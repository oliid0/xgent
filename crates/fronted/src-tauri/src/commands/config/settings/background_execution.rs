/// Host-owned background configuration. Called with the automation transaction
/// connection, so acceptance cannot race a settings write in config.sqlite.
#[cfg(desktop)]
pub(crate) fn load_background_execution_settings(
    conn: &Connection,
    input: &crate::services::automation::SubmitBackgroundTaskInput,
) -> Result<Value, String> {
    let providers = load_providers(conn)?.unwrap_or_else(|| json!([]));
    let provider = providers.as_array().into_iter().flatten()
        .find(|provider| provider.get("id").and_then(Value::as_str) == Some(input.provider_id.as_str()))
        .ok_or_else(|| "Background provider is unavailable on the execution host".to_string())?;
    let configured = if provider.get("authMode").and_then(Value::as_str) == Some("oauth-managed") {
        provider.get("oauthAccountId").and_then(Value::as_str).is_some_and(|id| !id.trim().is_empty())
    } else {
        provider.get("apiKey").and_then(Value::as_str).is_some_and(|key| !key.trim().is_empty())
    };
    let available_model = provider.get("models").and_then(Value::as_array).is_some_and(|models|
        models.iter().any(|model| model.get("id").and_then(Value::as_str) == Some(input.model.as_str())));
    let active_model = provider.get("activeModels").and_then(Value::as_array).is_some_and(|models|
        models.iter().any(|model| model.as_str() == Some(input.model.as_str())));
    if !configured || provider.get("baseUrl").and_then(Value::as_str).is_none_or(|url| url.trim().is_empty())
        || !available_model || !active_model {
        return Err("Background task requires a configured provider, an explicit OAuth account/API key and an active model on this host".to_string());
    }
    // Validate the exact selected model against the host-owned settings inside
    // the same acceptance transaction that captures its immutable binding.
    if let Some(requirements) = &input.requirements {
        let selected = provider.get("models").and_then(Value::as_array).into_iter().flatten()
            .find(|model| model.get("id").and_then(Value::as_str) == Some(input.model.as_str()));
        let skills = selected.map(crate::services::worker_inventory::configured_model_skills).unwrap_or_default();
        if requirements.model_skills.iter().any(|required| !skills.contains(required)) {
            return Err("Selected background model no longer has every required configured specialty; no new task accepted".into());
        }
    }
    let mut system = load_system_with_defaults(conn, &input.workdir)?;
    if !matches!(system.get("executionMode").and_then(Value::as_str), Some("tools" | "agent-dev")) {
        return Err("Background agent execution is disabled on this host".to_string());
    }
    system["workdir"] = json!(input.workdir);
    let access = serde_json::to_value(load_access_settings(conn)?).map_err(|e| e.to_string())?;
    let mut mcp = load_mcp(conn)?.unwrap_or_else(|| json!({"servers": [], "selected": []}));
    let key = normalize_project_path_key(&input.workdir);
    let resources = system.get("workspaceResourceSettings").and_then(|settings| settings.get(&key));
    if resources.and_then(|resources| resources.get("mode")).and_then(Value::as_str) == Some("custom") {
        let allowed = resources.and_then(|resources| resources.get("mcpServerIds")).and_then(Value::as_array);
        if let Some(servers) = mcp.get_mut("servers").and_then(Value::as_array_mut) {
            servers.retain(|server| allowed.is_some_and(|ids| ids.iter().any(|id| id == &server["id"])));
        }
        if let Some(selected) = mcp.get_mut("selected").and_then(Value::as_array_mut) {
            selected.retain(|id| allowed.is_some_and(|ids| ids.contains(id)));
        }
    }
    let mut snapshot = json!({"providerId": input.provider_id, "model": input.model, "providers": [provider], "system": system, "mcp": mcp, "access": access});
    if input.intelligent_scheduling_enabled {
        let mut delegates: Vec<Value> = providers.as_array().into_iter().flatten()
            .filter(|candidate| {
                let authenticated = if candidate["authMode"].as_str() == Some("oauth-managed") {
                    candidate["type"].as_str() == Some("codex")
                        && candidate["oauthAccountId"].as_str().is_some_and(|id| !id.trim().is_empty())
                } else { candidate["apiKey"].as_str().is_some_and(|key| !key.trim().is_empty()) };
                authenticated && candidate["baseUrl"].as_str().is_some_and(|url| !url.trim().is_empty())
            }).filter_map(|candidate| {
                let active = candidate["activeModels"].as_array()?;
                let models: Vec<Value> = candidate["models"].as_array()?.iter()
                    .filter(|model| active.iter().any(|id| id == &model["id"]))
                    .cloned().collect();
                if models.is_empty() { return None; }
                let mut candidate = candidate.clone();
                candidate["models"] = json!(models);
                Some(candidate)
            }).collect();
        delegates.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
        snapshot["intelligentSchedulingEnabled"] = json!(true);
        snapshot["delegationProviders"] = json!(delegates);
    }
    Ok(snapshot)
}

