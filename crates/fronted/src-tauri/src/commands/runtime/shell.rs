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
#[cfg(mobile)]
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
#[cfg(mobile)]
use std::path::{Path, PathBuf};

#[cfg(desktop)]
use crate::runtime::sandbox::{resolve_effective_options, SandboxOptions};
#[cfg(desktop)]
use crate::runtime::shell_runner::{run_shell_script_with_envs, ShellRunRegistry};
#[cfg(desktop)]
use crate::runtime::shell_session::{ShellSessionManager, ShellSessionResponse};
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

#[cfg(mobile)]
pub(crate) struct MobileShellRunInput {
    pub workdir: String,
    pub command: String,
    pub cwd: Option<String>,
    pub timeout_ms: Option<u64>,
    pub max_timeout_ms: Option<u64>,
    pub provider_id: Option<String>,
    pub run_id: Option<String>,
}

#[cfg(mobile)]
fn mobile_shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(mobile)]
fn read_mobile_ssh_private_key(workdir: &str, configured_path: &str) -> Result<String, String> {
    let configured_path = configured_path.trim();
    if configured_path.is_empty() {
        return Ok(String::new());
    }
    let path = Path::new(configured_path);
    let resolved: PathBuf = if path.is_absolute() {
        path.to_path_buf()
    } else {
        Path::new(workdir).join(path)
    };
    std::fs::read_to_string(&resolved)
        .map_err(|error| format!("read SSH private key {} failed: {error}", resolved.display()))
}

#[cfg(mobile)]
fn encoded_shell_file(path: &str, content: &str, executable: bool) -> String {
    let encoded = BASE64_STANDARD.encode(content.as_bytes());
    let chmod = if executable { "chmod 700" } else { "chmod 600" };
    format!(
        "printf %s {} | base64 -d > {}; {} {}",
        mobile_shell_quote(&encoded),
        path,
        chmod,
        path,
    )
}

