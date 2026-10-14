//! Status of the app-owned embedded node only.
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TailscaleStatus {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub engine: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_authenticate: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_logout: Option<bool>,
    pub state: String,
    pub addresses: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dns_name: Option<String>,
    pub observed_at: i64,
}

pub(crate) fn normalize_magic_dns_name(raw: &str) -> Option<String> {
    let name = raw.strip_suffix('.').unwrap_or(raw).to_ascii_lowercase();
    let labels: Vec<_> = name.split('.').collect();
    if name.len() > 253 || labels.len() < 4 || !name.ends_with(".ts.net")
        || labels.iter().any(|label| label.is_empty() || label.len() > 63
            || label.starts_with('-') || label.ends_with('-')
            || !label.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')) {
        return None;
    }
    Some(name)
}

pub async fn observe() -> TailscaleStatus {
    super::embedded_tailnet::observe().await
}
