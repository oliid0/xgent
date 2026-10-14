use std::sync::Arc;

use serde_json::Value;
use tauri::{Emitter, Manager};

use crate::services::lan_pc_client::{
    LanPcClient, LanPcClientStatus, LAN_PC_SESSION_CHANGED_EVENT,
};

#[tauri::command]
pub async fn lan_pc_status(
    client: tauri::State<'_, Arc<LanPcClient>>,
) -> Result<LanPcClientStatus, String> {
    Ok(client.status().await)
}

#[tauri::command]
pub async fn worker_peer_discover(window:tauri::WebviewWindow,app:tauri::AppHandle)->Result<tauri_plugin_mobile_assistant::NearbyWorkstations,String>{
    if window.label()=="agent-worker" {return Err("LAN discovery belongs to the device connection view".into());}
    let own=app.try_state::<Arc<crate::services::automation::AutomationStore>>().and_then(|store|store.background_worker_identity().ok());
    let mut result=crate::services::worker_discovery::discover(app).await?;
    if let Some(own)=own {result.services.retain(|service|service.host_id!=own);}
    Ok(result)
}

#[tauri::command]
pub async fn lan_pc_pair(
    base_url: String,
    code: String,
    device_name: String,
    client: tauri::State<'_, Arc<LanPcClient>>,
    app_handle: tauri::AppHandle,
) -> Result<LanPcClientStatus, String> {
    let mut status = client.pair(&base_url, &code, &device_name).await?;
    if let Some(registry) = app_handle.try_state::<Arc<crate::services::worker_peers::WorkerPeerRegistry>>() {
        if let Err(error) = registry.remember(&client).await {
            status.worker_registration_error = Some(format!("Paired successfully, but persistent worker registration failed: {error}"));
        }
    } else {
        status.worker_registration_error = Some("Paired successfully, but the worker registry is unavailable".to_string());
    }
    let _ = app_handle.emit(LAN_PC_SESSION_CHANGED_EVENT, &status);
    Ok(status)
}

#[tauri::command]
pub async fn lan_pc_refresh(
    base_url: Option<String>,
    client: tauri::State<'_, Arc<LanPcClient>>,
    app_handle: tauri::AppHandle,
) -> Result<LanPcClientStatus, String> {
    let status = client.refresh(base_url.as_deref()).await?;
    let _ = app_handle.emit(LAN_PC_SESSION_CHANGED_EVENT, &status);
    Ok(status)
}

#[tauri::command]
pub async fn lan_pc_disconnect(
    client: tauri::State<'_, Arc<LanPcClient>>,
    app_handle: tauri::AppHandle,
) -> Result<LanPcClientStatus, String> {
    if let Some(registry) = app_handle.try_state::<Arc<crate::services::worker_peers::WorkerPeerRegistry>>() {
        registry.forget_active(&client).await?;
    }
    let status = client.disconnect().await?;
    let _ = app_handle.emit(LAN_PC_SESSION_CHANGED_EVENT, &status);
    Ok(status)
}

#[tauri::command]
pub async fn worker_peer_list(
    registry: tauri::State<'_, Arc<crate::services::worker_peers::WorkerPeerRegistry>>,
    client: tauri::State<'_, Arc<LanPcClient>>,
) -> Result<crate::services::worker_peers::WorkerPeerList, String> {
    let registration_error = registry.ensure_active(&client).await.err();
    Ok(crate::services::worker_peers::WorkerPeerList { peers: registry.list().await, registration_error })
}

