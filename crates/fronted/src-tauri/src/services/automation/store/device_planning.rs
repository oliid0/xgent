//! Controller model requests data/proposes actions; only the original phone
//! performs scoped SDK reads, freezes plans and supplies native effect receipts.
use super::*;
use sha2::{Digest,Sha256};

fn ordered_json(value:&Value)->Value {
    match value {
        Value::Object(object)=>{
            let mut keys:Vec<_>=object.keys().collect();keys.sort();
            Value::Object(keys.into_iter().map(|key|(key.clone(),ordered_json(&object[key]))).collect())
        },
        Value::Array(items)=>Value::Array(items.iter().map(ordered_json).collect()),
        _=>value.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture()->(AutomationStore,String,String,BackgroundDeviceChannelProof,BackgroundExecutionLease){
        fixture_with_observation(None)
    }
    fn fixture_with_observation(observation:Option<BackgroundHealthObservation>)->(AutomationStore,String,String,BackgroundDeviceChannelProof,BackgroundExecutionLease){
        let store=AutomationStore::open_in_memory().unwrap();
        let request=Uuid::new_v4().to_string();let origin=Uuid::new_v4().to_string();
        let proof=BackgroundDeviceChannelProof {version:1,initiating_host_id:origin.clone(),token:"a".repeat(64)};
        let input=SubmitBackgroundTaskInput {intelligent_scheduling_enabled:false,request_id:request.clone(),name:"Calendar".into(),prompt:"Calendar".into(),provider_id:"configured".into(),model:"configured".into(),workdir:std::env::temp_dir().to_string_lossy().into_owned(),timeout_seconds:300,reasoning:"medium".into(),files:vec![],delegation:None,requirements:None,goal_binding:None,
            source_context:Some(BackgroundSourceContext {version:1,original_request:None,request_clock:None,request_scope:"phone-turn".into(),system_prompt:String::new(),messages:vec![json!({"role":"user","content":"Calendar"})],routing:Some(BackgroundSourceRouting {version:if observation.is_some(){2}else{1},initiating_host_id:origin,branches:vec![BackgroundSourceBranch {observation,id:"calendar".into(),requirement:"Calendar".into(),depends_on:vec![],locality:"initiating-device".into()}]})})};
        let task=store.submit_background_task_with_device_channel(input,Some(&proof),|_,_|Ok("pinned".into())).unwrap();
        let lease=store.claim_prompt_runs().unwrap().remove(0).lease.unwrap();let id=task.run.id;
        store.save_background_plan(SaveBackgroundPlanInput {execution_id:id.clone(),lease:Some(lease.clone()),plan:BackgroundTaskPlan {version:1,branches:vec![BackgroundBranch {id:"calendar".into(),title:"Calendar".into(),requirement:"Calendar".into(),depends_on:vec![],criteria:vec![BackgroundCriterion::Unavailable {capability:"Original phone calendar".into()}]}]}},|_,_|Ok(())).unwrap();
        store.save_background_checkpoint(SaveBackgroundCheckpointInput {execution_id:id.clone(),lease:Some(lease.clone()),revision:1,context:json!({"systemPrompt":"Original policy","messages":[{"role":"user","content":"Calendar","timestamp":1}]})}).unwrap();
        (store,request,id,proof,lease)
    }
    fn access()->Value {json!({"contextHash":"b".repeat(64),"revision":1,"decision":"approved","allowedKinds":["event"],"selections":[]})}
    fn health_contract()->BackgroundHealthObservation {BackgroundHealthObservation {kind:"health_samples".into(),metric:"heart_rate".into(),start_ms:1000,end_ms:2000,limit:200}}
    fn health_access()->Value {json!({"contextHash":"b".repeat(64),"revision":1,"decision":"approved","allowedKinds":["health"],"selections":[{"kind":"health","id":"heart_rate","sourceId":"healthkit","writable":false,"startMs":1000,"endMs":2000}]})}
    fn begin(store:&AutomationStore,id:&str,lease:&BackgroundExecutionLease,call:&str,args:Value){
        store.begin_background_operation(BeginBackgroundOperationInput {execution_id:id.into(),lease:Some(lease.clone()),call_id:call.into(),tool_name:"OriginalDeviceTask".into(),arguments:args}).unwrap();
    }
    #[test]
    fn accepted_native_queue_and_tool_receipt_are_one_commit_and_never_verify_phone_effects(){
        let (store,request,id,proof,lease)=fixture();
        let ready=store.exchange_device_planning(&request,"calendar",&proof,access(),None,|_,_|Ok(("pinned".into(),json!({})))).unwrap();
        begin(&store,&id,&lease,"read-call",json!({"action":"request_read","branch_id":"calendar","scope_key":ready["scopeKey"],"read_action":"list_calendars","request":{"kind":"event"}}));
        let receipt=store.plan_original_device(&id,"read-call",&lease,|_,_|Ok(("pinned".into(),json!({})))).unwrap();
        assert_eq!(receipt["isError"],false);
        assert_eq!(receipt,store.plan_original_device(&id,"read-call",&lease,|_,_|Ok(("pinned".into(),json!({})))).unwrap());
        assert!(!store.read_background_outcomes(&id,Some(&lease)).unwrap().unwrap().verified);
        let conn=store.lock_conn().unwrap();assert!(!AutomationStore::has_uncertain_operations(&conn,&id).unwrap());
        let count:i64=conn.query_row("SELECT COUNT(*) FROM automation_background_device_planning_calls",[],|row|row.get(0)).unwrap();assert_eq!(count,1);
    }
    #[test]
    fn stale_or_unapproved_scope_is_a_retained_no_effect_error_and_cannot_admit_sdk_work(){
        let (store,request,id,proof,lease)=fixture();
        store.exchange_device_planning(&request,"calendar",&proof,access(),None,|_,_|Ok(("pinned".into(),json!({})))).unwrap();
        begin(&store,&id,&lease,"rejected",json!({"action":"request_read","branch_id":"calendar","scope_key":"old-scope","read_action":"list_calendars","request":{"kind":"event"}}));
        let receipt=store.plan_original_device(&id,"rejected",&lease,|_,_|Ok(("pinned".into(),json!({})))).unwrap();
        assert_eq!(receipt["isError"],true);assert_eq!(receipt["details"]["knownNoEffect"],true);
        assert_eq!(receipt,store.plan_original_device(&id,"rejected",&lease,|_,_|Ok(("pinned".into(),json!({})))).unwrap());
        let conn=store.lock_conn().unwrap();let count:i64=conn.query_row("SELECT COUNT(*) FROM automation_background_device_planning_calls",[],|row|row.get(0)).unwrap();assert_eq!(count,0);
    }
    #[test]
    fn scope_digest_preserves_array_order_and_normalizes_nested_object_serialization(){
        let mut first=access();first["allowedKinds"]=json!(["event","reminder"]);first["selections"]=json!([{"kind":"event","sourceId":"observed-source","id":"calendar"}]);
        let second:Value=serde_json::from_str(&serde_json::to_string(&first).unwrap()).unwrap();
        assert_eq!(AutomationStore::device_planning_scope_key(&first).unwrap(),AutomationStore::device_planning_scope_key(&second).unwrap());
        let mut reordered=first.clone();reordered["allowedKinds"]=json!(["reminder","event"]);
        assert_ne!(AutomationStore::device_planning_scope_key(&first).unwrap(),AutomationStore::device_planning_scope_key(&reordered).unwrap());
        let mut changed=first;changed["revision"]=json!(2);assert_ne!(AutomationStore::device_planning_scope_key(&changed).unwrap(),AutomationStore::device_planning_scope_key(&second).unwrap());
    }

    #[test]
    fn native_scope_arriving_before_parking_wakes_original_context_once_without_effect_completion(){
        let (store,request,id,proof,lease)=fixture();
        store.record_background_outcome(RecordBackgroundOutcomeInput {execution_id:id.clone(),lease:Some(lease.clone()),branch_id:"calendar".into(),evidence:None,waiting_reason:Some("Await original phone observations".into()),waiting_tool:None,waiting_inventory:None},|_,_|Ok(())).unwrap();
        store.exchange_device_planning(&request,"calendar",&proof,access(),None,|_,_|Ok(("pinned".into(),json!({})))).unwrap();
        store.save_background_checkpoint(SaveBackgroundCheckpointInput {execution_id:id.clone(),lease:Some(lease.clone()),revision:2,context:json!({"systemPrompt":"Original policy","messages":[{"role":"assistant","api":"openai-completions","stopReason":"stop","content":[{"type":"text","text":"Phone observations pending"}],"timestamp":2}]})}).unwrap();
        assert!(store.wait_background_task(WaitBackgroundTaskInput {execution_id:id.clone(),lease,duration_ms:1,output:"Actual waiting conclusion".into(),known_tools:vec![],budget_deferral_id:None}).unwrap().is_none());
        let task=store.background_task(&request).unwrap();assert_eq!(task.run.state,RunState::Pending);assert!(!task.outcomes.unwrap().verified);
        let conn=store.lock_conn().unwrap();assert!(!AutomationStore::device_planning_wake(&conn,&id).unwrap());
    }

    #[test]
    fn original_health_read_joins_only_exact_sdk_data_and_remains_readable_without_a_write_receipt(){
        let (store,request,id,proof,lease)=fixture_with_observation(Some(health_contract()));
        let packet=store.exchange_device_planning(&request,"calendar",&proof,health_access(),None,|_,_|Ok(("pinned".into(),json!({})))).unwrap();
        begin(&store,&id,&lease,"health-read",json!({"action":"request_read","branch_id":"calendar","scope_key":packet["scopeKey"],"read_action":"read_health_samples","request":health_contract().request()}));
        assert_eq!(store.plan_original_device(&id,"health-read",&lease,|_,_|Ok(("pinned".into(),json!({})))).unwrap()["isError"],false);
        assert!(!store.read_background_outcomes(&id,Some(&lease)).unwrap().unwrap().verified);
        let result=json!({"data":{"health":{"metric":"heart_rate","unit":"bpm","startMs":1000,"endMs":2000,"samples":[],"source":"healthkit","truncated":false,"accessLimited":true}}});
        store.exchange_device_planning(&request,"calendar",&proof,health_access(),Some(json!({"callId":"health-read","scopeKey":packet["scopeKey"],"result":result})),|_,_|Ok(("pinned".into(),json!({})))).unwrap();
        let report=store.read_background_outcomes(&id,Some(&lease)).unwrap().unwrap();assert!(report.verified);
        let evidence:Value=serde_json::from_str(report.branches[0].evidence.as_ref().unwrap().answer.as_ref().unwrap()).unwrap();
        assert_eq!(evidence["kind"],"original_device_health_observation");assert_eq!(evidence["sampleCount"],0);assert_eq!(evidence["accessLimited"],true);
        begin(&store,&id,&lease,"read-result",json!({"action":"read_result","branch_id":"calendar","result_call_id":"health-read"}));
        assert_eq!(store.plan_original_device(&id,"read-result",&lease,|_,_|Ok(("pinned".into(),json!({})))).unwrap()["isError"],false);
        let changed=json!({"callId":"health-read","scopeKey":packet["scopeKey"],"result":{"data":{"health":{"source":"another-phone"}}}});
        assert!(store.exchange_device_planning(&request,"calendar",&proof,health_access(),Some(changed),|_,_|Ok(("pinned".into(),json!({})))).is_err());
        let conn=store.lock_conn().unwrap();assert_eq!(conn.query_row("SELECT COUNT(*) FROM automation_background_device_actions",[],|row|row.get::<_,i64>(0)).unwrap(),0);
    }

    #[test]
    fn original_read_contract_rejects_writes_and_shorter_or_substitute_sdk_queries(){
        for kind in ["propose","shorter","metric"] {
            let (store,request,id,proof,lease)=fixture_with_observation(Some(health_contract()));
            let packet=store.exchange_device_planning(&request,"calendar",&proof,health_access(),None,|_,_|Ok(("pinned".into(),json!({})))).unwrap();
            let mut args=json!({"action":"request_read","branch_id":"calendar","scope_key":packet["scopeKey"],"read_action":"read_health_samples","request":health_contract().request()});
            match kind {"propose"=>args["action"]=json!("propose"),"shorter"=>args["request"]["startMs"]=json!(1500),_=>args["request"]["metric"]=json!("weight")};
            begin(&store,&id,&lease,"rejected",args);
            let receipt=store.plan_original_device(&id,"rejected",&lease,|_,_|Ok(("pinned".into(),json!({})))).unwrap();
            assert_eq!(receipt["isError"],true);assert_eq!(receipt["details"]["knownNoEffect"],true);
            let conn=store.lock_conn().unwrap();assert_eq!(conn.query_row("SELECT COUNT(*) FROM automation_background_device_planning_calls",[],|row|row.get::<_,i64>(0)).unwrap(),0);
        }
    }
}

fn owner(conn:&Connection,request:&str,branch:&str)->Result<String,String>{
    let (execution,raw):(String,String)=conn.query_row("SELECT execution_id,input_json FROM automation_background_tasks WHERE request_id=?1",params![request],|row|Ok((row.get(0)?,row.get(1)?))).map_err(|e|e.to_string())?;
    let input:SubmitBackgroundTaskInput=serde_json::from_str(&raw).map_err(|e|e.to_string())?;
    if input.source_context.as_ref().and_then(|source|source.routing.as_ref()).is_none_or(|routing|
        !routing.branches.iter().any(|item|item.id==branch && item.locality=="initiating-device")) {return Err("Planning requires the original accepted device branch".into());}
    let report=AutomationStore::background_outcome_report(conn,&execution)?.ok_or("Original outcome plan is unavailable")?;
    let current=report.branches.iter().find(|item|item.branch.id==branch).ok_or("Original branch was not planned")?;
    let active:bool=conn.query_row("SELECT state IN ('pending','leased','waiting') FROM automation_cron_runs WHERE execution_id=?1",params![execution],|row|row.get(0)).map_err(|e|e.to_string())?;
    let observation=input.source_context.as_ref().and_then(|source|source.routing.as_ref()).is_some_and(|routing|routing.branches.iter().any(|source|source.id==branch && source.observation.is_some()));
    if !active || (current.state=="verified" && !observation) || current.branch.depends_on.iter().any(|id|!report.branches.iter().any(|item|item.branch.id==*id && item.state=="verified")) {return Err("Original controller has not released this unfinished branch".into());}
    Ok(execution)
}

impl AutomationStore {
    pub(crate) fn device_planning_scope_key(scope:&Value)->Result<String,String>{
        if !scope.is_object() || scope["contextHash"].as_str().is_none_or(|hash|hash.len()!=64 || !hash.bytes().all(|b|b.is_ascii_hexdigit()))
            || scope["revision"].as_u64().is_none_or(|revision|revision>u32::MAX as u64)
            || !matches!(scope["decision"].as_str(),Some("pending"|"approved"|"revoked"))
            || scope["allowedKinds"].as_array().is_none_or(|kinds|kinds.len()>3 || kinds.iter().any(|kind|!matches!(kind.as_str(),Some("event"|"reminder"|"health")))) {
            return Err("Invalid native planning read scope".into());
        }
        let bytes=serde_json::to_vec(&ordered_json(scope)).map_err(|e|e.to_string())?;
        if bytes.len()>64*1024 {return Err("Native planning scopes exceed their bound".into());}
        Ok(hex::encode(Sha256::digest(bytes)))
    }

    pub(crate) fn device_planning_wake(conn:&Connection,id:&str)->Result<bool,String>{
        conn.query_row("SELECT EXISTS(SELECT 1 FROM automation_background_device_planning_wakes WHERE execution_id=?1)",params![id],|row|row.get(0)).map_err(|e|e.to_string())
    }

    pub(crate) fn exchange_device_planning(&self,request:&str,branch:&str,proof:&BackgroundDeviceChannelProof,scope:Value,response:Option<Value>,
        load:impl FnOnce(&Connection,&SubmitBackgroundTaskInput)->Result<(String,Value),String>)->Result<Value,String>{
        self.authorize_background_device_channel(request,proof)?;
        let key=Self::device_planning_scope_key(&scope)?;
        let raw=serde_json::to_string(&scope).map_err(|e|e.to_string())?;
        let mut conn=self.lock_conn()?;
        let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let id=owner(&tx,request,branch)?;
        Self::verify_background_binding(&tx,&id,load)?;
        let previous:Option<String>=tx.query_row("SELECT scope_key FROM automation_background_device_planning_scopes WHERE execution_id=?1 AND branch_id=?2",params![id,branch],|row|row.get(0)).optional().map_err(|e|e.to_string())?;
        let mut changed=previous.as_deref()!=Some(&key);
        tx.execute("INSERT INTO automation_background_device_planning_scopes(execution_id,branch_id,scope_key,scope_json) VALUES(?1,?2,?3,?4) ON CONFLICT(execution_id,branch_id) DO UPDATE SET scope_key=excluded.scope_key,scope_json=excluded.scope_json",params![id,branch,key,raw]).map_err(|e|e.to_string())?;
        if let Some(response)=response {
            if response.as_object().is_none_or(|object|object.len()!=3) || response["scopeKey"]!=key {return Err("Planning response changed its original scope".into());}
            let call=response["callId"].as_str().filter(|value|!value.is_empty() && value.len()<=256).ok_or("Missing original planning call")?;
            let result=serde_json::to_string(&response["result"]).map_err(|e|e.to_string())?;
            if !response["result"].is_object() || result.len()>1024*1024 {return Err("Native planning response exceeds its bound".into());}
            let saved:(String,Option<String>)=tx.query_row("SELECT scope_key,result_json FROM automation_background_device_planning_calls WHERE execution_id=?1 AND branch_id=?2 AND call_id=?3",params![id,branch,call],|row|Ok((row.get(0)?,row.get(1)?))).map_err(|_|"Unknown original planning call")?;
            if saved.0!=key || saved.1.as_ref().is_some_and(|old|old!=&result) {return Err("Original planning response is immutable".into());}
            if saved.1.is_none(){
                let bytes:i64=tx.query_row("SELECT COALESCE(SUM(LENGTH(CAST(result_json AS BLOB))),0) FROM automation_background_device_planning_calls WHERE execution_id=?1",params![id],|row|row.get(0)).map_err(|e|e.to_string())?;
                if bytes+result.len() as i64>64*1024*1024 {return Err("Original planning result capacity exhausted".into());}
                tx.execute("UPDATE automation_background_device_planning_calls SET result_json=?3 WHERE execution_id=?1 AND call_id=?2 AND result_json IS NULL",params![id,call,result]).map_err(|e|e.to_string())?;changed=true;
            }
        }
        if changed {tx.execute("INSERT OR IGNORE INTO automation_background_device_planning_wakes(execution_id) VALUES(?1)",params![id]).map_err(|e|e.to_string())?;}
        if Self::device_planning_wake(&tx,&id)? {
            if let Some(wait)=Self::background_wait_record(&tx,&id)? {
                Self::resume_wait_on_connection(&tx,&id,&ResumeBackgroundTaskInput {request_id:request.into(),wait_id:wait.wait_id,resume_id:Uuid::new_v4().to_string(),response:"Original phone published a new authorized read scope or native planning response. Continue the SAME task; inspect OriginalDeviceTask for current data and pending calls. These observations/proposals are not effect receipts or new permissions. Preserve completed work and await real device outcomes.".into()})?;
                tx.execute("DELETE FROM automation_background_device_planning_wakes WHERE execution_id=?1",params![id]).map_err(|e|e.to_string())?;
            }
        }
        let calls={
            let mut stmt=tx.prepare("SELECT call_id,kind,request_json FROM automation_background_device_planning_calls WHERE execution_id=?1 AND branch_id=?2 AND scope_key=?3 AND result_json IS NULL ORDER BY created_at,call_id LIMIT 4").map_err(|e|e.to_string())?;
            let rows=stmt.query_map(params![id,branch,key],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?))).map_err(|e|e.to_string())?;
            rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?.into_iter().map(|(call,kind,raw)|Ok(serde_json::json!({"callId":call,"kind":kind,"request":serde_json::from_str::<Value>(&raw).map_err(|e|e.to_string())?}))).collect::<Result<Vec<Value>,String>>()?
        };
        tx.commit().map_err(|e|e.to_string())?;drop(conn);
        if changed {self.with_notifier(|notifier|notifier.prompt_pending());}
        Ok(serde_json::json!({"scopeKey":key,"calls":calls}))
    }

    /// Only data/drafts may be queued; no phone tool, account or effect authority.
    pub fn plan_original_device(&self,id:&str,call:&str,lease:&BackgroundExecutionLease,
        load:impl FnOnce(&Connection,&SubmitBackgroundTaskInput)->Result<(String,Value),String>)->Result<Value,String>{
        let mut conn=self.lock_conn()?;
        let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        Self::require_background_execution(&tx,id,Some(lease))?;
        Self::verify_background_binding(&tx,id,load)?;
        // Admission/read observation and its canonical tool receipt commit
        // together. A lost IPC reply cannot become an uncertain phone effect.
        let returned:Option<String>=tx.query_row("SELECT result_json FROM automation_background_operations WHERE execution_id=?1 AND call_id=?2 AND tool_name='OriginalDeviceTask' AND state='returned'",params![id,call],|row|row.get(0)).optional().map_err(|e|e.to_string())?;
        if let Some(raw)=returned {return serde_json::from_str(&raw).map_err(|e|e.to_string());}
        let arguments:String=tx.query_row("SELECT o.arguments_json FROM automation_background_operations o JOIN automation_background_operation_leases l ON l.execution_id=o.execution_id AND l.call_id=o.call_id WHERE o.execution_id=?1 AND o.call_id=?2 AND o.tool_name='OriginalDeviceTask'",params![id,call],|row|row.get(0)).map_err(|_|"Original device planning requires its captured native journal intent")?;
        let args:Value=serde_json::from_str(&arguments).map_err(|e|e.to_string())?;
        // The current fenced writer may recover this original immutable local
        // intent after restart. It never submits a new phone effect here.
        let observed=(||->Result<Value,String>{
        if call.is_empty() || call.len()>256 {return Err("Original planning call identity exceeds its bound".into());}
        let branch=args["branch_id"].as_str().ok_or("Choose an original device branch")?;
        let request:String=tx.query_row("SELECT request_id FROM automation_background_tasks WHERE execution_id=?1",params![id],|row|row.get(0)).map_err(|e|e.to_string())?;
        if owner(&tx,&request,branch)?!=id {return Err("Original device planning changed its execution".into());}
        let scope:Option<(String,String)>=tx.query_row("SELECT scope_key,scope_json FROM automation_background_device_planning_scopes WHERE execution_id=?1 AND branch_id=?2",params![id,branch],|row|Ok((row.get(0)?,row.get(1)?))).optional().map_err(|e|e.to_string())?;
        let result=match args["action"].as_str() {
            Some("inspect")=>{
                let offset=args.get("offset").map(|value|value.as_u64().filter(|value|*value<=128).ok_or("Invalid planning cursor")).transpose()?.unwrap_or(0);
                let selection_offset=args.get("scope_offset").map(|value|value.as_u64().and_then(|value|usize::try_from(value).ok()).ok_or("Invalid scope cursor")).transpose()?.unwrap_or(0);
                let current=scope.as_ref().map(|(_,raw)|serde_json::from_str::<Value>(raw)).transpose().map_err(|e|e.to_string())?;
                let metadata=current.as_ref().map(|current|{
                    let selected=current["selections"].as_array().cloned().unwrap_or_default();
                    serde_json::json!({"contextHash":current["contextHash"],"revision":current["revision"],"decision":current["decision"],"allowedKinds":current["allowedKinds"],
                        "selections":selected.iter().skip(selection_offset).take(4).collect::<Vec<_>>(),"nextSelectionOffset":if selection_offset.saturating_add(4)<selected.len(){Some(selection_offset+4)}else{None}})
                });
                let mut stmt=tx.prepare("SELECT call_id,kind,scope_key,result_json IS NOT NULL FROM automation_background_device_planning_calls WHERE execution_id=?1 AND branch_id=?2 ORDER BY created_at,call_id LIMIT 17 OFFSET ?3").map_err(|e|e.to_string())?;
                let mut calls=stmt.query_map(params![id,branch,offset as i64],|row|Ok(serde_json::json!({"callId":row.get::<_,String>(0)?,"kind":row.get::<_,String>(1)?,"scopeKey":row.get::<_,String>(2)?,"hasResult":row.get::<_,bool>(3)?}))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
                let next=if calls.len()>16 {calls.truncate(16);Some(offset+16)}else{None};
                serde_json::json!({"scope":metadata,"scopeKey":scope.as_ref().map(|(key,_)|key),"calls":calls,"nextCursor":next})
            },
            Some("read_result")=>{
                let selected=args["result_call_id"].as_str().ok_or("Choose the original planning call")?;
                let (key,raw):(String,Option<String>)=tx.query_row("SELECT scope_key,result_json FROM automation_background_device_planning_calls WHERE execution_id=?1 AND branch_id=?2 AND call_id=?3",params![id,branch,selected],|row|Ok((row.get(0)?,row.get(1)?))).map_err(|e|e.to_string())?;
                if scope.as_ref().is_none_or(|(current,_)|current!=&key){return Err("Read scope changed; old planning data cannot be released".into());}
                if let Some(raw)=raw {
                let hash=hex::encode(Sha256::digest(raw.as_bytes()));
                let offset=args.get("offset").map(|value|value.as_u64().ok_or("Invalid planning chunk offset")).transpose()?.unwrap_or(0);
                let offset=usize::try_from(offset).map_err(|_|"Invalid planning chunk offset")?;
                if offset>raw.len() || !raw.is_char_boundary(offset) || (offset>0 && args["snapshot_hash"]!=hash){return Err("Planning chunk requires its original snapshot hash and UTF-8 offset".into());}
                let mut end=(offset+16*1024).min(raw.len());while !raw.is_char_boundary(end){end-=1;}
                serde_json::json!({"callId":selected,"scopeKey":key,"snapshotHash":hash,"content":&raw[offset..end],"nextOffset":if end<raw.len(){Some(end)}else{None}})
                } else {serde_json::json!({"pending":true,"callId":selected})}
            },
            Some(kind @ ("request_read"|"propose"))=>{
                if let Some(contract)=Self::device_observation_contract(&tx,id,branch)? {
                    if kind!="request_read" || args["read_action"]!="read_health_samples" || args["request"]!=contract.request() {
                        return Err("Read-only branch requires its exact original health query; no writes or substitute reads".into());
                    }
                    let report=Self::background_outcome_report(&tx,id)?.ok_or("Missing original read plan")?;
                    if report.branches.iter().any(|outcome|outcome.branch.id==branch && outcome.state=="verified") {
                        return Err("Original health observation already completed; read its retained result instead of querying again".into());
                    }
                }
                let (key,raw)=scope.as_ref().ok_or("Original phone has not published its authorized read scope; wait for it")?;
                if args["scope_key"]!=*key {return Err("Original phone read scope changed; inspect it again".into());}
                let scope:Value=serde_json::from_str(raw).map_err(|e|e.to_string())?;
                if scope["allowedKinds"].as_array().is_none_or(Vec::is_empty){return Err("Original phone has not authorized planning reads".into());}
                let request=if kind=="request_read" {
                    let action=args["read_action"].as_str().ok_or("Choose a native read action")?;
                    let read_kind=match action {"list_calendars"=>args["request"]["kind"].as_str().ok_or("Calendar read requires kind")?,"list_calendar_events"=>"event","list_reminders"=>"reminder","read_health_samples"=>"health",_=>return Err("Only original native read actions are supported".into())};
                    if !scope["allowedKinds"].as_array().is_some_and(|kinds|kinds.iter().any(|kind|kind==read_kind)) || !args["request"].is_object() || serde_json::to_vec(&args["request"]).map_err(|e|e.to_string())?.len()>8192 {return Err("Read request exceeds the original authorized kind/bound".into());}
                    serde_json::json!({"action":action,"request":args["request"]})
                } else {
                    let actions=args["actions"].as_array().filter(|actions|!actions.is_empty() && actions.len()<=8).ok_or("Propose 1-8 original device actions")?;
                    if serde_json::to_vec(actions).map_err(|e|e.to_string())?.len()>64*1024 || actions.iter().any(|action|action.as_object().is_none_or(|object|object.len()!=3) || !matches!(action["kind"].as_str(),Some("calendar_event"|"reminder")) || !action["request"].is_object() || action["sourceId"].as_str().is_none_or(str::is_empty)){return Err("Invalid original device action proposal".into());}
                    serde_json::json!({"actions":actions})
                };
                let raw=serde_json::to_string(&request).map_err(|e|e.to_string())?;
                let existing:Option<(String,String,String,String)>=tx.query_row("SELECT branch_id,scope_key,kind,request_json FROM automation_background_device_planning_calls WHERE execution_id=?1 AND call_id=?2",params![id,call],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).optional().map_err(|e|e.to_string())?;
                if let Some(existing)=existing {if existing!=(branch.into(),key.clone(),kind.into(),raw.clone()){return Err("Original planning call is immutable".into());}}
                else {
                    let count:i64=tx.query_row("SELECT COUNT(*) FROM automation_background_device_planning_calls WHERE execution_id=?1",params![id],|row|row.get(0)).map_err(|e|e.to_string())?;
                    if count>=128 {return Err("Original planning call capacity exhausted".into());}
                    let pending:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_background_device_planning_calls WHERE execution_id=?1 AND branch_id=?2 AND scope_key=?3 AND result_json IS NULL)",params![id,branch,key],|row|row.get(0)).map_err(|e|e.to_string())?;
                    if pending {return Err("Await the original pending phone planning call before issuing another".into());}
                    tx.execute("INSERT INTO automation_background_device_planning_calls(execution_id,call_id,branch_id,scope_key,kind,request_json,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![id,call,branch,key,kind,raw,db::now_ms()]).map_err(|e|e.to_string())?;
                }
                serde_json::json!({"queued":true,"callId":call,"scopeKey":key,"kind":kind,"effectCompleted":false})
            },
            _=>return Err("Unknown original device planning action".into()),
        };Ok(result)
        })();
        let is_error=observed.is_err();
        let result=observed.unwrap_or_else(|error|serde_json::json!({"error":error,"knownNoEffect":true}));
        let now=db::now_ms();
        let receipt=serde_json::json!({"role":"toolResult","toolCallId":call,"toolName":"OriginalDeviceTask","isError":is_error,"timestamp":now,
            "content":[{"type":"text","text":serde_json::to_string(&result).map_err(|e|e.to_string())?}],"details":{"kind":"original_device_planning","knownNoEffect":is_error}});
        let raw=serde_json::to_string(&receipt).map_err(|e|e.to_string())?;
        if raw.len()>128*1024 {return Err("Original planning observation exceeds journal receipt bounds".into());}
        if tx.execute("UPDATE automation_background_operations SET state='returned',result_json=?3,is_error=?5,finished_at=?4 WHERE execution_id=?1 AND call_id=?2 AND state='started'",params![id,call,raw,now,is_error]).map_err(|e|e.to_string())?!=1 {return Err("Original planning intent changed before its atomic receipt".into());}
        tx.commit().map_err(|e|e.to_string())?;Ok(receipt)
    }

    pub(crate) fn mobile_planning_receipt(&self,entry:&str,branch:&str,call:&str,key:&str,result:Option<Value>)->Result<Option<Value>,String>{
        let mut conn=self.lock_conn()?;
        let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let (watch,submission,_)=Self::local_device_plan_owner(&tx,entry)?;
        if submission.cancel_requested {return Err("Original phone task was cancelled".into());}
        let access=Self::mobile_branch_read_authorization_on_connection(&tx,entry,branch)?;
        // The command separately checks SDK capability filtering; this layer
        // preserves the exact result and its original grant key across lost ACKs.
        let cached:Option<(String,String)>=tx.query_row("SELECT scope_key,result_json FROM automation_mobile_device_planning_receipts WHERE request_id=?1 AND branch_id=?2 AND call_id=?3",params![watch.request_id,branch,call],|row|Ok((row.get(0)?,row.get(1)?))).optional().map_err(|e|e.to_string())?;
        if access["decision"]=="revoked" {return Err("Original phone read scope was revoked".into());}
        if let Some((old,raw))=cached {if old!=key{return Err("Native planning receipt belongs to its original read scope".into());}return serde_json::from_str(&raw).map(Some).map_err(|e|e.to_string());}
        let Some(result)=result else{return Ok(None);};
        let raw=serde_json::to_string(&result).map_err(|e|e.to_string())?;
        if !result.is_object() || raw.len()>1024*1024 {return Err("Native planning receipt exceeds its bound".into());}
        let (count,bytes):(i64,i64)=tx.query_row("SELECT COUNT(*),COALESCE(SUM(LENGTH(CAST(result_json AS BLOB))),0) FROM automation_mobile_device_planning_receipts WHERE request_id=?1",params![watch.request_id],|row|Ok((row.get(0)?,row.get(1)?))).map_err(|e|e.to_string())?;
        if count>=128 || bytes+raw.len() as i64>64*1024*1024 {return Err("Native planning receipt capacity exhausted".into());}
        tx.execute("INSERT INTO automation_mobile_device_planning_receipts(request_id,branch_id,call_id,scope_key,result_json) VALUES(?1,?2,?3,?4,?5)",params![watch.request_id,branch,call,key,raw]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e|e.to_string())?;Ok(Some(result))
    }
}
