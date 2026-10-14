//! Approval is local, exact-plan authority; neither a model nor the controller
//! can substitute actions/accounts or return an invented OS receipt.
use super::*;
use sha2::{Digest,Sha256};
use serde_json::json;

fn hash(plan: &DeviceBranchPlan) -> Result<String,String> {
    let value = serde_json::to_value(plan).map_err(|e|e.to_string())?;
    Ok(hex::encode(Sha256::digest(serde_json::to_vec(&value).map_err(|e|e.to_string())?)))
}

impl AutomationStore {
    pub(super) fn mobile_branch_authorization_on_connection(conn: &Connection, entry: &str, branch: &str) -> Result<Value,String> {
        let (watch,submission,_) = Self::local_device_plan_owner(conn,entry)?;
        let Some(plan) = Self::mobile_branch_plan_on_connection(conn,entry,branch)? else { return Ok(Value::Null); };
        let plan_hash = hash(&plan)?;
        let retained: Option<(String,u32,String,Option<i64>)> = conn.query_row("SELECT plan_hash,revision,decision,approved_at FROM automation_mobile_branch_grants WHERE request_id = ?1 AND branch_id = ?2",params![watch.request_id,branch],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).optional().map_err(|e|e.to_string())?;
        if retained.as_ref().is_some_and(|saved|saved.0 != plan_hash) { return Err("Task approval no longer matches the immutable action/account plan".into()); }
        let (revision,decision,approved_at) = retained.map(|saved|(saved.1,saved.2,saved.3)).unwrap_or((0,"pending".into(),None));
        let mut required = false;
        let mut blocked = if submission.cancel_requested {Some("Task cancellation requested".to_string())} else {None};
        let mut unstarted = false;
        for action in &plan.actions {
            match crate::commands::settings::mobile_task_action_requires_approval(conn,&action.input.kind) {
                Ok(ask) => required |= ask,
                Err(error) => blocked = Some(error),
            }
            unstarted |= super::mobile_connector_writes::read(conn,&action.input)?.is_none();
        }
        let allowed = blocked.is_none() && decision != "revoked" && (!required || decision == "approved");
        Ok(json!({"planHash":plan_hash,"revision":revision,"decision":decision,"approvedAt":approved_at,"required":required,"blockedReason":blocked,"allowed":allowed,
            "canApprove":unstarted && blocked.is_none() && decision != "approved","canRevoke":unstarted && decision != "revoked"}))
    }

    pub(crate) fn mobile_branch_authorization(&self, entry: &str, branch: &str) -> Result<Value,String> {
        let conn = self.lock_conn()?;
        Self::mobile_branch_authorization_on_connection(&conn,entry,branch)
    }

    pub(crate) fn decide_mobile_branch_authorization(&self, entry: &str, branch: &str, expected_hash: &str, expected_revision: u32, approve: bool) -> Result<(),String> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let (watch,_,_) = Self::local_device_plan_owner(&tx,entry)?;
        let status = Self::mobile_branch_authorization_on_connection(&tx,entry,branch)?;
        if status.is_null() || status["planHash"] != expected_hash || status["revision"] != expected_revision || expected_revision == u32::MAX {
            return Err("The reviewed action/account plan or approval revision is stale".into());
        }
        if status[if approve {"canApprove"} else {"canRevoke"}] != true {
            return Err("Policy/cancellation/effect state no longer permits this approval decision".into());
        }
        let count: u32 = tx.query_row("SELECT COUNT(*) FROM automation_mobile_branch_grants",[],|row|row.get(0)).map_err(|e|e.to_string())?;
        if expected_revision == 0 && count >= 4096 { return Err("Task approval capacity reached".into()); }
        let now = db::now_ms();
        tx.execute("INSERT INTO automation_mobile_branch_grants (request_id,branch_id,plan_hash,revision,decision,approved_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(request_id,branch_id) DO UPDATE SET revision = excluded.revision, decision = excluded.decision, approved_at = excluded.approved_at, updated_at = excluded.updated_at",params![watch.request_id,branch,expected_hash,expected_revision + 1,if approve {"approved"} else {"revoked"},if approve {Some(now)} else {None},now]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e|e.to_string())
    }

    fn require_mobile_branch_action(conn: &Connection, entry: &str, branch: &str, index: usize, input: &MobileConnectorWriteInput) -> Result<DeviceBranchAction,String> {
        let plan = Self::mobile_branch_plan_on_connection(conn,entry,branch)?.ok_or_else(||"Missing native task action plan".to_string())?;
        let action = plan.actions.get(index).ok_or_else(||"Task action index out of bounds".to_string())?;
        if serde_json::to_value(&action.input).map_err(|e|e.to_string())? != serde_json::to_value(input).map_err(|e|e.to_string())? { return Err("Task effect changed its immutable native operation/arguments".into()); }
        let owner: (String,String,usize) = conn.query_row("SELECT request_id,branch_id,action_index FROM automation_mobile_branch_action_owners WHERE operation_id = ?1",params![input.operation_id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).map_err(|e|e.to_string())?;
        if owner != (plan.request_id.clone(),branch.to_string(),index) { return Err("Native task operation owner changed".into()); }
        // The frozen sequence cannot skip a pending/unknown prior effect even
        // if a caller invokes this command directly instead of the phone loop.
        for prior in plan.actions.iter().take(index) {
            if super::mobile_connector_writes::read(conn,&prior.input)?.is_none_or(|record|record.state != "succeeded") {
                return Err("A prior frozen task action has no durable successful SDK receipt; later effects cannot start".into());
            }
        }
        let status = Self::mobile_branch_authorization_on_connection(conn,entry,branch)?;
        if status["allowed"] != true { return Err(status["blockedReason"].as_str().unwrap_or("Exact task action/account approval is required or was revoked").to_string()); }
        Ok(action.clone())
    }

    pub(crate) fn check_mobile_branch_action(&self, entry: &str, branch: &str, index: usize, input: &MobileConnectorWriteInput) -> Result<(),String> {
        let conn = self.lock_conn()?;
        Self::require_mobile_branch_action(&conn,entry,branch,index,input)?;
        Ok(())
    }

    /// Final claim, original cancellation, retained grant and current settings
    /// are serialized together. Revocation after this claim cannot undo the SDK.
    pub(crate) fn begin_mobile_branch_action(&self, entry: &str, branch: &str, index: usize, input: MobileConnectorWriteInput, destination: Value) -> Result<(MobileConnectorWriteRecord,bool),String> {
        let observed = destination.clone();
        self.begin_mobile_connector_write_guarded(input,destination,|conn,input| {
            let action = Self::require_mobile_branch_action(conn,entry,branch,index,input)?;
            if observed["id"] != action.input.request["calendarId"] || observed["sourceId"] != action.source_id || observed["kind"] != action.input.kind { return Err("Final SDK account/list observation differs from the approved task action".into()); }
            Ok(())
        })
    }
}
