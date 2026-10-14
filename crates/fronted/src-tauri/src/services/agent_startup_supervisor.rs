//! OS-owned per-user restart registration. No task/provider credentials or elevated account.
//! This registration takes effect at login, not adoption of an already running GUI process.
use serde::Deserialize;
#[cfg(windows)]
use tauri::Manager;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Registration {
    pub registered: bool,
    pub restart_on_failure: bool,
}

#[cfg(windows)]
pub fn observe(app: &tauri::AppHandle) -> Result<Option<Registration>, String> {
    invoke(app, "status").map(Some)
}

#[cfg(any(target_os="macos",target_os="linux"))]
pub fn observe(app: &tauri::AppHandle) -> Result<Option<Registration>, String> { super::agent_startup_unix::observe(app) }

#[cfg(not(any(windows,target_os="macos",target_os="linux")))]
pub fn observe(_app: &tauri::AppHandle) -> Result<Option<Registration>, String> { Ok(None) }

#[cfg(any(target_os="macos",target_os="linux"))]
pub fn set(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> { super::agent_startup_unix::set(app,enabled) }

#[cfg(windows)]
pub fn set(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let observed = invoke(app, if enabled { "enable" } else { "disable" })?;
    if observed.registered != enabled || observed.restart_on_failure != enabled {
        return Err("OS agent registration returned inconsistent policy".into());
    }
    Ok(())
}

#[cfg(windows)]
fn invoke(app: &tauri::AppHandle, mode: &str) -> Result<Registration, String> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::time::Duration;
    use base64::Engine;
    use sha2::{Digest, Sha256};
    use wait_timeout::ChildExt;

    let root = app.path().app_data_dir().map_err(|e|e.to_string())?;
    let identity = format!("{}\0{}", app.config().identifier, root.display());
    let hash = hex::encode(Sha256::digest(identity.as_bytes()));
    let name = format!("Xgent.Agent.{}", &hash[..32]);
    let executable = std::env::current_exe().map_err(|e|e.to_string())?;
    let executable = executable.to_str().ok_or("Agent executable path is not Unicode")?;
    let descriptor = serde_json::json!({"mode":mode,"marker":format!("XgentAgent/v1/{name}"),"name":name,"executable":executable});
    let source = include_str!("agent_startup_windows.ps1");
    let bytes: Vec<u8> = source.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let script = base64::engine::general_purpose::STANDARD.encode(bytes);
    let program = std::path::PathBuf::from(std::env::var_os("SystemRoot").ok_or("Windows system directory unavailable")?)
        .join("System32/WindowsPowerShell/v1.0/powershell.exe");
    if !program.is_file() { return Err("Windows task registration utility unavailable".into()); }
    let mut stdout = tempfile::tempfile().map_err(|e|e.to_string())?;
    let mut stderr = tempfile::tempfile().map_err(|e|e.to_string())?;
    let mut command = Command::new(program);
    crate::runtime::process::configure_child_process_group(&mut command);
    let mut child = command.args(["-NoLogo","-NoProfile","-NonInteractive","-EncodedCommand",&script])
        .env("XGENT_AGENT_REGISTRATION", descriptor.to_string()).stdin(Stdio::null())
        .stdout(stdout.try_clone().map_err(|e|e.to_string())?).stderr(stderr.try_clone().map_err(|e|e.to_string())?)
        .spawn().map_err(|e|e.to_string())?;
    let status = match child.wait_timeout(Duration::from_secs(10)).map_err(|e|e.to_string())? {
        Some(status) => status,
        None => { let _=child.kill(); let _=child.wait(); return Err("OS registration response timed out; observe the actual registration before retrying".into()); },
    };
    use std::io::{Seek, SeekFrom};
    stdout.seek(SeekFrom::Start(0)).map_err(|e|e.to_string())?;
    stderr.seek(SeekFrom::Start(0)).map_err(|e|e.to_string())?;
    if !status.success() {
        let mut error=String::new(); stderr.take(4096).read_to_string(&mut error).map_err(|e|e.to_string())?;
        return Err(format!("OS agent registration failed: {}", error.trim()));
    }
    let mut raw=Vec::new(); stdout.take(65537).read_to_end(&mut raw).map_err(|e|e.to_string())?;
    if raw.len()>65536 { return Err("OS registration observation exceeds its bound".into()); }
    let observed: Registration=serde_json::from_slice(&raw).map_err(|e|format!("Invalid OS registration observation: {e}"))?;
    if observed.restart_on_failure != observed.registered { return Err("Inconsistent OS registration observation".into()); }
    Ok(observed)
}
