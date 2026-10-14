//! GitHub's documented device grant. Secrets and refresh stay in the native vault.
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use std::time::Duration;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;
use super::cloud_secret_vault::{CloudSecretVault, GitHubOAuthAccount, GitHubOAuthGrant};

const FLOW_KEY: &[u8] = b"github.device-authorization.v1";
const DEVICE_URL: &str = "https://github.com/login/device/code";
const TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
pub const VERIFICATION_URL: &str = "https://github.com/login/device";
const SCOPES: &str = "read:user public_repo workflow";
fn now() -> i64 { super::automation::db::now_ms() }
fn storage<T>(_: T) -> String { "github-oauth-storage".into() }
fn invalid<T>(_: T) -> String { "github-oauth-response".into() }

#[derive(Clone, Serialize, Deserialize)]
struct Pending {
    id: String, client_id: String, device_code: String, user_code: String,
    expires_at: i64, interval_ms: i64, next_poll_at: i64,
    expected_binding: String, phase: String, error: Option<String>,
    #[serde(default)] token_response: Option<Value>,
    #[serde(default)] token_observed_at: Option<i64>,
}

const REFRESH_KEY: &[u8] = b"github.refresh-authorization.v1";
#[derive(Serialize, Deserialize)]
struct RefreshAttempt {
    binding: String, observed_at: i64, next_attempt_at: i64,
    response: Option<Value>, error: Option<String>,
}

