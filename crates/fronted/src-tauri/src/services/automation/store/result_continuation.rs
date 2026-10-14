use super::*;

fn response_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<(String, String, String, String, String, Option<String>)> {
    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn received_wait() -> (AutomationStore, String, BackgroundResultWatch, Value) {
        let store = AutomationStore::open_in_memory().unwrap();
        let watch = BackgroundResultWatch { source_host_id: Uuid::new_v4().to_string(), request_id: Uuid::new_v4().to_string() };
        AutomationStore::track_result_on_connection(&store.lock_conn().unwrap(), &watch.source_host_id, &watch.request_id).unwrap();
        let id = Uuid::new_v4().to_string();
        // Authenticated-host snapshot fixture; no model path can insert it.
        let payload = json!({"hostId": watch.source_host_id, "requestId": watch.request_id, "name": "Compound task", "workdir": "/original",
            "run": {"id": id, "taskId": id, "state": "waiting", "success": false, "output": "Actual retained report"}, "checkpointRevision": 1,
            "waiting": {"waitId": Uuid::new_v4().to_string(), "createdAt": 1}, "artifacts": [], "operations": {"inFlight": 0}});
        store.receive_background_result(&watch, payload.clone()).unwrap();
        let entry = store.list_background_inbox(0, 1, true).unwrap().items[0].id.clone();
        (store, entry, watch, payload)
    }

    #[test]
    fn native_response_keeps_exact_input_and_one_id_across_uncertain_delivery() {
        let (store, entry, _, _) = received_wait();
        let first = store.stage_received_response(&entry, "明天 10:00，原日历").unwrap();
        let retry = store.stage_received_response(&entry, "明天 10:00，原日历").unwrap();
        assert_eq!(first.input.resume_id, retry.input.resume_id);
        assert!(store.stage_received_response(&entry, "Changed target").is_err());
        assert_eq!(store.claim_received_responses(None).unwrap().len(), 1);
        assert!(store.claim_received_responses(None).unwrap().is_empty());
        assert_eq!(store.received_response_for_entry(&entry).unwrap().unwrap().input.response, "明天 10:00，原日历");
        assert!(store.received_response_for_entry(&entry).unwrap().unwrap().result.is_none());
    }

    #[test]
    fn newer_state_blocks_new_response_and_actual_receipt_retains_original_owner() {
        let (store, entry, watch, mut payload) = received_wait();
        payload["run"]["state"] = json!("pending"); payload["checkpointRevision"] = json!(2); payload["waiting"] = Value::Null;
        store.receive_background_result(&watch, payload).unwrap();
        assert!(store.stage_received_response(&entry, "Too late").is_err());
        let (store, entry, watch, mut payload) = received_wait();
        let delivery = store.stage_received_response(&entry, "Actual information").unwrap();
        let mut wrong = payload.clone(); wrong["hostId"] = json!(Uuid::new_v4().to_string());
        assert!(store.complete_received_response(&delivery, &wrong).is_err());
        assert!(store.received_response_for_entry(&entry).unwrap().unwrap().result.is_none());
        payload["run"]["state"] = json!("pending"); payload["checkpointRevision"] = json!(2); payload["waiting"] = Value::Null;
        store.receive_background_result(&watch, payload.clone()).unwrap(); store.complete_received_response(&delivery, &payload).unwrap();
        assert_eq!(store.received_response_for_entry(&entry).unwrap().unwrap().result.unwrap(), payload);
        assert!(store.claim_received_responses(None).unwrap().is_empty());
        assert_eq!(store.stage_received_response(&entry, "Actual information").unwrap().input.resume_id, delivery.input.resume_id);
        assert_eq!(store.list_background_inbox(0, 1, false).unwrap().items[0].read_at, None);
    }
}
fn response_record(row: (String, String, String, String, String, Option<String>)) -> Result<BackgroundResultResponse, String> {
    let (source_host_id, request_id, wait_id, resume_id, response, raw) = row;
    Ok(BackgroundResultResponse { source_host_id,
        input: ResumeBackgroundTaskInput { request_id, wait_id, resume_id, response },
        result: raw.map(|raw| serde_json::from_str(&raw).map_err(|e| e.to_string())).transpose()?,
    })
}

