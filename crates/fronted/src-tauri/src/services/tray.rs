//! Native system-tray menu with a fixed skeleton and one serialized update path.
//! User-provided labels are sanitized before they enter native menus.

use std::sync::Mutex;

use serde::Deserialize;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIcon;
use tauri::AppHandle;

pub const TRAY_STATUS_ID: &str = "tray-status";
pub const TRAY_SHOW_ID: &str = "tray-show";
pub const TRAY_NEW_CHAT_ID: &str = "tray-new-chat";
pub const TRAY_PIN_ID: &str = "tray-pin";
pub const TRAY_RECENT_MENU_ID: &str = "tray-recent-menu";
pub const TRAY_RECENT_VIEW_ALL_ID: &str = "tray-recent-view-all";
pub const TRAY_WORKSPACES_MENU_ID: &str = "tray-workspaces-menu";
pub const TRAY_RUNS_MENU_ID: &str = "tray-runs-menu";
pub const TRAY_RUN_STOP_ALL_ID: &str = "tray-run-stop-all";
pub const TRAY_CRON_MENU_ID: &str = "tray-cron-menu";
pub const TRAY_APPEARANCE_MENU_ID: &str = "tray-appearance-menu";
pub const TRAY_THEME_LIGHT_ID: &str = "tray-theme:light";
pub const TRAY_THEME_DARK_ID: &str = "tray-theme:dark";
pub const TRAY_THEME_SYSTEM_ID: &str = "tray-theme:system";
pub const TRAY_SETTINGS_ID: &str = "tray-settings";
pub const TRAY_CHECK_UPDATES_ID: &str = "tray-check-updates";
pub const TRAY_OPEN_DATA_DIR_ID: &str = "tray-open-data-dir";
pub const TRAY_QUIT_ID: &str = "tray-quit";

pub const TRAY_RECENT_PREFIX: &str = "tray-recent:";
pub const TRAY_WORKSPACE_PREFIX: &str = "tray-ws:";
pub const TRAY_RUN_PREFIX: &str = "tray-run:";
pub const TRAY_CRON_PREFIX: &str = "tray-cron:";

