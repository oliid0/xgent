#[cfg(desktop)]
pub mod app;
#[cfg(desktop)]
pub mod tray;
#[cfg(mobile)]
#[path = "mobile_app.rs"]
pub mod app;
#[cfg(desktop)]
pub mod custom_tools;
pub mod system;
pub mod soul;
#[cfg(desktop)]
pub mod update;
