use super::*;

const MAX_OUTBOX_BYTES: i64 = 512 * 1024 * 1024;

fn delivery(row: &rusqlite::Row<'_>) -> rusqlite::Result<(String, String, Option<String>, bool)> {
    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
}
fn decode(row: (String, String, Option<String>, bool)) -> Result<BackgroundSubmission, String> {
    Ok(BackgroundSubmission { source_host_id: row.0,
        input: serde_json::from_str(&row.1).map_err(|e| e.to_string())?,
        result: row.2.map(|raw| serde_json::from_str(&raw).map_err(|e| e.to_string())).transpose()?,
        cancel_requested: row.3,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input() -> SubmitBackgroundTaskInput {
        SubmitBackgroundTaskInput { intelligent_scheduling_enabled: false, request_id: Uuid::new_v4().to_string(), name: "Real saved request".into(), prompt: "Create a report".into(), provider_id: "provider".into(), model: "model".into(), workdir: std::env::temp_dir().to_string_lossy().into_owned(), timeout_seconds: 300, reasoning: "medium".into(), files: vec![], delegation: None, requirements: None, source_context: None, goal_binding: None }
    }

    #[test]
    fn staging_retains_exact_packet_and_rejects_changed_input_owner_and_origin() {
        let store = AutomationStore::open_in_memory().unwrap(); let input = input();
        let host = store.background_worker_identity().unwrap(); let origin = serde_json::json!({"conversationId": "original", "messageId": "message"});
        let staged = store.stage_background_submission(&host, input.clone(), origin.clone()).unwrap();
        assert!(staged.result.is_none());
        assert!(store.stage_background_submission(&host, input.clone(), origin.clone()).is_ok());
        let mut changed = input.clone(); changed.prompt = "Different instruction".into();
        assert!(store.stage_background_submission(&host, changed, origin.clone()).is_err());
        assert!(store.stage_background_submission(&Uuid::new_v4().to_string(), input.clone(), origin).is_err());
        assert!(store.stage_background_submission(&host, input, Value::Null).is_err());
        assert_eq!(store.list_background_submissions(0, 20).unwrap().items.len(), 1);
    }

    #[test]
    fn cancellation_persists_before_rpc_and_late_acceptance_cannot_clear_it() {
        let store = AutomationStore::open_in_memory().unwrap(); let input = input(); let host = store.background_worker_identity().unwrap();
        store.stage_background_submission(&host, input.clone(), Value::Null).unwrap();
        let pending = store.claim_background_submissions(None).unwrap().remove(0);
        assert!(store.claim_background_submissions(None).unwrap().is_empty());
        assert!(store.cancel_background_submission(&input.request_id).unwrap().unwrap().cancel_requested);
        let accepted = serde_json::to_value(store.submit_background_task(input.clone()).unwrap()).unwrap();
        store.complete_background_submission(&pending, &accepted).unwrap();
        let cancel = store.claim_background_submissions(None).unwrap().remove(0);
        assert!(cancel.cancel_requested); assert!(cancel.result.is_none());
        assert!(store.complete_background_submission(&cancel, &accepted).is_err());
        let terminal = serde_json::to_value(store.cancel_background_task(&input.request_id).unwrap()).unwrap();
        store.complete_background_submission(&cancel, &terminal).unwrap();
        assert!(store.claim_background_submissions(None).unwrap().is_empty());
        assert!(store.list_background_submissions(0, 20).unwrap().items[0].cancellation_confirmed);
        assert!(store.stage_background_submission(&host, input, Value::Null).is_err());
    }

    #[test]
    fn copied_pending_submissions_never_acquire_new_installation_authority() {
        let store = AutomationStore::open_in_memory().unwrap(); let input = input(); let host = store.background_worker_identity().unwrap();
        store.stage_background_submission(&host, input.clone(), Value::Null).unwrap();
        store.bind_worker_identity(&Uuid::new_v4().to_string()).unwrap();
        assert!(store.claim_background_submissions(None).unwrap().is_empty());
        assert!(store.background_submission(&input.request_id).is_err());
        assert!(!store.list_background_submissions(0, 20).unwrap().items[0].local_owner);
    }
}

impl AutomationStore {
    /// Root client submission only. Delegated writes retain their captured
    /// parent lease and must never acquire deferred execution authority here.
    pub fn stage_background_submission(&self, source: &str, input: SubmitBackgroundTaskInput, origin: Value) -> Result<BackgroundSubmission, String> {
        let initiating = self.background_worker_identity()?;
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let result = Self::stage_background_submission_on_connection(&tx, &initiating, source, input, origin)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(result)
    }

    pub(super) fn stage_background_submission_on_connection(tx: &Connection, initiating: &str, source: &str,
        input: SubmitBackgroundTaskInput, origin: Value) -> Result<BackgroundSubmission, String> {
        if Uuid::parse_str(source).is_err() { return Err("Submission target must be a stable host UUID".into()); }
        let input = Self::normalize_background_task_input(input)?;
        if input.delegation.is_some() { return Err("Delegation requires its live captured parent lease; client submission outbox accepts only root tasks".into()); }
        let raw = serde_json::to_string(&input).map_err(|e| e.to_string())?;
        let origin_raw = serde_json::to_string(&origin).map_err(|e| e.to_string())?;
        // 8 MiB binary attachments expand in base64; leave room for the full
        // 2 MiB conversation and the RPC envelope below the 16 MiB LAN limit.
        if raw.len() > 15 * 1024 * 1024 || origin_raw.len() > 4 * 1024 * 1024 {
            return Err("Submission input/context exceeds its bound; no task was sent".into());
        }
        if input.source_context.as_ref().and_then(|source| source.routing.as_ref()).is_some_and(|routing| routing.initiating_host_id != initiating) {
            return Err("Source branch origin must match the actual submitting installation".into());
        }
        let saved: Option<(String, String, String, String, Option<String>, bool)> = tx.query_row(
            "SELECT initiating_host_id, source_host_id, input_json, origin_json, result_json, cancel_requested FROM automation_submission_outbox WHERE request_id = ?1",
            params![input.request_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
        ).optional().map_err(|e| e.to_string())?;
        if let Some(saved) = saved {
            if saved.0 != initiating || saved.1 != source || saved.2 != raw || saved.3 != origin_raw {
                return Err("Request belongs to its original device, target and immutable input/context; recover that delivery".into());
            }
            if saved.5 { return Err("This submission has a persisted cancellation; recover its original cancellation, never resubmit it".into()); }
            return decode((saved.1, saved.2, saved.4, false));
        }
        let (count, bytes): (i64, i64) = tx.query_row(
            "SELECT COUNT(*), COALESCE(SUM(LENGTH(CAST(input_json AS BLOB)) + LENGTH(CAST(origin_json AS BLOB)) + COALESCE(LENGTH(CAST(result_json AS BLOB)), 0) + COALESCE(LENGTH(CAST(cancel_json AS BLOB)), 0)), 0) FROM automation_submission_outbox", [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).map_err(|e| e.to_string())?;
        if count >= 4096 || bytes + raw.len() as i64 + origin_raw.len() as i64 > MAX_OUTBOX_BYTES {
            return Err("Submission outbox capacity reached; original pending requests retained and no task sent".into());
        }
        let sequence: i64 = tx.query_row("SELECT COALESCE(MAX(sequence), 0) FROM automation_submission_outbox", [], |row| row.get(0)).map_err(|e| e.to_string())?;
        if sequence >= 9_007_199_254_740_990 { return Err("Submission cursor capacity reached; no task sent".into()); }
        Self::track_result_on_connection(&tx, source, &input.request_id)?;
        tx.execute("INSERT INTO automation_submission_outbox (request_id, initiating_host_id, source_host_id, input_json, origin_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![input.request_id, initiating, source, raw, origin_raw, db::now_ms()]).map_err(|e| e.to_string())?;
        Ok(BackgroundSubmission { source_host_id: source.into(), input, result: None, cancel_requested: false })
    }

    pub fn claim_background_submissions(&self, selected: Option<&str>) -> Result<Vec<BackgroundSubmission>, String> {
        self.claim_background_submissions_filtered(selected,false)
    }

    pub(crate) fn claim_event_submissions(&self)->Result<Vec<BackgroundSubmission>,String>{
        self.claim_background_submissions_filtered(None,true)
    }

    fn claim_background_submissions_filtered(&self,selected:Option<&str>,event_only:bool)->Result<Vec<BackgroundSubmission>,String>{
        self.reconcile_proactive_remote_submissions()?;
        let initiating = self.background_worker_identity()?;
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let rows = {
            let mut stmt = tx.prepare("SELECT source_host_id, input_json, CASE WHEN cancel_requested = 1 THEN cancel_json ELSE result_json END, cancel_requested FROM automation_submission_outbox WHERE ((cancel_requested = 0 AND result_json IS NULL) OR (cancel_requested = 1 AND cancel_json IS NULL)) AND initiating_host_id = ?1 AND retry_at <= ?2 AND (?3 IS NULL OR request_id = ?3) AND NOT EXISTS(SELECT 1 FROM automation_proactive_remote_deliveries d WHERE d.request_id=automation_submission_outbox.request_id AND d.initiating_host_id=?1 AND d.locally_withdrawn=1) AND (?4=0 OR EXISTS(SELECT 1 FROM automation_proactive_remote_deliveries event WHERE event.request_id=automation_submission_outbox.request_id AND event.initiating_host_id=?1 AND event.source_host_id=automation_submission_outbox.source_host_id)) ORDER BY retry_at ASC, sequence ASC LIMIT 4").map_err(|e| e.to_string())?;
            let rows = stmt.query_map(params![initiating, db::now_ms(), selected,event_only], delivery).map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };
        let records = rows.into_iter().map(decode).collect::<Result<Vec<_>, _>>()?;
        for record in &records {
            tx.execute("UPDATE automation_submission_outbox SET retry_at = ?2 + MIN(900000, 60000 * (1 << MIN(probes, 4))), probes = MIN(32, probes + 1) WHERE request_id = ?1",
                params![record.input.request_id, db::now_ms()]).map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(records)
    }

    /// Only authenticated host delivery can persist acceptance. Queued means
    /// accepted by its host, never completed. First actual receipt is immutable.
    pub(crate) fn complete_background_submission(&self, pending: &BackgroundSubmission, result: &Value) -> Result<(), String> {
        let raw = serde_json::to_string(result).map_err(|e| e.to_string())?;
        if !pending.cancel_requested {
            if let Some(expected) = &pending.input.goal_binding {
                let accepted: BackgroundGoalBinding = serde_json::from_value(result["goalBinding"].clone())
                    .map_err(|_| "Goal acceptance receipt is missing or malformed; recover the original request".to_string())?;
                if &accepted != expected { return Err("Goal acceptance receipt does not match the original request".into()); }
            }
        }
        if raw.len() > 4 * 1024 * 1024 || result["requestId"] != pending.input.request_id || result["hostId"] != pending.source_host_id {
            return Err("Submission receipt exceeds bounds or changed its original request/host".into());
        }
        let initiating = self.background_worker_identity()?;
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let saved = tx.query_row("SELECT source_host_id, input_json, CASE WHEN ?3 = 1 THEN cancel_json ELSE result_json END, cancel_requested FROM automation_submission_outbox WHERE request_id = ?1 AND initiating_host_id = ?2",
            params![pending.input.request_id, initiating, pending.cancel_requested], delivery).map_err(|e| e.to_string())?;
        if saved.0 != pending.source_host_id || saved.1 != serde_json::to_string(&pending.input).map_err(|e| e.to_string())? {
            return Err("Submission delivery differs from its immutable saved packet".into());
        }
        let bytes: i64 = tx.query_row("SELECT COALESCE(SUM(LENGTH(CAST(input_json AS BLOB)) + LENGTH(CAST(origin_json AS BLOB)) + COALESCE(LENGTH(CAST(result_json AS BLOB)), 0) + COALESCE(LENGTH(CAST(cancel_json AS BLOB)), 0)), 0) FROM automation_submission_outbox", [], |row| row.get(0)).map_err(|e| e.to_string())?;
        if saved.2.is_none() && bytes + raw.len() as i64 > MAX_OUTBOX_BYTES { return Err("Acceptance receipt capacity reached; pending submission retained".into()); }
        if pending.cancel_requested {
            if !saved.3 || !matches!(result["run"]["state"].as_str(), Some("done" | "expired")) {
                return Err("Cancellation requires the original host's actual terminal receipt".into());
            }
            tx.execute("UPDATE automation_submission_outbox SET cancel_json = COALESCE(cancel_json, ?2), last_error = NULL WHERE request_id = ?1", params![pending.input.request_id, raw]).map_err(|e| e.to_string())?;
        } else {
            tx.execute("UPDATE automation_submission_outbox SET result_json = COALESCE(result_json, ?2), last_error = CASE WHEN cancel_requested = 1 THEN last_error ELSE NULL END WHERE request_id = ?1", params![pending.input.request_id, raw]).map_err(|e| e.to_string())?;
        }
        let cron_changed = super::proactive_remote::record_acceptance(&tx,pending)?;
        super::goal_progress::reconcile(&tx,&pending.input.request_id)?;
        tx.commit().map_err(|e| e.to_string())?;
        drop(conn);
        if cron_changed {
            let snapshot=self.snapshot()?.cron;
            self.with_notifier(|notifier|notifier.cron_changed(&snapshot));
        }
        Ok(())
    }

    pub(crate) fn note_background_submission_error(&self, request: &str, error: &str) -> Result<(), String> {
        let bounded: String = error.chars().take(2048).collect();
        let initiating = self.background_worker_identity()?;
        self.lock_conn()?.execute("UPDATE automation_submission_outbox SET last_error = ?2 WHERE request_id = ?1 AND initiating_host_id = ?3 AND ((cancel_requested = 0 AND result_json IS NULL) OR (cancel_requested = 1 AND cancel_json IS NULL))", params![request, bounded, initiating]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_background_submissions(&self, cursor: u64, limit: usize) -> Result<BackgroundSubmissionPage, String> {
        if !(1..=20).contains(&limit) || cursor > 9_007_199_254_740_990 { return Err("Invalid submission cursor/limit".into()); }
        let initiating = self.background_worker_identity()?;
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare("SELECT sequence, request_id, source_host_id, json_extract(input_json, '$.name'), created_at, retry_at, probes, last_error, result_json IS NOT NULL, initiating_host_id, cancel_requested, cancel_json IS NOT NULL, EXISTS(SELECT 1 FROM automation_proactive_remote_deliveries d WHERE d.request_id=automation_submission_outbox.request_id AND d.initiating_host_id=automation_submission_outbox.initiating_host_id AND d.locally_withdrawn=1) AS locally_withdrawn FROM automation_submission_outbox WHERE (?1 = 0 OR sequence < ?1) ORDER BY sequence DESC LIMIT ?2").map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![cursor, limit + 1], |row| Ok((row.get::<_, u64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?, row.get::<_, i64>(4)?, row.get::<_, i64>(5)?, row.get::<_, u32>(6)?, row.get::<_, Option<String>>(7)?, row.get::<_, bool>(8)?, row.get::<_, String>(9)?, row.get::<_, bool>(10)?, row.get::<_, bool>(11)?,row.get::<_,bool>(12)?))).map_err(|e| e.to_string())?;
        let mut items = rows.map(|row| {
            let row = row.map_err(|e| e.to_string())?;
            Ok(BackgroundSubmissionItem { sequence: row.0, request_id: row.1, source_host_id: row.2, name: row.3, created_at: row.4, retry_at: row.5, probes: row.6, last_error: row.7, accepted: row.8, local_owner: row.9 == initiating, cancel_requested: row.10, cancellation_confirmed: row.11,locally_withdrawn:row.12 })
        }).collect::<Result<Vec<_>, String>>()?;
        let more = items.len() > limit; items.truncate(limit);
        let next_cursor = if more { items.last().map(|item| item.sequence) } else { None };
        Ok(BackgroundSubmissionPage { items, next_cursor })
    }

    pub fn background_submission(&self, request: &str) -> Result<Option<BackgroundSubmission>, String> {
        let conn = self.lock_conn()?;
        Self::background_submission_on_connection(&conn, request)
    }

    pub(super) fn background_submission_on_connection(conn: &Connection, request: &str) -> Result<Option<BackgroundSubmission>, String> {
        let initiating: String = conn.query_row("SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1'", [], |row| row.get(0)).map_err(|e| e.to_string())?;
        let owner: Option<String> = conn.query_row("SELECT initiating_host_id FROM automation_submission_outbox WHERE request_id = ?1", params![request], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
        if owner.is_some_and(|owner| owner != initiating) { return Err("Submission belongs to a different installation; copied pending requests cannot be replayed".into()); }
        conn.query_row("SELECT source_host_id, input_json, CASE WHEN cancel_requested = 1 THEN cancel_json ELSE result_json END, cancel_requested FROM automation_submission_outbox WHERE request_id = ?1 AND initiating_host_id = ?2",
            params![request, initiating], delivery).optional().map_err(|e| e.to_string())?.map(decode).transpose()
    }

    pub fn cancel_background_submission(&self, request: &str) -> Result<Option<BackgroundSubmission>, String> {
        let initiating = self.background_worker_identity()?;
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_submission_outbox WHERE request_id = ?1 AND initiating_host_id = ?2)", params![request, initiating], |row| row.get(0)).map_err(|e| e.to_string())?;
        if !exists { return Ok(None); }
        // Even an unclaimed local packet might reuse an older accepted request
        // ID. Stop submission immediately, but never invent remote cancellation.
        tx.execute("UPDATE automation_submission_outbox SET cancel_requested = 1, retry_at = CASE WHEN cancel_requested = 0 THEN 0 ELSE retry_at END WHERE request_id = ?1", params![request]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        drop(conn);
        self.background_submission(request)
    }
}
