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
use desktop::MobileExecution;
#[cfg(mobile)]
use mobile::MobileExecution;

pub trait MobileExecutionExt<R: Runtime> {
    fn mobile_execution(&self) -> &MobileExecution<R>;
}

impl<R: Runtime, T: Manager<R>> MobileExecutionExt<R> for T {
    fn mobile_execution(&self) -> &MobileExecution<R> {
        self.state::<MobileExecution<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("mobile-execution")
        .invoke_handler(tauri::generate_handler![
            commands::status,
            commands::install,
            commands::install_toolchains,
            commands::run,
            commands::cancel
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let mobile_execution = mobile::init(app, api)?;
            #[cfg(desktop)]
            let mobile_execution = desktop::init(app, api)?;
            app.manage(mobile_execution);
            Ok(())
        })
        .build()
}
