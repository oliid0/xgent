use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::header::{ACCEPT, CONTENT_TYPE, COOKIE, ORIGIN, SET_COOKIE};
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worker_registration_error: Option<String>,
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
    #[serde(default)]
    subscription_id: Option<String>,
    #[serde(default)]
    payload: Value,
    #[serde(default)]
    session_revoked: bool,
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
    closed: bool,
}

struct EventSubscription {
    session: StoredLanPcSession,
    task: JoinHandle<()>,
    relay_id: String,
    app: tauri::AppHandle,
}

impl EventSubscription {
    fn stop(self) {
        self.task.abort();
        let _ = self.app.emit(LAN_PC_RELAY_EVENT, LanPcRelayedEvent {
            subscription_id: self.relay_id, payload: Value::Null, closed: true,
        });
    }
}

pub struct LanPcClient {
    vault: Arc<CloudSecretVault>,
    session_store_key: Vec<u8>,
    http: reqwest::Client,
    event_http: reqwest::Client,
    tailnet_http: OnceLock<reqwest::Client>,
    tailnet_event_http: OnceLock<reqwest::Client>,
    session: Mutex<Option<StoredLanPcSession>>,
    refresh_lock: Mutex<()>,
    subscriptions: Mutex<HashMap<String, EventSubscription>>,
}

impl LanPcClient {
    pub fn new(vault: Arc<CloudSecretVault>) -> Result<Self, String> {
        Self::new_with_namespace(vault, SESSION_STORE_KEY.to_vec())
    }

    pub(crate) fn new_with_namespace(vault: Arc<CloudSecretVault>, session_store_key: Vec<u8>) -> Result<Self, String> {
        let session = match vault.namespaced_secret(&session_store_key)? {
            Some(bytes) => Some(
                serde_json::from_slice(&bytes)
                    .map_err(|error| format!("read protected LAN computer session failed: {error}"))?,
            ),
            None => None,
        };
        // Ordinary app/LAN startup must not bind an optional overlay proxy.
        let http = Self::http_builder(false).build()
            .map_err(|error| format!("initialize LAN computer client failed: {error}"))?;
        let event_http = Self::http_builder(true).build()
            .map_err(|error| format!("initialize LAN computer event client failed: {error}"))?;
        Ok(Self {
            vault,
            session_store_key,
            http,
            event_http,
            tailnet_http: OnceLock::new(),
            tailnet_event_http: OnceLock::new(),
            session: Mutex::new(session),
            refresh_lock: Mutex::new(()),
            subscriptions: Mutex::new(HashMap::new()),
        })
    }

    fn http_builder(events: bool) -> reqwest::ClientBuilder {
        let builder = reqwest::Client::builder().no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .connect_timeout(Duration::from_secs(4));
        // SSE is long lived; only RPC inherits the end-to-end timeout.
        if events { builder } else { builder.timeout(Duration::from_secs(11 * 60)) }
    }

    fn http_for(&self, base_url: &str, events: bool) -> Result<&reqwest::Client, String> {
        if !super::embedded_tailnet::uses_transport(base_url) {
            return Ok(if events { &self.event_http } else { &self.http });
        }
        let slot = if events { &self.tailnet_event_http } else { &self.tailnet_http };
        if let Some(client) = slot.get() { return Ok(client); }
        // Failure is scoped to this Tailnet request. Never send its credentials
        // through the direct client, and permit a later initialization retry.
        let client = super::embedded_tailnet::with_proxy(Self::http_builder(events))?
            .build().map_err(|_| "tailscale-engine-unavailable".to_string())?;
        let _ = slot.set(client);
        slot.get().ok_or_else(|| "tailscale-engine-unavailable".into())
    }

    pub async fn status(&self) -> LanPcClientStatus {
        let session = self.session.lock().await;
        public_status(session.as_ref())
    }

    /// Probe and export the exact same authenticated session. Pairing another
    /// computer concurrently cannot attach its credentials to the probed host.
    pub(crate) async fn export_worker_session(&self) -> Result<(Value, String, String, Vec<u8>), String> {
        let session = self.session_snapshot(None).await?;
        let info = self.send_rpc(&session, "automation_background_host_info", json!({}))
            .await.map_err(RpcFailure::into_message)?;
        let bytes = serde_json::to_vec(&session).map_err(|e| e.to_string())?;
        Ok((info, session.base_url, session.device_id, bytes))
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
            .http_for(&base_url, false)?
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
        let _refresh_guard = self.refresh_lock.lock().await;
        self.persist(Some(&next))?;
        let status = public_status(Some(&next));
        let mut session = self.session.lock().await;
        *session = Some(next);
        for (_, subscription) in std::mem::take(&mut *self.subscriptions.lock().await) {
            subscription.stop();
        }
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
        let _refresh_guard = self.refresh_lock.lock().await;
        let mut session = self.session.lock().await;
        let running = std::mem::take(&mut *self.subscriptions.lock().await);
        for (_, subscription) in running {
            subscription.stop();
        }
        self.persist(None)?;
        *session = None;
        Ok(public_status(None))
    }

