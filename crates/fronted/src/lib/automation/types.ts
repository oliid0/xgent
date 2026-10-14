// Wire types for the automation domain (cron tasks + conversation hooks).
// Mirrors src-tauri/src/services/automation/types.rs — the Rust side is the
// single source of truth; every frontend runtime consumes these shapes verbatim.

export type CronTaskType = "bash" | "http" | "prompt";

export type HookType = "command" | "http";

export type HookEvent =
  | "agent_start"
  | "turn_start"
  | "message_start"
  | "message_end"
  | "tool_execution_start"
  | "tool_execution_end"
  | "turn_end"
  | "agent_end";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export const HOOK_EVENTS: HookEvent[] = [
  "agent_start",
  "turn_start",
  "message_start",
  "message_end",
  "tool_execution_start",
  "tool_execution_end",
  "turn_end",
  "agent_end",
];

export const HTTP_METHODS: HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];

/// Header values are replaced with this sentinel in snapshots that leave the
/// desktop; sending it back in a patch keeps the stored secret unchanged.
export const MASKED_HEADER_VALUE = "__xgent-masked__";

/**
 * Per-task execution timeout (seconds) applied to bash scripts, each http
 * request and the prompt run lease. Bounds mirror the Rust validator
 * (`MIN/MAX_CRON_TIMEOUT_SECONDS`); the max matches the shell runner's hard
 * ten-minute cap. Snapshots from desktops older than this field omit it —
 * resolve absent values to the default for display.
 */
export const DEFAULT_CRON_TIMEOUT_SECONDS = 300;
export const MIN_CRON_TIMEOUT_SECONDS = 1;
export const MAX_CRON_TIMEOUT_SECONDS = 600;

export function canHttpMethodHaveBody(method: HttpMethod): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

export type HttpRequestSpec = {
  id: string;
  url: string;
  method: HttpMethod;
  headers?: Record<string, string>;
  body?: unknown;
};

export type SelectedModelRef = {
  customProviderId: string;
  model: string;
};

export type CronTask = {
  id: string;
  name: string;
  description: string;
  cron: string;
  enabled: boolean;
  remainingExecutions?: number;
  /** Execution timeout in seconds; absent (pre-field snapshot) = 300. */
  timeoutSeconds?: number;
  type: CronTaskType;
  script?: string;
  requests?: HttpRequestSpec[];
  prompt?: string;
  selectedModel?: SelectedModelRef;
  /** Thinking level for prompt tasks; absent/empty = runtime default. */
  reasoning?: string;
  /** Workspace path pinned for this task; absent/empty = follow the globally
   * active workspace. Never set on http tasks. */
  workdir?: string;
  lastError?: string;
};

export type HookDef = {
  id: string;
  name: string;
  description: string;
  event: HookEvent;
  enabled: boolean;
  type: HookType;
  script?: string;
  requests?: HttpRequestSpec[];
  timeoutMs?: number;
};

export type CronSnapshot = {
  revision: number;
  tasks: CronTask[];
};

export type HooksSnapshot = {
  revision: number;
  hooks: HookDef[];
};

export type AutomationSnapshot = {
  cron: CronSnapshot;
  hooks: HooksSnapshot;
};

export type CronRunState = "pending" | "leased" | "waiting" | "done" | "expired";

export type BackgroundInboxItem = {
  id: string;
  sequence: number;
  sourceHostId: string;
  requestId: string;
  name: string;
  state: "waiting" | "done" | "expired";
  success: boolean;
  preview: string;
  artifactCount: number;
  receivedAt: number;
  readAt: number | null;
};
export type BackgroundInboxPage = { items: BackgroundInboxItem[]; nextCursor: number | null };
export type BackgroundInboxChunk = {
  entryId: string;
  offset: number;
  totalBytes: number;
  text: string;
  nextOffset: number | null;
  snapshotHash: string;
};
export type BackgroundInboxSync = { inspected: number; received: number; unresolved: number };

export type CronRunNowResponse = {
  startedAt: number;
};

export type CronRunRecord = {
  id: string;
  taskId: string;
  state: CronRunState;
  success: boolean;
  startedAt: number;
  finishedAt?: number;
  durationMs: number;
  exitCode?: number;
  output: string;
};

export const MANUAL_CRON_RUN_POLL_INTERVAL_MS = 1_000;
export const MANUAL_CRON_RUN_TIMEOUT_MS = 6 * 60_000;

const CONCURRENT_RUN_SKIP_PREFIX = "Skipped: previous run is still in progress.";

