
//!














mod builtin;
mod clawhub;
mod create;
mod external;
mod external_mcp;
mod install;
mod jobs;
mod library;
mod manager;
mod metadata;
mod paths;
mod sources;
#[cfg(test)]
mod tests;
mod types;
mod util;
mod validate;

pub use builtin::ensure_builtin_agent_skills_sync;
pub(crate) use builtin::*;
pub(crate) use clawhub::*;
pub(crate) use create::*;
pub(crate) use external::*;
pub(crate) use external_mcp::*;
pub(crate) use install::*;
pub(crate) use jobs::*;
pub(crate) use library::*;
pub use library::{
    system_list_skill_files_sync, system_read_skill_metadata_sync, system_read_skill_text_sync,
};
pub use manager::system_manage_skill_sync;
pub(crate) use metadata::*;
pub use paths::skills_root_dir;
pub(crate) use paths::*;
pub(crate) use sources::*;
pub use types::*;
pub(crate) use util::*;
pub(crate) use validate::*;


pub(crate) const MAX_SKILL_DESCRIPTION_LENGTH: usize = 1024;
pub(crate) const MAX_SKILL_FILE_BYTES: u64 = 10 * 1024 * 1024;






static SKILLS_WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub(crate) fn skills_write_guard() -> std::sync::MutexGuard<'static, ()> {
    SKILLS_WRITE_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
