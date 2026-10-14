//! Embedder-owned network recovery, following tailscaled-rs ipn/linkmon.
//! The pinned engine's optional internal monitor has only a no-op source.
use std::{collections::BTreeSet, net::IpAddr, time::Duration};
use tokio::sync::watch;

fn snapshot() -> Option<BTreeSet<(String, IpAddr)>> {
    let interfaces = if_addrs::get_if_addrs().ok()?;
    Some(interfaces.into_iter().filter_map(|interface| {
        let ip = interface.ip();
        if ip.is_loopback() || ip.is_unspecified() || interface.name == "Tailscale" || interface.name.starts_with("tailscale") {
            return None;
        }
        if matches!(ip, IpAddr::V6(ip) if ip.is_unicast_link_local()) { return None; }
        if cfg!(any(target_os="macos",target_os="ios")) && interface.name.starts_with("utun") && super::tailnet_ip(ip) { return None; }
        Some((interface.name, ip))
    }).collect())
}

pub(super) async fn monitor(device: &tailscale::Device, mut stop: watch::Receiver<bool>) {
    let mut previous = None;
    let mut rebind_pending = false;
    let mut last_poll = tokio::time::Instant::now();
    let mut states = device.watch_state();
    loop {
        if *stop.borrow() || matches!(device.device_state(), tailscale::DeviceState::Failed(_) | tailscale::DeviceState::Expired | tailscale::DeviceState::NeedsLogin(_)) { return; }
        tokio::select! {
            _ = stop.changed() => return,
            changed = states.changed() => { if changed.is_err() { return; } },
            _ = tokio::time::sleep(Duration::from_secs(5)) => {
                // A long suspension can preserve an address while invalidating
                // its NAT mapping. Do not require an address change on wake.
                let resumed = last_poll.elapsed() > Duration::from_secs(15);
                last_poll = tokio::time::Instant::now();
                let observed = tokio::task::spawn_blocking(snapshot).await.ok().flatten();
                let Some(observed) = observed else { continue; };
                let changed = previous.as_ref().is_some_and(|saved| saved != &observed);
                rebind_pending |= changed || resumed;
                if rebind_pending {
                    let rebound = tokio::select! {
                        _ = stop.changed() => return,
                        result = tokio::time::timeout(Duration::from_secs(2), device.rebind()) => matches!(result, Ok(Ok(()))),
                    };
                    // Keep the old signal after failure so the next poll retries.
                    // No task, registration key or model request is replayed.
                    if !rebound { continue; }
                    rebind_pending = false;
                }
                previous = Some(observed);
            },
        }
    }
}
