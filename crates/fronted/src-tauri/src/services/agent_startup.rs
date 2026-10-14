//! Per-user login registration. A running graphical user session is required;
//! Registration uses Task Scheduler/launchd/user systemd failure supervision
//! at login. Graphical user sessions remain required; this is not a headless host.
use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex};

use serde::Serialize;
use tauri::{Emitter, Manager};
use tauri_plugin_autostart::AutoLaunchManager;

pub const BACKGROUND_ARG: &str = "--xgent-agent";
pub const CHANGED_EVENT: &str = "app:agent-startup-changed";

pub struct AgentStartupState {
    pub background_launch: bool,
    show_requested: AtomicBool,
    registration: Mutex<u64>,
}

impl AgentStartupState {
    pub fn new(background_launch: bool) -> Self {
        Self { background_launch, show_requested: AtomicBool::new(!background_launch), registration: Mutex::new(0) }
    }
    pub fn request_show(&self) { self.show_requested.store(true, Ordering::SeqCst); }
    pub fn should_show(&self) -> bool { self.show_requested.load(Ordering::SeqCst) }
}

pub fn is_background_launch<I, S>(args: I) -> bool
where I: IntoIterator<Item = S>, S: AsRef<std::ffi::OsStr> {
    args.into_iter().any(|arg| arg.as_ref() == std::ffi::OsStr::new(BACKGROUND_ARG))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStartupStatus {
    pub revision: u64,
    pub supported: bool,
    pub registered: Option<bool>,
    pub restart_on_failure: bool,
    pub reason: Option<String>,
    pub background_launch: bool,
    pub worker_ready: bool,
    pub observed_at_ms: i64,
}

fn status_locked(app: &tauri::AppHandle, state: &AgentStartupState, revision: u64) -> Result<AgentStartupStatus, String> {
    let manager = app.try_state::<AutoLaunchManager>();
    let reason = if cfg!(debug_assertions) { Some("release_required") }
        else if manager.is_none() { Some("plugin_unavailable") } else { None };
    let supervisor = if reason.is_none() { super::agent_startup_supervisor::observe(app)? } else { None };
    let legacy = if reason.is_none() {
        manager.ok_or("Startup manager unavailable")?.is_enabled().map_err(|e| e.to_string())?
    } else { false };
    let registered = reason.is_none().then_some(legacy || supervisor.as_ref().is_some_and(|state|state.registered));
    Ok(AgentStartupStatus {
        revision, supported: reason.is_none(), registered, reason: reason.map(str::to_string),
        restart_on_failure: !legacy && supervisor.as_ref().is_some_and(|state|state.restart_on_failure),
        background_launch: state.background_launch,
        worker_ready: app.state::<Arc<super::agent_worker::AgentWorkerState>>().ready(),
        observed_at_ms: super::automation::db::now_ms(),
    })
}

pub fn status(app: &tauri::AppHandle) -> Result<AgentStartupStatus, String> {
    let state = app.state::<Arc<AgentStartupState>>();
    let revision = state.registration.lock().map_err(|e| e.to_string())?;
    status_locked(app, &state, *revision)
}

/// The compatible auto-launch 0.5 backend writes unescaped XML/Exec fields.
/// Reject unsupported executable spellings instead of acknowledging a broken
/// login entry. Windows quotes its executable and supports spaces normally.
#[cfg(not(any(windows,target_os="macos",target_os="linux")))]
fn validate_registration_path(app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let path = std::env::current_exe().map_err(|e| e.to_string())?;
        #[cfg(target_os = "linux")]
        let path = app.env().appimage.unwrap_or(path);
        #[cfg(target_os = "macos")]
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        let value = path.to_str().ok_or("Startup registration requires a Unicode executable path")?;
        let unsafe_path = if cfg!(target_os = "macos") { value.chars().any(|c| matches!(c, '&' | '<' | '>')) }
            else { value.chars().any(|c| c.is_whitespace() || "\"'\\`$%<>|;&".contains(c)) };
        if unsafe_path { return Err("This executable path cannot be safely registered by the login backend; move the installed application to a path without special characters".into()); }
    }
    #[cfg(windows)]
    let _ = app;
    Ok(())
}

pub fn set_registered(app: &tauri::AppHandle, enabled: bool) -> Result<AgentStartupStatus, String> {
    let state = app.state::<Arc<AgentStartupState>>();
    let mut revision = state.registration.lock().map_err(|e| e.to_string())?;
    if cfg!(debug_assertions) { return Err("Login registration is available in the installed release application".into()); }
    let manager = app.try_state::<AutoLaunchManager>().ok_or("Startup manager unavailable")?;
    if enabled {
        #[cfg(any(windows,target_os="macos",target_os="linux"))] {
            super::agent_startup_supervisor::set(app,true)?;
            if manager.is_enabled().map_err(|e|e.to_string())? { manager.disable().map_err(|e|e.to_string())?; }
        }
        // Enable rewrites an obsolete executable/arguments registration.
        #[cfg(not(any(windows,target_os="macos",target_os="linux")))] {
            validate_registration_path(app)?;
            manager.enable().map_err(|e| e.to_string())?;
        }
    } else {
        #[cfg(any(windows,target_os="macos",target_os="linux"))] super::agent_startup_supervisor::set(app,false)?;
        if manager.is_enabled().map_err(|e| e.to_string())? {
            // Already disabled is a no-op. Removal errors remain errors; a
            // later status read can reconcile concurrent changes.
            manager.disable().map_err(|e| e.to_string())?;
        }
    }
    *revision = revision.saturating_add(1);
    let observed = status_locked(app, &state, *revision)?;
    if observed.registered != Some(enabled) { return Err("OS startup registration did not match the requested state".into()); }
    if let Err(error) = app.emit(CHANGED_EVENT, &observed) { eprintln!("Startup state notification failed: {error}"); }
    Ok(observed)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_exact_background_flag_suppresses_initial_gui_and_user_reopen_is_sticky() {
        assert!(is_background_launch(["xgent", BACKGROUND_ARG]));
        assert!(!is_background_launch(["xgent", "--xgent-agent=false", "--other"]));
        let normal = AgentStartupState::new(false); assert!(normal.should_show());
        let startup = AgentStartupState::new(true); assert!(!startup.should_show());
        startup.request_show(); assert!(startup.should_show());
    }
}
