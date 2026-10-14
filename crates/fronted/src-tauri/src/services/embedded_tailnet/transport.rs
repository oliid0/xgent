//! Private SOCKS5 adapter for reqwest and the SDK's native Axum listener.
//! SOCKS framing follows RFC1928/RFC1929; destinations resolve only in the SDK.
//! The SDK loopback helper rejects IPv6 and leaves active splices alive when
//! dropped; this adapter enforces peer scope and cancels all streams on logout.
use std::{net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr}, sync::{Arc, Mutex}, time::Duration};
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::{TcpListener, TcpStream},
    sync::{watch, Semaphore}, task::JoinSet};
use super::Session;

struct Gate { url: String }
static GATE: Mutex<Option<Gate>> = Mutex::new(None);

fn proxy() -> Result<reqwest::Proxy, String> {
    let mut gate = GATE.lock().map_err(|_| "tailscale-engine-unavailable")?;
    if gate.is_none() {
        let socket = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|_| "tailscale-engine-unavailable")?;
        socket.set_nonblocking(true).map_err(|_| "tailscale-engine-unavailable")?;
        let address = socket.local_addr().map_err(|_| "tailscale-engine-unavailable")?;
        let password = uuid::Uuid::new_v4().simple().to_string();
        let url = format!("socks5h://xgent:{password}@{address}");
        tauri::async_runtime::spawn(async move {
            if let Ok(listener) = TcpListener::from_std(socket) { serve_proxy(listener, password).await; }
        });
        *gate = Some(Gate { url });
    }
    let url = gate.as_ref().ok_or("tailscale-engine-unavailable")?.url.clone();
    Ok(reqwest::Proxy::custom(move |target| {
        target.host_str().filter(|host| super::tailnet_host(host)).map(|_| url.clone())
    }))
}

pub(super) fn with_proxy(builder: reqwest::ClientBuilder) -> Result<reqwest::ClientBuilder, String> {
    Ok(builder.proxy(proxy()?))
}

#[cfg(mobile)]
pub(super) fn with_blocking_proxy(builder: reqwest::blocking::ClientBuilder) -> Result<reqwest::blocking::ClientBuilder, String> {
    Ok(builder.proxy(proxy()?))
}

async fn serve_proxy(listener: TcpListener, password: String) {
    let slots = Arc::new(Semaphore::new(64));
    let password = Arc::new(password);
    let mut jobs = JoinSet::new();
    loop {
        tokio::select! {
            Some(_) = jobs.join_next(), if !jobs.is_empty() => {},
            accepted = listener.accept() => {
                let Ok((mut local, address)) = accepted else { return; };
                if !address.ip().is_loopback() { continue; }
                let Ok(permit) = Arc::clone(&slots).try_acquire_owned() else { continue; };
                let password = Arc::clone(&password);
                jobs.spawn(async move {
                    let _permit = permit;
                    let result = tokio::time::timeout(Duration::from_secs(10), async {
                        let target = handshake(&mut local, &password).await?;
                        let owner = super::engine()?;
                        let session = owner.live.borrow().clone().ok_or("tailscale-engine-unavailable")?;
                        if *session.stop.borrow() || !matches!(session.device.device_state(), tailscale::DeviceState::Running) {
                            return Err("tailscale-engine-unavailable".into());
                        }
                        let mut stop = session.stop.clone();
                        let stream = tokio::select! {
                            _ = stop.changed() => return Err("tailscale-engine-unavailable".into()),
                            result = dial(&session, target) => result?,
                        };
                        local.write_all(&[5, 0, 0, 1, 0, 0, 0, 0, 0, 0]).await.map_err(|_| "tailscale-command-failed")?;
                        Ok::<_, String>((session, stream))
                    }).await;
                    if let Ok(Ok((session, mut remote))) = result {
                        let mut stop = session.stop.clone();
                        if *stop.borrow() { return; }
                        tokio::select! {
                            _ = stop.changed() => {},
                            _ = tokio::io::copy_bidirectional(&mut local, &mut remote) => {},
                        }
                    } else {
                        let _ = tokio::time::timeout(Duration::from_millis(200),
                            local.write_all(&[5, 1, 0, 1, 0, 0, 0, 0, 0, 0])).await;
                    }
                });
            }
        }
    }
}

enum Target { Address(IpAddr, u16), Name(String, u16) }

