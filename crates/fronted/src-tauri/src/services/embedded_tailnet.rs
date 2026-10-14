//! App-owned userspace Tailscale. No system daemon, installer, TUN or OS routes.
//! SDK API: GeiserX/tailscale-rs eabd2cf2b810d18881c9cf305000d6f42aacbd19.
use std::{net::IpAddr, sync::{Arc, OnceLock}, time::Duration};
use serde::{Deserialize, Serialize};
use tokio::{sync::{watch, Mutex}, task::JoinHandle};
use super::{cloud_secret_vault::CloudSecretVault, tailscale_setup::TailscaleAuthInput,
    tailscale_status::TailscaleStatus};
mod oauth;
mod transport;
mod network;
mod discovery;
mod lifecycle;
pub(crate) use discovery::discover_workers;

const KEY: &[u8] = b"tailscale.embedded.node.v1";
static ENGINE: OnceLock<Arc<Engine>> = OnceLock::new();

// Never Debug: PersistState contains private keys. Only Stronghold stores it.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SavedNode {
    version: u8,
    enabled: bool,
    tags: Vec<String>,
    keys: tailscale::keys::PersistState,
}

pub(super) struct Session {
    device: Arc<tailscale::Device>,
    stop: watch::Receiver<bool>,
}

struct Running {
    stop: watch::Sender<bool>,
    task: JoinHandle<()>,
}

struct Engine {
    vault: Arc<CloudSecretVault>,
    running: Mutex<Option<Running>>,
    live: watch::Sender<Option<Arc<Session>>>,
    state: watch::Sender<&'static str>,
}

fn engine() -> Result<&'static Arc<Engine>, String> {
    ENGINE.get().ok_or_else(|| "tailscale-engine-unavailable".into())
}

pub(crate) fn initialize(vault: Arc<CloudSecretVault>) -> Result<(), String> {
    // The SDK requires this process-local, non-secret acknowledgement. Configure
    // it once before creating the SDK, including an original OS-only cold start.
    static PREPARED: std::sync::Once = std::sync::Once::new();
    PREPARED.call_once(|| std::env::set_var("TS_RS_EXPERIMENT", "this_is_unstable_software"));
    let _ = rustls::crypto::ring::default_provider().install_default();
    if let Some(owner) = ENGINE.get() {
        return if Arc::ptr_eq(&owner.vault,&vault) {Ok(())} else {Err("tailscale-engine-unavailable".into())};
    }
    let engine = Arc::new(Engine { vault, running: Mutex::new(None), live: watch::channel(None).0, state: watch::channel("login-required").0 });
    if ENGINE.set(Arc::clone(&engine)).is_err() {
        // Foreground startup and an OS callback may race. Join only the same
        // protected owner; never install a second actor graph or new identity.
        let owner=ENGINE.get().ok_or("tailscale-engine-unavailable")?;
        return if Arc::ptr_eq(&owner.vault,&engine.vault) {Ok(())} else {Err("tailscale-engine-unavailable".into())};
    }
    // Resume only the original protected node that the user enabled. Never create
    // a replacement identity or obtain new credentials during background startup.
    tauri::async_runtime::spawn(async move {
        let result = async {
            let mut running = engine.running.lock().await;
            if running.is_none() {
                if let Some(saved) = engine.saved()? {
                    if saved.enabled { *running = Some(engine.launch(saved, None)); }
                }
            }
            Ok::<_, String>(())
        }.await;
        if result.is_err() { engine.state.send_replace("offline"); eprintln!("Embedded Tailscale identity unavailable; local chat and LAN remain usable"); }
    });
    Ok(())
}

impl Engine {
    fn saved(&self) -> Result<Option<SavedNode>, String> {
        let Some(bytes) = self.vault.namespaced_secret(KEY).map_err(|_| "tailscale-credential-file")? else { return Ok(None); };
        if bytes.len() > 65_536 { return Err("tailscale-credential-file".into()); }
        let saved: SavedNode = serde_json::from_slice(&bytes).map_err(|_| "tailscale-credential-file")?;
        if saved.version != 1 || !super::tailscale_setup::valid_tags(&saved.tags) {
            return Err("tailscale-credential-file".into());
        }
        Ok(Some(saved))
    }

