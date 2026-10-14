use serde::{Deserialize, Serialize};
use super::*;

pub(super) const REVISION: &str = "goal_revision";

#[cfg(test)]
mod control_tests {
    use super::*;
    #[test]
    fn original_goal_store_is_checked_before_replay_or_mutation() {
        let store = AutomationStore::open_in_memory().unwrap();
        let snapshot = store.goal_snapshot().unwrap();
        let input = serde_json::json!({"revision":snapshot.revision,"requestId":"original-control","storeId":snapshot.store_id,
            "operation":{"op":"create","id":"fitness","config":{"title":"Fitness","description":"","category":"health","parentId":null,"steps":[]}}});
        let accepted = store.goal_apply(serde_json::from_value(input.clone()).unwrap()).unwrap();
        assert_eq!(accepted.control_version, 1);
        assert_eq!(store.goal_apply(serde_json::from_value(input.clone()).unwrap()).unwrap().revision, accepted.revision);
        store.lock_conn().unwrap().execute("UPDATE automation_meta SET value='replacement-store' WHERE key='goal_store_id.v1'", []).unwrap();
        assert_eq!(store.goal_apply(serde_json::from_value(input).unwrap()).unwrap_err(), "goals.ownerChanged");
        assert_eq!(store.goal_snapshot().unwrap().revision, accepted.revision);
        assert_eq!(store.goal_snapshot().unwrap().goals.len(), 1);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GoalStep { pub id: String, pub title: String, pub done: bool }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GoalConfig {
    pub title: String,
    pub description: String,
    pub category: String,
    pub parent_id: Option<String>,
    pub steps: Vec<GoalStep>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum GoalOperation {
    Create { id: String, config: GoalConfig },
    Update { id: String, config: GoalConfig },
    SetStatus { id: String, status: String },
    SetStep { id: String, step_id: String, done: bool },
    LinkTask { id: String, task_id: String, #[serde(default,skip_serializing_if="Option::is_none")] follow_up: Option<bool> },
    UnlinkTask { id: String, task_id: String },
    LinkWork { id: String, request_id: String },
    UnlinkWork { id: String, request_id: String },
    Delete { id: String },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GoalApplyInput { pub revision: u64, pub request_id: String, pub operation: GoalOperation,
    #[serde(default)] pub store_id: Option<String> }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalTask {
    pub id: String, pub name: String, pub enabled: bool, pub exists: bool, pub cron: Option<String>,
    #[serde(skip_serializing_if="is_false")]
    pub follow_up:bool,
    #[serde(skip_serializing_if="Option::is_none")]
    pub follow_up_blocked:Option<String>,
    #[serde(skip_serializing_if="is_false")]
    pub follow_up_eligible:bool,
}
fn is_false(value:&bool)->bool{!*value}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalWork {
    pub request_id: String, pub name: String, pub state: Option<String>,
    pub success: Option<bool>, pub exists: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalArtifact {
    pub id: String, pub relative_path: String, pub content_hash: String, pub bytes: u64,
    pub request_id: String, pub task_name: String, pub at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalArtifactsPage {
    pub goal_id: String, pub store_id: String, pub items: Vec<GoalArtifact>,
    pub next_cursor: Option<GoalActivityCursor>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalRecord {
    pub id: String, pub config: GoalConfig, pub status: String,
    pub created_at: i64, pub updated_at: i64, pub tasks: Vec<GoalTask>,
    pub background_tasks: Vec<GoalWork>, pub artifact_count: u64, pub launch_blocked: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalSnapshot { pub revision: u64, pub store_id: String, pub goals: Vec<GoalRecord>, pub targets: Vec<GoalTask>, pub background_targets: Vec<GoalWork>, pub launch_version: u32, pub control_version: u32 }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GoalActivityCursor { pub at: i64, pub id: String }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalActivity {
    pub id: String, pub kind: String, pub label: String, pub at: i64,
    pub state: Option<String>, pub success: Option<bool>, pub output: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalActivityPage { pub goal_id: String, pub items: Vec<GoalActivity>, pub next_cursor: Option<GoalActivityCursor> }

fn identity(value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 80 || !value.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-') {
        return Err("goals.invalidIdentity".into());
    }
    Ok(())
}

pub(super) fn read_config(conn: &Connection, id: &str) -> Result<GoalConfig, String> {
    identity(id)?;
    let raw: Option<String> = conn.query_row("SELECT config_json FROM automation_goals WHERE goal_id = ?1", params![id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    serde_json::from_str(&raw.ok_or("goals.missing")?).map_err(|e| format!("Saved goal could not be read: {e}"))
}

fn validate_config(conn: &Connection, id: &str, config: &mut GoalConfig) -> Result<(), String> {
    identity(id)?;
    config.title = config.title.trim().into();
    if config.title.is_empty() || config.title.chars().count() > 160 || config.description.chars().count() > 8000
        || !["health", "relationships", "finance", "career", "interests", "productivity", "custom"].contains(&config.category.as_str())
        || config.steps.len() > 40 { return Err("goals.invalidConfig".into()); }
    let mut ids = std::collections::HashSet::new();
    for step in &mut config.steps {
        identity(&step.id)?;
        step.title = step.title.trim().into();
        if !ids.insert(step.id.clone()) || step.title.is_empty() || step.title.chars().count() > 160 { return Err("goals.invalidConfig".into()); }
    }
    let mut parent = config.parent_id.clone();
    let mut seen = std::collections::HashSet::from([id.to_owned()]);
    while let Some(parent_id) = parent {
        identity(&parent_id)?;
        if !seen.insert(parent_id.clone()) || seen.len() > 100 { return Err("goals.parentCycle".into()); }
        parent = read_config(conn, &parent_id)?.parent_id;
    }
    Ok(())
}

pub(super) fn activity(conn: &Connection, id: &str, kind: &str, label: &str, now: i64) -> Result<(), String> {
    conn.execute("INSERT INTO automation_goal_activities (goal_id, kind, label, occurred_at) VALUES (?1, ?2, ?3, ?4)", params![id, kind, label, now]).map_err(|e| e.to_string())?;
    // Keep a bounded audit per goal; execution logs retain their own policy.
    conn.execute("DELETE FROM automation_goal_activities WHERE goal_id = ?1 AND sequence NOT IN (SELECT sequence FROM automation_goal_activities WHERE goal_id = ?1 ORDER BY sequence DESC LIMIT 200)", params![id]).map_err(|e| e.to_string())?;
    conn.execute("UPDATE automation_goals SET updated_at = ?2 WHERE goal_id = ?1", params![id, now]).map_err(|e| e.to_string())?;
    Ok(())
}

pub(super) fn snapshot(conn: &Connection) -> Result<GoalSnapshot, String> {
    let mut stmt = conn.prepare("SELECT goal_id, config_json, status, created_at, updated_at FROM automation_goals ORDER BY created_at DESC, goal_id").map_err(|e| e.to_string())?;
    let raw = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, i64>(3)?, row.get::<_, i64>(4)?))).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    let mut goals = Vec::new();
    for (id, raw, status, created_at, updated_at) in raw {
        let config = serde_json::from_str(&raw).map_err(|e| format!("Saved goal could not be read: {e}"))?;
        let mut tasks = conn.prepare("SELECT l.task_id, COALESCE(t.name, l.task_name), COALESCE(t.enabled, 0), t.task_id IS NOT NULL, t.cron_expr FROM automation_goal_tasks l LEFT JOIN automation_cron_tasks t ON t.task_id = l.task_id WHERE l.goal_id = ?1 ORDER BY l.linked_at, l.task_id").map_err(|e| e.to_string())?;
        let mut tasks = tasks.query_map(params![id], |row| Ok(GoalTask { id: row.get(0)?, name: row.get(1)?, enabled: row.get(2)?, exists: row.get(3)?, cron: row.get(4)?,follow_up:false,follow_up_blocked:None,follow_up_eligible:false })).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        for task in &mut tasks{
            let (enabled,blocked)=super::goal_prompt::followup_status(conn,&id,&task.id)?;
            task.follow_up=enabled;task.follow_up_blocked=blocked;
            if status=="active"{
                if let Some(actual)=db::read_cron_task(conn,&task.id)?{task.follow_up_eligible=super::goal_prompt::followup_capable(conn,&actual)?;}
            }
        }
        let mut work = conn.prepare("SELECT l.request_id, COALESCE(json_extract(b.input_json, '$.name'), remote.task_name, l.task_name),
            COALESCE(r.state, CASE WHEN outgoing.cancel_requested = 1 THEN json_extract(outgoing.cancel_json, '$.run.state') END,
                json_extract(remote.payload_json, '$.run.state'),
                CASE WHEN outgoing.request_id IS NOT NULL THEN
                    CASE WHEN outgoing.cancel_requested = 1 THEN 'stopping' ELSE 'submitting' END END) AS state,
            COALESCE(r.success, CASE WHEN outgoing.cancel_requested = 1 THEN json_extract(outgoing.cancel_json, '$.run.success') END,
                json_extract(remote.payload_json, '$.run.success')) AS success,
            b.request_id IS NOT NULL OR remote.request_id IS NOT NULL OR outgoing.request_id IS NOT NULL
            FROM automation_goal_display_work l LEFT JOIN automation_background_tasks b ON b.request_id = l.request_id
            LEFT JOIN automation_cron_runs r ON r.execution_id = b.execution_id
            LEFT JOIN automation_goal_remote_work remote ON remote.request_id = l.request_id
            LEFT JOIN automation_submission_outbox outgoing ON outgoing.request_id = l.request_id
                AND outgoing.initiating_host_id = (SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1')
            WHERE l.goal_id = ?1 ORDER BY l.linked_at, l.request_id").map_err(|e| e.to_string())?;
        let background_tasks = work.query_map(params![id], |row| Ok(GoalWork { request_id: row.get(0)?, name: row.get(1)?, state: row.get(2)?, success: row.get(3)?, exists: row.get(4)? })).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        let artifact_count = conn.query_row("SELECT
            (SELECT COUNT(*) FROM automation_goal_all_work l JOIN automation_background_tasks b ON b.request_id = l.request_id
             JOIN automation_background_artifacts a ON a.execution_id = b.execution_id WHERE l.goal_id = ?1) +
            (SELECT COUNT(*) FROM automation_goal_all_work l JOIN automation_goal_remote_artifacts a ON a.request_id = l.request_id WHERE l.goal_id = ?1)", params![id], |row| row.get(0)).map_err(|e| e.to_string())?;
        let launch_blocked = super::goal_launch::has_active_work(conn, &id)?;
        goals.push(GoalRecord { id, config, status, created_at, updated_at, tasks, background_tasks, artifact_count, launch_blocked });
    }
    let targets = db::read_cron_snapshot(conn)?.tasks.into_iter().map(|task| GoalTask { id: task.id, name: task.name, enabled: task.enabled, exists: true, cron: Some(task.cron),follow_up:false,follow_up_blocked:None,follow_up_eligible:false }).collect();
    let store_id = conn.query_row("SELECT value FROM automation_meta WHERE key = 'goal_store_id.v1'", [], |row| row.get(0)).map_err(|e| e.to_string())?;
    let mut work = conn.prepare("SELECT request_id, name, state, success FROM (
        SELECT b.request_id, json_extract(b.input_json, '$.name') AS name, r.state, r.success, b.created_at
        FROM automation_background_tasks b JOIN automation_cron_runs r ON r.execution_id = b.execution_id
        UNION ALL
        SELECT request_id, task_name, json_extract(payload_json, '$.run.state'), json_extract(payload_json, '$.run.success'), created_at
        FROM automation_goal_remote_work
        ) ORDER BY created_at DESC, request_id DESC LIMIT 50").map_err(|e| e.to_string())?;
    let background_targets = work.query_map([], |row| Ok(GoalWork { request_id: row.get(0)?, name: row.get(1)?, state: row.get(2)?, success: row.get(3)?, exists: true })).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    Ok(GoalSnapshot { revision: db::read_revision(conn, REVISION)?, store_id, goals, targets, background_targets, launch_version: 1, control_version: 1 })
}

impl AutomationStore {
    /// Called only for a newly accepted request, inside the queue's immediate transaction.
    /// Exact receipt replay must never relink a goal or restart stopped work.
    pub(super) fn accept_background_goal(conn: &Connection, goal: &BackgroundGoalBinding, request_id: &str, name: &str, now: i64) -> Result<(), String> {
        goal.validate()?;
        let store_id: String = conn.query_row("SELECT value FROM automation_meta WHERE key = 'goal_store_id.v1'", [], |row| row.get(0)).map_err(|e| e.to_string())?;
        if store_id != goal.store_id { return Err("goals.ownerChanged".into()); }
        if db::read_revision(conn, REVISION)? != goal.revision { return Err("goals.conflict".into()); }
        read_config(conn, &goal.goal_id)?;
        let status: String = conn.query_row("SELECT status FROM automation_goals WHERE goal_id = ?1", params![goal.goal_id], |row| row.get(0)).map_err(|e| e.to_string())?;
        if status != "active" { return Err("goals.notActive".into()); }
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM automation_goal_work WHERE goal_id = ?1", params![goal.goal_id], |row| row.get(0)).map_err(|e| e.to_string())?;
        if count >= 32 { return Err("goals.workLimit".into()); }
        conn.execute("INSERT INTO automation_goal_work (goal_id, request_id, task_name, linked_at) VALUES (?1, ?2, ?3, ?4)", params![goal.goal_id, request_id, name, now]).map_err(|e| e.to_string())?;
        activity(conn, &goal.goal_id, "work_linked", name, now)?;
        db::bump_revision(conn, REVISION)?;
        Ok(())
    }

    pub fn goal_snapshot(&self) -> Result<GoalSnapshot, String> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let result = snapshot(&tx)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(result)
    }

    pub fn goal_apply(&self, input: GoalApplyInput) -> Result<GoalSnapshot, String> {
        if input.request_id.is_empty() || input.request_id.len() > 200 || input.request_id.chars().any(char::is_control) { return Err("goals.invalidIdentity".into()); }
        let raw = serde_json::to_string(&input.operation).map_err(|e| e.to_string())?;
        if raw.len() > 64000 { return Err("goals.invalidConfig".into()); }
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        // Check the original store in the same transaction as receipts and CAS.
        // Reinstalling a PC must not apply an old control to its replacement DB.
        if let Some(expected) = &input.store_id {
            identity(expected)?;
            let actual: String = tx.query_row("SELECT value FROM automation_meta WHERE key = 'goal_store_id.v1'", [], |row| row.get(0)).map_err(|e| e.to_string())?;
            if &actual != expected { return Err("goals.ownerChanged".into()); }
        }
        let receipt: Option<String> = tx.query_row("SELECT operation_json FROM automation_goal_receipts WHERE request_id = ?1", params![input.request_id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
        if let Some(previous) = receipt {
            if previous != raw { return Err("goals.requestChanged".into()); }
            return snapshot(&tx);
        }
        if db::read_revision(&tx, REVISION)? != input.revision { return Err("goals.conflict".into()); }
        let now = db::now_ms();
        match input.operation {
            GoalOperation::Create { id, mut config } => {
                let count: i64 = tx.query_row("SELECT COUNT(*) FROM automation_goals", [], |row| row.get(0)).map_err(|e| e.to_string())?;
                if count >= 100 { return Err("goals.limit".into()); }
                validate_config(&tx, &id, &mut config)?;
                tx.execute("INSERT INTO automation_goals (goal_id, config_json, status, parent_id, created_at, updated_at) VALUES (?1, ?2, 'active', ?3, ?4, ?4)", params![id, serde_json::to_string(&config).map_err(|e| e.to_string())?, config.parent_id, now]).map_err(|e| e.to_string())?;
                activity(&tx, &id, "created", &config.title, now)?;
            }
            GoalOperation::Update { id, mut config } => {
                let previous=read_config(&tx, &id)?;
                validate_config(&tx, &id, &mut config)?;
                for step in &config.steps {
                    if !step.done && previous.steps.iter().any(|old|old.id==step.id && old.done){
                        super::goal_progress::fence_reset(&tx,&id,&step.id,now)?;
                    }
                }
                tx.execute("UPDATE automation_goals SET config_json = ?2, parent_id = ?3 WHERE goal_id = ?1", params![id, serde_json::to_string(&config).map_err(|e| e.to_string())?, config.parent_id]).map_err(|e| e.to_string())?;
                activity(&tx, &id, "updated", &config.title, now)?;
            }
            GoalOperation::SetStatus { id, status } => {
                let config = read_config(&tx, &id)?;
                if !["active", "paused", "completed"].contains(&status.as_str()) { return Err("goals.invalidConfig".into()); }
                tx.execute("UPDATE automation_goals SET status = ?2 WHERE goal_id = ?1", params![id, status]).map_err(|e| e.to_string())?;
                activity(&tx, &id, &status, &config.title, now)?;
            }
            GoalOperation::SetStep { id, step_id, done } => {
                let mut config = read_config(&tx, &id)?;
                let step = config.steps.iter_mut().find(|step| step.id == step_id).ok_or("goals.missingStep")?;
                step.done = done;
                let title = step.title.clone();
                if !done {
                    super::goal_progress::fence_reset(&tx,&id,&step_id,now)?;
                }
                tx.execute("UPDATE automation_goals SET config_json = ?2 WHERE goal_id = ?1", params![id, serde_json::to_string(&config).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
                activity(&tx, &id, if done { "step_done" } else { "step_reopened" }, &title, now)?;
            }
            GoalOperation::LinkTask { id, task_id, follow_up } => {
                read_config(&tx, &id)?;
                let task = db::read_cron_task(&tx, &task_id)?.ok_or("goals.missingTask")?;
                if tx.execute("INSERT OR IGNORE INTO automation_goal_tasks (goal_id, task_id, task_name, linked_at) VALUES (?1, ?2, ?3, ?4)", params![id, task_id, task.name, now]).map_err(|e| e.to_string())? > 0 {
                    activity(&tx, &id, "task_linked", &task.name, now)?;
                }
                if let Some(enabled)=follow_up{
                    super::goal_prompt::set_followup(&tx,&id,&task,enabled)?;
                    activity(&tx,&id,if enabled{"followup_enabled"}else{"followup_disabled"},&task.name,now)?;
                }
            }
            GoalOperation::UnlinkTask { id, task_id } => {
                read_config(&tx, &id)?;
                let label: String = tx.query_row("SELECT task_name FROM automation_goal_tasks WHERE goal_id = ?1 AND task_id = ?2", params![id, task_id], |row| row.get(0)).map_err(|_| "goals.missingTask".to_string())?;
                tx.execute("DELETE FROM automation_goal_tasks WHERE goal_id = ?1 AND task_id = ?2", params![id, task_id]).map_err(|e| e.to_string())?;
                tx.execute("DELETE FROM automation_goal_prompt_links WHERE goal_id=?1 AND task_id=?2",params![id,task_id]).map_err(|e|e.to_string())?;
                activity(&tx, &id, "task_unlinked", &label, now)?;
            }
            GoalOperation::LinkWork { id, request_id } => {
                read_config(&tx, &id)?;
                if !Uuid::parse_str(&request_id).is_ok_and(|value| value.to_string() == request_id) { return Err("goals.invalidIdentity".into()); }
                let label: Option<String> = tx.query_row("SELECT name FROM (
                    SELECT json_extract(input_json, '$.name') AS name FROM automation_background_tasks WHERE request_id = ?1
                    UNION ALL SELECT task_name FROM automation_goal_remote_work WHERE request_id = ?1
                    ) LIMIT 1", params![request_id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
                let label = label.ok_or("goals.missingTask")?;
                let count: i64 = tx.query_row("SELECT COUNT(*) FROM automation_goal_work WHERE goal_id = ?1", params![id], |row| row.get(0)).map_err(|e| e.to_string())?;
                let linked: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_goal_work WHERE goal_id = ?1 AND request_id = ?2)", params![id, request_id], |row| row.get(0)).map_err(|e| e.to_string())?;
                if !linked && count >= 32 { return Err("goals.workLimit".into()); }
                if tx.execute("INSERT OR IGNORE INTO automation_goal_work (goal_id, request_id, task_name, linked_at) VALUES (?1, ?2, ?3, ?4)", params![id, request_id, label, now]).map_err(|e| e.to_string())? > 0 {
                    activity(&tx, &id, "work_linked", &label, now)?;
                }
            }
            GoalOperation::UnlinkWork { id, request_id } => {
                read_config(&tx, &id)?;
                let label: String = tx.query_row("SELECT task_name FROM automation_goal_all_work WHERE goal_id = ?1 AND request_id = ?2", params![id, request_id], |row| row.get(0)).optional().map_err(|e| e.to_string())?.ok_or("goals.missingTask")?;
                tx.execute("DELETE FROM automation_goal_work WHERE goal_id = ?1 AND request_id = ?2", params![id, request_id]).map_err(|e| e.to_string())?;
                tx.execute("UPDATE automation_goal_event_work SET unlinked=1 WHERE goal_id=?1 AND request_id=?2",params![id,request_id]).map_err(|e|e.to_string())?;
                activity(&tx, &id, "work_unlinked", &label, now)?;
            }
            GoalOperation::Delete { id } => {
                read_config(&tx, &id)?;
                let children: i64 = tx.query_row("SELECT COUNT(*) FROM automation_goals WHERE parent_id = ?1", params![id], |row| row.get(0)).map_err(|e| e.to_string())?;
                if children > 0 { return Err("goals.hasChildren".into()); }
                for table in ["automation_goal_prompt_links", "automation_goal_prompt_rotation", "automation_goal_tasks", "automation_goal_event_work", "automation_goal_work", "automation_goal_activities", "automation_goals"] {
                    tx.execute(&format!("DELETE FROM {table} WHERE goal_id = ?1"), params![id]).map_err(|e| e.to_string())?;
                }
            }
        }
        db::bump_revision(&tx, REVISION)?;
        tx.execute("INSERT INTO automation_goal_receipts (request_id, operation_json, created_at) VALUES (?1, ?2, ?3)", params![input.request_id, raw, now]).map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM automation_goal_receipts WHERE request_id NOT IN (SELECT request_id FROM automation_goal_receipts ORDER BY created_at DESC, rowid DESC LIMIT 512)", []).map_err(|e| e.to_string())?;
        let result = snapshot(&tx)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(result)
    }

    pub fn goal_activity(&self, id: &str, cursor: Option<GoalActivityCursor>, limit: u32) -> Result<GoalActivityPage, String> {
        identity(id)?;
        if !(1..=50).contains(&limit) || cursor.as_ref().is_some_and(|c| c.at < 0 || c.id.len() > 200 || c.id.is_empty()) { return Err("goals.invalidConfig".into()); }
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        read_config(&tx, id)?;
        let mut stmt = tx.prepare("SELECT id, kind, label, at, state, success, output FROM (
            SELECT 'edit:' || sequence AS id, kind, label, occurred_at AS at, NULL AS state, NULL AS success, NULL AS output FROM automation_goal_activities WHERE goal_id = ?1
            UNION ALL
            SELECT 'run:' || r.execution_id AS id, 'run' AS kind, COALESCE(t.name, l.task_name) AS label, r.started_at AS at, r.state, r.success, substr(r.output, 1, 2000) AS output
            FROM automation_goal_tasks l JOIN automation_cron_runs r ON r.task_id = l.task_id LEFT JOIN automation_cron_tasks t ON t.task_id = l.task_id
            WHERE l.goal_id = ?1 AND r.started_at >= l.linked_at
            UNION ALL
            SELECT 'work:' || r.execution_id AS id, 'run' AS kind, COALESCE(json_extract(b.input_json, '$.name'), l.task_name) AS label,
                r.started_at AS at, r.state, r.success, substr(r.output, 1, 2000) AS output
            FROM automation_goal_all_work l JOIN automation_background_tasks b ON b.request_id = l.request_id
            JOIN automation_cron_runs r ON r.execution_id = b.execution_id WHERE l.goal_id = ?1
            UNION ALL
            SELECT 'remote:' || remote.source_host_id || ':' || json_extract(remote.payload_json, '$.run.id'),
                'run', remote.task_name, json_extract(remote.payload_json, '$.run.startedAt'),
                json_extract(remote.payload_json, '$.run.state'), json_extract(remote.payload_json, '$.run.success'),
                substr(json_extract(remote.payload_json, '$.run.output'), 1, 2000)
            FROM automation_goal_all_work l JOIN automation_goal_remote_work remote ON remote.request_id = l.request_id
            WHERE l.goal_id = ?1
        ) WHERE (?2 IS NULL OR at < ?2 OR (at = ?2 AND id < ?3)) ORDER BY at DESC, id DESC LIMIT ?4").map_err(|e| e.to_string())?;
        let mut items = stmt.query_map(params![id, cursor.as_ref().map(|c| c.at), cursor.as_ref().map(|c| c.id.as_str()), limit + 1], |row| Ok(GoalActivity { id: row.get(0)?, kind: row.get(1)?, label: row.get(2)?, at: row.get(3)?, state: row.get(4)?, success: row.get(5)?, output: row.get(6)? })).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        let next_cursor = if items.len() > limit as usize { items.truncate(limit as usize); items.last().map(|item| GoalActivityCursor { at: item.at, id: item.id.clone() }) } else { None };
        drop(stmt);
        tx.commit().map_err(|e| e.to_string())?;
        Ok(GoalActivityPage { goal_id: id.into(), items, next_cursor })
    }

    pub fn goal_artifacts(&self, id: &str, cursor: Option<GoalActivityCursor>, limit: u32) -> Result<GoalArtifactsPage, String> {
        identity(id)?;
        if !(1..=50).contains(&limit) || cursor.as_ref().is_some_and(|c| c.at < 0 || c.id.len() > 200 || c.id.is_empty()) { return Err("goals.invalidConfig".into()); }
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        read_config(&tx, id)?;
        let store_id = tx.query_row("SELECT value FROM automation_meta WHERE key = 'goal_store_id.v1'", [], |row| row.get(0)).map_err(|e| e.to_string())?;
        let mut stmt = tx.prepare("SELECT a.artifact_id, a.relative_path, a.content_hash, a.bytes, b.request_id, json_extract(b.input_json, '$.name'), a.created_at
            FROM automation_goal_all_work l JOIN automation_background_tasks b ON b.request_id = l.request_id
            JOIN automation_background_artifacts a ON a.execution_id = b.execution_id
            WHERE l.goal_id = ?1 AND (?2 IS NULL OR a.created_at < ?2 OR (a.created_at = ?2 AND a.artifact_id < ?3))
            UNION ALL
            SELECT a.artifact_id, a.relative_path, a.content_hash, a.bytes, a.request_id, a.task_name, a.created_at
            FROM automation_goal_all_work l JOIN automation_goal_remote_artifacts a ON a.request_id = l.request_id
            WHERE l.goal_id = ?1 AND (?2 IS NULL OR a.created_at < ?2 OR (a.created_at = ?2 AND a.artifact_id < ?3))
            ORDER BY 7 DESC, 1 DESC LIMIT ?4").map_err(|e| e.to_string())?;
        let mut items = stmt.query_map(params![id, cursor.as_ref().map(|c| c.at), cursor.as_ref().map(|c| c.id.as_str()), limit + 1], |row| Ok(GoalArtifact {
            id: row.get(0)?, relative_path: row.get(1)?, content_hash: row.get(2)?, bytes: row.get(3)?, request_id: row.get(4)?, task_name: row.get(5)?, at: row.get(6)?,
        })).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        let next_cursor = if items.len() > limit as usize { items.truncate(limit as usize); items.last().map(|item| GoalActivityCursor { at: item.at, id: item.id.clone() }) } else { None };
        drop(stmt);
        tx.commit().map_err(|e| e.to_string())?;
        Ok(GoalArtifactsPage { goal_id: id.into(), store_id, items, next_cursor })
    }

    pub fn goal_artifact_content(&self, id: &str, request_id: &str, artifact_id: &str) -> Result<BackgroundArtifactContent, String> {
        identity(id)?;
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        read_config(&tx, id)?;
        let linked: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_goal_all_work WHERE goal_id = ?1 AND request_id = ?2)", params![id, request_id], |row| row.get(0)).map_err(|e| e.to_string())?;
        if !linked { return Err("goals.missingTask".into()); }
        let result = Self::read_background_artifact_content(&tx, request_id, artifact_id)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(result)
    }

    pub fn goal_remote_artifact_entry(&self, id: &str, request_id: &str, artifact_id: &str) -> Result<Option<String>, String> {
        identity(id)?;
        let conn = self.lock_conn()?;
        read_config(&conn, id)?;
        conn.query_row("SELECT a.entry_id FROM automation_goal_all_work l
            JOIN automation_goal_remote_artifacts a ON a.request_id = l.request_id
            WHERE l.goal_id = ?1 AND a.request_id = ?2 AND a.artifact_id = ?3",
            params![id, request_id, artifact_id], |row| row.get(0)).optional().map_err(|e| e.to_string())
    }
}
