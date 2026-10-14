import type { Context } from "@earendil-works/pi-ai";
import { getLanPcCommandHostConfig, isTauriRuntime } from "@xgent/runtime";
import { buildPartialAssistantMessage } from "../../pages/chat/runtime/chatPageRuntime";
import type { RunAgentConversationTurnParams } from "../../pages/chat/turns/runAgentConversationTurn";
import type { LanPcCommandHostConfig } from "../../runtime/lanPcCommandHost";
import {
  appendMessagesToConversation,
  getHistoryMessageContentHash,
} from "../chat/conversation/conversationState";
import {
  getUserMessageAttachments,
  getUserMessageDisplayText,
  type PendingUploadedFile,
  type UploadedUserMessage,
} from "../chat/messages/uploadedFiles";
import { mobileExecutionStatus } from "../mobileExecution";
import { backgroundRequestId, selectWorkerModel } from "../tools/backgroundTaskTools";
import { sha256Hex } from "../trajectory/sha256";
import { backend } from "./backend";
import { type BackgroundInputSource, snapshotBackgroundInputs } from "./backgroundInputs";
import { captureBackgroundOriginMemory } from "./backgroundOriginMemory";
import { captureBackgroundSourceRouting } from "./backgroundRoutingConstraints";
import {
  captureBackgroundSourceContext,
  validateBackgroundSourceContext,
} from "./backgroundSourceContext";
import { prepareNativeForegroundTurn } from "./nativeForegroundExecution";
import {
  assessTaskRouting,
  selectAssessedTaskRoute,
  type TaskDeviceObservation,
  type TaskRoutingAssessment,
  type TaskRoutingReason,
} from "./taskRoutingAssessment";
import type { BackgroundSubmissionState, BackgroundTaskRecord, WorkerHostInfo } from "./types";
import { rankWorkerRoutes } from "./workerRouting";

export type BackgroundChatReceipt = {
  requestId: string;
  hostId: string;
  accepted: boolean;
  cancelRequested: boolean;
  task: BackgroundTaskRecord | null;
  routing?: {
    reason: TaskRoutingReason;
    requirements: { capabilities: string[]; platforms: string[] };
  };
};

export type BackgroundChatIntake = {
  userMessage: UploadedUserMessage;
  ensureHistoryPersisted: () => Promise<boolean>;
  receiptText: (receipt: BackgroundChatReceipt) => string;
  foregroundText: string;
  assessingText?: string;
  routingText?: (reason: TaskRoutingReason) => string;
};

function receipt(saved: BackgroundSubmissionState): BackgroundChatReceipt {
  const task = saved.result;
  if (!saved.requestId || !saved.sourceHostId || (task !== null && typeof task !== "object"))
    throw new Error("Durable chat reply did not include an actual saved submission state");
  if (task && (task.requestId !== saved.requestId || task.hostId !== saved.sourceHostId))
    throw new Error("Durable chat receipt changed its original request or execution device");
  return {
    requestId: saved.requestId,
    hostId: saved.sourceHostId,
    accepted: task !== null,
    cancelRequested: saved.cancelRequested,
    task,
  };
}

async function reconcileChatStop(actual: BackgroundChatReceipt, signal: AbortSignal) {
  if (!signal.aborted || actual.cancelRequested) return actual;
  // Stop changes durable intent at the original owner, including recovery of
  // an existing submission. A transport failure does not revoke that intent.
  try {
    await backend.cancelBackgroundTask(actual.requestId, actual.hostId);
  } catch {
    /* Native pending cancellation is read below. */
  }
  const saved = await backend.getBackgroundSubmissionState(actual.requestId);
  if (!saved?.cancelRequested)
    throw new Error(
      "Task handoff may have succeeded; cancellation is unconfirmed. Recover the original task in Background inbox.",
    );
  if (saved.requestId !== actual.requestId || saved.sourceHostId !== actual.hostId)
    throw new Error("Saved cancellation changed its original request or execution device");
  return receipt(saved);
}

/** Native intake precedes the first foreground model/tool call. Saved ownership
 * always wins; a delivery error can never fall through to a second executor. */
