//! Native OS background result read. No Tauri startup, Activity, model, paired
//! session cookie, OS grants, task execution or inbox read acknowledgements.
use std::io::Read;
use std::time::{Duration,Instant};
#[cfg(target_os="android")]
use jni::{JNIEnv,objects::{JObject,JString},sys::{jboolean,JNI_FALSE,JNI_TRUE}};
use serde_json::Value;
use sha2::{Digest,Sha256};
use super::automation::{AutomationStore,BackgroundResultWatch,store::ResultDeliveryTarget};
use super::automation::store::{result_read_proof,verify_result_reply_proof};

const MAX_BODY:u64=4*1024*1024+16*1024;

// Keep each paired route's proof/session independent. Rejecting a response
// must not suppress another original-host route or mark the task delivered.
fn read_target(client:&reqwest::blocking::Client,store:&AutomationStore,target:&ResultDeliveryTarget,host:&str,
    started:Instant,budget:Duration,stopped:&mut impl FnMut()->bool)->Result<bool,String>{
    let binding=target.binding_hash()?;
    let mut overlay_client = None;
    for endpoint in &target.endpoints {
        if stopped() || started.elapsed()>=budget{return Err("OS result job stopped or reached its time bound".into());}
        if endpoint.expires_at<=super::automation::db::now_ms(){continue;}
        let overlay = super::embedded_tailnet::uses_transport(&endpoint.base_url);
        if overlay {
            // LAN has already had its original chance. Give a restored SDK
            // node a bounded cold start before the read's SOCKS handshake;
            // preserve this same future across OS expiration observations.
            let ready=tauri::async_runtime::block_on(async {
                let mut ready=Box::pin(super::embedded_tailnet::wait_ready_for_os());
                let began=Instant::now();
                loop {
                    if stopped() || started.elapsed()>=budget || began.elapsed()>=Duration::from_secs(20) {
                        return Err::<(),String>("Original Tailnet result route is not ready within this OS attempt".into());
                    }
                    if let Ok(result)=tokio::time::timeout(Duration::from_millis(100),ready.as_mut()).await {return result;}
                }
            });
            if ready.is_err(){continue;}
        }
        let client = if overlay {
            if overlay_client.is_none() {
                let configured = super::embedded_tailnet::with_blocking_proxy(reqwest::blocking::Client::builder().no_proxy())
                    .and_then(|builder| builder.redirect(reqwest::redirect::Policy::none())
                        .retry(reqwest::retry::never()).connect_timeout(Duration::from_secs(3))
                        .timeout(Duration::from_secs(8)).build().map_err(|_| "OS Tailnet result read client unavailable".to_string()));
                match configured { Ok(client) => overlay_client = Some(client), Err(_) => continue }
            }
            let Some(client) = overlay_client.as_ref() else { continue; };
            client
        } else { client };
        // Endpoints arrive in the registry's LAN-first order. Failover is
        // only between independently paired sessions of this same host.
        let url=format!("{}/api/local-access/task-result/{}",endpoint.base_url,target.request_id);
        let nonce=uuid::Uuid::new_v4().to_string();
        let key=format!("{:x}",Sha256::digest(endpoint.token.as_bytes()));
        let proof=result_read_proof(&key,&target.source_host_id,host,&endpoint.session_id,&target.request_id,&nonce)?;
        let response=match client.get(url).header("origin",&endpoint.base_url)
            .header("x-xgent-receiver",host).header("x-xgent-session",&endpoint.session_id)
            .header("x-xgent-result-nonce",&nonce).header("x-xgent-result-proof",proof)
            .timeout(budget.saturating_sub(started.elapsed()).min(Duration::from_secs(8))).send(){
            Ok(response) if response.status().is_success()=>response,
            _=>continue,
        };
        if response.content_length().is_some_and(|length|length>MAX_BODY){continue;}
        let Some(signature)=response.headers().get("x-xgent-result-proof").and_then(|value|value.to_str().ok()).map(ToOwned::to_owned) else {continue;};
        let mut bytes=Vec::new();
        if response.take(MAX_BODY+1).read_to_end(&mut bytes).is_err() || bytes.len() as u64>MAX_BODY{continue;}
        if verify_result_reply_proof(&key,&nonce,&bytes,&signature).is_err(){continue;}
        let packet:Value=match serde_json::from_slice(&bytes){Ok(value)=>value,Err(_)=>continue};
        if packet["version"]!=1 || packet["receiverHostId"]!=host || packet["sessionId"]!=endpoint.session_id
            || packet["snapshot"]["hostId"]!=target.source_host_id || packet["snapshot"]["requestId"]!=target.request_id {continue;}
        if stopped() || started.elapsed()>=budget{return Err("OS result receive stopped or reached its time bound".into());}
        if endpoint.expires_at<=super::automation::db::now_ms(){continue;}
        let watch=BackgroundResultWatch{source_host_id:target.source_host_id.clone(),request_id:target.request_id.clone()};
        if store.receive_background_result_guarded(&watch,packet["snapshot"].clone(),Some((host,&binding)),stopped).is_err(){continue;}
        return Ok(true);
    }
    Ok(false)
}

