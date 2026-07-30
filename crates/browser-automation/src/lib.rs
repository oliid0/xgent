use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod commands;
mod error;
mod models;

pub use error::{Error, Result};

#[cfg(desktop)]
use desktop::BrowserAutomation;
#[cfg(mobile)]
use mobile::BrowserAutomation;

pub const BROWSER_RUNTIME_SCRIPT: &str = include_str!("../shared/browser-runtime.js");

pub trait BrowserAutomationExt<R: Runtime> {
    fn browser_automation(&self) -> &BrowserAutomation<R>;
}

impl<R: Runtime, T: Manager<R>> BrowserAutomationExt<R> for T {
    fn browser_automation(&self) -> &BrowserAutomation<R> {
        self.state::<BrowserAutomation<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("browser-automation")
        .invoke_handler(tauri::generate_handler![
            commands::status,
            commands::open_session,
            commands::list_sessions,
            commands::close_session,
            commands::set_viewport,
            commands::action,
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let browser_automation = mobile::init(app, api)?;
            #[cfg(desktop)]
            let browser_automation = desktop::init(app, api)?;
            app.manage(browser_automation);
            Ok(())
        })
        .build()
}