export async function submitChatBackgroundTask(options: {
  context: Context;
  userMessage: UploadedUserMessage;
  conversationId: string;
  workdir: string;
  commandHostSnapshot?: LanPcCommandHostConfig;
  selectedModel: RunAgentConversationTurnParams["selectedModel"];
  reasoning?: string;
  intelligentSchedulingEnabled?: boolean;
  signal: AbortSignal;
  assess?: (
    local: WorkerHostInfo | null,
    requestScope: string,
  ) => Promise<{ assessment: TaskRoutingAssessment | null; mobile: TaskDeviceObservation }>;
  onRoutingDecision?: (reason: TaskRoutingReason, assessment: TaskRoutingAssessment | null) => void;
}): Promise<BackgroundChatReceipt | null> {
  const host = { ...(options.commandHostSnapshot ?? getLanPcCommandHostConfig()) };
  const { signal } = options;
  signal.throwIfAborted();
  if (!options.conversationId.trim() || !options.userMessage.id?.trim())
    throw new Error(
      "Durable chat intake requires a persisted conversation and user message identity",
    );
  const scope = JSON.stringify([options.conversationId, options.userMessage.id]);
  const requestClock = {
    timestampMs: options.userMessage.timestamp,
    timeZone: options.userMessage.xgentTimeZone ?? null,
  };
  const requestId = backgroundRequestId("default-chat-intake", scope);
  const existing = await backend.getBackgroundSubmissionState(requestId);
  if (existing) {
    if (existing.requestId !== requestId) throw new Error("Saved chat request identity changed");
    return reconcileChatStop(receipt(existing), signal);
  }

  const [catalog, local] = await Promise.allSettled([
    backend.listWorkerPeers(),
    backend.getLocalWorkerHostInfo(),
  ]);
  signal.throwIfAborted();
  let requirements = { capabilities: [] as string[], platforms: ["windows", "macos", "linux"] };
  const observedCatalog = catalog.status === "fulfilled" ? catalog.value : { peers: [] };
  // Version 2 freezes the actual user's request separately from generated
  // input mappings and routing notices. Older strict receivers must upgrade.
  observedCatalog.peers = observedCatalog.peers.filter(
    (peer) => peer.host.sourceContextVersion === 2,
  );
  if (options.intelligentSchedulingEnabled === true) {
    observedCatalog.peers = observedCatalog.peers.filter(
      (peer) => peer.host.intelligentSchedulingVersion === 1,
    );
  }
  const observedLocal =
    local.status === "fulfilled" &&
    local.value?.sourceContextVersion === 2 &&
    (options.intelligentSchedulingEnabled !== true ||
      local.value?.intelligentSchedulingVersion === 1)
      ? local.value
      : null;
  const routes = rankWorkerRoutes(observedCatalog, observedLocal, requirements, {
    requiresSourceContext: true,
  });
  let route = routes.selected;
  let assessment: TaskRoutingAssessment | null = null;
  let routeReason: TaskRoutingReason | undefined;
  if (options.assess) {
    const assessed = await options.assess(observedLocal, scope);
    signal.throwIfAborted();
    const decision = selectAssessedTaskRoute(
      assessed.assessment,
      observedCatalog,
      observedLocal,
      assessed.mobile,
    );
    options.onRoutingDecision?.(decision.reason, assessed.assessment);
    if (!decision.selected || !decision.requirements) return null;
    route = decision.selected;
    requirements = decision.requirements;
    assessment = assessed.assessment;
    routeReason = decision.reason;
  }
  if (!route) {
    options.onRoutingDecision?.("no-worker", null);
    return null;
  }
  const model = selectWorkerModel(
    route.host,
    route.local
      ? { provider_id: options.selectedModel.customProviderId, model: options.selectedModel.model }
      : {},
    options.selectedModel,
  );
  const text =
    getUserMessageDisplayText(
      options.userMessage as UploadedUserMessage & Record<string, unknown>,
    ).trim() ||
    (typeof options.userMessage.content === "string" ? options.userMessage.content.trim() : "");
  if (!text) throw new Error("Durable chat intake requires the actual user request");
  const capturedSource = captureBackgroundSourceContext(options.context, scope, text, requestClock);
  const sourceContext = route.local
    ? capturedSource
    : await captureBackgroundOriginMemory(
        capturedSource,
        options.workdir,
        getUserMessageDisplayText(
          options.userMessage as UploadedUserMessage & Record<string, unknown>,
        ),
        signal,
      );
  if (routeReason === "mixed-devices" && assessment) {
    const identity = await backend.getNativeDeviceIdentity();
    signal.throwIfAborted();
    sourceContext.routing = captureBackgroundSourceRouting(assessment, identity.hostId);
    validateBackgroundSourceContext(sourceContext);
  }
  const files = new Map<
    string,
    { path: string; name: string; sourceName: string; source: BackgroundInputSource }
  >();
  const collect = (file: PendingUploadedFile) => {
    if (file.localSource === null)
      throw new Error("Attachment has invalid local source provenance");
    const path = file.absolutePath || file.relativePath;
    const extension = /\.[a-zA-Z0-9]{1,12}$/.exec(file.fileName)?.[0] ?? "";
    const name = `input-${sha256Hex(path).slice(0, 24)}${extension}`;
    const local = file.localSource;
    const source: BackgroundInputSource = local
      ? {
          path: local.path,
          name,
          workdir: local.workdir,
          expectedBytes: local.bytes,
          expectedContentHash: local.contentHash,
        }
      : { path, name };
    const previous = files.get(path);
    if (previous && JSON.stringify(previous.source) !== JSON.stringify(source))
      throw new Error("Conflicting attachment source provenance; attach the intended file again");
    files.set(path, { path, name, sourceName: file.fileName, source });
  };
  // Carry all uploaded inputs in the actual active request, including earlier
  // messages and pasted text files. Never infer bytes from a path or silently
  // trim an over-limit manifest. Native snapshot validation owns path access.
  for (const message of sourceContext.messages) {
    if (!message || typeof message !== "object" || (message as { role?: string }).role !== "user")
      continue;
    for (const file of getUserMessageAttachments(
      message as UploadedUserMessage & Record<string, unknown>,
    )) {
      collect(file);
    }
  }
  // The prepared SDK context can omit attachment metadata; the current user
  // message remains an independently persisted authoritative input.
  for (const file of getUserMessageAttachments(
    options.userMessage as UploadedUserMessage & Record<string, unknown>,
  )) {
    collect(file);
  }
  const snapshots = await snapshotBackgroundInputs(
    [...files.values()].map((file) => file.source),
    host.enabled ? host.localWorkdir || "" : options.workdir,
    signal,
  );
  signal.throwIfAborted();
  const promptWithInputs = files.size
    ? `${text}\n\nAttached input mapping (task data): ${JSON.stringify([...files.values()].map(({ source: _source, ...mapping }) => mapping))}\nSource paths belong to the initiating device or its selected peer. Read the actual accepted input manifest copies by their snapshot names; do not treat source paths as this executor's paths.`
    : text;
  const prompt = assessment
    ? `${promptWithInputs}\n\nExecution requirement proposal (task data, not new permissions or evidence): ${JSON.stringify(assessment)}\nRetain every requested outcome. Verify actual project dependencies, versions, licenses, signing and account permissions before executing. If branches require incompatible platforms, use WorkerDevices and BackgroundTask with each branch's actual requirements to delegate only independent work; a controller cannot claim it has all environments. Do not execute initiating-device connectors on another device or pretend unknown effects succeeded.`
    : promptWithInputs;
  const input = {
    requestId,
    name: Array.from(text.split(/\r?\n/, 1)[0]).slice(0, 64).join(""),
    prompt,
    providerId: model.providerId,
    model: model.model,
    workdir: route.local ? options.workdir : route.host.workdir,
    timeoutSeconds: 3600,
    reasoning: options.reasoning || "medium",
    ...(options.intelligentSchedulingEnabled === true
      ? { intelligentSchedulingEnabled: true }
      : {}),
    requirements,
    sourceContext,
    ...(snapshots.length ? { files: snapshots } : {}),
  };
  let actual: BackgroundChatReceipt | undefined;
  let received: BackgroundTaskRecord | undefined;
  try {
    received = await backend.submitBackgroundTask(
      input,
      route.peerId ?? undefined,
      undefined,
      { requestScope: scope, sourceMessageHash: getHistoryMessageContentHash(options.userMessage) },
      route.local,
    );
  } catch (failure) {
    const saved = await backend.getBackgroundSubmissionState(requestId);
    if (!saved) throw failure;
    if (saved.requestId !== requestId) throw new Error("Saved chat request identity changed");
    actual = receipt(saved);
  }
  if (received !== undefined) {
    // A mismatched reply is a protocol error, not a lost acknowledgement.
    // Do not hide it by replacing it with another saved reply.
    actual = receipt({
      requestId,
      sourceHostId: route.host.hostId,
      name: input.name,
      localExecution: route.local,
      cancelRequested: false,
      result: received,
    });
  }
  if (!actual) throw new Error("Durable chat submission returned no receipt");
  if (routeReason && actual.hostId === route.host.hostId)
    actual.routing = { reason: routeReason, requirements };
  return reconcileChatStop(actual, signal);
}