pub(super) fn sync(path:&str,root:&str,host:&str,raw:&str,budget:Duration,stopped:&mut impl FnMut()->bool)->Result<(),String>{
    let started=Instant::now();
    if raw.len()>2*1024*1024 {return Err("OS result configuration exceeds limits".into());}
    let targets:Vec<ResultDeliveryTarget>=serde_json::from_str(raw).map_err(|_|"Invalid OS result target configuration".to_string())?;
    if targets.len()>128 || targets.iter().map(|t|&t.request_id).collect::<std::collections::BTreeSet<_>>().len()!=targets.len(){
        return Err("Invalid or duplicate OS result targets".into());
    }
    for target in &targets {target.binding_hash()?;}
    if stopped(){return Err("OS result job stopped".into());}
    let store=AutomationStore::open_os_result_receiver(path,root,host)?;
    store.recover_os_result_configuration(host,&targets,stopped)?;
    let claimed=store.claim_os_result_delivery(host,&targets)?;
    if claimed.is_empty(){return Ok(());}
    let _=rustls::crypto::ring::default_provider().install_default();
    // Restore only this installation's already enabled protected node. A
    // missing/locked vault must not prevent a working LAN endpoint from being
    // read, or silently turn a Tailnet request into a system-client request.
    if let Some(credential_root)=std::path::Path::new(path).parent() {
        if let Ok(vault)=super::mobile_worker_runtime::vault(credential_root,false) {
            if vault.existing_worker_host_identity().ok().as_deref()==Some(host) {
                let _=super::embedded_tailnet::initialize(vault);
            }
        }
    }
    let client=reqwest::blocking::Client::builder().no_proxy()
        .redirect(reqwest::redirect::Policy::none()).retry(reqwest::retry::never())
        .connect_timeout(Duration::from_secs(3)).timeout(Duration::from_secs(8))
        .build().map_err(|_|"OS result read client unavailable".to_string())?;
    let mut unresolved=false;
    for target in claimed {
        if stopped() || started.elapsed()>=budget{return Err("OS result job stopped or reached its time bound".into());}
        unresolved|=!read_target(&client,&store,&target,host,started,budget,stopped)?;
    }
    if unresolved {Err("Original OS result sources remain unavailable; bounded durable retry retained".into())} else {Ok(())}
}

