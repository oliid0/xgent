pub mod automation;
pub mod app_paths;
pub mod cloud_secret_vault;
pub mod cloud_execution;
pub mod lan_pc_client;
#[cfg(desktop)]
pub mod local_access;
pub mod memory;
#[cfg(desktop)]
pub mod power_activity;
pub mod provider_oauth;
pub mod provider_models;
pub mod proxy;
pub mod skills;
pub(crate) mod ssh_proxy;
pub mod system_proxy;
#[cfg(desktop)]
pub mod workspace_watch;
