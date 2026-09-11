//! Native presentation transport. Application actions stay in the shared runtime.

#[cfg(any(target_os = "macos", target_os = "ios"))]
static NAVIGATION_GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[cfg(any(target_os = "macos", target_os = "ios"))]
extern "C" {
    fn xgent_native_ui_reset(webview: *mut std::ffi::c_void);
    fn xgent_native_ui_update(
        webview: *mut std::ffi::c_void,
        controller: *mut std::ffi::c_void,
        payload: *const std::ffi::c_char,
        action_result: bool,
    ) -> i32;
}

// A document reload destroys the JS action registry. Retiring the native host
// at the matching navigation boundary prevents old controls from targeting it.
#[cfg(any(target_os = "macos", target_os = "ios"))]
pub(crate) fn reset_for_navigation(webview: &tauri::Webview) {
    if webview.label() != "main" {
        return;
    }
    NAVIGATION_GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    if let Err(error) = webview.with_webview(|platform| unsafe {
        xgent_native_ui_reset(platform.inner());
    }) {
        eprintln!("failed to retire native presentation for navigation: {error}");
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
async fn deliver(
    window: tauri::Webview,
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
    let generation = NAVIGATION_GENERATION.load(std::sync::atomic::Ordering::SeqCst);
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .with_webview(move |platform| {
            // A snapshot queued by the previous document cannot recreate its
            // retired host after a navigation has started.
            if generation != NAVIGATION_GENERATION.load(std::sync::atomic::Ordering::SeqCst) {
                let _ = sender.send(3);
                return;
            }
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
        3 => Err("Native presentation belongs to a previous page".into()),
        _ => Err("Native presentation rejected an invalid document".into()),
    }
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
async fn deliver(
    _window: tauri::Webview,
    _payload: serde_json::Value,
    _action_result: bool,
) -> Result<(), String> {
    Err("SwiftUI presentation requires an Apple application target".into())
}

#[tauri::command]
pub async fn apple_ui_update(
    window: tauri::Webview,
    payload: serde_json::Value,
) -> Result<(), String> {
    deliver(window, payload, false).await
}

#[tauri::command]
pub async fn apple_ui_action_result(
    window: tauri::Webview,
    payload: serde_json::Value,
) -> Result<(), String> {
    deliver(window, payload, true).await
}
