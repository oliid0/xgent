use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc, Condvar, Mutex,
    },
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use tauri::{
    plugin::PluginApi,
    webview::{PageLoadEvent, WebviewBuilder},
    AppHandle, LogicalPosition, LogicalSize, Manager, Runtime, WebviewUrl,
};
use url::Url;

use crate::models::*;
use crate::{Error, BROWSER_RUNTIME_SCRIPT};

const WEBVIEW_LABEL_PREFIX: &str = "xgent-browser-";
static LEGACY_REQUEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
struct SessionRecord {
    session_id: String,
    label: String,
    visible: bool,
}

#[derive(Clone, Debug, Default)]
struct PageLoadState {
    sequence: u64,
    completed_sequence: u64,
    loading: bool,
    error: Option<String>,
    url: String,
    native_navigation_id: Option<u64>,
}

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<BrowserAutomation<R>> {
    Ok(BrowserAutomation {
        app: app.clone(),
        sessions: Mutex::new(HashMap::new()),
        page_load_states: Arc::new((Mutex::new(HashMap::new()), Condvar::new())),
    })
}

pub struct BrowserAutomation<R: Runtime> {
    app: AppHandle<R>,
    sessions: Mutex<HashMap<String, SessionRecord>>,
    page_load_states: Arc<(Mutex<HashMap<String, PageLoadState>>, Condvar)>,
}

impl<R: Runtime> BrowserAutomation<R> {
    pub fn status(&self) -> crate::Result<BrowserStatus> {
        #[cfg(target_os = "windows")]
        let detail = "WebView2 sessions with CDP request/response DOM automation and trusted input";
        #[cfg(not(target_os = "windows"))]
        let detail = "Tauri child WebView sessions with bounded navigation and DOM automation";
        Ok(BrowserStatus {
            backend: BrowserBackend::DesktopWebview,
            available: true,
            detail: Some(detail.to_string()),
            capabilities: BrowserCapabilities {
                visible_sessions: true,
                dom_automation: true,
                javascript: true,
                screenshots: true,
                downloads: false,
                multiple_sessions: true,
            },
        })
    }

    pub fn open_session(
        &self,
        request: OpenSessionRequest,
    ) -> crate::Result<BrowserSessionSummary> {
        validate_session_id(&request.session_id)?;
        let url = parse_browser_url(&request.url)?;

        if let Some(record) = self.session_record(&request.session_id)? {
            let webview = self
                .app
                .get_webview(&record.label)
                .ok_or_else(|| Error::Message("browser session WebView is missing".to_string()))?;
            self.mark_page_loading(&request.session_id, true)?;
            if let Err(error) = webview.navigate(url) {
                self.mark_page_loading(&request.session_id, false)?;
                return Err(Error::Message(format!(
                    "failed to navigate browser: {error}"
                )));
            }
            self.apply_viewport(&record, &request.viewport)?;
            return self.session_summary(&record);
        }

        let label = format!("{WEBVIEW_LABEL_PREFIX}{}", request.session_id);
        self.mark_page_loading(&request.session_id, true)?;
        let window = self
            .app
            .get_window("main")
            .ok_or_else(|| Error::Message("main application window is unavailable".to_string()))?;
        let builder = WebviewBuilder::new(label.clone(), WebviewUrl::External(url))
            .initialization_script(BROWSER_RUNTIME_SCRIPT)
            .on_navigation(|url| matches!(url.scheme(), "http" | "https"));
        #[cfg(not(target_os = "windows"))]
        let builder = {
            let page_load_states = Arc::clone(&self.page_load_states);
            let page_load_session_id = request.session_id.clone();
            builder
            .on_page_load(move |_webview, payload| {
                let (states, wake) = &*page_load_states;
                if let Ok(mut states) = states.lock() {
                    let state = states.entry(page_load_session_id.clone()).or_default();
                    state.url = payload.url().to_string();
                    match payload.event() {
                        PageLoadEvent::Started => {
                            state.sequence = state.sequence.saturating_add(1);
                            state.loading = true;
                            state.error = None;
                        }
                        PageLoadEvent::Finished => {
                            if state.url == payload.url().as_str() {
                                state.loading = false;
                                state.completed_sequence = state.sequence;
                            }
                        }
                    }
                    wake.notify_all();
                }
            })
        };
        let viewport = normalized_viewport(&request.viewport);
        let webview = window
            .add_child(
                builder,
                LogicalPosition::new(viewport.x, viewport.y),
                LogicalSize::new(viewport.width, viewport.height),
            )
            .map_err(|error| Error::Message(format!("failed to create browser WebView: {error}")))?;
        install_desktop_process_recovery(
            &webview,
            Arc::clone(&self.page_load_states),
            request.session_id.clone(),
        )?;
        install_windows_navigation_lifecycle(
            &webview,
            Arc::clone(&self.page_load_states),
            request.session_id.clone(),
        )?;
        #[cfg(target_os = "windows")]
        webview.reload().map_err(|error| {
            Error::Message(format!(
                "failed to restart initial navigation after installing WebView2 lifecycle: {error}"
            ))
        })?;

        if viewport.visible {
            webview
                .show()
                .map_err(|error| Error::Message(format!("failed to show browser: {error}")))?;
        } else {
            webview
                .hide()
                .map_err(|error| Error::Message(format!("failed to hide browser: {error}")))?;
        }

        let record = SessionRecord {
            session_id: request.session_id.clone(),
            label,
            visible: viewport.visible,
        };
        self.sessions
            .lock()
            .map_err(lock_error)?
            .insert(request.session_id, record.clone());
        self.session_summary(&record)
    }

    pub fn list_sessions(&self) -> crate::Result<Vec<BrowserSessionSummary>> {
        let records = self
            .sessions
            .lock()
            .map_err(lock_error)?
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let mut sessions = records
            .iter()
            .filter_map(|record| self.session_summary(record).ok())
            .collect::<Vec<_>>();
        sessions.sort_by(|left, right| left.session_id.cmp(&right.session_id));
        Ok(sessions)
    }