export function findManualCronRun(
  runs: CronRunRecord[],
  startedAt: number,
): CronRunRecord | undefined {
  return runs.reduce<CronRunRecord | undefined>((match, run) => {
    if (run.startedAt < startedAt || run.output.startsWith(CONCURRENT_RUN_SKIP_PREFIX)) {
      return match;
    }
    if (!match || run.startedAt < match.startedAt) {
      return run;
    }
    return match;
  }, undefined);
}

export function isManualCronRunFinished(runs: CronRunRecord[], startedAt: number): boolean {
  const run = findManualCronRun(runs, startedAt);
  return run?.state === "done" || run?.state === "expired";
}

export type PromptRunRequest = {
  lease?: BackgroundExecutionLease;
  executionId: string;
  taskId: string;
  taskName: string;
  prompt: string;
  providerId: string;
  model: string;
  startedAt: number;
  leaseExpiresAt: number;
  counted: boolean;
  /** Resolved at queue time (task pin or global workdir). Empty on rows
   * queued before this field existed; the runner falls back to the global
   * workdir then. */
  workdir: string;
  /** Task thinking level; empty means the runner's default. */
  reasoning: string;
  backgroundContext?: BackgroundTaskContext;
  goalContext?: GoalPromptContext;
};

/** Bounded native data from the original goal store, never an execution grant. */
export type GoalPromptContext = {
  version: 1;
  taskId: string;
  storeId: string;
  revision: number;
  observedAt: number;
  hasMoreGoals: boolean;
  goals: Array<{
    id: string;
    status: "active";
    planPreview: {
      title: string;
      description: string;
      category: string;
      parentId: string | null;
      steps: Array<{ id: string; title: string; done: boolean }>;
      totalSteps: number;
      completedSteps: number;
    };
    activeWork: boolean;
    work: Array<{
      requestId: string;
      name: string;
      executionId: string | null;
      sourceHostId: string | null;
      state: string | null;
      success: boolean | null;
      outputPreview: string;
    }>;
    scheduledRuns: Array<{
      executionId: string;
      state: string;
      success: boolean | null;
      outputPreview: string;
      at: number;
    }>;
    artifactHints: Array<{
      id: string;
      pathPreview: string;
      contentHash: string;
      bytes: number;
      requestId: string;
      sourceHostId: string;
    }>;
  }>;
};

export type CompletePromptRunInput = {
  lease?: BackgroundExecutionLease;
  executionId: string;
  success: boolean;
  durationMs: number;
  output: string;
};

export type PromptCompletionResponse = {
  status: "completed" | "already_finished";
};

export type BackgroundExecutionLease = {
  attempt: number;
  generation: number;
  token: string;
};

export type BackgroundResumeCheckpoint = {
  revision: number;
  context: unknown | null;
  lastCompaction: unknown | null;
};

export type WaitBackgroundTaskInput = {
  executionId: string;
  lease: BackgroundExecutionLease;
  durationMs: number;
  output: string;
  knownTools: string[];
  budgetDeferralId?: string;
};

export type BackgroundWaitRecord = {
  waitId: string;
  createdAt: number;
  retryAt: number;
  probes: number;
  automaticTools: string[];
  knownTools: string[];
  retryOnInventoryChange: boolean;
  cloudCallIds?: string[];
};

export type BackgroundWaitingTask = { executionId: string; waiting: BackgroundWaitRecord };

export type BackgroundResumeReceipt = {
  version: 1;
  hostId: string;
  executionId: string;
  input: ResumeBackgroundTaskInput;
  acceptedAt: number;
};
export type ResumeBackgroundTaskInput = {
  requestId: string;
  waitId: string;
  resumeId: string;
  response: string;
};
export type BackgroundResultResponse = {
  sourceHostId: string;
  input: ResumeBackgroundTaskInput;
  result: BackgroundTaskRecord | null;
};

export type BackgroundSubmissionItem = {
  sequence: number;
  requestId: string;
  sourceHostId: string;
  name: string;
  createdAt: number;
  retryAt: number;
  probes: number;
  lastError: string | null;
  accepted: boolean;
  localOwner: boolean;
  cancelRequested: boolean;
  cancellationConfirmed: boolean;
  locallyWithdrawn?: boolean;
};
export type BackgroundSubmissionPage = {
  items: BackgroundSubmissionItem[];
  nextCursor: number | null;
};
export type BackgroundSubmissionState = {
  requestId: string;
  sourceHostId: string;
  localExecution: boolean;
  name: string;
  cancelRequested: boolean;
  result: BackgroundTaskRecord | null;
};

export type AutomationOp =
  | { op: "create"; item: Record<string, unknown> }
  | { op: "update"; id: string; patch: Record<string, unknown> }
  | { op: "delete"; id: string }
  | { op: "reorder"; ids: string[] };

export type AutomationApplyInput = {
  baseRevision: number;
  ops: AutomationOp[];
};

export type ApplyStatus = "ok" | "conflict";

