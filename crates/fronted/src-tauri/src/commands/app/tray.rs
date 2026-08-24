use std::sync::Arc;

use crate::services::tray::{apply_tray_menu, TrayMenuHandles, TrayMenuModel};

#[tauri::command(rename_all = "snake_case")]
pub async fn app_tray_menu_sync(
    app: tauri::AppHandle,
    model: TrayMenuModel,
    handles: tauri::State<'_, Arc<TrayMenuHandles>>,
) -> Result<(), String> {
    apply_tray_menu(&app, &handles, model)
}
