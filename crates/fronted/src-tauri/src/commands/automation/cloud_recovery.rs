use std::sync::Arc;
use tauri::Manager;
use crate::services::automation::AutomationStore;
use crate::services::cloud_execution::{CloudExecutionService,CloudTaskLocator};
use crate::services::cloud_secret_vault::CloudSecretVault;
use super::cron::background_configuration_on_connection;

async fn observe(app:&tauri::AppHandle,store:Arc<AutomationStore>,id:String,wait:String,call:String) -> Result<bool,String> {
    let token=app.state::<Arc<CloudSecretVault>>().github_token()?;
    let before=Arc::clone(&store);let device=app.clone();let execution=id.clone();let occurrence=wait.clone();let operation=call.clone();let captured=token.clone();
    let launch=tauri::async_runtime::spawn_blocking(move||before.prepare_waiting_background_cloud_launch(&execution,&occurrence,&operation,|conn,input| {
        let binding=background_configuration_on_connection(&device,conn,input)?;
        if device.state::<Arc<CloudSecretVault>>().github_token()?!=captured {return Err("Cloud credential changed before interrupted-launch observation".into());}
        Ok(binding)
    })).await.map_err(|e|e.to_string())??;
    let locator=CloudTaskLocator{owner:launch.input.owner,repository:launch.input.repository,task_id:launch.task_id};
    // Only a native GET observation can close this originally reserved start.
    let result=app.state::<Arc<CloudExecutionService>>().recover_task_start(&token,&locator,&launch.input.runner).await?;
    let Some(result)=result else {return Ok(false);};
    let device=app.clone();
    tauri::async_runtime::spawn_blocking(move||store.acknowledge_waiting_background_cloud_launch(&id,&wait,&call,&result,|conn,input| {
        let binding=background_configuration_on_connection(&device,conn,input)?;
        if device.state::<Arc<CloudSecretVault>>().github_token()?!=token {return Err("Cloud credential changed before interrupted-launch release".into());}
        Ok(binding)
    })).await.map_err(|e|e.to_string())?
}

/// No caller ids, leases, inputs or statuses: native storage selects at most
/// four due original starts and persists retry backoff before any GET.
#[tauri::command]
pub async fn automation_background_cloud_recover_interrupted(window:tauri::WebviewWindow,app:tauri::AppHandle,
    store:tauri::State<'_,Arc<AutomationStore>>) -> Result<u32,String> {
    if window.label()!="agent-worker" {return Err("Interrupted cloud recovery belongs to the native worker".into());}
    let store=Arc::clone(store.inner());let owned=Arc::clone(&store);
    let candidates=tauri::async_runtime::spawn_blocking(move||owned.due_background_cloud_launch_recoveries()).await.map_err(|e|e.to_string())??;
    let mut resumed=0;
    for (id,wait,call) in candidates {
        let outcome=observe(&app,Arc::clone(&store),id.clone(),wait.clone(),call).await;
        match outcome {
            Ok(true)=>resumed+=1,
            other=>{
                let message=match other {Ok(false)=>"Original cloud run is not visible yet; outcome remains unknown; no redispatch".to_string(),Err(error)=>format!("Original cloud recovery could not be confirmed: {error}"),Ok(true)=>unreachable!()};
                let owned=Arc::clone(&store);
                let saved=tauri::async_runtime::spawn_blocking(move||owned.record_background_cloud_recovery_observation(&id,&wait,&message)).await;
                if !matches!(saved,Ok(Ok(()))) {eprintln!("Interrupted cloud recovery diagnostic could not be saved; persisted backoff remains");}
            }
        }
    }
    Ok(resumed)
}

async fn cancel_original(app: &tauri::AppHandle, store: Arc<AutomationStore>, id: &str, call: &str, probe: &str) -> Result<bool,String> {
    let token = app.state::<Arc<CloudSecretVault>>().github_token()?;
    let load = |conn: &rusqlite::Connection, input: &crate::services::automation::SubmitBackgroundTaskInput| {
        if app.state::<Arc<CloudSecretVault>>().github_token()? != token { return Err("Cloud cancellation credential changed".into()); }
        background_configuration_on_connection(app,conn,input)
    };
    let (locator,known_run) = store.prepare_background_cloud_cancellation(id,call,probe,load)?;
    let outcome = app.state::<Arc<CloudExecutionService>>().request_task_cancellation(&token,&locator,known_run,|status| {
        // Recheck after the lookup and immediately before POST. No new tool
        // launch, arbitrary run id or selected-peer authority is introduced.
        // Persist the positive GET identity before POST, including when its
        // response is subsequently lost. Acceptance is recorded separately.
        store.record_background_cloud_cancellation(id,call,probe,status,false,load).map(|_| ())
    }).await?;
    let Some((status,accepted)) = outcome else { return Err("Original run is not visible yet; its cancellation remains pending".into()); };
    store.record_background_cloud_cancellation(id,call,probe,&status,accepted,load)
}

/// Caller provides no task/run/account identifiers or claimed remote status.
#[tauri::command]
pub async fn automation_background_cloud_reconcile_cancellations(window: tauri::WebviewWindow, app: tauri::AppHandle,
    store: tauri::State<'_,Arc<AutomationStore>>) -> Result<u32,String> {
    if window.label() != "agent-worker" { return Err("Cloud cancellation reconciliation belongs to the native worker".into()); }
    let store = Arc::clone(store.inner());
    let owned = Arc::clone(&store);
    let due = tauri::async_runtime::spawn_blocking(move || owned.due_background_cloud_cancellations()).await.map_err(|e| e.to_string())??;
    let mut settled = 0;
    for (id,call,probe) in due {
        match cancel_original(&app,Arc::clone(&store),&id,&call,&probe).await {
            Ok(true) => settled += 1,
            Ok(false) => {},
            Err(error) => {
                let owned = Arc::clone(&store);
                let saved = tauri::async_runtime::spawn_blocking(move || owned.record_background_cloud_cancellation_error(&id,&call,&probe,&error)).await;
                if !matches!(saved,Ok(Ok(()))) { eprintln!("Cloud cancellation diagnostic could not be saved; persistent backoff remains"); }
            }
        }
    }
    Ok(settled)
}
