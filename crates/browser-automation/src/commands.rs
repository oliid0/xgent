use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::{BrowserAutomationExt, Result};

#[command]
pub(crate) async fn status<R: Runtime>(app: AppHandle<R>) -> Result<BrowserStatus> {
    app.browser_automation().status()
}

#[command]
pub(crate) async fn open_session<R: Runtime>(
    app: AppHandle<R>,
    request: OpenSessionRequest,
) -> Result<BrowserSessionSummary> {
    app.browser_automation().open_session(request)
}

#[command]
pub(crate) async fn list_sessions<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<BrowserSessionSummary>> {
    app.browser_automation().list_sessions()
}

#[command]
pub(crate) async fn close_session<R: Runtime>(
    app: AppHandle<R>,
    request: SessionRequest,
) -> Result<BrowserSessionSummary> {
    app.browser_automation().close_session(request)
}

#[command]
pub(crate) async fn set_viewport<R: Runtime>(
    app: AppHandle<R>,
    request: SetViewportRequest,
) -> Result<BrowserSessionSummary> {
    app.browser_automation().set_viewport(request)
}

#[command]
pub(crate) async fn action<R: Runtime>(
    app: AppHandle<R>,
    request: BrowserActionRequest,
) -> Result<BrowserActionResponse> {
    app.browser_automation().action(request)
}
