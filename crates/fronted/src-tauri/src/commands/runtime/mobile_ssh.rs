use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use base64::Engine;
use russh::client;
use russh::keys::ssh_key::HashAlg;
use russh::keys::{PrivateKeyWithHashAlg, PublicKey, PublicKeyBase64};
use russh::{ChannelMsg, MethodKind};
use tokio::sync::watch;

use crate::commands::settings::{
    check_runtime_ssh_known_host, trust_runtime_ssh_known_host, RuntimeSshHostConfig,
    RuntimeSshKnownHostKey, RuntimeSshKnownHostStatus,
};
use crate::runtime::shell_types::{
    ShellRunResponse, DEFAULT_SHELL_TIMEOUT_MS, MAX_SHELL_TIMEOUT_MS, MIN_SHELL_TIMEOUT_MS,
};

const MAX_OUTPUT_BYTES: usize = 512 * 1024;
const MAX_COMMAND_BYTES: usize = 128 * 1024;

type CancelRegistry = Mutex<HashMap<String, watch::Sender<bool>>>;
static CANCEL_REGISTRY: OnceLock<CancelRegistry> = OnceLock::new();

fn cancel_registry() -> &'static CancelRegistry {
    CANCEL_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn cancel(run_id: &str) -> bool {
    cancel_registry()
        .lock()
        .ok()
        .and_then(|runs| runs.get(run_id).cloned())
        .is_some_and(|sender| sender.send(true).is_ok())
}

struct MobileSshClient {
    host: String,
    port: u16,
    host_key_error: Arc<tokio::sync::Mutex<Option<String>>>,
}

impl client::Handler for MobileSshClient {
    type Error = russh::Error;

    async fn check_server_key(&mut self, public_key: &PublicKey) -> Result<bool, Self::Error> {
        let key = RuntimeSshKnownHostKey {
            host: self.host.clone(),
            port: self.port,
            key_type: public_key.algorithm().as_str().to_string(),
            key_base64: base64::engine::general_purpose::STANDARD
                .encode(public_key.public_key_bytes()),
            fingerprint_sha256: public_key.fingerprint(HashAlg::Sha256).to_string(),
        };
        let decision = match check_runtime_ssh_known_host(&key) {
            Ok(RuntimeSshKnownHostStatus::Known) => return Ok(true),
            // The previous mobile OpenSSH runner used StrictHostKeyChecking=accept-new.
            // Preserve that first-use policy in the shared known-host database.
            Ok(RuntimeSshKnownHostStatus::Unknown) => trust_runtime_ssh_known_host(&key),
            Ok(RuntimeSshKnownHostStatus::Changed { stored_fingerprint }) => Err(format!(
                "SSH host key changed for {}:{} (previously {stored_fingerprint})",
                self.host, self.port
            )),
            Err(error) => Err(error),
        };
        if let Err(error) = decision {
            *self.host_key_error.lock().await = Some(error);
            return Ok(false);
        }
        Ok(true)
    }
}

async fn keyboard_interactive(
    handle: &mut client::Handle<MobileSshClient>,
    username: &str,
    answer: &str,
) -> Result<(), String> {
    let mut response = handle
        .authenticate_keyboard_interactive_start(username, None::<String>)
        .await
        .map_err(|error| format!("SSH keyboard-interactive authentication failed: {error}"))?;
    let mut answered = false;
    for _ in 0..5 {
        response = match response {
            client::KeyboardInteractiveAuthResponse::Success => return Ok(()),
            client::KeyboardInteractiveAuthResponse::Failure { remaining_methods, .. } => {
                if !answered && remaining_methods.contains(&MethodKind::Password) {
                    let result = handle
                        .authenticate_password(username, answer)
                        .await
                        .map_err(|error| format!("SSH password authentication failed: {error}"))?;
                    if result.success() {
                        return Ok(());
                    }
                }
                return Err("SSH keyboard-interactive authentication failed".to_string());
            }
            client::KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => {
                let answers = if prompts.is_empty() {
                    Vec::new()
                } else if prompts.len() == 1 && !answered && !answer.is_empty() {
                    answered = true;
                    vec![answer.to_string()]
                } else {
                    return Err("SSH requires another keyboard-interactive answer".to_string());
                };
                handle
                    .authenticate_keyboard_interactive_respond(answers)
                    .await
                    .map_err(|error| format!("SSH keyboard-interactive response failed: {error}"))?
            }
        };
    }
    Err("SSH keyboard-interactive exceeded five prompt rounds".to_string())
}