/// Project identities, credentials and effective permissions, excluding UI
/// labels, unrelated providers/workspaces, global workdir and model inventory.
#[cfg(desktop)]
pub(crate) fn background_configuration_material(settings: &Value, model_id: &str) -> Value {
    let provider = &settings["providers"][0];
    let mut provider_binding = Map::new();
    for key in ["id", "type", "baseUrl", "isFullUrl", "apiKey", "authMode", "oauthAccountId", "customHeaders", "requestFormat", "useSystemProxy"] {
        provider_binding.insert(key.to_string(), provider[key].clone());
    }
    provider_binding.insert("model".to_string(), provider.get("models").and_then(Value::as_array)
        .and_then(|models| models.iter().find(|model| model["id"].as_str() == Some(model_id)))
        .cloned().unwrap_or(Value::Null));
    let system = &settings["system"];
    let mut system_binding = Map::new();
    for key in ["executionMode", "workdir", "selectedSystemTools", "toolPolicies", "commandSafetyMode", "terminalShell", "systemProxy"] {
        system_binding.insert(key.to_string(), system[key].clone());
    }
    let path_key = normalize_project_path_key(system["workdir"].as_str().unwrap_or_default());
    system_binding.insert("workspaceResources".to_string(), system["workspaceResourceSettings"][path_key.as_str()].clone());
    let mut servers: Vec<Value> = settings["mcp"]["servers"].as_array().into_iter().flatten()
        .filter(|server| server["enabled"].as_bool() == Some(true))
        .map(|server| {
            let mut server = server.clone();
            if let Some(object) = server.as_object_mut() {
                object.remove("description");
                object.remove("docsUrl");
            }
            server
        }).collect();
    servers.sort_by(|left, right| left["id"].as_str().cmp(&right["id"].as_str()));
    let mut access = Map::new();
    for key in ["blockedLocalCapabilities", "cloudExecutionEnabled", "githubOwner", "githubRepository", "androidProotEnabled", "iosAShellEnabled"] {
        access.insert(key.to_string(), settings["access"][key].clone());
    }
    let mut material = json!({"version": 1, "provider": provider_binding, "system": system_binding, "mcp": servers, "access": access});
    // Off remains byte-compatible with existing accepted single-model tasks.
    // On binds every delegate's credentials, active models and declared skills.
    if settings["intelligentSchedulingEnabled"].as_bool() == Some(true) {
        let delegates: Vec<Value> = settings["delegationProviders"].as_array().into_iter().flatten()
            .map(|provider| {
                let mut binding = Map::new();
                for key in ["id", "type", "baseUrl", "isFullUrl", "apiKey", "authMode", "oauthAccountId", "customHeaders", "requestFormat", "useSystemProxy", "activeModels", "models"] {
                    binding.insert(key.into(), provider[key].clone());
                }
                Value::Object(binding)
            }).collect();
        material["intelligentSchedulingEnabled"] = json!(true);
        material["delegationProviders"] = json!(delegates);
        if let Some(templates) = settings["system"]["subagentTemplates"].as_array().filter(|templates| !templates.is_empty()) {
            material["subagentTemplates"] = json!(templates);
        }
    }
    canonical_background_value(material)
}

#[cfg(desktop)]
pub(crate) fn canonical_background_value(value: Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut entries: Vec<_> = object.into_iter().collect();
            entries.sort_by(|left, right| left.0.cmp(&right.0));
            Value::Object(entries.into_iter().map(|(key, value)| (key, canonical_background_value(value))).collect())
        }
        Value::Array(values) => Value::Array(values.into_iter().map(canonical_background_value).collect()),
        value => value,
    }
}

#[cfg(all(test, desktop))]
mod background_configuration_tests {
    use super::*;

    fn input() -> crate::services::automation::SubmitBackgroundTaskInput {
        crate::services::automation::SubmitBackgroundTaskInput {
            intelligent_scheduling_enabled: false, request_id: Uuid::new_v4().to_string(), name: "Report".into(), prompt: "Create report".into(),
            provider_id: "provider".into(), model: "model".into(), workdir: "/accepted".into(),
            timeout_seconds: 300, reasoning: "medium".into(), files: Vec::new(), delegation: None, requirements: None, source_context: None, goal_binding: None,
        }
    }

