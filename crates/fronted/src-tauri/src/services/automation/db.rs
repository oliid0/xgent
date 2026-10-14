use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{Map, Value};

use super::types::{
    CronRunRecord, CronSnapshot, CronTask, HookDef, HooksSnapshot, HttpRequestSpec, RunState,
    SelectedModelRef, DEFAULT_CRON_TIMEOUT_SECONDS,
};

pub const RUN_RETENTION_PER_TASK: u32 = 200;
pub const RUN_RETENTION_MAX_AGE_MS: i64 = 30 * 24 * 60 * 60 * 1000;
pub const MAX_RUN_OUTPUT_CHARS: usize = 50_000;

const SCHEMA_VERSION: i64 = 1;

pub fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis() as i64
}

pub fn truncate_run_output(text: &str) -> String {
    if text.chars().count() <= MAX_RUN_OUTPUT_CHARS {
        return text.to_string();
    }
    let mut out: String = text.chars().take(MAX_RUN_OUTPUT_CHARS).collect();
    out.push_str("\n...[log truncated]");
    out
}

pub fn open_automation_connection() -> Result<Connection, String> {
    let db_path = crate::commands::settings::config_db_path()?;
    let conn = Connection::open(db_path).map_err(|e| format!("打开 automation 数据库失败：{e}"))?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| format!("设置 SQLite busy_timeout 失败：{e}"))?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("启用 SQLite WAL 失败：{e}"))?;
    // Action intents must be durable before invoking external systems. WAL
    // NORMAL can lose acknowledged commits on power loss; FULL syncs commits.
    conn.pragma_update(None, "synchronous", "FULL")
        .map_err(|e| format!("设置 SQLite synchronous 失败：{e}"))?;
    Ok(conn)
}

