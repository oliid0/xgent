//! Native health intake survives page closure and ACK loss. OS-owned iOS
//! observers/Android jobs retain metadata independently of the page lifetime.
use std::sync::{Arc, Mutex};
use tauri_plugin_mobile_assistant::{HealthEventAcknowledgement, HealthEventConfiguration, HealthMetricRequest, MobileAssistantExt};
use super::automation::AutomationStore;

pub(crate) static HEALTH_CONFIG_LOCK: Mutex<()> = Mutex::new(());

pub(crate) fn configure(app: &tauri::AppHandle, store: &AutomationStore, authorize_metric: Option<String>) -> Result<(),String> {
    let mut metrics=store.active_health_event_metrics()?;
    let authorize=authorize_metric.is_some();
    if let Some(metric)=authorize_metric { if !metrics.contains(&metric) { metrics.push(metric); } }
    metrics.sort();
    // Event delivery has its own native scope. An unavailable optional Health
    // adapter must not invent OS setup success or strand already staged tasks.
    let delivery=super::os_event_sender::configure(app,store);
    store.set_event_sender_error(delivery.as_ref().err().map(String::as_str))?;
    let observed=app.mobile_assistant().configure_health_events(HealthEventConfiguration {
        metrics:metrics.clone(),authorize,
        #[cfg(target_os="android")]
        policy_database:crate::commands::settings::config_db_path()?.to_str().ok_or("Invalid health policy database path")?.to_string(),
    }).map_err(|e|e.to_string())?;
    if observed!=metrics { return Err("Native health adapter did not confirm the exact observation scope".into()); }
    Ok(())
}

pub(crate) fn start(app: tauri::AppHandle, store: Arc<AutomationStore>) {
    tauri::async_runtime::spawn(async move {
        let mut ticks=tokio::time::interval(std::time::Duration::from_secs(5));
        ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            ticks.tick().await;
            let app=app.clone();let store=Arc::clone(&store);
            let _=tauri::async_runtime::spawn_blocking(move || {
                let result=(|| {
                    {
                        let _guard=HEALTH_CONFIG_LOCK.lock().map_err(|_|"Health configuration lock poisoned".to_string())?;
                        configure(&app,&store,None)?;
                        let events=app.mobile_assistant().pending_health_events().map_err(|e|e.to_string())?;
                        if !events.is_empty() {
                            store.ingest_health_events(&events)?;
                            // A lost ACK re-reads the same persisted event ID.
                            app.mobile_assistant().acknowledge_health_events(HealthEventAcknowledgement {ids:events.iter().map(|event|event.id.clone()).collect()}).map_err(|e|e.to_string())?;
                        }
                    }
                    // Foreground refresh must not leave an opted-in rule
                    // waiting for a deferred OS refresh. Same private scope,
                    // existing SDK read, late-result fences and frozen receipt.
                    let mut read_error=None;
                    for scope in store.pending_event_health_reads()? {
                        let observed=(|| {
                            let request=scope.sample_request()?;
                            let permission=HealthMetricRequest{metric:request.metric.clone()};
                            let permitted=|states:&tauri_plugin_mobile_assistant::MobilePermissionStates|
                                states.get("health").is_some_and(|state|state=="granted" || (cfg!(target_os="ios") && state=="requested"));
                            let before=app.mobile_assistant().check_health_metric_permission(permission.clone()).map_err(|e|e.to_string())?;
                            if !permitted(&before){return Err("Original health sample permission unavailable".to_string());}
                            let actual=app.mobile_assistant().read_health_samples(request).map_err(|e|e.to_string())?;
                            let after=app.mobile_assistant().check_health_metric_permission(permission).map_err(|e|e.to_string())?;
                            if !permitted(&after){return Err("Original health sample permission changed during query".into());}
                            store.commit_event_health_reads(&[scope.observation(actual)])
                        })();
                        if let Err(error)=observed {if read_error.is_none(){read_error=Some(error);}}
                    }
                    store.dispatch_proactive_rules()?;
                    if let Some(error)=read_error{return Err(error);}
                    Ok::<(),String>(())
                })();
                let _=store.set_health_event_error(result.as_ref().err().map(String::as_str));
            }).await;
        }
    });
}