    fn save(&self, saved: &SavedNode) -> Result<(), String> {
        let bytes = serde_json::to_vec(saved).map_err(|_| "tailscale-credential-file")?;
        self.vault.set_namespaced_secret(KEY, &bytes).map_err(|_| "tailscale-credential-file".into())
    }

    fn launch(self: &Arc<Self>, saved: SavedNode, auth_key: Option<String>) -> Running {
        self.state.send_replace("starting");
        let (stop, mut stopped) = watch::channel(false);
        let owner = Arc::clone(self);
        let task = tokio::spawn(async move {
            let config = tailscale::Config {
                key_state: saved.keys, client_name: Some("xgent".into()),
                requested_tags: saved.tags, ephemeral: false, reauth_on_expiry: false,
                accept_dns: false, enable_ipv6: true, ..Default::default()
            };
            // Keep registration credentials in zeroizing memory only until the
            // first successful registration. Retries retain the exact same keys;
            // they never exchange OAuth again or dispatch application work.
            let mut auth_key = auth_key.map(tailscale::SecretString::from);
            let mut backoff = lifecycle::Backoff::default();
            loop {
                if *stopped.borrow() { break; }
                // Do not cancel Device construction and abandon spawned actors.
                // A late construction after logout is drained without publication.
                let device = match tailscale::Device::new_with_secret(&config, auth_key.clone()).await {
                    Ok(device) => device,
                    Err(_) => { owner.state.send_replace("offline"); return; },
                };
                let mut device = Arc::new(device);
                // One signal retires this attempt's sockets; the outer signal
                // records the user's stop and must survive a transient failure.
                let (retire, retired) = watch::channel(false);
                let mut retry = false;
                if !*stopped.borrow() {
                    owner.live.send_replace(Some(Arc::new(Session {
                        device: Arc::clone(&device), stop: retired.clone(),
                    })));
                    let monitor = network::monitor(&device, retired);
                    tokio::pin!(monitor);
                    let mut states = device.watch_state();
                    loop {
                        let state = device.device_state();
                        if matches!(&state, tailscale::DeviceState::Running) {
                            auth_key = None;
                            backoff.reset();
                        }
                        if lifecycle::exit(&state).is_some() { break; }
                        tokio::select! {
                            _ = stopped.changed() => break,
                            _ = &mut monitor => break,
                            changed = states.changed() => { if changed.is_err() { break; } },
                        }
                    }
                    let state = device.device_state();
                    retry = lifecycle::exit(&state) == Some(lifecycle::Exit::Retry);
                    owner.state.send_replace(if *stopped.borrow() { "stopped" } else { device_status(&state) });
                    // Notify every outstanding socket owner before draining Arc.
                    retire.send_replace(true);
                    owner.live.send_replace(None);
                }
                loop {
                    match Arc::try_unwrap(device) {
                        Ok(device) => { let _ = device.shutdown(Some(Duration::from_secs(5))).await; break; }
                        Err(retained) => { device = retained; tokio::time::sleep(Duration::from_millis(20)).await; }
                    }
                }
                if !retry || *stopped.borrow() { break; }
                tokio::select! {
                    _ = stopped.changed() => break,
                    _ = tokio::time::sleep(backoff.next()) => {},
                }
            }
        });
        Running { stop, task }
    }
}

