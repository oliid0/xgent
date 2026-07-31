use serde::{Deserialize, Serialize};

pub(crate) const DEFAULT_SHELL_TIMEOUT_MS: u64 = 120_000;
pub(crate) const MIN_SHELL_TIMEOUT_MS: u64 = 1_000;
pub(crate) const MAX_SHELL_TIMEOUT_MS: u64 = 10 * 60_000;

#[derive(Debug, Deserialize, Serialize)]
pub struct ShellRunResponse {
    pub exit_code: i32,
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
    pub duration_ms: u128,
}
