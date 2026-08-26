mod commands;
mod runtime;
mod services;

#[cfg(desktop)]
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
#[cfg(desktop)]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
#[cfg(desktop)]
use tauri::Emitter;
use tauri::Manager;
#[cfg(desktop)]
use tauri::WindowEvent;

#[cfg(desktop)]
const MAIN_WINDOW_LABEL: &str = "main";
#[cfg(desktop)]
pub(crate) const WINDOW_STATE_FLAGS: tauri_plugin_window_state::StateFlags =
    tauri_plugin_window_state::StateFlags::SIZE
        .union(tauri_plugin_window_state::StateFlags::MAXIMIZED);
#[cfg(desktop)]
const TRAY_SHOW_MENU_ON_LEFT_CLICK: bool = !cfg!(target_os = "windows");
#[cfg(desktop)]
const TERMINAL_EXIT_REQUESTED_EVENT: &str = "terminal:exit-requested";
#[cfg(desktop)]
const APP_ACTION_EVENT: &str = "app:action";
#[cfg(desktop)]
const APP_ACTION_FEEDBACK_EVENT: &str = "app:action-feedback";

#[cfg(desktop)]
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExitRequestedEvent {
    running_count: usize,
}

#[cfg(desktop)]
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppActionEvent {
    action: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<String>,
}

#[cfg(desktop)]
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppActionFeedbackEvent {
    action: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<String>,
}

pub fn app_version() -> &'static str {
    env!("XAGENT_APP_VERSION")
}

