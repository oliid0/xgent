//! Native presentation transport. Application actions stay in the shared runtime.

#[cfg(any(target_os = "macos", target_os = "ios"))]
extern "C" {
    fn xgent_native_ui_update(
        webview: *mut std::ffi::c_void,
        controller: *mut std::ffi::c_void,
        payload: *const std::ffi::c_char,
        action_result: bool,
    ) -> i32;
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
async fn deliver(
    window: tauri::WebviewWindow,
    payload: serde_json::Value,
    action_result: bool,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Native presentation is restricted to the main application window".into());
    }
    let encoded = serde_json::to_string(&payload).map_err(|error| error.to_string())?;
    if encoded.len() > 8 * 1024 * 1024 {
        return Err("Native presentation payload is too large".into());
    }
    let encoded = std::ffi::CString::new(encoded).map_err(|error| error.to_string())?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .with_webview(move |platform| {
            #[cfg(target_os = "ios")]
            let controller = platform.view_controller();
            #[cfg(target_os = "macos")]
            let controller = std::ptr::null_mut();
            // with_webview executes on the UI thread. Swift copies the JSON and
            // retains its hosting controller; neither borrowed pointer escapes.
            let status = unsafe {
                xgent_native_ui_update(platform.inner(), controller, encoded.as_ptr(), action_result)
            };
            let _ = sender.send(status);
        })
        .map_err(|error| error.to_string())?;
    match receiver.await.map_err(|error| error.to_string())? {
        0 => Ok(()),
        1 => Err("Native presentation host is unavailable".into()),
        _ => Err("Native presentation rejected an invalid document".into()),
    }
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
async fn deliver(
    _window: tauri::WebviewWindow,
    _payload: serde_json::Value,
    _action_result: bool,
) -> Result<(), String> {
    Err("SwiftUI presentation requires an Apple application target".into())
}

#[tauri::command]
pub async fn apple_ui_update(
    window: tauri::WebviewWindow,
    payload: serde_json::Value,
) -> Result<(), String> {
    deliver(window, payload, false).await
}

#[tauri::command]
pub async fn apple_ui_action_result(
    window: tauri::WebviewWindow,
    payload: serde_json::Value,
) -> Result<(), String> {
    deliver(window, payload, true).await
}
