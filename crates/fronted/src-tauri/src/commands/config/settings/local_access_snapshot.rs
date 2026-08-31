const LOCAL_ACCESS_SETTINGS_SECRET_SENTINEL: &str = "__XGENT_LOCAL_ACCESS_SECRET__";

const LOCAL_ACCESS_SETTINGS_WRITE_COMMANDS: &[&str] = &[
    "settings_save_providers",
    "settings_save_system",
    "settings_save_mcp",
    "settings_save_agents",
    "settings_save_memory",
    "settings_apply_ssh_patch",
];

pub(crate) fn is_local_access_settings_write(command: &str) -> bool {
    LOCAL_ACCESS_SETTINGS_WRITE_COMMANDS.contains(&command)
}

/// Sanitizes settings writes received from an authenticated, paired browser
/// before they are forwarded to Tauri. Reads stay redacted; explicit new
/// values replace secrets, while redaction markers preserve stored values.
pub(crate) fn sanitize_local_access_settings_write(
    conn: &Connection,
    command: &str,
    args: Value,
) -> Result<Value, String> {
    if !is_local_access_settings_write(command) {
        return Err(format!("unsupported local-access settings write: {command}"));
    }
    let mut args = expect_object(args, "local-access settings arguments")?;
    let payload = args
        .remove("payload")
        .ok_or_else(|| format!("{command} requires a payload"))?;
    let sanitized = match command {
        "settings_save_providers" => sanitize_provider_write(conn, payload)?,
        "settings_save_system" => sanitize_system_write(conn, payload)?,
        "settings_save_mcp" => sanitize_mcp_write(conn, payload)?,
        "settings_apply_ssh_patch" => sanitize_ssh_patch_write(payload)?,
        "settings_save_agents" | "settings_save_memory" => payload,
        _ => unreachable!("command membership checked above"),
    };
    args.insert("payload".to_string(), sanitized);
    Ok(Value::Object(args))
}

