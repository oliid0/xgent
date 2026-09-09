//! Windows' own Open With catalog, shared by the workspace file preview.
use std::path::Path;
use serde_json::{json, Value};
use windows::core::{HSTRING, PWSTR};
use windows::Win32::System::Com::{CoInitializeEx, CoTaskMemFree, CoUninitialize, IDataObject, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::Shell::{SHAssocEnumHandlers, SHCreateItemFromParsingName, ASSOC_FILTER_RECOMMENDED, BHID_DataObject, IShellItem};

struct Apartment;
impl Drop for Apartment { fn drop(&mut self) { unsafe { CoUninitialize(); } } }

unsafe fn take_string(value: PWSTR) -> String {
    let text = value.to_string().unwrap_or_default();
    CoTaskMemFree(Some(value.0.cast()));
    text
}

/// Re-enumerate before invoking; IDs never become shell commands or arbitrary executables.
pub fn applications(path: &Path, selected: Option<&str>) -> Result<Vec<Value>, String> {
    let Some(extension) = path.extension().and_then(|ext| ext.to_str()) else {
        return if selected.is_some() { Err("No registered application for this file".into()) } else { Ok(Vec::new()) };
    };
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().map_err(|error| error.to_string())?;
        let _apartment = Apartment;
        let handlers = SHAssocEnumHandlers(&HSTRING::from(format!(".{extension}")), ASSOC_FILTER_RECOMMENDED).map_err(|error| error.to_string())?;
        let mut result = Vec::new();
        for _ in 0..64 {
            let mut next = [None];
            handlers.Next(&mut next, None).map_err(|error| error.to_string())?;
            let Some(handler) = next[0].take() else { break; };
            let id = take_string(handler.GetName().map_err(|error| error.to_string())?);
            let label = take_string(handler.GetUIName().map_err(|error| error.to_string())?);
            if selected.is_some_and(|selected| selected.eq_ignore_ascii_case(&id)) {
                let item: IShellItem = SHCreateItemFromParsingName(&HSTRING::from(path.as_os_str()), None).map_err(|error| error.to_string())?;
                let data: IDataObject = item.BindToHandler(None, &BHID_DataObject).map_err(|error| error.to_string())?;
                handler.Invoke(&data).map_err(|error| error.to_string())?;
                return Ok(Vec::new());
            }
            if !id.is_empty() && !label.is_empty() { result.push(json!({"id":id,"label":label})); }
        }
        if selected.is_some() { return Err("This application is no longer registered for the file. Reopen Open with.".into()); }
        Ok(result)
    }
}
