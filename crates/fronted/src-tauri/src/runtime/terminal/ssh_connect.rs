use base64::Engine;
use russh::client;
use russh::keys::ssh_key::HashAlg;
use russh::keys::{PublicKey, PublicKeyBase64};
use std::sync::Arc;

use crate::commands::settings::{
    check_runtime_ssh_known_host, RuntimeSshHostConfig, RuntimeSshKnownHostKey,
    RuntimeSshKnownHostStatus,
};
#[cfg(test)]
pub(crate) use crate::services::ssh_proxy::SshProxyKind;

use super::*;

/// An SFTP subsystem channel opened on a terminal SSH session's connection.
/// It does not own the connection: the terminal session runtime does, and the
/// SFTP session dies with it (reconnects invalidate it via the connection id).
pub(crate) struct TerminalSftpConnection {
    pub(crate) session: russh_sftp::client::SftpSession,
}

pub(crate) struct XgentSshClient {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) captured_host_key: Arc<tokio::sync::Mutex<Option<CapturedHostKey>>>,
}

impl client::Handler for XgentSshClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let key_base64 =
            base64::engine::general_purpose::STANDARD.encode(server_public_key.public_key_bytes());
        let key = RuntimeSshKnownHostKey {
            host: self.host.clone(),
            port: self.port,
            key_type: server_public_key.algorithm().as_str().to_string(),
            key_base64,
            fingerprint_sha256: server_public_key.fingerprint(HashAlg::Sha256).to_string(),
        };
        match check_runtime_ssh_known_host(&key) {
            Ok(RuntimeSshKnownHostStatus::Known) => Ok(true),
            Ok(status) => {
                *self.captured_host_key.lock().await = Some(CapturedHostKey { key, status });
                Ok(false)
            }
            Err(error) => {
                *self.captured_host_key.lock().await = Some(CapturedHostKey {
                    key,
                    status: RuntimeSshKnownHostStatus::Changed {
                        stored_fingerprint: error,
                    },
                });
                Ok(false)
            }
        }
    }
}

pub(crate) enum ResolvedSshAuth {
    Password(String),
    PrivateKey {
        key: String,
        passphrase: Option<String>,
    },
    KeyboardInteractive,
}

pub(crate) use crate::services::ssh_transport::open_ssh_transport;
#[cfg(test)]
pub(crate) use crate::services::ssh_transport::{
    host_port_authority, resolve_effective_ssh_proxy, resolve_ssh_proxy, system_proxy_to_ssh_proxy,
    write_socks5_address,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SshPathProfile {
    Windows,
    Posix,
}

pub(crate) async fn connect_ssh_handle(
    host_config: &RuntimeSshHostConfig,
    captured_host_key: Arc<tokio::sync::Mutex<Option<CapturedHostKey>>>,
) -> Result<client::Handle<XgentSshClient>, String> {
    let ssh_client = XgentSshClient {
        host: host_config.host.clone(),
        port: host_config.port,
        captured_host_key,
    };
    let config = Arc::new(ssh_client_config());
    let stream = open_ssh_transport(host_config).await?;
    client::connect_stream(config, stream, ssh_client)
        .await
        .map_err(|error| format!("SSH connection failed: {error}"))
}

pub(crate) fn ssh_client_config() -> client::Config {
    client::Config {
        keepalive_interval: Some(SSH_KEEPALIVE_INTERVAL),
        keepalive_max: SSH_KEEPALIVE_MAX_MISSES,
        nodelay: true,
        ..Default::default()
    }
}
