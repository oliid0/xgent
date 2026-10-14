#[path = "app/mod.rs"]
pub mod app_commands;
#[path = "automation/mod.rs"]
pub mod automation_commands;
pub use automation_commands::goal_launch;
pub use automation_commands::received_children;
pub use automation_commands::artifact_streams;
#[cfg(desktop)]
pub use automation_commands::videos;
#[path = "config/mod.rs"]
pub mod config_commands;
#[path = "history/mod.rs"]
pub mod history_commands;
#[path = "integration/mod.rs"]
pub mod integration_commands;
#[path = "runtime/mod.rs"]
pub mod runtime_commands;
#[path = "workspace/mod.rs"]
pub mod workspace_commands;

pub use app_commands::app;
#[cfg(desktop)]
pub use app_commands::tray;
#[cfg(desktop)]
pub use app_commands::custom_tools;
pub use app_commands::system;
#[cfg(desktop)]
pub use app_commands::update;

pub use automation_commands::cron;
pub use automation_commands::proactive;
pub use automation_commands::goals;
#[cfg(desktop)]
pub use automation_commands::children;
#[cfg(desktop)]
pub use automation_commands::cloud_waiting;
#[cfg(desktop)]
pub use automation_commands::cloud_artifacts;
#[cfg(desktop)]
pub use automation_commands::cloud_launch;
#[cfg(desktop)]
pub use automation_commands::cloud_recovery;
pub use automation_commands::submission;
#[cfg(desktop)]
pub use automation_commands::device_planning;
#[cfg(mobile)]
pub use automation_commands::mobile_device_planning;
#[cfg(mobile)]
pub use automation_commands::mobile_connector;
#[cfg(mobile)]
pub use automation_commands::mobile_branch;
#[cfg(mobile)]
pub use automation_commands::mobile_branch_reads;
#[cfg(desktop)]
pub use automation_commands::hook;
#[cfg(mobile)]
pub use automation_commands::mobile_hook as hook;

pub use config_commands::settings;

pub use history_commands::chat_history;
pub use history_commands::history_db;
pub use history_commands::subagent_store;

pub use integration_commands::cloud;
#[cfg(desktop)]
pub use integration_commands::cua;
pub use integration_commands::lan_pc;
pub use integration_commands::tailscale;
#[cfg(desktop)]
pub use integration_commands::local_access;
pub use integration_commands::mcp;
pub use integration_commands::memory;
pub use integration_commands::provider_oauth;
pub use integration_commands::github_oauth;
#[cfg(desktop)]
pub use integration_commands::provider_usage;

#[cfg(desktop)]
pub use runtime_commands::process;
#[cfg(desktop)]
pub use runtime_commands::sftp;
pub use runtime_commands::shell;
#[cfg(desktop)]
pub use runtime_commands::terminal;

pub use workspace_commands::fs;
#[cfg(desktop)]
pub use workspace_commands::chat_file_links;
#[cfg(desktop)]
pub use workspace_commands::checkpoint;
#[cfg(desktop)]
pub use workspace_commands::git;
#[cfg(mobile)]
pub use workspace_commands::mobile_git;
#[cfg(desktop)]
pub use workspace_commands::root_grants;
#[cfg(desktop)]
pub use workspace_commands::subagent_worktree;
