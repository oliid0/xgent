use base64::{engine::general_purpose::STANDARD, Engine};
use sha2::{Digest, Sha256};
use super::*;

pub(crate) const MAX_INPUT_BYTES: usize = 8 * 1024 * 1024;

impl BackgroundInputFile {
    pub(crate) fn verified_bytes(&self) -> Result<Vec<u8>, String> {
        if self.content_base64.len() > (MAX_INPUT_BYTES + 2) / 3 * 4 {
            return Err("Background input exceeds 8 MiB".to_string());
        }
        let bytes = STANDARD.decode(&self.content_base64).map_err(|_| "Invalid background input base64".to_string())?;
        if bytes.len() > MAX_INPUT_BYTES || self.bytes != bytes.len() as u64
            || self.content_hash != hex::encode(Sha256::digest(&bytes)) {
            return Err("Background input failed size/hash verification".to_string());
        }
        Ok(bytes)
    }
}

impl AutomationStore {
    pub(super) fn normalize_background_files(files: &mut Vec<BackgroundInputFile>) -> Result<(), String> {
        if files.len() > 8 { return Err("A background task accepts at most 8 input files".to_string()); }
        let mut names = std::collections::BTreeSet::new();
        let mut total = 0usize;
        for file in files.iter_mut() {
            let stem = file.name.split('.').next().unwrap_or_default().to_ascii_uppercase();
            let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT"))
                    && stem.as_bytes()[3].is_ascii_digit() && stem.as_bytes()[3] != b'0');
            if file.name.is_empty() || file.name.len() > 180 || file.name.ends_with('.') || file.name.ends_with(' ')
                || file.name.chars().any(|c| c.is_control() || "/\\:*?\"<>|".contains(c)) || reserved
                || !names.insert(file.name.to_lowercase()) {
                return Err("Input filenames must be unique portable basenames (up to 180 bytes)".to_string());
            }
            let bytes = file.verified_bytes()?;
            total += bytes.len();
            if total > MAX_INPUT_BYTES { return Err("Background task inputs exceed 8 MiB total".to_string()); }
            file.content_base64 = STANDARD.encode(bytes);
        }
        files.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(())
    }

    pub(super) fn background_input_manifest(execution_id: &str, files: &[BackgroundInputFile]) -> Vec<BackgroundInputManifest> {
        files.iter().map(|file| BackgroundInputManifest {
            relative_path: format!(".xgent-background-inputs/{execution_id}/{}", file.name),
            content_hash: file.content_hash.clone(), bytes: file.bytes,
        }).collect()
    }

    pub fn background_inputs_for_execution(&self, execution_id: &str, lease: Option<&BackgroundExecutionLease>) -> Result<(String, Vec<BackgroundInputFile>), String> {
        let conn = self.lock_conn()?;
        Self::require_background_execution(&conn, execution_id, lease)?;
        let raw: String = conn.query_row("SELECT input_json FROM automation_background_tasks WHERE execution_id = ?1",
            params![execution_id], |row| row.get(0)).map_err(|e| e.to_string())?;
        let mut input: SubmitBackgroundTaskInput = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        Self::normalize_background_files(&mut input.files)?;
        Ok((input.workdir, input.files))
    }

    pub fn require_background_action_lease(&self, execution_id: &str, lease: Option<&BackgroundExecutionLease>) -> Result<(), String> {
        let conn = self.lock_conn()?;
        Self::require_background_execution(&conn, execution_id, lease)
    }
}
