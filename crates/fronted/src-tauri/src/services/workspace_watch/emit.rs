//! Emits workspace activity to every frontend connected to the Tauri runtime.

use serde::Serialize;
use tauri::Emitter;

use super::{WorkspaceWatchService, WORKSPACE_ACTIVITY_EVENT};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceActivityPayload {
    pub workdir: String,
    pub revision: u64,
    pub fs: bool,
    pub git: bool,
    pub changed_paths: Vec<String>,
    pub truncated: bool,
}

impl WorkspaceWatchService {
    pub(crate) fn emit_activity(
        &self,
        workdir: &str,
        fs: bool,
        git: bool,
        changed_paths: Vec<String>,
        truncated: bool,
    ) {
        if !fs && !git {
            return;
        }
        let payload = WorkspaceActivityPayload {
            workdir: workdir.to_string(),
            revision: self.next_revision(workdir),
            fs,
            git,
            changed_paths,
            truncated,
        };

        if let Err(error) = self
            .app_handle
            .emit(WORKSPACE_ACTIVITY_EVENT, payload.clone())
        {
            eprintln!("emit workspace activity failed: {error}");
        }
    }
}
