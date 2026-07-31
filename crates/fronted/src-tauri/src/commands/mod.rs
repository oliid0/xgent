#[path = "app/mod.rs"]
pub mod app_commands;
#[path = "automation/mod.rs"]
pub mod automation_commands;
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
pub use app_commands::custom_tools;
pub use app_commands::system;
#[cfg(desktop)]
pub use app_commands::update;

pub use automation_commands::cron;
#[cfg(desktop)]
pub use automation_commands::hook;
#[cfg(mobile)]
pub use automation_commands::mobile_hook as hook;

pub use config_commands::settings;

pub use history_commands::chat_history;
pub use history_commands::history_db;
pub use history_commands::subagent_store;

pub use integration_commands::cloud;
pub use integration_commands::lan_pc;
#[cfg(desktop)]
pub use integration_commands::local_access;
pub use integration_commands::mcp;
pub use integration_commands::memory;
pub use integration_commands::provider_oauth;

#[cfg(desktop)]
pub use runtime_commands::process;
#[cfg(desktop)]
pub use runtime_commands::sftp;
pub use runtime_commands::shell;
#[cfg(desktop)]
pub use runtime_commands::terminal;

pub use workspace_commands::fs;
#[cfg(desktop)]
pub use workspace_commands::git;
#[cfg(desktop)]
pub use workspace_commands::subagent_worktree;