#[cfg(desktop)]
macro_rules! app_invoke_handler {
    () => {
        tauri::generate_handler![
            // Chat history
            commands::chat_history::chat_history_list,
            commands::chat_history::chat_history_workdirs,
            commands::chat_history::chat_history_search,
            commands::chat_history::chat_history_get,
            commands::chat_history::chat_history_get_active_segment,
            commands::chat_history::chat_history_get_window,
            commands::chat_history::chat_history_upsert,
            commands::chat_history::chat_history_upsert_active_segment,
            commands::chat_history::chat_history_append_segment,
            commands::chat_history::chat_history_replace_from_message,
            commands::chat_history::chat_history_rename,
            commands::chat_history::chat_history_branch,
            commands::chat_history::chat_history_set_pinned,
            commands::chat_history::chat_history_set_model,
            commands::chat_history::chat_history_set_cwd,
            commands::chat_history::chat_history_delete,
            commands::chat_history::trajectory_append_events,
            commands::chat_history::trajectory_get_events,
            commands::chat_history::trajectory_get_window,
            commands::chat_history::trajectory_resolve_turn_number,
            commands::chat_history::trajectory_get_subagent_runs,
            commands::chat_history::trajectory_put_sections,
            commands::chat_history::trajectory_get_sections,
            // Subagent store
            commands::subagent_store::subagent_identity_upsert,
            commands::subagent_store::subagent_identity_list,
            commands::subagent_store::subagent_run_save,
            commands::subagent_store::subagent_run_list,
            commands::subagent_store::subagent_run_load,
            commands::subagent_store::subagent_run_prune,
            commands::subagent_store::subagent_message_append,
            commands::subagent_store::subagent_message_list,
            // File system
            commands::fs::fs_read_text,
            commands::fs::fs_read_editable_text,
            commands::fs::fs_path_status,
            commands::fs::fs_read_image_source,
            commands::fs::fs_read_workspace_image,
            commands::fs::fs_write_text,
            commands::fs::fs_edit_text,
            commands::fs::fs_delete,
            commands::fs::fs_open_workspace_path,
            commands::fs::fs_create_dir,
            commands::fs::fs_rename,
            commands::fs::fs_roots,
            commands::fs::fs_list_dirs,
            commands::fs::fs_list,
            commands::fs::fs_glob,
            commands::fs::fs_grep,
            commands::fs::fs_mention_list,
            commands::checkpoint::checkpoint_begin_turn,
            commands::checkpoint::checkpoint_list,
            commands::checkpoint::checkpoint_diff_stats,
            commands::checkpoint::checkpoint_rewind_code,
            commands::checkpoint::checkpoint_clear,
            commands::chat_file_links::open_chat_file_link,
            commands::root_grants::workspace_root_grants_list,
            commands::root_grants::workspace_root_grants_apply,
            commands::root_grants::workspace_root_grants_revoke,
            // Subagent worktrees
            commands::subagent_worktree::subagent_worktree_create,
            commands::subagent_worktree::subagent_worktree_status,
            commands::subagent_worktree::subagent_worktree_apply,
            commands::subagent_worktree::subagent_worktree_cleanup,
            // MCP
            commands::mcp::mcp_list_tools,
            commands::mcp::mcp_call_tool,
            commands::mcp::mcp_cancel_tool,
            commands::mcp::mcp_runtime_status,
            commands::mcp::mcp_stop_server,
            commands::mcp::mcp_test_server,
            commands::mcp::mcp_restart_server,
            // Memory
            commands::memory::memory_list,
            commands::memory::memory_read,
            commands::memory::memory_search,
            commands::memory::memory_write,
            commands::memory::memory_update,
            commands::memory::memory_delete,
            commands::memory::memory_delete_project,
            commands::memory::memory_accept,
            commands::memory::memory_apply_batch,
            commands::memory::memory_organize_run_create,
            commands::memory::memory_organize_run_update,
            commands::memory::memory_organize_run_list,
            commands::memory::memory_organize_run_read,
            commands::memory::memory_organize_run_clear_history,
            commands::memory::memory_organize_due_claim,
            commands::memory::memory_organize_due_complete,
            commands::memory::memory_index_overview,
            commands::memory::memory_paths_info,
            commands::memory::memory_recent_rejections,
            commands::memory::memory_today_local_date,
            commands::memory::memory_today_daily,
            commands::memory::memory_quota_summary,
            commands::memory::memory_wipe_all,
            // Settings
            commands::settings::settings_load_all,
            commands::settings::settings_save_providers,
            commands::settings::settings_list_ccswitch_providers,
            commands::settings::settings_list_cherry_studio_providers,
            commands::settings::settings_list_cherry_studio_providers_from_path,
            commands::settings::settings_save_system,
            commands::settings::settings_save_mcp,
            commands::settings::settings_save_agents,
            commands::settings::settings_save_ssh,
            commands::settings::settings_save_access,
            commands::settings::settings_apply_ssh_patch,
            commands::settings::settings_reset_ssh_known_host,
            commands::settings::settings_save_memory,
            commands::update::app_update_check,
            commands::update::app_update_install,
            commands::update::app_restart,
            commands::app::app_runtime_platform,
            commands::app::app_frontend_ready,
            commands::app::app_set_close_window_behavior,
            commands::app::app_set_global_shortcuts,
            commands::app::app_window_pinned,
            commands::app::app_toggle_window_pin,
            commands::tray::app_tray_menu_sync,
            commands::app::app_confirmed_exit,
            commands::app::app_macos_traffic_light_metrics,
            // Hooks
            commands::hook::hook_run_script,
            commands::hook::hook_run_http_requests,
            commands::hook::hook_cancel_scope,
            // Automation (cron tasks + hooks store)
            commands::cron::cron_validate_expression,
            commands::cron::automation_snapshot,
            commands::cron::automation_cron_apply,
            commands::cron::automation_hooks_apply,
            commands::cron::automation_list_runs,
            commands::cron::automation_clear_runs,
            commands::cron::automation_run_cron_now,
            commands::cron::automation_claim_prompt_runs,
            commands::cron::automation_release_prompt_run,
            commands::cron::automation_complete_prompt_run,
            // Local command execution
            commands::shell::shell_run,
            commands::shell::shell_cancel,
            commands::shell::runtime_cancel,
            commands::shell::shell_session_start,
            commands::shell::shell_session_wait,
            commands::shell::shell_session_stop,
            commands::process::managed_process_start,
            commands::process::managed_process_status,
            commands::process::managed_process_stop,
            commands::process::managed_process_read_log,
            commands::process::managed_process_wait,
            commands::process::managed_process_snapshot,
            commands::process::managed_process_clear,
            commands::terminal::terminal_shell_options,
            commands::terminal::terminal_list,
            commands::terminal::terminal_create,
            commands::terminal::terminal_create_ssh,
            commands::terminal::terminal_answer_ssh_prompt,
            commands::terminal::terminal_cancel_ssh_prompt,
            commands::terminal::terminal_ssh_reconnect,
            commands::terminal::terminal_ssh_latency,
            commands::terminal::terminal_ssh_exec,
            commands::terminal::terminal_ssh_local_forward_start,
            commands::terminal::terminal_ssh_local_forward_list,
            commands::terminal::terminal_ssh_local_forward_stop,
            commands::terminal::terminal_ssh_local_forward_check_port,
            commands::terminal::ssh_terminal_tabs_list,
            commands::terminal::ssh_terminal_tab_open,
            commands::terminal::ssh_terminal_tab_close,
            commands::terminal::terminal_stream_attach,
            commands::terminal::terminal_stream_input,
            commands::terminal::terminal_stream_resize,
            commands::terminal::terminal_rename,
            commands::terminal::terminal_close,
            commands::terminal::terminal_close_project,
            commands::terminal::terminal_read_tail,
            commands::sftp::sftp_list,
            commands::sftp::sftp_stat,
            commands::sftp::sftp_read_text,
            commands::sftp::sftp_write_text,
            commands::sftp::sftp_mkdir,
            commands::sftp::sftp_rename,
            commands::sftp::sftp_delete,
            commands::sftp::sftp_transfer,
            commands::sftp::sftp_cancel_transfer,
            commands::sftp::sftp_transfer_status,
            commands::git::git_status,
            commands::git::git_discover_repositories,
            commands::git::git_branches,
            commands::git::git_init,
            commands::git::git_clone_repository,
            commands::git::git_clone_repository_start,
            commands::git::git_clone_repository_tasks,
            commands::git::git_clone_repository_cancel,
            commands::git::git_clone_repository_dismiss,
            commands::git::git_list_remote_branches,
            commands::git::git_switch_branch,
            commands::git::git_create_branch,
            commands::git::git_create_worktree,
            commands::git::git_remove_worktree,
            commands::git::git_diff,
            commands::git::git_log,
            commands::git::git_commit_details,
            commands::git::git_compare_commit_with_remote,
            commands::git::git_commit_diff,
            commands::git::git_stage,
            commands::git::git_stage_all,
            commands::git::git_unstage,
            commands::git::git_unstage_all,
            commands::git::git_discard,
            commands::git::git_discard_all,
            commands::git::git_add_to_gitignore,
            commands::git::git_open_system_file_location,
            commands::git::git_commit,
            commands::git::git_fetch,
            commands::git::git_pull,
            commands::git::git_set_remote,
            commands::git::git_push,
            commands::git::git_delete_branch,
            commands::git::git_rename_branch,
            commands::git::git_stash_push,
            commands::git::git_stash_pop,
            commands::system::system_pick_folder,
            commands::system::system_pick_file,
            commands::system::system_home_dir,
            commands::system::system_create_project_folder,
            commands::system::system_import_pasted_texts,
            commands::system::system_import_readable_file_paths,
            commands::system::system_import_uploaded_readable_files,
            commands::system::system_pick_readable_files,
            commands::system::system_read_uploaded_image_preview,
            commands::system::system_open_uploaded_image,
            commands::system::system_prepare_preview_file_save,
            commands::system::system_write_preview_file,
            commands::system::system_read_uploaded_native_attachment,
            commands::system::system_list_skill_files,
            commands::system::system_ensure_builtin_skills,
            commands::system::system_read_skill_metadata,
            commands::system::system_read_skill_text,
            commands::system::system_manage_skill,
            commands::system::system_append_debug_jsonl,
            commands::system::system_clipboard_read_text,
            commands::system::system_classify_dropped_paths,
            commands::system::system_resolve_dropped_workspace_folders,
            commands::system::system_begin_power_activity,
            commands::system::system_end_power_activity,
            commands::app_commands::soul::system_load_soul,
            commands::app_commands::soul::system_list_souls,
            commands::app_commands::soul::system_save_soul,
            commands::app_commands::soul::system_create_soul,
            commands::app_commands::soul::system_select_soul,
            commands::app_commands::soul::system_delete_soul,
            commands::custom_tools::system_http_get_test,
            commands::cloud::cloud_secret_vault_status,
            commands::cloud::cloud_secret_vault_set_github_token,
            commands::cloud::cloud_secret_vault_remove_github_token,
            commands::lan_pc::lan_pc_status,
            commands::lan_pc::lan_pc_pair,
            commands::lan_pc::lan_pc_refresh,
            commands::lan_pc::lan_pc_disconnect,
            commands::lan_pc::lan_pc_invoke,
            commands::lan_pc::lan_pc_subscribe,
            commands::lan_pc::lan_pc_unsubscribe,
            commands::provider_oauth::provider_oauth_start_codex,
            commands::provider_oauth::provider_oauth_poll_codex,
            commands::provider_oauth::provider_oauth_status_codex,
            commands::provider_oauth::provider_oauth_set_default_codex_account,
            commands::provider_oauth::provider_oauth_remove_codex_account,
            commands::provider_oauth::provider_oauth_logout_codex,
            commands::cloud::cloud_task_start,
            commands::cloud::cloud_task_status,
            commands::cloud::cloud_task_wait,
            commands::cloud::cloud_task_failure_log,
            commands::cloud::cloud_task_download_artifact,
            commands::cloud::cloud_task_open_artifact,
            commands::local_access::local_access_status,
            commands::local_access::local_access_rotate_pairing_code,
            commands::local_access::local_access_revoke_all_devices,
            commands::local_access::local_access_rpc_respond,
            commands::local_access::local_access_event_publish,
            commands::local_access::local_access_broadcast_event,
            commands::local_access::workspace_watch_set,
            commands::provider_usage::provider_usage_query,
            commands::provider_usage::provider_usage_test,
            services::proxy::proxy_get_server_info,
        ]
    };
}

