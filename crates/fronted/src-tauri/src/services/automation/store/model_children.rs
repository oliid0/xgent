//! Same-host model work uses the real background queue and the parent's ledger.
use super::*;

impl AutomationStore {
    pub fn submit_background_model_child(&self, id: &str, call: &str, lease: &BackgroundExecutionLease,
        provider: &str, model: &str,
        mut load: impl FnMut(&Connection, &SubmitBackgroundTaskInput) -> Result<(String, Value), String>,
    ) -> Result<Value, String> {
        if !Uuid::parse_str(id).is_ok_and(|value|value.to_string()==id) || call.is_empty() || call.len()>256
            || provider.trim().is_empty() || model.trim().is_empty() || provider!=provider.trim() || model!=model.trim() {
            return Err("Invalid persistent model child identity".into());
        }
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let settings = Self::verify_background_configuration(&tx,id,Some(lease),|conn,input|load(conn,input))?;
        let parent_raw: String = tx.query_row("SELECT input_json FROM automation_background_tasks WHERE execution_id = ?1",params![id],|r|r.get(0)).map_err(|e|e.to_string())?;
        let parent: SubmitBackgroundTaskInput = serde_json::from_str(&parent_raw).map_err(|e|e.to_string())?;
        if !parent.intelligent_scheduling_enabled || settings["intelligentSchedulingEnabled"]!=true {
            return Err("Persistent model children require the accepted parent's enabled scheduling".into());
        }
        let intent_raw: String = tx.query_row(
            "SELECT o.arguments_json FROM automation_background_operations o JOIN automation_background_operation_leases l ON l.execution_id=o.execution_id AND l.call_id=o.call_id WHERE o.execution_id=?1 AND o.call_id=?2 AND l.attempt=?3 AND l.generation=?4 AND l.token=?5 AND o.tool_name='BackgroundTask' AND json_extract(o.arguments_json,'$.action')='submit' AND json_extract(o.arguments_json,'$.execution')='model'",
            params![id,call,lease.attempt,lease.generation,lease.token],|r|r.get(0),
        ).optional().map_err(|e|e.to_string())?.ok_or("Model child requires its original journal intent and lease")?;
        let intent: Value = serde_json::from_str(&intent_raw).map_err(|e|e.to_string())?;
        // The native journal supplies the work contract. The caller selects
        // only an exact, already permitted model; it cannot add task authority.
        if ["peer_id","request_id","goal_binding","files"].iter().any(|key|intent.get(*key).is_some())
            || intent["provider_id"].as_str().is_some_and(|value|!value.trim().is_empty() && value.trim()!=provider)
            || intent["model"].as_str().is_some_and(|value|!value.trim().is_empty() && value.trim()!=model) {
            return Err("Model child cannot replace original ownership, inputs or model pins".into());
        }
        let permitted = ["providers","delegationProviders"].iter().any(|key|settings[*key].as_array().into_iter().flatten().any(|candidate|
            candidate["id"].as_str()==Some(provider) && candidate["activeModels"].as_array().into_iter().flatten().any(|value|value.as_str()==Some(model))
                && candidate["models"].as_array().into_iter().flatten().any(|value|value["id"].as_str()==Some(model))));
        if !permitted { return Err("Selected child model is outside the original parent's configured model catalog".into()); }
        let allocation = &intent["delegation_budget"];
        let budget = BackgroundDelegationBudget { version:1,
            max_model_requests:allocation["max_model_requests"].as_u64().ok_or("Missing model request allocation")?,
            max_tool_calls:allocation["max_tool_calls"].as_u64().ok_or("Missing tool call allocation")?,deadline_at:Self::background_budget_deadline(&tx,id)? };
        if allocation.as_object().is_none_or(|value|value.len()!=2) { return Err("Invalid model child budget allocation".into()); }
        budget.validate()?;
        let host: String = tx.query_row("SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1'",[],|r|r.get(0)).map_err(|e|e.to_string())?;
        let mut context = Self::accepted_background_context(&tx,id,&parent,&host)?;
        let request = super::child_resumes::response_identity(id,call);
        let saved: Option<(String,String,String,Option<String>)> = tx.query_row(
            "SELECT peer_id,issuer_host_id,input_json,receipt_json FROM automation_background_children WHERE execution_id=?1 AND call_id=?2",
            params![id,call],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)),
        ).optional().map_err(|e|e.to_string())?;
        let source_context = match &saved {
            Some((_,_,original,_)) => serde_json::from_str::<SubmitBackgroundTaskInput>(original).map_err(|e|e.to_string())?.source_context,
            None => parent.source_context.as_ref().map(|source|source.delegated_snapshot(&request,intent["prompt"].as_str().ok_or("Missing child prompt")?,false)).transpose()?,
        };
        let input = Self::normalize_background_task_input(SubmitBackgroundTaskInput {
            request_id:request.clone(), name:intent["name"].as_str().ok_or("Missing child name")?.into(),
            prompt:intent["prompt"].as_str().ok_or("Missing child prompt")?.into(), provider_id:provider.into(),model:model.into(),
            workdir:parent.workdir.clone(),timeout_seconds:match intent.get("timeout_seconds") {
                Some(value)=>value.as_u64().ok_or("Invalid child timeout")?, None=>300 }, reasoning:parent.reasoning.clone(),
            files:parent.files.clone(), delegation:None, requirements:intent.get("requirements").map(|value|serde_json::from_value(value.clone())).transpose().map_err(|e|e.to_string())?,
            source_context,goal_binding:None,intelligent_scheduling_enabled:true,
        })?;
        let raw = serde_json::to_string(&input).map_err(|e|e.to_string())?;
        if let Some((peer,issuer,original,receipt)) = saved {
            if peer!=host || issuer!=host || original!=raw { return Err("Model child is already bound to different original input or ownership".into()); }
            return serde_json::from_str(&receipt.ok_or("Model child has no committed acceptance receipt")?).map_err(|e|e.to_string());
        }
        let depth: i64 = tx.query_row(
            "WITH RECURSIVE lineage(execution_id,depth) AS (SELECT ?1,1 UNION ALL SELECT c.execution_id,l.depth+1 FROM automation_background_children c JOIN lineage l ON c.observed_execution_id=l.execution_id WHERE c.peer_id=?2 AND c.issuer_host_id=?2 AND l.depth<8) SELECT MAX(depth) FROM lineage",
            params![id,host],|r|r.get(0),
        ).map_err(|e|e.to_string())?;
        if depth>=MAX_BACKGROUND_HOSTS as i64 { return Err("Persistent model child nesting limit exhausted".into()); }
        let (count,bytes):(i64,i64) = tx.query_row("SELECT COUNT(*),COALESCE(SUM(LENGTH(CAST(input_json AS BLOB))),0) FROM automation_background_children WHERE execution_id=?1",params![id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|e|e.to_string())?;
        if count>=super::children::MAX_CHILDREN || bytes+raw.len() as i64>super::children::MAX_INPUT_BYTES { return Err("Persistent child admission capacity exhausted".into()); }
        context.request_id=request.clone(); context.goal_binding=None;
        Self::allocate_background_child_budget(&tx,id,call,&host,&request,&budget)?;
        let now=db::now_ms();
        tx.execute("INSERT INTO automation_background_children (execution_id,call_id,child_request_id,peer_id,issuer_host_id,input_json,issued_at,retry_at) VALUES (?1,?2,?3,?4,?4,?5,?6,?6)",params![id,call,request,host,raw,now]).map_err(|e|e.to_string())?;
        Self::accept_background_on_connection(&tx,&input,context,None,Some(&budget),|conn,input|load(conn,input).map(|(binding,_)|binding))?;
        let record=Self::background_task_on_connection(&tx,&request,&host)?;
        let receipt=serde_json::to_value(record).map_err(|e|e.to_string())?;
        Self::record_background_child_observation_on_connection(&tx,id,call,None,&receipt,false)?;
        tx.commit().map_err(|e|e.to_string())?;
        drop(conn);
        self.with_notifier(|notifier|notifier.prompt_pending());
        Ok(receipt)
    }

    /// Self routing is available only for an originally accepted native child.
    pub fn is_local_background_model_child(&self, request: &str) -> Result<bool,String> {
        self.lock_conn()?.query_row(
            "SELECT EXISTS(SELECT 1 FROM automation_background_children c JOIN automation_background_tasks b ON b.request_id=c.child_request_id AND b.execution_id=c.observed_execution_id WHERE c.child_request_id=?1 AND c.peer_id=c.issuer_host_id AND c.issuer_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1'))",
            params![request],|r|r.get(0),
        ).map_err(|e|e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn settings(_: &Connection, _: &SubmitBackgroundTaskInput) -> Result<(String,Value),String> {
        Ok(("accepted-binding".into(),json!({"intelligentSchedulingEnabled":true,"providers":[{"id":"configured","activeModels":["main","specialist"],"models":[{"id":"main"},{"id":"specialist"}]}]})))
    }

    fn fixture() -> (AutomationStore,BackgroundTaskRecord,BackgroundExecutionLease) {
        fixture_with_source(None)
    }

    fn fixture_with_source(source_context: Option<BackgroundSourceContext>) -> (AutomationStore,BackgroundTaskRecord,BackgroundExecutionLease) {
        let store=AutomationStore::open_in_memory().unwrap();
        let root=store.submit_background_task_with_binding(SubmitBackgroundTaskInput {
            intelligent_scheduling_enabled:true,request_id:Uuid::new_v4().to_string(),name:"Compound".into(),prompt:"Report and slides".into(),
            provider_id:"configured".into(),model:"main".into(),workdir:std::env::temp_dir().to_string_lossy().into_owned(),
            timeout_seconds:300,reasoning:"medium".into(),files:vec![],delegation:None,requirements:None,source_context,goal_binding:None,
        },|_,_|Ok("accepted-binding".into())).unwrap();
        let lease=store.claim_prompt_runs().unwrap().remove(0).lease.unwrap();
        store.save_background_plan(SaveBackgroundPlanInput { execution_id:root.run.id.clone(),lease:Some(lease.clone()),
            plan:BackgroundTaskPlan {version:1,branches:vec![BackgroundBranch {id:"slides".into(),title:"Slides".into(),requirement:"Actual slides".into(),depends_on:vec![],criteria:vec![BackgroundCriterion::Answer]}]} },|_,_|Ok(())).unwrap();
        store.save_background_checkpoint(SaveBackgroundCheckpointInput {execution_id:root.run.id.clone(),lease:Some(lease.clone()),revision:1,
            context:json!({"systemPrompt":"Original coordinator","messages":[{"role":"user","content":"Report and slides"}]})}).unwrap();
        store.begin_background_operation(BeginBackgroundOperationInput {execution_id:root.run.id.clone(),call_id:"model-child".into(),lease:Some(lease.clone()),tool_name:"BackgroundTask".into(),
            arguments:json!({"action":"submit","execution":"model","name":"Slides","prompt":"Produce actual verified slides","model":"specialist","delegation_budget":{"max_model_requests":10,"max_tool_calls":20}})}).unwrap();
        (store,root,lease)
    }

    #[test]
    fn native_model_child_has_independent_queue_context_budget_and_original_receipt() {
        let (store,root,lease)=fixture();
        let receipt=store.submit_background_model_child(&root.run.id,"model-child",&lease,"configured","specialist",settings).unwrap();
        let request=receipt["requestId"].as_str().unwrap();
        assert_ne!(receipt["run"]["id"],root.run.id);
        assert_eq!(receipt["run"]["state"],"pending");
        assert_eq!(store.submit_background_model_child(&root.run.id,"model-child",&lease,"configured","specialist",settings).unwrap(),receipt);
        let child=store.claim_prompt_runs().unwrap().remove(0);
        assert_eq!(child.model,"specialist");assert_eq!(child.workdir,root.workdir);
        let context=child.background_context.unwrap();
        assert_eq!(context.request_id,request);assert_eq!(context.root_request_id,root.request_id);assert!(context.goal_binding.is_none());
        assert_eq!(context.host_ids,vec![store.background_worker_identity().unwrap()]);
        let budget=store.background_budget(&root.run.id,&lease,|_|Ok(()),None).unwrap().budget;
        assert_eq!(budget.model_requests.reserved,10);assert_eq!(budget.tool_calls.reserved,20);
        let limit=store.background_budget(&child.execution_id,&child.lease.unwrap(),|_|Ok(()),None).unwrap().budget;
        assert_eq!(limit.model_requests.limit,10);assert_eq!(limit.tool_calls.limit,20);
        assert!(store.is_local_background_model_child(request).unwrap());
    }

    #[test]
    fn invalid_model_lease_account_or_exhausted_budget_cannot_accept_child() {
        let (store,root,lease)=fixture();let mut stale=lease.clone();stale.generation+=1;
        assert!(store.submit_background_model_child(&root.run.id,"model-child",&stale,"configured","specialist",settings).is_err());
        assert!(store.submit_background_model_child(&root.run.id,"model-child",&lease,"foreign","specialist",settings).is_err());
        assert!(store.submit_background_model_child(&root.run.id,"model-child",&lease,"configured","main",settings).is_err());
        assert!(store.submit_background_model_child(&root.run.id,"model-child",&lease,"configured","specialist",|_,_|Ok(("changed".into(),json!({})))).is_err());
        store.lock_conn().unwrap().execute("UPDATE automation_background_budgets SET model_requests=128",[]).unwrap();
        assert!(store.submit_background_model_child(&root.run.id,"model-child",&lease,"configured","specialist",settings).is_err());
        assert_eq!(store.list_background_tasks(10).unwrap().len(),1);
        assert!(store.background_task(&root.request_id).unwrap().children.is_empty());
        assert_eq!(store.lock_conn().unwrap().query_row("SELECT COUNT(*) FROM automation_background_budget_grants",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    }

    #[test]
    fn model_child_retains_origin_clock_and_its_own_brief_without_coordinator_history() {
        let source: BackgroundSourceContext = serde_json::from_value(json!({"version":2,"requestScope":"original/turn",
            "systemPrompt":"Private coordinator policy","originalRequest":"Report, slides and tomorrow calendar",
            "messages":[{"role":"user","content":"Private coordinator conversation"}],
            "requestClock":{"timestampMs":1791959400000_i64,"timeZone":"America/Los_Angeles"}})).unwrap();
        let (store,root,lease)=fixture_with_source(Some(source));
        let receipt=store.submit_background_model_child(&root.run.id,"model-child",&lease,"configured","specialist",settings).unwrap();
        let child=store.claim_prompt_runs().unwrap().remove(0);
        let source=store.load_background_source_context(&child.execution_id,child.lease.as_ref()).unwrap().unwrap();
        assert_eq!(source.original_request.as_deref(),Some("Produce actual verified slides"));
        assert_eq!(source.request_scope,format!("delegated-task/{}",receipt["requestId"].as_str().unwrap()));
        assert_eq!(source.request_clock.unwrap().time_zone.as_deref(),Some("America/Los_Angeles"));
        assert!(source.system_prompt.is_empty());assert!(source.routing.is_none());
        assert_eq!(source.messages,vec![json!({"role":"user","content":"Produce actual verified slides"})]);
        assert_eq!(store.submit_background_model_child(&root.run.id,"model-child",&lease,"configured","specialist",settings).unwrap()["requestId"],receipt["requestId"]);
    }

    #[test]
    fn legacy_model_child_recovery_preserves_accepted_input_instead_of_injecting_a_later_clock() {
        let source: BackgroundSourceContext = serde_json::from_value(json!({"version":2,"requestScope":"original/turn",
            "systemPrompt":"Private","originalRequest":"Report and slides","messages":[{"role":"user","content":"Private"}],
            "requestClock":{"timestampMs":1791959400000_i64,"timeZone":"America/Los_Angeles"}})).unwrap();
        let (store,root,lease)=fixture_with_source(Some(source));
        let receipt=store.submit_background_model_child(&root.run.id,"model-child",&lease,"configured","specialist",settings).unwrap();
        {
            let conn=store.lock_conn().unwrap();
            let raw:String=conn.query_row("SELECT input_json FROM automation_background_children WHERE execution_id=?1 AND call_id='model-child'",params![root.run.id],|row|row.get(0)).unwrap();
            let mut legacy:SubmitBackgroundTaskInput=serde_json::from_str(&raw).unwrap();legacy.source_context=None;
            let raw=serde_json::to_string(&legacy).unwrap();
            conn.execute("UPDATE automation_background_children SET input_json=?2 WHERE execution_id=?1 AND call_id='model-child'",params![root.run.id,raw]).unwrap();
            conn.execute("UPDATE automation_background_tasks SET input_json=?2 WHERE request_id=?1",params![receipt["requestId"].as_str().unwrap(),raw]).unwrap();
        }
        assert_eq!(store.submit_background_model_child(&root.run.id,"model-child",&lease,"configured","specialist",settings).unwrap(),receipt);
        let child=store.claim_prompt_runs().unwrap().remove(0);
        assert!(store.load_background_source_context(&child.execution_id,child.lease.as_ref()).unwrap().is_none());
    }
}
