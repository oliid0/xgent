// Unified transport for the automation store. Native windows invoke Tauri
// directly; the paired WebUI uses the same command/event API through the
// authenticated local-access bridge.

import type { ToolResultMessage } from "@earendil-works/pi-ai";
import {
  getLanPcCommandHostConfig,
  invoke as invokeDefault,
  invokeNative,
  isTauriRuntime,
  listen as listenDefault,
} from "@xgent/runtime";
import type { XgentRuntime } from "../../runtime/types";
import { isNativeMobileRuntime } from "../runtimePlatform";
import type { AppSettings } from "../settings";
import type { ExecutionBudgetKind } from "../subagents/executionBudget";
import type { BackgroundBudgetAdmission, BackgroundBudgetSnapshot } from "./backgroundBudget";
import { captureBackgroundLease } from "./backgroundLease";
import type {
  DeviceBranchPlan,
  MobileBranchAuthorization,
  MobileBranchProposal,
  MobileBranchReview,
  MobileBranchState,
  MobilePlanningTicket,
  MobileReadAuthorization,
  MobileReadChoice,
  MobileReadChoices,
  MobileReadKind,
} from "./mobileBranchActions";

import type {
  AutomationApplyInput,
  AutomationSnapshot,
  BackgroundArtifact,
  BackgroundArtifactContent,
  BackgroundBranchEvidence,
  BackgroundCompactionPage,
  BackgroundContextArchiveChunk,
  BackgroundExecutionLease,
  BackgroundInboxChunk,
  BackgroundInboxPage,
  BackgroundInboxSync,
  BackgroundInputManifest,
  BackgroundOperationPage,
  BackgroundOutcomeReport,
  BackgroundResultResponse,
  BackgroundResumeCheckpoint,
  BackgroundResumeReceipt,
  BackgroundSourceContext,
  BackgroundSubmissionPage,
  BackgroundSubmissionState,
  BackgroundTaskPlan,
  BackgroundTaskRecord,
  BackgroundWaitingTask,
  BackgroundWaitRecord,
  BeginBackgroundOperationResponse,
  CompletePromptRunInput,
  CronApplyResponse,
  CronRunNowResponse,
  CronRunRecord,
  CronSnapshot,
  HooksApplyResponse,
  HooksSnapshot,
  PromptCompletionResponse,
  PromptRunRequest,
  ResumeBackgroundTaskInput,
  SubmitBackgroundTaskInput,
  WaitBackgroundTaskInput,
  WorkerHostInfo,
  WorkerPeerList,
} from "./types";

const CRON_CHANGED_EVENT = "automation:cron-changed";
const HOOKS_CHANGED_EVENT = "automation:hooks-changed";

async function invokeBackgroundUsing<T>(
  command: string,
  args: Record<string, unknown>,
  peerId?: string,
  invoke = invokeDefault,
): Promise<T> {
  let owner = peerId;
  const requestId =
    args.request_id ?? (args.input as SubmitBackgroundTaskInput | undefined)?.requestId;
  if (!owner && typeof requestId === "string" && isTauriRuntime()) {
    owner =
      (await invokeNative<string | null>("worker_peer_resolve_request", {
        request_id: requestId,
      })) ?? undefined;
  }
  if (owner) {
    if (!isTauriRuntime()) throw new Error("Selecting worker peers requires the native app");
    return invokeNative<T>("worker_peer_invoke", { peer_id: owner, command, args });
  }
  return invoke<T>(command, args);
}

export type AutomationBackendHandlers = {
  onCron: (snapshot: CronSnapshot) => void;
  onHooks: (snapshot: HooksSnapshot) => void;
};

