use std::marker::PhantomData;

use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::{
    CalendarRangeRequest, ComposeMessageRequest, CreateCalendarEventRequest,
    CreateReminderRequest, CurrentLocationRequest, MobileActionResult, MobileAssistantBackend,
    MobileAssistantStatus, MobileCalendarEvent, MobileLocation, MobilePermissionRequest,
    MobilePermissionStates, MobileReminder, ReminderListRequest, VoiceInputRequest,
    VoiceInputResult,
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

    pub fn get_current_location(
        &self,
        _request: CurrentLocationRequest,
    ) -> Result<MobileLocation> {
        Err(Error::Unavailable("location access is only available on mobile".into()))
    }

    pub fn list_calendar_events(
        &self,
        _request: CalendarRangeRequest,
    ) -> Result<Vec<MobileCalendarEvent>> {
        Err(Error::Unavailable("calendar access is only available on mobile".into()))
    }

    pub fn list_reminders(
        &self,
        _request: ReminderListRequest,
    ) -> Result<Vec<MobileReminder>> {
        Err(Error::Unavailable("reminder access is only available on mobile".into()))
    }

    pub fn create_calendar_event(
        &self,
        _request: CreateCalendarEventRequest,
    ) -> Result<MobileActionResult> {
        Err(Error::Unavailable("calendar access is only available on mobile".into()))
    }

    pub fn create_reminder(
        &self,
        _request: CreateReminderRequest,
    ) -> Result<MobileActionResult> {
        Err(Error::Unavailable("reminder access is only available on mobile".into()))
    }

    pub fn compose_message(
        &self,
        _request: ComposeMessageRequest,
    ) -> Result<MobileActionResult> {
        Err(Error::Unavailable("system composers are only available on mobile".into()))
    }
}