#[tauri::command(rename_all = "snake_case")]
pub async fn worker_peer_probe(
    peer_id: String,
    registry: tauri::State<'_, Arc<crate::services::worker_peers::WorkerPeerRegistry>>,
) -> Result<crate::services::worker_peers::WorkerHostInfo, String> {
    registry.probe(&peer_id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn worker_peer_resolve_endpoint(
    base_url: String,
    registry: tauri::State<'_, Arc<crate::services::worker_peers::WorkerPeerRegistry>>,
) -> Result<String, String> {
    registry.resolve_endpoint(&base_url).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn worker_peer_resolve_request(
    app: tauri::AppHandle,
    request_id: String,
    registry: tauri::State<'_, Arc<crate::services::worker_peers::WorkerPeerRegistry>>,
) -> Result<Option<String>, String> {
    #[cfg(desktop)] {
        use tauri::Manager;
        let store=app.state::<Arc<crate::services::automation::AutomationStore>>();
        if store.is_local_background_model_child(&request_id)? { return store.background_worker_identity().map(Some); }
    }
    #[cfg(mobile)] let _=app;
    registry.resolve_request(&request_id).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn worker_peer_invoke(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    peer_id: String, command: String, args: Value,
    registry: tauri::State<'_, Arc<crate::services::worker_peers::WorkerPeerRegistry>>,
) -> Result<Value, String> {
    #[cfg(desktop)] {
        use tauri::Manager;
        let store=Arc::clone(app.state::<Arc<crate::services::automation::AutomationStore>>().inner());
        if peer_id==store.background_worker_identity()? {
            return crate::services::child_tasks::invoke_child(store,registry.inner(),&peer_id,&command,args).await;
        }
    }
    #[cfg(desktop)]
    if window.label() == "agent-worker" && command == "automation_background_submit" {
        use tauri::Manager;
        let input = serde_json::from_value::<crate::services::automation::SubmitBackgroundTaskInput>(
            args.get("input").cloned().ok_or_else(|| "Missing background task input".to_string())?,
        ).map_err(|e| e.to_string())?;
        let lease = serde_json::from_value::<crate::services::automation::BackgroundExecutionLease>(
            args.get("parent_lease").cloned().ok_or_else(|| "Missing captured parent execution lease".to_string())?,
        ).map_err(|e| e.to_string())?;
        let call = args.get("parent_call_id").and_then(Value::as_str).ok_or("Missing original child tool call")?.to_string();
        let store = Arc::clone(app.state::<Arc<crate::services::automation::AutomationStore>>().inner());
        let stage = Arc::clone(&store); let device = app.clone(); let target = peer_id.clone(); let operation = call.clone();
        let (execution, existing, accepted_input) = tauri::async_runtime::spawn_blocking(move || stage.stage_background_child(input,&target,&operation,&lease,|conn,id| {
            crate::services::automation::AutomationStore::verify_background_configuration(conn,id,Some(&lease),|conn,input|
                crate::commands::cron::background_configuration_on_connection(&device,conn,input)).map(|_|())
        })).await.map_err(|e|e.to_string())??;
        if let Some(existing) = existing { return Ok(existing); }
        let mut outbound = args;
        outbound["input"] = serde_json::to_value(accepted_input).map_err(|e|e.to_string())?;
        if let Some(object) = outbound.as_object_mut() { object.remove("parent_lease"); object.remove("parent_call_id"); }
        let result = registry.invoke(&peer_id,&command,outbound).await;
        match result {
            Ok(snapshot) => {
                let observation = snapshot.clone();
                tauri::async_runtime::spawn_blocking(move || store.record_background_child_observation(&execution,&call,None,&observation,false)).await.map_err(|e|e.to_string())??;
                return Ok(snapshot);
            }
            Err(error) => {
                let message = error.clone();
                tauri::async_runtime::spawn_blocking(move || store.record_background_child_error(&execution,&call,None,&message)).await.map_err(|e|e.to_string())??;
                return Err(error);
            }
        }
    }
    #[cfg(mobile)]
    let _ = (window, app);
    let mut outbound_args = args;
    // The caller lease is a local execution capability, never peer payload.
    if let Some(object) = outbound_args.as_object_mut() { object.remove("parent_lease"); object.remove("parent_call_id"); }
    registry.invoke(&peer_id, &command, outbound_args).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn worker_peer_file_invoke(
    peer_id: String, command: String, args: Value,
    registry: tauri::State<'_, Arc<crate::services::worker_peers::WorkerPeerRegistry>>,
) -> Result<Value, String> {
    registry.invoke_file(&peer_id, &command, args).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn worker_peer_forget(
    peer_id: String,
    base_url: Option<String>,
    registry: tauri::State<'_, Arc<crate::services::worker_peers::WorkerPeerRegistry>>,
    client: tauri::State<'_, Arc<LanPcClient>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // Otherwise list/ensure_active would immediately recreate this peer.
    let selected_url = base_url.as_deref().map(crate::services::lan_pc_client::normalize_base_url).transpose()?;
    let active_url = client.status().await.base_url;
    if registry.owns_active(&peer_id, &client).await && selected_url.as_ref().is_none_or(|url|
        Some(url) == active_url.as_ref()) {
        let status = client.disconnect().await?;
        let _ = app_handle.emit(LAN_PC_SESSION_CHANGED_EVENT, &status);
    }
    if let Some(url) = selected_url { registry.forget_endpoint(&peer_id, &url).await }
    else { registry.forget(&peer_id).await }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn lan_pc_invoke(
    base_url: Option<String>,
    peer_id: Option<String>,
    command: String,
    args: Value,
    client: tauri::State<'_, Arc<LanPcClient>>,
    registry: tauri::State<'_, Arc<crate::services::worker_peers::WorkerPeerRegistry>>,
) -> Result<Value, String> {
    let url = match base_url { Some(url) => url, None => client.status().await.base_url.ok_or("No paired computer selected")? };
    registry.invoke_chat(&url, peer_id.as_deref(), &command, args).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn lan_pc_subscribe(
    base_url: Option<String>,
    peer_id: Option<String>,
    relay_id: String,
    event: String,
    client: tauri::State<'_, Arc<LanPcClient>>,
    app_handle: tauri::AppHandle,
    registry: tauri::State<'_, Arc<crate::services::worker_peers::WorkerPeerRegistry>>,
) -> Result<Value, String> {
    let url = match base_url { Some(url) => url, None => client.status().await.base_url.ok_or("No paired computer selected")? };
    let (subscription, peer_id) = registry.subscribe_chat(&url, peer_id.as_deref(), &event, &relay_id, app_handle).await?;
    Ok(serde_json::json!({ "subscriptionId": subscription.subscription_id, "peerId": peer_id }))
}

#[tauri::command(rename_all = "snake_case")]
pub async fn lan_pc_unsubscribe(
    subscription_id: String,
    registry: tauri::State<'_, Arc<crate::services::worker_peers::WorkerPeerRegistry>>,
) -> Result<(), String> {
    registry.unsubscribe_chat(&subscription_id).await
}