    pub fn close_session(
        &self,
        request: SessionRequest,
    ) -> crate::Result<BrowserSessionSummary> {
        let record = self
            .sessions
            .lock()
            .map_err(lock_error)?
            .remove(&request.session_id)
            .ok_or_else(|| Error::Message("browser session was not found".to_string()))?;
        let summary = self.session_summary(&record)?;
        self.remove_page_load_state(&request.session_id);
        if let Some(webview) = self.app.get_webview(&record.label) {
            webview
                .close()
                .map_err(|error| Error::Message(format!("failed to close browser: {error}")))?;
        }
        Ok(summary)
    }

    pub fn set_viewport(
        &self,
        request: SetViewportRequest,
    ) -> crate::Result<BrowserSessionSummary> {
        let mut sessions = self.sessions.lock().map_err(lock_error)?;
        let record = sessions
            .get_mut(&request.session_id)
            .ok_or_else(|| Error::Message("browser session was not found".to_string()))?;
        self.apply_viewport(record, &request.viewport)?;
        record.visible = request.viewport.visible;
        self.session_summary(record)
    }

    pub fn action(
        &self,
        request: BrowserActionRequest,
    ) -> crate::Result<BrowserActionResponse> {
        let record = self
            .session_record(&request.session_id)?
            .ok_or_else(|| Error::Message("browser session was not found".to_string()))?;
        let webview = self
            .app
            .get_webview(&record.label)
            .ok_or_else(|| Error::Message("browser session WebView is missing".to_string()))?;
        let action = request.action.trim().to_lowercase();
        let request_id = normalized_request_id(&request.request_id)?;
        let navigation_timeout = Duration::from_millis(request.timeout_ms.clamp(1_000, 30_000));

        let mut screenshot_base64 = None;
        let mut lifecycle = BrowserCommandLifecycle::default();
        let data = match action.as_str() {
            "navigate" => {
                let target = request
                    .input
                    .get("url")
                    .and_then(Value::as_str)
                    .ok_or_else(|| Error::Message("navigate requires input.url".to_string()))?;
                let target_url = parse_browser_url(target)?;
                let baseline = self.navigation_sequence(&request.session_id)?;
                self.mark_page_loading(&request.session_id, true)?;
                if let Err(error) = webview.navigate(target_url) {
                    self.mark_page_loading(&request.session_id, false)?;
                    return Err(Error::Message(format!(
                        "failed to navigate browser: {error}"
                    )));
                }
                self.wait_for_page_load_or_recover(
                    &webview,
                    &request.session_id,
                    baseline,
                    navigation_timeout,
                )?;
                lifecycle.navigation_started = true;
                lifecycle.navigation_finished = true;
                json!({ "navigated": true, "completed": true, "url": target })
            }
            "reload" => {
                let baseline = self.navigation_sequence(&request.session_id)?;
                self.mark_page_loading(&request.session_id, true)?;
                if let Err(error) = webview.reload() {
                    self.mark_page_loading(&request.session_id, false)?;
                    return Err(Error::Message(format!("failed to reload browser: {error}")));
                }
                self.wait_for_page_load_or_recover(
                    &webview,
                    &request.session_id,
                    baseline,
                    navigation_timeout,
                )?;
                lifecycle.navigation_started = true;
                lifecycle.navigation_finished = true;
                json!({ "reloaded": true, "completed": true })
            }
            "go_back" => {
                if !can_navigate_history(&webview, false)? {
                    json!({ "requested": "back", "completed": true, "navigated": false })
                } else {
                    let baseline = self.navigation_sequence(&request.session_id)?;
                    self.mark_page_loading(&request.session_id, true)?;
                    if let Err(error) = webview.eval("history.back()") {
                        self.mark_page_loading(&request.session_id, false)?;
                        return Err(Error::Message(format!("failed to go back: {error}")));
                    }
                    self.wait_for_page_load_or_recover(
                        &webview,
                        &request.session_id,
                        baseline,
                        navigation_timeout,
                    )?;
                    lifecycle.navigation_started = true;
                    lifecycle.navigation_finished = true;
                    json!({ "requested": "back", "completed": true, "navigated": true })
                }
            }
            "go_forward" => {
                if !can_navigate_history(&webview, true)? {
                    json!({ "requested": "forward", "completed": true, "navigated": false })
                } else {
                    let baseline = self.navigation_sequence(&request.session_id)?;
                    self.mark_page_loading(&request.session_id, true)?;
                    if let Err(error) = webview.eval("history.forward()") {
                        self.mark_page_loading(&request.session_id, false)?;
                        return Err(Error::Message(format!("failed to go forward: {error}")));
                    }
                    self.wait_for_page_load_or_recover(
                        &webview,
                        &request.session_id,
                        baseline,
                        navigation_timeout,
                    )?;
                    lifecycle.navigation_started = true;
                    lifecycle.navigation_finished = true;
                    json!({ "requested": "forward", "completed": true, "navigated": true })
                }
            }
            "recover" => {
                let baseline = self.navigation_sequence(&request.session_id)?;
                let _ = webview.eval("window.stop()");
                self.mark_page_loading(&request.session_id, true)?;
                webview.reload().map_err(|error| {
                    Error::Message(format!("failed to recover browser session: {error}"))
                })?;
                self.wait_for_page_load_or_recover(
                    &webview,
                    &request.session_id,
                    baseline,
                    navigation_timeout,
                )?;
                lifecycle.navigation_started = true;
                lifecycle.navigation_finished = true;
                lifecycle.recovered = true;
                json!({ "recovered": true, "completed": true })
            }
            "screenshot" => {
                let bytes = capture_desktop_webview(
                    &webview,
                    Duration::from_millis(request.timeout_ms.clamp(1_000, 30_000)),
                )?;
                screenshot_base64 = Some(BASE64_STANDARD.encode(&bytes));
                json!({
                    "mimeType": "image/png",
                    "encodedBytes": bytes.len(),
                })
            }
            _ => {
                let baseline = self.navigation_sequence(&request.session_id)?;
                let data = evaluate_dom_action(
                    &webview,
                    &action,
                    &request.input,
                    request.timeout_ms.clamp(1_000, 90_000),
                )?;
                if matches!(action.as_str(), "click" | "type" | "press_key") {
                    if self.wait_for_navigation_start(
                        &request.session_id,
                        baseline,
                        Duration::from_millis(300),
                    )? {
                        lifecycle.navigation_started = true;
                        self.wait_for_page_load_or_recover(
                            &webview,
                            &request.session_id,
                            baseline,
                            navigation_timeout,
                        )?;
                        lifecycle.navigation_finished = true;
                    }
                }
                data
            }
        };
        let url = webview
            .url()
            .map(|url| url.to_string())
            .unwrap_or_default();
        let title = data
            .get("title")
            .and_then(Value::as_str)
            .map(str::to_string);
        Ok(BrowserActionResponse {
            request_id,
            session_id: request.session_id,
            action,
            url,
            title,
            data,
            screenshot_base64,
            lifecycle: BrowserCommandLifecycle {
                command_completed: true,
                ..lifecycle
            },
        })
    }

