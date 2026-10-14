use std::sync::Arc;
use serde_json::{json, Value};
use tauri::Manager;
use crate::services::automation::{AutomationStore, BackgroundSubmission, BackgroundResultWatch, SubmitBackgroundTaskInput};
use crate::services::worker_peers::WorkerPeerRegistry;

/// Installation identity is available on phones without admitting desktop jobs.
#[tauri::command]
pub async fn automation_device_identity(
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<Value, String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || {
        Ok::<_, String>(json!({ "hostId": store.background_worker_identity()? }))
    }).await.map_err(|error| error.to_string())?
}

/// Recover original-device requirements via the native-stored controller and
/// private task capability. No global selected PC or model-provided owner.
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_result_device_branches(app: tauri::AppHandle, entry_id: String,
    store: tauri::State<'_, Arc<AutomationStore>>, registry: tauri::State<'_, Arc<WorkerPeerRegistry>>) -> Result<Value, String> {
    read_owned_device_branches(&app, Arc::clone(store.inner()), registry.inner(), &entry_id).await
}

pub(crate) async fn invoke_owned_device_channel(app: &tauri::AppHandle, store: Arc<AutomationStore>, registry: &WorkerPeerRegistry,
    entry_id: &str, command: &str, mut args: Value) -> Result<(Value, crate::services::automation::BackgroundSourceRouting), String> {
    let read = Arc::clone(&store);
    let entry_id = entry_id.to_string();
    let (watch, routing, device) = tauri::async_runtime::spawn_blocking(move || {
        let (watch, _) = read.received_task_source(&entry_id)?;
        let submission = read.background_submission(&watch.request_id)?.ok_or_else(|| "Original task submission is not owned by this installation".to_string())?;
        let device = read.background_worker_identity()?;
        let routing = submission.input.source_context.and_then(|source| source.routing).ok_or_else(|| "Task has no original-device branch graph".to_string())?;
        if submission.source_host_id != watch.source_host_id || submission.result.is_none() || submission.cancel_requested || routing.initiating_host_id != device {
            return Err("Original-device handoff was not accepted here or its owner/cancellation changed".to_string());
        }
        Ok::<_, String>((watch, routing, device))
    }).await.map_err(|e| e.to_string())??;
    let token = app.state::<Arc<crate::services::cloud_secret_vault::CloudSecretVault>>().device_task_channel_token(&device, &watch.request_id)?;
    args["request_id"] = json!(watch.request_id);
    args["device_channel"] = json!({"version":1,"initiatingHostId":device,"token":token});
    let packet = registry.invoke(&watch.source_host_id, command, args).await?;
    Ok((packet, routing))
}

pub(crate) async fn read_owned_device_branches(app: &tauri::AppHandle, store: Arc<AutomationStore>, registry: &WorkerPeerRegistry, entry_id: &str) -> Result<Value, String> {
    let (packet, routing) = invoke_owned_device_channel(app, Arc::clone(&store), registry, entry_id, "automation_background_device_branches", json!({})).await?;
    let (watch, _) = store.received_task_source(entry_id)?;
    let device = store.background_worker_identity()?;
    let branches = packet["branches"].as_array().ok_or_else(|| "Device handoff omitted original branches".to_string())?;
    if serde_json::to_vec(&packet).map_err(|e| e.to_string())?.len() > 128 * 1024 { return Err("Device handoff exceeded its bound".into()); }
    let expected: Vec<_> = routing.branches.iter().filter(|branch| branch.locality == "initiating-device").collect();
    if packet["version"] != 1 || packet["requestId"] != watch.request_id || packet["hostId"] != watch.source_host_id || packet["initiatingHostId"] != device || branches.len() != expected.len() {
        return Err("Device handoff changed task/controller/installation".into());
    }
    for branch in expected {
        let actual = branches.iter().find(|item| item["source"]["id"] == branch.id).ok_or_else(|| "Device handoff dropped a source branch".to_string())?;
        if actual["source"] != serde_json::to_value(branch).map_err(|e| e.to_string())? { return Err("Device handoff changed immutable requirement/dependencies".into()); }
    }
    Ok(packet)
}

