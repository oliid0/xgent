use std::sync::Arc;
use tauri::Manager;
use serde_json::{Value,json};
use crate::services::{automation::{AutomationStore,BackgroundExecutionLease,BackgroundOutcomeReport,store::{VideoInput,video_account}},video_generation};

#[tauri::command(rename_all="snake_case")]
pub async fn automation_video_models(window:tauri::WebviewWindow,app:tauri::AppHandle,execution_id:String,lease:BackgroundExecutionLease,provider_id:Option<String>,offset:Option<usize>)->Result<Value,String> {
    if window.label()!="agent-worker" {return Err("Video capabilities belong to the original native task worker".into());}
    let device=app.clone();let settings=tauri::async_runtime::spawn_blocking(move||super::cron::verified_background_execution_settings(&device,&execution_id,Some(&lease))).await.map_err(|e|e.to_string())??;
    if let Some(provider)=provider_id {
        let provider=video_account(&settings,&provider,None)?;let models=video_generation::catalog(&provider).await?;
        return Ok(json!({"models":models}));
    }
    if settings["intelligentSchedulingEnabled"]!=true {return Err("Intelligent scheduling was not accepted".into());}
    let providers=settings["delegationProviders"].as_array().filter(|items|items.len()<=4096).ok_or("Missing bounded configured video accounts")?;
    let accounts:Vec<_>=providers.iter().filter(|provider|provider["id"].as_str().is_some_and(|id|video_account(&settings,id,None).is_ok()))
        .map(|provider|json!({"providerId":provider["id"],"name":provider["name"].as_str().unwrap_or("").chars().take(128).collect::<String>()})).collect();
    let offset=offset.unwrap_or(0);if offset>accounts.len() {return Err("Video account page is out of bounds".into());}
    let end=(offset+20).min(accounts.len());Ok(json!({"accounts":&accounts[offset..end],"nextOffset":if end<accounts.len(){Some(end)}else{None}}))
}

#[tauri::command(rename_all="snake_case")]
pub async fn automation_video_start(window:tauri::WebviewWindow,app:tauri::AppHandle,execution_id:String,call_id:String,lease:BackgroundExecutionLease,input:VideoInput)->Result<Value,String> {
    if window.label()!="agent-worker" {return Err("Video generation belongs to the original native task worker".into());}
    let device=app.clone();let id=execution_id.clone();let captured=lease.clone();
    let rejected=|error:String|format!("video_preflight_rejected: {error}");
    let settings=tauri::async_runtime::spawn_blocking(move||super::cron::verified_background_execution_settings(&device,&id,Some(&captured))).await.map_err(|e|rejected(e.to_string()))?.map_err(rejected)?;
    let provider=video_account(&settings,&input.provider_id,Some(&input.model)).map_err(rejected)?;
    let body=video_generation::request_body(&input,&video_generation::catalog(&provider).await.map_err(rejected)?).map_err(rejected)?;
    let (client,headers)=video_generation::client(&provider).map_err(rejected)?;
    let owned=Arc::clone(app.state::<Arc<AutomationStore>>().inner());let device=app.clone();let id=execution_id.clone();let call=call_id.clone();let captured=lease.clone();
    let launch=tauri::async_runtime::spawn_blocking(move||owned.stage_video(&id,&call,&captured,input,|conn,input|super::cron::background_configuration_on_connection(&device,conn,input))).await.map_err(|e|rejected(e.to_string()))?
        .map_err(|error|if error.starts_with("video_submission_unconfirmed:") {error} else {rejected(error)})?;
    if let Some(receipt)=launch.receipt {return Ok(receipt);}
    let response=client.post(video_generation::endpoint(None,false)?).headers(headers).json(&body).send().await.map_err(|_|"video_submission_unconfirmed: original POST did not return")?;
    let value=video_generation::json_response(response).await.map_err(|_|"video_submission_unconfirmed: original POST did not return a valid acknowledgment")?;
    let job=value["id"].as_str().ok_or("video_submission_unconfirmed: job ID is missing")?.to_string();let status=value["status"].as_str().ok_or("video_submission_unconfirmed: status is missing")?.to_string();
    video_generation::endpoint(Some(&job),false).map_err(|_|"video_submission_unconfirmed: invalid job ID")?;
    let owned=Arc::clone(app.state::<Arc<AutomationStore>>().inner());
    tauri::async_runtime::spawn_blocking(move||owned.acknowledge_video(&execution_id,&call_id,&launch.nonce,&job,&status,&lease)).await.map_err(|_|"video_submission_unconfirmed: acknowledgment persistence did not settle")?
        .map_err(|_|"video_submission_unconfirmed: original acknowledgment could not be persisted".into())
}

#[tauri::command(rename_all="snake_case")]
pub async fn automation_video_result(window:tauri::WebviewWindow,app:tauri::AppHandle,execution_id:String,call_id:String,lease:BackgroundExecutionLease)->Result<Value,String> {
    if window.label()!="agent-worker" {return Err("Video results belong to the original native task worker".into());}
    let owned=Arc::clone(app.state::<Arc<AutomationStore>>().inner());
    tauri::async_runtime::spawn_blocking(move||owned.video_result(&execution_id,&call_id,&lease,|conn,input|super::cron::background_configuration_on_connection(&app,conn,input))).await.map_err(|e|e.to_string())?
}

#[tauri::command(rename_all="snake_case")]
pub async fn automation_video_wait(window:tauri::WebviewWindow,app:tauri::AppHandle,execution_id:String,branch_id:String,call_id:String,reason:String,lease:BackgroundExecutionLease)->Result<BackgroundOutcomeReport,String> {
    if window.label()!="agent-worker" {return Err("Video waits belong to the original native task worker".into());}
    let owned=Arc::clone(app.state::<Arc<AutomationStore>>().inner());
    tauri::async_runtime::spawn_blocking(move||owned.record_video_wait(&execution_id,&branch_id,&call_id,&reason,&lease,|conn,id|
        AutomationStore::verify_background_configuration(conn,id,Some(&lease),|conn,input|super::cron::background_configuration_on_connection(&app,conn,input)).map(|_|()))).await.map_err(|e|e.to_string())?
}
