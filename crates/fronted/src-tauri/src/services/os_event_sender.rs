//! Independent OS callback: native SDK metadata -> original event outbox ->
//! the already authorized paired PC. No WebView/model/OS permission requests.
use std::future::Future;
use std::sync::{Arc,Mutex};
use std::time::{Duration,Instant};
use serde_json::{json,Value};
use serde::Deserialize;
use tauri_plugin_mobile_assistant::{HealthChangeEvent,HomeChangeEvent,MobileAssistantExt,EventDeliveryConfiguration};
use super::automation::{AutomationStore,BackgroundResultWatch,store::{ResultDeliveryTarget,EventHealthReadResult}};

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct NativeEventIntake {
    events:Vec<HealthChangeEvent>,
    #[serde(default)] health_reads:Vec<EventHealthReadResult>,
    #[serde(default)] home_events:Vec<HomeChangeEvent>,
}

pub(super) fn prepare_health(path:&str,root:&str,host:&str,raw:&str)->Result<Value,String>{
    if raw.len()>16384{return Err("Native event metadata exceeds bounds".into());}
    let events:Vec<HealthChangeEvent>=serde_json::from_str(raw).map_err(|_|"Invalid original SDK event metadata".to_string())?;
    if events.len()>5{return Err("Native health event batch exceeds its bound".into());}
    let store=AutomationStore::open_os_event_sender(path,root,host)?;
    let credential_root=std::path::Path::new(path).parent().ok_or("Original credential root unavailable")?;
    let vault=super::mobile_worker_runtime::vault(credential_root,false)?;
    if vault.existing_worker_host_identity()?!=host{return Err("Original credential installation changed".into());}
    let metrics=store.active_health_event_metrics()?;
    let events:Vec<_>=events.into_iter().filter(|event|metrics.contains(&event.metric)).collect();
    store.ingest_health_events(&events)?;
    serde_json::to_value(store.pending_event_health_reads()?).map_err(|e|e.to_string())
}

static CONFIGURED:Mutex<Option<(String,String,bool)>>=Mutex::new(None);

pub(crate) fn configure(app:&tauri::AppHandle,store:&AutomationStore)->Result<(),String>{
    let path=crate::commands::settings::config_db_path()?.to_str().ok_or("Invalid native event database path")?.to_string();
    let scope=store.stage_event_sender_scope(&path,store.has_os_event_work()?)?;
    let mut configured=CONFIGURED.lock().map_err(|_|"OS event configuration lock unavailable".to_string())?;
    let binding=(scope.database_path.clone(),scope.host_id.clone(),scope.enabled);
    if configured.as_ref()==Some(&binding){return Ok(());}
    let accepted=app.mobile_assistant().configure_event_delivery(EventDeliveryConfiguration{
        database_path:scope.database_path,host_id:scope.host_id,enabled:scope.enabled,
    }).map_err(|_|"OS event delivery setup remains available for retry".to_string())?;
    if !accepted{return Err("OS event delivery was not acknowledged".into());}
    *configured=Some(binding);Ok(())
}

async fn bounded<T>(work:impl Future<Output=Result<T,String>>,started:Instant,budget:Duration,stopped:&mut impl FnMut()->bool)->Result<T,String>{
    let mut work=Box::pin(work);
    loop {
        if stopped() || started.elapsed()>=budget{return Err("Original OS event attempt stopped; immutable delivery retained".into());}
        // Poll the same admitted future, never restart an HTTP write on an
        // observation timeout. JNI/C expiration is checked on this thread.
        let slice=budget.saturating_sub(started.elapsed()).min(Duration::from_millis(100));
        if let Ok(result)=tokio::time::timeout(slice,work.as_mut()).await{return result;}
    }
}