export type CronApplyResponse = {
  status: ApplyStatus;
  cron: CronSnapshot;
};

export type HooksApplyResponse = {
  status: ApplyStatus;
  hooks: HooksSnapshot;
};

export const HOOK_EVENT_TRANSLATION_KEYS: Record<HookEvent, string> = {
  agent_start: "settings.hooksEventAgentStart",
  turn_start: "settings.hooksEventTurnStart",
  message_start: "settings.hooksEventMessageStart",
  message_end: "settings.hooksEventMessageEnd",
  tool_execution_start: "settings.hooksEventToolExecutionStart",
  tool_execution_end: "settings.hooksEventToolExecutionEnd",
  turn_end: "settings.hooksEventTurnEnd",
  agent_end: "settings.hooksEventAgentEnd",
};

export const HOOK_EVENT_DESCRIPTION_TRANSLATION_KEYS: Record<HookEvent, string> = {
  agent_start: "settings.hooksEventAgentStartDesc",
  turn_start: "settings.hooksEventTurnStartDesc",
  message_start: "settings.hooksEventMessageStartDesc",
  message_end: "settings.hooksEventMessageEndDesc",
  tool_execution_start: "settings.hooksEventToolExecutionStartDesc",
  tool_execution_end: "settings.hooksEventToolExecutionEndDesc",
  turn_end: "settings.hooksEventTurnEndDesc",
  agent_end: "settings.hooksEventAgentEndDesc",
};

export type SubmitBackgroundTaskInput = {
  requestId: string;
  name: string;
  prompt: string;
  providerId: string;
  model: string;
  workdir: string;
  timeoutSeconds?: number;
  reasoning?: string;
  intelligentSchedulingEnabled?: boolean;
  files?: BackgroundInputFile[];
  delegation?: BackgroundDelegation;
  requirements?: WorkerRequirements;
  sourceContext?: BackgroundSourceContext;
  goalBinding?: BackgroundGoalBinding;
};

export type BackgroundGoalBinding = {
  goalId: string;
  storeId: string;
  revision: number;
};

export type BackgroundRequestClock = {
  timestampMs: number;
  timeZone: string | null;
};

export type BackgroundSourceContext = {
  version: 1 | 2;
  requestScope: string;
  systemPrompt: string;
  messages: unknown[];
  originalRequest?: string;
  requestClock?: BackgroundRequestClock;
  routing?: BackgroundSourceRouting;
};

/** Original device requirements restrict execution; they never grant authority. */
export type BackgroundSourceRouting = {
  version: 1 | 2;
  initiatingHostId: string;
  branches: {
    id: string;
    requirement: string;
    dependsOn: string[];
    locality: "portable" | "initiating-device";
    observation?: {
      kind: "health_samples";
      metric: "heart_rate" | "blood_glucose" | "oxygen_saturation" | "weight" | "body_temperature";
      startMs: number;
      endMs: number;
      limit: number;
    };
  }[];
};

export type BackgroundDelegation = {
  rootRequestId: string;
  parentRequestId: string;
  ancestorHostIds: string[];
  budget?: { version: 1; maxModelRequests: number; maxToolCalls: number; deadlineAt?: number };
};

export type BackgroundTaskContext = {
  rootRequestId: string;
  requestId: string;
  hostIds: string[];
  goalBinding?: BackgroundGoalBinding;
};

export const MAX_BACKGROUND_HOSTS = 8;

export type BackgroundInputFile = {
  name: string;
  contentBase64: string;
  contentHash: string;
  bytes: number;
};
export type BackgroundInputManifest = {
  relativePath: string;
  contentHash: string;
  bytes: number;
};
export type BackgroundTaskRecord = {
  executionBudget?: import("./backgroundBudget").BackgroundBudgetSnapshot;
  children?: BackgroundChildSummary[];
  videos?: Array<{
    callId: string;
    status:
      | "issuing"
      | "pending"
      | "in_progress"
      | "completed"
      | "failed"
      | "cancelled"
      | "expired";
    artifactId: string | null;
    error: string | null;
  }>;
  requestId: string;
  goalBinding?: BackgroundGoalBinding;
  hostId: string;
  name: string;
  workdir: string;
  run: CronRunRecord;
  artifacts: BackgroundArtifact[];
  inputs: BackgroundInputManifest[];
  operations: { inFlight: number; returned: number; errors: number };
  checkpointRevision: number;
  delegation?: BackgroundDelegation | null;
  outcomes?: BackgroundOutcomeReport | null;
  waiting?: BackgroundWaitRecord | null;
  cloudRecovery?: {
    callId: string;
    taskId: string;
    waitId: string;
    retryAt: number;
    probes: number;
    launchError?: string | null;
    lastError?: string | null;
  } | null;
  cloudCancellation?: { pending: number; observedTerminal: number };
};

