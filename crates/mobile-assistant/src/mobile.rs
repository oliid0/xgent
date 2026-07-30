use serde::{de::DeserializeOwned, Serialize};
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::{
    MobileAssistantStatus, MobilePermissionRequest, MobilePermissionStates, VoiceInputRequest,
    VoiceInputResult,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_mobile_assistant);

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<MobileAssistant<R>> {
    #[cfg(target_os = "android")]
    let handle =
        api.register_android_plugin("com.ohi.xagent.mobileassistant", "MobileAssistantPlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_mobile_assistant)?;
    Ok(MobileAssistant(handle))
}

pub struct MobileAssistant<R: Runtime>(PluginHandle<R>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MobileVoiceInputRequest {
    #[serde(flatten)]
    request: VoiceInputRequest,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativePermissionRequest {
    permissions: Vec<String>,
}

impl<R: Runtime> MobileAssistant<R> {
    pub fn status(&self) -> crate::Result<MobileAssistantStatus> {
        self.0.run_mobile_plugin("status", ()).map_err(Into::into)
    }

    pub fn start_voice_input(
        &self,
        request: VoiceInputRequest,
    ) -> crate::Result<VoiceInputResult> {
        self.0
            .run_mobile_plugin(
                "startVoiceInput",
                MobileVoiceInputRequest { request },
            )
            .map_err(Into::into)
    }

    pub fn check_permissions(&self) -> crate::Result<MobilePermissionStates> {
        let status = self.status()?;
        let native: MobilePermissionStates = self
            .0
            .run_mobile_plugin("checkPermissions", ())
            .map_err(crate::Error::from)?;
        Ok(normalize_permission_states(
            native,
            &status.permission_aliases,
        ))
    }

    pub fn request_permissions(
        &self,
        request: MobilePermissionRequest,
    ) -> crate::Result<MobilePermissionStates> {
        let status = self.status()?;
        let permissions = request
            .permissions
            .into_iter()
            .map(|permission| {
                status
                    .permission_aliases
                    .get(&permission)
                    .cloned()
                    .unwrap_or(permission)
            })
            .collect();
        let native: MobilePermissionStates = self
            .0
            .run_mobile_plugin(
                "requestPermissions",
                NativePermissionRequest { permissions },
            )
            .map_err(crate::Error::from)?;
        Ok(normalize_permission_states(
            native,
            &status.permission_aliases,
        ))
    }
}

fn normalize_permission_states(
    native: MobilePermissionStates,
    aliases: &std::collections::BTreeMap<String, String>,
) -> MobilePermissionStates {
    aliases
        .iter()
        .filter_map(|(permission, alias)| {
            native
                .get(alias)
                .or_else(|| native.get(permission))
                .cloned()
                .map(|state| (permission.clone(), state))
        })
        .collect()
}
