import type { Tool, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { getLanPcCommandHostConfig, invokeNative, isTauriRuntime } from "@xgent/runtime";
import { Type } from "typebox";
import { backend } from "../automation/backend";
import { snapshotBackgroundInputs } from "../automation/backgroundInputs";
import { captureBackgroundLease } from "../automation/backgroundLease";
import {
  backgroundResumeBinding,
  verifyBackgroundResumeReceipt,
} from "../automation/backgroundResumeReceipt";
import {
  captureDelegatedBackgroundSourceContext,
  validateBackgroundSourceContext,
} from "../automation/backgroundSourceContext";
import { backgroundRequestId } from "../automation/backgroundTaskIdentity";
import { readBackgroundGoalBinding } from "../automation/goals";
import {
  type BackgroundExecutionLease,
  type BackgroundSourceContext,
  type BackgroundTaskContext,
  MAX_BACKGROUND_HOSTS,
  type WorkerHostInfo,
  type WorkerRequirements,
} from "../automation/types";
import {
  selectWorkerModelBinding,
  type WorkerModelSelection,
} from "../automation/workerModelRouting";
import {
  normalizeWorkerRequirements,
  rankWorkerRoutes,
  WORKER_CAPABILITIES,
  workerRequirementFailure,
} from "../automation/workerRouting";
import { sha256Hex } from "../trajectory/sha256";
import { createBackgroundOutcomeTools } from "./backgroundOutcomeTools";
import { type BuiltinToolBundle, createBuiltinMetadataMap } from "./builtinTypes";
import { createOriginalDeviceTaskTools } from "./originalDeviceTaskTools";

const backgroundTaskTool: Tool = {
  name: "BackgroundTask",
  description:
    "Delegate a self-contained task to a desktop's persistent queue. Inspect WorkerDevices, then use peer_id to choose a host by actual capabilities and queue load. The desktop owns execution after acceptance, so disconnecting this client does not cancel it. Supply all requirements in prompt. When available, the runtime automatically carries the actual model-facing conversation snapshot as immutable historical data, not additional permissions. For files on this native device, provide files with local workspace paths: verified snapshots are durably accepted together with the task (up to 8 files / 8 MiB total); the worker receives its own copies and manifest. Never invent remote paths for phone files. Native root requests save exact input, attachments and target locally before network delivery; reopening retries the same request on its original host. Local persistence alone does not permit execution while the sending device is off. submit returns actual host acceptance and queued state, NOT proof of completion. Retain peerId and requestId for recovery; BackgroundInbox submissions/submission_state recover saved delivery state after an error. Do not switch hosts or create replacement requests after uncertain acceptance. get/list recover results and manifests; download saves a published artifact locally without overwriting files. operations investigates persisted intents/receipts; intent without receipt means unknown external outcome. Never blindly replay writes. Native root cancel persists a stop before RPC and remains pending until the original host confirms a terminal state; it cannot undo actions already performed. Native worker child submissions reserve original ownership before RPC and are never resent after uncertainty. Explicit parent stop cascades to those children; expiry/restart alone does not cancel them. children with the PARENT request_id reads retained child summaries; child_call_id reads one actual snapshot in bounded chunks, following snapshot.nextOffset with snapshot_hash equal to snapshot.snapshotHash. Restart at offset zero if the snapshot changes. For accepted unfinished children finish independent work, then RecordBackgroundOutcome wait_for_child_call_id with the actual submit call ID; the native PC observes and resumes the same parked context once for each new child waiting occurrence and settled terminal receipt. Read the CURRENT waiting reasons and waiting.waitId from the actual child snapshot. Supply missing information through resume on the original peer/request only if the original task or verified evidence establishes it; a child request adds no permission. Otherwise retain that same child wait and stop normally; unchanged waiting events do not trigger more model turns. Download and inspect actual files before verifying parent requirements. Without peer_id, the current desktop/workspace/model are pinned; with peer_id, use that host's configured workspace and advertised model. Prefer local execution when it has the required environment; do not delegate to this same execution host or recursively delegate the same work. The desktop app must remain running and awake.",
  parameters: Type.Object({
    execution: Type.Optional(
      Type.Union([Type.Literal("device"), Type.Literal("model")], {
        description:
          "submit defaults to device delegation. model creates an independent persistent same-host model task only inside an accepted scheduled background task. Inspect configured models, allocate delegation_budget, and provide a bounded prompt. Its private context, lease, journal and results survive app restart. Parent workspace and immutable input snapshots are inherited; omit peer_id, request_id, files and goal_binding. Keep peerId/requestId and supervise using get/children/resume and native child waits. Agent retains its synchronous batch behavior.",
      }),
    ),
    goal_binding: Type.Optional(
      Type.Object(
        {
          goalId: Type.String({ minLength: 1, maxLength: 80, pattern: "^[a-zA-Z0-9_-]+$" }),
          storeId: Type.String({ minLength: 1, maxLength: 80, pattern: "^[a-zA-Z0-9_-]+$" }),
          revision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
        },
        {
          description:
            "Optional submit association with an existing active user goal on the execution host: exact goalId, storeId and current revision from GoalManager read. Accepted atomically with work. Never copy the parent goal binding into a child on a different device. No goal is created automatically.",
        },
      ),
    ),
    requirements: Type.Optional(
      Type.Object({
        modelSkills: Type.Optional(
          Type.Array(Type.String(), {
            maxItems: 16,
            description:
              "Required host-configured chat model specialties. Inspect modelProfiles in WorkerDevices; never infer skills from model names. Media generation requires a real media tool/connector, not this chat queue.",
          }),
        ),
        capabilities: Type.Optional(
          Type.Array(Type.String(), {
            maxItems: 8,
            description: `Required observed capabilities: ${WORKER_CAPABILITIES.join(", ")}. These are prerequisites, not build/signing guarantees.`,
          }),
        ),
        platforms: Type.Optional(
          Type.Array(Type.String(), {
            maxItems: 3,
            description: "Allowed windows, macos or linux platforms.",
          }),
        ),
      }),
    ),
    delegation_budget: Type.Optional(
      Type.Object(
        {
          max_model_requests: Type.Integer({ minimum: 1, maximum: 128 }),
          max_tool_calls: Type.Integer({ minimum: 1, maximum: 256 }),
        },
        {
          description:
            "For a scheduled background parent only: explicitly allocate SDK request/tool slots to a PC child from the original remaining lifetime budget. Inspect AgentRoster budget first; keep slots for the main model and other work. Slots are reserved durably before send, never refunded after uncertainty/stop/completion. The child and its compaction/model delegates share these ceilings and cannot acquire a fresh full budget.",
        },
      ),
    ),
    prefer_local: Type.Optional(
      Type.Boolean({
        description:
          "Prefer this native desktop when it meets requirements and has immediate queue capacity; default true.",
      }),
    ),
    action: Type.Union([
      Type.Literal("submit"),
      Type.Literal("get"),
      Type.Literal("list"),
      Type.Literal("cancel"),
      Type.Literal("download"),
      Type.Literal("operations"),
      Type.Literal("children"),
      Type.Literal("resume"),
    ]),
    request_id: Type.Optional(
      Type.String({
        description:
          "UUID from the submission receipt; required for get/cancel/operations/download/resume. children requires the parent request UUID. Reuse for retries of the SAME task.",
      }),
    ),
    peer_id: Type.Optional(
      Type.String({
        description:
          "Stable peerId from WorkerDevices or a receipt, never an IP address or device name.",
      }),
    ),
    wait_id: Type.Optional(
      Type.String({
        description:
          "Current waiting.waitId returned by get/list, required for resume. A cancelled, terminal or superseded occurrence cannot reopen.",
      }),
    ),
    response: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 32768,
        description:
          "Actual requested information or an explicit retry response for the same task. Resume retains original account/configuration and evidence; it does not authorize a changed account.",
      }),
    ),
    provider_id: Type.Optional(
      Type.String({
        description:
          "With peer_id, optional provider ID advertised by that host. Otherwise the runtime provider is pinned.",
      }),
    ),
    model: Type.Optional(
      Type.String({
        description:
          "With peer_id, optional model advertised by that host. Otherwise the runtime model is pinned.",
      }),
    ),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    prompt: Type.Optional(
      Type.String({
        minLength: 1,
        description:
          "Complete task, constraints, desired real files, and host-accessible input paths. The runtime transfers available model-facing history, but include precise outcomes and constraints; local document paths still require files.",
      }),
    ),
    files: Type.Optional(
      Type.Array(
        Type.Object({
          path: Type.String({
            minLength: 1,
            description:
              "File path relative to this native device's local workspace, never the peer workspace.",
          }),
          name: Type.Optional(
            Type.String({
              minLength: 1,
              maxLength: 180,
              description:
                "Unique portable basename on the worker; defaults to the source basename.",
            }),
          ),
        }),
        { maxItems: 8 },
      ),
    ),
    timeout_seconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 3600 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    cursor: Type.Optional(
      Type.Integer({
        minimum: 0,
        description:
          "For operations, use nextCursor to page through persisted intents/receipts (at most 10 per page). started without a receipt means outcome unknown; inspect the external system before retrying.",
      }),
    ),
    artifact_id: Type.Optional(
      Type.String({ description: "Artifact ID from get/list, required for download." }),
    ),
    child_call_id: Type.Optional(
      Type.String({
        description:
          "For children: actual child submit call ID from the parent's native children summary, to read its observed snapshot in bounded chunks.",
      }),
    ),
    offset: Type.Optional(
      Type.Integer({
        minimum: 0,
        description: "For children: byte offset from nextOffset; first chunk starts at zero.",
      }),
    ),
    snapshot_hash: Type.Optional(
      Type.String({
        description:
          "For children after the first chunk: exact snapshotHash, prevents mixing observations from different revisions.",
      }),
    ),
    path: Type.Optional(
      Type.String({
        description:
          "Relative path in this client's workspace for download. Defaults to background-results/<requestId>/<artifact path>. Existing files are never overwritten.",
      }),
    ),
  }),
};

