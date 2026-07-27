fn default_web_ui_scope() -> String {
    "lan".to_string()
}

fn default_web_ui_port() -> u16 {
    28_367
}

fn default_github_repository() -> String {
    "agent-temp".to_string()
}

fn default_cloud_artifact_retention_days() -> u16 {
    7
}

impl Default for AccessSettingsPayload {
    fn default() -> Self {
        Self {
            web_ui_enabled: false,
            web_ui_scope: default_web_ui_scope(),
            web_ui_port: default_web_ui_port(),
            allow_terminal: false,
            allow_ssh: false,
            allow_git: false,
            allow_file_write: false,
            cloud_execution_enabled: false,
            github_owner: String::new(),
            github_repository: default_github_repository(),
            cloud_artifact_retention_days: default_cloud_artifact_retention_days(),
            android_proot_enabled: false,
            ios_a_shell_enabled: false,
        }
    }
}

pub(crate) fn normalize_access_settings_payload(
    payload: AccessSettingsPayload,
) -> AccessSettingsPayload {
    let scope = match payload.web_ui_scope.trim() {
        "loopback" => "loopback",
        _ => "lan",
    };
    let repository = payload.github_repository.trim();
    AccessSettingsPayload {
        web_ui_enabled: payload.web_ui_enabled,
        web_ui_scope: scope.to_string(),
        web_ui_port: if payload.web_ui_port == 0 {
            default_web_ui_port()
        } else {
            payload.web_ui_port
        },
        allow_terminal: payload.allow_terminal,
        allow_ssh: payload.allow_ssh,
        allow_git: payload.allow_git,
        allow_file_write: payload.allow_file_write,
        cloud_execution_enabled: payload.cloud_execution_enabled,
        github_owner: payload.github_owner.trim().to_string(),
        github_repository: if repository.is_empty() {
            default_github_repository()
        } else {
            repository.to_string()
        },
        cloud_artifact_retention_days: payload.cloud_artifact_retention_days.clamp(1, 90),
        android_proot_enabled: payload.android_proot_enabled,
        ios_a_shell_enabled: payload.ios_a_shell_enabled,
    }
}

pub(crate) fn parse_access_settings_payload(value: Value) -> Result<AccessSettingsPayload, String> {
    let parsed = serde_json::from_value::<AccessSettingsPayload>(value)
        .map_err(|error| format!("parse access settings failed: {error}"))?;
    Ok(normalize_access_settings_payload(parsed))
}

pub(crate) fn load_access(conn: &Connection) -> Result<Option<Value>, String> {
    let payload_json = conn
        .query_row(
            &format!(
                "SELECT payload_json FROM {ACCESS_SETTINGS_TABLE} WHERE config_id = 'default'"
            ),
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("read {ACCESS_SETTINGS_TABLE} failed: {error}"))?;
    match payload_json {
        Some(raw) => Ok(Some(parse_json(&raw, ACCESS_SETTINGS_TABLE)?)),
        None => Ok(None),
    }
}

pub(crate) fn load_access_settings(conn: &Connection) -> Result<AccessSettingsPayload, String> {
    match load_access(conn)? {
        Some(value) => parse_access_settings_payload(value),
        None => Ok(AccessSettingsPayload::default()),
    }
}

fn save_access(conn: &mut Connection, payload: Value) -> Result<(), String> {
    let normalized = parse_access_settings_payload(payload)?;
    let payload_json = serde_json::to_value(&normalized)
        .map_err(|error| format!("serialize {ACCESS_SETTINGS_TABLE} failed: {error}"))?;
    let updated_at = now_ms();
    let tx = conn
        .transaction()
        .map_err(|error| format!("begin {ACCESS_SETTINGS_TABLE} transaction failed: {error}"))?;
    tx.execute(
        &format!("DELETE FROM {ACCESS_SETTINGS_TABLE} WHERE config_id = 'default'"),
        [],
    )
    .map_err(|error| format!("clear {ACCESS_SETTINGS_TABLE} failed: {error}"))?;
    tx.execute(
        &format!(
            "INSERT INTO {ACCESS_SETTINGS_TABLE} (config_id, payload_json, updated_at) VALUES ('default', ?1, ?2)"
        ),
        params![serialize_json(&payload_json, ACCESS_SETTINGS_TABLE)?, updated_at],
    )
    .map_err(|error| format!("write {ACCESS_SETTINGS_TABLE} failed: {error}"))?;
    tx.commit()
        .map_err(|error| format!("commit {ACCESS_SETTINGS_TABLE} transaction failed: {error}"))?;
    Ok(())
}
