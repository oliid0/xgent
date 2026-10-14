//! Original-owner results and saved user responses survive the visible UI.
//! This runs in the native app process; it is not an OS daemon or remote push.
use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use std::time::Duration;
use tauri::Manager;
use super::{automation::AutomationStore, worker_peers::WorkerPeerRegistry};

struct ResultReceiverStarted;

#[cfg(any(target_os="android",target_os="ios"))]
fn configure_os_delivery(app: &tauri::AppHandle, store: &AutomationStore) -> Result<(), String> {
    use tauri_plugin_mobile_assistant::{MobileAssistantExt, ResultDeliveryConfiguration};
    let configured = app.mobile_assistant().configure_result_delivery(ResultDeliveryConfiguration {
        database_path: crate::commands::settings::config_db_path()?.to_str().ok_or("Invalid result database path")?.to_string(),
        host_id: store.background_worker_identity()?,
        target_json: String::new(),
    }).map_err(|e| e.to_string())?;
    if !configured { return Err("OS result delivery was not confirmed".into()); }
    Ok(())
}

#[cfg(any(target_os="android",target_os="ios"))]
fn os_result_setup_lock()->&'static tokio::sync::Mutex<()> {
    static LOCK:std::sync::OnceLock<tokio::sync::Mutex<()>>=std::sync::OnceLock::new();
    LOCK.get_or_init(||tokio::sync::Mutex::new(()))
}

#[cfg(any(target_os="android",target_os="ios"))]
async fn configure_os_target(app:&tauri::AppHandle,store:&Arc<AutomationStore>,target:super::automation::store::ResultDeliveryTarget)->Result<(),String>{
    use tauri_plugin_mobile_assistant::{MobileAssistantExt,ResultDeliveryConfiguration};
    let device=app.clone();let installation=store.background_worker_identity()?;let update=target.clone();
    let configured=tauri::async_runtime::spawn_blocking(move ||{
        device.mobile_assistant().configure_result_delivery(ResultDeliveryConfiguration{
            database_path:crate::commands::settings::config_db_path()?.to_str().ok_or("Invalid result database path")?.to_string(),
            host_id:installation,target_json:serde_json::to_string(&update).map_err(|e|e.to_string())?,
        }).map_err(|_|"OS scoped result configuration was not acknowledged".to_string())
    }).await.map_err(|e|e.to_string())??;
    if !configured{return Err("OS scoped result configuration was not confirmed".into());}
    store.acknowledge_result_delivery(&target)
}

#[cfg(any(target_os="android",target_os="ios"))]
async fn provision_os_results(app:&tauri::AppHandle,store:&Arc<AutomationStore>,registry:&Arc<WorkerPeerRegistry>)->Result<(),String>{
    let owned=Arc::clone(store);
    let (host,candidates)=tauri::async_runtime::spawn_blocking(move ||Ok::<_,String>((owned.background_worker_identity()?,owned.claim_result_delivery_setup()?))).await.map_err(|e|e.to_string())??;
    for watch in candidates {
        // Release between profiles so a newly accepted foreground task is not
        // delayed behind the entire sweep's unreachable older peers.
        let _setup=os_result_setup_lock().lock().await;
        let target=match registry.result_delivery_target(&watch,&host).await {Ok(target)=>target,Err(_)=>continue};
        registry.stage_result_delivery_target(store,&target).await?;
        configure_os_target(app,store,target).await?;
    }
    Ok(())
}

