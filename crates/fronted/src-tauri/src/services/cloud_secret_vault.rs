use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri_plugin_stronghold::stronghold::Stronghold;
use uuid::Uuid;

const VAULT_FILENAME: &str = "cloud-secrets.device.hold";
const DEVICE_KEY_FILENAME: &str = "cloud-secrets.device.key";
const VAULT_CLIENT_ID: &[u8] = b"xgent.cloud-execution";
const GITHUB_TOKEN_KEY: &[u8] = b"github.personal-access-token";
const GITHUB_USERNAME_KEY: &[u8] = b"github.username";
const DEVICE_KEY_BYTES: usize = 32;

/// Device-protected cloud credentials that are ready whenever the application
/// is running. The random Stronghold key is generated once inside the private
/// application data directory; no recoverable user passphrase is required.
pub struct CloudSecretVault {
    stronghold: Mutex<Stronghold>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudSecretVaultStatus {
    pub github_token_configured: bool,
    pub github_username: Option<String>,
}

impl CloudSecretVault {
    pub fn new(app_data_dir: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&app_data_dir)
            .map_err(|error| format!("create cloud secret directory failed: {error}"))?;
        let snapshot_path = app_data_dir.join(VAULT_FILENAME);
        let key = load_or_create_device_key(&app_data_dir.join(DEVICE_KEY_FILENAME))?;
        let snapshot_exists = snapshot_path.exists();
        let stronghold = Stronghold::new(&snapshot_path, key)
            .map_err(|error| format!("open device-protected cloud credentials failed: {error}"))?;
        if snapshot_exists {
            stronghold
                .load_client(VAULT_CLIENT_ID)
                .map_err(|error| format!("load cloud credential client failed: {error}"))?;
        } else {
            stronghold
                .create_client(VAULT_CLIENT_ID)
                .map_err(|error| format!("create cloud credential client failed: {error}"))?;
            stronghold
                .save()
                .map_err(|error| format!("initialize cloud credentials failed: {error}"))?;
        }
        Ok(Self {
            stronghold: Mutex::new(stronghold),
        })
    }

    pub fn status(&self) -> Result<CloudSecretVaultStatus, String> {
        let stronghold = self
            .stronghold
            .lock()
            .map_err(|_| "cloud credential lock poisoned".to_string())?;
        let store = stronghold
            .get_client(VAULT_CLIENT_ID)
            .map_err(|error| format!("open cloud credential client failed: {error}"))?
            .store();
        let github_token_configured = store
            .get(GITHUB_TOKEN_KEY)
            .map_err(|error| format!("read GitHub token status failed: {error}"))?
            .is_some();
        let github_username = store
            .get(GITHUB_USERNAME_KEY)
            .map_err(|error| format!("read GitHub username failed: {error}"))?
            .map(String::from_utf8)
            .transpose()
            .map_err(|_| "stored GitHub username is not valid UTF-8".to_string())?;
        Ok(CloudSecretVaultStatus {
            github_token_configured,
            github_username,
        })
    }

    pub fn set_github_token(
        &self,
        username: &str,
        token: &str,
    ) -> Result<CloudSecretVaultStatus, String> {
        let username = validate_github_username(username)?;
        let token = token.trim();
        if token.is_empty() {
            return Err("GitHub token cannot be empty".to_string());
        }
        let stronghold = self
            .stronghold
            .lock()
            .map_err(|_| "cloud credential lock poisoned".to_string())?;
        let store = stronghold
            .get_client(VAULT_CLIENT_ID)
            .map_err(|error| format!("open cloud credential client failed: {error}"))?
            .store();
        store
            .insert(
                GITHUB_USERNAME_KEY.to_vec(),
                username.as_bytes().to_vec(),
                None,
            )
            .map_err(|error| format!("store GitHub username failed: {error}"))?;
        store
            .insert(GITHUB_TOKEN_KEY.to_vec(), token.as_bytes().to_vec(), None)
            .map_err(|error| format!("store GitHub token failed: {error}"))?;
        stronghold
            .save()
            .map_err(|error| format!("save cloud credentials failed: {error}"))?;
        drop(stronghold);
        self.status()
    }

    pub fn remove_github_token(&self) -> Result<CloudSecretVaultStatus, String> {
        let stronghold = self
            .stronghold
            .lock()
            .map_err(|_| "cloud credential lock poisoned".to_string())?;
        let store = stronghold
            .get_client(VAULT_CLIENT_ID)
            .map_err(|error| format!("open cloud credential client failed: {error}"))?
            .store();
        store
            .delete(GITHUB_TOKEN_KEY)
            .map_err(|error| format!("remove GitHub token failed: {error}"))?;
        store
            .delete(GITHUB_USERNAME_KEY)
            .map_err(|error| format!("remove GitHub username failed: {error}"))?;
        stronghold
            .save()
            .map_err(|error| format!("save cloud credentials failed: {error}"))?;
        drop(stronghold);
        self.status()
    }

