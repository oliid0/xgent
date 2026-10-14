use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri_plugin_stronghold::stronghold::Stronghold;
use uuid::Uuid;

const VAULT_FILENAME: &str = "cloud-secrets.device.hold";
const DEVICE_KEY_FILENAME: &str = "cloud-secrets.device.key";
const VAULT_CLIENT_ID: &[u8] = b"xgent.cloud-execution";
const GITHUB_TOKEN_KEY: &[u8] = b"github.personal-access-token";
const GITHUB_USERNAME_KEY: &[u8] = b"github.username";
const GITHUB_OAUTH_KEY: &[u8] = b"github.oauth-account.v1";
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub github_oauth_account: Option<GitHubOAuthAccount>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubOAuthAccount {
    pub account_id: String,
    pub github_user_id: String,
    pub login: String,
    pub client_id: String,
    pub scopes: Vec<String>,
    pub authenticated_at: i64,
    pub expires_at: Option<i64>,
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct GitHubOAuthGrant {
    pub account: GitHubOAuthAccount,
    pub refresh_token: Option<String>,
    pub refresh_expires_at: Option<i64>,
    pub credential_binding: String,
}

fn github_digest(token: Option<&[u8]>, username: Option<&[u8]>) -> String {
    let mut digest = Sha256::new();
    for value in [token, username] {
        digest.update([u8::from(value.is_some())]);
        let value = value.unwrap_or_default();
        digest.update((value.len() as u64).to_be_bytes());
        digest.update(value);
    }
    format!("{:x}", digest.finalize())
}

impl CloudSecretVault {
    /// OS callbacks can reopen this installation, never create a replacement
    /// identity, key or empty credential client when protected files are absent.
    #[cfg(any(target_os="ios",target_os="android"))]
    pub(crate) fn open_existing(app_data_dir: &Path) -> Result<Self,String> {
        let root=fs::canonicalize(app_data_dir).map_err(|_|"Original credential directory unavailable".to_string())?;
        let snapshot=fs::canonicalize(root.join(VAULT_FILENAME)).map_err(|_|"Original credential snapshot unavailable".to_string())?;
        let key_path=fs::canonicalize(root.join(DEVICE_KEY_FILENAME)).map_err(|_|"Original credential key unavailable".to_string())?;
        if snapshot.parent()!=Some(root.as_path()) || key_path.parent()!=Some(root.as_path()) || !snapshot.is_file() || !key_path.is_file() {
            return Err("Original private credential files changed".into());
        }
        let key=validate_device_key(fs::read(key_path).map_err(|_|"Original credential key unavailable".to_string())?)?;
        let stronghold=Stronghold::new(&snapshot,key).map_err(|_|"Original credential snapshot unavailable".to_string())?;
        stronghold.load_client(VAULT_CLIENT_ID).map_err(|_|"Original credential client unavailable".to_string())?;
        Ok(Self {stronghold:Mutex::new(stronghold)})
    }

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
        let token = store
            .get(GITHUB_TOKEN_KEY)
            .map_err(|error| format!("read GitHub token status failed: {error}"))?;
        let github_token_configured = token.is_some();
        let username = store.get(GITHUB_USERNAME_KEY).map_err(|_| "Read GitHub account failed".to_string())?;
        let binding = github_digest(token.as_deref(), username.as_deref());
        let github_oauth_account = store.get(GITHUB_OAUTH_KEY).map_err(|_| "Read GitHub authorization failed".to_string())?
            .map(|bytes| serde_json::from_slice::<GitHubOAuthGrant>(&bytes)).transpose()
            .map_err(|_| "Read GitHub authorization failed".to_string())?
            .filter(|grant| grant.credential_binding == binding).map(|grant| grant.account);
        let github_username = store
            .get(GITHUB_USERNAME_KEY)
            .map_err(|error| format!("read GitHub username failed: {error}"))?
            .map(String::from_utf8)
            .transpose()
            .map_err(|_| "stored GitHub username is not valid UTF-8".to_string())?;
        Ok(CloudSecretVaultStatus {
            github_token_configured,
            github_username,
            github_oauth_account,
        })
    }

    pub fn set_github_token(
        &self,
        username: &str,
        token: &str,
    ) -> Result<CloudSecretVaultStatus, String> {
        self.write_github_token(username, token, None, None)
    }

    pub(crate) fn set_github_oauth_token(&self, expected: &str, token: &str, grant: GitHubOAuthGrant)
        -> Result<CloudSecretVaultStatus, String> {
        self.write_github_token(&grant.account.login.clone(), token, Some(expected), Some(grant))
    }

    fn write_github_token(&self, username: &str, token: &str, expected: Option<&str>,
        mut grant: Option<GitHubOAuthGrant>) -> Result<CloudSecretVaultStatus, String> {
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
        if let Some(expected) = expected {
            let current_token = store.get(GITHUB_TOKEN_KEY).map_err(|_| "github-oauth-storage".to_string())?;
            let current_name = store.get(GITHUB_USERNAME_KEY).map_err(|_| "github-oauth-storage".to_string())?;
            if github_digest(current_token.as_deref(), current_name.as_deref()) != expected {
                return Err("github-oauth-credential-changed".into());
            }
        }
        let previous = [GITHUB_TOKEN_KEY,GITHUB_USERNAME_KEY,GITHUB_OAUTH_KEY].into_iter()
            .map(|key|store.get(key).map(|value|(key,value)).map_err(|_|"github-oauth-storage".to_string()))
            .collect::<Result<Vec<_>,_>>()?;
        let write = (|| -> Result<(),String> {
        if let Some(grant) = grant.as_mut() {
            grant.credential_binding = github_digest(Some(token.as_bytes()), Some(username.as_bytes()));
            store.insert(GITHUB_OAUTH_KEY.to_vec(), serde_json::to_vec(grant).map_err(|_| "github-oauth-storage".to_string())?, None)
                .map_err(|_| "github-oauth-storage".to_string())?;
        } else {
            store.delete(GITHUB_OAUTH_KEY).map_err(|_| "github-oauth-storage".to_string())?;
        }
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
        Ok(())
        })();
        if let Err(error) = write {
            // Do not expose an uncommitted replacement as the connected account.
            for (key,value) in previous {
                match value {
                    Some(value) => {store.insert(key.to_vec(),value,None).map_err(|_|"github-oauth-storage".to_string())?;},
                    None => {store.delete(key).map_err(|_|"github-oauth-storage".to_string())?;},
                }
            }
            return Err(error);
        }
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
        store.delete(GITHUB_OAUTH_KEY).map_err(|_| "github-oauth-storage".to_string())?;
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
        let store = stronghold
            .get_client(VAULT_CLIENT_ID)
            .map_err(|error| format!("open cloud credential client failed: {error}"))?
            .store();
        let value = store
            .get(GITHUB_TOKEN_KEY)
            .map_err(|error| format!("read GitHub token failed: {error}"))?
            .ok_or_else(|| "GitHub token is not configured".to_string())?;
        let name=store.get(GITHUB_USERNAME_KEY).map_err(|_|"github-oauth-storage".to_string())?;
        let grant=store.get(GITHUB_OAUTH_KEY).map_err(|_|"github-oauth-storage".to_string())?
            .map(|bytes|serde_json::from_slice::<GitHubOAuthGrant>(&bytes)).transpose().map_err(|_|"github-oauth-storage".to_string())?;
        if grant.is_some_and(|grant|grant.credential_binding==github_digest(Some(&value),name.as_deref())
            && grant.account.expires_at.is_some_and(|expires|expires<=crate::services::automation::db::now_ms())) {
            return Err("github-oauth-expired".into());
        }
        String::from_utf8(value).map_err(|_| "stored GitHub token is not valid UTF-8".to_string())
    }

    pub(crate) fn github_credential_binding(&self) -> Result<String, String> {
        let hold = self.stronghold.lock().map_err(|_| "github-oauth-storage".to_string())?;
        let store = hold.get_client(VAULT_CLIENT_ID).map_err(|_| "github-oauth-storage".to_string())?.store();
        let token = store.get(GITHUB_TOKEN_KEY).map_err(|_| "github-oauth-storage".to_string())?;
        let name = store.get(GITHUB_USERNAME_KEY).map_err(|_| "github-oauth-storage".to_string())?;
        Ok(github_digest(token.as_deref(), name.as_deref()))
    }

    pub(crate) fn github_oauth_grant(&self) -> Result<Option<GitHubOAuthGrant>, String> {
        let hold = self.stronghold.lock().map_err(|_| "github-oauth-storage".to_string())?;
        let store = hold.get_client(VAULT_CLIENT_ID).map_err(|_| "github-oauth-storage".to_string())?.store();
        let token = store.get(GITHUB_TOKEN_KEY).map_err(|_| "github-oauth-storage".to_string())?;
        let name = store.get(GITHUB_USERNAME_KEY).map_err(|_| "github-oauth-storage".to_string())?;
        let binding = github_digest(token.as_deref(), name.as_deref());
        store.get(GITHUB_OAUTH_KEY).map_err(|_| "github-oauth-storage".to_string())?
            .map(|bytes| serde_json::from_slice::<GitHubOAuthGrant>(&bytes)).transpose()
            .map(|grant| grant.filter(|grant| grant.credential_binding == binding))
            .map_err(|_| "github-oauth-storage".to_string())
    }

    pub(crate) fn github_background_material(&self) -> Result<serde_json::Value, String> {
        let hold=self.stronghold.lock().map_err(|_|"github-oauth-storage".to_string())?;
        let store=hold.get_client(VAULT_CLIENT_ID).map_err(|_|"github-oauth-storage".to_string())?.store();
        let token=store.get(GITHUB_TOKEN_KEY).map_err(|_|"github-oauth-storage".to_string())?;
        let name=store.get(GITHUB_USERNAME_KEY).map_err(|_|"github-oauth-storage".to_string())?;
        let binding=github_digest(token.as_deref(),name.as_deref());
        let grant=store.get(GITHUB_OAUTH_KEY).map_err(|_|"github-oauth-storage".to_string())?
            .map(|bytes|serde_json::from_slice::<GitHubOAuthGrant>(&bytes)).transpose().map_err(|_|"github-oauth-storage".to_string())?;
        if let Some(grant) = grant.filter(|grant|grant.credential_binding==binding) {
            // A refresh retains the verified account and scopes; a new login receives a new account ID.
            return Ok(serde_json::json!({"oauthAccount":grant.account.account_id,
                "subject":grant.account.github_user_id,"client":grant.account.client_id,"scopes":grant.account.scopes}));
        }
        token.map(|bytes|String::from_utf8(bytes).map(serde_json::Value::String).map_err(|_|"github-oauth-storage".to_string()))
            .unwrap_or(Ok(serde_json::Value::Null))
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

    /// Installation identity stays outside config.sqlite: copying settings or
    /// task history to another device must not copy this host's identity.
    #[cfg(any(target_os="ios",target_os="android"))]
    pub(crate) fn existing_worker_host_identity(&self)->Result<String,String>{
        let bytes=self.namespaced_secret(b"worker-host.identity.v1")?.ok_or("Original protected worker identity unavailable")?;
        let id=String::from_utf8(bytes).map_err(|_|"Original worker identity invalid".to_string())?;
        if !Uuid::parse_str(&id).is_ok_and(|uuid|uuid.to_string()==id){return Err("Original worker identity invalid".into());}
        Ok(id)
    }

    pub(crate) fn worker_host_identity(&self) -> Result<String, String> {
        const KEY: &[u8] = b"worker-host.identity.v1";
        let stronghold = self.stronghold.lock().map_err(|_| "cloud credential lock poisoned".to_string())?;
        let client = stronghold.get_client(VAULT_CLIENT_ID).map_err(|e| e.to_string())?;
        if let Some(bytes) = client.store().get(KEY).map_err(|e| e.to_string())? {
            let id = String::from_utf8(bytes).map_err(|_| "Worker identity is damaged".to_string())?;
            let parsed = Uuid::parse_str(&id).map_err(|_| "Worker identity is damaged; restore the device vault".to_string())?;
            if parsed.to_string() != id { return Err("Worker identity is not canonical".to_string()); }
            return Ok(id);
        }
        let id = Uuid::new_v4().to_string();
        client.store().insert(KEY.to_vec(), id.as_bytes().to_vec(), None).map_err(|e| e.to_string())?;
        stronghold.save().map_err(|e| e.to_string())?;
        Ok(id)
    }

    /// A secret commitment to task configuration, independent of the public
    /// worker UUID. The commitment does not permit credential guessing from
    /// queue bindings; it does not replace protection of the settings database.
    pub(crate) fn background_configuration_binding(&self, config: &[u8]) -> Result<String, String> {
        use background_hmac::{Hmac, KeyInit, Mac};
        use sha2::Sha256;
        const KEY: &[u8] = b"background-configuration.hmac-key.v1";
        let stronghold = self.stronghold.lock().map_err(|_| "cloud credential lock poisoned".to_string())?;
        let client = stronghold.get_client(VAULT_CLIENT_ID).map_err(|e| e.to_string())?;
        let key = match client.store().get(KEY).map_err(|e| e.to_string())? {
            Some(key) if key.len() == DEVICE_KEY_BYTES => key,
            Some(_) => return Err("Background configuration key is damaged".to_string()),
            None => {
                let mut key = Vec::with_capacity(DEVICE_KEY_BYTES);
                key.extend_from_slice(Uuid::new_v4().as_bytes());
                key.extend_from_slice(Uuid::new_v4().as_bytes());
                client.store().insert(KEY.to_vec(), key.clone(), None).map_err(|e| e.to_string())?;
                stronghold.save().map_err(|e| e.to_string())?;
                key
            }
        };
        let mut mac = Hmac::<Sha256>::new_from_slice(&key).map_err(|_| "Invalid background configuration key".to_string())?;
        mac.update(b"xgent.background-configuration.v1\0");
        mac.update(config);
        let bytes = mac.finalize().into_bytes();
        Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
    }

    /// Private task capability: never returned to the WebView/model, settings,
    /// source conversation or task result. It survives endpoint/session changes.
    pub(crate) fn device_task_channel_token(&self, device: &str, request: &str) -> Result<String, String> {
        if self.worker_host_identity()? != device || Uuid::parse_str(request).is_err() {
            return Err("Device channel must belong to this installation and a real request UUID".into());
        }
        let request = Uuid::parse_str(request).map_err(|e| e.to_string())?.to_string();
        let material = serde_json::to_vec(&serde_json::json!({"domain":"xgent.origin-device-channel.v1", "device":device, "request":request})).map_err(|e| e.to_string())?;
        self.background_configuration_binding(&material)
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
    fn github_oauth_account_is_durable_cas_bound_and_refresh_preserves_task_identity() {
        let directory=tempfile::tempdir().unwrap();
        let material={
            let vault=CloudSecretVault::new(directory.path().to_path_buf()).unwrap();
            let mut grant=GitHubOAuthGrant {account:GitHubOAuthAccount {
                account_id:Uuid::new_v4().to_string(),github_user_id:"17".into(),login:"actual-account".into(),
                client_id:"registered-client".into(),scopes:vec!["public_repo".into(),"read:user".into(),"workflow".into()],
                authenticated_at:1000,expires_at:None},refresh_token:Some("private-refresh".into()),refresh_expires_at:None,credential_binding:String::new()};
            let original=vault.github_credential_binding().unwrap();
            vault.set_github_oauth_token(&original,"original-token",grant.clone()).unwrap();
            let material=vault.github_background_material().unwrap();
            let public=serde_json::to_string(&vault.status().unwrap()).unwrap();
            assert!(!public.contains("original-token") && !public.contains("private-refresh") && !public.contains("credential_binding"));
            let renewed=vault.github_credential_binding().unwrap();
            vault.set_github_oauth_token(&renewed,"renewed-token",grant.clone()).unwrap();
            assert_eq!(vault.github_background_material().unwrap(),material);
            assert!(vault.set_github_oauth_token(&original,"stale-token",grant.clone()).is_err());
            assert_eq!(vault.github_token().unwrap(),"renewed-token");
            grant.account.expires_at=Some(1);
            vault.set_github_oauth_token(&vault.github_credential_binding().unwrap(),"expired-token",grant).unwrap();
            assert!(vault.github_token().is_err()); material
        };
        let vault=CloudSecretVault::new(directory.path().to_path_buf()).unwrap();
        assert_eq!(vault.github_background_material().unwrap(),material);
        vault.set_github_token("manual-account","manual-token").unwrap();
        assert!(vault.status().unwrap().github_oauth_account.is_none());
        assert_ne!(vault.github_background_material().unwrap(),material);
        assert_eq!(vault.github_token().unwrap(),"manual-token");
    }

    #[test]
    fn task_channel_survives_reopen_and_never_uses_another_installation() {
        let directory = tempfile::tempdir().unwrap();
        let request = Uuid::new_v4().to_string();
        let (device, token) = {
            let vault = CloudSecretVault::new(directory.path().to_path_buf()).unwrap();
            let device = vault.worker_host_identity().unwrap();
            let token = vault.device_task_channel_token(&device, &request).unwrap();
            assert_eq!(token.len(), 64);
            assert_ne!(token, vault.device_task_channel_token(&device, &Uuid::new_v4().to_string()).unwrap());
            assert!(vault.device_task_channel_token(&Uuid::new_v4().to_string(), &request).is_err());
            (device, token)
        };
        let reopened = CloudSecretVault::new(directory.path().to_path_buf()).unwrap();
        assert_eq!(reopened.device_task_channel_token(&device, &request).unwrap(), token);
    }

    #[cfg(desktop)]
    #[test]
    fn background_binding_survives_reopen_and_changes_with_credentials_or_device_key() {
        let directory = tempfile::tempdir().unwrap();
        let material = br#"{"account":"a","apiKey":"private-test-key"}"#;
        let binding = {
            let vault = CloudSecretVault::new(directory.path().to_path_buf()).unwrap();
            let binding = vault.background_configuration_binding(material).unwrap();
            assert_eq!(binding.len(), 64);
            assert_eq!(binding, vault.background_configuration_binding(material).unwrap());
            assert_ne!(binding, vault.background_configuration_binding(br#"{"account":"b"}"#).unwrap());
            binding
        };
        let reopened = CloudSecretVault::new(directory.path().to_path_buf()).unwrap();
        assert_eq!(binding, reopened.background_configuration_binding(material).unwrap());
        let other = tempfile::tempdir().unwrap();
        let other_vault = CloudSecretVault::new(other.path().to_path_buf()).unwrap();
        assert_ne!(binding, other_vault.background_configuration_binding(material).unwrap());
    }

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
