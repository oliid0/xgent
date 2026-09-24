//! Optional Cua Driver installation. The built-in computer-use engine remains separate.
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use wait_timeout::ChildExt;

const UNIX_INSTALL_URL: &str = "https://cua.ai/driver/install.sh";
const WINDOWS_INSTALL_URL: &str = "https://cua.ai/driver/install.ps1";
const INSTALL_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const PROBE_TIMEOUT: Duration = Duration::from_secs(15);
const PROGRESS_EVENT: &str = "cua_driver_install_progress";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallPreview {
    pub program: String,
    pub args: Vec<String>,
    pub display: String,
    pub source_url: String,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverProbe {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub mcp_command: Option<String>,
    pub mcp_args: Vec<String>,
    pub error: Option<String>,
}

#[derive(Clone, Serialize)]
struct InstallProgress {
    stream: &'static str,
    line: String,
}

fn hidden_command(program: &str) -> Command {
    let mut command = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
}

fn install_preview() -> InstallPreview {
    if cfg!(target_os = "windows") {
        let script = format!("irm {WINDOWS_INSTALL_URL} | iex");
        InstallPreview {
            program: "powershell".into(),
            args: vec!["-NoProfile".into(), "-Command".into(), script.clone()],
            display: format!("powershell -NoProfile -Command \"{script}\""),
            source_url: WINDOWS_INSTALL_URL.into(),
        }
    } else {
        // pipefail makes a failed download fail the installation as well.
        let script = format!("set -o pipefail; curl -fsSL {UNIX_INSTALL_URL} | /bin/bash");
        InstallPreview {
            program: "/bin/bash".into(),
            args: vec!["-c".into(), script.clone()],
            display: format!("/bin/bash -c \"{script}\""),
            source_url: UNIX_INSTALL_URL.into(),
        }
    }
}

fn candidate_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(home) = dirs::home_dir() {
        if cfg!(target_os = "windows") {
            paths.push(home.join(".local/bin/cua-driver.exe"));
            paths.push(home.join("AppData/Local/Programs/Cua/cua-driver/bin/cua-driver.exe"));
            paths.push(home.join("AppData/Local/Programs/cua-driver/cua-driver.exe"));
        } else {
            paths.push(home.join(".local/bin/cua-driver"));
            paths.push(home.join(".cua/bin/cua-driver"));
        }
    }
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        paths.push(PathBuf::from(local_app_data).join("Programs/Cua/cua-driver/bin/cua-driver.exe"));
    }
    if !cfg!(target_os = "windows") {
        paths.push(PathBuf::from("/usr/local/bin/cua-driver"));
        paths.push(PathBuf::from("/opt/homebrew/bin/cua-driver"));
        paths.push(PathBuf::from("/Applications/CuaDriver.app/Contents/MacOS/cua-driver"));
    }
    paths
}

fn find_binary() -> Option<PathBuf> {
    if let Some(search_path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&search_path) {
            let candidate = dir.join("cua-driver");
            if candidate.is_file() {
                return Some(candidate);
            }
            if cfg!(target_os = "windows") {
                let candidate = dir.join("cua-driver.exe");
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    candidate_paths().into_iter().find(|path| path.is_file())
}

fn capture_manifest(path: &Path) -> Result<Value, String> {
    let mut child = hidden_command(path.to_string_lossy().as_ref())
        .arg("manifest")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("launch cua-driver manifest failed: {error}"))?;
    let status = match child.wait_timeout(PROBE_TIMEOUT) {
        Ok(Some(status)) => status,
        Ok(None) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("cua-driver manifest timed out".into());
        }
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("wait for cua-driver manifest failed: {error}"));
        }
    };
    let output = child
        .wait_with_output()
        .map_err(|error| format!("read cua-driver manifest failed: {error}"))?;
    if !status.success() {
        return Err(format!(
            "cua-driver manifest exited with {}: {}",
            status.code().unwrap_or(-1),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("parse cua-driver manifest failed: {error}"))
}

fn probe() -> DriverProbe {
    let Some(path) = find_binary() else {
        return DriverProbe::default();
    };
    let absolute = path.to_string_lossy().into_owned();
    let mut result = DriverProbe {
        installed: true,
        path: Some(absolute.clone()),
        mcp_command: Some(absolute.clone()),
        mcp_args: vec!["mcp".into()],
        ..DriverProbe::default()
    };
    match capture_manifest(&path) {
        Ok(manifest) => {
            result.version = manifest
                .get("binary_version")
                .and_then(Value::as_str)
                .map(str::to_owned);
            if let Some(invocation) = manifest.get("mcp_invocation") {
                if let Some(command) = invocation.get("command").and_then(Value::as_str) {
                    if !command.trim().is_empty() {
                        result.mcp_command = Some(if matches!(command, "cua-driver" | "cua-driver.exe") {
                            absolute
                        } else {
                            command.to_owned()
                        });
                    }
                }
                if let Some(args) = invocation.get("args").and_then(Value::as_array) {
                    result.mcp_args = args.iter().filter_map(Value::as_str).map(str::to_owned).collect();
                }
            }
        }
        Err(error) => result.error = Some(error),
    }
    result
}

fn forward_output(app: AppHandle, stream: &'static str, reader: impl Read + Send + 'static) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            let bounded: String = line.chars().take(4_096).collect();
            let _ = app.emit(PROGRESS_EVENT, InstallProgress { stream, line: bounded });
        }
    })
}

fn install(app: &AppHandle) -> Result<DriverProbe, String> {
    static INSTALL_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    let _guard = INSTALL_LOCK
        .get_or_init(|| Mutex::new(()))
        .try_lock()
        .map_err(|_| "cua-driver installation is already running".to_string())?;
    let preview = install_preview();
    let mut child = hidden_command(&preview.program)
        .args(&preview.args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("launch cua-driver installer failed: {error}"))?;
    let stdout = child.stdout.take().map(|reader| forward_output(app.clone(), "stdout", reader));
    let stderr = child.stderr.take().map(|reader| forward_output(app.clone(), "stderr", reader));
    let status = match child.wait_timeout(INSTALL_TIMEOUT) {
        Ok(Some(status)) => status,
        Ok(None) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("cua-driver installation timed out after 15 minutes".into());
        }
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("wait for cua-driver installer failed: {error}"));
        }
    };
    if let Some(handle) = stdout { let _ = handle.join(); }
    if let Some(handle) = stderr { let _ = handle.join(); }
    if !status.success() {
        return Err(format!("cua-driver installer exited with {}", status.code().unwrap_or(-1)));
    }
    let result = probe();
    if !result.installed {
        return Err("installer finished, but cua-driver was not found in the supported install locations".into());
    }
    let _ = app.emit(PROGRESS_EVENT, InstallProgress {
        stream: "done",
        line: result.version.clone().unwrap_or_else(|| "cua-driver installed".into()),
    });
    Ok(result)
}

#[tauri::command]
pub fn cua_driver_install_command() -> InstallPreview {
    install_preview()
}

#[tauri::command]
pub async fn cua_driver_probe() -> Result<DriverProbe, String> {
    tauri::async_runtime::spawn_blocking(probe)
        .await
        .map_err(|error| format!("cua-driver probe failed: {error}"))
}

#[tauri::command]
pub async fn cua_driver_install(app: AppHandle) -> Result<DriverProbe, String> {
    tauri::async_runtime::spawn_blocking(move || install(&app))
        .await
        .map_err(|error| format!("cua-driver installation failed: {error}"))?
}
