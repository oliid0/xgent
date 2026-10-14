use super::*;

const MAX_ARGUMENT_BYTES: usize = 1024 * 1024;
const MAX_RESULT_BYTES: usize = 256 * 1024;
const MAX_CONTEXT_BYTES: usize = 4 * 1024 * 1024;
const MAX_OPERATIONS: i64 = 1024;
const MAX_JOURNAL_BYTES: i64 = 16 * 1024 * 1024;

pub(super) fn background_context_json(context: &Value) -> Result<String, String> {
    let json = serde_json::to_string(context).map_err(|e| e.to_string())?;
    if json.len() > MAX_CONTEXT_BYTES
        || !context.get("systemPrompt").is_some_and(Value::is_string)
        || !context.get("messages").is_some_and(Value::is_array) {
        return Err("Checkpoint must contain a systemPrompt and messages within 4 MiB".to_string());
    }
    Ok(json)
}

pub(super) fn require_live_execution(conn: &Connection, execution_id: &str) -> Result<(), String> {
    let live: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM automation_background_tasks b JOIN automation_cron_runs r ON r.execution_id = b.execution_id
         WHERE b.execution_id = ?1 AND r.state = 'leased' AND r.lease_expires_at > ?2
         AND NOT EXISTS (SELECT 1 FROM automation_prompt_completion_outbox o WHERE o.execution_id = r.execution_id))",
        params![execution_id, db::now_ms()], |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    if live { Ok(()) } else { Err("Background execution does not own a live action lease".to_string()) }
}

fn journal_usage(conn: &Connection, execution_id: &str) -> Result<(i64, i64), String> {
    conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(LENGTH(CAST(arguments_json AS BLOB)) + COALESCE(LENGTH(CAST(result_json AS BLOB)), 0)), 0)
         FROM automation_background_operations WHERE execution_id = ?1",
        params![execution_id], |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|e| e.to_string())
}

