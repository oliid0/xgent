use std::sync::Arc;

use tauri_plugin_opener::OpenerExt;

use crate::services::cloud_execution::{
    CloudExecutionService, CloudTaskArtifactResult, CloudTaskFailureReport, CloudTaskLocator,
    CloudTaskStartInput, CloudTaskStartResult, CloudTaskStatus,
};
use crate::services::cloud_secret_vault::{CloudSecretVault, CloudSecretVaultStatus};

#[tauri::command]
pub fn cloud_secret_vault_status(
    vault: tauri::State<'_, Arc<CloudSecretVault>>,
) -> Result<CloudSecretVaultStatus, String> {
    vault.status()
}

#[tauri::command]
pub fn cloud_secret_vault_set_github_token(
    username: String,
    token: String,
    vault: tauri::State<'_, Arc<CloudSecretVault>>,
) -> Result<CloudSecretVaultStatus, String> {
    vault.set_github_token(&username, &token)
}

#[tauri::command]
pub fn cloud_secret_vault_remove_github_token(
    vault: tauri::State<'_, Arc<CloudSecretVault>>,
) -> Result<CloudSecretVaultStatus, String> {
    vault.remove_github_token()
}

#[tauri::command]
pub async fn cloud_task_start(
    input: CloudTaskStartInput,
    service: tauri::State<'_, Arc<CloudExecutionService>>,
    vault: tauri::State<'_, Arc<CloudSecretVault>>,
) -> Result<CloudTaskStartResult, String> {
    let token = vault.github_token()?;
    service.start_task(&token, input).await
}

#[tauri::command]
pub async fn cloud_task_status(
    locator: CloudTaskLocator,
    service: tauri::State<'_, Arc<CloudExecutionService>>,
    vault: tauri::State<'_, Arc<CloudSecretVault>>,
) -> Result<CloudTaskStatus, String> {
    let token = vault.github_token()?;
    service.task_status(&token, &locator).await
}

#[tauri::command]
pub async fn cloud_task_wait(
    locator: CloudTaskLocator,
    max_wait_seconds: Option<u64>,
    service: tauri::State<'_, Arc<CloudExecutionService>>,
    vault: tauri::State<'_, Arc<CloudSecretVault>>,
) -> Result<CloudTaskStatus, String> {
    let token = vault.github_token()?;
    service
        .wait_for_task(&token, &locator, max_wait_seconds.unwrap_or(45))
        .await
}

#[tauri::command]
pub async fn cloud_task_failure_log(
    locator: CloudTaskLocator,
    service: tauri::State<'_, Arc<CloudExecutionService>>,
    vault: tauri::State<'_, Arc<CloudSecretVault>>,
) -> Result<CloudTaskFailureReport, String> {
    let token = vault.github_token()?;
    service.failure_log(&token, &locator).await
}

#[tauri::command]
pub async fn cloud_task_download_artifact(
    locator: CloudTaskLocator,
    destination_dir: Option<String>,
    service: tauri::State<'_, Arc<CloudExecutionService>>,
    vault: tauri::State<'_, Arc<CloudSecretVault>>,
) -> Result<CloudTaskArtifactResult, String> {
    let token = vault.github_token()?;
    service
        .download_artifact(&token, &locator, destination_dir.as_deref())
        .await
}

#[tauri::command]
pub fn cloud_task_open_artifact(
    local_path: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let path = std::path::PathBuf::from(local_path.trim());
    if path.as_os_str().is_empty() {
        return Err("cloud artifact path cannot be empty".to_string());
    }
    let metadata = std::fs::metadata(&path)
        .map_err(|error| format!("cloud artifact is unavailable: {error}"))?;
    if !metadata.is_file() {
        return Err("cloud artifact path is not a file".to_string());
    }

    #[cfg(desktop)]
    {
        app.opener()
            .reveal_item_in_dir(&path)
            .map_err(|error| format!("reveal cloud artifact failed: {error}"))
    }
    #[cfg(mobile)]
    {
        app.opener()
            .open_path(path.to_string_lossy(), None::<&str>)
            .map_err(|error| format!("open cloud artifact failed: {error}"))
    }
}