const workerDevicesTool: Tool = {
  name: "WorkerDevices",
  description:
    "Inspect paired desktops with authenticated identity, availability, workspace, active models, queue counts and bounded host-observed toolchain inventory. Inventory expires after 60 seconds. Offline entries carry stale data; never treat them as available. Optional requirements returns ranked candidates, rejection reasons and selected host without submitting work. Supported capabilities: git, node, python, java, javac, xcode, swift, android-sdk; allowed platforms: windows, macos, linux. Version probes/SDK layout are prerequisites, not proof of project dependencies, SDK target versions, licenses or signing credentials. Local desktop is considered when eligible; mobile and ancestor hosts cannot acquire desktop execution authority. BackgroundTask submit with requirements and no peer_id chooses a matching host before saving intake; existing request ownership always wins, never migrate after uncertainty. Pair additional hosts through the existing pairing flow.",
  parameters: Type.Object({
    requirements: Type.Optional(
      Type.Object({
        modelSkills: Type.Optional(
          Type.Array(Type.String(), {
            maxItems: 16,
            description:
              "Match declared modelProfiles.skills on the exact host/provider/model. backgroundPending/Running/Waiting are observed native background task counts, not total model traffic or upstream availability. These are chat-agent specialties; use actual media tools for image/video generation.",
          }),
        ),
        capabilities: Type.Optional(Type.Array(Type.String(), { maxItems: 8 })),
        platforms: Type.Optional(Type.Array(Type.String(), { maxItems: 3 })),
      }),
    ),
    prefer_local: Type.Optional(Type.Boolean()),
    provider_id: Type.Optional(Type.String()),
    model: Type.Optional(Type.String()),
  }),
};