const TRAY_LABEL_MAX_WIDTH: usize = 40;
const TRAY_SUBMENU_MAX_ENTRIES: usize = 20;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayMenuEntry {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub checked: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TrayMenuLabels {
    pub show: String,
    pub new_chat: String,
    pub pin: String,
    pub recent: String,
    pub recent_view_all: String,
    pub workspaces: String,
    pub runs: String,
    pub stop_all: String,
    pub cron: String,
    pub appearance: String,
    pub theme_light: String,
    pub theme_dark: String,
    pub theme_system: String,
    pub settings: String,
    pub check_updates: String,
    pub open_data_dir: String,
    pub quit: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TrayMenuModel {
    pub labels: TrayMenuLabels,
    pub status_suffix: Option<String>,
    pub recent: Vec<TrayMenuEntry>,
    pub recent_truncated: bool,
    pub workspaces: Vec<TrayMenuEntry>,
    pub runs: Vec<TrayMenuEntry>,
    pub cron: Vec<TrayMenuEntry>,
    pub theme: String,
    pub show_accelerator: Option<String>,
    pub new_chat_accelerator: Option<String>,
    pub tooltip: Option<String>,
    pub badge_text: Option<String>,
}

pub struct TrayMenuHandles {
    apply_lock: Mutex<()>,
    app_version: &'static str,
    status: MenuItem<tauri::Wry>,
    show: MenuItem<tauri::Wry>,
    new_chat: MenuItem<tauri::Wry>,
    pin: CheckMenuItem<tauri::Wry>,
    recent: Submenu<tauri::Wry>,
    workspaces: Submenu<tauri::Wry>,
    runs: Submenu<tauri::Wry>,
    cron: Submenu<tauri::Wry>,
    appearance: Submenu<tauri::Wry>,
    theme_light: CheckMenuItem<tauri::Wry>,
    theme_dark: CheckMenuItem<tauri::Wry>,
    theme_system: CheckMenuItem<tauri::Wry>,
    settings: MenuItem<tauri::Wry>,
    check_updates: MenuItem<tauri::Wry>,
    open_data_dir: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
    tray_icon: TrayIcon,
}

pub struct TrayMenuSkeleton {
    pub menu: Menu<tauri::Wry>,
    status: MenuItem<tauri::Wry>,
    show: MenuItem<tauri::Wry>,
    new_chat: MenuItem<tauri::Wry>,
    pin: CheckMenuItem<tauri::Wry>,
    recent: Submenu<tauri::Wry>,
    workspaces: Submenu<tauri::Wry>,
    runs: Submenu<tauri::Wry>,
    cron: Submenu<tauri::Wry>,
    appearance: Submenu<tauri::Wry>,
    theme_light: CheckMenuItem<tauri::Wry>,
    theme_dark: CheckMenuItem<tauri::Wry>,
    theme_system: CheckMenuItem<tauri::Wry>,
    settings: MenuItem<tauri::Wry>,
    check_updates: MenuItem<tauri::Wry>,
    open_data_dir: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
}

pub fn build_tray_menu_skeleton(
    app: &tauri::App,
    app_version: &str,
) -> tauri::Result<TrayMenuSkeleton> {
    let status = MenuItem::with_id(
        app,
        TRAY_STATUS_ID,
        compose_status_line(app_version, None),
        false,
        None::<&str>,
    )?;
    let show = MenuItem::with_id(app, TRAY_SHOW_ID, "显示主窗口", true, None::<&str>)?;
    let new_chat = MenuItem::with_id(app, TRAY_NEW_CHAT_ID, "新建对话", true, None::<&str>)?;
    let pin = CheckMenuItem::with_id(app, TRAY_PIN_ID, "窗口置顶", true, false, None::<&str>)?;
    let recent = Submenu::with_id(app, TRAY_RECENT_MENU_ID, "最近对话", false)?;
    let workspaces = Submenu::with_id(app, TRAY_WORKSPACES_MENU_ID, "工作空间", false)?;
    let runs = Submenu::with_id(app, TRAY_RUNS_MENU_ID, "运行中", false)?;
    let cron = Submenu::with_id(app, TRAY_CRON_MENU_ID, "定时任务", false)?;
    let theme_light =
        CheckMenuItem::with_id(app, TRAY_THEME_LIGHT_ID, "浅色", true, false, None::<&str>)?;
    let theme_dark =
        CheckMenuItem::with_id(app, TRAY_THEME_DARK_ID, "深色", true, false, None::<&str>)?;
    let theme_system = CheckMenuItem::with_id(
        app,
        TRAY_THEME_SYSTEM_ID,
        "跟随系统",
        true,
        false,
        None::<&str>,
    )?;
    let appearance = Submenu::with_id_and_items(
        app,
        TRAY_APPEARANCE_MENU_ID,
        "外观",
        true,
        &[&theme_light, &theme_dark, &theme_system],
    )?;
    let settings = MenuItem::with_id(app, TRAY_SETTINGS_ID, "设置…", true, None::<&str>)?;
    let check_updates =
        MenuItem::with_id(app, TRAY_CHECK_UPDATES_ID, "检查更新…", true, None::<&str>)?;
    let open_data_dir =
        MenuItem::with_id(app, TRAY_OPEN_DATA_DIR_ID, "打开数据目录", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, TRAY_QUIT_ID, "退出 Xgent", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &status,
            &PredefinedMenuItem::separator(app)?,
            &show,
            &new_chat,
            &pin,
            &PredefinedMenuItem::separator(app)?,
            &recent,
            &workspaces,
            &PredefinedMenuItem::separator(app)?,
            &runs,
            &cron,
            &PredefinedMenuItem::separator(app)?,
            &appearance,
            &settings,
            &check_updates,
            &open_data_dir,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    Ok(TrayMenuSkeleton {
        menu,
        status,
        show,
        new_chat,
        pin,
        recent,
        workspaces,
        runs,
        cron,
        appearance,
        theme_light,
        theme_dark,
        theme_system,
        settings,
        check_updates,
        open_data_dir,
        quit,
    })
}

impl TrayMenuHandles {
    pub fn new(skeleton: TrayMenuSkeleton, tray_icon: TrayIcon, app_version: &'static str) -> Self {
        Self {
            apply_lock: Mutex::new(()),
            app_version,
            status: skeleton.status,
            show: skeleton.show,
            new_chat: skeleton.new_chat,
            pin: skeleton.pin,
            recent: skeleton.recent,
            workspaces: skeleton.workspaces,
            runs: skeleton.runs,
            cron: skeleton.cron,
            appearance: skeleton.appearance,
            theme_light: skeleton.theme_light,
            theme_dark: skeleton.theme_dark,
            theme_system: skeleton.theme_system,
            settings: skeleton.settings,
            check_updates: skeleton.check_updates,
            open_data_dir: skeleton.open_data_dir,
            quit: skeleton.quit,
            tray_icon,
        }
    }

    pub fn set_pin_checked(&self, checked: bool) {
        if let Err(error) = self.pin.set_checked(checked) {
            eprintln!("failed to sync tray pin checkmark: {error}");
        }
    }
}

pub fn apply_tray_menu(
    app: &AppHandle,
    handles: &TrayMenuHandles,
    model: TrayMenuModel,
) -> Result<(), String> {
    let _guard = handles
        .apply_lock
        .lock()
        .map_err(|_| "tray menu apply lock poisoned".to_string())?;
    let err = |error: tauri::Error| format!("tray menu update failed: {error}");

    handles
        .status
        .set_text(compose_status_line(
            handles.app_version,
            model.status_suffix.as_deref(),
        ))
        .map_err(err)?;
    set_text_if_present(&handles.show, &model.labels.show).map_err(err)?;
    set_text_if_present(&handles.new_chat, &model.labels.new_chat).map_err(err)?;
    set_check_text_if_present(&handles.pin, &model.labels.pin).map_err(err)?;
    set_submenu_text_if_present(&handles.recent, &model.labels.recent).map_err(err)?;
    set_submenu_text_if_present(&handles.workspaces, &model.labels.workspaces).map_err(err)?;
    set_submenu_text_if_present(&handles.runs, &model.labels.runs).map_err(err)?;
    set_submenu_text_if_present(&handles.cron, &model.labels.cron).map_err(err)?;
    set_submenu_text_if_present(&handles.appearance, &model.labels.appearance).map_err(err)?;
    set_check_text_if_present(&handles.theme_light, &model.labels.theme_light).map_err(err)?;
    set_check_text_if_present(&handles.theme_dark, &model.labels.theme_dark).map_err(err)?;
    set_check_text_if_present(&handles.theme_system, &model.labels.theme_system).map_err(err)?;
    set_text_if_present(&handles.settings, &model.labels.settings).map_err(err)?;
    set_text_if_present(&handles.check_updates, &model.labels.check_updates).map_err(err)?;
    set_text_if_present(&handles.open_data_dir, &model.labels.open_data_dir).map_err(err)?;
    set_text_if_present(&handles.quit, &model.labels.quit).map_err(err)?;

    handles
        .show
        .set_accelerator(model.show_accelerator.as_deref())
        .map_err(err)?;
    handles
        .new_chat
        .set_accelerator(model.new_chat_accelerator.as_deref())
        .map_err(err)?;

    if matches!(model.theme.as_str(), "light" | "dark" | "system") {
        handles
            .theme_light
            .set_checked(model.theme == "light")
            .map_err(err)?;
        handles
            .theme_dark
            .set_checked(model.theme == "dark")
            .map_err(err)?;
        handles
            .theme_system
            .set_checked(model.theme == "system")
            .map_err(err)?;
    }

    let recent_trailing = model.recent_truncated.then_some((
        TRAY_RECENT_VIEW_ALL_ID,
        non_empty_or(&model.labels.recent_view_all, "查看全部…"),
    ));
    rebuild_submenu(
        app,
        &handles.recent,
        &model.recent,
        TRAY_RECENT_PREFIX,
        false,
        recent_trailing,
    )
    .map_err(err)?;
    handles
        .recent
        .set_enabled(!model.recent.is_empty())
        .map_err(err)?;

    rebuild_submenu(
        app,
        &handles.workspaces,
        &model.workspaces,
        TRAY_WORKSPACE_PREFIX,
        true,
        None,
    )
    .map_err(err)?;
    handles
        .workspaces
        .set_enabled(!model.workspaces.is_empty())
        .map_err(err)?;

    let runs_trailing = (!model.runs.is_empty()).then_some((
        TRAY_RUN_STOP_ALL_ID,
        non_empty_or(&model.labels.stop_all, "全部停止"),
    ));
    rebuild_submenu(
        app,
        &handles.runs,
        &model.runs,
        TRAY_RUN_PREFIX,
        false,
        runs_trailing,
    )
    .map_err(err)?;
    handles
        .runs
        .set_enabled(!model.runs.is_empty())
        .map_err(err)?;

    rebuild_submenu(
        app,
        &handles.cron,
        &model.cron,
        TRAY_CRON_PREFIX,
        true,
        None,
    )
    .map_err(err)?;
    handles
        .cron
        .set_enabled(!model.cron.is_empty())
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

fn compose_status_line(app_version: &str, status_suffix: Option<&str>) -> String {
    let base = format!("Xgent {app_version}");
    match status_suffix {
        Some(suffix) if !suffix.trim().is_empty() => format!("{base} · {}", suffix.trim()),
        _ => base,
    }
}

fn non_empty_or<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    if value.trim().is_empty() {
        fallback
    } else {
        value
    }
}

fn set_text_if_present(item: &MenuItem<tauri::Wry>, text: &str) -> tauri::Result<()> {
    if text.trim().is_empty() {
        return Ok(());
    }
    item.set_text(text)
}

fn set_check_text_if_present(item: &CheckMenuItem<tauri::Wry>, text: &str) -> tauri::Result<()> {
    if text.trim().is_empty() {
        return Ok(());
    }
    item.set_text(text)
}

fn set_submenu_text_if_present(item: &Submenu<tauri::Wry>, text: &str) -> tauri::Result<()> {
    if text.trim().is_empty() {
        return Ok(());
    }
    item.set_text(text)
}

fn rebuild_submenu(
    app: &AppHandle,
    submenu: &Submenu<tauri::Wry>,
    entries: &[TrayMenuEntry],
    prefix: &str,
    checkable: bool,
    trailing: Option<(&str, &str)>,
) -> tauri::Result<()> {
    while submenu.remove_at(0)?.is_some() {}

    for entry in entries.iter().take(TRAY_SUBMENU_MAX_ENTRIES) {
        let id = format!("{prefix}{}", entry.id);
        let label = sanitize_menu_label(&entry.label, TRAY_LABEL_MAX_WIDTH);
        if checkable {
            let item = CheckMenuItem::with_id(app, id, label, true, entry.checked, None::<&str>)?;
            submenu.append(&item)?;
        } else {
            let item = MenuItem::with_id(app, id, label, true, None::<&str>)?;
            submenu.append(&item)?;
        }
    }

    if let Some((trailing_id, trailing_label)) = trailing {
        if !entries.is_empty() {
            submenu.append(&PredefinedMenuItem::separator(app)?)?;
        }
        let item = MenuItem::with_id(
            app,
            trailing_id,
            sanitize_menu_label(trailing_label, TRAY_LABEL_MAX_WIDTH),
            true,
            None::<&str>,
        )?;
        submenu.append(&item)?;
    }

    Ok(())
}

fn sanitize_menu_label(text: &str, max_width: usize) -> String {
    let mut cleaned = String::with_capacity(text.len());
    let mut pending_space = false;
    for c in text.chars() {
        if c.is_whitespace() || c.is_control() || c == '\u{200B}' {
            if !cleaned.is_empty() {
                pending_space = true;
            }
            continue;
        }
        if pending_space {
            cleaned.push(' ');
            pending_space = false;
        }
        cleaned.push(c);
    }

    let mut out = String::new();
    let mut width = 0usize;
    let mut truncated = false;
    for c in cleaned.chars() {
        let char_width = char_display_width(c);
        if width + char_width > max_width {
            truncated = true;
            break;
        }
        width += char_width;
        out.push(c);
    }
    if truncated {
        while out.ends_with(' ') {
            out.pop();
        }
        out.push('…');
    }
    if out.is_empty() {
        out.push('—');
    }
    out.replace('&', "&&")
}

fn char_display_width(c: char) -> usize {
    match c as u32 {
        0x1100..=0x115F
        | 0x2E80..=0x303E
        | 0x3041..=0x33FF
        | 0x3400..=0x4DBF
        | 0x4E00..=0x9FFF
        | 0xA000..=0xA4CF
        | 0xAC00..=0xD7A3
        | 0xF900..=0xFAFF
        | 0xFE30..=0xFE4F
        | 0xFF00..=0xFF60
        | 0xFFE0..=0xFFE6
        | 0x1F300..=0x1FAFF
        | 0x20000..=0x3FFFD => 2,
        _ => 1,
    }
}