#[cfg(mobile)]
macro_rules! app_invoke_handler {
    () => {
        tauri::generate_handler![
            commands::chat_history::chat_history_list,
            commands::chat_history::chat_history_workdirs,
            commands::chat_history::chat_history_search,
            commands::chat_history::chat_history_get,
            commands::chat_history::chat_history_get_active_segment,
            commands::chat_history::chat_history_get_window,
            commands::chat_history::chat_history_upsert,
            commands::chat_history::chat_history_upsert_active_segment,
            commands::chat_history::chat_history_append_segment,
            commands::chat_history::chat_history_replace_from_message,
            commands::chat_history::chat_history_rename,
            commands::chat_history::chat_history_branch,
            commands::chat_history::chat_history_set_pinned,
            commands::chat_history::chat_history_set_model,
            commands::chat_history::chat_history_set_cwd,
            commands::chat_history::chat_history_delete,
            commands::subagent_store::subagent_identity_upsert,
            commands::subagent_store::subagent_identity_list,
            commands::subagent_store::subagent_run_save,
            commands::subagent_store::subagent_run_list,
            commands::subagent_store::subagent_run_load,
            commands::subagent_store::subagent_run_prune,
            commands::subagent_store::subagent_message_append,
            commands::subagent_store::subagent_message_list,
            commands::fs::fs_read_text,
            commands::fs::fs_read_editable_text,
            commands::fs::fs_path_status,
            commands::fs::fs_read_image_source,
            commands::fs::fs_read_workspace_image,
            commands::fs::fs_write_text,
            commands::fs::fs_edit_text,
            commands::fs::fs_delete,
            commands::fs::fs_open_workspace_path,
            commands::fs::fs_create_dir,
            commands::fs::fs_rename,
            commands::fs::fs_roots,
            commands::fs::fs_list_dirs,
            commands::fs::fs_list,
            commands::fs::fs_glob,
            commands::fs::fs_grep,
            commands::fs::fs_mention_list,
            commands::memory::memory_list,
            commands::memory::memory_read,
            commands::memory::memory_search,
            commands::memory::memory_write,
            commands::memory::memory_update,
            commands::memory::memory_delete,
            commands::memory::memory_delete_project,
            commands::memory::memory_accept,
            commands::memory::memory_apply_batch,
            commands::memory::memory_organize_run_create,
            commands::memory::memory_organize_run_update,
            commands::memory::memory_organize_run_list,
            commands::memory::memory_organize_run_read,
            commands::memory::memory_organize_run_clear_history,
            commands::memory::memory_organize_due_claim,
            commands::memory::memory_organize_due_complete,
            commands::memory::memory_index_overview,
            commands::memory::memory_paths_info,
            commands::memory::memory_recent_rejections,
            commands::memory::memory_today_local_date,
            commands::memory::memory_today_daily,
            commands::memory::memory_quota_summary,
            commands::memory::memory_wipe_all,
            commands::settings::settings_load_all,
            commands::settings::settings_save_providers,
            commands::settings::settings_save_system,
            commands::settings::settings_save_mcp,
            commands::settings::settings_save_agents,
            commands::settings::settings_save_ssh,
            commands::settings::settings_save_access,
            commands::settings::settings_apply_ssh_patch,
            commands::settings::settings_reset_ssh_known_host,
            commands::settings::settings_save_memory,
            commands::settings::settings_save_model_failover,
            commands::cron::cron_validate_expression,
            commands::cron::automation_snapshot,
            commands::cron::automation_cron_apply,
            commands::cron::automation_hooks_apply,
            commands::cron::automation_list_runs,
            commands::cron::automation_clear_runs,
            commands::cron::automation_run_cron_now,
            commands::cron::automation_claim_prompt_runs,
            commands::cron::automation_release_prompt_run,
            commands::cron::automation_complete_prompt_run,
            commands::hook::hook_run_script,
            commands::hook::hook_run_http_requests,
            commands::hook::hook_cancel_scope,
            commands::mcp::mcp_list_tools,
            commands::mcp::mcp_call_tool,
            commands::mcp::mcp_cancel_tool,
            commands::mcp::mcp_runtime_status,
            commands::mcp::mcp_stop_server,
            commands::mcp::mcp_test_server,
            commands::mcp::mcp_restart_server,
            commands::cloud::cloud_secret_vault_status,
            commands::cloud::cloud_secret_vault_set_github_token,
            commands::cloud::cloud_secret_vault_remove_github_token,
            commands::lan_pc::lan_pc_status,
            commands::lan_pc::lan_pc_pair,
            commands::lan_pc::lan_pc_refresh,
            commands::lan_pc::lan_pc_disconnect,
            commands::lan_pc::lan_pc_invoke,
            commands::lan_pc::lan_pc_subscribe,
            commands::lan_pc::lan_pc_unsubscribe,
            commands::provider_oauth::provider_oauth_start_codex,
            commands::provider_oauth::provider_oauth_poll_codex,
            commands::provider_oauth::provider_oauth_status_codex,
            commands::provider_oauth::provider_oauth_set_default_codex_account,
            commands::provider_oauth::provider_oauth_remove_codex_account,
            commands::provider_oauth::provider_oauth_logout_codex,
            commands::cloud::cloud_task_start,
            commands::cloud::cloud_task_status,
            commands::cloud::cloud_task_wait,
            commands::cloud::cloud_task_failure_log,
            commands::cloud::cloud_task_download_artifact,
            commands::cloud::cloud_task_open_artifact,
            commands::shell::shell_run,
            commands::shell::shell_cancel,
            commands::shell::mobile_ssh_exec,
            commands::app::app_runtime_platform,
            commands::system::system_pick_folder,
            commands::system::system_home_dir,
            commands::system::system_create_project_folder,
            commands::system::system_import_readable_file_paths,
            commands::system::system_import_uploaded_readable_files,
            commands::system::system_import_pasted_texts,
            commands::system::system_read_uploaded_image_preview,
            commands::system::system_read_uploaded_native_attachment,
            commands::system::system_list_skill_files,
            commands::system::system_ensure_builtin_skills,
            commands::system::system_read_skill_metadata,
            commands::system::system_read_skill_text,
            commands::system::system_manage_skill,
            commands::system::system_append_debug_jsonl,
            commands::app_commands::soul::system_load_soul,
            commands::app_commands::soul::system_list_souls,
            commands::app_commands::soul::system_save_soul,
            commands::app_commands::soul::system_create_soul,
            commands::app_commands::soul::system_select_soul,
            commands::app_commands::soul::system_delete_soul,
            services::proxy::proxy_get_server_info,
        ]
    };
}

