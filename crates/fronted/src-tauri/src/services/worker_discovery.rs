//! Untrusted LAN/Tailnet presence only. Pairing, credentials and task routing stay in
//! the original protected registry; discovery never submits or adopts work.
use tauri_plugin_mobile_assistant::{NearbyWorkstation,NearbyWorkstations};

fn normalize(mut services:Vec<NearbyWorkstation>)->Result<NearbyWorkstations,String>{
    if services.len()>64 {return Err("Nearby workstation response exceeds its bound".into());}
    for service in &mut services {
        if !uuid::Uuid::parse_str(&service.host_id).is_ok_and(|id|id.to_string()==service.host_id)
            || !matches!(service.platform.as_str(),"macos"|"windows"|"linux") || service.urls.is_empty() || service.urls.len()>16 {
            return Err("Invalid nearby workstation advertisement".into());
        }
        for raw in &mut service.urls {
            let url=reqwest::Url::parse(raw).map_err(|_|"Invalid discovered address")?;
            let ip=url.host_str().and_then(|host|host.parse::<std::net::Ipv4Addr>().ok()).ok_or("Discovery requires a numeric LAN address")?;
            let port=url.port_or_known_default().filter(|port|*port>0).ok_or("Invalid discovered port")?;
            if !(lan_address(ip) || super::worker_peers::is_tailnet_ipv4(ip)) || url.scheme()!="http" || !url.username().is_empty() || url.password().is_some()
                || url.path()!="/" || url.query().is_some() || url.fragment().is_some() {
                return Err("Invalid discovered LAN endpoint".into());
            }
            *raw=format!("http://{ip}:{port}");
        }
        service.urls.sort();service.urls.dedup();
    }
    let mut merged: std::collections::BTreeMap<String, NearbyWorkstation> = std::collections::BTreeMap::new();
    for service in services {
        if let Some(previous) = merged.get_mut(&service.host_id) {
            if previous.platform != service.platform { return Err("Conflicting workstation presence".into()); }
            previous.urls.extend(service.urls);
        } else { merged.insert(service.host_id.clone(), service); }
    }
    for service in merged.values_mut() {
        service.urls.sort_by_key(|url| (super::embedded_tailnet::uses_transport(url), url.clone()));
        service.urls.dedup(); service.urls.truncate(16);
    }
    Ok(NearbyWorkstations{services:merged.into_values().collect()})
}

pub(crate) fn lan_address(ip:std::net::Ipv4Addr)->bool{ip.is_private() || ip.is_link_local()}

pub(crate) async fn discover(app:tauri::AppHandle)->Result<NearbyWorkstations,String>{
    static SLOTS:std::sync::OnceLock<std::sync::Arc<tokio::sync::Semaphore>>=std::sync::OnceLock::new();
    let _slot=std::sync::Arc::clone(SLOTS.get_or_init(||std::sync::Arc::new(tokio::sync::Semaphore::new(1))))
        .try_acquire_owned().map_err(|_|"Workstation discovery is busy")?;
    let (lan, overlay)=tokio::join!(discover_lan(app),super::embedded_tailnet::discover_workers());
    let mut services=match lan {Ok(lan)=>lan.services,Err(error) if overlay.is_empty()=>return Err(error),Err(_)=>vec![]};
    for service in overlay {
        if let Some(previous)=services.iter_mut().find(|item|item.host_id==service.host_id && item.platform==service.platform) {
            previous.urls.extend(service.urls); previous.urls.truncate(16);
        } else if services.len()<64 { services.push(service); }
    }
    normalize(services)
}

#[cfg(mobile)]
async fn discover_lan(app:tauri::AppHandle)->Result<NearbyWorkstations,String>{
    use tauri_plugin_mobile_assistant::MobileAssistantExt;
    let response=tauri::async_runtime::spawn_blocking(move ||app.mobile_assistant().discover_workstations().map_err(|e|e.to_string())).await.map_err(|e|e.to_string())??;
    normalize(response.services)
}

