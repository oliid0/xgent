use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::{MobileExecutionExt, Result};

#[command]
pub(crate) async fn status<R: Runtime>(app: AppHandle<R>) -> Result<MobileExecutionStatus> {
    app.mobile_execution().status()
}

#[command]
pub(crate) async fn install<R: Runtime>(
    app: AppHandle<R>,
    request: InstallRequest,
) -> Result<InstallResponse> {
    app.mobile_execution().install(request)
}

#[command]
pub(crate) async fn install_toolchains<R: Runtime>(
    app: AppHandle<R>,
    request: InstallToolchainsRequest,
) -> Result<InstallToolchainsResponse> {
    app.mobile_execution().install_toolchains(request)
}

#[command]
pub(crate) async fn list_external_workspaces<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<ExternalWorkspace>> {
    app.mobile_execution().list_external_workspaces()
}

#[command]
pub(crate) async fn pick_external_workspace<R: Runtime>(
    app: AppHandle<R>,
    request: PickExternalWorkspaceRequest,
) -> Result<ExternalWorkspace> {
    app.mobile_execution().pick_external_workspace(request)
}

#[command]
pub(crate) async fn remove_external_workspace<R: Runtime>(
    app: AppHandle<R>,
    request: RemoveExternalWorkspaceRequest,
) -> Result<RemoveExternalWorkspaceResponse> {
    app.mobile_execution().remove_external_workspace(request)
}

#[command]
pub(crate) async fn run<R: Runtime>(
    app: AppHandle<R>,
    request: RunRequest,
) -> Result<RunResponse> {
    app.mobile_execution().run(request)
}

#[command]
pub(crate) async fn cancel<R: Runtime>(
    app: AppHandle<R>,
    request: CancelRequest,
) -> Result<CancelResponse> {
    app.mobile_execution().cancel(request)
}
