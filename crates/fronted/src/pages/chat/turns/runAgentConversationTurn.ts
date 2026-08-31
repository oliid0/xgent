import type {
  AssistantMessage,
  Context,
  Message,
  ToolCall,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import { getLanPcCommandHostConfig } from "@xgent/runtime";
import { ASK_USER_QUESTION_TOOL_NAME } from "../../../lib/chat/askUserQuestion";
import type { CompactionController } from "../../../lib/chat/compaction/controller";
import { estimateTextTokenUnits } from "../../../lib/chat/compaction/tokenLedger";
import type { ProviderRuntimeConfig } from "../../../lib/chat/compaction/types";
import { resolveTailBlockAnchorId } from "../../../lib/chat/context/contextTailBlock";
import {
  isAbortedAssistantMessage,
  type SuppressedToolTraceSnapshot,
} from "../../../lib/chat/conversation/chatAbort";
import {
  appendMessagesToConversation,
  appendRenderOnlyMessagesToConversation,
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
  MemoryExtractionVisibleEvents,
} from "../../../lib/chat/memory/extractionEngine";
import type { HostedSearchBlock } from "../../../lib/chat/messages/hostedSearch";
import {
  appendTextDeltaToRound,
  appendThinkingDeltaToRound,
  attachToolResultToRound,
  collapseThinking,
  type LiveRound,
  markToolCallRunningInRound,
  summarizeToolCall,
  updateLiveRound,
  upsertHostedSearchToRound,
  upsertToolCallToRound,
} from "../../../lib/chat/messages/uiMessages";
import {
  type AgentRunnerFailoverParams,
  runAssistantWithTools,
} from "../../../lib/chat/runner/agentRunner";
import { observeStreamDebugLogger, type StreamDebugLogger } from "../../../lib/debug/agentDebug";
import { assistantMessageToText } from "../../../lib/providers/llm";
import { resolveRuntimePlatform } from "../../../lib/runtimePlatform";
import {
  type AppSettings,
  type McpSettingsOp,
  type ProviderId,
  type SshHostConfig,
  type SystemToolId,
  selectEnabledMcpServers,
  workspaceProjectPathKey,
} from "../../../lib/settings";
import {
  AGENT_TOOL_NAME,
  buildRosterIdentitySection,
  buildRosterRunStatusSection,
  createSubagentScheduler,
  isSubagentCardToolCall,
  renderMessageBusDelta,
  renderMessageBusSnapshot,
  SUBAGENT_PARENT_ID,
  type SubagentConversationStore,
  type SubagentTemplate,
} from "../../../lib/subagents";
import type { AdditionalProjectRoot } from "../../../lib/tools/additionalProjectRoots";
import { buildBuiltinToolRegistry } from "../../../lib/tools/builtinRegistry";
import type { BuiltinToolExecutionContext } from "../../../lib/tools/builtinTypes";
import { createFileToolState } from "../../../lib/tools/fileToolState";
import {
  buildPlanModeSystemPromptSection,
  createPlanModeRunPolicy,
  isPlanModeAllowedTool,
} from "../../../lib/tools/planModeTools";
import { resolveShellSandboxSettings } from "../../../lib/tools/sandboxPolicy";
import type { SkillAccessPolicy } from "../../../lib/tools/skillAccessPolicy";
import type { SshManagerSessionChange } from "../../../lib/tools/sshManagerTools";
import { formatTaskListRuntimeContext, type TaskStateStore } from "../../../lib/tools/taskTools";
import { isSessionApproved, requestToolApproval } from "../../../lib/tools/toolApproval";
import { resolveToolPolicy } from "../../../lib/tools/toolPolicy";
import {
  buildMcpRequestToolFilter,
  getMcpToolActivation,
} from "../../../lib/tools/toolSearchTools";
import { trajectoryTerminalInfo } from "../../../lib/trajectory/assistantOutcome";
import {
  NOOP_TRAJECTORY_RECORDER,
  type TrajectoryRecorder,
} from "../../../lib/trajectory/recorder";
import {
  composeTrajectorySystemPrompt,
  serializeToolCatalog,
} from "../../../lib/trajectory/sections";
import type { TrajectoryUsage } from "../../../lib/trajectory/types";
import {
  appendSystemPrompt,
  buildPartialAssistantMessage,
  type ConversationRuntimeEntry,
  createEmptyAssistantUsage,
} from "../runtime/chatPageRuntime";
import { buildToolCallPreviewArguments } from "./toolCallPreview";
import { buildTrajectoryRuntimeContext } from "./trajectoryRuntimeContext";

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

const AGENT_PERF_LOG_THRESHOLD_MS = 250;
const TOOL_CALL_DELTA_RAF_FALLBACK_DELAY_MS = 64;
const PARENT_MESSAGE_BUS_AGENT_NAME = "Parent Agent";

function perfNowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

export function scheduleToolCallDeltaFlush(callback: () => void) {
  let frameId: number | null = null;
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  let finished = false;

  const run = () => {
    if (finished) return;
    finished = true;
    if (frameId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
      timeoutId = null;
    }
    callback();
  };

  const canUseAnimationFrame =
    typeof requestAnimationFrame === "function" &&
    (typeof document === "undefined" || document.visibilityState === "visible");
  if (canUseAnimationFrame) {
    frameId = requestAnimationFrame(run);
  }

  if (typeof globalThis.setTimeout === "function") {
    timeoutId = globalThis.setTimeout(
      run,
      canUseAnimationFrame ? TOOL_CALL_DELTA_RAF_FALLBACK_DELAY_MS : 0,
    );
  } else if (!canUseAnimationFrame && typeof queueMicrotask === "function") {
    queueMicrotask(run);
  }

  return () => {
    if (finished) return;
    finished = true;
    if (frameId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
      timeoutId = null;
    }
  };
}

function finishAgentPerfSpan(
  logger: StreamDebugLogger,
  span: string,
  startedAt: number,
  fields: Record<string, unknown> = {},
  thresholdMs = AGENT_PERF_LOG_THRESHOLD_MS,
) {
  const durationMs = Math.round(perfNowMs() - startedAt);
  const payload = {
    type: "perf_span",
    span,
    durationMs,
    ...fields,
  };
  if (logger.enabled) {
    logger.logResult(payload);
  }
  if (durationMs >= thresholdMs) {
    console.warn(`[Agent perf] ${span} took ${durationMs}ms`, fields);
  }
  return durationMs;
}

// Only enabled, non-empty templates are resolvable from Agent calls.
function enabledSubagentTemplates(agentTemplates: AppSettings["agents"]): SubagentTemplate[] {
  return (agentTemplates ?? [])
    .filter((template) => template.enabled && template.prompt.trim())
    .map((template) => ({
      id: template.id,
      name: template.name,
      description: template.description,
      prompt: template.prompt,
    }));
}

// The parent Agent call is suppressed in favor of the per-agent cards; a
// rejected batch (error result) stays visible so validation failures are
// never silent.
function shouldShowToolEvent(toolCall: ToolCall, toolResult?: ToolResultMessage) {
  if (toolCall.name !== AGENT_TOOL_NAME) return true;
  if (isSubagentCardToolCall(toolCall)) return true;
  return toolResult?.isError === true;
}

function toTrajectoryUsage(value: unknown): TrajectoryUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const read = (key: string) => (typeof raw[key] === "number" ? (raw[key] as number) : undefined);
  const usage: TrajectoryUsage = {
    totalTokens: read("totalTokens"),
    input: read("input"),
    output: read("output"),
    cacheRead: read("cacheRead"),
    cacheWrite: read("cacheWrite"),
    reasoning: read("reasoning"),
  };
  return Object.values(usage).some((item) => item !== undefined) ? usage : undefined;
}