/// Complete the existing private read-grant/OS configuration path before an
/// accepted submission returns to its caller, instead of waiting for a sweep.
/// A setup error never discards host acceptance or submits the task again.
#[cfg(any(target_os="android",target_os="ios"))]
pub(crate) async fn provision_submission_result(app:&tauri::AppHandle,store:&Arc<AutomationStore>,registry:&Arc<WorkerPeerRegistry>,request:&str) {
    let attempt:Result<(),String>=async {
        let _setup=os_result_setup_lock().lock().await;
        registry.bind_result_delivery_store(store)?;
        let owned=Arc::clone(store);let selected=request.to_string();
        let (host,watch)=tauri::async_runtime::spawn_blocking(move ||Ok::<_,String>((owned.background_worker_identity()?,owned.claim_submission_result_delivery_setup(&selected)?))).await.map_err(|e|e.to_string())??;
        let Some(watch)=watch else {return Ok(());};
        let target=registry.result_delivery_target(&watch,&host).await?;
        registry.stage_result_delivery_target(store,&target).await?;
        configure_os_target(app,store,target).await
    }.await;
    if attempt.is_err() {
        let owned=Arc::clone(store);let selected=request.to_string();
        let _=tauri::async_runtime::spawn_blocking(move ||owned.note_submission_result_delivery_error(&selected)).await;
        eprintln!("Original task accepted; OS result setup remains retained for retry");
    }
}

#[cfg(mobile)]
async fn notify_pending(app: &tauri::AppHandle, store: &Arc<AutomationStore>) -> Result<(), String> {
    let owned = Arc::clone(store);
    let entries = tauri::async_runtime::spawn_blocking(move || owned.pending_background_notifications(20))
        .await.map_err(|e| e.to_string())??;
    for entry in entries {
        match crate::commands::cron::deliver_background_result_notification(entry, app.clone(), Arc::clone(store)).await {
            Ok(status) if status == "blocked" || status == "unavailable" => break,
            Ok(_) => {},
            Err(_) => eprintln!("Native result notice remains retained for retry"),
        }
    }
    Ok(())
}

/// Startup can be retried on mobile, but must never install a second receiver.
/// Missing protected ownership leaves ordinary chat usable and creates no peers.
pub(crate) fn start_if_available(app: &tauri::AppHandle, quitting: Option<Arc<AtomicBool>>) {
    let Some(store) = app.try_state::<Arc<AutomationStore>>() else { return; };
    let Some(registry) = app.try_state::<Arc<WorkerPeerRegistry>>() else { return; };
    let store = Arc::clone(store.inner());
    let registry = Arc::clone(registry.inner());
    #[cfg(any(target_os="android",target_os="ios"))]
    if registry.bind_result_delivery_store(&store).is_err(){return;}
    if !app.manage(ResultReceiverStarted) { return; }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        #[cfg(any(target_os="android",target_os="ios"))]
        let mut os_delivery_ready = false;
        let mut sweep = tokio::time::interval(Duration::from_secs(30));
        sweep.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            sweep.tick().await;
            if quitting.as_ref().is_some_and(|flag| flag.load(Ordering::SeqCst)) { break; }
            #[cfg(any(target_os="android",target_os="ios"))]
            if !os_delivery_ready {
                let device = app.clone(); let owned = Arc::clone(&store);
                match tauri::async_runtime::spawn_blocking(move || configure_os_delivery(&device, &owned)).await {
                    Ok(Ok(())) => os_delivery_ready = true,
                    _ => eprintln!("OS result delivery configuration remains available for retry"),
                }
            }
            // Cached notices are attempted before any unavailable PC delays reads.
            #[cfg(mobile)]
            if notify_pending(&app, &store).await.is_err() {
                eprintln!("Native result notification journal unavailable; receipt data retained");
            }
            if quitting.as_ref().is_some_and(|flag| flag.load(Ordering::SeqCst)) { break; }
            if crate::commands::cron::sync_background_results(app.clone(), Arc::clone(&store), Arc::clone(&registry)).await.is_err() {
                eprintln!("Native result synchronization unavailable; durable retry remains");
            }
            #[cfg(any(target_os="android",target_os="ios"))]
            if os_delivery_ready && provision_os_results(&app,&store,&registry).await.is_err(){
                eprintln!("Scoped OS result receive setup remains retained for retry");
            }
            if quitting.as_ref().is_some_and(|flag| flag.load(Ordering::SeqCst)) { break; }
            #[cfg(mobile)]
            if notify_pending(&app, &store).await.is_err() {
                eprintln!("Native result notification journal unavailable; receipt data retained");
            }
        }
    });
}