async fn authenticate(
    handle: &mut client::Handle<MobileSshClient>,
    host: &RuntimeSshHostConfig,
    workdir: &str,
    keyboard_response: Option<&str>,
) -> Result<(), String> {
    let username = host.username.trim();
    if username.is_empty() {
        return Err("SSH username is empty".to_string());
    }
    match host.auth_type.as_str() {
        "privateKey" => {
            let material = if host.private_key.trim().is_empty() {
                super::shell::read_mobile_ssh_private_key(workdir, &host.private_key_path)?
            } else {
                host.private_key.clone()
            };
            let key_pair = russh::keys::decode_secret_key(
                material.trim(),
                (!host.private_key_passphrase.is_empty())
                    .then_some(host.private_key_passphrase.as_str()),
            )
            .map_err(|error| format!("Invalid SSH private key: {error}"))?;
            let hash_alg = if key_pair.algorithm().is_rsa() {
                handle
                    .best_supported_rsa_hash()
                    .await
                    .map_err(|error| format!("SSH RSA negotiation failed: {error}"))?
                    .unwrap_or(Some(HashAlg::Sha256))
            } else {
                None
            };
            let result = handle
                .authenticate_publickey(
                    username,
                    PrivateKeyWithHashAlg::new(Arc::new(key_pair), hash_alg),
                )
                .await
                .map_err(|error| format!("SSH private key authentication failed: {error}"))?;
            if result.success() {
                Ok(())
            } else {
                Err("SSH private key authentication failed".to_string())
            }
        }
        "keyboardInteractive" => {
            let answer = keyboard_response.unwrap_or_default();
            if answer.is_empty() {
                return Err("SSH keyboard-interactive answer is required".to_string());
            }
            keyboard_interactive(handle, username, answer).await
        }
        "password" => {
            if host.password.is_empty() {
                return Err("SSH password is not configured".to_string());
            }
            let result = handle
                .authenticate_password(username, host.password.as_str())
                .await
                .map_err(|error| format!("SSH password authentication failed: {error}"))?;
            if result.success() {
                Ok(())
            } else if matches!(
                result,
                client::AuthResult::Failure { remaining_methods, .. }
                    if remaining_methods.contains(&MethodKind::KeyboardInteractive)
            ) {
                keyboard_interactive(handle, username, &host.password).await
            } else {
                Err("SSH password authentication failed".to_string())
            }
        }
        _ => Err("Unsupported SSH authentication type".to_string()),
    }
}

fn append_capped(output: &mut Vec<u8>, bytes: &[u8]) -> bool {
    let remaining = MAX_OUTPUT_BYTES.saturating_sub(output.len());
    output.extend_from_slice(&bytes[..bytes.len().min(remaining)]);
    bytes.len() > remaining
}

