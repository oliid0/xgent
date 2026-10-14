//! Separate authenticated sessions for each execution host. Peer IDs identify
//! installations, never IP addresses, display names or paired client IDs.
use std::collections::BTreeMap;
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::Mutex;
use uuid::Uuid;
use sha2::{Digest, Sha256};
use futures_util::FutureExt;
use super::{cloud_secret_vault::CloudSecretVault, lan_pc_client::LanPcClient};

mod chat;

const REGISTRY_KEY: &[u8] = b"worker-peers.registry.v1";
const MAX_PEERS: usize = 32;
const MAX_ENDPOINTS: usize = 4;
const REQUESTS_KEY: &[u8] = b"worker-peer.requests.v1";
const MAX_REQUEST_BINDINGS: usize = 4096;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestBinding { peer_id: String, input_hash: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerProvider {
    pub id: String,
    pub name: String,
    pub provider_type: String,
    pub models: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub model_profiles: Vec<WorkerModelProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerModelProfile {
    pub model: String,
    pub skills: Vec<String>,
    pub background_pending: u64,
    pub background_running: u64,
    pub background_waiting: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn catalog() -> WorkerHostInfo {
        WorkerHostInfo { result_delivery_version: 1, source_routing_version: 1, device_channel_version: 1, device_actions_version: 1, host_id: Uuid::new_v4().to_string(), platform: "macos".into(), architecture: "aarch64".into(),
            executor_ready: true, accepts_background_tasks: true, workdir: "/workspace".into(), workspace_available: true,
            providers: Vec::new(), pending: 0, running: 0, observed_at: 1, input_snapshot_version: 1, delegation_version: 1, child_tasks_version: 1, waiting_version: 1, source_context_version: 1, goal_acceptance_version: 1, intelligent_scheduling_version: 1, model_routing_version: 1, budget_delegation_version: 1, budget_deadline_version: 1, inventory: None }
    }

    #[test]
    fn host_identity_is_not_a_display_name_or_address() {
        let mut info = catalog(); assert!(info.validate().is_ok());
        info.host_id = "Same Mac Name".into(); assert!(info.validate().is_err());
        info.host_id = "192.168.1.1".into(); assert!(info.validate().is_err());
    }

    #[test]
    fn worker_catalog_rejects_unbounded_remote_metadata() {
        let mut info = catalog(); info.workdir = "x".repeat(32769); assert!(info.validate().is_err());
        let mut info = catalog(); info.providers = (0..129).map(|_| WorkerProvider { id: "p".into(), name: "p".into(), provider_type: "codex".into(), models: Vec::new(), model_profiles: Vec::new() }).collect();
        assert!(info.validate().is_err());
    }

    #[test]
    fn legacy_worker_does_not_advertise_input_snapshot_support() {
        let mut value = serde_json::to_value(catalog()).unwrap();
        value.as_object_mut().unwrap().remove("inputSnapshotVersion");
        value.as_object_mut().unwrap().remove("delegationVersion");
        value.as_object_mut().unwrap().remove("childTasksVersion");
        value.as_object_mut().unwrap().remove("waitingVersion");
        value.as_object_mut().unwrap().remove("goalAcceptanceVersion");
        value.as_object_mut().unwrap().remove("modelRoutingVersion");
        value.as_object_mut().unwrap().remove("budgetDelegationVersion");
        value.as_object_mut().unwrap().remove("budgetDeadlineVersion");
        let legacy: WorkerHostInfo = serde_json::from_value(value).unwrap();
        assert_eq!(legacy.input_snapshot_version, 0);
        assert_eq!(legacy.delegation_version, 0);
        assert_eq!(legacy.child_tasks_version, 0);
        assert_eq!(legacy.waiting_version, 0);
        assert_eq!(legacy.goal_acceptance_version, 0);
        assert_eq!(legacy.model_routing_version, 0);
        assert_eq!(legacy.budget_delegation_version, 0);
        assert_eq!(legacy.budget_deadline_version, 0);
    }

    #[test]
    fn legacy_registry_migrates_without_changing_session_or_host() {
        let host = catalog();
        let session = Uuid::new_v4().to_string();
        let raw = serde_json::json!({ "peerId": host.host_id, "baseUrl": "http://192.168.1.2:28367",
            "sessionId": session, "host": host });
        let stored: StoredPeer = serde_json::from_value(raw.clone()).unwrap();
        stored.validate().unwrap();
        assert_eq!(stored.endpoints().len(), 1);
        assert_eq!(serde_json::to_value(stored).unwrap(), raw);
    }

    #[test]
    fn endpoint_order_prefers_lan_and_rejects_credential_aliases() {
        let host = catalog();
        let mut stored = StoredPeer { peer_id: host.host_id.clone(), host,
            base_url: "http://100.70.1.2:28367".into(), session_id: Uuid::new_v4().to_string(),
            alternate_endpoints: vec![StoredEndpoint { base_url: "http://192.168.1.2:28367".into(), session_id: Uuid::new_v4().to_string() }] };
        stored.validate().unwrap();
        assert_eq!(stored.endpoints()[0].base_url, "http://192.168.1.2:28367");
        stored.alternate_endpoints[0].session_id = stored.session_id.clone();
        assert!(stored.validate().is_err());
        assert_eq!(endpoint_network("http://mac.tail123.ts.net:28367"), "tailnet");
        assert_eq!(endpoint_network("http://[fd7a:115c:a1e0::1]:28367"), "tailnet");
        assert_eq!(endpoint_network("http://100.115.92.1:28367"), "other");
        assert_eq!(endpoint_network("http://100.100.100.100:28367"), "other");
        assert_eq!(endpoint_network("http://mac.ts.net.evil.example:28367"), "other");
    }

    async fn mock_endpoint(vault: &Arc<CloudSecretVault>, peer_id: &str, host: WorkerHostInfo, delay_ms: u64,
        commands: Arc<std::sync::Mutex<Vec<String>>>) -> (EndpointClient, tokio::task::JoinHandle<()>) {
        use axum::{routing::post, Json, Router};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = StoredEndpoint { base_url: format!("http://{}", listener.local_addr().unwrap()), session_id: Uuid::new_v4().to_string() };
        let router = Router::new().route("/api/local-access/rpc", post(move |Json(payload): Json<Value>| {
            let host = host.clone(); let commands = Arc::clone(&commands);
            async move {
                commands.lock().unwrap().push(payload["command"].as_str().unwrap().to_string());
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                Json(serde_json::json!({ "ok": true, "result": host }))
            }
        }));
        let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap(); });
        let key = session_key(peer_id, &endpoint.session_id);
        vault.set_namespaced_secret(&key, &serde_json::to_vec(&serde_json::json!({
            "baseUrl": endpoint.base_url, "deviceId": endpoint.session_id, "sessionToken": "paired-test-token",
            "csrfToken": "paired-test-csrf", "expiresAt": i64::MAX,
        })).unwrap()).unwrap();
        let client = Arc::new(LanPcClient::new_with_namespace(Arc::clone(vault), key).unwrap());
        ((endpoint, client), task)
    }

    #[tokio::test]
    async fn faster_fallback_cannot_override_a_reachable_preferred_endpoint() {
        let temp = tempfile::tempdir().unwrap();
        let vault = Arc::new(CloudSecretVault::new(temp.path().to_path_buf()).unwrap());
        let host = catalog();
        let commands = Arc::new(std::sync::Mutex::new(Vec::new()));
        let (preferred, first) = mock_endpoint(&vault, &host.host_id, host.clone(), 100, Arc::clone(&commands)).await;
        let (fallback, second) = mock_endpoint(&vault, &host.host_id, host.clone(), 0, commands).await;
        let stored = StoredPeer { peer_id: host.host_id.clone(), host, base_url: preferred.0.base_url.clone(),
            session_id: preferred.0.session_id.clone(), alternate_endpoints: vec![fallback.0.clone()] };
        let (selected, statuses) = WorkerPeerRegistry::probe_entry(&stored, &[preferred.clone(), fallback]).await;
        assert_eq!(selected.unwrap().0.base_url, preferred.0.base_url);
        assert!(statuses.iter().all(|endpoint| endpoint.online));
        first.abort(); second.abort();
    }

    #[tokio::test]
    async fn interactive_rpc_uses_original_peer_fallback_and_never_dispatches_to_a_changed_identity() {
        let temp = tempfile::tempdir().unwrap();
        let vault = Arc::new(CloudSecretVault::new(temp.path().to_path_buf()).unwrap());
        let host = catalog();
        let commands = Arc::new(std::sync::Mutex::new(Vec::new()));
        let (unavailable, first) = mock_endpoint(&vault, &host.host_id, host.clone(), 0, Arc::clone(&commands)).await;
        first.abort(); let _ = first.await;
        let (fallback, second) = mock_endpoint(&vault, &host.host_id, host.clone(), 0, Arc::clone(&commands)).await;
        let original_url = unavailable.0.base_url.clone();
        let stored = StoredPeer { peer_id: host.host_id.clone(), host: host.clone(), base_url: original_url.clone(),
            session_id: unavailable.0.session_id.clone(), alternate_endpoints: vec![fallback.0.clone()] };
        let registry = WorkerPeerRegistry::new(Arc::clone(&vault)).unwrap();
        registry.peers.lock().await.insert(host.host_id.clone(), PeerEntry { stored: stored.clone(),
            clients: vec![unavailable, fallback.clone()] });
        registry.invoke_chat(&original_url, None, "shell_run", serde_json::json!({})).await.unwrap();
        assert_eq!(commands.lock().unwrap().iter().filter(|command| command.as_str() == "shell_run").count(), 1);
        let (foreign, third) = mock_endpoint(&vault, &host.host_id, catalog(), 0, Arc::clone(&commands)).await;
        registry.peers.lock().await.insert(host.host_id.clone(), PeerEntry { stored,
            clients: vec![foreign, fallback] });
        commands.lock().unwrap().clear();
        assert!(registry.invoke_chat(&original_url, Some(&host.host_id), "shell_run", serde_json::json!({})).await.is_err());
        assert!(commands.lock().unwrap().iter().all(|command| command == "automation_background_host_info"));
        assert!(registry.resolve_endpoint("http://unpaired:28367").await.is_err());
        second.abort(); third.abort();
    }

    #[tokio::test]
    async fn failed_address_uses_same_peer_fallback_but_identity_change_stops_dispatch() {
        let temp = tempfile::tempdir().unwrap();
        let vault = Arc::new(CloudSecretVault::new(temp.path().to_path_buf()).unwrap());
        let host = catalog();
        let commands = Arc::new(std::sync::Mutex::new(Vec::new()));
        let (unavailable, first) = mock_endpoint(&vault, &host.host_id, host.clone(), 0, Arc::clone(&commands)).await;
        first.abort(); let _ = first.await;
        let (fallback, second) = mock_endpoint(&vault, &host.host_id, host.clone(), 0, Arc::clone(&commands)).await;
        let stored = StoredPeer { peer_id: host.host_id.clone(), host: host.clone(), base_url: unavailable.0.base_url.clone(),
            session_id: unavailable.0.session_id.clone(), alternate_endpoints: vec![fallback.0.clone()] };
        let (selected, _) = WorkerPeerRegistry::probe_entry(&stored, &[unavailable, fallback.clone()]).await;
        assert_eq!(selected.unwrap().2.host_id, host.host_id);
        let (foreign, third) = mock_endpoint(&vault, &host.host_id, catalog(), 0, Arc::clone(&commands)).await;
        let registry = WorkerPeerRegistry::new(vault).unwrap();
        registry.peers.lock().await.insert(host.host_id.clone(), PeerEntry { stored,
            clients: vec![foreign, fallback] });
        commands.lock().unwrap().clear();
        assert!(registry.invoke(&host.host_id, "automation_background_list", serde_json::json!({})).await.is_err());
        assert!(commands.lock().unwrap().iter().all(|command| command == "automation_background_host_info"));
        second.abort(); third.abort();
    }

    #[tokio::test]
    async fn goal_control_resolves_only_paired_endpoints_and_uses_the_original_host_fallback() {
        let temp = tempfile::tempdir().unwrap();
        let vault = Arc::new(CloudSecretVault::new(temp.path().to_path_buf()).unwrap());
        let host = catalog();
        let commands = Arc::new(std::sync::Mutex::new(Vec::new()));
        let (unavailable, first) = mock_endpoint(&vault, &host.host_id, host.clone(), 0, Arc::clone(&commands)).await;
        first.abort(); let _ = first.await;
        let (fallback, second) = mock_endpoint(&vault, &host.host_id, host.clone(), 0, Arc::clone(&commands)).await;
        let original_url = unavailable.0.base_url.clone();
        let stored = StoredPeer { peer_id: host.host_id.clone(), host: host.clone(), base_url: original_url.clone(),
            session_id: unavailable.0.session_id.clone(), alternate_endpoints: vec![fallback.0.clone()] };
        let registry = WorkerPeerRegistry::new(vault).unwrap();
        registry.peers.lock().await.insert(host.host_id.clone(), PeerEntry { stored: stored.clone(), clients: vec![unavailable, fallback.clone()] });
        assert_eq!(registry.resolve_endpoint(&original_url).await.unwrap(), host.host_id);
        assert!(registry.resolve_endpoint("http://192.168.1.99:28367").await.is_err());
        registry.invoke(&host.host_id, "automation_goal_apply", serde_json::json!({"input":{"requestId":"original-control"}})).await.unwrap();
        assert_eq!(commands.lock().unwrap().iter().filter(|command| command.as_str() == "automation_goal_apply").count(), 1);
        let count = commands.lock().unwrap().len();
        assert!(registry.invoke(&host.host_id, "automation_goal_invented", serde_json::json!({})).await.is_err());
        assert_eq!(commands.lock().unwrap().len(), count);
        let foreign = catalog();
        registry.peers.lock().await.insert(foreign.host_id.clone(), PeerEntry {
            stored: StoredPeer { peer_id: foreign.host_id.clone(), host: foreign, ..stored }, clients: vec![fallback] });
        assert!(registry.resolve_endpoint(&original_url).await.unwrap_err().contains("ambiguous"));
        second.abort();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerHostInfo {
    pub host_id: String,
    pub platform: String,
    pub architecture: String,
    pub executor_ready: bool,
    pub accepts_background_tasks: bool,
    pub workdir: String,
    pub workspace_available: bool,
    #[serde(default)]
    pub input_snapshot_version: u32,
    #[serde(default)]
    pub delegation_version: u32,
    #[serde(default)]
    pub child_tasks_version: u32,
    #[serde(default)]
    pub waiting_version: u32,
    #[serde(default)]
    pub source_context_version: u32,
    #[serde(default)]
    pub goal_acceptance_version: u32,
    #[serde(default)]
    pub intelligent_scheduling_version: u32,
    #[serde(default)]
    pub model_routing_version: u32,
    #[serde(default)]
    pub budget_delegation_version: u32,
    #[serde(default)]
    pub budget_deadline_version: u32,
    #[serde(default)]
    pub source_routing_version: u32,
    #[serde(default)]
    pub device_channel_version: u32,
    #[serde(default)]
    pub device_actions_version: u32,
    #[serde(default)]
    pub result_delivery_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inventory: Option<super::worker_inventory::WorkerInventory>,
    pub providers: Vec<WorkerProvider>,
    pub pending: u64,
    pub running: u64,
    pub observed_at: i64,
}

impl WorkerHostInfo {
    fn validate(&self) -> Result<(), String> {
        if let Some(inventory) = &self.inventory { inventory.validate()?; }
        let id = Uuid::parse_str(&self.host_id).map_err(|_| "Worker returned an invalid identity".to_string())?;
        if id.to_string() != self.host_id || self.platform.len() > 32 || self.architecture.len() > 32
            || self.workdir.len() > 32768 || self.providers.len() > 128
            || self.providers.iter().any(|p| p.id.len() > 256 || p.name.len() > 512 || p.provider_type.len() > 64
                || p.models.len() > 256 || p.models.iter().any(|m| m.len() > 512)
                || p.model_profiles.len() > p.models.len()
                || p.model_profiles.iter().any(|profile| !p.models.contains(&profile.model) || profile.skills.len() > 16
                    || profile.skills.iter().any(|skill| !super::worker_inventory::valid_model_skill(skill))
                    || profile.skills.iter().collect::<std::collections::BTreeSet<_>>().len() != profile.skills.len()
                    || [profile.background_pending, profile.background_running, profile.background_waiting].iter().any(|count| *count > 9_007_199_254_740_991))
                || p.model_profiles.iter().map(|profile| &profile.model).collect::<std::collections::BTreeSet<_>>().len() != p.model_profiles.len()) {
            return Err("Worker catalog exceeds supported limits".to_string());
        }
        Ok(())
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredEndpoint { base_url: String, session_id: String }

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredPeer {
    peer_id: String,
    base_url: String,
    session_id: String,
    host: WorkerHostInfo,
    // The original fields remain the first endpoint for v1 vault migration.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    alternate_endpoints: Vec<StoredEndpoint>,
}

impl StoredPeer {
    fn endpoints(&self) -> Vec<StoredEndpoint> {
        let mut endpoints = vec![StoredEndpoint { base_url: self.base_url.clone(), session_id: self.session_id.clone() }];
        endpoints.extend(self.alternate_endpoints.clone());
        endpoints.sort_by(|a, b| endpoint_rank(&a.base_url).cmp(&endpoint_rank(&b.base_url)).then_with(|| a.base_url.cmp(&b.base_url)));
        endpoints
    }

    fn validate(&self) -> Result<(), String> {
        self.host.validate()?;
        if self.peer_id != self.host.host_id || self.alternate_endpoints.len() >= MAX_ENDPOINTS {
            return Err("Invalid worker endpoint binding or more than four endpoints".into());
        }
        let mut urls = std::collections::BTreeSet::new();
        let mut sessions = std::collections::BTreeSet::new();
        for endpoint in self.endpoints() {
            if Uuid::parse_str(&endpoint.session_id).is_err() || endpoint.base_url.len() > 2048
                || super::lan_pc_client::normalize_base_url(&endpoint.base_url)? != endpoint.base_url
                || !urls.insert(endpoint.base_url) || !sessions.insert(endpoint.session_id) {
                return Err("Invalid or duplicate worker endpoint session".into());
            }
        }
        Ok(())
    }
}

/// A routing hint only. Being in a VPN address range never grants trust.
pub(crate) fn is_tailnet_ipv4(ip: std::net::Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    a == 100 && (64..=127).contains(&b) && !(b == 115 && (92..=93).contains(&c))
        && ip != std::net::Ipv4Addr::new(100, 100, 100, 100)
}

fn endpoint_network(base_url: &str) -> &'static str {
    let hostname = reqwest::Url::parse(base_url).ok().and_then(|url| url.host_str().map(ToOwned::to_owned)).unwrap_or_default();
    match hostname.trim_matches(['[', ']']).parse::<std::net::IpAddr>() {
        Ok(std::net::IpAddr::V4(ip)) if ip.is_private() || ip.is_loopback() => "lan",
        Ok(std::net::IpAddr::V4(ip)) if is_tailnet_ipv4(ip) => "tailnet",
        Ok(std::net::IpAddr::V6(ip)) if ip.segments()[..3] == [0xfd7a, 0x115c, 0xa1e0] => "tailnet",
        Ok(std::net::IpAddr::V6(ip)) if ip.is_loopback() || ip.is_unique_local() => "lan",
        Err(_) if hostname == "localhost" => "lan",
        Err(_) if hostname.ends_with(".ts.net") => "tailnet",
        _ => "other",
    }
}

fn endpoint_rank(base_url: &str) -> u8 {
    match endpoint_network(base_url) { "lan" => 0, "tailnet" => 1, _ => 2 }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerEndpointStatus {
    pub base_url: String,
    pub network: String,
    pub online: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerPeerStatus {
    pub peer_id: String,
    pub base_url: String,
    pub online: bool,
    pub host: WorkerHostInfo,
    pub endpoints: Vec<WorkerEndpointStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerPeerList {
    pub peers: Vec<WorkerPeerStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registration_error: Option<String>,
}

type EndpointClient = (StoredEndpoint, Arc<LanPcClient>);
struct PeerEntry { stored: StoredPeer, clients: Vec<EndpointClient> }
enum ProbeFailure { Unavailable(String), Identity(String) }
impl ProbeFailure { fn message(self) -> String { match self { Self::Unavailable(s) | Self::Identity(s) => s } } }
pub struct WorkerPeerRegistry {
    vault: Arc<CloudSecretVault>,
    peers: Mutex<BTreeMap<String, PeerEntry>>,
    requests: Mutex<BTreeMap<String, RequestBinding>>,
    chat_subscriptions: Mutex<BTreeMap<String, (String, Arc<LanPcClient>)>>,
    #[cfg(any(target_os="android",target_os="ios"))]
    delivery_store: std::sync::Mutex<Option<std::sync::Weak<super::automation::AutomationStore>>>,
}

fn session_key(peer_id: &str, session_id: &str) -> Vec<u8> {
    format!("worker-peer.session.v1/{peer_id}/{session_id}").into_bytes()
}

impl WorkerPeerRegistry {
    pub fn new(vault: Arc<CloudSecretVault>) -> Result<Self, String> {
        let stored: Vec<StoredPeer> = match vault.namespaced_secret(REGISTRY_KEY)? {
            Some(bytes) => serde_json::from_slice(&bytes).map_err(|e| format!("Read worker registry failed: {e}"))?,
            None => Vec::new(),
        };
        if stored.len() > MAX_PEERS { return Err("Worker registry exceeds 32 hosts".to_string()); }
        let mut peers = BTreeMap::new();
        for peer in stored {
            peer.validate()?;
            let clients = Self::clients_for(&vault, &peer)?;
            if peers.insert(peer.peer_id.clone(), PeerEntry { stored: peer, clients }).is_some() {
                return Err("Duplicate worker identity in registry".to_string());
            }
        }
        let requests: BTreeMap<String, RequestBinding> = match vault.namespaced_secret(REQUESTS_KEY)? {
            Some(bytes) => serde_json::from_slice(&bytes).map_err(|e| format!("Read worker request bindings failed: {e}"))?,
            None => BTreeMap::new(),
        };
        if requests.len() > MAX_REQUEST_BINDINGS || requests.iter().any(|(id, binding)|
            Uuid::parse_str(id).is_err() || Uuid::parse_str(&binding.peer_id).is_err()
            || binding.input_hash.len() != 64 || !binding.input_hash.bytes().all(|b| b.is_ascii_hexdigit())) {
            return Err("Invalid persisted worker request bindings".to_string());
        }
        Ok(Self { vault, peers: Mutex::new(peers), requests: Mutex::new(requests),
            chat_subscriptions: Mutex::new(BTreeMap::new()),
            #[cfg(any(target_os="android",target_os="ios"))]
            delivery_store:std::sync::Mutex::new(None),
        })
    }

    #[cfg(any(target_os="android",target_os="ios"))]
    pub(crate) fn bind_result_delivery_store(&self,store:&Arc<super::automation::AutomationStore>)->Result<(),String>{
        self.bind_delivery_store(store,false)
    }

    #[cfg(any(target_os="android",target_os="ios"))]
    pub(crate) fn bind_os_result_delivery_store(&self,store:&Arc<super::automation::AutomationStore>)->Result<(),String>{
        self.bind_delivery_store(store,true)
    }

    #[cfg(any(target_os="android",target_os="ios"))]
    fn bind_delivery_store(&self,store:&Arc<super::automation::AutomationStore>,preserve_live:bool)->Result<(),String>{
        let mut owner=self.delivery_store.lock().map_err(|_|"Result delivery owner lock unavailable".to_string())?;
        if let Some(current)=owner.as_ref().and_then(std::sync::Weak::upgrade) {
            if current.background_worker_identity()?!=store.background_worker_identity()? {return Err("Original result owner changed".into());}
            // An OS callback must not replace a live application's revocation
            // target with a temporary store that disappears after the job.
            if preserve_live {return Ok(());}
        }
        *owner=Some(Arc::downgrade(store));Ok(())
    }

    #[cfg(any(target_os="android",target_os="ios"))]
    fn invalidate_result_delivery(&self,peer:&str)->Result<(),String>{
        if let Some(store)=self.delivery_store.lock().map_err(|_|"Result delivery owner lock unavailable".to_string())?.as_ref().and_then(std::sync::Weak::upgrade){
            store.revoke_result_delivery_peer(peer)?;
        }
        Ok(())
    }

    fn persist(&self, stored: &[StoredPeer]) -> Result<(), String> {
        let bytes = serde_json::to_vec(stored).map_err(|e| e.to_string())?;
        self.vault.set_namespaced_secret(REGISTRY_KEY, &bytes)
    }

    fn clients_for(vault: &Arc<CloudSecretVault>, stored: &StoredPeer) -> Result<Vec<EndpointClient>, String> {
        stored.endpoints().into_iter().map(|endpoint| {
            let client = Arc::new(LanPcClient::new_with_namespace(Arc::clone(vault), session_key(&stored.peer_id, &endpoint.session_id))?);
            Ok((endpoint, client))
        }).collect()
    }

    pub async fn remember(&self, active: &LanPcClient) -> Result<String, String> {
        let (info, base_url, session_id, bytes) = tokio::time::timeout(std::time::Duration::from_secs(8), active.export_worker_session())
            .await.map_err(|_| "Worker registration probe timed out".to_string())??;
        let host: WorkerHostInfo = serde_json::from_value(info).map_err(|e| format!("Decode worker catalog failed: {e}"))?;
        host.validate()?;
        Uuid::parse_str(&session_id).map_err(|_| "Invalid paired client identity".to_string())?;
        let peer_id = host.host_id.clone();
        let mut peers = self.peers.lock().await;
        if !peers.contains_key(&peer_id) && peers.len() >= MAX_PEERS { return Err("Worker registry is full (32 hosts)".to_string()); }
        // Each address was paired and probed independently. Never copy an
        // existing endpoint's cookie to a discovered or model-provided URL.
        let mut endpoints = peers.get(&peer_id).map(|entry| entry.stored.endpoints()).unwrap_or_default();
        let replaced = endpoints.iter().find(|endpoint| endpoint.base_url == base_url).cloned();
        #[cfg(any(target_os="android",target_os="ios"))]
        if replaced.as_ref().is_some_and(|old|old.session_id!=session_id){self.invalidate_result_delivery(&peer_id)?;}
        endpoints.retain(|endpoint| endpoint.base_url != base_url);
        if endpoints.len() >= MAX_ENDPOINTS { return Err("Worker endpoint limit reached (four); disconnect an unused address first".into()); }
        endpoints.push(StoredEndpoint { base_url, session_id: session_id.clone() });
        endpoints.sort_by(|a, b| endpoint_rank(&a.base_url).cmp(&endpoint_rank(&b.base_url)).then_with(|| a.base_url.cmp(&b.base_url)));
        let first = endpoints.remove(0);
        let stored = StoredPeer { peer_id: peer_id.clone(), base_url: first.base_url, session_id: first.session_id,
            host, alternate_endpoints: endpoints };
        stored.validate()?;
        let key = session_key(&peer_id, &session_id);
        self.vault.set_namespaced_secret(&key, &bytes)?;
        let mut clients = Self::clients_for(&self.vault, &stored)?;
        // Reuse retained clients: their refresh mutex owns CSRF rotations.
        if let Some(previous) = peers.get(&peer_id) {
            for (endpoint, client) in &mut clients {
                if let Some((_, existing)) = previous.clients.iter().find(|(saved, _)| saved.session_id == endpoint.session_id) {
                    *client = Arc::clone(existing);
                }
            }
        }
        let mut snapshot: Vec<_> = peers.values().filter(|p| p.stored.peer_id != peer_id).map(|p| p.stored.clone()).collect();
        snapshot.push(stored.clone());
        self.persist(&snapshot)?;
        let previous = peers.insert(peer_id.clone(), PeerEntry { stored, clients });
        if let Some(old) = replaced.filter(|old| old.session_id != session_id) {
            if let Some((_, client)) = previous.as_ref().and_then(|entry| entry.clients.iter().find(|(saved, _)| saved.session_id == old.session_id)) {
                self.retire_chat_client(client).await;
            }
            // A failed cleanup cannot undo the already persisted new binding.
            if let Err(error) = self.vault.remove_namespaced_secret(&session_key(&peer_id, &old.session_id)) {
                eprintln!("Retired worker session cleanup failed: {error}");
            }
        }
        Ok(peer_id)
    }

    pub async fn ensure_active(&self, active: &LanPcClient) -> Result<(), String> {
        let status = active.status().await;
        if !status.paired { return Ok(()); }
        let known = self.peers.lock().await.values().any(|p| p.clients.iter().any(|(endpoint, _)| Some(&endpoint.base_url) == status.base_url.as_ref()
            && Some(&endpoint.session_id) == status.device_id.as_ref()));
        if !known { self.remember(active).await?; }
        Ok(())
    }

    pub async fn owns_active(&self, peer_id: &str, active: &LanPcClient) -> bool {
        let status = active.status().await;
        self.peers.lock().await.get(peer_id).is_some_and(|p| p.clients.iter().any(|(endpoint, _)|
            Some(&endpoint.base_url) == status.base_url.as_ref() && Some(&endpoint.session_id) == status.device_id.as_ref()))
    }

    pub async fn forget_active(&self, active: &LanPcClient) -> Result<(), String> {
        let status = active.status().await;
        let found = self.peers.lock().await.values().find_map(|p| p.clients.iter().find(|(endpoint, _)| Some(&endpoint.base_url) == status.base_url.as_ref()
            && Some(&endpoint.session_id) == status.device_id.as_ref()).map(|(endpoint, _)| (p.stored.peer_id.clone(), endpoint.session_id.clone())));
        if let Some((id, session)) = found { self.forget_session(&id, &session).await?; }
        Ok(())
    }

    pub async fn forget_endpoint(&self, peer_id: &str, base_url: &str) -> Result<(), String> {
        let url = super::lan_pc_client::normalize_base_url(base_url)?;
        let session = self.peers.lock().await.get(peer_id).and_then(|peer|
            peer.clients.iter().find(|(endpoint, _)| endpoint.base_url == url).map(|(endpoint, _)| endpoint.session_id.clone()))
            .ok_or_else(|| "Paired worker endpoint not found".to_string())?;
        self.forget_session(peer_id, &session).await
    }

    async fn forget_session(&self, id: &str, session: &str) -> Result<(), String> {
        let mut peers = self.peers.lock().await;
        let current = peers.get(id).ok_or_else(|| "Worker peer disappeared".to_string())?;
        if !current.clients.iter().any(|(endpoint, _)| endpoint.session_id == session) {
            return Err("Worker session changed; inspect the current endpoints before removing".into());
        }
        #[cfg(any(target_os="android",target_os="ios"))]
        self.invalidate_result_delivery(id)?;
        let mut endpoints = current.stored.endpoints();
        let retired = current.clients.iter().find(|(endpoint, _)| endpoint.session_id == session).map(|(_, client)| Arc::clone(client));
        endpoints.retain(|endpoint| endpoint.session_id != session);
        let replacement = if endpoints.is_empty() { None } else {
            let first = endpoints.remove(0);
            let stored = StoredPeer { base_url: first.base_url, session_id: first.session_id,
                alternate_endpoints: endpoints, ..current.stored.clone() };
            let clients = current.clients.iter().filter(|(endpoint, _)| endpoint.session_id != session).cloned().collect();
            Some(PeerEntry { stored, clients })
        };
        let mut snapshot: Vec<_> = peers.values().filter(|p| p.stored.peer_id != id).map(|p| p.stored.clone()).collect();
        if let Some(entry) = &replacement { snapshot.push(entry.stored.clone()); }
        self.persist(&snapshot)?;
        peers.remove(id);
        if let Some(entry) = replacement { peers.insert(id.to_string(), entry); }
        if let Some(client) = retired { self.retire_chat_client(&client).await; }
        self.vault.remove_namespaced_secret(&session_key(id, session))?;
        Ok(())
    }

    async fn entry(&self, peer_id: &str) -> Result<(StoredPeer, Vec<EndpointClient>), String> {
        let peers = self.peers.lock().await;
        peers.get(peer_id).map(|p| (p.stored.clone(), p.clients.clone()))
            .ok_or_else(|| "Worker peer not found; pair this computer first".to_string())
    }

    /// Resolve only protected pairings. An address is never a host identity and
    /// no cookie is moved or new session created by selecting a Goal store.
    pub async fn resolve_endpoint(&self, base_url: &str) -> Result<String, String> {
        let url = super::lan_pc_client::normalize_base_url(base_url)?;
        let peers = self.peers.lock().await;
        let mut matching = peers.values().filter(|entry| entry.stored.endpoints().iter().any(|endpoint| endpoint.base_url == url));
        let peer = matching.next().ok_or("Pair this computer before controlling its Goals")?;
        if matching.next().is_some() { return Err("Selected address has ambiguous protected worker identities; inspect and pair again".into()); }
        Ok(peer.stored.peer_id.clone())
    }

    async fn probe_endpoint(peer_id: &str, endpoint: &StoredEndpoint, client: &LanPcClient) -> Result<WorkerHostInfo, ProbeFailure> {
        let raw = tokio::time::timeout(std::time::Duration::from_secs(8),
            client.invoke(Some(&endpoint.base_url), "automation_background_host_info", serde_json::json!({})))
            .await.map_err(|_| ProbeFailure::Unavailable("Worker probe timed out".into()))?
            .map_err(ProbeFailure::Unavailable)?;
        let host: WorkerHostInfo = serde_json::from_value(raw).map_err(|e| ProbeFailure::Identity(format!("Decode worker catalog failed: {e}")))?;
        host.validate().map_err(ProbeFailure::Identity)?;
        if host.host_id != peer_id { return Err(ProbeFailure::Identity("Worker identity changed; pair and inspect the new host before sending tasks".into())); }
        Ok(host)
    }

    pub async fn probe(&self, peer_id: &str) -> Result<WorkerHostInfo, String> {
        let (stored, clients) = self.entry(peer_id).await?;
        let (selected, _) = Self::probe_entry(&stored, &clients).await;
        selected.map(|(_, _, host)| host)
    }

    /// Observe paired virtual-network services, not VPN ownership/readiness.
    async fn probe_entry(stored: &StoredPeer, clients: &[EndpointClient])
        -> (Result<(StoredEndpoint, Arc<LanPcClient>, WorkerHostInfo), String>, Vec<WorkerEndpointStatus>) {
        // Read-only probes run concurrently under the same eight-second bound.
        // A slower working LAN still wins over a faster Tailnet response.
        let probes: Vec<_> = clients.iter().map(|(endpoint, client)| {
            let peer_id = stored.peer_id.clone();
            let endpoint = endpoint.clone();
            let client = Arc::clone(client);
            async move { Self::probe_endpoint(&peer_id, &endpoint, &client).await }.boxed()
        }).collect();
        let results = futures_util::future::join_all(probes).await;
        let mut selected = None;
        let mut invalid_identity = None;
        let mut statuses = Vec::new();
        for ((endpoint, client), result) in clients.iter().zip(results) {
            let (online, error) = match result {
                Ok(host) => {
                    if selected.is_none() { selected = Some((endpoint.clone(), Arc::clone(client), host)); }
                    (true, None)
                }
                Err(error) => {
                    if matches!(&error, ProbeFailure::Identity(_)) { invalid_identity = Some("Worker endpoint identity is invalid; inspect and pair again before continuing".to_string()); }
                    (false, Some(error.message().chars().take(2048).collect()))
                }
            };
            statuses.push(WorkerEndpointStatus { base_url: endpoint.base_url.clone(), network: endpoint_network(&endpoint.base_url).into(), online, error });
        }
        let selection = if let Some(error) = invalid_identity { Err(error) } else {
            selected.ok_or_else(|| "No authenticated endpoint for this worker is reachable; reconnect the original host".to_string())
        };
        (selection, statuses)
    }

    /// Pin a previously authenticated peer before network. A cached entry is
    /// ownership, not live capability/readiness evidence; invoke still probes.
    pub async fn submission_target(&self, peer_id: Option<&str>, base_url: Option<&str>) -> Result<String, String> {
        let peers = self.peers.lock().await;
        let selected = if let Some(id) = peer_id {
            peers.get(id).map(|entry| &entry.stored)
        } else if let Some(url) = base_url {
            let mut matches = peers.values().filter(|entry| entry.clients.iter().any(|(endpoint, _)| endpoint.base_url == url.trim_end_matches('/')));
            let selected = matches.next().map(|entry| &entry.stored);
            if matches.next().is_some() { return Err("Selected endpoint has ambiguous protected worker identities; select a stable peer".into()); }
            selected
        } else { None }.ok_or_else(|| "Target is not a protected paired worker; pair it before saving a task".to_string())?;
        if selected.host.input_snapshot_version != 1 {
            return Err("This worker does not advertise immutable task/input acceptance; update before using durable submission retries".into());
        }
        Ok(selected.peer_id.clone())
    }

    pub async fn resolve_request(&self, request_id: &str) -> Result<Option<String>, String> {
        let id = Uuid::parse_str(request_id).map_err(|_| "Background requestId must be a UUID".to_string())?.to_string();
        Ok(self.requests.lock().await.get(&id).map(|binding| binding.peer_id.clone()))
    }

    /// Accepted and uncertain submissions share the same protected owner map.
    /// Never scan unrelated tasks on other devices to discover results.
    pub async fn result_requests(&self) -> Vec<super::automation::BackgroundResultWatch> {
        self.requests.lock().await.iter().map(|(request_id, binding)| super::automation::BackgroundResultWatch {
            source_host_id: binding.peer_id.clone(), request_id: request_id.clone(),
        }).collect()
    }

    /// Private native receiver setup. The public model/device invoke whitelist
    /// cannot mint or export these capabilities or full paired credentials.
    #[cfg(any(target_os="android",target_os="ios"))]
    pub(crate) async fn result_delivery_target(&self,watch:&super::automation::BackgroundResultWatch,receiver:&str)->Result<super::automation::store::ResultDeliveryTarget,String>{
        use super::automation::store::{ResultDeliveryTarget,ResultDeliveryEndpoint};
        if self.resolve_request(&watch.request_id).await?.as_deref()!=Some(watch.source_host_id.as_str()) {return Err("No protected original request owner".into());}
        let (stored,clients)=self.entry(&watch.source_host_id).await?;
        let mut endpoints=Vec::new();
        for (endpoint,client) in clients {
            let key=format!("worker.result-read.v1/{}/{}/{}/{}",receiver,watch.source_host_id,endpoint.session_id,watch.request_id).into_bytes();
            let acknowledgement_key=format!("worker.result-read-ack.v1/{}/{}/{}/{}",receiver,watch.source_host_id,endpoint.session_id,watch.request_id).into_bytes();
            let capability=match self.vault.namespaced_secret(&key)? {
                Some(bytes)=>String::from_utf8(bytes).map_err(|_|"Invalid retained scoped token".to_string())?,
                None=>{
                    let token=format!("{}{}",Uuid::new_v4().simple(),Uuid::new_v4().simple());
                    self.vault.set_namespaced_secret(&key,token.as_bytes())?;token
                },
            };
            let result=tokio::time::timeout(std::time::Duration::from_secs(4),async{
                let host:WorkerHostInfo=serde_json::from_value(client.invoke(Some(&endpoint.base_url),"automation_background_host_info",serde_json::json!({})).await?).map_err(|e|e.to_string())?;
                host.validate()?;
                if host.host_id!=stored.peer_id || host.result_delivery_version!=1 {return Err("Original host lacks scoped OS result delivery".to_string());}
                client.invoke(Some(&endpoint.base_url),"automation_background_result_grant",serde_json::json!({"request_id":watch.request_id,"receiver_host_id":receiver,"source_host_id":watch.source_host_id,"token":capability})).await
            }).await;
            // A temporarily unreachable LAN/tailnet address must not discard
            // its still-valid original grant. No cookie is copied to another
            // URL: each cache remains bound to the protected endpoint session.
            let (ack,fresh)=match result {
                Ok(Ok(ack))=>(ack,true),
                _=>match self.vault.namespaced_secret(&acknowledgement_key)? {
                    Some(bytes)=>(serde_json::from_slice::<Value>(&bytes).map_err(|_|"Invalid retained scoped result ACK".to_string())?,false),
                    None=>continue,
                },
            };
            let Some(expires)=ack["expiresAt"].as_i64().filter(|value|*value>super::automation::db::now_ms()) else {continue;};
            if ack["version"]!=1 || ack["requestId"]!=watch.request_id || ack["sourceHostId"]!=watch.source_host_id || ack["receiverHostId"]!=receiver || ack["sessionId"]!=endpoint.session_id {return Err("Scoped grant acknowledgement changed its original binding".into());}
            if fresh {self.vault.set_namespaced_secret(&acknowledgement_key,&serde_json::to_vec(&ack).map_err(|e|e.to_string())?)?;}
            endpoints.push(ResultDeliveryEndpoint{base_url:endpoint.base_url,session_id:endpoint.session_id,token:capability,expires_at:expires});
        }
        let target=ResultDeliveryTarget{request_id:watch.request_id.clone(),source_host_id:watch.source_host_id.clone(),endpoints};
        target.binding_hash()?;Ok(target)
    }

    #[cfg(any(target_os="android",target_os="ios"))]
    pub(crate) async fn stage_result_delivery_target(&self,store:&super::automation::AutomationStore,target:&super::automation::store::ResultDeliveryTarget)->Result<(),String>{
        // Serialize the last protected endpoint check against peer forgetting.
        let peers=self.peers.lock().await;
        let entry=peers.get(&target.source_host_id).ok_or("Result peer was forgotten")?;
        let endpoints=entry.stored.endpoints();
        if target.endpoints.iter().any(|target|!endpoints.iter().any(|endpoint|endpoint.base_url==target.base_url && endpoint.session_id==target.session_id)) {return Err("Original endpoint session was removed".into());}
        store.stage_result_delivery(target)
    }

    async fn bind_request(&self, peer_id: &str, args: &Value) -> Result<(), String> {
        let input = serde_json::from_value(args.get("input").cloned().ok_or_else(|| "Task input is required".to_string())?)
            .map_err(|e| e.to_string())?;
        let input = super::automation::AutomationStore::normalize_background_task_input(input)?;
        let id = input.request_id.clone();
        let input_hash = hex::encode(Sha256::digest(serde_json::to_vec(&input).map_err(|e| e.to_string())?));
        let mut requests = self.requests.lock().await;
        if let Some(binding) = requests.get(&id) {
            if binding.peer_id != peer_id || binding.input_hash != input_hash {
                return Err("requestId is already bound to another worker or task input; query the original worker before creating a new request".to_string());
            }
            return Ok(());
        }
        if requests.len() >= MAX_REQUEST_BINDINGS { return Err("Worker request binding limit reached; no task was sent".to_string()); }
        let mut next = requests.clone();
        next.insert(id, RequestBinding { peer_id: peer_id.to_string(), input_hash });
        self.vault.set_namespaced_secret(REQUESTS_KEY, &serde_json::to_vec(&next).map_err(|e| e.to_string())?)?;
        *requests = next;
        Ok(())
    }

    pub async fn list(&self) -> Vec<WorkerPeerStatus> {
        use futures_util::{stream, StreamExt};
        let entries: Vec<_> = self.peers.lock().await.values().map(|p| (p.stored.clone(), p.clients.clone())).collect();
        let mut results: Vec<_> = stream::iter(entries).map(|(stored, clients)| async move {
            let (result, endpoints) = Self::probe_entry(&stored, &clients).await;
            let (online, base_url, host, error) = match result {
                Ok((endpoint, _, host)) => (true, endpoint.base_url, host, None),
                Err(error) => (false, stored.base_url, stored.host, Some(error)),
            };
            WorkerPeerStatus { peer_id: stored.peer_id, base_url, online, host, endpoints, error }
        }).buffer_unordered(4).collect().await;
        results.sort_by(|a, b| a.peer_id.cmp(&b.peer_id));
        results
    }

    pub async fn invoke(&self, peer_id: &str, command: &str, args: Value) -> Result<Value, String> {
        if !matches!(command, "automation_background_submit" | "automation_background_get" | "automation_background_children" | "automation_background_list"
            | "automation_background_cancel" | "automation_background_resume" | "automation_background_resume_receipt" | "automation_background_operations" | "automation_background_read_artifact" | "automation_background_read_artifact_chunk" | "automation_background_device_branches"
            | "automation_background_device_plan" | "automation_background_device_complete" | "automation_background_device_planning_exchange"
            | "automation_goal_snapshot" | "automation_goal_apply" | "automation_goal_executors" | "automation_goal_launch"
            | "automation_goal_activity" | "automation_goal_artifacts" | "automation_goal_artifact_content") {
            return Err("Worker peers only accept task, Goal, result and artifact operations".to_string());
        }
        let (stored, clients) = self.entry(peer_id).await?;
        if command == "automation_background_submit" {
            self.bind_request(peer_id, &args).await?;
        } else if let Some(id) = args.get("request_id").and_then(Value::as_str).filter(|_| command.starts_with("automation_background_")) {
            if self.resolve_request(id).await?.is_some_and(|owner| owner != peer_id) {
                return Err("This request belongs to a different worker".to_string());
            }
        }
        let (selection, _) = Self::probe_entry(&stored, &clients).await;
        let (endpoint, client, host) = selection?;
        if command == "automation_background_submit" && args.get("input").and_then(|input| input.get("goalBinding")).is_some_and(|v| !v.is_null())
            && host.goal_acceptance_version != 1 {
            return Err("Worker does not support atomic goal acceptance; no task was sent".into());
        }
        if args.get("device_channel").is_some_and(|value| !value.is_null()) && host.device_channel_version != 1 {
            return Err("Worker does not support the private original-device channel; no capability was sent".into());
        }
        if (matches!(command,"automation_background_device_plan" | "automation_background_device_complete" | "automation_background_device_planning_exchange")
            || (command == "automation_background_submit" && args.get("device_channel").is_some_and(|value|!value.is_null()))) && host.device_actions_version != 1 {
            return Err("Worker does not support native original-device action joining; no task/capability was sent".into());
        }
        if command == "automation_background_submit" && args.get("input").and_then(|input| input.get("intelligentSchedulingEnabled")).and_then(serde_json::Value::as_bool) == Some(true)
            && host.intelligent_scheduling_version != 1 {
            return Err("Worker does not support intelligent model scheduling; no task was sent".into());
        }
        if command == "automation_background_submit" && args.get("input").and_then(|input| input.get("delegation"))
            .and_then(|delegation| delegation.get("budget")).is_some_and(|budget| !budget.is_null()) && host.budget_delegation_version != 1 {
            return Err("Worker cannot enforce a delegated lifetime budget; no task was sent".into());
        }
        if command=="automation_background_submit" && args.get("input").and_then(|input|input.get("delegation")).and_then(|delegation|delegation.get("budget")).and_then(|budget|budget.get("deadlineAt")).is_some_and(|value|!value.is_null()) && host.budget_deadline_version!=1 {
            return Err("Worker cannot enforce the original task deadline; no task was sent".into());
        }
        if command == "automation_background_submit" {
            if let Some(source) = args.get("input").and_then(|input| input.get("sourceContext")).filter(|v| !v.is_null()) {
                let required = source.get("version").and_then(Value::as_u64).unwrap_or(0);
                if !matches!(required, 1 | 2) || u64::from(host.source_context_version) < required {
                    return Err("Worker does not support this immutable source conversation version; no task was sent".into());
                }
            }
        }
        if command == "automation_background_submit" {
            if let Some(routing)=args.get("input").and_then(|input|input.get("sourceContext")).and_then(|source|source.get("routing")).filter(|v|!v.is_null()) {
                let required=routing.get("version").and_then(Value::as_u64).unwrap_or(0);
                if !matches!(required,1|2) || u64::from(host.source_routing_version)<required || host.device_channel_version!=1 {
                    return Err("Worker does not enforce this initiating-device branch/read contract version; no task was sent".into());
                }
            }
        }
        if command == "automation_background_submit" && args.get("input").and_then(|input| input.get("requirements")).and_then(|r| r.get("modelSkills"))
            .and_then(Value::as_array).is_some_and(|skills| !skills.is_empty()) && host.model_routing_version != 1 {
            return Err("Worker does not enforce selected-model specialties; no task was sent".into());
        }
        if command == "automation_background_submit" && args.get("input").and_then(|input| input.get("requirements")).is_some_and(|r|
            ["capabilities", "platforms"].iter().any(|key| r.get(*key).and_then(Value::as_array).is_some_and(|ids| !ids.is_empty())))
            && host.inventory.as_ref().is_none_or(|inventory| inventory.version != 1) {
            return Err("Worker does not advertise observed requirement enforcement; no task was sent".into());
        }
        if command == "automation_background_resume" && host.waiting_version != 1 {
            return Err("Worker does not support durable waiting resumption; no response was sent".into());
        }
        if matches!(command,"automation_background_resume"|"automation_background_resume_receipt") && args.get("request_id") != args.get("input").and_then(|input| input.get("requestId")) {
            return Err("Resume request does not match its bound owner".into());
        }
        if command == "automation_background_submit" && args.get("input").and_then(|input| input.get("delegation"))
            .is_some_and(|value| !value.is_null()) && host.delegation_version != 1 {
            return Err("Worker does not enforce background delegation chains; no task was sent".to_string());
        }
        if command == "automation_background_submit" && args.get("input").and_then(|input|input.get("delegation"))
            .is_some_and(|value|!value.is_null()) && host.child_tasks_version != 1 {
            return Err("Worker does not support persistent child joins and cascading stops; update it before delegating".into());
        }
        if command == "automation_background_submit" && args.get("input").and_then(|input| input.get("files"))
            .and_then(Value::as_array).is_some_and(|files| !files.is_empty()) && host.input_snapshot_version != 1 {
            return Err("Worker does not support durable input snapshots; no task was sent".to_string());
        }
        // No transport-error replay and no switching to another host: acceptance
        // may already have happened. Recover using this peer and request ID.
        let (current, _) = self.entry(peer_id).await?;
        if !current.endpoints().iter().any(|known| known.base_url == endpoint.base_url && known.session_id == endpoint.session_id) {
            return Err("Original worker pairing changed during the probe; reconnect and retry".into());
        }
        client.invoke(Some(&endpoint.base_url), command, args).await
    }

    pub async fn invoke_file(&self, peer_id: &str, command: &str, args: Value) -> Result<Value, String> {
        if !matches!(command, "fs_path_status" | "fs_read_workspace_image" | "fs_read_editable_text"
            | "fs_write_text" | "fs_write_docx_text" | "fs_write_binary"
            | "fs_file_applications" | "fs_open_workspace_path") {
            return Err("Worker file access only accepts workspace preview operations".into());
        }
        let workdir = args.get("workdir").and_then(Value::as_str)
            .ok_or_else(|| "Missing original file workspace".to_string())?;
        if workdir.is_empty() || workdir.len() > 32768 || workdir.contains('\0') {
            return Err("Invalid original file workspace".into());
        }
        let (stored, clients) = self.entry(peer_id).await?;
        let (selected, _) = Self::probe_entry(&stored, &clients).await;
        let (endpoint, client, _) = selected?;
        let (current, _) = self.entry(peer_id).await?;
        if !current.endpoints().iter().any(|known| known.base_url == endpoint.base_url && known.session_id == endpoint.session_id) {
            return Err("Original worker pairing changed during file access; reconnect and retry".into());
        }
        // Current authenticated permissions and filesystem validation remain
        // authoritative. A failed write is never replayed on another endpoint.
        client.invoke(Some(&endpoint.base_url), command, args).await
    }

    pub async fn forget(&self, peer_id: &str) -> Result<(), String> {
        let mut peers = self.peers.lock().await;
        let stored = peers.get(peer_id).ok_or_else(|| "Worker peer not found".to_string())?.stored.clone();
        #[cfg(any(target_os="android",target_os="ios"))]
        self.invalidate_result_delivery(peer_id)?;
        let snapshot: Vec<_> = peers.values().filter(|p| p.stored.peer_id != peer_id).map(|p| p.stored.clone()).collect();
        self.persist(&snapshot)?;
        if let Some(entry) = peers.remove(peer_id) {
            for (_, client) in entry.clients { self.retire_chat_client(&client).await; }
        }
        for endpoint in stored.endpoints() {
            self.vault.remove_namespaced_secret(&session_key(peer_id, &endpoint.session_id))?;
        }
        Ok(())
    }
}
