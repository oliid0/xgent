#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePlatformResponse {
    pub platform: &'static str,
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
