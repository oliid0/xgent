use std::sync::Arc;
use tauri::Manager;
use crate::services::automation::{AutomationStore,BackgroundCloudLaunch,BackgroundExecutionLease};
use crate::services::cloud_execution::{CloudExecutionService,CloudTaskLocator};
use crate::services::cloud_secret_vault::CloudSecretVault;
use super::cron::background_configuration_on_connection;

async fn prepare(app:&tauri::AppHandle,store:&Arc<AutomationStore>,id:&str,call:&str,lease:&BackgroundExecutionLease,reserve:bool) -> Result<(BackgroundCloudLaunch,String),String> {
    let token=app.state::<Arc<CloudSecretVault>>().github_token()?;
    let owned=Arc::clone(store);let device=app.clone();let execution=id.to_string();let operation=call.to_string();let authority=lease.clone();let captured=token.clone();
    let launch=tauri::async_runtime::spawn_blocking(move||owned.prepare_background_cloud_launch(&execution,&operation,&authority,reserve,|conn,input| {
        let binding=background_configuration_on_connection(&device,conn,input)?;
        if device.state::<Arc<CloudSecretVault>>().github_token()?!=captured {return Err("Cloud credential changed before launch/recovery".into());}
        Ok(binding)
    })).await.map_err(|e|e.to_string())??;
    Ok((launch,token))
}

async fn acknowledge(store:Arc<AutomationStore>,id:String,call:String,lease:BackgroundExecutionLease,result:crate::services::cloud_execution::CloudTaskStartResult) -> Result<serde_json::Value,String> {
    tauri::async_runtime::spawn_blocking(move||store.acknowledge_background_cloud_launch(&id,&call,&lease,&result)).await.map_err(|e|e.to_string())?
}

async fn recover(app:&tauri::AppHandle,store:Arc<AutomationStore>,id:String,call:String,lease:BackgroundExecutionLease) -> Result<Option<serde_json::Value>,String> {
    let (launch,token)=prepare(app,&store,&id,&call,&lease,false).await?;
    if let Some(receipt)=launch.receipt {return Ok(Some(receipt));}
    let locator=CloudTaskLocator{owner:launch.input.owner,repository:launch.input.repository,task_id:launch.task_id};
    let result=app.state::<Arc<CloudExecutionService>>().recover_task_start(&token,&locator,&launch.input.runner).await?;
    // No response/negative observation ever reaches a dispatch endpoint.
    let Some(result)=result else {return Ok(None);};
    let (current,_)=prepare(app,&store,&id,&call,&lease,false).await?;
    if let Some(receipt)=current.receipt {return Ok(Some(receipt));}
    acknowledge(store,id,call,lease,result).await.map(Some)
}

#[tauri::command(rename_all="snake_case")]
pub async fn automation_background_cloud_start(window:tauri::WebviewWindow,app:tauri::AppHandle,execution_id:String,call_id:String,lease:BackgroundExecutionLease,
    store:tauri::State<'_,Arc<AutomationStore>>) -> Result<serde_json::Value,String> {
    if window.label()!="agent-worker" {return Err("Cloud task starts belong to the native execution worker".into());}
    let store=Arc::clone(store.inner());
    let (launch,token)=prepare(&app,&store,&execution_id,&call_id,&lease,true).await?;
    if let Some(receipt)=launch.receipt {return Ok(receipt);}
    if !launch.execute {
        return recover(&app,store,execution_id,call_id,lease).await?.ok_or_else(||"Original cloud launch remains unconfirmed; no second dispatch was permitted".into());
    }
    let service=Arc::clone(app.state::<Arc<CloudExecutionService>>().inner());
    match service.start_task_with_id(&token,launch.input,&launch.task_id).await {
        Ok(result)=>acknowledge(store,execution_id,call_id,lease,result).await,
        Err(error)=>{
          let owned=Arc::clone(&store);let id=execution_id.clone();let call=call_id.clone();let authority=lease.clone();let failure=error.clone();
          let saved=tauri::async_runtime::spawn_blocking(move||owned.record_native_cloud_launch_failure(&id,&call,&authority,&failure)).await;
          if !matches!(saved,Ok(Ok(()))) {eprintln!("Native cloud launch diagnostic could not be saved; original reservation retained");}
          match recover(&app,store,execution_id,call_id,lease).await {
            Ok(Some(receipt))=>Ok(receipt),
            Ok(None)=>Err(format!("{error}; original cloud outcome remains unknown; native task id retained, no redispatch")),
            Err(observation)=>Err(format!("{error}; cloud recovery GET could not confirm the original launch: {observation}; no redispatch")),
          }
        }
    }
}

#[tauri::command(rename_all="snake_case")]
pub async fn automation_background_cloud_reconcile(window:tauri::WebviewWindow,app:tauri::AppHandle,execution_id:String,call_id:String,lease:BackgroundExecutionLease,
    store:tauri::State<'_,Arc<AutomationStore>>) -> Result<Option<serde_json::Value>,String> {
    if window.label()!="agent-worker" {return Err("Cloud launch recovery belongs to the native execution worker".into());}
    recover(&app,Arc::clone(store.inner()),execution_id,call_id,lease).await
}

#[tauri::command(rename_all="snake_case")]
pub async fn automation_background_cloud_park(window:tauri::WebviewWindow,app:tauri::AppHandle,execution_id:String,call_id:String,lease:BackgroundExecutionLease,
    store:tauri::State<'_,Arc<AutomationStore>>) -> Result<bool,String> {
    if window.label()!="agent-worker" {return Err("Cloud parking belongs to its native worker".into());}
    let owned=Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move||owned.park_unconfirmed_background_cloud_start(&execution_id,&call_id,&lease,|conn,input|background_configuration_on_connection(&app,conn,input))).await.map_err(|e|e.to_string())?
}