#[cfg(desktop)]
async fn discover_lan(_app:tauri::AppHandle)->Result<NearbyWorkstations,String>{
    static SLOTS:std::sync::OnceLock<std::sync::Arc<tokio::sync::Semaphore>>=std::sync::OnceLock::new();
    let slot=std::sync::Arc::clone(SLOTS.get_or_init(||std::sync::Arc::new(tokio::sync::Semaphore::new(1))))
        .try_acquire_owned().map_err(|_|"LAN discovery is busy")?;
    tauri::async_runtime::spawn_blocking(move ||{let _slot=slot;browse()}).await.map_err(|e|e.to_string())?
}

#[cfg(desktop)]
fn browse()->Result<NearbyWorkstations,String>{
    use mdns_sd::{ServiceDaemon,ServiceEvent};
    let daemon=ServiceDaemon::new().map_err(|e|format!("LAN discovery unavailable: {e}"))?;
    let result=(||{
        let events=daemon.browse("_xgent._tcp.local.").map_err(|e|e.to_string())?;
        let until=std::time::Instant::now()+std::time::Duration::from_secs(3);
        let mut found=std::collections::BTreeMap::new();
        while std::time::Instant::now()<until && found.len()<64 {
            let Ok(event)=events.recv_timeout(std::time::Duration::from_millis(100)) else {continue;};
            match event {
                ServiceEvent::ServiceResolved(service)=>{
                    if service.get_property_val_str("v")!=Some("1") {continue;}
                    let (Some(id),Some(platform))=(service.get_property_val_str("id"),service.get_property_val_str("p")) else {continue;};
                    if !uuid::Uuid::parse_str(id).is_ok_and(|uuid|uuid.to_string()==id) || !matches!(platform,"macos"|"windows"|"linux") || service.get_port()==0 {continue;}
                    let urls:Vec<_>=service.get_addresses_v4().into_iter().filter(|ip|lan_address(*ip)).take(16).map(|ip|format!("http://{ip}:{}",service.get_port())).collect();
                    if !urls.is_empty(){found.insert(id.to_string(),(service.get_fullname().to_lowercase(),NearbyWorkstation{host_id:id.into(),platform:platform.into(),urls}));}
                },
                ServiceEvent::ServiceRemoved(_,name)=>{found.retain(|_,(instance,_)|*instance!=name.to_lowercase());},
                _=>{},
            }
        }
        normalize(found.into_values().map(|(_,service)|service).collect())
    })();
    let _=daemon.stop_browse("_xgent._tcp.local.");let _=daemon.shutdown();
    result
}

#[cfg(desktop)]
pub(crate) struct Advertisement {daemon:mdns_sd::ServiceDaemon,name:String}
#[cfg(desktop)]
impl Advertisement {
    pub(crate) fn start(id:&str,port:u16,addresses:Vec<std::net::Ipv4Addr>)->Result<Self,String>{
        if !uuid::Uuid::parse_str(id).is_ok_and(|uuid|uuid.to_string()==id) || port==0 {return Err("Invalid workstation advertiser identity".into());}
        let addresses:Vec<_>=addresses.into_iter().filter(|ip|lan_address(*ip)).take(16).map(|ip|ip.to_string()).collect();
        let daemon=mdns_sd::ServiceDaemon::new().map_err(|e|e.to_string())?;
        // The local-access server currently binds IPv4; do not publish an
        // unusable IPv6-only endpoint to native service resolvers.
        if let Err(error)=daemon.disable_interface(mdns_sd::IfKind::IPv6){let _=daemon.shutdown();return Err(error.to_string());}
        let info=match mdns_sd::ServiceInfo::new("_xgent._tcp.local.",&format!("Xgent-{id}"),&format!("xgent-{id}.local."),addresses.join(",").as_str(),port,&[("v","1"),("id",id),("p",std::env::consts::OS)][..]) {
            Ok(info)=>info.enable_addr_auto(),Err(error)=>{let _=daemon.shutdown();return Err(error.to_string());},
        };
        let name=info.get_fullname().to_string();
        if let Err(error)=daemon.register(info){let _=daemon.shutdown();return Err(error.to_string());}
        Ok(Self{daemon,name})
    }
}
#[cfg(desktop)]
impl Drop for Advertisement {fn drop(&mut self){let _=self.daemon.unregister(&self.name);let _=self.daemon.shutdown();}}
