use super::*;

impl AutomationStore {
    /// Save the conclusion before committing terminal state. Startup can finish
    /// a staged result without restarting its model or repeating any tools.
    pub(crate) fn stage_prompt_completion(&self, mut input: CompletePromptRunInput) -> Result<Option<CompletePromptRunInput>, String> {
        input.execution_id = input.execution_id.trim().to_string();
        if input.execution_id.is_empty() { return Err("executionId cannot be empty".to_string()); }
        input.output = db::truncate_run_output(input.output.trim());
        input.duration_ms = input.duration_ms.min(i64::MAX as u64);
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let row: Option<(String, Option<i64>)> = tx.query_row(
            "SELECT state, lease_expires_at FROM automation_cron_runs WHERE execution_id = ?1",
            params![input.execution_id], |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(|e| e.to_string())?;
        let Some((state, lease)) = row else { return Ok(None); };
        if state != "pending" && state != "leased" { return Ok(None); }
        let serialized = serde_json::to_string(&input).map_err(|e| e.to_string())?;
        let existing: Option<String> = tx.query_row(
            "SELECT input_json FROM automation_prompt_completion_outbox WHERE execution_id = ?1",
            params![input.execution_id], |row| row.get(0),
        ).optional().map_err(|e| e.to_string())?;
        if let Some(existing) = existing {
            if existing != serialized { return Err("A different conclusion is already staged for this execution".to_string()); }
            // A persisted legacy conclusion can settle without authorizing
            // new work. Once a fenced claim exists, even retries must match it.
            if Self::is_background_execution(&tx, &input.execution_id)? {
                let fenced: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_background_leases WHERE execution_id = ?1)",
                    params![input.execution_id], |row| row.get(0)).map_err(|e| e.to_string())?;
                if fenced { Self::require_background_fence(&tx, &input.execution_id, input.lease.as_ref())?; }
            }
        } else {
            if Self::is_background_execution(&tx, &input.execution_id)? {
                Self::require_background_execution(&tx, &input.execution_id, input.lease.as_ref())?;
            }
            if state == "leased" && lease.is_some_and(|deadline| deadline <= db::now_ms()) {
                return Err("Execution deadline passed before conclusion persistence".to_string());
            }
            if input.success && Self::has_uncertain_operations(&tx, &input.execution_id)? {
                return Err("Cannot finalize success with operations awaiting receipts or unresolved external outcomes".to_string());
            }
            if input.success && Self::is_background_execution(&tx, &input.execution_id)? {
                Self::require_background_outcomes(&tx, &input.execution_id)?;
            }
            tx.execute(
                "INSERT INTO automation_prompt_completion_outbox (execution_id, input_json, created_at) VALUES (?1, ?2, ?3)",
                params![input.execution_id, serialized, db::now_ms()],
            ).map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(Some(input))
    }

    pub(crate) fn flush_prompt_completion_outbox(&self) -> Result<usize, String> {
        let inputs = {
            let conn = self.lock_conn()?;
            let mut stmt = conn.prepare("SELECT input_json FROM automation_prompt_completion_outbox ORDER BY created_at ASC, execution_id ASC")
                .map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };
        let count = inputs.len();
        for raw in inputs {
            let input: CompletePromptRunInput = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            self.finalize_prompt_completion(input)?;
        }
        Ok(count)
    }
}