async fn execute_command(
    host: RuntimeSshHostConfig,
    workdir: String,
    command: String,
    keyboard_response: Option<String>,
) -> Result<(String, String, i32, bool, bool), String> {
    if host.host.trim().is_empty() || host.port == 0 {
        return Err("SSH host and port are required".to_string());
    }
    if host.proxy.use_system_proxy
        || !host.proxy.url.trim().is_empty()
        || host.proxy.port > 0
        || !host.proxy.username.trim().is_empty()
        || host.proxy.password_configured
    {
        return Err("This SSH host uses a proxy; direct mobile SSH requires a direct host".to_string());
    }
    let host_key_error = Arc::new(tokio::sync::Mutex::new(None));
    let handler = MobileSshClient {
        host: host.host.clone(),
        port: host.port,
        host_key_error: Arc::clone(&host_key_error),
    };
    let config = Arc::new(client::Config::default());
    let mut handle = match client::connect(config, (host.host.as_str(), host.port), handler).await {
        Ok(handle) => handle,
        Err(error) => {
            return Err(host_key_error
                .lock()
                .await
                .take()
                .unwrap_or_else(|| format!("SSH connection failed: {error}")))
        }
    };
    authenticate(&mut handle, &host, &workdir, keyboard_response.as_deref()).await?;
    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|error| format!("SSH session failed: {error}"))?;
    channel
        .exec(true, command)
        .await
        .map_err(|error| format!("SSH command failed: {error}"))?;
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut stdout_truncated = false;
    let mut stderr_truncated = false;
    let mut exit_code = 255;
    while let Some(message) = channel.wait().await {
        match message {
            ChannelMsg::Data { data } => stdout_truncated |= append_capped(&mut stdout, &data),
            ChannelMsg::ExtendedData { data, ext: 1 } => {
                stderr_truncated |= append_capped(&mut stderr, &data)
            }
            ChannelMsg::ExitStatus { exit_status } => {
                exit_code = i32::try_from(exit_status).unwrap_or(255)
            }
            ChannelMsg::Close => break,
            _ => {}
        }
    }
    let _ = handle
        .disconnect(russh::Disconnect::ByApplication, "Command finished", "en")
        .await;
    Ok((
        String::from_utf8_lossy(&stdout).into_owned(),
        String::from_utf8_lossy(&stderr).into_owned(),
        exit_code,
        stdout_truncated,
        stderr_truncated,
    ))
}

pub(crate) async fn run(
    host: RuntimeSshHostConfig,
    workdir: String,
    remote_command: String,
    keyboard_response: Option<String>,
    timeout_ms: Option<u64>,
    run_id: String,
) -> Result<ShellRunResponse, String> {
    let command = remote_command.trim().to_string();
    if command.is_empty() || command.len() > MAX_COMMAND_BYTES {
        return Err("SSH command must contain 1 to 131072 bytes".to_string());
    }
    let effective_timeout_ms = timeout_ms
        .unwrap_or(DEFAULT_SHELL_TIMEOUT_MS)
        .clamp(MIN_SHELL_TIMEOUT_MS, MAX_SHELL_TIMEOUT_MS);
    let (sender, mut cancel_receiver) = watch::channel(false);
    {
        let mut runs = cancel_registry()
            .lock()
            .map_err(|_| "SSH cancellation registry is unavailable".to_string())?;
        if runs.contains_key(&run_id) {
            return Err("SSH run ID is already active".to_string());
        }
        runs.insert(run_id.clone(), sender);
    }
    let started = Instant::now();
    let outcome = tokio::select! {
        result = execute_command(host, workdir, command, keyboard_response) => result.map(Some),
        _ = cancel_receiver.changed() => Ok(None),
        _ = tokio::time::sleep(Duration::from_millis(effective_timeout_ms)) => {
            Err("SSH command timed out".to_string())
        }
    };
    if let Ok(mut runs) = cancel_registry().lock() {
        runs.remove(&run_id);
    }
    let timed_out = matches!(&outcome, Err(error) if error == "SSH command timed out");
    let cancelled = matches!(&outcome, Ok(None));
    let (stdout, stderr, exit_code, stdout_truncated, stderr_truncated) = match outcome {
        Ok(Some(output)) => output,
        Ok(None) => (String::new(), String::new(), -1, false, false),
        Err(error) if timed_out => (String::new(), error, -1, false, false),
        Err(error) => return Err(error),
    };
    Ok(ShellRunResponse {
        exit_code,
        shell: "ssh".to_string(),
        platform: if cfg!(target_os = "ios") {
            "ios"
        } else {
            "android"
        }
        .to_string(),
        profile: "native-ssh".to_string(),
        shell_family: "ssh".to_string(),
        sandbox: None,
        stdout,
        stderr,
        stdout_truncated,
        stderr_truncated,
        timed_out,
        cancelled,
        stdio_open_after_exit: false,
        effective_timeout_ms,
        duration_ms: started.elapsed().as_millis(),
    })
}
