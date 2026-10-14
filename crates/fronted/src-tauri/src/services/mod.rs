#[cfg(desktop)]
pub mod agent_worker;
#[cfg(desktop)]
pub mod agent_startup;
#[cfg(desktop)]
pub(crate) mod agent_startup_supervisor;
#[cfg(any(target_os="macos",target_os="linux"))]
mod agent_startup_unix;
#[cfg(desktop)]
pub(crate) mod worker_supervisor;
#[cfg(desktop)]
pub(crate) mod child_tasks;
pub(crate) mod tailscale_status;
pub(crate) mod tailscale_setup;
pub(crate) mod embedded_tailnet;
pub mod automation;
pub(crate) mod worker_discovery;
pub(crate) mod result_receiver;
#[cfg(any(target_os="android",target_os="ios"))]
mod os_result_receiver;
#[cfg(target_os="ios")]
mod ios_result_receiver;
#[cfg(any(target_os="ios",target_os="android"))]
pub(crate) mod health_events;
#[cfg(target_os="ios")]
pub(crate) mod home_events;
#[cfg(any(target_os="ios",target_os="android"))]
pub(crate) mod mobile_worker_runtime;
#[cfg(any(target_os="ios",target_os="android"))]
pub(crate) mod os_event_sender;
pub mod app_paths;
#[cfg(windows)]
pub mod clipboard;
pub mod cloud_secret_vault;
pub mod cloud_execution;
pub(crate) mod cloud_artifacts;
pub(crate) mod document_validation;
pub mod lan_pc_client;
pub mod worker_peers;
pub mod worker_inventory;
#[cfg(desktop)]
pub mod local_access;
pub mod memory;
#[cfg(desktop)]
pub mod power_activity;
pub mod provider_oauth;
pub(crate) mod github_oauth;
pub mod provider_models;
#[cfg(desktop)]
pub mod provider_usage;
pub mod proxy;
pub mod skills;
pub(crate) mod ssh_proxy;
pub(crate) mod ssh_transport;
pub mod system_proxy;
#[cfg(desktop)]
pub(crate) mod video_generation;
#[cfg(desktop)]
pub mod stt;
#[cfg(desktop)]
pub mod tray;
pub mod webdav;
#[cfg(desktop)]
pub mod webdav_auto_sync;
#[cfg(desktop)]
pub mod workspace_watch;
