//! Process-local native host identity, persisted to fence queued old claims in
//! the same SQLite transaction that would issue a new task execution lease.
use super::*;

pub(crate) const WORKER_SUPERSEDED: &str = "Background worker instance was superseded";

impl AutomationStore {
    pub(crate) fn install_background_worker_instance(&self, instance: &str) -> Result<(),String> {
        if !Uuid::parse_str(instance).is_ok_and(|id| id.to_string() == instance) { return Err("Invalid native worker instance".into()); }
        let conn = self.lock_conn()?;
        conn.execute("INSERT INTO automation_meta (key,value) VALUES ('background-worker-instance',?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",params![instance]).map_err(|e|e.to_string())?;
        Ok(())
    }

    pub(super) fn require_worker_instance(conn: &Connection, instance: &str) -> Result<(),String> {
        let matches: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM automation_meta WHERE key = 'background-worker-instance' AND value = ?1)",params![instance],|row|row.get(0)).map_err(|e|e.to_string())?;
        if !matches { return Err(WORKER_SUPERSEDED.into()); }
        Ok(())
    }
}
