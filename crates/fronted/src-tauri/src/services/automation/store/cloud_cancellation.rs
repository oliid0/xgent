//! Only explicit cancellation of the original task creates remote intent.
//! Lost responses and invisible runs remain pending across app restarts.
use super::*;
use sha2::{Digest, Sha256};
use crate::services::cloud_execution::{CloudTaskLocator, CloudTaskStatus};

impl AutomationStore {
    pub(super) fn enqueue_background_cloud_cancellations(conn: &Connection, id: &str, now: i64) -> Result<(), String> {
        conn.execute(
            "INSERT OR IGNORE INTO automation_background_cloud_cancellations (execution_id,call_id,requested_at,retry_at)
             SELECT c.execution_id,c.call_id,?2,?2 FROM automation_background_cloud_launches c
             JOIN automation_background_tasks b ON b.execution_id = c.execution_id
             JOIN automation_background_configuration_bindings binding ON binding.execution_id = c.execution_id
             JOIN automation_background_operations o ON o.execution_id = c.execution_id AND o.call_id = c.call_id
             JOIN automation_background_operation_leases l ON l.execution_id = c.execution_id AND l.call_id = c.call_id
             WHERE c.execution_id = ?1 AND o.tool_name = 'CloudTaskManager'",
            params![id,now],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub(super) fn background_cloud_cancellation_summary(conn: &Connection, id: &str) -> Result<BackgroundCloudCancellationSummary, String> {
        conn.query_row(
            "SELECT COALESCE(SUM(terminal_at IS NULL),0),COALESCE(SUM(terminal_at IS NOT NULL),0) FROM automation_background_cloud_cancellations WHERE execution_id = ?1",
            params![id], |row| Ok(BackgroundCloudCancellationSummary { pending: row.get(0)?, observed_terminal: row.get(1)? }),
        ).map_err(|e| e.to_string())
    }

    /// Selection and a fresh probe fence/backoff persist before any network I/O.
    pub fn due_background_cloud_cancellations(&self) -> Result<Vec<(String,String,String)>, String> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let now = db::now_ms();
        let rows = {
            let mut query = tx.prepare(
                "SELECT c.execution_id,c.call_id,c.probes FROM automation_background_cloud_cancellations c
                 JOIN automation_cron_runs r ON r.execution_id = c.execution_id
                 WHERE r.state = 'expired' AND c.terminal_at IS NULL AND c.retry_at <= ?1
                 ORDER BY c.retry_at,c.execution_id,c.call_id LIMIT 4",
            ).map_err(|e| e.to_string())?;
            let mapped = query.query_map(params![now], |row| Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,u32>(2)?))).map_err(|e| e.to_string())?;
            mapped.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?
        };
        let mut due = Vec::new();
        for (id,call,probes) in rows {
            let probes = probes.saturating_add(1).min(32);
            let retry = now + (30_000i64 * (1i64 << probes.min(5))).min(900_000);
            let token = Uuid::new_v4().to_string();
            tx.execute("UPDATE automation_background_cloud_cancellations SET retry_at = ?3, probes = ?4, probe_token = ?5 WHERE execution_id = ?1 AND call_id = ?2 AND terminal_at IS NULL", params![id,call,retry,probes,token]).map_err(|e| e.to_string())?;
            due.push((id,call,token));
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(due)
    }

    /// No live execution lease is required after cancellation. Authority still
    /// belongs to the accepted task/configuration and its native reservation.
    pub fn prepare_background_cloud_cancellation(&self, id: &str, call: &str, probe: &str,
        load: impl FnOnce(&Connection,&SubmitBackgroundTaskInput) -> Result<(String,Value),String>,
    ) -> Result<(CloudTaskLocator,Option<u64>),String> {
        let conn = self.lock_conn()?;
        Self::prepare_cloud_cancellation_on_connection(&conn,id,call,probe,load)
    }

