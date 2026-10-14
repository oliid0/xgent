use std::sync::Arc;

use crate::services::automation::{
    validate_cron_expression, AutomationApplyInput, AutomationSnapshot, AutomationStore,
    CompletePromptRunInput, CronApplyResponse, CronRunNowResponse, CronRunRecord,
    HooksApplyResponse, PromptCompletionResponse, PromptRunRequest,
};

#[tauri::command(rename_all = "snake_case")]
pub async fn cron_validate_expression(expression: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || validate_cron_expression(&expression))
        .await
        .map_err(|e| format!("cron_validate_expression join 失败：{e}"))?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_snapshot(
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<AutomationSnapshot, String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.snapshot())
        .await
        .map_err(|e| format!("automation_snapshot join 失败：{e}"))?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_cron_apply(
    input: AutomationApplyInput,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<CronApplyResponse, String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.cron_apply(input))
        .await
        .map_err(|e| format!("automation_cron_apply join 失败：{e}"))?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_hooks_apply(
    input: AutomationApplyInput,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<HooksApplyResponse, String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.hooks_apply(input))
        .await
        .map_err(|e| format!("automation_hooks_apply join 失败：{e}"))?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_list_runs(
    task_id: String,
    limit: Option<usize>,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<Vec<CronRunRecord>, String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.list_runs(&task_id, limit.unwrap_or(100)))
        .await
        .map_err(|e| format!("automation_list_runs join 失败：{e}"))?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_clear_runs(
    task_id: String,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<usize, String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.clear_runs(&task_id))
        .await
        .map_err(|e| format!("automation_clear_runs join 失败：{e}"))?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_run_cron_now(
    task_id: String,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<CronRunNowResponse, String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.run_cron_task_now(&task_id))
        .await
        .map_err(|e| format!("automation_run_cron_now join 失败：{e}"))?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_claim_prompt_runs(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    limit: Option<usize>,
    worker_instance_id: Option<String>,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<Vec<PromptRunRequest>, String> {
    #[cfg(desktop)]
    if window.label() != "agent-worker" { return Err("Prompt leases belong to the execution host".to_string()); }
    #[cfg(mobile)]
    let _ = (window, app, worker_instance_id);
    let store = Arc::clone(store.inner());
    #[cfg(desktop)]
    {
        use tauri::Manager;
        let state = Arc::clone(app.state::<Arc<crate::services::agent_worker::AgentWorkerState>>().inner());
        return tauri::async_runtime::spawn_blocking(move || {
            state.require_instance(worker_instance_id.as_deref())?;
            store.claim_prompt_runs_for_worker(limit.unwrap_or(2),worker_instance_id.as_deref().unwrap_or_default())
        }).await.map_err(|e|format!("automation_claim_prompt_runs join 失败：{e}"))?;
    }
    #[cfg(mobile)]
    {
        tauri::async_runtime::spawn_blocking(move || store.claim_prompt_runs_with_limit(limit.unwrap_or(2)))
            .await
            .map_err(|e| format!("automation_claim_prompt_runs join 失败：{e}"))?
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_release_prompt_run(
    lease: Option<crate::services::automation::BackgroundExecutionLease>,
    window: tauri::WebviewWindow,
    execution_id: String,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<(), String> {
    #[cfg(desktop)]
    if window.label() != "agent-worker" { return Err("Prompt leases belong to the execution host".to_string()); }
    #[cfg(mobile)]
    let _ = window;
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.release_prompt_run(&execution_id, lease.as_ref()))
        .await
        .map_err(|e| format!("automation_release_prompt_run join 失败：{e}"))?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_complete_prompt_run(
    window: tauri::WebviewWindow,
    input: CompletePromptRunInput,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<PromptCompletionResponse, String> {
    #[cfg(desktop)]
    if window.label() != "agent-worker" { return Err("Prompt leases belong to the execution host".to_string()); }
    #[cfg(mobile)]
    let _ = window;
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.complete_prompt_run(input))
        .await
        .map_err(|e| format!("automation_complete_prompt_run join 失败：{e}"))?
}

#[cfg(desktop)]
pub(crate) fn background_host_info(app: &tauri::AppHandle) -> Result<crate::services::worker_peers::WorkerHostInfo, String> {
    use tauri::Manager;
    use serde_json::Value;
    use crate::services::worker_peers::{WorkerHostInfo, WorkerProvider, WorkerModelProfile};
    let store = app.state::<Arc<AutomationStore>>();
    let conn = crate::commands::settings::open_db()?;
    let snapshot = crate::commands::settings::load_local_access_settings_snapshot(&conn)?;
    let system = &snapshot["system"];
    let workdir = system.get("workdir").and_then(Value::as_str).unwrap_or_default().to_string();
    let agent_mode = matches!(system.get("executionMode").and_then(Value::as_str), Some("tools" | "agent-dev"));
    let allowed = snapshot["access"].get("blockedLocalCapabilities").and_then(Value::as_array).is_none_or(Vec::is_empty);
    let mut providers = Vec::new();
    let model_counts = store.background_model_queue_counts()?;
    for provider in snapshot["providers"].as_array().into_iter().flatten().take(128) {
        let configured = if provider.get("authMode").and_then(Value::as_str) == Some("oauth-managed") {
            provider.get("oauthAccountId").and_then(Value::as_str).is_some_and(|s| !s.trim().is_empty())
        } else { provider.get("apiKeyConfigured").and_then(Value::as_bool) == Some(true) };
        if !configured || provider.get("baseUrl").and_then(Value::as_str).is_none_or(|s| s.trim().is_empty()) { continue; }
        let active: Vec<&str> = provider.get("activeModels").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).collect();
        let models: Vec<String> = provider.get("models").and_then(Value::as_array).into_iter().flatten()
            .filter_map(|m| m.get("id").and_then(Value::as_str))
            .filter(|id| active.contains(id)).take(256).map(str::to_string).collect();
        let provider_id = provider.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
        let model_profiles = models.iter().map(|id| {
            let config = provider.get("models").and_then(Value::as_array).into_iter().flatten()
                .find(|model| model.get("id").and_then(Value::as_str) == Some(id.as_str()));
            let skills = config.map(crate::services::worker_inventory::configured_model_skills).unwrap_or_default();
            let (pending, running, waiting) = model_counts.get(&(provider_id.clone(), id.clone())).copied().unwrap_or_default();
            WorkerModelProfile { model: id.clone(), skills, background_pending: pending, background_running: running, background_waiting: waiting }
        }).collect();
        providers.push(WorkerProvider {
            id: provider_id,
            name: provider.get("name").and_then(Value::as_str).unwrap_or_default().to_string(),
            provider_type: provider.get("type").and_then(Value::as_str).unwrap_or_default().to_string(), models, model_profiles,
        });
    }
    let (pending, running) = store.background_queue_counts()?;
    let executor_ready = app.state::<Arc<crate::services::agent_worker::AgentWorkerState>>().ready();
    Ok(WorkerHostInfo {
        host_id: store.background_worker_identity()?, platform: std::env::consts::OS.to_string(),
        architecture: std::env::consts::ARCH.to_string(), executor_ready,
        accepts_background_tasks: executor_ready && agent_mode && allowed,
        workspace_available: std::path::Path::new(&workdir).is_absolute() && std::path::Path::new(&workdir).is_dir(),
        input_snapshot_version: 1,
        delegation_version: 1,
        child_tasks_version: 1,
        waiting_version: 1,
        inventory: if allowed { crate::services::worker_inventory::cached() } else { None },
        source_context_version: 2,
        goal_acceptance_version: 1,
        intelligent_scheduling_version: 1,
        model_routing_version: 1,
        budget_delegation_version: 1,
        budget_deadline_version: 1,
        source_routing_version: 2,
        device_channel_version: 1,
        device_actions_version: 1,
        result_delivery_version: 1,
        workdir, providers, pending, running, observed_at: crate::services::automation::db::now_ms(),
    })
}

#[cfg(desktop)]
#[tauri::command]
pub async fn automation_background_host_info(app: tauri::AppHandle) -> Result<crate::services::worker_peers::WorkerHostInfo, String> {
    let inspect = app.clone();
    let mut host = tauri::async_runtime::spawn_blocking(move || background_host_info(&inspect)).await.map_err(|e| e.to_string())??;
    host.inventory = Some(crate::services::worker_inventory::observe(host.accepts_background_tasks).await);
    Ok(host)
}

#[cfg(desktop)]
pub(crate) fn background_configuration_on_connection(
    app: &tauri::AppHandle, conn: &rusqlite::Connection,
    input: &crate::services::automation::SubmitBackgroundTaskInput,
) -> Result<(String, serde_json::Value), String> {
    use tauri::Manager;
    let settings = crate::commands::settings::load_background_execution_settings(conn, input)?;
    let mut material = crate::commands::settings::background_configuration_material(&settings, &input.model);
    let vault = app.state::<Arc<crate::services::cloud_secret_vault::CloudSecretVault>>();
    if settings["access"]["cloudExecutionEnabled"].as_bool() == Some(true) {
        // Cloud tools read the native vault, not settings.apiKey. Bind that
        // account credential too, without storing it in queue/context JSON.
        material["cloudCredential"] = vault.github_background_material()?;
    }
    let material = crate::commands::settings::canonical_background_value(material);
    let bytes = serde_json::to_vec(&material).map_err(|e| e.to_string())?;
    Ok((vault.background_configuration_binding(&bytes)?, settings))
}

#[cfg(desktop)]
pub(crate) fn verified_background_execution_settings(
    app: &tauri::AppHandle, execution_id: &str, lease: Option<&crate::services::automation::BackgroundExecutionLease>,
) -> Result<serde_json::Value, String> {
    use tauri::Manager;
    app.state::<Arc<AutomationStore>>().background_execution_settings(execution_id, lease, |conn, input|
        background_configuration_on_connection(app, conn, input))
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_execution_settings(
    window: tauri::WebviewWindow, app: tauri::AppHandle, execution_id: String, lease: Option<crate::services::automation::BackgroundExecutionLease>,
) -> Result<serde_json::Value, String> {
    if window.label() != "agent-worker" { return Err("Background configuration belongs to the execution host".to_string()); }
    tauri::async_runtime::spawn_blocking(move || verified_background_execution_settings(&app, &execution_id, lease.as_ref()))
        .await.map_err(|e| e.to_string())?
}

#[cfg(desktop)]
pub(crate) fn submit_background_on_host(
    app: &tauri::AppHandle,
    input: crate::services::automation::SubmitBackgroundTaskInput,
) -> Result<crate::services::automation::BackgroundTaskRecord, String> {
    submit_background_with_channel_on_host(app, input, None)
}

#[cfg(desktop)]
pub(crate) fn submit_background_with_channel_on_host(
    app: &tauri::AppHandle,
    mut input: crate::services::automation::SubmitBackgroundTaskInput,
    channel: Option<&crate::services::automation::BackgroundDeviceChannelProof>,
) -> Result<crate::services::automation::BackgroundTaskRecord, String> {
    use tauri::Manager;
    input.request_id = uuid::Uuid::parse_str(input.request_id.trim())
        .map_err(|_| "Background requestId must be a UUID".to_string())?.to_string();
    let store = app.state::<Arc<AutomationStore>>();
    // Return an existing receipt even after settings/worker availability changes.
    if store.background_task(&input.request_id).is_ok() {
        return store.submit_background_task_with_device_channel(input, channel, |_, _|
            Err("Existing background receipt could not be resolved; no replacement task was accepted".to_string()));
    }
    if !app.state::<Arc<crate::services::agent_worker::AgentWorkerState>>().ready() {
        return Err("Desktop background executor is not ready; no task was accepted".to_string());
    }
    if !std::path::Path::new(input.workdir.trim()).is_absolute() {
        return Err("Background workspace must be an absolute host path".to_string());
    }
    crate::runtime::task_runner::resolve_workdir(Some(input.workdir.clone()))?;
    if let Some(requirements) = &input.requirements {
        let host = background_host_info(app)?;
        if !host.accepts_background_tasks || !host.workspace_available { return Err("Task requirement admission is unavailable under the current host policy/workspace".into()); }
        requirements.check(&host.platform, host.inventory.as_ref(), crate::services::automation::db::now_ms())?;
    }
    store.submit_background_task_with_device_channel(input, channel, |conn, input|
        background_configuration_on_connection(app, conn, input).map(|(binding, _)| binding))
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_submit(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    input: crate::services::automation::SubmitBackgroundTaskInput,
) -> Result<crate::services::automation::BackgroundTaskRecord, String> {
    if window.label() == "agent-worker" {
        return Err("Background worker delegation must use a different paired worker".to_string());
    }
    if input.requirements.is_some() { automation_background_host_info(app.clone()).await?; }
    tauri::async_runtime::spawn_blocking(move || submit_background_on_host(&app, input))
        .await.map_err(|e| e.to_string())?
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_get(
    request_id: String,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<crate::services::automation::BackgroundTaskRecord, String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.background_task(&request_id)).await.map_err(|e| e.to_string())?
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_list(
    limit: Option<usize>,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<Vec<crate::services::automation::BackgroundTaskRecord>, String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.list_background_tasks(limit.unwrap_or(50))).await.map_err(|e| e.to_string())?
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_cancel(
    request_id: String,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<crate::services::automation::BackgroundTaskRecord, String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.cancel_background_task(&request_id)).await.map_err(|e| e.to_string())?
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub fn automation_background_host_heartbeat(
    window: tauri::WebviewWindow,
    running: Option<bool>,
    worker_instance_id: Option<String>,
    state: tauri::State<'_, Arc<crate::services::agent_worker::AgentWorkerState>>,
) -> Result<(), String> {
    if window.label() != "agent-worker" { return Err("Heartbeat requires the native execution host".to_string()); }
    state.heartbeat(worker_instance_id.as_deref(), running.unwrap_or(true))
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_publish_artifact(
    lease: Option<crate::services::automation::BackgroundExecutionLease>,
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    execution_id: String,
    path: String,
    expected_hash: Option<String>,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<crate::services::automation::BackgroundArtifact, String> {
    if window.label() != "agent-worker" { return Err("Artifact publication belongs to the execution host".to_string()); }
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || {
        verified_background_execution_settings(&app, &execution_id, lease.as_ref())?;
        store.publish_background_artifact(&execution_id, &path, expected_hash.as_deref(), lease.as_ref())
    })
        .await.map_err(|e| e.to_string())?
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_prepare_inputs(
    lease: Option<crate::services::automation::BackgroundExecutionLease>,
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    execution_id: String,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<Vec<crate::services::automation::BackgroundInputManifest>, String> {
    if window.label() != "agent-worker" { return Err("Input preparation belongs to the execution host".to_string()); }
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || {
        verified_background_execution_settings(&app, &execution_id, lease.as_ref())?;
        let (workdir, files) = store.background_inputs_for_execution(&execution_id, lease.as_ref())?;
        let mut manifest = Vec::new();
        for file in files {
            store.require_background_action_lease(&execution_id, lease.as_ref())?;
            verified_background_execution_settings(&app, &execution_id, lease.as_ref())?;
            let relative_path = format!(".xgent-background-inputs/{execution_id}/{}", file.name);
            let bytes = file.verified_bytes()?;
            crate::commands::fs::create_background_input_copy(&workdir, &relative_path, &bytes, &file.content_hash)?;
            manifest.push(crate::services::automation::BackgroundInputManifest { relative_path, content_hash: file.content_hash, bytes: file.bytes });
        }
        store.require_background_action_lease(&execution_id, lease.as_ref())?;
        Ok(manifest)
    }).await.map_err(|e| e.to_string())?
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_read_artifact(
    request_id: String,
    artifact_id: String,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<crate::services::automation::BackgroundArtifactContent, String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.read_background_artifact(&request_id, &artifact_id))
        .await.map_err(|e| e.to_string())?
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_read_artifact_chunk(
    request_id: String, artifact_id: String, offset: u64, length: usize,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<crate::services::automation::BackgroundArtifactChunk, String> {
    let store=Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.read_background_artifact_chunk(&request_id,&artifact_id,offset,length))
        .await.map_err(|e|e.to_string())?
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_execution_read_artifact(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    execution_id: String,
    artifact_id: String,
    lease: crate::services::automation::BackgroundExecutionLease,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<crate::services::automation::BackgroundArtifactContent, String> {
    if window.label() != "agent-worker" { return Err("Composition reads belong to the original native execution worker".into()); }
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.read_background_execution_artifact(
        &execution_id, &artifact_id, &lease,
        |conn, input| background_configuration_on_connection(&app, conn, input),
    )).await.map_err(|e| e.to_string())?
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_save_checkpoint(
    window: tauri::WebviewWindow,
    input: crate::services::automation::SaveBackgroundCheckpointInput,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<u64, String> {
    if window.label() != "agent-worker" { return Err("Checkpoint writes belong to the execution host".to_string()); }
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.save_background_checkpoint(input)).await.map_err(|e| e.to_string())?
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_restore_checkpoint(
    window: tauri::WebviewWindow, app: tauri::AppHandle, execution_id: String,
    lease: Option<crate::services::automation::BackgroundExecutionLease>,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<crate::services::automation::BackgroundResumeCheckpoint, String> {
    if window.label() != "agent-worker" { return Err("Checkpoint recovery belongs to the execution host".to_string()); }
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.restore_background_checkpoint(&execution_id, lease.as_ref(), |conn, execution_id| {
        AutomationStore::verify_background_configuration(conn, execution_id, lease.as_ref(), |conn, input|
            background_configuration_on_connection(&app, conn, input)).map(|_| ())
    })).await.map_err(|e| e.to_string())?
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_budget(
    window: tauri::WebviewWindow, app: tauri::AppHandle, execution_id: String,
    lease: crate::services::automation::BackgroundExecutionLease,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<crate::services::automation::store::BackgroundBudgetSnapshot, String> {
    if window.label() != "agent-worker" { return Err("Execution budget belongs to its worker".to_string()); }
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.background_budget(&execution_id, &lease, |conn| {
        AutomationStore::verify_background_configuration(conn, &execution_id, Some(&lease), |conn, input|
            background_configuration_on_connection(&app, conn, input)).map(|_| ())
    }, None).map(|receipt| receipt.budget)).await.map_err(|e| e.to_string())?
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_budget_consume(
    window: tauri::WebviewWindow, app: tauri::AppHandle, execution_id: String,
    lease: crate::services::automation::BackgroundExecutionLease,
    kind: crate::services::automation::store::BackgroundBudgetKind,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<crate::services::automation::store::BackgroundBudgetAdmission, String> {
    if window.label() != "agent-worker" { return Err("Execution budget belongs to its worker".to_string()); }
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.background_budget(&execution_id, &lease, |conn| {
        AutomationStore::verify_background_configuration(conn, &execution_id, Some(&lease), |conn, input|
            background_configuration_on_connection(&app, conn, input)).map(|_| ())
    }, Some(kind))).await.map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_result_sync(
    app: tauri::AppHandle,
    store: tauri::State<'_, Arc<AutomationStore>>,
    registry: tauri::State<'_, Arc<crate::services::worker_peers::WorkerPeerRegistry>>,
) -> Result<crate::services::automation::BackgroundInboxSync, String> {
    sync_background_results(app, Arc::clone(store.inner()), Arc::clone(registry.inner())).await
}

/// Native startup and the manual command share the original durable delivery path.
/// Only retained submission/response intents may cause an effect; watches use GET.
pub(crate) async fn sync_background_results(
    app: tauri::AppHandle,
    store: Arc<AutomationStore>,
    registry: Arc<crate::services::worker_peers::WorkerPeerRegistry>,
) -> Result<crate::services::automation::BackgroundInboxSync, String> {
    use futures_util::{stream, StreamExt};
    let requests = registry.result_requests().await;
    let prepare = Arc::clone(&store);
    let (host, watches, responses, submissions) = tauri::async_runtime::spawn_blocking(move || {
        prepare.register_result_requests(&requests)?;
        Ok::<_, String>((prepare.background_worker_identity()?, prepare.claim_result_watches()?, prepare.claim_received_responses(None)?, prepare.claim_background_submissions(None)?))
    }).await.map_err(|e| e.to_string())??;
    let submissions: Vec<Result<bool, String>> = stream::iter(submissions).map(|pending| {
        let app = app.clone(); let store = Arc::clone(&store); let registry = Arc::clone(&registry);
        async move { super::submission::deliver(app, store, registry, pending).await.map(|_| false) }
    }).buffer_unordered(2).collect().await;
    let responses: Vec<Result<bool, String>> = stream::iter(responses).map(|response| {
        let app = app.clone(); let store = Arc::clone(&store); let registry = Arc::clone(&registry);
        async move { deliver_received_response(app, store, registry, response).await.map(|_| false) }
    }).buffer_unordered(2).collect().await;
    let mut results: Vec<Result<bool, String>> = stream::iter(watches).map(|watch| {
        let store = Arc::clone(&store);
        let registry = Arc::clone(&registry);
        let local = watch.source_host_id == host;
        async move {
            let snapshot = if local {
                let read = Arc::clone(&store);
                let request = watch.request_id.clone();
                tauri::async_runtime::spawn_blocking(move || serde_json::to_value(read.background_task(&request)?).map_err(|e| e.to_string())).await.map_err(|e| e.to_string())??
            } else {
                registry.invoke(&watch.source_host_id, "automation_background_get", serde_json::json!({"request_id": watch.request_id})).await?
            };
            tauri::async_runtime::spawn_blocking(move || store.receive_background_result(&watch, snapshot)).await.map_err(|e| e.to_string())?
        }
    }).buffer_unordered(4).collect().await;
    results.extend(responses);
    results.extend(submissions);
    Ok(crate::services::automation::BackgroundInboxSync {
        inspected: results.len(), received: results.iter().filter(|result| matches!(result, Ok(true))).count(),
        unresolved: results.iter().filter(|result| result.is_err()).count(),
    })
}

async fn deliver_received_response(app: tauri::AppHandle, store: Arc<AutomationStore>,
    registry: Arc<crate::services::worker_peers::WorkerPeerRegistry>,
    delivery: crate::services::automation::BackgroundResultResponse,
) -> Result<serde_json::Value, String> {
    let local = store.background_worker_identity()? == delivery.source_host_id;
    let actual = if local {
        #[cfg(desktop)] {
            let input = delivery.input.clone();
            tauri::async_runtime::spawn_blocking(move || serde_json::to_value(resume_background_on_host(&app, input)?).map_err(|e| e.to_string()))
                .await.map_err(|e| e.to_string())??
        }
        #[cfg(mobile)] { let _ = app; return Err("This mobile device has no persistent desktop executor".into()); }
    } else {
        registry.invoke(&delivery.source_host_id, "automation_background_resume",
            serde_json::json!({"request_id": delivery.input.request_id, "input": delivery.input})).await?
    };
    tauri::async_runtime::spawn_blocking(move || {
        let watch = crate::services::automation::BackgroundResultWatch { source_host_id: delivery.source_host_id.clone(), request_id: delivery.input.request_id.clone() };
        store.receive_background_result(&watch, actual.clone())?;
        store.complete_received_response(&delivery, &actual)?;
        Ok(actual)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_result_resume(app: tauri::AppHandle, entry_id: String, response: String,
    store: tauri::State<'_, Arc<AutomationStore>>,
    registry: tauri::State<'_, Arc<crate::services::worker_peers::WorkerPeerRegistry>>,
) -> Result<serde_json::Value, String> {
    let store = Arc::clone(store.inner()); let stage = Arc::clone(&store);
    let delivery = tauri::async_runtime::spawn_blocking(move || stage.stage_received_response(&entry_id, &response))
        .await.map_err(|e| e.to_string())??;
    if let Some(result) = delivery.result { return Ok(result); }
    let reserve = Arc::clone(&store); let resume_id = delivery.input.resume_id.clone();
    let mut claimed = tauri::async_runtime::spawn_blocking(move || reserve.claim_received_responses(Some(&resume_id)))
        .await.map_err(|e| e.to_string())??;
    if let Some(delivery) = claimed.pop() {
        deliver_received_response(app, store, Arc::clone(registry.inner()), delivery).await
    } else {
        Err("Response is saved and awaiting its original delivery/backoff; synchronize to recover its receipt".into())
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_result_response_state(entry_id: String,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<Option<crate::services::automation::BackgroundResultResponse>, String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.received_response_for_entry(&entry_id)).await.map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_result_current(entry_id: String,
    store: tauri::State<'_, Arc<AutomationStore>>,
    registry: tauri::State<'_, Arc<crate::services::worker_peers::WorkerPeerRegistry>>,
) -> Result<serde_json::Value, String> {
    let store = Arc::clone(store.inner()); let source = Arc::clone(&store);
    let (host, watch) = tauri::async_runtime::spawn_blocking(move || {
        let (watch, _) = source.received_task_source(&entry_id)?;
        Ok::<_, String>((source.background_worker_identity()?, watch))
    }).await.map_err(|e| e.to_string())??;
    let actual = if host == watch.source_host_id {
        let read = Arc::clone(&store); let request = watch.request_id.clone();
        tauri::async_runtime::spawn_blocking(move || serde_json::to_value(read.background_task(&request)?).map_err(|e| e.to_string()))
            .await.map_err(|e| e.to_string())??
    } else {
        registry.invoke(&watch.source_host_id, "automation_background_get", serde_json::json!({"request_id": watch.request_id})).await?
    };
    tauri::async_runtime::spawn_blocking(move || {
        store.receive_background_result(&watch, actual.clone())?;
        Ok(actual)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_result_list(cursor: u64, limit: usize, unread_only: bool,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<crate::services::automation::BackgroundInboxPage, String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.list_background_inbox(cursor, limit, unread_only)).await.map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_result_read(entry_id: String, offset: usize, store: tauri::State<'_, Arc<AutomationStore>>) -> Result<crate::services::automation::BackgroundInboxChunk, String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.read_background_inbox(&entry_id, offset)).await.map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_result_notify(entry_id: String, app: tauri::AppHandle,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<String, String> {
    deliver_background_result_notification(entry_id, app, Arc::clone(store.inner())).await
}

pub(crate) async fn deliver_background_result_notification(entry_id: String, app: tauri::AppHandle,
    store: Arc<AutomationStore>,
) -> Result<String, String> {
    #[cfg(desktop)]
    { let _ = (entry_id, app, store); Ok("unavailable".into()) }
    #[cfg(mobile)]
    {
        use tauri_plugin_mobile_assistant::{MobileAssistantExt, ResultNotificationReceipt, ResultNotificationRequest};
        tauri::async_runtime::spawn_blocking(move || {
            let status = store.background_inbox_notification_status(&entry_id)?;
            if status != "ready" { return Ok(status); }
            let request = ResultNotificationRequest { entry_id: entry_id.clone() };
            match app.mobile_assistant().post_result_notification(request.clone()).map_err(|e| e.to_string())? {
                ResultNotificationReceipt::Blocked => Ok("blocked".into()),
                ResultNotificationReceipt::Accepted => {
                    store.record_background_notification_accepted(&entry_id)?;
                    // A read/superseding receipt may have arrived during OS IPC.
                    if store.background_inbox_notification_status(&entry_id)? == "obsolete" {
                        app.mobile_assistant().remove_result_notification(request).map_err(|e| e.to_string())?;
                        return Ok("obsolete".into());
                    }
                    Ok("accepted".into())
                }
            }
        }).await.map_err(|e| e.to_string())?
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_result_ack(entry_id: String, app: tauri::AppHandle, store: tauri::State<'_, Arc<AutomationStore>>) -> Result<(), String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || {
        store.acknowledge_background_inbox(&entry_id)?;
        #[cfg(mobile)]
        {
            use tauri_plugin_mobile_assistant::{MobileAssistantExt, ResultNotificationRequest};
            if let Err(error) = app.mobile_assistant().remove_result_notification(ResultNotificationRequest { entry_id }) {
                eprintln!("Result notice withdrawal failed: {error}");
            }
        }
        #[cfg(desktop)]
        let _ = app;
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_result_artifact(entry_id: String, artifact_id: String,
    store: tauri::State<'_, Arc<AutomationStore>>,
    registry: tauri::State<'_, Arc<crate::services::worker_peers::WorkerPeerRegistry>>,
) -> Result<serde_json::Value, String> {
    read_received_artifact(entry_id, artifact_id, Arc::clone(store.inner()), Arc::clone(registry.inner())).await
}

pub(crate) async fn read_received_artifact(entry_id: String, artifact_id: String,
    store: Arc<AutomationStore>,
    registry: Arc<crate::services::worker_peers::WorkerPeerRegistry>,
) -> Result<serde_json::Value, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use sha2::{Digest, Sha256};
    let read = Arc::clone(&store);
    let artifact_key = artifact_id.clone();
    let (host, watch, expected) = tauri::async_runtime::spawn_blocking(move || {
        let (watch, expected) = read.background_inbox_artifact_source(&entry_id, &artifact_key)?;
        Ok::<_, String>((read.background_worker_identity()?, watch, expected))
    }).await.map_err(|e| e.to_string())??;
    let actual = if watch.source_host_id == host {
        tauri::async_runtime::spawn_blocking(move || serde_json::to_value(store.read_background_artifact(&watch.request_id, &artifact_id)?).map_err(|e| e.to_string()))
            .await.map_err(|e| e.to_string())??
    } else {
        registry.invoke(&watch.source_host_id, "automation_background_read_artifact",
            serde_json::json!({"request_id": watch.request_id, "artifact_id": artifact_id})).await?
    };
    if actual["artifact"] != expected { return Err("Artifact differs from the immutable received manifest".into()); }
    let encoded = actual["contentBase64"].as_str().filter(|value| value.len() <= 8 * 1024 * 1024 * 4 / 3 + 4)
        .ok_or_else(|| "Artifact content exceeds its bound".to_string())?;
    let bytes = STANDARD.decode(encoded).map_err(|e| e.to_string())?;
    if bytes.len() > 8 * 1024 * 1024 || expected["bytes"].as_u64() != Some(bytes.len() as u64)
        || expected["contentHash"].as_str() != Some(format!("{:x}", Sha256::digest(&bytes)).as_str()) {
        return Err("Artifact bytes failed received-manifest integrity verification".into());
    }
    Ok(actual)
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_outcomes(
    window: tauri::WebviewWindow, execution_id: String,
    lease: Option<crate::services::automation::BackgroundExecutionLease>,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<Option<crate::services::automation::BackgroundOutcomeReport>, String> {
    if window.label() != "agent-worker" { return Err("Outcome execution state belongs to its worker".to_string()); }
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.read_background_outcomes(&execution_id, lease.as_ref())).await.map_err(|e| e.to_string())?
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_wait(
    window: tauri::WebviewWindow, input: crate::services::automation::WaitBackgroundTaskInput,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<Option<crate::services::automation::BackgroundWaitRecord>, String> {
    if window.label() != "agent-worker" { return Err("Waiting state belongs to its worker".into()); }
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.wait_background_task(input)).await.map_err(|e| e.to_string())?
}

#[cfg(desktop)]
#[tauri::command]
pub async fn automation_background_due_waits(
    window: tauri::WebviewWindow, store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<Vec<crate::services::automation::BackgroundWaitingTask>, String> {
    if window.label() != "agent-worker" { return Err("Wait discovery belongs to its worker".into()); }
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.due_background_waits()).await.map_err(|e| e.to_string())?
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_defer_wait(
    window: tauri::WebviewWindow, execution_id: String, wait_id: String,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<(), String> {
    if window.label() != "agent-worker" { return Err("Wait discovery belongs to its worker".into()); }
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.defer_background_wait(&execution_id, &wait_id)).await.map_err(|e| e.to_string())?
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_waiting_settings(
    window: tauri::WebviewWindow, app: tauri::AppHandle, execution_id: String, wait_id: String,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<serde_json::Value, String> {
    if window.label() != "agent-worker" { return Err("Wait configuration belongs to its worker".into()); }
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.waiting_background_settings(&execution_id, &wait_id, |conn, input|
        background_configuration_on_connection(&app, conn, input))).await.map_err(|e| e.to_string())?
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_wake_ready(
    window: tauri::WebviewWindow, app: tauri::AppHandle, execution_id: String, wait_id: String, tools: Vec<String>,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<bool, String> {
    if window.label() != "agent-worker" { return Err("Wait resumption belongs to its worker".into()); }
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.wake_ready_background_task(&execution_id, &wait_id, &tools, |conn, input|
        background_configuration_on_connection(&app, conn, input))).await.map_err(|e| e.to_string())?
}

#[cfg(desktop)]
pub(crate) fn resume_background_on_host(app: &tauri::AppHandle, input: crate::services::automation::ResumeBackgroundTaskInput) -> Result<crate::services::automation::BackgroundTaskRecord, String> {
    use tauri::Manager;
    let store = app.state::<Arc<AutomationStore>>();
    store.resume_background_task(input, |conn, input| background_configuration_on_connection(app, conn, input))
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_resume(app: tauri::AppHandle, input: crate::services::automation::ResumeBackgroundTaskInput) -> Result<crate::services::automation::BackgroundTaskRecord, String> {
    tauri::async_runtime::spawn_blocking(move || resume_background_on_host(&app, input)).await.map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_resume_receipt(input: crate::services::automation::ResumeBackgroundTaskInput,
    store: tauri::State<'_,Arc<AutomationStore>>) -> Result<Option<serde_json::Value>,String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.background_resume_receipt(&input)).await.map_err(|e|e.to_string())?
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_evidence_options(
    window: tauri::WebviewWindow, execution_id: String, cursor: Option<i64>,
    lease: Option<crate::services::automation::BackgroundExecutionLease>,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<serde_json::Value, String> {
    if window.label() != "agent-worker" { return Err("Outcome evidence belongs to its worker".to_string()); }
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.background_evidence_options(&execution_id, lease.as_ref(), cursor.unwrap_or(0))).await.map_err(|e| e.to_string())?
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_save_plan(
    window: tauri::WebviewWindow, app: tauri::AppHandle,
    input: crate::services::automation::SaveBackgroundPlanInput,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<crate::services::automation::BackgroundOutcomeReport, String> {
    if window.label() != "agent-worker" { return Err("Outcome planning belongs to its worker".to_string()); }
    let store = Arc::clone(store.inner());
    let lease = input.lease.clone();
    tauri::async_runtime::spawn_blocking(move || store.save_background_plan(input, |conn, execution_id| {
        AutomationStore::verify_background_configuration(conn, execution_id, lease.as_ref(), |conn, input|
            background_configuration_on_connection(&app, conn, input)).map(|_| ())
    })).await.map_err(|e| e.to_string())?
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_resolve_plan(
    window: tauri::WebviewWindow, app: tauri::AppHandle, input: crate::services::automation::SaveBackgroundPlanInput, tools: Vec<String>,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<crate::services::automation::BackgroundOutcomeReport, String> {
    if window.label() != "agent-worker" { return Err("Capability criteria belong to their worker".into()); }
    let store = Arc::clone(store.inner());
    let lease = input.lease.clone();
    tauri::async_runtime::spawn_blocking(move || store.resolve_background_plan(input, &tools, |conn, id| {
        AutomationStore::verify_background_configuration(conn, id, lease.as_ref(), |conn, input| background_configuration_on_connection(&app, conn, input)).map(|_| ())
    })).await.map_err(|e| e.to_string())?
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_record_outcome(
    window: tauri::WebviewWindow, app: tauri::AppHandle,
    input: crate::services::automation::RecordBackgroundOutcomeInput,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<crate::services::automation::BackgroundOutcomeReport, String> {
    if window.label() != "agent-worker" { return Err("Outcome evidence belongs to its worker".to_string()); }
    let store = Arc::clone(store.inner());
    let lease = input.lease.clone();
    tauri::async_runtime::spawn_blocking(move || store.record_background_outcome(input, |conn, execution_id| {
        AutomationStore::verify_background_configuration(conn, execution_id, lease.as_ref(), |conn, input|
            background_configuration_on_connection(&app, conn, input)).map(|_| ())
    })).await.map_err(|e| e.to_string())?
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_compact_context(
    window: tauri::WebviewWindow, app: tauri::AppHandle,
    input: crate::services::automation::CompactBackgroundContextInput,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<u64, String> {
    if window.label() != "agent-worker" { return Err("Context compaction belongs to the execution host".to_string()); }
    let store = Arc::clone(store.inner());
    let lease = input.lease.clone();
    tauri::async_runtime::spawn_blocking(move || store.compact_background_context(input, |conn, execution_id| {
        AutomationStore::verify_background_configuration(conn, execution_id, lease.as_ref(), |conn, input|
            background_configuration_on_connection(&app, conn, input)).map(|_| ())
    })).await.map_err(|e| e.to_string())?
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_compactions(
    lease: Option<crate::services::automation::BackgroundExecutionLease>,
    window: tauri::WebviewWindow, execution_id: String, cursor: Option<u64>,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<crate::services::automation::BackgroundCompactionPage, String> {
    if window.label() != "agent-worker" { return Err("Context archives belong to the execution host".to_string()); }
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.list_background_compactions(&execution_id, cursor.unwrap_or(0), lease.as_ref()))
        .await.map_err(|e| e.to_string())?
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_read_context_archive(
    lease: Option<crate::services::automation::BackgroundExecutionLease>,
    window: tauri::WebviewWindow, execution_id: String, source_revision: u64, offset: Option<usize>,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<crate::services::automation::BackgroundContextArchiveChunk, String> {
    if window.label() != "agent-worker" { return Err("Context archives belong to the execution host".to_string()); }
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.read_background_context_archive(&execution_id, source_revision, offset.unwrap_or(0), lease.as_ref()))
        .await.map_err(|e| e.to_string())?
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_source_context(
    lease: Option<crate::services::automation::BackgroundExecutionLease>,
    window: tauri::WebviewWindow, app: tauri::AppHandle, execution_id: String,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<Option<crate::services::automation::BackgroundSourceContext>, String> {
    if window.label() != "agent-worker" { return Err("Source conversation belongs to the execution host".into()); }
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || {
        verified_background_execution_settings(&app, &execution_id, lease.as_ref())?;
        store.load_background_source_context(&execution_id, lease.as_ref())
    }).await.map_err(|e| e.to_string())?
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_begin_operation(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    input: crate::services::automation::BeginBackgroundOperationInput,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<crate::services::automation::BeginBackgroundOperationResponse, String> {
    if window.label() != "agent-worker" { return Err("Operation intents belong to the execution host".to_string()); }
    let store = Arc::clone(store.inner());
    let lease = input.lease.clone();
    tauri::async_runtime::spawn_blocking(move || store.begin_background_operation_with_configuration(input, |conn, execution_id| {
        AutomationStore::verify_background_configuration(conn, execution_id, lease.as_ref(), |conn, input|
            background_configuration_on_connection(&app, conn, input)).map(|_| ())
    })).await.map_err(|e| e.to_string())?
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_complete_operation(
    window: tauri::WebviewWindow,
    input: crate::services::automation::CompleteBackgroundOperationInput,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<(), String> {
    if window.label() != "agent-worker" { return Err("Operation receipts belong to the execution host".to_string()); }
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.complete_background_operation(input)).await.map_err(|e| e.to_string())?
}

#[cfg(desktop)]
#[tauri::command(rename_all = "snake_case")]
pub async fn automation_background_operations(
    request_id: String, cursor: Option<i64>, limit: Option<usize>,
    store: tauri::State<'_, Arc<AutomationStore>>,
) -> Result<crate::services::automation::BackgroundOperationPage, String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.list_background_operations(&request_id, cursor.unwrap_or(0), limit.unwrap_or(10)))
        .await.map_err(|e| e.to_string())?
}