pub(crate) async fn authenticate(input: TailscaleAuthInput) -> Result<TailscaleStatus, String> {
    let value = super::tailscale_setup::validated_credential(&input)?;
    let owner = engine()?;
    let mut running = owner.running.try_lock().map_err(|_| "tailscale-busy")?;
    if running.as_ref().is_some_and(|work| !work.task.is_finished()) { return Err("tailscale-busy".into()); }
    let mut saved = match owner.saved()? {
        Some(saved) => saved,
        None => SavedNode { version: 1, enabled: false, tags: vec![], keys: Default::default() },
    };
    // Exchange OAuth for an actual, single-use auth key; never give the Rust
    // Device a CLI-only tskey-client secret or persist either registration key.
    let key = oauth::auth_key(input.mode, value, &input.tags).await?;
    saved.enabled = true;
    saved.tags = input.tags;
    owner.save(&saved)?;
    *running = Some(owner.launch(saved, Some(key)));
    drop(running);
    Ok(observe().await)
}

pub(crate) async fn logout() -> Result<TailscaleStatus, String> {
    let owner = engine()?;
    let mut running = owner.running.try_lock().map_err(|_| "tailscale-busy")?;
    // Durable disable precedes any shutdown or secret deletion, so restart
    // cannot silently reconnect after an interrupted logout.
    if let Some(mut saved) = owner.saved()? { saved.enabled = false; owner.save(&saved)?; }
    if let Some(work) = running.as_mut() {
        work.stop.send_replace(true);
        owner.live.send_replace(None);
        let joined = tokio::time::timeout(Duration::from_secs(10), &mut work.task).await
            .map_err(|_| "tailscale-timed-out")?;
        if joined.is_err() {
            // A completed JoinHandle cannot be polled again. Retire it while
            // retaining the durable disabled identity and an explicit error.
            *running = None;
            return Err("tailscale-command-failed".into());
        }
    }
    *running = None;
    owner.state.send_replace("stopped");
    owner.vault.remove_namespaced_secret(KEY).map_err(|_| "tailscale-credential-file")?;
    drop(running);
    Ok(observe().await)
}

fn device_status(state: &tailscale::DeviceState) -> &'static str {
    match state {
        tailscale::DeviceState::Running => "running",
        tailscale::DeviceState::NeedsMachineAuth => "approval-required",
        tailscale::DeviceState::Connecting | tailscale::DeviceState::Reauthenticating => "starting",
        tailscale::DeviceState::NeedsLogin(_) | tailscale::DeviceState::Expired => "login-required",
        tailscale::DeviceState::Failed(_) if lifecycle::exit(state) == Some(lifecycle::Exit::Retry) => "starting",
        tailscale::DeviceState::Failed(_) => "login-required",
        _ => "offline",
    }
}

pub(crate) async fn observe() -> TailscaleStatus {
    let mut status = TailscaleStatus { state: "login-required".into(), addresses: vec![],
        dns_name: None, observed_at: super::automation::db::now_ms(), engine: Some("embedded-rust".into()),
        can_authenticate: Some(false), can_logout: Some(false) };
    let Ok(owner) = engine() else { status.state = "offline".into(); return status; };
    if let Ok(running) = owner.running.try_lock() {
        status.can_authenticate = Some(running.as_ref().is_none_or(|work| work.task.is_finished()));
        status.can_logout = Some(running.is_some() || owner.saved().ok().flatten().is_some());
    }
    status.state = (*owner.state.borrow()).into();
    let session = owner.live.borrow().clone();
    let Some(session) = session else {
        if let Ok(running) = owner.running.try_lock() {
            if let Some(work) = running.as_ref() {
                if !work.task.is_finished() && !*work.stop.borrow() { status.state = "starting".into(); }
            }
        } else { status.state = "starting".into(); }
        return status;
    };
    let read = async {
        match session.device.device_state() {
            tailscale::DeviceState::Running => {
                let ipv4 = session.device.ipv4_addr().await.ok()?;
                if !super::worker_peers::is_tailnet_ipv4(ipv4) { return None; }
                let mut ips = vec![ipv4.to_string()];
                if let Ok(ipv6) = session.device.ipv6_addr().await {
                    if ipv6.segments()[..3] == [0xfd7a, 0x115c, 0xa1e0] { ips.push(ipv6.to_string()); }
                }
                let name = session.device.self_node().await.ok().and_then(|node| node.fqdn_opt(false))
                    .and_then(|name| super::tailscale_status::normalize_magic_dns_name(&name));
                Some(("running", ips, name))
            },
            state => Some((device_status(&state), vec![], None)),
        }
    };
    if let Ok(Some((state, addresses, name))) = tokio::time::timeout(Duration::from_secs(2), read).await {
        // Do not publish addresses from an old, canceled node after logout.
        if !*session.stop.borrow() {
            status.state = state.into(); status.addresses = addresses; status.dns_name = name;
            status.observed_at = super::automation::db::now_ms();
            return status;
        }
    }
    status.state = "offline".into();
    status
}

