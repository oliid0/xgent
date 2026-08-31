use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use tauri_plugin_mobile_execution::{CancelRequest as MobileCancelRequest, MobileExecutionExt};

use crate::commands::shell::{run_mobile_shell, MobileShellRunInput};
use crate::services::automation::validate::{MAX_HOOK_TIMEOUT_MS, MIN_HOOK_TIMEOUT_MS};
use crate::services::lan_pc_client::LanPcClient;

const DEFAULT_HOOK_SCRIPT_TIMEOUT_MS: u64 = 60_000;
const MAX_REMEMBERED_CANCELLED_SCOPES: usize = 256;

#[derive(Default)]
pub struct MobileHookScopeRegistry {
    state: Mutex<MobileHookScopeState>,
}

#[derive(Default)]
struct MobileHookScopeState {
    active_run_ids: HashMap<String, HashSet<String>>,
    cancelled: HashSet<String>,
    cancelled_order: VecDeque<String>,
}

impl MobileHookScopeRegistry {
    fn register(&self, scope_id: &str, run_id: &str) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "mobile hook scope registry poisoned".to_string())?;
        if state.cancelled.contains(scope_id) {
            return Err("Hook scope has been cancelled.".to_string());
        }
        state
            .active_run_ids
            .entry(scope_id.to_string())
            .or_default()
            .insert(run_id.to_string());
        Ok(())
    }

    fn unregister(&self, scope_id: &str, run_id: &str) {
        if let Ok(mut state) = self.state.lock() {
            if let Some(active) = state.active_run_ids.get_mut(scope_id) {
                active.remove(run_id);
                if active.is_empty() {
                    state.active_run_ids.remove(scope_id);
                }
            }
        }
    }

    fn is_cancelled(&self, scope_id: &str) -> bool {
        self.state
            .lock()
            .map(|state| state.cancelled.contains(scope_id))
            .unwrap_or(true)
    }

    fn cancel(&self, scope_id: &str) -> Result<Vec<String>, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "mobile hook scope registry poisoned".to_string())?;
        if state.cancelled.insert(scope_id.to_string()) {
            state.cancelled_order.push_back(scope_id.to_string());
            while state.cancelled_order.len() > MAX_REMEMBERED_CANCELLED_SCOPES {
                if let Some(evicted) = state.cancelled_order.pop_front() {
                    state.cancelled.remove(&evicted);
                }
            }
        }
        Ok(state
            .active_run_ids
            .remove(scope_id)
            .unwrap_or_default()
            .into_iter()
            .collect())
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn script_with_context(script: String, context: Option<HashMap<String, String>>) -> String {
    let Some(context) = context else {
        return script;
    };
    let mut exports = context
        .into_iter()
        .filter(|(key, _)| {
            key.starts_with("XGENT_")
                && key
                    .chars()
                    .all(|character| character == '_' || character.is_ascii_alphanumeric())
        })
        .collect::<Vec<_>>();
    exports.sort_by(|left, right| left.0.cmp(&right.0));
    let prefix = exports
        .into_iter()
        .map(|(key, value)| format!("export {key}={}", shell_quote(&value)))
        .collect::<Vec<_>>()
        .join("; ");
    if prefix.is_empty() {
        script
    } else {
        format!("{prefix}; {script}")
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn hook_run_script(
    app: AppHandle,
    lan_pc_client: tauri::State<'_, Arc<LanPcClient>>,
    registry: tauri::State<'_, Arc<MobileHookScopeRegistry>>,
    workdir: Option<String>,
    script: String,
    timeout_ms: Option<u64>,
    scope_id: Option<String>,
    context: Option<HashMap<String, String>>,
) -> Result<crate::runtime::shell_types::ShellRunResponse, String> {
    let workdir = workdir
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "A mobile hook requires a workspace directory.".to_string())?;
    let scope_id = scope_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let run_id = format!("hook-{scope_id}-{}", uuid::Uuid::new_v4());
    registry.register(&scope_id, &run_id)?;
    let result = run_mobile_shell(
        app,
        lan_pc_client.inner(),
        MobileShellRunInput {
            workdir,
            command: script_with_context(script, context),
            cwd: None,
            timeout_ms: Some(
                timeout_ms
                    .unwrap_or(DEFAULT_HOOK_SCRIPT_TIMEOUT_MS)
                    .clamp(MIN_HOOK_TIMEOUT_MS, MAX_HOOK_TIMEOUT_MS),
            ),
            max_timeout_ms: Some(MAX_HOOK_TIMEOUT_MS),
            provider_id: None,
            run_id: Some(run_id.clone()),
        },
    )
    .await;
    registry.unregister(&scope_id, &run_id);
    let response = result?;
    if response.exit_code != 0 || response.timed_out || response.cancelled {
        return Err(format!(
            "Mobile hook failed (exit={}, shell={}): {}{}",
            response.exit_code,
            response.shell,
            response.stderr.trim(),
            if response.stdout.trim().is_empty() {
                String::new()
            } else {
                format!("\n{}", response.stdout.trim())
            }
        ));
    }
    Ok(response)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileHookHttpRequest {
    id: String,
    url: String,
    method: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    #[serde(default)]
    body: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileHookHttpResult {
    id: String,
    ok: bool,
    status: Option<u16>,
    duration_ms: u64,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileHookHttpResponse {
    ok: bool,
    results: Vec<MobileHookHttpResult>,
}

#[tauri::command(rename_all = "snake_case")]
pub async fn hook_run_http_requests(
    requests: Vec<MobileHookHttpRequest>,
    scope_id: Option<String>,
    registry: tauri::State<'_, Arc<MobileHookScopeRegistry>>,
) -> Result<MobileHookHttpResponse, String> {
    if requests.is_empty() {
        return Err("A hook requires at least one HTTP request.".to_string());
    }
    let scope_id = scope_id.unwrap_or_default();
    let client = crate::services::system_proxy::cached_client()?;
    let mut results = Vec::with_capacity(requests.len());
    for request in requests {
        if !scope_id.is_empty() && registry.is_cancelled(&scope_id) {
            return Err("Hook scope has been cancelled.".to_string());
        }
        let started = Instant::now();
        let method = reqwest::Method::from_bytes(request.method.as_bytes())
            .map_err(|error| format!("invalid HTTP method: {error}"))?;
        let mut builder = client
            .request(method, &request.url)
            .timeout(std::time::Duration::from_secs(60));
        for (name, value) in &request.headers {
            builder = builder.header(name, value);
        }
        if let Some(body) = request.body {
            builder = builder.json(&body);
        }
        match builder.send().await {
            Ok(response) => {
                let status = response.status().as_u16();
                let ok = (200..400).contains(&status);
                let error = if ok {
                    None
                } else {
                    response
                        .text()
                        .await
                        .ok()
                        .map(|text| text.chars().take(4_000).collect())
                };
                results.push(MobileHookHttpResult {
                    id: request.id,
                    ok,
                    status: Some(status),
                    duration_ms: started.elapsed().as_millis() as u64,
                    error,
                });
            }
            Err(error) => results.push(MobileHookHttpResult {
                id: request.id,
                ok: false,
                status: None,
                duration_ms: started.elapsed().as_millis() as u64,
                error: Some(error.to_string()),
            }),
        }
    }
    Ok(MobileHookHttpResponse {
        ok: results.iter().all(|result| result.ok),
        results,
    })
}

#[tauri::command(rename_all = "snake_case")]
pub async fn hook_cancel_scope(
    app: AppHandle,
    lan_pc_client: tauri::State<'_, Arc<LanPcClient>>,
    registry: tauri::State<'_, Arc<MobileHookScopeRegistry>>,
    scope_id: String,
) -> Result<(), String> {
    let run_ids = registry.cancel(scope_id.trim())?;
    let settings = crate::commands::settings::open_db()
        .and_then(|connection| crate::commands::settings::load_access_settings(&connection))
        .ok();
    for run_id in run_ids {
        let _ = app
            .mobile_execution()
            .cancel(MobileCancelRequest {
                run_id: run_id.clone(),
            });
        if let Some(settings) = settings.as_ref().filter(|settings| {
            settings.prefer_lan_pc_execution && !settings.lan_control_url.trim().is_empty()
        }) {
            let _ = lan_pc_client
                .invoke(
                    Some(&settings.lan_control_url),
                    "shell_cancel",
                    json!({ "run_id": run_id }),
                )
                .await;
        }
    }
    Ok(())
}