fn sanitize_provider_write(conn: &Connection, incoming: Value) -> Result<Value, String> {
    let current = load_providers(conn)?.unwrap_or(Value::Array(Vec::new()));
    let current = index_objects_by_id(current, "stored provider settings")?;
    let providers = expect_array(incoming, "local-access provider settings")?;
    let providers = providers
        .into_iter()
        .map(|provider| {
            let mut provider = expect_object(provider, "local-access provider")?;
            let id = object_id(&provider, "local-access provider")?;
            let stored = current.get(&id);
            merge_provider_api_key(&mut provider, stored)?;
            merge_provider_headers(&mut provider, stored)?;
            Ok(Value::Object(provider))
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(Value::Array(providers))
}

fn merge_provider_api_key(
    incoming: &mut Map<String, Value>,
    stored: Option<&Map<String, Value>>,
) -> Result<(), String> {
    let configured = incoming
        .get("apiKeyConfigured")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let value = optional_string(incoming.get("apiKey"), "provider apiKey")?;
    let preserve = configured
        && value.is_none_or(|value| {
            value.is_empty() || value == LOCAL_ACCESS_SETTINGS_SECRET_SENTINEL
        });
    if preserve {
        if let Some(secret) = stored.and_then(|provider| provider.get("apiKey")).cloned() {
            incoming.insert("apiKey".to_string(), secret);
        } else {
            incoming.remove("apiKey");
        }
    } else if value == Some(LOCAL_ACCESS_SETTINGS_SECRET_SENTINEL) {
        return Err("provider credential marker has no stored value".to_string());
    }
    Ok(())
}

fn merge_provider_headers(
    incoming: &mut Map<String, Value>,
    stored: Option<&Map<String, Value>>,
) -> Result<(), String> {
    let stored_headers = stored
        .and_then(|provider| provider.get("customHeaders"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|header| {
            let key = header.get("key")?.as_str()?.trim().to_ascii_lowercase();
            let value = header.get("value")?.as_str()?.to_string();
            (!key.is_empty()).then_some((key, value))
        })
        .collect::<HashMap<_, _>>();
    let Some(headers) = incoming.get_mut("customHeaders") else {
        return Ok(());
    };
    let headers = headers
        .as_array_mut()
        .ok_or_else(|| "provider customHeaders must be an array".to_string())?;
    for header in headers {
        let header = header
            .as_object_mut()
            .ok_or_else(|| "provider customHeaders item must be an object".to_string())?;
        let key = optional_string(header.get("key"), "provider custom header key")?
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        let value = optional_string(header.get("value"), "provider custom header value")?
            .unwrap_or_default();
        if value == LOCAL_ACCESS_SETTINGS_SECRET_SENTINEL {
            let secret = stored_headers.get(&key).ok_or_else(|| {
                format!("provider custom header marker has no stored value for {key}")
            })?;
            header.insert("value".to_string(), Value::String(secret.clone()));
        }
    }
    Ok(())
}

fn sanitize_system_write(conn: &Connection, incoming: Value) -> Result<Value, String> {
    let default_workdir = default_project_workdir()?;
    let current = expect_object(
        load_system_with_defaults(conn, &default_workdir)?,
        "stored system settings",
    )?;
    let mut incoming = expect_object(incoming, "local-access system settings")?;
    let Some(proxy) = incoming
        .get_mut(SYSTEM_SYSTEM_PROXY_KEY)
        .and_then(Value::as_object_mut)
    else {
        return Ok(Value::Object(incoming));
    };
    let configured = proxy
        .get("passwordConfigured")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let value = optional_string(proxy.get("password"), "system proxy password")?;
    if value.is_some_and(|value| {
        !value.is_empty() && value != LOCAL_ACCESS_SETTINGS_SECRET_SENTINEL
    }) {
        return Err(
            "system proxy credentials can only be changed in the native application".to_string(),
        );
    }
    if configured
        && value.is_none_or(|value| {
            value.is_empty() || value == LOCAL_ACCESS_SETTINGS_SECRET_SENTINEL
        })
    {
        if let Some(secret) = current
            .get(SYSTEM_SYSTEM_PROXY_KEY)
            .and_then(Value::as_object)
            .and_then(|proxy| proxy.get("password"))
            .cloned()
        {
            proxy.insert("password".to_string(), secret);
        } else {
            proxy.remove("password");
        }
    }
    Ok(Value::Object(incoming))
}

fn sanitize_mcp_write(conn: &Connection, incoming: Value) -> Result<Value, String> {
    let current = load_mcp(conn)?.unwrap_or(Value::Object(Map::new()));
    let current_servers = current
        .get("servers")
        .cloned()
        .unwrap_or(Value::Array(Vec::new()));
    let current_servers = index_objects_by_id(current_servers, "stored MCP settings")?;
    let mut incoming = expect_object(incoming, "local-access MCP settings")?;
    let servers = incoming
        .entry("servers".to_string())
        .or_insert_with(|| Value::Array(Vec::new()))
        .as_array_mut()
        .ok_or_else(|| "MCP settings servers must be an array".to_string())?;
    for server in servers {
        let server = server
            .as_object_mut()
            .ok_or_else(|| "MCP settings server must be an object".to_string())?;
        let id = object_id(server, "MCP settings server")?;
        let stored = current_servers.get(&id);
        merge_secret_map(server, stored, "env", "MCP environment variables")?;
        merge_secret_map(server, stored, "headers", "MCP request headers")?;
    }
    Ok(Value::Object(incoming))
}

fn merge_secret_map(
    incoming: &mut Map<String, Value>,
    stored: Option<&Map<String, Value>>,
    field: &str,
    label: &str,
) -> Result<(), String> {
    let stored = stored
        .and_then(|server| server.get(field))
        .and_then(Value::as_object);
    let Some(values) = incoming.get_mut(field) else {
        return Ok(());
    };
    let values = values
        .as_object_mut()
        .ok_or_else(|| format!("{label} must be an object"))?;
    for (key, value) in values.iter_mut() {
        let text = value
            .as_str()
            .ok_or_else(|| format!("{label} value must be a string"))?;
        if text == LOCAL_ACCESS_SETTINGS_SECRET_SENTINEL {
            *value = stored
                .and_then(|stored| stored.get(key))
                .cloned()
                .ok_or_else(|| format!("{label} marker has no stored value for {key}"))?;
        }
    }
    Ok(())
}

fn sanitize_ssh_patch_write(payload: Value) -> Result<Value, String> {
    let payload = expect_object(payload, "local-access SSH settings patch")?;
    if payload
        .get(SSH_SECRET_UPDATES_FIELD)
        .and_then(Value::as_object)
        .is_some_and(|updates| !updates.is_empty())
    {
        return Err("SSH credentials can only be changed in the native application".to_string());
    }
    Ok(Value::Object(payload))
}

fn index_objects_by_id(
    value: Value,
    label: &str,
) -> Result<HashMap<String, Map<String, Value>>, String> {
    let items = expect_array(value, label)?;
    items
        .into_iter()
        .map(|item| {
            let object = expect_object(item, label)?;
            let id = object_id(&object, label)?;
            Ok((id, object))
        })
        .collect()
}

fn object_id(object: &Map<String, Value>, label: &str) -> Result<String, String> {
    object
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("{label} id must be a non-empty string"))
}

fn optional_string<'a>(value: Option<&'a Value>, label: &str) -> Result<Option<&'a str>, String> {
    match value {
        Some(Value::String(value)) => Ok(Some(value.as_str())),
        Some(Value::Null) | None => Ok(None),
        Some(_) => Err(format!("{label} must be a string")),
    }
}