#[cfg(desktop)]
fn show_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(ready_state) = app.try_state::<Arc<commands::app::FrontendReadyState>>() {
        if !ready_state.0.load(Ordering::SeqCst) {
            return Ok(());
        }
    }
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window.show()?;
        window.unminimize()?;
        window.set_focus()?;
    }

    Ok(())
}

#[cfg(desktop)]
fn request_app_exit(
    app: &tauri::AppHandle,
    allow_exit: &AtomicBool,
    terminal_registry: &runtime::terminal::TerminalSessionRegistry,
) {
    let running_count = terminal_registry.running_session_count();
    if running_count > 0 {
        if let Err(error) = show_main_window(app) {
            eprintln!("failed to show XAgent window before terminal exit confirm: {error}");
        }
        if let Err(error) = app.emit(
            TERMINAL_EXIT_REQUESTED_EVENT,
            TerminalExitRequestedEvent { running_count },
        ) {
            eprintln!("failed to request terminal exit confirmation: {error}");
        }
        return;
    }

    allow_exit.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[cfg(desktop)]
fn toggle_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let visible = window.is_visible().unwrap_or(false);
        let focused = window.is_focused().unwrap_or(false);
        if visible && focused {
            let _ = window.hide();
        } else if let Err(error) = show_main_window(app) {
            eprintln!("failed to show XAgent window from global shortcut: {error}");
        }
    }
}