    fn session_record(&self, session_id: &str) -> crate::Result<Option<SessionRecord>> {
        Ok(self
            .sessions
            .lock()
            .map_err(lock_error)?
            .get(session_id)
            .cloned())
    }

    fn mark_page_loading(&self, session_id: &str, loading: bool) -> crate::Result<()> {
        let (states, wake) = &*self.page_load_states;
        states.lock().map_err(lock_error)?.entry(session_id.to_string()).or_default().loading =
            loading;
        wake.notify_all();
        Ok(())
    }

    fn navigation_sequence(&self, session_id: &str) -> crate::Result<u64> {
        Ok(self
            .page_load_states
            .0
            .lock()
            .map_err(lock_error)?
            .get(session_id)
            .map(|state| state.sequence)
            .unwrap_or(0))
    }

    fn remove_page_load_state(&self, session_id: &str) {
        let (states, wake) = &*self.page_load_states;
        if let Ok(mut states) = states.lock() {
            states.remove(session_id);
            wake.notify_all();
        }
    }

    fn wait_for_navigation_start(
        &self,
        session_id: &str,
        baseline: u64,
        timeout: Duration,
    ) -> crate::Result<bool> {
        let (states, wake) = &*self.page_load_states;
        let states = states.lock().map_err(lock_error)?;
        let (states, wait) = wake
            .wait_timeout_while(states, timeout, |states| {
                states
                    .get(session_id)
                    .map(|state| state.sequence <= baseline)
                    .unwrap_or(true)
            })
            .map_err(lock_error)?;
        Ok(!wait.timed_out()
            && states
                .get(session_id)
                .map(|state| state.sequence > baseline)
                .unwrap_or(false))
    }

    fn wait_for_page_load_or_recover(
        &self,
        webview: &tauri::Webview<R>,
        session_id: &str,
        baseline: u64,
        timeout: Duration,
    ) -> crate::Result<()> {
        let (states, wake) = &*self.page_load_states;
        let states = states.lock().map_err(lock_error)?;
        let (states, wait) = wake
            .wait_timeout_while(states, timeout, |states| {
                states
                    .get(session_id)
                    .map(|state| {
                        state.sequence <= baseline
                            || state.loading
                            || state.completed_sequence < state.sequence
                    })
                    .unwrap_or(true)
            })
            .map_err(lock_error)?;
        if let Some(error) = states.get(session_id).and_then(|state| state.error.clone()) {
            return Err(Error::Message(error));
        }
        if !wait.timed_out()
            && states
                .get(session_id)
                .map(|state| {
                    state.sequence > baseline
                        && !state.loading
                        && state.completed_sequence == state.sequence
                })
                .unwrap_or(false)
        {
            return Ok(());
        }
        drop(states);
        let _ = webview.eval("window.stop()");
        self.mark_page_loading(session_id, false)?;
        Err(Error::Message(format!(
            "browser navigation timed out after {} ms; the pending load was stopped and the session is ready for another command",
            timeout.as_millis()
        )))
    }

    fn session_summary(
        &self,
        record: &SessionRecord,
    ) -> crate::Result<BrowserSessionSummary> {
        let webview = self
            .app
            .get_webview(&record.label)
            .ok_or_else(|| Error::Message("browser session WebView is missing".to_string()))?;
        Ok(BrowserSessionSummary {
            session_id: record.session_id.clone(),
            url: webview
                .url()
                .map(|url| url.to_string())
                .unwrap_or_default(),
            title: None,
            visible: record.visible,
            loading: {
                let (states, _) = &*self.page_load_states;
                states
                    .lock()
                    .map_err(lock_error)?
                    .get(&record.session_id)
                    .map(|state| state.loading)
                    .unwrap_or(false)
            },
        })
    }

    fn apply_viewport(
        &self,
        record: &SessionRecord,
        viewport: &BrowserViewport,
    ) -> crate::Result<()> {
        let webview = self
            .app
            .get_webview(&record.label)
            .ok_or_else(|| Error::Message("browser session WebView is missing".to_string()))?;
        let viewport = normalized_viewport(viewport);
        webview
            .set_position(LogicalPosition::new(viewport.x, viewport.y))
            .and_then(|_| webview.set_size(LogicalSize::new(viewport.width, viewport.height)))
            .map_err(|error| Error::Message(format!("failed to resize browser: {error}")))?;
        if viewport.visible {
            webview
                .show()
                .map_err(|error| Error::Message(format!("failed to show browser: {error}")))
        } else {
            webview
                .hide()
                .map_err(|error| Error::Message(format!("failed to hide browser: {error}")))
        }
    }
}

