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
    pub network: Option<MobileNetworkStatus>,
    #[serde(default)]
    pub audio_outputs: Vec<MobileAudioOutput>,
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
pub struct BluetoothScanRequest {
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileNetworkStatus {
    pub transport: String,
    pub connected: bool,
    pub metered: Option<bool>,
    pub validated: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileAudioOutput {
    pub id: String,
    pub name: String,
    pub transport: String,
    pub active: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BluetoothDevice {
    pub id: String,
    pub name: Option<String>,
    pub rssi: i32,
    pub service_uuids: Vec<String>,
}

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
pub struct HealthStepsRequest {
    pub start_ms: i64,
    pub end_ms: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthStepsSummary {
    pub start_ms: i64,
    pub end_ms: i64,
    pub steps: i64,
    pub source: String,
    #[serde(default)]
    pub access_limited: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthMetric {
    HeartRate,
    BloodGlucose,
    OxygenSaturation,
    Weight,
    BodyTemperature,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthMetricRequest {
    pub metric: HealthMetric,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthSamplesRequest {
    pub metric: HealthMetric,
    pub start_ms: i64,
    pub end_ms: i64,
    #[serde(default = "default_result_limit")]
    pub limit: u16,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthSample {
    pub id: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub value: f64,
    pub source: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthSamplesResult {
    pub metric: HealthMetric,
    pub unit: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub samples: Vec<HealthSample>,
    pub source: String,
    pub truncated: bool,
    pub access_limited: bool,
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

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ClipboardText {
    pub text: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoListRequest {
    pub start_ms: Option<i64>,
    pub end_ms: Option<i64>,
    #[serde(default = "default_result_limit")]
    pub limit: u16,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobilePhoto {
    pub id: String,
    pub created_ms: Option<i64>,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoListResult {
    pub photos: Vec<MobilePhoto>,
    pub truncated: bool,
    pub access_limited: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PhotoReadRequest {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BluetoothGattRequest {
    pub operation: String,
    pub device_id: String,
    pub service_uuid: Option<String>,
    pub characteristic_uuid: Option<String>,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BluetoothGattResult {
    pub device_id: String,
    pub services: Vec<BluetoothGattService>,
    pub service_uuid: Option<String>,
    pub characteristic_uuid: Option<String>,
    pub data_hex: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BluetoothGattService {
    pub uuid: String,
    pub characteristics: Vec<BluetoothGattCharacteristic>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BluetoothGattCharacteristic {
    pub uuid: String,
    pub readable: bool,
    pub writable: bool,
    pub notifiable: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoReadResult {
    pub id: String,
    pub mime_type: String,
    pub data_base64: String,
    pub width: u32,
    pub height: u32,
}
