use std::sync::Arc;
use tauri::Manager;
use crate::services::automation::{store::{GoalApplyInput, GoalSnapshot, GoalActivityCursor, GoalActivityPage, GoalArtifactsPage}, AutomationStore, BackgroundArtifactContent};

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_goal_snapshot(store: tauri::State<'_, Arc<AutomationStore>>) -> Result<GoalSnapshot, String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.goal_snapshot()).await.map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_goal_apply(input: GoalApplyInput, store: tauri::State<'_, Arc<AutomationStore>>) -> Result<GoalSnapshot, String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.goal_apply(input)).await.map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_goal_activity(goal_id: String, cursor: Option<GoalActivityCursor>, limit: u32, store: tauri::State<'_, Arc<AutomationStore>>) -> Result<GoalActivityPage, String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.goal_activity(&goal_id, cursor, limit)).await.map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_goal_artifacts(goal_id: String, cursor: Option<GoalActivityCursor>, limit: u32, store: tauri::State<'_, Arc<AutomationStore>>) -> Result<GoalArtifactsPage, String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.goal_artifacts(&goal_id, cursor, limit)).await.map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_goal_artifact_content(app: tauri::AppHandle, goal_id: String, request_id: String, artifact_id: String, store: tauri::State<'_, Arc<AutomationStore>>) -> Result<BackgroundArtifactContent, String> {
    let store = Arc::clone(store.inner());
    let read = Arc::clone(&store);
    let goal = goal_id.clone(); let request = request_id.clone(); let artifact = artifact_id.clone();
    let remote = tauri::async_runtime::spawn_blocking(move || read.goal_remote_artifact_entry(&goal, &request, &artifact))
        .await.map_err(|e| e.to_string())??;
    if let Some(entry) = remote {
        let registry = app.try_state::<Arc<crate::services::worker_peers::WorkerPeerRegistry>>()
            .ok_or("Original Goal execution host is unavailable")?;
        let actual = super::cron::read_received_artifact(entry.clone(), artifact_id.clone(), Arc::clone(&store), Arc::clone(registry.inner())).await?;
        let verified = tauri::async_runtime::spawn_blocking(move || {
            if store.goal_remote_artifact_entry(&goal_id, &request_id, &artifact_id)? != Some(entry) {
                return Err("goals.artifactChanged".to_string());
            }
            serde_json::from_value(actual).map_err(|e| e.to_string())
        }).await.map_err(|e| e.to_string())??;
        return Ok(verified);
    }
    tauri::async_runtime::spawn_blocking(move || store.goal_artifact_content(&goal_id, &request_id, &artifact_id)).await.map_err(|e| e.to_string())?
}
