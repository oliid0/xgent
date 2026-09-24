use tauri::{command, AppHandle, Runtime};

use crate::models::{
    CalendarRangeRequest, ComposeMessageRequest, CreateCalendarEventRequest,
    CreateReminderRequest, CurrentLocationRequest, HealthStepsRequest, HealthStepsSummary,
    MobileActionResult, MobileAssistantStatus, MobileCalendarEvent, MobileLocation,
    MobilePermissionRequest, MobilePermissionStates, MobileReminder, ReminderListRequest,
    VoiceInputRequest, VoiceInputResult,
};
use crate::{MobileAssistantExt, Result};

#[command]
pub(crate) async fn bluetooth_gatt<R: Runtime>(app: AppHandle<R>, request: crate::BluetoothGattRequest) -> Result<crate::BluetoothGattResult> {
    on_worker(move || app.mobile_assistant().bluetooth_gatt(request)).await
}

#[command]
pub(crate) async fn list_photos<R: Runtime>(app: AppHandle<R>, request: crate::PhotoListRequest) -> Result<crate::PhotoListResult> {
    on_worker(move || app.mobile_assistant().list_photos(request)).await
}

#[command]
pub(crate) async fn read_photo<R: Runtime>(app: AppHandle<R>, request: crate::PhotoReadRequest) -> Result<crate::PhotoReadResult> {
    on_worker(move || app.mobile_assistant().read_photo(request)).await
}

// Native permission, speech and location callbacks can wait for user input.
// Keep their synchronous mobile IPC off the executor that serves model traffic.
async fn on_worker<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| crate::Error::Worker(error.to_string()))?
}

#[command]
pub(crate) async fn scan_bluetooth<R: Runtime>(
    app: AppHandle<R>,
    request: crate::BluetoothScanRequest,
) -> Result<Vec<crate::BluetoothDevice>> {
    on_worker(move || app.mobile_assistant().scan_bluetooth(request)).await
}

#[command]
pub(crate) async fn status<R: Runtime>(app: AppHandle<R>) -> Result<MobileAssistantStatus> {
    on_worker(move || app.mobile_assistant().status()).await
}

#[command]
pub(crate) async fn start_voice_input<R: Runtime>(
    app: AppHandle<R>,
    request: VoiceInputRequest,
) -> Result<VoiceInputResult> {
    on_worker(move || app.mobile_assistant().start_voice_input(request)).await
}

#[command]
pub(crate) async fn check_permissions<R: Runtime>(
    app: AppHandle<R>,
) -> Result<MobilePermissionStates> {
    on_worker(move || app.mobile_assistant().check_permissions()).await
}

#[command]
pub(crate) async fn request_permissions<R: Runtime>(
    app: AppHandle<R>,
    request: MobilePermissionRequest,
) -> Result<MobilePermissionStates> {
    on_worker(move || app.mobile_assistant().request_permissions(request)).await
}

#[command]
pub(crate) async fn get_current_location<R: Runtime>(
    app: AppHandle<R>,
    request: CurrentLocationRequest,
) -> Result<MobileLocation> {
    on_worker(move || app.mobile_assistant().get_current_location(request)).await
}

#[command]
pub(crate) async fn read_health_steps<R: Runtime>(
    app: AppHandle<R>,
    request: HealthStepsRequest,
) -> Result<HealthStepsSummary> {
    on_worker(move || app.mobile_assistant().read_health_steps(request)).await
}

#[command]
pub(crate) async fn request_health_metric_permission<R: Runtime>(
    app: AppHandle<R>,
    request: crate::HealthMetricRequest,
) -> Result<MobilePermissionStates> {
    on_worker(move || app.mobile_assistant().request_health_metric_permission(request)).await
}

#[command]
pub(crate) async fn read_health_samples<R: Runtime>(
    app: AppHandle<R>,
    request: crate::HealthSamplesRequest,
) -> Result<crate::HealthSamplesResult> {
    on_worker(move || app.mobile_assistant().read_health_samples(request)).await
}

#[command]
pub(crate) async fn list_calendar_events<R: Runtime>(
    app: AppHandle<R>,
    request: CalendarRangeRequest,
) -> Result<Vec<MobileCalendarEvent>> {
    on_worker(move || app.mobile_assistant().list_calendar_events(request)).await
}

#[command]
pub(crate) async fn list_reminders<R: Runtime>(
    app: AppHandle<R>,
    request: ReminderListRequest,
) -> Result<Vec<MobileReminder>> {
    on_worker(move || app.mobile_assistant().list_reminders(request)).await
}

#[command]
pub(crate) async fn create_calendar_event<R: Runtime>(
    app: AppHandle<R>,
    request: CreateCalendarEventRequest,
) -> Result<MobileActionResult> {
    on_worker(move || app.mobile_assistant().create_calendar_event(request)).await
}

#[command]
pub(crate) async fn create_reminder<R: Runtime>(
    app: AppHandle<R>,
    request: CreateReminderRequest,
) -> Result<MobileActionResult> {
    on_worker(move || app.mobile_assistant().create_reminder(request)).await
}

#[command]
pub(crate) async fn compose_message<R: Runtime>(
    app: AppHandle<R>,
    request: ComposeMessageRequest,
) -> Result<MobileActionResult> {
    on_worker(move || app.mobile_assistant().compose_message(request)).await
}

#[command]
pub(crate) async fn read_clipboard<R: Runtime>(app: AppHandle<R>) -> Result<crate::ClipboardText> {
    on_worker(move || app.mobile_assistant().read_clipboard()).await
}

#[command]
pub(crate) async fn write_clipboard<R: Runtime>(app: AppHandle<R>, request: crate::ClipboardText) -> Result<crate::ClipboardText> {
    on_worker(move || app.mobile_assistant().write_clipboard(request)).await
}

#[command]
pub(crate) async fn open_settings<R: Runtime>(app: AppHandle<R>) -> Result<MobileActionResult> {
    on_worker(move || app.mobile_assistant().open_settings()).await
}
