//! Local computer use is linked into Xgent; no runtime component loader.
use super::CuaResponse;
use serde::Serialize;
use serde_json::Value;
#[cfg(target_os = "macos")]
use std::ffi::{CStr, CString};
use std::path::PathBuf;
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    enabled: bool, installed: bool, target: String, version: &'static str,
    permissions_required: bool, host_pid: u32,
}
fn disabled_marker(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // Preserve the per-platform preference across app updates.
    app.path().app_data_dir().map(|path| path.join("computer-use").join("abi1")
        .join(format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)).join("disabled"))
        .map_err(|error| error.to_string())
}
pub fn ensure_available(app: &tauri::AppHandle) -> Result<(), String> {
    if disabled_marker(app)?.is_file() {
        return Err("Computer use is disabled. Enable it in Settings > Computer use.".into());
    }
    Ok(())
}
#[tauri::command]
pub fn cua_status(app: tauri::AppHandle) -> Result<Status, String> {
    Ok(Status { enabled: !disabled_marker(&app)?.is_file(), installed: true,
        target: format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        version: env!("XGENT_APP_VERSION"), permissions_required: cfg!(target_os = "macos"), host_pid: std::process::id() })
}
#[tauri::command]
pub fn cua_set_enabled(app: tauri::AppHandle, enabled: bool) -> Result<Status, String> {
    let marker = disabled_marker(&app)?;
    if enabled {
        match std::fs::remove_file(&marker) {
            Ok(()) => {}, Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
            Err(error) => return Err(error.to_string()),
        }
    } else {
        std::fs::create_dir_all(marker.parent().ok_or("Invalid settings directory")?).map_err(|error| error.to_string())?;
        std::fs::write(marker, b"disabled").map_err(|error| error.to_string())?;
    }
    cua_status(app)
}
#[cfg(any(target_os = "windows", target_os = "linux"))]
pub fn call(operation: &str, arguments: &Value, cancelled: &dyn Fn() -> bool) -> Result<CuaResponse, String> {
    serde_json::from_value(xgent_computer_use::call(operation, arguments, cancelled)).map_err(|error| error.to_string())
}
#[cfg(target_os = "macos")]
extern "C" {
    fn xgent_cua_call(request: *const std::ffi::c_char, cancelled: extern "C" fn(*const std::ffi::c_void) -> bool, context: *const std::ffi::c_void) -> *mut std::ffi::c_char;
    fn xgent_cua_free(result: *mut std::ffi::c_char);
}
#[cfg(target_os = "macos")]
pub fn call(operation: &str, arguments: &Value, cancelled: &dyn Fn() -> bool) -> Result<CuaResponse, String> {
    let request = CString::new(serde_json::json!({"operation":operation,"arguments":arguments}).to_string()).map_err(|error| error.to_string())?;
    unsafe {
        extern "C" fn probe(context: *const std::ffi::c_void) -> bool {
            unsafe { (*(context as *const &dyn Fn() -> bool))() }
        }
        let result = xgent_cua_call(request.as_ptr(), probe, &cancelled as *const _ as *const std::ffi::c_void);
        if result.is_null() { return Err("Computer use returned no state".into()); }
        let response = serde_json::from_slice(CStr::from_ptr(result).to_bytes()).map_err(|error| format!("Invalid computer-use response: {error}"));
        xgent_cua_free(result);
        response
    }
}
