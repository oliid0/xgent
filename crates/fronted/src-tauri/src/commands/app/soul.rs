use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use uuid::Uuid;

const ACTIVE_SOUL_FILE_NAME: &str = "SOUL.md";
const SOUL_LIBRARY_DIR_NAME: &str = "souls";
const SOUL_LIBRARY_INDEX_NAME: &str = "index.json";
const DEFAULT_SOUL_ID: &str = "default";
const SOUL_MAX_BYTES: usize = 64 * 1024;
const DEFAULT_SOUL: &str = r#"---
name: "XGent"
style: ""
lang: "auto"
---

"#;

static SOUL_LIBRARY_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SoulLibraryIndex {
    active_id: String,
    preset_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoulDocumentResponse {
    id: String,
    content: String,
    path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoulLibraryResponse {
    active_id: String,
    presets: Vec<SoulDocumentResponse>,
}

fn app_storage_dir() -> Result<PathBuf, String> {
    crate::services::app_paths::app_storage_dir()
}

fn active_soul_path() -> Result<PathBuf, String> {
    Ok(app_storage_dir()?.join(ACTIVE_SOUL_FILE_NAME))
}

fn soul_library_dir() -> Result<PathBuf, String> {
    Ok(app_storage_dir()?.join(SOUL_LIBRARY_DIR_NAME))
}

fn soul_library_index_path() -> Result<PathBuf, String> {
    Ok(soul_library_dir()?.join(SOUL_LIBRARY_INDEX_NAME))
}

fn validate_preset_id(id: &str) -> Result<&str, String> {
    let id = id.trim();
    if id.is_empty()
        || id.len() > 80
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("Invalid Soul preset id".to_string());
    }
    Ok(id)
}

fn soul_preset_path(id: &str) -> Result<PathBuf, String> {
    let id = validate_preset_id(id)?;
    Ok(soul_library_dir()?.join(format!("{id}.md")))
}

fn validate_content(content: &str) -> Result<(), String> {
    if content.len() > SOUL_MAX_BYTES {
        return Err(format!(
            "SOUL.md is too large ({} bytes; maximum is {SOUL_MAX_BYTES})",
            content.len()
        ));
    }
    if content.contains('\0') {
        return Err("SOUL.md cannot contain null bytes".to_string());
    }
    Ok(())
}

fn read_soul(path: &Path) -> Result<String, String> {
    let content =
        fs::read_to_string(path).map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    validate_content(&content)?;
    Ok(content)
}

fn atomic_write(path: &Path, content: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| format!("Failed to create a temporary file: {error}"))?;
    temporary
        .write_all(content)
        .map_err(|error| format!("Failed to write {}: {error}", path.display()))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("Failed to flush {}: {error}", path.display()))?;
    temporary
        .persist(path)
        .map_err(|error| format!("Failed to replace {}: {}", path.display(), error.error))?;
    Ok(())
}

fn write_index(index: &SoulLibraryIndex) -> Result<(), String> {
    let content = serde_json::to_vec_pretty(index)
        .map_err(|error| format!("Failed to serialize the Soul library: {error}"))?;
    atomic_write(&soul_library_index_path()?, &content)
}

fn ensure_library() -> Result<SoulLibraryIndex, String> {
    let active_path = active_soul_path()?;
    if !active_path.exists() {
        atomic_write(&active_path, DEFAULT_SOUL.as_bytes())?;
    } else if !active_path.is_file() {
        return Err(format!(
            "SOUL.md path is not a file: {}",
            active_path.display()
        ));
    }

    let library_dir = soul_library_dir()?;
    fs::create_dir_all(&library_dir)
        .map_err(|error| format!("Failed to create the Soul library: {error}"))?;
    let index_path = soul_library_index_path()?;
    if !index_path.exists() {
        let content = read_soul(&active_path)?;
        atomic_write(&soul_preset_path(DEFAULT_SOUL_ID)?, content.as_bytes())?;
        let index = SoulLibraryIndex {
            active_id: DEFAULT_SOUL_ID.to_string(),
            preset_ids: vec![DEFAULT_SOUL_ID.to_string()],
        };
        write_index(&index)?;
        return Ok(index);
    }

    let raw = fs::read_to_string(&index_path)
        .map_err(|error| format!("Failed to read the Soul library index: {error}"))?;
    let mut index: SoulLibraryIndex = serde_json::from_str(&raw)
        .map_err(|error| format!("Failed to parse the Soul library index: {error}"))?;
    index.preset_ids.retain(|id| {
        validate_preset_id(id).is_ok()
            && soul_preset_path(id)
                .map(|path| path.is_file())
                .unwrap_or(false)
    });
    index.preset_ids.sort();
    index.preset_ids.dedup();
    if index.preset_ids.is_empty() {
        let content = read_soul(&active_path)?;
        atomic_write(&soul_preset_path(DEFAULT_SOUL_ID)?, content.as_bytes())?;
        index.preset_ids.push(DEFAULT_SOUL_ID.to_string());
    }
    if !index.preset_ids.iter().any(|id| id == &index.active_id) {
        index.active_id = index.preset_ids[0].clone();
    }

    let active_content = read_soul(&soul_preset_path(&index.active_id)?)?;
    atomic_write(&active_path, active_content.as_bytes())?;
    write_index(&index)?;
    Ok(index)
}