impl AutomationStore {
    pub fn received_task_source(&self, entry_id: &str) -> Result<(BackgroundResultWatch, Value), String> {
        let conn = self.lock_conn()?;
        Self::received_task_source_on_connection(&conn, entry_id)
    }

    pub(super) fn received_task_source_on_connection(conn: &Connection, entry_id: &str) -> Result<(BackgroundResultWatch, Value), String> {
        let (source_host_id, request_id, raw): (String, String, String) = conn.query_row(
            "SELECT source_host_id, request_id, payload_json FROM automation_result_inbox WHERE entry_id = ?1",
            params![entry_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).map_err(|e| e.to_string())?;
        Ok((BackgroundResultWatch { source_host_id, request_id }, serde_json::from_str(&raw).map_err(|e| e.to_string())?))
    }

    /// Persist one immutable response per received wait BEFORE any RPC. The
    /// same response after a lost ACK/reopen retains the same resume ID.
    pub fn stage_received_response(&self, entry_id: &str, response: &str) -> Result<BackgroundResultResponse, String> {
        if response.trim().is_empty() || response.len() > 32 * 1024 { return Err("A nonempty response of at most 32 KiB is required".into()); }
        let (watch, payload) = self.received_task_source(entry_id)?;
        let wait_id = payload["waiting"]["waitId"].as_str().filter(|id| Uuid::parse_str(id).is_ok())
            .ok_or_else(|| "Received task has no waiting occurrence".to_string())?;
        if payload["run"]["state"] != "waiting" { return Err("Only a received waiting task can accept a response".into()); }
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let existing = tx.query_row("SELECT source_host_id, request_id, wait_id, resume_id, response, result_json FROM automation_result_responses WHERE wait_id = ?1",
            params![wait_id], response_row).optional().map_err(|e| e.to_string())?;
        if let Some(row) = existing {
            let saved = response_record(row)?;
            if saved.source_host_id != watch.source_host_id || saved.input.request_id != watch.request_id || saved.input.response != response {
                return Err("This occurrence already has an immutable response; recover its original delivery before changing it".into());
            }
            return Ok(saved);
        }
        let (state, revision): (Option<String>, u64) = tx.query_row(
            "SELECT last_state, last_revision FROM automation_result_watches WHERE request_id = ?1 AND source_host_id = ?2",
            params![watch.request_id, watch.source_host_id], |row| Ok((row.get(0)?, row.get(1)?)),
        ).map_err(|e| e.to_string())?;
        if state.as_deref() != Some("waiting") || payload["checkpointRevision"].as_u64() != Some(revision) {
            return Err("A newer task state superseded this waiting notice; read its current status".into());
        }
        let count: i64 = tx.query_row("SELECT COUNT(*) FROM automation_result_responses", [], |row| row.get(0)).map_err(|e| e.to_string())?;
        if count >= 4096 { return Err("Response outbox capacity reached; no response was sent".into()); }
        let bytes: i64 = tx.query_row("SELECT COALESCE(SUM(LENGTH(CAST(response AS BLOB)) + COALESCE(LENGTH(CAST(result_json AS BLOB)), 0)), 0) FROM automation_result_responses", [], |row| row.get(0)).map_err(|e| e.to_string())?;
        if bytes + response.len() as i64 > 128 * 1024 * 1024 { return Err("Response outbox byte capacity reached; no response was sent".into()); }
        let input = ResumeBackgroundTaskInput { request_id: watch.request_id, wait_id: wait_id.into(), resume_id: Uuid::new_v4().to_string(), response: response.into() };
        tx.execute("INSERT INTO automation_result_responses (resume_id, entry_id, source_host_id, request_id, wait_id, response, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![input.resume_id, entry_id, watch.source_host_id, input.request_id, input.wait_id, input.response, db::now_ms()]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(BackgroundResultResponse { source_host_id: watch.source_host_id, input, result: None })
    }

    /// Claim delivery before network. Bounded retries carry the exact original
    /// response and never mutate a request, peer or current account binding.
    pub fn claim_received_responses(&self, selected: Option<&str>) -> Result<Vec<BackgroundResultResponse>, String> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let rows = {
            let mut stmt = tx.prepare("SELECT source_host_id, request_id, wait_id, resume_id, response, result_json FROM automation_result_responses WHERE result_json IS NULL AND retry_at <= ?1 AND (?2 IS NULL OR resume_id = ?2) ORDER BY retry_at ASC, created_at ASC, resume_id ASC LIMIT 4").map_err(|e| e.to_string())?;
            let rows = stmt.query_map(params![db::now_ms(), selected], response_row).map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };
        let records = rows.into_iter().map(response_record).collect::<Result<Vec<_>, _>>()?;
        for record in &records {
            tx.execute("UPDATE automation_result_responses SET retry_at = ?2 + MIN(900000, 60000 * (1 << MIN(probes, 4))), probes = MIN(32, probes + 1) WHERE resume_id = ?1 AND result_json IS NULL",
                params![record.input.resume_id, db::now_ms()]).map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(records)
    }

    pub fn received_response_for_entry(&self, entry_id: &str) -> Result<Option<BackgroundResultResponse>, String> {
        let (_, payload) = self.received_task_source(entry_id)?;
        let Some(wait_id) = payload["waiting"]["waitId"].as_str() else { return Ok(None); };
        let conn = self.lock_conn()?;
        conn.query_row("SELECT source_host_id, request_id, wait_id, resume_id, response, result_json FROM automation_result_responses WHERE wait_id = ?1",
            params![wait_id], response_row).optional().map_err(|e| e.to_string())?.map(response_record).transpose()
    }

    /// Called only after an authenticated real host resume reply. Retain the
    /// receipt before presenting acceptance. Failed writes remain retryable.
    pub(crate) fn complete_received_response(&self, delivery: &BackgroundResultResponse, result: &Value) -> Result<(), String> {
        let raw = serde_json::to_string(result).map_err(|e| e.to_string())?;
        if raw.len() > 4 * 1024 * 1024 || result["hostId"] != delivery.source_host_id || result["requestId"] != delivery.input.request_id {
            return Err("Response receipt changed owner/request or exceeds its bound".into());
        }
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let saved = response_record(tx.query_row("SELECT source_host_id, request_id, wait_id, resume_id, response, result_json FROM automation_result_responses WHERE resume_id = ?1",
            params![delivery.input.resume_id], response_row).map_err(|e| e.to_string())?)?;
        if saved.source_host_id != delivery.source_host_id || serde_json::to_value(&saved.input).map_err(|e| e.to_string())? != serde_json::to_value(&delivery.input).map_err(|e| e.to_string())? {
            return Err("Response delivery does not match its durable input".into());
        }
        if saved.result.is_none() {
            let bytes: i64 = tx.query_row("SELECT COALESCE(SUM(LENGTH(CAST(response AS BLOB)) + COALESCE(LENGTH(CAST(result_json AS BLOB)), 0)), 0) FROM automation_result_responses", [], |row| row.get(0)).map_err(|e| e.to_string())?;
            if bytes + raw.len() as i64 > 128 * 1024 * 1024 { return Err("Response receipt capacity reached; retain the original delivery for reconciliation".into()); }
        }
        // A retry may observe a later host state. Keep the first actual receipt.
        tx.execute("UPDATE automation_result_responses SET result_json = COALESCE(result_json, ?2) WHERE resume_id = ?1", params![delivery.input.resume_id, raw]).map_err(|e| e.to_string())?;
        tx.execute("UPDATE automation_result_watches SET active = 1, retry_at = 0 WHERE request_id = ?1 AND source_host_id = ?2", params![delivery.input.request_id, delivery.source_host_id]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }
}
