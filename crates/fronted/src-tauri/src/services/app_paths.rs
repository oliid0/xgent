use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

const APP_ROOT_NAME: &str = ".xgent";
const DATA_DIR_NAME: &str = "data";
const WEBVIEW_DIR_NAME: &str = "ebwebview";
const LEGACY_APP_IDENTIFIERS: &[&str] = &["com.ohi.xagent", "com.ohi.agent"];

static APP_ROOT: OnceLock<PathBuf> = OnceLock::new();

/// Initializes the one writable XAgent root before databases and services open.
/// Desktop uses `~/.xgent`; mobile passes an OS-sandboxed `.xgent` root.
pub fn initialize(root: PathBuf) -> Result<(), String> {
    validate_root(&root)?;
    fs::create_dir_all(root.join(DATA_DIR_NAME))
        .map_err(|error| format!("Failed to create the XAgent data directory: {error}"))?;
    fs::create_dir_all(root.join(WEBVIEW_DIR_NAME))
        .map_err(|error| format!("Failed to create the XAgent webview directory: {error}"))?;
    let canonical = fs::canonicalize(&root)
        .map_err(|error| format!("Failed to resolve the XAgent root directory: {error}"))?;
    if let Some(existing) = APP_ROOT.get() {
        if existing == &canonical {
            return Ok(());
        }
        return Err("The XAgent root directory was already initialized".to_string());
    }
    APP_ROOT
        .set(canonical)
        .map_err(|_| "The XAgent root directory was already initialized".to_string())
}

pub fn initialize_desktop() -> Result<Vec<String>, String> {
    let root = desktop_root_dir()?;
    validate_root(&root)?;
    fs::create_dir_all(&root)
        .map_err(|error| format!("Failed to create the XAgent root directory: {error}"))?;

    let mut warnings = Vec::new();
    let data_dir = root.join(DATA_DIR_NAME);
    let webview_dir = root.join(WEBVIEW_DIR_NAME);
    let home = dirs::home_dir()
        .ok_or_else(|| "Failed to locate the user home directory".to_string())?;
    migrate_directory(&home.join(".xagent"), &data_dir, &mut warnings);

    if let Some(roaming) = dirs::data_dir() {
        for identifier in LEGACY_APP_IDENTIFIERS {
            migrate_directory(&roaming.join(identifier), &data_dir, &mut warnings);
        }
    }
    if let Some(local) = dirs::data_local_dir() {
        for identifier in LEGACY_APP_IDENTIFIERS {
            let legacy_dir = local.join(identifier);
            migrate_directory(
                &legacy_dir.join("EBWebView"),
                &webview_dir,
                &mut warnings,
            );
            migrate_directory(&legacy_dir, &webview_dir, &mut warnings);
        }
    }

    initialize(root)?;
    Ok(warnings)
}

pub fn mobile_root(platform_app_data_dir: &Path) -> PathBuf {
    platform_app_data_dir.join(APP_ROOT_NAME)
}

pub fn app_root_dir() -> Result<PathBuf, String> {
    if let Some(root) = APP_ROOT.get() {
        return Ok(root.clone());
    }
    desktop_root_dir()
}

pub fn app_storage_dir() -> Result<PathBuf, String> {
    let directory = app_root_dir()?.join(DATA_DIR_NAME);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Failed to create the XAgent data directory: {error}"))?;
    Ok(directory)
}

pub fn webview_data_dir() -> Result<PathBuf, String> {
    let directory = app_root_dir()?.join(WEBVIEW_DIR_NAME);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Failed to create the XAgent webview directory: {error}"))?;
    Ok(directory)
}

fn desktop_root_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|home| home.join(APP_ROOT_NAME))
        .ok_or_else(|| "Failed to locate the user home directory".to_string())
}

fn validate_root(root: &Path) -> Result<(), String> {
    if root.as_os_str().is_empty() || root == Path::new("/") || root.parent().is_none() {
        return Err("Refusing an unsafe XAgent root directory".to_string());
    }
    Ok(())
}