#[cfg(mobile)]
fn build_mobile_ssh_command(
    workdir: &str,
    host: &crate::commands::settings::RuntimeSshHostConfig,
    remote_command: &str,
    run_id: &str,
    keyboard_response: Option<&str>,
) -> Result<String, String> {
    let endpoint = if host.username.trim().is_empty() {
        host.host.trim().to_string()
    } else {
        format!("{}@{}", host.username.trim(), host.host.trim())
    };
    if endpoint.trim().is_empty() {
        return Err("SSH host is empty".to_string());
    }
    let remote_command = remote_command.trim();
    if remote_command.is_empty() {
        return Err("A remote command is required for mobile SSH execution".to_string());
    }
    if remote_command.len() > 128 * 1024 {
        return Err("The remote SSH command is too large".to_string());
    }

    let safe_run_id: String = run_id
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
        .take(96)
        .collect();
    let temp_root = format!("$PWD/.xagent-tmp/ssh-{}", safe_run_id);
    let temp_dir = format!("\"{temp_root}\"");
    let key_path = format!("\"{temp_root}/key\"");
    let askpass_path = format!("\"{temp_root}/askpass\"");
    let known_hosts_dir = "\"$PWD/.xagent-ssh\"";
    let known_hosts = "\"$PWD/.xagent-ssh/known_hosts\"";
    let mut setup = vec![
        "umask 077".to_string(),
        format!("mkdir -p {temp_dir} {known_hosts_dir}"),
        format!("trap 'rm -rf {temp_dir}' EXIT HUP INT TERM"),
    ];
    let mut options = vec![
        "-o ConnectTimeout=15".to_string(),
        "-o ServerAliveInterval=15".to_string(),
        "-o ServerAliveCountMax=2".to_string(),
        "-o StrictHostKeyChecking=accept-new".to_string(),
        format!("-o UserKnownHostsFile={known_hosts}"),
        format!("-p {}", host.port),
    ];

    let proxy_url = host.proxy.url.trim();
    if !proxy_url.is_empty() || host.proxy.port > 0 {
        let proxy = crate::services::ssh_proxy::resolve_ssh_proxy_endpoint(
            proxy_url,
            &host.proxy.proxy_type,
            host.proxy.port,
        )?;
        if host.proxy.password_configured || !host.proxy.password.trim().is_empty() {
            return Err("Password-authenticated SSH proxies are not supported by the mobile command runner".to_string());
        }
        let proxy_kind = match proxy.kind {
            crate::services::ssh_proxy::SshProxyKind::Http => "connect",
            crate::services::ssh_proxy::SshProxyKind::Socks5 => "5",
        };
        let proxy_user = if host.proxy.username.trim().is_empty() {
            String::new()
        } else {
            format!(" -P {}", mobile_shell_quote(host.proxy.username.trim()))
        };
        let proxy_command = format!(
            "nc -X {proxy_kind} -x {}:{}{proxy_user} %h %p",
            proxy.host, proxy.port
        );
        options.push(format!("-o ProxyCommand={}", mobile_shell_quote(&proxy_command)));
    }

    let mut environment = String::new();
    match host.auth_type.as_str() {
        "privateKey" => {
            let key = if host.private_key.trim().is_empty() {
                read_mobile_ssh_private_key(workdir, &host.private_key_path)?
            } else {
                host.private_key.clone()
            };
            if key.trim().is_empty() {
                return Err("The selected SSH host has no private key".to_string());
            }
            setup.push(encoded_shell_file(&key_path, &key, false));
            options.push("-o IdentitiesOnly=yes".to_string());
            options.push(format!("-i {key_path}"));
            if !host.private_key_passphrase.is_empty() {
                let askpass = format!(
                    "#!/bin/sh\nprintf '%s\\n' {}\n",
                    mobile_shell_quote(&host.private_key_passphrase)
                );
                setup.push(encoded_shell_file(
                    &askpass_path,
                    &askpass,
                    true,
                ));
                environment = format!(
                    "SSH_ASKPASS={askpass_path} SSH_ASKPASS_REQUIRE=force DISPLAY=x "
                );
            } else {
                options.push("-o BatchMode=yes".to_string());
            }
        }
        "password" => {
            if host.password.is_empty() {
                return Err("The selected SSH host has no saved password".to_string());
            }
            let askpass = format!(
                "#!/bin/sh\nprintf '%s\\n' {}\n",
                mobile_shell_quote(&host.password)
            );
            setup.push(encoded_shell_file(
                &askpass_path,
                &askpass,
                true,
            ));
            options.push("-o PreferredAuthentications=password".to_string());
            environment = format!(
                "SSH_ASKPASS={askpass_path} SSH_ASKPASS_REQUIRE=force DISPLAY=x "
            );
        }
        "keyboardInteractive" => {
            let response = keyboard_response.map(str::trim).unwrap_or_default();
            if response.is_empty() {
                return Err("A keyboard-interactive response is required".to_string());
            }
            let askpass = format!(
                "#!/bin/sh\nprintf '%s\\n' {}\n",
                mobile_shell_quote(response)
            );
            setup.push(encoded_shell_file(&askpass_path, &askpass, true));
            options.push(
                "-o PreferredAuthentications=keyboard-interactive,password".to_string(),
            );
            options.push("-o KbdInteractiveAuthentication=yes".to_string());
            environment = format!(
                "SSH_ASKPASS={askpass_path} SSH_ASKPASS_REQUIRE=force DISPLAY=x "
            );
        }
        other => return Err(format!("Unsupported SSH authentication method: {other}")),
    }

    let execute = format!(
        "{environment}ssh {} -- {} {} </dev/null",
        options.join(" "),
        mobile_shell_quote(&endpoint),
        mobile_shell_quote(remote_command),
    );
    setup.push(execute);
    Ok(setup.join("\n"))
}

#[cfg(mobile)]
pub(crate) async fn run_mobile_shell(
    app: AppHandle,
    lan_pc_client: &LanPcClient,
    input: MobileShellRunInput,
) -> Result<ShellRunResponse, String> {
    let MobileShellRunInput {
        workdir,
        command,
        cwd,
        timeout_ms,
        max_timeout_ms,
        provider_id,
        run_id,
    } = input;

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
    sandbox: bool,
    sandbox_allow_network: bool,
) -> Result<ShellRunResponse, String> {
    run_mobile_shell(
        app,
        lan_pc_client.inner(),
        MobileShellRunInput {
            workdir,
            command,
            cwd,
            timeout_ms,
            max_timeout_ms,
            provider_id,
            run_id,
        },
    )
    .await
}

#[tauri::command(rename_all = "snake_case")]
#[cfg(mobile)]
pub async fn mobile_ssh_exec(
    app: AppHandle,
    lan_pc_client: tauri::State<'_, Arc<LanPcClient>>,
    host_id: String,
    workdir: String,
    remote_command: String,
    keyboard_response: Option<String>,
    timeout_ms: Option<u64>,
    run_id: Option<String>,
) -> Result<ShellRunResponse, String> {
    let host = crate::commands::settings::load_runtime_ssh_host(&host_id)?
        .ok_or_else(|| format!("SSH host not found: {}", host_id.trim()))?;
    let normalized_run_id = run_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let command = build_mobile_ssh_command(
        &workdir,
        &host,
        &remote_command,
        &normalized_run_id,
        keyboard_response.as_deref(),
    )?;
    run_mobile_shell(
        app,
        lan_pc_client.inner(),
        MobileShellRunInput {
            workdir,
            command,
            cwd: None,
            timeout_ms,
            max_timeout_ms: Some(MAX_SHELL_TIMEOUT_MS),
            provider_id: None,
            run_id: Some(normalized_run_id),
        },
    )
    .await
}

