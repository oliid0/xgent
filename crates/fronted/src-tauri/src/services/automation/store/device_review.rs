//! Local review is observational. It cannot replace plans or manufacture receipts.
use super::*;
use serde_json::json;

fn branch_owner(conn: &Connection, entry: &str, branch: &str) -> Result<(BackgroundResultWatch, BackgroundSubmission, String), String> {
    let owner = AutomationStore::local_device_plan_owner(conn, entry)?;
    if owner.1.input.source_context.as_ref().and_then(|source|source.routing.as_ref())
        .is_none_or(|routing|!routing.branches.iter().any(|source|source.id == branch && source.locality == "initiating-device")) {
        return Err("Unknown original-device branch".into());
    }
    Ok(owner)
}

pub(super) fn ensure_review(conn: &Connection, request: &str, branch: &str) -> Result<(), String> {
    let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM automation_mobile_branch_reviews WHERE request_id = ?1 AND branch_id = ?2)",params![request,branch],|row|row.get(0)).map_err(|e|e.to_string())?;
    if !exists {
        let count: u32 = conn.query_row("SELECT COUNT(*) FROM automation_mobile_branch_reviews",[],|row|row.get(0)).map_err(|e|e.to_string())?;
        if count >= 4096 { return Err("Phone branch review capacity reached".into()); }
        conn.execute("INSERT INTO automation_mobile_branch_reviews (request_id,branch_id,updated_at) VALUES (?1,?2,?3)",params![request,branch,db::now_ms()]).map_err(|e|e.to_string())?;
    }
    Ok(())
}

impl AutomationStore {
    #[cfg(any(mobile, test))]
    pub(crate) fn recover_mobile_branch_planning_on_startup(conn: &Connection) -> Result<(), String> {
        conn.execute("UPDATE automation_mobile_branch_reviews SET last_error = 'Phone restarted during planning; retained task remains unfinished', failed_attempt = (SELECT attempts FROM automation_mobile_branch_planning p WHERE p.request_id = automation_mobile_branch_reviews.request_id AND p.branch_id = automation_mobile_branch_reviews.branch_id), updated_at = ?1 WHERE last_error IS NULL AND EXISTS(SELECT 1 FROM automation_mobile_branch_planning p WHERE p.request_id = automation_mobile_branch_reviews.request_id AND p.branch_id = automation_mobile_branch_reviews.branch_id) AND NOT EXISTS(SELECT 1 FROM automation_mobile_branch_plans p WHERE p.request_id = automation_mobile_branch_reviews.request_id AND p.branch_id = automation_mobile_branch_reviews.branch_id)",params![db::now_ms()]).map_err(|e|e.to_string())?;
        Ok(())
    }
    pub(crate) fn inspect_mobile_branches(&self, entry: &str) -> Result<Value, String> {
        let conn = self.lock_conn()?;
        let (watch,_) = Self::received_task_source_on_connection(&conn,entry)?;
        let submission = Self::background_submission_on_connection(&conn,&watch.request_id)?;
        let device: String = conn.query_row("SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1'",[],|row|row.get(0)).map_err(|e|e.to_string())?;
        if submission.as_ref().is_none_or(|submission|submission.source_host_id != watch.source_host_id || submission.result.is_none() || submission.input.source_context.as_ref().and_then(|source|source.routing.as_ref()).is_none_or(|routing|routing.initiating_host_id != device)) {
            // Portable/legacy/other-installation results have no local action authority.
            return Ok(json!({"requestId":watch.request_id,"sourceHostId":watch.source_host_id,"deviceHostId":device,"cancelRequested":false,"branches":[]}));
        }
        let (_,submission,_) = Self::local_device_plan_owner(&conn,entry)?;
        let routing = submission.input.source_context.as_ref().and_then(|source|source.routing.as_ref()).ok_or_else(||"Missing original branch graph".to_string())?;
        let mut branches = Vec::new();
        for source in routing.branches.iter().filter(|source|source.locality == "initiating-device") {
            let plan = Self::mobile_branch_plan_on_connection(&conn,entry,&source.id)?;
            let records = plan.as_ref().map(|plan|plan.actions.iter().map(|action|super::mobile_connector_writes::read(&conn,&action.input)).collect::<Result<Vec<_>,_>>()).transpose()?.unwrap_or_default();
            let attempts: u32 = conn.query_row("SELECT attempts FROM automation_mobile_branch_planning WHERE request_id = ?1 AND branch_id = ?2",params![watch.request_id,source.id],|row|row.get(0)).optional().map_err(|e|e.to_string())?.unwrap_or(0);
            let (recovery, labels, error, failed_attempt): (u32,String,Option<String>,Option<u32>) = conn.query_row("SELECT recovery,labels_json,last_error,failed_attempt FROM automation_mobile_branch_reviews WHERE request_id = ?1 AND branch_id = ?2",params![watch.request_id,source.id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).optional().map_err(|e|e.to_string())?.unwrap_or((0,"[]".into(),None,None));
            let acknowledged: bool = conn.query_row("SELECT acknowledged FROM automation_mobile_branch_plans WHERE request_id = ?1 AND branch_id = ?2",params![watch.request_id,source.id],|row|row.get(0)).optional().map_err(|e|e.to_string())?.unwrap_or(false);
            let authorization = Self::mobile_branch_authorization_on_connection(&conn,entry,&source.id)?;
            let read_authorization = Self::mobile_branch_read_authorization_on_connection(&conn,entry,&source.id)?;
            branches.push(json!({"source":source,"plan":plan,"records":records,"labels":serde_json::from_str::<Value>(&labels).map_err(|e|e.to_string())?,"attempts":attempts,"recovery":recovery,"lastError":error,"acknowledged":acknowledged,"authorization":authorization,"readAuthorization":read_authorization,
                "canRetryPlanning":!submission.cancel_requested && plan.is_none() && attempts == 3 && failed_attempt == Some(3) && error.is_some()}));
        }
        let result = json!({"requestId":watch.request_id,"sourceHostId":watch.source_host_id,"deviceHostId":device,"cancelRequested":submission.cancel_requested,"branches":branches});
        if serde_json::to_vec(&result).map_err(|e|e.to_string())?.len() > 2 * 1024 * 1024 { return Err("Phone branch review exceeds its bounds".into()); }
        Ok(result)
    }

    pub(crate) fn save_mobile_branch_labels(&self, entry: &str, branch: &str, labels: Value) -> Result<(), String> {
        let raw = serde_json::to_string(&labels).map_err(|e|e.to_string())?;
        if raw.len() > 32 * 1024 { return Err("Observed calendar labels exceed their bounds".into()); }
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let (watch,_,_) = branch_owner(&tx,entry,branch)?;
        let plan = Self::mobile_branch_plan_on_connection(&tx,entry,branch)?.ok_or_else(||"No retained action plan".to_string())?;
        let labels_array = labels.as_array().filter(|labels|labels.len() == plan.actions.len()).ok_or_else(||"Missing native list observations".to_string())?;
        for (action,label) in plan.actions.iter().zip(labels_array) {
            if label["id"] != action.input.request["calendarId"] || label["sourceId"] != action.source_id || !label["title"].is_string() || !label["source"].is_string() { return Err("Observed label changed its frozen account/list".into()); }
        }
        ensure_review(&tx,&watch.request_id,branch)?;
        tx.execute("UPDATE automation_mobile_branch_reviews SET labels_json = ?3, updated_at = ?4 WHERE request_id = ?1 AND branch_id = ?2 AND labels_json = '[]'",params![watch.request_id,branch,raw,db::now_ms()]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e|e.to_string())
    }

    /// Diagnostics do not grant authority. An exhausted planning reservation
    /// becomes recoverable only after its exact generation has reported failure.
    pub(crate) fn note_mobile_branch_error(&self, entry: &str, branch: &str, error: Option<&str>, planning: Option<(u32,u32)>) -> Result<(), String> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let (watch,_,_) = branch_owner(&tx,entry,branch)?;
        ensure_review(&tx,&watch.request_id,branch)?;
        let (recovery, previous_failed): (u32,Option<u32>) = tx.query_row("SELECT recovery,failed_attempt FROM automation_mobile_branch_reviews WHERE request_id = ?1 AND branch_id = ?2",params![watch.request_id,branch],|row|Ok((row.get(0)?,row.get(1)?))).map_err(|e|e.to_string())?;
        let attempts: u32 = tx.query_row("SELECT attempts FROM automation_mobile_branch_planning WHERE request_id = ?1 AND branch_id = ?2",params![watch.request_id,branch],|row|row.get(0)).optional().map_err(|e|e.to_string())?.unwrap_or(0);
        if planning.is_some_and(|ticket|ticket != (attempts,recovery)) { return Err("Planning failure belongs to a retired recovery generation".into()); }
        let failed = if error.is_some() { planning.map(|ticket|ticket.0).or(previous_failed) } else { None };
        let bounded = error.map(|error|error.chars().take(2048).collect::<String>());
        tx.execute("UPDATE automation_mobile_branch_reviews SET last_error = ?3, failed_attempt = ?4, updated_at = ?5 WHERE request_id = ?1 AND branch_id = ?2",params![watch.request_id,branch,bounded,failed,db::now_ms()]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e|e.to_string())
    }

