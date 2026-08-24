import type { AssistantMessage, Context } from "@earendil-works/pi-ai";
import type { HostedSearchBlock } from "@xagent/ui/lib/chat/hostedSearch";
import {
  composeTrajectorySystemPrompt,
  serializeToolCatalog,
} from "@xagent/ui/lib/trajectory/sections";
import type { TrajectoryUsage } from "@xagent/ui/lib/trajectory/types";
import type { CompactionController } from "../../../lib/chat/compaction/controller";
import { estimateTextTokenUnits } from "../../../lib/chat/compaction/tokenLedger";
import type { ProviderRuntimeConfig } from "../../../lib/chat/compaction/types";
import {
  appendMessagesToConversation,
  type ConversationViewState,
} from "../../../lib/chat/conversation/conversationState";
import type {
  LiveTranscriptStore,
  RetryAttemptRecord,
} from "../../../lib/chat/conversation/liveTranscriptStore";
import type {
  ConversationEventController,
  ConversationHookLifecycle,
} from "../../../lib/chat/conversation/run";
import type { TurnCancellation } from "../../../lib/chat/conversation/turnCancellation";
import { memoryExtraction } from "../../../lib/chat/memory/extractionController";
import type {
  MemoryExtractionModelConfig,
  MemoryExtractionStatusText,
} from "../../../lib/chat/memory/extractionEngine";
import {
  appendTextDeltaToRound,
  collapseThinking,
  type LiveRound,
  updateLiveRound,
  upsertHostedSearchToRound,
} from "../../../lib/chat/messages/uiMessages";
import { isAbortLikeError } from "../../../lib/chat/page/chatPageHelpers";
import type { AgentRunnerFailoverParams } from "../../../lib/chat/runner/agentRunner";
import {
  createDeferredProviderNativeWebSearchStatus,
  resolveProviderNativeWebSearchStatus,
} from "../../../lib/chat/search/providerNativeSearchStatus";
import type { StreamDebugLogger } from "../../../lib/debug/agentDebug";
import { assistantMessageToText, streamAssistantMessage } from "../../../lib/providers/llm";
import type { ProviderId } from "../../../lib/settings";
import { trajectoryTerminalInfo } from "../../../lib/trajectory/assistantOutcome";
import {
  NOOP_TRAJECTORY_RECORDER,
  type TrajectoryRecorder,
} from "../../../lib/trajectory/recorder";
import { buildPartialAssistantMessage } from "../runtime/chatPageRuntime";

export type RuntimeModel = {
  api: AssistantMessage["api"];
  provider: AssistantMessage["provider"];
  id: string;
};

export type PersistConversationParams = {
  conversationId: string;
  sessionId: string;
  providerId: string;
  model: string;
  cwd?: string;
  state: ConversationViewState;
  fallbackTitle: string;
  createdAt: number;
  titlePromise: Promise<string | null> | null;
};

/** Normalize provider usage without inventing zero-valued fields. */
function toTrajectoryUsage(value: unknown): TrajectoryUsage | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const pick = (key: string) => (typeof raw[key] === "number" ? (raw[key] as number) : undefined);
  const usage: TrajectoryUsage = {
    ...(pick("totalTokens") === undefined ? {} : { totalTokens: pick("totalTokens") }),
    ...(pick("input") === undefined ? {} : { input: pick("input") }),
    ...(pick("output") === undefined ? {} : { output: pick("output") }),
    ...(pick("cacheRead") === undefined ? {} : { cacheRead: pick("cacheRead") }),
    ...(pick("cacheWrite") === undefined ? {} : { cacheWrite: pick("cacheWrite") }),
    ...(pick("reasoning") === undefined ? {} : { reasoning: pick("reasoning") }),
  };
  return Object.keys(usage).length === 0 ? undefined : usage;
}

