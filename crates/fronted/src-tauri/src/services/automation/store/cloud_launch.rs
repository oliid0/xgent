//! The native journal owns task ids and immutable launch receipts. Recovery is
//! GET-only; even an invisible run is not proof that dispatch never happened.
use super::*;
use sha2::{Digest, Sha256};
use crate::services::cloud_execution::{CloudTaskStartInput, CloudTaskStartResult};

pub(super) fn uncertain_cloud_start_error(raw:&str,call:&str) -> bool {
    serde_json::from_str::<Value>(raw).ok().is_some_and(|receipt|
        receipt["role"]=="toolResult" && receipt["toolCallId"]==call
        && receipt["toolName"]=="CloudTaskManager" && receipt["isError"]==true
        && receipt["details"]["outcomeUncertain"]==true)
}

/// An additive native observation, never a replacement of the original error.
/// Every consumer uses this same reservation/arguments/receipt proof boundary.
pub(super) fn confirmed_late_cloud_start_receipt(conn:&Connection,id:&str,call:&str) -> Result<Option<Value>,String> {
    let arguments:Option<String>=conn.query_row(
        "SELECT arguments_json FROM automation_background_operations WHERE execution_id = ?1 AND call_id = ?2 AND tool_name = 'CloudTaskManager' AND state = 'returned' AND is_error = 1",
        params![id,call],|row|row.get(0)).optional().map_err(|e|e.to_string())?;
    let Some(arguments)=arguments else {return Ok(None);};
    let parsed:Value=serde_json::from_str(&arguments).map_err(|e|e.to_string())?;
    if parsed["action"]!="start" || parsed.get("owner").is_some() || parsed.get("repository").is_some() {return Ok(None);}
    let hash=hex::encode(Sha256::digest(arguments.as_bytes()));
    let raw:Option<String>=conn.query_row(
        "SELECT c.result_json FROM automation_background_cloud_launches c
         JOIN automation_background_operations o ON o.execution_id = c.execution_id AND o.call_id = c.call_id
         WHERE c.execution_id = ?1 AND c.call_id = ?2 AND c.arguments_hash = ?3
         AND o.tool_name = 'CloudTaskManager' AND o.state = 'returned' AND o.is_error = 1
         AND json_valid(o.result_json) AND json_extract(o.result_json,'$.role') = 'toolResult'
         AND json_extract(o.result_json,'$.toolCallId') = ?2 AND json_extract(o.result_json,'$.toolName') = 'CloudTaskManager'
         AND json_type(o.result_json,'$.isError') = 'true' AND json_type(o.result_json,'$.details.outcomeUncertain') = 'true'
         AND json_valid(c.result_json) AND json_extract(c.result_json,'$.role') = 'toolResult'
         AND json_extract(c.result_json,'$.toolCallId') = ?2 AND json_extract(c.result_json,'$.toolName') = 'CloudTaskManager'
         AND json_type(c.result_json,'$.isError') = 'false' AND json_type(c.result_json,'$.details.reconcilesFailedReceipt') = 'true'
         AND COALESCE(json_extract(c.result_json,'$.details.outcomeUncertain'),0) = 0
         AND COALESCE(json_extract(c.result_json,'$.details.receiptTruncated'),0) = 0
         AND json_extract(c.result_json,'$.details.kind') = 'cloud_task_manager' AND json_extract(c.result_json,'$.details.action') = 'start'
         AND json_type(c.result_json,'$.details.observedRunId') = 'integer' AND json_extract(c.result_json,'$.details.observedRunId') > 0
         AND json_extract(c.result_json,'$.details.taskId') = c.task_id
         AND length(json_extract(c.result_json,'$.details.owner')) > 0
         AND (c.owner = '' OR lower(json_extract(c.result_json,'$.details.owner')) = lower(c.owner))
         AND lower(json_extract(c.result_json,'$.details.repository')) = lower(c.repository)
         AND json_extract(c.result_json,'$.details.runner') = c.runner",
        params![id,call,hash],|row|row.get(0)).optional().map_err(|e|e.to_string())?;
    raw.map(|raw|serde_json::from_str(&raw).map_err(|e|e.to_string())).transpose()
}

impl AutomationStore {
    pub fn prepare_background_cloud_launch(&self, id: &str, call: &str, lease: &BackgroundExecutionLease, reserve: bool,
        load: impl FnOnce(&Connection, &SubmitBackgroundTaskInput) -> Result<(String,Value),String>,
    ) -> Result<BackgroundCloudLaunch,String> {
        if call.is_empty() || call.len()>256 { return Err("Cloud launch requires an actual bounded call id".into()); }
        let mut conn=self.lock_conn()?;
        let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let settings=Self::verify_background_configuration(&tx,id,Some(lease),load)?;
        let launch=Self::prepare_cloud_launch_on_connection(&tx,id,call,lease,reserve,settings)?;
        tx.commit().map_err(|e|e.to_string())?;
        Ok(launch)
    }