// The Kotlin object declares an instance native method. Keep its name in the
// consumer rules, and use the already locked jni 0.21.1 lifetime/API contract.
#[cfg(target_os="android")]
#[no_mangle]
pub extern "system" fn Java_com_ohi_xgent_mobileassistant_NativeResultReceiver_sync<'local>(
    mut env:JNIEnv<'local>,_object:JObject<'local>,database:JString<'local>,root:JString<'local>,
    host:JString<'local>,targets:JString<'local>,worker:JObject<'local>)->jboolean{
    let result=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||{
        let database:String=env.get_string(&database).map_err(|_|())?.into();
        let root:String=env.get_string(&root).map_err(|_|())?.into();
        let host:String=env.get_string(&host).map_err(|_|())?.into();
        let targets:String=env.get_string(&targets).map_err(|_|())?.into();
        if database.len()>32768 || root.len()>32768 || host.len()!=36{return Err(());}
        let mut stopped=||env.call_method(&worker,"isStopped","()Z",&[]).and_then(|value|value.z()).unwrap_or(true);
        sync(&database,&root,&host,&targets,Duration::from_secs(90),&mut stopped).map_err(|_|())
    }));
    if matches!(result,Ok(Ok(()))){JNI_TRUE}else{JNI_FALSE}
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::Write,net::TcpListener,sync::{Arc,Mutex}};
    use super::super::automation::store::{ResultDeliveryEndpoint,result_reply_proof};

    fn endpoint(mode:&'static str,receiver:&str,source:&str,request:&str,seen:Arc<Mutex<Vec<String>>>)
        ->(ResultDeliveryEndpoint,std::thread::JoinHandle<()>) {
        let listener=TcpListener::bind("127.0.0.1:0").unwrap();listener.set_nonblocking(true).unwrap();
        let base=format!("http://{}",listener.local_addr().unwrap());
        let route=ResultDeliveryEndpoint {base_url:base.clone(),session_id:uuid::Uuid::new_v4().to_string(),
            token:format!("{}{}",uuid::Uuid::new_v4().simple(),uuid::Uuid::new_v4().simple()),expires_at:super::super::automation::db::now_ms()+60_000};
        let session=route.session_id.clone();let key=format!("{:x}",Sha256::digest(route.token.as_bytes()));
        let receiver=receiver.to_owned();let source=source.to_owned();let request=request.to_owned();
        let worker=std::thread::spawn(move|| {
            let start=Instant::now();
            let mut stream=loop {match listener.accept(){Ok((stream,_))=>break stream,Err(error) if error.kind()==std::io::ErrorKind::WouldBlock=>{
                assert!(start.elapsed()<Duration::from_secs(5),"Fixture endpoint was never requested");std::thread::sleep(Duration::from_millis(5));
            },Err(error)=>panic!("Fixture accept failed: {error}")}};
            stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
            let mut bytes=Vec::new();let mut chunk=[0u8;1024];
            while !bytes.windows(4).any(|tail|tail==b"\r\n\r\n") {
                let count=stream.read(&mut chunk).unwrap();assert!(count>0 && bytes.len()+count<=16*1024);bytes.extend_from_slice(&chunk[..count]);
            }
            let headers=String::from_utf8(bytes).unwrap();
            let header=|name:&str|headers.lines().find_map(|line|line.split_once(':').filter(|(key,_)|key.eq_ignore_ascii_case(name)).map(|(_,value)|value.trim().to_string())).unwrap();
            assert!(headers.starts_with(&format!("GET /api/local-access/task-result/{request} HTTP/1.1")));
            assert_eq!(header("x-xgent-receiver"),receiver);assert_eq!(header("x-xgent-session"),session);
            let nonce=header("x-xgent-result-nonce");
            assert_eq!(header("x-xgent-result-proof"),result_read_proof(&key,&source,&receiver,&session,&request,&nonce).unwrap());
            seen.lock().unwrap().push(base);
            let execution=uuid::Uuid::new_v4().to_string();
            let mut packet=serde_json::json!({"version":1,"receiverHostId":receiver,"sessionId":session,"snapshot":{
                "hostId":source,"requestId":request,"name":"Native result fixture","workdir":"/fixture",
                "run":{"id":execution,"taskId":execution,"state":"done","success":false,"output":"Actual fixture failure result"},
                "checkpointRevision":1,"artifacts":[],"operations":{"inFlight":0,"returned":0},"outcomes":{"verified":false,"branches":[]}}});
            if mode=="identity" {packet["receiverHostId"]=serde_json::json!(uuid::Uuid::new_v4().to_string());}
            if mode=="snapshot" {packet["snapshot"]["checkpointRevision"]=serde_json::json!("invalid");}
            let body=if mode=="json" {b"not JSON".to_vec()}else{serde_json::to_vec(&packet).unwrap()};
            let proof=if mode=="signature" {"00".repeat(32)}else{result_reply_proof(&key,&nonce,&body).unwrap()};
            let signature=if mode=="unsigned" {String::new()}else{format!("x-xgent-result-proof: {proof}\r\n")};
            write!(stream,"HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n{signature}\r\n",body.len()).unwrap();
            stream.write_all(&body).unwrap();
        });
        (route,worker)
    }
    fn configured(store:&AutomationStore,target:&ResultDeliveryTarget){
        store.register_result_requests(&[BackgroundResultWatch {request_id:target.request_id.clone(),source_host_id:target.source_host_id.clone()}]).unwrap();
        assert_eq!(store.claim_result_delivery_setup().unwrap().len(),1);
        store.stage_result_delivery(target).unwrap();store.acknowledge_result_delivery(target).unwrap();
    }
    fn client()->reqwest::blocking::Client{
        let _=rustls::crypto::ring::default_provider().install_default();
        reqwest::blocking::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never()).timeout(Duration::from_secs(3)).build().unwrap()
    }
    #[test]
    fn rejected_first_response_falls_back_to_an_independently_authenticated_original_host_route(){
        for mode in ["unsigned","signature","identity","json","snapshot"] {
            let store=AutomationStore::open_in_memory().unwrap();let receiver=store.background_worker_identity().unwrap();
            let source=uuid::Uuid::new_v4().to_string();let request=uuid::Uuid::new_v4().to_string();let seen=Arc::new(Mutex::new(Vec::new()));
            let (first,a)=endpoint(mode,&receiver,&source,&request,Arc::clone(&seen));
            let (second,b)=endpoint("valid",&receiver,&source,&request,Arc::clone(&seen));
            let urls=vec![first.base_url.clone(),second.base_url.clone()];
            let target=ResultDeliveryTarget {request_id:request.clone(),source_host_id:source.clone(),endpoints:vec![first,second]};configured(&store,&target);
            assert!(read_target(&client(),&store,&target,&receiver,Instant::now(),Duration::from_secs(8),&mut ||false).unwrap());
            a.join().unwrap();b.join().unwrap();assert_eq!(*seen.lock().unwrap(),urls);
            let inbox=store.list_background_inbox(0,20,false).unwrap();assert_eq!(inbox.items.len(),1);
            assert_eq!(inbox.items[0].source_host_id,source);assert_eq!(inbox.items[0].request_id,request);assert!(!inbox.items[0].success);
        }
    }
    #[test]
    fn valid_preferred_route_finishes_without_contacting_a_fallback(){
        let store=AutomationStore::open_in_memory().unwrap();let receiver=store.background_worker_identity().unwrap();
        let source=uuid::Uuid::new_v4().to_string();let request=uuid::Uuid::new_v4().to_string();let seen=Arc::new(Mutex::new(Vec::new()));
        let (first,worker)=endpoint("valid",&receiver,&source,&request,Arc::clone(&seen));let url=first.base_url.clone();
        let unused=ResultDeliveryEndpoint {base_url:"http://127.0.0.1:1".into(),session_id:uuid::Uuid::new_v4().to_string(),token:"aa".repeat(32),expires_at:first.expires_at};
        let target=ResultDeliveryTarget {request_id:request,source_host_id:source,endpoints:vec![first,unused]};configured(&store,&target);
        assert!(read_target(&client(),&store,&target,&receiver,Instant::now(),Duration::from_secs(8),&mut ||false).unwrap());
        worker.join().unwrap();assert_eq!(*seen.lock().unwrap(),vec![url]);
    }
    #[test]
    fn all_rejected_routes_leave_the_original_inbox_empty_and_no_read_ack(){
        let store=AutomationStore::open_in_memory().unwrap();let receiver=store.background_worker_identity().unwrap();
        let source=uuid::Uuid::new_v4().to_string();let request=uuid::Uuid::new_v4().to_string();let seen=Arc::new(Mutex::new(Vec::new()));
        let (first,a)=endpoint("unsigned",&receiver,&source,&request,Arc::clone(&seen));
        let (second,b)=endpoint("identity",&receiver,&source,&request,Arc::clone(&seen));
        let target=ResultDeliveryTarget {request_id:request,source_host_id:source,endpoints:vec![first,second]};configured(&store,&target);
        assert!(!read_target(&client(),&store,&target,&receiver,Instant::now(),Duration::from_secs(8),&mut ||false).unwrap());
        a.join().unwrap();b.join().unwrap();assert_eq!(seen.lock().unwrap().len(),2);
        assert!(store.list_background_inbox(0,20,false).unwrap().items.is_empty());
        assert_eq!(store.claim_result_watches().unwrap().len(),1);
    }
    #[test]
    fn expired_routes_do_not_make_network_requests_and_stop_or_deadline_is_not_delivery(){
        let store=AutomationStore::open_in_memory().unwrap();let receiver=store.background_worker_identity().unwrap();
        let target=ResultDeliveryTarget {request_id:uuid::Uuid::new_v4().to_string(),source_host_id:uuid::Uuid::new_v4().to_string(),
            endpoints:(1..=2).map(|port|ResultDeliveryEndpoint {base_url:format!("http://127.0.0.1:{port}"),
                session_id:uuid::Uuid::new_v4().to_string(),token:"aa".repeat(32),expires_at:1}).collect()};
        configured(&store,&target);
        assert!(!read_target(&client(),&store,&target,&receiver,Instant::now(),Duration::from_secs(2),&mut ||false).unwrap());
        assert!(read_target(&client(),&store,&target,&receiver,Instant::now(),Duration::ZERO,&mut ||false).is_err());
        assert!(read_target(&client(),&store,&target,&receiver,Instant::now(),Duration::from_secs(2),&mut ||true).is_err());
        assert!(store.list_background_inbox(0,20,false).unwrap().items.is_empty());
    }
}
