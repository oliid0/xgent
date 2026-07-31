use serde::Serialize;
use std::sync::Arc;
use tauri::AppHandle;
#[cfg(desktop)]
use tauri::State;

#[cfg(mobile)]
use tauri_plugin_mobile_execution::{
    CancelRequest as MobileCancelRequest, MobileExecutionExt, RunRequest as MobileRunRequest,
};
#[cfg(mobile)]
use serde_json::json;

#[cfg(desktop)]
use crate::runtime::shell_runner::{run_shell_script, ShellRunRegistry};
use crate::runtime::shell_types::ShellRunResponse;
#[cfg(mobile)]
use crate::services::lan_pc_client::LanPcClient;
#[cfg(mobile)]
use crate::runtime::shell_types::{
    DEFAULT_SHELL_TIMEOUT_MS, MAX_SHELL_TIMEOUT_MS, MIN_SHELL_TIMEOUT_MS,
};

#[derive(Debug, Serialize)]
pub struct ShellCancelResponse {
    cancelled: bool,
}

#[tauri::command(rename_all = "snake_case")]
#[cfg(mobile)]
pub async fn shell_run(
    app: AppHandle,
    lan_pc_client: tauri::State<'_, Arc<LanPcClient>>,
    workdir: String,
    command: String,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
    max_timeout_ms: Option<u64>,
    provider_id: Option<String>,
    run_id: Option<String>,
) -> Result<ShellRunResponse, String> {
    let settings = crate::commands::settings::load_access_settings(
        &crate::commands::settings::open_db()?,
    )?;
    let run_id = run_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let maximum = max_timeout_ms
        .unwrap_or(MAX_SHELL_TIMEOUT_MS)
        .clamp(MIN_SHELL_TIMEOUT_MS, MAX_SHELL_TIMEOUT_MS);
    let effective_timeout_ms = timeout_ms
        .unwrap_or(DEFAULT_SHELL_TIMEOUT_MS)
        .clamp(MIN_SHELL_TIMEOUT_MS, maximum);

    let mut lan_fallback_error = None;
    if settings.prefer_lan_pc_execution && !settings.lan_control_url.trim().is_empty() {
        let remote_workdir = lan_pc_client
            .invoke(
                Some(&settings.lan_control_url),
                "settings_load_all",
                json!({}),
            )
            .await
            .and_then(|value| {
                value
                    .get("defaultWorkdir")
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToOwned::to_owned)
                    .ok_or_else(|| "paired LAN computer did not report a working directory".to_string())
            });
        match remote_workdir {
            Ok(remote_workdir) => {
                match lan_pc_client
                    .invoke(
                        Some(&settings.lan_control_url),
                        "shell_run",
                        json!({
                            "workdir": remote_workdir,
                            "command": &command,
                            "cwd": null,
                            "timeout_ms": effective_timeout_ms,
                            "max_timeout_ms": maximum,
                            "provider_id": provider_id.as_deref(),
                            "run_id": &run_id,
                        }),
                    )
                    .await
                    .and_then(|value| {
                        serde_json::from_value::<ShellRunResponse>(value)
                            .map_err(|error| format!("decode LAN computer shell result failed: {error}"))
                    })
                {
                    Ok(mut response) => {
                        response.profile = format!("lan-pc/{}", response.profile);
                        return Ok(response);
                    }
                    Err(error) => lan_fallback_error = Some(error),
                }
            }
            Err(error) => lan_fallback_error = Some(error),
        }
    }
    #[cfg(target_os = "android")]
    if !settings.android_proot_enabled {
        return Err("Android PRoot execution is disabled in Access settings".to_string());
    }
    #[cfg(target_os = "ios")]
    if !settings.ios_a_shell_enabled {
        return Err("iOS a-Shell execution is disabled in Access settings".to_string());
    }

    let mut response = app
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
    if let Some(error) = lan_fallback_error {
        let notice = format!(
            "LAN computer was unavailable, so XAgent used the mobile shell instead: {error}"
        );
        response.stderr = if response.stderr.trim().is_empty() {
            notice
        } else {
            format!("{notice}\n{}", response.stderr)
        };
    }
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
pub async fn shell_cancel(
    app: AppHandle,
    lan_pc_client: tauri::State<'_, Arc<LanPcClient>>,
    run_id: String,
) -> ShellCancelResponse {
    let run_id = run_id.trim().to_string();
    let settings = crate::commands::settings::open_db()
        .and_then(|connection| crate::commands::settings::load_access_settings(&connection))
        .ok();
    let remote_cancelled = if let Some(settings) = settings.filter(|settings| {
        settings.prefer_lan_pc_execution && !settings.lan_control_url.trim().is_empty()
    }) {
        lan_pc_client
            .invoke(
                Some(&settings.lan_control_url),
                "shell_cancel",
                json!({ "run_id": &run_id }),
            )
            .await
            .ok()
            .and_then(|value| value.get("cancelled").and_then(|value| value.as_bool()))
            .unwrap_or(false)
    } else {
        false
    };
    ShellCancelResponse {
        cancelled: remote_cancelled
            || app
            .mobile_execution()
            .cancel(MobileCancelRequest {
                run_id,
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
