use std::sync::Arc;
use tauri::Manager;

use crate::services::automation::{
    store::{ProactiveApplyInput, ProactiveSnapshot}, AutomationStore,
};

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_foreground_attention(window: tauri::WebviewWindow,
    input: crate::services::automation::store::ForegroundAttentionInput,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<(), String> {
    if window.label()!="main" { return Err("Foreground attention belongs to this device's main client".into()); }
    let store=Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move||store.observe_foreground_attention(input)).await.map_err(|e|e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_proactive_snapshot(
    app: tauri::AppHandle,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<ProactiveSnapshot, String> {
    let store = Arc::clone(store.inner());
    let device=app.clone();
    let snapshot=tauri::async_runtime::spawn_blocking(move || mobile_snapshot(&device,&store))
        .await.map_err(|e| format!("Proactive snapshot join: {e}"))??;
    Ok(with_execution_peers(&app,snapshot).await)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_proactive_apply(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    input: ProactiveApplyInput,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<ProactiveSnapshot, String> {
    let store = Arc::clone(store.inner());
    let preflight=Arc::clone(&store);
    let needs_device_reads=store.health_metric_for_proactive_apply(&input)?.is_some();
    let remote=store.remote_execution_for_proactive_apply(&input)?;
    if let Some(remote)=remote {
        if window.label()=="agent-worker" {return Err("Event delegation requires an explicit client configuration action".into());}
        let registry=app.try_state::<Arc<crate::services::worker_peers::WorkerPeerRegistry>>().ok_or("No protected paired worker registry")?;
        let host=registry.probe(&remote.peer_id).await?;
        if host.host_id!=remote.peer_id || !host.executor_ready || !host.accepts_background_tasks
            || !host.workspace_available || host.input_snapshot_version!=1 || !matches!(host.source_context_version, 1 | 2) || host.workdir!=remote.workdir
            || (needs_device_reads && (!matches!(host.source_context_version, 1 | 2) || host.source_routing_version!=2 || host.device_channel_version!=1 || host.device_actions_version!=1))
            || !host.providers.iter().any(|provider|provider.id==remote.provider_id && provider.models.contains(&remote.model)) {
            return Err("Selected event executor/model/workspace is no longer available; refresh before creating the rule".into());
        }
        // Store-side CAS/template/policy is repeated after network and any OS sheet.
        preflight.remote_execution_for_proactive_apply(&input)?;
    }
    let device=app.clone();
    let snapshot=tauri::async_runtime::spawn_blocking(move || {
        let app=device;
        #[cfg(any(target_os="ios",target_os="android"))]
        {
            let _guard=crate::services::health_events::HEALTH_CONFIG_LOCK.lock().map_err(|_|"Health configuration lock poisoned".to_string())?;
            #[cfg(target_os="ios")]
            let _home_guard=crate::services::home_events::HOME_CONFIG_LOCK.lock().map_err(|_|"Home observation setup lock unavailable".to_string())?;
            #[cfg(target_os="ios")]
            if let Some(home)=store.home_for_proactive_apply(&input)? {
                if window.label()=="agent-worker" {return Err("Home observation requires explicit client configuration".into());}
                crate::services::home_events::configure(&app,&store,Some(home))?;
            }
            if let Some(metric)=store.health_metric_for_proactive_apply(&input)? {
                if window.label()=="agent-worker" { return Err("Health observation requires an explicit client authorization action".into()); }
                crate::services::health_events::configure(&app,&store,Some(metric))?;
            }
            let result=store.proactive_apply(input);
            // Include rollback after a failed CAS: a stale form must not leave
            // an unused native subscription armed. Accepted rules stay armed.
            let observed=crate::services::health_events::configure(&app,&store,None);
            store.set_health_event_error(observed.as_ref().err().map(String::as_str))?;
            #[cfg(target_os="ios")]
            {
                let observed=crate::services::home_events::configure(&app,&store,None);
                store.set_home_event_error(observed.as_ref().err().map(String::as_str))?;
            }
            result?;
            mobile_snapshot(&app,&store)
        }
        #[cfg(not(any(target_os="ios",target_os="android")))]
        { let _=(app,window);store.proactive_apply(input) }
    })
        .await.map_err(|e| format!("Proactive apply join: {e}"))??;
    Ok(with_execution_peers(&app,snapshot).await)
}

async fn with_execution_peers(app:&tauri::AppHandle,mut snapshot:ProactiveSnapshot)->ProactiveSnapshot {
    if let Some(registry)=app.try_state::<Arc<crate::services::worker_peers::WorkerPeerRegistry>>() {
        // Includes truthful offline states; only live ready peers can be chosen.
        snapshot.execution_peers=registry.list().await.into_iter().filter(|peer|peer.peer_id!=snapshot.host_id).collect();
    }
    snapshot
}

fn mobile_snapshot(app:&tauri::AppHandle,store:&AutomationStore)->Result<ProactiveSnapshot,String> {
    #[cfg(target_os="android")]
    {
        use tauri_plugin_mobile_assistant::MobileAssistantExt;
        let mut snapshot=store.proactive_snapshot()?;
        // Unsupported devices keep their original controls without a dead
        // health option. Availability is not an OS permission grant.
        match app.mobile_assistant().available_health_event_metrics() {
            Ok(metrics)=>snapshot.health_event_metrics=metrics,
            Err(error)=>{ snapshot.health_event_metrics.clear();snapshot.health_event_error=Some(error.to_string()); },
        }
        Ok(snapshot)
    }
    #[cfg(target_os="ios")]
    {
        use tauri_plugin_mobile_assistant::MobileAssistantExt;
        let mut snapshot=store.proactive_snapshot()?;
        if store.home_event_sources_allowed()? { match app.mobile_assistant().home_event_sources() {
            Ok(homes)=>snapshot.home_event_homes=homes,
            Err(error)=>snapshot.home_event_error=Some(error.to_string()),
        } }
        Ok(snapshot)
    }
    #[cfg(not(any(target_os="android",target_os="ios")))]
    { let _=app;store.proactive_snapshot() }
}