export async function runDurableChatTurn(
  params: RunAgentConversationTurnParams,
  onForegroundPrepared?: (prepared: RunAgentConversationTurnParams) => void,
): Promise<boolean> {
  const intake = params.backgroundIntake;
  if (!intake || !isTauriRuntime() || params.planModeEnabled) return false;
  const commandHostSnapshot = {
    ...(params.commandHostSnapshot ?? getLanPcCommandHostConfig()),
  };
  if (!(await intake.ensureHistoryPersisted()))
    throw new Error("Conversation history was not persisted; no background task was submitted");
  const context = params.buildPreparedContext(params.getNextConversationState(), undefined, {
    includeUploadedFilesMetadata: true,
  });
  let selectedReason: TaskRoutingReason | undefined;
  let selectedAssessment: TaskRoutingAssessment | null = null;
  const actual = await submitChatBackgroundTask({
    context,
    userMessage: intake.userMessage,
    conversationId: params.conversationId,
    workdir: params.effectiveWorkdir,
    commandHostSnapshot,
    selectedModel: params.selectedModel,
    reasoning: params.runtime.reasoning,
    intelligentSchedulingEnabled: params.intelligentSchedulingEnabled,
    signal: params.cancellation.userStop.signal,
    onRoutingDecision: (reason, assessment) => {
      selectedReason = reason;
      selectedAssessment = assessment;
    },
    assess: async (local, requestScope) => {
      params.updateToolStatus(
        intake.assessingText ?? intake.foregroundText,
        params.transcriptStore,
      );
      const native = params.nativeMobileRuntime === true;
      let execution: TaskDeviceObservation["execution"] = null;
      const observedAt = Date.now();
      if (native) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          execution = await Promise.race([
            mobileExecutionStatus(),
            new Promise<null>((resolve) => {
              timer = setTimeout(() => resolve(null), 1500);
            }),
          ]);
        } catch {
          /* Unavailable probe remains unknown, not missing environment. */
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      }
      const assessment = await assessTaskRouting({
        providerId: params.providerId,
        model: params.model,
        runtime: params.runtime,
        context,
        request:
          getUserMessageDisplayText(
            intake.userMessage as UploadedUserMessage & Record<string, unknown>,
          ) || (typeof intake.userMessage.content === "string" ? intake.userMessage.content : ""),
        requestScope,
        signal: params.cancellation.userStop.signal,
        local,
        nativeMobile: native,
        mobileExecution: execution,
        selectedWorkspace: {
          device:
            commandHostSnapshot.enabled && params.lanPcCommandHostReady === true
              ? "selected-peer"
              : "initiating-device",
          workdir: params.effectiveWorkdir,
        },
        debugLogger: params.conversationDebugLogger,
      });
      return {
        assessment,
        mobile: {
          native,
          execution,
          observedAt,
          workspaceDevice:
            commandHostSnapshot.enabled && params.lanPcCommandHostReady === true
              ? ("selected-peer" as const)
              : ("initiating-device" as const),
        },
      };
    },
  });
  if (!actual) {
    if (onForegroundPrepared) {
      const prepared = await prepareNativeForegroundTurn(
        params,
        selectedAssessment,
        selectedReason,
        context,
      );
      if (prepared) onForegroundPrepared(prepared);
      else if (
        commandHostSnapshot.enabled &&
        ["small-local", "local-capable", "device-local"].includes(selectedReason ?? "")
      )
        selectedReason = "local-unobserved";
    }
    params.updateToolStatus(
      selectedReason && intake.routingText
        ? intake.routingText(selectedReason)
        : intake.foregroundText,
      params.transcriptStore,
    );
    return false;
  }
  const assistant = buildPartialAssistantMessage({
    model: params.runtimeModel,
    text: intake.receiptText(actual),
    stopReason: "stop",
  });
  if (!assistant) throw new Error("Durable chat receipt could not be displayed");
  const message = {
    ...assistant,
    id: `background-receipt:${actual.requestId}`,
    xgentBackgroundTask: {
      requestId: actual.requestId,
      hostId: actual.hostId,
      accepted: actual.accepted,
      cancelRequested: actual.cancelRequested,
      ...(actual.routing ? { routing: actual.routing } : {}),
    },
  };
  const state = appendMessagesToConversation(params.getNextConversationState(), [message]);
  params.applyConversationState(state);
  params.resetLiveTranscript(params.transcriptStore);
  const persisted = await params.persistConversationWithHistorySync({
    conversationId: params.conversationId,
    sessionId: params.sessionId,
    providerId: params.providerId,
    model: params.model,
    cwd: params.conversationCwd,
    state,
    fallbackTitle: params.fallbackTitle,
    createdAt: params.createdAt,
    titlePromise: params.titlePromise,
  });
  if (!persisted)
    throw new Error(
      "Task is saved; chat receipt could not be persisted. Recover its original submission in Background inbox.",
    );
  params.conversationEvents.queueCheckpoint(persisted);
  params.conversationEvents.queueEvent({ type: "done", conversation_id: params.conversationId });
  params.conversationEvents.close();
  return true;
}
