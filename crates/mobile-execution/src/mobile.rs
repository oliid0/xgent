use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_mobile_execution);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<MobileExecution<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin(
        "com.ohi.xagent.mobileexecution",
        "MobileExecutionPlugin",
    )?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_mobile_execution)?;
    Ok(MobileExecution(handle))
}

pub struct MobileExecution<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> MobileExecution<R> {
    pub fn status(&self) -> crate::Result<MobileExecutionStatus> {
        self.0.run_mobile_plugin("status", ()).map_err(Into::into)
    }

    pub fn install(&self, request: InstallRequest) -> crate::Result<InstallResponse> {
        self.0
            .run_mobile_plugin("install", request)
            .map_err(Into::into)
    }

    pub fn install_toolchains(
        &self,
        request: InstallToolchainsRequest,
    ) -> crate::Result<InstallToolchainsResponse> {
        self.0
            .run_mobile_plugin("installToolchains", request)
            .map_err(Into::into)
    }

    pub fn list_external_workspaces(&self) -> crate::Result<Vec<ExternalWorkspace>> {
        self.0
            .run_mobile_plugin("listExternalWorkspaces", ())
            .map_err(Into::into)
    }

    pub fn pick_external_workspace(
        &self,
        request: PickExternalWorkspaceRequest,
    ) -> crate::Result<ExternalWorkspace> {
        self.0
            .run_mobile_plugin("pickExternalWorkspace", request)
            .map_err(Into::into)
    }

    pub fn remove_external_workspace(
        &self,
        request: RemoveExternalWorkspaceRequest,
    ) -> crate::Result<RemoveExternalWorkspaceResponse> {
        self.0
            .run_mobile_plugin("removeExternalWorkspace", request)
            .map_err(Into::into)
    }

    pub fn run(&self, request: RunRequest) -> crate::Result<RunResponse> {
        self.0.run_mobile_plugin("run", request).map_err(Into::into)
    }

    pub fn cancel(&self, request: CancelRequest) -> crate::Result<CancelResponse> {
        self.0
            .run_mobile_plugin("cancel", request)
            .map_err(Into::into)
    }
}
