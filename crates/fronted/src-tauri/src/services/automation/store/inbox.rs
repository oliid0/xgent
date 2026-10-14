use super::*;
use sha2::{Digest, Sha256};

const MAX_WATCHES: i64 = 8192;
const MAX_INBOX_BYTES: i64 = 128 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES: usize = 4 * 1024 * 1024;

fn canonical_id(id: &str) -> bool { Uuid::parse_str(id).is_ok_and(|value| value.to_string() == id) }
fn text<'a>(value: &'a Value, field: &str, max: usize) -> Result<&'a str, String> {
    value[field].as_str().filter(|s| s.len() <= max).ok_or_else(|| format!("Invalid result field {field}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn completed() -> (AutomationStore, BackgroundResultWatch, Value) {
        let store = AutomationStore::open_in_memory().unwrap();
        let task = store.submit_background_task(SubmitBackgroundTaskInput { intelligent_scheduling_enabled: false, request_id: Uuid::new_v4().to_string(), name: "Retained compound result".into(),
            prompt: "Report and calendar".into(), provider_id: "fixture".into(), model: "fixture".into(), workdir: std::env::temp_dir().to_string_lossy().into_owned(),
            timeout_seconds: 300, reasoning: "medium".into(), files: vec![], delegation: None, requirements: None, source_context: None, goal_binding: None,
        }).unwrap();
        let lease = store.claim_prompt_runs().unwrap().remove(0).lease.unwrap();
        store.complete_prompt_run(CompletePromptRunInput { execution_id: task.run.id, lease: Some(lease), success: false, duration_ms: 10, output: "Actual report retained; calendar incomplete".into() }).unwrap();
        let watch = BackgroundResultWatch { source_host_id: task.host_id, request_id: task.request_id };
        let payload = serde_json::to_value(store.background_task(&watch.request_id).unwrap()).unwrap();
        (store, watch, payload)
    }

    #[test]
    fn remote_cancellation_keeps_terminal_result_watched_and_publishes_immutable_confirmation() {
        let (store,watch,mut payload) = completed();
        payload["run"]["state"] = json!("expired");
        payload["cloudCancellation"] = json!({"pending":1,"observedTerminal":0});
        let pending = payload.clone();
        assert!(store.receive_background_result(&watch,payload.clone()).unwrap());
        let first = store.list_background_inbox(0,20,false).unwrap().items[0].id.clone();
        {
            let conn = store.lock_conn().unwrap();
            assert!(conn.query_row("SELECT active FROM automation_result_watches WHERE request_id = ?1",params![watch.request_id],|row|row.get::<_,bool>(0)).unwrap());
        }
        assert!(!store.receive_background_result(&watch,payload.clone()).unwrap());
        payload["cloudCancellation"] = json!({"pending":0,"observedTerminal":1});
        assert!(store.receive_background_result(&watch,payload).unwrap());
        assert_eq!(store.list_background_inbox(0,20,false).unwrap().items.len(),2);
        assert_eq!(serde_json::from_str::<Value>(&store.read_background_inbox(&first,0).unwrap().text).unwrap(),pending);
        let conn = store.lock_conn().unwrap();
        assert!(!conn.query_row("SELECT active FROM automation_result_watches WHERE request_id = ?1",params![watch.request_id],|row|row.get::<_,bool>(0)).unwrap());
    }

    #[test]
    fn legacy_cloud_cancellation_summary_is_optional_but_supplied_counts_are_bounded_and_typed() {
        let (store,watch,mut payload) = completed();
        payload.as_object_mut().unwrap().remove("cloudCancellation");
        assert!(store.receive_background_result(&watch,payload.clone()).unwrap());
        payload["cloudCancellation"] = json!({"pending":0,"observedTerminal":0});
        assert!(!store.receive_background_result(&watch,payload.clone()).unwrap());
        for invalid in [json!({"pending":-1,"observedTerminal":0}),json!({"pending":1.5,"observedTerminal":0}),json!({"pending":1024,"observedTerminal":1}),json!({"pending":1,"observedTerminal":0,"runId":999})] {
            payload["cloudCancellation"] = invalid;
            assert!(store.receive_background_result(&watch,payload.clone()).is_err());
        }
    }

    #[test]
    fn terminal_parent_polling_retains_unsettled_children_without_retry_error_notifications() {
        let (store,watch,mut payload) = completed();
        payload.as_object_mut().unwrap().remove("children");
        assert!(store.receive_background_result(&watch,payload.clone()).unwrap());
        payload["children"] = json!([]);
        assert!(!store.receive_background_result(&watch,payload.clone()).unwrap());
        payload["children"] = json!([{"callId":"actual-submit","requestId":Uuid::new_v4().to_string(),"peerId":Uuid::new_v4().to_string(),"accepted":true,"state":"done","success":false,"terminalConfirmed":true,"cancelRequested":true,"cancelAcknowledged":false,"lastError":null}]);
        assert!(store.receive_background_result(&watch,payload.clone()).unwrap());
        let active = ||store.lock_conn().unwrap().query_row("SELECT active FROM automation_result_watches WHERE request_id = ?1",params![watch.request_id],|r|r.get::<_,bool>(0)).unwrap();
        assert!(active());
        payload["children"][0]["lastError"] = json!("Current connection failed; retry remains");
        assert!(!store.receive_background_result(&watch,payload.clone()).unwrap());
        assert!(active());
        payload["children"][0]["cancelAcknowledged"] = json!(true);
        assert!(store.receive_background_result(&watch,payload.clone()).unwrap());
        assert!(!active());
        payload["children"][0]["terminalConfirmed"] = json!("invented");
        assert!(store.receive_background_result(&watch,payload).is_err());
    }

    #[test]
    fn receipt_is_not_read_ack_and_acked_payload_remains_immutable() {
        let (store, watch, payload) = completed();
        assert!(store.receive_background_result(&watch, payload.clone()).unwrap());
        assert!(!store.receive_background_result(&watch, payload.clone()).unwrap());
        let page = store.list_background_inbox(0, 20, true).unwrap(); assert_eq!(page.items.len(), 1);
        let id = &page.items[0].id;
        assert_eq!(serde_json::from_str::<Value>(&store.read_background_inbox(id, 0).unwrap().text).unwrap(), payload);
        assert_eq!(store.list_background_inbox(0, 20, true).unwrap().items.len(), 1);
        store.acknowledge_background_inbox(id).unwrap(); store.acknowledge_background_inbox(id).unwrap();
        assert!(store.list_background_inbox(0, 20, true).unwrap().items.is_empty());
        assert_eq!(store.list_background_inbox(0, 20, false).unwrap().items.len(), 1);
        assert_eq!(store.background_task(&watch.request_id).unwrap().run.state, RunState::Done);
        assert!(store.acknowledge_background_inbox("missing").is_err());
    }

    #[test]
    fn changed_source_execution_and_stale_state_cannot_replace_a_received_result() {
        let (store, watch, payload) = completed();
        let mut other = payload.clone(); other["hostId"] = json!(Uuid::new_v4().to_string()); assert!(store.receive_background_result(&watch, other).is_err());
        assert!(store.receive_background_result(&watch, payload.clone()).unwrap());
        let mut rebound = payload.clone(); let execution = Uuid::new_v4().to_string(); rebound["run"]["id"] = json!(execution); rebound["run"]["taskId"] = rebound["run"]["id"].clone();
        assert!(store.receive_background_result(&watch, rebound).is_err());
        let mut stale = payload; stale["run"]["state"] = json!("pending");
        assert!(!store.receive_background_result(&watch, stale).unwrap());
        assert_eq!(store.list_background_inbox(0, 20, true).unwrap().items.len(), 1);
    }

    #[test]
    fn native_receipt_enforces_manifest_bounds_and_utf8_chunk_offsets() {
        let (store, watch, mut payload) = completed();
        let mut invalid = payload.clone(); invalid["artifacts"] = json!([{"id": Uuid::new_v4().to_string(), "relativePath": "../private", "contentHash": "0".repeat(64), "bytes": 1}]);
        assert!(store.receive_background_result(&watch, invalid).is_err());
        payload["run"]["output"] = json!("中文🙂".repeat(4000)); store.receive_background_result(&watch, payload).unwrap();
        let id = store.list_background_inbox(0, 1, false).unwrap().items[0].id.clone();
        let first = store.read_background_inbox(&id, 0).unwrap(); assert!(first.text.len() <= 16 * 1024); assert!(first.next_offset.is_some());
        let next = store.read_background_inbox(&id, first.next_offset.unwrap()).unwrap(); assert_eq!(first.snapshot_hash, next.snapshot_hash);
        assert!(store.read_background_inbox(&id, usize::MAX).is_err());
    }

    #[test]
    fn artifact_lookup_retains_received_owner_and_cannot_select_an_unlisted_artifact() {
        let (store, watch, mut payload) = completed();
        let artifact_id = Uuid::new_v4().to_string();
        let manifest = json!({"id": artifact_id, "relativePath": "product.docx", "contentHash": "0".repeat(64), "bytes": 1});
        payload["artifacts"] = json!([manifest]); store.receive_background_result(&watch, payload).unwrap();
        let id = store.list_background_inbox(0, 1, false).unwrap().items[0].id.clone();
        let (owner, actual) = store.background_inbox_artifact_source(&id, &artifact_id).unwrap();
        assert_eq!(owner.source_host_id, watch.source_host_id); assert_eq!(owner.request_id, watch.request_id); assert_eq!(actual, manifest);
        assert!(store.background_inbox_artifact_source(&id, &Uuid::new_v4().to_string()).is_err());
        assert!(store.background_inbox_artifact_source("missing", &artifact_id).is_err());
    }
}
fn stage(state: &str) -> i32 { match state { "pending" => 0, "leased" => 1, "waiting" => 2, "done" | "expired" => 3, _ => -1 } }