pub(super) fn sync(path:&str,root:&str,host:&str,raw:&str,budget:Duration,stopped:&mut impl FnMut()->bool)->Result<Value,String>{
    let started=Instant::now();
    if raw.len()>160*1024 || stopped(){return Err("Invalid or stopped native event intake".into());}
    let intake:NativeEventIntake=serde_json::from_str(raw).map_err(|_|"Invalid native event intake".to_string())?;
    let events=intake.events;
    if events.len()>5{return Err("Native health event batch exceeds its bound".into());}
    let store=Arc::new(AutomationStore::open_os_event_sender(path,root,host)?);
    let credential_root=std::path::Path::new(path).parent().ok_or("Original credential root unavailable")?;
    let vault=super::mobile_worker_runtime::vault(credential_root,false)?;
    if vault.existing_worker_host_identity()?!=host {return Err("Original credential installation changed".into());}
    super::embedded_tailnet::initialize(Arc::clone(&vault))?;
    if stopped() || started.elapsed()>=budget {return Err("Original OS event intake expired before admission".into());}
    let metrics=store.active_health_event_metrics()?;
    let events:Vec<_>=events.into_iter().filter(|event|metrics.contains(&event.metric)).collect();
    store.ingest_health_events(&events)?;
    store.commit_event_health_reads(&intake.health_reads)?;
    if intake.home_events.len()>16{return Err("Native Home event batch exceeds its bound".into());}
    let homes=store.active_home_event_homes()?;
    let home_events:Vec<_>=intake.home_events.into_iter().filter(|event|homes.contains(&event.home_id)).collect();
    store.ingest_home_events(&home_events)?;
    let home_acknowledgements:Vec<_>=home_events.iter().map(|event|event.id.clone()).collect();
    let acknowledgements:Vec<_>=events.iter().map(|event|event.id.clone()).collect();
    store.dispatch_proactive_remote_rules(credential_root)?;
    let registry=super::mobile_worker_runtime::peers(&vault)?;
    registry.bind_os_result_delivery_store(&store)?;
    let mut targets=Vec::<ResultDeliveryTarget>::new();
    let mut success=true;
    tauri::async_runtime::block_on(async {
        if stopped() || started.elapsed()>=budget {return Err("Original OS event delivery expired before claim".into());}
        let submissions=store.claim_event_submissions()?;
        for pending in submissions {
            let request=pending.input.request_id.clone();
            let attempt=async {
                store.validate_event_sender_scope(path,host)?;
                store.reconcile_proactive_remote_submissions()?;
                let current=store.background_submission(&request)?.ok_or("Original event submission unavailable")?;
                if current.cancel_requested!=pending.cancel_requested{return Err("Original event stop intention changed".into());}
                if let Some(result)=current.result {return Ok(result);}
                let args=if pending.cancel_requested {json!({"request_id":request})} else {
                    let mut args=json!({"input":pending.input});
                    if pending.input.source_context.as_ref().and_then(|source|source.routing.as_ref()).is_some_and(|routing|routing.branches.iter().any(|branch|branch.locality=="initiating-device")) {
                        let token=vault.device_task_channel_token(host,&request)?;
                        args["device_channel"]=json!({"version":1,"initiatingHostId":host,"token":token});
                    }
                    args
                };
                let command=if pending.cancel_requested {"automation_background_cancel"} else {"automation_background_submit"};
                let actual=bounded(registry.invoke(&pending.source_host_id,command,args),started,budget,stopped).await?;
                let watch=BackgroundResultWatch {source_host_id:pending.source_host_id.clone(),request_id:request.clone()};
                store.receive_background_result(&watch,actual.clone())?;
                store.complete_background_submission(&pending,&actual)?;
                Ok::<_,String>(actual)
            }.await;
            if let Err(error)=attempt {store.note_background_submission_error(&request,&error)?;success=false;}
            if stopped() || started.elapsed()>=budget {success=false;break;}
        }
        // Per-request read grants are handed directly to platform-protected
        // result storage, never returned to a model or copied as session cookies.
        for watch in store.claim_result_delivery_setup()? {
            if stopped() || started.elapsed()>=budget {success=false;break;}
            let original=store.background_submission(&watch.request_id)?;
            if !original.as_ref().is_some_and(|record|record.source_host_id==watch.source_host_id && record.result.is_some()) {continue;}
            match bounded(registry.result_delivery_target(&watch,host),started,budget,stopped).await {
                Ok(target)=>{registry.stage_result_delivery_target(&store,&target).await?;targets.push(target);},
                Err(_)=>success=false,
            }
        }
        Ok::<_,String>(())
    })?;
    Ok(json!({"version":1,"hostId":host,"success":success && !stopped(),"acknowledgedEventIds":acknowledgements,"acknowledgedHomeEventIds":home_acknowledgements,"targets":targets}))
}

