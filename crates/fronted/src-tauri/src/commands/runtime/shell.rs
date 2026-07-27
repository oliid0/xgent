use serde::Serialize;
use tauri::AppHandle;

#[cfg(desktop)]
use std::sync::Arc;
#[cfg(desktop)]
use tauri::State;

#[cfg(mobile)]
use tauri_plugin_mobile_execution::{
    CancelRequest as MobileCancelRequest, MobileExecutionExt, RunRequest as MobileRunRequest,
};

#[cfg(desktop)]
use crate::runtime::shell_runner::{run_shell_script, ShellRunRegistry};
use crate::runtime::shell_types::{
    ShellRunResponse, DEFAULT_SHELL_TIMEOUT_MS, MAX_SHELL_TIMEOUT_MS, MIN_SHELL_TIMEOUT_MS,
};

#[derive(Debug, Serialize)]
pub struct ShellCancelResponse {
    cancelled: bool,
}

#[tauri::command(rename_all = "snake_case")]
#[cfg(mobile)]
pub async fn shell_run(
    app: AppHandle,
    workdir: String,
    command: String,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
    max_timeout_ms: Option<u64>,
    provider_id: Option<String>,
    run_id: Option<String>,
) -> Result<ShellRunResponse, String> {
    let _ = provider_id;
    let settings = crate::commands::settings::load_access_settings(
        &crate::commands::settings::open_db()?,
    )?;
    #[cfg(target_os = "android")]
    if !settings.android_proot_enabled {
        return Err("Android PRoot execution is disabled in Access settings".to_string());
    }
    #[cfg(target_os = "ios")]
    if !settings.ios_a_shell_enabled {
        return Err("iOS a-Shell execution is disabled in Access settings".to_string());
    }

    let maximum = max_timeout_ms
        .unwrap_or(MAX_SHELL_TIMEOUT_MS)
        .clamp(MIN_SHELL_TIMEOUT_MS, MAX_SHELL_TIMEOUT_MS);
    let effective_timeout_ms = timeout_ms
        .unwrap_or(DEFAULT_SHELL_TIMEOUT_MS)
        .clamp(MIN_SHELL_TIMEOUT_MS, maximum);
    let run_id = run_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let response = app
        .mobile_execution()
        .run(MobileRunRequest {
            run_id,
            workdir,
            command,
            cwd,
            timeout_ms: effective_timeout_ms,
            stdin_base64: None,
            wasi: None,
        })
        .map_err(|error| error.to_string())?;
    Ok(ShellRunResponse {
        exit_code: response.exit_code,
        shell: response.shell,
        platform: response.platform,
        profile: response.profile,
        shell_family: response.shell_family,
        stdout: response.stdout,
        stderr: response.stderr,
        stdout_truncated: response.stdout_truncated,
        stderr_truncated: response.stderr_truncated,
        timed_out: response.timed_out,
        cancelled: response.cancelled,
        stdio_open_after_exit: response.stdio_open_after_exit,
        effective_timeout_ms: response.effective_timeout_ms,
        duration_ms: u128::from(response.duration_ms),
    })
}

#[tauri::command(rename_all = "snake_case")]
#[cfg(desktop)]
pub async fn shell_run(
    app: AppHandle,
    registry: State<'_, Arc<ShellRunRegistry>>,
    workdir: String,
    command: String,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
    max_timeout_ms: Option<u64>,
    provider_id: Option<String>,
    run_id: Option<String>,
) -> Result<ShellRunResponse, String> {
    let _ = app;
    let normalized_run_id = run_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let cancel_token = normalized_run_id.as_deref().map(|id| registry.register(id));

    let join_result = tauri::async_runtime::spawn_blocking(move || {
        run_shell_script(
            workdir,
            command,
            cwd,
            timeout_ms,
            max_timeout_ms,
            provider_id,
            cancel_token,
        )
    })
    .await;

    if let Some(run_id) = normalized_run_id {
        registry.unregister(&run_id);
    }

    join_result.map_err(|e| format!("shell_run join failed: {e}"))?
}

#[tauri::command(rename_all = "snake_case")]
#[cfg(mobile)]
pub fn shell_cancel(app: AppHandle, run_id: String) -> ShellCancelResponse {
    ShellCancelResponse {
        cancelled: app
            .mobile_execution()
            .cancel(MobileCancelRequest {
                run_id: run_id.trim().to_string(),
            })
            .map(|response| response.cancelled)
            .unwrap_or(false),
    }
}

#[tauri::command(rename_all = "snake_case")]
#[cfg(desktop)]
pub fn shell_cancel(
    app: AppHandle,
    registry: State<'_, Arc<ShellRunRegistry>>,
    run_id: String,
) -> ShellCancelResponse {
    let _ = app;
    ShellCancelResponse {
        cancelled: registry.cancel(run_id.trim()),
    }
}
