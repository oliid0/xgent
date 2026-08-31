use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::header::{COOKIE, ORIGIN, SET_COOKIE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tauri::Emitter;

use crate::services::cloud_secret_vault::CloudSecretVault;

const SESSION_STORE_KEY: &[u8] = b"lan-pc.session.v1";
const SESSION_COOKIE_NAME: &str = "xgent_session";
const CSRF_HEADER: &str = "x-xgent-csrf";
const DEFAULT_LAN_PORT: u16 = 28_367;
pub const LAN_PC_RELAY_EVENT: &str = "xgent:lan-pc-event";
pub const LAN_PC_SESSION_CHANGED_EVENT: &str = "xgent:lan-pc-session-changed";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredLanPcSession {
    base_url: String,
    device_id: String,
    session_token: String,
    csrf_token: String,
    expires_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanPcClientStatus {
    pub paired: bool,
    pub base_url: Option<String>,
    pub device_id: Option<String>,
    pub expires_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairResponse {
    paired: bool,
    device_id: String,
    csrf_token: String,
    expires_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RefreshResponse {
    authenticated: bool,
    device_id: String,
    csrf_token: String,
    expires_at: i64,
}

#[derive(Debug, Deserialize)]
struct RpcResponse {
    ok: Option<bool>,
    result: Option<Value>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubscribeResponse {
    subscription_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteEventEnvelope {
    subscription_id: String,
    payload: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanPcSubscription {
    pub subscription_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LanPcRelayedEvent {
    subscription_id: String,
    payload: Value,
}

pub struct LanPcClient {
    vault: Arc<CloudSecretVault>,
    http: reqwest::Client,
    event_http: reqwest::Client,
    session: Mutex<Option<StoredLanPcSession>>,
    refresh_lock: Mutex<()>,
    subscriptions: Mutex<HashMap<String, JoinHandle<()>>>,
}

impl LanPcClient {
    pub fn new(vault: Arc<CloudSecretVault>) -> Result<Self, String> {
        let session = match vault.namespaced_secret(SESSION_STORE_KEY)? {
            Some(bytes) => Some(
                serde_json::from_slice(&bytes)
                    .map_err(|error| format!("read protected LAN computer session failed: {error}"))?,
            ),
            None => None,
        };
        let http = reqwest::Client::builder()
            .no_proxy()
            .connect_timeout(Duration::from_secs(4))
            .timeout(Duration::from_secs(11 * 60))
            .build()
            .map_err(|error| format!("initialize LAN computer client failed: {error}"))?;
        // SSE subscriptions are intentionally long lived. They share the
        // connection timeout and proxy policy with RPC calls, but must not
        // inherit the finite end-to-end RPC timeout.
        let event_http = reqwest::Client::builder()
            .no_proxy()
            .connect_timeout(Duration::from_secs(4))
            .build()
            .map_err(|error| format!("initialize LAN computer event client failed: {error}"))?;
        Ok(Self {
            vault,
            http,
            event_http,
            session: Mutex::new(session),
            refresh_lock: Mutex::new(()),
            subscriptions: Mutex::new(HashMap::new()),
        })
    }

    pub async fn status(&self) -> LanPcClientStatus {
        let session = self.session.lock().await;
        public_status(session.as_ref())
    }

    pub async fn pair(
        &self,
        base_url: &str,
        code: &str,
        device_name: &str,
    ) -> Result<LanPcClientStatus, String> {
        let base_url = normalize_base_url(base_url)?;
        let code = code.trim();
        if code.len() != 6 || !code.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err("pairing code must contain exactly six digits".to_string());
        }
        let device_name = device_name.trim();
        if device_name.is_empty() || device_name.chars().count() > 64 {
            return Err("device name must contain 1 to 64 characters".to_string());
        }

        let response = self
            .http
            .post(endpoint(&base_url, "api/local-access/pair")?)
            .header(ORIGIN, &base_url)
            .json(&json!({ "code": code, "deviceName": device_name }))
            .send()
            .await
            .map_err(|error| format!("connect to LAN computer failed: {error}"))?;
        let session_token = response
            .headers()
            .get_all(SET_COOKIE)
            .iter()
            .filter_map(|value| value.to_str().ok())
            .find_map(parse_session_cookie);
        let status_code = response.status();
        let bytes = response
            .bytes()
            .await
            .map_err(|error| format!("read LAN computer pairing response failed: {error}"))?;
        if !status_code.is_success() {
            return Err(http_error("pair LAN computer", status_code.as_u16(), &bytes));
        }
        let payload: PairResponse = serde_json::from_slice(&bytes)
            .map_err(|error| format!("decode LAN computer pairing response failed: {error}"))?;
        if !payload.paired {
            return Err("LAN computer rejected the pairing request".to_string());
        }
        let session_token =
            session_token.ok_or_else(|| "LAN computer did not return a session cookie".to_string())?;
        let next = StoredLanPcSession {
            base_url,
            device_id: payload.device_id,
            session_token,
            csrf_token: payload.csrf_token,
            expires_at: payload.expires_at,
        };
        self.persist(Some(&next))?;
        let status = public_status(Some(&next));
        *self.session.lock().await = Some(next);
        Ok(status)
    }

    pub async fn refresh(&self, expected_base_url: Option<&str>) -> Result<LanPcClientStatus, String> {
        let _refresh_guard = self.refresh_lock.lock().await;
        let mut session = self.session_snapshot(expected_base_url).await?;
        session = self.refresh_session(&session).await?;
        self.persist(Some(&session))?;
        let status = public_status(Some(&session));
        *self.session.lock().await = Some(session);
        Ok(status)
    }

    pub async fn disconnect(&self) -> Result<LanPcClientStatus, String> {
        let running = std::mem::take(&mut *self.subscriptions.lock().await);
        for (_, task) in running {
            task.abort();
        }
        self.persist(None)?;
        *self.session.lock().await = None;
        Ok(public_status(None))
    }

    pub async fn invoke(
        &self,
        expected_base_url: Option<&str>,
        command: &str,
        args: Value,
    ) -> Result<Value, String> {
        let command = command.trim();
        if command.is_empty() {
            return Err("LAN computer command cannot be empty".to_string());
        }
        let session = self.session_snapshot(expected_base_url).await?;
        let first = self.send_rpc(&session, command, args.clone()).await;
        if !matches!(&first, Err(RpcFailure::Unauthorized(_))) {
            return first.map_err(RpcFailure::into_message);
        }

        // Only serialize the short session refresh path. Successful RPC calls
        // run concurrently, including long shell tasks on the paired computer.
        let refresh_guard = self.refresh_lock.lock().await;
        let current = self.session_snapshot(expected_base_url).await?;
        let refreshed = if current.csrf_token != session.csrf_token {
            current
        } else {
            let refreshed = self.refresh_session(&current).await?;
            self.persist(Some(&refreshed))?;
            *self.session.lock().await = Some(refreshed.clone());
            refreshed
        };
        drop(refresh_guard);
        self.send_rpc(&refreshed, command, args)
            .await
            .map_err(RpcFailure::into_message)
    }

    pub async fn subscribe(
        &self,
        expected_base_url: Option<&str>,
        event: &str,
        app_handle: tauri::AppHandle,
    ) -> Result<LanPcSubscription, String> {
        let event = event.trim();
        if event.is_empty() {
            return Err("LAN computer event name cannot be empty".to_string());
        }
        let session = self.session_snapshot(expected_base_url).await?;

        // Open the event stream before registering the remote subscription so
        // the first terminal/process event cannot race past the mobile client.
        let stream_response = self
            .event_http
            .get(endpoint(&session.base_url, "api/local-access/events")?)
            .header(ORIGIN, &session.base_url)
            .header(COOKIE, session_cookie(&session.session_token))
            .send()
            .await
            .map_err(|error| format!("open LAN computer event stream failed: {error}"))?;
        let stream_status = stream_response.status();
        if !stream_status.is_success() {
            let bytes = stream_response
                .bytes()
                .await
                .map_err(|error| format!("read LAN computer event stream failure failed: {error}"))?;
            return Err(http_error(
                "open LAN computer event stream",
                stream_status.as_u16(),
                &bytes,
            ));
        }

        let response = self
            .http
            .post(endpoint(&session.base_url, "api/local-access/subscriptions")?)
            .header(ORIGIN, &session.base_url)
            .header(COOKIE, session_cookie(&session.session_token))
            .header(CSRF_HEADER, &session.csrf_token)
            .json(&json!({ "event": event }))
            .send()
            .await
            .map_err(|error| format!("subscribe to LAN computer event failed: {error}"))?;
        let status = response.status();
        let bytes = response
            .bytes()
            .await
            .map_err(|error| format!("read LAN computer subscription response failed: {error}"))?;
        if !status.is_success() {
            return Err(http_error(
                "subscribe to LAN computer event",
                status.as_u16(),
                &bytes,
            ));
        }
        let payload: SubscribeResponse = serde_json::from_slice(&bytes)
            .map_err(|error| format!("decode LAN computer subscription response failed: {error}"))?;
        let subscription_id = payload.subscription_id.trim().to_string();
        if subscription_id.is_empty() {
            return Err("LAN computer subscription did not return an id".to_string());
        }

        let expected_subscription_id = subscription_id.clone();
        let task = tokio::spawn(async move {
            let mut stream = stream_response.bytes_stream();
            let mut buffer = String::new();
            while let Some(chunk) = stream.next().await {
                let Ok(chunk) = chunk else {
                    break;
                };
                buffer.push_str(&String::from_utf8_lossy(&chunk));
                while let Some(frame) = take_sse_frame(&mut buffer) {
                    let Some(data) = sse_frame_data(&frame) else {
                        continue;
                    };
                    let Ok(envelope) = serde_json::from_str::<RemoteEventEnvelope>(&data) else {
                        continue;
                    };
                    if envelope.subscription_id != expected_subscription_id {
                        continue;
                    }
                    let _ = app_handle.emit(
                        LAN_PC_RELAY_EVENT,
                        LanPcRelayedEvent {
                            subscription_id: expected_subscription_id.clone(),
                            payload: envelope.payload,
                        },
                    );
                }
            }
        });
        if let Some(previous) = self
            .subscriptions
            .lock()
            .await
            .insert(subscription_id.clone(), task)
        {
            previous.abort();
        }
        Ok(LanPcSubscription { subscription_id })
    }

    pub async fn unsubscribe(&self, subscription_id: &str) -> Result<(), String> {
        let subscription_id = subscription_id.trim();
        if subscription_id.is_empty() {
            return Ok(());
        }
        if let Some(task) = self.subscriptions.lock().await.remove(subscription_id) {
            task.abort();
        }
        let session = match self.session.lock().await.clone() {
            Some(session) => session,
            None => return Ok(()),
        };
        let response = self
            .http
            .delete(endpoint(
                &session.base_url,
                &format!("api/local-access/subscriptions/{subscription_id}"),
            )?)
            .header(ORIGIN, &session.base_url)
            .header(COOKIE, session_cookie(&session.session_token))
            .header(CSRF_HEADER, &session.csrf_token)
            .send()
            .await
            .map_err(|error| format!("unsubscribe from LAN computer event failed: {error}"))?;
        if !response.status().is_success() {
            let status = response.status();
            let bytes = response.bytes().await.map_err(|error| {
                format!("read LAN computer unsubscribe response failed: {error}")
            })?;
            return Err(http_error(
                "unsubscribe from LAN computer event",
                status.as_u16(),
                &bytes,
            ));
        }
        Ok(())
    }

    async fn session_snapshot(
        &self,
        expected_base_url: Option<&str>,
    ) -> Result<StoredLanPcSession, String> {
        let guard = self.session.lock().await;
        Self::resolve_session(&guard, expected_base_url)
    }

    fn resolve_session(
        session: &Option<StoredLanPcSession>,
        expected_base_url: Option<&str>,
    ) -> Result<StoredLanPcSession, String> {
        let session = session
            .clone()
            .ok_or_else(|| "LAN computer is not paired; enter the computer pairing code first".to_string())?;
        if let Some(expected) = expected_base_url.map(str::trim).filter(|value| !value.is_empty()) {
            let expected = normalize_base_url(expected)?;
            if expected != session.base_url {
                return Err(
                    "The configured LAN computer address changed; pair the new address first"
                        .to_string(),
                );
            }
        }
        Ok(session)
    }

    async fn refresh_session(
        &self,
        session: &StoredLanPcSession,
    ) -> Result<StoredLanPcSession, String> {
        let response = self
            .http
            .post(endpoint(&session.base_url, "api/local-access/session")?)
            .header(ORIGIN, &session.base_url)
            .header(COOKIE, session_cookie(&session.session_token))
            .send()
            .await
            .map_err(|error| format!("refresh LAN computer session failed: {error}"))?;
        let status = response.status();
        let bytes = response
            .bytes()
            .await
            .map_err(|error| format!("read LAN computer session response failed: {error}"))?;
        if !status.is_success() {
            return Err(http_error(
                "refresh LAN computer session",
                status.as_u16(),
                &bytes,
            ));
        }
        let payload: RefreshResponse = serde_json::from_slice(&bytes)
            .map_err(|error| format!("decode LAN computer session response failed: {error}"))?;
        if !payload.authenticated || payload.device_id != session.device_id {
            return Err("LAN computer session is no longer valid; pair again".to_string());
        }
        Ok(StoredLanPcSession {
            base_url: session.base_url.clone(),
            device_id: session.device_id.clone(),
            session_token: session.session_token.clone(),
            csrf_token: payload.csrf_token,
            expires_at: payload.expires_at,
        })
    }

    async fn send_rpc(
        &self,
        session: &StoredLanPcSession,
        command: &str,
        args: Value,
    ) -> Result<Value, RpcFailure> {
        let target = endpoint(&session.base_url, "api/local-access/rpc")
            .map_err(RpcFailure::Request)?;
        let response = self
            .http
            .post(target)
            .header(ORIGIN, &session.base_url)
            .header(COOKIE, session_cookie(&session.session_token))
            .header(CSRF_HEADER, &session.csrf_token)
            .json(&json!({ "command": command, "args": args }))
            .send()
            .await
            .map_err(|error| RpcFailure::Request(format!("call LAN computer failed: {error}")))?;
        let status = response.status();
        let bytes = response
            .bytes()
            .await
            .map_err(|error| RpcFailure::Request(format!("read LAN computer response failed: {error}")))?;
        if status.as_u16() == 401 {
            return Err(RpcFailure::Unauthorized(http_error(
                "call LAN computer",
                status.as_u16(),
                &bytes,
            )));
        }
        if !status.is_success() {
            return Err(RpcFailure::Request(http_error(
                "call LAN computer",
                status.as_u16(),
                &bytes,
            )));
        }
        let payload: RpcResponse = serde_json::from_slice(&bytes)
            .map_err(|error| RpcFailure::Request(format!("decode LAN computer response failed: {error}")))?;
        if payload.ok != Some(true) {
            return Err(RpcFailure::Request(
                payload
                    .error
                    .unwrap_or_else(|| format!("LAN computer command failed: {command}")),
            ));
        }
        Ok(payload.result.unwrap_or(Value::Null))
    }

    fn persist(&self, session: Option<&StoredLanPcSession>) -> Result<(), String> {
        match session {
            Some(session) => {
                let bytes = serde_json::to_vec(session)
                    .map_err(|error| format!("encode protected LAN computer session failed: {error}"))?;
                self.vault.set_namespaced_secret(SESSION_STORE_KEY, &bytes)
            }
            None => self.vault.remove_namespaced_secret(SESSION_STORE_KEY),
        }
    }
}

fn take_sse_frame(buffer: &mut String) -> Option<String> {
    let lf = buffer.find("\n\n").map(|index| (index, 2));
    let crlf = buffer.find("\r\n\r\n").map(|index| (index, 4));
    let (index, separator_len) = match (lf, crlf) {
        (Some(left), Some(right)) => {
            if left.0 <= right.0 {
                left
            } else {
                right
            }
        }
        (Some(found), None) | (None, Some(found)) => found,
        (None, None) => return None,
    };
    let frame = buffer[..index].to_string();
    buffer.drain(..index + separator_len);
    Some(frame)
}

fn sse_frame_data(frame: &str) -> Option<String> {
    let lines = frame
        .lines()
        .filter_map(|line| line.trim_end_matches('\r').strip_prefix("data:"))
        .map(|line| line.strip_prefix(' ').unwrap_or(line))
        .collect::<Vec<_>>();
    (!lines.is_empty()).then(|| lines.join("\n"))
}

enum RpcFailure {
    Unauthorized(String),
    Request(String),
}

impl RpcFailure {
    fn into_message(self) -> String {
        match self {
            Self::Unauthorized(message) | Self::Request(message) => message,
        }
    }
}

fn public_status(session: Option<&StoredLanPcSession>) -> LanPcClientStatus {
    LanPcClientStatus {
        paired: session.is_some(),
        base_url: session.map(|value| value.base_url.clone()),
        device_id: session.map(|value| value.device_id.clone()),
        expires_at: session.map(|value| value.expires_at),
    }
}

fn normalize_base_url(value: &str) -> Result<String, String> {
    let raw = value.trim();
    if raw.is_empty() {
        return Err("LAN computer address is required".to_string());
    }
    let raw = if raw.contains("://") {
        raw.to_string()
    } else {
        format!("http://{raw}")
    };
    let mut url =
        reqwest::Url::parse(&raw).map_err(|error| format!("LAN computer address is invalid: {error}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("LAN computer address must use HTTP or HTTPS".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("LAN computer address must not contain credentials".to_string());
    }
    if url.port().is_none() && url.scheme() == "http" {
        url.set_port(Some(DEFAULT_LAN_PORT))
            .map_err(|_| "LAN computer port is invalid".to_string())?;
    }
    url.set_path("/");
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn endpoint(base_url: &str, path: &str) -> Result<reqwest::Url, String> {
    reqwest::Url::parse(&format!("{}/{}", base_url.trim_end_matches('/'), path.trim_start_matches('/')))
        .map_err(|error| format!("build LAN computer endpoint failed: {error}"))
}

fn parse_session_cookie(value: &str) -> Option<String> {
    value
        .split(';')
        .next()?
        .trim()
        .strip_prefix(&format!("{SESSION_COOKIE_NAME}="))
        .map(ToOwned::to_owned)
        .filter(|value| !value.is_empty())
}

fn session_cookie(token: &str) -> String {
    format!("{SESSION_COOKIE_NAME}={token}")
}

fn http_error(context: &str, status: u16, bytes: &[u8]) -> String {
    let detail = serde_json::from_slice::<Value>(bytes)
        .ok()
        .and_then(|value| value.get("error").and_then(Value::as_str).map(ToOwned::to_owned))
        .unwrap_or_else(|| "the remote computer rejected the request".to_string());
    format!("{context} failed (HTTP {status}): {detail}")
}
