use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::{MobileExecutionExt, Result};

// run_mobile_plugin waits synchronously for Swift/Kotlin. Never occupy a Tokio
// executor thread while an install, command or native picker is pending: the
// same executor must keep serving model traffic and unrelated assistant tools.
async fn on_worker<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| crate::Error::Worker(error.to_string()))?
}

#[command]
pub(crate) async fn status<R: Runtime>(app: AppHandle<R>) -> Result<MobileExecutionStatus> {
    on_worker(move || app.mobile_execution().status()).await
}

#[command]
pub(crate) async fn install<R: Runtime>(
    app: AppHandle<R>,
    request: InstallRequest,
) -> Result<InstallResponse> {
    on_worker(move || app.mobile_execution().install(request)).await
}

#[command]
pub(crate) async fn install_toolchains<R: Runtime>(
    app: AppHandle<R>,
    request: InstallToolchainsRequest,
) -> Result<InstallToolchainsResponse> {
    on_worker(move || app.mobile_execution().install_toolchains(request)).await
}

#[command]
pub(crate) async fn list_external_workspaces<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<ExternalWorkspace>> {
    on_worker(move || app.mobile_execution().list_external_workspaces()).await
}

#[command]
pub(crate) async fn pick_external_workspace<R: Runtime>(
    app: AppHandle<R>,
    request: PickExternalWorkspaceRequest,
) -> Result<ExternalWorkspace> {
    on_worker(move || app.mobile_execution().pick_external_workspace(request)).await
}

#[command]
pub(crate) async fn remove_external_workspace<R: Runtime>(
    app: AppHandle<R>,
    request: RemoveExternalWorkspaceRequest,
) -> Result<RemoveExternalWorkspaceResponse> {
    on_worker(move || app.mobile_execution().remove_external_workspace(request)).await
}

#[command]
pub(crate) async fn run<R: Runtime>(
    app: AppHandle<R>,
    request: RunRequest,
) -> Result<RunResponse> {
    on_worker(move || app.mobile_execution().run(request)).await
}

#[command]
pub(crate) async fn cancel<R: Runtime>(
    app: AppHandle<R>,
    request: CancelRequest,
) -> Result<CancelResponse> {
    on_worker(move || app.mobile_execution().cancel(request)).await
}
