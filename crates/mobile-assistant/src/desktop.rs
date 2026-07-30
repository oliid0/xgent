use std::marker::PhantomData;

use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::{
    MobileAssistantBackend, MobileAssistantStatus, MobilePermissionRequest,
    MobilePermissionStates, VoiceInputRequest, VoiceInputResult,
};
use crate::{Error, Result};

pub fn init<R: Runtime, C: serde::de::DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> Result<MobileAssistant<R>> {
    Ok(MobileAssistant(PhantomData))
}

// The desktop fallback has no runtime-owned state. A function-pointer marker
// keeps the runtime type relationship without inheriting R's Send/Sync bounds,
// which lets Tauri manage the fallback through its normal state container.
pub struct MobileAssistant<R: Runtime>(PhantomData<fn() -> R>);

impl<R: Runtime> MobileAssistant<R> {
    pub fn status(&self) -> Result<MobileAssistantStatus> {
        Ok(MobileAssistantStatus {
            backend: MobileAssistantBackend::DesktopUnavailable,
            available: false,
            voice_input_available: false,
            external_folder_mount_available: false,
            cloud_sync_available: false,
            health_available: false,
            home_available: false,
            permission_aliases: Default::default(),
            detail: Some("Native assistant capabilities are available on Android and iOS.".into()),
        })
    }

    pub fn start_voice_input(&self, _request: VoiceInputRequest) -> Result<VoiceInputResult> {
        Err(Error::Unavailable(
            "native voice input is only available on Android and iOS".into(),
        ))
    }

    pub fn check_permissions(&self) -> Result<MobilePermissionStates> {
        Ok(Default::default())
    }

    pub fn request_permissions(
        &self,
        _request: MobilePermissionRequest,
    ) -> Result<MobilePermissionStates> {
        Err(Error::Unavailable(
            "native permissions are only available on Android and iOS".into(),
        ))
    }
}