impl AutomationStore {
    pub(super) fn has_uncertain_operations(conn: &Connection, execution_id: &str) -> Result<bool, String> {
        let started: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM automation_background_operations o WHERE o.execution_id = ?1 AND o.state = 'started' AND NOT EXISTS (SELECT 1 FROM automation_background_child_operations c WHERE c.execution_id = o.execution_id AND c.call_id = o.call_id AND c.receipt_json IS NOT NULL AND c.issuer_host_id = (SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1')) AND NOT (o.tool_name='OriginalDeviceTask' AND NOT EXISTS(SELECT 1 FROM automation_background_device_planning_calls p WHERE p.execution_id=o.execution_id AND p.call_id=o.call_id)))",
            params![execution_id], |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        if started { return Ok(true); }
        let mut stmt = conn.prepare(
            "SELECT call_id,result_json FROM automation_background_operations WHERE execution_id = ?1 AND state = 'returned' AND is_error = 1",
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![execution_id], |row| Ok((row.get::<_, String>(0)?,row.get::<_, String>(1)?))).map_err(|e| e.to_string())?;
        for row in rows {
            let (call,raw)=row.map_err(|e|e.to_string())?;
            let result: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            if result.get("details").and_then(|details| details.get("outcomeUncertain")).and_then(Value::as_bool) == Some(true) {
                if super::cloud_launch::confirmed_late_cloud_start_receipt(conn,execution_id,&call)?.is_some() {continue;}
                if super::children::confirmed_child_start_receipt(conn,execution_id,&call)?.is_some() {continue;}
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub fn save_background_checkpoint(&self, input: SaveBackgroundCheckpointInput) -> Result<u64, String> {
        if input.revision == 0 || input.revision > i64::MAX as u64 {
            return Err("Invalid checkpoint revision".to_string());
        }
        let context_json = background_context_json(&input.context)?;
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        Self::require_background_execution(&tx, &input.execution_id, input.lease.as_ref())?;
        let existing: Option<(u64, String)> = tx.query_row(
            "SELECT revision, context_json FROM automation_background_checkpoints WHERE execution_id = ?1",
            params![input.execution_id], |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(|e| e.to_string())?;
        let current = existing.as_ref().map(|(revision, _)| *revision).unwrap_or(0);
        if current == input.revision {
            if existing.as_ref().map(|(_, json)| json.as_str()) != Some(context_json.as_str()) {
                return Err("Checkpoint revision is bound to different context".to_string());
            }
        } else {
            if input.revision != current + 1 { return Err("Checkpoint revision conflict".to_string()); }
            tx.execute(
                "INSERT INTO automation_background_checkpoints (execution_id, revision, context_json, updated_at) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(execution_id) DO UPDATE SET revision = excluded.revision, context_json = excluded.context_json, updated_at = excluded.updated_at",
                params![input.execution_id, input.revision as i64, context_json, db::now_ms()],
            ).map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(input.revision)
    }

    #[cfg(test)]
    pub fn begin_background_operation(&self, input: BeginBackgroundOperationInput) -> Result<BeginBackgroundOperationResponse, String> {
        self.begin_background_operation_with_configuration(input, |_, _| Ok(()))
    }

    pub fn begin_background_operation_with_configuration(
        &self, input: BeginBackgroundOperationInput,
        verify: impl FnOnce(&Connection, &str) -> Result<(), String>,
    ) -> Result<BeginBackgroundOperationResponse, String> {
        if input.call_id.trim().is_empty() || input.call_id.len() > 512 || input.tool_name.trim().is_empty() || input.tool_name.len() > 256 {
            return Err("Operation needs a valid tool call ID and name".to_string());
        }
        let arguments_json = serde_json::to_string(&input.arguments).map_err(|e| e.to_string())?;
        if arguments_json.len() > MAX_ARGUMENT_BYTES { return Err("Operation arguments exceed 1 MiB".to_string()); }
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        Self::require_background_execution(&tx, &input.execution_id, input.lease.as_ref())?;
        verify(&tx, &input.execution_id)?;
        let planned: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_background_plans WHERE execution_id = ?1)",
            params![input.execution_id], |row| row.get(0)).map_err(|e| e.to_string())?;
        if !planned { return Err("Persist the background outcome plan before invoking tools".to_string()); }
        let existing: Option<(String, String, String, Option<String>)> = tx.query_row(
            "SELECT tool_name, arguments_json, state, result_json FROM automation_background_operations WHERE execution_id = ?1 AND call_id = ?2",
            params![input.execution_id, input.call_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        ).optional().map_err(|e| e.to_string())?;
        if let Some((name, arguments, state, result)) = existing {
            if name != input.tool_name || arguments != arguments_json { return Err("Tool call ID is already bound to a different operation".to_string()); }
            let observed=super::children::confirmed_child_start_receipt(&tx,&input.execution_id,&input.call_id)?
                .or(super::cloud_launch::confirmed_late_cloud_start_receipt(&tx,&input.execution_id,&input.call_id)?);
            return Ok(BeginBackgroundOperationResponse {
                status: if state == "returned" || observed.is_some() { "returned" } else { "uncertain" }.to_string(),
                result: observed.or(result.map(|raw| serde_json::from_str(&raw).map_err(|e| e.to_string())).transpose()?),
            });
        }
        let revision: Option<i64> = tx.query_row(
            "SELECT revision FROM automation_background_checkpoints WHERE execution_id = ?1",
            params![input.execution_id], |row| row.get(0),
        ).optional().map_err(|e| e.to_string())?;
        let revision = revision.ok_or_else(|| "Persist the model context before invoking tools".to_string())?;
        let (count, bytes) = journal_usage(&tx, &input.execution_id)?;
        // Reserve room for a maximum-size receipt before permitting an action.
        let in_flight: i64 = tx.query_row(
            "SELECT COUNT(*) FROM automation_background_operations WHERE execution_id = ?1 AND state = 'started'",
            params![input.execution_id], |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        if count >= MAX_OPERATIONS || bytes + arguments_json.len() as i64 + (in_flight + 1) * MAX_RESULT_BYTES as i64 > MAX_JOURNAL_BYTES {
            return Err("Background operation journal quota exceeded".to_string());
        }
        tx.execute(
            "INSERT INTO automation_background_operations (execution_id, call_id, tool_name, arguments_json, context_revision, state, started_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'started', ?6)",
            params![input.execution_id, input.call_id, input.tool_name, arguments_json, revision, db::now_ms()],
        ).map_err(|e| e.to_string())?;
        let lease = input.lease.as_ref().ok_or_else(|| "Operation intent requires its execution lease".to_string())?;
        tx.execute(
            "INSERT INTO automation_background_operation_leases (execution_id, call_id, attempt, generation, token) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![input.execution_id, input.call_id, lease.attempt as i64, lease.generation as i64, lease.token],
        ).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(BeginBackgroundOperationResponse { status: "execute".to_string(), result: None })
    }

    /// A receipt is still valuable after cancellation or expiry. It records
    /// what returned; it never reopens the task or changes its terminal state.
    pub fn complete_background_operation(&self, input: CompleteBackgroundOperationInput) -> Result<(), String> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        Self::complete_background_operation_on_connection(&tx, input)?;
        tx.commit().map_err(|e| e.to_string())
    }

    pub(super) fn complete_background_operation_on_connection(conn: &Connection, input: CompleteBackgroundOperationInput) -> Result<(), String> {
        let result_json = serde_json::to_string(&input.result).map_err(|e| e.to_string())?;
        if result_json.len() > MAX_RESULT_BYTES { return Err("Operation receipt exceeds 256 KiB".to_string()); }
        let lease = input.lease.as_ref().ok_or_else(|| "Operation receipt requires its captured execution lease".to_string())?;
        let owns_intent: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM automation_background_operation_leases WHERE execution_id = ?1 AND call_id = ?2 AND attempt = ?3 AND generation = ?4 AND token = ?5)",
            params![input.execution_id, input.call_id, lease.attempt, lease.generation, lease.token], |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        if !owns_intent { return Err("Receipt lease does not match the original operation attempt".to_string()); }
        let row: Option<(String, Option<String>)> = conn.query_row(
            "SELECT tool_name, result_json FROM automation_background_operations WHERE execution_id = ?1 AND call_id = ?2",
            params![input.execution_id, input.call_id], |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(|e| e.to_string())?;
        let (name, existing) = row.ok_or_else(|| "Operation intent not found".to_string())?;
        if input.result.get("role").and_then(Value::as_str) != Some("toolResult")
            || input.result.get("toolCallId").and_then(Value::as_str) != Some(input.call_id.as_str())
            || input.result.get("toolName").and_then(Value::as_str) != Some(name.as_str()) {
            return Err("Receipt does not match the persisted operation".to_string());
        }
        if let Some(existing) = existing {
            if existing != result_json { return Err("Operation receipt is immutable".to_string()); }
        } else {
            let changed = conn.execute(
                "UPDATE automation_background_operations SET state = 'returned', result_json = ?3, is_error = ?4, finished_at = ?5
                 WHERE execution_id = ?1 AND call_id = ?2 AND state = 'started'",
                params![input.execution_id, input.call_id, result_json, input.result.get("isError").and_then(Value::as_bool).unwrap_or(false) as i64, db::now_ms()],
            ).map_err(|e| e.to_string())?;
            if changed != 1 { return Err("Operation receipt lost its original started intent".into()); }
        }
        Ok(())
    }

    pub(super) fn operation_summary(conn: &Connection, execution_id: &str) -> Result<BackgroundOperationSummary, String> {
        conn.query_row(
            "SELECT COALESCE(SUM(state = 'started' AND NOT EXISTS (SELECT 1 FROM automation_background_child_operations c WHERE c.execution_id = o.execution_id AND c.call_id = o.call_id AND c.receipt_json IS NOT NULL AND c.issuer_host_id = (SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1'))), 0), COALESCE(SUM(state = 'returned'), 0), COALESCE(SUM(is_error), 0)
             FROM automation_background_operations o WHERE execution_id = ?1",
            params![execution_id], |row| Ok(BackgroundOperationSummary { in_flight: row.get(0)?, returned: row.get(1)?, errors: row.get(2)? }),
        ).map_err(|e| e.to_string())
    }

    pub fn list_background_operations(&self, request_id: &str, cursor: i64, limit: usize) -> Result<BackgroundOperationPage, String> {
        let task = self.background_task(request_id)?;
        let conn = self.lock_conn()?;
        let limit = limit.clamp(1, 10);
        let mut stmt = conn.prepare(
            "SELECT sequence, call_id, tool_name, arguments_json, context_revision, state, result_json, started_at, finished_at
             FROM automation_background_operations WHERE execution_id = ?1 AND sequence > ?2 ORDER BY sequence ASC LIMIT ?3",
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![task.run.id, cursor.max(0), (limit + 1) as i64], |row| Ok((
            row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?,
            row.get::<_, u64>(4)?, row.get::<_, String>(5)?, row.get::<_, Option<String>>(6)?, row.get::<_, i64>(7)?, row.get::<_, Option<i64>>(8)?,
        ))).map_err(|e| e.to_string())?;
        let mut records = Vec::new();
        for row in rows {
            let (sequence, call_id, tool_name, arguments, context_revision, state, result, started_at, finished_at) = row.map_err(|e| e.to_string())?;
            records.push(BackgroundOperationRecord { sequence, call_id, tool_name, arguments: serde_json::from_str(&arguments).map_err(|e| e.to_string())?,
                context_revision, state, result: result.map(|raw| serde_json::from_str(&raw).map_err(|e| e.to_string())).transpose()?, started_at, finished_at });
        }
        let has_more = records.len() > limit;
        records.truncate(limit);
        let next_cursor = if has_more { records.last().map(|record| record.sequence) } else { None };
        Ok(BackgroundOperationPage { operations: records, next_cursor })
    }
}
