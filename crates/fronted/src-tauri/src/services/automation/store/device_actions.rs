use super::*;
use sha2::{Digest, Sha256};

pub(crate) fn device_action_id(device: &str, request: &str, branch: &str, index: usize) -> String {
    format!("{:x}", Sha256::digest(format!("xgent.device-branch-action.v1\0{device}\0{request}\0{branch}\0{index}").as_bytes()))
}

fn equal<T: serde::Serialize>(left: &T, right: &T) -> Result<bool, String> {
    Ok(serde_json::to_value(left).map_err(|e| e.to_string())? == serde_json::to_value(right).map_err(|e| e.to_string())?)
}

pub(crate) fn validate_device_plan(plan: &DeviceBranchPlan, device: &str) -> Result<(), String> {
    if plan.version != 1 || plan.source.observation.is_some() || plan.source.locality != "initiating-device" || plan.actions.is_empty() || plan.actions.len() > 8
        || serde_json::to_vec(plan).map_err(|e| e.to_string())?.len() > 64 * 1024 {
        return Err("Device branch needs 1–8 bounded concrete calendar/reminder actions".into());
    }
    for (index, action) in plan.actions.iter().enumerate() {
        if !matches!(action.input.kind.as_str(),"calendar_event"|"reminder") {return Err("This device branch authorizes calendar/reminder actions only".into());}
        super::mobile_connector_writes::validate_input(&action.input)?;
        if action.input.device_host_id != device || action.input.operation_id != device_action_id(device, &plan.request_id, &plan.source.id, index)
            || action.source_id.trim().is_empty() || action.source_id.len() > 4096
            || action.input.request["calendarId"].as_str().is_none_or(|id| id.trim().is_empty() || id.len() > 4096) {
            return Err("Device action changed its native task/branch identity or omitted the explicit OS account/list".into());
        }
    }
    Ok(())
}

fn verify_receipt(receipt: &DeviceBranchReceipt, device: &str) -> Result<(), String> {
    validate_device_plan(&receipt.plan, device)?;
    if receipt.receipts.len() != receipt.plan.actions.len() || serde_json::to_vec(receipt).map_err(|e| e.to_string())?.len() > 256 * 1024 {
        return Err("Device completion omitted actions or exceeded receipt bounds".into());
    }
    for (action, saved) in receipt.plan.actions.iter().zip(&receipt.receipts) {
        let result = saved.result.as_ref().ok_or_else(|| "Device action has no saved native receipt".to_string())?;
        if !equal(&action.input, &saved.input)? || saved.state != "succeeded" || saved.error.is_some()
            || saved.destination["id"] != action.input.request["calendarId"] || saved.destination["sourceId"] != action.source_id
            || saved.destination["kind"] != action.input.kind || saved.started_at < 0
            || saved.finished_at.is_none_or(|time| time < saved.started_at) || result["presented"] != false
            || result["id"].as_str().is_none_or(|id| id.trim().is_empty() || id.len() > 4096)
            || result["detail"].as_str().is_none() {
            return Err("Device completion requires actual successful native IDs for every immutable action/account".into());
        }
    }
    Ok(())
}

impl AutomationStore {
    pub(super) fn local_device_plan_owner(conn: &Connection, entry: &str) -> Result<(BackgroundResultWatch, BackgroundSubmission, String), String> {
        let (watch, _) = Self::received_task_source_on_connection(conn, entry)?;
        let submission = Self::background_submission_on_connection(conn, &watch.request_id)?
            .ok_or_else(|| "Device plan has no original native submission".to_string())?;
        let device: String = conn.query_row("SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1'", [], |row| row.get(0)).map_err(|e| e.to_string())?;
        if submission.source_host_id != watch.source_host_id || submission.result.is_none()
            || submission.input.source_context.as_ref().and_then(|source| source.routing.as_ref()).is_none_or(|routing| routing.initiating_host_id != device) {
            return Err("Device action source/controller/installation changed".into());
        }
        Ok((watch, submission, device))
    }

    pub(crate) fn mobile_branch_context(&self, entry: &str) -> Result<Value, String> {
        let conn = self.lock_conn()?;
        let (_, submission, _) = Self::local_device_plan_owner(&conn, entry)?;
        if submission.cancel_requested { return Err("Task cancellation was requested".into()); }
        Ok(serde_json::json!({"prompt":submission.input.prompt,"sourceContext":submission.input.source_context}))
    }

