use std::{
    collections::HashMap,
    sync::{mpsc, Mutex},
    time::Duration,
};

use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use tauri::{
    plugin::PluginApi,
    webview::WebviewBuilder,
    AppHandle, LogicalPosition, LogicalSize, Manager, Runtime, WebviewUrl,
};
use url::Url;

use crate::models::*;
use crate::{Error, BROWSER_RUNTIME_SCRIPT};

const WEBVIEW_LABEL_PREFIX: &str = "xgent-browser-";

#[derive(Clone)]
struct SessionRecord {
    session_id: String,
    label: String,
    visible: bool,
}

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<BrowserAutomation<R>> {
    Ok(BrowserAutomation {
        app: app.clone(),
        sessions: Mutex::new(HashMap::new()),
    })
}

pub struct BrowserAutomation<R: Runtime> {
    app: AppHandle<R>,
    sessions: Mutex<HashMap<String, SessionRecord>>,
}

impl<R: Runtime> BrowserAutomation<R> {
    pub fn status(&self) -> crate::Result<BrowserStatus> {
        Ok(BrowserStatus {
            backend: BrowserBackend::DesktopWebview,
            available: true,
            detail: Some(
                "Tauri child WebView sessions with isolated navigation and DOM automation"
                    .to_string(),
            ),
            capabilities: BrowserCapabilities {
                visible_sessions: true,
                dom_automation: true,
                javascript: true,
                screenshots: false,
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
            webview
                .navigate(url)
                .map_err(|error| Error::Message(format!("failed to navigate browser: {error}")))?;
            self.apply_viewport(&record, &request.viewport)?;
            return self.session_summary(&record);
        }

        let label = format!("{WEBVIEW_LABEL_PREFIX}{}", request.session_id);
        let window = self
            .app
            .get_window("main")
            .ok_or_else(|| Error::Message("main application window is unavailable".to_string()))?;
        let builder = WebviewBuilder::new(label.clone(), WebviewUrl::External(url))
            .initialization_script(BROWSER_RUNTIME_SCRIPT)
            .on_navigation(|url| matches!(url.scheme(), "http" | "https"));
        let viewport = normalized_viewport(&request.viewport);
        let webview = window
            .add_child(
                builder,
                LogicalPosition::new(viewport.x, viewport.y),
                LogicalSize::new(viewport.width, viewport.height),
            )
            .map_err(|error| Error::Message(format!("failed to create browser WebView: {error}")))?;

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

        let data = match action.as_str() {
            "navigate" => {
                let target = request
                    .input
                    .get("url")
                    .and_then(Value::as_str)
                    .ok_or_else(|| Error::Message("navigate requires input.url".to_string()))?;
                webview
                    .navigate(parse_browser_url(target)?)
                    .map_err(|error| Error::Message(format!("failed to navigate browser: {error}")))?;
                json!({ "navigated": true, "url": target })
            }
            "reload" => {
                webview
                    .reload()
                    .map_err(|error| Error::Message(format!("failed to reload browser: {error}")))?;
                json!({ "reloaded": true })
            }
            "go_back" => {
                webview
                    .eval("history.back()")
                    .map_err(|error| Error::Message(format!("failed to go back: {error}")))?;
                json!({ "requested": "back" })
            }
            "go_forward" => {
                webview
                    .eval("history.forward()")
                    .map_err(|error| Error::Message(format!("failed to go forward: {error}")))?;
                json!({ "requested": "forward" })
            }
            "screenshot" => {
                return Err(Error::Message(
                    "desktop browser screenshots are not available in this build".to_string(),
                ));
            }
            _ => evaluate_dom_action(
                &webview,
                &action,
                &request.input,
                request.timeout_ms.clamp(1_000, 90_000),
            )?,
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
            session_id: request.session_id,
            action,
            url,
            title,
            data,
            screenshot_base64: None,
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
            loading: false,
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
        .map_err(|_| Error::Message("browser action timed out".to_string()))?;
    decode_runtime_response(&raw)
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
