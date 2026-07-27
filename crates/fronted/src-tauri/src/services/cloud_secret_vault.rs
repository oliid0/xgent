use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use argon2::Argon2;
use serde::Serialize;
use tauri_plugin_stronghold::stronghold::Stronghold;
use uuid::Uuid;

const VAULT_FILENAME: &str = "cloud-secrets.hold";
const VAULT_SALT_FILENAME: &str = "cloud-secrets.salt";
const VAULT_CLIENT_ID: &[u8] = b"xagent.cloud-execution";
const GITHUB_TOKEN_KEY: &[u8] = b"github.personal-access-token";

/// An encrypted, explicitly unlocked store for cloud credentials.
///
/// The passphrase is never persisted. The Stronghold snapshot stays locked at
/// startup and after an explicit lock; cloud execution must therefore be
/// authorized for the current app session before a token can be used.
pub struct CloudSecretVault {
    snapshot_path: PathBuf,
    salt_path: PathBuf,
    unlocked: Mutex<Option<Stronghold>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudSecretVaultStatus {
    pub configured: bool,
    pub unlocked: bool,
    pub github_token_configured: bool,
}

impl CloudSecretVault {
    pub fn new(app_data_dir: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&app_data_dir)
            .map_err(|error| format!("create cloud secret directory failed: {error}"))?;
        Ok(Self {
            snapshot_path: app_data_dir.join(VAULT_FILENAME),
            salt_path: app_data_dir.join(VAULT_SALT_FILENAME),
            unlocked: Mutex::new(None),
        })
    }

    pub fn status(&self) -> Result<CloudSecretVaultStatus, String> {
        let unlocked = self
            .unlocked
            .lock()
            .map_err(|_| "cloud secret vault lock poisoned".to_string())?;
        let github_token_configured = unlocked
            .as_ref()
            .map(|vault| {
                vault
                    .get_client(VAULT_CLIENT_ID)
                    .map_err(|error| format!("open cloud secret vault client failed: {error}"))?
                    .store()
                    .get(GITHUB_TOKEN_KEY)
                    .map(|value| value.is_some())
                    .map_err(|error| format!("read cloud secret vault status failed: {error}"))
            })
            .transpose()?
            .unwrap_or(false);
        Ok(CloudSecretVaultStatus {
            configured: self.snapshot_path.exists(),
            unlocked: unlocked.is_some(),
            github_token_configured,
        })
    }

    pub fn unlock(&self, passphrase: &str) -> Result<CloudSecretVaultStatus, String> {
        if passphrase.chars().count() < 12 {
            return Err("cloud secret vault passphrase must contain at least 12 characters".into());
        }
        let salt = load_or_create_salt(&self.salt_path)?;
        let mut key = vec![0_u8; 32];
        Argon2::default()
            .hash_password_into(passphrase.as_bytes(), &salt, &mut key)
            .map_err(|error| format!("derive cloud secret vault key failed: {error}"))?;
        let snapshot_exists = self.snapshot_path.exists();
        let vault = Stronghold::new(&self.snapshot_path, key)
            .map_err(|error| format!("unlock cloud secret vault failed: {error}"))?;
        if snapshot_exists {
            vault
                .load_client(VAULT_CLIENT_ID)
                .map_err(|error| format!("load cloud secret vault client failed: {error}"))?;
        } else {
            vault
                .create_client(VAULT_CLIENT_ID)
                .map_err(|error| format!("create cloud secret vault client failed: {error}"))?;
            vault
                .save()
                .map_err(|error| format!("initialize cloud secret vault failed: {error}"))?;
        }
        let mut unlocked = self
            .unlocked
            .lock()
            .map_err(|_| "cloud secret vault lock poisoned".to_string())?;
        *unlocked = Some(vault);
        drop(unlocked);
        self.status()
    }

    pub fn lock(&self) -> Result<CloudSecretVaultStatus, String> {
        let mut unlocked = self
            .unlocked
            .lock()
            .map_err(|_| "cloud secret vault lock poisoned".to_string())?;
        *unlocked = None;
        drop(unlocked);
        self.status()
    }

    pub fn set_github_token(&self, token: &str) -> Result<CloudSecretVaultStatus, String> {
        let token = token.trim();
        if token.is_empty() {
            return Err("GitHub token cannot be empty".to_string());
        }
        let unlocked = self
            .unlocked
            .lock()
            .map_err(|_| "cloud secret vault lock poisoned".to_string())?;
        let vault = unlocked
            .as_ref()
            .ok_or_else(|| "cloud secret vault is locked".to_string())?;
        vault
            .get_client(VAULT_CLIENT_ID)
            .map_err(|error| format!("open cloud secret vault client failed: {error}"))?
            .store()
            .insert(GITHUB_TOKEN_KEY.to_vec(), token.as_bytes().to_vec(), None)
            .map_err(|error| format!("store GitHub token failed: {error}"))?;
        vault
            .save()
            .map_err(|error| format!("save cloud secret vault failed: {error}"))?;
        drop(unlocked);
        self.status()
    }

    pub fn remove_github_token(&self) -> Result<CloudSecretVaultStatus, String> {
        let unlocked = self
            .unlocked
            .lock()
            .map_err(|_| "cloud secret vault lock poisoned".to_string())?;
        let vault = unlocked
            .as_ref()
            .ok_or_else(|| "cloud secret vault is locked".to_string())?;
        vault
            .get_client(VAULT_CLIENT_ID)
            .map_err(|error| format!("open cloud secret vault client failed: {error}"))?
            .store()
            .delete(GITHUB_TOKEN_KEY)
            .map_err(|error| format!("remove GitHub token failed: {error}"))?;
        vault
            .save()
            .map_err(|error| format!("save cloud secret vault failed: {error}"))?;
        drop(unlocked);
        self.status()
    }

    /// Returns the credential only to native services that need to construct
    /// an authenticated GitHub request. It is intentionally not a Tauri
    /// command and must never be serialized to the browser runtime.
    pub fn github_token(&self) -> Result<String, String> {
        let unlocked = self
            .unlocked
            .lock()
            .map_err(|_| "cloud secret vault lock poisoned".to_string())?;
        let vault = unlocked
            .as_ref()
            .ok_or_else(|| "cloud secret vault is locked".to_string())?;
        let value = vault
            .get_client(VAULT_CLIENT_ID)
            .map_err(|error| format!("open cloud secret vault client failed: {error}"))?
            .store()
            .get(GITHUB_TOKEN_KEY)
            .map_err(|error| format!("read GitHub token failed: {error}"))?
            .ok_or_else(|| "GitHub token is not configured".to_string())?;
        String::from_utf8(value).map_err(|_| "stored GitHub token is not valid UTF-8".to_string())
    }
}

fn load_or_create_salt(path: &Path) -> Result<Vec<u8>, String> {
    if path.exists() {
        let salt = fs::read(path)
            .map_err(|error| format!("read cloud secret vault salt failed: {error}"))?;
        if salt.len() < 16 {
            return Err("cloud secret vault salt is invalid".to_string());
        }
        return Ok(salt);
    }

    let salt = Uuid::new_v4().as_bytes().to_vec();
    fs::write(path, &salt)
        .map_err(|error| format!("write cloud secret vault salt failed: {error}"))?;
    Ok(salt)
}