/// Builds the settings view that may cross the local-access boundary.
/// Secrets never leave the desktop process: callers receive only
/// `*Configured` markers for provider, proxy, and SSH credentials.
pub(crate) fn load_local_access_settings_snapshot(conn: &Connection) -> Result<Value, String> {
    let default_workdir = default_project_workdir()?;
    let mut snapshot = Map::new();
    snapshot.insert(
        "system".to_string(),
        redact_system_settings(load_system_with_defaults(conn, &default_workdir)?)?,
    );
    snapshot.insert(
        "providers".to_string(),
        local_access_provider_settings(
            load_providers(conn)?.unwrap_or(Value::Array(Vec::new())),
        )?,
    );
    snapshot.insert(
        "mcp".to_string(),
        redact_mcp_settings(load_mcp(conn)?.unwrap_or(Value::Object(Map::new())))?,
    );
    snapshot.insert(
        "agents".to_string(),
        load_agents(conn)?.unwrap_or(Value::Array(Vec::new())),
    );
    snapshot.insert(
        "ssh".to_string(),
        redact_ssh_settings(load_ssh(conn)?.unwrap_or(Value::Object(Map::from_iter([(
            "hosts".to_string(),
            Value::Array(Vec::new()),
        )]))))?,
    );
    snapshot.insert(
        "automationCron".to_string(),
        load_masked_automation_cron(conn)?,
    );
    snapshot.insert(
        "automationHooks".to_string(),
        load_masked_automation_hooks(conn)?,
    );
    snapshot.insert(
        "memory".to_string(),
        load_memory(conn)?.unwrap_or(Value::Object(Map::new())),
    );
    snapshot.insert(
        "access".to_string(),
        load_access(conn)?.unwrap_or(Value::Object(Map::new())),
    );
    snapshot.insert("defaultWorkdir".to_string(), Value::String(default_workdir));
    Ok(Value::Object(snapshot))
}

pub(crate) fn load_local_access_automation_snapshot(conn: &Connection) -> Result<Value, String> {
    Ok(Value::Object(Map::from_iter([
        ("cron".to_string(), load_masked_automation_cron(conn)?),
        ("hooks".to_string(), load_masked_automation_hooks(conn)?),
    ])))
}

pub(crate) fn mask_local_access_automation_event(
    event: &str,
    payload: Value,
) -> Result<Value, String> {
    match event {
        crate::services::automation::CRON_CHANGED_EVENT => {
            let mut snapshot: crate::services::automation::CronSnapshot =
                serde_json::from_value(payload)
                    .map_err(|error| format!("decode local-access cron event failed: {error}"))?;
            for task in &mut snapshot.tasks {
                crate::services::automation::validate::mask_request_headers(&mut task.requests);
            }
            serde_json::to_value(snapshot)
                .map_err(|error| format!("encode local-access cron event failed: {error}"))
        }
        crate::services::automation::HOOKS_CHANGED_EVENT => {
            let mut snapshot: crate::services::automation::HooksSnapshot =
                serde_json::from_value(payload)
                    .map_err(|error| format!("decode local-access hooks event failed: {error}"))?;
            for hook in &mut snapshot.hooks {
                crate::services::automation::validate::mask_request_headers(&mut hook.requests);
            }
            serde_json::to_value(snapshot)
                .map_err(|error| format!("encode local-access hooks event failed: {error}"))
        }
        _ => Ok(payload),
    }
}