export type BackgroundChildSummary = {
  name?: string;
  callId: string;
  requestId: string;
  peerId: string;
  accepted: boolean;
  state: "pending" | "leased" | "waiting" | "done" | "expired" | null;
  success: boolean;
  terminalConfirmed: boolean;
  cancelRequested: boolean;
  cancelAcknowledged: boolean;
  lastError: string | null;
};

export type ReceivedChildChunk = {
  requestId: string;
  hostId: string;
  child: BackgroundChildSummary;
  available: boolean;
  snapshot: {
    offset: number;
    totalBytes: number;
    text: string;
    nextOffset: number | null;
    snapshotHash: string;
  } | null;
};

export type BackgroundCriterion =
  | { kind: "artifact"; path: string }
  | { kind: "operation"; tool: string; arguments: Record<string, unknown> }
  | { kind: "answer" }
  | { kind: "unavailable"; capability: string };

export type BackgroundTaskPlan = {
  version: 1;
  branches: {
    id: string;
    title: string;
    requirement: string;
    dependsOn: string[];
    criteria: BackgroundCriterion[];
  }[];
};

export type BackgroundBranchEvidence = {
  artifactIds: string[];
  callIds: string[];
  answer: string | null;
};

export type BackgroundOutcomeReport = {
  branches: {
    branch: BackgroundTaskPlan["branches"][number];
    state: "pending" | "waiting" | "verified";
    evidence: BackgroundBranchEvidence | null;
    reason: string | null;
    waitingTool?: string | null;
    waitingInventory?: boolean;
  }[];
  verified: boolean;
};

export type BackgroundOperationRecord = {
  sequence: number;
  callId: string;
  toolName: string;
  arguments: unknown;
  contextRevision: number;
  state: "started" | "returned";
  result: unknown | null;
  startedAt: number;
  finishedAt: number | null;
};

export type BackgroundOperationPage = {
  operations: BackgroundOperationRecord[];
  nextCursor: number | null;
};

export type BeginBackgroundOperationResponse = {
  status: "execute" | "returned" | "uncertain";
  result?: unknown;
};

export type BackgroundCompactionPage = {
  compactions: {
    sourceRevision: number;
    checkpointRevision: number;
    sourceHash: string;
    sourceBytes: number;
    createdAt: number;
  }[];
  nextCursor: number | null;
};

export type BackgroundContextArchiveChunk = {
  sourceRevision: number;
  sourceHash: string;
  totalBytes: number;
  offset: number;
  text: string;
  nextOffset: number | null;
};

export type BackgroundArtifact = {
  id: string;
  relativePath: string;
  contentHash: string;
  bytes: number;
};

export type BackgroundArtifactContent = {
  artifact: BackgroundArtifact;
  contentBase64: string;
};

export type WorkerHostInfo = {
  hostId: string;
  platform: string;
  architecture: string;
  executorReady: boolean;
  acceptsBackgroundTasks: boolean;
  workdir: string;
  workspaceAvailable: boolean;
  inputSnapshotVersion: number;
  delegationVersion: number;
  childTasksVersion?: number;
  waitingVersion?: number;
  sourceContextVersion?: number;
  goalAcceptanceVersion?: number;
  intelligentSchedulingVersion?: number;
  modelRoutingVersion?: number;
  budgetDelegationVersion?: number;
  budgetDeadlineVersion?: number;
  sourceRoutingVersion?: number;
  deviceChannelVersion?: number;
  deviceActionsVersion?: number;
  resultDeliveryVersion?: number;
  inventory?: WorkerInventory;
  providers: {
    id: string;
    name: string;
    providerType: string;
    models: string[];
    modelProfiles?: {
      model: string;
      skills: string[];
      backgroundPending: number;
      backgroundRunning: number;
      backgroundWaiting: number;
    }[];
  }[];
  pending: number;
  running: number;
  observedAt: number;
};

export type WorkerRequirements = {
  capabilities: string[];
  platforms: string[];
  modelSkills?: string[];
};
export type WorkerInventory = {
  version: 1;
  observedAt: number;
  validUntil: number;
  capabilities: {
    id: string;
    state: "available" | "unavailable" | "unknown";
    evidence: "version-command" | "sdk-layout" | "policy";
    detail: string;
  }[];
};

export type WorkerPeerList = {
  peers: {
    peerId: string;
    baseUrl: string;
    online: boolean;
    host: WorkerHostInfo;
    endpoints?: {
      baseUrl: string;
      network: "lan" | "tailnet" | "other";
      online: boolean;
      error?: string;
    }[];
    error?: string;
  }[];
  registrationError?: string;
};
