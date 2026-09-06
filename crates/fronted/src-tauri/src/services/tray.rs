//! Minimal native system-tray menu and its serialized update path.

use std::sync::Mutex;

use serde::Deserialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIcon;
use tauri::AppHandle;

pub const TRAY_SHOW_ID: &str = "tray-show";
pub const TRAY_NEW_CHAT_ID: &str = "tray-new-chat";
pub const TRAY_QUIT_ID: &str = "tray-quit";

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TrayMenuLabels {
    pub show: String,
    pub new_chat: String,
    pub quit: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TrayMenuModel {
    pub labels: TrayMenuLabels,
    pub show_accelerator: Option<String>,
    pub new_chat_accelerator: Option<String>,
    pub tooltip: Option<String>,
    pub badge_text: Option<String>,
}

pub struct TrayMenuHandles {
    apply_lock: Mutex<()>,
    show: MenuItem<tauri::Wry>,
    new_chat: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
    tray_icon: TrayIcon,
}

pub struct TrayMenuSkeleton {
    pub menu: Menu<tauri::Wry>,
    show: MenuItem<tauri::Wry>,
    new_chat: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
}

pub fn build_tray_menu_skeleton(
    app: &tauri::App,
    _app_version: &str,
) -> tauri::Result<TrayMenuSkeleton> {
    let show = MenuItem::with_id(app, TRAY_SHOW_ID, "Open Xgent", true, None::<&str>)?;
    let new_chat = MenuItem::with_id(app, TRAY_NEW_CHAT_ID, "New conversation", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, TRAY_QUIT_ID, "Quit Xgent", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &new_chat, &quit])?;

    Ok(TrayMenuSkeleton {
        menu,
        show,
        new_chat,
        quit,
    })
}

impl TrayMenuHandles {
    pub fn new(skeleton: TrayMenuSkeleton, tray_icon: TrayIcon, _app_version: &'static str) -> Self {
        Self {
            apply_lock: Mutex::new(()),
            show: skeleton.show,
            new_chat: skeleton.new_chat,
            quit: skeleton.quit,
            tray_icon,
        }
    }

    // Pinning remains available through global shortcuts, but is intentionally
    // absent from the reduced tray menu.
    pub fn set_pin_checked(&self, _checked: bool) {}
}

pub fn apply_tray_menu(
    _app: &AppHandle,
    handles: &TrayMenuHandles,
    model: TrayMenuModel,
) -> Result<(), String> {
    let _guard = handles
        .apply_lock
        .lock()
        .map_err(|_| "tray menu apply lock poisoned".to_string())?;
    let err = |error: tauri::Error| format!("tray menu update failed: {error}");

    set_text_if_present(&handles.show, &model.labels.show).map_err(err)?;
    set_text_if_present(&handles.new_chat, &model.labels.new_chat).map_err(err)?;
    set_text_if_present(&handles.quit, &model.labels.quit).map_err(err)?;
    handles
        .show
        .set_accelerator(model.show_accelerator.as_deref())
        .map_err(err)?;
    handles
        .new_chat
        .set_accelerator(model.new_chat_accelerator.as_deref())
        .map_err(err)?;

    if let Err(error) = handles
        .tray_icon
        .set_tooltip(Some(model.tooltip.as_deref().unwrap_or("Xgent")))
    {
        eprintln!("failed to set tray tooltip: {error}");
    }
    #[cfg(target_os = "macos")]
    if let Err(error) = handles.tray_icon.set_title(model.badge_text.as_deref()) {
        eprintln!("failed to set tray title badge: {error}");
    }

    Ok(())
}

fn set_text_if_present(item: &MenuItem<tauri::Wry>, text: &str) -> tauri::Result<()> {
    if text.trim().is_empty() {
        return Ok(());
    }
    item.set_text(text)
}
