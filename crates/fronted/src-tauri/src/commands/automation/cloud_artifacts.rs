use std::sync::Arc;
use tauri::Manager;
use crate::services::automation::{AutomationStore,BackgroundExecutionLease};
use crate::services::cloud_execution::CloudExecutionService;
use crate::services::cloud_secret_vault::CloudSecretVault;
use super::cron::background_configuration_on_connection;

#[tauri::command(rename_all="snake_case")]
pub async fn automation_background_cloud_import_artifact(window:tauri::WebviewWindow,app:tauri::AppHandle,execution_id:String,call_id:String,cloud_call_id:String,lease:BackgroundExecutionLease,
    store:tauri::State<'_,Arc<AutomationStore>>)->Result<serde_json::Value,String>{
    if window.label()!="agent-worker" {return Err("Cloud artifact imports belong to the original native execution worker".into());}
    let owned=Arc::clone(store.inner());let device=app.clone();let id=execution_id.clone();let call=call_id.clone();let cloud=cloud_call_id.clone();let captured=lease.clone();
    let source=tauri::async_runtime::spawn_blocking(move||owned.prepare_background_cloud_artifact(&id,&call,&cloud,&captured,|conn,input|background_configuration_on_connection(&device,conn,input))).await.map_err(|error|error.to_string())??;
    // An acknowledged/local snapshot is independent of GitHub retention and
    // never re-downloads or redispatches a job to recover a lost local ACK.
    if let Some(receipt)=&source.receipt {return Ok(receipt.clone());}
    let token=app.state::<Arc<CloudSecretVault>>().github_token()?;
    let downloaded=app.state::<Arc<CloudExecutionService>>().download_artifact(&token,&source.locator,None,false).await?;
    let owned=Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move||{
        let mut zip=crate::services::cloud_artifacts::open_archive(std::path::Path::new(&downloaded.local_path))?;
        let mut entry=zip.by_name(&source.entry_path).map_err(|_|"Requested entry is absent from the original cloud archive".to_string())?;
        if entry.is_dir(){return Err("Cloud import needs an actual file entry".into());}
        let bytes=entry.size();
        owned.import_background_cloud_artifact(&execution_id,&call_id,&cloud_call_id,&source,&lease,&downloaded,bytes,&mut entry,|conn,input|background_configuration_on_connection(&app,conn,input))
    }).await.map_err(|error|error.to_string())?
}
