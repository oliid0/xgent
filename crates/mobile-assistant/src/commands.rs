use tauri::{command, AppHandle, Runtime};

use crate::models::{
    MobileAssistantStatus, MobilePermissionRequest, MobilePermissionStates, VoiceInputRequest,
    VoiceInputResult,
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
