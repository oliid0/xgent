use std::sync::Arc;

use serde_json::Value;
use tauri::Emitter;

use crate::services::lan_pc_client::{
    LanPcClient, LanPcClientStatus, LanPcSubscription, LAN_PC_SESSION_CHANGED_EVENT,
};

#[tauri::command]
pub async fn lan_pc_status(
    client: tauri::State<'_, Arc<LanPcClient>>,
) -> Result<LanPcClientStatus, String> {
    Ok(client.status().await)
}

#[tauri::command]
pub async fn lan_pc_pair(
    base_url: String,
    code: String,
    device_name: String,
    client: tauri::State<'_, Arc<LanPcClient>>,
    app_handle: tauri::AppHandle,
) -> Result<LanPcClientStatus, String> {
    let status = client.pair(&base_url, &code, &device_name).await?;
    let _ = app_handle.emit(LAN_PC_SESSION_CHANGED_EVENT, &status);
    Ok(status)
}

#[tauri::command]
pub async fn lan_pc_refresh(
    base_url: Option<String>,
    client: tauri::State<'_, Arc<LanPcClient>>,
    app_handle: tauri::AppHandle,
) -> Result<LanPcClientStatus, String> {
    let status = client.refresh(base_url.as_deref()).await?;
    let _ = app_handle.emit(LAN_PC_SESSION_CHANGED_EVENT, &status);
    Ok(status)
}

#[tauri::command]
pub async fn lan_pc_disconnect(
    client: tauri::State<'_, Arc<LanPcClient>>,
    app_handle: tauri::AppHandle,
) -> Result<LanPcClientStatus, String> {
    let status = client.disconnect().await?;
    let _ = app_handle.emit(LAN_PC_SESSION_CHANGED_EVENT, &status);
    Ok(status)
}

#[tauri::command]
pub async fn lan_pc_invoke(
    base_url: Option<String>,
    command: String,
    args: Value,
    client: tauri::State<'_, Arc<LanPcClient>>,
) -> Result<Value, String> {
    client.invoke(base_url.as_deref(), &command, args).await
}

#[tauri::command]
pub async fn lan_pc_subscribe(
    base_url: Option<String>,
    event: String,
    client: tauri::State<'_, Arc<LanPcClient>>,
    app_handle: tauri::AppHandle,
) -> Result<LanPcSubscription, String> {
    client
        .subscribe(base_url.as_deref(), &event, app_handle)
        .await
}

#[tauri::command]
pub async fn lan_pc_unsubscribe(
    subscription_id: String,
    client: tauri::State<'_, Arc<LanPcClient>>,
) -> Result<(), String> {
    client.unsubscribe(&subscription_id).await
}
