use std::collections::{HashMap, VecDeque};
use std::convert::Infallible;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::body::{to_bytes, Body};
use axum::extract::{ConnectInfo, DefaultBodyLimit, OriginalUri, Path, State};
use axum::http::header::{
    CACHE_CONTROL, CONTENT_SECURITY_POLICY, CONTENT_TYPE, COOKIE, HOST, ORIGIN, REFERER, SET_COOKIE,
};
use axum::http::{HeaderMap, HeaderValue, Method, Request, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::Emitter;
use tokio::sync::{broadcast, oneshot};
use uuid::Uuid;

use crate::commands::settings::{load_access_settings, open_db, AccessSettingsPayload};
use crate::services::proxy::ProxyServerInfo;

const DEFAULT_PORT: u16 = 28_367;
const PAIRING_CODE_TTL: Duration = Duration::from_secs(10 * 60);
const DEVICE_SESSION_TTL_SECS: i64 = 30 * 24 * 60 * 60;
const MAX_PAIR_ATTEMPTS_PER_MINUTE: usize = 10;
const MAX_PAIRING_BODY_BYTES: usize = 4 * 1024;
const MAX_RPC_BODY_BYTES: usize = 16 * 1024 * 1024;
const RPC_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const SESSION_COOKIE: &str = "xgent_session";
const CSRF_HEADER: &str = "x-xgent-csrf";
const PROXY_TOKEN_HEADER: &str = "x-xgent-proxy-token";
const PROVIDER_CONFIG_ID_HEADER: &str = "x-xgent-provider-config-id";
const LOCAL_ACCESS_STATUS_EVENT: &str = "local-access:status";
const LOCAL_ACCESS_RPC_REQUEST_EVENT: &str = "local-access:rpc-request";
const LOCAL_ACCESS_SUBSCRIBE_EVENT: &str = "local-access:event-subscribe";
const LOCAL_ACCESS_UNSUBSCRIBE_EVENT: &str = "local-access:event-unsubscribe";
const LOCAL_ACCESS_SECRET_SENTINEL: &str = "__XGENT_LOCAL_ACCESS_SECRET__";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAccessStatus {
    pub enabled: bool,
    pub running: bool,
    pub bind_address: String,
    pub port: u16,
    pub urls: Vec<String>,
    pub paired_devices: usize,
    pub devices: Vec<LocalAccessDevice>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pairing_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pairing_code_expires_at: Option<i64>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAccessDevice {
    pub device_id: String,
    pub label: String,
    pub created_at: i64,
    pub last_seen_at: i64,
    pub expires_at: i64,
}

#[derive(Debug, Clone)]
struct PairingCode {
    plaintext: String,
    hash: String,
    expires_at_ms: i64,
}

#[derive(Default)]
struct PairAttemptWindow {
    attempts: HashMap<IpAddr, VecDeque<Instant>>,
}

pub struct LocalAccessController {
    app_handle: tauri::AppHandle,
    proxy_info: ProxyServerInfo,
    proxy_client: reqwest::Client,
    config: Mutex<AccessSettingsPayload>,
    status: Mutex<LocalAccessStatus>,
    pairing_code: Mutex<Option<PairingCode>>,
    pair_attempts: Mutex<PairAttemptWindow>,
    pending_rpc: Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>,
    subscriptions: Mutex<HashMap<String, LocalEventSubscription>>,
    latest_conversation_selection: Mutex<Option<Value>>,
    event_tx: broadcast::Sender<LocalBrowserEvent>,
    shutdown: Mutex<Option<oneshot::Sender<()>>>,
    server_task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairDeviceRequest {
    code: String,
    device_name: String,
}

#[derive(Debug, Deserialize)]
struct LocalProxyPath {
    provider: String,
    #[serde(rename = "rest")]
    _rest: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PairDeviceResponse {
    paired: bool,
    device_id: String,
    csrf_token: String,
    expires_at: i64,
}

#[derive(Debug)]
struct DeviceSession {
    device_id: String,
    csrf_hash: String,
    expires_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalRpcPayload {
    command: String,
    #[serde(default)]
    args: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalRpcRequestEvent {
    request_id: String,
    command: String,
    args: Value,
}

#[derive(Debug, Deserialize)]
struct SubscribeRequest {
    event: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SubscribeResponse {
    subscription_id: String,
}

#[derive(Debug, Clone)]
struct LocalEventSubscription {
    device_id: String,
    event: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalEventSubscriptionRequest {
    subscription_id: String,
    event: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalEventUnsubscribeRequest {
    subscription_id: String,
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalBrowserEvent {
    device_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    subscription_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    payload: Option<Value>,
    #[serde(default, skip_serializing_if = "is_false")]
    session_revoked: bool,
}

impl LocalAccessController {
    pub fn new(app_handle: tauri::AppHandle, proxy_info: ProxyServerInfo) -> Result<Self, String> {
        let (event_tx, _) = broadcast::channel(512);
        let proxy_client = reqwest::Client::builder()
            // This client only reaches Xgent's loopback proxy. Inheriting
            // HTTP(S)_PROXY here can send that local hop to an upstream proxy
            // and turn otherwise valid WebUI requests into 502/CORS failures.
            .no_proxy()
            .build()
            .map_err(|error| format!("initialize local WebUI proxy client failed: {error}"))?;
        Ok(Self {
            app_handle,
            proxy_info,
            proxy_client,
            config: Mutex::new(AccessSettingsPayload::default()),
            status: Mutex::new(LocalAccessStatus {
                enabled: false,
                running: false,
                bind_address: String::new(),
                port: DEFAULT_PORT,
                urls: Vec::new(),
                paired_devices: 0,
                devices: Vec::new(),
                pairing_code: None,
                pairing_code_expires_at: None,
                last_error: None,
            }),
            pairing_code: Mutex::new(None),
            pair_attempts: Mutex::new(PairAttemptWindow::default()),
            pending_rpc: Mutex::new(HashMap::new()),
            subscriptions: Mutex::new(HashMap::new()),
            latest_conversation_selection: Mutex::new(None),
            event_tx,
            shutdown: Mutex::new(None),
            server_task: Mutex::new(None),
        })
    }

    pub async fn reload_from_db(self: &Arc<Self>) -> Result<(), String> {
        let config = tauri::async_runtime::spawn_blocking(|| {
            let conn = open_db()?;
            load_access_settings(&conn)
        })
        .await
        .map_err(|error| format!("load local access settings join failed: {error}"))??;
        self.apply_config(config)
    }

    pub fn apply_config(self: &Arc<Self>, config: AccessSettingsPayload) -> Result<(), String> {
        let previous = self
            .config
            .lock()
            .map_err(|_| "local access config lock poisoned".to_string())?
            .clone();
        {
            let mut current = self
                .config
                .lock()
                .map_err(|_| "local access config lock poisoned".to_string())?;
            *current = config.clone();
        }

        let requires_restart = previous.web_ui_enabled != config.web_ui_enabled
            || previous.web_ui_scope != config.web_ui_scope
            || previous.web_ui_port != config.web_ui_port;
        if !requires_restart {
            self.publish_status();
            return Ok(());
        }

        self.stop_server()?;
        if !config.web_ui_enabled {
            self.update_server_status(false, String::new(), config.web_ui_port, None)?;
            return Ok(());
        }

        self.ensure_pairing_code()?;
        let controller = Arc::clone(self);
        let bind_address = if config.web_ui_scope == "loopback" {
            IpAddr::V4(Ipv4Addr::LOCALHOST)
        } else {
            IpAddr::V4(Ipv4Addr::UNSPECIFIED)
        };
        let port = config.web_ui_port.max(1);
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        *self
            .shutdown
            .lock()
            .map_err(|_| "local access shutdown lock poisoned".to_string())? = Some(shutdown_tx);
        let task = tauri::async_runtime::spawn(async move {
            if let Err(error) = controller
                .run_server(SocketAddr::new(bind_address, port), shutdown_rx)
                .await
            {
                let _ = controller.update_server_status(
                    false,
                    bind_address.to_string(),
                    port,
                    Some(error),
                );
            }
        });
        *self
            .server_task
            .lock()
            .map_err(|_| "local access server task lock poisoned".to_string())? = Some(task);
        Ok(())
    }

    pub fn status(&self) -> Result<LocalAccessStatus, String> {
        let enabled = self
            .config
            .lock()
            .map_err(|_| "local access config lock poisoned".to_string())?
            .web_ui_enabled;
        let mut status = self
            .status
            .lock()
            .map_err(|_| "local access status lock poisoned".to_string())?
            .clone();
        status.enabled = enabled;
        status.devices = list_paired_devices()?;
        status.paired_devices = status.devices.len();
        let pairing = self.current_pairing_code()?;
        status.pairing_code = pairing.as_ref().map(|value| value.plaintext.clone());
        status.pairing_code_expires_at = pairing.map(|value| value.expires_at_ms);
        Ok(status)
    }

    pub fn rotate_pairing_code(&self) -> Result<LocalAccessStatus, String> {
        let code = pairing_code_from_uuid(Uuid::new_v4());
        let pairing = PairingCode {
            hash: hash_text(&code),
            plaintext: code,
            expires_at_ms: now_ms() + PAIRING_CODE_TTL.as_millis() as i64,
        };
        *self
            .pairing_code
            .lock()
            .map_err(|_| "local access pairing lock poisoned".to_string())? = Some(pairing);
        self.publish_status();
        self.status()
    }

    pub fn revoke_all_devices(&self) -> Result<LocalAccessStatus, String> {
        let device_ids = list_paired_devices()?
            .into_iter()
            .map(|device| device.device_id)
            .collect::<Vec<_>>();
        let conn = open_db()?;
        conn.execute(
            "UPDATE local_access_devices SET revoked_at = ?1 WHERE revoked_at IS NULL",
            params![now_ms()],
        )
        .map_err(|error| format!("revoke local access devices failed: {error}"))?;
        for device_id in device_ids {
            self.notify_device_revoked(&device_id);
            self.remove_device_subscriptions(&device_id)?;
        }
        self.rotate_pairing_code()
    }

    pub fn revoke_device(&self, device_id: &str) -> Result<LocalAccessStatus, String> {
        let device_id = device_id.trim();
        if device_id.is_empty() || device_id.len() > 128 {
            return Err("paired device id is invalid".to_string());
        }
        let conn = open_db()?;
        let changed = conn
            .execute(
                "UPDATE local_access_devices
                 SET revoked_at = ?1
                 WHERE device_id = ?2 AND revoked_at IS NULL",
                params![now_ms(), device_id],
            )
            .map_err(|error| format!("revoke paired device failed: {error}"))?;
        if changed == 0 {
            return Err("paired device was not found".to_string());
        }
        self.notify_device_revoked(device_id);
        self.remove_device_subscriptions(device_id)?;
        self.publish_status();
        self.status()
    }

    fn remove_device_subscriptions(&self, device_id: &str) -> Result<(), String> {
        let removed = {
            let mut subscriptions = self
                .subscriptions
                .lock()
                .map_err(|_| "local access subscription lock poisoned".to_string())?;
            let ids = subscriptions
                .iter()
                .filter_map(|(subscription_id, subscription)| {
                    (subscription.device_id == device_id).then(|| subscription_id.clone())
                })
                .collect::<Vec<_>>();
            for subscription_id in &ids {
                subscriptions.remove(subscription_id);
            }
            ids
        };
        for subscription_id in removed {
            let _ = self.app_handle.emit(
                LOCAL_ACCESS_UNSUBSCRIBE_EVENT,
                LocalEventUnsubscribeRequest { subscription_id },
            );
        }
        Ok(())
    }

    fn notify_device_revoked(&self, device_id: &str) {
        let _ = self.event_tx.send(LocalBrowserEvent {
            device_id: device_id.to_string(),
            subscription_id: None,
            payload: None,
            session_revoked: true,
        });
    }

    fn ensure_pairing_code(&self) -> Result<(), String> {
        if self.current_pairing_code()?.is_none() {
            self.rotate_pairing_code()?;
        }
        Ok(())
    }

    fn current_pairing_code(&self) -> Result<Option<PairingCode>, String> {
        let mut slot = self
            .pairing_code
            .lock()
            .map_err(|_| "local access pairing lock poisoned".to_string())?;
        if slot
            .as_ref()
            .is_some_and(|pairing| pairing.expires_at_ms <= now_ms())
        {
            *slot = None;
        }
        Ok(slot.clone())
    }

    fn stop_server(&self) -> Result<(), String> {
        if let Some(shutdown) = self
            .shutdown
            .lock()
            .map_err(|_| "local access shutdown lock poisoned".to_string())?
            .take()
        {
            let _ = shutdown.send(());
        }
        if let Some(task) = self
            .server_task
            .lock()
            .map_err(|_| "local access server task lock poisoned".to_string())?
            .take()
        {
            task.abort();
        }
        Ok(())
    }

    async fn run_server(
        self: &Arc<Self>,
        address: SocketAddr,
        shutdown: oneshot::Receiver<()>,
    ) -> Result<(), String> {
        let listener = tokio::net::TcpListener::bind(address)
            .await
            .map_err(|error| format!("bind local Web UI on {address} failed: {error}"))?;
        let actual = listener
            .local_addr()
            .map_err(|error| format!("read local Web UI address failed: {error}"))?;
        self.update_server_status(true, address.ip().to_string(), actual.port(), None)?;

        let router = Router::new()
            .route("/api/local-access/status", get(public_status))
            .route(
                "/api/local-access/pair",
                post(pair_device).layer(DefaultBodyLimit::max(MAX_PAIRING_BODY_BYTES)),
            )
            .route("/api/local-access/session", post(refresh_session))
            .route("/api/local-access/rpc", post(local_rpc))
            .route(
                "/api/local-access/proxy/{provider}",
                axum::routing::any(local_provider_proxy),
            )
            .route(
                "/api/local-access/proxy/{provider}/{*rest}",
                axum::routing::any(local_provider_proxy),
            )
            .route(
                "/api/local-access/image-proxy",
                axum::routing::any(local_image_proxy),
            )
            .route("/api/local-access/events", get(event_stream))
            .route("/api/local-access/subscriptions", post(subscribe_event))
            .route(
                "/api/local-access/subscriptions/{subscription_id}",
                delete(unsubscribe_event),
            )
            .route("/", get(index_asset))
            .route("/{*path}", get(static_asset))
            .layer(DefaultBodyLimit::max(MAX_RPC_BODY_BYTES))
            .with_state(Arc::clone(self));

        axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(async move {
            let _ = shutdown.await;
        })
        .await
        .map_err(|error| format!("local Web UI server failed: {error}"))?;
        self.update_server_status(false, address.ip().to_string(), actual.port(), None)?;
        Ok(())
    }

    fn update_server_status(
        &self,
        running: bool,
        bind_address: String,
        port: u16,
        last_error: Option<String>,
    ) -> Result<(), String> {
        let config = self
            .config
            .lock()
            .map_err(|_| "local access config lock poisoned".to_string())?
            .clone();
        let mut status = self
            .status
            .lock()
            .map_err(|_| "local access status lock poisoned".to_string())?;
        status.running = running;
        status.bind_address = bind_address;
        status.port = port;
        status.urls = if running {
            local_access_urls(&config, port)
        } else {
            Vec::new()
        };
        status.last_error = last_error;
        drop(status);
        self.publish_status();
        Ok(())
    }

    fn publish_status(&self) {
        if let Ok(status) = self.status() {
            let _ = self.app_handle.emit(LOCAL_ACCESS_STATUS_EVENT, status);
        }
    }

    fn validate_request_origin(&self, headers: &HeaderMap) -> Result<(), String> {
        let host = headers
            .get(HOST)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| "missing Host header".to_string())?;
        if !is_allowed_host(host, self.status()?.port) {
            return Err("Host is not a local Xgent address".to_string());
        }
        let expected_origin = format!("http://{host}");
        if let Some(origin) = headers.get(ORIGIN).and_then(|value| value.to_str().ok()) {
            if origin != expected_origin {
                return Err("Origin does not match the local Xgent host".to_string());
            }
            return Ok(());
        }
        let same_origin_fetch = headers
            .get("sec-fetch-site")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.eq_ignore_ascii_case("same-origin"));
        let matching_referer = headers
            .get(REFERER)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value == expected_origin || value.starts_with(&format!("{expected_origin}/")));
        // EventSource does not consistently send both Referer and
        // Sec-Fetch-Site. Host is already restricted to the active local
        // server above, so either browser signal is sufficient here.
        if !same_origin_fetch && !matching_referer {
            return Err("request is missing same-origin browser metadata".to_string());
        }
        Ok(())
    }

    fn record_pair_attempt(&self, address: IpAddr) -> Result<(), String> {
        let mut windows = self
            .pair_attempts
            .lock()
            .map_err(|_| "local access pairing rate-limit lock poisoned".to_string())?;
        let attempts = windows.attempts.entry(address).or_default();
        let cutoff = Instant::now() - Duration::from_secs(60);
        while attempts.front().is_some_and(|attempt| *attempt < cutoff) {
            attempts.pop_front();
        }
        if attempts.len() >= MAX_PAIR_ATTEMPTS_PER_MINUTE {
            return Err("too many pairing attempts; retry in one minute".to_string());
        }
        attempts.push_back(Instant::now());
        Ok(())
    }

    fn validate_pairing_code(&self, provided: &str) -> Result<(), String> {
        let pairing = self
            .current_pairing_code()?
            .ok_or_else(|| "pairing code expired; generate a new code on the desktop".to_string())?;
        if !constant_time_eq(pairing.hash.as_bytes(), hash_text(provided.trim()).as_bytes()) {
            return Err("invalid pairing code".to_string());
        }
        Ok(())
    }

    fn create_device_session(
        &self,
        device_name: &str,
    ) -> Result<(String, String, String, i64), String> {
        let label = device_name.trim();
        if label.is_empty() || label.chars().count() > 64 {
            return Err("device name must contain 1 to 64 characters".to_string());
        }
        let device_id = Uuid::new_v4().to_string();
        let session_token = format!("{}.{}", Uuid::new_v4(), Uuid::new_v4());
        let csrf_token = Uuid::new_v4().to_string();
        let created_at = now_ms();
        let expires_at = created_at + DEVICE_SESSION_TTL_SECS * 1_000;
        let conn = open_db()?;
        conn.execute(
            "INSERT INTO local_access_devices
                (device_id, label, session_hash, csrf_hash, created_at, last_seen_at, expires_at, revoked_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, NULL)",
            params![
                device_id,
                label,
                hash_text(&session_token),
                hash_text(&csrf_token),
                created_at,
                expires_at
            ],
        )
        .map_err(|error| format!("save paired device failed: {error}"))?;
        Ok((device_id, session_token, csrf_token, expires_at))
    }

    fn authenticate(&self, headers: &HeaderMap, require_csrf: bool) -> Result<DeviceSession, String> {
        let token = cookie_value(headers, SESSION_COOKIE)
            .ok_or_else(|| "local access session is missing".to_string())?;
        let token_hash = hash_text(&token);
        let conn = open_db()?;
        let session = conn
            .query_row(
                "SELECT device_id, csrf_hash, expires_at
                 FROM local_access_devices
                 WHERE session_hash = ?1 AND revoked_at IS NULL AND expires_at > ?2",
                params![token_hash, now_ms()],
                |row| {
                    Ok(DeviceSession {
                        device_id: row.get(0)?,
                        csrf_hash: row.get(1)?,
                        expires_at: row.get(2)?,
                    })
                },
            )
            .optional()
            .map_err(|error| format!("read local access session failed: {error}"))?
            .ok_or_else(|| "local access session is invalid or expired".to_string())?;
        if require_csrf {
            let csrf = headers
                .get(CSRF_HEADER)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| "missing CSRF token".to_string())?;
            if !constant_time_eq(hash_text(csrf).as_bytes(), session.csrf_hash.as_bytes()) {
                return Err("invalid CSRF token".to_string());
            }
        }
        conn.execute(
            "UPDATE local_access_devices SET last_seen_at = ?1 WHERE device_id = ?2",
            params![now_ms(), session.device_id],
        )
        .map_err(|error| format!("update paired device activity failed: {error}"))?;
        Ok(session)
    }

    fn rotate_session_csrf(&self, session: &DeviceSession) -> Result<String, String> {
        let csrf = Uuid::new_v4().to_string();
        let conn = open_db()?;
        conn.execute(
            "UPDATE local_access_devices SET csrf_hash = ?1 WHERE device_id = ?2",
            params![hash_text(&csrf), session.device_id],
        )
        .map_err(|error| format!("rotate local access CSRF token failed: {error}"))?;
        Ok(csrf)
    }

    pub fn complete_rpc(
        &self,
        request_id: &str,
        result: Result<Value, String>,
    ) -> Result<(), String> {
        let sender = self
            .pending_rpc
            .lock()
            .map_err(|_| "local access RPC lock poisoned".to_string())?
            .remove(request_id)
            .ok_or_else(|| "local access RPC request is no longer pending".to_string())?;
        sender
            .send(result)
            .map_err(|_| "local access RPC receiver was dropped".to_string())
    }

    pub fn publish_browser_event(
        &self,
        subscription_id: &str,
        payload: Value,
    ) -> Result<(), String> {
        let subscription = self
            .subscriptions
            .lock()
            .map_err(|_| "local access subscription lock poisoned".to_string())?
            .get(subscription_id)
            .cloned()
            .ok_or_else(|| "local access event subscription no longer exists".to_string())?;
        let payload = crate::commands::settings::mask_local_access_automation_event(
            &subscription.event,
            payload,
        )?;
        let _ = self.event_tx.send(LocalBrowserEvent {
            device_id: subscription.device_id,
            subscription_id: Some(subscription_id.to_string()),
            payload: Some(payload),
            session_revoked: false,
        });
        Ok(())
    }

    pub fn broadcast_client_event(&self, event: &str, payload: Value) -> Result<(), String> {
        if event == "xgent:conversation-selection" {
            *self
                .latest_conversation_selection
                .lock()
                .map_err(|_| "local conversation selection lock poisoned".to_string())? =
                Some(payload.clone());
        }
        self.app_handle
            .emit(event, payload)
            .map_err(|error| format!("broadcast local access event failed: {error}"))
    }

    pub fn latest_conversation_selection(&self) -> Result<Option<Value>, String> {
        self.latest_conversation_selection
            .lock()
            .map_err(|_| "local conversation selection lock poisoned".to_string())
            .map(|selection| selection.clone())
    }

    async fn dispatch_rpc(&self, payload: LocalRpcPayload) -> Result<Value, String> {
        let command = payload.command.trim();
        if command.is_empty() {
            return Err("local access RPC command cannot be empty".to_string());
        }
        let config = self
            .config
            .lock()
            .map_err(|_| "local access config lock poisoned".to_string())?
            .clone();
        authorize_local_command(command, &config)?;
        if command == "settings_load_all" {
            return tauri::async_runtime::spawn_blocking(|| {
                let conn = open_db()?;
                crate::commands::settings::load_local_access_settings_snapshot(&conn)
            })
            .await
            .map_err(|error| format!("load local access settings join failed: {error}"))?;
        }
        if command == "automation_snapshot" {
            return tauri::async_runtime::spawn_blocking(|| {
                let conn = open_db()?;
                crate::commands::settings::load_local_access_automation_snapshot(&conn)
            })
            .await
            .map_err(|error| format!("load local access automation join failed: {error}"))?;
        }
        if command == "proxy_get_server_info" {
            return Ok(json!({
                "baseUrl": "/api/local-access",
                "token": "local-access-session"
            }));
        }
        if command == "local_access_status" {
            let mut status = self.status()?;
            status.pairing_code = None;
            status.pairing_code_expires_at = None;
            return serde_json::to_value(status)
                .map_err(|error| format!("serialize local access status failed: {error}"));
        }

        let command_owned = command.to_string();
        let args = if crate::commands::settings::is_local_access_settings_write(command) {
            let args = payload.args;
            tauri::async_runtime::spawn_blocking(move || {
                let conn = open_db()?;
                crate::commands::settings::sanitize_local_access_settings_write(
                    &conn,
                    &command_owned,
                    args,
                )
            })
            .await
            .map_err(|error| format!("sanitize local access settings join failed: {error}"))??
        } else {
            payload.args
        };

        let request_id = Uuid::new_v4().to_string();
        let (sender, receiver) = oneshot::channel();
        self.pending_rpc
            .lock()
            .map_err(|_| "local access RPC lock poisoned".to_string())?
            .insert(request_id.clone(), sender);
        let event = LocalRpcRequestEvent {
            request_id: request_id.clone(),
            command: command.to_string(),
            args,
        };
        if let Err(error) = self.app_handle.emit(LOCAL_ACCESS_RPC_REQUEST_EVENT, event) {
            let _ = self.pending_rpc.lock().map(|mut pending| pending.remove(&request_id));
            return Err(format!("dispatch local access RPC failed: {error}"));
        }
        let outcome = tokio::time::timeout(RPC_TIMEOUT, receiver).await;
        let _ = self.pending_rpc.lock().map(|mut pending| pending.remove(&request_id));
        match outcome {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("local access RPC host bridge stopped".to_string()),
            Err(_) => Err("local access RPC timed out".to_string()),
        }
    }
}

async fn local_provider_proxy(
    State(controller): State<Arc<LocalAccessController>>,
    Path(path): Path<LocalProxyPath>,
    method: Method,
    headers: HeaderMap,
    OriginalUri(original_uri): OriginalUri,
    body: Body,
) -> Response {
    if let Err(error) = controller.validate_request_origin(&headers) {
        return error_response(StatusCode::FORBIDDEN, error);
    }
    if let Err(error) = controller.authenticate(&headers, false) {
        return error_response(StatusCode::UNAUTHORIZED, error);
    }
    let suffix = original_uri
        .path_and_query()
        .map(|value| value.as_str())
        .unwrap_or("/")
        .strip_prefix("/api/local-access")
        .unwrap_or("/");
    let target = format!(
        "{}{}",
        controller.proxy_info.base_url.trim_end_matches('/'),
        suffix
    );
    let body = match to_bytes(body, MAX_RPC_BODY_BYTES).await {
        Ok(body) => body,
        Err(error) => {
            return error_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                format!("read local provider request failed: {error}"),
            )
        }
    };
    let provider_config_id = headers
        .get(PROVIDER_CONFIG_ID_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(path.provider.as_str());
    let provider_secrets = match load_provider_secrets(provider_config_id) {
        Ok(secrets) => secrets,
        Err(error) => return error_response(StatusCode::BAD_REQUEST, error),
    };
    let mut request = controller.proxy_client.request(method, target);
    for (name, value) in &headers {
        if matches!(
            name.as_str(),
            "host"
                | "cookie"
                | "origin"
                | "content-length"
                | "connection"
                | CSRF_HEADER
                | PROXY_TOKEN_HEADER
                | PROVIDER_CONFIG_ID_HEADER
        ) {
            continue;
        }
        let value = replace_secret_sentinel(name.as_str(), value, provider_secrets.as_ref());
        request = request.header(name, value);
    }
    // The browser-side route intentionally uses a non-secret placeholder.
    // Never append it alongside the real loopback token: reqwest preserves
    // duplicate header values and the loopback proxy validates the first one.
    request = request.header(PROXY_TOKEN_HEADER, &controller.proxy_info.token);
    if !body.is_empty() {
        request = request.body(body);
    }
    let upstream = match request.send().await {
        Ok(response) => response,
        Err(error) => {
            return error_response(
                StatusCode::BAD_GATEWAY,
                format!("local provider proxy failed: {error}"),
            )
        }
    };
    let status = upstream.status();
    let response_headers = upstream.headers().clone();
    let mut response = Response::new(Body::from_stream(upstream.bytes_stream()));
    *response.status_mut() = status;
    for (name, value) in &response_headers {
        if !matches!(
            name.as_str(),
            "content-length" | "connection" | "transfer-encoding"
        ) {
            response.headers_mut().append(name, value.clone());
        }
    }
    response
}

async fn local_image_proxy(
    State(controller): State<Arc<LocalAccessController>>,
    method: Method,
    headers: HeaderMap,
    OriginalUri(original_uri): OriginalUri,
) -> Response {
    if let Err(error) = controller.validate_request_origin(&headers) {
        return error_response(StatusCode::FORBIDDEN, error);
    }
    if let Err(error) = controller.authenticate(&headers, false) {
        return error_response(StatusCode::UNAUTHORIZED, error);
    }
    if method != Method::GET && method != Method::HEAD {
        return error_response(
            StatusCode::METHOD_NOT_ALLOWED,
            "image proxy only supports GET".to_string(),
        );
    }
    let suffix = original_uri
        .path_and_query()
        .map(|value| value.as_str())
        .unwrap_or("/")
        .strip_prefix("/api/local-access")
        .unwrap_or("/");
    let target = format!(
        "{}{}",
        controller.proxy_info.base_url.trim_end_matches('/'),
        suffix
    );
    let upstream = match controller
        .proxy_client
        .request(method, target)
        .header(PROXY_TOKEN_HEADER, &controller.proxy_info.token)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            return error_response(
                StatusCode::BAD_GATEWAY,
                format!("local image proxy failed: {error}"),
            )
        }
    };
    let status = upstream.status();
    let response_headers = upstream.headers().clone();
    let mut response = Response::new(Body::from_stream(upstream.bytes_stream()));
    *response.status_mut() = status;
    for (name, value) in &response_headers {
        if !matches!(
            name.as_str(),
            "content-length" | "connection" | "transfer-encoding"
        ) {
            response.headers_mut().append(name, value.clone());
        }
    }
    response
}

struct LocalProviderSecrets {
    api_key: Option<String>,
    custom_headers: HashMap<String, String>,
}

fn load_provider_secrets(provider_id: &str) -> Result<Option<LocalProviderSecrets>, String> {
    let conn = open_db()?;
    let providers = crate::commands::settings::load_providers(&conn)?
        .unwrap_or(Value::Array(Vec::new()));
    let provider = providers.as_array().and_then(|providers| {
        providers.iter().find(|provider| {
            provider
                .get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| id == provider_id)
        })
    });
    let Some(provider) = provider else {
        return Ok(None);
    };
    let api_key = provider
        .get("apiKey")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|secret| !secret.is_empty())
        .map(str::to_string);
    let custom_headers = provider
        .get("customHeaders")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|header| {
            let key = header.get("key")?.as_str()?.trim().to_ascii_lowercase();
            let value = header.get("value")?.as_str()?.trim().to_string();
            (!key.is_empty() && !value.is_empty()).then_some((key, value))
        })
        .collect();
    Ok(Some(LocalProviderSecrets {
        api_key,
        custom_headers,
    }))
}

fn replace_secret_sentinel(
    header_name: &str,
    value: &HeaderValue,
    secrets: Option<&LocalProviderSecrets>,
) -> HeaderValue {
    let Ok(text) = value.to_str() else {
        return value.clone();
    };
    if !text.contains(LOCAL_ACCESS_SECRET_SENTINEL) {
        return value.clone();
    }
    let Some(secrets) = secrets else {
        return value.clone();
    };
    if text.trim() == LOCAL_ACCESS_SECRET_SENTINEL {
        if let Some(secret) = secrets.custom_headers.get(&header_name.to_ascii_lowercase()) {
            return HeaderValue::from_str(secret).unwrap_or_else(|_| value.clone());
        }
    }
    let Some(api_key) = secrets.api_key.as_deref() else {
        return value.clone();
    };
    HeaderValue::from_str(&text.replace(LOCAL_ACCESS_SECRET_SENTINEL, api_key))
        .unwrap_or_else(|_| value.clone())
}

async fn event_stream(
    State(controller): State<Arc<LocalAccessController>>,
    headers: HeaderMap,
) -> Response {
    if let Err(error) = controller.validate_request_origin(&headers) {
        return error_response(StatusCode::FORBIDDEN, error);
    }
    let session = match controller.authenticate(&headers, false) {
        Ok(session) => session,
        Err(error) => return error_response(StatusCode::UNAUTHORIZED, error),
    };
    let device_id = session.device_id;
    let receiver = controller.event_tx.subscribe();
    let stream = futures_util::stream::unfold(receiver, move |mut receiver| {
        let device_id = device_id.clone();
        async move {
            loop {
                match receiver.recv().await {
                    Ok(event) if event.device_id == device_id => {
                        let data = match serde_json::to_string(&event) {
                            Ok(data) => data,
                            Err(_) => continue,
                        };
                        return Some((Ok::<Event, Infallible>(Event::default().data(data)), receiver));
                    }
                    Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => return None,
                }
            }
        }
    });
    Sse::new(stream)
        .keep_alive(KeepAlive::new().interval(Duration::from_secs(15)).text("keepalive"))
        .into_response()
}

async fn subscribe_event(
    State(controller): State<Arc<LocalAccessController>>,
    headers: HeaderMap,
    Json(payload): Json<SubscribeRequest>,
) -> Response {
    if let Err(error) = controller.validate_request_origin(&headers) {
        return error_response(StatusCode::FORBIDDEN, error);
    }
    let session = match controller.authenticate(&headers, true) {
        Ok(session) => session,
        Err(error) => return error_response(StatusCode::UNAUTHORIZED, error),
    };
    let event = payload.event.trim();
    if event.is_empty()
        || event.len() > 128
        || !event
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || ":-_.".contains(character))
        || event.starts_with("local-access:")
    {
        return error_response(StatusCode::BAD_REQUEST, "invalid event name".to_string());
    }
    let config = match controller.config.lock() {
        Ok(config) => config.clone(),
        Err(_) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "local access config lock poisoned".to_string(),
            )
        }
    };
    if let Err(error) = authorize_local_event(event, &config) {
        return error_response(StatusCode::FORBIDDEN, error);
    }
    let subscription_id = Uuid::new_v4().to_string();
    let subscription = LocalEventSubscription {
        device_id: session.device_id,
        event: event.to_string(),
    };
    if let Ok(mut subscriptions) = controller.subscriptions.lock() {
        subscriptions.insert(subscription_id.clone(), subscription);
    } else {
        return error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "local access subscription lock poisoned".to_string(),
        );
    }
    if let Err(error) = controller.app_handle.emit(
        LOCAL_ACCESS_SUBSCRIBE_EVENT,
        LocalEventSubscriptionRequest {
            subscription_id: subscription_id.clone(),
            event: event.to_string(),
        },
    ) {
        let _ = controller
            .subscriptions
            .lock()
            .map(|mut subscriptions| subscriptions.remove(&subscription_id));
        return error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("start local access event subscription failed: {error}"),
        );
    }
    Json(SubscribeResponse { subscription_id }).into_response()
}