function readChildBudget(value: unknown) {
  const budget = value as Record<string, unknown> | undefined;
  if (
    !budget ||
    typeof budget !== "object" ||
    Array.isArray(budget) ||
    Object.keys(budget).some((key) => !["max_model_requests", "max_tool_calls"].includes(key)) ||
    !Number.isSafeInteger(budget.max_model_requests) ||
    Number(budget.max_model_requests) < 1 ||
    Number(budget.max_model_requests) > 128 ||
    !Number.isSafeInteger(budget.max_tool_calls) ||
    Number(budget.max_tool_calls) < 1 ||
    Number(budget.max_tool_calls) > 256
  )
    throw new Error(
      "Scheduled delegation requires an explicit bounded model/tool budget allocation",
    );
  return {
    version: 1 as const,
    maxModelRequests: Number(budget.max_model_requests),
    maxToolCalls: Number(budget.max_tool_calls),
  };
}

export function selectWorkerModel(
  host: WorkerHostInfo,
  args: Record<string, unknown>,
  current?: { customProviderId: string; model: string },
  requirements?: WorkerRequirements,
) {
  const providerId = typeof args.provider_id === "string" ? args.provider_id.trim() : "";
  const requestedModel = typeof args.model === "string" ? args.model.trim() : "";
  return selectWorkerModelBinding(
    host,
    { providerId, model: requestedModel, current },
    requirements,
  );
}

export function isBackgroundTaskReadOnly(call: ToolCall) {
  return (
    call.name === "WorkerDevices" ||
    (call.name === "BackgroundTask" &&
      ["get", "list", "operations", "children"].includes(
        String((call.arguments as Record<string, unknown>)?.action),
      ))
  );
}

export { backgroundRequestId } from "../automation/backgroundTaskIdentity";

