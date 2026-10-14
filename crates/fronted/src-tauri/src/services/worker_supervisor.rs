//! Desktop execution host recovery is independent of any WebView timer. This
//! supervises the existing in-app executor; it is not an OS service/daemon.
use std::sync::{Arc,atomic::{AtomicBool,Ordering}};
use std::time::Duration;
use tauri::Manager;
use uuid::Uuid;
use super::{agent_worker::AgentWorkerState,automation::AutomationStore};

const LABEL: &str = "agent-worker";
const POWER_SCOPE:&str="native-background-work";

fn build_worker(app: &tauri::AppHandle, instance: &str) -> Result<(),String> {
    let value = serde_json::to_string(instance).map_err(|e|e.to_string())?;
    let initialization = format!("Object.defineProperty(window,'__XGENT_WORKER_INSTANCE__',{{value:{value},writable:false,configurable:false}});");
    tauri::WebviewWindowBuilder::new(app,LABEL,tauri::WebviewUrl::App("index.html".into()))
        .title("Xgent Agent Worker").visible(false).focused(false).skip_taskbar(true)
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
        .initialization_script(initialization).build().map_err(|e|e.to_string())?;
    Ok(())
}

/// Called from native setup. A failed recovery is never armed by this function;
/// the independent local RPC bridge can still load with execution disabled.
pub(crate) fn initialize(app: &tauri::AppHandle, store: &Arc<AutomationStore>, state: &Arc<AgentWorkerState>) -> Result<(),String> {
    let instance = Uuid::new_v4().to_string();
    store.install_background_worker_instance(&instance)?;
    state.install_instance(instance.clone(),super::automation::db::now_ms() as u64)?;
    build_worker(app,&instance)
}

async fn replace_worker(app: &tauri::AppHandle, store: Arc<AutomationStore>, state: Arc<AgentWorkerState>, quitting: Arc<AtomicBool>) -> Result<(),String> {
    state.suspend_execution()?;
    // Fence before destroying: an already queued claim must not acquire a
    // fresh lease after the old window has gone, even if its command was read
    // before readiness changed. SQLite checks inside the claim transaction.
    let instance = Uuid::new_v4().to_string();
    let owned = Arc::clone(&store); let fence = instance.clone();
    tauri::async_runtime::spawn_blocking(move || owned.install_background_worker_instance(&fence)).await.map_err(|e|e.to_string())??;
    if let Some(window) = app.get_webview_window(LABEL) { window.destroy().map_err(|e|e.to_string())?; }
    for _ in 0..20 {
        if quitting.load(Ordering::SeqCst) { return Err("Background host replacement stopped by app exit".into()); }
        if app.get_webview_window(LABEL).is_none() { break; }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    if app.get_webview_window(LABEL).is_some() { return Err("Old execution host has not retired; no replacement was started".into()); }
    let owned = Arc::clone(&store);
    tauri::async_runtime::spawn_blocking(move || owned.recover_interrupted_prompt_runs()).await.map_err(|e|e.to_string())??;
    if quitting.load(Ordering::SeqCst) { return Err("Background host replacement stopped by app exit".into()); }
    state.install_instance(instance.clone(),super::automation::db::now_ms() as u64)?;
    // Builder must not run inside a synchronous IPC/event handler on Windows.
    let device = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if quitting.load(Ordering::SeqCst) { return Err("Background host replacement stopped by app exit".into()); }
        build_worker(&device,&instance)
    }).await.map_err(|e|e.to_string())?
}

pub(crate) fn start(app: tauri::AppHandle, store: Arc<AutomationStore>, state: Arc<AgentWorkerState>, quitting: Arc<AtomicBool>) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;
            if quitting.load(Ordering::SeqCst) { break; }
            if let Some(power)=app.try_state::<Arc<super::power_activity::PowerActivityManager>>() {
                let owned=Arc::clone(&store);
                let power=Arc::clone(power.inner());let stopping=Arc::clone(&quitting);
                let _=tauri::async_runtime::spawn_blocking(move|| {
                    if stopping.load(Ordering::SeqCst) {power.end(POWER_SCOPE);return;}
                    match owned.background_work_requires_awake() {
                        Ok(true)=>{
                            if let Err(error)=power.begin(POWER_SCOPE,"Original background task and owned job follow-up",Some(60_000)){eprintln!("Background power activity unavailable: {error}");}
                        },
                        Ok(false)=>power.end(POWER_SCOPE),
                        Err(error)=>{power.end(POWER_SCOPE);eprintln!("Original background power scope unavailable: {error}");},
                    }
                    if stopping.load(Ordering::SeqCst) {power.end(POWER_SCOPE);}
                }).await;
            }
            let now = super::automation::db::now_ms() as u64;
            if !state.restart_due(now,app.get_webview_window(LABEL).is_some()) { continue; }
            if let Err(error) = replace_worker(&app,Arc::clone(&store),Arc::clone(&state),Arc::clone(&quitting)).await {
                if quitting.load(Ordering::SeqCst) { break; }
                let _ = state.restart_failed(super::automation::db::now_ms() as u64);
                eprintln!("Native execution host remains unavailable; recovery will retry with backoff: {error}");
            }
        }
        if let Some(power)=app.try_state::<Arc<super::power_activity::PowerActivityManager>>() {power.end(POWER_SCOPE);}
    });
}
