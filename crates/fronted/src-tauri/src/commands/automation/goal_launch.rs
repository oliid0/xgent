use std::sync::Arc;
use serde::Serialize;
use tauri::Manager;
use crate::services::automation::{AutomationStore, store::{GoalLaunchInput, GoalLaunchReceipt}};
use crate::services::worker_peers::{WorkerHostInfo, WorkerPeerRegistry};

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct GoalExecutor {
    pub peer_id: Option<String>,
    pub label: String,
    pub host: WorkerHostInfo,
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct GoalExecutors {
    pub store_id: String,
    pub targets: Vec<GoalExecutor>,
}

fn main(window: &tauri::WebviewWindow) -> Result<(),String> {
    if window.label() != "main" { return Err("Goal launches belong to the main client, never an execution worker".into()); }
    Ok(())
}
fn valid_target(host: &WorkerHostInfo, input: &GoalLaunchInput) -> Result<(),String> {
    if !host.executor_ready || !host.accepts_background_tasks || !host.workspace_available
        || host.workdir != input.workdir || (input.intelligent_scheduling_enabled && host.intelligent_scheduling_version != 1) {
        return Err("goals.executorUnavailable".into());
    }
    if !matches!(host.source_context_version, 1 | 2) || !matches!(host.source_routing_version,1|2) {return Err("goals.executorUnavailable".into());}
    let provider = host.providers.iter().find(|provider|provider.id==input.provider_id).ok_or("goals.executorUnavailable")?;
    if !provider.models.contains(&input.model) { return Err("goals.executorUnavailable".into()); }
    if provider.model_profiles.iter().find(|profile| profile.model==input.model).is_some_and(|profile|
        !profile.skills.is_empty() && profile.skills.iter().all(|skill| matches!(skill.as_str(),"image"|"video"|"audio"))) {
        return Err("goals.planningModelRequired".into());
    }
    Ok(())
}

#[tauri::command(rename_all="snake_case")]
pub async fn automation_goal_executors(window: tauri::WebviewWindow, app: tauri::AppHandle,
    store: tauri::State<'_,Arc<AutomationStore>>, registry: tauri::State<'_,Arc<WorkerPeerRegistry>>,
) -> Result<GoalExecutors,String> {
    main(&window)?;
    let owned = Arc::clone(store.inner());
    let store_id = tauri::async_runtime::spawn_blocking(move||owned.goal_snapshot().map(|snapshot|snapshot.store_id)).await.map_err(|e|e.to_string())??;
    let mut targets = Vec::new();
    #[cfg(desktop)]
    {
        let owned = app.clone();
        if let Ok(Ok(host)) = tauri::async_runtime::spawn_blocking(move||super::cron::background_host_info(&owned)).await {
            if host.executor_ready && host.accepts_background_tasks && host.workspace_available {
                targets.push(GoalExecutor { peer_id: None, label: host.platform.clone(), host });
            }
        }
    }
    #[cfg(mobile)] let _ = app;
    for peer in registry.list().await {
        if peer.online && peer.host.executor_ready && peer.host.accepts_background_tasks && peer.host.workspace_available && matches!(peer.host.source_context_version, 1 | 2) {
            let address = reqwest::Url::parse(&peer.base_url).ok().and_then(|url|url.host_str().map(str::to_owned)).unwrap_or_default();
            targets.push(GoalExecutor { peer_id: Some(peer.peer_id), label: format!("{} · {}",peer.host.platform,address), host: peer.host });
        }
    }
    Ok(GoalExecutors { store_id, targets })
}

#[tauri::command(rename_all="snake_case")]
pub async fn automation_goal_launch(window: tauri::WebviewWindow, app: tauri::AppHandle, input: GoalLaunchInput,
    store: tauri::State<'_,Arc<AutomationStore>>, registry: tauri::State<'_,Arc<WorkerPeerRegistry>>,
) -> Result<GoalLaunchReceipt,String> {
    main(&window)?;
    let store = Arc::clone(store.inner()); let registry = Arc::clone(registry.inner());
    let read = Arc::clone(&store); let original = input.clone();
    let existing = tauri::async_runtime::spawn_blocking(move||read.existing_goal_launch(&original)).await.map_err(|e|e.to_string())??;
    let saved = if let Some(saved) = existing { saved } else {
        let host = if let Some(peer) = &input.peer_id { registry.probe(peer).await? } else {
            #[cfg(desktop)] {
                let owned=app.clone();
                tauri::async_runtime::spawn_blocking(move||super::cron::background_host_info(&owned)).await.map_err(|e|e.to_string())??
            }
            #[cfg(mobile)] { return Err("goals.executorUnavailable".into()); }
        };
        valid_target(&host,&input)?;
        if registry.resolve_request(&input.request_id).await?.is_some_and(|owner|owner!=host.host_id) { return Err("goals.ownerChanged".into()); }
        let origin_memory=if input.peer_id.is_some() {
            let read=Arc::clone(&store);let original=input.clone();
            let query=tauri::async_runtime::spawn_blocking(move||read.goal_launch_memory_query(&original)).await.map_err(|e|e.to_string())??;
            if let Some(memory)=app.try_state::<Arc<crate::services::memory::MemoryStore>>() {
                let memory=Arc::clone(memory.inner());
                tauri::async_runtime::spawn_blocking(move||crate::services::automation::origin_memory::capture(&memory,&query)).await.map_err(|e|e.to_string())?
            }else{None}
        }else{None};
        let stage=Arc::clone(&store); let original=input.clone();
        tauri::async_runtime::spawn_blocking(move||stage.stage_goal_launch(original,&host.host_id,origin_memory)).await.map_err(|e|e.to_string())??
    };
    if !saved.accepted && !saved.cancel_requested {
        let _ = super::submission::dispatch_selected(app,Arc::clone(&store),registry,input.request_id.clone()).await;
    }
    tauri::async_runtime::spawn_blocking(move||store.existing_goal_launch(&input)?.ok_or_else(||"goals.ownerChanged".into()))
        .await.map_err(|e|e.to_string())?
}
