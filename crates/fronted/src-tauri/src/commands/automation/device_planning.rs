use std::sync::Arc;
use serde_json::Value;
use crate::services::automation::{AutomationStore,BackgroundExecutionLease};

#[tauri::command(rename_all="snake_case")]
pub async fn automation_background_device_planning(app:tauri::AppHandle,execution_id:String,call_id:String,lease:BackgroundExecutionLease,
    store:tauri::State<'_,Arc<AutomationStore>>)->Result<Value,String>{
    let store=Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move||store.plan_original_device(&execution_id,&call_id,&lease,
        |conn,input|super::cron::background_configuration_on_connection(&app,conn,input))).await.map_err(|e|e.to_string())?
}