#[cfg(target_os = "windows")]
fn capture_desktop_webview<R: Runtime>(
    webview: &tauri::Webview<R>,
    timeout: Duration,
) -> crate::Result<Vec<u8>> {
    let response = call_windows_cdp(
        webview,
        "Page.captureScreenshot",
        &json!({ "format": "png", "fromSurface": true }),
        timeout,
    )?;
    let encoded = response
        .get("data")
        .and_then(Value::as_str)
        .ok_or_else(|| Error::Message("CDP screenshot response did not include data".to_string()))?;
    BASE64_STANDARD
        .decode(encoded)
        .map_err(|error| Error::Message(format!("failed to decode CDP screenshot: {error}")))
}

#[cfg(target_os = "macos")]
fn capture_desktop_webview<R: Runtime>(
    webview: &tauri::Webview<R>,
    timeout: Duration,
) -> crate::Result<Vec<u8>> {
    use block2::RcBlock;
    use objc2_app_kit::NSImage;
    use objc2_foundation::NSError;
    use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};

    let (sender, receiver) = mpsc::sync_channel(1);
    let pending_sender = Arc::new(Mutex::new(Some(sender)));
    webview
        .with_webview({
            let pending_sender = Arc::clone(&pending_sender);
            move |platform_webview| unsafe {
                let wk_webview: &WKWebView = &*platform_webview.inner().cast();
                let configuration = WKSnapshotConfiguration::new();
                let callback_sender = Arc::clone(&pending_sender);
                let handler = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
                    let result = if !error.is_null() {
                        Err((&*error).localizedDescription().to_string())
                    } else if !image.is_null() {
                        ns_image_to_png(&*image)
                    } else {
                        Err("WKWebView returned no screenshot image".to_string())
                    };
                    if let Ok(mut slot) = callback_sender.lock() {
                        if let Some(sender) = slot.take() {
                            let _ = sender.send(result);
                        }
                    }
                });
                wk_webview.takeSnapshotWithConfiguration_completionHandler(
                    Some(&configuration),
                    &handler,
                );
            }
        })
        .map_err(|error| Error::Message(format!("failed to access browser WebView: {error}")))?;

    receiver
        .recv_timeout(timeout)
        .map_err(|_| {
            let _ = webview.reload();
            Error::Message(
                "browser screenshot timed out; the WebView was reloaded for recovery".to_string(),
            )
        })?
        .map_err(|error| Error::Message(format!("browser screenshot failed: {error}")))
}

#[cfg(target_os = "macos")]
unsafe fn ns_image_to_png(image: &objc2_app_kit::NSImage) -> Result<Vec<u8>, String> {
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep};
    use objc2_foundation::NSDictionary;

    let tiff = image
        .TIFFRepresentation()
        .ok_or_else(|| "failed to create TIFF screenshot representation".to_string())?;
    let bitmap = NSBitmapImageRep::imageRepWithData(&tiff)
        .ok_or_else(|| "failed to create bitmap screenshot representation".to_string())?;
    let png = bitmap
        .representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
        .ok_or_else(|| "failed to encode browser screenshot as PNG".to_string())?;
    Ok(std::slice::from_raw_parts(png.bytes().as_ptr(), png.len()).to_vec())
}

#[cfg(target_os = "linux")]
fn capture_desktop_webview<R: Runtime>(
    webview: &tauri::Webview<R>,
    timeout: Duration,
) -> crate::Result<Vec<u8>> {
    use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};

    let (sender, receiver) = mpsc::sync_channel(1);
    webview
        .with_webview(move |platform_webview| {
            platform_webview.inner().snapshot(
                SnapshotRegion::Visible,
                SnapshotOptions::NONE,
                None::<&webkit2gtk::gio::Cancellable>,
                move |result| {
                    let encoded = result
                        .map_err(|error| format!("WebKitGTK snapshot failed: {error}"))
                        .and_then(|surface| {
                            let mut bytes = Vec::new();
                            surface
                                .write_to_png(&mut bytes)
                                .map_err(|error| format!("failed to encode Linux PNG: {error}"))?;
                            Ok(bytes)
                        });
                    let _ = sender.send(encoded);
                },
            );
        })
        .map_err(|error| Error::Message(format!("failed to access browser WebView: {error}")))?;
    receiver
        .recv_timeout(timeout)
        .map_err(|_| {
            let _ = webview.reload();
            Error::Message(
                "browser screenshot timed out; the WebView was reloaded for recovery".to_string(),
            )
        })?
        .map_err(Error::Message)
}

fn normalized_viewport(viewport: &BrowserViewport) -> BrowserViewport {
    BrowserViewport {
        x: viewport.x.max(0.0),
        y: viewport.y.max(0.0),
        width: viewport.width.max(1.0),
        height: viewport.height.max(1.0),
        visible: viewport.visible,
        scale_factor: viewport.scale_factor.max(0.1),
    }
}

fn validate_session_id(session_id: &str) -> crate::Result<()> {
    let valid = !session_id.is_empty()
        && session_id.len() <= 64
        && session_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'));
    if valid {
        Ok(())
    } else {
        Err(Error::Message(
            "sessionId must contain 1-64 ASCII letters, digits, '-' or '_'".to_string(),
        ))
    }
}

