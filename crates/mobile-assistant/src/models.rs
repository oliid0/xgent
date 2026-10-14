use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Unauthenticated service advertisements, never task/credential authority.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct NearbyWorkstation {
    pub host_id:String,
    pub platform:String,
    pub urls:Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct NearbyWorkstations {pub services:Vec<NearbyWorkstation>}

/// Internal platform change metadata; never a sample value or read grant.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HealthChangeEvent {
    pub id: String,
    pub metric: String,
    pub occurred_at_ms: i64,
}

/// Actual original-device HomeKit power notification; no write authority.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct HomeChangeEvent {
    pub id:String,
    pub home_id:String,
    pub accessory_id:String,
    pub service_id:String,
    pub characteristic_id:String,
    #[serde(default)] pub home_name_preview:String,
    #[serde(default)] pub accessory_name_preview:String,
    #[serde(default)] pub service_name_preview:String,
    pub power:bool,
    pub occurred_at_ms:i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct HomeEventConfiguration { pub host_id:String,pub homes:Vec<String>,pub authorize:bool }

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct HomeEventSource {pub id:String,pub name:String}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HealthEventConfiguration {
    pub metrics: Vec<String>,
    pub authorize: bool,
    /// Read-only native policy/rule source for an Activity-independent worker.
    #[cfg(target_os = "android")]
    pub policy_database: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HealthEventAcknowledgement {
    pub ids: Vec<String>,
}

/// Internal service payload: content is fixed by the platform, never model text.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResultNotificationRequest {
    pub entry_id: String,
}

/// Native startup only; scoped updates never include full peer credentials.
#[cfg(any(target_os = "android",target_os = "ios"))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResultDeliveryConfiguration {
    pub database_path: String,
    pub host_id: String,
    #[serde(default)]
    pub target_json: String,
}

/// Private native event service setup; no token/model/shell or event injection.
#[derive(Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct EventDeliveryConfiguration {
    pub database_path:String,
    pub host_id:String,
    pub enabled:bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResultNotificationReceipt {
    Accepted,
    Blocked,
}

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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HomeInventoryRequest {
    pub limit: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub home_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum HomeInventoryKind { Home, Room, Accessory, Scene }

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeInventoryRecord {
    pub kind: HomeInventoryKind,
    pub id: String,
    pub home_id: String,
    pub name: String,
    pub room_id: Option<String>,
    pub reachable: Option<bool>,
    #[serde(default)]
    pub power_controls: Vec<HomePowerControl>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HomePowerControl {
    pub id: String,
    pub service_id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HomePowerRequest {
    pub home_id: String,
    pub accessory_id: String,
    pub service_id: String,
    pub characteristic_id: String,
    pub power: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HomePowerDestination {
    pub id: String,
    pub source_id: String,
    pub source: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeInventoryResult {
    pub source: String,
    pub observed_at_ms: i64,
    pub records: Vec<HomeInventoryRecord>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContactListRequest {
    #[serde(default)]
    pub query: String,
    pub limit: u16,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileContact {
    pub id: String,
    pub name: String,
    pub phones: Vec<String>,
    pub emails: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactListResult {
    pub contacts: Vec<MobileContact>,
    pub truncated: bool,
    pub access_limited: bool,
}

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calendar_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CalendarKind { Event, Reminder }

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CalendarListRequest {
    pub kind: CalendarKind,
    #[serde(default = "default_true")]
    pub writable_only: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calendar_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileCalendar {
    pub id: String,
    pub title: String,
    pub source: String,
    #[serde(default)]
    pub source_id: String,
    pub is_default: bool,
    #[serde(default = "default_true")]
    pub writable: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarListResult {
    pub calendars: Vec<MobileCalendar>,
    pub truncated: bool,
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
    #[serde(default)]
    pub calendar_id: String,
    #[serde(default)]
    pub source_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderListRequest {
    #[serde(default = "default_true")]
    pub incomplete_only: bool,
    #[serde(default = "default_result_limit")]
    pub limit: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calendar_ids: Option<Vec<String>>,
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
    #[serde(default)]
    pub calendar_id: String,
    #[serde(default)]
    pub source_id: String,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calendar_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_source_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateReminderRequest {
    pub title: String,
    pub due_ms: Option<i64>,
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recurrence: Option<ReminderRecurrence>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calendar_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_source_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ReminderRecurrence { Daily, Weekly }

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
pub struct ImageAttachmentRequest {
    pub file_name: String,
    pub content_base64: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageAttachmentResult {
    pub file_name: String,
    pub mime_type: String,
    pub content_base64: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BluetoothGattRequest {
    pub operation: String,
    pub device_id: String,
    pub service_uuid: Option<String>,
    pub characteristic_uuid: Option<String>,
    pub timeout_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sample_limit: Option<u16>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BluetoothGattResult {
    pub device_id: String,
    pub services: Vec<BluetoothGattService>,
    pub service_uuid: Option<String>,
    pub characteristic_uuid: Option<String>,
    pub data_hex: Option<String>,
    #[serde(default)]
    pub samples: Vec<BluetoothGattSample>,
    pub stop_reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BluetoothGattSample {
    pub received_at_ms: i64,
    pub data_hex: String,
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