async fn unsubscribe_event(
    State(controller): State<Arc<LocalAccessController>>,
    Path(subscription_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    if let Err(error) = controller.validate_request_origin(&headers) {
        return error_response(StatusCode::FORBIDDEN, error);
    }
    let session = match controller.authenticate(&headers, true) {
        Ok(session) => session,
        Err(error) => return error_response(StatusCode::UNAUTHORIZED, error),
    };
    let removed = controller
        .subscriptions
        .lock()
        .ok()
        .and_then(|mut subscriptions| {
            let owned = subscriptions
                .get(&subscription_id)
                .is_some_and(|subscription| subscription.device_id == session.device_id);
            owned.then(|| subscriptions.remove(&subscription_id)).flatten()
        });
    if removed.is_some() {
        let _ = controller.app_handle.emit(
            LOCAL_ACCESS_UNSUBSCRIBE_EVENT,
            LocalEventUnsubscribeRequest {
                subscription_id,
            },
        );
    }
    StatusCode::NO_CONTENT.into_response()
}

async fn public_status(
    State(controller): State<Arc<LocalAccessController>>,
    headers: HeaderMap,
) -> Response {
    if let Err(error) = controller.validate_request_origin(&headers) {
        return error_response(StatusCode::FORBIDDEN, error);
    }
    let status = match controller.status() {
        Ok(status) => status,
        Err(error) => return error_response(StatusCode::INTERNAL_SERVER_ERROR, error),
    };
    Json(json!({
        "service": "xgent-local-access",
        "protocolVersion": 1,
        "running": status.running,
        "pairingRequired": true
    }))
    .into_response()
}

async fn pair_device(
    State(controller): State<Arc<LocalAccessController>>,
    ConnectInfo(remote): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(payload): Json<PairDeviceRequest>,
) -> Response {
    if let Err(error) = controller.validate_request_origin(&headers) {
        return error_response(StatusCode::FORBIDDEN, error);
    }
    if let Err(error) = controller.record_pair_attempt(remote.ip()) {
        return error_response(StatusCode::TOO_MANY_REQUESTS, error);
    }
    if let Err(error) = controller.validate_pairing_code(&payload.code) {
        return error_response(StatusCode::UNAUTHORIZED, error);
    }
    let (device_id, session_token, csrf_token, expires_at) =
        match controller.create_device_session(&payload.device_name) {
            Ok(value) => value,
            Err(error) => return error_response(StatusCode::BAD_REQUEST, error),
        };
    let max_age = DEVICE_SESSION_TTL_SECS;
    let cookie = format!(
        "{SESSION_COOKIE}={session_token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={max_age}"
    );
    let mut response = Json(PairDeviceResponse {
        paired: true,
        device_id,
        csrf_token,
        expires_at,
    })
    .into_response();
    if let Ok(value) = HeaderValue::from_str(&cookie) {
        response.headers_mut().append(SET_COOKIE, value);
    }
    controller.publish_status();
    response
}

async fn refresh_session(
    State(controller): State<Arc<LocalAccessController>>,
    headers: HeaderMap,
) -> Response {
    if let Err(error) = controller.validate_request_origin(&headers) {
        return error_response(StatusCode::FORBIDDEN, error);
    }
    let session = match controller.authenticate(&headers, false) {
        Ok(session) => session,
        Err(error) => return error_response(StatusCode::UNAUTHORIZED, error),
    };
    let csrf_token = match controller.rotate_session_csrf(&session) {
        Ok(value) => value,
        Err(error) => return error_response(StatusCode::INTERNAL_SERVER_ERROR, error),
    };
    Json(json!({
        "authenticated": true,
        "deviceId": session.device_id,
        "csrfToken": csrf_token,
        "expiresAt": session.expires_at
    }))
    .into_response()
}

async fn local_rpc(
    State(controller): State<Arc<LocalAccessController>>,
    headers: HeaderMap,
    Json(payload): Json<LocalRpcPayload>,
) -> Response {
    if let Err(error) = controller.validate_request_origin(&headers) {
        return error_response(StatusCode::FORBIDDEN, error);
    }
    if let Err(error) = controller.authenticate(&headers, true) {
        return error_response(StatusCode::UNAUTHORIZED, error);
    }
    match controller.dispatch_rpc(payload).await {
        Ok(result) => Json(json!({ "ok": true, "result": result })).into_response(),
        Err(error) => error_response(StatusCode::BAD_REQUEST, error),
    }
}

fn authorize_local_command(
    command: &str,
    config: &AccessSettingsPayload,
) -> Result<(), String> {
    const FILE_WRITE_COMMANDS: &[&str] = &[
        "fs_write_text",
        "fs_edit_text",
        "fs_delete",
        "fs_create_dir",
        "fs_rename",
    ];
    const GIT_READ_COMMANDS: &[&str] = &[
        "git_status",
        "git_discover_repositories",
        "git_branches",
        "git_diff",
        "git_log",
        "git_commit_details",
        "git_compare_commit_with_remote",
        "git_commit_diff",
    ];
    let blocked = |capability: &str| {
        config
            .blocked_local_capabilities
            .iter()
            .any(|value| value == capability)
    };

    if command.starts_with("cloud_task_") {
        if !config.cloud_execution_enabled {
            return Err("cloud execution is disabled for paired devices".to_string());
        }
        if command == "cloud_task_download_artifact" && blocked("file_write") {
            return Err("file writes are disabled for paired devices".to_string());
        }
        return Ok(());
    }
    if FILE_WRITE_COMMANDS.contains(&command) && blocked("file_write") {
        return Err("file writes are disabled for paired devices".to_string());
    }
    if command.starts_with("git_") && !GIT_READ_COMMANDS.contains(&command) && blocked("git") {
        return Err("Git writes are disabled for paired devices".to_string());
    }
    if (command.starts_with("terminal_")
        || command.starts_with("managed_process_")
        || command.starts_with("shell_")
        || command.starts_with("hook_")
        || matches!(
            command,
            "automation_cron_apply"
                | "automation_hooks_apply"
                | "automation_clear_runs"
                | "automation_run_cron_now"
        ))
        && blocked("terminal")
    {
        return Err("terminal access is disabled for paired devices".to_string());
    }
    if command.starts_with("plugin:browser-automation|") && blocked("browser_automation") {
        return Err("browser automation is disabled for paired devices".to_string());
    }
    if (command.starts_with("ssh_") || command.starts_with("sftp_")) && blocked("ssh") {
        return Err("SSH access is disabled for paired devices".to_string());
    }

    // Pairing creates another presentation of the same Xgent client. Commands
    // therefore share the desktop surface unless the owner explicitly blocks
    // their capability above. Command-specific approval/sandbox policies still
    // run after this transport authorization step.
    Ok(())
}

fn authorize_local_event(event: &str, config: &AccessSettingsPayload) -> Result<(), String> {
    let blocked = |capability: &str| {
        config
            .blocked_local_capabilities
            .iter()
            .any(|value| value == capability)
    };
    if matches!(
        event,
        "terminal:event"
            | "terminal:stream"
            | "terminal:exit-requested"
            | "managed-process:changed"
    ) && blocked("terminal")
    {
        return Err("terminal events are disabled for paired devices".to_string());
    }
    if event == "sftp:event" && blocked("ssh") {
        return Err("SSH events are disabled for paired devices".to_string());
    }
    Ok(())
}

async fn index_asset(
    State(controller): State<Arc<LocalAccessController>>,
    request: Request<Body>,
) -> Response {
    serve_asset(&controller, "index.html", request.headers())
}

async fn static_asset(
    State(controller): State<Arc<LocalAccessController>>,
    Path(path): Path<String>,
    request: Request<Body>,
) -> Response {
    let normalized = path.trim_start_matches('/');
    if normalized.split('/').any(|segment| segment == "..") || normalized.contains('\\') {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let asset_path = if normalized.is_empty() {
        "index.html"
    } else {
        normalized
    };
    let response = serve_asset(&controller, asset_path, request.headers());
    if response.status() != StatusCode::NOT_FOUND || asset_path.contains('.') {
        return response;
    }
    serve_asset(&controller, "index.html", request.headers())
}

fn serve_asset(
    controller: &LocalAccessController,
    path: &str,
    _headers: &HeaderMap,
) -> Response {
    let Some(asset) = controller.app_handle.asset_resolver().get(path.to_string()) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut response = Response::new(Body::from(asset.bytes));
    if let Ok(value) = HeaderValue::from_str(&asset.mime_type) {
        response.headers_mut().insert(CONTENT_TYPE, value);
    }
    let cache = if path == "index.html" {
        "no-store"
    } else {
        "public, max-age=31536000, immutable"
    };
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static(cache));
    response.headers_mut().insert(
        CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(
            "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws:; worker-src 'self' blob:",
        ),
    );
    response
}

fn error_response(status: StatusCode, message: String) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .filter_map(|part| part.trim().split_once('='))
        .find_map(|(key, value)| (key == name).then(|| value.to_string()))
}