function subagentRunIdsFromToolResult(toolResult: unknown): string[] {
  if (!toolResult || typeof toolResult !== "object") return [];
  const details = (toolResult as { details?: unknown }).details;
  if (!details || typeof details !== "object") return [];
  const agents = (details as { agents?: unknown }).agents;
  if (!Array.isArray(agents)) return [];
  return agents.flatMap((agent) => {
    if (!agent || typeof agent !== "object") return [];
    const runId = (agent as { runId?: unknown }).runId;
    return typeof runId === "string" && runId ? [runId] : [];
  });
}

export type RunAgentConversationTurnParams = {
  providerId: ProviderId;
  model: string;
  runtime: ProviderRuntimeConfig;
  failover?: AgentRunnerFailoverParams;
  runtimeModel: RuntimeModel;
  selectedModel: {
    customProviderId: string;
    model: string;
  };
  effectiveWorkdir: string;
  additionalRoots?: readonly AdditionalProjectRoot[];
  effectiveSkillsEnabled: boolean;
  showSilentMemoryExtraction: boolean;
  skillsRootDir?: string;
  skillAccessPolicy?: SkillAccessPolicy;
  onManagedSkillsChanged?: (change: {
    action: "install" | "create" | "delete";
    names: string[];
    baseDirs: string[];
  }) => void | Promise<void>;
  agentTemplates: AppSettings["agents"];
  selectedSystemToolIds: SystemToolId[];
  cloudExecution?: AppSettings["access"];
  nativeMobileRuntime?: boolean;
  lanPcCommandHostReady?: boolean;
  getMcpSettings: () => AppSettings["mcp"];
  getToolPolicies?: () => AppSettings["system"]["toolPolicies"];
  commandSafetyMode?: AppSettings["system"]["commandSafetyMode"];
  planModeEnabled?: boolean;
  applyMcpOps?: (ops: McpSettingsOp[]) => void;
  sshHosts?: SshHostConfig[];
  associatedSshHostIds?: string[];
  sshManagerRemoteAllowed?: boolean;
  onSshSessionsChanged?: (change: SshManagerSessionChange) => void;
  sessionId: string;

  taskStateStore: TaskStateStore;
  conversationId: string;
  checkpointTurnId?: string;
  conversationCwd?: string;
  fallbackTitle: string;
  createdAt: number;
  titlePromise: Promise<string | null> | null;
  transcriptStore: LiveTranscriptStore;
  conversationEvents: ConversationEventController;
  hookLifecycle: ConversationHookLifecycle;
  conversationDebugLogger: StreamDebugLogger;
  subagentStore?: SubagentConversationStore;
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
  batchLiveRoundsUpdate: (
    updater: (prev: LiveRound[]) => LiveRound[],
    store: LiveTranscriptStore,
  ) => void;
  updateToolStatus: (status: string | null, store: LiveTranscriptStore) => void;
  updateRetryAttempts: (attempts: RetryAttemptRecord[], store: LiveTranscriptStore) => void;
  updatePersistableAgentProgress: (progress: {
    completedThroughRound: number;
    suppressedToolTrace: SuppressedToolTraceSnapshot[];
  }) => void;
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

export async function runAgentConversationTurn(params: RunAgentConversationTurnParams) {
  const {
    providerId,
    model,
    runtime,
    runtimeModel,
    selectedModel,
    effectiveWorkdir,
    additionalRoots,
    effectiveSkillsEnabled,
    showSilentMemoryExtraction,
    skillsRootDir,
    skillAccessPolicy,
    onManagedSkillsChanged,
    agentTemplates,
    selectedSystemToolIds,
    cloudExecution,
    nativeMobileRuntime,
    lanPcCommandHostReady,
    getMcpSettings,
    getToolPolicies,
    commandSafetyMode,
    planModeEnabled,
    applyMcpOps,
    sshHosts,
    associatedSshHostIds,
    sshManagerRemoteAllowed,
    onSshSessionsChanged,
    sessionId,
    taskStateStore,
    conversationId,
    checkpointTurnId,
    conversationCwd,
    fallbackTitle,
    createdAt,
    titlePromise,
    transcriptStore,
    conversationEvents,
    hookLifecycle,
    conversationDebugLogger,
    subagentStore,
    getNextConversationState,
    applyConversationState,
    buildPreparedContext,
    compaction,
    cancellation,
    resetLiveTranscript,
    settleLiveTranscript,
    batchLiveRoundsUpdate,
    updateToolStatus,
    updateRetryAttempts,
    updatePersistableAgentProgress,
    commitVisibleAbortedConversation,
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

  if (!effectiveWorkdir) {
    throw new Error("Tool mode requires a project directory from the chat sidebar.");
  }

  // Reset per-turn dedup state so <already-written-this-turn> reflects only
  // this turn. In-flight extraction from the previous turn keeps running.
  memoryExtraction.noteTurnBoundary(conversationId);

  const loadParentBusMessages = async () => {
    if (!subagentStore) return null;
    try {
      return await subagentStore.listBusMessages(SUBAGENT_PARENT_ID);
    } catch (error) {
      console.warn("Failed to load parent message bus snapshot", error);
      return null;
    }
  };
  const subagentStoreReadyStartedAt = perfNowMs();

  let rosterIdentitySection = "";

  let parentMessageBusSnapshot = "";

  let renderedBusSeq = 0;

  let frozenBusSeq = 0;
  const refreezeParentMessageBus = async () => {
    const messages = await loadParentBusMessages();

    if (!messages) {
      renderedBusSeq = frozenBusSeq;
      return;
    }
    const snapshot = renderMessageBusSnapshot({
      messages,
      currentAgentId: SUBAGENT_PARENT_ID,
      currentAgentName: PARENT_MESSAGE_BUS_AGENT_NAME,
    });
    parentMessageBusSnapshot = snapshot.text;

    frozenBusSeq = snapshot.renderedSeq;
    renderedBusSeq = frozenBusSeq;
  };
  if (subagentStore) {
    try {
      await subagentStore.ready();
      rosterIdentitySection = buildRosterIdentitySection({
        identities: subagentStore.listIdentities(),
      });
    } catch (error) {
      console.warn("Failed to load the subagent roster", error);
    }
    await refreezeParentMessageBus();
  }
  finishAgentPerfSpan(
    conversationDebugLogger,
    "subagent_store.ready",
    subagentStoreReadyStartedAt,
    {
      conversationId,
      identityCount: subagentStore?.listIdentities().length ?? 0,
    },
  );
  const buildParentMessageBusDelta = async () => {
    const messages = await loadParentBusMessages();
    if (!messages) return { text: "", lastSeq: renderedBusSeq };
    return renderMessageBusDelta({
      messages,
      sinceSeq: renderedBusSeq,
      currentAgentId: SUBAGENT_PARENT_ID,
      currentAgentName: PARENT_MESSAGE_BUS_AGENT_NAME,
    });
  };
  let currentTrajectoryRuntimeContext = buildTrajectoryRuntimeContext([]);
  const lastRecordedRuntimeContextBySource = new Map<string, string>();

  let renderedRosterRunStatus = "";
  const buildRosterRunStatusDelta = () => {
    if (!subagentStore) return "";
    let section = "";
    try {
      section = buildRosterRunStatusSection({
        identities: subagentStore.listIdentities(),
        latestRunsByAgent: subagentStore.latestRunsByAgent(),
      });
    } catch (error) {
      console.warn("Failed to render the subagent run status", error);
      return "";
    }

    return section === renderedRosterRunStatus ? "" : section;
  };

  let frozenTaskListContext = "";
  const refreezeTaskListContext = () => {
    const taskList = getNextConversationState().meta.taskList;
    frozenTaskListContext =
      taskList && taskList.runId === taskStateStore.runId
        ? formatTaskListRuntimeContext(taskList)
        : "";
    return frozenTaskListContext;
  };
  refreezeTaskListContext();

  const planModeSection = planModeEnabled ? buildPlanModeSystemPromptSection() : "";

  const planRunPolicy = planModeEnabled ? createPlanModeRunPolicy({ conversationId }) : null;
  const withAgentRuntimeContext = (context: Context): Context => {
    let systemPrompt = context.systemPrompt;
    if (planModeSection) {
      systemPrompt = appendSystemPrompt(systemPrompt, planModeSection);
    }
    if (rosterIdentitySection) {
      systemPrompt = appendSystemPrompt(systemPrompt, rosterIdentitySection);
    }
    if (parentMessageBusSnapshot) {
      systemPrompt = appendSystemPrompt(systemPrompt, parentMessageBusSnapshot);
    }
    if (frozenTaskListContext) {
      systemPrompt = appendSystemPrompt(systemPrompt, frozenTaskListContext);
    }

    currentTrajectoryRuntimeContext = buildTrajectoryRuntimeContext([
      { source: "plan-mode", text: planModeSection },
      { source: "subagent-roster", text: rosterIdentitySection },
      { source: "parent-message-bus", text: parentMessageBusSnapshot },
      { source: "task-list", text: frozenTaskListContext },
    ]);
    return systemPrompt !== context.systemPrompt
      ? {
          ...context,
          systemPrompt,
        }
      : context;
  };
  const fileState = createFileToolState();
  const subagentScheduler = createSubagentScheduler();
  const runtimePlatform = await resolveRuntimePlatform();
  const lanPcCommandHost = getLanPcCommandHostConfig();
  const toolWorkdir =
    lanPcCommandHostReady && lanPcCommandHost.remoteWorkdir
      ? lanPcCommandHost.remoteWorkdir
      : effectiveWorkdir;
  const buildRegistryStartedAt = perfNowMs();
  const builtinRegistry = await buildBuiltinToolRegistry({
    workdir: toolWorkdir,
    additionalRoots,
    providerId,
    runtimePlatform,
    nativeMobileRuntime,
    lanPcCommandHostReady,
    fileState,
    sandbox: resolveShellSandboxSettings(commandSafetyMode),
    checkpoint: {
      conversationId,
      turnId: checkpointTurnId?.trim() || crypto.randomUUID(),
    },
    taskStateStore,
    // Keep the ordinary Agent tool surface identical to the reference runtime:
    // AskUserQuestion is available for material user-owned decisions regardless
    // of whether the hidden plan workflow is active. The model decides when it
    // is warranted; registering the tool does not force a question.
    askUserQuestionConversationId: conversationId,
    planMode: planModeEnabled ? { conversationId } : undefined,
    toolSearch: { conversationId },
    skillsEnabled: effectiveSkillsEnabled,
    skillsRootDir,
    skillAccessPolicy,
    onManagedSkillsChanged,
    runtimeScope: "chat",
    currentChatModel: selectedModel,
    selectedSystemToolIds,
    cloudExecution,
    getMcpSettings,
    applyMcpOps,
    projectPathKey: workspaceProjectPathKey(toolWorkdir),
    sshHosts,
    associatedSshHostIds,
    sshManagerRemoteAllowed,
    onSshSessionsChanged,
    onMcpLoadError: (message) => {
      const warning = `MCP 工具加载失败，已跳过并继续对话：${message || "未知错误"}`;
      console.warn(warning);
      updateToolStatus(warning, transcriptStore);
    },
    subagentRuntime: subagentStore
      ? {
          providerId,
          model,
          runtime,
          sessionId,
          templates: enabledSubagentTemplates(agentTemplates),
          store: subagentStore,
          scheduler: subagentScheduler,
        }
      : undefined,
  });
  finishAgentPerfSpan(conversationDebugLogger, "builtin_registry.build", buildRegistryStartedAt, {
    toolCount: builtinRegistry.tools.length,
    enabledMcpServerCount: selectEnabledMcpServers(getMcpSettings()).length,
  });
  const toolPoliciesSnapshot = getToolPolicies?.();
  const combinedTools = builtinRegistry.tools.filter((tool) => {
    const metadata = builtinRegistry.metadataByName.get(tool.name);
    return (
      (!planModeEnabled || isPlanModeAllowedTool(tool.name, metadata)) &&
      resolveToolPolicy(tool.name, metadata, toolPoliciesSnapshot) !== "deny"
    );
  });

  const preCompactionStartedAt = perfNowMs();
  await compaction.maybeCompactPreSend({
    budgetContext: withAgentRuntimeContext(
      buildPreparedContext(getNextConversationState(), combinedTools, {
        includeUploadedFilesMetadata: true,
      }),
    ),
    tools: combinedTools,
    includeUploadedFilesMetadata: true,
  });
  finishAgentPerfSpan(
    conversationDebugLogger,
    "conversation.pre_compaction",
    preCompactionStartedAt,
    {
      toolCount: combinedTools.length,
    },
  );
  refreezeTaskListContext();

  const requestToolFilter = builtinRegistry.mcpToolDeferralActive
    ? buildMcpRequestToolFilter({
        conversationId,
        metadataByName: builtinRegistry.metadataByName,
      })
    : undefined;

  const combinedExecutor: (
    toolCall: ToolCall,
    signal?: AbortSignal,
    context?: BuiltinToolExecutionContext,
  ) => Promise<Message> = (tc, signal, context) => {
    const metadata = builtinRegistry.metadataByName.get(tc.name);
    if (
      builtinRegistry.mcpToolDeferralActive &&
      metadata?.groupId === "mcp" &&
      metadata.kind === "mcp"
    ) {
      getMcpToolActivation(conversationId).add(tc.name);
    }
    return builtinRegistry.executeToolCall(tc, signal, context);
  };

  const resolveToolGate = async (
    toolCall: ToolCall,
    signal?: AbortSignal,
  ): Promise<{ allow: true } | { allow: false; reason: string }> => {
    const metadata = builtinRegistry.metadataByName.get(toolCall.name);
    if (planModeEnabled && !isPlanModeAllowedTool(toolCall.name, metadata)) {
      return {
        allow: false,
        reason: `Tool ${toolCall.name} is unavailable while plan mode is active.`,
      };
    }
    if (planRunPolicy) {
      const repeatGate = planRunPolicy.guardRepeatedToolCall(toolCall);
      if (!repeatGate.allow) return repeatGate;
    }
    const policy = resolveToolPolicy(toolCall.name, metadata, getToolPolicies?.());
    if (policy === "deny") {
      return {
        allow: false,
        reason: `Tool ${toolCall.name} is disabled by the user's execution policy. Do not retry it.`,
      };
    }
    const effectivePolicy =
      commandSafetyMode === "ask" && metadata?.isReadOnly !== true ? "ask" : policy;
    if (effectivePolicy !== "ask" || isSessionApproved(conversationId, toolCall.name)) {
      return { allow: true };
    }
    const settlement = await requestToolApproval({
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      summary: summarizeToolCall(toolCall, { includeName: false }),
      conversationId,
      signal,
    });
    if (settlement.kind === "decided" && settlement.decision !== "deny") {
      return { allow: true };
    }
    const reason =
      settlement.kind === "timeout"
        ? `Approval for ${toolCall.name} timed out and was denied. Do not retry it.`
        : settlement.kind === "cancelled"
          ? `The turn stopped before ${toolCall.name} was approved.`
          : `The user denied ${toolCall.name}. Do not retry it.`;
    return { allow: false, reason };
  };

  hookLifecycle.startAgent();
  let result: Awaited<ReturnType<typeof runAssistantWithTools>> | null = null;
  let latestAgentEmittedMessages: Message[] = [];
  let suppressedToolTrace: SuppressedToolTraceSnapshot[] = [];
  let activeAgentRound = 0;
  const trajectoryDebugLogger = observeStreamDebugLogger(conversationDebugLogger, (type, payload) =>
    trajectory.noteModelDiagnostic(activeAgentRound, type, payload),
  );
  let pendingAgentContext: Context | null = null;
  const pendingTerminalAssistantMetaRef: {
    current: {
      assistant: AssistantMessage;
      round: number;
    } | null;
  } = {
    current: null,
  };

  function publishPersistableAgentProgress(
    round: number,
    assistant: AssistantMessage,
    toolResults: ToolResultMessage[],
  ) {
    const toolResultsById = new Map(
      toolResults.map((toolResult) => [toolResult.toolCallId, toolResult]),
    );
    const roundTrace = assistant.content
      .filter(
        (block): block is ToolCall =>
          block.type === "toolCall" &&
          block.name === AGENT_TOOL_NAME &&
          !isSubagentCardToolCall(block),
      )
      .map((toolCall) => ({
        round,
        toolCall,
        toolResult: toolResultsById.get(toolCall.id),
      }));

    suppressedToolTrace = [
      ...suppressedToolTrace.filter((item) => item.round !== round),
      ...roundTrace,
    ];
    updatePersistableAgentProgress({
      completedThroughRound: round,
      suppressedToolTrace: suppressedToolTrace.slice(),
    });
  }

  function clearPersistableAgentProgress() {
    suppressedToolTrace = [];
    updatePersistableAgentProgress({
      completedThroughRound: 0,
      suppressedToolTrace: [],
    });
  }

  function commitAssistantRoundMeta(
    assistant: AssistantMessage,
    round: number,
    options?: { contextRelevant?: boolean },
  ) {
    const contextRelevant = options?.contextRelevant !== false;
    const contextUsageTokens = contextRelevant
      ? compaction.observeContextMessages([assistant])
      : undefined;
    conversationEvents.queueToken("", {
      round,
      provider: assistant.provider,
      model: assistant.model,
      api: assistant.api,
      stopReason: assistant.stopReason,
      usage: assistant.usage,
      ...(contextUsageTokens ? { contextUsageTokens } : {}),
      ...(contextRelevant ? {} : { contextRelevant: false }),
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
            contextRelevant,
          },
        })),
      transcriptStore,
    );
  }

  function updateHostedSearch(hostedSearch: HostedSearchBlock, round: number) {
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
    batchLiveRoundsUpdate((prev) => {
      const withRound = prev.some((item) => item.round === round)
        ? prev
        : [
            ...prev,
            {
              key: `r${round}`,
              round,
              blocks: [],
              meta: { contextRelevant: false },
              runningToolCallIds: [],
              thinkingOpen: false,
            },
          ];
      return updateLiveRound(withRound, round, (target) =>
        upsertHostedSearchToRound(collapseThinking(target), hostedSearch),
      );
    }, transcriptStore);
  }

  const pendingToolCallDeltas = new Map<string, { round: number; toolCall: ToolCall }>();
  let cancelPendingToolCallDeltaFlush: (() => void) | null = null;

  function toolCallDeltaKey(round: number, toolCallId: string) {
    return `${round}:${toolCallId}`;
  }

  function flushPendingToolCallDeltas() {
    cancelPendingToolCallDeltaFlush?.();
    cancelPendingToolCallDeltaFlush = null;
    if (pendingToolCallDeltas.size === 0) return;

    const deltas = Array.from(pendingToolCallDeltas.values());
    pendingToolCallDeltas.clear();

    for (const { round, toolCall } of deltas) {
      conversationEvents.queueEvent({
        type: "tool_call_delta",
        id: toolCall.id,
        name: toolCall.name,
        arguments: buildToolCallPreviewArguments(toolCall),
        round,
        conversation_id: conversationId,
      });
    }

    batchLiveRoundsUpdate((prev) => {
      let next = prev;
      for (const { round, toolCall } of deltas) {
        next = updateLiveRound(next, round, (target) => {
          const withToolCall = upsertToolCallToRound(collapseThinking(target), toolCall);
          return markToolCallRunningInRound(withToolCall, toolCall);
        });
      }
      return next;
    }, transcriptStore);
  }

  function schedulePendingToolCallDeltaFlush() {
    if (cancelPendingToolCallDeltaFlush !== null) return;
    cancelPendingToolCallDeltaFlush = scheduleToolCallDeltaFlush(flushPendingToolCallDeltas);
  }

  function queueToolCallDelta(toolCall: ToolCall, round: number) {
    if (!shouldShowToolEvent(toolCall)) return;

    if (toolCall.name === ASK_USER_QUESTION_TOOL_NAME) return;
    pendingToolCallDeltas.set(toolCallDeltaKey(round, toolCall.id), { round, toolCall });
    schedulePendingToolCallDeltaFlush();
  }

  function discardPendingToolCallDelta(toolCall: ToolCall, round: number) {
    pendingToolCallDeltas.delete(toolCallDeltaKey(round, toolCall.id));
    if (pendingToolCallDeltas.size === 0) {
      cancelPendingToolCallDeltaFlush?.();
      cancelPendingToolCallDeltaFlush = null;
    }
  }

  let planFallbackMessages: Message[] = [];
  const lastVisibleAssistantText = (messages: readonly Message[]): string => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role !== "assistant") continue;
      const text = assistantMessageToText(message).trim();
      if (text) return text;
    }
    return "";
  };

  let midStreamProtectionDisabled = false;
  while (!result) {
    let streamedAgentText = "";
    let streamedAgentTokenUnits = 0;
    let protectionCheckChars = 0;
    let midStreamCompactionRequested = false;
    let sawToolCallInRound = false;
    const nativeWebSearchEnabled = runtime.nativeWebSearchEnabled !== false;
    const agentContext = withAgentRuntimeContext(
      pendingAgentContext ??
        buildPreparedContext(getNextConversationState(), combinedTools, {
          includeUploadedFilesMetadata: true,
        }),
    );
    pendingAgentContext = null;

    const scope = cancellation.deriveScope();
    compaction.beginRequest(agentContext, getNextConversationState());

    try {
      const assistantRunStartedAt = perfNowMs();
      result = await runAssistantWithTools({
        providerId,
        model,
        runtime,
        failover: params.failover,
        runtimePlatform,
        context: agentContext,
        workdir: toolWorkdir,
        additionalRoots,
        sessionId,
        nativeWebSearch: nativeWebSearchEnabled,
        tools: combinedTools,
        subagentScheduler,
        requestToolFilter,
        resolveToolTermination: planRunPolicy?.resolveToolTermination,
        resolveToolChoice: planRunPolicy ? () => planRunPolicy.resolveToolChoice() : undefined,
        maxRounds: planRunPolicy?.maxRounds(),
        onRequestStart: ({ round, context: requestContext, toolsSuffix }) => {
          const activeSources = new Set(
            currentTrajectoryRuntimeContext.entries.map((entry) => entry.source),
          );
          for (const source of lastRecordedRuntimeContextBySource.keys()) {
            if (!activeSources.has(source)) lastRecordedRuntimeContextBySource.delete(source);
          }
          for (const entry of currentTrajectoryRuntimeContext.entries) {
            if (lastRecordedRuntimeContextBySource.get(entry.source) === entry.text) continue;
            trajectory.noteContext(entry);
            lastRecordedRuntimeContextBySource.set(entry.source, entry.text);
          }
          const toolCatalog = serializeToolCatalog(requestContext.tools);
          const segmentedHeader = {
            ...(params.readTrajectorySlots?.() ?? {}),
            ...(currentTrajectoryRuntimeContext.prompt
              ? { runtime: currentTrajectoryRuntimeContext.prompt }
              : {}),
            toolsSuffix,
            toolCatalog,
          };
          const actualSystemPrompt =
            typeof requestContext.systemPrompt === "string"
              ? requestContext.systemPrompt
              : undefined;
          const reconstructed = composeTrajectorySystemPrompt(segmentedHeader);
          const headerId = trajectory.captureHeader(
            actualSystemPrompt !== undefined && reconstructed !== actualSystemPrompt
              ? { runtime: actualSystemPrompt, toolCatalog }
              : segmentedHeader,
          );
          trajectory.stepStart(round, headerId);
        },
        executeToolCall: combinedExecutor,
        resolveToolGate,
        onTurnStart: (round) => {
          activeAgentRound = round;
          streamedAgentText = "";
          streamedAgentTokenUnits = 0;
          protectionCheckChars = 0;
          sawToolCallInRound = false;
          hookLifecycle.startTurn(round);
          const contextUsageTokens = compaction.contextUsageTokens;
          conversationEvents.queueToken("", {
            round,
            ...(contextUsageTokens ? { contextUsageTokens } : {}),
          });
          batchLiveRoundsUpdate(
            (prev) => [
              ...prev,
              {
                key: `r${round}`,
                round,
                blocks: [],
                meta: contextUsageTokens ? { contextUsageTokens } : undefined,
                runningToolCallIds: [],
                thinkingOpen: false,
              },
            ],
            transcriptStore,
          );
        },
        onTextDelta: (delta, round) => {
          trajectory.firstToken(round);
          conversationEvents.queueToken(delta, { round });
          streamedAgentText += delta;
          streamedAgentTokenUnits += estimateTextTokenUnits(delta);
          batchLiveRoundsUpdate(
            (prev) =>
              updateLiveRound(prev, round, (target) => {
                const nextTarget = collapseThinking(target);
                return appendTextDeltaToRound(nextTarget, delta);
              }),
            transcriptStore,
          );

          protectionCheckChars += delta.length;
          if (
            midStreamCompactionRequested ||
            midStreamProtectionDisabled ||
            sawToolCallInRound ||
            protectionCheckChars < 160
          ) {
            return;
          }

          protectionCheckChars = 0;

          if (!compaction.shouldProtectMidStream(streamedAgentTokenUnits)) return;
          midStreamCompactionRequested = true;
          scope.controller.abort();
        },
        onThinkingDelta: (delta, round) => {
          trajectory.firstToken(round);
          conversationEvents.queueEvent({
            type: "thinking",
            text: delta,
            round,
            conversation_id: conversationId,
          });
          batchLiveRoundsUpdate(
            (prev) =>
              updateLiveRound(prev, round, (target) => ({
                ...appendThinkingDeltaToRound(target, delta),
                thinkingOpen: true,
              })),
            transcriptStore,
          );
        },
        onHostedSearch: (hostedSearch, round) => {
          trajectory.firstToken(round);
          updateHostedSearch(hostedSearch, round);
        },
        onToolCall: (toolCall, round) => {
          trajectory.firstToken(round);
          sawToolCallInRound = true;
          discardPendingToolCallDelta(toolCall, round);
          // AskUserQuestion only becomes interactive once the executor has
          // installed its authoritative pending entry. Rendering it here can
          // expose a card that cannot submit yet.
          if (toolCall.name === ASK_USER_QUESTION_TOOL_NAME) return;
          if (!shouldShowToolEvent(toolCall)) return;
          conversationEvents.queueEvent({
            type: "tool_call",
            id: toolCall.id,
            name: toolCall.name,
            arguments: buildToolCallPreviewArguments(toolCall),
            round,
            conversation_id: conversationId,
          });
          batchLiveRoundsUpdate(
            (prev) =>
              updateLiveRound(prev, round, (target) => {
                const nextTarget = collapseThinking(target);
                const withToolCall = upsertToolCallToRound(nextTarget, toolCall);
                return markToolCallRunningInRound(withToolCall, toolCall);
              }),
            transcriptStore,
          );
        },
        onToolCallDelta: (toolCall, round) => {
          trajectory.firstToken(round);
          sawToolCallInRound = true;
          queueToolCallDelta(toolCall, round);
        },
        onToolExecutionStart: (toolCall, round) => {
          trajectory.firstToken(round);
          sawToolCallInRound = true;
          trajectory.toolStart(round, toolCall);
          discardPendingToolCallDelta(toolCall, round);
          if (!isSubagentCardToolCall(toolCall)) {
            hookLifecycle.toolExecutionStarted();
          }
          if (!shouldShowToolEvent(toolCall)) return;
          conversationEvents.queueEvent({
            type: "tool_call",
            id: toolCall.id,
            name: toolCall.name,
            arguments: buildToolCallPreviewArguments(toolCall),
            round,
            conversation_id: conversationId,
          });
          batchLiveRoundsUpdate(
            (prev) =>
              updateLiveRound(prev, round, (target) => {
                const withToolCall = upsertToolCallToRound(collapseThinking(target), toolCall);
                return markToolCallRunningInRound(withToolCall, toolCall);
              }),
            transcriptStore,
          );
        },
        onToolResult: (toolCall, toolResult, round) => {
          if (toolResult.role !== "toolResult") return;
          trajectory.toolEnd(toolCall.id, {
            isError: toolResult.isError === true,
            ...(() => {
              const runIds = subagentRunIdsFromToolResult(toolResult);
              return runIds.length === 0 ? {} : { subagentRunIds: runIds };
            })(),
          });
          compaction.observeContextMessages([toolResult]);
          discardPendingToolCallDelta(toolCall, round);
          if (!isSubagentCardToolCall(toolCall)) {
            hookLifecycle.toolResultReceived(round);
          }
          if (!shouldShowToolEvent(toolCall, toolResult)) return;
          conversationEvents.queueEvent({
            type: "tool_result",
            id: toolCall.id,
            name: toolCall.name,
            arguments: buildToolCallPreviewArguments(toolCall),
            content: toolResult.content,
            details: toolResult.details,
            isError: toolResult.isError ?? false,
            round,
            conversation_id: conversationId,
          });
          batchLiveRoundsUpdate(
            (prev) =>
              updateLiveRound(prev, round, (target) => {
                const tr: ToolResultMessage = toolResult as ToolResultMessage;
                const nextTarget = attachToolResultToRound(collapseThinking(target), toolCall, tr);

                return {
                  ...nextTarget,
                  runningToolCallIds: (nextTarget.runningToolCallIds || []).filter(
                    (id) => id !== toolCall.id,
                  ),
                };
              }),
            transcriptStore,
          );
        },
        onAssistantMessage: (assistant, round) => {
          if (assistant.role !== "assistant") return;
          // Some transports only surface a final message (no incremental text/tool callback).
          trajectory.firstToken(round);

          const trajectoryUsage = toTrajectoryUsage(assistant.usage);
          const terminalInfo = trajectoryTerminalInfo(assistant);
          trajectory.stepEnd(round, {
            ...terminalInfo,
            ...(trajectoryUsage === undefined ? {} : { usage: trajectoryUsage }),
            provider: assistant.provider || providerId,
            model: assistant.model || model,
            ...(assistant.api ? { api: assistant.api } : {}),
            ...(typeof assistant.stopReason === "string"
              ? { stopReason: assistant.stopReason }
              : {}),
          });
          hookLifecycle.ensureMessageEnded();
          const toolCallCount = assistant.content.filter(
            (block) => block.type === "toolCall",
          ).length;
          hookLifecycle.assistantMessageCompleted(round, toolCallCount);
          if (toolCallCount === 0 && assistant.stopReason !== "toolUse") {
            pendingTerminalAssistantMetaRef.current = { assistant, round };
            return;
          }
          commitAssistantRoundMeta(assistant, round);
        },
        onToolStatus: (s) => {
          conversationEvents.queueToolStatus(s, false);
          updateToolStatus(s, transcriptStore);
        },
        onRetryAttempts: (_round, attempts) => {
          const latest = attempts.at(-1);
          if (latest !== undefined) {
            trajectory.noteRetry(activeAgentRound, {
              attempt: latest.attempt,
              maxRetries: latest.maxAttempts,
              ...(latest.plannedDelayMs === undefined ? {} : { delayMs: latest.plannedDelayMs }),
              ...(latest.errorMessage === "" ? {} : { error: latest.errorMessage }),
              ...(latest.providerLabel === undefined ? {} : { provider: latest.providerLabel }),
            });
          }
          updateRetryAttempts(attempts, transcriptStore);
        },
        onFailoverAttempt: (_round, event) => {
          trajectory.noteFailover(activeAgentRound, {
            attempt: event.attempt,
            fromLabel: event.fromLabel,
            toLabel: event.toLabel,
            targetIndex: event.targetIndex,
            ...(event.errorMessage === "" ? {} : { error: event.errorMessage }),
          });
        },
        onTransportAttempt: (_round, snapshot) => {
          trajectory.noteTransport(activeAgentRound, {
            provider: snapshot.providerLabel,
            ...(snapshot.upstreamOrigin === undefined
              ? {}
              : { upstreamOrigin: snapshot.upstreamOrigin }),
            useSystemProxy: snapshot.useSystemProxy,
            fullUrl: snapshot.fullUrl,
            headerNames: snapshot.headerNames,
          });
        },
        onBeforeNextTurn: async ({ round, assistant, toolResults, emittedMessages }) => {
          publishPersistableAgentProgress(round, assistant, toolResults);
          latestAgentEmittedMessages = emittedMessages.slice();
          const tempState = appendMessagesToConversation(
            getNextConversationState(),
            emittedMessages,
          );
          const tempContext = withAgentRuntimeContext(
            buildPreparedContext(tempState, combinedTools, {
              includeUploadedFilesMetadata: true,
            }),
          );

          const busDelta = await buildParentMessageBusDelta();
          const rosterRunStatusDelta = buildRosterRunStatusDelta();
          const tailBlockText = [busDelta.text, rosterRunStatusDelta].filter(Boolean).join("\n\n");

          const tailBlockAttachable =
            Boolean(tailBlockText) && resolveTailBlockAnchorId(tempContext.messages) !== null;
          const { context: compactedContext } = await compaction.compactDuringRun({
            trigger: "post-tool",
            state: tempState,
            budgetContext: tempContext,
            tools: combinedTools,
            includeUploadedFilesMetadata: true,
          });
          if (!compactedContext) {
            if (!tailBlockAttachable) {
              return null;
            }

            renderedBusSeq = busDelta.lastSeq;
            if (rosterRunStatusDelta) {
              renderedRosterRunStatus = rosterRunStatusDelta;
            }
            return {
              context: tempContext,
              emittedMessages,
              wireTailText: tailBlockText,
            };
          }
          latestAgentEmittedMessages = [];
          clearPersistableAgentProgress();

          refreezeTaskListContext();

          await refreezeParentMessageBus();

          renderedRosterRunStatus = "";
          return {
            context: withAgentRuntimeContext(compactedContext),
            emittedMessages: [],
          };
        },
        signal: scope.controller.signal,
        debugLogger: trajectoryDebugLogger,
      });
      finishAgentPerfSpan(
        conversationDebugLogger,
        "assistant.run_with_tools",
        assistantRunStartedAt,
        {
          emittedMessageCount: result.emittedMessages.length,
          messageCount: result.messages.length,
        },
      );

      if (planRunPolicy) {
        const decision = planRunPolicy.decideAfterRun({
          emittedMessages: result.emittedMessages,
        });
        if (decision.kind === "nudge") {
          const interimState = appendMessagesToConversation(
            getNextConversationState(),
            result.emittedMessages,
          );
          latestAgentEmittedMessages = [];
          applyConversationState(interimState);
          clearPersistableAgentProgress();
          resetLiveTranscript(transcriptStore);
          const preparedContext = buildPreparedContext(interimState, combinedTools, {
            includeUploadedFilesMetadata: true,
          });
          pendingAgentContext = {
            ...preparedContext,
            messages: [
              ...preparedContext.messages,
              {
                role: "user",
                content: [{ type: "text", text: decision.reminderText }],
                timestamp: Date.now(),
              },
            ],
          };
          result = null;
        } else if (decision.kind === "fallback") {
          const fallback = planRunPolicy.registerFallbackPlan({
            planText: lastVisibleAssistantText(result.messages),
          });
          if (fallback) {
            planFallbackMessages = [
              {
                role: "assistant",
                content: [fallback.toolCall],
                api: runtimeModel.api,
                provider: runtimeModel.provider,
                model: runtimeModel.id,
                usage: createEmptyAssistantUsage(),
                stopReason: "toolUse",
                timestamp: fallback.toolResult.timestamp,
              } satisfies AssistantMessage,
              fallback.toolResult,
            ];
          }
        }
      }
    } catch (error) {
      if (!midStreamCompactionRequested) {
        throw error;
      }

      hookLifecycle.ensureMessageEnded();
      if (activeAgentRound > 0) {
        hookLifecycle.endTurn(activeAgentRound);
      }
      resetLiveTranscript(transcriptStore);

      const partialAssistant = buildPartialAssistantMessage({
        model: runtimeModel,
        text: streamedAgentText,
        stopReason: "aborted",
      });
      const tempState = appendMessagesToConversation(getNextConversationState(), [
        ...latestAgentEmittedMessages,
        ...(partialAssistant ? [partialAssistant] : []),
      ]);
      latestAgentEmittedMessages = [];
      applyConversationState(tempState);
      clearPersistableAgentProgress();

      const compactionResult = await compaction.compactDuringRun({
        trigger: "mid-stream",
        state: tempState,
        budgetContext: withAgentRuntimeContext(
          buildPreparedContext(tempState, combinedTools, {
            includeAbortedMessages: true,
            includeUploadedFilesMetadata: true,
          }),
        ),
        tools: combinedTools,
        includeAbortedMessages: true,
        includeUploadedFilesMetadata: true,
      });

      if (!compactionResult.context) {
        throw new Error("Mid-stream compaction did not provide a continuation context.");
      }

      refreezeTaskListContext();
      await refreezeParentMessageBus();
      renderedRosterRunStatus = "";
      pendingAgentContext = compactionResult.context;
      if (compactionResult.shouldDisableProtection) {
        midStreamProtectionDisabled = true;
      }
    } finally {
      scope.release();
    }
  }

  const assistantStopReason = result.assistant.stopReason;
  if (
    isAbortedAssistantMessage(result.assistant) ||
    isAbortedAssistantMessage(result.messages[result.messages.length - 1])
  ) {
    if (commitVisibleAbortedConversation()) {
      return;
    }
    throw new Error("Cancelled");
  }

  const finalState = appendMessagesToConversation(getNextConversationState(), [
    ...result.emittedMessages,
    ...planFallbackMessages,
  ]);
  let completedState = finalState;
  const finalAssistantText = assistantMessageToText(result.assistant);
  if (!conversationEvents.hasForwardedText() && finalAssistantText.length > 0) {
    conversationEvents.queueToken(finalAssistantText, {
      round: activeAgentRound || 1,
    });
  }
  const shouldRunMemoryExtraction =
    assistantStopReason !== "error" && assistantStopReason !== "aborted";
  const memoryRoundOffset = Math.max(
    activeAgentRound || pendingTerminalAssistantMetaRef.current?.round || 1,
    1,
  );

  const runPostTurnMemoryExtraction = (visibleEvents?: MemoryExtractionVisibleEvents) => {
    const currentMemoryExtractionModel: MemoryExtractionModelConfig = {
      providerId,
      model,
      runtime,
      selectedModel,
    };
    // The controller owns the extraction scope and links this stable turn-level
    // userStop signal, so request-scope churn cannot detach cancellation.
    return memoryExtraction.requestExtraction({
      primary: memoryExtractionModel ?? currentMemoryExtractionModel,
      fallback: memoryExtractionModel ? currentMemoryExtractionModel : undefined,
      onPrimaryFailure: memoryExtractionModel ? onMemoryExtractionModelFailure : undefined,
      sessionId,
      conversationId,
      workdir: conversationCwd ?? effectiveWorkdir,
      messages: buildPreparedContext(finalState).messages,
      statusText: memoryExtractionStatusText,
      signal: cancellation.userStop.signal,
      debugLogger: conversationDebugLogger,
      visibleEvents,
    });
  };

  const persistCompletedState = (state: ConversationViewState) =>
    persistConversationWithHistorySync({
      conversationId,
      sessionId,
      providerId,
      model,
      cwd: conversationCwd,
      state,
      fallbackTitle,
      createdAt,
      titlePromise,
    });

  const pendingTerminalAssistantMeta = pendingTerminalAssistantMetaRef.current;
  if (pendingTerminalAssistantMeta) {
    commitAssistantRoundMeta(
      pendingTerminalAssistantMeta.assistant,
      pendingTerminalAssistantMeta.round,
    );
  }
  hookLifecycle.endAgent();

  applyConversationState(finalState);
  settleLiveTranscript(transcriptStore);
  const historyPersisted = await persistCompletedState(finalState);
  trajectory.endTurn(
    pendingTerminalAssistantMeta === null
      ? { status: "complete" }
      : trajectoryTerminalInfo(pendingTerminalAssistantMeta.assistant),
  );

  await trajectory.flush();

  // Memory extraction reads the in-memory final state. Only run it after the
  // durable history write succeeds so we never keep "memory has the answer,
  // chat history only has the user prompt" after a failed final persist.
  if (historyPersisted && showSilentMemoryExtraction && shouldRunMemoryExtraction) {
    const extraction = await runPostTurnMemoryExtraction({
      roundOffset: memoryRoundOffset,
      onTurnStart: (round) => {
        conversationEvents.queueToken("", { round, contextRelevant: false });
        batchLiveRoundsUpdate(
          (prev) => [
            ...prev,
            {
              key: `r${round}`,
              round,
              blocks: [],
              meta: { contextRelevant: false },
              runningToolCallIds: [],
              thinkingOpen: false,
            },
          ],
          transcriptStore,
        );
      },
      onTextDelta: (delta, round) => {
        conversationEvents.queueToken(delta, { round });
        batchLiveRoundsUpdate(
          (prev) =>
            updateLiveRound(prev, round, (target) =>
              appendTextDeltaToRound(collapseThinking(target), delta),
            ),
          transcriptStore,
        );
      },
      onThinkingDelta: (delta, round) => {
        conversationEvents.queueEvent({
          type: "thinking",
          text: delta,
          round,
          conversation_id: conversationId,
        });
        batchLiveRoundsUpdate(
          (prev) =>
            updateLiveRound(prev, round, (target) => ({
              ...appendThinkingDeltaToRound(target, delta),
              thinkingOpen: true,
            })),
          transcriptStore,
        );
      },
      onToolCall: (toolCall, round) => {
        if (!shouldShowToolEvent(toolCall)) return;
        conversationEvents.queueEvent({
          type: "tool_call",
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
          round,
          conversation_id: conversationId,
        });
        batchLiveRoundsUpdate(
          (prev) =>
            updateLiveRound(prev, round, (target) => {
              const withToolCall = upsertToolCallToRound(collapseThinking(target), toolCall);
              return markToolCallRunningInRound(withToolCall, toolCall);
            }),
          transcriptStore,
        );
      },
      onToolExecutionStart: (toolCall, round) => {
        if (!shouldShowToolEvent(toolCall)) return;
        conversationEvents.queueEvent({
          type: "tool_call",
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
          round,
          conversation_id: conversationId,
        });
        batchLiveRoundsUpdate(
          (prev) =>
            updateLiveRound(prev, round, (target) => {
              const withToolCall = upsertToolCallToRound(collapseThinking(target), toolCall);
              return markToolCallRunningInRound(withToolCall, toolCall);
            }),
          transcriptStore,
        );
      },
      onToolResult: (toolCall, toolResult, round) => {
        if (!shouldShowToolEvent(toolCall)) return;
        conversationEvents.queueEvent({
          type: "tool_result",
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
          content: toolResult.content,
          details: toolResult.details,
          isError: toolResult.isError ?? false,
          round,
          conversation_id: conversationId,
        });
        batchLiveRoundsUpdate(
          (prev) =>
            updateLiveRound(prev, round, (target) => {
              const nextTarget = attachToolResultToRound(
                collapseThinking(target),
                toolCall,
                toolResult,
              );

              return {
                ...nextTarget,
                runningToolCallIds: (nextTarget.runningToolCallIds || []).filter(
                  (id) => id !== toolCall.id,
                ),
              };
            }),
          transcriptStore,
        );
      },
      onAssistantMessage: (assistant, round) =>
        commitAssistantRoundMeta(assistant, round, { contextRelevant: false }),
      onToolStatus: (s) => {
        conversationEvents.queueToolStatus(s, false);
        updateToolStatus(s, transcriptStore);
      },
    });
    if (extraction.emittedMessages.length > 0) {
      completedState = appendRenderOnlyMessagesToConversation(
        finalState,
        extraction.emittedMessages,
      );
    }
  }
  if (completedState !== finalState) {
    applyConversationState(completedState);
    await persistCompletedState(completedState);
  }
  conversationEvents.queueEvent({
    type: "done",
    conversation_id: conversationId,
  });
  conversationEvents.close();
  if (historyPersisted && !showSilentMemoryExtraction && shouldRunMemoryExtraction) {
    void runPostTurnMemoryExtraction();
  }
}