fn document_response(id: &str) -> Result<SoulDocumentResponse, String> {
    let path = soul_preset_path(id)?;
    Ok(SoulDocumentResponse {
        id: id.to_string(),
        content: read_soul(&path)?,
        path: path.to_string_lossy().into_owned(),
    })
}

fn library_response(index: &SoulLibraryIndex) -> Result<SoulLibraryResponse, String> {
    let presets = index
        .preset_ids
        .iter()
        .map(|id| document_response(id))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(SoulLibraryResponse {
        active_id: index.active_id.clone(),
        presets,
    })
}

fn with_library_lock<T>(operation: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let _guard = SOUL_LIBRARY_LOCK
        .lock()
        .map_err(|_| "Soul library lock is poisoned".to_string())?;
    operation()
}

#[tauri::command]
pub async fn system_load_soul() -> Result<SoulDocumentResponse, String> {
    tauri::async_runtime::spawn_blocking(|| {
        with_library_lock(|| {
            let index = ensure_library()?;
            document_response(&index.active_id)
        })
    })
    .await
    .map_err(|error| format!("system_load_soul join failed: {error}"))?
}

#[tauri::command]
pub async fn system_list_souls() -> Result<SoulLibraryResponse, String> {
    tauri::async_runtime::spawn_blocking(|| {
        with_library_lock(|| {
            let index = ensure_library()?;
            library_response(&index)
        })
    })
    .await
    .map_err(|error| format!("system_list_souls join failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn system_save_soul(
    content: String,
    preset_id: Option<String>,
) -> Result<SoulDocumentResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_library_lock(|| {
            validate_content(&content)?;
            let mut index = ensure_library()?;
            let id = preset_id.unwrap_or_else(|| index.active_id.clone());
            let id = validate_preset_id(&id)?.to_string();
            if !index.preset_ids.iter().any(|current| current == &id) {
                return Err("Soul preset does not exist".to_string());
            }
            atomic_write(&soul_preset_path(&id)?, content.as_bytes())?;
            if index.active_id == id {
                atomic_write(&active_soul_path()?, content.as_bytes())?;
            }
            index.active_id = id.clone();
            atomic_write(&active_soul_path()?, content.as_bytes())?;
            write_index(&index)?;
            document_response(&id)
        })
    })
    .await
    .map_err(|error| format!("system_save_soul join failed: {error}"))?
}

#[tauri::command]
pub async fn system_create_soul(content: String) -> Result<SoulLibraryResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_library_lock(|| {
            validate_content(&content)?;
            let mut index = ensure_library()?;
            let id = Uuid::new_v4().simple().to_string();
            atomic_write(&soul_preset_path(&id)?, content.as_bytes())?;
            atomic_write(&active_soul_path()?, content.as_bytes())?;
            index.active_id = id.clone();
            index.preset_ids.push(id);
            write_index(&index)?;
            library_response(&index)
        })
    })
    .await
    .map_err(|error| format!("system_create_soul join failed: {error}"))?
}

#[tauri::command]
pub async fn system_select_soul(preset_id: String) -> Result<SoulDocumentResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_library_lock(|| {
            let mut index = ensure_library()?;
            let id = validate_preset_id(&preset_id)?.to_string();
            if !index.preset_ids.iter().any(|current| current == &id) {
                return Err("Soul preset does not exist".to_string());
            }
            let content = read_soul(&soul_preset_path(&id)?)?;
            atomic_write(&active_soul_path()?, content.as_bytes())?;
            index.active_id = id.clone();
            write_index(&index)?;
            document_response(&id)
        })
    })
    .await
    .map_err(|error| format!("system_select_soul join failed: {error}"))?
}

#[tauri::command]
pub async fn system_delete_soul(preset_id: String) -> Result<SoulLibraryResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_library_lock(|| {
            let mut index = ensure_library()?;
            let id = validate_preset_id(&preset_id)?.to_string();
            if index.preset_ids.len() <= 1 {
                return Err("At least one Soul preset must be kept".to_string());
            }
            if !index.preset_ids.iter().any(|current| current == &id) {
                return Err("Soul preset does not exist".to_string());
            }
            fs::remove_file(soul_preset_path(&id)?)
                .map_err(|error| format!("Failed to delete the Soul preset: {error}"))?;
            index.preset_ids.retain(|current| current != &id);
            if index.active_id == id {
                index.active_id = index.preset_ids[0].clone();
                let content = read_soul(&soul_preset_path(&index.active_id)?)?;
                atomic_write(&active_soul_path()?, content.as_bytes())?;
            }
            write_index(&index)?;
            library_response(&index)
        })
    })
    .await
    .map_err(|error| format!("system_delete_soul join failed: {error}"))?
}
