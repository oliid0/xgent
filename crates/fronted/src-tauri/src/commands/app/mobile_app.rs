use std::sync::Mutex;

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePlatformResponse {
    pub platform: &'static str,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileStartupStatus {
    pub phase: String,
    pub failures: Vec<String>,
}

pub struct MobileStartupState(Mutex<MobileStartupStatus>);

impl Default for MobileStartupState {
    fn default() -> Self {
        Self(Mutex::new(MobileStartupStatus {
            phase: "starting".to_string(),
            failures: Vec::new(),
        }))
    }
}

impl MobileStartupState {
    pub(crate) fn finish(&self, failures: Vec<String>) {
        let mut status = self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        status.phase = if failures.is_empty() {
            "ready".to_string()
        } else {
            "degraded".to_string()
        };
        status.failures = failures;
    }

    fn snapshot(&self) -> MobileStartupStatus {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }
}

#[tauri::command]
pub fn app_runtime_platform() -> RuntimePlatformResponse {
    RuntimePlatformResponse {
        platform: if cfg!(target_os = "android") {
            "android"
        } else {
            "ios"
        },
    }
}

#[tauri::command]
pub fn app_mobile_startup_status(
    state: tauri::State<'_, std::sync::Arc<MobileStartupState>>,
) -> MobileStartupStatus {
    state.snapshot()
}