    /// Returns the credential only to native services that construct an
    /// authenticated GitHub request. It is never exposed as a Tauri command.
    pub fn github_token(&self) -> Result<String, String> {
        let stronghold = self
            .stronghold
            .lock()
            .map_err(|_| "cloud credential lock poisoned".to_string())?;
        let value = stronghold
            .get_client(VAULT_CLIENT_ID)
            .map_err(|error| format!("open cloud credential client failed: {error}"))?
            .store()
            .get(GITHUB_TOKEN_KEY)
            .map_err(|error| format!("read GitHub token failed: {error}"))?
            .ok_or_else(|| "GitHub token is not configured".to_string())?;
        String::from_utf8(value).map_err(|_| "stored GitHub token is not valid UTF-8".to_string())
    }

    /// Stores an opaque credential payload for another native service. These
    /// helpers deliberately remain crate-private so secret material cannot be
    /// exposed through a Tauri command by accident.
    pub(crate) fn set_namespaced_secret(&self, key: &[u8], value: &[u8]) -> Result<(), String> {
        if key.is_empty() {
            return Err("credential namespace cannot be empty".to_string());
        }
        let stronghold = self
            .stronghold
            .lock()
            .map_err(|_| "cloud credential lock poisoned".to_string())?;
        stronghold
            .get_client(VAULT_CLIENT_ID)
            .map_err(|error| format!("open cloud credential client failed: {error}"))?
            .store()
            .insert(key.to_vec(), value.to_vec(), None)
            .map_err(|error| format!("store protected credential failed: {error}"))?;
        stronghold
            .save()
            .map_err(|error| format!("save protected credential failed: {error}"))
    }

    pub(crate) fn namespaced_secret(&self, key: &[u8]) -> Result<Option<Vec<u8>>, String> {
        if key.is_empty() {
            return Err("credential namespace cannot be empty".to_string());
        }
        self.stronghold
            .lock()
            .map_err(|_| "cloud credential lock poisoned".to_string())?
            .get_client(VAULT_CLIENT_ID)
            .map_err(|error| format!("open cloud credential client failed: {error}"))?
            .store()
            .get(key)
            .map_err(|error| format!("read protected credential failed: {error}"))
    }

    pub(crate) fn remove_namespaced_secret(&self, key: &[u8]) -> Result<(), String> {
        if key.is_empty() {
            return Err("credential namespace cannot be empty".to_string());
        }
        let stronghold = self
            .stronghold
            .lock()
            .map_err(|_| "cloud credential lock poisoned".to_string())?;
        stronghold
            .get_client(VAULT_CLIENT_ID)
            .map_err(|error| format!("open cloud credential client failed: {error}"))?
            .store()
            .delete(key)
            .map_err(|error| format!("remove protected credential failed: {error}"))?;
        stronghold
            .save()
            .map_err(|error| format!("save protected credential failed: {error}"))
    }
}

fn validate_github_username(value: &str) -> Result<String, String> {
    let username = value.trim();
    if username.is_empty() || username.len() > 100 {
        return Err("GitHub username or organization must contain 1 to 100 characters".to_string());
    }
    if !username
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-')
        || username.starts_with('-')
        || username.ends_with('-')
    {
        return Err(
            "GitHub username or organization may contain letters, numbers, and inner hyphens"
                .to_string(),
        );
    }
    Ok(username.to_string())
}

fn load_or_create_device_key(path: &Path) -> Result<Vec<u8>, String> {
    match fs::read(path) {
        Ok(key) => return validate_device_key(key),
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(format!("read cloud credential device key failed: {error}")),
    }

    let mut key = Vec::with_capacity(DEVICE_KEY_BYTES);
    key.extend_from_slice(Uuid::new_v4().as_bytes());
    key.extend_from_slice(Uuid::new_v4().as_bytes());
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    match options.open(path) {
        Ok(mut file) => {
            file.write_all(&key)
                .and_then(|_| file.sync_all())
                .map_err(|error| format!("write cloud credential device key failed: {error}"))?;
            restrict_device_key_permissions(path)?;
            Ok(key)
        }
        Err(error) if error.kind() == ErrorKind::AlreadyExists => {
            validate_device_key(
                fs::read(path)
                    .map_err(|read_error| format!("read cloud credential device key failed: {read_error}"))?,
            )
        }
        Err(error) => Err(format!("create cloud credential device key failed: {error}")),
    }
}

fn validate_device_key(key: Vec<u8>) -> Result<Vec<u8>, String> {
    if key.len() != DEVICE_KEY_BYTES {
        return Err("cloud credential device key has an invalid length".to_string());
    }
    Ok(key)
}

#[cfg(unix)]
fn restrict_device_key_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("protect cloud credential device key failed: {error}"))
}

#[cfg(not(unix))]
fn restrict_device_key_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_vault_reopens_without_a_passphrase() {
        let directory = tempfile::tempdir().expect("temp dir");
        {
            let vault = CloudSecretVault::new(directory.path().to_path_buf()).expect("new vault");
            let status = vault
                .set_github_token("xgent-user", "github_pat_test")
                .expect("save token");
            assert_eq!(status.github_username.as_deref(), Some("xgent-user"));
            assert!(status.github_token_configured);
        }

        let reopened =
            CloudSecretVault::new(directory.path().to_path_buf()).expect("reopen vault");
        assert_eq!(
            reopened.github_token().expect("read saved token"),
            "github_pat_test"
        );
    }

    #[test]
    fn github_username_validation_rejects_path_like_values() {
        assert!(validate_github_username("owner-name").is_ok());
        assert!(validate_github_username("../owner").is_err());
        assert!(validate_github_username("-owner").is_err());
    }
}