export function createAutomationBackend(port?: Pick<XgentRuntime, "invoke" | "listen">) {
  const invoke = port?.invoke ?? invokeDefault;
  const listen = port?.listen ?? listenDefault;
  const invokeBackground = <T>(command: string, args: Record<string, unknown>, peerId?: string) =>
    invokeBackgroundUsing<T>(command, args, peerId, invoke);
  return {
    getNativeDeviceIdentity(): Promise<{ hostId: string }> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Device identity requires the native app"));
      return invokeNative("automation_device_identity");
    },
    listBackgroundSubmissions(cursor = 0, limit = 20): Promise<BackgroundSubmissionPage> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Submission records belong to the native device"));
      return invokeNative("automation_result_submission_list", { cursor, limit });
    },
    getBackgroundSubmissionState(requestId: string): Promise<BackgroundSubmissionState | null> {
      if (!isTauriRuntime()) return Promise.resolve(null);
      return invokeNative("automation_result_submission_state", { request_id: requestId });
    },
    readBackgroundChatContext(conversationId: string): Promise<unknown> {
      if (!isTauriRuntime()) return Promise.resolve(null);
      return invokeNative("automation_result_chat_context", { conversation_id: conversationId });
    },
    projectBackgroundChatResults(
      cursor = 0,
    ): Promise<{ changed: number; nextCursor: number | null }> {
      if (!isTauriRuntime()) return Promise.resolve({ changed: 0, nextCursor: null });
      return invokeNative("automation_result_chat_project", { cursor });
    },
    syncBackgroundInbox(): Promise<BackgroundInboxSync> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Durable result reception requires the native app"));
      return invokeNative("automation_result_sync");
    },
    listBackgroundInbox(cursor = 0, limit = 20, unreadOnly = false): Promise<BackgroundInboxPage> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("The result inbox belongs to the native device"));
      return invokeNative("automation_result_list", { cursor, limit, unread_only: unreadOnly });
    },
    readBackgroundInbox(entryId: string, offset = 0): Promise<BackgroundInboxChunk> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("The result inbox belongs to the native device"));
      return invokeNative("automation_result_read", { entry_id: entryId, offset });
    },
    notifyBackgroundInbox(
      entryId: string,
    ): Promise<"accepted" | "blocked" | "obsolete" | "unavailable"> {
      if (!isTauriRuntime() || !isNativeMobileRuntime()) return Promise.resolve("unavailable");
      return invokeNative("automation_result_notify", { entry_id: entryId });
    },
    acknowledgeBackgroundInbox(entryId: string): Promise<void> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("The result inbox belongs to the native device"));
      return invokeNative("automation_result_ack", { entry_id: entryId });
    },
    getReceivedBackgroundTask(entryId: string): Promise<BackgroundTaskRecord> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Received tasks belong to the native device"));
      return invokeNative("automation_result_current", { entry_id: entryId });
    },
    readReceivedChild(
      entryId: string,
      callId: string,
      offset = 0,
      snapshotHash?: string,
    ): Promise<import("./types").ReceivedChildChunk> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Received child observations belong to the native device"));
      return invokeNative("automation_result_child", {
        entry_id: entryId,
        call_id: callId,
        offset,
        snapshot_hash: snapshotHash,
      });
    },
    getReceivedDeviceBranches(entryId: string): Promise<{
      version: 1;
      planningVersion?: 1;
      requestId: string;
      hostId: string;
      initiatingHostId: string;
      executionId: string;
      state: string;
      branches: {
        source: NonNullable<BackgroundSourceContext["routing"]>["branches"][number];
        state: string;
        ready: boolean;
        reason: string | null;
      }[];
    }> {
      if (!isTauriRuntime())
        return Promise.reject(
          new Error("Original-device handoffs require the native installation"),
        );
      return invokeNative("automation_result_device_branches", { entry_id: entryId });
    },
    exchangeOriginalDevicePlanning(entryId: string, branchId: string): Promise<void> {
      if (!isTauriRuntime())
        return Promise.reject(
          new Error("Original-device planning requires the native installation"),
        );
      return invokeNative("automation_mobile_branch_planning_exchange", {
        entry_id: entryId,
        branch_id: branchId,
      });
    },
    planOriginalDevice(
      executionId: string,
      callId: string,
      lease: BackgroundExecutionLease,
    ): Promise<ToolResultMessage> {
      return invokeNative("automation_background_device_planning", {
        execution_id: executionId,
        call_id: callId,
        lease: captureBackgroundLease(lease),
      });
    },
    getMobileBranchContext(
      entryId: string,
      branchId: string,
    ): Promise<{
      prompt: string;
      sourceContext: BackgroundSourceContext;
      planning: MobilePlanningTicket;
    }> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Device branch context requires the native app"));
      return invokeNative("automation_mobile_branch_context", {
        entry_id: entryId,
        branch_id: branchId,
      });
    },
    listPendingMobileBranches(
      cursor = 0,
    ): Promise<{ items: { entryId: string; branchId: string }[]; nextCursor: number | null }> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Device action plans belong to the native app"));
      return invokeNative("automation_mobile_branch_pending", { cursor });
    },
    readMobileBranch(entryId: string, branchId: string): Promise<MobileBranchState> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Device action receipts require the native app"));
      return invokeNative("automation_mobile_branch_read", {
        entry_id: entryId,
        branch_id: branchId,
      });
    },
    inspectMobileBranches(entryId: string): Promise<MobileBranchReview> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Phone task review belongs to the native installation"));
      return invokeNative("automation_mobile_branch_inspect", { entry_id: entryId });
    },
    noteMobileBranchError(
      entryId: string,
      branchId: string,
      error: string | null,
      planning: MobilePlanningTicket | null,
    ): Promise<void> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Phone task diagnostics require the native app"));
      return invokeNative("automation_mobile_branch_error", {
        entry_id: entryId,
        branch_id: branchId,
        error,
        planning,
      });
    },
    retryMobileBranchPlanning(
      entryId: string,
      branchId: string,
      expectedRecovery: number,
    ): Promise<void> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Phone planning recovery requires the native app"));
      return invokeNative("automation_mobile_branch_retry", {
        entry_id: entryId,
        branch_id: branchId,
        expected_recovery: expectedRecovery,
      });
    },
    getMobileBranchAuthorization(
      entryId: string,
      branchId: string,
    ): Promise<MobileBranchAuthorization | null> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Task approval belongs to the native phone"));
      return invokeNative("automation_mobile_branch_authorization", {
        entry_id: entryId,
        branch_id: branchId,
      });
    },
    decideMobileBranchAuthorization(
      entryId: string,
      branchId: string,
      expectedHash: string,
      expectedRevision: number,
      approve: boolean,
    ): Promise<void> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Task approval requires the native client review"));
      return invokeNative("automation_mobile_branch_decide", {
        entry_id: entryId,
        branch_id: branchId,
        expected_hash: expectedHash,
        expected_revision: expectedRevision,
        approve,
      });
    },
    getMobileBranchReadAuthorization(
      entryId: string,
      branchId: string,
    ): Promise<MobileReadAuthorization> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Task read authority belongs to the native phone"));
      return invokeNative("automation_mobile_branch_read_authorization", {
        entry_id: entryId,
        branch_id: branchId,
      });
    },
    getMobileBranchReadChoices(
      entryId: string,
      branchId: string,
      kind: MobileReadKind,
    ): Promise<MobileReadChoices> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Account discovery requires the native client review"));
      return invokeNative("automation_mobile_branch_read_choices", {
        entry_id: entryId,
        branch_id: branchId,
        kind,
      });
    },
    decideMobileBranchReadAuthorization(
      entryId: string,
      branchId: string,
      expectedHash: string,
      expectedRevision: number,
      selections: MobileReadChoice[],
      approve: boolean,
    ): Promise<void> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Task read approval requires the native client review"));
      return invokeNative("automation_mobile_branch_read_decide", {
        entry_id: entryId,
        branch_id: branchId,
        expected_hash: expectedHash,
        expected_revision: expectedRevision,
        selections,
        approve,
      });
    },
    readMobileBranchData(
      entryId: string,
      branchId: string,
      action: string,
      request: Record<string, unknown>,
    ): Promise<unknown> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Task calendar reads require the original native phone"));
      return invokeNative("automation_mobile_branch_read_data", {
        entry_id: entryId,
        branch_id: branchId,
        action,
        request,
      });
    },
    prepareMobileBranch(
      entryId: string,
      branchId: string,
      actions: MobileBranchProposal[],
    ): Promise<DeviceBranchPlan> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Device actions require native acceptance"));
      return invokeNative("automation_mobile_branch_prepare", {
        entry_id: entryId,
        branch_id: branchId,
        actions,
      });
    },
    executeMobileBranchAction(
      entryId: string,
      branchId: string,
      index: number,
      request: Record<string, unknown>,
    ): Promise<import("../connectors/durableMobileWrites").MobileConnectorWriteRecord> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Device actions require the native app"));
      return invokeNative("automation_mobile_branch_execute", {
        entry_id: entryId,
        branch_id: branchId,
        index,
        request,
      });
    },
    completeMobileBranch(entryId: string, branchId: string): Promise<unknown> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Only native device receipts can complete a branch"));
      return invokeNative("automation_mobile_branch_complete", {
        entry_id: entryId,
        branch_id: branchId,
      });
    },
    resumeReceivedBackgroundTask(entryId: string, response: string): Promise<BackgroundTaskRecord> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Received tasks belong to the native device"));
      return invokeNative("automation_result_resume", { entry_id: entryId, response });
    },
    getReceivedResponseState(entryId: string): Promise<BackgroundResultResponse | null> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Received tasks belong to the native device"));
      return invokeNative("automation_result_response_state", { entry_id: entryId });
    },
    readReceivedBackgroundArtifact(
      entryId: string,
      artifactId: string,
    ): Promise<BackgroundArtifactContent> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Received artifacts belong to the native device"));
      return invokeNative("automation_result_artifact", {
        entry_id: entryId,
        artifact_id: artifactId,
      });
    },
    waitBackgroundTask(input: WaitBackgroundTaskInput): Promise<BackgroundWaitRecord | null> {
      return invokeNative("automation_background_wait", { input });
    },
    dueBackgroundWaits(): Promise<BackgroundWaitingTask[]> {
      return invokeNative("automation_background_due_waits");
    },
    deferBackgroundWait(executionId: string, waitId: string): Promise<void> {
      return invokeNative("automation_background_defer_wait", {
        execution_id: executionId,
        wait_id: waitId,
      });
    },
    loadWaitingExecutionSettings(
      executionId: string,
      waitId: string,
    ): Promise<{
      providerId: string;
      model: string;
      providers: AppSettings["customProviders"];
      system: AppSettings["system"];
      mcp: AppSettings["mcp"];
      access: AppSettings["access"];
    }> {
      return invokeNative("automation_background_waiting_settings", {
        execution_id: executionId,
        wait_id: waitId,
      });
    },
    wakeReadyBackgroundTask(
      executionId: string,
      waitId: string,
      tools: string[],
    ): Promise<boolean> {
      return invokeNative("automation_background_wake_ready", {
        execution_id: executionId,
        wait_id: waitId,
        tools,
      });
    },
    probeBackgroundCloudWait(
      executionId: string,
      waitId: string,
      callId: string,
    ): Promise<boolean> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Cloud wait discovery requires the native worker"));
      return invokeNative("automation_background_cloud_probe", {
        execution_id: executionId,
        wait_id: waitId,
        call_id: callId,
      });
    },
    recordBackgroundCloudWait(
      executionId: string,
      branchId: string,
      callId: string,
      reason: string,
      lease: BackgroundExecutionLease,
    ): Promise<BackgroundOutcomeReport> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Cloud wait binding requires the native worker"));
      return invokeNative("automation_background_cloud_wait", {
        execution_id: executionId,
        branch_id: branchId,
        call_id: callId,
        reason,
        lease,
      });
    },
    recordBackgroundVideoWait(
      executionId: string,
      branchId: string,
      callId: string,
      reason: string,
      lease: BackgroundExecutionLease,
    ): Promise<BackgroundOutcomeReport> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Video waits require the original native worker"));
      return invokeNative("automation_video_wait", {
        execution_id: executionId,
        branch_id: branchId,
        call_id: callId,
        reason,
        lease,
      });
    },
    resumeBackgroundTask(
      input: ResumeBackgroundTaskInput,
      peerId?: string,
    ): Promise<BackgroundTaskRecord> {
      return invokeBackground(
        "automation_background_resume",
        { request_id: input.requestId, input },
        peerId,
      );
    },
    readBackgroundResumeReceipt(
      input: ResumeBackgroundTaskInput,
      peerId: string,
    ): Promise<BackgroundResumeReceipt | null> {
      return invokeBackground(
        "automation_background_resume_receipt",
        { request_id: input.requestId, input: { ...input } },
        peerId,
      );
    },
    resumeBackgroundChild(
      executionId: string,
      callId: string,
      input: ResumeBackgroundTaskInput,
      peerId: string,
      lease: BackgroundExecutionLease,
    ): Promise<BackgroundResumeReceipt> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Child responses require the native worker"));
      return invokeNative("automation_background_child_resume", {
        execution_id: executionId,
        call_id: callId,
        input: { ...input },
        peer_id: peerId,
        lease: captureBackgroundLease(lease),
      });
    },
    readBackgroundChildResumeReceipt(
      executionId: string,
      callId: string,
      lease: BackgroundExecutionLease,
    ): Promise<BackgroundResumeReceipt | null> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Child response receipts require the native worker"));
      return invokeNative("automation_background_child_resume_receipt", {
        execution_id: executionId,
        call_id: callId,
        lease: captureBackgroundLease(lease),
      });
    },
    readBackgroundOutcomes(
      executionId: string,
      lease?: BackgroundExecutionLease,
    ): Promise<BackgroundOutcomeReport | null> {
      return invokeNative("automation_background_outcomes", { execution_id: executionId, lease });
    },
    readBackgroundEvidenceOptions(
      executionId: string,
      cursor = 0,
      lease?: BackgroundExecutionLease,
    ): Promise<{
      receipts: {
        sequence: number;
        callId: string;
        toolName: string;
        state: string;
        isError: boolean;
      }[];
      nextCursor: number | null;
      artifacts: BackgroundArtifact[];
    }> {
      return invokeNative("automation_background_evidence_options", {
        execution_id: executionId,
        cursor,
        lease,
      });
    },
    saveBackgroundPlan(
      executionId: string,
      plan: BackgroundTaskPlan,
      lease?: BackgroundExecutionLease,
    ): Promise<BackgroundOutcomeReport> {
      return invokeNative("automation_background_save_plan", {
        input: { executionId, plan, lease },
      });
    },
    resolveBackgroundPlan(
      executionId: string,
      plan: BackgroundTaskPlan,
      tools: string[],
      lease: BackgroundExecutionLease,
    ): Promise<BackgroundOutcomeReport> {
      return invokeNative("automation_background_resolve_plan", {
        input: { executionId, plan, lease },
        tools,
      });
    },
    recordBackgroundOutcome(
      executionId: string,
      branchId: string,
      evidence: BackgroundBranchEvidence | null,
      waitingReason: string | null,
      lease?: BackgroundExecutionLease,
      waitingTool?: string,
      waitingInventory?: boolean,
    ): Promise<BackgroundOutcomeReport> {
      return invokeNative("automation_background_record_outcome", {
        input: {
          executionId,
          branchId,
          evidence,
          waitingReason,
          lease,
          waitingTool,
          waitingInventory,
        },
      });
    },
    restoreBackgroundCheckpoint(
      executionId: string,
      lease?: BackgroundExecutionLease,
    ): Promise<BackgroundResumeCheckpoint> {
      return invokeNative("automation_background_restore_checkpoint", {
        execution_id: executionId,
        lease,
      });
    },
    readBackgroundBudget(
      executionId: string,
      lease: BackgroundExecutionLease,
    ): Promise<BackgroundBudgetSnapshot> {
      return invokeNative("automation_background_budget", { execution_id: executionId, lease });
    },
    consumeBackgroundBudget(
      executionId: string,
      lease: BackgroundExecutionLease,
      kind: ExecutionBudgetKind,
    ): Promise<BackgroundBudgetAdmission> {
      return invokeNative("automation_background_budget_consume", {
        execution_id: executionId,
        lease,
        kind,
      });
    },
    compactBackgroundContext(
      executionId: string,
      sourceRevision: number,
      context: unknown,
      summary: unknown,
      lease?: BackgroundExecutionLease,
    ): Promise<number> {
      return invokeNative("automation_background_compact_context", {
        input: { executionId, sourceRevision, context, summary, lease },
      });
    },
    listBackgroundCompactions(
      executionId: string,
      cursor = 0,
      lease?: BackgroundExecutionLease,
    ): Promise<BackgroundCompactionPage> {
      return invokeNative("automation_background_compactions", {
        execution_id: executionId,
        cursor,
        lease,
      });
    },
    readBackgroundContextArchive(
      executionId: string,
      sourceRevision: number,
      offset = 0,
      lease?: BackgroundExecutionLease,
    ): Promise<BackgroundContextArchiveChunk> {
      return invokeNative("automation_background_read_context_archive", {
        execution_id: executionId,
        lease,
        source_revision: sourceRevision,
        offset,
      });
    },
    loadBackgroundSourceContext(
      executionId: string,
      lease?: BackgroundExecutionLease,
    ): Promise<BackgroundSourceContext | null> {
      return invokeNative("automation_background_source_context", {
        execution_id: executionId,
        lease,
      });
    },
    loadBackgroundExecutionSettings(
      executionId: string,
      lease?: BackgroundExecutionLease,
    ): Promise<{
      providerId: string;
      model: string;
      providers: AppSettings["customProviders"];
      intelligentSchedulingEnabled?: boolean;
      delegationProviders?: AppSettings["customProviders"];
      system: AppSettings["system"];
      mcp: AppSettings["mcp"];
      access: AppSettings["access"];
    }> {
      return invokeNative("automation_background_execution_settings", {
        execution_id: executionId,
        lease,
      });
    },
    listWorkerPeers(): Promise<WorkerPeerList> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Worker discovery requires the native app"));
      return invokeNative("worker_peer_list");
    },
    discoverWorkerPeers(): Promise<{ services: import("./workerDiscovery").DiscoveredWorker[] }> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("LAN discovery requires a native connection"));
      return invokeNative("worker_peer_discover");
    },
    probeWorkerPeer(peerId: string): Promise<WorkerHostInfo> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Worker selection requires the native app"));
      return invokeNative("worker_peer_probe", { peer_id: peerId });
    },
    forgetWorkerPeer(peerId: string): Promise<void> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Worker removal requires the native app"));
      return invokeNative("worker_peer_forget", { peer_id: peerId });
    },
    forgetWorkerEndpoint(peerId: string, baseUrl: string): Promise<void> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Worker removal requires the native app"));
      return invokeNative("worker_peer_forget", { peer_id: peerId, base_url: baseUrl });
    },
    resolveBackgroundPeer(requestId: string): Promise<string | null> {
      if (!isTauriRuntime()) return Promise.resolve(null);
      return invokeNative("worker_peer_resolve_request", { request_id: requestId });
    },
    saveBackgroundCheckpoint(
      executionId: string,
      revision: number,
      context: unknown,
      lease?: BackgroundExecutionLease,
    ): Promise<number> {
      return invokeNative("automation_background_save_checkpoint", {
        input: { executionId, revision, context, lease },
      });
    },
    startBackgroundCloudTask(
      executionId: string,
      callId: string,
      lease: BackgroundExecutionLease,
    ): Promise<ToolResultMessage> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Cloud starts belong to the native worker"));
      return invokeNative("automation_background_cloud_start", {
        execution_id: executionId,
        call_id: callId,
        lease,
      });
    },
    reconcileBackgroundCloudStart(
      executionId: string,
      callId: string,
      lease: BackgroundExecutionLease,
    ): Promise<ToolResultMessage | null> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Cloud recovery belongs to the native worker"));
      return invokeNative("automation_background_cloud_reconcile", {
        execution_id: executionId,
        call_id: callId,
        lease,
      });
    },
    parkUnconfirmedChildStart(
      executionId: string,
      callId: string,
      lease: BackgroundExecutionLease,
    ): Promise<boolean> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Child parking belongs to the native worker"));
      return invokeNative("automation_background_child_park", {
        execution_id: executionId,
        call_id: callId,
        lease,
      });
    },
    parkUnconfirmedCloudStart(
      executionId: string,
      callId: string,
      lease: BackgroundExecutionLease,
    ): Promise<boolean> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Cloud parking belongs to the native worker"));
      return invokeNative("automation_background_cloud_park", {
        execution_id: executionId,
        call_id: callId,
        lease,
      });
    },
    recoverInterruptedCloudLaunches(): Promise<number> {
      if (!isTauriRuntime())
        return Promise.reject(new Error("Interrupted cloud recovery belongs to the native worker"));
      return invokeNative("automation_background_cloud_recover_interrupted");
    },
    reconcileCloudCancellations(): Promise<number> {
      if (!isTauriRuntime())
        return Promise.reject(
          new Error("Cloud cancellation reconciliation belongs to the native worker"),
        );
      return invokeNative("automation_background_cloud_reconcile_cancellations");
    },
    beginBackgroundOperation(
      executionId: string,
      callId: string,
      toolName: string,
      args: unknown,
      lease?: BackgroundExecutionLease,
    ): Promise<BeginBackgroundOperationResponse> {
      return invokeNative("automation_background_begin_operation", {
        input: { executionId, callId, toolName, arguments: args, lease },
      });
    },
    completeBackgroundOperation(
      executionId: string,
      callId: string,
      result: unknown,
      lease?: BackgroundExecutionLease,
    ): Promise<void> {
      return invokeNative("automation_background_complete_operation", {
        input: { executionId, callId, result, lease },
      });
    },
    listBackgroundOperations(
      requestId: string,
      cursor = 0,
      limit = 10,
      peerId?: string,
    ): Promise<BackgroundOperationPage> {
      return invokeBackground(
        "automation_background_operations",
        { request_id: requestId, cursor, limit },
        peerId,
      );
    },
    submitBackgroundModelTask(
      executionId: string,
      callId: string,
      lease: BackgroundExecutionLease,
      providerId: string,
      model: string,
    ): Promise<BackgroundTaskRecord> {
      if (!isTauriRuntime() || isNativeMobileRuntime())
        throw new Error("Persistent model children require the native desktop executor");
      return invokeNative("automation_background_model_submit", {
        execution_id: executionId,
        call_id: callId,
        lease,
        provider_id: providerId,
        model,
      });
    },
    submitBackgroundTask(
      input: SubmitBackgroundTaskInput,
      peerId?: string,
      parentLease?: BackgroundExecutionLease,
      origin?: unknown,
      localExecution = false,
      parentCallId?: string,
    ): Promise<BackgroundTaskRecord> {
      if (isTauriRuntime() && !parentLease) {
        const host = getLanPcCommandHostConfig();
        return invokeNative("automation_result_submission_submit", {
          input,
          origin: origin ?? null,
          peer_id: peerId ?? null,
          base_url: !peerId && host.enabled && !localExecution ? host.baseUrl : null,
        });
      }
      return invokeBackground(
        "automation_background_submit",
        {
          input,
          ...(parentLease ? { parent_lease: parentLease, parent_call_id: parentCallId } : {}),
        },
        peerId,
      );
    },
    readBackgroundChildren(
      requestId: string,
      peerId?: string,
      callId?: string,
      offset = 0,
      snapshotHash?: string,
    ): Promise<Record<string, unknown>> {
      return invokeBackground(
        "automation_background_children",
        {
          request_id: requestId,
          call_id: callId,
          offset,
          snapshot_hash: snapshotHash,
        },
        peerId,
      );
    },
    recordBackgroundChildWait(
      executionId: string,
      branchId: string,
      callId: string,
      reason: string,
      lease: BackgroundExecutionLease,
    ): Promise<BackgroundOutcomeReport> {
      return invokeNative("automation_background_child_wait", {
        execution_id: executionId,
        branch_id: branchId,
        call_id: callId,
        reason,
        lease,
      });
    },
    prepareBackgroundInputs(
      executionId: string,
      lease?: BackgroundExecutionLease,
    ): Promise<BackgroundInputManifest[]> {
      return invokeNative("automation_background_prepare_inputs", {
        execution_id: executionId,
        lease,
      });
    },
    getBackgroundHostInfo(): Promise<WorkerHostInfo> {
      return invoke("automation_background_host_info");
    },
    getLocalWorkerHostInfo(): Promise<WorkerHostInfo | null> {
      if (!isTauriRuntime() || isNativeMobileRuntime()) return Promise.resolve(null);
      return invokeNative("automation_background_host_info");
    },
    importBackgroundChildArtifact(
      executionId: string,
      callId: string,
      childCallId: string,
      artifactId: string,
      lease: BackgroundExecutionLease,
    ): Promise<ToolResultMessage> {
      return invokeNative("automation_background_child_import_artifact", {
        execution_id: executionId,
        call_id: callId,
        child_call_id: childCallId,
        artifact_id: artifactId,
        lease,
      });
    },
    importBackgroundCloudArtifact(
      executionId: string,
      callId: string,
      cloudCallId: string,
      lease: BackgroundExecutionLease,
    ): Promise<ToolResultMessage> {
      return invokeNative("automation_background_cloud_import_artifact", {
        execution_id: executionId,
        call_id: callId,
        cloud_call_id: cloudCallId,
        lease,
      });
    },
    readBackgroundExecutionArtifact(
      executionId: string,
      artifactId: string,
      lease: BackgroundExecutionLease,
    ): Promise<BackgroundArtifactContent> {
      return invokeNative("automation_background_execution_read_artifact", {
        execution_id: executionId,
        artifact_id: artifactId,
        lease,
      });
    },
    publishBackgroundArtifact(
      executionId: string,
      path: string,
      expectedHash?: string,
      lease?: BackgroundExecutionLease,
    ): Promise<BackgroundArtifact> {
      return invokeNative("automation_background_publish_artifact", {
        execution_id: executionId,
        lease,
        path,
        expected_hash: expectedHash,
      });
    },
    readBackgroundArtifact(
      requestId: string,
      artifactId: string,
      peerId?: string,
    ): Promise<BackgroundArtifactContent> {
      return invokeBackground(
        "automation_background_read_artifact",
        {
          request_id: requestId,
          artifact_id: artifactId,
        },
        peerId,
      );
    },
    async getBackgroundTask(requestId: string, peerId?: string): Promise<BackgroundTaskRecord> {
      if (isTauriRuntime()) {
        const current = await invokeNative<BackgroundTaskRecord | null>(
          "automation_result_submission_current",
          { request_id: requestId, peer_id: peerId ?? null },
        );
        if (current) return current;
      }
      return invokeBackground("automation_background_get", { request_id: requestId }, peerId);
    },
    listBackgroundTasks(limit = 50, peerId?: string): Promise<BackgroundTaskRecord[]> {
      return invokeBackground("automation_background_list", { limit }, peerId);
    },
    async cancelBackgroundTask(requestId: string, peerId?: string): Promise<BackgroundTaskRecord> {
      if (isTauriRuntime()) {
        const cancelled = await invokeNative<BackgroundTaskRecord | null>(
          "automation_result_submission_cancel",
          { request_id: requestId, peer_id: peerId ?? null },
        );
        if (cancelled) return cancelled;
      }
      return invokeBackground("automation_background_cancel", { request_id: requestId }, peerId);
    },
    fetchSnapshot(): Promise<AutomationSnapshot> {
      return invoke<AutomationSnapshot>("automation_snapshot");
    },

    cronApply(input: AutomationApplyInput): Promise<CronApplyResponse> {
      return invoke<CronApplyResponse>("automation_cron_apply", { input });
    },

    hooksApply(input: AutomationApplyInput): Promise<HooksApplyResponse> {
      return invoke<HooksApplyResponse>("automation_hooks_apply", { input });
    },

    listRuns(taskId: string, limit?: number): Promise<CronRunRecord[]> {
      return invoke<CronRunRecord[]>("automation_list_runs", {
        task_id: taskId,
        limit: limit ?? 100,
      });
    },

    clearRuns(taskId: string): Promise<number> {
      return invoke<number>("automation_clear_runs", { task_id: taskId });
    },

    runNow(taskId: string): Promise<CronRunNowResponse> {
      return invoke<CronRunNowResponse>("automation_run_cron_now", { task_id: taskId });
    },

    claimPromptRuns(limit?: number): Promise<PromptRunRequest[]> {
      return invoke<PromptRunRequest[]>(
        "automation_claim_prompt_runs",
        limit === undefined ? undefined : { limit },
      );
    },

    releasePromptRun(executionId: string, lease?: BackgroundExecutionLease): Promise<void> {
      return (lease ? invokeNative<void> : invoke<void>)("automation_release_prompt_run", {
        execution_id: executionId,
        ...(lease ? { lease } : {}),
      });
    },

    completePromptRun(input: CompletePromptRunInput): Promise<PromptCompletionResponse> {
      return (
        input.lease ? invokeNative<PromptCompletionResponse> : invoke<PromptCompletionResponse>
      )("automation_complete_prompt_run", { input });
    },

    async validateCronExpression(expression: string): Promise<void> {
      await invoke("cron_validate_expression", { expression });
    },

    subscribe(handlers: AutomationBackendHandlers): () => void {
      const unlistenCron = listen<CronSnapshot>(CRON_CHANGED_EVENT, (event) => {
        handlers.onCron(event.payload);
      });
      const unlistenHooks = listen<HooksSnapshot>(HOOKS_CHANGED_EVENT, (event) => {
        handlers.onHooks(event.payload);
      });
      return () => {
        void unlistenCron.then((unlisten) => unlisten());
        void unlistenHooks.then((unlisten) => unlisten());
      };
    },
  };
}

export const backend = createAutomationBackend();