fn redact_mcp_settings(settings: Value) -> Result<Value, String> {
    let mut settings = expect_object(settings, "MCP settings payload")?;
    let servers = expect_array(
        settings.remove("servers").unwrap_or(Value::Array(Vec::new())),
        "MCP settings servers",
    )?;
    let servers = servers
        .into_iter()
        .map(|server| {
            let mut server = expect_object(server, "MCP settings server")?;
            if let Some(env) = server.get_mut("env").and_then(Value::as_object_mut) {
                for value in env.values_mut() {
                    if value.as_str().is_some_and(|value| !value.trim().is_empty()) {
                        *value = Value::String(LOCAL_ACCESS_SETTINGS_SECRET_SENTINEL.to_string());
                    }
                }
            }
            if let Some(headers) = server.get_mut("headers").and_then(Value::as_object_mut) {
                for value in headers.values_mut() {
                    if value.as_str().is_some_and(|value| !value.trim().is_empty()) {
                        *value = Value::String(LOCAL_ACCESS_SETTINGS_SECRET_SENTINEL.to_string());
                    }
                }
            }
            Ok(Value::Object(server))
        })
        .collect::<Result<Vec<_>, String>>()?;
    settings.insert("servers".to_string(), Value::Array(servers));
    Ok(Value::Object(settings))
}

fn local_access_provider_settings(providers: Value) -> Result<Value, String> {
    let redacted = redact_provider_credentials(providers)?;
    let mut providers = expect_array(redacted, "provider settings payload")?;
    for provider in &mut providers {
        let payload = provider
            .as_object_mut()
            .ok_or_else(|| "provider settings item must be an object".to_string())?;
        if payload
            .get("apiKeyConfigured")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            payload.insert(
                "apiKey".to_string(),
                Value::String(LOCAL_ACCESS_SETTINGS_SECRET_SENTINEL.to_string()),
            );
        }
        if let Some(headers) = payload.get_mut("customHeaders").and_then(Value::as_array_mut) {
            for header in headers {
                let Some(header) = header.as_object_mut() else {
                    continue;
                };
                if header
                    .get("value")
                    .and_then(Value::as_str)
                    .is_some_and(|value| !value.trim().is_empty())
                {
                    header.insert(
                        "value".to_string(),
                        Value::String(LOCAL_ACCESS_SETTINGS_SECRET_SENTINEL.to_string()),
                    );
                }
            }
        }
    }
    Ok(Value::Array(providers))
}

fn load_masked_automation_cron(conn: &Connection) -> Result<Value, String> {
    crate::services::automation::db::ensure_schema(conn)?;
    let mut snapshot = crate::services::automation::db::read_cron_snapshot(conn)?;
    for task in &mut snapshot.tasks {
        crate::services::automation::validate::mask_request_headers(&mut task.requests);
    }
    serde_json::to_value(&snapshot)
        .map_err(|error| format!("serialize local-access cron snapshot failed: {error}"))
}

fn load_masked_automation_hooks(conn: &Connection) -> Result<Value, String> {
    crate::services::automation::db::ensure_schema(conn)?;
    let mut snapshot = crate::services::automation::db::read_hooks_snapshot(conn)?;
    for hook in &mut snapshot.hooks {
        crate::services::automation::validate::mask_request_headers(&mut hook.requests);
    }
    serde_json::to_value(&snapshot)
        .map_err(|error| format!("serialize local-access hooks snapshot failed: {error}"))
}

fn redact_ssh_settings(ssh: Value) -> Result<Value, String> {
    let mut ssh = expect_object(ssh, "ssh settings payload")?;
    let hosts = expect_array(
        ssh.remove("hosts").unwrap_or(Value::Array(Vec::new())),
        "ssh settings hosts",
    )?;
    let project_host_associations = ssh
        .remove("projectHostAssociations")
        .unwrap_or(Value::Object(Map::new()));
    let redacted = hosts
        .into_iter()
        .map(redact_ssh_host_secret)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Value::Object(Map::from_iter([
        ("hosts".to_string(), Value::Array(redacted)),
        (
            "projectHostAssociations".to_string(),
            Value::Object(normalize_ssh_project_host_associations_value(
                project_host_associations,
                None,
            )?),
        ),
    ])))
}

fn redact_system_settings(system: Value) -> Result<Value, String> {
    let mut payload = expect_object(system, "system settings payload")?;
    if let Some(proxy) = payload.remove(SYSTEM_SYSTEM_PROXY_KEY) {
        if !matches!(proxy, Value::Null) {
            payload.insert(
                SYSTEM_SYSTEM_PROXY_KEY.to_string(),
                redact_system_proxy_secret(proxy)?,
            );
        }
    }
    Ok(Value::Object(payload))
}

fn redact_system_proxy_secret(proxy: Value) -> Result<Value, String> {
    let mut payload = expect_object(proxy, "system settings systemProxy")?;
    let configured = configured_secret(
        payload.remove("password"),
        payload.get("passwordConfigured"),
        "system settings systemProxy.password",
    )?;
    payload.insert("passwordConfigured".to_string(), Value::Bool(configured));
    Ok(Value::Object(payload))
}