fn normalized_request_id(request_id: &str) -> crate::Result<String> {
    let request_id = request_id.trim();
    if request_id.is_empty() {
        return Ok(format!(
            "browser-native-{}",
            LEGACY_REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
    }
    if request_id.len() > 128
        || !request_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(Error::Message(
            "browser request_id must use 1-128 ASCII letters, digits, '-', '_' or '.'".to_string(),
        ));
    }
    Ok(request_id.to_string())
}

fn parse_browser_url(raw: &str) -> crate::Result<Url> {
    let trimmed = raw.trim();
    let normalized = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let url = Url::parse(&normalized)
        .map_err(|error| Error::Message(format!("invalid browser URL: {error}")))?;
    if matches!(url.scheme(), "http" | "https") {
        Ok(url)
    } else {
        Err(Error::Message(
            "browser navigation only supports http and https URLs".to_string(),
        ))
    }
}

#[cfg(target_os = "windows")]
fn call_windows_cdp<R: Runtime>(
    webview: &tauri::Webview<R>,
    method: &str,
    params: &Value,
    timeout: Duration,
) -> crate::Result<Value> {
    use webview2_com::{CallDevToolsProtocolMethodCompletedHandler, CoTaskMemPWSTR};

    let method_name = method.to_string();
    let params_json = params.to_string();
    let (sender, receiver) = mpsc::sync_channel(1);
    let pending_sender = Arc::new(Mutex::new(Some(sender)));
    let closure_sender = Arc::clone(&pending_sender);
    webview
        .with_webview(move |platform_webview| unsafe {
            let result = (|| -> Result<(), String> {
                let core_webview = platform_webview
                    .controller()
                    .CoreWebView2()
                    .map_err(|error| format!("failed to access CoreWebView2: {error}"))?;
                let method = CoTaskMemPWSTR::from(method_name.as_str());
                let params = CoTaskMemPWSTR::from(params_json.as_str());
                let callback_sender = Arc::clone(&closure_sender);
                let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                    move |status, payload| {
                        let result = status
                            .map(|_| payload)
                            .map_err(|error| format!("CDP command failed: {error}"));
                        if let Ok(mut slot) = callback_sender.lock() {
                            if let Some(sender) = slot.take() {
                                let _ = sender.send(result);
                            }
                        }
                        Ok(())
                    },
                ));
                core_webview
                    .CallDevToolsProtocolMethod(
                        *method.as_ref().as_pcwstr(),
                        *params.as_ref().as_pcwstr(),
                        &handler,
                    )
                    .map_err(|error| format!("failed to dispatch CDP command: {error}"))?;
                Ok(())
            })();
            if let Err(error) = result {
                if let Ok(mut slot) = closure_sender.lock() {
                    if let Some(sender) = slot.take() {
                        let _ = sender.send(Err(error));
                    }
                }
            }
        })
        .map_err(|error| Error::Message(format!("failed to access browser WebView: {error}")))?;

    let raw = receiver
        .recv_timeout(timeout)
        .map_err(|_| {
            let _ = webview.reload();
            Error::Message(format!(
                "CDP {method} timed out; WebView2 was reloaded so the session can recover"
            ))
        })?
        .map_err(Error::Message)?;
    let response = serde_json::from_str::<Value>(&raw)
        .map_err(|error| Error::Message(format!("invalid CDP {method} response: {error}")))?;
    if let Some(error) = response.get("error") {
        return Err(Error::Message(format!("CDP {method} failed: {error}")));
    }
    Ok(response)
}

#[cfg(target_os = "windows")]
fn evaluate_windows_runtime_action<R: Runtime>(
    webview: &tauri::Webview<R>,
    action: &str,
    input: &Value,
    timeout: Duration,
) -> crate::Result<Value> {
    let action_json = serde_json::to_string(action)
        .map_err(|error| Error::Message(format!("failed to encode browser action: {error}")))?;
    let input_json = serde_json::to_string(input)
        .map_err(|error| Error::Message(format!("failed to encode browser input: {error}")))?;
    let expression = format!(
        "(() => {{ if (!window.__xgentBrowserRuntime) {{ {BROWSER_RUNTIME_SCRIPT} }} return window.__xgentBrowserRuntime.execute({action_json}, {input_json}); }})()"
    );
    let response = call_windows_cdp(
        webview,
        "Runtime.evaluate",
        &json!({
            "expression": expression,
            "returnByValue": true,
            "awaitPromise": true,
            "userGesture": true,
        }),
        timeout,
    )?;
    if let Some(details) = response.get("exceptionDetails") {
        let detail = details
            .pointer("/exception/description")
            .or_else(|| details.get("text"))
            .and_then(Value::as_str)
            .unwrap_or("unknown page exception");
        return Err(Error::Message(format!("browser evaluation failed: {detail}")));
    }
    let raw = response
        .pointer("/result/value")
        .and_then(Value::as_str)
        .ok_or_else(|| Error::Message("CDP evaluation returned no serialized value".to_string()))?;
    decode_runtime_response(raw)
}

#[cfg(target_os = "windows")]
fn windows_target_point(target: &Value) -> crate::Result<(f64, f64)> {
    let rect = target
        .get("rect")
        .ok_or_else(|| Error::Message("browser target returned no geometry".to_string()))?;
    let x = rect.get("x").and_then(Value::as_f64).unwrap_or(0.0)
        + rect.get("width").and_then(Value::as_f64).unwrap_or(0.0) / 2.0;
    let y = rect.get("y").and_then(Value::as_f64).unwrap_or(0.0)
        + rect.get("height").and_then(Value::as_f64).unwrap_or(0.0) / 2.0;
    if x.is_finite() && y.is_finite() {
        Ok((x, y))
    } else {
        Err(Error::Message("browser target geometry is invalid".to_string()))
    }
}

#[cfg(target_os = "windows")]
fn dispatch_windows_mouse<R: Runtime>(
    webview: &tauri::Webview<R>,
    event_type: &str,
    x: f64,
    y: f64,
    extra: Value,
    timeout: Duration,
) -> crate::Result<()> {
    let timeout = timeout.min(Duration::from_secs(5));
    let mut params = json!({ "type": event_type, "x": x, "y": y });
    if let (Some(target), Some(source)) = (params.as_object_mut(), extra.as_object()) {
        target.extend(source.clone());
    }
    call_windows_cdp(webview, "Input.dispatchMouseEvent", &params, timeout).map(|_| ())
}

