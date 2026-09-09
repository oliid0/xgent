use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};
#[cfg(any(target_os = "windows", target_os = "linux"))]
mod desktop;
#[cfg(target_os = "windows")]
pub mod file_handlers;
#[cfg(target_os = "windows")]
mod dpi;
fn error(message: impl ToString) -> Value {
    json!({"content":[{"type":"text","text":message.to_string()}],"isError":true})
}
/// Direct in-process call. The cancellation probe is checked during input bursts.
pub fn call(operation: &str, arguments: &Value, cancelled: &dyn Fn() -> bool) -> Value {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        #[cfg(target_os = "windows")]
        let _dpi = match dpi::PhysicalPixels::enter() {
            Ok(context) => context,
            Err(message) => return error(message),
        };
        #[cfg(any(target_os = "windows", target_os = "linux"))]
        {
            if operation == "capture_preview" { return desktop::capture_preview(arguments).unwrap_or_else(error); }
            static STATE: OnceLock<Mutex<desktop::Desktop>> = OnceLock::new();
            let Ok(mut state) = STATE.get_or_init(Mutex::default).lock() else { return error("Computer-use state unavailable; restart Xgent"); };
            if cancelled() { return error("Cancelled"); }
            state.call(operation, arguments, cancelled).unwrap_or_else(error)
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        { let _ = (operation, arguments, cancelled); error("This platform uses Xgent's Swift implementation") }
    })).unwrap_or_else(|_| error("Native computer use failed; observe before retrying"))
}
