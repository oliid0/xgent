use windows::Win32::UI::HiDpi::{
    SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT,
    DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};

/// DWM and accessibility return physical coordinates. GetWindowRect and input
/// APIs must use the same space, even when an external host is DPI unaware.
/// In particular, xcap crops a capture using DWM bounds minus GetWindowRect:
/// mixing these units cuts real content off at non-100% display scaling.
pub struct PhysicalPixels(DPI_AWARENESS_CONTEXT);

impl PhysicalPixels {
    pub fn enter() -> Result<Self, String> {
        let previous = unsafe {
            SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)
        };
        if previous.0.is_null() {
            return Err(format!("Cannot establish physical-pixel computer-use coordinates: {}", std::io::Error::last_os_error()));
        }
        Ok(Self(previous))
    }
}

impl Drop for PhysicalPixels {
    fn drop(&mut self) {
        // Restore the host's thread context, including on errors and panics.
        unsafe { SetThreadDpiAwarenessContext(self.0); }
    }
}
