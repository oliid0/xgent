use super::*;

impl AutomationStore {
    /// Native policy uses real queue/owned job state. User/capability waits and
    /// future cron definitions alone do not keep an idle workstation awake.
    pub(crate) fn background_work_requires_awake(&self)->Result<bool,String>{
        let conn=self.lock_conn()?;
        let mode:Option<String>=conn.query_row("SELECT payload_json FROM system_settings WHERE setting_key='executionMode'",[],|row|row.get(0)).optional().map_err(|error|error.to_string())?;
        if let Some(mode)=mode {
            let value:Value=serde_json::from_str(&mode).map_err(|_|"Invalid original execution mode".to_string())?;
            if !value.is_null() && !value.as_str().is_some_and(|mode|matches!(mode.trim(),"tools"|"agent-dev")) {return Ok(false);}
        }
        conn.query_row("SELECT EXISTS(SELECT 1 FROM automation_cron_runs r LEFT JOIN automation_background_budget_deadlines d ON d.execution_id=r.execution_id
            WHERE (d.deadline_at IS NULL OR d.deadline_at>?1) AND (
                r.state='pending' OR (r.state='leased' AND (r.lease_expires_at IS NULL OR r.lease_expires_at>?1))
                OR (r.state='waiting' AND (
                    EXISTS(SELECT 1 FROM automation_background_children c WHERE c.execution_id=r.execution_id AND c.issuer_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1')
                        AND c.receipt_json IS NOT NULL AND c.terminal_confirmed=0 AND (c.observed_state IS NULL OR c.observed_state IN ('pending','leased')))
                    OR EXISTS(SELECT 1 FROM automation_background_cloud_launches c WHERE c.execution_id=r.execution_id AND c.result_json IS NOT NULL
                        AND NOT EXISTS(SELECT 1 FROM automation_background_cloud_completions p WHERE p.execution_id=c.execution_id AND p.call_id=c.call_id AND p.task_id=c.task_id AND p.repository=c.repository COLLATE NOCASE AND (c.owner='' OR c.owner=p.owner COLLATE NOCASE)))
                    OR EXISTS(SELECT 1 FROM automation_video_jobs v WHERE v.execution_id=r.execution_id AND v.issuer_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1')
                        AND v.job_id IS NOT NULL AND v.state IN ('pending','in_progress'))
                ))))",params![db::now_ms()],|row|row.get(0)).map_err(|error|error.to_string())
    }
}
