pub mod cloud;
#[cfg(desktop)]
pub mod cua;
pub mod lan_pc;
pub mod tailscale;
#[cfg(desktop)]
pub mod local_access;
pub mod mcp;
pub mod memory;
pub mod provider_oauth;
pub mod github_oauth;
#[cfg(desktop)]
pub mod provider_usage;