    /// Registry removal owns protected-store deletion. Retire in-memory
    /// credentials too, including subscriptions captured before that removal.
    pub(crate) async fn retire(&self) {
        let _refresh_guard = self.refresh_lock.lock().await;
        let mut session = self.session.lock().await;
        *session = None;
        for (_, subscription) in std::mem::take(&mut *self.subscriptions.lock().await) {
            subscription.stop();
        }
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
        if current.device_id != session.device_id || current.session_token != session.session_token {
            return Err("Original computer pairing changed during the request".into());
        }
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
        relay_id: &str,
        app_handle: tauri::AppHandle,
    ) -> Result<LanPcSubscription, String> {
        let event = event.trim();
        if event.is_empty() {
            return Err("LAN computer event name cannot be empty".to_string());
        }
        let relay_id = uuid::Uuid::parse_str(relay_id).map_err(|_| "Invalid event relay identity".to_string())?.to_string();
        // Registration and CSRF rotation share a short, bounded critical
        // section. Ordinary successful commands remain concurrent.
        let _refresh_guard = self.refresh_lock.lock().await;
        let mut session = self.session_snapshot(expected_base_url).await?;

        // Open the event stream before registering the remote subscription so
        // the first terminal/process event cannot race past the mobile client.
        let stream_response = tokio::time::timeout(Duration::from_secs(8), self
            .http_for(&session.base_url, true)?
            .get(endpoint(&session.base_url, "api/local-access/events")?)
            .query(&[("streamId", &relay_id)])
            .header(ACCEPT, "text/event-stream")
            .header(ORIGIN, &session.base_url)
            .header(COOKIE, session_cookie(&session.session_token))
            .send())
            .await.map_err(|_| "LAN computer event handshake timed out".to_string())?
            .map_err(|error| format!("open LAN computer event stream failed: {error}"))?;
        let stream_status = stream_response.status();
        if !stream_status.is_success() {
            let bytes = tokio::time::timeout(Duration::from_secs(8), stream_response.bytes())
                .await.map_err(|_| "LAN computer event error response timed out".to_string())?
                .map_err(|error| format!("read LAN computer event stream failure failed: {error}"))?;
            return Err(http_error(
                "open LAN computer event stream",
                stream_status.as_u16(),
                &bytes,
            ));
        }
        if !stream_response.headers().get(CONTENT_TYPE).and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.split(';').next().is_some_and(|mime| mime.trim().eq_ignore_ascii_case("text/event-stream"))) {
            return Err("LAN computer did not return an event stream".into());
        }

