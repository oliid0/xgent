#[tauri::command]
pub async fn settings_load_all() -> Result<SettingsLoadResponse, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let conn = open_db()?;
        let default_workdir = default_project_workdir()?;
        Ok(SettingsLoadResponse {
            providers: load_providers(&conn)?,
            system: Some(load_system_with_defaults(&conn, &default_workdir)?),
            mcp: load_mcp(&conn)?,
            agents: load_agents(&conn)?,
            ssh: load_ssh(&conn)?,
            access: load_access(&conn)?,
            #[cfg(desktop)]
            stt: load_stt_redacted(&conn)?,
            memory: load_memory(&conn)?,
            model_failover: load_model_failover(&conn)?,
            default_workdir,
        })
    })
    .await
    .map_err(|e| format!("settings_load_all join 失败：{e}"))?
}

#[tauri::command]
#[cfg(desktop)]
pub async fn settings_save_access(
    payload: Value,
    local_access_controller: tauri::State<'_, Arc<crate::services::local_access::LocalAccessController>>,
) -> Result<(), String> {
    let normalized = parse_access_settings_payload(payload)?;
    let persisted = serde_json::to_value(&normalized)
        .map_err(|error| format!("serialize {ACCESS_SETTINGS_TABLE} failed: {error}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db()?;
        save_access(&mut conn, persisted)
    })
    .await
    .map_err(|error| format!("settings_save_access join failed: {error}"))??;
    local_access_controller.apply_config(normalized)
}

#[tauri::command]
#[cfg(mobile)]
pub async fn settings_save_access(payload: Value) -> Result<(), String> {
    let normalized = parse_access_settings_payload(payload)?;
    let persisted = serde_json::to_value(&normalized)
        .map_err(|error| format!("serialize {ACCESS_SETTINGS_TABLE} failed: {error}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db()?;
        save_access(&mut conn, persisted)
    })
    .await
    .map_err(|error| format!("settings_save_access join failed: {error}"))?
}

#[tauri::command]
pub async fn settings_save_providers(payload: Value) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db()?;
        save_providers(&mut conn, payload)
    })
    .await
    .map_err(|e| format!("settings_save_providers join 失败：{e}"))?
}

#[tauri::command]
#[cfg(desktop)]
pub async fn settings_save_system(
    payload: Value,
    automation_scheduler: tauri::State<'_, Arc<AutomationScheduler>>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db()?;
        save_system(&mut conn, payload)?;
        // 保存成功后刷新全局代理状态，让 shell env 注入与出网代理即时生效。
        refresh_system_proxy_state(&conn)
    })
    .await
    .map_err(|e| format!("settings_save_system join 失败：{e}"))??;
    // Bash cron tasks execute in the system workdir; reschedule so the new
    // workdir takes effect without an app restart.
    automation_scheduler.request_reload();
    Ok(())
}

#[tauri::command]
#[cfg(mobile)]
pub async fn settings_save_system(payload: Value) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db()?;
        save_system(&mut conn, payload)?;
        refresh_system_proxy_state(&conn)
    })
    .await
    .map_err(|error| format!("settings_save_system join failed: {error}"))?
}

#[tauri::command]
pub async fn settings_save_mcp(payload: Value) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db()?;
        save_mcp(&mut conn, payload)
    })
    .await
    .map_err(|e| format!("settings_save_mcp join 失败：{e}"))?
}

#[tauri::command]
pub async fn settings_save_memory(payload: Value) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db()?;
        save_memory(&mut conn, payload)
    })
    .await
    .map_err(|e| format!("settings_save_memory join 失败：{e}"))?
}

#[tauri::command]
pub async fn settings_save_model_failover(payload: Value) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db()?;
        save_model_failover(&mut conn, payload)
    })
    .await
    .map_err(|e| format!("settings_save_model_failover join 失败：{e}"))?
}

#[tauri::command]
#[cfg(desktop)]
pub async fn settings_save_stt(payload: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db()?;
        save_stt(&mut conn, payload)?;
        load_stt_redacted(&conn).map(|value| value.unwrap_or_else(|| json!({})))
    })
    .await
    .map_err(|e| format!("settings_save_stt join failed: {e}"))?
}

#[tauri::command]
#[cfg(desktop)]
pub async fn settings_reveal_stt_secret(
    provider: String,
    field: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db()?;
        load_stt_secret(&conn, &provider, &field)
    })
    .await
    .map_err(|e| format!("settings_reveal_stt_secret join failed: {e}"))?
}

#[tauri::command]
pub async fn settings_save_agents(payload: Value) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db()?;
        save_agents(&mut conn, payload)
    })
    .await
    .map_err(|e| format!("settings_save_agents join 失败：{e}"))?
}

#[tauri::command]
pub async fn settings_save_ssh(payload: Value) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db()?;
        save_ssh(&mut conn, payload)
    })
    .await
    .map_err(|e| format!("settings_save_ssh join 失败：{e}"))?
}

#[tauri::command]
pub async fn settings_apply_ssh_patch(payload: Value) -> Result<SshPatchApplyResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db()?;
        apply_ssh_patch_with_conn(&mut conn, payload)
    })
    .await
    .map_err(|e| format!("settings_apply_ssh_patch join 失败：{e}"))?
}

#[tauri::command]
pub async fn settings_reset_ssh_known_host(
    host: String,
    port: u16,
) -> Result<SshKnownHostResetResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let deleted = reset_runtime_ssh_known_host(&host, port)?;
        Ok(SshKnownHostResetResponse { deleted })
    })
    .await
    .map_err(|e| format!("settings_reset_ssh_known_host join 失败：{e}"))?
}