fn local_access_urls(config: &AccessSettingsPayload, port: u16) -> Vec<String> {
    let loopback_url = format!("http://127.0.0.1:{port}");
    let mut urls = Vec::new();
    if config.web_ui_scope == "lan" {
        for ip in lan_ipv4_addresses() {
            let url = format!("http://{ip}:{port}");
            if !urls.contains(&url) {
                urls.push(url);
            }
        }
    }
    urls.push(loopback_url);
    urls
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LanAddress {
    interface_name: String,
    ip: Ipv4Addr,
    score: i16,
}

fn lan_ipv4_addresses() -> Vec<Ipv4Addr> {
    let mut addresses = enumerated_lan_addresses();
    if addresses.is_empty() {
        if let Some(ip) = routed_lan_ip() {
            addresses.push(LanAddress {
                interface_name: "default-route".to_string(),
                ip,
                score: i16::MIN,
            });
        }
    }
    addresses.into_iter().map(|address| address.ip).collect()
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn enumerated_lan_addresses() -> Vec<LanAddress> {
    let interfaces = if_addrs::get_if_addrs().unwrap_or_default();
    rank_lan_addresses(interfaces.into_iter().filter_map(|interface| {
        let IpAddr::V4(ip) = interface.ip() else {
            return None;
        };
        Some((interface.name, ip))
    }))
}

// `if-addrs` stays desktop-only. Mobile clients share this module but do not
// host the LAN Web UI, so the routed-address fallback below is sufficient.
#[cfg(any(target_os = "android", target_os = "ios"))]
fn enumerated_lan_addresses() -> Vec<LanAddress> {
    Vec::new()
}

fn rank_lan_addresses(
    interfaces: impl IntoIterator<Item = (String, Ipv4Addr)>,
) -> Vec<LanAddress> {
    let mut by_ip: HashMap<Ipv4Addr, LanAddress> = HashMap::new();
    for (interface_name, ip) in interfaces {
        if !ip.is_private() || ip.is_loopback() || ip.is_unspecified() {
            continue;
        }
        let candidate = LanAddress {
            score: lan_interface_score(&interface_name, ip),
            interface_name,
            ip,
        };
        match by_ip.get(&ip) {
            Some(existing) if existing.score >= candidate.score => {}
            _ => {
                by_ip.insert(ip, candidate);
            }
        }
    }
    let mut addresses: Vec<_> = by_ip.into_values().collect();
    addresses.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.interface_name.cmp(&right.interface_name))
            .then_with(|| left.ip.octets().cmp(&right.ip.octets()))
    });
    addresses
}