    fn prepare_cloud_cancellation_on_connection(conn: &Connection, id: &str, call: &str, probe: &str,
        load: impl FnOnce(&Connection,&SubmitBackgroundTaskInput) -> Result<(String,Value),String>,
    ) -> Result<(CloudTaskLocator,Option<u64>),String> {
        let settings = Self::verify_background_binding(conn,id,load)?;
        if settings["access"]["cloudExecutionEnabled"] != true { return Err("Cloud cancellation is waiting for its original enabled configuration".into()); }
        let original: Option<(String,String,String,String,String,Option<u64>)> = conn.query_row(
            "SELECT c.task_id,c.owner,c.repository,c.arguments_hash,o.arguments_json,x.run_id FROM automation_background_cloud_cancellations x
             JOIN automation_background_cloud_launches c ON c.execution_id = x.execution_id AND c.call_id = x.call_id
             JOIN automation_background_operations o ON o.execution_id = c.execution_id AND o.call_id = c.call_id
             JOIN automation_background_operation_leases l ON l.execution_id = c.execution_id AND l.call_id = c.call_id
             JOIN automation_cron_runs r ON r.execution_id = c.execution_id
             WHERE x.execution_id = ?1 AND x.call_id = ?2 AND x.probe_token = ?3 AND x.terminal_at IS NULL
             AND r.state = 'expired' AND o.tool_name = 'CloudTaskManager'",
            params![id,call,probe], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?)),
        ).optional().map_err(|e| e.to_string())?;
        let (task_id,owner,repository,hash,raw,run_id) = original.ok_or_else(|| "Original cloud cancellation occurrence changed".to_string())?;
        let args: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        if args["action"] != "start" || args.get("owner").is_some() || args.get("repository").is_some()
            || hash != hex::encode(Sha256::digest(raw.as_bytes()))
            || owner != settings["access"]["githubOwner"].as_str().unwrap_or_default().trim()
            || repository != crate::services::cloud_execution::normalize_repository_name(settings["access"]["githubRepository"].as_str().unwrap_or_default())? {
            return Err("Original cloud cancellation reservation/configuration changed".into());
        }
        Ok((CloudTaskLocator { owner, repository, task_id },run_id))
    }

    /// 202 only records accepted_at. Only a positive native GET of the actual
    /// run in 'completed' state settles the request, whatever its conclusion.
    /// Neither this observation nor a late success can reopen the original run.
    pub(crate) fn record_background_cloud_cancellation(&self, id: &str, call: &str, probe: &str,
        status: &CloudTaskStatus, accepted: bool,
        load: impl FnOnce(&Connection,&SubmitBackgroundTaskInput) -> Result<(String,Value),String>,
    ) -> Result<bool,String> {
        // Recheck account/configuration after I/O before trusting its result.
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let (locator,known_run) = Self::prepare_cloud_cancellation_on_connection(&tx,id,call,probe,load)?;
        if status.task_id != locator.task_id || status.run_id.is_none_or(|run| run == 0 || run > i64::MAX as u64)
            || known_run.is_some_and(|run| Some(run) != status.run_id) {
            return Err("Cloud cancellation requires the original positive native run identity".into());
        }
        let terminal = status.state == "completed";
        let now = db::now_ms();
        let changed = tx.execute(
            "UPDATE automation_background_cloud_cancellations SET run_id = ?4, observed_state = ?5, conclusion = ?6,
             accepted_at = CASE WHEN ?7 THEN COALESCE(accepted_at,?8) ELSE accepted_at END,
             terminal_at = CASE WHEN ?9 THEN ?8 ELSE NULL END, last_error = NULL
             WHERE execution_id = ?1 AND call_id = ?2 AND probe_token = ?3 AND terminal_at IS NULL
             AND (run_id IS NULL OR run_id = ?4)
             AND EXISTS (SELECT 1 FROM automation_cron_runs r WHERE r.execution_id = ?1 AND r.state = 'expired')",
            params![id,call,probe,status.run_id.map(|run| run as i64),status.state,status.conclusion,accepted,now,terminal],
        ).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(changed == 1 && terminal)
    }

    pub fn record_background_cloud_cancellation_error(&self, id: &str, call: &str, probe: &str, message: &str) -> Result<(),String> {
        let conn = self.lock_conn()?;
        conn.execute("UPDATE automation_background_cloud_cancellations SET last_error = ?4 WHERE execution_id = ?1 AND call_id = ?2 AND probe_token = ?3 AND terminal_at IS NULL", params![id,call,probe,message.chars().take(512).collect::<String>()]).map_err(|e| e.to_string())?;
        Ok(())
    }
}