        let mut response = self
            .http_for(&session.base_url, false)?
            .post(endpoint(&session.base_url, "api/local-access/subscriptions")?)
            .header(ORIGIN, &session.base_url)
            .header(COOKIE, session_cookie(&session.session_token))
            .header(CSRF_HEADER, &session.csrf_token)
            .json(&json!({ "event": event, "streamId": relay_id }))
            .timeout(Duration::from_secs(8))
            .send()
            .await
            .map_err(|error| format!("subscribe to LAN computer event failed: {error}"))?;
        // The server authenticates before creating a subscription. Only its
        // explicit 401 permits this retry; a lost response remains unknown.
        if response.status().as_u16() == 401 {
            session = self.refresh_session(&session).await?;
            self.persist(Some(&session))?;
            *self.session.lock().await = Some(session.clone());
            response = self.http_for(&session.base_url, false)?
                .post(endpoint(&session.base_url, "api/local-access/subscriptions")?)
                .header(ORIGIN, &session.base_url)
                .header(COOKIE, session_cookie(&session.session_token))
                .header(CSRF_HEADER, &session.csrf_token)
                .json(&json!({ "event": event, "streamId": relay_id }))
                .timeout(Duration::from_secs(8))
                .send().await.map_err(|error| format!("subscribe to LAN computer event failed: {error}"))?;
        }
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
        let owner = self.session.lock().await;
        if !owner.as_ref().is_some_and(|current| current.device_id == session.device_id
            && current.session_token == session.session_token) {
            return Err("Original computer pairing changed during event subscription".into());
        }
        let task_relay_id = relay_id.clone();
        let task_app = app_handle.clone();
        let task = tokio::spawn(async move {
            let mut stream = stream_response.bytes_stream();
            let mut buffer = Vec::new();
            // The server sends a keepalive every 15s. Detect a half-open socket
            // as well as EOF so the owner can select another paired endpoint.
            'events: while let Ok(Some(chunk)) = tokio::time::timeout(Duration::from_secs(45), stream.next()).await {
                let Ok(chunk) = chunk else {
                    break;
                };
                if chunk.len() > (16 * 1024 * 1024usize).saturating_sub(buffer.len()) { break; }
                buffer.extend_from_slice(&chunk);
                while let Some(frame) = take_sse_frame(&mut buffer) {
                    let Some(data) = sse_frame_data(&frame) else {
                        continue;
                    };
                    let Ok(envelope) = serde_json::from_str::<RemoteEventEnvelope>(&data) else {
                        continue;
                    };
                    if envelope.session_revoked { break 'events; }
                    if envelope.subscription_id.as_deref() != Some(&expected_subscription_id) {
                        continue;
                    }
                    let _ = task_app.emit(
                        LAN_PC_RELAY_EVENT,
                        LanPcRelayedEvent {
                            subscription_id: task_relay_id.clone(),
                            payload: envelope.payload,
                            closed: false,
                        },
                    );
                }
            }
            let _ = task_app.emit(LAN_PC_RELAY_EVENT, LanPcRelayedEvent {
                subscription_id: task_relay_id, payload: Value::Null, closed: true,
            });
        });
        if let Some(previous) = self
            .subscriptions
            .lock()
            .await
            .insert(subscription_id.clone(), EventSubscription { session, task, relay_id, app: app_handle })
        {
            previous.stop();
        }
        Ok(LanPcSubscription { subscription_id })
    }

    pub async fn unsubscribe(&self, subscription_id: &str) -> Result<(), String> {
        let subscription_id = subscription_id.trim();
        if subscription_id.is_empty() {
            return Ok(());
        }
        let subscription = match self.subscriptions.lock().await.remove(subscription_id) {
            Some(subscription) => subscription,
            None => return Ok(()),
        };
        let captured = subscription.session.clone();
        subscription.stop();
        let _refresh_guard = self.refresh_lock.lock().await;
        // A rotation on this same session changes CSRF, not ownership. Never
        // use a newly paired computer's credentials to clean up an old stream.
        let mut session = self.session.lock().await.as_ref()
            .filter(|current| same_session(current, &captured)).cloned().unwrap_or(captured.clone());
        let mut response = self.delete_subscription(&session, subscription_id).await?;
        if response.status().as_u16() == 401 && self.session.lock().await.as_ref()
            .is_some_and(|current| same_session(current, &captured)) {
            session = self.refresh_session(&session).await?;
            self.persist(Some(&session))?;
            *self.session.lock().await = Some(session.clone());
            response = self.delete_subscription(&session, subscription_id).await?;
        }
        if !response.status().is_success() {
            let status = response.status();
            let bytes = response.bytes().await.map_err(|error| {
                format!("read LAN computer unsubscribe response failed: {error}")
            })?;
            return Err(http_error("unsubscribe from LAN computer event", status.as_u16(), &bytes));
        }
        Ok(())
    }

    async fn delete_subscription(&self, session: &StoredLanPcSession, subscription_id: &str) -> Result<reqwest::Response, String> {
        self
            .http_for(&session.base_url, false)?
            .delete(endpoint(
                &session.base_url,
                &format!("api/local-access/subscriptions/{subscription_id}"),
            )?)
            .header(ORIGIN, &session.base_url)
            .header(COOKIE, session_cookie(&session.session_token))
            .header(CSRF_HEADER, &session.csrf_token)
            .timeout(Duration::from_secs(8))
            .send()
            .await
            .map_err(|error| format!("unsubscribe from LAN computer event failed: {error}"))
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
            .http_for(&session.base_url, false)?
            .post(endpoint(&session.base_url, "api/local-access/session")?)
            .header(ORIGIN, &session.base_url)
            .header(COOKIE, session_cookie(&session.session_token))
            .timeout(Duration::from_secs(8))
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
            .http_for(&session.base_url, false).map_err(RpcFailure::Request)?
            .post(target)
            .header(ORIGIN, &session.base_url)
            .header(COOKIE, session_cookie(&session.session_token))
            .header(CSRF_HEADER, &session.csrf_token)
            .json(&json!({ "command": command, "args": args }))
            .send()
            .await
            .map_err(|error| RpcFailure::Request(format!("call LAN computer failed: {error}")))?;
        let status = response.status();
        let bytes = if command == "automation_background_read_artifact" || command == "automation_background_read_artifact_chunk" {
            // 8 MiB binary snapshots expand to ~10.7 MiB base64. Bound the
            // actual wire body before parsing, including chunked responses.
            const LIMIT: usize = 16 * 1024 * 1024;
            if response.content_length().is_some_and(|size| size > LIMIT as u64) {
                return Err(RpcFailure::Request("LAN artifact response exceeds 16 MiB".into()));
            }
            let mut stream = response.bytes_stream();
            let mut bytes = Vec::new();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|error| RpcFailure::Request(format!("read LAN artifact response failed: {error}")))?;
                if chunk.len() > LIMIT.saturating_sub(bytes.len()) {
                    return Err(RpcFailure::Request("LAN artifact response exceeds 16 MiB".into()));
                }
                bytes.extend_from_slice(&chunk);
            }
            bytes
        } else {
            response.bytes().await
                .map_err(|error| RpcFailure::Request(format!("read LAN computer response failed: {error}")))?.to_vec()
        };
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
                self.vault.set_namespaced_secret(&self.session_store_key, &bytes)
            }
            None => self.vault.remove_namespaced_secret(&self.session_store_key),
        }
    }
}

