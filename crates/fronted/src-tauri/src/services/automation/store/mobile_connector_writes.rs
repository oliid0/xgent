use super::*;

pub(super) fn validate_input(input: &MobileConnectorWriteInput) -> Result<String, String> {
    if input.operation_id.len() != 64 || !input.operation_id.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        || Uuid::parse_str(&input.device_host_id).map(|id| id.to_string() != input.device_host_id).unwrap_or(true)
        || !matches!(input.kind.as_str(), "calendar_event" | "reminder" | "home_power") || !input.request.is_object() {
        return Err("Invalid device-bound connector operation".into());
    }
    let raw = serde_json::to_string(&input.request).map_err(|e| e.to_string())?;
    if raw.len() > 32 * 1024 { return Err("Connector request exceeds 32 KiB".into()); }
    Ok(raw)
}

fn row(row: &rusqlite::Row<'_>) -> rusqlite::Result<(String, String, String, String, String, String, Option<String>, Option<String>, i64, Option<i64>)> {
    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?, row.get(8)?, row.get(9)?))
}
fn decode(data: (String, String, String, String, String, String, Option<String>, Option<String>, i64, Option<i64>)) -> Result<MobileConnectorWriteRecord, String> {
    Ok(MobileConnectorWriteRecord {
        input: MobileConnectorWriteInput { operation_id: data.0, device_host_id: data.1, kind: data.2, request: serde_json::from_str(&data.3).map_err(|e| e.to_string())? },
        destination: serde_json::from_str(&data.4).map_err(|e| e.to_string())?, state: data.5,
        result: data.6.map(|raw| serde_json::from_str(&raw).map_err(|e| e.to_string())).transpose()?, error: data.7, started_at: data.8, finished_at: data.9,
    })
}
pub(super) fn read(conn: &Connection, input: &MobileConnectorWriteInput) -> Result<Option<MobileConnectorWriteRecord>, String> {
    validate_input(input)?;
    let actual: String = conn.query_row("SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1'", [], |row| row.get(0)).map_err(|e| e.to_string())?;
    if actual != input.device_host_id { return Err("Connector operation belongs to another installation".into()); }
    let saved = conn.query_row("SELECT operation_id, device_host_id, kind, request_json, destination_json, state, result_json, error, started_at, finished_at FROM automation_mobile_connector_writes WHERE operation_id = ?1", params![input.operation_id], row)
        .optional().map_err(|e| e.to_string())?.map(decode).transpose()?;
    if saved.as_ref().is_some_and(|record| record.input.device_host_id != input.device_host_id || record.input.kind != input.kind || record.input.request != input.request) {
        return Err("Operation identity already has different immutable device/connector/arguments; no write was replayed".into());
    }
    Ok(saved)
}

