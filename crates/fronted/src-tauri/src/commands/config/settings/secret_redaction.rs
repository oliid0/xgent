fn configured_secret(
    secret: Option<Value>,
    marker: Option<&Value>,
    label: &str,
) -> Result<bool, String> {
    let present = match secret {
        Some(Value::String(value)) => !value.trim().is_empty(),
        Some(Value::Null) | None => false,
        Some(_) => return Err(format!("{label} must be a string")),
    };
    Ok(present || matches!(marker, Some(Value::Bool(true))))
}

fn redact_ssh_host_secret(host: Value) -> Result<Value, String> {
    let mut payload = expect_object(host, "ssh settings host")?;
    let auth_type = payload
        .get("authType")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("password");
    let keyboard_interactive = auth_type == "keyboardInteractive";
    let password_configured = configured_secret(
        payload.remove("password"),
        payload.get("passwordConfigured"),
        "ssh settings password",
    )?;
    let private_key_configured = configured_secret(
        payload.remove("privateKey"),
        payload.get("privateKeyConfigured"),
        "ssh settings privateKey",
    )? || payload
        .get("privateKeyPath")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty());
    let passphrase_configured = configured_secret(
        payload.remove("privateKeyPassphrase"),
        payload.get("privateKeyPassphraseConfigured"),
        "ssh settings privateKeyPassphrase",
    )?;
    payload.insert(
        "passwordConfigured".to_string(),
        Value::Bool(!keyboard_interactive && password_configured),
    );
    payload.insert(
        "privateKeyConfigured".to_string(),
        Value::Bool(!keyboard_interactive && private_key_configured),
    );
    payload.insert(
        "privateKeyPassphraseConfigured".to_string(),
        Value::Bool(!keyboard_interactive && passphrase_configured),
    );
    if let Some(proxy) = payload.remove("proxy") {
        if !matches!(proxy, Value::Null) {
            payload.insert("proxy".to_string(), redact_ssh_proxy_secret(proxy)?);
        }
    }
    Ok(Value::Object(payload))
}

fn redact_ssh_proxy_secret(proxy: Value) -> Result<Value, String> {
    let mut payload = expect_object(proxy, "ssh settings proxy")?;
    let configured = configured_secret(
        payload.remove("password"),
        payload.get("passwordConfigured"),
        "ssh settings proxy.password",
    )?;
    payload.insert("passwordConfigured".to_string(), Value::Bool(configured));
    Ok(Value::Object(payload))
}