fn live_flow(flow:&Pending)->bool {
    if let Some(body)=flow.token_response.as_ref() {
        flow.token_observed_at.is_some_and(|issued|expiry(body,"expires_in",issued)
            .is_ok_and(|expires|expires.is_none_or(|expires|expires>now())))
    } else {flow.expires_at>now()}
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubAuthorizationStatus {
    pub phase: String, pub flow_id: Option<String>, pub user_code: Option<String>,
    pub expires_at: Option<i64>, pub next_poll_at: Option<i64>,
    pub account: Option<GitHubOAuthAccount>, pub error: Option<String>,
}

pub struct GitHubAuthorizationService {
    vault: Arc<CloudSecretVault>, http: Client, pending: Mutex<Option<Pending>>,
    network: tokio::sync::Mutex<()>, worker_running: AtomicBool,
}

impl GitHubAuthorizationService {
    pub fn new(vault: Arc<CloudSecretVault>) -> Result<Self, String> {
        let pending = vault.namespaced_secret(FLOW_KEY)?
            .map(|bytes| {
                if bytes.len() > 131_072 { return Err("github-oauth-storage".into()); }
                serde_json::from_slice::<Pending>(&bytes).map_err(storage)
            }).transpose()?;
        if let Some(flow) = &pending {
            if Uuid::parse_str(&flow.id).is_err() || !valid_client_id(&flow.client_id)
                || flow.device_code.len() > 4096 || flow.user_code.len() > 16
                || !(1_000..=600_000).contains(&flow.interval_ms)
                || flow.expected_binding.len() != 64 || !flow.expected_binding.bytes().all(|b|b.is_ascii_hexdigit())
                || !["starting", "pending", "error"].contains(&flow.phase.as_str()) {
                return Err("github-oauth-storage".into());
            }
        }
        let http = Client::builder().user_agent("Xgent GitHub account authorization")
            .redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(15))
            .build().map_err(|_| "github-oauth-network".to_string())?;
        Ok(Self { vault, http, pending: Mutex::new(pending), network: tokio::sync::Mutex::new(()),
            worker_running: AtomicBool::new(false) })
    }

    fn save(&self, slot: &mut Option<Pending>, next: Option<Pending>) -> Result<(), String> {
        if let Some(flow) = &next {
            self.vault.set_namespaced_secret(FLOW_KEY, &serde_json::to_vec(flow).map_err(storage)?).map_err(storage)?;
        } else { self.vault.remove_namespaced_secret(FLOW_KEY).map_err(storage)?; }
        *slot = next;
        Ok(())
    }

    pub fn status(&self) -> Result<GitHubAuthorizationStatus, String> {
        let slot = self.pending.lock().map_err(storage)?;
        let account = self.vault.status()?.github_oauth_account;
        let mut status = GitHubAuthorizationStatus { phase: if account.is_some() { "connected" } else { "idle" }.into(),
            flow_id: None, user_code: None, expires_at: None, next_poll_at: None, account, error: None };
        if let Some(flow) = slot.as_ref().filter(|flow| !status.account.as_ref().is_some_and(|account|account.account_id==flow.id)) {
            status.phase = if !live_flow(flow) { "error".into() }
                else if flow.phase=="pending" && flow.token_response.is_some() {"verifying".into()} else { flow.phase.clone() };
            status.flow_id = Some(flow.id.clone());
            status.error = if flow.phase=="error" {flow.error.clone()}
                else if !live_flow(flow) { Some("github-oauth-expired".into()) } else { flow.error.clone() };
            if status.phase == "pending" {
                status.user_code = Some(flow.user_code.clone()); status.expires_at = Some(flow.expires_at);
                status.next_poll_at = Some(flow.next_poll_at);
            }
        }
        if status.phase == "connected" {
            if let Some(grant) = self.vault.github_oauth_grant()? {
                if let Some(attempt) = self.read_refresh()?.filter(|attempt|attempt.binding == grant.credential_binding) {
                    if let Some(error) = attempt.error { status.error = Some(error); }
                    else if attempt.response.is_none() && attempt.observed_at + 30_000 < now() { status.error = Some("github-oauth-refresh-unknown".into()); }
                }
                if grant.account.expires_at.is_some_and(|expires|expires <= now()) {
                    status.phase = "expired".into(); status.error.get_or_insert_with(||"github-oauth-expired".into());
                }
            }
        }
        Ok(status)
    }

    pub async fn start(self: &Arc<Self>, client_id: &str) -> Result<GitHubAuthorizationStatus, String> {
        let client_id = client_id.trim();
        if !valid_client_id(client_id) { return Err("github-oauth-client-id".into()); }
        let _network = self.network.lock().await;
        let mut flow = Pending { id: Uuid::new_v4().to_string(), client_id: client_id.into(), device_code: String::new(),
            user_code: String::new(), expires_at: now() + 60_000, interval_ms: 5_000, next_poll_at: now(),
            expected_binding: self.vault.github_credential_binding()?, phase: "starting".into(), error: None,
            token_response: None, token_observed_at: None };
        {
            let mut slot = self.pending.lock().map_err(storage)?;
            if slot.as_ref().is_some_and(|flow| ["starting","pending"].contains(&flow.phase.as_str()) && live_flow(flow)) {
                return Err("github-oauth-busy".into());
            }
            self.save(&mut slot, Some(flow.clone()))?;
        }
        let result = async {
            let response = self.http.post(DEVICE_URL).header("Accept", "application/json")
                .form(&[("client_id", client_id), ("scope", SCOPES)]).send().await.map_err(|_| "github-oauth-network".to_string())?;
            let successful = response.status().is_success(); let body = bounded_json(response).await?;
            if !successful || body.get("error").is_some() { return Err(oauth_error(&body)); }
            flow.device_code = text(&body, "device_code", 4096)?;
            flow.user_code = text(&body, "user_code", 16)?;
            if body["verification_uri"].as_str() != Some(VERIFICATION_URL)
                || !flow.device_code.bytes().all(|b| b.is_ascii_alphanumeric())
                || !flow.user_code.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'-') {
                return Err("github-oauth-response".into());
            }
            let ttl = body["expires_in"].as_i64().filter(|seconds| (1..=3600).contains(seconds)).ok_or("github-oauth-response")?;
            let interval = body["interval"].as_i64().unwrap_or(5);
            if !(1..=600).contains(&interval) { return Err("github-oauth-response".into()); }
            flow.expires_at = now() + ttl * 1000; flow.interval_ms = interval * 1000;
            flow.next_poll_at = now() + flow.interval_ms; flow.phase = "pending".into();
            Ok(())
        }.await;
        {
            let mut slot = self.pending.lock().map_err(storage)?;
            if slot.as_ref().map(|current| &current.id) != Some(&flow.id) { return Err("github-oauth-retired".into()); }
            if let Err(error) = result { flow.phase = "error".into(); flow.error = Some(error); flow.device_code.clear(); }
            self.save(&mut slot, Some(flow))?;
        }
        self.start_worker();
        self.status()
    }

    pub fn cancel(&self, flow_id: &str) -> Result<(), String> {
        let mut slot = self.pending.lock().map_err(storage)?;
        if slot.as_ref().map(|flow| flow.id.as_str()) != Some(flow_id) { return Err("github-oauth-retired".into()); }
        self.save(&mut slot, None)
    }

    pub fn can_open(&self, flow_id: &str) -> Result<(), String> {
        let status = self.status()?;
        if status.phase != "pending" || status.flow_id.as_deref() != Some(flow_id) { return Err("github-oauth-retired".into()); }
        Ok(())
    }

    pub fn start_worker(self: &Arc<Self>) {
        if !self.has_work().unwrap_or(false) { return; }
        if self.worker_running.swap(true, Ordering::SeqCst) { return; }
        let service = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            loop {
                let _ = service.tick().await;
                if !service.has_work().unwrap_or(false) {
                    service.worker_running.store(false,Ordering::SeqCst);
                    // A start racing the retirement either owns a new worker or reuses this one.
                    if service.has_work().unwrap_or(false) && !service.worker_running.swap(true,Ordering::SeqCst) {continue;}
                    break;
                }
                let pending=service.pending.lock().ok().is_some_and(|slot|slot.as_ref().is_some_and(|flow|flow.phase=="pending"));
                tokio::time::sleep(Duration::from_secs(if pending {2} else {30})).await;
            }
        });
    }

    fn has_work(&self)->Result<bool,String> {
        if self.pending.lock().map_err(storage)?.as_ref()
            .is_some_and(|flow|["starting","pending"].contains(&flow.phase.as_str()) && live_flow(flow)) {return Ok(true);}
        let Some(grant)=self.vault.github_oauth_grant()? else {return Ok(false);};
        if grant.account.expires_at.is_none() || grant.refresh_token.is_none()
            || grant.refresh_expires_at.is_some_and(|expires|expires<=now()) {return Ok(false);}
        if self.read_refresh()?.is_some_and(|attempt|attempt.binding==grant.credential_binding
            && attempt.response.is_none() && attempt.observed_at+30_000<=now()) {return Ok(false);}
        Ok(true)
    }

    async fn tick(&self) -> Result<(), String> {
        let Ok(_network) = self.network.try_lock() else { return Ok(()); };
        let flow = {
            let mut slot = self.pending.lock().map_err(storage)?;
            if slot.as_ref().is_some_and(|flow|self.vault.status().ok().and_then(|status|status.github_oauth_account)
                .is_some_and(|account|account.account_id==flow.id)) { self.save(&mut slot,None)?; }
            match slot.as_ref() {
                Some(flow) if flow.phase == "pending" && live_flow(flow) && flow.next_poll_at <= now() => {
                    let mut next = flow.clone();
                    if self.vault.github_credential_binding()? != next.expected_binding {
                        next.phase = "error".into(); next.error = Some("github-oauth-credential-changed".into()); next.device_code.clear();
                        self.save(&mut slot, Some(next))?; return Ok(());
                    }
                    next.next_poll_at = now() + next.interval_ms;
                    self.save(&mut slot, Some(next.clone()))?; Some(next)
                },
                _ => None,
            }
        };
        if let Some(flow) = flow { self.poll(flow).await?; }
        else {
            let authorizing=self.pending.lock().map_err(storage)?.as_ref()
                .is_some_and(|flow|["starting","pending"].contains(&flow.phase.as_str()) && live_flow(flow));
            if !authorizing {self.refresh_if_needed().await?;}
        }
        Ok(())
    }

    async fn poll(&self, mut flow: Pending) -> Result<(), String> {
        let result = async {
            if let Some(body) = flow.token_response.as_ref() {
                return self.parse_grant(body,&flow.id,&flow.client_id,None,flow.token_observed_at.ok_or("github-oauth-response")?).await.map(Some);
            }
            let response = self.http.post(TOKEN_URL).header("Accept","application/json")
                .form(&[("client_id",flow.client_id.as_str()),("device_code",flow.device_code.as_str()),
                    ("grant_type","urn:ietf:params:oauth:grant-type:device_code")]).send().await.map_err(|_| "github-oauth-network".to_string())?;
            let successful = response.status().is_success(); let body = bounded_json(response).await?;
            match body["error"].as_str() {
                Some("authorization_pending") => return Ok(None),
                Some("slow_down") => {
                    let interval = body["interval"].as_i64().map(|seconds|seconds.saturating_mul(1000)).unwrap_or(flow.interval_ms + 5000);
                    flow.interval_ms = interval.max(flow.interval_ms + 5000).min(600_000);
                    flow.next_poll_at = now() + flow.interval_ms; return Ok(None);
                },
                Some(_) => return Err(oauth_error(&body)), _ => {},
            }
            if !successful { return Err("github-oauth-network".into()); }
            flow.token_observed_at = Some(now()); flow.token_response = Some(body.clone());
            {
                let mut slot = self.pending.lock().map_err(storage)?;
                if slot.as_ref().map(|current| &current.id) != Some(&flow.id) { return Err("github-oauth-retired".into()); }
                self.save(&mut slot, Some(flow.clone()))?;
            }
            self.parse_grant(&body, &flow.id, &flow.client_id, None,flow.token_observed_at.unwrap()).await.map(Some)
        }.await;
        let mut slot = self.pending.lock().map_err(storage)?;
        if slot.as_ref().map(|current| &current.id) != Some(&flow.id) { return Ok(()); }
        match result {
            Ok(Some((token, grant))) => {
                self.vault.set_github_oauth_token(&flow.expected_binding, &token, grant)?;
                self.save(&mut slot, None)?;
            },
            Ok(None) => { flow.error = None; self.save(&mut slot, Some(flow))?; },
            Err(error) => {
                if error != "github-oauth-network" { flow.phase = "error".into(); flow.device_code.clear(); flow.token_response=None; }
                flow.error = Some(error); self.save(&mut slot, Some(flow))?;
            },
        }
        Ok(())
    }

    async fn parse_grant(&self, body: &Value, id: &str, client_id: &str, previous: Option<&GitHubOAuthGrant>, issued_at:i64)
        -> Result<(String, GitHubOAuthGrant), String> {
        let token = text(body,"access_token",4096)?;
        if !body["token_type"].as_str().is_some_and(|kind|kind.eq_ignore_ascii_case("bearer"))
            || !token.bytes().all(|byte|byte.is_ascii_graphic()) { return Err("github-oauth-response".into()); }
        let scopes = match body.get("scope") {
            Some(Value::String(scope)) => normalized_scopes(scope)?,
            None => previous.map(|grant|grant.account.scopes.clone()).ok_or("github-oauth-scope")?,
            _ => return Err("github-oauth-scope".into()),
        };
        if !(scopes.iter().any(|scope|scope=="read:user" || scope=="user")
            && scopes.iter().any(|scope|scope=="public_repo" || scope=="repo") && scopes.iter().any(|scope|scope=="workflow")) {
            return Err("github-oauth-scope".into());
        }
        if previous.is_some_and(|grant|grant.account.scopes != scopes) { return Err("github-oauth-scope-changed".into()); }
        let response = self.http.get("https://api.github.com/user").bearer_auth(&token)
            .header("Accept","application/vnd.github+json").header("X-GitHub-Api-Version","2022-11-28")
            .send().await.map_err(|_|"github-oauth-network".to_string())?;
        if !response.status().is_success() { return Err("github-oauth-account".into()); }
        let user = bounded_json(response).await?;
        let login = text(&user,"login",39)?;
        let github_user_id = user["id"].as_u64().filter(|id|*id > 0).ok_or("github-oauth-account")?.to_string();
        if previous.is_some_and(|grant|grant.account.github_user_id != github_user_id) { return Err("github-oauth-account".into()); }
        let account = GitHubOAuthAccount { account_id:id.into(), github_user_id, login, client_id:client_id.into(), scopes,
            authenticated_at: previous.map(|grant|grant.account.authenticated_at).unwrap_or(issued_at), expires_at: expiry(body,"expires_in",issued_at)? };
        let refresh_token = match body.get("refresh_token") {
            Some(Value::String(value)) if !value.is_empty() && value.len() <= 4096 && value.bytes().all(|b|b.is_ascii_graphic()) => Some(value.clone()),
            None => previous.and_then(|grant|grant.refresh_token.clone()), _ => return Err("github-oauth-response".into()),
        };
        let refresh_expires_at = if body.get("refresh_token_expires_in").is_some() { expiry(body,"refresh_token_expires_in",issued_at)? }
            else { previous.and_then(|grant|grant.refresh_expires_at) };
        Ok((token, GitHubOAuthGrant { account, refresh_token, refresh_expires_at, credential_binding:String::new() }))
    }

    async fn refresh_if_needed(&self) -> Result<(), String> {
        let Some(grant) = self.vault.github_oauth_grant()? else {
            if self.vault.namespaced_secret(REFRESH_KEY).map_err(storage)?.is_some() {
                self.vault.remove_namespaced_secret(REFRESH_KEY).map_err(storage)?;
            }
            return Ok(());
        };
        if !grant.account.expires_at.is_some_and(|expires|expires <= now() + 120_000) { return Ok(()); }
        let Some(refresh) = &grant.refresh_token else { return Ok(()); };
        if grant.refresh_expires_at.is_some_and(|expires|expires <= now()) { return Ok(()); }
        let mut attempt = if let Some(attempt)=self.read_refresh()?.filter(|attempt|attempt.binding==grant.credential_binding) {
            // A rotating refresh request with a lost response is not safe to repeat.
            if attempt.response.is_none() || attempt.next_attempt_at>now() { return Ok(()); } attempt
        } else {
            let mut attempt=RefreshAttempt {binding:grant.credential_binding.clone(),observed_at:now(),next_attempt_at:now()+30_000,response:None,error:None};
            self.save_refresh(&attempt)?;
            let received=async {
                let response=self.http.post(TOKEN_URL).header("Accept","application/json")
                    .form(&[("client_id",grant.account.client_id.as_str()),("grant_type","refresh_token"),("refresh_token",refresh.as_str())])
                    .send().await.map_err(|_|"github-oauth-network".to_string())?;
                let successful=response.status().is_success(); let body=bounded_json(response).await?;
                if !successful || body.get("error").is_some() {return Err(oauth_error(&body));} Ok(body)
            }.await;
            match received {Ok(body)=>{attempt.observed_at=now();attempt.response=Some(body);},Err(error)=>{attempt.error=Some(error);}}
            self.save_refresh(&attempt)?; attempt
        };
        let Some(body)=attempt.response.as_ref() else {return Ok(());};
        attempt.next_attempt_at=now()+30_000;
        let result=self.parse_grant(body,&grant.account.account_id,&grant.account.client_id,Some(&grant),attempt.observed_at).await;
        let (token,next)=match result {Ok(grant)=>grant,Err(error)=>{
            attempt.error=Some(error);self.save_refresh(&attempt)?;return Ok(());
        }};
        self.vault.set_github_oauth_token(&grant.credential_binding,&token,next)?;
        self.vault.remove_namespaced_secret(REFRESH_KEY).map_err(storage)?;
        Ok(())
    }

    fn read_refresh(&self)->Result<Option<RefreshAttempt>,String> {
        self.vault.namespaced_secret(REFRESH_KEY).map_err(storage)?.map(|bytes|{
            if bytes.len()>131_072 {return Err("github-oauth-storage".into());}
            serde_json::from_slice(&bytes).map_err(storage)
        }).transpose()
    }
    fn save_refresh(&self,attempt:&RefreshAttempt)->Result<(),String> {
        self.vault.set_namespaced_secret(REFRESH_KEY,&serde_json::to_vec(attempt).map_err(storage)?).map_err(storage)
    }
}