impl AutomationStore {
    pub(crate) fn check_home_power_policy(&self)->Result<(),String> {
        let conn=self.lock_conn()?;
        crate::commands::settings::mobile_task_action_requires_approval(&conn,"home_power")?;
        Ok(())
    }
    #[cfg(any(mobile, test))]
    pub(crate) fn recover_mobile_connector_writes_on_startup(conn: &Connection) -> Result<(), String> {
        conn.execute("UPDATE automation_mobile_connector_writes SET state = 'unknown', error = 'App restarted before the native receipt was durably saved; inspect device records before issuing a new operation' WHERE state = 'running'", []).map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn read_mobile_connector_write(&self, input: &MobileConnectorWriteInput) -> Result<Option<MobileConnectorWriteRecord>, String> {
        let conn = self.lock_conn()?;
        read(&conn, input)
    }

    /// Only the native command calls this, after observing a writable OS
    /// destination. Return false for ALL previous claims, even without ACK.
    pub(crate) fn begin_mobile_connector_write(&self, input: MobileConnectorWriteInput, destination: Value) -> Result<(MobileConnectorWriteRecord, bool), String> {
        self.begin_mobile_connector_write_guarded(input,destination,|conn,input| {
            if input.kind=="home_power" {
                crate::commands::settings::mobile_task_action_requires_approval(conn,"home_power")?;
                let unsettled:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM automation_mobile_connector_writes WHERE kind='home_power' AND state IN ('running','unknown') AND json_extract(request_json,'$.homeId')=?1 AND json_extract(request_json,'$.characteristicId')=?2)",params![input.request["homeId"].as_str(),input.request["characteristicId"].as_str()],|row|row.get(0)).map_err(|e|e.to_string())?;
                if unsettled {return Err("This Home target has an unsettled operation; no replacement write was started".into());}
            }
            let owned: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM automation_mobile_branch_action_owners WHERE operation_id = ?1)",params![input.operation_id],|row|row.get(0)).map_err(|e|e.to_string())?;
            if owned { return Err("Task-owned operation must use its original branch authorization path".into()); }
            Ok(())
        })
    }

    pub(super) fn begin_mobile_connector_write_guarded(&self, input: MobileConnectorWriteInput, destination: Value,
        guard: impl FnOnce(&Connection,&MobileConnectorWriteInput) -> Result<(),String>) -> Result<(MobileConnectorWriteRecord, bool), String> {
        let raw = validate_input(&input)?;
        let target = serde_json::to_string(&destination).map_err(|e| e.to_string())?;
        if !destination.is_object() || target.len() > 4096 || destination["id"].as_str().is_none_or(|id| id.is_empty()) {
            return Err("An actual bounded writable OS destination is required".into());
        }
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        if let Some(saved) = read(&tx, &input)? { return Ok((saved, false)); }
        guard(&tx,&input)?;
        let (count, bytes): (i64, i64) = tx.query_row("SELECT COUNT(*), COALESCE(SUM(LENGTH(CAST(request_json AS BLOB)) + LENGTH(CAST(destination_json AS BLOB)) + 32768), 0) FROM automation_mobile_connector_writes", [], |row| Ok((row.get(0)?, row.get(1)?))).map_err(|e| e.to_string())?;
        // Reserve room for a later receipt/error before starting the effect.
        if count >= 4096 || bytes + raw.len() as i64 + target.len() as i64 + 32 * 1024 > 128 * 1024 * 1024 { return Err("Connector ledger capacity reached; no native write was started".into()); }
        let started_at = db::now_ms();
        tx.execute("INSERT INTO automation_mobile_connector_writes (operation_id, device_host_id, kind, request_json, destination_json, state, started_at) VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?6)", params![input.operation_id, input.device_host_id, input.kind, raw, target, started_at]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok((MobileConnectorWriteRecord { input, destination, state: "running".into(), result: None, error: None, started_at, finished_at: None }, true))
    }

    /// Not exposed as an IPC command: a frontend/model cannot invent receipts.
    pub(crate) fn complete_mobile_connector_write(&self, input: &MobileConnectorWriteInput, result: Result<Value, String>) -> Result<MobileConnectorWriteRecord, String> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let saved = read(&tx, input)?.ok_or_else(|| "Connector operation has no durable claim".to_string())?;
        if saved.state != "running" { return Ok(saved); }
        let receipt = result.and_then(|value| {
            if value["presented"] != false || value["id"].as_str().is_none_or(|id| id.trim().is_empty()) || value["detail"].as_str().is_none()
                || (input.kind=="home_power" && (value["id"]!=input.request["characteristicId"] || saved.destination["sourceId"]!=input.request["homeId"]))
                || serde_json::to_vec(&value).map_err(|e| e.to_string())?.len() > 32 * 1024 {
                return Err("Native operation did not confirm a bounded saved record ID; inspect device records, do not replay".into());
            }
            Ok(value)
        });
        let (state, raw, error) = match receipt {
            Ok(value) => ("succeeded", Some(serde_json::to_string(&value).map_err(|e| e.to_string())?), None),
            Err(error) => ("unknown", None, Some(error.chars().take(2048).collect::<String>())),
        };
        tx.execute("UPDATE automation_mobile_connector_writes SET state = ?2, result_json = ?3, error = ?4, finished_at = ?5 WHERE operation_id = ?1 AND state = 'running'", params![input.operation_id, state, raw, error, db::now_ms()]).map_err(|e| e.to_string())?;
        let record = read(&tx, input)?.ok_or_else(|| "Connector receipt disappeared".to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(record)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn packet(store: &AutomationStore) -> MobileConnectorWriteInput {
        MobileConnectorWriteInput { operation_id: "a".repeat(64), device_host_id: store.background_worker_identity().unwrap(),
            kind: "reminder".into(), request: json!({"title":"Exercise", "calendarId":"actual-list", "dueMs":2000000000000_i64,"recurrence":"daily"}) }
    }
    fn target() -> Value { json!({"kind":"reminder", "id":"actual-list", "sourceId":"actual-account", "source":"Work"}) }

    #[test]
    fn a_claim_never_replays_and_native_receipts_preserve_original_target() {
        let store = AutomationStore::open_in_memory().unwrap(); let input = packet(&store);
        assert!(store.begin_mobile_connector_write(input.clone(), target()).unwrap().1);
        assert!(!store.begin_mobile_connector_write(input.clone(), target()).unwrap().1);
        let receipt = json!({"id":"saved-id", "presented":false,"detail":"Saved"});
        let saved = store.complete_mobile_connector_write(&input, Ok(receipt.clone())).unwrap();
        assert_eq!(saved.state, "succeeded"); assert_eq!(saved.result, Some(receipt));
        let (retry, acquired) = store.begin_mobile_connector_write(input.clone(), json!({"id":"changed-default","sourceId":"another-account"})).unwrap();
        assert!(!acquired); assert_eq!(retry.destination, target()); assert_eq!(retry.result, saved.result);
        let mut changed = input.clone(); changed.request["title"] = json!("Changed intent");
        assert!(store.begin_mobile_connector_write(changed, target()).is_err());
        let mut foreign = input.clone(); foreign.device_host_id = Uuid::new_v4().to_string();
        assert!(store.read_mobile_connector_write(&foreign).is_err());
        store.bind_worker_identity(&Uuid::new_v4().to_string()).unwrap();
        assert!(store.read_mobile_connector_write(&input).is_err());
    }

    #[test]
    fn unknown_errors_and_composers_cannot_become_success_or_new_effects() {
        for receipt in [Err("Native reply lost after write".into()), Ok(json!({"id":null,"presented":true,"detail":"Draft"})), Ok(json!({"id":"","presented":false,"detail":"No record"}))] {
            let store = AutomationStore::open_in_memory().unwrap(); let input = packet(&store);
            store.begin_mobile_connector_write(input.clone(), target()).unwrap();
            let result = store.complete_mobile_connector_write(&input, receipt).unwrap();
            assert_eq!(result.state, "unknown"); assert!(result.result.is_none());
            assert!(!store.begin_mobile_connector_write(input.clone(), target()).unwrap().1);
            assert_eq!(store.complete_mobile_connector_write(&input, Ok(json!({"id":"invented","presented":false,"detail":"Late"}))).unwrap().state, "unknown");
        }
    }

    #[test]
    fn concurrent_claims_have_one_executor_and_restart_recovery_does_not_requeue_effects() {
        let store = std::sync::Arc::new(AutomationStore::open_in_memory().unwrap()); let input = packet(&store);
        let attempts: Vec<_> = (0..2).map(|_| { let store = std::sync::Arc::clone(&store); let input = input.clone();
            std::thread::spawn(move || store.begin_mobile_connector_write(input, target()).unwrap().1) }).collect();
        assert_eq!(attempts.into_iter().map(|attempt| attempt.join().unwrap()).filter(|acquired| *acquired).count(), 1);
        AutomationStore::recover_mobile_connector_writes_on_startup(&store.lock_conn().unwrap()).unwrap();
        assert_eq!(store.read_mobile_connector_write(&input).unwrap().unwrap().state, "unknown");
        assert!(!store.begin_mobile_connector_write(input, target()).unwrap().1);
    }
}