    pub(super) fn prepare_cloud_launch_on_connection(tx:&Connection,id:&str,call:&str,lease:&BackgroundExecutionLease,reserve:bool,settings:Value) -> Result<BackgroundCloudLaunch,String> {
        if settings["access"]["cloudExecutionEnabled"]!=true {return Err("Cloud execution is disabled".into());}
        let policies=&settings["system"]["toolPolicies"];
        let policy=policies.get("CloudTaskManager").or_else(||policies.get("group:cloud")).and_then(Value::as_str).unwrap_or("allow");
        if policy!="allow" {return Err("Cloud task launch requires an allowed native execution policy".into());}
        let owns:bool=tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM automation_background_operation_leases WHERE execution_id = ?1 AND call_id = ?2 AND attempt = ?3 AND generation = ?4 AND token = ?5)",
            params![id,call,lease.attempt,lease.generation,lease.token],|row|row.get(0)).map_err(|e|e.to_string())?;
        if !owns {return Err("Cloud launch does not own the original journal intent".into());}
        let (raw,state,operation_receipt):(String,String,Option<String>)=tx.query_row(
            "SELECT arguments_json,state,result_json FROM automation_background_operations WHERE execution_id = ?1 AND call_id = ?2 AND tool_name = 'CloudTaskManager'",
            params![id,call],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).map_err(|_|"Cloud launch requires this execution's original journal call".to_string())?;
        let arguments:Value=serde_json::from_str(&raw).map_err(|e|e.to_string())?;
        if arguments["action"]!="start" || arguments.get("owner").is_some() || arguments.get("repository").is_some() {
            return Err("New cloud launch arguments cannot replace its configured namespace".into());
        }
        let hash=hex::encode(Sha256::digest(raw.as_bytes()));
        let mut input:CloudTaskStartInput=serde_json::from_value(arguments).map_err(|e|format!("Invalid original cloud inputs: {e}"))?;
        input.owner=settings["access"]["githubOwner"].as_str().unwrap_or_default().trim().into();
        input.repository=crate::services::cloud_execution::normalize_repository_name(settings["access"]["githubRepository"].as_str().unwrap_or_default())?;
        input.retention_days=settings["access"]["cloudArtifactRetentionDays"].as_u64().unwrap_or(7).clamp(1,90) as u8;
        input.runner=input.runner.trim().into(); input.script=input.script.trim().into(); input.label=input.label.trim().into();
        input.validate_execution()?;
        if !matches!(input.runner.as_str(),"ubuntu-latest"|"windows-latest"|"macos-latest") {return Err("Cloud start requires a supported runner".into());}
        for file in &mut input.files {file.path=file.path.trim().into();}
        let saved:Option<(String,String,String,String,String,Option<String>)>=tx.query_row(
            "SELECT task_id,arguments_hash,owner,repository,runner,result_json FROM automation_background_cloud_launches WHERE execution_id = ?1 AND call_id = ?2",
            params![id,call],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?))).optional().map_err(|e|e.to_string())?;
        let (task_id,execute,receipt)=if let Some((task,original,owner,repository,runner,receipt))=saved {
            if original!=hash || owner!=input.owner || repository!=input.repository || runner!=input.runner {return Err("Cloud launch intent/configuration changed".into());}
            let failed=state=="returned" && operation_receipt.as_deref().is_some_and(|raw|uncertain_cloud_start_error(raw,call));
            if receipt!=operation_receipt && !failed {return Err("Cloud launch receipt and journal disagree; inspect before continuing".into());}
            if failed && receipt.is_some() && confirmed_late_cloud_start_receipt(tx,id,call)?.is_none() {return Err("Late cloud observation does not reconcile its original receipt".into());}
            if receipt.is_none() && state!="started" && !failed {return Err("Cloud intent is no longer unresolved".into());}
            (task,false,receipt.map(|raw|serde_json::from_str(&raw).map_err(|e|e.to_string())).transpose()?)
        } else {
            if !reserve || state!="started" || operation_receipt.is_some() {return Err("No unresolved native cloud reservation; never infer or replay a start".into());}
            let task=format!("task-{}",Uuid::new_v4().simple());
            tx.execute(
                "INSERT INTO automation_background_cloud_launches (execution_id,call_id,task_id,arguments_hash,owner,repository,runner,issued_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                params![id,call,task,hash,input.owner,input.repository,input.runner,db::now_ms()]).map_err(|e|e.to_string())?;
            (task,true,None)
        };
        Ok(BackgroundCloudLaunch{task_id,input,execute,receipt})
    }

    /// An actual native acknowledgement is useful even after cancellation. It
    /// never reopens a task; it only closes its originally owned journal intent.
    pub fn acknowledge_background_cloud_launch(&self,id:&str,call:&str,lease:&BackgroundExecutionLease,result:&CloudTaskStartResult) -> Result<Value,String> {
        let mut conn=self.lock_conn()?;
        let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let receipt=Self::acknowledge_cloud_launch_on_connection(&tx,id,call,lease,result)?;
        tx.commit().map_err(|e|e.to_string())?;
        Ok(receipt)
    }

    pub(super) fn acknowledge_cloud_launch_on_connection(tx:&Connection,id:&str,call:&str,lease:&BackgroundExecutionLease,result:&CloudTaskStartResult) -> Result<Value,String> {
        let (task,owner,repository,runner,existing):(String,String,String,String,Option<String>)=tx.query_row(
            "SELECT task_id,owner,repository,runner,result_json FROM automation_background_cloud_launches WHERE execution_id = ?1 AND call_id = ?2",
            params![id,call],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?))).map_err(|e|e.to_string())?;
        let owns:bool=tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM automation_background_operation_leases WHERE execution_id = ?1 AND call_id = ?2 AND attempt = ?3 AND generation = ?4 AND token = ?5)",
            params![id,call,lease.attempt,lease.generation,lease.token],|row|row.get(0)).map_err(|e|e.to_string())?;
        if !owns || result.task_id!=task || !result.repository.eq_ignore_ascii_case(&repository) || result.runner!=runner || (!owner.is_empty() && !owner.eq_ignore_ascii_case(&result.owner)) {
            return Err("Native cloud acknowledgement does not match its original reservation/lease".into());
        }
        if let Some(raw)=existing {return serde_json::from_str(&raw).map_err(|e|e.to_string());}
        let (state,original):(String,Option<String>)=tx.query_row(
            "SELECT state,result_json FROM automation_background_operations WHERE execution_id = ?1 AND call_id = ?2 AND tool_name = 'CloudTaskManager'",
            params![id,call],|row|Ok((row.get(0)?,row.get(1)?))).map_err(|e|e.to_string())?;
        let failed=state=="returned" && original.as_deref().is_some_and(|raw|uncertain_cloud_start_error(raw,call));
        if failed && result.observed_run_id.is_none_or(|id|id==0) {return Err("Frozen cloud error needs a positive native GET run observation".into());}
        let mut details=serde_json::to_value(result).map_err(|e|e.to_string())?;
        details["kind"]=Value::String("cloud_task_manager".into());details["action"]=Value::String("start".into());
        if failed {details["reconcilesFailedReceipt"]=Value::Bool(true);}
        let mut receipt=serde_json::json!({"role":"toolResult","toolCallId":call,"toolName":"CloudTaskManager","isError":false,"timestamp":db::now_ms(),
            "content":[{"type":"text","text":format!("Cloud task started: {}\nrunner: {}\nrepository: {}/{}\nrepository URL: {}\nrepository visibility: {}\nUse this task_id, owner and repository to inspect the original job. For background waiting, bind the actual start call id; never redispatch it. Download and inspect actual deliverables; job success alone is not completion proof.",result.task_id,result.runner,result.owner,result.repository,result.repository_url,result.repository_visibility)}],"details":details});
        if failed {receipt["content"].as_array_mut().ok_or_else(||"Invalid native cloud receipt".to_string())?.push(serde_json::json!({"type":"text","text":format!("The original failed receipt remains in the audit journal. Native GET later observed its reserved workflow run {}. This confirms launch only; continue checking the original job and actual deliverables.",result.observed_run_id.unwrap_or_default())}));}
        let raw=serde_json::to_string(&receipt).map_err(|e|e.to_string())?;
        if raw.len()>16*1024 {return Err("Cloud acknowledgement exceeds its receipt bound".into());}
        let recorded=if failed {0} else {tx.execute(
            "UPDATE automation_background_operations SET state = 'returned', result_json = ?3, is_error = 0, finished_at = ?4 WHERE execution_id = ?1 AND call_id = ?2 AND tool_name = 'CloudTaskManager' AND state = 'started' AND result_json IS NULL",
            params![id,call,raw,db::now_ms()]).map_err(|e|e.to_string())?};
        if recorded!=1 && !failed {return Err("Cloud journal already has an immutable receipt; cannot replace it".into());}
        tx.execute("UPDATE automation_background_cloud_launches SET result_json = ?3 WHERE execution_id = ?1 AND call_id = ?2 AND result_json IS NULL",params![id,call,raw]).map_err(|e|e.to_string())?;
        if failed && confirmed_late_cloud_start_receipt(tx,id,call)?.is_none() {return Err("Late cloud observation failed its native reservation proof".into());}
        Ok(receipt)
    }
}