export type RunTextConversationTurnParams = {
  providerId: ProviderId;
  model: string;
  runtime: ProviderRuntimeConfig;
  failover?: AgentRunnerFailoverParams;
  runtimeModel: RuntimeModel;
  selectedModel: {
    customProviderId: string;
    model: string;
  };
  sessionId: string;
  conversationId: string;
  conversationCwd?: string;
  historyCwd?: string;
  fallbackTitle: string;
  createdAt: number;
  titlePromise: Promise<string | null> | null;
  transcriptStore: LiveTranscriptStore;
  conversationEvents: ConversationEventController;
  hookLifecycle: ConversationHookLifecycle;
  conversationDebugLogger: StreamDebugLogger;
  recoveryDebugLogger: StreamDebugLogger;
  getNextConversationState: () => ConversationViewState;
  applyConversationState: (state: ConversationViewState) => void;
  buildPreparedContext: (
    state: ConversationViewState,
    tools?: Context["tools"],
    options?: { includeAbortedMessages?: boolean; includeUploadedFilesMetadata?: boolean },
  ) => Context;
  compaction: CompactionController;
  cancellation: TurnCancellation;
  resetLiveTranscript: (store: LiveTranscriptStore) => void;
  settleLiveTranscript: (store: LiveTranscriptStore) => void;
  appendDraftAssistantText: (delta: string, store: LiveTranscriptStore) => void;
  batchLiveRoundsUpdate: (
    updater: (prev: LiveRound[]) => LiveRound[],
    store: LiveTranscriptStore,
  ) => void;
  updateConversationEventToolStatus: (status: string | null, isCompaction?: boolean) => void;
  updateRetryAttempts: (attempts: RetryAttemptRecord[], store: LiveTranscriptStore) => void;
  commitVisibleAbortedConversation: () => boolean;
  updateConversationRuntimeEntry: (
    conversationId: string,
    updater: (prev: ConversationRuntimeEntry) => ConversationRuntimeEntry,
  ) => ConversationRuntimeEntry;
  persistConversationWithHistorySync: (
    params: PersistConversationParams,
  ) => Promise<ConversationViewState | null>;
  memoryExtractionModel?: MemoryExtractionModelConfig;
  onMemoryExtractionModelFailure?: (model: MemoryExtractionModelConfig) => void;
  memoryExtractionStatusText?: MemoryExtractionStatusText;
  trajectory?: TrajectoryRecorder;
  trajectoryTurn?: number;
  trajectoryMessageIndex?: number;
  trajectoryMessageId?: string;
  readTrajectorySlots?: () => {
    base?: string;
    agent?: string;
    skills?: string;
    memory?: string;
  };
};

