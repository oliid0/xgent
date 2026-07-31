#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsLoadResponse {
    pub providers: Option<Value>,
    pub system: Option<Value>,
    pub mcp: Option<Value>,
    pub agents: Option<Value>,
    pub ssh: Option<Value>,
    pub access: Option<Value>,
    pub memory: Option<Value>,
    pub default_workdir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccessSettingsPayload {
    #[serde(default)]
    pub web_ui_enabled: bool,
    #[serde(default = "default_web_ui_scope")]
    pub web_ui_scope: String,
    #[serde(default = "default_web_ui_port")]
    pub web_ui_port: u16,
    /// Last desktop Web UI endpoint opened by a native mobile client.
    #[serde(default)]
    pub lan_control_url: String,
    /// Route supported mobile tool calls to the paired LAN computer when available.
    #[serde(default)]
    pub prefer_lan_pc_execution: bool,
    #[serde(default)]
    pub allow_terminal: bool,
    #[serde(default)]
    pub allow_browser_automation: bool,
    #[serde(default)]
    pub allow_ssh: bool,
    #[serde(default)]
    pub allow_git: bool,
    #[serde(default)]
    pub allow_file_write: bool,
    #[serde(default)]
    pub cloud_execution_enabled: bool,
    #[serde(default)]
    pub github_owner: String,
    #[serde(default = "default_github_repository")]
    pub github_repository: String,
    #[serde(default = "default_cloud_artifact_retention_days")]
    pub cloud_artifact_retention_days: u16,
    #[serde(default = "default_mobile_execution_enabled")]
    pub android_proot_enabled: bool,
    #[serde(default = "default_mobile_execution_enabled")]
    pub ios_a_shell_enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshPatchApplyResponse {
    pub ssh: Value,
    pub conflict: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct RuntimeSshProxyConfig {
    pub proxy_type: String,
    pub url: String,
    pub port: i64,
    pub username: String,
    pub password: String,
    pub password_configured: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct RuntimeSshHostConfig {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String,
    pub password: String,
    pub private_key: String,
    pub private_key_path: String,
    pub private_key_passphrase: String,
    pub proxy: RuntimeSshProxyConfig,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RuntimeSshKnownHostStatus {
    Known,
    Unknown,
    Changed { stored_fingerprint: String },
}

#[derive(Debug, Clone)]
pub(crate) struct RuntimeSshKnownHostKey {
    pub host: String,
    pub port: u16,
    pub key_type: String,
    pub key_base64: String,
    pub fingerprint_sha256: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKnownHostResetResponse {
    pub deleted: usize,
}
