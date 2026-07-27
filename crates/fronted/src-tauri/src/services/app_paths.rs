use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

static APP_STORAGE_ROOT: OnceLock<PathBuf> = OnceLock::new();

/// Pins the writable application root before any database or local service opens.
/// Mobile entry points must call this with Tauri's app-data directory.
pub fn initialize(root: PathBuf) -> Result<(), String> {
    if root.as_os_str().is_empty() || root == Path::new("/") {
        return Err("Refusing an unsafe application data directory".to_string());
    }
    fs::create_dir_all(&root)
        .map_err(|error| format!("Failed to create the application data directory: {error}"))?;
    let canonical = fs::canonicalize(&root)
        .map_err(|error| format!("Failed to resolve the application data directory: {error}"))?;
    if let Some(existing) = APP_STORAGE_ROOT.get() {
        if existing == &canonical {
            return Ok(());
        }
        return Err("The application data directory was already initialized".to_string());
    }
    APP_STORAGE_ROOT
        .set(canonical)
        .map_err(|_| "The application data directory was already initialized".to_string())
}

pub fn app_storage_dir() -> Result<PathBuf, String> {
    if let Some(root) = APP_STORAGE_ROOT.get() {
        return Ok(root.clone());
    }

    // Desktop keeps its existing ~/.xagent layout. Mobile entry points initialize
    // this service from AppHandle::path().app_data_dir() before reaching here.
    let home =
        dirs::home_dir().ok_or_else(|| "Failed to locate the user home directory".to_string())?;
    let root = home.join(format!(".{}", env!("CARGO_PKG_NAME")));
    fs::create_dir_all(&root)
        .map_err(|error| format!("Failed to create the application directory: {error}"))?;
    Ok(root)
}