#[cfg(desktop)]
pub(crate) fn toggle_main_window_pin(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let pin_state = app.state::<Arc<commands::app::WindowPinState>>();
        let next = !pin_state.0.load(Ordering::SeqCst);
        match window.set_always_on_top(next) {
            Ok(()) => {
                pin_state.0.store(next, Ordering::SeqCst);
                if next {
                    let _ = show_main_window(app);
                }
                let _ = app.emit("global-shortcut:pin-changed", next);
                if let Some(handles) = app.try_state::<Arc<services::tray::TrayMenuHandles>>() {
                    handles.set_pin_checked(next);
                }
            }
            Err(error) => eprintln!("failed to toggle XAgent window pin: {error}"),
        }
    }
}

#[cfg(desktop)]
#[derive(Debug, Clone)]
enum AppAction {
    Summon,
    ToggleWindow,
    TogglePin,
    NewChat,
    OpenConversation(String),
    ViewAllConversations,
    SwitchWorkspace(String),
    StopRun(String),
    StopAllRuns,
    ToggleCronTask(String),
    SetTheme(&'static str),
    OpenSettings,
    CheckUpdates,
    OpenDataDir,
    Quit,
}

#[cfg(desktop)]
fn tray_menu_action(id: &str) -> Option<AppAction> {
    use services::tray as tray_ids;
    match id {
        tray_ids::TRAY_SHOW_ID => Some(AppAction::Summon),
        tray_ids::TRAY_NEW_CHAT_ID => Some(AppAction::NewChat),
        tray_ids::TRAY_PIN_ID => Some(AppAction::TogglePin),
        tray_ids::TRAY_RECENT_VIEW_ALL_ID => Some(AppAction::ViewAllConversations),
        tray_ids::TRAY_RUN_STOP_ALL_ID => Some(AppAction::StopAllRuns),
        tray_ids::TRAY_THEME_LIGHT_ID => Some(AppAction::SetTheme("light")),
        tray_ids::TRAY_THEME_DARK_ID => Some(AppAction::SetTheme("dark")),
        tray_ids::TRAY_THEME_SYSTEM_ID => Some(AppAction::SetTheme("system")),
        tray_ids::TRAY_SETTINGS_ID => Some(AppAction::OpenSettings),
        tray_ids::TRAY_CHECK_UPDATES_ID => Some(AppAction::CheckUpdates),
        tray_ids::TRAY_OPEN_DATA_DIR_ID => Some(AppAction::OpenDataDir),
        tray_ids::TRAY_QUIT_ID => Some(AppAction::Quit),
        _ => {
            if let Some(rest) = id.strip_prefix(tray_ids::TRAY_RECENT_PREFIX) {
                Some(AppAction::OpenConversation(rest.to_string()))
            } else if let Some(rest) = id.strip_prefix(tray_ids::TRAY_WORKSPACE_PREFIX) {
                Some(AppAction::SwitchWorkspace(rest.to_string()))
            } else if let Some(rest) = id.strip_prefix(tray_ids::TRAY_RUN_PREFIX) {
                Some(AppAction::StopRun(rest.to_string()))
            } else {
                id.strip_prefix(tray_ids::TRAY_CRON_PREFIX)
                    .map(|rest| AppAction::ToggleCronTask(rest.to_string()))
            }
        }
    }
}

#[cfg(desktop)]
fn forward_app_action(
    app: &tauri::AppHandle,
    action: &'static str,
    id: Option<String>,
    value: Option<String>,
    show_window: bool,
) {
    if show_window {
        if let Err(error) = show_main_window(app) {
            eprintln!("failed to show XAgent window for action {action}: {error}");
        }
    }
    if let Err(error) = app.emit(APP_ACTION_EVENT, AppActionEvent { action, id, value }) {
        eprintln!("failed to emit app action {action}: {error}");
    }
}

#[cfg(desktop)]
fn handle_global_shortcut(
    app: &tauri::AppHandle,
    shortcut: &tauri_plugin_global_shortcut::Shortcut,
) {
    let action = app
        .state::<Arc<commands::app::GlobalShortcutRegistry>>()
        .lookup_action(shortcut);
    let Some(action) = action else {
        return;
    };
    let action = match action.as_str() {
        "summon" => AppAction::Summon,
        "toggle" => AppAction::ToggleWindow,
        "pin" => AppAction::TogglePin,
        "newChat" => AppAction::NewChat,
        _ => return,
    };
    dispatch_app_action(app, action);
}

#[cfg(desktop)]
fn exit_app_from_tray(
    app: &tauri::AppHandle,
    allow_exit: &AtomicBool,
) {
    // Selecting Quit from the tray is already an explicit confirmation. Do not
    // restore a hidden window, enter the title-bar confirmation flow, or block
    // the native menu event thread while waiting for child processes to stop.
    // The normal RunEvent exit path owns process and power cleanup.
    allow_exit.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[cfg(desktop)]
fn dispatch_app_action(app: &tauri::AppHandle, action: AppAction) {
    match action {
        AppAction::Summon => {
            if let Err(error) = show_main_window(app) {
                eprintln!("failed to show XAgent window: {error}");
            }
        }
        AppAction::ToggleWindow => toggle_main_window(app),
        AppAction::TogglePin => toggle_main_window_pin(app),
        AppAction::NewChat => forward_app_action(app, "new-chat", None, None, true),
        AppAction::OpenConversation(id) => {
            forward_app_action(app, "open-conversation", Some(id), None, true);
        }
        AppAction::ViewAllConversations => {
            forward_app_action(app, "view-all-conversations", None, None, true);
        }
        AppAction::SwitchWorkspace(id) => {
            forward_app_action(app, "switch-workspace", Some(id), None, true);
        }
        AppAction::StopRun(id) => forward_app_action(app, "stop-run", Some(id), None, false),
        AppAction::StopAllRuns => forward_app_action(app, "stop-all-runs", None, None, false),
        AppAction::SetTheme(theme) => {
            forward_app_action(app, "set-theme", None, Some(theme.to_string()), false);
        }
        AppAction::OpenSettings => forward_app_action(app, "open-settings", None, None, true),
        AppAction::CheckUpdates => forward_app_action(app, "check-updates", None, None, true),
        AppAction::ToggleCronTask(task_id) => {
            let Some(store) = app.try_state::<Arc<services::automation::AutomationStore>>() else {
                return;
            };
            let store = Arc::clone(store.inner());
            let app_handle = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let (value, error) = match store.toggle_cron_task_enabled(&task_id) {
                    Ok(enabled) => (
                        Some(if enabled { "enabled" } else { "disabled" }.to_string()),
                        None,
                    ),
                    Err(error) => {
                        eprintln!("failed to toggle cron task from tray: {error}");
                        (None, Some(error))
                    }
                };
                if let Err(emit_error) = app_handle.emit(
                    APP_ACTION_FEEDBACK_EVENT,
                    AppActionFeedbackEvent {
                        action: "toggle-cron-task",
                        id: Some(task_id),
                        ok: error.is_none(),
                        error,
                        value,
                    },
                ) {
                    eprintln!("failed to emit cron toggle feedback: {emit_error}");
                }
            });
        }
        AppAction::OpenDataDir => {
            use tauri_plugin_opener::OpenerExt;
            match commands::settings::config_dir() {
                Ok(dir) => {
                    if let Err(error) = app
                        .opener()
                        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
                    {
                        eprintln!("failed to open XAgent data directory: {error}");
                    }
                }
                Err(error) => eprintln!("failed to resolve XAgent data directory: {error}"),
            }
        }
        AppAction::Quit => {
            let allow_exit = app.state::<Arc<AtomicBool>>();
            exit_app_from_tray(app, allow_exit.inner());
        }
    }
}