export function createBackgroundTaskTools(options: {
  workdir: string;
  currentChatModel?: { customProviderId: string; model: string };
  requirePeer?: boolean;
  requestScope?: string;
  backgroundContext?: BackgroundTaskContext;
  backgroundLease?: BackgroundExecutionLease;
  schedulingEnabled?: boolean;
  getExecutionDeadline?: () => number | undefined;
  getSourceContext?: () => BackgroundSourceContext | undefined;
}): BuiltinToolBundle {
  const sourceSnapshots = new Map<string, BackgroundSourceContext | undefined>();
  const parentLease = options.backgroundLease
    ? captureBackgroundLease(options.backgroundLease)
    : undefined;
  const discoverRoutes = async (
    requirements: WorkerRequirements,
    preferLocal: boolean,
    requiresSourceContext = false,
    modelSelection?: WorkerModelSelection,
  ) => {
    const [peers, local] = await Promise.allSettled([
      backend.listWorkerPeers(),
      options.requirePeer || options.backgroundContext
        ? Promise.resolve(null)
        : backend.getLocalWorkerHostInfo(),
    ]);
    if (peers.status === "rejected") throw peers.reason;
    return {
      ...rankWorkerRoutes(
        peers.value,
        local.status === "fulfilled" ? local.value : null,
        requirements,
        {
          excludedHostIds: options.backgroundContext?.hostIds,
          preferLocal,
          requiresSourceContext,
          requiresBudgetDelegation:
            !!options.backgroundContext && options.schedulingEnabled === true,
          modelSelection,
        },
      ),
      ...(local.status === "rejected" ? { localError: String(local.reason) } : {}),
    };
  };
  return {
    groupId: "system",
    tools: [backgroundTaskTool, workerDevicesTool],
    recoverToolCall: async (call) => {
      const binding = backgroundResumeBinding(call, options.requestScope);
      if (!binding) return null;
      const saved =
        options.backgroundContext && parentLease
          ? await backend.readBackgroundChildResumeReceipt(
              options.requestScope!,
              call.id,
              parentLease,
            )
          : await backend.readBackgroundResumeReceipt(binding.input, binding.peerId);
      if (!saved) return null;
      const accepted = verifyBackgroundResumeReceipt(saved, binding);
      const result = {
        peerId: binding.peerId,
        result: { status: "response_accepted", receipt: accepted },
      };
      return {
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        isError: false,
        timestamp: accepted.acceptedAt,
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: { kind: "background_task", action: "resume", reconciledResume: true, result },
      };
    },
    metadataByName: createBuiltinMetadataMap([
      [
        "BackgroundTask",
        {
          groupId: "system",
          kind: "system",
          isReadOnly: false,
          displayCategory: "system",
        },
      ],
      [
        "WorkerDevices",
        { groupId: "system", kind: "system", isReadOnly: true, displayCategory: "system" },
      ],
    ]),
    async executeToolCall(call: ToolCall, signal?: AbortSignal): Promise<ToolResultMessage> {
      const args = call.arguments as Record<string, unknown>;
      const requestId =
        typeof args?.request_id === "string"
          ? args.request_id.trim()
          : backgroundRequestId(call.id, options.requestScope);
      let peerId = typeof args?.peer_id === "string" ? args.peer_id.trim() : undefined;
      let localExecution = false;
      let result: unknown;
      let isError = false;
      let childSubmissionAttempted = false;
      try {
        signal?.throwIfAborted();
        if (args?.execution !== undefined && !["device", "model"].includes(String(args.execution)))
          throw new Error("Unknown background execution kind");
        if (args?.execution === "model" && args.action !== "submit")
          throw new Error("execution=model is only a child submission option");
        if (args?.prefer_local !== undefined && typeof args.prefer_local !== "boolean")
          throw new Error("prefer_local must be boolean");
        if (call.name === "WorkerDevices") {
          result =
            args?.requirements === undefined
              ? await backend.listWorkerPeers()
              : await discoverRoutes(
                  normalizeWorkerRequirements(args.requirements),
                  args.prefer_local !== false,
                  false,
                  {
                    providerId:
                      typeof args.provider_id === "string" ? args.provider_id.trim() : undefined,
                    model: typeof args.model === "string" ? args.model.trim() : undefined,
                    current: options.currentChatModel,
                  },
                );
        } else if (call.name !== "BackgroundTask") {
          throw new Error(`Unknown tool: ${call.name}`);
        } else
          switch (args?.action) {
            case "submit": {
              if (args.execution === "model") {
                const parent = options.backgroundContext;
                if (
                  !parent ||
                  options.schedulingEnabled !== true ||
                  !parentLease ||
                  !options.requestScope
                )
                  throw new Error(
                    "Persistent model children require an accepted scheduled parent and its captured lease",
                  );
                if (
                  ["peer_id", "request_id", "files", "goal_binding"].some(
                    (key) => args[key] !== undefined,
                  )
                )
                  throw new Error(
                    "Model children retain original local ownership and inherited inputs; omit peer_id, request_id, files and goal_binding",
                  );
                readChildBudget(args.delegation_budget);
                const host = await backend.getLocalWorkerHostInfo();
                if (!host || host.hostId !== parent.hostIds.at(-1))
                  throw new Error("Original native model execution host is unavailable");
                if (!host.acceptsBackgroundTasks || !host.executorReady)
                  throw new Error(
                    "Original native model executor is not ready in the accepted workspace",
                  );
                const requirements =
                  args.requirements === undefined
                    ? undefined
                    : normalizeWorkerRequirements(args.requirements);
                if (requirements) {
                  const failure = workerRequirementFailure(host, requirements);
                  if (failure) throw new Error(failure);
                }
                const selected = selectWorkerModel(
                  host,
                  args,
                  options.currentChatModel,
                  requirements,
                );
                signal?.throwIfAborted();
                peerId = host.hostId;
                childSubmissionAttempted = true;
                result = await backend.submitBackgroundModelTask(
                  options.requestScope,
                  call.id,
                  parentLease,
                  selected.providerId,
                  selected.model,
                );
                const accepted = result as {
                  requestId?: string;
                  hostId?: string;
                  run?: { id?: string; state?: string };
                };
                if (
                  accepted.requestId !== requestId ||
                  accepted.hostId !== peerId ||
                  !accepted.run?.id ||
                  !accepted.run.state
                )
                  throw new Error(
                    "Original native model child acceptance is unconfirmed; recover its original child receipt",
                  );
                break;
              }
              const goalBinding =
                args.goal_binding === undefined
                  ? undefined
                  : readBackgroundGoalBinding(args.goal_binding);
              if (!sourceSnapshots.has(requestId)) {
                if (options.getSourceContext && sourceSnapshots.size >= 128)
                  throw new Error("Source snapshot capacity reached; recover existing submissions");
                const source = options.getSourceContext?.();
                if (source) validateBackgroundSourceContext(source);
                if (options.getSourceContext)
                  sourceSnapshots.set(
                    requestId,
                    source
                      ? options.backgroundContext
                        ? captureDelegatedBackgroundSourceContext(
                            source,
                            requestId,
                            typeof args.prompt === "string" ? args.prompt : "",
                          )
                        : JSON.parse(JSON.stringify(source))
                      : undefined,
                  );
              }
              const sourceContext = sourceSnapshots.get(requestId);
              const boundPeer = await backend.resolveBackgroundPeer(requestId);
              if (boundPeer && peerId && boundPeer !== peerId)
                throw new Error(
                  "This request is bound to another worker; query its original receipt",
                );
              peerId ||= boundPeer ?? undefined;
              const parent = options.backgroundContext;
              const requestedBudget = args.delegation_budget;
              const scheduledChild = Boolean(parent && options.schedulingEnabled === true);
              if (requestedBudget !== undefined && !scheduledChild)
                throw new Error(
                  "delegation_budget requires this accepted background parent's enabled scheduling",
                );
              let childBudget:
                | {
                    version: 1;
                    maxModelRequests: number;
                    maxToolCalls: number;
                    deadlineAt?: number;
                  }
                | undefined;
              if (scheduledChild) {
                childBudget = readChildBudget(requestedBudget);
                const deadlineAt = options.getExecutionDeadline?.();
                if (deadlineAt !== undefined) {
                  if (!Number.isSafeInteger(deadlineAt) || deadlineAt <= Date.now())
                    throw new Error(
                      "Original execution deadline reached or invalid; no child sent",
                    );
                  childBudget.deadlineAt = deadlineAt;
                }
              }
              const requirements =
                args.requirements === undefined
                  ? undefined
                  : normalizeWorkerRequirements(args.requirements);
              if (parent && !parentLease)
                throw new Error(
                  "Background delegation requires its captured parent execution lease",
                );
              if (parent && parent.hostIds.length >= MAX_BACKGROUND_HOSTS)
                throw new Error("Background delegation chain has reached its host limit");
              if (requirements && !parent) {
                const saved = await backend.getBackgroundSubmissionState(requestId);
                if (saved) {
                  if (saved.cancelRequested)
                    throw new Error(
                      "This saved request has a persisted cancellation; recover it rather than submit again",
                    );
                  if (peerId && (saved.localExecution || saved.sourceHostId !== peerId))
                    throw new Error("This request belongs to its original saved execution host");
                  localExecution = saved.localExecution;
                  peerId = localExecution ? undefined : saved.sourceHostId;
                }
              }
              let routedHost: WorkerHostInfo | undefined;
              if (requirements && !peerId && !localExecution) {
                const routes = await discoverRoutes(
                  requirements,
                  args.prefer_local !== false,
                  !!sourceContext,
                  {
                    providerId:
                      typeof args.provider_id === "string" ? args.provider_id.trim() : undefined,
                    model: typeof args.model === "string" ? args.model.trim() : undefined,
                    current: options.currentChatModel,
                  },
                );
                signal?.throwIfAborted();
                if (!routes.selected)
                  throw new Error(
                    `No eligible worker for required capabilities: ${routes.rejected.map((item) => `${item.hostId}: ${item.reason}`).join("; ")}`,
                  );
                routedHost = routes.selected.host;
                peerId = routes.selected.peerId ?? undefined;
                localExecution = routes.selected.local;
              }
              if (parent) {
                if (!peerId)
                  throw new Error("A background task must select another worker for delegation");
                if (parent.hostIds.includes(peerId))
                  throw new Error("Background delegation cycle: target is an ancestor host");
                if (parent.hostIds.length >= MAX_BACKGROUND_HOSTS)
                  throw new Error("Background delegation chain has reached its host limit");
              }
              if (!peerId && options.requirePeer)
                throw new Error(
                  "Mobile background execution requires a paired worker from WorkerDevices",
                );
              let model = options.currentChatModel && {
                providerId: options.currentChatModel.customProviderId,
                model: options.currentChatModel.model,
              };
              let workdir = options.workdir;
              let inputSnapshotVersion: number | undefined;
              let sourceContextVersion: number | undefined;
              let goalAcceptanceVersion: number | undefined;
              if (localExecution && requirements) {
                const local = routedHost ?? (await backend.getLocalWorkerHostInfo());
                if (!local) throw new Error("Original local execution host is unavailable");
                const failure = workerRequirementFailure(local, requirements);
                if (failure) throw new Error(failure);
                model = selectWorkerModel(local, args, options.currentChatModel, requirements);
                workdir = local.workdir;
                inputSnapshotVersion = local.inputSnapshotVersion;
                sourceContextVersion = local.sourceContextVersion;
                goalAcceptanceVersion = local.goalAcceptanceVersion;
              }
              if (peerId) {
                const host = await backend.probeWorkerPeer(peerId);
                if (childBudget?.deadlineAt !== undefined && host.budgetDeadlineVersion !== 1)
                  throw new Error(
                    "This worker cannot enforce the original task deadline; no child sent",
                  );
                if (
                  childBudget &&
                  (host.budgetDelegationVersion !== 1 || host.intelligentSchedulingVersion !== 1)
                )
                  throw new Error(
                    "This worker cannot enforce a delegated lifetime budget; no child sent",
                  );
                if (parent && host.delegationVersion !== 1)
                  throw new Error(
                    "This worker does not enforce delegation chains; update it before delegating",
                  );
                if (parent && host.childTasksVersion !== 1)
                  throw new Error(
                    "This worker does not support persistent child joins and cascading stops; update it before delegating",
                  );
                inputSnapshotVersion = host.inputSnapshotVersion;
                sourceContextVersion = host.sourceContextVersion;
                signal?.throwIfAborted();
                if (host.hostId !== peerId)
                  throw new Error("Worker identity does not match the selected peer");
                if (!host.acceptsBackgroundTasks || !host.executorReady)
                  throw new Error(
                    "The selected worker is not ready or does not authorize background tasks",
                  );
                if (!host.workspaceAvailable || !host.workdir.trim())
                  throw new Error("The selected worker workspace is unavailable");
                if (requirements) {
                  const failure = workerRequirementFailure(host, requirements);
                  if (failure) throw new Error(failure);
                }
                model = selectWorkerModel(host, args, options.currentChatModel, requirements);
                goalAcceptanceVersion = host.goalAcceptanceVersion;
                workdir = host.workdir;
              }
              if (!model) throw new Error("A model configured on the execution host is required");
              if (sourceContext) {
                if (!peerId && sourceContextVersion === undefined) {
                  const host = localExecution
                    ? await backend.getLocalWorkerHostInfo()
                    : await backend.getBackgroundHostInfo();
                  sourceContextVersion = host?.sourceContextVersion;
                }
                if (
                  ![1, 2].includes(sourceContextVersion ?? 0) ||
                  (sourceContextVersion ?? 0) < sourceContext.version
                )
                  throw new Error(
                    "Worker does not support immutable source conversations; update it before submitting. No task was sent",
                  );
              }
              if (goalBinding) {
                if (!peerId && goalAcceptanceVersion === undefined) {
                  const host = localExecution
                    ? await backend.getLocalWorkerHostInfo()
                    : await backend.getBackgroundHostInfo();
                  goalAcceptanceVersion = host?.goalAcceptanceVersion;
                }
                if (goalAcceptanceVersion !== 1)
                  throw new Error(
                    "Worker does not support atomic goal acceptance; no task was sent",
                  );
              }
              const input = {
                requestId,
                name: typeof args.name === "string" ? args.name : "",
                prompt: typeof args.prompt === "string" ? args.prompt : "",
                providerId: model.providerId,
                model: model.model,
                workdir,
                timeoutSeconds:
                  typeof args.timeout_seconds === "number" ? args.timeout_seconds : 300,
                reasoning: "medium",
                ...(childBudget ? { intelligentSchedulingEnabled: true } : {}),
                ...(goalBinding ? { goalBinding } : {}),
                ...(requirements ? { requirements } : {}),
                ...(sourceContext ? { sourceContext } : {}),
                ...(parent
                  ? {
                      delegation: {
                        rootRequestId: parent.rootRequestId,
                        parentRequestId: parent.requestId,
                        ancestorHostIds: [...parent.hostIds],
                        ...(childBudget ? { budget: childBudget } : {}),
                      },
                    }
                  : {}),
              };
              if (args.files !== undefined && (!Array.isArray(args.files) || args.files.length > 8))
                throw new Error("files must be an array of at most 8 local input paths");
              if (Array.isArray(args.files) && args.files.length > 0) {
                if (!peerId && inputSnapshotVersion === undefined)
                  inputSnapshotVersion = (await backend.getBackgroundHostInfo())
                    .inputSnapshotVersion;
                if (inputSnapshotVersion !== 1)
                  throw new Error(
                    "This worker does not support durable input snapshots; update it before sending files",
                  );
              }
              const localHost = getLanPcCommandHostConfig();
              const localWorkdir =
                localHost.enabled && localHost.localWorkdir
                  ? localHost.localWorkdir
                  : options.workdir;
              const files =
                args.files === undefined || (Array.isArray(args.files) && args.files.length === 0)
                  ? []
                  : await snapshotBackgroundInputs(
                      args.files as { path: string; name?: string }[],
                      localWorkdir,
                      signal,
                    );
              signal?.throwIfAborted();
              const submissionArgs = [
                files.length ? { ...input, files } : input,
                peerId,
                parentLease,
                options.requestScope ? { requestScope: options.requestScope } : undefined,
                localExecution,
              ] as const;
              childSubmissionAttempted = !!parent;
              result = parent
                ? await backend.submitBackgroundTask(...submissionArgs, call.id)
                : await backend.submitBackgroundTask(...submissionArgs);
              if (goalBinding) {
                const receipt = result as { requestId?: string; goalBinding?: unknown };
                let accepted: ReturnType<typeof readBackgroundGoalBinding>;
                try {
                  accepted = readBackgroundGoalBinding(receipt?.goalBinding);
                } catch {
                  throw new Error(
                    "Goal association is unconfirmed; inspect the original accepted request without submitting replacement work",
                  );
                }
                if (
                  receipt.requestId !== requestId ||
                  accepted.goalId !== goalBinding.goalId ||
                  accepted.storeId !== goalBinding.storeId ||
                  accepted.revision !== goalBinding.revision
                )
                  throw new Error(
                    "Goal association is unconfirmed; inspect the original accepted request without submitting replacement work",
                  );
              }
              break;
            }
            case "children": {
              if (typeof args.request_id !== "string" || !args.request_id.trim())
                throw new Error("Parent request_id from its receipt is required");
              if (
                args.child_call_id !== undefined &&
                (typeof args.child_call_id !== "string" ||
                  !args.child_call_id ||
                  args.child_call_id.length > 256)
              )
                throw new Error("child_call_id must be an actual bounded call ID");
              const offset = args.offset ?? 0;
              if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0)
                throw new Error("Child snapshot offset must be a non-negative safe integer");
              if (
                args.snapshot_hash !== undefined &&
                (typeof args.snapshot_hash !== "string" ||
                  !/^[a-f0-9]{64}$/.test(args.snapshot_hash))
              )
                throw new Error("snapshot_hash must be the observed SHA-256");
              if (offset > 0 && (!args.child_call_id || !args.snapshot_hash))
                throw new Error(
                  "Later child chunks require actual child_call_id and snapshot_hash",
                );
              result = await backend.readBackgroundChildren(
                requestId,
                peerId,
                args.child_call_id as string | undefined,
                offset,
                args.snapshot_hash as string | undefined,
              );
              break;
            }
            case "get":
            case "cancel":
              if (typeof args.request_id !== "string" || !args.request_id.trim())
                throw new Error("request_id from the receipt is required");
              result =
                args.action === "get"
                  ? peerId
                    ? await backend.getBackgroundTask(requestId, peerId)
                    : await backend.getBackgroundTask(requestId)
                  : peerId
                    ? await backend.cancelBackgroundTask(requestId, peerId)
                    : await backend.cancelBackgroundTask(requestId);
              break;
            case "resume": {
              if (
                typeof args.request_id !== "string" ||
                !args.request_id.trim() ||
                typeof args.wait_id !== "string" ||
                !args.wait_id ||
                typeof args.response !== "string" ||
                !args.response.trim()
              )
                throw new Error(
                  "resume requires request_id, current wait_id and the actual response",
                );
              const input = {
                requestId,
                waitId: args.wait_id,
                resumeId: backgroundRequestId(call.id, options.requestScope),
                response: args.response,
              };
              if (options.backgroundContext && parentLease) {
                const binding = backgroundResumeBinding(call, options.requestScope);
                if (!binding)
                  throw new Error(
                    "An outgoing child response requires its exact original peer and scoped IDs",
                  );
                const saved = await backend.resumeBackgroundChild(
                  options.requestScope!,
                  call.id,
                  input,
                  binding.peerId,
                  parentLease,
                );
                result = {
                  status: "response_accepted",
                  receipt: verifyBackgroundResumeReceipt(saved, binding),
                };
              } else
                result = await backend.resumeBackgroundTask(
                  {
                    requestId,
                    waitId: args.wait_id,
                    resumeId: backgroundRequestId(call.id, options.requestScope),
                    response: args.response,
                  },
                  peerId,
                );
              break;
            }
            case "list":
              result = await backend.listBackgroundTasks(
                typeof args.limit === "number" ? args.limit : 50,
                peerId,
              );
              break;
            case "operations":
              if (typeof args.request_id !== "string" || !args.request_id.trim())
                throw new Error("request_id from the receipt is required");
              {
                const params: [string, number, number, string?] = [
                  requestId,
                  typeof args.cursor === "number" ? args.cursor : 0,
                  typeof args.limit === "number" ? args.limit : 10,
                ];
                if (peerId) params.push(peerId);
                result = await backend.listBackgroundOperations(...params);
              }
              break;
            case "download": {
              if (!args.request_id || typeof args.artifact_id !== "string" || !args.artifact_id)
                throw new Error("request_id and artifact_id from the receipt are required");
              const { artifact, contentBase64 } = await backend.readBackgroundArtifact(
                requestId,
                args.artifact_id,
                peerId,
              );
              signal?.throwIfAborted();
              if (contentBase64.length > Math.ceil((8 * 1024 * 1024) / 3) * 4)
                throw new Error("Artifact exceeds 8 MiB");
              const bytes = Uint8Array.from(atob(contentBase64), (char) => char.charCodeAt(0));
              if (bytes.length !== artifact.bytes || sha256Hex(bytes) !== artifact.contentHash)
                throw new Error("Artifact failed integrity verification");
              if (isTauriRuntime()) {
                const host = getLanPcCommandHostConfig();
                const workdir =
                  host.enabled && host.localWorkdir ? host.localWorkdir : options.workdir;
                const path =
                  typeof args.path === "string"
                    ? args.path
                    : `background-results/${requestId}/${artifact.relativePath}`;
                // Deliberately local: the normal runtime invoke would send fs_* back to the PC.
                result = await invokeNative("fs_create_binary", {
                  workdir,
                  path,
                  content_base64: contentBase64,
                  expected_content_hash: artifact.contentHash,
                });
              } else {
                const url = URL.createObjectURL(
                  new Blob([bytes], { type: "application/octet-stream" }),
                );
                const link = document.createElement("a");
                link.href = url;
                link.download = artifact.relativePath.split("/").pop() || artifact.id;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 60_000);
                result = { status: "download_requested", artifact };
              }
              break;
            }
            default:
              throw new Error("Unknown BackgroundTask action");
          }
        if (peerId) result = { peerId, result };
      } catch (error) {
        isError = true;
        result = {
          requestId,
          ...(peerId ? { peerId } : {}),
          error: error instanceof Error ? error.message : String(error),
          instruction:
            "If submission delivery was uncertain, query this requestId before submitting again.",
        };
      }
      return {
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: {
          kind: "background_task",
          result,
          ...(isError && childSubmissionAttempted ? { outcomeUncertain: true } : {}),
        },
        isError,
        timestamp: Date.now(),
      };
    },
  };
}

