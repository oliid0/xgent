use serde::{de::DeserializeOwned, Serialize};
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;
use crate::BROWSER_RUNTIME_SCRIPT;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_browser_automation);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<BrowserAutomation<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin(
        "com.ohi.xagent.browserautomation",
        "BrowserAutomationPlugin",
    )?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_browser_automation)?;
    Ok(BrowserAutomation(handle))
}

pub struct BrowserAutomation<R: Runtime>(PluginHandle<R>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MobileOpenSessionRequest {
    #[serde(flatten)]
    request: OpenSessionRequest,
    runtime_script: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MobileActionRequest {
    #[serde(flatten)]
    request: BrowserActionRequest,
    runtime_script: &'static str,
}

impl<R: Runtime> BrowserAutomation<R> {
    pub fn status(&self) -> crate::Result<BrowserStatus> {
        self.0.run_mobile_plugin("status", ()).map_err(Into::into)
    }

    pub fn open_session(
        &self,
        request: OpenSessionRequest,
    ) -> crate::Result<BrowserSessionSummary> {
        self.0
            .run_mobile_plugin(
                "openSession",
                MobileOpenSessionRequest {
                    request,
                    runtime_script: BROWSER_RUNTIME_SCRIPT,
                },
            )
            .map_err(Into::into)
    }

    pub fn list_sessions(&self) -> crate::Result<Vec<BrowserSessionSummary>> {
        self.0
            .run_mobile_plugin("listSessions", ())
            .map_err(Into::into)
    }

    pub fn close_session(
        &self,
        request: SessionRequest,
    ) -> crate::Result<BrowserSessionSummary> {
        self.0
            .run_mobile_plugin("closeSession", request)
            .map_err(Into::into)
    }

    pub fn set_viewport(
        &self,
        request: SetViewportRequest,
    ) -> crate::Result<BrowserSessionSummary> {
        self.0
            .run_mobile_plugin("setViewport", request)
            .map_err(Into::into)
    }

    pub fn action(
        &self,
        request: BrowserActionRequest,
    ) -> crate::Result<BrowserActionResponse> {
        self.0
            .run_mobile_plugin(
                "action",
                MobileActionRequest {
                    request,
                    runtime_script: BROWSER_RUNTIME_SCRIPT,
                },
            )
            .map_err(Into::into)
    }
}
