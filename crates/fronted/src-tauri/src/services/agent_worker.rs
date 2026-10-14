use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

pub(crate) use super::automation::store::WORKER_SUPERSEDED;

#[derive(Default)]
pub struct AgentWorkerState {
    execution_enabled: AtomicBool,
    last_heartbeat: AtomicU64,
    supervision_armed: AtomicBool,
    instance: Mutex<String>,
    started_at: AtomicU64,
    retry_at: AtomicU64,
    failures: AtomicU64,
}

impl AgentWorkerState {
    // Only native startup can admit execution, after interrupted leases settle.
    pub fn enable_execution(&self) {
        self.supervision_armed.store(true, Ordering::SeqCst);
        self.execution_enabled.store(true, Ordering::SeqCst);
    }
    pub fn execution_enabled(&self) -> bool {
        self.execution_enabled.load(Ordering::SeqCst)
    }
    pub fn require_instance(&self, instance: Option<&str>) -> Result<(), String> {
        let current = self.instance.lock().map_err(|e| e.to_string())?;
        if current.is_empty() || instance != Some(current.as_str()) { return Err(WORKER_SUPERSEDED.into()); }
        if !self.execution_enabled() { return Err("Background recovery did not finish; execution is unavailable for this process".into()); }
        Ok(())
    }
    pub fn install_instance(&self, instance: String, now: u64) -> Result<(), String> {
        let mut current = self.instance.lock().map_err(|e| e.to_string())?;
        *current = instance;
        self.last_heartbeat.store(0, Ordering::SeqCst);
        self.started_at.store(now, Ordering::SeqCst);
        self.execution_enabled.store(self.supervision_armed.load(Ordering::SeqCst), Ordering::SeqCst);
        Ok(())
    }
    pub fn suspend_execution(&self) -> Result<(), String> {
        let _current = self.instance.lock().map_err(|e| e.to_string())?;
        self.execution_enabled.store(false, Ordering::SeqCst);
        self.last_heartbeat.store(0, Ordering::SeqCst);
        Ok(())
    }
    pub fn restart_due(&self, now: u64, window_exists: bool) -> bool {
        if !self.supervision_armed.load(Ordering::SeqCst) || now < self.retry_at.load(Ordering::SeqCst) { return false; }
        if !window_exists || !self.execution_enabled() { return true; }
        let seen = self.last_heartbeat.load(Ordering::SeqCst);
        if seen == 0 { now.saturating_sub(self.started_at.load(Ordering::SeqCst)) >= 60_000 }
        else { now.saturating_sub(seen) >= 45_000 }
    }
    pub fn restart_failed(&self, now: u64) -> Result<(), String> {
        self.suspend_execution()?;
        let failures = self.failures.fetch_add(1, Ordering::SeqCst).saturating_add(1).min(8);
        self.retry_at.store(now.saturating_add((5_000u64 * (1u64 << (failures - 1))).min(300_000)), Ordering::SeqCst);
        Ok(())
    }
    pub fn heartbeat(&self, instance: Option<&str>, running: bool) -> Result<(), String> {
        // Serialize owner replacement and heartbeat, including a late false
        // heartbeat from a destroyed window. It cannot clear the new owner.
        let current = self.instance.lock().map_err(|e| e.to_string())?;
        if current.is_empty() || instance != Some(current.as_str()) { return Err(WORKER_SUPERSEDED.into()); }
        if !running {
            self.last_heartbeat.store(0, Ordering::SeqCst);
            return Ok(());
        }
        if !self.execution_enabled() {
            return Err("Background recovery did not finish; execution is unavailable for this process".into());
        }
        self.last_heartbeat.store(super::automation::db::now_ms() as u64, Ordering::SeqCst);
        self.failures.store(0, Ordering::SeqCst);
        self.retry_at.store(0, Ordering::SeqCst);
        Ok(())
    }
    pub fn ready(&self) -> bool {
        let seen = self.last_heartbeat.load(Ordering::SeqCst);
        self.execution_enabled() && seen > 0 && (super::automation::db::now_ms() as u64).saturating_sub(seen) < 30_000
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heartbeat_cannot_bypass_failed_startup_recovery() {
        let state = AgentWorkerState::default();
        state.install_instance("first".into(), 1).unwrap();
        assert!(!state.execution_enabled());
        assert!(state.heartbeat(Some("first"), true).is_err());
        assert!(!state.ready());
        assert!(state.heartbeat(Some("first"), false).is_ok());
        state.enable_execution();
        assert!(!state.ready());
        assert!(state.heartbeat(Some("first"), true).is_ok());
        assert!(state.ready());
        assert!(state.heartbeat(Some("first"), false).is_ok());
        assert!(!state.ready());
    }

    #[test]
    fn native_supervision_requires_prior_recovery_and_old_heartbeats_cannot_change_a_new_owner() {
        let state = AgentWorkerState::default();
        state.install_instance("first".into(),100).unwrap();
        assert!(!state.restart_due(90_000,false));
        state.enable_execution();
        assert!(!state.restart_due(60_099,true)); assert!(state.restart_due(60_100,true));
        assert!(state.restart_due(200,false));
        state.suspend_execution().unwrap();
        assert!(state.heartbeat(Some("first"),true).is_err());
        state.install_instance("second".into(),300).unwrap();
        state.heartbeat(Some("second"),true).unwrap(); assert!(state.ready());
        assert_eq!(state.heartbeat(Some("first"),false).unwrap_err(),WORKER_SUPERSEDED);
        assert_eq!(state.heartbeat(Some("first"),true).unwrap_err(),WORKER_SUPERSEDED);
        assert!(state.ready()); assert!(state.require_instance(None).is_err());
        state.restart_failed(1_000).unwrap();
        assert!(!state.restart_due(5_999,false)); assert!(state.restart_due(6_000,false));
        state.restart_failed(6_000).unwrap();
        assert!(!state.restart_due(15_999,false)); assert!(state.restart_due(16_000,false));
    }
}