#[cfg(desktop)]
fn configure_system_tray(app: &tauri::App) -> tauri::Result<()> {
    let skeleton = services::tray::build_tray_menu_skeleton(app, app_version())?;
    let menu = skeleton.menu.clone();
    let mut tray_builder = TrayIconBuilder::new()
        .tooltip("XAgent")
        .menu(&menu)
        .show_menu_on_left_click(TRAY_SHOW_MENU_ON_LEFT_CLICK)
        .on_menu_event(|app, event| {
            if let Some(action) = tray_menu_action(event.id().as_ref()) {
                dispatch_app_action(app, action);
            }
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => {
                if let Err(error) = show_main_window(tray.app_handle()) {
                    eprintln!("failed to show XAgent window from tray double-click: {error}");
                }
            }
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Down,
                ..
            } if !TRAY_SHOW_MENU_ON_LEFT_CLICK => {
                if let Err(error) = show_main_window(tray.app_handle()) {
                    eprintln!("failed to show XAgent window from tray click: {error}");
                }
            }
            _ => {}
        });

    #[cfg(target_os = "macos")]
    {
        match tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon-macos.png")) {
            Ok(icon) => {
                tray_builder = tray_builder.icon(icon).icon_as_template(true);
            }
            Err(error) => {
                eprintln!("failed to load macOS tray icon: {error}");
                if let Some(icon) = app.default_window_icon() {
                    tray_builder = tray_builder.icon(icon.clone());
                }
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }

    let tray = tray_builder.build(app)?;
    let handles = Arc::new(services::tray::TrayMenuHandles::new(
        skeleton,
        tray.clone(),
        app_version(),
    ));
    app.manage(tray);
    app.manage(handles);
    Ok(())
}

#[cfg(all(desktop, target_os = "windows"))]
fn configure_windows_window_chrome(app: &tauri::App) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window.set_decorations(false)?;
    }

    Ok(())
}