/** Available only inside an accepted background execution, pinned in code. */
export function createBackgroundArtifactTools(
  executionId: string,
  executionLease?: BackgroundExecutionLease,
  originalDevicePlanning = false,
): BuiltinToolBundle {
  const lease = captureBackgroundLease(executionLease);
  const outcomes = createBackgroundOutcomeTools(executionId, lease);
  const originalDevice = originalDevicePlanning
    ? createOriginalDeviceTaskTools(executionId, lease)
    : undefined;
  const importTool: Tool = {
    name: "ImportBackgroundChildArtifact",
    description:
      "Retain an actual child's published deliverable in this parent task's immutable results, so the initiating client can retrieve it from the parent after reconnect without the child device remaining online. Read this parent's children snapshot first; supply the original submit call ID and an artifact ID from that observed manifest. Optional path names the parent result to match a saved artifact criterion; it must be a portable relative path and creates no workspace file. Otherwise the result uses child-results/<childRequestId>/<source path>. Native code pins the accepted host/request, verifies actual bytes against the observed length/SHA-256, and commits provenance, content and this operation receipt together. Repeated imports reuse the same artifact and cannot rename it. This does not prove semantic correctness, change child state or grant connector permissions. Limits: 512 MiB/file, 32 files/1 GiB per parent. Large imports require the updated child chunk protocol. Inspect and verify deliverables before marking requirements complete.",
    parameters: Type.Object(
      {
        child_call_id: Type.String({ minLength: 1, maxLength: 256 }),
        artifact_id: Type.String({ minLength: 1, maxLength: 180 }),
        path: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
      },
      { additionalProperties: false },
    ),
  };
  const tool: Tool = {
    name: "PublishBackgroundArtifact",
    description:
      "Publish an actual deliverable file from this task's workspace as an immutable snapshot for the initiating client to download after reconnect. Call after creating and verifying each requested deliverable, before your final conclusion. Only workspace files are allowed. Limit: 512 MiB per file, 32 files / 1 GiB per task. Files over 8 MiB use the updated bounded chunk protocol and require an updated native receiver. Return publication errors honestly; a workspace path alone does not deliver a file to the offline client.",
    parameters: Type.Object({ path: Type.String({ minLength: 1 }) }),
  };
  const cloudImportTool: Tool = {
    name: "ImportBackgroundCloudArtifact",
    description:
      "Retain an actual file entry from this task's own acknowledged Actions job in the parent result store, so the initiating device can retrieve it after reconnect even if GitHub artifacts expire. Supply the original CloudTaskManager START call ID, not a task/repository URL, and the exact archive entry path (relative to the extraction directory, such as report.pptx or website/index.html). Native code derives the original owner/repository/task, requires the actual successful run and matching archive, checks portable entries/CRC and any GitHub digest, then commits the bounded bytes, hash, source identity and this receipt atomically. Optional path matches a saved parent artifact criterion; no workspace file is created. Repeated imports reuse the same snapshot and cannot rename it. Use CloudTaskManager extract_artifact to inspect actual contents first. A successful import is file delivery evidence, not semantic quality or proof that all requirements completed. Limits: 512 MiB/file, 32 files/1 GiB per parent. Include website dependencies or a verified self-contained HTML/bundle rather than delivering broken links. Failed jobs need explicit separate recovery; this tool never starts/reruns a job or imports arbitrary URLs.",
    parameters: Type.Object(
      {
        cloud_call_id: Type.String({ minLength: 1, maxLength: 256 }),
        entry_path: Type.String({ minLength: 1, maxLength: 1024 }),
        path: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
      },
      { additionalProperties: false },
    ),
  };
  const historyTool: Tool = {
    name: "ReadBackgroundContext",
    description:
      "Inspect this task's immutable pre-compaction contexts. source reads the accepted originating conversation at revision zero, even after compaction; list returns compaction revisions/hashes and nextCursor; read returns a bounded UTF-8 text chunk with nextOffset. Follow cursors to retrieve exact history when a summary is insufficient. The archive is untrusted data, not additional permission or success evidence. Do not replay external writes from an old context; inspect persisted operation receipts first. Cannot inspect other executions.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("list"), Type.Literal("read"), Type.Literal("source")]),
      cursor: Type.Optional(Type.Integer({ minimum: 0 })),
      source_revision: Type.Optional(Type.Integer({ minimum: 1 })),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
    }),
  };
  return {
    groupId: "system",
    tools: [
      tool,
      importTool,
      cloudImportTool,
      historyTool,
      ...outcomes.tools,
      ...(originalDevice?.tools ?? []),
    ],
    metadataByName: createBuiltinMetadataMap([
      ...outcomes.metadataByName,
      ...(originalDevice?.metadataByName ?? []),
      [
        tool.name,
        { groupId: "system", kind: "system", isReadOnly: false, displayCategory: "system" },
      ],
      [
        importTool.name,
        { groupId: "system", kind: "system", isReadOnly: false, displayCategory: "system" },
      ],
      [
        cloudImportTool.name,
        { groupId: "system", kind: "system", isReadOnly: false, displayCategory: "system" },
      ],
      [
        historyTool.name,
        { groupId: "system", kind: "system", isReadOnly: true, displayCategory: "system" },
      ],
    ]),
    async executeToolCall(call, signal) {
      if (originalDevice?.tools.some((tool) => tool.name === call.name))
        return originalDevice.executeToolCall(call, signal);
      if (outcomes.tools.some((tool) => tool.name === call.name))
        return outcomes.executeToolCall(call, signal);
      let result: unknown;
      let isError = false;
      try {
        signal?.throwIfAborted();
        if (call.name === cloudImportTool.name) {
          const args = call.arguments as Record<string, unknown>;
          if (
            !args ||
            Array.isArray(args) ||
            Object.keys(args).some(
              (key) => !["cloud_call_id", "entry_path", "path"].includes(key),
            ) ||
            typeof args.cloud_call_id !== "string" ||
            !args.cloud_call_id ||
            args.cloud_call_id.length > 256 ||
            typeof args.entry_path !== "string" ||
            !args.entry_path ||
            args.entry_path.length > 1024 ||
            (args.path !== undefined &&
              (typeof args.path !== "string" || !args.path || args.path.length > 4096))
          )
            throw new Error("Cloud import needs the original start call and exact archive entry");
          const receipt = await backend.importBackgroundCloudArtifact(
            executionId,
            call.id,
            args.cloud_call_id,
            lease,
          );
          if (
            receipt?.role !== "toolResult" ||
            receipt.toolCallId !== call.id ||
            receipt.toolName !== cloudImportTool.name
          )
            throw new Error("Native cloud import returned a mismatched operation receipt");
          return receipt;
        }
        if (call.name === importTool.name) {
          const args = call.arguments as Record<string, unknown>;
          if (
            !args ||
            Object.keys(args).some(
              (key) => !["child_call_id", "artifact_id", "path"].includes(key),
            ) ||
            typeof args.child_call_id !== "string" ||
            !args.child_call_id ||
            args.child_call_id.length > 256 ||
            typeof args.artifact_id !== "string" ||
            !args.artifact_id ||
            args.artifact_id.length > 180 ||
            (args.path !== undefined &&
              (typeof args.path !== "string" || !args.path || args.path.length > 4096))
          )
            throw new Error(
              "Child import requires the actual child call and published artifact IDs",
            );
          // Return the exact native receipt already committed with the bytes.
          // Do not regenerate timestamps or let cancellation replace success.
          const receipt = await backend.importBackgroundChildArtifact(
            executionId,
            call.id,
            args.child_call_id,
            args.artifact_id,
            lease,
          );
          if (
            receipt?.role !== "toolResult" ||
            receipt.toolCallId !== call.id ||
            receipt.toolName !== importTool.name
          )
            throw new Error("Native child import returned a mismatched operation receipt");
          return receipt;
        }
        if (call.name === historyTool.name) {
          const args = call.arguments as Record<string, unknown>;
          const integer = (value: unknown, fallback?: number) => {
            if (value === undefined && fallback !== undefined) return fallback;
            if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
              throw new Error("Archive cursors and revisions must be non-negative safe integers");
            return value;
          };
          if (args.action === "list")
            result = await backend.listBackgroundCompactions(
              executionId,
              integer(args.cursor, 0),
              lease,
            );
          else if (args.action === "read") {
            const revision = integer(args.source_revision);
            if (revision === 0) throw new Error("Archive source_revision must be positive");
            result = await backend.readBackgroundContextArchive(
              executionId,
              revision,
              integer(args.offset, 0),
              lease,
            );
          } else if (args.action === "source") {
            result = await backend.readBackgroundContextArchive(
              executionId,
              0,
              integer(args.offset, 0),
              lease,
            );
          } else throw new Error("Unknown background context action");
        } else {
          const path = (call.arguments as { path?: unknown })?.path;
          if (call.name !== tool.name || typeof path !== "string")
            throw new Error("Artifact publication requires a file path");
          result = await backend.publishBackgroundArtifact(executionId, path, undefined, lease);
        }
        signal?.throwIfAborted();
      } catch (error) {
        isError = true;
        result = { error: error instanceof Error ? error.message : String(error) };
      }
      return {
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: { kind: "background_artifact", result },
        isError,
        timestamp: Date.now(),
      };
    },
  };
}
