//! Watches active workdirs for filesystem and Git changes, then emits
//! debounced invalidation events to the unified frontend.

mod emit;
mod watcher;

use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex};

pub const WORKSPACE_ACTIVITY_EVENT: &str = "workspace:activity";

#[derive(Default)]
struct WatchInner {
    desired: BTreeSet<String>,
    watchers: HashMap<String, watcher::WorkdirWatcherHandle>,
}

pub struct WorkspaceWatchService {
    app_handle: tauri::AppHandle,
    inner: Mutex<WatchInner>,
    // Per-workdir monotonic revision counters. Kept outside WatchInner so they
    // survive watcher teardown/recreation: a re-watched workdir must not
    // restart at 1 (clients treat revision regressions as forced-dirty).
    revisions: Mutex<HashMap<String, u64>>,
}

impl WorkspaceWatchService {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self {
            app_handle,
            inner: Mutex::new(WatchInner::default()),
            revisions: Mutex::new(HashMap::new()),
        }
    }

    /// Replaces the desired workdir set and reconciles active watchers.
    pub fn set_desired(self: &Arc<Self>, workdirs: Vec<String>) {
        let normalized: BTreeSet<String> = workdirs
            .into_iter()
            .map(|workdir| workdir.trim().to_string())
            .filter(|workdir| !workdir.is_empty())
            .collect();

        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        inner.desired = normalized;
        let desired = inner.desired.clone();
        // Dropping a handle stops its watcher (native watcher teardown ends
        // the aggregator; the polling fallback observes the stop flag).
        inner
            .watchers
            .retain(|workdir, _| desired.contains(workdir));
        for workdir in desired {
            if !inner.watchers.contains_key(&workdir) {
                let handle = watcher::spawn_workdir_watcher(workdir.clone(), Arc::downgrade(self));
                inner.watchers.insert(workdir, handle);
            }
        }
    }

    /// Per-workdir monotonic revision. A poisoned lock yields 0, which clients
    /// already treat as a revision regression (forced dirty) — fail-safe.
    pub(crate) fn next_revision(&self, workdir: &str) -> u64 {
        let Ok(mut revisions) = self.revisions.lock() else {
            return 0;
        };
        let counter = revisions.entry(workdir.to_string()).or_insert(0);
        *counter += 1;
        *counter
    }
}
