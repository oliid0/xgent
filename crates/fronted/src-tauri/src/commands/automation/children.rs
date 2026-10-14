use std::sync::Arc;
use crate::services::automation::{AutomationStore,BackgroundExecutionLease,BackgroundOutcomeReport};

#[tauri::command(rename_all="snake_case")]
pub async fn automation_background_child_import_artifact(window:tauri::WebviewWindow,app:tauri::AppHandle,
    execution_id:String,call_id:String,child_call_id:String,artifact_id:String,lease:BackgroundExecutionLease,
    store:tauri::State<'_,Arc<AutomationStore>>,
    registry:tauri::State<'_,Arc<crate::services::worker_peers::WorkerPeerRegistry>>) -> Result<serde_json::Value,String> {
    if window.label()!="agent-worker" { return Err("Child artifact imports belong to the original native execution worker".into()); }
    let owned=Arc::clone(store.inner());let device=app.clone();
    let id=execution_id.clone();let call=call_id.clone();let child=child_call_id.clone();let captured=lease.clone();
    let source=tauri::async_runtime::spawn_blocking(move || owned.prepare_background_child_artifact(&id,&call,&child,&artifact_id,&captured,
        |conn,input|super::cron::background_configuration_on_connection(&device,conn,input))).await.map_err(|e|e.to_string())??;
    // Recovery of an already committed import is local; no remote request.
    if let Some(receipt)=&source.receipt {return Ok(receipt.clone());}
    if source.artifact.bytes>8*1024*1024 {
        let mut file=super::artifact_streams::receive_file(Arc::clone(store.inner()),registry.inner(),&source.peer_id,&source.request_id,&source.artifact).await?;
        let owned=Arc::clone(store.inner());
        return tauri::async_runtime::spawn_blocking(move||owned.import_background_child_artifact_file(&execution_id,&call_id,&child_call_id,&source,&lease,&mut file,
            |conn,input|super::cron::background_configuration_on_connection(&app,conn,input))).await.map_err(|e|e.to_string())?;
    }
    let value=crate::services::child_tasks::invoke_child(Arc::clone(store.inner()),registry.inner(),&source.peer_id,
        "automation_background_read_artifact",serde_json::json!({"request_id":source.request_id,"artifact_id":source.artifact.id})).await?;
    let owned=Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || owned.import_background_child_artifact(&execution_id,&call_id,&child_call_id,&source,&lease,value,
        |conn,input|super::cron::background_configuration_on_connection(&app,conn,input))).await.map_err(|e|e.to_string())?
}

#[tauri::command(rename_all="snake_case")]
pub async fn automation_background_model_submit(window:tauri::WebviewWindow,app:tauri::AppHandle,
    execution_id:String,call_id:String,lease:BackgroundExecutionLease,provider_id:String,model:String,
    store:tauri::State<'_,Arc<AutomationStore>>) -> Result<serde_json::Value,String> {
    if window.label()!="agent-worker" { return Err("Persistent model children belong to the native execution worker".into()); }
    let device=app.clone();
    let host=tauri::async_runtime::spawn_blocking(move || super::cron::background_host_info(&device)).await.map_err(|e|e.to_string())??;
    if !host.accepts_background_tasks || !host.executor_ready { return Err("Original native model executor is not ready or permitted".into()); }
    let owned=Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || owned.submit_background_model_child(&execution_id,&call_id,&lease,&provider_id,&model,
        |conn,input| {
            crate::runtime::task_runner::resolve_workdir(Some(input.workdir.clone()))?;
            if let Some(requirements)=&input.requirements { requirements.check(&host.platform,host.inventory.as_ref(),crate::services::automation::db::now_ms())?; }
            super::cron::background_configuration_on_connection(&app,conn,input)
        })).await.map_err(|e|e.to_string())?
}

#[tauri::command(rename_all="snake_case")]
pub async fn automation_background_child_park(window:tauri::WebviewWindow,app:tauri::AppHandle,execution_id:String,call_id:String,lease:BackgroundExecutionLease,
    store:tauri::State<'_,Arc<AutomationStore>>) -> Result<bool,String> {
    if window.label()!="agent-worker" { return Err("Child acceptance parking belongs to the native execution worker".into()); }
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.park_unconfirmed_background_child_start(&execution_id,&call_id,&lease,|conn,input|
        super::cron::background_configuration_on_connection(&app,conn,input))).await.map_err(|e|e.to_string())?
}

#[tauri::command(rename_all="snake_case")]
pub async fn automation_background_children(request_id:String,call_id:Option<String>,offset:Option<usize>,snapshot_hash:Option<String>,store:tauri::State<'_,Arc<AutomationStore>>) -> Result<serde_json::Value,String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.read_background_children(&request_id,call_id.as_deref(),offset.unwrap_or(0),snapshot_hash.as_deref())).await.map_err(|e|e.to_string())?
}

