//! Unicode clipboard access without launching a console process.
use windows_sys::Win32::Foundation::{GlobalFree, HWND};
use windows_sys::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, GetClipboardData, IsClipboardFormatAvailable,
    OpenClipboard, SetClipboardData,
};
use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE};

const UNICODE_TEXT: u32 = 13; // CF_UNICODETEXT
struct Clipboard;
impl Drop for Clipboard {
    fn drop(&mut self) { unsafe { CloseClipboard(); } }
}
fn open(owner: HWND) -> Result<Clipboard, String> {
    for _ in 0..20 {
        if unsafe { OpenClipboard(owner) } != 0 { return Ok(Clipboard); }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    Err(format!("Cannot open clipboard: {}", std::io::Error::last_os_error()))
}

pub fn read_text() -> Result<String, String> {
    let _clipboard = open(std::ptr::null_mut())?;
    unsafe {
        if IsClipboardFormatAvailable(UNICODE_TEXT) == 0 { return Ok(String::new()); }
        let memory = GetClipboardData(UNICODE_TEXT);
        if memory.is_null() { return Err(std::io::Error::last_os_error().to_string()); }
        let length = GlobalSize(memory) / std::mem::size_of::<u16>();
        let pointer = GlobalLock(memory).cast::<u16>();
        if pointer.is_null() { return Err(std::io::Error::last_os_error().to_string()); }
        let units = std::slice::from_raw_parts(pointer, length);
        let end = units.iter().position(|&unit| unit == 0).unwrap_or(length);
        let result = String::from_utf16_lossy(&units[..end]);
        GlobalUnlock(memory);
        Ok(result)
    }
}

pub fn write_text(owner: usize, text: &str) -> Result<(), String> {
    if owner == 0 { return Err("Clipboard owner window is unavailable".into()); }
    let units: Vec<u16> = text.encode_utf16().chain(Some(0)).collect();
    let _clipboard = open(owner as HWND)?;
    unsafe {
        let memory = GlobalAlloc(GMEM_MOVEABLE, units.len() * std::mem::size_of::<u16>());
        if memory.is_null() { return Err(std::io::Error::last_os_error().to_string()); }
        let pointer = GlobalLock(memory).cast::<u16>();
        if pointer.is_null() {
            GlobalFree(memory);
            return Err("Cannot lock clipboard memory".into());
        }
        std::ptr::copy_nonoverlapping(units.as_ptr(), pointer, units.len());
        GlobalUnlock(memory);
        if EmptyClipboard() == 0 || SetClipboardData(UNICODE_TEXT, memory).is_null() {
            let error = std::io::Error::last_os_error().to_string();
            GlobalFree(memory);
            return Err(error);
        }
        // SetClipboardData transfers ownership to Windows.
        Ok(())
    }
}
