use std::sync::Arc;

use crate::services::provider_oauth::{
    ProviderOAuthDeviceCode, ProviderOAuthPollResult, ProviderOAuthService, ProviderOAuthStatus,
};

#[tauri::command]
pub async fn provider_oauth_start_codex(
    service: tauri::State<'_, Arc<ProviderOAuthService>>,
) -> Result<ProviderOAuthDeviceCode, String> {
    service.start_codex_device_flow().await
}

#[tauri::command]
pub async fn provider_oauth_poll_codex(
    flow_id: String,
    service: tauri::State<'_, Arc<ProviderOAuthService>>,
) -> Result<ProviderOAuthPollResult, String> {
    service.poll_codex_device_flow(flow_id.trim()).await
}

#[tauri::command]
pub async fn provider_oauth_status_codex(
    service: tauri::State<'_, Arc<ProviderOAuthService>>,
) -> Result<ProviderOAuthStatus, String> {
    Ok(service.codex_status().await)
}

#[tauri::command]
pub async fn provider_oauth_set_default_codex_account(
    account_id: String,
    service: tauri::State<'_, Arc<ProviderOAuthService>>,
) -> Result<ProviderOAuthStatus, String> {
    service
        .set_default_codex_account(account_id.trim())
        .await?;
    Ok(service.codex_status().await)
}

#[tauri::command]
pub async fn provider_oauth_remove_codex_account(
    account_id: String,
    service: tauri::State<'_, Arc<ProviderOAuthService>>,
) -> Result<ProviderOAuthStatus, String> {
    service.remove_codex_account(account_id.trim()).await?;
    Ok(service.codex_status().await)
}

#[tauri::command]
pub async fn provider_oauth_logout_codex(
    service: tauri::State<'_, Arc<ProviderOAuthService>>,
) -> Result<ProviderOAuthStatus, String> {
    service.logout_codex().await?;
    Ok(service.codex_status().await)
}
