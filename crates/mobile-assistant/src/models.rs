use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum MobileAssistantBackend {
    DesktopUnavailable,
    AndroidNative,
    IosNative,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileAssistantStatus {
    pub backend: MobileAssistantBackend,
    pub available: bool,
    pub voice_input_available: bool,
    pub external_folder_mount_available: bool,
    pub cloud_sync_available: bool,
    pub health_available: bool,
    pub home_available: bool,
    #[serde(default)]
    pub permission_aliases: BTreeMap<String, String>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceInputRequest {
    #[serde(default)]
    pub locale: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceInputResult {
    pub text: String,
    pub locale: String,
    pub confidence: Option<f64>,
}

pub type MobilePermissionStates = BTreeMap<String, String>;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobilePermissionRequest {
    pub permissions: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentLocationRequest {
    #[serde(default = "default_location_timeout_ms")]
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileLocation {
    pub latitude: f64,
    pub longitude: f64,
    pub altitude_meters: Option<f64>,
    pub accuracy_meters: f64,
    pub timestamp_ms: i64,
    pub provider: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarRangeRequest {
    pub start_ms: i64,
    pub end_ms: i64,
    #[serde(default = "default_result_limit")]
    pub limit: u16,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileCalendarEvent {
    pub id: String,
    pub title: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub all_day: bool,
    pub location: Option<String>,
    pub notes: Option<String>,
    pub calendar: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderListRequest {
    #[serde(default = "default_true")]
    pub incomplete_only: bool,
    #[serde(default = "default_result_limit")]
    pub limit: u16,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileReminder {
    pub id: String,
    pub title: String,
    pub due_ms: Option<i64>,
    pub completed: bool,
    pub notes: Option<String>,
    pub list: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCalendarEventRequest {
    pub title: String,
    pub start_ms: i64,
    pub end_ms: i64,
    #[serde(default)]
    pub all_day: bool,
    pub location: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateReminderRequest {
    pub title: String,
    pub due_ms: Option<i64>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ComposeMessageKind {
    Email,
    Sms,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeMessageRequest {
    pub kind: ComposeMessageKind,
    pub recipients: Vec<String>,
    pub subject: Option<String>,
    pub body: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileActionResult {
    pub id: Option<String>,
    pub presented: bool,
    pub detail: String,
}

fn default_result_limit() -> u16 {
    50
}

fn default_location_timeout_ms() -> u64 {
    10_000
}

fn default_true() -> bool {
    true
}
