import { deriveContextUsageTokens } from "@xagent/ui/lib/chat/contextUsage";
import { useCallback, type MutableRefObject } from "react";
import { readMessageContextUsage } from "../../../lib/chat/compaction/contextUsageMetadata";
import type {
  CompactionController,
  CompactionSinks,
  ManualCompactionOutcome,
  ManualContextUsageSnapshot,
} from "../../../lib/chat/compaction/controller";
import type { CompactionDecisionReason } from "../../../lib/chat/compaction/types";
import { getActiveSegment } from "../../../lib/chat/conversation/conversationState";
import type { LiveTranscriptStore } from "../../../lib/chat/conversation/liveTranscriptStore";
import { createTurnCancellation } from "../../../lib/chat/conversation/turnCancellation";
import { memoryTurnInjection } from "../../../lib/chat/memory/injectionController";
import { createProviderRuntimeConfig } from "../../../lib/providers/llm";
import type { AppSettings } from "../../../lib/settings";
import {
  acquireTrajectoryRecorder,
  updateTrajectoryRecorderSegment,
} from "../../../lib/trajectory/recorderRegistry";
import type { PersistConversationAction } from "../history/useConversationHistoryActions";
import type { ConversationRuntimeEntry } from "./chatPageRuntime";
import {
  buildPreparedContext as buildPreparedConversationContext,
  buildResumeContext as buildResumeConversationContext,
} from "./conversationContextBuilders";
import { resolveEffectiveChatModelSelection } from "./modelSelection";

export type ManualCompactionResult = {
  status: "compacted" | "failed" | "busy" | "skipped";
  message?: string;
};

export type ManualCompactionRequest = {
  conversationId?: string;
  operationId?: string;
  onAccepted?: () => void;
};

function resolveManualContextUsage(
  controller: CompactionController,
  runtimeEntry: ConversationRuntimeEntry,
): ManualContextUsageSnapshot {
  const runtimeSnapshot = controller.contextUsageSnapshot;
  const messages = getActiveSegment(runtimeEntry.state)?.messages ?? [];
  let fixedTokens: number | undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const usage = readMessageContextUsage(messages[index]);
    if (usage) {
      fixedTokens = usage.fixedTokens;
      break;
    }
  }
  return {
    totalTokens:
      runtimeSnapshot?.totalTokens ?? deriveContextUsageTokens(runtimeEntry.state.transcript.items),
    fixedTokens: runtimeSnapshot?.fixedTokens ?? fixedTokens,
  };
}

