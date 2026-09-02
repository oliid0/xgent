use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum BrowserBackend {
    DesktopWebview,
    AndroidWebview,
    IosWkWebview,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCapabilities {
    pub visible_sessions: bool,
    pub dom_automation: bool,
    pub javascript: bool,
    pub screenshots: bool,
    pub downloads: bool,
    pub multiple_sessions: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserStatus {
    pub backend: BrowserBackend,
    pub available: bool,
    pub detail: Option<String>,
    pub capabilities: BrowserCapabilities,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserViewport {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub visible: bool,
    #[serde(default = "default_scale_factor")]
    pub scale_factor: f64,
}

fn default_scale_factor() -> f64 {
    1.0
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSessionRequest {
    pub session_id: String,
    pub url: String,
    #[serde(default)]
    pub viewport: BrowserViewport,
    #[serde(default)]
    pub user_agent: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSessionSummary {
    pub session_id: String,
    pub url: String,
    pub title: Option<String>,
    pub visible: bool,
    pub loading: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRequest {
    pub session_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetViewportRequest {
    pub session_id: String,
    pub viewport: BrowserViewport,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserActionRequest {
    #[serde(default)]
    pub request_id: String,
    pub session_id: String,
    pub action: String,
    #[serde(default)]
    pub input: Value,
    #[serde(default = "default_action_timeout_ms")]
    pub timeout_ms: u64,
}

fn default_action_timeout_ms() -> u64 {
    30_000
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserActionResponse {
    pub request_id: String,
    pub session_id: String,
    pub action: String,
    pub url: String,
    pub title: Option<String>,
    pub data: Value,
    pub screenshot_base64: Option<String>,
    pub lifecycle: BrowserCommandLifecycle,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCommandLifecycle {
    pub command_completed: bool,
    pub navigation_started: bool,
    pub navigation_finished: bool,
    pub recovered: bool,
}
