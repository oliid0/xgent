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
use desktop::MobileAssistant;
#[cfg(mobile)]
use mobile::MobileAssistant;

pub trait MobileAssistantExt<R: Runtime> {
    fn mobile_assistant(&self) -> &MobileAssistant<R>;
}

impl<R: Runtime, T: Manager<R>> MobileAssistantExt<R> for T {
    fn mobile_assistant(&self) -> &MobileAssistant<R> {
        self.state::<MobileAssistant<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("mobile-assistant")
        .invoke_handler(tauri::generate_handler![
            commands::status,
            commands::start_voice_input,
            commands::check_permissions,
            commands::request_permissions,
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let assistant = mobile::init(app, api)?;
            #[cfg(desktop)]
            let assistant = desktop::init(app, api)?;
            app.manage(assistant);
            Ok(())
        })
        .build()
}
