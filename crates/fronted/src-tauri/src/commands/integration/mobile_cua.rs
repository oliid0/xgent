use serde_json::{json, Value};
use tauri_plugin_mobile_assistant::MobileAssistantExt;

async fn dispatch(app: tauri::AppHandle, request: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.mobile_assistant().computer_use(request).map_err(|error| error.to_string())
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn cua_call(app: tauri::AppHandle, operation: String, arguments: Value, run_id: String) -> Result<Value, String> {
    dispatch(app, json!({"operation":operation,"arguments":arguments,"runId":run_id})).await
}
#[tauri::command]
pub async fn cua_status(app: tauri::AppHandle) -> Result<Value, String> {
    dispatch(app, json!({"operation":"status"})).await
}
#[tauri::command(rename_all = "snake_case")]
pub async fn cua_cancel(app: tauri::AppHandle, run_id: String) -> Result<Value, String> {
    dispatch(app, json!({"operation":"cancel","runId":run_id})).await
}
#[tauri::command]
pub async fn cua_set_enabled(app: tauri::AppHandle, enabled: bool) -> Result<Value, String> {
    dispatch(app, json!({"operation":"set_enabled","arguments":{"enabled":enabled}})).await
}
#[tauri::command(rename_all = "snake_case")]
pub async fn cua_preview(app: tauri::AppHandle, target: String, max_image_size: Option<u32>) -> Result<Value, String> {
    dispatch(app, json!({"operation":"capture_preview","arguments":{"app":target,"max_image_size":max_image_size}})).await
}
