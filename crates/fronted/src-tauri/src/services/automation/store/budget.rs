use super::*;

#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BackgroundBudgetKind { ModelRequests, ToolCalls }

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundBudgetCounter { pub used: u64, pub limit: u64, #[serde(skip_serializing_if = "is_zero")] pub reserved: u64 }

fn is_zero(value: &u64) -> bool { *value == 0 }

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundBudgetSnapshot {
    pub version: u32,
    pub execution_id: String,
    pub scope: &'static str,
    pub model_requests: BackgroundBudgetCounter,
    pub tool_calls: BackgroundBudgetCounter,
    pub durable: bool,
    pub includes_compaction: bool,
    pub includes_device_delegates: bool,
    #[serde(skip_serializing_if="is_zero")]
    pub settled_delegations: u64,
    pub exhausted: bool,
    #[serde(skip_serializing_if="Option::is_none")]
    pub deadline_at: Option<i64>,
}

#[cfg(test)]
mod deferral_tests {
    use super::*;
    use serde_json::json;

    fn parent()->(AutomationStore,BackgroundTaskRecord,BackgroundExecutionLease){
        let store=AutomationStore::open_in_memory().unwrap();
        let task=store.submit_background_task(SubmitBackgroundTaskInput {request_id:Uuid::new_v4().to_string(),name:"Parent summaries".into(),prompt:"Write the requested summaries".into(),
            provider_id:"fixture".into(),model:"fixture".into(),workdir:std::env::temp_dir().to_string_lossy().into_owned(),timeout_seconds:300,reasoning:"medium".into(),
            files:vec![],delegation:None,requirements:None,source_context:None,goal_binding:None,intelligent_scheduling_enabled:true}).unwrap();
        let lease=store.claim_prompt_runs().unwrap().remove(0).lease.unwrap();
        store.save_background_checkpoint(SaveBackgroundCheckpointInput {execution_id:task.run.id.clone(),lease:Some(lease.clone()),revision:1,
            context:json!({"systemPrompt":"Fixture","messages":[{"role":"user","content":"Write the requested summaries"}]})}).unwrap();
        store.save_background_plan(SaveBackgroundPlanInput {execution_id:task.run.id.clone(),lease:Some(lease.clone()),plan:BackgroundTaskPlan {version:1,branches:vec![BackgroundBranch {
            id:"summaries".into(),title:"Summaries".into(),requirement:"Write the requested summaries".into(),depends_on:vec![],criteria:vec![BackgroundCriterion::Answer]}]}},|_,_|Ok(())).unwrap();
        {
            let conn=store.lock_conn().unwrap();
            conn.execute("UPDATE automation_background_budgets SET max_model_requests=2,max_tool_calls=2 WHERE execution_id=?1",params![task.run.id]).unwrap();
            let deadline=AutomationStore::background_budget_deadline(&conn,&task.run.id).unwrap();
            let peer=Uuid::new_v4().to_string();let request=Uuid::new_v4().to_string();
            AutomationStore::allocate_background_child_budget(&conn,&task.run.id,"child",&peer,&request,&BackgroundDelegationBudget {version:1,max_model_requests:2,max_tool_calls:2,deadline_at:deadline}).unwrap();
            conn.execute("INSERT INTO automation_background_children(execution_id,call_id,child_request_id,peer_id,issuer_host_id,input_json,issued_at) VALUES(?1,'child',?2,?3,?4,'{}',1)",
                params![task.run.id,request,peer,task.host_id]).unwrap();
        }
        (store,task,lease)
    }
    #[test]
    fn actual_native_refusal_can_park_without_a_fabricated_stopped_sdk_message_and_settlement_returns_the_original_slots(){
        let (store,task,lease)=parent();
        let refusal=store.background_budget(&task.run.id,&lease,|_|Ok(()),Some(BackgroundBudgetKind::ModelRequests)).unwrap();
        assert!(!refusal.admitted);assert!(!refusal.budget.exhausted);assert_eq!(refusal.budget.model_requests.used,0);
        let cause=refusal.deferred.unwrap();
        let mut input=WaitBackgroundTaskInput {execution_id:task.run.id.clone(),lease:lease.clone(),duration_ms:1,
            output:"Awaiting actual child usage settlement".into(),known_tools:vec![],budget_deferral_id:Some(Uuid::new_v4().to_string())};
        assert!(store.wait_background_task(input.clone()).is_err());
        input.budget_deferral_id=Some(cause.id);
        assert!(store.wait_background_task(input).unwrap().is_some());
        assert_eq!(store.background_task(&task.request_id).unwrap().run.state,RunState::Waiting);
        let conn=store.lock_conn().unwrap();
        let child=Uuid::new_v4().to_string();
        conn.execute("UPDATE automation_background_children SET terminal_confirmed=1,observed_execution_id=?2 WHERE execution_id=?1",params![task.run.id,child]).unwrap();
        let mut report=json!({"executionBudget":{"version":1,"executionId":child,"scope":"current_host_execution","durable":true,"includesCompaction":true,"includesDeviceDelegates":false,"exhausted":false,
            "modelRequests":{"used":0,"limit":2},"toolCalls":{"used":0,"limit":2}}});
        if let Some(time)=AutomationStore::background_budget_deadline(&conn,&task.run.id).unwrap(){report["executionBudget"]["deadlineAt"]=json!(time);}
        AutomationStore::settle_background_child_budget(&conn,&task.run.id,"child",&child,&report).unwrap();
        let current=read_budget(&conn,&task.run.id).unwrap();assert!(!current.exhausted);assert_eq!(current.model_requests.reserved,0);assert_eq!(current.model_requests.limit,2);
    }
    #[test]
    fn real_consumed_or_unknown_terminal_allocations_cannot_claim_a_temporary_budget_deferral(){
        let (store,task,lease)=parent();
        store.lock_conn().unwrap().execute("UPDATE automation_background_children SET terminal_confirmed=1 WHERE execution_id=?1",params![task.run.id]).unwrap();
        let refusal=store.background_budget(&task.run.id,&lease,|_|Ok(()),Some(BackgroundBudgetKind::ModelRequests)).unwrap();
        assert!(!refusal.admitted);assert!(refusal.budget.exhausted);assert!(refusal.deferred.is_none());
    }
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundBudgetAdmission {
    pub admitted: bool,
    pub budget: BackgroundBudgetSnapshot,
    #[serde(skip_serializing_if="Option::is_none")]
    pub deferred:Option<BackgroundBudgetDeferral>,
}

#[derive(Debug,Clone,serde::Serialize)]
#[serde(rename_all="camelCase")]
pub struct BackgroundBudgetDeferral {pub id:String,pub kind:&'static str}

fn kind_name(kind:BackgroundBudgetKind)->&'static str{match kind{BackgroundBudgetKind::ModelRequests=>"modelRequests",BackgroundBudgetKind::ToolCalls=>"toolCalls"}}

fn reserved_by_live_children(conn:&Connection,id:&str,kind:BackgroundBudgetKind)->Result<bool,String>{
    conn.query_row("SELECT b.exhausted=0 AND
        CASE ?2 WHEN 'modelRequests' THEN b.model_requests ELSE b.tool_calls END
        +COALESCE((SELECT SUM(CASE ?2 WHEN 'modelRequests' THEN model_requests ELSE tool_calls END) FROM automation_background_budget_committed_grants WHERE execution_id=?1),0)
        >=CASE ?2 WHEN 'modelRequests' THEN b.max_model_requests ELSE b.max_tool_calls END
        AND CASE ?2 WHEN 'modelRequests' THEN b.model_requests ELSE b.tool_calls END
        +COALESCE((SELECT SUM(CASE ?2 WHEN 'modelRequests' THEN model_requests ELSE tool_calls END) FROM automation_background_budget_committed_grants WHERE execution_id=?1),0)
        -COALESCE((SELECT SUM(CASE ?2 WHEN 'modelRequests' THEN g.max_model_requests ELSE g.max_tool_calls END)
          FROM automation_background_budget_grants g JOIN automation_background_children c ON c.execution_id=g.execution_id AND c.call_id=g.call_id AND c.child_request_id=g.child_request_id AND c.peer_id=g.peer_id
          WHERE g.execution_id=?1 AND c.issuer_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1')
          AND c.terminal_confirmed=0 AND NOT EXISTS(SELECT 1 FROM automation_background_budget_settlements s WHERE s.execution_id=g.execution_id AND s.call_id=g.call_id)) ,0)
        <CASE ?2 WHEN 'modelRequests' THEN b.max_model_requests ELSE b.max_tool_calls END
        FROM automation_background_budgets b WHERE b.execution_id=?1",params![id,kind_name(kind)],|row|row.get(0)).map_err(|e|e.to_string())
}

pub(super) fn require_budget_deferral(conn:&Connection,id:&str,deferral:&str)->Result<(),String>{
    if !Uuid::parse_str(deferral).is_ok_and(|uuid|uuid.to_string()==deferral){return Err("Invalid original budget deferral".into());}
    let owned:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM automation_background_budget_deferrals d JOIN automation_background_budgets b ON b.execution_id=d.execution_id
        WHERE d.execution_id=?1 AND d.deferral_id=?2 AND b.exhausted=0
        AND d.issuer_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1')
        AND NOT EXISTS(SELECT 1 FROM automation_background_budget_deadlines time WHERE time.execution_id=d.execution_id AND time.deadline_at<=?3))",
        params![id,deferral,db::now_ms()],|row|row.get(0)).map_err(|e|e.to_string())?;
    if !owned{return Err("Original confirmed budget deferral changed or expired".into());}
    Ok(())
}

pub(super) fn read_budget(conn: &Connection, execution_id: &str) -> Result<BackgroundBudgetSnapshot, String> {
    let deadline_at=AutomationStore::background_budget_deadline(conn,execution_id)?;
    conn.query_row(
        "SELECT model_requests, max_model_requests, tool_calls, max_tool_calls, exhausted
             , COALESCE((SELECT SUM(model_requests) FROM automation_background_budget_committed_grants WHERE execution_id = ?1), 0)
             , COALESCE((SELECT SUM(tool_calls) FROM automation_background_budget_committed_grants WHERE execution_id = ?1), 0)
             , EXISTS(SELECT 1 FROM automation_background_budget_grants WHERE execution_id=?1)
             , (SELECT COUNT(*) FROM automation_background_budget_settlements WHERE execution_id=?1)
         FROM automation_background_budgets WHERE execution_id = ?1",
        params![execution_id], |row| Ok(BackgroundBudgetSnapshot {
            version: 1, execution_id: execution_id.to_string(), scope: "current_host_execution",
            model_requests: BackgroundBudgetCounter { used: row.get(0)?, limit: row.get(1)?, reserved: row.get(5)? },
            tool_calls: BackgroundBudgetCounter { used: row.get(2)?, limit: row.get(3)?, reserved: row.get(6)? },
            durable: true, includes_compaction: true, includes_device_delegates: row.get(7)?,
            settled_delegations:row.get(8)?,
            exhausted: row.get(4)?,
            deadline_at,
        }),
    ).map_err(|e| e.to_string())
}

impl AutomationStore {
    pub(super) fn background_budget_deadline(conn:&Connection,id:&str) -> Result<Option<i64>,String> {
        conn.query_row("SELECT deadline_at FROM automation_background_budget_deadlines WHERE execution_id=?1",params![id],|row|row.get(0)).optional().map_err(|e|e.to_string())
    }
    fn retain_background_deadline(conn:&Connection,id:&str,deadline:i64) -> Result<(),String> {
        if deadline<=db::now_ms() {return Err("Shared execution deadline already reached; no new task accepted".into());}
        conn.execute("INSERT INTO automation_background_budget_deadlines (execution_id,deadline_at) VALUES (?1,?2)",params![id,deadline]).map_err(|e|e.to_string())?;
        Ok(())
    }
    fn expire_background_budget(conn:&Connection,id:&str) -> Result<(),String> {
        conn.execute("UPDATE automation_background_budgets AS budget SET exhausted=1 WHERE budget.execution_id=?1 AND EXISTS(SELECT 1 FROM automation_background_budget_deadlines d WHERE d.execution_id=budget.execution_id AND d.deadline_at<=?2)",params![id,db::now_ms()]).map_err(|e|e.to_string())?;
        Ok(())
    }
    pub(super) fn initialize_delegated_background_budget(conn: &Connection, execution_id: &str, budget: &BackgroundDelegationBudget) -> Result<(), String> {
        budget.validate()?;
        conn.execute("INSERT INTO automation_background_budgets (execution_id, max_model_requests, max_tool_calls) VALUES (?1, ?2, ?3)",
            params![execution_id, budget.max_model_requests, budget.max_tool_calls]).map_err(|e| e.to_string())?;
        if let Some(deadline)=budget.deadline_at {Self::retain_background_deadline(conn,execution_id,deadline)?;}
        Ok(())
    }

    pub(super) fn reserve_background_child_budget(conn: &Connection, id: &str, call: &str, peer: &str,
        input: &SubmitBackgroundTaskInput, intent: &Value) -> Result<(), String> {
        let raw: String = conn.query_row("SELECT input_json FROM automation_background_tasks WHERE execution_id = ?1",
            params![id], |row| row.get(0)).map_err(|e| e.to_string())?;
        let parent: SubmitBackgroundTaskInput = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let budget = input.delegation.as_ref().and_then(|delegation| delegation.budget.as_ref());
        if !parent.intelligent_scheduling_enabled {
            if input.intelligent_scheduling_enabled || budget.is_some() || intent.get("delegation_budget").is_some() { return Err("Parent did not enable shared lifetime budgeting".into()); }
            return Ok(());
        }
        let budget = budget.ok_or("Scheduled device children require an explicit allocation from the parent's remaining budget")?;
        budget.validate()?;
        if !input.intelligent_scheduling_enabled || intent["delegation_budget"]["max_model_requests"].as_u64() != Some(budget.max_model_requests)
            || intent["delegation_budget"]["max_tool_calls"].as_u64() != Some(budget.max_tool_calls) {
            return Err("Child budget differs from its original journal intent".into());
        }
        Self::allocate_background_child_budget(conn, id, call, peer, &input.request_id, budget)
    }

    pub(super) fn allocate_background_child_budget(conn: &Connection, id: &str, call: &str, peer: &str,
        request_id: &str, budget: &BackgroundDelegationBudget) -> Result<(), String> {
        budget.validate()?;
        let deadline=Self::background_budget_deadline(conn,id)?;
        if deadline!=budget.deadline_at || deadline.is_some_and(|time|time<=db::now_ms()) {return Err("Child must inherit the original unexpired execution deadline; no child sent".into());}
        let changed = conn.execute(
            "INSERT INTO automation_background_budget_grants (execution_id,call_id,child_request_id,peer_id,max_model_requests,max_tool_calls)
             SELECT ?1,?2,?3,?4,?5,?6 FROM automation_background_budgets b
             WHERE b.execution_id = ?1 AND b.exhausted = 0
               AND b.model_requests + ?5 + COALESCE((SELECT SUM(model_requests) FROM automation_background_budget_committed_grants WHERE execution_id = ?1),0) <= b.max_model_requests
               AND b.tool_calls + ?6 + COALESCE((SELECT SUM(tool_calls) FROM automation_background_budget_committed_grants WHERE execution_id = ?1),0) <= b.max_tool_calls",
            params![id, call, request_id, peer, budget.max_model_requests, budget.max_tool_calls],
        ).map_err(|e| e.to_string())?;
        if changed != 1 { return Err("Child budget cannot be reserved from this task's remaining lifetime slots; no child sent".into()); }
        Ok(())
    }

    pub(super) fn initialize_background_budget(conn: &Connection, execution_id: &str) -> Result<(), String> {
        let (requests,tools,minutes)=crate::commands::settings::background_scheduling_budget(conn)?;
        // Existing supported scheduling/cloud request and tool ceilings.
        // Called only inside the new task's acceptance transaction.
        if requests==128 && tools==256 {conn.execute(
            "INSERT INTO automation_background_budgets
             (execution_id, max_model_requests, max_tool_calls) VALUES (?1, 128, 256)",
            params![execution_id],
        ).map_err(|e| e.to_string())?;} else {
            conn.execute("INSERT INTO automation_background_budgets (execution_id,max_model_requests,max_tool_calls) VALUES (?1,?2,?3)",params![execution_id,requests,tools]).map_err(|e|e.to_string())?;
        }
        if minutes>0 {
            let created:i64=conn.query_row("SELECT created_at FROM automation_background_tasks WHERE execution_id=?1",params![execution_id],|row|row.get(0)).map_err(|e|e.to_string())?;
            let deadline=created.checked_add((minutes*60_000) as i64).ok_or("Invalid execution deadline")?;
            Self::retain_background_deadline(conn,execution_id,deadline)?;
        }
        Ok(())
    }

    /// Read/admit against the accepted lifetime ledger, never initialize or
    /// reset it on a new lease. Pre-ledger scheduled tasks require review.
    pub fn background_budget(
        &self, execution_id: &str, lease: &BackgroundExecutionLease,
        verify: impl FnOnce(&Connection) -> Result<(), String>,
        kind: Option<BackgroundBudgetKind>,
    ) -> Result<BackgroundBudgetAdmission, String> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        Self::require_background_execution(&tx, execution_id, Some(lease))?;
        verify(&tx)?;
        let raw: String = tx.query_row(
            "SELECT input_json FROM automation_background_tasks WHERE execution_id = ?1",
            params![execution_id], |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        let input: SubmitBackgroundTaskInput = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        if !input.intelligent_scheduling_enabled {
            return Err("Accepted task did not enable intelligent scheduling".to_string());
        }
        Self::expire_background_budget(&tx,execution_id)?;
        read_budget(&tx, execution_id).map_err(|_| "Accepted task has no lifetime budget ledger; inspect completed work and submit a new task explicitly".to_string())?;
        let mut deferred=None;
        let admitted = match kind {
            None => false,
            Some(kind) => {
                let changed = match kind {
                    BackgroundBudgetKind::ModelRequests => tx.execute(
                        "UPDATE automation_background_budgets SET model_requests = model_requests + 1
                         WHERE execution_id = ?1 AND exhausted = 0 AND model_requests + COALESCE((SELECT SUM(model_requests) FROM automation_background_budget_committed_grants WHERE execution_id = ?1),0) < max_model_requests",
                        params![execution_id],
                    ),
                    BackgroundBudgetKind::ToolCalls => tx.execute(
                        "UPDATE automation_background_budgets SET tool_calls = tool_calls + 1
                         WHERE execution_id = ?1 AND exhausted = 0 AND tool_calls + COALESCE((SELECT SUM(tool_calls) FROM automation_background_budget_committed_grants WHERE execution_id = ?1),0) < max_tool_calls",
                        params![execution_id],
                    ),
                }.map_err(|e| e.to_string())?;
                if changed == 0 {
                    if reserved_by_live_children(&tx,execution_id,kind)? {
                        let id=Uuid::new_v4().to_string();
                        tx.execute("INSERT INTO automation_background_budget_deferrals(execution_id,deferral_id,kind,issuer_host_id) VALUES(?1,?2,?3,(SELECT value FROM automation_meta WHERE key='background_worker_id.v1'))
                            ON CONFLICT(execution_id) DO UPDATE SET deferral_id=excluded.deferral_id,kind=excluded.kind",
                            params![execution_id,id,kind_name(kind)]).map_err(|e|e.to_string())?;
                        deferred=Some(BackgroundBudgetDeferral{id,kind:kind_name(kind)});
                    }else{
                        tx.execute("UPDATE automation_background_budgets SET exhausted = 1 WHERE execution_id = ?1",
                            params![execution_id]).map_err(|e| e.to_string())?;
                    }
                }else{
                    tx.execute("DELETE FROM automation_background_budget_deferrals WHERE execution_id=?1",params![execution_id]).map_err(|e|e.to_string())?;
                }
                changed == 1
            }
        };
        let budget = read_budget(&tx, execution_id)?;
        // Even a refusal persists before replying. A lost admission ACK is
        // spent, never refunded or automatically replayed as a new effect.
        tx.commit().map_err(|e| e.to_string())?;
        Ok(BackgroundBudgetAdmission { admitted, budget,deferred })
    }
}
