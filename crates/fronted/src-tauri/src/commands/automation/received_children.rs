use std::sync::Arc;
use crate::services::automation::AutomationStore;
use crate::services::worker_peers::WorkerPeerRegistry;

/// Read the original parent's retained observations, never contact a child
/// using a client-supplied host or invent a new pairing/dispatch authority.
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_result_child(
    window: tauri::WebviewWindow, entry_id: String, call_id: String, offset: usize,
    snapshot_hash: Option<String>, store: tauri::State<'_, Arc<AutomationStore>>,
    registry: tauri::State<'_, Arc<WorkerPeerRegistry>>,
) -> Result<serde_json::Value, String> {
    if window.label() != "main" { return Err("Received child observations belong to the main client".into()); }
    if call_id.is_empty() || call_id.len() > 256 || offset > 512 * 1024
        || snapshot_hash.as_ref().is_some_and(|hash| hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit())) {
        return Err("Invalid received child snapshot boundary".into());
    }
    let owned = Arc::clone(store.inner()); let source = Arc::clone(&owned); let entry = entry_id.clone();
    let (host, watch) = tauri::async_runtime::spawn_blocking(move || {
        let (watch, _) = source.received_task_source(&entry)?;
        Ok::<_, String>((source.background_worker_identity()?, watch))
    }).await.map_err(|error| error.to_string())??;
    let actual = if host == watch.source_host_id {
        let source = Arc::clone(&owned); let request = watch.request_id.clone();
        let call = call_id.clone(); let hash = snapshot_hash.clone();
        tauri::async_runtime::spawn_blocking(move || source.read_background_children(&request, Some(&call), offset, hash.as_deref()))
            .await.map_err(|error| error.to_string())??
    } else {
        registry.invoke(&watch.source_host_id, "automation_background_children", serde_json::json!({
            "request_id": watch.request_id, "call_id": call_id, "offset": offset, "snapshot_hash": snapshot_hash,
        })).await?
    };
    if actual["requestId"] != watch.request_id || actual["hostId"] != watch.source_host_id || actual["child"]["callId"] != call_id {
        return Err("Received child observation changed its original parent or call".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let (current, _) = owned.received_task_source(&entry_id)?;
        if current.source_host_id != watch.source_host_id || current.request_id != watch.request_id {
            return Err("Received child parent changed during observation".into());
        }
        Ok(actual)
    }).await.map_err(|error| error.to_string())?
}