async fn handshake(local: &mut TcpStream, password: &str) -> Result<Target, String> {
    let mut hello = [0; 2];
    local.read_exact(&mut hello).await.map_err(|_| "tailscale-command-failed")?;
    if hello[0] != 5 || hello[1] == 0 { return Err("tailscale-command-failed".into()); }
    let mut methods = vec![0; hello[1] as usize];
    local.read_exact(&mut methods).await.map_err(|_| "tailscale-command-failed")?;
    if !methods.contains(&2) {
        let _ = local.write_all(&[5, 255]).await;
        return Err("tailscale-command-failed".into());
    }
    local.write_all(&[5, 2]).await.map_err(|_| "tailscale-command-failed")?;
    local.read_exact(&mut hello).await.map_err(|_| "tailscale-command-failed")?;
    if hello[0] != 1 || hello[1] != 5 { return Err("tailscale-command-failed".into()); }
    let mut username = [0; 5];
    local.read_exact(&mut username).await.map_err(|_| "tailscale-command-failed")?;
    let length = local.read_u8().await.map_err(|_| "tailscale-command-failed")?;
    if username != *b"xgent" || length as usize != password.len() { return Err("tailscale-command-failed".into()); }
    let mut supplied = vec![0; length as usize];
    local.read_exact(&mut supplied).await.map_err(|_| "tailscale-command-failed")?;
    let mismatch = supplied.iter().zip(password.bytes()).fold(0u8, |value, (a, b)| value | (*a ^ b));
    if mismatch != 0 { let _ = local.write_all(&[1, 1]).await; return Err("tailscale-command-failed".into()); }
    local.write_all(&[1, 0]).await.map_err(|_| "tailscale-command-failed")?;
    let mut request = [0; 4];
    local.read_exact(&mut request).await.map_err(|_| "tailscale-command-failed")?;
    if request[..3] != [5, 1, 0] { return Err("tailscale-command-failed".into()); }
    let target = match request[3] {
        1 => { let mut bytes = [0; 4]; local.read_exact(&mut bytes).await.map_err(|_| "tailscale-command-failed")?;
            Target::Address(Ipv4Addr::from(bytes).into(), 0) }
        4 => { let mut bytes = [0; 16]; local.read_exact(&mut bytes).await.map_err(|_| "tailscale-command-failed")?;
            Target::Address(Ipv6Addr::from(bytes).into(), 0) }
        3 => { let length = local.read_u8().await.map_err(|_| "tailscale-command-failed")?;
            let mut bytes = vec![0; length as usize]; local.read_exact(&mut bytes).await.map_err(|_| "tailscale-command-failed")?;
            let name = String::from_utf8(bytes).map_err(|_| "tailscale-command-failed")?;
            // SOCKS5h may encode literals as domains; still never resolve through OS DNS.
            if let Ok(ip) = name.trim_matches(['[', ']']).parse() { Target::Address(ip, 0) }
            else { Target::Name(name, 0) } }
        _ => return Err("tailscale-command-failed".into()),
    };
    let port = local.read_u16().await.map_err(|_| "tailscale-command-failed")?;
    match target {
        Target::Address(ip, _) if port != 0 && super::tailnet_ip(ip) => Ok(Target::Address(ip, port)),
        Target::Name(name, _) if port != 0 && super::tailnet_host(&name) => Ok(Target::Name(name, port)),
        _ => Err("tailscale-command-failed".into()),
    }
}

async fn dial(session: &Session, target: Target) -> Result<tailscale::netstack::TcpStream, String> {
    let (ip, port) = match target {
        Target::Address(ip, port) => {
            if session.device.peer_by_tailnet_ip(ip).await.map_err(|_| "tailscale-command-failed")?.is_none() {
                return Err("tailscale-command-failed".into());
            }
            (ip, port)
        }
        Target::Name(name, port) => {
            let node = session.device.peer_by_name(&name).await.map_err(|_| "tailscale-command-failed")?
                .ok_or("tailscale-command-failed")?;
            // Require the exact control-plane FQDN, not a bare-host alias.
            if !node.fqdn(false).eq_ignore_ascii_case(name.trim_end_matches('.')) { return Err("tailscale-command-failed".into()); }
            (IpAddr::V4(node.tailnet_address.ipv4.addr()), port)
        }
    };
    if !super::tailnet_ip(ip) { return Err("tailscale-command-failed".into()); }
    session.device.tcp_connect(SocketAddr::new(ip, port)).await.map_err(|_| "tailscale-command-failed".into())
}