fn valid_client_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 256 && value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
fn text(value: &Value, key: &str, max: usize) -> Result<String,String> {
    value[key].as_str().filter(|value|!value.is_empty() && value.len() <= max).map(str::to_owned).ok_or_else(||"github-oauth-response".into())
}
fn expiry(body: &Value, key: &str, issued_at:i64) -> Result<Option<i64>,String> {
    body.get(key).map(|value| value.as_i64().filter(|seconds|(1..=63_244_800).contains(seconds))
        .and_then(|seconds|issued_at.checked_add(seconds*1000)).ok_or_else(||"github-oauth-response".to_string())).transpose()
}
fn normalized_scopes(raw: &str) -> Result<Vec<String>,String> {
    let mut scopes: Vec<String> = raw.split(|c:char|c==',' || c.is_ascii_whitespace()).filter(|scope|!scope.is_empty()).map(str::to_owned).collect();
    if scopes.len()>64 || scopes.iter().any(|scope|scope.len()>128 || !scope.bytes().all(|b|b.is_ascii_alphanumeric() || b==b':' || b==b'_' || b==b'-')) {
        return Err("github-oauth-scope".into());
    }
    scopes.sort(); scopes.dedup(); Ok(scopes)
}
fn oauth_error(body:&Value) -> String {
    match body["error"].as_str() {
        Some("access_denied") => "github-oauth-denied", Some("expired_token"|"token_expired") => "github-oauth-expired",
        Some("device_flow_disabled") => "github-oauth-disabled", Some("incorrect_client_credentials") => "github-oauth-client-id",
        Some("invalid_grant"|"bad_refresh_token") => "github-oauth-expired", _ => "github-oauth-response",
    }.into()
}
async fn bounded_json(mut response:reqwest::Response) -> Result<Value,String> {
    let mut bytes=Vec::new();
    while let Some(chunk)=response.chunk().await.map_err(|_|"github-oauth-network".to_string())? {
        if bytes.len()+chunk.len()>65_536 { return Err("github-oauth-response".into()); } bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(invalid)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn received_token_recovery_uses_token_expiry_instead_of_expired_device_code() {
        let mut flow=Pending {id:Uuid::new_v4().to_string(),client_id:"registered-client".into(),device_code:String::new(),
            user_code:"ABCD-EFGH".into(),expires_at:now()-1,interval_ms:5000,next_poll_at:now(),expected_binding:"0".repeat(64),
            phase:"pending".into(),error:None,token_response:Some(json!({"access_token":"protected-issued-token"})),token_observed_at:Some(now()-2000)};
        assert!(live_flow(&flow));
        flow.token_response=Some(json!({"expires_in":1}));assert!(!live_flow(&flow));
        flow.token_response=None;assert!(!live_flow(&flow));
    }
}
