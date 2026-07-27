use std::sync::Arc;

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
pub fn cloud_secret_vault_unlock(
    passphrase: String,
    vault: tauri::State<'_, Arc<CloudSecretVault>>,
) -> Result<CloudSecretVaultStatus, String> {
    vault.unlock(&passphrase)
}

#[tauri::command]
pub fn cloud_secret_vault_lock(
    vault: tauri::State<'_, Arc<CloudSecretVault>>,
) -> Result<CloudSecretVaultStatus, String> {
    vault.lock()
}

#[tauri::command]
pub fn cloud_secret_vault_set_github_token(
    token: String,
    vault: tauri::State<'_, Arc<CloudSecretVault>>,
) -> Result<CloudSecretVaultStatus, String> {
    vault.set_github_token(&token)
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