fn migrate_directory(source: &Path, destination: &Path, warnings: &mut Vec<String>) {
    if !source.exists() || source == destination || destination.starts_with(source) {
        return;
    }
    if let Err(error) = merge_directory(source, destination) {
        warnings.push(format!(
            "Could not fully migrate {} to {}: {error}",
            source.display(),
            destination.display()
        ));
    }
}

fn merge_directory(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.is_dir() {
        return Ok(());
    }
    if !destination.exists() {
        if fs::rename(source, destination).is_ok() {
            return Ok(());
        }
    }
    fs::create_dir_all(destination)
        .map_err(|error| format!("create migration destination failed: {error}"))?;

    for entry in
        fs::read_dir(source).map_err(|error| format!("read legacy directory failed: {error}"))?
    {
        let entry = entry.map_err(|error| format!("read legacy entry failed: {error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|error| format!("read legacy entry type failed: {error}"))?;
        if destination_path.exists() {
            if file_type.is_dir() && destination_path.is_dir() {
                merge_directory(&source_path, &destination_path)?;
            }
            continue;
        }

        if fs::rename(&source_path, &destination_path).is_ok() {
            continue;
        }
        if file_type.is_dir() {
            merge_directory(&source_path, &destination_path)?;
        } else if file_type.is_file() {
            fs::copy(&source_path, &destination_path)
                .map_err(|error| format!("copy legacy entry failed: {error}"))?;
            fs::remove_file(&source_path)
                .map_err(|error| format!("remove copied legacy entry failed: {error}"))?;
        } else {
            return Err(format!(
                "could not safely migrate special filesystem entry {}",
                source_path.display()
            ));
        }
    }

    if fs::read_dir(source)
        .map_err(|error| format!("inspect migrated directory failed: {error}"))?
        .next()
        .is_none()
    {
        fs::remove_dir(source)
            .map_err(|error| format!("remove empty legacy directory failed: {error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_merges_without_overwriting_existing_data() {
        let temp = tempfile::tempdir().expect("temp dir");
        let source = temp.path().join("legacy");
        let destination = temp.path().join("current");
        fs::create_dir_all(source.join("nested")).expect("create source");
        fs::create_dir_all(&destination).expect("create destination");
        fs::write(source.join("nested/new.txt"), "new").expect("write source");
        fs::write(source.join("keep.txt"), "legacy").expect("write conflict");
        fs::write(destination.join("keep.txt"), "current").expect("write destination");

        merge_directory(&source, &destination).expect("merge");

        assert_eq!(
            fs::read_to_string(destination.join("nested/new.txt")).expect("read moved file"),
            "new"
        );
        assert_eq!(
            fs::read_to_string(destination.join("keep.txt")).expect("read preserved file"),
            "current"
        );
        assert_eq!(
            fs::read_to_string(source.join("keep.txt")).expect("read legacy conflict"),
            "legacy"
        );
    }

    #[test]
    fn legacy_webview_contents_move_without_an_extra_ebwebview_layer() {
        let temp = tempfile::tempdir().expect("temp dir");
        let legacy_app_dir = temp.path().join("com.ohi.xagent");
        let legacy_webview_dir = legacy_app_dir.join("EBWebView");
        let destination = temp.path().join(".xgent/ebwebview");
        fs::create_dir_all(&legacy_webview_dir).expect("create legacy webview");
        fs::write(legacy_webview_dir.join("Preferences"), "legacy").expect("write preference");

        let mut warnings = Vec::new();
        migrate_directory(&legacy_webview_dir, &destination, &mut warnings);
        migrate_directory(&legacy_app_dir, &destination, &mut warnings);

        assert!(warnings.is_empty());
        assert_eq!(
            fs::read_to_string(destination.join("Preferences")).expect("read migrated preference"),
            "legacy"
        );
        assert!(!destination.join("EBWebView").exists());
        assert!(!legacy_app_dir.exists());
    }
}