#[cfg(desktop)]
pub(super) async fn serve_worker(mut live: watch::Receiver<Option<Arc<Session>>>, port: u16, host_id: String, router: axum::Router) {
    if port == 0 || !uuid::Uuid::parse_str(&host_id).is_ok_and(|id| id.to_string() == host_id) { return; }
    loop {
        let session = live.borrow_and_update().clone();
        if let Some(session) = session {
            let mut stop = session.stop.clone();
            if !*stop.borrow() {
                tokio::select! {
                    _ = stop.changed() => {},
                    _ = bridge(session, port, &host_id, router.clone()) => {},
                }
            }
        }
        if live.changed().await.is_err() { return; }
    }
}

#[cfg(desktop)]
async fn bridge(session: Arc<Session>, port: u16, host_id: &str, router: axum::Router) {
    let mut stop = session.stop.clone();
    // The registration can require administrator approval. Until the actual SDK
    // reports authorization and an assigned IP, there is no overlay listener.
    loop {
        if *stop.borrow() { return; }
        let ready = async {
            if !matches!(session.device.device_state(), tailscale::DeviceState::Running) { return None; }
            // Publish the actual application identity and bound port through
            // control metadata; discovery still verifies live app presence.
            session.device.set_hostname(format!("xgent-{host_id}-{port}")).await.ok()?;
            let ip = session.device.ipv4_addr().await.ok()?;
            if !super::tailnet_ip(ip.into()) { return None; }
            session.device.tcp_listen((ip, port).into()).await.ok()
        };
        if let Ok(Some(listener)) = tokio::time::timeout(Duration::from_secs(2), ready).await {
            let mut listeners = JoinSet::new();
            listeners.spawn(serve_listener(listener, router.clone(), stop.clone()));
            let ipv6 = async {
                let ip = session.device.ipv6_addr().await.ok()?;
                if !super::tailnet_ip(ip.into()) { return None; }
                session.device.tcp_listen((ip, port).into()).await.ok()
            };
            if let Ok(Some(listener)) = tokio::time::timeout(Duration::from_secs(2), ipv6).await {
                listeners.spawn(serve_listener(listener, router.clone(), stop.clone()));
            }
            tokio::select! { _ = stop.changed() => return, _ = listeners.join_next() => {} }
            // A lost listener gets recreated without dispatching any task or
            // changing the paired session/host. Dropping JoinSet closes sockets.
        }
        tokio::select! { _ = stop.changed() => return, _ = tokio::time::sleep(Duration::from_secs(3)) => {} }
    }
}

#[cfg(desktop)]
async fn serve_listener(listener: tailscale::netstack::TcpListener, router: axum::Router,
    mut stop: watch::Receiver<bool>) {
    use super::super::local_access::LocalAccessPeerAddr;
    if *stop.borrow() { return; }
    let listener = tailscale::axum::Listener::from(listener);
    let serving = async move {
        let _ = axum::serve(listener, router.into_make_service_with_connect_info::<LocalAccessPeerAddr>()).await;
    };
    tokio::select! {
        _ = stop.changed() => {},
        _ = serving => {},
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn socks_negotiation_requires_private_credentials_and_a_tailnet_destination() {
        for destination in [[100, 70, 1, 2], [192, 168, 1, 2], [8, 8, 8, 8], [100, 100, 100, 100]] {
            let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
            let address = listener.local_addr().unwrap();
            let task = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap(); handshake(&mut socket, "private-test-key").await
            });
            let mut client = TcpStream::connect(address).await.unwrap();
            client.write_all(&[5, 1, 2]).await.unwrap();
            let mut reply = [0; 2]; client.read_exact(&mut reply).await.unwrap(); assert_eq!(reply, [5, 2]);
            client.write_all(b"\x01\x05xgent\x10private-test-key").await.unwrap();
            client.read_exact(&mut reply).await.unwrap(); assert_eq!(reply, [1, 0]);
            client.write_all(&[5, 1, 0, 1]).await.unwrap(); client.write_all(&destination).await.unwrap();
            client.write_all(&28_367u16.to_be_bytes()).await.unwrap();
            assert_eq!(task.await.unwrap().is_ok(), destination == [100, 70, 1, 2]);
        }
    }
}