fn lan_interface_score(interface_name: &str, ip: Ipv4Addr) -> i16 {
    let normalized = interface_name.to_lowercase();
    let virtual_interface = [
        "tun",
        "tap",
        "wintun",
        "wireguard",
        "openvpn",
        "vpn",
        "tailscale",
        "zerotier",
        "hamachi",
        "cloudflare",
        "warp",
        "clash",
        "mihomo",
        "sing-box",
        "vmware",
        "virtualbox",
        "vbox",
        "hyper-v",
        "vethernet",
        "docker",
        "podman",
        "wsl",
        "bridge",
    ]
    .iter()
    .any(|hint| normalized.contains(hint));
    let physical_interface = [
        "ethernet",
        "wi-fi",
        "wifi",
        "wlan",
        "wireless",
        "以太网",
        "无线",
    ]
    .iter()
    .any(|hint| normalized.contains(hint))
        || normalized.starts_with("eth")
        || normalized.starts_with("en")
        || normalized.starts_with("wl");

    let subnet_score = match ip.octets() {
        [192, 168, ..] => 30,
        [10, ..] => 20,
        [172, second, ..] if (16..=31).contains(&second) => 10,
        _ => 0,
    };
    subnet_score + if physical_interface { 100 } else { 0 } - if virtual_interface { 200 } else { 0 }
}