/// Dispatch only native-stored bytes. Re-check cancellation after reservation;
/// acceptance racing cancellation is later reconciled at the SAME host.
pub(crate) async fn deliver(app: tauri::AppHandle, store: Arc<AutomationStore>, registry: Arc<WorkerPeerRegistry>, pending: BackgroundSubmission) -> Result<Value, String> {
    let request = pending.input.request_id.clone();
    #[cfg(any(target_os="android",target_os="ios"))]
    let result_delivery_app=app.clone();
    let attempt: Result<Value, String> = async {
        // Recheck native event-rule ownership/template before reading the
        // saved stop intention. UI closure never bypasses rule withdrawal.
        let validate=Arc::clone(&store);
        tauri::async_runtime::spawn_blocking(move ||validate.reconcile_proactive_remote_submissions()).await.map_err(|e|e.to_string())??;
        let read = Arc::clone(&store); let id = request.clone();
        let current = tauri::async_runtime::spawn_blocking(move || read.background_submission(&id)).await.map_err(|e| e.to_string())??
            .ok_or_else(|| "Submission does not belong to this installation".to_string())?;
        if current.cancel_requested != pending.cancel_requested {
            return Err("Submission stopped; cancellation will reconcile at the original host".into());
        }
        if let Some(result) = current.result { return Ok(result); }
        let actual = if store.background_worker_identity()? == pending.source_host_id {
            #[cfg(desktop)] {
                if !pending.cancel_requested && pending.input.requirements.is_some() { super::cron::automation_background_host_info(app.clone()).await?; }
                let input = pending.input.clone(); let local = Arc::clone(&store);
                let cancelling = pending.cancel_requested;
                tauri::async_runtime::spawn_blocking(move || {
                    let task = if cancelling { local.cancel_background_task(&input.request_id)? }
                        else { super::cron::submit_background_on_host(&app, input)? };
                    serde_json::to_value(task).map_err(|e| e.to_string())
                }).await.map_err(|e| e.to_string())??
            }
            #[cfg(mobile)] { let _ = app; return Err("This mobile device has no persistent desktop executor; select a paired worker".into()); }
        } else {
            // Authentication/protocol and immutable-input owner binding are
            // enforced again by the existing native registry on every attempt.
            registry.submission_target(Some(&pending.source_host_id), None).await?;
            if pending.cancel_requested {
                registry.invoke(&pending.source_host_id, "automation_background_cancel", json!({"request_id": request})).await?
            } else {
                let mut packet = json!({"input": pending.input});
                if let Some(routing) = pending.input.source_context.as_ref().and_then(|source| source.routing.as_ref()) {
                    if routing.branches.iter().any(|branch| branch.locality == "initiating-device") {
                        let device = store.background_worker_identity()?;
                        if routing.initiating_host_id != device { return Err("Device channel origin changed; task was not sent".into()); }
                        let token = app.state::<Arc<crate::services::cloud_secret_vault::CloudSecretVault>>().device_task_channel_token(&device, &request)?;
                        packet["device_channel"] = json!({"version":1,"initiatingHostId":device,"token":token});
                    }
                }
                registry.invoke(&pending.source_host_id, "automation_background_submit", packet).await?
            }
        };
        let save = Arc::clone(&store);
        tauri::async_runtime::spawn_blocking(move || {
            let watch = BackgroundResultWatch { source_host_id: pending.source_host_id.clone(), request_id: pending.input.request_id.clone() };
            save.receive_background_result(&watch, actual.clone())?;
            save.complete_background_submission(&pending, &actual)?;
            Ok(actual)
        }).await.map_err(|e| e.to_string())?
    }.await;
    if let Err(error) = &attempt {
        let save = Arc::clone(&store); let error = error.clone();
        tauri::async_runtime::spawn_blocking(move || save.note_background_submission_error(&request, &error)).await.map_err(|e| e.to_string())??;
    }
    #[cfg(any(target_os="android",target_os="ios"))]
    if attempt.is_ok() {crate::services::result_receiver::provision_submission_result(&result_delivery_app,&store,&registry,&request).await;}
    attempt
}

