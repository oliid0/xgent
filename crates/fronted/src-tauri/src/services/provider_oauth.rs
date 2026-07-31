use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{Mutex, RwLock};
use uuid::Uuid;

use crate::services::cloud_secret_vault::CloudSecretVault;

const CODEX_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_DEVICE_CODE_URL: &str =
    "https://auth.openai.com/api/accounts/deviceauth/usercode";
const CODEX_DEVICE_TOKEN_URL: &str = "https://auth.openai.com/api/accounts/deviceauth/token";
const CODEX_TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const CODEX_DEVICE_REDIRECT_URI: &str = "https://auth.openai.com/deviceauth/callback";
const CODEX_DEFAULT_VERIFICATION_URI: &str = "https://auth.openai.com/codex/device";
const CODEX_SCOPES: &str = "openid profile email offline_access";
const CODEX_STORE_KEY: &[u8] = b"provider-oauth.codex.accounts.v1";
const REFRESH_EARLY_SECONDS: u64 = 300;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderOAuthDeviceCode {
    pub flow_id: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: Option<String>,
    pub expires_at: u64,
    pub interval_seconds: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderOAuthAccount {
    pub id: String,
    pub email: Option<String>,
    pub plan_type: Option<String>,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderOAuthStatus {
    pub accounts: Vec<ProviderOAuthAccount>,
    pub default_account_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderOAuthPollResult {
    pub state: ProviderOAuthPollState,
    pub account: Option<ProviderOAuthAccount>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProviderOAuthPollState {
    Pending,
    Complete,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct CodexOAuthStore {
    accounts: BTreeMap<String, StoredCodexAccount>,
    default_account_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredCodexAccount {
    id: String,
    email: Option<String>,
    plan_type: Option<String>,
    access_token: String,
    refresh_token: Option<String>,
    id_token: Option<String>,
    expires_at: Option<u64>,
}

#[derive(Debug, Clone)]
struct PendingDeviceFlow {
    device_auth_id: String,
    user_code: String,
    expires_at: u64,
}

#[derive(Debug, Deserialize)]
struct DeviceCodeResponse {
    device_auth_id: String,
    user_code: String,
    #[serde(default)]
    verification_uri: Option<String>,
    #[serde(default)]
    verification_uri_complete: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
    #[serde(default)]
    interval: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct DeviceAuthorizationResponse {
    authorization_code: String,
    code_verifier: String,
}

pub struct ProviderOAuthService {
    vault: Arc<CloudSecretVault>,
    store: RwLock<CodexOAuthStore>,
    pending: RwLock<HashMap<String, PendingDeviceFlow>>,
    refresh_guard: Mutex<()>,
}

impl ProviderOAuthService {
    pub fn new(vault: Arc<CloudSecretVault>) -> Result<Self, String> {
        let store = match vault.namespaced_secret(CODEX_STORE_KEY)? {
            Some(bytes) => serde_json::from_slice(&bytes)
                .map_err(|error| format!("read protected Codex accounts failed: {error}"))?,
            None => CodexOAuthStore::default(),
        };
        Ok(Self {
            vault,
            store: RwLock::new(store),
            pending: RwLock::new(HashMap::new()),
            refresh_guard: Mutex::new(()),
        })
    }

    pub async fn start_codex_device_flow(&self) -> Result<ProviderOAuthDeviceCode, String> {
        let client = crate::services::system_proxy::cached_client()
            .map_err(|error| format!("OpenAI sign-in network is unavailable: {error}"))?;
        let response = client
            .post(CODEX_DEVICE_CODE_URL)
            .json(&json!({ "client_id": CODEX_CLIENT_ID }))
            .send()
            .await
            .map_err(|error| format!("start OpenAI sign-in failed: {error}"))?;
        let status = response.status();
        let body = response
            .bytes()
            .await
            .map_err(|error| format!("read OpenAI sign-in response failed: {error}"))?;
        if !status.is_success() {
            return Err(oauth_http_error("start OpenAI sign-in", status.as_u16(), &body));
        }
        let payload: DeviceCodeResponse = serde_json::from_slice(&body)
            .map_err(|error| format!("decode OpenAI sign-in response failed: {error}"))?;
        let now = unix_now();
        let expires_at = now.saturating_add(payload.expires_in.unwrap_or(900));
        let interval_seconds = payload.interval.unwrap_or(5).clamp(3, 30);
        let verification_uri = payload
            .verification_uri
            .unwrap_or_else(|| CODEX_DEFAULT_VERIFICATION_URI.to_string());
        let flow_id = Uuid::new_v4().to_string();
        self.pending.write().await.insert(
            flow_id.clone(),
            PendingDeviceFlow {
                device_auth_id: payload.device_auth_id,
                user_code: payload.user_code.clone(),
                expires_at,
            },
        );
        Ok(ProviderOAuthDeviceCode {
            flow_id,
            user_code: payload.user_code,
            verification_uri,
            verification_uri_complete: payload.verification_uri_complete,
            expires_at,
            interval_seconds,
        })
    }

    pub async fn poll_codex_device_flow(
        &self,
        flow_id: &str,
    ) -> Result<ProviderOAuthPollResult, String> {
        let flow = self
            .pending
            .read()
            .await
            .get(flow_id)
            .cloned()
            .ok_or_else(|| "OpenAI sign-in session was not found; start again".to_string())?;
        if unix_now() >= flow.expires_at {
            self.pending.write().await.remove(flow_id);
            return Err("OpenAI sign-in session expired; start again".to_string());
        }

        let client = crate::services::system_proxy::cached_client()
            .map_err(|error| format!("OpenAI sign-in network is unavailable: {error}"))?;
        let response = client
            .post(CODEX_DEVICE_TOKEN_URL)
            .json(&json!({
                "device_auth_id": flow.device_auth_id,
                "user_code": flow.user_code,
            }))
            .send()
            .await
            .map_err(|error| format!("poll OpenAI sign-in failed: {error}"))?;
        let status = response.status();
        let body = response
            .bytes()
            .await
            .map_err(|error| format!("read OpenAI sign-in response failed: {error}"))?;
        if !status.is_success() {
            if oauth_error_code(&body).is_some_and(|code| {
                matches!(code.as_str(), "authorization_pending" | "slow_down")
            }) {
                return Ok(ProviderOAuthPollResult {
                    state: ProviderOAuthPollState::Pending,
                    account: None,
                });
            }
            self.pending.write().await.remove(flow_id);
            return Err(oauth_http_error(
                "complete OpenAI sign-in",
                status.as_u16(),
                &body,
            ));
        }

        let authorization: DeviceAuthorizationResponse = serde_json::from_slice(&body)
            .map_err(|error| format!("decode OpenAI authorization response failed: {error}"))?;
        let token = exchange_codex_authorization(
            &client,
            &authorization.authorization_code,
            &authorization.code_verifier,
        )
        .await?;
        let stored = parse_codex_token(token, None)?;
        let account_id = stored.id.clone();
        {
            let mut store = self.store.write().await;
            store.accounts.insert(account_id.clone(), stored);
            if store.default_account_id.is_none() {
                store.default_account_id = Some(account_id.clone());
            }
            self.persist(&store)?;
        }
        self.pending.write().await.remove(flow_id);
        let status = self.codex_status().await;
        let account = status
            .accounts
            .into_iter()
            .find(|account| account.id == account_id);
        Ok(ProviderOAuthPollResult {
            state: ProviderOAuthPollState::Complete,
            account,
        })
    }

    pub async fn codex_status(&self) -> ProviderOAuthStatus {
        let store = self.store.read().await;
        public_status(&store)
    }

    pub async fn set_default_codex_account(&self, account_id: &str) -> Result<(), String> {
        let mut store = self.store.write().await;
        if !store.accounts.contains_key(account_id) {
            return Err("OpenAI account was not found".to_string());
        }
        store.default_account_id = Some(account_id.to_string());
        self.persist(&store)
    }

    pub async fn remove_codex_account(&self, account_id: &str) -> Result<(), String> {
        let mut store = self.store.write().await;
        if store.accounts.remove(account_id).is_none() {
            return Err("OpenAI account was not found".to_string());
        }
        if store.default_account_id.as_deref() == Some(account_id) {
            store.default_account_id = store.accounts.keys().next().cloned();
        }
        self.persist(&store)
    }

    pub async fn logout_codex(&self) -> Result<(), String> {
        let mut store = self.store.write().await;
        store.accounts.clear();
        store.default_account_id = None;
        self.vault.remove_namespaced_secret(CODEX_STORE_KEY)
    }

    /// Resolves a valid token exclusively for the native HTTP proxy. Access and
    /// refresh tokens never cross the Tauri command boundary.
    pub async fn codex_access_token(&self, account_id: Option<&str>) -> Result<(String, String), String> {
        let selected_id = {
            let store = self.store.read().await;
            resolve_account_id(&store, account_id)?
        };
        if let Some(token) = {
            let store = self.store.read().await;
            store
                .accounts
                .get(&selected_id)
                .filter(|account| !account_needs_refresh(account))
                .map(|account| account.access_token.clone())
        } {
            return Ok((token, selected_id));
        }

        let _refresh = self.refresh_guard.lock().await;
        {
            let store = self.store.read().await;
            if let Some(account) = store.accounts.get(&selected_id) {
                if !account_needs_refresh(account) {
                    return Ok((account.access_token.clone(), selected_id));
                }
            }
        }
        self.refresh_codex_account(&selected_id).await?;
        let store = self.store.read().await;
        let account = store
            .accounts
            .get(&selected_id)
            .ok_or_else(|| "OpenAI account was removed during token refresh".to_string())?;
        Ok((account.access_token.clone(), selected_id))
    }

    async fn refresh_codex_account(&self, account_id: &str) -> Result<(), String> {
        let existing = self
            .store
            .read()
            .await
            .accounts
            .get(account_id)
            .cloned()
            .ok_or_else(|| "OpenAI account was not found".to_string())?;
        let refresh_token = existing
            .refresh_token
            .as_deref()
            .ok_or_else(|| "OpenAI session expired and cannot be refreshed; sign in again".to_string())?;
        let client = crate::services::system_proxy::cached_client()
            .map_err(|error| format!("OpenAI token refresh network is unavailable: {error}"))?;
        let response = client
            .post(CODEX_TOKEN_URL)
            .json(&json!({
                "grant_type": "refresh_token",
                "client_id": CODEX_CLIENT_ID,
                "refresh_token": refresh_token,
                "scope": CODEX_SCOPES,
            }))
            .send()
            .await
            .map_err(|error| format!("refresh OpenAI sign-in failed: {error}"))?;
        let status = response.status();
        let body = response
            .bytes()
            .await
            .map_err(|error| format!("read OpenAI refresh response failed: {error}"))?;
        if !status.is_success() {
            return Err(oauth_http_error(
                "refresh OpenAI sign-in",
                status.as_u16(),
                &body,
            ));
        }
        let payload: Value = serde_json::from_slice(&body)
            .map_err(|error| format!("decode OpenAI refresh response failed: {error}"))?;
        let refreshed = parse_codex_token(payload, Some(&existing))?;
        let mut store = self.store.write().await;
        store.accounts.insert(account_id.to_string(), refreshed);
        self.persist(&store)
    }

    fn persist(&self, store: &CodexOAuthStore) -> Result<(), String> {
        if store.accounts.is_empty() {
            return self.vault.remove_namespaced_secret(CODEX_STORE_KEY);
        }
        let bytes = serde_json::to_vec(store)
            .map_err(|error| format!("encode protected Codex accounts failed: {error}"))?;
        self.vault.set_namespaced_secret(CODEX_STORE_KEY, &bytes)
    }
}

async fn exchange_codex_authorization(
    client: &reqwest::Client,
    authorization_code: &str,
    code_verifier: &str,
) -> Result<Value, String> {
    let response = client
        .post(CODEX_TOKEN_URL)
        .json(&json!({
            "grant_type": "authorization_code",
            "client_id": CODEX_CLIENT_ID,
            "code": authorization_code,
            "redirect_uri": CODEX_DEVICE_REDIRECT_URI,
            "code_verifier": code_verifier,
        }))
        .send()
        .await
        .map_err(|error| format!("exchange OpenAI authorization failed: {error}"))?;
    let status = response.status();
    let body = response
        .bytes()
        .await
        .map_err(|error| format!("read OpenAI token response failed: {error}"))?;
    if !status.is_success() {
        return Err(oauth_http_error(
            "exchange OpenAI authorization",
            status.as_u16(),
            &body,
        ));
    }
    serde_json::from_slice(&body)
        .map_err(|error| format!("decode OpenAI token response failed: {error}"))
}

fn parse_codex_token(
    payload: Value,
    previous: Option<&StoredCodexAccount>,
) -> Result<StoredCodexAccount, String> {
    let access_token = required_json_string(&payload, "access_token")?;
    let refresh_token = optional_json_string(&payload, "refresh_token")
        .or_else(|| previous.and_then(|account| account.refresh_token.clone()));
    let id_token = optional_json_string(&payload, "id_token")
        .or_else(|| previous.and_then(|account| account.id_token.clone()));
    let claims = id_token
        .as_deref()
        .and_then(decode_jwt_payload)
        .or_else(|| decode_jwt_payload(&access_token))
        .unwrap_or(Value::Null);
    let nested_auth = claims.get("https://api.openai.com/auth");
    let account_id = json_string(&claims, "chatgpt_account_id")
        .or_else(|| nested_auth.and_then(|value| json_string(value, "chatgpt_account_id")))
        .or_else(|| previous.map(|account| account.id.clone()))
        .ok_or_else(|| "OpenAI token did not contain a ChatGPT account id".to_string())?;
    let email = json_string(&claims, "email")
        .or_else(|| previous.and_then(|account| account.email.clone()));
    let plan_type = json_string(&claims, "chatgpt_plan_type")
        .or_else(|| nested_auth.and_then(|value| json_string(value, "chatgpt_plan_type")))
        .or_else(|| previous.and_then(|account| account.plan_type.clone()));
    let expires_at = payload
        .get("expires_in")
        .and_then(Value::as_u64)
        .map(|seconds| unix_now().saturating_add(seconds))
        .or_else(|| claims.get("exp").and_then(Value::as_u64))
        .or_else(|| previous.and_then(|account| account.expires_at));
    Ok(StoredCodexAccount {
        id: account_id,
        email,
        plan_type,
        access_token,
        refresh_token,
        id_token,
        expires_at,
    })
}

fn resolve_account_id(store: &CodexOAuthStore, requested: Option<&str>) -> Result<String, String> {
    let requested = requested.map(str::trim).filter(|value| !value.is_empty());
    if let Some(account_id) = requested {
        if store.accounts.contains_key(account_id) {
            return Ok(account_id.to_string());
        }
        return Err("selected OpenAI account is no longer available".to_string());
    }
    store
        .default_account_id
        .clone()
        .or_else(|| store.accounts.keys().next().cloned())
        .ok_or_else(|| "OpenAI OAuth is not configured".to_string())
}

fn public_status(store: &CodexOAuthStore) -> ProviderOAuthStatus {
    ProviderOAuthStatus {
        accounts: store
            .accounts
            .values()
            .map(|account| ProviderOAuthAccount {
                id: account.id.clone(),
                email: account.email.clone(),
                plan_type: account.plan_type.clone(),
                is_default: store.default_account_id.as_deref() == Some(account.id.as_str()),
            })
            .collect(),
        default_account_id: store.default_account_id.clone(),
    }
}

fn account_needs_refresh(account: &StoredCodexAccount) -> bool {
    account
        .expires_at
        .is_some_and(|expires_at| expires_at <= unix_now().saturating_add(REFRESH_EARLY_SECONDS))
}

fn decode_jwt_payload(token: &str) -> Option<Value> {
    let encoded = token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(encoded).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn required_json_string(value: &Value, key: &str) -> Result<String, String> {
    json_string(value, key).ok_or_else(|| format!("OpenAI token response is missing {key}"))
}

fn optional_json_string(value: &Value, key: &str) -> Option<String> {
    json_string(value, key)
}

fn json_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn oauth_error_code(body: &[u8]) -> Option<String> {
    let value: Value = serde_json::from_slice(body).ok()?;
    value
        .get("error")
        .and_then(|error| {
            error
                .as_str()
                .or_else(|| error.get("code").and_then(Value::as_str))
        })
        .map(ToOwned::to_owned)
}

fn oauth_http_error(context: &str, status: u16, body: &[u8]) -> String {
    let detail = serde_json::from_slice::<Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("error_description")
                .and_then(Value::as_str)
                .or_else(|| value.get("message").and_then(Value::as_str))
                .or_else(|| {
                    value
                        .get("error")
                        .and_then(|error| error.get("message"))
                        .and_then(Value::as_str)
                })
                .map(ToOwned::to_owned)
        })
        .unwrap_or_else(|| "the authorization server rejected the request".to_string());
    format!("{context} failed (HTTP {status}): {detail}")
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}
