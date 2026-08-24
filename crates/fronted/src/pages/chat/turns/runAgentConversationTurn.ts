import type {
  AssistantMessage,
  Context,
  Message,
  ToolCall,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import { getLanPcCommandHostConfig } from "@xagent/runtime";
import { ASK_USER_QUESTION_TOOL_NAME } from "../../../lib/chat/askUserQuestion";
import type { CompactionController } from "../../../lib/chat/compaction/controller";
import { estimateTextTokenUnits } from "../../../lib/chat/compaction/tokenLedger";
import type { ProviderRuntimeConfig } from "../../../lib/chat/compaction/types";
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
import { resolveTailBlockAnchorId } from "../../../lib/chat/context/contextTailBlock";
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
import type { StreamDebugLogger } from "../../../lib/debug/agentDebug";
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
import { buildBuiltinToolRegistry } from "../../../lib/tools/builtinRegistry";
import type { AdditionalProjectRoot } from "../../../lib/tools/additionalProjectRoots";
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
import { getOrCreateTodoToolState } from "../../../lib/tools/todoTools";
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
import type { TrajectoryUsage } from "../../../lib/trajectory/types";
import {
  composeTrajectorySystemPrompt,
  serializeToolCatalog,
} from "../../../lib/trajectory/sections";
import {
  appendSystemPrompt,
  buildPartialAssistantMessage,
  createEmptyAssistantUsage,
  type ConversationRuntimeEntry,
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
  /** Run 级任务状态存储：由 send 管线构建，提交走非终态持久化。 */
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
  /** 轨迹埋点；缺省时不记录，对话行为完全不变。 */
  trajectory?: TrajectoryRecorder;
  /** 本轮在会话中的 turn 序号（1-based），供轨迹归位。 */
  trajectoryTurn?: number;
  /** 用户消息在完整会话中的 0-based messageIndex，供分支/重发精确裁剪。 */
  trajectoryMessageIndex?: number;
  /** 用户消息稳定 id；正文窗口优先按它与轨迹 turn 对齐。 */
  trajectoryMessageId?: string;
  /** 读取最近一次上下文构建的 system prompt 分段，供轨迹分段去重。 */
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
      ...(params.trajectoryMessageId === undefined ? {} : { messageId: params.trajectoryMessageId }),
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
  // roster 拆两段：身份字段（id / name / role / mode）稳定，留在 systemPrompt；
  // 运行状态（status / last_task / last_summary）随子代理 run 推进而变，后置到消息尾部，
  // 否则每推进一次状态就改写 systemPrompt，system 块连同其后的全部历史一并作废。
  let rosterIdentitySection = "";
  // 消息总线快照同样按“压缩纪元”冻结：只在 run 起始与各压缩边界重算。
  // run 内新到的子 agent 消息不回头改写 systemPrompt（那会作废 system 块及其后
  // 的全部历史），改由 renderMessageBusDelta 渲染成增量块挂到消息尾部投递——
  // 尾部本就在缓存断点之后、每轮重读，追加不额外损失命中率。
  let parentMessageBusSnapshot = "";
  // 已渲染进上下文的 bus 游标（seq）：run 内只投递其后的增量。
  let renderedBusSeq = 0;
  // 当前冻结快照实际覆盖到的 seq。必须与 renderedBusSeq 分开记：后者会被尾部增量
  // 推进，快照却只在压缩边界重算，两者在 run 内本就不成对。
  let frozenBusSeq = 0;
  const refreezeParentMessageBus = async () => {
    const messages = await loadParentBusMessages();
    // 读失败时保持上一份快照，并把游标退回该快照覆盖的位置：调用点都在压缩之后，
    // 挂着增量的尾部块可能已被截断，游标停在原处会让那段消息既不在快照里也不在
    // 历史里，永久丢失。退回后下一轮重投——重投只多花 token，丢消息不可逆。
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
    // 游标必须用快照实际覆盖到的 seq（连续已渲染前缀），不能用全体可见消息的
    // 最大 seq：快照有条数上限，被配额挤掉的消息若被游标跳过，就既不在快照里
    // 也不会再被 delta 投递，静默丢失。
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
  // 已投递进上下文的 roster 易变段：与 bus 的 seq 游标同理，只有真正挂上才推进。
  // run 起始不投递——此时消息尾部还没有安全锚点（末条是 user 消息），首次投递发生在
  // 第一轮工具结果之后；在那之前 Agent 工具描述里的 roster 已带有 status / summary，
  // 模型真要委派时看得到。
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
    // 内容没变就不投递：每轮无条件追加等于亲手打穿缓存。
    return section === renderedRosterRunStatus ? "" : section;
  };
  // 任务状态快照按“压缩纪元”冻结：只在 run 起始与各压缩边界重算，run 内不再重读。
  // 缓存前缀按字节匹配，systemPrompt 排在全部消息之前——每轮重读 meta.taskList
  // 等于每次 TaskUpdate 都改写前缀，system 块连同其后的全部历史一并作废。
  // 模型感知任务状态的主通道是 TaskCreate / TaskUpdate / TaskList 的工具结果，
  // 这份 JSON 只在历史被压缩截断、工具结果被摘要掉之后才不可替代（见
  // formatTaskListRuntimeContext 的文案），而那一刻前缀本来就要重建，重新冻结是
  // 免费的。代价是 run 内新建的任务不出现在 system 段，由工具结果覆盖。
  let frozenTaskListContext = "";
  const refreezeTaskListContext = () => {
    // 只注入本 Run 的权威任务状态：edit-resend 等路径可能把上一 Run 持久化的
    // taskList 带回 meta，工具层按 runId 视其为不存在，注入必须同口径。
    const taskList = getNextConversationState().meta.taskList;
    frozenTaskListContext =
      taskList && taskList.runId === taskStateStore.runId
        ? formatTaskListRuntimeContext(taskList)
        : "";
    return frozenTaskListContext;
  };
  refreezeTaskListContext();
  // Plan mode 段:turn 级快照、run 内恒定文本,与 frozenTaskListContext 同列
  // 冻结注入——system 段任何变动都会作废整条前缀缓存,绝不能随状态中途改写。
  const planModeSection = planModeEnabled ? buildPlanModeSystemPromptSection() : "";
  // Plan mode 运行策略(turn 级实例):有界升级状态机——终止谓词、轮数熔断、
  // 重复调用守卫、run 后的补提交/兜底裁决全部收敛于此,runner 保持模式无关。
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
    // 轨迹 runtime 段与真实注入同口径：只记录此刻真的拼进 systemPrompt 的部分，
    // builder 会跳过空段，与上方 appendSystemPrompt 的条件一一对应。
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
  const todoState = getOrCreateTodoToolState(conversationId);
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
    todoState,
    taskStateStore,
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
  const combinedTools = builtinRegistry.tools.filter(
    (tool) => {
      const metadata = builtinRegistry.metadataByName.get(tool.name);
      return (
        (!planModeEnabled || isPlanModeAllowedTool(tool.name, metadata)) &&
        resolveToolPolicy(tool.name, metadata, toolPoliciesSnapshot) !== "deny"
      );
    },
  );

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
    const policy = resolveToolPolicy(
      toolCall.name,
      metadata,
      getToolPolicies?.(),
    );
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
    // 提问卡必须等问题与选项全部生成完毕且工具真正开始执行后再显示：
    // 流式增量与 onToolCall 都只做内部记账，双端统一由
    // onToolExecutionStart 发布可交互卡片。
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

  // Plan mode 文本兜底产出的合成消息对(assistant toolCall + toolResult),
  // 随最终状态一次性落盘;卡片在 turn 落定后由持久化消息渲染。
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
    // 主请求跑在派生 scope 上：mid-stream 压缩只 abort 该 scope，用户停止
    // （userStop）随时链式传导，不存在换代窗口。
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
            typeof requestContext.systemPrompt === "string" ? requestContext.systemPrompt : undefined;
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
          // O(1) 账本判定，触发时才 abort 本地 scope 并在 catch 中构建压缩输入。
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
          updateHostedSearch(hostedSearch, round);
        },
        onToolCall: (toolCall, round) => {
          sawToolCallInRound = true;
          discardPendingToolCallDelta(toolCall, round);
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
          // stepEnd 记在这里而不是工具执行之后：这样 step 的耗时是纯模型时间，
          // 工具各有自己的区间，甘特图上不会把工具时间重复计进模型泳道。
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
              // maxAttempts 含首次尝试，重试上限要减去它。
              maxRetries: Math.max(0, latest.maxAttempts - 1),
              ...(latest.errorMessage === "" ? {} : { error: latest.errorMessage }),
            });
          }
          updateRetryAttempts(attempts, transcriptStore);
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
          // 尾部投递：systemPrompt 里的 bus 快照与 roster 身份段都已冻结，run 内新到的
          // bus 消息与推进后的 roster 运行状态合并成**同一个**块作为 wireTailText 交给
          // runner——runner 累积后只挂到每次出站请求上，agent 运行时状态与
          // emittedMessages 始终不含它，不会泄漏进持久化、UI 与记忆抽取。
          const busDelta = await buildParentMessageBusDelta();
          const rosterRunStatusDelta = buildRosterRunStatusDelta();
          const tailBlockText = [busDelta.text, rosterRunStatusDelta].filter(Boolean).join("\n\n");
          // 探锚：只判断尾部块此刻能否安全挂上（解析得到锚点 = 可挂），不改写
          // tempContext.messages 本身。真正的挂载与锚点钉死发生在 runner 侧。
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
            // 没有增量时返回 null：不产生任何额外内容，运行时状态原样续跑。
            if (!tailBlockAttachable) {
              return null;
            }
            // 只有确认能挂上才推进游标与基线；没有安全锚点时下一轮重试，避免丢内容。
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
          // 压缩边界②：run 内压缩后重新冻结，必须赶在下面组装续跑上下文之前。
          refreezeTaskListContext();
          // 压缩会截断历史，runner 里累积的尾部投递内容也随本 override 不带
          // wireTailText 而被清空，必须连同游标一起重新冻结，否则那些消息既
          // 不在快照里也不会再被投递。
          await refreezeParentMessageBus();
          // 同理：roster 易变段的投递基线也随之作废，重置后下一轮重新投递。
          renderedRosterRunStatus = "";
          return {
            context: withAgentRuntimeContext(compactedContext),
            emittedMessages: [],
          };
        },
        signal: scope.controller.signal,
        debugLogger: conversationDebugLogger,
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

      // Plan mode 有界升级:run 正常结束但未经 ExitPlanMode 提交时,先补提交一
      // 轮(nudge),仍未提交则把最后的助手文本兜底注册为待决计划。两步各至多
      // 一次,turn 必然有限步收敛。
      if (planRunPolicy) {
        const decision = planRunPolicy.decideAfterRun({
          emittedMessages: result.emittedMessages,
        });
        if (decision.kind === "nudge") {
          // 对齐 mid-stream 压缩的循环重入范式:先把本 run 的消息提交进会话
          // 状态并重置 live 轮(避免重入后 round key 冲突、消息双渲染),再带
          // 一条 wire-only 提醒续跑。提醒只进出站请求——不追加进会话状态,
          // 不持久化、不进 UI 与记忆抽取。
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
            // 合成 ExitPlanMode 调用对追加进最终历史:协议一致(assistant
            // toolCall + toolResult),计划卡与审批链路零改动复用;usage 置零,
            // 不污染用量统计。
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
      // 压缩边界③：中途流式压缩后重新冻结，续跑上下文在下一轮循环由
      // withAgentRuntimeContext 包装 pendingAgentContext 时才读取冻结值。
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
  // 落盘与历史写入对齐：turn 边界是账本的一致点，之后的记忆提取不属于本轮轨迹。
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
      onAssistantMessage: commitAssistantRoundMeta,
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
  if (!showSilentMemoryExtraction && shouldRunMemoryExtraction) {
    void runPostTurnMemoryExtraction();
  }
}