pub(crate) fn with_proxy(builder: reqwest::ClientBuilder) -> Result<reqwest::ClientBuilder, String> {
    transport::with_proxy(builder)
}

pub(crate) fn uses_transport(base_url:&str)->bool {
    reqwest::Url::parse(base_url).ok().and_then(|url|url.host_str().map(tailnet_host)).unwrap_or(false)
}

#[cfg(mobile)]
pub(crate) async fn wait_ready_for_os()->Result<(),String> {
    let owner=engine()?;
    if !owner.saved()?.is_some_and(|saved|saved.enabled) {return Err("tailscale-engine-unavailable".into());}
    loop {
        let status=observe().await;
        match status.state.as_str() {
            "running"=>return Ok(()),
            "login-required"|"stopped"=>return Err("tailscale-engine-unavailable".into()),
            _ if status.can_authenticate==Some(true)=>return Err("tailscale-engine-unavailable".into()),
            _=>{},
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[cfg(mobile)]
pub(crate) fn with_blocking_proxy(builder: reqwest::blocking::ClientBuilder) -> Result<reqwest::blocking::ClientBuilder, String> {
    transport::with_blocking_proxy(builder)
}

#[cfg(desktop)]
pub(crate) async fn serve_worker(port: u16, host_id: String, router: axum::Router) {
    if let Ok(owner) = engine() { transport::serve_worker(owner.live.subscribe(), port, host_id, router).await; }
    // Optional transport failure must not end the original LAN server.
    std::future::pending::<()>().await;
}

fn tailnet_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => super::worker_peers::is_tailnet_ipv4(ip),
        IpAddr::V6(ip) => ip.segments()[..3] == [0xfd7a, 0x115c, 0xa1e0],
    }
}

fn tailnet_host(raw: &str) -> bool {
    raw.trim_matches(['[', ']']).parse::<IpAddr>().map(tailnet_ip).unwrap_or_else(|_| {
        super::tailscale_status::normalize_magic_dns_name(raw).is_some()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn terminal_and_approval_states_do_not_masquerade_as_startup() {
        assert_eq!(device_status(&tailscale::DeviceState::NeedsMachineAuth), "approval-required");
        assert_eq!(device_status(&tailscale::DeviceState::Expired), "login-required");
        assert_eq!(device_status(&tailscale::DeviceState::Connecting), "starting");
        for error in [tailscale::RegistrationError::AuthRejected("rejected".into()),
            tailscale::RegistrationError::KeyExpired,
            tailscale::RegistrationError::NeedsLogin("https://login.tailscale.com/a/test".parse().unwrap())] {
            assert_eq!(device_status(&tailscale::DeviceState::Failed(error)), "login-required");
        }
        for error in [tailscale::RegistrationError::NetworkUnreachable, tailscale::RegistrationError::Timeout] {
            assert_eq!(device_status(&tailscale::DeviceState::Failed(error)), "starting");
        }
    }
    #[test]
    fn overlay_scope_excludes_lan_public_dns_and_tailscale_service_addresses() {
        for host in ["100.70.1.2", "[fd7a:115c:a1e0::2]", "pc.tail123.ts.net"] { assert!(tailnet_host(host)); }
        for host in ["127.0.0.1", "192.168.1.2", "8.8.8.8", "100.100.100.100", "100.115.92.1", "pc.ts.net.evil", "pc.ts.net", ""] { assert!(!tailnet_host(host)); }
    }
}
