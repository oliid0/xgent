use std::sync::Arc;
use serde_json::Value;
use tauri::Emitter;

use crate::services::local_access::{LocalAccessController, LocalAccessStatus};
use crate::services::workspace_watch::WorkspaceWatchService;

#[tauri::command]
pub fn local_access_status(
    controller: tauri::State<'_, Arc<LocalAccessController>>,
) -> Result<LocalAccessStatus, String> {
    controller.status()
}

#[tauri::command]
pub fn local_access_rotate_pairing_code(
    controller: tauri::State<'_, Arc<LocalAccessController>>,
) -> Result<LocalAccessStatus, String> {
    controller.rotate_pairing_code()
}

#[tauri::command]
pub fn local_access_revoke_all_devices(
    controller: tauri::State<'_, Arc<LocalAccessController>>,
) -> Result<LocalAccessStatus, String> {
    controller.revoke_all_devices()
}

#[tauri::command]
pub fn workspace_watch_set(
    workdirs: Vec<String>,
    workspace_watch: tauri::State<'_, Arc<WorkspaceWatchService>>,
) -> Result<(), String> {
    workspace_watch.set_desired(workdirs);
    Ok(())
}

#[tauri::command]
pub fn local_access_rpc_respond(
    request_id: String,
    ok: bool,
    result: Option<Value>,
    error: Option<String>,
    controller: tauri::State<'_, Arc<LocalAccessController>>,
) -> Result<(), String> {
    let outcome = if ok {
        Ok(result.unwrap_or(Value::Null))
    } else {
        Err(error.unwrap_or_else(|| "local access RPC failed".to_string()))
    };
    controller.complete_rpc(&request_id, outcome)
}

#[tauri::command]
pub fn local_access_event_publish(
    subscription_id: String,
    payload: Value,
    controller: tauri::State<'_, Arc<LocalAccessController>>,
) -> Result<(), String> {
    controller.publish_browser_event(&subscription_id, payload)
}

#[tauri::command]
pub fn local_access_broadcast_event(
    event: String,
    payload: Value,
    app: tauri::AppHandle,
) -> Result<(), String> {
    const ALLOWED_EVENTS: &[&str] = &[
        "xgent:chat-queue",
        "xgent:chat-runtime",
        "xgent:conversation-event",
    ];
    let event = event.trim();
    if !ALLOWED_EVENTS.contains(&event) {
        return Err("local access broadcast event is not allowed".to_string());
    }
    app.emit(event, payload)
        .map_err(|error| format!("broadcast local access event failed: {error}"))
}
