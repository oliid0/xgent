use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::{BrowserAutomationExt, Result};

// Browser navigation and native callbacks are synchronous at this boundary.
// Waiting must not consume the shared asynchronous executor.
async fn on_worker<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| crate::Error::Message(format!("browser worker failed: {error}")))?
}

#[command]
pub(crate) async fn status<R: Runtime>(app: AppHandle<R>) -> Result<BrowserStatus> {
    on_worker(move || app.browser_automation().status()).await
}

#[command]
pub(crate) async fn open_session<R: Runtime>(
    app: AppHandle<R>,
    request: OpenSessionRequest,
) -> Result<BrowserSessionSummary> {
    on_worker(move || app.browser_automation().open_session(request)).await
}

#[command]
pub(crate) async fn list_sessions<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<BrowserSessionSummary>> {
    on_worker(move || app.browser_automation().list_sessions()).await
}

#[command]
pub(crate) async fn close_session<R: Runtime>(
    app: AppHandle<R>,
    request: SessionRequest,
) -> Result<BrowserSessionSummary> {
    on_worker(move || app.browser_automation().close_session(request)).await
}

#[command]
pub(crate) async fn set_viewport<R: Runtime>(
    app: AppHandle<R>,
    request: SetViewportRequest,
) -> Result<BrowserSessionSummary> {
    on_worker(move || app.browser_automation().set_viewport(request)).await
}

#[command]
pub(crate) async fn action<R: Runtime>(
    app: AppHandle<R>,
    request: BrowserActionRequest,
) -> Result<BrowserActionResponse> {
    let request_id = request.request_id.clone();
    on_worker(move || app.browser_automation().action(request))
        .await
        .map_err(|error| {
            if request_id.is_empty() {
                error
            } else {
                crate::Error::Message(format!("browser request {request_id} failed: {error}"))
            }
        })
}
