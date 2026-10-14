//! Mirrors Tailscale's feature/oauthkey/oauthkey.go; no CLI execution.
use futures_util::StreamExt;
use serde::Deserialize;
use super::super::tailscale_setup::TailscaleAuthMode;

async fn json(response: reqwest::Response) -> Result<serde_json::Value, String> {
    if !response.status().is_success() { return Err("tailscale-command-failed".into()); }
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "tailscale-command-failed")?;
        if bytes.len().saturating_add(chunk.len()) > 65_536 { return Err("tailscale-command-failed".into()); }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "tailscale-command-failed".into())
}

pub(super) async fn auth_key(mode: TailscaleAuthMode, secret: String, tags: &[String]) -> Result<String, String> {
    if matches!(mode, TailscaleAuthMode::AuthKey) { return Ok(secret); }
    #[derive(Deserialize)]
    struct Grant { access_token: String, token_type: String }
    let client = reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never()).connect_timeout(std::time::Duration::from_secs(4))
        .timeout(std::time::Duration::from_secs(15)).build().map_err(|_| "tailscale-command-failed")?;
    let response = client.post("https://api.tailscale.com/api/v2/oauth/token")
        // The official resolver uses an ignored client id with this secret.
        .basic_auth("some-client-id", Some(secret))
        .form(&[("grant_type", "client_credentials")]).send().await.map_err(|_| "tailscale-command-failed")?;
    let grant: Grant = serde_json::from_value(json(response).await?).map_err(|_| "tailscale-command-failed")?;
    if !grant.token_type.eq_ignore_ascii_case("bearer") || grant.access_token.is_empty() || grant.access_token.len() > 4096 {
        return Err("tailscale-command-failed".into());
    }
    let response = client.post("https://api.tailscale.com/api/v2/tailnet/-/keys")
        .bearer_auth(grant.access_token).json(&serde_json::json!({ "capabilities": { "devices": { "create": {
            "reusable": false, "ephemeral": false, "preauthorized": false, "tags": tags
        } } }, "expirySeconds": 300 })).send().await.map_err(|_| "tailscale-command-failed")?;
    let value = json(response).await?;
    let key = value["key"].as_str().ok_or("tailscale-command-failed")?;
    let input = super::super::tailscale_setup::TailscaleAuthInput {
        mode: TailscaleAuthMode::AuthKey, credential: key.into(), tags: vec![],
    };
    super::super::tailscale_setup::validated_credential(&input).map_err(|_| "tailscale-command-failed".into())
}