fn routed_lan_ip() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect((Ipv4Addr::new(192, 0, 2, 1), 9)).ok()?;
    let IpAddr::V4(ip) = socket.local_addr().ok()?.ip() else {
        return None;
    };
    (ip.is_private() && !ip.is_loopback() && !ip.is_unspecified()).then_some(ip)
}

fn is_allowed_host(host: &str, expected_port: u16) -> bool {
    is_allowed_host_for_addresses(host, expected_port, &lan_ipv4_addresses())
}

fn is_allowed_host_for_addresses(
    host: &str,
    expected_port: u16,
    lan_addresses: &[Ipv4Addr],
) -> bool {
    let (hostname, port) = split_host_port(host, expected_port);
    if port != expected_port {
        return false;
    }
    if hostname.eq_ignore_ascii_case("localhost") {
        return true;
    }
    let Ok(ip) = hostname.parse::<IpAddr>() else {
        return false;
    };
    if ip.is_loopback() {
        return true;
    }
    let IpAddr::V4(ip) = ip else {
        return false;
    };
    lan_addresses.contains(&ip)
}

fn split_host_port(host: &str, default_port: u16) -> (String, u16) {
    if let Ok(address) = host.parse::<SocketAddr>() {
        return (address.ip().to_string(), address.port());
    }
    if let Some((name, port)) = host.rsplit_once(':') {
        if let Ok(port) = port.parse::<u16>() {
            return (name.trim_matches(['[', ']']).to_string(), port);
        }
    }
    (host.trim_matches(['[', ']']).to_string(), default_port)
}

