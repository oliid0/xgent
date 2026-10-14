use std::sync::Arc;
use tauri::Manager;
use crate::services::automation::{AutomationStore,BackgroundExecutionLease,BackgroundOutcomeReport};
use crate::services::cloud_execution::CloudExecutionService;
use crate::services::cloud_secret_vault::CloudSecretVault;
use super::cron::background_configuration_on_connection;

#[tauri::command(rename_all="snake_case")]
pub async fn automation_background_cloud_wait(window:tauri::WebviewWindow,app:tauri::AppHandle,execution_id:String,branch_id:String,call_id:String,reason:String,lease:BackgroundExecutionLease,
    store:tauri::State<'_,Arc<AutomationStore>>) -> Result<BackgroundOutcomeReport,String> {
    if window.label()!="agent-worker" {return Err("Cloud waits belong to the native execution worker".into());}
    let store=Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move||store.record_background_cloud_wait(&execution_id,&branch_id,&call_id,&reason,&lease,|conn,id| {
        AutomationStore::verify_background_configuration(conn,id,Some(&lease),|conn,input|background_configuration_on_connection(&app,conn,input)).map(|_|())
    })).await.map_err(|e|e.to_string())?
}

#[tauri::command(rename_all="snake_case")]
pub async fn automation_background_cloud_probe(window:tauri::WebviewWindow,app:tauri::AppHandle,execution_id:String,wait_id:String,call_id:String,
    store:tauri::State<'_,Arc<AutomationStore>>) -> Result<bool,String> {
    if window.label()!="agent-worker" {return Err("Cloud wait discovery belongs to its native worker".into());}
    let store=Arc::clone(store.inner());
    let before=Arc::clone(&store);let device=app.clone();let id=execution_id.clone();let wait=wait_id.clone();let call=call_id.clone();
    let (locator,token)=tauri::async_runtime::spawn_blocking(move|| {
        let locator=before.waiting_background_cloud_task(&id,&wait,&call,|conn,input|background_configuration_on_connection(&device,conn,input))?;
        let token=device.state::<Arc<CloudSecretVault>>().github_token()?;
        Ok::<_,String>((locator,token))
    }).await.map_err(|e|e.to_string())??;
    // GET-only, native vault access, native receipt-derived namespace. No
    // caller status, selected PC, model polling or dispatch/re-run endpoint.
    let status=app.state::<Arc<CloudExecutionService>>().task_status(&token,&locator).await?;
    tauri::async_runtime::spawn_blocking(move||store.wake_completed_background_cloud_task(&execution_id,&wait_id,&call_id,&status,|conn,input|background_configuration_on_connection(&app,conn,input)))
        .await.map_err(|e|e.to_string())?
}
