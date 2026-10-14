#[tauri::command]
pub async fn tailscale_setup_status(window:tauri::WebviewWindow) -> Result<serde_json::Value,String> {
    if window.label()!="main" {return Err("Tailscale setup belongs to this device's main client".into());}
    serde_json::to_value(crate::services::tailscale_status::observe().await).map_err(|e|e.to_string())
}

#[tauri::command]
pub async fn tailscale_authenticate(window:tauri::WebviewWindow,input:crate::services::tailscale_setup::TailscaleAuthInput) -> Result<crate::services::tailscale_status::TailscaleStatus,String> {
    if window.label()!="main" {return Err("Tailscale setup belongs to this device's main client".into());}
    crate::services::embedded_tailnet::authenticate(input).await
}

#[tauri::command]
pub async fn tailscale_logout(window:tauri::WebviewWindow) -> Result<crate::services::tailscale_status::TailscaleStatus,String> {
    if window.label()!="main" {return Err("Tailscale setup belongs to this device's main client".into());}
    crate::services::embedded_tailnet::logout().await
}