export async function runTextConversationTurn(params: RunTextConversationTurnParams) {
  const {
    providerId,
    model,
    runtime,
    failover,
    runtimeModel,
    selectedModel,
    sessionId,
    conversationId,
    conversationCwd,
    historyCwd = conversationCwd,
    fallbackTitle,
    createdAt,
    titlePromise,
    transcriptStore,
    conversationEvents,
    hookLifecycle,
    conversationDebugLogger,
    recoveryDebugLogger,
    getNextConversationState,
    applyConversationState,
    buildPreparedContext,
    compaction,
    cancellation,
    resetLiveTranscript,
    settleLiveTranscript,
    appendDraftAssistantText,
    batchLiveRoundsUpdate,
    updateConversationEventToolStatus,
    updateRetryAttempts,
    commitVisibleAbortedConversation,
    updateConversationRuntimeEntry,
    persistConversationWithHistorySync,
    memoryExtractionModel,
    onMemoryExtractionModelFailure,
    memoryExtractionStatusText,
  } = params;

  const trajectory = params.trajectory ?? NOOP_TRAJECTORY_RECORDER;
  if (params.trajectoryTurn !== undefined) {
    trajectory.beginTurn({
      turn: params.trajectoryTurn,
      ...(params.trajectoryMessageIndex === undefined
        ? {}
        : { messageIndex: params.trajectoryMessageIndex }),
      ...(params.trajectoryMessageId === undefined
        ? {}
        : { messageId: params.trajectoryMessageId }),
    });
  }

  // Reset per-turn dedup state so <already-written-this-turn> reflects only
  // this turn. In-flight extraction from the previous turn keeps running.
  memoryExtraction.noteTurnBoundary(conversationId);

  let finalAssistant: AssistantMessage | null = null;
  let contextWithSkills = buildPreparedContext(getNextConversationState());
  let pendingTextContext: Context | null = null;
  let textRound = 1;
  let protectionCompactionDisabled = false;

  function commitAssistantRoundMeta(assistant: AssistantMessage, round: number) {
    conversationEvents.queueToken("", {
      round,
      provider: assistant.provider,
      model: assistant.model,
      api: assistant.api,
      stopReason: assistant.stopReason,
      usage: assistant.usage,
      contextUsageTokens,
    });
    batchLiveRoundsUpdate(
      (prev) =>
        updateLiveRound(prev, round, (target) => ({
          ...collapseThinking(target),
          meta: {
            provider: String(assistant.provider ?? ""),
            model: String(assistant.model ?? ""),
            api: String(assistant.api ?? ""),
            stopReason: String(assistant.stopReason ?? ""),
            usage: assistant.usage,
            usageTotalTokens: assistant.usage?.totalTokens,
            contextUsageTokens,
          },
        })),
      transcriptStore,
    );
  }

  let textModeUsesLiveRounds = false;

  function ensureTextLiveRound(round: number) {
    textModeUsesLiveRounds = true;
    batchLiveRoundsUpdate((prev) => {
      if (prev.some((item) => item.round === round)) return prev;
      return [
        ...prev,
        {
          key: `r${round}`,
          round,
          blocks: [],
          runningToolCallIds: [],
          thinkingOpen: false,
        },
      ];
    }, transcriptStore);
  }

  function updateHostedSearch(hostedSearch: HostedSearchBlock, round: number, existingText = "") {
    const shouldSeedExistingText = !textModeUsesLiveRounds && existingText.length > 0;
    ensureTextLiveRound(round);
    conversationEvents.queueEvent({
      type: "hosted_search",
      id: hostedSearch.id,
      provider: hostedSearch.provider,
      status: hostedSearch.status,
      queries: hostedSearch.queries,
      sources: hostedSearch.sources,
      updatedAt: hostedSearch.updatedAt,
      round,
      conversation_id: conversationId,
    });
    batchLiveRoundsUpdate(
      (prev) =>
        updateLiveRound(prev, round, (target) =>
          upsertHostedSearchToRound(
            shouldSeedExistingText
              ? appendTextDeltaToRound(collapseThinking(target), existingText)
              : collapseThinking(target),
            hostedSearch,
          ),
        ),
      transcriptStore,
    );
  }

  function recordTextRequestStart(context: Context, systemSuffix: string) {
    const toolCatalog = serializeToolCatalog(context.tools);
    const segmentedHeader = {
      ...(params.readTrajectorySlots?.() ?? {}),
      toolsSuffix: systemSuffix,
      ...(toolCatalog === undefined ? {} : { toolCatalog }),
    };
    const actualSystemPrompt =
      typeof context.systemPrompt === "string" ? context.systemPrompt : undefined;
    const reconstructed = composeTrajectorySystemPrompt(segmentedHeader);
    const headerInput =
      actualSystemPrompt !== undefined && reconstructed !== actualSystemPrompt
        ? {
            runtime: actualSystemPrompt,
            ...(toolCatalog === undefined ? {} : { toolCatalog }),
          }
        : segmentedHeader;
    if (headerInput !== segmentedHeader) {
      console.warn(
        "[trajectory] text-mode segmented system prompt drifted from provider context; recording exact fallback",
      );
    }
    const headerId = trajectory.captureHeader(headerInput);
    if (startedTrajectorySteps.has(textRound)) return;
    startedTrajectorySteps.add(textRound);
    trajectory.stepStart(textRound, headerId);
  }

  await compaction.maybeCompactPreSend({
    budgetContext: buildPreparedContext(getNextConversationState(), undefined, {
      includeUploadedFilesMetadata: true,
    }),
    includeUploadedFilesMetadata: true,
  });
  hookLifecycle.startAgent();

  textResponseLoop: while (!finalAssistant) {
    contextWithSkills =
      pendingTextContext ??
      buildPreparedContext(getNextConversationState(), undefined, {
        includeUploadedFilesMetadata: true,
      });
    pendingTextContext = null;
    compaction.beginRequest(contextWithSkills, getNextConversationState());
    hookLifecycle.startTurn(textRound);
    textModeUsesLiveRounds = false;

    let streamedAssistantText = "";
    let streamedAssistantTokenUnits = 0;
    let protectionCheckChars = 0;
    let compactionRequested = false;
    let streamAttempt = 0;
    let failoverAttempt = 0;
    let failoverStatusVisible = false;
    const nativeWebSearchEnabled = runtime.nativeWebSearchEnabled !== false;
    const nativeWebSearchStatus = resolveProviderNativeWebSearchStatus({
      providerId,
      api: runtimeModel.api,
      enabled: nativeWebSearchEnabled,
      baseUrl: runtime.baseUrl,
      modelId: model,
    });

    while (!finalAssistant) {
      const scope = cancellation.deriveScope();
      const nativeWebSearchStatusController = createDeferredProviderNativeWebSearchStatus({
        status: nativeWebSearchStatus,
        onStatus: (status) => updateConversationEventToolStatus(status),
      });
      const retryAttemptsForAttempt: RetryAttemptRecord[] = [];
      updateRetryAttempts(retryAttemptsForAttempt, transcriptStore);
      try {
        finalAssistant = await streamAssistantMessage({
          providerId,
          model,
          runtime,
          failover: failover
            ? {
                config: failover.config,
                primary: failover.primary,
                fallbacks: failover.fallbacks,
                onSwitched: ({ target, errorMessage }) => {
                  failover.onSwitched?.({ target, round: textRound, errorMessage });
                },
                onFailover: ({ fromLabel, toLabel, errorMessage }) => {
                  failoverAttempt += 1;
                  trajectory.noteRetry(textRound, {
                    attempt: failoverAttempt,
                    maxRetries: failover.fallbacks.length,
                    ...(errorMessage ? { error: errorMessage } : {}),
                  });
                  failoverStatusVisible = true;
                  updateConversationEventToolStatus(
                    `第 ${textRound} 轮：${fromLabel} 不可用，正在切换到 ${toLabel}...`,
                  );
                },
              }
            : undefined,
          context: contextWithSkills,
          workdir: conversationCwd,
          sessionId,
          nativeWebSearch: nativeWebSearchEnabled,
          onRequestStart: ({ context, systemSuffix }) => {
            recordTextRequestStart(context, systemSuffix);
          },
          onTextDelta: (delta) => {
            trajectory.firstToken(textRound);
            if (failoverStatusVisible) {
              failoverStatusVisible = false;
              updateConversationEventToolStatus(null);
            }
            nativeWebSearchStatusController.noteVisibleActivity();
            conversationEvents.queueToken(delta, { round: textRound });
            if (textModeUsesLiveRounds) {
              batchLiveRoundsUpdate(
                (prev) =>
                  updateLiveRound(prev, textRound, (target) =>
                    appendTextDeltaToRound(collapseThinking(target), delta),
                  ),
                transcriptStore,
              );
            } else {
              appendDraftAssistantText(delta, transcriptStore);
            }
            streamedAssistantText += delta;
            streamedAssistantTokenUnits += estimateTextTokenUnits(delta);
            protectionCheckChars += delta.length;
            if (compactionRequested || protectionCompactionDisabled || protectionCheckChars < 160) {
              return;
            }
            protectionCheckChars = 0;
            if (!compaction.shouldProtectMidStream(streamedAssistantTokenUnits)) return;
            compactionRequested = true;
            scope.controller.abort();
          },
          onHostedSearch: (hostedSearch) => {
            trajectory.firstToken(textRound);
            if (hostedSearch.status === "searching") {
              nativeWebSearchStatusController.schedule();
            } else {
              nativeWebSearchStatusController.pause();
            }
            updateHostedSearch(hostedSearch, textRound, streamedAssistantText);
          },
          signal: scope.controller.signal,
          debugLogger: streamAttempt === 0 ? conversationDebugLogger : recoveryDebugLogger,
          onRetryStatus: (attempt, maxAttempts, errorMessage) => {
            updateConversationEventToolStatus(
              `连接已断开，正在重试 (${attempt}/${maxAttempts})...`,
            );
            retryAttemptsForAttempt.push({ attempt, maxAttempts, errorMessage });
            updateRetryAttempts(retryAttemptsForAttempt.slice(), transcriptStore);
          },
          onRetryRecovered: () => {
            updateConversationEventToolStatus(null);
          },
        });
        trajectory.firstToken(textRound);
        const trajectoryUsage = toTrajectoryUsage(finalAssistant.usage);
        trajectory.stepEnd(textRound, {
          ...trajectoryTerminalInfo(finalAssistant),
          ...(trajectoryUsage === undefined ? {} : { usage: trajectoryUsage }),
        });
        nativeWebSearchStatusController.finish();
      } catch (streamErr) {
        nativeWebSearchStatusController.finish();
        if (compactionRequested) {
          hookLifecycle.ensureMessageEnded();
          hookLifecycle.endTurn(textRound);
          resetLiveTranscript(transcriptStore);
          textModeUsesLiveRounds = false;

          const partialAssistant = buildPartialAssistantMessage({
            model: runtimeModel,
            text: streamedAssistantText,
            stopReason: "aborted",
          });
          if (partialAssistant) {
            applyConversationState(
              appendMessagesToConversation(getNextConversationState(), [partialAssistant]),
            );
          }

          const compactionResult = await compaction.compactDuringRun({
            trigger: "mid-stream",
            state: getNextConversationState(),
            includeAbortedMessages: true,
            includeUploadedFilesMetadata: true,
          });

          if (!compactionResult.context) {
            throw new Error("Mid-stream compaction did not provide a continuation context.");
          }
          pendingTextContext = compactionResult.context;
          if (compactionResult.shouldDisableProtection) {
            protectionCompactionDisabled = true;
          }
          textRound += 1;
          continue textResponseLoop;
        }

        if (cancellation.userStop.signal.aborted || isAbortLikeError(streamErr)) {
          if (commitVisibleAbortedConversation()) {
            return;
          }
          throw streamErr;
        }

        if (streamAttempt < 1) {
          streamAttempt += 1;
          trajectory.noteRetry(textRound, {
            attempt: streamAttempt,
            maxRetries: 1,
            error: streamErr instanceof Error ? streamErr.message : String(streamErr),
          });
          streamedAssistantText = "";
          streamedAssistantTokenUnits = 0;
          protectionCheckChars = 0;
          resetLiveTranscript(transcriptStore);
          textModeUsesLiveRounds = false;
          continue;
        }

        throw streamErr;
      } finally {
        scope.release();
      }
    }

    hookLifecycle.ensureMessageEnded();
    hookLifecycle.endTurn(textRound);
  }

  const finalAssistantText = assistantMessageToText(finalAssistant);
  if (!conversationEvents.hasForwardedText() && finalAssistantText.length > 0) {
    conversationEvents.queueToken(finalAssistantText, { round: textRound });
  }
  const finalState = appendMessagesToConversation(getNextConversationState(), [finalAssistant]);
  const shouldRunMemoryExtraction =
    finalAssistant.stopReason !== "error" && finalAssistant.stopReason !== "aborted";
  commitAssistantRoundMeta(finalAssistant, textRound);
  settleLiveTranscript(transcriptStore);
  updateConversationRuntimeEntry(conversationId, (prev) => ({
    ...prev,
    state: finalState,
  }));
  hookLifecycle.ensureMessageEnded();
  hookLifecycle.endAgent();
  trajectory.endTurn(trajectoryTerminalInfo(finalAssistant));
  await trajectory.flush();
  void persistConversationWithHistorySync({
    conversationId,
    sessionId,
    providerId,
    model,
    cwd: conversationCwd,
    state: finalState,
    fallbackTitle,
    createdAt,
    titlePromise,
  });
  conversationEvents.queueEvent({
    type: "done",
    conversation_id: conversationId,
  });
  conversationEvents.close();
  if (shouldRunMemoryExtraction) {
    const currentMemoryExtractionModel: MemoryExtractionModelConfig = {
      providerId,
      model,
      runtime,
      selectedModel,
    };
    // Fire-and-forget; the controller owns lifecycle/abort, detached from the
    // chat request signal.
    void memoryExtraction.requestExtraction({
      primary: memoryExtractionModel ?? currentMemoryExtractionModel,
      fallback: memoryExtractionModel ? currentMemoryExtractionModel : undefined,
      onPrimaryFailure: memoryExtractionModel ? onMemoryExtractionModelFailure : undefined,
      sessionId,
      conversationId,
      workdir: conversationCwd,
      // 抽取子模型看到的必须是用户真正说的话:memory 增量块只服务主模型的缓存,
      // 混进来会把索引行当成用户发言,既撑破短消息门控又诱发重复写入。
      messages: buildPreparedContext(finalState).messages,
      statusText: memoryExtractionStatusText,
      signal: cancellation.userStop.signal,
      debugLogger: conversationDebugLogger,
    });
  }
}