/// Cancels any run registered in the shared `ShellRunRegistry` — shell
/// commands, MCP tool calls, and SSH exec all park their cancel tokens there.
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
    sandbox: Option<bool>,
    sandbox_allow_network: Option<bool>,
) -> Result<ShellRunResponse, String> {
    let _ = app;
    let sandbox_options = resolve_effective_options(sandbox.unwrap_or(false).then_some(
        SandboxOptions {
            allow_network: sandbox_allow_network.unwrap_or(false),
        },
    ))?;
    let normalized_run_id = run_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let cancel_token = normalized_run_id.as_deref().map(|id| registry.register(id));
    let registered_token = cancel_token.clone();

    let join_result = tauri::async_runtime::spawn_blocking(move || {
        run_shell_script_with_envs(
            workdir,
            command,
            cwd,
            timeout_ms,
            max_timeout_ms,
            provider_id,
            cancel_token,
            &[],
            sandbox_options,
        )
    })
    .await;

    if let (Some(run_id), Some(token)) = (normalized_run_id.as_deref(), registered_token.as_ref()) {
        registry.unregister(run_id, token);
    }

    join_result.map_err(|e| format!("shell_run join failed: {e}"))?
}

#[tauri::command(rename_all = "snake_case")]
#[cfg(mobile)]
pub async fn shell_cancel(
    app: AppHandle,
    lan_pc_client: tauri::State<'_, Arc<LanPcClient>>,
    run_id: String,
) -> Result<ShellCancelResponse, String> {
    // Own the managed state before the first await so Tauri's command future never retains an
    // IPC-message borrow. This is required by mobile archive builds where commands are `Send +
    // 'static`.
    let lan_pc_client = Arc::clone(lan_pc_client.inner());
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
    Ok(ShellCancelResponse {
        cancelled: remote_cancelled
            || app
            .mobile_execution()
            .cancel(MobileCancelRequest {
                run_id,
            })
            .map(|response| response.cancelled)
            .unwrap_or(false),
    })
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

#[tauri::command(rename_all = "snake_case")]
#[cfg(desktop)]
pub fn runtime_cancel(
    registry: State<'_, Arc<ShellRunRegistry>>,
    run_id: String,
) -> ShellCancelResponse {
    ShellCancelResponse {
        cancelled: registry.cancel(run_id.trim()),
    }
}

#[allow(clippy::too_many_arguments)]
#[tauri::command(rename_all = "snake_case")]
#[cfg(desktop)]
pub async fn shell_session_start(
    manager: State<'_, Arc<ShellSessionManager>>,
    session_id: String,
    workdir: String,
    command: String,
    cwd: Option<String>,
    yield_time_ms: Option<u64>,
    timeout_ms: Option<u64>,
    max_timeout_ms: Option<u64>,
    sandbox: Option<bool>,
    sandbox_allow_network: Option<bool>,
) -> Result<ShellSessionResponse, String> {
    let manager = Arc::clone(manager.inner());
    let sandbox_options = resolve_effective_options(sandbox.unwrap_or(false).then_some(
        SandboxOptions {
            allow_network: sandbox_allow_network.unwrap_or(false),
        },
    ))?;
    tauri::async_runtime::spawn_blocking(move || {
        manager.start(
            session_id,
            workdir,
            command,
            cwd,
            yield_time_ms,
            timeout_ms,
            max_timeout_ms,
            sandbox_options,
        )
    })
    .await
    .map_err(|error| format!("shell_session_start join failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
#[cfg(desktop)]
pub async fn shell_session_wait(
    manager: State<'_, Arc<ShellSessionManager>>,
    session_id: String,
    cursor: Option<u64>,
    yield_time_ms: Option<u64>,
) -> Result<ShellSessionResponse, String> {
    let manager = Arc::clone(manager.inner());
    tauri::async_runtime::spawn_blocking(move || manager.wait(&session_id, cursor, yield_time_ms))
        .await
        .map_err(|error| format!("shell_session_wait join failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
#[cfg(desktop)]
pub async fn shell_session_stop(
    manager: State<'_, Arc<ShellSessionManager>>,
    session_id: String,
    cursor: Option<u64>,
) -> Result<ShellSessionResponse, String> {
    let manager = Arc::clone(manager.inner());
    tauri::async_runtime::spawn_blocking(move || manager.stop(&session_id, cursor))
        .await
        .map_err(|error| format!("shell_session_stop join failed: {error}"))?
}