pub(crate) async fn dispatch_selected(app: tauri::AppHandle, store: Arc<AutomationStore>, registry: Arc<WorkerPeerRegistry>, request: String) -> Result<Value, String> {
    let reserve = Arc::clone(&store); let selected = request.clone();
    let mut batch = tauri::async_runtime::spawn_blocking(move || reserve.claim_background_submissions(Some(&selected))).await.map_err(|e| e.to_string())??;
    if let Some(pending) = batch.pop() { deliver(app, store, registry, pending).await }
    else { Err(format!("Request {request} is saved locally and awaiting delivery/backoff; this is not host acceptance. Open Background inbox submissions or synchronize to recover.")) }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_result_submission_submit(window: tauri::WebviewWindow, app: tauri::AppHandle,
    input: SubmitBackgroundTaskInput, origin: Option<Value>, peer_id: Option<String>, base_url: Option<String>,
    store: tauri::State<'_, Arc<AutomationStore>>, registry: tauri::State<'_, Arc<WorkerPeerRegistry>>,
) -> Result<Value, String> {
    if window.label() == "agent-worker" || input.delegation.is_some() {
        return Err("Worker delegation requires its captured parent lease, not the root submission outbox".into());
    }
    let input = AutomationStore::normalize_background_task_input(input)?;
    let store = Arc::clone(store.inner());
    let registry = Arc::clone(registry.inner());
    let read = Arc::clone(&store); let id = input.request_id.clone();
    let existing = tauri::async_runtime::spawn_blocking(move || read.background_submission(&id)).await.map_err(|e| e.to_string())??;
    // Once staged, mutable UI selection can never change the original target.
    let target = if let Some(saved) = existing {
        if peer_id.as_deref().is_some_and(|id| id != saved.source_host_id) {
            return Err("Request already belongs to its original host".into());
        }
        saved.source_host_id
    } else if peer_id.is_some() || base_url.is_some() {
        registry.submission_target(peer_id.as_deref(), base_url.as_deref()).await?
    } else {
        #[cfg(mobile)] { return Err("Select a paired executor before saving a persistent mobile task".into()); }
        #[cfg(desktop)] { store.background_worker_identity()? }
    };
    if registry.resolve_request(&input.request_id).await?.is_some_and(|owner| owner != target) {
        return Err("An earlier submission is bound to another worker; recover its original owner".into());
    }
    let stage = Arc::clone(&store);
    let pending = tauri::async_runtime::spawn_blocking(move || stage.stage_background_submission(&target, input, origin.unwrap_or(Value::Null))).await.map_err(|e| e.to_string())??;
    if let Some(result) = pending.result {
        #[cfg(any(target_os="android",target_os="ios"))]
        crate::services::result_receiver::provision_submission_result(&app,&store,&registry,&pending.input.request_id).await;
        return Ok(result);
    }
    dispatch_selected(app, store, registry, pending.input.request_id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_result_chat_context(window:tauri::WebviewWindow,conversation_id:String,
    store:tauri::State<'_,Arc<AutomationStore>>)->Result<Value,String>{
    if window.label()!="main"{return Err("Original chat observations belong to the main native client".into());}
    let store=Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move||store.background_chat_context(&conversation_id)).await.map_err(|e|e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_result_chat_project(app:tauri::AppHandle,window:tauri::WebviewWindow,cursor:u64,
    store:tauri::State<'_,Arc<AutomationStore>>)->Result<Value,String>{
    if window.label()!="main"{return Err("Original chat delivery belongs to the main native client".into());}
    let store=Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move||{
        let page=store.list_background_submissions(cursor,20)?;
        let mut changed=0usize;
        // Acquire/release the automation lock before opening the history write
        // transaction. The original inbox is retained if history is unavailable.
        for submission in page.items {
            if !submission.local_owner {continue}
            let Some(result)=store.background_chat_result(&submission.request_id)? else{continue};
            let mut conn=crate::commands::history_db::open_connection()?;
            if let Some(summary)=crate::commands::chat_history::project_background_chat_result_sync(&mut conn,&result)? {
                crate::commands::chat_history::emit_background_chat_result(&app,&summary);
                changed+=1;
            }
        }
        Ok(serde_json::json!({"changed":changed,"nextCursor":page.next_cursor}))
    }).await.map_err(|e|e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_result_submission_list(cursor: u64, limit: usize, store: tauri::State<'_, Arc<AutomationStore>>) -> Result<crate::services::automation::BackgroundSubmissionPage, String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.list_background_submissions(cursor, limit)).await.map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_result_submission_state(request_id: String, store: tauri::State<'_, Arc<AutomationStore>>) -> Result<Option<Value>, String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || { let local = store.background_worker_identity()?; Ok(store.background_submission(&request_id)?.map(|saved| json!({
        "requestId": saved.input.request_id, "sourceHostId": saved.source_host_id, "name": saved.input.name,
        "localExecution": saved.source_host_id == local,
        "cancelRequested": saved.cancel_requested, "result": saved.result,
    }))) }).await.map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_result_submission_cancel(window: tauri::WebviewWindow, app: tauri::AppHandle, request_id: String, peer_id: Option<String>,
    store: tauri::State<'_, Arc<AutomationStore>>, registry: tauri::State<'_, Arc<WorkerPeerRegistry>>,
) -> Result<Option<Value>, String> {
    let existing = store.background_submission(&request_id)?;
    let Some(existing) = existing else { return Ok(None); };
    if window.label() == "agent-worker" { return Err("Client submission control is unavailable to the execution worker".into()); }
    if peer_id.as_deref().is_some_and(|id| id != existing.source_host_id) { return Err("Request belongs to its original submission host".into()); }
    let store = Arc::clone(store.inner()); let stage = Arc::clone(&store); let request = request_id.clone();
    let saved = tauri::async_runtime::spawn_blocking(move || stage.cancel_background_submission(&request)).await.map_err(|e| e.to_string())??;
    let Some(saved) = saved else { return Ok(None); };
    if let Some(result) = saved.result { return Ok(Some(result)); }
    dispatch_selected(app, store, Arc::clone(registry.inner()), request_id).await.map(Some)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_result_submission_current(request_id: String, peer_id: Option<String>,
    store: tauri::State<'_, Arc<AutomationStore>>, registry: tauri::State<'_, Arc<WorkerPeerRegistry>>,
) -> Result<Option<Value>, String> {
    let store = Arc::clone(store.inner()); let read = Arc::clone(&store); let id = request_id.clone();
    let saved = tauri::async_runtime::spawn_blocking(move || read.background_submission(&id)).await.map_err(|e| e.to_string())??;
    let Some(saved) = saved else { return Ok(None); };
    if peer_id.as_deref().is_some_and(|id| id != saved.source_host_id) { return Err("Request belongs to its original submission host".into()); }
    let watch = BackgroundResultWatch { request_id: request_id.clone(), source_host_id: saved.source_host_id.clone() };
    let actual = if store.background_worker_identity()? == saved.source_host_id {
        let local = Arc::clone(&store);
        tauri::async_runtime::spawn_blocking(move || serde_json::to_value(local.background_task(&request_id)?).map_err(|e| e.to_string())).await.map_err(|e| e.to_string())??
    } else { registry.invoke(&saved.source_host_id, "automation_background_get", json!({"request_id": request_id})).await? };
    tauri::async_runtime::spawn_blocking(move || { store.receive_background_result(&watch, actual.clone())?; Ok(Some(actual)) }).await.map_err(|e| e.to_string())?
}
