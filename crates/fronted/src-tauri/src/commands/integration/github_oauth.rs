use std::sync::Arc;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;
use crate::services::github_oauth::{GitHubAuthorizationService,GitHubAuthorizationStatus,VERIFICATION_URL};

fn local(window:&tauri::WebviewWindow,app:&tauri::AppHandle)->Result<Arc<GitHubAuthorizationService>,String> {
    if window.label()!="main" {return Err("github-oauth-local-only".into());}
    app.try_state::<Arc<GitHubAuthorizationService>>().map(|state|Arc::clone(state.inner())).ok_or_else(||"github-oauth-unavailable".into())
}
#[tauri::command]
pub fn github_oauth_status(window:tauri::WebviewWindow,app:tauri::AppHandle)->Result<GitHubAuthorizationStatus,String> {
    local(&window,&app)?.status()
}
#[tauri::command]
pub async fn github_oauth_start(window:tauri::WebviewWindow,app:tauri::AppHandle,client_id:String)->Result<GitHubAuthorizationStatus,String> {
    local(&window,&app)?.start(&client_id).await
}
#[tauri::command]
pub fn github_oauth_cancel(window:tauri::WebviewWindow,app:tauri::AppHandle,flow_id:String)->Result<GitHubAuthorizationStatus,String> {
    let service=local(&window,&app)?;service.cancel(&flow_id)?;service.status()
}
#[tauri::command]
pub fn github_oauth_open(window:tauri::WebviewWindow,app:tauri::AppHandle,flow_id:String)->Result<(),String> {
    local(&window,&app)?.can_open(&flow_id)?;
    app.opener().open_url(VERIFICATION_URL,None::<&str>).map_err(|_|"github-oauth-open".into())
}
