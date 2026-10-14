//! Explicit, read-only Xgent presence probes of the current control-plane peer
//! set. Addresses remain untrusted candidates until individually paired.
use std::time::Duration;
use futures_util::{stream, StreamExt};
use tauri_plugin_mobile_assistant::NearbyWorkstation;

fn application(name: &str) -> Option<(String, u16)> {
    let label = name.split('.').next()?.strip_prefix("xgent-")?;
    let (id, port) = label.rsplit_once('-')?;
    if !uuid::Uuid::parse_str(id).is_ok_and(|uuid| uuid.to_string() == id) { return None; }
    let parsed: u16 = port.parse().ok()?;
    if parsed == 0 || parsed.to_string() != port { return None; }
    Some((id.into(), parsed))
}

pub(crate) async fn discover_workers() -> Vec<NearbyWorkstation> {
    let Ok(owner) = super::engine() else { return vec![]; };
    let Some(session) = owner.live.borrow().clone() else { return vec![]; };
    if *session.stop.borrow() || !matches!(session.device.device_state(), tailscale::DeviceState::Running) { return vec![]; }
    let mut stop = session.stop.clone();
    let read = async {
        let status = tokio::time::timeout(Duration::from_secs(2), session.device.status()).await.map_err(|_| ())?.map_err(|_| ())?;
        let own = status.self_node.map(|node| node.tailscale_ips).unwrap_or_default();
        let addresses: std::collections::BTreeSet<_> = status.peers.into_iter()
            .filter(|node| !node.expired && node.online != Some(false))
            .filter_map(|node| application(&node.display_name).map(|(id, port)| (node.tailscale_ips, id, port)))
            .flat_map(|(ips, id, port)| ips.into_iter().map(move |ip| (ip, id.clone(), port)))
            .filter(|(ip, _, _)| !own.contains(ip))
            .filter_map(|(ip, id, port)| match ip { std::net::IpAddr::V4(ip) if super::super::worker_peers::is_tailnet_ipv4(ip) => Some((ip, id, port)), _ => None })
            .take(64).collect();
        let builder = super::with_proxy(reqwest::Client::builder().no_proxy()).map_err(|_| ())?;
        let client = builder.redirect(reqwest::redirect::Policy::none()).retry(reqwest::retry::never())
            .connect_timeout(Duration::from_secs(2)).timeout(Duration::from_secs(3)).build().map_err(|_| ())?;
        let mut responses = stream::iter(addresses).map(|(ip, expected_host, port)| {
            let client = client.clone();
            async move {
                // Only the app's announced port, never a port/address scan.
                let url = format!("http://{ip}:{port}");
                let mut response = client.get(format!("{url}/api/local-access/status")).send().await.ok()?;
                if !response.status().is_success() || response.content_length().is_some_and(|size| size > 4096) { return None; }
                let mut bytes = Vec::new();
                while let Some(chunk) = response.chunk().await.ok()? {
                    if bytes.len() + chunk.len() > 4096 { return None; }
                    bytes.extend_from_slice(&chunk);
                }
                let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
                if value["service"] != "xgent-local-access" || value["protocolVersion"] != 1 || value["running"] != true || value["pairingRequired"] != true { return None; }
                let id = value["hostId"].as_str()?;
                if id != expected_host { return None; }
                let platform = value["platform"].as_str()?;
                if !matches!(platform, "macos" | "windows" | "linux") { return None; }
                Some(NearbyWorkstation { host_id: id.into(), platform: platform.into(), urls: vec![url] })
            }
        }).buffer_unordered(16);
        let until = tokio::time::Instant::now() + Duration::from_secs(8);
        let mut services = Vec::new();
        while let Ok(Some(service)) = tokio::time::timeout_at(until, responses.next()).await {
            if let Some(service) = service { services.push(service); }
        }
        Ok::<_, ()>(services)
    };
    let result = tokio::select! {
        _ = stop.changed() => return vec![],
        result = tokio::time::timeout(Duration::from_secs(11), read) => result,
    };
    if *session.stop.borrow() { return vec![]; }
    result.ok().and_then(Result::ok).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn presence_names_pin_one_real_installation_and_its_actual_port() {
        let id = "11111111-1111-4111-8111-111111111111";
        assert_eq!(application(&format!("xgent-{id}-4040.tail123.ts.net")), Some((id.into(),4040)));
        for name in [format!("xgent-{id}-0"),format!("xgent-{id}-65536"),format!("xgent-{id}-04040"),"ordinary-pc".into(),"xgent-fake-4040".into()] {
            assert!(application(&name).is_none());
        }
    }
}
