use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

const APP_ROOT_NAME: &str = ".xgent";
const DATA_DIR_NAME: &str = "data";
const WEBVIEW_PROFILE_DIR_NAME: &str = "EBWebView";
const LEGACY_WEBVIEW_PARENT_DIR_NAME: &str = "ebwebview";
const LEGACY_APP_IDENTIFIERS: &[&str] = &["com.ohi.xagent", "com.ohi.agent"];

static APP_ROOT: OnceLock<PathBuf> = OnceLock::new();

/// Initializes the one writable XAgent root before databases and services open.
/// Desktop uses `~/.xgent`; mobile passes an OS-sandboxed `.xgent` root.
pub fn initialize(root: PathBuf) -> Result<(), String> {
    validate_root(&root)?;
    fs::create_dir_all(root.join(DATA_DIR_NAME))
        .map_err(|error| format!("Failed to create the XAgent data directory: {error}"))?;
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
    let webview_profile_dir = root.join(WEBVIEW_PROFILE_DIR_NAME);
    let legacy_webview_parent = root.join(LEGACY_WEBVIEW_PARENT_DIR_NAME);
    let home = dirs::home_dir()
        .ok_or_else(|| "Failed to locate the user home directory".to_string())?;
    migrate_directory(&home.join(".xagent"), &data_dir, &mut warnings);

    // An earlier unified-path implementation passed `.xgent/ebwebview` as
    // WebView2's UDF root. WebView2 then appended its own `EBWebView` profile
    // directory. Lift that profile into the real UDF root and remove the
    // redundant parent without discarding any collision data.
    let legacy_nested_profile = legacy_webview_parent.join(WEBVIEW_PROFILE_DIR_NAME);
    let nested_destination = if paths_refer_to_same_entry(
        &legacy_webview_parent,
        &webview_profile_dir,
    ) {
        legacy_webview_parent.clone()
    } else {
        webview_profile_dir.clone()
    };
    migrate_directory(
        &legacy_nested_profile,
        &nested_destination,
        &mut warnings,
    );
    if !paths_refer_to_same_entry(&legacy_webview_parent, &webview_profile_dir) {
        migrate_directory(
            &legacy_webview_parent,
            &webview_profile_dir,
            &mut warnings,
        );
    }
    normalize_windows_directory_case(
        &legacy_webview_parent,
        &webview_profile_dir,
        &mut warnings,
    );

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
                &webview_profile_dir,
                &mut warnings,
            );
            migrate_directory(&legacy_dir, &webview_profile_dir, &mut warnings);
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

/// WebView2 receives the unified application root as its UDF root and creates
/// the standard `EBWebView` profile directly below it. Passing an already
/// suffixed directory would produce a redundant `ebwebview/EBWebView` layer.
pub fn webview_user_data_root() -> Result<PathBuf, String> {
    let root = app_root_dir()?;
    fs::create_dir_all(&root)
        .map_err(|error| format!("Failed to create the XAgent root directory: {error}"))?;
    Ok(root)
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
    if !source.exists()
        || source == destination
        || destination.starts_with(source)
        || paths_refer_to_same_entry(source, destination)
    {
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

fn paths_refer_to_same_entry(left: &Path, right: &Path) -> bool {
    if left == right {
        return true;
    }
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

#[cfg(target_os = "windows")]
fn normalize_windows_directory_case(source: &Path, destination: &Path, warnings: &mut Vec<String>) {
    if !source.exists() || source == destination || !paths_refer_to_same_entry(source, destination) {
        return;
    }
    let actual_name = fs::canonicalize(source)
        .ok()
        .and_then(|path| path.file_name().map(|name| name.to_os_string()));
    if actual_name.as_deref() == destination.file_name() {
        return;
    }
    let Some(parent) = destination.parent() else {
        return;
    };
    let Some(temp) = (1..=10_000)
        .map(|index| parent.join(format!(".xgent-webview-migration-{index}")))
        .find(|candidate| !candidate.exists())
    else {
        warnings.push("Could not allocate a temporary WebView2 migration directory".to_string());
        return;
    };
    if let Err(error) = fs::rename(source, &temp) {
        warnings.push(format!(
            "Could not normalize the WebView2 profile directory name: {error}"
        ));
        return;
    }
    if let Err(error) = fs::rename(&temp, destination) {
        let _ = fs::rename(&temp, source);
        warnings.push(format!(
            "Could not finish normalizing the WebView2 profile directory name: {error}"
        ));
    }
}

#[cfg(not(target_os = "windows"))]
fn normalize_windows_directory_case(
    _source: &Path,
    _destination: &Path,
    _warnings: &mut Vec<String>,
) {
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
        let destination_path = if destination_path.exists() {
            if file_type.is_dir() && destination_path.is_dir() {
                merge_directory(&source_path, &destination_path)?;
                continue;
            }
            legacy_collision_path(&destination_path)?
        } else {
            destination_path
        };

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

/// Preserve a legacy entry that collides with newer data inside the unified
/// root. This keeps the current file authoritative without leaving a second
/// bundle-identifier directory behind after migration.
fn legacy_collision_path(destination: &Path) -> Result<PathBuf, String> {
    let parent = destination
        .parent()
        .ok_or_else(|| "legacy collision destination has no parent".to_string())?;
    let file_name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("legacy-entry");
    for index in 1..=10_000 {
        let candidate = parent.join(format!("{file_name}.legacy-{index}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(format!(
        "could not allocate a legacy collision path for {}",
        destination.display()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_archives_conflicts_and_removes_the_legacy_directory() {
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
            fs::read_to_string(destination.join("keep.txt.legacy-1"))
                .expect("read archived legacy conflict"),
            "legacy"
        );
        assert!(!source.exists());
    }

    #[test]
    fn legacy_webview_contents_move_without_an_extra_ebwebview_layer() {
        let temp = tempfile::tempdir().expect("temp dir");
        let legacy_app_dir = temp.path().join("com.ohi.xagent");
        let legacy_webview_dir = legacy_app_dir.join("EBWebView");
        let destination = temp.path().join(".xgent/EBWebView");
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

    #[test]
    fn redundant_webview_profile_layer_is_lifted_into_its_parent() {
        let temp = tempfile::tempdir().expect("temp dir");
        let misspelled_parent = temp.path().join(".xgent/ebwebview");
        let redundant_profile = misspelled_parent.join("EBWebView");
        fs::create_dir_all(&redundant_profile).expect("create redundant profile");
        fs::write(redundant_profile.join("Preferences"), "profile")
            .expect("write profile preference");

        merge_directory(&redundant_profile, &misspelled_parent).expect("lift profile");

        assert_eq!(
            fs::read_to_string(misspelled_parent.join("Preferences"))
                .expect("read lifted preference"),
            "profile"
        );
        assert!(!redundant_profile.exists());
    }
}