#[tauri::command(rename_all="snake_case")]
pub async fn automation_background_child_wait(window:tauri::WebviewWindow,app:tauri::AppHandle,execution_id:String,branch_id:String,call_id:String,reason:String,lease:BackgroundExecutionLease,
    store:tauri::State<'_,Arc<AutomationStore>>) -> Result<BackgroundOutcomeReport,String> {
    if window.label()!="agent-worker" { return Err("Child waits belong to the native execution worker".into()); }
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.record_background_child_wait(&execution_id,&branch_id,&call_id,&reason,&lease,|conn,id|
        AutomationStore::verify_background_configuration(conn,id,Some(&lease),|conn,input|
            super::cron::background_configuration_on_connection(&app,conn,input)).map(|_|()))).await.map_err(|e|e.to_string())?
}

#[tauri::command(rename_all="snake_case")]
pub async fn automation_background_child_resume(window:tauri::WebviewWindow,app:tauri::AppHandle,
    execution_id:String,call_id:String,peer_id:String,input:crate::services::automation::ResumeBackgroundTaskInput,
    lease:BackgroundExecutionLease,store:tauri::State<'_,Arc<AutomationStore>>,
    registry:tauri::State<'_,Arc<crate::services::worker_peers::WorkerPeerRegistry>>) -> Result<serde_json::Value,String> {
    if window.label()!="agent-worker" { return Err("Outgoing child responses belong to the native execution worker".into()); }
    let owned = Arc::clone(store.inner()); let original_lease = lease.clone(); let device=app.clone();
    let (probe,saved) = tauri::async_runtime::spawn_blocking(move || owned.stage_background_child_resume(
        &execution_id,&call_id,&peer_id,input,&original_lease,|conn,id|
            AutomationStore::verify_background_configuration(conn,id,Some(&original_lease),|conn,input|
                super::cron::background_configuration_on_connection(&device,conn,input)).map(|_|())
    )).await.map_err(|e|e.to_string())??;
    if let Some(saved) = saved { return Ok(saved); }
    // This is the only send. Background discovery only reads the original ACK.
    let sent = if probe.peer_id==store.background_worker_identity()? {
        let owned=Arc::clone(store.inner()); let input=probe.input.clone();
        tauri::async_runtime::spawn_blocking(move || {
            if !owned.is_local_background_model_child(&input.request_id)? { return Err("Original local model child is unavailable".into()); }
            owned.resume_background_task(input,|conn,input|super::cron::background_configuration_on_connection(&app,conn,input))
                .and_then(|record|serde_json::to_value(record).map_err(|e|e.to_string()))
        }).await.map_err(|e|e.to_string())?
    } else { registry.invoke(&probe.peer_id,"automation_background_resume",serde_json::json!({"request_id":probe.input.request_id,"input":probe.input})).await };
    let observed = crate::services::child_tasks::invoke_child(Arc::clone(store.inner()),registry.inner(),&probe.peer_id,"automation_background_resume_receipt",serde_json::json!({"request_id":probe.input.request_id,"input":probe.input})).await;
    let owned = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let result = match observed {
            Ok(value) if !value.is_null() => owned.record_background_child_resume_receipt(&probe,&value)
                .and_then(|_|owned.read_background_child_resume_receipt(&probe.execution_id,&probe.call_id,&lease))
                .and_then(|saved|saved.ok_or_else(||"Original child response lost its retained ACK".to_string())),
            Ok(_) => Err("Original child response is unconfirmed; native discovery will read its ACK without resending".into()),
            Err(error) => Err(format!("Original child response ACK is unavailable: {error}")),
        };
        if let Err(error) = &result {
            let reason = sent.err().map(|send|format!("{error}; original RPC: {send}")).unwrap_or_else(||error.clone());
            owned.record_background_child_resume_error(&probe,&reason)?;
        }
        result
    }).await.map_err(|e|e.to_string())?
}

#[tauri::command(rename_all="snake_case")]
pub async fn automation_background_child_resume_receipt(window:tauri::WebviewWindow,execution_id:String,
    call_id:String,lease:BackgroundExecutionLease,store:tauri::State<'_,Arc<AutomationStore>>) -> Result<Option<serde_json::Value>,String> {
    if window.label()!="agent-worker" { return Err("Child response receipts belong to the native execution worker".into()); }
    let owned = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || owned.read_background_child_resume_receipt(&execution_id,&call_id,&lease)).await.map_err(|e|e.to_string())?
}
