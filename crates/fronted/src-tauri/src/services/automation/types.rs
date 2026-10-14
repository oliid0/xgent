use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const CRON_CHANGED_EVENT: &str = "automation:cron-changed";
pub const HOOKS_CHANGED_EVENT: &str = "automation:hooks-changed";
pub const PROMPT_PENDING_EVENT: &str = "automation:prompt-pending";
pub const PROMPT_EXPIRED_EVENT: &str = "automation:prompt-expired";

/// Sentinel written in place of HTTP header values when a snapshot leaves the
/// desktop (local-access web clients). Apply ops carrying this sentinel keep
/// the currently stored value, so remote clients can edit a request without
/// ever seeing or re-sending the secret.
pub const MASKED_HEADER_VALUE: &str = "__xgent-masked__";

pub const CRON_TASK_KINDS: &[&str] = &["bash", "http", "prompt"];
pub const CRON_REASONING_LEVELS: &[&str] =
    &["off", "minimal", "low", "medium", "high", "xhigh", "max"];
/// Per-task execution timeout applied to bash scripts, each http request and
/// the prompt run execution lease (stamped when a runner claims the run).
/// Tasks stored before the field existed resolve to it. Upper bounds are
/// per-kind — see validate.rs.
pub const DEFAULT_CRON_TIMEOUT_SECONDS: u64 = 300;

