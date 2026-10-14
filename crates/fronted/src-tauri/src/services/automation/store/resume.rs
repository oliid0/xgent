use super::*;

const MAX_AUTOMATIC_ATTEMPTS: u64 = 3;

impl AutomationStore {
    /// Called once at startup, before any worker exists. Keep task identity and
    /// evidence; never replay an operation whose external outcome is unknown.
    pub(super) fn requeue_recoverable_background_runs(&self) -> Result<usize, String> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let candidates = {
            let mut stmt = tx.prepare(
                "SELECT r.execution_id, r.request_json, l.attempt, l.generation FROM automation_cron_runs r
                 JOIN automation_background_tasks b ON b.execution_id = r.execution_id
                 JOIN automation_background_leases l ON l.execution_id = r.execution_id
                 JOIN automation_background_configuration_bindings c ON c.execution_id = r.execution_id
                 WHERE r.state = 'leased' AND r.request_json IS NOT NULL AND l.attempt > 0
                 AND l.attempt < ?1 + (SELECT COUNT(*) FROM automation_background_resumptions w WHERE w.execution_id = r.execution_id)
                 AND NOT EXISTS (SELECT 1 FROM automation_prompt_completion_outbox o WHERE o.execution_id = r.execution_id)",
            ).map_err(|e| e.to_string())?;
            let rows = stmt.query_map(params![MAX_AUTOMATIC_ATTEMPTS], |row| Ok((
                row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, u64>(2)?, row.get::<_, u64>(3)?,
            ))).map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };
        let mut resumed = 0;
        for (execution_id, raw, _, generation) in candidates {
            if generation >= 9_007_199_254_740_990 || Self::has_uncertain_operations(&tx, &execution_id)? { continue; }
            let Ok(mut request) = serde_json::from_str::<PromptRunRequest>(&raw) else { continue; };
            if request.execution_id != execution_id || request.task_id != execution_id { continue; }
            // A journal without its model checkpoint cannot be restarted from
            // the original prompt: that would discard completed action context.
            let checkpoint: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM automation_background_checkpoints WHERE execution_id = ?1)",
                params![execution_id], |row| row.get(0),
            ).map_err(|e| e.to_string())?;
            let operations: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM automation_background_operations WHERE execution_id = ?1)",
                params![execution_id], |row| row.get(0),
            ).map_err(|e| e.to_string())?;
            if operations && !checkpoint { continue; }
            request.lease = None;
            let request_json = serde_json::to_string(&request).map_err(|e| e.to_string())?;
            // Revoke the old writer in this same transaction, before exposing
            // pending work. A subsequent claim issues a fresh attempt/token.
            tx.execute(
                "UPDATE automation_background_leases SET generation = ?2, token = ?3 WHERE execution_id = ?1",
                params![execution_id, (generation + 1) as i64, Uuid::new_v4().to_string()],
            ).map_err(|e| e.to_string())?;
            resumed += tx.execute(
                "UPDATE automation_cron_runs SET state = 'pending', lease_expires_at = NULL, request_json = ?2
                 WHERE execution_id = ?1 AND state = 'leased'",
                params![execution_id, request_json],
            ).map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(resumed)
    }

    pub fn restore_background_checkpoint(
        &self, execution_id: &str, lease: Option<&BackgroundExecutionLease>,
        verify: impl FnOnce(&Connection, &str) -> Result<(), String>,
    ) -> Result<BackgroundResumeCheckpoint, String> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        Self::require_background_execution(&tx, execution_id, lease)?;
        verify(&tx, execution_id)?;
        if Self::has_uncertain_operations(&tx, execution_id)? {
            return Err("Reconcile unfinished or uncertain operations before resuming background work".to_string());
        }
        let checkpoint: Option<(u64, String)> = tx.query_row(
            "SELECT revision, context_json FROM automation_background_checkpoints WHERE execution_id = ?1",
            params![execution_id], |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(|e| e.to_string())?;
        let (revision, context) = if let Some((revision, raw)) = checkpoint {
            let context: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            super::journal::background_context_json(&context)?;
            if revision == 0 || revision >= 9_007_199_254_740_991 { return Err("Invalid restored checkpoint revision".to_string()); }
            (revision, Some(context))
        } else {
            let operations: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM automation_background_operations WHERE execution_id = ?1)",
                params![execution_id], |row| row.get(0),
            ).map_err(|e| e.to_string())?;
            if operations { return Err("Operation journal has no model checkpoint; do not restart its actions".to_string()); }
            (0, None)
        };
        let summary: Option<String> = tx.query_row(
            "SELECT summary_json FROM automation_background_compactions WHERE execution_id = ?1 AND checkpoint_revision <= ?2
             ORDER BY checkpoint_revision DESC LIMIT 1",
            params![execution_id, revision as i64], |row| row.get(0),
        ).optional().map_err(|e| e.to_string())?;
        let last_compaction = summary.map(|raw| serde_json::from_str(&raw).map_err(|e| e.to_string())).transpose()?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(BackgroundResumeCheckpoint { revision, context, last_compaction })
    }
}