    pub(crate) fn retry_mobile_branch_planning(&self, entry: &str, branch: &str, expected_recovery: u32) -> Result<(), String> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let (watch,submission,device) = branch_owner(&tx,entry,branch)?;
        if submission.cancel_requested || Self::mobile_branch_plan_on_connection(&tx,entry,branch)?.is_some() { return Err("Cancelled or already planned branch cannot be replanned".into()); }
        let attempts: u32 = tx.query_row("SELECT attempts FROM automation_mobile_branch_planning WHERE request_id = ?1 AND branch_id = ?2",params![watch.request_id,branch],|row|row.get(0)).map_err(|e|e.to_string())?;
        let (recovery,failed,error): (u32,Option<u32>,Option<String>) = tx.query_row("SELECT recovery,failed_attempt,last_error FROM automation_mobile_branch_reviews WHERE request_id = ?1 AND branch_id = ?2",params![watch.request_id,branch],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).map_err(|e|e.to_string())?;
        if attempts != 3 || failed != Some(3) || error.is_none() || recovery != expected_recovery || recovery == u32::MAX { return Err("Planning is active, not exhausted, or this recovery view is stale".into()); }
        for index in 0..8 {
            let claimed: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_mobile_connector_writes WHERE operation_id = ?1)",params![super::device_actions::device_action_id(&device,&watch.request_id,branch,index)],|row|row.get(0)).map_err(|e|e.to_string())?;
            if claimed { return Err("A native effect already has a claim; inspect its receipt instead of replanning".into()); }
        }
        tx.execute("DELETE FROM automation_mobile_branch_planning WHERE request_id = ?1 AND branch_id = ?2",params![watch.request_id,branch]).map_err(|e|e.to_string())?;
        tx.execute("UPDATE automation_mobile_branch_reviews SET recovery = recovery + 1, last_error = NULL, failed_attempt = NULL, updated_at = ?3 WHERE request_id = ?1 AND branch_id = ?2",params![watch.request_id,branch,db::now_ms()]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e|e.to_string())
    }
}