fn list_paired_devices() -> Result<Vec<LocalAccessDevice>, String> {
    let conn = open_db()?;
    let mut statement = conn
        .prepare(
            "SELECT device_id, label, created_at, last_seen_at, expires_at
             FROM local_access_devices
             WHERE revoked_at IS NULL AND expires_at > ?1
             ORDER BY last_seen_at DESC, created_at DESC",
        )
        .map_err(|error| format!("prepare paired device list failed: {error}"))?;
    let rows = statement
        .query_map(params![now_ms()], |row| {
            Ok(LocalAccessDevice {
                device_id: row.get(0)?,
                label: row.get(1)?,
                created_at: row.get(2)?,
                last_seen_at: row.get(3)?,
                expires_at: row.get(4)?,
            })
        })
        .map_err(|error| format!("list paired devices failed: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("read paired device failed: {error}"))
}

fn pairing_code_from_uuid(id: Uuid) -> String {
    let bytes = id.as_bytes();
    let number = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) % 1_000_000;
    format!("{number:06}")
}

fn hash_text(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn physical_lan_interfaces_sort_before_tunnels() {
        let addresses = rank_lan_addresses([
            ("Wintun Userspace Tunnel".to_string(), Ipv4Addr::new(192, 168, 50, 2)),
            ("Wi-Fi".to_string(), Ipv4Addr::new(10, 0, 0, 42)),
            ("vEthernet (WSL)".to_string(), Ipv4Addr::new(172, 24, 0, 1)),
        ]);

        assert_eq!(
            addresses.iter().map(|address| address.ip).collect::<Vec<_>>(),
            vec![
                Ipv4Addr::new(10, 0, 0, 42),
                Ipv4Addr::new(192, 168, 50, 2),
                Ipv4Addr::new(172, 24, 0, 1),
            ]
        );
    }

    #[test]
    fn lan_addresses_exclude_public_loopback_and_link_local_ranges() {
        let addresses = rank_lan_addresses([
            ("Ethernet".to_string(), Ipv4Addr::new(192, 168, 1, 20)),
            ("Ethernet".to_string(), Ipv4Addr::new(8, 8, 8, 8)),
            ("Loopback".to_string(), Ipv4Addr::LOCALHOST),
            ("Link Local".to_string(), Ipv4Addr::new(169, 254, 1, 2)),
        ]);

        assert_eq!(addresses.len(), 1);
        assert_eq!(addresses[0].ip, Ipv4Addr::new(192, 168, 1, 20));
    }

    #[test]
    fn host_validation_accepts_every_current_lan_address_only_on_the_bound_port() {
        let addresses = [
            Ipv4Addr::new(192, 168, 1, 20),
            Ipv4Addr::new(10, 0, 0, 42),
        ];

        assert!(is_allowed_host_for_addresses("192.168.1.20:28367", 28_367, &addresses));
        assert!(is_allowed_host_for_addresses("10.0.0.42:28367", 28_367, &addresses));
        assert!(is_allowed_host_for_addresses("localhost:28367", 28_367, &addresses));
        assert!(!is_allowed_host_for_addresses("192.168.1.20:8080", 28_367, &addresses));
        assert!(!is_allowed_host_for_addresses("192.168.1.99:28367", 28_367, &addresses));
    }

    #[test]
    fn paired_devices_default_to_full_non_cloud_access_with_explicit_blocks() {
        let mut config = AccessSettingsPayload::default();

        assert!(authorize_local_command("system_clipboard_read_text", &config).is_ok());
        assert!(authorize_local_event("custom:desktop-event", &config).is_ok());
        assert!(authorize_local_command("cloud_task_start", &config).is_err());

        config
            .blocked_local_capabilities
            .push("browser_automation".to_string());
        assert!(authorize_local_command("plugin:browser-automation|action", &config).is_err());
        assert!(authorize_local_command("terminal_create", &config).is_ok());

        config.cloud_execution_enabled = true;
        assert!(authorize_local_command("cloud_task_start", &config).is_ok());
    }
}