pub fn default_cron_timeout_seconds() -> u64 {
    DEFAULT_CRON_TIMEOUT_SECONDS
}
pub const HOOK_KINDS: &[&str] = &["command", "http"];
pub const HOOK_EVENTS: &[&str] = &[
    "agent_start",
    "turn_start",
    "message_start",
    "message_end",
    "tool_execution_start",
    "tool_execution_end",
    "turn_end",
    "agent_end",
];
pub const HTTP_METHODS: &[&str] = &["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

pub fn http_method_can_have_body(method: &str) -> bool {
    matches!(method, "POST" | "PUT" | "PATCH" | "DELETE")
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequestSpec {
    pub id: String,
    pub url: String,
    pub method: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub headers: Option<BTreeMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedModelRef {
    pub custom_provider_id: String,
    pub model: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronTask {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub cron: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remaining_executions: Option<u64>,
    /// Execution timeout in seconds (bash script / each http request / prompt
    /// run lease). Always serialized; missing input defaults to 300.
    #[serde(default = "default_cron_timeout_seconds")]
    pub timeout_seconds: u64,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requests: Option<Vec<HttpRequestSpec>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_model: Option<SelectedModelRef>,
    /// Thinking level for prompt tasks; None/empty means the runtime default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    /// Workspace path pinned for this task; None/empty means "follow the
    /// globally active workspace" (the pre-existing behavior).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workdir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookDef {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub event: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requests: Option<Vec<HttpRequestSpec>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronSnapshot {
    pub revision: u64,
    pub tasks: Vec<CronTask>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HooksSnapshot {
    pub revision: u64,
    pub hooks: Vec<HookDef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationSnapshot {
    pub cron: CronSnapshot,
    pub hooks: HooksSnapshot,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum AutomationOp {
    Create {
        #[serde(rename = "item")]
        item: Value,
    },
    Update {
        id: String,
        patch: Value,
    },
    Delete {
        id: String,
    },
    Reorder {
        ids: Vec<String>,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationApplyInput {
    pub base_revision: u64,
    pub ops: Vec<AutomationOp>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronApplyResponse {
    pub status: ApplyStatus,
    pub cron: CronSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HooksApplyResponse {
    pub status: ApplyStatus,
    pub hooks: HooksSnapshot,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApplyStatus {
    Ok,
    Conflict,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    Pending,
    Leased,
    Waiting,
    Done,
    Expired,
}

impl RunState {
    pub fn as_str(self) -> &'static str {
        match self {
            RunState::Pending => "pending",
            RunState::Leased => "leased",
            RunState::Waiting => "waiting",
            RunState::Done => "done",
            RunState::Expired => "expired",
        }
    }

    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "pending" => Ok(RunState::Pending),
            "leased" => Ok(RunState::Leased),
            "waiting" => Ok(RunState::Waiting),
            "done" => Ok(RunState::Done),
            "expired" => Ok(RunState::Expired),
            other => Err(format!("unknown automation run state: {other}")),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CronRunNowResponse {
    pub started_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CronRunRecord {
    pub id: String,
    pub task_id: String,
    pub state: RunState,
    pub success: bool,
    pub started_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<i64>,
    pub duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    pub output: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundExecutionLease {
    pub attempt: u64,
    pub generation: u64,
    pub token: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptRunRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lease: Option<BackgroundExecutionLease>,
    pub execution_id: String,
    pub task_id: String,
    pub task_name: String,
    pub prompt: String,
    pub provider_id: String,
    pub model: String,
    pub started_at: i64,
    /// Deadline enforced by the expiry sweep. Stamped as a fixed claim window
    /// at queue time, then re-stamped to `claim_now + timeout_seconds` when a
    /// runner claims the row (see store.rs).
    pub lease_expires_at: i64,
    /// Task timeout snapshot taken at queue time (like workdir/reasoning), so
    /// the claim-time lease re-stamp survives task edits/deletion. Rows queued
    /// before this field existed resolve to the default.
    #[serde(default = "default_cron_timeout_seconds")]
    pub timeout_seconds: u64,
    #[serde(default = "default_true")]
    pub counted: bool,
    /// Resolved at queue time (task pin or global workdir). Empty on rows
    /// queued before this field existed; the runner falls back to the global
    /// workdir then.
    #[serde(default)]
    pub workdir: String,
    /// Task thinking level; empty means the runner's default.
    #[serde(default)]
    pub reasoning: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_context: Option<BackgroundTaskContext>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goal_context: Option<super::store::GoalPromptContext>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletePromptRunInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lease: Option<BackgroundExecutionLease>,
    pub execution_id: String,
    #[serde(default)]
    pub success: bool,
    #[serde(default)]
    pub duration_ms: u64,
    #[serde(default)]
    pub output: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PromptCompletionStatus {
    Completed,
    AlreadyFinished,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptCompletionResponse {
    pub status: PromptCompletionStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptExpiredEvent {
    pub execution_id: String,
    pub task_id: String,
}

/// Outcome of a finished bash/http run (or a synthesized failure/skip record)
/// persisted by the scheduler.
#[derive(Debug, Clone)]
pub struct CompletedRun {
    pub task_id: String,
    pub success: bool,
    pub started_at: i64,
    pub duration_ms: u64,
    pub exit_code: Option<i32>,
    pub output: String,
    /// Counted runs decrement `remaining_executions`; skip records do not.
    pub counted: bool,
}

/// A one-shot task uses the existing durable prompt queue, never a synthetic cron schedule.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitBackgroundTaskInput {
    #[serde(default)]
    pub intelligent_scheduling_enabled: bool,
    pub request_id: String,
    pub name: String,
    pub prompt: String,
    pub provider_id: String,
    pub model: String,
    pub workdir: String,
    #[serde(default = "default_cron_timeout_seconds")]
    pub timeout_seconds: u64,
    #[serde(default)]
    pub reasoning: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<BackgroundInputFile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delegation: Option<BackgroundDelegation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requirements: Option<crate::services::worker_inventory::WorkerRequirements>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_context: Option<BackgroundSourceContext>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goal_binding: Option<BackgroundGoalBinding>,
}

/// An accepted goal association is part of the immutable request, not an execution grant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackgroundGoalBinding {
    pub goal_id: String,
    pub store_id: String,
    pub revision: u64,
}

impl BackgroundGoalBinding {
    pub fn validate(&self) -> Result<(), String> {
        let valid = |id: &str| !id.is_empty() && id.len() <= 80
            && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-');
        if !valid(&self.goal_id) || !valid(&self.store_id) || self.revision > 9_007_199_254_740_991 {
            return Err("goals.invalidConfig".into());
        }
        Ok(())
    }
}

/// Original model-facing conversation data, never the receiving host's policy
/// or operation receipts. Kept with immutable accepted input through recovery.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackgroundSourceContext {
    pub version: u32,
    pub request_scope: String,
    pub system_prompt: String,
    pub messages: Vec<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_request: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_clock: Option<BackgroundRequestClock>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub routing: Option<BackgroundSourceRouting>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackgroundRequestClock {
    pub timestamp_ms: i64,
    pub time_zone: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackgroundSourceRouting {
    pub version: u32,
    pub initiating_host_id: String,
    pub branches: Vec<BackgroundSourceBranch>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackgroundSourceBranch {
    pub id: String,
    pub requirement: String,
    pub depends_on: Vec<String>,
    pub locality: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observation: Option<BackgroundHealthObservation>,
}

/// A bounded original-device read requirement; never a write or OS grant.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackgroundHealthObservation {
    pub kind: String,
    pub metric: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub limit: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MobileConnectorWriteInput {
    pub operation_id: String,
    pub device_host_id: String,
    pub kind: String,
    pub request: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileConnectorWriteRecord {
    pub input: MobileConnectorWriteInput,
    pub destination: serde_json::Value,
    pub state: String,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
    pub started_at: i64,
    pub finished_at: Option<i64>,
}

pub const MAX_BACKGROUND_HOSTS: usize = 8;
/// Frozen original-device actions. Neither a plan nor readiness grants OS access.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceBranchAction {
    pub input: MobileConnectorWriteInput,
    pub source_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceBranchPlan {
    pub version: u32,
    pub request_id: String,
    pub source_host_id: String,
    pub source: BackgroundSourceBranch,
    pub actions: Vec<DeviceBranchAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceBranchReceipt {
    pub plan: DeviceBranchPlan,
    pub receipts: Vec<MobileConnectorWriteRecord>,
}

/// Native transport capability, deliberately outside accepted task/context JSON.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackgroundDeviceChannelProof {
    pub version: u32,
    pub initiating_host_id: String,
    pub token: String,
}

/// Routing history, not an authorization grant. Each receiver appends its own
/// installation identity; the model cannot supply this through tool arguments.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundDelegation {
    pub root_request_id: String,
    pub parent_request_id: String,
    pub ancestor_host_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub budget: Option<BackgroundDelegationBudget>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackgroundDelegationBudget {
    pub version: u32,
    pub max_model_requests: u64,
    pub max_tool_calls: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deadline_at: Option<i64>,
}

impl BackgroundDelegationBudget {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1 || !(1..=128).contains(&self.max_model_requests) || !(1..=256).contains(&self.max_tool_calls)
            || self.deadline_at.is_some_and(|time|!(1..=8_640_000_000_000_000).contains(&time)) {
            return Err("Delegated budget needs version 1 and bounded positive request/tool slots".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTaskContext {
    pub root_request_id: String,
    pub request_id: String,
    pub host_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goal_binding: Option<BackgroundGoalBinding>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundInputFile {
    pub name: String,
    pub content_base64: String,
    pub content_hash: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundInputManifest {
    pub relative_path: String,
    pub content_hash: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTaskRecord {
    #[serde(skip_serializing_if="Option::is_none")]
    pub execution_budget: Option<super::store::BackgroundBudgetSnapshot>,
    pub request_id: String,
    pub host_id: String,
    pub name: String,
    pub workdir: String,
    pub run: CronRunRecord,
    pub artifacts: Vec<BackgroundArtifact>,
    pub inputs: Vec<BackgroundInputManifest>,
    pub operations: BackgroundOperationSummary,
    pub checkpoint_revision: u64,
    pub delegation: Option<BackgroundDelegation>,
    pub outcomes: Option<BackgroundOutcomeReport>,
    pub waiting: Option<BackgroundWaitRecord>,
    pub cloud_recovery: Option<BackgroundCloudRecovery>,
    pub cloud_cancellation: BackgroundCloudCancellationSummary,
    pub children: Vec<BackgroundChildSummary>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub videos: Vec<BackgroundVideoSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goal_binding: Option<BackgroundGoalBinding>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundVideoSummary {
    pub call_id: String,
    pub status: String,
    pub artifact_id: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundChildSummary {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub call_id: String,
    pub request_id: String,
    pub peer_id: String,
    pub accepted: bool,
    pub state: Option<String>,
    pub success: bool,
    pub terminal_confirmed: bool,
    pub cancel_requested: bool,
    pub cancel_acknowledged: bool,
    pub last_error: Option<String>,
}

pub struct BackgroundChildProbe {
    pub execution_id: String,
    pub call_id: String,
    pub request_id: String,
    pub peer_id: String,
    pub token: String,
    pub cancel_requested: bool,
    pub cancel_acknowledged: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundCloudRecovery {
    pub call_id: String,
    pub task_id: String,
    pub wait_id: String,
    pub retry_at: i64,
    pub probes: u32,
    pub launch_error: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackgroundCloudCancellationSummary {
    pub pending: u64,
    pub observed_terminal: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundResultWatch { pub source_host_id: String, pub request_id: String }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundInboxItem {
    pub id: String, pub sequence: u64, pub source_host_id: String, pub request_id: String,
    pub name: String, pub state: String, pub success: bool, pub preview: String,
    pub artifact_count: usize, pub received_at: i64, pub read_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundInboxPage { pub items: Vec<BackgroundInboxItem>, pub next_cursor: Option<u64> }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundInboxChunk {
    pub entry_id: String, pub offset: usize, pub total_bytes: usize,
    pub text: String, pub next_offset: Option<usize>, pub snapshot_hash: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundInboxSync { pub inspected: usize, pub received: usize, pub unresolved: usize }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundSubmission {
    pub source_host_id: String,
    pub input: SubmitBackgroundTaskInput,
    pub result: Option<serde_json::Value>,
    pub cancel_requested: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundSubmissionItem {
    pub sequence: u64, pub request_id: String, pub source_host_id: String,
    pub name: String, pub created_at: i64, pub retry_at: i64, pub probes: u32,
    pub last_error: Option<String>, pub accepted: bool, pub local_owner: bool,
    pub cancel_requested: bool, pub cancellation_confirmed: bool,
    pub locally_withdrawn: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundSubmissionPage { pub items: Vec<BackgroundSubmissionItem>, pub next_cursor: Option<u64> }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundResultResponse {
    pub source_host_id: String,
    pub input: ResumeBackgroundTaskInput,
    pub result: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WaitBackgroundTaskInput {
    pub execution_id: String,
    pub lease: BackgroundExecutionLease,
    pub duration_ms: u64,
    pub output: String,
    pub known_tools: Vec<String>,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub budget_deferral_id:Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundWaitRecord {
    pub wait_id: String,
    pub created_at: i64,
    pub retry_at: i64,
    pub probes: u32,
    pub automatic_tools: Vec<String>,
    pub known_tools: Vec<String>,
    pub retry_on_inventory_change: bool,
    pub cloud_call_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundWaitingTask {
    pub execution_id: String,
    pub waiting: BackgroundWaitRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResumeBackgroundTaskInput {
    pub request_id: String,
    pub wait_id: String,
    pub resume_id: String,
    pub response: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum BackgroundCriterion {
    Artifact { path: String },
    Operation { tool: String, arguments: Value },
    Answer,
    Unavailable { capability: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackgroundBranch {
    pub id: String,
    pub title: String,
    pub requirement: String,
    pub depends_on: Vec<String>,
    pub criteria: Vec<BackgroundCriterion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackgroundTaskPlan {
    pub version: u8,
    pub branches: Vec<BackgroundBranch>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveBackgroundPlanInput {
    pub execution_id: String,
    pub lease: Option<BackgroundExecutionLease>,
    pub plan: BackgroundTaskPlan,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackgroundBranchEvidence {
    pub artifact_ids: Vec<String>,
    pub call_ids: Vec<String>,
    pub answer: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordBackgroundOutcomeInput {
    pub execution_id: String,
    pub lease: Option<BackgroundExecutionLease>,
    pub branch_id: String,
    pub evidence: Option<BackgroundBranchEvidence>,
    pub waiting_reason: Option<String>,
    pub waiting_tool: Option<String>,
    pub waiting_inventory: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundBranchOutcome {
    pub branch: BackgroundBranch,
    pub state: String,
    pub evidence: Option<BackgroundBranchEvidence>,
    pub reason: Option<String>,
    pub waiting_tool: Option<String>,
    pub waiting_inventory: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundOutcomeReport {
    pub branches: Vec<BackgroundBranchOutcome>,
    pub verified: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundOperationSummary {
    pub in_flight: u64,
    pub returned: u64,
    pub errors: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginBackgroundOperationInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lease: Option<BackgroundExecutionLease>,
    pub execution_id: String,
    pub call_id: String,
    pub tool_name: String,
    pub arguments: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginBackgroundOperationResponse {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteBackgroundOperationInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lease: Option<BackgroundExecutionLease>,
    pub execution_id: String,
    pub call_id: String,
    pub result: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveBackgroundCheckpointInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lease: Option<BackgroundExecutionLease>,
    pub execution_id: String,
    pub revision: u64,
    pub context: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundResumeCheckpoint {
    pub revision: u64,
    pub context: Option<Value>,
    pub last_compaction: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactBackgroundContextInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lease: Option<BackgroundExecutionLease>,
    pub execution_id: String,
    pub source_revision: u64,
    pub context: Value,
    pub summary: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundCompactionRecord {
    pub source_revision: u64,
    pub checkpoint_revision: u64,
    pub source_hash: String,
    pub source_bytes: u64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundCompactionPage {
    pub compactions: Vec<BackgroundCompactionRecord>,
    pub next_cursor: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundContextArchiveChunk {
    pub source_revision: u64,
    pub source_hash: String,
    pub total_bytes: usize,
    pub offset: usize,
    pub text: String,
    pub next_offset: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundOperationRecord {
    pub sequence: i64,
    pub call_id: String,
    pub tool_name: String,
    pub arguments: Value,
    pub context_revision: u64,
    pub state: String,
    pub result: Option<Value>,
    pub started_at: i64,
    pub finished_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundOperationPage {
    pub operations: Vec<BackgroundOperationRecord>,
    pub next_cursor: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundArtifact {
    pub id: String,
    pub relative_path: String,
    pub content_hash: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundArtifactContent {
    pub artifact: BackgroundArtifact,
    pub content_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackgroundArtifactChunk {
    pub artifact: BackgroundArtifact,
    pub offset: u64,
    pub content_base64: String,
    pub chunk_hash: String,
    pub next_offset: Option<u64>,
}
/// Actual SDK account/list identity retained for a task's read scope.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MobileReadDestination {
    pub kind: String,
    pub id: String,
    pub source_id: String,
    pub title: String,
    pub source: String,
    pub writable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_ms: Option<i64>,
}

pub struct BackgroundCloudLaunch {
    pub task_id: String,
    pub input: crate::services::cloud_execution::CloudTaskStartInput,
    pub execute: bool,
    pub receipt: Option<serde_json::Value>,
}
