//! Native child discovery/cascade/join continues independently of WebView timers.
use std::sync::{Arc, atomic::{AtomicBool,Ordering}};
use std::time::Duration;
use tauri::Manager;
use super::{automation::AutomationStore,worker_peers::WorkerPeerRegistry};

/// Native children on this installation do not require pairing to ourselves.
/// Every local read/stop is still bound to an original retained child row.
pub(crate) async fn invoke_child(store:Arc<AutomationStore>,registry:&WorkerPeerRegistry,peer:&str,command:&str,args:serde_json::Value) -> Result<serde_json::Value,String> {
    if peer!=store.background_worker_identity()? { return registry.invoke(peer,command,args).await; }
    let command=command.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let request=args["request_id"].as_str().ok_or("Missing original local child request")?;
        if !store.is_local_background_model_child(request)? { return Err("Local routing requires the originally accepted model child".into()); }
        let value=match command.as_str() {
            "automation_background_get"=>serde_json::to_value(store.background_task(request)?),
            "automation_background_cancel"=>serde_json::to_value(store.cancel_background_task(request)?),
            "automation_background_children"=>serde_json::to_value(store.read_background_children(request,args["call_id"].as_str(),args["offset"].as_u64().unwrap_or(0) as usize,args["snapshot_hash"].as_str())?),
            "automation_background_operations"=>serde_json::to_value(store.list_background_operations(request,args["cursor"].as_i64().unwrap_or(0),args["limit"].as_u64().unwrap_or(10) as usize)?),
            "automation_background_read_artifact"=>serde_json::to_value(store.read_background_artifact(request,args["artifact_id"].as_str().ok_or("Missing child artifact")?)?),
            "automation_background_read_artifact_chunk"=>serde_json::to_value(store.read_background_artifact_chunk(request,args["artifact_id"].as_str().ok_or("Missing child artifact")?,
                args["offset"].as_u64().ok_or("Missing child artifact cursor")?,usize::try_from(args["length"].as_u64().ok_or("Missing child artifact chunk bound")?).map_err(|e|e.to_string())?)?),
            "automation_background_resume_receipt"=>{
                let input:super::automation::ResumeBackgroundTaskInput=serde_json::from_value(args["input"].clone()).map_err(|e|e.to_string())?;
                if input.request_id!=request { return Err("Local response receipt changed its original child".into()); }
                serde_json::to_value(store.background_resume_receipt(&input)?)
            },
            _=>return Err("Command is unavailable on the original local model child route".into()),
        };
        value.map_err(|e|e.to_string())
    }).await.map_err(|e|e.to_string())?
}

pub(crate) fn start(app:tauri::AppHandle,store:Arc<AutomationStore>,registry:Arc<WorkerPeerRegistry>,quitting:Arc<AtomicBool>) {
    tauri::async_runtime::spawn(async move {
        loop {
            if quitting.load(Ordering::SeqCst) { break; }
            let owned = Arc::clone(&store);
            let due = tauri::async_runtime::spawn_blocking(move || owned.due_background_children()).await;
            match due {
                Ok(Ok(probes)) => for probe in probes {
                    if quitting.load(Ordering::SeqCst) { break; }
                    let observed = invoke_child(Arc::clone(&store),&registry,&probe.peer_id,"automation_background_get",serde_json::json!({"request_id":probe.request_id})).await;
                    let owned = Arc::clone(&store); let id = probe.execution_id.clone(); let call = probe.call_id.clone(); let token = probe.token.clone();
                    let result = tauri::async_runtime::spawn_blocking(move || match observed {
                        Ok(value) => {
                            let recorded = owned.record_background_child_observation(&id,&call,Some(&token),&value,false);
                            if let Err(error) = &recorded { owned.record_background_child_error(&id,&call,Some(&token),error)?; }
                            recorded
                        },
                        Err(error) => { owned.record_background_child_error(&id,&call,Some(&token),&error)?; Err(error) }
                    }).await;
                    if !matches!(result,Ok(Ok(()))) { continue; }
                    // First authenticate the original child execution with GET.
                    // Cancel is idempotent native stop intent, never submit/re-run.
                    if probe.cancel_requested && !probe.cancel_acknowledged {
                        let stopped = invoke_child(Arc::clone(&store),&registry,&probe.peer_id,"automation_background_cancel",serde_json::json!({"request_id":probe.request_id})).await;
                        let owned = Arc::clone(&store);
                        let saved = tauri::async_runtime::spawn_blocking(move || match stopped {
                            Ok(value) => {
                                let recorded = owned.record_background_child_observation(&probe.execution_id,&probe.call_id,Some(&probe.token),&value,true);
                                if let Err(error) = &recorded { owned.record_background_child_error(&probe.execution_id,&probe.call_id,Some(&probe.token),error)?; }
                                recorded
                            },
                            Err(error) => owned.record_background_child_error(&probe.execution_id,&probe.call_id,Some(&probe.token),&error),
                        }).await;
                        if !matches!(saved,Ok(Ok(()))) { eprintln!("Child stop receipt unresolved; native retry remains"); }
                    }
                },
                Ok(Err(error)) => eprintln!("Native child discovery unavailable: {error}"),
                Err(error) => eprintln!("Native child discovery join failed: {error}"),
            }
            let owned = Arc::clone(&store); let device = app.clone();
            let responses = tauri::async_runtime::spawn_blocking({
                let owned = Arc::clone(&store); move || owned.due_background_child_resumes()
            }).await;
            if let Ok(Ok(probes)) = responses {
                for probe in probes {
                    if quitting.load(Ordering::SeqCst) { break; }
                    // Frozen native input/owner; no resume/submit in discovery.
                    let observed = invoke_child(Arc::clone(&store),&registry,&probe.peer_id,"automation_background_resume_receipt",serde_json::json!({"request_id":probe.input.request_id,"input":probe.input})).await;
                    let saved = Arc::clone(&store);
                    let _ = tauri::async_runtime::spawn_blocking(move || {
                        let result = match observed {
                            Ok(value) if !value.is_null() => saved.record_background_child_resume_receipt(&probe,&value),
                            Ok(_) => Err("Original receiver has no committed response receipt yet".into()),
                            Err(error) => Err(error),
                        };
                        if let Err(error) = &result { saved.record_background_child_resume_error(&probe,error)?; }
                        result
                    }).await;
                }
            } else { eprintln!("Original child response discovery unavailable; retained backoff remains"); }
            let joined = tauri::async_runtime::spawn_blocking(move || {
                let accepted = owned.resume_ready_background_child_starts(|conn,input|
                    crate::commands::cron::background_configuration_on_connection(&device,conn,input))?;
                owned.resume_ready_background_children(|conn,input|
                    crate::commands::cron::background_configuration_on_connection(&device,conn,input)).map(|joined|accepted + joined)
            }).await;
            if !matches!(joined,Ok(Ok(_))) { eprintln!("Child join remains pending under its original task/configuration"); }
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });
}

pub(crate) fn start_if_available(app:&tauri::AppHandle,store:Arc<AutomationStore>,quitting:Arc<AtomicBool>) {
    if let Some(registry) = app.try_state::<Arc<WorkerPeerRegistry>>() {
        start(app.clone(),store,Arc::clone(registry.inner()),quitting);
    }
}