impl AutomationStore {
    pub(super) fn track_result_on_connection(conn: &Connection, host: &str, request: &str) -> Result<(), String> {
        if !canonical_id(host) || !canonical_id(request) { return Err("Result source and request must be stable UUIDs".into()); }
        let owner: Option<String> = conn.query_row("SELECT source_host_id FROM automation_result_watches WHERE request_id = ?1", params![request], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
        if let Some(owner) = owner { return if owner == host { Ok(()) } else { Err("Result request belongs to its original host".into()) }; }
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM automation_result_watches", [], |row| row.get(0)).map_err(|e| e.to_string())?;
        if count >= MAX_WATCHES { return Err("Result watch capacity reached; retain original task receipts".into()); }
        conn.execute("INSERT INTO automation_result_watches (request_id, source_host_id) VALUES (?1, ?2)", params![request, host]).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Rebuild watch indexes from protected request ownership, including lost
    /// submission ACKs. This grants no task execution or new peer authority.
    pub fn register_result_requests(&self, requests: &[BackgroundResultWatch]) -> Result<(), String> {
        if requests.len() > 4096 { return Err("Protected result ownership exceeds its bound".into()); }
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        for request in requests { Self::track_result_on_connection(&tx, &request.source_host_id, &request.request_id)?; }
        let host: String = tx.query_row("SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1'", [], |row| row.get(0)).map_err(|e| e.to_string())?;
        let missing = {
            let mut stmt = tx.prepare("SELECT request_id FROM automation_background_tasks b WHERE NOT EXISTS (SELECT 1 FROM automation_result_watches w WHERE w.request_id = b.request_id) ORDER BY b.created_at ASC LIMIT 4097").map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };
        if missing.len() > 4096 { return Err("Legacy result backfill exceeds its bounded batch".into()); }
        for request in missing { Self::track_result_on_connection(&tx, &host, &request)?; }
        tx.commit().map_err(|e| e.to_string())
    }

    /// Atomically reserve a bounded fair batch and persist failure backoff
    /// BEFORE making network requests. Concurrent refreshes cannot hot-loop.
    pub fn claim_result_watches(&self) -> Result<Vec<BackgroundResultWatch>, String> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let rows = {
            let mut stmt = tx.prepare("SELECT source_host_id, request_id, probes FROM automation_result_watches WHERE active = 1 AND retry_at <= ?1 ORDER BY retry_at ASC, request_id ASC LIMIT 4").map_err(|e| e.to_string())?;
            let rows = stmt.query_map(params![db::now_ms()], |row| Ok((BackgroundResultWatch { source_host_id: row.get(0)?, request_id: row.get(1)? }, row.get::<_, u32>(2)?))).map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };
        for (watch, probes) in &rows {
            let probes = probes.saturating_add(1).min(32);
            let delay = (30_000i64 * (1i64 << probes.min(5))).min(900_000);
            tx.execute("UPDATE automation_result_watches SET retry_at = ?2, probes = ?3 WHERE request_id = ?1", params![watch.request_id, db::now_ms() + delay, probes]).map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(rows.into_iter().map(|(watch, _)| watch).collect())
    }

    /// Only native synchronization passes authenticated snapshots here. Model
    /// tools and remote RPC cannot submit their own claimed success payload.
    pub(crate) fn receive_background_result(&self, watch: &BackgroundResultWatch, payload: Value) -> Result<bool, String> {
        self.receive_background_result_guarded(watch,payload,None,&mut ||false)
    }

    pub(crate) fn receive_background_result_guarded(&self, watch: &BackgroundResultWatch, payload: Value,
        receiver_scope: Option<(&str,&str)>, stopped: &mut impl FnMut()->bool) -> Result<bool,String> {
        let raw = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
        if raw.len() > MAX_SNAPSHOT_BYTES || text(&payload, "hostId", 36)? != watch.source_host_id || text(&payload, "requestId", 36)? != watch.request_id {
            return Err("Result snapshot exceeds limits or changed its task/source identity".into());
        }
        let name = text(&payload, "name", 256)?;
        text(&payload, "workdir", 32768)?;
        let run = &payload["run"];
        let execution = text(run, "id", 36)?;
        if !canonical_id(execution) || run["taskId"] != execution { return Err("Invalid result execution identity".into()); }
        let state = text(run, "state", 16)?;
        let success = run["success"].as_bool().ok_or_else(|| "Missing actual result status".to_string())?;
        text(run, "output", 256 * 1024)?;
        if stage(state) < 0 || (state != "done" && success) || name.trim().is_empty() { return Err("Contradictory result state".into()); }
        let revision = payload["checkpointRevision"].as_u64().filter(|n| *n <= 9_007_199_254_740_990).ok_or_else(|| "Invalid result revision".to_string())?;
        let artifacts = payload["artifacts"].as_array().filter(|a| a.len() <= 32).ok_or_else(|| "Invalid result artifact manifest".to_string())?;
        let mut artifact_bytes=0u64;
        for artifact in artifacts {
            let path = text(artifact, "relativePath", 1024)?;
            let hash = text(artifact, "contentHash", 64)?;
            if !canonical_id(text(artifact, "id", 36)?) || hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit())
                || path.is_empty() || path.contains(['\\', ':']) || path.split('/').any(|p| p.is_empty() || p == "." || p == "..")
                || artifact["bytes"].as_u64().filter(|n| *n <= super::MAX_STREAM_ARTIFACT_BYTES).is_none() {
                return Err("Result contains an invalid artifact identity/path/hash/size".into());
            }
            artifact_bytes=artifact_bytes.checked_add(artifact["bytes"].as_u64().ok_or("Invalid artifact size")?)
                .filter(|bytes|*bytes<=1024*1024*1024).ok_or("Result artifact manifest exceeds 1 GiB")?;
        }
        let in_flight = payload["operations"]["inFlight"].as_u64().filter(|n| *n <= 1024).ok_or_else(|| "Invalid result operation summary".to_string())?;
        // Older peers have no field. Only bounded authenticated host counts
        // extend polling; mutable retry/error metadata is not notification data.
        let cloud_cancellation = payload.get("cloudCancellation")
            .map(|value| serde_json::from_value::<BackgroundCloudCancellationSummary>(value.clone()).map_err(|e| e.to_string()))
            .transpose()?.unwrap_or(BackgroundCloudCancellationSummary { pending: 0, observed_terminal: 0 });
        if cloud_cancellation.pending > 1024 || cloud_cancellation.observed_terminal > 1024
            || cloud_cancellation.pending + cloud_cancellation.observed_terminal > 1024 {
            return Err("Invalid cloud cancellation result summary".into());
        }
        let children = super::children::validated_child_summaries(payload.get("children"))?;
        let child_pending = children.iter().any(|child|!child.terminal_confirmed || (child.cancel_requested && !child.cancel_acknowledged));
        let waiting = if state == "waiting" {
            let wait_id = text(&payload["waiting"], "waitId", 36)?;
            if !canonical_id(wait_id) || payload["waiting"]["createdAt"].as_i64().is_none() { return Err("Waiting result has no actual occurrence".into()); }
            Some(serde_json::json!({"waitId": wait_id, "createdAt": payload["waiting"]["createdAt"]}))
        } else { None };
        if success && payload["outcomes"]["verified"] != true { return Err("Successful result lacks its verified outcome report".into()); }
        // Mutable polling metadata must not repeatedly notify the same wait.
        let mut notification = serde_json::json!({
            "run": run, "artifacts": artifacts, "outcomes": payload["outcomes"], "operations": payload["operations"], "waiting": waiting,
        });
        // Adding a zero-valued optional field cannot generate a new notice for
        // a legacy peer/task. Actual cancellation transitions do change proof.
        if cloud_cancellation.pending > 0 || cloud_cancellation.observed_terminal > 0 {
            notification["cloudCancellation"] = serde_json::to_value(&cloud_cancellation).map_err(|e| e.to_string())?;
        }
        if !children.is_empty() {
            // Retry diagnostics can change without any new result. Retain them
            // in the payload, but notify only actual observation transitions.
            notification["children"] = Value::Array(children.iter().map(|child|serde_json::json!({"callId":child.call_id,"requestId":child.request_id,"peerId":child.peer_id,"accepted":child.accepted,"state":child.state,"success":child.success,"terminalConfirmed":child.terminal_confirmed,"cancelRequested":child.cancel_requested,"cancelAcknowledged":child.cancel_acknowledged})).collect());
        }
        let digest = hex::encode(Sha256::digest(serde_json::to_vec(&notification).map_err(|e| e.to_string())?));
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        if stopped() { return Err("OS result receive was stopped".into()); }
        if let Some((installation,binding))=receiver_scope {
            let owned:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_meta m JOIN automation_result_delivery_targets t ON t.request_id=?2 JOIN automation_result_watches w ON w.request_id=t.request_id AND w.source_host_id=t.source_host_id WHERE m.key='background_worker_id.v1' AND m.value=?1 AND t.source_host_id=?3 AND t.binding_hash=?4 AND t.configured=1 AND w.active=1)",params![installation,watch.request_id,watch.source_host_id,binding],|row|row.get(0)).map_err(|e|e.to_string())?;
            if !owned {return Err("OS result scope changed or was revoked; no result received".into());}
        }
        let previous: (String, Option<String>, u64, Option<String>) = tx.query_row("SELECT source_host_id, execution_id, last_revision, last_state FROM automation_result_watches WHERE request_id = ?1", params![watch.request_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))).map_err(|e| e.to_string())?;
        if previous.0 != watch.source_host_id || previous.1.as_deref().is_some_and(|id| id != execution) { return Err("Result source/execution changed; no result was received".into()); }
        if revision < previous.2 || (revision == previous.2 && previous.3.as_deref().is_some_and(|old| stage(old) > stage(state)))
            || previous.3.as_deref().is_some_and(|old| stage(old) == 3 && old != state) { return Ok(false); }
        let deliverable = matches!(state, "waiting" | "done" | "expired");
        let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_result_inbox WHERE source_host_id = ?1 AND request_id = ?2 AND content_hash = ?3)", params![watch.source_host_id, watch.request_id, digest], |row| row.get(0)).map_err(|e| e.to_string())?;
        let inserted = deliverable && !exists;
        if inserted {
            let (bytes, count, sequence): (i64, i64, i64) = tx.query_row("SELECT COALESCE(SUM(LENGTH(CAST(payload_json AS BLOB))), 0), COUNT(*), COALESCE(MAX(sequence), 0) FROM automation_result_inbox", [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).map_err(|e| e.to_string())?;
            if bytes + raw.len() as i64 > MAX_INBOX_BYTES || count >= 16384 || sequence >= 9_007_199_254_740_990 { return Err("Result inbox capacity reached; host evidence and retry remain intact".into()); }
            tx.execute("INSERT INTO automation_result_inbox (entry_id, source_host_id, request_id, content_hash, payload_json, received_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)", params![Uuid::new_v4().to_string(), watch.source_host_id, watch.request_id, digest, raw, db::now_ms()]).map_err(|e| e.to_string())?;
        }
        // A terminal run may still receive its original late operation receipt.
        let active = !matches!(state, "done" | "expired") || in_flight > 0 || cloud_cancellation.pending > 0 || child_pending;
        tx.execute("UPDATE automation_result_watches SET execution_id = ?2, last_revision = ?3, last_state = ?4, last_digest = ?5, last_received_at = ?6, probes = 0, retry_at = ?7, active = ?8 WHERE request_id = ?1",
            params![watch.request_id, execution, revision as i64, state, digest, db::now_ms(), db::now_ms() + if stage(state) == 3 { 300_000 } else { 30_000 }, active]).map_err(|e| e.to_string())?;
        super::goal_progress::reconcile(&tx,&watch.request_id)?;
        if stopped() { return Err("OS result receive stopped before durable publication".into()); }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(inserted)
    }

    pub fn list_background_inbox(&self, cursor: u64, limit: usize, unread_only: bool) -> Result<BackgroundInboxPage, String> {
        if cursor > 9_007_199_254_740_990 || !(1..=20).contains(&limit) { return Err("Inbox cursor/limit is out of bounds".into()); }
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare("SELECT entry_id, sequence, source_host_id, request_id, payload_json, received_at, read_at FROM automation_result_inbox i WHERE sequence > ?1 AND (?2 = 0 OR (read_at IS NULL AND NOT EXISTS (SELECT 1 FROM automation_result_inbox newer WHERE newer.request_id = i.request_id AND newer.sequence > i.sequence))) ORDER BY sequence ASC LIMIT ?3").map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![cursor as i64, unread_only, (limit + 1) as i64], |row| Ok((row.get::<_, String>(0)?, row.get::<_, u64>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?, row.get::<_, String>(4)?, row.get::<_, i64>(5)?, row.get::<_, Option<i64>>(6)?))).map_err(|e| e.to_string())?;
        let mut items = rows.map(|row| {
            let (id, sequence, source_host_id, request_id, raw, received_at, read_at) = row.map_err(|e| e.to_string())?;
            let payload: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            Ok(BackgroundInboxItem { id, sequence, source_host_id, request_id, received_at, read_at,
                name: text(&payload, "name", 256)?.into(), state: text(&payload["run"], "state", 16)?.into(), success: payload["run"]["success"].as_bool().ok_or_else(|| "Invalid stored status".to_string())?,
                preview: text(&payload["run"], "output", 256 * 1024)?.chars().take(512).collect(), artifact_count: payload["artifacts"].as_array().map_or(0, Vec::len),
            })
        }).collect::<Result<Vec<_>, String>>()?;
        let next_cursor = if items.len() > limit { items.truncate(limit); items.last().map(|item| item.sequence) } else { None };
        Ok(BackgroundInboxPage { items, next_cursor })
    }

    pub fn read_background_inbox(&self, id: &str, offset: usize) -> Result<BackgroundInboxChunk, String> {
        let conn = self.lock_conn()?;
        let raw: String = conn.query_row("SELECT payload_json FROM automation_result_inbox WHERE entry_id = ?1", params![id], |row| row.get(0)).map_err(|e| e.to_string())?;
        if offset > raw.len() || !raw.is_char_boundary(offset) { return Err("Inbox offset must be an actual UTF-8 byte boundary".into()); }
        let mut end = (offset + 16 * 1024).min(raw.len());
        while !raw.is_char_boundary(end) { end -= 1; }
        Ok(BackgroundInboxChunk { entry_id: id.into(), offset, total_bytes: raw.len(), text: raw[offset..end].into(),
            next_offset: if end < raw.len() { Some(end) } else { None }, snapshot_hash: hex::encode(Sha256::digest(raw.as_bytes())),
        })
    }

    /// The immutable received entry determines both owner and artifact. A
    /// client cannot redirect a download by supplying a different peer/path.
    pub fn background_inbox_artifact_source(&self, id: &str, artifact_id: &str) -> Result<(BackgroundResultWatch, Value), String> {
        let conn = self.lock_conn()?;
        let (source_host_id, request_id, raw): (String, String, String) = conn.query_row(
            "SELECT source_host_id, request_id, payload_json FROM automation_result_inbox WHERE entry_id = ?1",
            params![id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).map_err(|e| e.to_string())?;
        let payload: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let artifact = payload["artifacts"].as_array().and_then(|items| items.iter().find(|item| item["id"] == artifact_id))
            .cloned().ok_or_else(|| "Artifact is not in this received result".to_string())?;
        Ok((BackgroundResultWatch { source_host_id, request_id }, artifact))
    }

    /// Reading bytes is not an ACK. Explicit acknowledgment never deletes
    /// snapshots, artifacts on the host, or another device's unread status.
    pub fn acknowledge_background_inbox(&self, id: &str) -> Result<(), String> {
        let conn = self.lock_conn()?;
        if conn.execute("UPDATE automation_result_inbox SET read_at = COALESCE(read_at, ?2) WHERE entry_id = ?1", params![id, db::now_ms()]).map_err(|e| e.to_string())? == 0 { return Err("Inbox entry not found".into()); }
        Ok(())
    }
}