pub(super) fn acknowledge_targets(path:&str,root:&str,host:&str,raw:&str)->Result<(),String>{
    if raw.len()>2*1024*1024{return Err("Native result handoff exceeds bounds".into());}
    let store=AutomationStore::open_os_result_receiver(path,root,host)?;
    let targets:Vec<ResultDeliveryTarget>=serde_json::from_str(raw).map_err(|_|"Invalid native result handoff".to_string())?;
    if targets.len()>2{return Err("Native result handoff exceeds its fair batch".into());}
    for target in targets {store.acknowledge_result_delivery(&target)?;}
    Ok(())
}

#[cfg(target_os="android")]
#[no_mangle]
pub extern "system" fn Java_com_ohi_xgent_mobileassistant_NativeEventSender_healthScopes<'local>(
    mut env:jni::JNIEnv<'local>,_object:jni::objects::JObject<'local>,path:jni::objects::JString<'local>,root:jni::objects::JString<'local>,host:jni::objects::JString<'local>,events:jni::objects::JString<'local>)->jni::sys::jstring{
    let result=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||{
        let path:String=env.get_string(&path).map_err(|_|())?.into();let root:String=env.get_string(&root).map_err(|_|())?.into();
        let host:String=env.get_string(&host).map_err(|_|())?.into();let events:String=env.get_string(&events).map_err(|_|())?.into();
        if path.len()>32768 || root.len()>32768 || host.len()!=36{return Err(());}
        prepare_health(&path,&root,&host,&events).map_err(|_|())
    }));
    match result {Ok(Ok(reply))=>env.new_string(reply.to_string()).map(|value|value.into_raw()).unwrap_or(std::ptr::null_mut()),_=>std::ptr::null_mut()}
}

#[cfg(target_os="android")]
#[no_mangle]
pub extern "system" fn Java_com_ohi_xgent_mobileassistant_NativeEventSender_sync<'local>(
    mut env:jni::JNIEnv<'local>,_object:jni::objects::JObject<'local>,path:jni::objects::JString<'local>,root:jni::objects::JString<'local>,
    host:jni::objects::JString<'local>,events:jni::objects::JString<'local>,worker:jni::objects::JObject<'local>)->jni::sys::jstring{
    let result=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||{
        let path:String=env.get_string(&path).map_err(|_|())?.into();let root:String=env.get_string(&root).map_err(|_|())?.into();
        let host:String=env.get_string(&host).map_err(|_|())?.into();let events:String=env.get_string(&events).map_err(|_|())?.into();
        if path.len()>32768 || root.len()>32768 || host.len()!=36{return Err(());}
        let mut stopped=||env.call_method(&worker,"isStopped","()Z",&[]).and_then(|value|value.z()).unwrap_or(true);
        sync(&path,&root,&host,&events,Duration::from_secs(90),&mut stopped).map_err(|_|())
    }));
    match result {Ok(Ok(reply))=>env.new_string(reply.to_string()).map(|value|value.into_raw()).unwrap_or(std::ptr::null_mut()),_=>std::ptr::null_mut()}
}

#[cfg(target_os="android")]
#[no_mangle]
pub extern "system" fn Java_com_ohi_xgent_mobileassistant_NativeEventSender_acknowledge<'local>(
    mut env:jni::JNIEnv<'local>,_object:jni::objects::JObject<'local>,path:jni::objects::JString<'local>,root:jni::objects::JString<'local>,host:jni::objects::JString<'local>,targets:jni::objects::JString<'local>)->jni::sys::jboolean{
    let result=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||{
        let path:String=env.get_string(&path).map_err(|_|())?.into();let root:String=env.get_string(&root).map_err(|_|())?.into();
        let host:String=env.get_string(&host).map_err(|_|())?.into();let targets:String=env.get_string(&targets).map_err(|_|())?.into();
        if path.len()>32768 || root.len()>32768 || host.len()!=36{return Err(());}
        acknowledge_targets(&path,&root,&host,&targets).map_err(|_|())
    }));
    if matches!(result,Ok(Ok(()))){jni::sys::JNI_TRUE}else{jni::sys::JNI_FALSE}
}