    pub(crate) fn save_mobile_branch_plan(&self, entry: &str, plan: DeviceBranchPlan) -> Result<DeviceBranchPlan, String> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let (watch, submission, device) = Self::local_device_plan_owner(&tx, entry)?;
        if submission.cancel_requested || plan.request_id != watch.request_id || plan.source_host_id != watch.source_host_id {
            return Err("Task was cancelled or plan changed its controller/request".into());
        }
        validate_device_plan(&plan, &device)?;
        let original = submission.input.source_context.as_ref().and_then(|source| source.routing.as_ref())
            .and_then(|routing| routing.branches.iter().find(|branch| branch.id == plan.source.id)).ok_or_else(|| "Plan omitted its original branch".to_string())?;
        if !equal(original, &plan.source)? { return Err("Device action plan changed immutable original requirements/dependencies".into()); }
        let raw = serde_json::to_string(&plan).map_err(|e| e.to_string())?;
        let previous: Option<String> = tx.query_row("SELECT plan_json FROM automation_mobile_branch_plans WHERE request_id = ?1 AND branch_id = ?2", params![plan.request_id, plan.source.id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
        if let Some(previous) = previous {
            if !equal(&serde_json::from_str::<DeviceBranchPlan>(&previous).map_err(|e| e.to_string())?, &plan)? { return Err("Accepted device action plan is immutable; no replacement effect started".into()); }
        } else {
            for action in &plan.actions { Self::validate_mobile_branch_read_destination(&tx,entry,&plan.source.id,action)?; }
            let (count, bytes): (i64, i64) = tx.query_row("SELECT COUNT(*), COALESCE(SUM(LENGTH(CAST(plan_json AS BLOB))), 0) FROM automation_mobile_branch_plans", [], |row| Ok((row.get(0)?, row.get(1)?))).map_err(|e| e.to_string())?;
            if count >= 4096 || bytes + raw.len() as i64 > 64 * 1024 * 1024 { return Err("Device action plan capacity reached".into()); }
            tx.execute("INSERT INTO automation_mobile_branch_plans (request_id, branch_id, entry_id, plan_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5)", params![plan.request_id, plan.source.id, entry, raw, db::now_ms()]).map_err(|e| e.to_string())?;
        }
        for (index,action) in plan.actions.iter().enumerate() {
            tx.execute("INSERT OR IGNORE INTO automation_mobile_branch_action_owners (operation_id,request_id,branch_id,entry_id,action_index) VALUES (?1,?2,?3,?4,?5)",params![action.input.operation_id,plan.request_id,plan.source.id,entry,index]).map_err(|e|e.to_string())?;
            let owner: (String,String,String,usize) = tx.query_row("SELECT request_id,branch_id,entry_id,action_index FROM automation_mobile_branch_action_owners WHERE operation_id = ?1",params![action.input.operation_id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).map_err(|e|e.to_string())?;
            // Different inbox occurrences may refer to the SAME root. The
            // first native owner remains authoritative across later results.
            if owner.0 != plan.request_id || owner.1 != plan.source.id || owner.3 != index { return Err("Native operation already belongs to another task action".into()); }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(plan)
    }

    pub(crate) fn reserve_mobile_branch_planning(&self, entry: &str, branch: &str) -> Result<Value, String> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let (watch, submission, _) = Self::local_device_plan_owner(&tx, entry)?;
        if submission.cancel_requested || submission.input.source_context.as_ref().and_then(|source|source.routing.as_ref())
            .is_none_or(|routing|!routing.branches.iter().any(|source|source.id == branch && source.locality == "initiating-device")) {
            return Err("Cancelled or unknown original-device planning branch".into());
        }
        let planned: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_mobile_branch_plans WHERE request_id = ?1 AND branch_id = ?2)", params![watch.request_id,branch],|row|row.get(0)).map_err(|e|e.to_string())?;
        if planned { return Err("Use the retained immutable action plan instead of planning again".into()); }
        let read_access=Self::mobile_branch_read_authorization_on_connection(&tx,entry,branch)?;
        if read_access["allowedKinds"].as_array().is_none_or(Vec::is_empty) { return Err("Authorize actual task read lists before reserving a model attempt".into()); }
        let attempts: u32 = tx.query_row("SELECT attempts FROM automation_mobile_branch_planning WHERE request_id = ?1 AND branch_id = ?2",params![watch.request_id,branch],|row|row.get(0)).optional().map_err(|e|e.to_string())?.unwrap_or(0);
        if attempts >= 3 { return Err("Automatic phone planning limit reached; retained task remains unfinished and requires explicit recovery".into()); }
        tx.execute("INSERT INTO automation_mobile_branch_planning (request_id,branch_id,attempts) VALUES (?1,?2,1) ON CONFLICT(request_id,branch_id) DO UPDATE SET attempts = attempts + 1",params![watch.request_id,branch]).map_err(|e|e.to_string())?;
        super::device_review::ensure_review(&tx,&watch.request_id,branch)?;
        tx.execute("UPDATE automation_mobile_branch_reviews SET last_error = NULL, failed_attempt = NULL, updated_at = ?3 WHERE request_id = ?1 AND branch_id = ?2",params![watch.request_id,branch,db::now_ms()]).map_err(|e|e.to_string())?;
        let recovery: u32 = tx.query_row("SELECT recovery FROM automation_mobile_branch_reviews WHERE request_id = ?1 AND branch_id = ?2",params![watch.request_id,branch],|row|row.get(0)).map_err(|e|e.to_string())?;
        let context = serde_json::json!({"prompt":submission.input.prompt,"sourceContext":submission.input.source_context,"planning":{"attempts":attempts + 1,"recovery":recovery}});
        tx.commit().map_err(|e|e.to_string())?;
        Ok(context)
    }

    pub(crate) fn read_mobile_branch_plan(&self, entry: &str, branch: &str) -> Result<Option<DeviceBranchPlan>, String> {
        let conn = self.lock_conn()?;
        Self::mobile_branch_plan_on_connection(&conn, entry, branch)
    }

    pub(super) fn mobile_branch_plan_on_connection(conn: &Connection, entry: &str, branch: &str) -> Result<Option<DeviceBranchPlan>, String> {
        let (watch, submission, device) = Self::local_device_plan_owner(conn, entry)?;
        let raw: Option<String> = conn.query_row("SELECT plan_json FROM automation_mobile_branch_plans WHERE request_id = ?1 AND branch_id = ?2", params![watch.request_id, branch], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
        raw.map(|raw| {
            let plan: DeviceBranchPlan = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            validate_device_plan(&plan, &device)?;
            if plan.request_id != watch.request_id || plan.source_host_id != watch.source_host_id || plan.source.id != branch { return Err("Retained device plan changed owner".into()); }
            let original = submission.input.source_context.as_ref().and_then(|source|source.routing.as_ref()).and_then(|routing|routing.branches.iter().find(|source|source.id == branch)).ok_or_else(||"Retained plan lost its original branch".to_string())?;
            if !equal(original,&plan.source)? { return Err("Retained plan changed original requirements/dependencies".into()); }
            Ok(plan)
        }).transpose()
    }

    pub(crate) fn pending_mobile_branch_plans(&self, cursor: u64, limit: usize) -> Result<Value, String> {
        let conn = self.lock_conn()?;
        let limit = limit.clamp(1, 32);
        let mut stmt = conn.prepare("SELECT rowid, entry_id, branch_id FROM automation_mobile_branch_plans WHERE acknowledged = 0 AND rowid > ?1 ORDER BY rowid LIMIT ?2").map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![cursor.min(i64::MAX as u64), limit], |row| Ok(serde_json::json!({"sequence":row.get::<_,u64>(0)?,"entryId":row.get::<_,String>(1)?,"branchId":row.get::<_,String>(2)?}))).map_err(|e| e.to_string())?;
        let items = rows.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
        let next = if items.len() == limit { items.last().and_then(|item|item["sequence"].as_u64()) } else { None };
        Ok(serde_json::json!({"items":items,"nextCursor":next}))
    }

    pub(crate) fn mobile_branch_receipt(&self, entry: &str, branch: &str) -> Result<DeviceBranchReceipt, String> {
        let plan = self.read_mobile_branch_plan(entry, branch)?.ok_or_else(|| "Device branch has no durable action plan".to_string())?;
        let receipts = plan.actions.iter().map(|action| self.read_mobile_connector_write(&action.input)?.ok_or_else(|| "Device branch still has an unexecuted action".to_string())).collect::<Result<Vec<_>,_>>()?;
        let receipt = DeviceBranchReceipt { plan, receipts };
        verify_receipt(&receipt, &self.background_worker_identity()?)?;
        Ok(receipt)
    }

    pub(crate) fn acknowledge_mobile_branch(&self, entry: &str, branch: &str) -> Result<(), String> {
        let conn = self.lock_conn()?;
        let (watch, _, _) = Self::local_device_plan_owner(&conn, entry)?;
        conn.execute("UPDATE automation_mobile_branch_plans SET acknowledged = 1 WHERE request_id = ?1 AND branch_id = ?2", params![watch.request_id, branch]).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn controller_device_plan_owner(conn: &Connection, plan: &DeviceBranchPlan, device: &str) -> Result<String, String> {
        validate_device_plan(plan, device)?;
        let host: String = conn.query_row("SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1'", [], |row| row.get(0)).map_err(|e| e.to_string())?;
        let (id, raw): (String, String) = conn.query_row("SELECT execution_id, input_json FROM automation_background_tasks WHERE request_id = ?1", params![plan.request_id], |row| Ok((row.get(0)?, row.get(1)?))).map_err(|e| e.to_string())?;
        let input: SubmitBackgroundTaskInput = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let routing = input.source_context.and_then(|source| source.routing).ok_or_else(|| "Device action has no immutable source graph".to_string())?;
        let original = routing.branches.iter().find(|source| source.id == plan.source.id).ok_or_else(|| "Device action has no source branch".to_string())?;
        if host != plan.source_host_id || routing.initiating_host_id != device || !equal(original, &plan.source)? { return Err("Device action changed its original controller/graph".into()); }
        Ok(id)
    }

    fn require_ready_device_plan(conn: &Connection, execution: &str, plan: &DeviceBranchPlan) -> Result<(), String> {
        let run = db::read_runs(conn, execution, 1)?.into_iter().next().ok_or_else(|| "Missing controller execution".to_string())?;
        if !matches!(run.state, RunState::Pending | RunState::Leased | RunState::Waiting) { return Err("Controller task is terminal/cancelled".into()); }
        let report = Self::background_outcome_report(conn, execution)?.ok_or_else(|| "Controller has not planned this branch".to_string())?;
        let branch = report.branches.iter().find(|branch| branch.branch.id == plan.source.id).ok_or_else(|| "Missing controller branch".to_string())?;
        if branch.state == "verified" || !branch.branch.criteria.iter().all(|criterion| matches!(criterion, BackgroundCriterion::Unavailable { .. }))
            || plan.source.depends_on.iter().any(|id| !report.branches.iter().any(|branch| branch.branch.id == *id && branch.state == "verified")) {
            return Err("Device branch is already complete or its actual dependencies are not verified".into());
        }
        Ok(())
    }

    pub(crate) fn register_device_branch_plan(&self, plan: DeviceBranchPlan, proof: &BackgroundDeviceChannelProof) -> Result<Value, String> {
        self.authorize_background_device_channel(&plan.request_id, proof)?;
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let id = Self::controller_device_plan_owner(&tx, &plan, &proof.initiating_host_id)?;
        Self::require_ready_device_plan(&tx, &id, &plan)?;
        let previous: Option<String> = tx.query_row("SELECT plan_json FROM automation_background_device_actions WHERE execution_id = ?1 AND branch_id = ?2", params![id, plan.source.id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
        if let Some(raw) = previous {
            if !equal(&serde_json::from_str::<DeviceBranchPlan>(&raw).map_err(|e| e.to_string())?, &plan)? { return Err("Controller action plan is immutable".into()); }
        } else {
            tx.execute("INSERT INTO automation_background_device_actions (execution_id, branch_id, plan_json, created_at) VALUES (?1, ?2, ?3, ?4)", params![id, plan.source.id, serde_json::to_string(&plan).map_err(|e| e.to_string())?, db::now_ms()]).map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(serde_json::json!({"accepted":true,"requestId":plan.request_id,"sourceHostId":plan.source_host_id,"branchId":plan.source.id}))
    }

    /// Only the original native channel can publish this packet. The caller on
    /// the phone constructs it by reading its ledger, never from WebView results.
    pub(crate) fn accept_device_branch_receipt(&self, receipt: DeviceBranchReceipt, proof: &BackgroundDeviceChannelProof,
        load: impl FnOnce(&Connection, &SubmitBackgroundTaskInput) -> Result<(String, Value), String>) -> Result<Value, String> {
        self.authorize_background_device_channel(&receipt.plan.request_id, proof)?;
        verify_receipt(&receipt, &proof.initiating_host_id)?;
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let id = Self::controller_device_plan_owner(&tx, &receipt.plan, &proof.initiating_host_id)?;
        let (raw, previous): (String, Option<String>) = tx.query_row("SELECT plan_json, receipt_json FROM automation_background_device_actions WHERE execution_id = ?1 AND branch_id = ?2", params![id, receipt.plan.source.id], |row| Ok((row.get(0)?, row.get(1)?))).map_err(|_| "Controller never accepted this action plan before the effect".to_string())?;
        if !equal(&serde_json::from_str::<DeviceBranchPlan>(&raw).map_err(|e| e.to_string())?, &receipt.plan)? { return Err("Receipt changed accepted actions".into()); }
        if let Some(raw) = previous {
            if !equal(&serde_json::from_str::<DeviceBranchReceipt>(&raw).map_err(|e| e.to_string())?, &receipt)? { return Err("Accepted native device receipt is immutable".into()); }
        } else {
            Self::require_ready_device_plan(&tx, &id, &receipt.plan)?;
            tx.execute("UPDATE automation_background_device_actions SET receipt_json = ?3 WHERE execution_id = ?1 AND branch_id = ?2 AND receipt_json IS NULL", params![id, receipt.plan.source.id, serde_json::to_string(&receipt).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
            tx.execute("INSERT OR IGNORE INTO automation_background_device_wakes (execution_id, branch_id) VALUES (?1, ?2)", params![id,receipt.plan.source.id]).map_err(|e|e.to_string())?;
        }
        // Retained callback and SAME-task wake/checkpoint are one transaction.
        // A failed configuration/checkpoint fence rolls back; phone receipts remain.
        let needs_wake: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_background_device_wakes WHERE execution_id = ?1 AND branch_id = ?2)", params![id,receipt.plan.source.id], |row|row.get(0)).map_err(|e|e.to_string())?;
        if let Some(wait) = if needs_wake { Self::background_wait_record(&tx, &id)? } else { None } {
            Self::verify_background_binding(&tx, &id, load)?;
            Self::resume_wait_on_connection(&tx, &id, &ResumeBackgroundTaskInput {
                request_id:receipt.plan.request_id.clone(),wait_id:wait.wait_id,resume_id:Uuid::new_v4().to_string(),
                response:format!("Original device native receipts were durably verified for branch {}. ReadBackgroundOutcomes contains the actual saved IDs. Continue the SAME task from retained evidence; do not repeat its device actions.",receipt.plan.source.id),
            })?;
            tx.execute("DELETE FROM automation_background_device_wakes WHERE execution_id = ?1",params![id]).map_err(|e|e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        drop(conn);
        self.with_notifier(|notifier| notifier.prompt_pending());
        Ok(serde_json::json!({"accepted":true,"requestId":receipt.plan.request_id,"sourceHostId":receipt.plan.source_host_id,"branchId":receipt.plan.source.id}))
    }

    /// Revalidate retained proof at every outcome read and at final completion.
    /// Model outcome state/text is not authority for original-device effects.
    pub(super) fn verified_device_branch(conn: &Connection, execution: &str, branch: &BackgroundBranch) -> Result<Option<BackgroundBranchEvidence>, String> {
        let raw: Option<String> = conn.query_row("SELECT receipt_json FROM automation_background_device_actions WHERE execution_id = ?1 AND branch_id = ?2 AND receipt_json IS NOT NULL", params![execution, branch.id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
        let Some(raw) = raw else { return Self::verified_device_observation(conn,execution,branch); };
        if !branch.criteria.iter().all(|criterion| matches!(criterion, BackgroundCriterion::Unavailable { .. })) { return Err("Device receipt cannot replace unrelated evidence criteria".into()); }
        let receipt: DeviceBranchReceipt = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let device = receipt.plan.actions.first().ok_or_else(|| "Device proof omitted actions".to_string())?.input.device_host_id.as_str();
        verify_receipt(&receipt, device)?;
        if Self::controller_device_plan_owner(conn, &receipt.plan, device)? != execution || receipt.plan.source.id != branch.id
            || receipt.plan.source.requirement != branch.requirement || receipt.plan.source.depends_on != branch.depends_on { return Err("Device proof changed execution/branch/requirements/dependencies".into()); }
        let raw_plan: String = conn.query_row("SELECT plan_json FROM automation_background_device_actions WHERE execution_id = ?1 AND branch_id = ?2", params![execution,branch.id],|row|row.get(0)).map_err(|e|e.to_string())?;
        if !equal(&serde_json::from_str::<DeviceBranchPlan>(&raw_plan).map_err(|e|e.to_string())?,&receipt.plan)? { return Err("Retained device proof changed its pre-effect plan".into()); }
        let origin: String = conn.query_row("SELECT initiating_host_id FROM automation_background_device_channels WHERE request_id = ?1", params![receipt.plan.request_id], |row| row.get(0)).map_err(|e|e.to_string())?;
        if origin != device { return Err("Retained device proof lost its authenticated original channel".into()); }
        let summary = receipt.receipts.iter().map(|saved| serde_json::json!({"kind":saved.input.kind,"recordId":saved.result.as_ref().and_then(|result|result.get("id")),"destination":saved.destination,"completedAt":saved.finished_at})).collect::<Vec<_>>();
        Ok(Some(BackgroundBranchEvidence {artifact_ids:vec![],call_ids:vec![],answer:Some(serde_json::to_string(&summary).map_err(|e|e.to_string())?)}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn phone_policy(phone: &AutomationStore, policy: &str) {
        let conn = phone.lock_conn().unwrap();
        conn.execute_batch("CREATE TABLE IF NOT EXISTS system_settings (setting_key TEXT PRIMARY KEY NOT NULL,payload_json TEXT NOT NULL,updated_at INTEGER NOT NULL)").unwrap();
        for (key,value) in [("executionMode",json!("tools")),("commandSafetyMode",json!("auto")),("toolPolicies",json!({"personal:calendar":policy,"personal:reminders":policy}))] {
            conn.execute("INSERT OR REPLACE INTO system_settings (setting_key,payload_json,updated_at) VALUES (?1,?2,1)",params![key,value.to_string()]).unwrap();
        }
    }

    fn fixture() -> (AutomationStore, AutomationStore, SubmitBackgroundTaskInput, BackgroundDeviceChannelProof, String, BackgroundExecutionLease, DeviceBranchPlan) {
        let controller = AutomationStore::open_in_memory().unwrap();
        let phone = AutomationStore::open_in_memory().unwrap();
        phone_policy(&phone,"allow");
        let device = phone.background_worker_identity().unwrap();
        let proof = BackgroundDeviceChannelProof {version:1,initiating_host_id:device.clone(),token:"a".repeat(64)};
        let request = Uuid::new_v4().to_string();
        let source = BackgroundSourceBranch {observation:None,id:"calendar".into(),requirement:"Schedule the requested event on the original phone".into(),depends_on:vec!["report".into()],locality:"initiating-device".into()};
        let input = SubmitBackgroundTaskInput {intelligent_scheduling_enabled: false, request_id:request.clone(),name:"Report and calendar".into(),prompt:"Create the report and requested calendar event".into(),provider_id:"model".into(),model:"model".into(),workdir:std::env::temp_dir().to_string_lossy().into_owned(),timeout_seconds:300,reasoning:"medium".into(),files:vec![],delegation:None,requirements:None,
            goal_binding:None, source_context:Some(BackgroundSourceContext {version:1,original_request:None,request_clock:None,request_scope:"original".into(),system_prompt:String::new(),messages:vec![json!({"role":"user","content":"Report and calendar"})],routing:Some(BackgroundSourceRouting {version:1,initiating_host_id:device.clone(),branches:vec![BackgroundSourceBranch {observation:None,id:"report".into(),requirement:"Create report".into(),depends_on:vec![],locality:"portable".into()},source.clone()]})})};
        let task = controller.submit_background_task_with_device_channel(input.clone(),Some(&proof),|_,_|Ok("pinned".into())).unwrap();
        let lease = controller.claim_prompt_runs().unwrap().remove(0).lease.unwrap();
        controller.save_background_plan(SaveBackgroundPlanInput {execution_id:task.run.id.clone(),lease:Some(lease.clone()),plan:BackgroundTaskPlan {version:1,branches:vec![
            BackgroundBranch {id:"report".into(),title:"Report".into(),requirement:"Create report".into(),depends_on:vec![],criteria:vec![BackgroundCriterion::Answer]},
            BackgroundBranch {id:source.id.clone(),title:"Calendar".into(),requirement:source.requirement.clone(),depends_on:source.depends_on.clone(),criteria:vec![BackgroundCriterion::Unavailable {capability:"Original phone calendar".into()}]}]}},|_,_|Ok(())).unwrap();
        let plan = DeviceBranchPlan {version:1,request_id:request.clone(),source_host_id:controller.background_worker_identity().unwrap(),source,actions:vec![DeviceBranchAction {input:MobileConnectorWriteInput {
            operation_id:device_action_id(&device,&request,"calendar",0),device_host_id:device,kind:"calendar_event".into(),
            request:json!({"title":"Requested event","calendarId":"actual-calendar","startMs":2000000000000_i64,"endMs":2000003600000_i64,"allDay":false,"notes":null,"location":null})},source_id:"actual-account".into()}]};
        (controller,phone,input,proof,task.run.id,lease,plan)
    }
    fn report(controller: &AutomationStore, id: &str, lease: &BackgroundExecutionLease) {
        controller.record_background_outcome(RecordBackgroundOutcomeInput {execution_id:id.into(),lease:Some(lease.clone()),branch_id:"report".into(),evidence:Some(BackgroundBranchEvidence {artifact_ids:vec![],call_ids:vec![],answer:Some("Actual report answer".into())}),waiting_reason:None,waiting_tool:None,waiting_inventory:None},|_,_|Ok(())).unwrap();
    }
    fn receipt(phone: &AutomationStore, plan: &DeviceBranchPlan) -> DeviceBranchReceipt {
        let input = &plan.actions[0].input;
        let owner: Option<(String,String)> = phone.lock_conn().unwrap().query_row("SELECT entry_id,branch_id FROM automation_mobile_branch_action_owners WHERE operation_id = ?1",params![input.operation_id],|row|Ok((row.get(0)?,row.get(1)?))).optional().unwrap();
        let destination = json!({"kind":input.kind,"id":"actual-calendar","sourceId":"actual-account","source":"Personal"});
        // Proof-only controller fixtures have no local owned plan. Real phone
        // plan fixtures must use the guarded task claim, never the generic path.
        if let Some((entry,branch)) = owner { phone.begin_mobile_branch_action(&entry,&branch,0,input.clone(),destination).unwrap(); }
        else { phone.begin_mobile_connector_write(input.clone(),destination).unwrap(); }
        let saved = phone.complete_mobile_connector_write(input,Ok(json!({"id":"actual-native-id","presented":false,"detail":"Saved record fixture"}))).unwrap();
        DeviceBranchReceipt {plan:plan.clone(),receipts:vec![saved]}
    }

    fn owned_task() -> (AutomationStore,String,DeviceBranchPlan) {
        let (controller,phone,input,_,id,lease,plan) = fixture(); report(&controller,&id,&lease);
        controller.record_background_outcome(RecordBackgroundOutcomeInput {execution_id:id.clone(),lease:Some(lease.clone()),branch_id:"calendar".into(),evidence:None,waiting_reason:Some("Phone work".into()),waiting_tool:None,waiting_inventory:None},|_,_|Ok(())).unwrap();
        controller.save_background_checkpoint(SaveBackgroundCheckpointInput {execution_id:id.clone(),lease:Some(lease.clone()),revision:1,context:json!({"systemPrompt":"Original","messages":[{"role":"user","content":"Report and calendar","timestamp":1},{"role":"assistant","api":"openai-completions","content":[{"type":"text","text":"Actual report; phone waiting"}],"stopReason":"stop","timestamp":2}]})}).unwrap();
        controller.wait_background_task(WaitBackgroundTaskInput {execution_id:id,lease,duration_ms:1,output:"Actual report".into(),known_tools:vec![],budget_deferral_id:None}).unwrap();
        phone.stage_background_submission(&plan.source_host_id,input,json!({})).unwrap();
        let pending = phone.claim_background_submissions(Some(&plan.request_id)).unwrap().remove(0);
        let task = serde_json::to_value(controller.background_task(&plan.request_id).unwrap()).unwrap();
        phone.receive_background_result(&BackgroundResultWatch {source_host_id:plan.source_host_id.clone(),request_id:plan.request_id.clone()},task.clone()).unwrap();
        phone.complete_background_submission(&pending,&task).unwrap();
        let entry = phone.list_background_inbox(0,1,false).unwrap().items[0].id.clone();
        (phone,entry,plan)
    }

    fn owned_plan(two: bool) -> (AutomationStore,String,DeviceBranchPlan) {
        let (phone,entry,mut plan) = owned_task();
        if two { let mut action=plan.actions[0].clone(); action.input.operation_id=device_action_id(&action.input.device_host_id,&plan.request_id,"calendar",1); action.input.request["title"]=json!("Second actual action"); plan.actions.push(action); }
        phone.save_mobile_branch_plan(&entry,plan.clone()).unwrap(); phone_policy(&phone,"ask");
        (phone,entry,plan)
    }

    #[test]
    fn read_ask_does_not_spend_model_attempts_and_grants_bind_original_accounts() {
        let (phone,entry,plan)=owned_task();phone_policy(&phone,"ask");
        assert!(phone.reserve_mobile_branch_planning(&entry,"calendar").is_err());
        assert_eq!(phone.inspect_mobile_branches(&entry).unwrap()["branches"][0]["attempts"],0);
        let status=phone.mobile_branch_read_authorization(&entry,"calendar").unwrap();
        let hash=status["contextHash"].as_str().unwrap();
        let selected=MobileReadDestination {kind:"event".into(),id:plan.actions[0].input.request["calendarId"].as_str().unwrap().into(),source_id:plan.actions[0].source_id.clone(),title:"Native observed".into(),source:"Actual account".into(),writable:true,start_ms:None,end_ms:None};
        assert!(phone.decide_mobile_branch_read_authorization(&entry,"calendar","other-context",0,vec![selected.clone()],true).is_err());
        assert!(phone.decide_mobile_branch_read_authorization(&entry,"calendar",hash,1,vec![selected.clone()],true).is_err());
        phone.decide_mobile_branch_read_authorization(&entry,"calendar",hash,0,vec![selected.clone()],true).unwrap();
        assert!(phone.mobile_branch_read_scope(&entry,"calendar","reminder").is_err());
        assert!(phone.mobile_branch_read_scope(&entry,"unknown","event").is_err());
        assert_eq!(phone.mobile_branch_read_scope(&entry,"calendar","event").unwrap().1.unwrap()[0].source_id,selected.source_id);
        let mut wrong=plan.clone();wrong.actions[0].source_id="other-account".into();
        assert!(phone.save_mobile_branch_plan(&entry,wrong).is_err());
        phone.save_mobile_branch_plan(&entry,plan.clone()).unwrap();
        assert_eq!(phone.mobile_branch_authorization(&entry,"calendar").unwrap()["allowed"],false);
        phone.decide_mobile_branch_read_authorization(&entry,"calendar",hash,1,vec![],false).unwrap();
        phone_policy(&phone,"allow");
        assert!(phone.mobile_branch_read_scope(&entry,"calendar","event").is_err());
        assert_eq!(phone.mobile_branch_authorization(&entry,"calendar").unwrap()["allowed"],true);
    }

    #[test]
    fn read_scope_rechecks_current_deny_and_cancellation() {
        let (phone,entry,_)=owned_task();
        assert!(phone.mobile_branch_read_scope(&entry,"calendar","event").unwrap().1.is_none());
        let status=phone.mobile_branch_read_authorization(&entry,"calendar").unwrap();
        let hash=status["contextHash"].as_str().unwrap();
        let selected=MobileReadDestination {kind:"event".into(),id:"list".into(),source_id:"source".into(),title:"Observed".into(),source:"OS account".into(),writable:false,start_ms:None,end_ms:None};
        phone.decide_mobile_branch_read_authorization(&entry,"calendar",hash,0,vec![selected.clone()],true).unwrap();
        phone_policy(&phone,"deny");assert!(phone.mobile_branch_read_scope(&entry,"calendar","event").is_err());
        phone_policy(&phone,"ask");
        let request=phone.inspect_mobile_branches(&entry).unwrap()["requestId"].as_str().unwrap().to_string();
        phone.cancel_background_submission(&request).unwrap();
        assert!(phone.mobile_branch_read_scope(&entry,"calendar","event").is_err());
        assert!(phone.decide_mobile_branch_read_authorization(&entry,"calendar",hash,1,vec![selected],true).is_err());
        phone.decide_mobile_branch_read_authorization(&entry,"calendar",hash,1,vec![],false).unwrap();
    }

    #[test]
    fn exact_plan_approval_rejects_stale_revisions_and_generic_task_operation_claims() {
        let (phone,entry,plan) = owned_plan(false); let input=plan.actions[0].input.clone();
        let destination=json!({"kind":input.kind,"id":"actual-calendar","sourceId":"actual-account","source":"Personal"});
        let status=phone.mobile_branch_authorization(&entry,"calendar").unwrap(); let hash=status["planHash"].as_str().unwrap();
        assert_eq!(status["required"],true); assert_eq!(status["allowed"],false);
        assert!(phone.begin_mobile_branch_action(&entry,"calendar",0,input.clone(),destination.clone()).is_err());
        assert!(phone.begin_mobile_connector_write(input.clone(),destination.clone()).is_err());
        assert!(phone.decide_mobile_branch_authorization(&entry,"calendar","different-hash",0,true).is_err());
        assert!(phone.decide_mobile_branch_authorization(&entry,"calendar",hash,1,true).is_err());
        phone.decide_mobile_branch_authorization(&entry,"calendar",hash,0,true).unwrap();
        assert!(phone.decide_mobile_branch_authorization(&entry,"calendar",hash,0,true).is_err());
        let mut changed=input.clone(); changed.request["title"]=json!("Not reviewed");
        assert!(phone.begin_mobile_branch_action(&entry,"calendar",0,changed,destination.clone()).is_err());
        let mut changed=destination.clone(); changed["sourceId"]=json!("Other account");
        assert!(phone.begin_mobile_branch_action(&entry,"calendar",0,input.clone(),changed).is_err());
        assert!(phone.read_mobile_connector_write(&input).unwrap().is_none());
        assert!(phone.begin_mobile_branch_action(&entry,"calendar",0,input,destination).unwrap().1);
    }

    #[test]
    fn revocation_between_account_read_and_claim_blocks_remaining_writes_without_replaying_claimed_effects() {
        let (phone,entry,plan)=owned_plan(true); let first=&plan.actions[0].input; let second=&plan.actions[1].input;
        let destination=json!({"kind":"calendar_event","id":"actual-calendar","sourceId":"actual-account","source":"Personal"});
        let status=phone.mobile_branch_authorization(&entry,"calendar").unwrap(); let hash=status["planHash"].as_str().unwrap();
        phone.decide_mobile_branch_authorization(&entry,"calendar",hash,0,true).unwrap();
        phone.begin_mobile_branch_action(&entry,"calendar",0,first.clone(),destination.clone()).unwrap();
        assert!(phone.begin_mobile_branch_action(&entry,"calendar",1,second.clone(),destination.clone()).is_err());
        phone.complete_mobile_connector_write(first,Ok(json!({"id":"actual-native-first-id","presented":false,"detail":"Saved record fixture"}))).unwrap();
        phone.check_mobile_branch_action(&entry,"calendar",1,second).unwrap(); // Before a slow SDK account read.
        phone.decide_mobile_branch_authorization(&entry,"calendar",hash,1,false).unwrap();
        assert!(phone.begin_mobile_branch_action(&entry,"calendar",1,second.clone(),destination.clone()).is_err());
        assert!(phone.read_mobile_connector_write(second).unwrap().is_none());
        assert!(!phone.begin_mobile_branch_action(&entry,"calendar",0,first.clone(),destination).unwrap().1);
        assert_eq!(phone.mobile_branch_authorization(&entry,"calendar").unwrap()["decision"],"revoked");
    }

    #[test]
    fn persisted_deny_or_original_cancellation_wins_after_preflight_and_exact_approval() {
        for cancelled in [false,true] {
            let (phone,entry,plan)=owned_plan(false); let input=&plan.actions[0].input;
            let status=phone.mobile_branch_authorization(&entry,"calendar").unwrap();
            phone.decide_mobile_branch_authorization(&entry,"calendar",status["planHash"].as_str().unwrap(),0,true).unwrap();
            phone.check_mobile_branch_action(&entry,"calendar",0,input).unwrap();
            if cancelled { phone.cancel_background_submission(&plan.request_id).unwrap(); } else { phone_policy(&phone,"deny"); }
            assert!(phone.begin_mobile_branch_action(&entry,"calendar",0,input.clone(),json!({"kind":input.kind,"id":"actual-calendar","sourceId":"actual-account","source":"Personal"})).is_err());
            assert!(phone.read_mobile_connector_write(input).unwrap().is_none());
        }
    }

    #[test]
    fn concrete_device_plans_require_the_original_channel_dependencies_and_immutable_actions() {
        let (controller,_,_,proof,id,lease,plan) = fixture();
        assert!(controller.register_device_branch_plan(plan.clone(),&proof).is_err());
        report(&controller,&id,&lease);
        let wrong = BackgroundDeviceChannelProof {token:"b".repeat(64),..proof.clone()};
        assert!(controller.register_device_branch_plan(plan.clone(),&wrong).is_err());
        controller.register_device_branch_plan(plan.clone(),&proof).unwrap();
        controller.register_device_branch_plan(plan.clone(),&proof).unwrap();
        let mut changed = plan.clone(); changed.actions[0].input.request["title"] = json!("Replacement");
        assert!(controller.register_device_branch_plan(changed,&proof).is_err());
        controller.cancel_background_task(&plan.request_id).unwrap();
        assert!(controller.register_device_branch_plan(plan,&proof).is_err());
    }

    #[test]
    fn native_receipts_never_accept_unknown_accounts_missing_actions_or_changed_ids() {
        let (controller,phone,_,proof,id,lease,plan) = fixture(); report(&controller,&id,&lease);
        let actual = receipt(&phone,&plan);
        assert!(controller.accept_device_branch_receipt(actual.clone(),&proof,|_,_|panic!("No plan")).is_err());
        controller.register_device_branch_plan(plan.clone(),&proof).unwrap();
        for mutated in 0..5 {
            let mut wrong = actual.clone();
            match mutated {
                0 => wrong.receipts.clear(),
                1 => wrong.receipts[0].state = "unknown".into(),
                2 => wrong.receipts[0].destination["sourceId"] = json!("Other account"),
                3 => wrong.receipts[0].input.operation_id = "b".repeat(64),
                _ => wrong.receipts[0].result.as_mut().unwrap()["presented"] = json!(true),
            }
            assert!(controller.accept_device_branch_receipt(wrong,&proof,|_,_|panic!("No configuration read before proof")).is_err());
        }
        controller.accept_device_branch_receipt(actual.clone(),&proof,|_,_|panic!("Leased callback need not wake")).unwrap();
        assert!(controller.read_background_outcomes(&id,Some(&lease)).unwrap().unwrap().verified);
        AutomationStore::require_background_outcomes(&controller.lock_conn().unwrap(),&id).unwrap();
        controller.accept_device_branch_receipt(actual.clone(),&proof,|_,_|panic!("Receipt retry")).unwrap();
        let mut changed = actual; changed.receipts[0].result.as_mut().unwrap()["id"] = json!("Replacement ID");
        assert!(controller.accept_device_branch_receipt(changed,&proof,|_,_|panic!("Immutable receipt")).is_err());
        controller.lock_conn().unwrap().execute("UPDATE automation_background_device_actions SET receipt_json = NULL",[]).unwrap();
        assert!(AutomationStore::require_background_outcomes(&controller.lock_conn().unwrap(),&id).is_err());
    }

    #[test]
    fn phone_callback_wakes_the_same_retained_checkpoint_once_and_revoked_configuration_rolls_back() {
        let (controller,phone,_,proof,id,lease,plan) = fixture(); report(&controller,&id,&lease);
        controller.record_background_outcome(RecordBackgroundOutcomeInput {execution_id:id.clone(),lease:Some(lease.clone()),branch_id:"calendar".into(),evidence:None,waiting_reason:Some("Original phone offline".into()),waiting_tool:None,waiting_inventory:None},|_,_|Ok(())).unwrap();
        controller.save_background_checkpoint(SaveBackgroundCheckpointInput {execution_id:id.clone(),lease:Some(lease.clone()),revision:1,context:json!({"systemPrompt":"Original task policy","messages":[{"role":"user","content":"Report and calendar","timestamp":1},{"role":"assistant","api":"openai-completions","content":[{"type":"text","text":"Actual report retained; phone waiting"}],"stopReason":"stop","timestamp":2}]})}).unwrap();
        controller.wait_background_task(WaitBackgroundTaskInput {execution_id:id.clone(),lease,duration_ms:10,output:"Actual report retained".into(),known_tools:vec![],budget_deferral_id:None}).unwrap();
        controller.register_device_branch_plan(plan.clone(),&proof).unwrap();
        let actual = receipt(&phone,&plan);
        assert!(controller.accept_device_branch_receipt(actual.clone(),&proof,|_,_|Err("Configuration revoked".into())).is_err());
        assert_eq!(controller.background_task(&plan.request_id).unwrap().run.state,RunState::Waiting);
        controller.accept_device_branch_receipt(actual.clone(),&proof,|_,_|Ok(("pinned".into(),json!({})))).unwrap();
        assert_eq!(controller.background_task(&plan.request_id).unwrap().run.state,RunState::Pending);
        assert_eq!(controller.background_task(&plan.request_id).unwrap().checkpoint_revision,2);
        controller.accept_device_branch_receipt(actual,&proof,|_,_|panic!("Lost ACK never wakes twice")).unwrap();
        assert_eq!(controller.background_task(&plan.request_id).unwrap().checkpoint_revision,2);
    }

    #[test]
    fn local_planning_budget_and_action_plan_survive_receipt_recovery_without_model_replanning() {
        let (controller,phone,input,proof,id,lease,plan) = fixture(); report(&controller,&id,&lease);
        controller.record_background_outcome(RecordBackgroundOutcomeInput {execution_id:id.clone(),lease:Some(lease.clone()),branch_id:"calendar".into(),evidence:None,waiting_reason:Some("Phone work".into()),waiting_tool:None,waiting_inventory:None},|_,_|Ok(())).unwrap();
        controller.save_background_checkpoint(SaveBackgroundCheckpointInput {execution_id:id.clone(),lease:Some(lease.clone()),revision:1,context:json!({"systemPrompt":"Original task policy","messages":[{"role":"user","content":"Original","timestamp":1},{"role":"assistant","api":"openai-completions","content":[{"type":"text","text":"Report retained; phone waiting"}],"stopReason":"stop","timestamp":2}]})}).unwrap();
        controller.wait_background_task(WaitBackgroundTaskInput {execution_id:id,lease,duration_ms:1,output:"Report retained".into(),known_tools:vec![],budget_deferral_id:None}).unwrap();
        phone.stage_background_submission(&plan.source_host_id,input,json!({})).unwrap();
        let pending = phone.claim_background_submissions(Some(&plan.request_id)).unwrap().remove(0);
        let task = serde_json::to_value(controller.background_task(&plan.request_id).unwrap()).unwrap();
        phone.receive_background_result(&BackgroundResultWatch {source_host_id:plan.source_host_id.clone(),request_id:plan.request_id.clone()},task.clone()).unwrap();
        phone.complete_background_submission(&pending,&task).unwrap();
        let entry = phone.list_background_inbox(0,1,false).unwrap().items[0].id.clone();
        for _ in 0..3 { phone.reserve_mobile_branch_planning(&entry,"calendar").unwrap(); }
        assert!(phone.reserve_mobile_branch_planning(&entry,"calendar").is_err());
        assert_eq!(phone.inspect_mobile_branches(&entry).unwrap()["branches"][0]["canRetryPlanning"],false);
        assert!(phone.retry_mobile_branch_planning(&entry,"calendar",0).is_err()); // Third model may still be running.
        phone.note_mobile_branch_error(&entry,"calendar",Some("Actual planning failure"),Some((3,0))).unwrap();
        assert_eq!(phone.inspect_mobile_branches(&entry).unwrap()["branches"][0]["canRetryPlanning"],true);
        assert!(phone.retry_mobile_branch_planning(&entry,"calendar",1).is_err());
        phone.retry_mobile_branch_planning(&entry,"calendar",0).unwrap();
        assert!(phone.retry_mobile_branch_planning(&entry,"calendar",0).is_err());
        assert!(phone.note_mobile_branch_error(&entry,"calendar",Some("Late error"),Some((3,0))).is_err());
        for _ in 0..3 { assert_eq!(phone.reserve_mobile_branch_planning(&entry,"calendar").unwrap()["planning"]["recovery"],1); }
        // A process death retains failure recovery, not a fourth automatic attempt.
        { let conn = phone.lock_conn().unwrap(); AutomationStore::recover_mobile_branch_planning_on_startup(&conn).unwrap(); }
        assert_eq!(phone.inspect_mobile_branches(&entry).unwrap()["branches"][0]["canRetryPlanning"],true);
        phone.save_mobile_branch_plan(&entry,plan.clone()).unwrap();
        assert!(phone.retry_mobile_branch_planning(&entry,"calendar",1).is_err());
        phone.save_mobile_branch_labels(&entry,"calendar",json!([{"id":"actual-calendar","sourceId":"actual-account","title":"Actual observed list","source":"Actual observed account"}])).unwrap();
        assert_eq!(phone.inspect_mobile_branches(&entry).unwrap()["branches"][0]["labels"][0]["title"],"Actual observed list");
        let mut changed = plan.clone(); changed.actions[0].input.request["title"] = json!("Changed");
        assert!(phone.save_mobile_branch_plan(&entry,changed).is_err());
        assert!(phone.mobile_branch_receipt(&entry,"calendar").is_err());
        receipt(&phone,&plan);
        let retained = phone.mobile_branch_receipt(&entry,"calendar").unwrap();
        controller.register_device_branch_plan(plan,&proof).unwrap();
        controller.accept_device_branch_receipt(retained,&proof,|_,_|Ok(("pinned".into(),json!({})))).unwrap();
        phone.acknowledge_mobile_branch(&entry,"calendar").unwrap();
        assert!(phone.pending_mobile_branch_plans(0,20).unwrap()["items"].as_array().unwrap().is_empty());
    }

    #[test]
    fn a_callback_arriving_between_outcome_read_and_parking_is_consumed_once_without_stalling() {
        let (controller,phone,_,proof,id,lease,plan) = fixture(); report(&controller,&id,&lease);
        controller.record_background_outcome(RecordBackgroundOutcomeInput {execution_id:id.clone(),lease:Some(lease.clone()),branch_id:"calendar".into(),evidence:None,waiting_reason:Some("Phone offline at last read".into()),waiting_tool:None,waiting_inventory:None},|_,_|Ok(())).unwrap();
        controller.save_background_checkpoint(SaveBackgroundCheckpointInput {execution_id:id.clone(),lease:Some(lease.clone()),revision:1,context:json!({"systemPrompt":"Pinned policy","messages":[{"role":"user","content":"Original task","timestamp":1},{"role":"assistant","api":"openai-completions","content":[{"type":"text","text":"Report retained; phone waiting"}],"stopReason":"stop","timestamp":2}]})}).unwrap();
        controller.register_device_branch_plan(plan.clone(),&proof).unwrap();
        let actual = receipt(&phone,&plan);
        controller.accept_device_branch_receipt(actual.clone(),&proof,|_,_|panic!("Still leased")).unwrap();
        assert!(controller.read_background_outcomes(&id,Some(&lease)).unwrap().unwrap().verified);
        assert!(controller.wait_background_task(WaitBackgroundTaskInput {execution_id:id.clone(),lease:lease.clone(),duration_ms:1,output:"Earlier waiting conclusion".into(),known_tools:vec![],budget_deferral_id:None}).unwrap().is_none());
        assert_eq!(controller.background_task(&plan.request_id).unwrap().run.state,RunState::Pending);
        assert_eq!(controller.background_task(&plan.request_id).unwrap().checkpoint_revision,2);
        assert!(controller.read_background_outcomes(&id,Some(&lease)).is_err());
        controller.accept_device_branch_receipt(actual,&proof,|_,_|panic!("Callback ACK retry cannot wake again")).unwrap();
        assert_eq!(controller.background_task(&plan.request_id).unwrap().checkpoint_revision,2);
        assert_eq!(controller.lock_conn().unwrap().query_row("SELECT COUNT(*) FROM automation_background_device_wakes",[],|row|row.get::<_,i64>(0)).unwrap(),0);
    }
}