#[cfg(desktop)]
pub fn run() {
    #[cfg(target_os = "windows")]
    runtime::windows_sandbox::run_sandbox_launcher_if_requested();

    for warning in services::app_paths::initialize_desktop()
        .expect("failed to initialize the unified XAgent data directory")
    {
        eprintln!("{warning}");
    }
    #[cfg(target_os = "windows")]
    {
        let webview_user_data_root = services::app_paths::webview_user_data_root()
            .expect("failed to initialize the XAgent WebView2 user-data root");
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", webview_user_data_root);
    }

    let automation_store = Arc::new(
        services::automation::AutomationStore::open()
            .expect("failed to initialize XAgent automation store"),
    );
    let automation_scheduler = Arc::new(services::automation::AutomationScheduler::new(
        Arc::clone(&automation_store),
    ));
    let memory_store = Arc::new(
        services::memory::MemoryStore::open().expect("failed to initialize XAgent memory store"),
    );
    let power_activity = Arc::new(services::power_activity::PowerActivityManager::default());
    let managed_process_registry =
        Arc::new(runtime::managed_process::ManagedProcessRegistry::open());
    let shell_session_manager = Arc::new(runtime::shell_session::ShellSessionManager::default());
    runtime::shell_session::ShellSessionManager::start_cleaner(&shell_session_manager);
    let terminal_registry = Arc::new(runtime::terminal::TerminalSessionRegistry::default());
    let git_clone_task_registry = Arc::new(commands::git::GitCloneTaskRegistry::default());
    let sftp_registry = Arc::new(runtime::sftp::SftpSessionRegistry::new(Arc::clone(
        &terminal_registry,
    )));
    let allow_exit = Arc::new(AtomicBool::new(false));
    let close_window_behavior = Arc::new(commands::app::CloseWindowBehaviorState::new(
        commands::app::CLOSE_WINDOW_BEHAVIOR_MINIMIZE,
    ));
    let provider_usage_service =
        Arc::new(services::provider_usage::ProviderUsageService::default());
    let stt_manager = Arc::new(services::stt::SttManager::default());

    let builder = tauri::Builder::default();
    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        if let Err(error) = show_main_window(app) {
            eprintln!("failed to focus existing XAgent instance: {error}");
        }
    }));

    let app = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_browser_automation::init())
        .plugin(tauri_plugin_mobile_assistant::init())
        .plugin(tauri_plugin_mobile_execution::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_mcp_bridge::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(WINDOW_STATE_FLAGS)
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        handle_global_shortcut(app, shortcut);
                    }
                })
                .build(),
        )
        .manage(Arc::new(commands::app::GlobalShortcutRegistry::default()))
        .manage(Arc::new(commands::app::FrontendReadyState::default()))
        .manage(Arc::new(commands::app::WindowPinState::default()))
        .manage(Arc::new(commands::mcp::McpRuntimeManager::default()))
        .manage(Arc::clone(&memory_store))
        .manage(Arc::clone(&provider_usage_service))
        .manage(Arc::clone(&power_activity))
        .manage(Arc::new(runtime::shell_runner::ShellRunRegistry::default()))
        .manage(Arc::clone(&shell_session_manager))
        .manage(Arc::clone(&managed_process_registry))
        .manage(Arc::clone(&terminal_registry))
        .manage(Arc::clone(&sftp_registry))
        .manage(Arc::clone(&git_clone_task_registry))
        .manage(Arc::clone(&allow_exit))
        .manage(Arc::clone(&close_window_behavior))
        .manage(Arc::clone(&automation_store))
        .manage(Arc::clone(&automation_scheduler))
        .manage(Arc::new(commands::hook::HookScopeRegistry::default()))
        .manage(stt_manager)
        .on_page_load(|webview, payload| {
            if webview.label() != MAIN_WINDOW_LABEL
                || !matches!(payload.event(), tauri::webview::PageLoadEvent::Started)
            {
                return;
            }
            let app = webview.app_handle();
            if let Some(ready_state) = app.try_state::<Arc<commands::app::FrontendReadyState>>() {
                ready_state.0.store(false, Ordering::SeqCst);
            }
            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                if window.is_visible().unwrap_or(false) {
                    let _ = window.hide();
                }
            }
        })
        .setup({
            let terminal_registry = Arc::clone(&terminal_registry);
            let sftp_registry = Arc::clone(&sftp_registry);
            let managed_process_registry = Arc::clone(&managed_process_registry);
            move |app| {
                commands::history_db::initialize_history_db()?;
                configure_system_tray(app)?;
                #[cfg(target_os = "windows")]
                configure_windows_window_chrome(app)?;
                if let Err(error) = commands::settings::initialize_system_proxy_from_db() {
                    eprintln!("failed to initialize system proxy state: {error}");
                }
                let app_data_dir = services::app_paths::app_storage_dir()?;
                let cloud_secret_vault = Arc::new(
                    services::cloud_secret_vault::CloudSecretVault::new(app_data_dir.clone())?,
                );
                let provider_oauth = Arc::new(
                    services::provider_oauth::ProviderOAuthService::new(Arc::clone(
                        &cloud_secret_vault,
                    ))?,
                );
                let lan_pc_client = Arc::new(services::lan_pc_client::LanPcClient::new(
                    Arc::clone(&cloud_secret_vault),
                )?);
                app.manage(Arc::clone(&cloud_secret_vault));
                app.manage(Arc::clone(&provider_oauth));
                app.manage(lan_pc_client);
                app.manage(Arc::new(
                    services::cloud_execution::CloudExecutionService::new(app_data_dir)?,
                ));
                let proxy_server = services::proxy::start_proxy_server(provider_oauth)?;
                app.manage(Arc::clone(&proxy_server));
                let local_access_controller = Arc::new(
                    services::local_access::LocalAccessController::new(
                        app.handle().clone(),
                        proxy_server.info(),
                    ),
                );
                app.manage(Arc::clone(&local_access_controller));
                let workspace_watch = Arc::new(
                    services::workspace_watch::WorkspaceWatchService::new(app.handle().clone()),
                );
                app.manage(workspace_watch);
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = local_access_controller.reload_from_db().await {
                        eprintln!("failed to load local access settings: {error}");
                    }
                });
                if let Err(error) = services::skills::ensure_builtin_agent_skills_sync() {
                    eprintln!("failed to seed builtin skills: {error}");
                }
                terminal_registry.attach_app_handle(app.handle().clone());
                sftp_registry.attach_app_handle(app.handle().clone());
                services::webdav_auto_sync::start(app.handle().clone());
                managed_process_registry.set_notifier(
                    runtime::managed_process::ManagedProcessNotifier {
                        app_handle: app.handle().clone(),
                    },
                );
                managed_process_registry.spawn_startup_reconcile();
                managed_process_registry.spawn_monitor();
                automation_store.set_notifier(services::automation::AutomationNotifier {
                    app_handle: app.handle().clone(),
                    scheduler: Arc::downgrade(&automation_scheduler),
                });
                Arc::clone(&automation_scheduler).start();
                Ok(())
            }
        })
        .on_window_event({
            let allow_exit = Arc::clone(&allow_exit);
            let close_window_behavior = Arc::clone(&close_window_behavior);
            let terminal_registry = Arc::clone(&terminal_registry);
            move |window, event| {
                if window.label() != MAIN_WINDOW_LABEL {
                    return;
                }

                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if commands::app::is_close_window_exit(&close_window_behavior) {
                        request_app_exit(window.app_handle(), &allow_exit, &terminal_registry);
                    } else if let Err(error) = window.hide() {
                        eprintln!("failed to hide XAgent window on close: {error}");
                    }
                }
            }
        })
        .invoke_handler(app_invoke_handler!())
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |_app, event| match event {
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => {
            if let Err(error) = show_main_window(_app) {
                eprintln!("failed to show XAgent window from dock reopen: {error}");
            }
        }
        tauri::RunEvent::ExitRequested { api, .. } => {
            if !allow_exit.load(Ordering::SeqCst) {
                let running_count = terminal_registry.running_session_count();
                if running_count > 0 {
                    if let Err(error) = show_main_window(_app) {
                        eprintln!(
                            "failed to show XAgent window before terminal exit confirm: {error}"
                        );
                    }
                    if let Err(error) = _app.emit(
                        TERMINAL_EXIT_REQUESTED_EVENT,
                        TerminalExitRequestedEvent { running_count },
                    ) {
                        eprintln!("failed to request terminal exit confirmation: {error}");
                    }
                }
                api.prevent_exit();
            } else {
                // Real exit: reclaim every non-isolated managed process
                // before the OS tears us down (Drop is not guaranteed).
                terminal_registry.shutdown_cleanup();
                shell_session_manager.shutdown_cleanup();
                managed_process_registry.shutdown_cleanup();
                git_clone_task_registry.shutdown_cleanup();
                power_activity.clear_all();
            }
        }
        _ => {}
    });
}

