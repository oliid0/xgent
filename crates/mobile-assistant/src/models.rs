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