fn same_session(left: &StoredLanPcSession, right: &StoredLanPcSession) -> bool {
    left.base_url == right.base_url && left.device_id == right.device_id && left.session_token == right.session_token
}

fn take_sse_frame(buffer: &mut Vec<u8>) -> Option<String> {
    let lf = buffer.windows(2).position(|bytes| bytes == b"\n\n").map(|index| (index, 2));
    let crlf = buffer.windows(4).position(|bytes| bytes == b"\r\n\r\n").map(|index| (index, 4));
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
    // Decode complete frames, never individual transport chunks: UTF-8 code
    // points can be split across two reads.
    let frame = String::from_utf8_lossy(&buffer[..index]).into_owned();
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
        worker_registration_error: None,
    }
}

pub(crate) fn normalize_base_url(value: &str) -> Result<String, String> {
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
    let explicit_http_default=raw.split_once("://").and_then(|(_,rest)|rest.split(['/', '?', '#']).next())
        .and_then(|authority|authority.rsplit_once(':')).is_some_and(|(_,port)|port.parse::<u16>().ok()==Some(80)) && url.scheme()=="http";
    if url.port().is_none() && url.scheme() == "http" && !explicit_http_default {
        url.set_port(Some(DEFAULT_LAN_PORT))
            .map_err(|_| "LAN computer port is invalid".to_string())?;
    }
    url.set_path("/");
    url.set_query(None);
    url.set_fragment(None);
    let normalized=url.as_str().trim_end_matches('/');
    Ok(if explicit_http_default {format!("{normalized}:80")} else {normalized.to_string()})
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sse_decodes_utf8_only_after_a_complete_frame() {
        let source = "data: {\"text\":\"你好🌍\"}\r\n\r\n".as_bytes();
        let mut buffer = Vec::new();
        for byte in &source[..source.len() - 1] {
            buffer.push(*byte);
            assert!(take_sse_frame(&mut buffer).is_none());
        }
        buffer.push(source[source.len() - 1]);
        let frame = take_sse_frame(&mut buffer).unwrap();
        assert_eq!(sse_frame_data(&frame).unwrap(), "{\"text\":\"你好🌍\"}");
        assert!(buffer.is_empty());
    }

    #[test]
    fn sse_handles_mixed_frame_delimiters_without_merging_events() {
        let mut buffer = b": keepalive\n\ndata: one\r\n\r\ndata: two\ndata: three\n\n".to_vec();
        assert!(sse_frame_data(&take_sse_frame(&mut buffer).unwrap()).is_none());
        assert_eq!(sse_frame_data(&take_sse_frame(&mut buffer).unwrap()).unwrap(), "one");
        assert_eq!(sse_frame_data(&take_sse_frame(&mut buffer).unwrap()).unwrap(), "two\nthree");
        assert!(buffer.is_empty());
    }
}
