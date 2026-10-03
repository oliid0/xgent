//! AppKit adapter for the shared, workspace-scoped filesystem commands.
use serde::Deserialize;
use serde::de::DeserializeOwned;
use std::ffi::{CStr, CString, c_char};
use std::path::Path;

extern "C" {
    fn xgent_workspace_file_applications(path: *const c_char) -> *mut c_char;
    fn xgent_workspace_file_application_open(path: *const c_char, application: *const c_char) -> *mut c_char;
    fn xgent_workspace_file_applications_free(pointer: *mut c_char);
}

#[derive(Deserialize)]
struct Application {
    id: String,
    label: String,
}

#[derive(Deserialize)]
struct ApplicationsReply {
    applications: Vec<Application>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct OpenReply {
    ok: bool,
    error: Option<String>,
}

fn file_path(target: &Path) -> Result<CString, String> {
    let path = target.to_str().ok_or("File paths must use valid UTF-8")?;
    CString::new(path).map_err(|_| "File paths cannot contain NUL".to_string())
}

// The only callers pass pointers returned by this adapter's matching Swift exports.
unsafe fn copy_reply<T: DeserializeOwned>(pointer: *mut c_char) -> Result<T, String> {
    if pointer.is_null() { return Err("AppKit did not return an application result".into()); }
    let bytes = unsafe { CStr::from_ptr(pointer).to_bytes().to_vec() };
    unsafe { xgent_workspace_file_applications_free(pointer) };
    serde_json::from_slice(&bytes).map_err(|error| format!("Invalid AppKit application result: {error}"))
}

pub(super) fn applications(target: &Path) -> Result<Vec<serde_json::Value>, String> {
    let path = file_path(target)?;
    let reply: ApplicationsReply = unsafe { copy_reply(xgent_workspace_file_applications(path.as_ptr()))? };
    if let Some(error) = reply.error { return Err(error); }
    Ok(reply.applications.into_iter().map(|application| serde_json::json!({
        "id": application.id, "label": application.label,
    })).collect())
}

pub(super) fn open(target: &Path, application: &str) -> Result<(), String> {
    let path = file_path(target)?;
    let application = CString::new(application).map_err(|_| "Application identifiers cannot contain NUL".to_string())?;
    let reply: OpenReply = unsafe {
        copy_reply(xgent_workspace_file_application_open(path.as_ptr(), application.as_ptr()))?
    };
    if reply.ok { Ok(()) }
    else { Err(reply.error.unwrap_or_else(|| "The selected application could not open this file".into())) }
}