    fn setup() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        initialize_schema(&conn).unwrap();
        save_providers(&mut conn, json!([{"id": "provider", "name": "Provider", "type": "codex", "baseUrl": "https://example.test",
            "apiKey": "secret", "models": [{"id": "model"}, {"id": "other"}], "activeModels": ["model", "other"]}])).unwrap();
        save_system_with_default_workdir(&mut conn, json!({"executionMode": "tools", "workdir": "/global",
            "workspaceResourceSettings": {"/accepted": {"mode": "custom", "skillNames": [], "mcpServerIds": ["mail"]}}}), "/default").unwrap();
        save_mcp(&mut conn, json!({"servers": [
            {"id": "mail", "enabled": true, "transport": "http", "url": "https://mail.test", "headers": {"Authorization": "mail-secret"}},
            {"id": "other", "enabled": true, "transport": "http", "url": "https://other.test"}
        ], "selected": []})).unwrap();
        conn
    }

    #[test]
    fn native_snapshot_uses_pinned_workspace_and_effective_enabled_connectors() {
        let conn = setup();
        let snapshot = load_background_execution_settings(&conn, &input()).unwrap();
        assert_eq!(snapshot["system"]["workdir"], "/accepted");
        assert_eq!(snapshot["providers"].as_array().unwrap().len(), 1);
        assert_eq!(snapshot["mcp"]["servers"].as_array().unwrap().len(), 1);
        assert_eq!(snapshot["mcp"]["servers"][0]["id"], "mail");
        assert!(snapshot["mcp"]["selected"].as_array().unwrap().is_empty());
    }

    #[test]
    fn scheduling_is_explicit_and_binds_only_configured_host_delegates() {
        let mut conn = setup();
        let mut providers = load_providers(&conn).unwrap().unwrap();
        let mut delegate = providers[0].clone();
        delegate["id"] = json!("code-account");
        delegate["models"] = json!([
            {"id": "coder", "delegationSkills": ["coding"], "delegationMaxConcurrency": 1},
            {"id": "inactive"}
        ]);
        delegate["activeModels"] = json!(["coder"]);
        providers.as_array_mut().unwrap().push(delegate.clone());
        delegate["id"] = json!("unconfigured");
        delegate["apiKey"] = json!("");
        providers.as_array_mut().unwrap().push(delegate);
        save_providers(&mut conn, providers).unwrap();
        let off = load_background_execution_settings(&conn, &input()).unwrap();
        assert!(off.get("delegationProviders").is_none());
        let mut enabled = input();
        enabled.intelligent_scheduling_enabled = true;
        let on = load_background_execution_settings(&conn, &enabled).unwrap();
        assert_eq!(on["providers"].as_array().unwrap().len(), 1);
        let delegates = on["delegationProviders"].as_array().unwrap();
        assert_eq!(delegates.len(), 2);
        let coder = delegates.iter().find(|provider| provider["id"] == "code-account").unwrap();
        assert_eq!(coder["models"].as_array().unwrap().len(), 1);
        assert_eq!(coder["models"][0]["delegationSkills"], json!(["coding"]));
        let accepted = background_configuration_material(&on, "model");
        let mut changed = on.clone();
        changed["delegationProviders"][0]["apiKey"] = json!("replacement");
        assert_ne!(accepted, background_configuration_material(&changed, "model"));
        changed = on.clone();
        changed["delegationProviders"][0]["models"][0]["delegationMaxConcurrency"] = json!(3);
        assert_ne!(accepted, background_configuration_material(&changed, "model"));
        assert_ne!(accepted, background_configuration_material(&off, "model"));
    }

    #[test]
    fn configuration_binding_tracks_credentials_accounts_and_permissions_but_not_ui_inventory() {
        let conn = setup();
        let snapshot = load_background_execution_settings(&conn, &input()).unwrap();
        let accepted = background_configuration_material(&snapshot, "model");
        for (path, changed) in [
            (vec!["providers", "0", "apiKey"], json!("replacement")),
            (vec!["providers", "0", "oauthAccountId"], json!("another-account")),
            (vec!["providers", "0", "baseUrl"], json!("https://replacement.test")),
            (vec!["mcp", "servers", "0", "headers"], json!({"Authorization": "replacement"})),
            (vec!["system", "commandSafetyMode"], json!("ask")),
            (vec!["access", "blockedLocalCapabilities"], json!(["terminal"])),
        ] {
            let mut changed_snapshot = snapshot.clone();
            let mut target = &mut changed_snapshot;
            for key in path {
                target = if key == "0" { &mut target[0] } else { &mut target[key] };
            }
            *target = changed;
            assert_ne!(accepted, background_configuration_material(&changed_snapshot, "model"));
        }
        let mut harmless = snapshot.clone();
        harmless["providers"][0]["name"] = json!("Renamed");
        harmless["providers"][0]["models"][1] = json!({"id": "other", "contextWindow": 99});
        harmless["system"]["workspaceResourceSettings"]["/unrelated"] = json!({"mode": "custom"});
        harmless["mcp"]["selected"] = json!(["mail"]);
        harmless["mcp"]["servers"][0]["description"] = json!("Renamed connector");
        assert_eq!(accepted, background_configuration_material(&harmless, "model"));
    }

    #[test]
    fn acceptance_rejects_unselected_oauth_account_and_disabled_model() {
        let mut conn = setup();
        let mut providers = load_providers(&conn).unwrap().unwrap();
        providers[0]["authMode"] = json!("oauth-managed");
        providers[0]["oauthAccountId"] = Value::Null;
        save_providers(&mut conn, providers.clone()).unwrap();
        assert!(load_background_execution_settings(&conn, &input()).is_err());
        providers[0]["oauthAccountId"] = json!("explicit-account");
        save_providers(&mut conn, providers.clone()).unwrap();
        assert!(load_background_execution_settings(&conn, &input()).is_ok());
        providers[0]["activeModels"] = json!(["other"]);
        save_providers(&mut conn, providers).unwrap();
        assert!(load_background_execution_settings(&conn, &input()).is_err());
    }
}
