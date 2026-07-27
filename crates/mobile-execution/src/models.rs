use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum MobileExecutionBackend {
    AndroidProot,
    IosAShell,
    Unavailable,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileExecutionCapabilities {
    pub shell: bool,
    pub wasi: bool,
    pub network: bool,
    pub child_processes: bool,
    pub user_selected_workspaces: bool,
    pub package_management: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileToolchainStatus {
    pub id: String,
    pub label: String,
    pub installed: bool,
    pub installable: bool,
    pub version: Option<String>,
    #[serde(default)]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileExecutionStatus {
    pub backend: MobileExecutionBackend,
    pub available: bool,
    pub installed: bool,
    pub detail: Option<String>,
    pub capabilities: MobileExecutionCapabilities,
    #[serde(default)]
    pub toolchains: Vec<MobileToolchainStatus>,
    pub environment_version: Option<String>,
    pub disk_usage_bytes: Option<u64>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallRequest {}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResponse {
    pub backend: MobileExecutionBackend,
    pub installed: bool,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallToolchainsRequest {
    pub run_id: String,
    pub toolchains: Vec<String>,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallToolchainsResponse {
    pub backend: MobileExecutionBackend,
    pub succeeded: bool,
    pub exit_code: i32,
    pub installed: Vec<String>,
    pub status: Vec<MobileToolchainStatus>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasiInvocation {
    pub module_path: String,
    #[serde(default)]
    pub arguments: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    pub run_id: String,
    pub workdir: String,
    pub command: String,
    pub cwd: Option<String>,
    pub timeout_ms: u64,
    pub stdin_base64: Option<String>,
    pub wasi: Option<WasiInvocation>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResponse {
    pub exit_code: i32,
    pub backend: MobileExecutionBackend,
    pub shell: String,
    pub platform: String,
    pub profile: String,
    pub shell_family: String,
    pub stdout: String,
    pub stderr: String,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
    pub timed_out: bool,
    pub cancelled: bool,
    pub stdio_open_after_exit: bool,
    pub effective_timeout_ms: u64,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelRequest {
    pub run_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelResponse {
    pub cancelled: bool,
}