#[cfg(mobile)]
#[tauri::mobile_entry_point]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_browser_automation::init())
        .plugin(tauri_plugin_mobile_assistant::init())
        .plugin(tauri_plugin_mobile_execution::init())
        .manage(Arc::new(commands::mcp::McpRuntimeManager::default()))
        .manage(Arc::new(commands::hook::MobileHookScopeRegistry::default()))
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("resolve app data directory failed: {error}"))?;
            services::app_paths::initialize(services::app_paths::mobile_root(&app_data_dir))?;
            let app_data_dir = services::app_paths::app_storage_dir()?;
            commands::history_db::initialize_history_db()?;
            if let Err(error) = commands::settings::initialize_system_proxy_from_db() {
                eprintln!("failed to initialize system proxy state: {error}");
            }
            let memory_store = Arc::new(
                services::memory::MemoryStore::open()
                    .map_err(|error| format!("initialize XAgent memory store failed: {error}"))?,
            );
            app.manage(memory_store);
            let automation_store = Arc::new(
                services::automation::AutomationStore::open()
                    .map_err(|error| format!("initialize XAgent automation store failed: {error}"))?,
            );
            let cloud_secret_vault = Arc::new(
                services::cloud_secret_vault::CloudSecretVault::new(app_data_dir.clone())?,
            );
            let provider_oauth = Arc::new(
                services::provider_oauth::ProviderOAuthService::new(Arc::clone(
                    &cloud_secret_vault,
                ))?,
            );
            let lan_pc_client = Arc::new(services::lan_pc_client::LanPcClient::new(
                Arc::clone(&cloud_secret_vault),
            )?);
            let automation_scheduler = Arc::new(
                services::automation::AutomationScheduler::new(
                    Arc::clone(&automation_store),
                    app.handle().clone(),
                    Arc::clone(&lan_pc_client),
                ),
            );
            automation_store.set_notifier(services::automation::AutomationNotifier {
                app_handle: app.handle().clone(),
                scheduler: Arc::downgrade(&automation_scheduler),
            });
            app.manage(Arc::clone(&automation_store));
            app.manage(Arc::clone(&automation_scheduler));
            app.manage(Arc::clone(&cloud_secret_vault));
            app.manage(Arc::clone(&provider_oauth));
            app.manage(Arc::clone(&lan_pc_client));
            app.manage(Arc::new(
                services::cloud_execution::CloudExecutionService::new(app_data_dir)?,
            ));
            app.manage(services::proxy::start_proxy_server(provider_oauth)?);
            if let Err(error) = services::skills::ensure_builtin_agent_skills_sync() {
                eprintln!("failed to seed builtin skills: {error}");
            }
            Arc::clone(&automation_scheduler).start();
            Ok(())
        })
        .invoke_handler(app_invoke_handler!())
        .run(tauri::generate_context!())
        .expect("error while running XAgent mobile application");
}