/** Runs explicit context compaction through the same local runtime used by normal sends. */
export function useManualCompaction(params: {
  settings: AppSettings;
  t: (key: string) => string;
  currentConversationIdRef: MutableRefObject<string>;
  isConversationRunning: (conversationId: string) => boolean;
  setConversationRunningState: (conversationId: string, value: boolean) => void;
  setConversationAbortController: (
    conversationId: string,
    controller: AbortController | null,
  ) => void;
  buildRuntimeEntryFromVisibleState: () => ConversationRuntimeEntry;
  conversationRuntimeCacheRef: MutableRefObject<Map<string, ConversationRuntimeEntry>>;
  ensureConversationReady: (conversationId: string) => Promise<string>;
  getCompactionController: (conversationId: string) => CompactionController;
  getConversationLiveTranscriptStore: (conversationId: string) => LiveTranscriptStore;
  updateConversationRuntimeEntry: (
    conversationId: string,
    updater: (prev: ConversationRuntimeEntry) => ConversationRuntimeEntry,
  ) => void;
  resetLiveTranscript: (store?: LiveTranscriptStore) => void;
  updateToolStatus: (status: string | null, store?: LiveTranscriptStore) => void;
  persistConversation: PersistConversationAction;
  setErrorMessage: (message: string | null) => void;
  resolveManualCompactionPromptInputs: (input: {
    isCurrentConversation: boolean;
    workdir?: string;
  }) => Promise<{ soulPrompt: string; skillsPrompt: string; memoryPrompt: string }>;
}) {
  const {
    settings,
    t,
    currentConversationIdRef,
    isConversationRunning,
    setConversationRunningState,
    setConversationAbortController,
    buildRuntimeEntryFromVisibleState,
    conversationRuntimeCacheRef,
    ensureConversationReady,
    getCompactionController,
    getConversationLiveTranscriptStore,
    updateConversationRuntimeEntry,
    resetLiveTranscript,
    updateToolStatus,
    persistConversation,
    setErrorMessage,
    resolveManualCompactionPromptInputs,
  } = params;

  return useCallback(
    async (request?: ManualCompactionRequest): Promise<ManualCompactionResult> => {
      const conversationId =
        request?.conversationId?.trim() || currentConversationIdRef.current.trim();
      if (!conversationId) {
        return { status: "skipped", message: t("chat.manualCompactRejected") };
      }

      const isCurrentConversation = () =>
        conversationId === currentConversationIdRef.current.trim();
      const transcriptStore = getConversationLiveTranscriptStore(conversationId);
      const cancellation = createTurnCancellation();
      let runningStateClaimed = false;
      let flushTrajectory: (() => Promise<void>) | null = null;

      const messageForSkipReason = (reason: CompactionDecisionReason): string => {
        switch (reason) {
          case "below-manual-threshold":
            return t("chat.manualCompactBelowThreshold");
          case "no-active-messages":
            return t("chat.manualCompactEmpty");
          default:
            return t("chat.manualCompactUnavailable");
        }
      };

      const mapOutcome = (
        outcome: ManualCompactionOutcome,
        failureMessage: string,
      ): ManualCompactionResult => {
        switch (outcome.status) {
          case "compacted":
            return { status: "compacted" };
          case "busy":
            return { status: "busy", message: t("chat.manualCompactRejected") };
          case "skipped":
            return { status: "skipped", message: messageForSkipReason(outcome.reason) };
          default:
            return outcome.aborted
              ? { status: "skipped", message: t("chat.manualCompactCancelled") }
              : {
                  status: "failed",
                  message: failureMessage || t("chat.manualCompactFailed"),
                };
        }
      };

      try {
        if (isConversationRunning(conversationId)) {
          return { status: "busy", message: t("chat.manualCompactRejected") };
        }

        let runtimeEntry: ConversationRuntimeEntry;
        if (isCurrentConversation()) {
          const visibleEntry = buildRuntimeEntryFromVisibleState();
          const visibleMessages = getActiveSegment(visibleEntry.state)?.messages ?? [];
          if (visibleMessages.length > 0) {
            runtimeEntry = visibleEntry;
          } else {
            await ensureConversationReady(conversationId);
            runtimeEntry = conversationRuntimeCacheRef.current.get(conversationId) ?? visibleEntry;
          }
        } else {
          await ensureConversationReady(conversationId);
          const cached = conversationRuntimeCacheRef.current.get(conversationId);
          if (!cached) {
            throw new Error("Conversation runtime is unavailable after history hydration");
          }
          runtimeEntry = cached;
        }

        if (isConversationRunning(conversationId)) {
          return { status: "busy", message: t("chat.manualCompactRejected") };
        }
        setConversationRunningState(conversationId, true);
        runningStateClaimed = true;
        setConversationAbortController(conversationId, cancellation.userStop);

        if (runtimeEntry.compactionStatus.phase === "running") {
          return { status: "busy", message: t("chat.manualCompactRejected") };
        }

        const effective = resolveEffectiveChatModelSelection({
          settings,
          conversationSelectedModel: runtimeEntry.selectedModel,
        });
        const { provider, providerId, model, selectedModel } = effective;
        const runtime = createProviderRuntimeConfig(
          provider,
          model,
          settings.chatRuntimeControls,
        );
        const promptInputs = await resolveManualCompactionPromptInputs({
          isCurrentConversation: isCurrentConversation(),
          workdir: runtimeEntry.workdir,
        });
        const memoryPrompt =
          memoryTurnInjection.getSystemText(conversationId) ?? promptInputs.memoryPrompt;

        let failureMessage = "";
        const sinks: CompactionSinks = {
          applyState: (state) =>
            updateConversationRuntimeEntry(conversationId, (previous) => ({
              ...previous,
              state,
            })),
          applyStateMidRun: (state) => {
            updateConversationRuntimeEntry(conversationId, (previous) => ({
              ...previous,
              state,
            }));
            resetLiveTranscript(transcriptStore);
          },
          publishStatus: (status) => {
            if (status.phase === "failed") failureMessage = status.message;
            updateConversationRuntimeEntry(conversationId, (previous) => ({
              ...previous,
              compactionStatus: status,
            }));
          },
          setLiveToolStatus: (status) => updateToolStatus(status, transcriptStore),
          queueCheckpoint: () => undefined,
          persist: (state) =>
            persistConversation({
              conversationId,
              sessionId: runtimeEntry.sessionId,
              providerId,
              model,
              selectedModel,
              cwd: runtimeEntry.workdir,
              state,
              fallbackTitle: t("chat.pendingTitle"),
              createdAt: runtimeEntry.createdAt,
              titlePromise: null,
            }),
        };

        const compactionController = getCompactionController(conversationId);
        const trajectory = acquireTrajectoryRecorder(
          conversationId,
          getActiveSegment(runtimeEntry.state)?.segmentIndex ??
            runtimeEntry.state.meta.activeSegmentIndex,
        );
        flushTrajectory = trajectory.recorder.flush;
        compactionController.setObserver({
          onStart: ({ trigger }) => {
            trajectory.recorder.compactionStart({ standalone: trigger === "manual" });
          },
          onEnd: ({ trigger, status, tokensBefore, tokensAfter, newSegmentIndex, error }) => {
            trajectory.recorder.compactionEnd({
              status,
              standalone: trigger === "manual",
              ...(tokensBefore === undefined ? {} : { tokensBefore }),
              ...(tokensAfter === undefined ? {} : { tokensAfter }),
              ...(error === undefined ? {} : { error }),
            });
            if (status === "complete" && newSegmentIndex !== undefined) {
              updateTrajectoryRecorderSegment(conversationId, newSegmentIndex);
            }
          },
        });

        const outcome = await compactionController.compactManually(
          {
            providerId,
            model,
            runtime,
            cancellation,
            sinks,
            buildPreparedContext: (state, tools, options) =>
              buildPreparedConversationContext({
                state,
                tools,
                soulPrompt: promptInputs.soulPrompt,
                skillsPrompt: promptInputs.skillsPrompt,
                memoryPrompt,
                includeAbortedMessages: options?.includeAbortedMessages,
                includeUploadedFilesMetadata: options?.includeUploadedFilesMetadata,
              }),
            buildResumeContext: (state, resumeMessage, tools, options) =>
              buildResumeConversationContext({
                state,
                resumeMessage,
                tools,
                soulPrompt: promptInputs.soulPrompt,
                skillsPrompt: promptInputs.skillsPrompt,
                memoryPrompt,
                includeAbortedMessages: options?.includeAbortedMessages,
                includeUploadedFilesMetadata: options?.includeUploadedFilesMetadata,
              }),
          },
          runtimeEntry.state,
          resolveManualContextUsage(compactionController, runtimeEntry),
          {
            tools: runtimeEntry.state.meta.tools,
            onProceed: request?.onAccepted,
          },
        );

        if (outcome.status === "compacted") {
          memoryTurnInjection.invalidate(conversationId);
        }
        const result = mapOutcome(outcome, failureMessage);
        if (result.status === "failed" && result.message && isCurrentConversation()) {
          setErrorMessage(result.message);
        }
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isCurrentConversation()) setErrorMessage(message);
        return { status: "failed", message };
      } finally {
        if (flushTrajectory) await flushTrajectory();
        setConversationAbortController(conversationId, null);
        if (runningStateClaimed) setConversationRunningState(conversationId, false);
      }
    },
    [
      buildRuntimeEntryFromVisibleState,
      conversationRuntimeCacheRef,
      currentConversationIdRef,
      ensureConversationReady,
      getCompactionController,
      getConversationLiveTranscriptStore,
      isConversationRunning,
      persistConversation,
      resetLiveTranscript,
      resolveManualCompactionPromptInputs,
      setConversationAbortController,
      setConversationRunningState,
      setErrorMessage,
      settings,
      t,
      updateConversationRuntimeEntry,
      updateToolStatus,
    ],
  );
}
