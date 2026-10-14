//! Bounded host-owned observations, never model-supplied commands or install actions.
use serde::{Deserialize, Serialize};

pub const CAPABILITIES: &[&str] = &["git", "node", "python", "java", "javac", "xcode", "swift", "android-sdk"];
pub const PLATFORMS: &[&str] = &["windows", "macos", "linux"];

pub fn valid_model_skill(skill: &str) -> bool {
    !skill.is_empty() && skill.len() <= 48 && skill.as_bytes()[0].is_ascii_lowercase()
        && skill.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_' || c == b'-')
}

pub fn configured_model_skills(model: &serde_json::Value) -> Vec<String> {
    let mut skills: Vec<String> = Vec::new();
    for skill in model.get("delegationSkills").and_then(serde_json::Value::as_array).into_iter().flatten().filter_map(serde_json::Value::as_str) {
        if valid_model_skill(skill) && !skills.iter().any(|saved| saved == skill) {
            skills.push(skill.to_string());
            if skills.len() == 16 { break; }
        }
    }
    skills
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerRequirements {
    #[serde(default)] pub capabilities: Vec<String>,
    #[serde(default)] pub platforms: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")] pub model_skills: Vec<String>,
}
impl WorkerRequirements {
    pub fn normalize(&mut self) -> Result<(), String> {
        if self.capabilities.len() > CAPABILITIES.len() || self.platforms.len() > PLATFORMS.len()
            || self.capabilities.iter().any(|id| !CAPABILITIES.contains(&id.as_str()))
            || self.platforms.iter().any(|id| !PLATFORMS.contains(&id.as_str()))
            || self.model_skills.len() > 16 || self.model_skills.iter().any(|id| !valid_model_skill(id))
            || (self.capabilities.is_empty() && self.platforms.is_empty() && self.model_skills.is_empty()) {
            return Err("Task requirements must name supported toolchains/platforms; arbitrary capability claims are unavailable".into());
        }
        self.capabilities.sort(); self.capabilities.dedup(); self.platforms.sort(); self.platforms.dedup();
        self.model_skills.sort(); self.model_skills.dedup();
        Ok(())
    }
    pub fn check(&self, platform: &str, inventory: Option<&WorkerInventory>, now: i64) -> Result<(), String> {
        if !self.platforms.is_empty() && !self.platforms.iter().any(|p| p == platform) {
            return Err("Execution host does not match the task's required platform".into());
        }
        if self.capabilities.is_empty() { return Ok(()); }
        let inventory = inventory.ok_or_else(|| "Execution host has no observed toolchain inventory".to_string())?;
        inventory.validate()?;
        if now < inventory.observed_at || now > inventory.valid_until { return Err("Execution host toolchain evidence expired; refresh its inventory".into()); }
        for id in &self.capabilities {
            if !inventory.capabilities.iter().any(|item| item.id == *id && item.state == "available") {
                return Err(format!("Execution host lacks observed capability {id}; no new task accepted"));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerCapability { pub id: String, pub state: String, pub evidence: String, pub detail: String }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerInventory { pub version: u32, pub observed_at: i64, pub valid_until: i64, pub capabilities: Vec<WorkerCapability> }
impl WorkerInventory {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1 || self.observed_at < 0 || self.valid_until <= self.observed_at || self.valid_until - self.observed_at > 60_000
            || self.capabilities.len() > CAPABILITIES.len()
            || self.capabilities.iter().any(|item| !CAPABILITIES.contains(&item.id.as_str()) || !matches!(item.state.as_str(), "available" | "unavailable" | "unknown")
                || !matches!(item.evidence.as_str(), "version-command" | "sdk-layout" | "policy") || item.detail.len() > 2048)
            || self.capabilities.iter().map(|item| &item.id).collect::<std::collections::BTreeSet<_>>().len() != self.capabilities.len() {
            return Err("Invalid or unbounded worker inventory".into());
        }
        Ok(())
    }
}

#[cfg(desktop)]
mod desktop {
    use super::*;
    use std::{path::PathBuf, process::Stdio, sync::{Arc, Mutex, OnceLock}, time::Duration};
    use tokio::io::AsyncReadExt;

    #[derive(Default)]
    struct Cache { value: Mutex<Option<(Vec<Option<std::ffi::OsString>>, WorkerInventory)>>, refresh: tokio::sync::Mutex<()> }
    fn cache() -> &'static Cache { static CACHE: OnceLock<Cache> = OnceLock::new(); CACHE.get_or_init(Cache::default) }
    fn key() -> Vec<Option<std::ffi::OsString>> {
        ["PATH", "JAVA_HOME", "ANDROID_HOME", "ANDROID_SDK_ROOT", "DEVELOPER_DIR"].iter().map(std::env::var_os).collect()
    }
    pub fn cached() -> Option<WorkerInventory> {
        let key = key(); let now = crate::services::automation::db::now_ms();
        cache().value.lock().ok()?.as_ref().filter(|(saved, inventory)| *saved == key && now >= inventory.observed_at && now <= inventory.valid_until).map(|(_, inventory)| inventory.clone())
    }
    fn item(id: &str, state: &str, evidence: &str, detail: &str) -> WorkerCapability {
        WorkerCapability { id: id.into(), state: state.into(), evidence: evidence.into(), detail: detail.chars().take(512).collect() }
    }
    async fn disk_read<T: Send + 'static>(operation: impl FnOnce() -> T + Send + 'static) -> Option<T> {
        // A timed-out filesystem syscall cannot be cancelled. Keep its permit
        // until the real blocking operation ends so refreshes cannot pile up.
        static IO_SLOTS: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
        let permit = IO_SLOTS.get_or_init(|| Arc::new(tokio::sync::Semaphore::new(4))).clone().try_acquire_owned().ok()?;
        tokio::time::timeout(Duration::from_millis(500), tauri::async_runtime::spawn_blocking(move || { let _permit = permit; operation() })).await.ok()?.ok()
    }
    fn executable(name: &str) -> Option<PathBuf> {
        let filename = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
        let java = ["java", "javac"].contains(&name).then(|| std::env::var_os("JAVA_HOME")).flatten().map(|p| PathBuf::from(p).join("bin"));
        let paths = std::env::var_os("PATH").unwrap_or_default();
        java.into_iter().chain(std::env::split_paths(&paths)).take(128)
            .filter(|p| p.is_absolute() && !p.to_string_lossy().contains("WindowsApps"))
            .map(|p| p.join(&filename)).find(|p| p.is_file())
    }
    async fn version(id: &str, program: &str, args: &[&str], apple_ready: bool) -> WorkerCapability {
        let program = program.to_string();
        let Some(resolved) = disk_read(move || executable(&program)).await else { return item(id, "unknown", "version-command", "Executable lookup timed out or filesystem probe slots are occupied"); };
        let Some(path) = resolved else { return item(id, "unavailable", "version-command", "Executable not found in absolute host PATH/JAVA_HOME entries"); };
        if cfg!(target_os = "macos") && !apple_ready && [PathBuf::from("/usr/bin/git"), PathBuf::from("/usr/bin/python3")].contains(&path) {
            return item(id, "unknown", "version-command", "Apple system tool launcher skipped without an active developer directory");
        }
        let mut command = tokio::process::Command::new(path);
        command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
        #[cfg(windows)] command.creation_flags(0x08000000); // CREATE_NO_WINDOW, same policy as runtime/process.rs.
        let Ok(mut child) = command.spawn() else { return item(id, "unknown", "version-command", "Version probe could not start"); };
        let stdout = child.stdout.take().unwrap(); let stderr = child.stderr.take().unwrap();
        let read = async move {
            let mut out = Vec::new(); let mut err = Vec::new();
            let mut stdout = stdout.take(4097); let mut stderr = stderr.take(4097);
            let (a, b) = tokio::join!(stdout.read_to_end(&mut out), stderr.read_to_end(&mut err));
            a?; b?; Ok::<_, std::io::Error>((out, err))
        };
        let observed = tokio::time::timeout(Duration::from_secs(2), async { tokio::join!(child.wait(), read) }).await;
        match observed {
            Ok((Ok(status), Ok((out, err)))) if out.len() <= 4096 && err.len() <= 4096 => {
                let detail = format!("{}{}", String::from_utf8_lossy(&out), String::from_utf8_lossy(&err));
                if status.success() && !detail.trim().is_empty() { item(id, "available", "version-command", detail.trim()) }
                else { item(id, "unavailable", "version-command", "Version probe failed or returned no evidence") }
            }
            _ => {
                // Reap the direct child after timeout/overflow/read error. No shells or wrappers are spawned.
                let _ = tokio::time::timeout(Duration::from_millis(500), child.kill()).await;
                item(id, "unknown", "version-command", "Version probe timed out, exceeded output bound or failed")
            }
        }
    }
    fn android() -> WorkerCapability {
        let home = std::env::var_os("ANDROID_HOME"); let legacy = std::env::var_os("ANDROID_SDK_ROOT");
        if home.is_some() && legacy.is_some() && home != legacy { return item("android-sdk", "unknown", "sdk-layout", "ANDROID_HOME and deprecated ANDROID_SDK_ROOT disagree"); }
        let Some(root) = home.or(legacy).map(PathBuf::from).filter(|p| p.is_absolute()) else { return item("android-sdk", "unavailable", "sdk-layout", "No absolute Android SDK environment root"); };
        let contains = |folder: &str, marker: &str| std::fs::read_dir(root.join(folder)).ok().into_iter().flatten().take(128).filter_map(Result::ok).any(|entry| entry.path().join(marker).is_file());
        let adb = if cfg!(windows) { "adb.exe" } else { "adb" };
        let aapt = if cfg!(windows) { "aapt2.exe" } else { "aapt2" };
        if root.join("platform-tools").join(adb).is_file() && contains("platforms", "android.jar") && contains("build-tools", aapt) {
            item("android-sdk", "available", "sdk-layout", "Observed platform-tools/adb, platforms/android.jar and build-tools/aapt2. Project SDK version, licenses, Gradle and signing remain task-specific checks.")
        } else { item("android-sdk", "unavailable", "sdk-layout", "SDK platform, build-tools or platform-tools markers missing") }
    }
    pub async fn observe(allowed: bool) -> WorkerInventory {
        if !allowed {
            let now = crate::services::automation::db::now_ms();
            return WorkerInventory { version: 1, observed_at: now, valid_until: now + 60_000, capabilities: CAPABILITIES.iter().map(|id| item(id, "unknown", "policy", "Host local capability policy does not authorize probing")).collect() };
        }
        let _guard = cache().refresh.lock().await;
        if let Some(inventory) = cached() { return inventory; }
        let observed_key = key();
        // Avoid Apple's tool-install launchers when no active developer directory exists.
        let developer = if cfg!(target_os = "macos") {
            let selected = if let Some(path) = std::env::var_os("DEVELOPER_DIR") { Some(PathBuf::from(path)) }
                else { let selected = version("xcode-select", "xcode-select", &["-p"], false).await; (selected.state == "available").then(|| PathBuf::from(selected.detail.trim())) };
            match selected { Some(path) if path.is_absolute() => disk_read(move || path.is_dir()).await.unwrap_or(false), _ => false }
        } else { false };
        let probes = [("git", "git", "--version"), ("node", "node", "--version"), ("python", if cfg!(windows) { "python" } else { "python3" }, "--version"),
            ("java", "java", "-version"), ("javac", "javac", "-version"), ("xcode", "xcodebuild", "-version"), ("swift", "swift", "--version")];
        use futures_util::{stream, StreamExt};
        let mut capabilities: Vec<_> = stream::iter(probes).map(|(id, program, argument)| async move {
            if (id == "xcode" || (id == "swift" && cfg!(target_os = "macos"))) && !developer { item(id, "unavailable", "version-command", "No active Apple developer directory observed") }
            else { version(id, program, &[argument], developer).await }
        }).buffer_unordered(4).collect().await;
        capabilities.push(disk_read(android).await.unwrap_or_else(|| item("android-sdk", "unknown", "sdk-layout", "SDK observation timed out or filesystem probe slots are occupied")));
        capabilities.sort_by(|a, b| a.id.cmp(&b.id));
        if observed_key != key() { capabilities = CAPABILITIES.iter().map(|id| item(id, "unknown", "policy", "Host environment changed during observation; refresh before choosing")).collect(); }
        let now = crate::services::automation::db::now_ms();
        let inventory = WorkerInventory { version: 1, observed_at: now, valid_until: now + 60_000, capabilities };
        if observed_key == key() { if let Ok(mut value) = cache().value.lock() { *value = Some((observed_key, inventory.clone())); } }
        inventory
    }
}
#[cfg(desktop)] pub use desktop::{cached, observe};

#[cfg(test)]
mod tests {
    use super::*;
    fn observed() -> WorkerInventory { WorkerInventory { version: 1, observed_at: 100, valid_until: 60_100, capabilities: vec![WorkerCapability { id: "xcode".into(), state: "available".into(), evidence: "version-command".into(), detail: "Actual version output".into() }] } }
    #[test]
    fn requirements_normalize_and_reject_unsupported_claims() {
        let mut requirements = WorkerRequirements { capabilities: vec!["node".into(), "git".into(), "node".into()], platforms: vec![], model_skills: vec![] };
        requirements.normalize().unwrap(); assert_eq!(requirements.capabilities, vec!["git", "node"]);
        requirements.capabilities.push("invented-connector".into()); assert!(requirements.normalize().is_err());
    }
    #[test]
    fn expired_missing_unknown_and_wrong_platform_evidence_never_admit_requirements() {
        let requirements = WorkerRequirements { capabilities: vec!["xcode".into()], platforms: vec!["macos".into()], model_skills: vec![] };
        let mut inventory = observed(); assert!(requirements.check("macos", Some(&inventory), 101).is_ok());
        assert!(requirements.check("windows", Some(&inventory), 101).is_err()); assert!(requirements.check("macos", None, 101).is_err());
        assert!(requirements.check("macos", Some(&inventory), 60_101).is_err()); inventory.capabilities[0].state = "unknown".into();
        assert!(requirements.check("macos", Some(&inventory), 101).is_err());
    }
    #[test]
    fn remote_inventory_rejects_duplicate_unbounded_and_invented_capabilities() {
        let mut inventory = observed(); inventory.capabilities.push(inventory.capabilities[0].clone()); assert!(inventory.validate().is_err());
        let mut inventory = observed(); inventory.valid_until += 1; assert!(inventory.validate().is_err());
        let mut inventory = observed(); inventory.capabilities[0].id = "invented".into(); assert!(inventory.validate().is_err());
    }
}
