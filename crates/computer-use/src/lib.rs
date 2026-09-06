use serde_json::{json, Value};
use std::ffi::{c_char, CStr, CString};
use std::sync::{Mutex, OnceLock};

#[cfg(any(target_os = "windows", target_os = "linux"))]
mod desktop;

fn error(message: impl ToString) -> Value {
    json!({"content":[{"type":"text","text":message.to_string()}],"isError":true})
}

/// ABI 1: UTF-8 JSON in, owned UTF-8 JSON out. Xgent calls xgent_cua_free once
/// for every non-null response. Panics never unwind over the C ABI boundary.
#[no_mangle]
pub unsafe extern "C" fn xgent_cua_call(request: *const c_char) -> *mut c_char {
    let result = std::panic::catch_unwind(|| {
        if request.is_null() { return error("Empty computer-use request"); }
        let input: Value = match serde_json::from_slice(CStr::from_ptr(request).to_bytes()) {
            Ok(value) => value, Err(error_message) => return error(error_message),
        };
        #[cfg(any(target_os = "windows", target_os = "linux"))]
        {
            static STATE: OnceLock<Mutex<desktop::Desktop>> = OnceLock::new();
            let Ok(mut state) = STATE.get_or_init(Mutex::default).lock() else { return error("Computer-use state is unavailable; restart Xgent"); };
            state.call(input["operation"].as_str().unwrap_or(""), &input["arguments"])
                .unwrap_or_else(error)
        }
        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        { let _ = input; error("Use Xgent's macOS Swift component on this platform") }
    }).unwrap_or_else(|_| error("Native computer use failed; inspect the app before retrying"));
    CString::new(result.to_string()).map(CString::into_raw).unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub unsafe extern "C" fn xgent_cua_free(result: *mut c_char) {
    if !result.is_null() { drop(CString::from_raw(result)); }
}