pub fn ensure_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS automation_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS automation_cron_tasks (
            task_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            cron_expr TEXT NOT NULL,
            kind TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 0,
            remaining_runs INTEGER,
            config_json TEXT NOT NULL,
            sort_index INTEGER NOT NULL,
            last_error TEXT,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS automation_hooks (
            hook_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            event TEXT NOT NULL,
            kind TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 0,
            timeout_ms INTEGER,
            config_json TEXT NOT NULL,
            sort_index INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS automation_cron_runs (
            execution_id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            state TEXT NOT NULL,
            success INTEGER NOT NULL DEFAULT 0,
            started_at INTEGER NOT NULL,
            finished_at INTEGER,
            duration_ms INTEGER NOT NULL DEFAULT 0,
            exit_code INTEGER,
            output TEXT NOT NULL DEFAULT '',
            lease_expires_at INTEGER,
            request_json TEXT
        );
        CREATE TABLE IF NOT EXISTS automation_background_tasks (
            request_id TEXT PRIMARY KEY,
            execution_id TEXT NOT NULL UNIQUE,
            input_json TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS automation_background_artifacts (
            artifact_id TEXT PRIMARY KEY,
            execution_id TEXT NOT NULL,
            relative_path TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            bytes INTEGER NOT NULL,
            content BLOB NOT NULL,
            created_at INTEGER NOT NULL,
            UNIQUE (execution_id, relative_path, content_hash)
        );
        CREATE TABLE IF NOT EXISTS automation_background_configuration_bindings (
            execution_id TEXT PRIMARY KEY,
            binding TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS automation_background_plans (
            execution_id TEXT PRIMARY KEY,
            plan_json TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS automation_background_outcomes (
            execution_id TEXT NOT NULL,
            branch_id TEXT NOT NULL,
            state TEXT NOT NULL,
            evidence_json TEXT,
            reason TEXT,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (execution_id, branch_id)
        );
        CREATE TABLE IF NOT EXISTS automation_background_leases (
            execution_id TEXT PRIMARY KEY,
            attempt INTEGER NOT NULL,
            generation INTEGER NOT NULL,
            token TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS automation_background_wait_conditions (
            execution_id TEXT NOT NULL,
            branch_id TEXT NOT NULL,
            tool_name TEXT,
            inventory_change INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (execution_id, branch_id)
        );
        CREATE TABLE IF NOT EXISTS automation_background_cloud_waits (
            execution_id TEXT NOT NULL,
            branch_id TEXT NOT NULL,
            call_id TEXT NOT NULL,
            PRIMARY KEY (execution_id, branch_id)
        );
        CREATE TABLE IF NOT EXISTS automation_result_watches (
            request_id TEXT PRIMARY KEY,
            source_host_id TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1,
            retry_at INTEGER NOT NULL DEFAULT 0,
            probes INTEGER NOT NULL DEFAULT 0,
            last_digest TEXT,
            execution_id TEXT,
            last_revision INTEGER NOT NULL DEFAULT 0,
            last_state TEXT,
            last_received_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_result_watches_due ON automation_result_watches (active, retry_at);
        CREATE TABLE IF NOT EXISTS automation_result_inbox (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_id TEXT NOT NULL UNIQUE,
            source_host_id TEXT NOT NULL,
            request_id TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            received_at INTEGER NOT NULL,
            read_at INTEGER,
            UNIQUE (source_host_id, request_id, content_hash)
        );
        CREATE TABLE IF NOT EXISTS automation_result_notifications (
            entry_id TEXT PRIMARY KEY NOT NULL REFERENCES automation_result_inbox(entry_id),
            accepted_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS automation_result_responses (
            resume_id TEXT PRIMARY KEY,
            entry_id TEXT NOT NULL,
            source_host_id TEXT NOT NULL,
            request_id TEXT NOT NULL,
            wait_id TEXT NOT NULL UNIQUE,
            response TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            retry_at INTEGER NOT NULL DEFAULT 0,
            probes INTEGER NOT NULL DEFAULT 0,
            result_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_result_response_due
            ON automation_result_responses (retry_at) WHERE result_json IS NULL;
        CREATE TABLE IF NOT EXISTS automation_submission_outbox (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            request_id TEXT NOT NULL UNIQUE,
            initiating_host_id TEXT NOT NULL,
            source_host_id TEXT NOT NULL,
            input_json TEXT NOT NULL,
            origin_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            retry_at INTEGER NOT NULL DEFAULT 0,
            probes INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            result_json TEXT,
            cancel_requested INTEGER NOT NULL DEFAULT 0,
            cancel_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_submission_due ON automation_submission_outbox (initiating_host_id, retry_at);
        CREATE TABLE IF NOT EXISTS automation_background_waits (
            wait_id TEXT PRIMARY KEY,
            execution_id TEXT NOT NULL,
            input_json TEXT NOT NULL,
            automatic_tools_json TEXT NOT NULL,
            known_tools_json TEXT NOT NULL,
            retry_on_inventory_change INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            retry_at INTEGER NOT NULL,
            probes INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_background_waits_execution ON automation_background_waits (execution_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS automation_background_resumptions (
            resume_id TEXT PRIMARY KEY,
            execution_id TEXT NOT NULL,
            wait_id TEXT NOT NULL UNIQUE,
            input_json TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS automation_background_plan_resolutions (
            execution_id TEXT NOT NULL,
            branch_id TEXT NOT NULL,
            criteria_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (execution_id, branch_id)
        );
        CREATE TABLE IF NOT EXISTS automation_background_operation_leases (
            execution_id TEXT NOT NULL,
            call_id TEXT NOT NULL,
            attempt INTEGER NOT NULL,
            generation INTEGER NOT NULL,
            token TEXT NOT NULL,
            PRIMARY KEY (execution_id, call_id)
        );
        CREATE TABLE IF NOT EXISTS automation_prompt_completion_outbox (
            execution_id TEXT PRIMARY KEY,
            input_json TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS automation_background_checkpoints (
            execution_id TEXT PRIMARY KEY,
            revision INTEGER NOT NULL,
            context_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS automation_background_operations (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            execution_id TEXT NOT NULL,
            call_id TEXT NOT NULL,
            tool_name TEXT NOT NULL,
            arguments_json TEXT NOT NULL,
            context_revision INTEGER NOT NULL,
            state TEXT NOT NULL,
            result_json TEXT,
            is_error INTEGER NOT NULL DEFAULT 0,
            started_at INTEGER NOT NULL,
            finished_at INTEGER,
            UNIQUE (execution_id, call_id)
        );
        CREATE TABLE IF NOT EXISTS automation_background_children (
            execution_id TEXT NOT NULL,
            call_id TEXT NOT NULL,
            child_request_id TEXT NOT NULL UNIQUE,
            peer_id TEXT NOT NULL,
            issuer_host_id TEXT NOT NULL,
            input_json TEXT NOT NULL,
            issued_at INTEGER NOT NULL,
            receipt_json TEXT,
            observed_json TEXT,
            observed_execution_id TEXT,
            observed_revision INTEGER NOT NULL DEFAULT 0,
            observed_state TEXT,
            observed_success INTEGER NOT NULL DEFAULT 0,
            terminal_confirmed INTEGER NOT NULL DEFAULT 0,
            cancel_requested INTEGER NOT NULL DEFAULT 0,
            cancel_acknowledged INTEGER NOT NULL DEFAULT 0,
            retry_at INTEGER NOT NULL,
            probes INTEGER NOT NULL DEFAULT 0,
            probe_token TEXT,
            last_error TEXT,
            PRIMARY KEY (execution_id, call_id)
        );
        CREATE INDEX IF NOT EXISTS idx_background_children_due ON automation_background_children (retry_at);
        CREATE TABLE IF NOT EXISTS automation_background_task_joins (
            execution_id TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('child','cloud','video')),
            call_id TEXT NOT NULL,
            wait_id TEXT NOT NULL,
            retry_at INTEGER NOT NULL DEFAULT 0,
            wake_consumed INTEGER NOT NULL DEFAULT 0 CHECK (wake_consumed IN (0,1)),
            PRIMARY KEY (execution_id, kind, call_id)
        );
        CREATE INDEX IF NOT EXISTS idx_background_task_joins_wait
            ON automation_background_task_joins (execution_id, wait_id, kind, wake_consumed);
        CREATE TABLE IF NOT EXISTS automation_background_child_waits (
            execution_id TEXT NOT NULL,
            branch_id TEXT NOT NULL,
            call_id TEXT NOT NULL,
            wake_consumed INTEGER NOT NULL DEFAULT 0,
            retry_at INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (execution_id, branch_id)
        );
        CREATE TABLE IF NOT EXISTS automation_background_child_wait_events (
            execution_id TEXT NOT NULL,
            call_id TEXT NOT NULL,
            wait_id TEXT NOT NULL,
            consumed_at INTEGER NOT NULL,
            PRIMARY KEY (execution_id, call_id, wait_id)
        );
        CREATE TABLE IF NOT EXISTS automation_background_child_resumes (
            execution_id TEXT NOT NULL,
            call_id TEXT NOT NULL,
            peer_id TEXT NOT NULL,
            issuer_host_id TEXT NOT NULL,
            child_execution_id TEXT NOT NULL,
            input_json TEXT NOT NULL,
            issued_at INTEGER NOT NULL,
            receipt_json TEXT,
            retry_at INTEGER NOT NULL,
            probes INTEGER NOT NULL DEFAULT 0,
            probe_token TEXT,
            last_error TEXT,
            PRIMARY KEY (execution_id, call_id)
        );
        CREATE INDEX IF NOT EXISTS idx_background_child_resumes_due ON automation_background_child_resumes (retry_at);
        CREATE VIEW IF NOT EXISTS automation_background_child_operations
            (execution_id,call_id,peer_id,issuer_host_id,receipt_json,issued_at,action) AS
            SELECT execution_id,call_id,peer_id,issuer_host_id,receipt_json,issued_at,'submit'
                FROM automation_background_children
            UNION ALL
            SELECT execution_id,call_id,peer_id,issuer_host_id,receipt_json,issued_at,'resume'
                FROM automation_background_child_resumes;
        CREATE TABLE IF NOT EXISTS automation_background_cloud_launches (
            execution_id TEXT NOT NULL,
            call_id TEXT NOT NULL,
            task_id TEXT NOT NULL UNIQUE,
            arguments_hash TEXT NOT NULL,
            owner TEXT NOT NULL,
            repository TEXT NOT NULL,
            runner TEXT NOT NULL,
            issued_at INTEGER NOT NULL,
            result_json TEXT,
            PRIMARY KEY (execution_id, call_id)
        );
        CREATE TABLE IF NOT EXISTS automation_background_cloud_launch_failures (
            execution_id TEXT NOT NULL,
            call_id TEXT NOT NULL,
            error TEXT NOT NULL,
            recorded_at INTEGER NOT NULL,
            PRIMARY KEY (execution_id,call_id)
        );
        CREATE TABLE IF NOT EXISTS automation_background_cloud_completions (
            execution_id TEXT NOT NULL,
            call_id TEXT NOT NULL,
            owner TEXT NOT NULL,
            repository TEXT NOT NULL,
            task_id TEXT NOT NULL,
            run_id INTEGER NOT NULL CHECK(run_id > 0),
            conclusion TEXT NOT NULL CHECK(length(conclusion) BETWEEN 1 AND 64),
            status_json TEXT NOT NULL CHECK(json_valid(status_json) AND length(CAST(status_json AS BLOB)) <= 8192
                AND json_type(status_json,'$.state') IS 'text' AND json_extract(status_json,'$.state')='completed'
                AND json_type(status_json,'$.taskId') IS 'text' AND json_extract(status_json,'$.taskId')=task_id
                AND json_type(status_json,'$.runId') IS 'integer' AND json_extract(status_json,'$.runId')=run_id
                AND json_type(status_json,'$.conclusion') IS 'text' AND json_extract(status_json,'$.conclusion')=conclusion),
            observed_at INTEGER NOT NULL,
            PRIMARY KEY(execution_id,call_id)
        );
        CREATE TABLE IF NOT EXISTS automation_background_cloud_recoveries (
            execution_id TEXT PRIMARY KEY,
            call_id TEXT NOT NULL,
            wait_id TEXT NOT NULL UNIQUE,
            retry_at INTEGER NOT NULL,
            probes INTEGER NOT NULL DEFAULT 0,
            last_error TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_background_cloud_recoveries_due ON automation_background_cloud_recoveries (retry_at);
        CREATE TABLE IF NOT EXISTS automation_background_cloud_cancellations (
            execution_id TEXT NOT NULL,
            call_id TEXT NOT NULL,
            requested_at INTEGER NOT NULL,
            retry_at INTEGER NOT NULL,
            probes INTEGER NOT NULL DEFAULT 0,
            probe_token TEXT NOT NULL DEFAULT '',
            last_error TEXT,
            run_id INTEGER,
            observed_state TEXT,
            conclusion TEXT,
            accepted_at INTEGER,
            terminal_at INTEGER,
            PRIMARY KEY (execution_id,call_id)
        );
        CREATE INDEX IF NOT EXISTS idx_background_cloud_cancellations_due ON automation_background_cloud_cancellations (retry_at) WHERE terminal_at IS NULL;
        CREATE TABLE IF NOT EXISTS automation_background_compactions (
            execution_id TEXT NOT NULL,
            source_revision INTEGER NOT NULL,
            checkpoint_revision INTEGER NOT NULL,
            source_context_json TEXT NOT NULL,
            source_hash TEXT NOT NULL,
            context_hash TEXT NOT NULL,
            summary_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (execution_id, source_revision)
        );
        CREATE TABLE IF NOT EXISTS automation_background_device_channels (
            request_id TEXT PRIMARY KEY,
            initiating_host_id TEXT NOT NULL,
            verifier BLOB NOT NULL CHECK (LENGTH(verifier) = 32)
        );
        CREATE TABLE IF NOT EXISTS automation_mobile_connector_writes (
            operation_id TEXT PRIMARY KEY,
            device_host_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            request_json TEXT NOT NULL,
            destination_json TEXT NOT NULL,
            state TEXT NOT NULL CHECK (state IN ('running', 'succeeded', 'unknown')),
            result_json TEXT,
            error TEXT,
            started_at INTEGER NOT NULL,
            finished_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS automation_mobile_branch_plans (
            request_id TEXT NOT NULL,
            branch_id TEXT NOT NULL,
            entry_id TEXT NOT NULL,
            plan_json TEXT NOT NULL,
            acknowledged INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (request_id, branch_id)
        );
        CREATE TABLE IF NOT EXISTS automation_mobile_branch_action_owners (
            operation_id TEXT PRIMARY KEY NOT NULL,
            request_id TEXT NOT NULL,
            branch_id TEXT NOT NULL,
            entry_id TEXT NOT NULL,
            action_index INTEGER NOT NULL CHECK (action_index BETWEEN 0 AND 7)
        );
        INSERT OR IGNORE INTO automation_mobile_branch_action_owners (operation_id,request_id,branch_id,entry_id,action_index)
            SELECT json_extract(a.value, '$.input.operationId'),p.request_id,p.branch_id,p.entry_id,CAST(a.key AS INTEGER)
            FROM automation_mobile_branch_plans p, json_each(p.plan_json, '$.actions') a;
        CREATE TABLE IF NOT EXISTS automation_mobile_branch_grants (
            request_id TEXT NOT NULL,
            branch_id TEXT NOT NULL,
            plan_hash TEXT NOT NULL,
            revision INTEGER NOT NULL CHECK (revision > 0),
            decision TEXT NOT NULL CHECK (decision IN ('approved','revoked')),
            approved_at INTEGER,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (request_id, branch_id)
        );
        CREATE TABLE IF NOT EXISTS automation_mobile_branch_reads (
            request_id TEXT NOT NULL,
            branch_id TEXT NOT NULL,
            context_hash TEXT NOT NULL,
            revision INTEGER NOT NULL CHECK (revision > 0),
            decision TEXT NOT NULL CHECK (decision IN ('approved','revoked')),
            selections_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (request_id, branch_id)
        );
        CREATE TABLE IF NOT EXISTS automation_background_device_actions (
            execution_id TEXT NOT NULL,
            branch_id TEXT NOT NULL,
            plan_json TEXT NOT NULL,
            receipt_json TEXT,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (execution_id, branch_id)
        );
        CREATE TABLE IF NOT EXISTS automation_mobile_branch_planning (
            request_id TEXT NOT NULL,
            branch_id TEXT NOT NULL,
            attempts INTEGER NOT NULL CHECK (attempts BETWEEN 1 AND 3),
            PRIMARY KEY (request_id, branch_id)
        );
        CREATE TABLE IF NOT EXISTS automation_mobile_branch_reviews (
            request_id TEXT NOT NULL,
            branch_id TEXT NOT NULL,
            recovery INTEGER NOT NULL DEFAULT 0 CHECK (recovery >= 0),
            labels_json TEXT NOT NULL DEFAULT '[]',
            last_error TEXT,
            failed_attempt INTEGER,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (request_id, branch_id)
        );
        CREATE TABLE IF NOT EXISTS automation_background_device_wakes (
            execution_id TEXT NOT NULL,
            branch_id TEXT NOT NULL,
            PRIMARY KEY (execution_id, branch_id)
        );
        CREATE TABLE IF NOT EXISTS automation_background_device_planning_scopes (
            execution_id TEXT NOT NULL, branch_id TEXT NOT NULL, scope_key TEXT NOT NULL,
            scope_json TEXT NOT NULL, PRIMARY KEY(execution_id,branch_id)
        );
        CREATE TABLE IF NOT EXISTS automation_background_device_planning_calls (
            execution_id TEXT NOT NULL, call_id TEXT NOT NULL, branch_id TEXT NOT NULL,
            scope_key TEXT NOT NULL, kind TEXT NOT NULL, request_json TEXT NOT NULL,
            result_json TEXT, created_at INTEGER NOT NULL, PRIMARY KEY(execution_id,call_id)
        );
        CREATE TABLE IF NOT EXISTS automation_background_device_planning_wakes (
            execution_id TEXT PRIMARY KEY
        );
        CREATE TABLE IF NOT EXISTS automation_mobile_device_planning_receipts (
            request_id TEXT NOT NULL, branch_id TEXT NOT NULL, call_id TEXT NOT NULL,
            scope_key TEXT NOT NULL, result_json TEXT NOT NULL,
            PRIMARY KEY(request_id,branch_id,call_id)
        );
        CREATE INDEX IF NOT EXISTS idx_automation_cron_runs_task
            ON automation_cron_runs (task_id, started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_automation_cron_runs_state
            ON automation_cron_runs (state);
        ",
    )
    .map_err(|e| format!("初始化 automation 表失败：{e}"))?;
    conn.execute_batch(include_str!("foreground_attention.sql"))
        .map_err(|e| format!("Initialize foreground attention failed: {e}"))?;
    conn.execute_batch(include_str!("proactive.sql"))
        .map_err(|e| format!("Initialize proactive rules: {e}"))?;
    conn.execute_batch(include_str!("goals.sql"))
        .map_err(|e| format!("Initialize goals: {e}"))?;
    conn.execute_batch(include_str!("budget.sql"))
        .map_err(|e| format!("Initialize execution budget: {e}"))?;
    conn.execute_batch(include_str!("child_artifacts.sql"))
        .map_err(|e| format!("Initialize child artifact provenance: {e}"))?;
    conn.execute_batch(include_str!("cloud_artifacts.sql"))
        .map_err(|e|format!("Initialize owned cloud artifact provenance: {e}"))?;
    conn.execute_batch(include_str!("artifact_parts.sql"))
        .map_err(|e| format!("Initialize bounded artifact pieces: {e}"))?;
    conn.execute_batch(include_str!("videos.sql"))
        .map_err(|e| format!("Initialize owned video jobs: {e}"))?;
    conn.execute_batch(include_str!("result_delivery.sql"))
        .map_err(|e| format!("Initialize scoped OS result delivery: {e}"))?;
    conn.execute("INSERT OR IGNORE INTO automation_meta (key, value) VALUES ('goal_store_id.v1', ?1)",
        params![uuid::Uuid::new_v4().to_string()]).map_err(|e| e.to_string())?;
    Ok(())
}

fn meta_read_i64(conn: &Connection, key: &str) -> Result<Option<i64>, String> {
    conn.query_row(
        "SELECT value FROM automation_meta WHERE key = ?1",
        params![key],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|e| format!("读取 automation_meta.{key} 失败：{e}"))?
    .map(|raw| {
        raw.parse::<i64>()
            .map_err(|e| format!("解析 automation_meta.{key} 失败：{e}"))
    })
    .transpose()
}

pub fn meta_write_i64(conn: &Connection, key: &str, value: i64) -> Result<(), String> {
    conn.execute(
        "INSERT INTO automation_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value.to_string()],
    )
    .map_err(|e| format!("写入 automation_meta.{key} 失败：{e}"))?;
    Ok(())
}

pub fn read_revision(conn: &Connection, key: &str) -> Result<u64, String> {
    Ok(meta_read_i64(conn, key)?.unwrap_or(0).max(0) as u64)
}

pub fn bump_revision(conn: &Connection, key: &str) -> Result<u64, String> {
    let next = read_revision(conn, key)? + 1;
    meta_write_i64(conn, key, next as i64)?;
    Ok(next)
}

pub const CRON_REVISION_KEY: &str = "cron_revision";
pub const HOOKS_REVISION_KEY: &str = "hooks_revision";

/// Creates the automation tables and stamps the schema version. Idempotent.
pub fn initialize(conn: &Connection) -> Result<(), String> {
    ensure_schema(conn)?;
    if meta_read_i64(conn, "schema_version")?.is_none() {
        meta_write_i64(conn, "schema_version", SCHEMA_VERSION)?;
    }
    Ok(())
}

fn task_config_json(task: &CronTask) -> Result<String, String> {
    let mut config = Map::new();
    if let Some(script) = &task.script {
        config.insert("script".to_string(), Value::String(script.clone()));
    }
    if let Some(requests) = &task.requests {
        config.insert(
            "requests".to_string(),
            serde_json::to_value(requests)
                .map_err(|e| format!("序列化 cron requests 失败：{e}"))?,
        );
    }
    if let Some(prompt) = &task.prompt {
        config.insert("prompt".to_string(), Value::String(prompt.clone()));
    }
    if let Some(selected_model) = &task.selected_model {
        config.insert(
            "selectedModel".to_string(),
            serde_json::to_value(selected_model)
                .map_err(|e| format!("序列化 cron selectedModel 失败：{e}"))?,
        );
    }
    if let Some(reasoning) = &task.reasoning {
        config.insert("reasoning".to_string(), Value::String(reasoning.clone()));
    }
    if let Some(workdir) = &task.workdir {
        config.insert("workdir".to_string(), Value::String(workdir.clone()));
    }
    config.insert(
        "timeoutSeconds".to_string(),
        Value::Number(task.timeout_seconds.into()),
    );
    serde_json::to_string(&Value::Object(config))
        .map_err(|e| format!("序列化 cron config 失败：{e}"))
}

fn hook_config_json(hook: &HookDef) -> Result<String, String> {
    let mut config = Map::new();
    if let Some(script) = &hook.script {
        config.insert("script".to_string(), Value::String(script.clone()));
    }
    if let Some(requests) = &hook.requests {
        config.insert(
            "requests".to_string(),
            serde_json::to_value(requests)
                .map_err(|e| format!("序列化 hook requests 失败：{e}"))?,
        );
    }
    serde_json::to_string(&Value::Object(config))
        .map_err(|e| format!("序列化 hook config 失败：{e}"))
}

pub fn insert_cron_task(conn: &Connection, task: &CronTask, sort_index: i64) -> Result<(), String> {
    conn.execute(
        "INSERT INTO automation_cron_tasks
            (task_id, name, description, cron_expr, kind, enabled, remaining_runs,
             config_json, sort_index, last_error, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            task.id,
            task.name,
            task.description,
            task.cron,
            task.kind,
            task.enabled as i64,
            task.remaining_executions.map(|value| value as i64),
            task_config_json(task)?,
            sort_index,
            task.last_error,
            now_ms(),
        ],
    )
    .map_err(|e| format!("写入 automation_cron_tasks 失败：{e}"))?;
    Ok(())
}

pub fn update_cron_task_row(conn: &Connection, task: &CronTask) -> Result<usize, String> {
    conn.execute(
        "UPDATE automation_cron_tasks
         SET name = ?2, description = ?3, cron_expr = ?4, kind = ?5, enabled = ?6,
             remaining_runs = ?7, config_json = ?8, last_error = ?9, updated_at = ?10
         WHERE task_id = ?1",
        params![
            task.id,
            task.name,
            task.description,
            task.cron,
            task.kind,
            task.enabled as i64,
            task.remaining_executions.map(|value| value as i64),
            task_config_json(task)?,
            task.last_error,
            now_ms(),
        ],
    )
    .map_err(|e| format!("更新 automation_cron_tasks 失败：{e}"))
}

pub fn insert_hook(conn: &Connection, hook: &HookDef, sort_index: i64) -> Result<(), String> {
    conn.execute(
        "INSERT INTO automation_hooks
            (hook_id, name, description, event, kind, enabled, timeout_ms,
             config_json, sort_index, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            hook.id,
            hook.name,
            hook.description,
            hook.event,
            hook.kind,
            hook.enabled as i64,
            hook.timeout_ms.map(|value| value as i64),
            hook_config_json(hook)?,
            sort_index,
            now_ms(),
        ],
    )
    .map_err(|e| format!("写入 automation_hooks 失败：{e}"))?;
    Ok(())
}

pub fn update_hook_row(conn: &Connection, hook: &HookDef) -> Result<usize, String> {
    conn.execute(
        "UPDATE automation_hooks
         SET name = ?2, description = ?3, event = ?4, kind = ?5, enabled = ?6,
             timeout_ms = ?7, config_json = ?8, updated_at = ?9
         WHERE hook_id = ?1",
        params![
            hook.id,
            hook.name,
            hook.description,
            hook.event,
            hook.kind,
            hook.enabled as i64,
            hook.timeout_ms.map(|value| value as i64),
            hook_config_json(hook)?,
            now_ms(),
        ],
    )
    .map_err(|e| format!("更新 automation_hooks 失败：{e}"))
}

struct TaskConfig {
    script: Option<String>,
    requests: Option<Vec<HttpRequestSpec>>,
    prompt: Option<String>,
    selected_model: Option<SelectedModelRef>,
    reasoning: Option<String>,
    workdir: Option<String>,
    timeout_seconds: Option<u64>,
}

fn parse_task_config(config_json: &str) -> TaskConfig {
    let map = serde_json::from_str::<Value>(config_json)
        .ok()
        .and_then(|value| match value {
            Value::Object(map) => Some(map),
            _ => None,
        })
        .unwrap_or_default();
    TaskConfig {
        script: map
            .get("script")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        requests: map
            .get("requests")
            .cloned()
            .and_then(|value| serde_json::from_value(value).ok()),
        prompt: map
            .get("prompt")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        selected_model: map
            .get("selectedModel")
            .cloned()
            .and_then(|value| serde_json::from_value(value).ok()),
        reasoning: map
            .get("reasoning")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        workdir: map
            .get("workdir")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        timeout_seconds: map.get("timeoutSeconds").and_then(Value::as_u64),
    }
}

fn cron_task_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CronTask> {
    let config_json: String = row.get("config_json")?;
    let config = parse_task_config(&config_json);
    Ok(CronTask {
        id: row.get("task_id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        cron: row.get("cron_expr")?,
        enabled: row.get::<_, i64>("enabled")? != 0,
        remaining_executions: row
            .get::<_, Option<i64>>("remaining_runs")?
            .map(|value| value.max(0) as u64),
        timeout_seconds: config
            .timeout_seconds
            .unwrap_or(DEFAULT_CRON_TIMEOUT_SECONDS),
        kind: row.get("kind")?,
        script: config.script,
        requests: config.requests,
        prompt: config.prompt,
        selected_model: config.selected_model,
        reasoning: config.reasoning,
        workdir: config.workdir,
        last_error: row.get("last_error")?,
    })
}

fn hook_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<HookDef> {
    let config_json: String = row.get("config_json")?;
    let config = parse_task_config(&config_json);
    Ok(HookDef {
        id: row.get("hook_id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        event: row.get("event")?,
        enabled: row.get::<_, i64>("enabled")? != 0,
        kind: row.get("kind")?,
        script: config.script,
        requests: config.requests,
        timeout_ms: row
            .get::<_, Option<i64>>("timeout_ms")?
            .map(|value| value.max(0) as u64),
    })
}

pub fn read_cron_tasks(conn: &Connection) -> Result<Vec<CronTask>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT task_id, name, description, cron_expr, kind, enabled, remaining_runs,
                    config_json, last_error
             FROM automation_cron_tasks
             ORDER BY sort_index ASC, task_id ASC",
        )
        .map_err(|e| format!("准备读取 automation_cron_tasks 失败：{e}"))?;
    let rows = stmt
        .query_map([], cron_task_from_row)
        .map_err(|e| format!("读取 automation_cron_tasks 失败：{e}"))?;
    let mut tasks = Vec::new();
    for row in rows {
        tasks.push(row.map_err(|e| format!("读取 automation_cron_tasks 行失败：{e}"))?);
    }
    Ok(tasks)
}

pub fn read_cron_task(conn: &Connection, task_id: &str) -> Result<Option<CronTask>, String> {
    conn.query_row(
        "SELECT task_id, name, description, cron_expr, kind, enabled, remaining_runs,
                config_json, last_error
         FROM automation_cron_tasks WHERE task_id = ?1",
        params![task_id],
        cron_task_from_row,
    )
    .optional()
    .map_err(|e| format!("读取 automation_cron_tasks.{task_id} 失败：{e}"))
}

pub fn read_hooks(conn: &Connection) -> Result<Vec<HookDef>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT hook_id, name, description, event, kind, enabled, timeout_ms, config_json
             FROM automation_hooks
             ORDER BY sort_index ASC, hook_id ASC",
        )
        .map_err(|e| format!("准备读取 automation_hooks 失败：{e}"))?;
    let rows = stmt
        .query_map([], hook_from_row)
        .map_err(|e| format!("读取 automation_hooks 失败：{e}"))?;
    let mut hooks = Vec::new();
    for row in rows {
        hooks.push(row.map_err(|e| format!("读取 automation_hooks 行失败：{e}"))?);
    }
    Ok(hooks)
}

pub fn read_hook(conn: &Connection, hook_id: &str) -> Result<Option<HookDef>, String> {
    conn.query_row(
        "SELECT hook_id, name, description, event, kind, enabled, timeout_ms, config_json
         FROM automation_hooks WHERE hook_id = ?1",
        params![hook_id],
        hook_from_row,
    )
    .optional()
    .map_err(|e| format!("读取 automation_hooks.{hook_id} 失败：{e}"))
}

pub fn read_cron_snapshot(conn: &Connection) -> Result<CronSnapshot, String> {
    Ok(CronSnapshot {
        revision: read_revision(conn, CRON_REVISION_KEY)?,
        tasks: read_cron_tasks(conn)?,
    })
}

pub fn read_hooks_snapshot(conn: &Connection) -> Result<HooksSnapshot, String> {
    Ok(HooksSnapshot {
        revision: read_revision(conn, HOOKS_REVISION_KEY)?,
        hooks: read_hooks(conn)?,
    })
}

fn run_record_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CronRunRecord> {
    let state_raw: String = row.get("state")?;
    Ok(CronRunRecord {
        id: row.get("execution_id")?,
        task_id: row.get("task_id")?,
        state: RunState::parse(&state_raw).unwrap_or(RunState::Done),
        success: row.get::<_, i64>("success")? != 0,
        started_at: row.get("started_at")?,
        finished_at: row.get("finished_at")?,
        duration_ms: row.get::<_, i64>("duration_ms")?.max(0) as u64,
        exit_code: row.get("exit_code")?,
        output: row.get("output")?,
    })
}

pub fn read_runs(
    conn: &Connection,
    task_id: &str,
    limit: usize,
) -> Result<Vec<CronRunRecord>, String> {
    let limit = limit.clamp(1, 500) as i64;
    let mut stmt = conn
        .prepare(
            "SELECT execution_id, task_id, state, success, started_at, finished_at,
                    duration_ms, exit_code, output
             FROM automation_cron_runs
             WHERE task_id = ?1
             ORDER BY started_at DESC, execution_id DESC
             LIMIT ?2",
        )
        .map_err(|e| format!("准备读取 automation_cron_runs 失败：{e}"))?;
    let rows = stmt
        .query_map(params![task_id, limit], run_record_from_row)
        .map_err(|e| format!("读取 automation_cron_runs 失败：{e}"))?;
    let mut runs = Vec::new();
    for row in rows {
        runs.push(row.map_err(|e| format!("读取 automation_cron_runs 行失败：{e}"))?);
    }
    Ok(runs)
}

/// Deletes finished runs beyond the per-task retention window plus anything
/// older than the global age cap. Delegated results remain available to an
/// offline initiating client; they need explicit inbox acknowledgement/retention.
/// Called inside the same transaction as the insert that grows the table.
pub fn prune_runs(conn: &Connection, task_id: &str) -> Result<(), String> {
    conn.execute(
        &format!(
            "DELETE FROM automation_cron_runs
             WHERE task_id = ?1 AND state IN ('done', 'expired')
             AND NOT EXISTS (SELECT 1 FROM automation_background_tasks b WHERE b.execution_id = automation_cron_runs.execution_id)
             AND execution_id NOT IN (
                 SELECT execution_id FROM automation_cron_runs
                 WHERE task_id = ?1 AND state IN ('done', 'expired')
                 ORDER BY started_at DESC, execution_id DESC
                 LIMIT {RUN_RETENTION_PER_TASK}
             )"
        ),
        params![task_id],
    )
    .map_err(|e| format!("修剪 automation_cron_runs 失败：{e}"))?;
    conn.execute(
        "DELETE FROM automation_cron_runs
         WHERE state IN ('done', 'expired') AND started_at < ?1
         AND NOT EXISTS (SELECT 1 FROM automation_background_tasks b WHERE b.execution_id = automation_cron_runs.execution_id)",
        params![now_ms() - RUN_RETENTION_MAX_AGE_MS],
    )
    .map_err(|e| format!("按时限修剪 automation_cron_runs 失败：{e}"))?;
    Ok(())
}
