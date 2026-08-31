use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<MobileExecution<R>> {
    Ok(MobileExecution(app.clone()))
}

pub struct MobileExecution<R: Runtime>(#[allow(dead_code)] AppHandle<R>);

impl<R: Runtime> MobileExecution<R> {
    pub fn status(&self) -> crate::Result<MobileExecutionStatus> {
        Ok(MobileExecutionStatus {
            backend: MobileExecutionBackend::Unavailable,
            available: false,
            installed: false,
            detail: Some("desktop commands use the native Xgent runner".to_string()),
            capabilities: MobileExecutionCapabilities::default(),
            toolchains: Vec::new(),
            environment_version: None,
            disk_usage_bytes: None,
        })
    }

    pub fn install(&self, _request: InstallRequest) -> crate::Result<InstallResponse> {
        Err(crate::Error::Unavailable)
    }

    pub fn install_toolchains(
        &self,
        _request: InstallToolchainsRequest,
    ) -> crate::Result<InstallToolchainsResponse> {
        Err(crate::Error::Unavailable)
    }

    pub fn list_external_workspaces(&self) -> crate::Result<Vec<ExternalWorkspace>> {
        Ok(Vec::new())
    }

    pub fn pick_external_workspace(
        &self,
        _request: PickExternalWorkspaceRequest,
    ) -> crate::Result<ExternalWorkspace> {
        Err(crate::Error::Unavailable)
    }

    pub fn remove_external_workspace(
        &self,
        _request: RemoveExternalWorkspaceRequest,
    ) -> crate::Result<RemoveExternalWorkspaceResponse> {
        Err(crate::Error::Unavailable)
    }

    pub fn run(&self, _request: RunRequest) -> crate::Result<RunResponse> {
        Err(crate::Error::Unavailable)
    }

    pub fn cancel(&self, _request: CancelRequest) -> crate::Result<CancelResponse> {
        Ok(CancelResponse { cancelled: false })
    }
}
