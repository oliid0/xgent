use super::*;

// Keep wire counters exactly representable by the JS worker.
const MAX_LEASE_COUNTER: u64 = 9_007_199_254_740_991;

impl AutomationStore {
    pub(super) fn claim_background_lease(conn: &Connection, execution_id: &str) -> Result<Option<BackgroundExecutionLease>, String> {
        let background: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM automation_background_tasks WHERE execution_id = ?1)",
            params![execution_id], |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        if !background { return Ok(None); }
        let previous: Option<(u64, u64)> = conn.query_row(
            "SELECT attempt, generation FROM automation_background_leases WHERE execution_id = ?1",
            params![execution_id], |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(|e| e.to_string())?;
        let (attempt, generation) = previous.unwrap_or((0, 0));
        if attempt >= MAX_LEASE_COUNTER || generation >= MAX_LEASE_COUNTER {
            return Err("Background execution lease counter exhausted".to_string());
        }
        let lease = BackgroundExecutionLease { attempt: attempt + 1, generation: generation + 1, token: Uuid::new_v4().to_string() };
        conn.execute(
            "INSERT INTO automation_background_leases (execution_id, attempt, generation, token) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(execution_id) DO UPDATE SET attempt = excluded.attempt, generation = excluded.generation, token = excluded.token",
            params![execution_id, lease.attempt as i64, lease.generation as i64, lease.token],
        ).map_err(|e| e.to_string())?;
        Ok(Some(lease))
    }

    /// Validate the caller's captured execution, never look up a replacement
    /// token on its behalf. Deadline/state checks remain separate for outbox
    /// settlement and late receipts, which must survive expiry/cancellation.
    pub(super) fn require_background_fence(conn: &Connection, execution_id: &str, lease: Option<&BackgroundExecutionLease>) -> Result<(), String> {
        let expected = lease.ok_or_else(|| "Background execution requires its captured attempt/generation token".to_string())?;
        if expected.attempt == 0 || expected.generation == 0 || expected.attempt > MAX_LEASE_COUNTER || expected.generation > MAX_LEASE_COUNTER {
            return Err("Invalid background execution lease counters".to_string());
        }
        let matches: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM automation_background_leases WHERE execution_id = ?1 AND attempt = ?2 AND generation = ?3 AND token = ?4)",
            params![execution_id, expected.attempt as i64, expected.generation as i64, expected.token], |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        if matches { Ok(()) } else { Err("Background execution lease was superseded; this worker cannot write into another attempt".to_string()) }
    }

    pub(super) fn require_background_execution(conn: &Connection, execution_id: &str, lease: Option<&BackgroundExecutionLease>) -> Result<(), String> {
        super::journal::require_live_execution(conn, execution_id)?;
        Self::require_background_fence(conn, execution_id, lease)
    }

    pub(super) fn is_background_execution(conn: &Connection, execution_id: &str) -> Result<bool, String> {
        conn.query_row("SELECT EXISTS(SELECT 1 FROM automation_background_tasks WHERE execution_id = ?1)",
            params![execution_id], |row| row.get(0)).map_err(|e| e.to_string())
    }

    #[cfg(test)]
    pub fn debug_background_lease(&self, execution_id: &str) -> Option<BackgroundExecutionLease> {
        let conn = self.lock_conn().unwrap();
        conn.query_row("SELECT attempt, generation, token FROM automation_background_leases WHERE execution_id = ?1",
            params![execution_id], |row| Ok(BackgroundExecutionLease { attempt: row.get(0)?, generation: row.get(1)?, token: row.get(2)? })).optional().unwrap()
    }
}
