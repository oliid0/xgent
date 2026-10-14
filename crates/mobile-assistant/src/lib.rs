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

/// Called from the generated iOS main entry before building the Tauri event
/// loop. BGTask registration cannot wait for a WebView/plugin/page to load.
#[cfg(target_os="ios")]
pub fn register_background_results() -> bool {
    extern "C" {fn xgent_result_delivery_register_v1()->i32;fn xgent_event_delivery_register_v1()->i32;}
    unsafe {
        let results=xgent_result_delivery_register_v1()==1;
        let events=xgent_event_delivery_register_v1()==1;
        results && events
    }
}

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
            commands::bluetooth_gatt,
            commands::list_photos,
            commands::read_photo,
            commands::prepare_image_attachment,
            commands::scan_bluetooth,
            commands::read_clipboard,
            commands::write_clipboard,
            commands::open_settings,
            commands::status,
            commands::start_voice_input,
            commands::check_permissions,
            commands::request_permissions,
            commands::get_current_location,
            commands::read_health_steps,
            commands::request_health_metric_permission,
            commands::read_health_samples,
            commands::list_calendar_events,
            commands::list_calendars,
            commands::list_reminders,
            commands::list_contacts,
            commands::list_home_inventory,
            commands::create_calendar_event,
            commands::create_reminder,
            commands::compose_message,
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
