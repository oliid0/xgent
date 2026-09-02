use tauri::{command, AppHandle, Runtime};

use crate::models::{
    CalendarRangeRequest, ComposeMessageRequest, CreateCalendarEventRequest,
    CreateReminderRequest, CurrentLocationRequest, MobileActionResult, MobileAssistantStatus,
    MobileCalendarEvent, MobileLocation, MobilePermissionRequest, MobilePermissionStates,
    MobileReminder, ReminderListRequest, VoiceInputRequest, VoiceInputResult,
};
use crate::{MobileAssistantExt, Result};

#[command]
pub(crate) async fn status<R: Runtime>(app: AppHandle<R>) -> Result<MobileAssistantStatus> {
    app.mobile_assistant().status()
}

#[command]
pub(crate) async fn start_voice_input<R: Runtime>(
    app: AppHandle<R>,
    request: VoiceInputRequest,
) -> Result<VoiceInputResult> {
    app.mobile_assistant().start_voice_input(request)
}

#[command]
pub(crate) async fn check_permissions<R: Runtime>(
    app: AppHandle<R>,
) -> Result<MobilePermissionStates> {
    app.mobile_assistant().check_permissions()
}

#[command]
pub(crate) async fn request_permissions<R: Runtime>(
    app: AppHandle<R>,
    request: MobilePermissionRequest,
) -> Result<MobilePermissionStates> {
    app.mobile_assistant().request_permissions(request)
}

#[command]
pub(crate) async fn get_current_location<R: Runtime>(
    app: AppHandle<R>,
    request: CurrentLocationRequest,
) -> Result<MobileLocation> {
    app.mobile_assistant().get_current_location(request)
}

#[command]
pub(crate) async fn list_calendar_events<R: Runtime>(
    app: AppHandle<R>,
    request: CalendarRangeRequest,
) -> Result<Vec<MobileCalendarEvent>> {
    app.mobile_assistant().list_calendar_events(request)
}

#[command]
pub(crate) async fn list_reminders<R: Runtime>(
    app: AppHandle<R>,
    request: ReminderListRequest,
) -> Result<Vec<MobileReminder>> {
    app.mobile_assistant().list_reminders(request)
}

#[command]
pub(crate) async fn create_calendar_event<R: Runtime>(
    app: AppHandle<R>,
    request: CreateCalendarEventRequest,
) -> Result<MobileActionResult> {
    app.mobile_assistant().create_calendar_event(request)
}

#[command]
pub(crate) async fn create_reminder<R: Runtime>(
    app: AppHandle<R>,
    request: CreateReminderRequest,
) -> Result<MobileActionResult> {
    app.mobile_assistant().create_reminder(request)
}

#[command]
pub(crate) async fn compose_message<R: Runtime>(
    app: AppHandle<R>,
    request: ComposeMessageRequest,
) -> Result<MobileActionResult> {
    app.mobile_assistant().compose_message(request)
}