#[cfg(target_os = "windows")]
fn windows_key_identity(raw: &str) -> Option<(&'static str, &'static str, u64, Option<&'static str>)> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "enter" | "return" => Some(("Enter", "Enter", 13, Some("\r"))),
        "tab" => Some(("Tab", "Tab", 9, Some("\t"))),
        "space" | " " => Some((" ", "Space", 32, Some(" "))),
        "backspace" => Some(("Backspace", "Backspace", 8, None)),
        "delete" => Some(("Delete", "Delete", 46, None)),
        "escape" | "esc" => Some(("Escape", "Escape", 27, None)),
        "home" => Some(("Home", "Home", 36, None)),
        "end" => Some(("End", "End", 35, None)),
        "pageup" => Some(("PageUp", "PageUp", 33, None)),
        "pagedown" => Some(("PageDown", "PageDown", 34, None)),
        "arrowleft" | "left" => Some(("ArrowLeft", "ArrowLeft", 37, None)),
        "arrowup" | "up" => Some(("ArrowUp", "ArrowUp", 38, None)),
        "arrowright" | "right" => Some(("ArrowRight", "ArrowRight", 39, None)),
        "arrowdown" | "down" => Some(("ArrowDown", "ArrowDown", 40, None)),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn dispatch_windows_key<R: Runtime>(
    webview: &tauri::Webview<R>,
    key: &str,
    timeout: Duration,
) -> crate::Result<()> {
    let timeout = timeout.min(Duration::from_secs(5));
    if key.chars().count() == 1 && key != " " {
        return call_windows_cdp(
            webview,
            "Input.insertText",
            &json!({ "text": key }),
            timeout,
        )
        .map(|_| ());
    }
    let (key_name, code, virtual_key, text) = windows_key_identity(key)
        .ok_or_else(|| Error::Message(format!("unsupported browser key: {key}")))?;
    let mut down = json!({
        "type": if text.is_some() { "keyDown" } else { "rawKeyDown" },
        "key": key_name,
        "code": code,
        "windowsVirtualKeyCode": virtual_key,
        "nativeVirtualKeyCode": virtual_key,
    });
    if let Some(text) = text {
        down["text"] = json!(text);
    }
    call_windows_cdp(webview, "Input.dispatchKeyEvent", &down, timeout)?;
    call_windows_cdp(
        webview,
        "Input.dispatchKeyEvent",
        &json!({
            "type": "keyUp",
            "key": key_name,
            "code": code,
            "windowsVirtualKeyCode": virtual_key,
            "nativeVirtualKeyCode": virtual_key,
        }),
        timeout,
    )?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn evaluate_dom_action<R: Runtime>(
    webview: &tauri::Webview<R>,
    action: &str,
    input: &Value,
    timeout_ms: u64,
) -> crate::Result<Value> {
    let timeout = Duration::from_millis(timeout_ms);
    match action {
        "click" | "hover" => {
            let target = evaluate_windows_runtime_action(
                webview,
                "__native_target",
                input,
                timeout,
            )?;
            let (center_x, center_y) = windows_target_point(&target)?;
            let x = input.get("x").and_then(Value::as_f64).unwrap_or(center_x);
            let y = input.get("y").and_then(Value::as_f64).unwrap_or(center_y);
            dispatch_windows_mouse(webview, "mouseMoved", x, y, json!({}), timeout)?;
            if action == "click" {
                dispatch_windows_mouse(
                    webview,
                    "mousePressed",
                    x,
                    y,
                    json!({ "button": "left", "buttons": 1, "clickCount": 1 }),
                    timeout,
                )?;
                dispatch_windows_mouse(
                    webview,
                    "mouseReleased",
                    x,
                    y,
                    json!({ "button": "left", "buttons": 0, "clickCount": 1 }),
                    timeout,
                )?;
            }
            let mut result = json!({
                "nativeInput": "webview2-cdp",
                "element": target,
            });
            result[if action == "click" { "clicked" } else { "hovered" }] = Value::Bool(true);
            Ok(result)
        }
        "type" => {
            let target = evaluate_windows_runtime_action(
                webview,
                "__native_target",
                input,
                timeout,
            )?;
            let (x, y) = windows_target_point(&target)?;
            dispatch_windows_mouse(webview, "mouseMoved", x, y, json!({}), timeout)?;
            dispatch_windows_mouse(
                webview,
                "mousePressed",
                x,
                y,
                json!({ "button": "left", "buttons": 1, "clickCount": 1 }),
                timeout,
            )?;
            dispatch_windows_mouse(
                webview,
                "mouseReleased",
                x,
                y,
                json!({ "button": "left", "buttons": 0, "clickCount": 1 }),
                timeout,
            )?;
            let mut target_input = input.clone();
            if let Some(object) = target_input.as_object_mut() {
                object.insert("selectAll".to_string(), Value::Bool(true));
            }
            evaluate_windows_runtime_action(
                webview,
                "__native_target",
                &target_input,
                timeout,
            )?;
            let text = input.get("text").and_then(Value::as_str).unwrap_or("");
            if text.is_empty() {
                dispatch_windows_key(webview, "Backspace", timeout)?;
            } else {
                call_windows_cdp(
                    webview,
                    "Input.insertText",
                    &json!({ "text": text }),
                    timeout,
                )?;
            }
            if input.get("submit").and_then(Value::as_bool).unwrap_or(false) {
                dispatch_windows_key(webview, "Enter", timeout)?;
            }
            Ok(json!({
                "typed": true,
                "length": text.chars().count(),
                "nativeInput": "webview2-cdp",
                "element": target,
            }))
        }
        "press_key" => {
            let has_target = input.get("ref").is_some() || input.get("selector").is_some();
            if has_target {
                evaluate_windows_runtime_action(
                    webview,
                    "__native_target",
                    input,
                    timeout,
                )?;
            }
            let key = input
                .get("key")
                .and_then(Value::as_str)
                .ok_or_else(|| Error::Message("press_key requires input.key".to_string()))?;
            dispatch_windows_key(webview, key, timeout)?;
            Ok(json!({ "pressed": true, "key": key, "nativeInput": "webview2-cdp" }))
        }
        "scroll" => {
            let target = if input.get("ref").is_some() || input.get("selector").is_some() {
                evaluate_windows_runtime_action(
                    webview,
                    "__native_target",
                    input,
                    timeout,
                )?
            } else {
                evaluate_windows_runtime_action(webview, "page_info", &json!({}), timeout)?
            };
            let (x, y) = if target.get("rect").is_some() {
                windows_target_point(&target)?
            } else {
                (
                    target
                        .get("viewportWidth")
                        .and_then(Value::as_f64)
                        .unwrap_or(1024.0)
                        / 2.0,
                    target
                        .get("viewportHeight")
                        .and_then(Value::as_f64)
                        .unwrap_or(768.0)
                        / 2.0,
                )
            };
            let amount = input
                .get("amount")
                .and_then(Value::as_f64)
                .unwrap_or(600.0)
                .clamp(1.0, 10_000.0);
            let direction = input
                .get("direction")
                .and_then(Value::as_str)
                .unwrap_or("down");
            let (delta_x, delta_y) = match direction {
                "up" => (0.0, -amount),
                "left" => (-amount, 0.0),
                "right" => (amount, 0.0),
                _ => (0.0, amount),
            };
            dispatch_windows_mouse(
                webview,
                "mouseWheel",
                x,
                y,
                json!({ "deltaX": delta_x, "deltaY": delta_y }),
                timeout,
            )?;
            Ok(json!({
                "scrolled": true,
                "direction": direction,
                "amount": amount,
                "nativeInput": "webview2-cdp",
            }))
        }
        _ => evaluate_windows_runtime_action(webview, action, input, timeout),
    }
}

#[cfg(not(target_os = "windows"))]
fn evaluate_dom_action<R: Runtime>(
    webview: &tauri::Webview<R>,
    action: &str,
    input: &Value,
    timeout_ms: u64,
) -> crate::Result<Value> {
    let action_json = serde_json::to_string(action)
        .map_err(|error| Error::Message(format!("failed to encode browser action: {error}")))?;
    let input_json = serde_json::to_string(input)
        .map_err(|error| Error::Message(format!("failed to encode browser input: {error}")))?;
    let script = format!(
        "(() => {{ if (!window.__xgentBrowserRuntime) {{ {BROWSER_RUNTIME_SCRIPT} }} return window.__xgentBrowserRuntime.execute({action_json}, {input_json}); }})()"
    );
    let (sender, receiver) = mpsc::sync_channel(1);
    webview
        .eval_with_callback(script, move |value| {
            let _ = sender.send(value);
        })
        .map_err(|error| Error::Message(format!("failed to evaluate browser action: {error}")))?;
    let raw = receiver
        .recv_timeout(Duration::from_millis(timeout_ms))
        .map_err(|_| {
            let _ = webview.reload();
            Error::Message(
                "browser action timed out; the WebView was reloaded so the session can recover"
                    .to_string(),
            )
        })?;
    decode_runtime_response(&raw)
}

#[cfg(target_os = "windows")]
fn can_navigate_history<R: Runtime>(
    webview: &tauri::Webview<R>,
    forward: bool,
) -> crate::Result<bool> {
    let (sender, receiver) = mpsc::sync_channel(1);
    webview
        .with_webview(move |platform_webview| unsafe {
            let value = platform_webview
                .controller()
                .CoreWebView2()
                .and_then(|core| {
                    if forward {
                        core.CanGoForward()
                    } else {
                        core.CanGoBack()
                    }
                })
                .map(|value| value.as_bool())
                .map_err(|error| format!("failed to inspect browser history: {error}"));
            let _ = sender.send(value);
        })
        .map_err(|error| Error::Message(format!("failed to access browser WebView: {error}")))?;
    receiver
        .recv_timeout(Duration::from_secs(2))
        .map_err(|_| Error::Message("browser history inspection timed out".to_string()))?
        .map_err(Error::Message)
}

#[cfg(target_os = "macos")]
fn can_navigate_history<R: Runtime>(
    webview: &tauri::Webview<R>,
    forward: bool,
) -> crate::Result<bool> {
    use objc2_web_kit::WKWebView;

    let (sender, receiver) = mpsc::sync_channel(1);
    webview
        .with_webview(move |platform_webview| unsafe {
            let wk_webview: &WKWebView = &*platform_webview.inner().cast();
            let value = if forward {
                wk_webview.canGoForward()
            } else {
                wk_webview.canGoBack()
            };
            let _ = sender.send(value);
        })
        .map_err(|error| Error::Message(format!("failed to access browser WebView: {error}")))?;
    receiver
        .recv_timeout(Duration::from_secs(2))
        .map_err(|_| Error::Message("browser history inspection timed out".to_string()))
}

#[cfg(target_os = "linux")]
fn can_navigate_history<R: Runtime>(
    webview: &tauri::Webview<R>,
    forward: bool,
) -> crate::Result<bool> {
    use webkit2gtk::WebViewExt;

    let (sender, receiver) = mpsc::sync_channel(1);
    webview
        .with_webview(move |platform_webview| {
            let value = if forward {
                platform_webview.inner().can_go_forward()
            } else {
                platform_webview.inner().can_go_back()
            };
            let _ = sender.send(value);
        })
        .map_err(|error| Error::Message(format!("failed to access browser WebView: {error}")))?;
    receiver
        .recv_timeout(Duration::from_secs(2))
        .map_err(|_| Error::Message("browser history inspection timed out".to_string()))
}

#[cfg(target_os = "linux")]
fn install_desktop_process_recovery<R: Runtime>(
    webview: &tauri::Webview<R>,
    page_load_states: Arc<(Mutex<HashMap<String, PageLoadState>>, Condvar)>,
    session_id: String,
) -> crate::Result<()> {
    use webkit2gtk::WebViewExt;

    webview
        .with_webview(move |platform_webview| {
            let view = platform_webview.inner();
            let failed_states = Arc::clone(&page_load_states);
            let failed_session_id = session_id.clone();
            view.connect_load_failed(move |_, _, failing_uri, error| {
                let (states, wake) = &*failed_states;
                if let Ok(mut states) = states.lock() {
                    let state = states.entry(failed_session_id.clone()).or_default();
                    state.loading = false;
                    state.error = Some(format!(
                        "browser navigation failed for {failing_uri}: {error}"
                    ));
                    wake.notify_all();
                }
                false
            });
            view
                .connect_web_process_terminated(move |view, _reason| {
                    let (states, wake) = &*page_load_states;
                    if let Ok(mut states) = states.lock() {
                        let state = states.entry(session_id.clone()).or_default();
                        state.loading = false;
                        state.error = Some(
                            "browser WebKit process terminated; the session was reloaded"
                                .to_string(),
                        );
                        wake.notify_all();
                    }
                    view.reload();
                });
        })
        .map_err(|error| {
            Error::Message(format!(
                "failed to install Linux browser process recovery: {error}"
            ))
        })
}

#[cfg(not(target_os = "linux"))]
fn install_desktop_process_recovery<R: Runtime>(
    _webview: &tauri::Webview<R>,
    _page_load_states: Arc<(Mutex<HashMap<String, PageLoadState>>, Condvar)>,
    _session_id: String,
) -> crate::Result<()> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn install_windows_navigation_lifecycle<R: Runtime>(
    webview: &tauri::Webview<R>,
    page_load_states: Arc<(Mutex<HashMap<String, PageLoadState>>, Condvar)>,
    session_id: String,
) -> crate::Result<()> {
    use webview2_com::{NavigationCompletedEventHandler, NavigationStartingEventHandler};
    use windows::Win32::Foundation::BOOL;

    webview
        .with_webview(move |platform_webview| unsafe {
            let install = (|| -> Result<(), String> {
                let core = platform_webview
                    .controller()
                    .CoreWebView2()
                    .map_err(|error| format!("failed to access CoreWebView2: {error}"))?;

                let started_states = Arc::clone(&page_load_states);
                let started_session_id = session_id.clone();
                let started = NavigationStartingEventHandler::create(Box::new(move |_, args| {
                    let (states, wake) = &*started_states;
                    if let Ok(mut states) = states.lock() {
                        let state = states.entry(started_session_id.clone()).or_default();
                        state.sequence = state.sequence.saturating_add(1);
                        state.loading = true;
                        state.error = None;
                        if let Some(args) = args {
                            let mut navigation_id = 0u64;
                            if args.NavigationId(&mut navigation_id).is_ok() {
                                state.native_navigation_id = Some(navigation_id);
                            }
                        }
                        wake.notify_all();
                    }
                    Ok(())
                }));
                let mut started_token = 0i64;
                core.add_NavigationStarting(&started, &mut started_token)
                    .map_err(|error| {
                        format!("failed to subscribe to WebView2 navigation start: {error}")
                    })?;

                let completed_states = Arc::clone(&page_load_states);
                let completed_session_id = session_id.clone();
                let completed =
                    NavigationCompletedEventHandler::create(Box::new(move |_, args| {
                        let (states, wake) = &*completed_states;
                        if let Ok(mut states) = states.lock() {
                            let state = states.entry(completed_session_id.clone()).or_default();
                            let completed_navigation_id = args.as_ref().and_then(|args| {
                                let mut navigation_id = 0u64;
                                args.NavigationId(&mut navigation_id).ok()?;
                                Some(navigation_id)
                            });
                            if completed_navigation_id != state.native_navigation_id {
                                return Ok(());
                            }
                            state.loading = false;
                            state.completed_sequence = state.sequence;
                            let mut success = BOOL::default();
                            let succeeded = args
                                .as_ref()
                                .is_some_and(|args| args.IsSuccess(&mut success).is_ok())
                                && success.as_bool();
                            if !succeeded {
                                state.error = Some(
                                    "WebView2 reported that browser navigation failed".to_string(),
                                );
                            }
                            wake.notify_all();
                        }
                        Ok(())
                    }));
                let mut completed_token = 0i64;
                core.add_NavigationCompleted(&completed, &mut completed_token)
                    .map_err(|error| {
                        format!("failed to subscribe to WebView2 navigation completion: {error}")
                    })?;
                Ok(())
            })();
            if let Err(error) = install {
                let (states, wake) = &*page_load_states;
                if let Ok(mut states) = states.lock() {
                    states.entry(session_id).or_default().error = Some(error);
                    wake.notify_all();
                }
            }
        })
        .map_err(|error| {
            Error::Message(format!(
                "failed to install WebView2 navigation lifecycle: {error}"
            ))
        })
}

#[cfg(not(target_os = "windows"))]
fn install_windows_navigation_lifecycle<R: Runtime>(
    _webview: &tauri::Webview<R>,
    _page_load_states: Arc<(Mutex<HashMap<String, PageLoadState>>, Condvar)>,
    _session_id: String,
) -> crate::Result<()> {
    Ok(())
}

fn decode_runtime_response(raw: &str) -> crate::Result<Value> {
    let outer = serde_json::from_str::<Value>(raw).unwrap_or_else(|_| Value::String(raw.to_string()));
    let envelope = match outer {
        Value::String(inner) => serde_json::from_str::<Value>(&inner)
            .map_err(|error| Error::Message(format!("invalid browser response: {error}")))?,
        value => value,
    };
    if envelope.get("ok").and_then(Value::as_bool) == Some(false) {
        return Err(Error::Message(
            envelope
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("browser DOM action failed")
                .to_string(),
        ));
    }
    Ok(envelope.get("data").cloned().unwrap_or(Value::Null))
}

fn lock_error<T>(error: std::sync::PoisonError<T>) -> Error {
    Error::Message(format!("browser session state is unavailable: {error}"))
}
