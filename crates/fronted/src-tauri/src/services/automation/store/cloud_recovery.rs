//! Recovery parks only a single reserved cloud START with a recoverable model
//! tail. This collector observes the original job; it never issues a dispatch.
use super::*;
use crate::services::cloud_execution::CloudTaskStartResult;

fn recovery_lease(conn:&Connection,id:&str,wait:&str,call:&str) -> Result<BackgroundExecutionLease,String> {
    super::waiting::require_wait(conn,id,wait)?;
    let owns:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM automation_background_cloud_recoveries WHERE execution_id = ?1 AND wait_id = ?2 AND call_id = ?3)",params![id,wait,call],|row|row.get(0)).map_err(|e|e.to_string())?;
    if !owns {return Err("Cloud recovery occurrence changed".into());}
    conn.query_row("SELECT attempt,generation,token FROM automation_background_operation_leases WHERE execution_id = ?1 AND call_id = ?2",params![id,call],|row|Ok(BackgroundExecutionLease{attempt:row.get(0)?,generation:row.get(1)?,token:row.get(2)?})).map_err(|e|e.to_string())
}

fn has_original_tail(context:&Value,call:&str,arguments:&str) -> bool {
    let Some(messages)=context["messages"].as_array() else {return false;};
    let Some(index)=messages.iter().rposition(|message|message["role"]=="assistant") else {return false;};
    let assistant=&messages[index];
    if assistant["stopReason"]!="toolUse" {return false;}
    let Ok(original)=serde_json::from_str::<Value>(arguments) else {return false;};
    assistant["content"].as_array().is_some_and(|parts|parts.iter().any(|part|
        part["type"]=="toolCall" && part["id"]==call && part["name"]=="CloudTaskManager" && part["arguments"]==original))
        && messages[index+1..].iter().all(|message|message["role"]=="toolResult" && message["toolCallId"]!=call)
}

fn park_cloud_row(tx:&Connection,id:&str,raw:&str,call:&str,arguments:&str,context:&str,generation:u64) -> Result<Option<String>,String> {
    let Ok(mut request)=serde_json::from_str::<PromptRunRequest>(raw) else {return Ok(None);};
    let Ok(context)=serde_json::from_str::<Value>(context) else {return Ok(None);};
    if request.execution_id!=id || request.task_id!=id || super::journal::background_context_json(&context).is_err() || !has_original_tail(&context,call,arguments) {return Ok(None);}
    let wait=Uuid::new_v4().to_string();let now=db::now_ms();request.lease=None;
    let input=serde_json::json!({"kind":"native_cloud_launch_recovery","executionId":id,"callId":call});
    tx.execute("INSERT INTO automation_background_waits (wait_id,execution_id,input_json,automatic_tools_json,known_tools_json,retry_on_inventory_change,created_at,retry_at,probes) VALUES (?1,?2,?3,'[]','[]',0,?4,?4,0)",params![wait,id,input.to_string(),now]).map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO automation_background_cloud_recoveries (execution_id,call_id,wait_id,retry_at) VALUES (?1,?2,?3,?4) ON CONFLICT(execution_id) DO UPDATE SET call_id = excluded.call_id, wait_id = excluded.wait_id, retry_at = excluded.retry_at, probes = 0, last_error = NULL",params![id,call,wait,now]).map_err(|e|e.to_string())?;
    tx.execute("UPDATE automation_background_cloud_recoveries SET last_error = (SELECT error FROM automation_background_cloud_launch_failures WHERE execution_id = ?1 AND call_id = ?3) WHERE execution_id = ?1 AND wait_id = ?2",params![id,wait,call]).map_err(|e|e.to_string())?;
    tx.execute("UPDATE automation_background_leases SET generation = ?2, token = ?3 WHERE execution_id = ?1",params![id,(generation+1) as i64,Uuid::new_v4().to_string()]).map_err(|e|e.to_string())?;
    let changed=tx.execute("UPDATE automation_cron_runs SET state = 'waiting', lease_expires_at = NULL, request_json = ?2, output = ?3 WHERE execution_id = ?1 AND state = 'leased'",params![id,serde_json::to_string(&request).map_err(|e|e.to_string())?,"Original cloud launch is unconfirmed. Native recovery will query the retained task without redispatch."]).map_err(|e|e.to_string())?;
    if changed!=1 {return Err("Cloud parking lost its original execution".into());}Ok(Some(wait))
}

fn wake_cloud_row(tx:&Connection,id:&str,wait:&str,call:&str,receipt:&Value) -> Result<usize,String> {
    let input=serde_json::json!({"kind":"native_cloud_launch_recovered","callId":call,"taskId":receipt["details"]["taskId"]});
    tx.execute("INSERT INTO automation_background_resumptions (resume_id,execution_id,wait_id,input_json,created_at) VALUES (?1,?2,?3,?4,?5)",params![Uuid::new_v4().to_string(),id,wait,input.to_string(),db::now_ms()]).map_err(|e|e.to_string())?;
    let changed=tx.execute("UPDATE automation_cron_runs SET state = 'pending', lease_expires_at = NULL WHERE execution_id = ?1 AND state = 'waiting'",params![id]).map_err(|e|e.to_string())?;
    tx.execute("DELETE FROM automation_background_cloud_recoveries WHERE execution_id = ?1 AND wait_id = ?2",params![id,wait]).map_err(|e|e.to_string())?;Ok(changed)
}

impl AutomationStore {
    /// Status projection only. This read cannot dispatch, wake or acknowledge a
    /// job. Old snapshots retain their original observation independently.
    pub(super) fn background_cloud_recovery_record(conn:&Connection,id:&str) -> Result<Option<BackgroundCloudRecovery>,String> {
        conn.query_row("SELECT c.call_id,l.task_id,c.wait_id,c.retry_at,c.probes,f.error,c.last_error FROM automation_background_cloud_recoveries c
            JOIN automation_background_cloud_launches l ON l.execution_id = c.execution_id AND l.call_id = c.call_id
            JOIN automation_cron_runs r ON r.execution_id = c.execution_id
            LEFT JOIN automation_background_cloud_launch_failures f ON f.execution_id = c.execution_id AND f.call_id = c.call_id
            WHERE c.execution_id = ?1 AND r.state = 'waiting'
            AND NOT EXISTS (SELECT 1 FROM automation_background_resumptions s WHERE s.wait_id = c.wait_id)",params![id],|row|Ok(BackgroundCloudRecovery{
                call_id:row.get(0)?,task_id:row.get(1)?,wait_id:row.get(2)?,retry_at:row.get(3)?,probes:row.get(4)?,launch_error:row.get(5)?,last_error:row.get(6)?,
            })).optional().map_err(|e|e.to_string())
    }

    /// Only native service errors populate this immutable diagnostic. It is
    /// not a failed operation receipt or evidence of absence/success.
    pub fn record_native_cloud_launch_failure(&self,id:&str,call:&str,lease:&BackgroundExecutionLease,error:&str) -> Result<(),String> {
        let conn=self.lock_conn()?;
        conn.execute("INSERT OR IGNORE INTO automation_background_cloud_launch_failures (execution_id,call_id,error,recorded_at) SELECT ?1,?2,?6,?7 WHERE EXISTS (SELECT 1 FROM automation_background_operation_leases l JOIN automation_background_cloud_launches c ON c.execution_id = l.execution_id AND c.call_id = l.call_id WHERE l.execution_id = ?1 AND l.call_id = ?2 AND l.attempt = ?3 AND l.generation = ?4 AND l.token = ?5)",params![id,call,lease.attempt,lease.generation,lease.token,error.chars().take(2048).collect::<String>(),db::now_ms()]).map_err(|e|e.to_string())?;Ok(())
    }

    /// Runtime suspension is delivered until acknowledged. No reservation
    /// means the ordinary original failure can be recorded; absence of a run
    /// never has that meaning. ACK retries do not mutate a replacement attempt.
    pub fn park_unconfirmed_background_cloud_start(&self,id:&str,call:&str,lease:&BackgroundExecutionLease,
        load:impl FnOnce(&Connection,&SubmitBackgroundTaskInput)->Result<(String,Value),String>) -> Result<bool,String> {
        let mut conn=self.lock_conn()?;
        let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let owns:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_background_operation_leases WHERE execution_id = ?1 AND call_id = ?2 AND attempt = ?3 AND generation = ?4 AND token = ?5)",params![id,call,lease.attempt,lease.generation,lease.token],|row|row.get(0)).map_err(|e|e.to_string())?;
        if !owns {return Err("Cloud parking requires its original operation lease".into());}
        let reserved:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_background_cloud_launches WHERE execution_id = ?1 AND call_id = ?2)",params![id,call],|row|row.get(0)).map_err(|e|e.to_string())?;
        if !reserved {return Ok(false);}
        let parked:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_background_cloud_recoveries WHERE execution_id = ?1 AND call_id = ?2)",params![id,call],|row|row.get(0)).map_err(|e|e.to_string())?;
        if parked {return Ok(true);}
        let state:String=tx.query_row("SELECT state FROM automation_cron_runs WHERE execution_id = ?1",params![id],|row|row.get(0)).map_err(|e|e.to_string())?;
        if matches!(state.as_str(),"done"|"expired") {return Ok(true);}
        if Self::require_background_fence(&tx,id,Some(lease)).is_err() {
            let receipt:Option<String>=tx.query_row("SELECT result_json FROM automation_background_cloud_launches WHERE execution_id = ?1 AND call_id = ?2",params![id,call],|row|row.get(0)).map_err(|e|e.to_string())?;
            if receipt.is_some() {return Ok(true);}return Err("Cloud parking attempt was superseded".into());
        }
        let settings=Self::verify_background_configuration(&tx,id,Some(lease),load)?;
        let launch=Self::prepare_cloud_launch_on_connection(&tx,id,call,lease,false,settings)?;
        let other_uncertain:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_background_operations WHERE execution_id = ?1 AND call_id != ?2 AND (state = 'started' OR (is_error = 1 AND CASE WHEN json_valid(result_json) THEN COALESCE(json_extract(result_json,'$.details.outcomeUncertain'),0) = 1 ELSE 1 END)))",params![id,call],|row|row.get(0)).map_err(|e|e.to_string())?;
        if other_uncertain {return Err("Other uncertain effects prevent automatic cloud parking".into());}
        let waits:i64=tx.query_row("SELECT COUNT(*) FROM automation_background_waits WHERE execution_id = ?1",params![id],|row|row.get(0)).map_err(|e|e.to_string())?;
        if waits>=32 || lease.generation>=9_007_199_254_740_990 {return Err("Cloud recovery history or execution counter exhausted".into());}
        let (raw,args,context):(String,String,String)=tx.query_row("SELECT r.request_json,o.arguments_json,k.context_json FROM automation_cron_runs r JOIN automation_background_operations o ON o.execution_id = r.execution_id JOIN automation_background_checkpoints k ON k.execution_id = r.execution_id WHERE r.execution_id = ?1 AND o.call_id = ?2",params![id,call],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).map_err(|e|e.to_string())?;
        let wait=park_cloud_row(&tx,id,&raw,call,&args,&context,lease.generation)?.ok_or_else(||"Cloud parking has no original recoverable model tail".to_string())?;
        let wake=if let Some(receipt)=launch.receipt {wake_cloud_row(&tx,id,&wait,call,&receipt)?==1} else {false};
        tx.commit().map_err(|e|e.to_string())?;drop(conn);
        if wake {self.with_notifier(|notifier|notifier.prompt_pending());}Ok(true)
    }
    /// Startup only, before any worker may claim. Revoke the previous writer
    /// while retaining its intent lease as evidence for a late actual receipt.
    pub(super) fn park_interrupted_cloud_launches(&self) -> Result<usize,String> {
        self.park_cloud_launches(None)
    }

    /// The periodic sweep may revoke only a writer whose lease has expired.
    /// A live worker must never be parked just because its dispatch is pending.
    pub(super) fn park_expired_cloud_launches(&self) -> Result<usize,String> {
        self.park_cloud_launches(Some(db::now_ms()))
    }

    fn park_cloud_launches(&self,expired_at:Option<i64>) -> Result<usize,String> {
        let mut conn=self.lock_conn()?;
        let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let rows={
            let mut query=tx.prepare("SELECT r.execution_id,r.request_json,c.call_id,o.arguments_json,k.context_json,l.generation
                FROM automation_cron_runs r
                JOIN automation_background_tasks b ON b.execution_id = r.execution_id
                JOIN automation_background_configuration_bindings binding ON binding.execution_id = r.execution_id
                JOIN automation_background_leases l ON l.execution_id = r.execution_id
                JOIN automation_background_checkpoints k ON k.execution_id = r.execution_id
                JOIN automation_background_cloud_launches c ON c.execution_id = r.execution_id
                JOIN automation_background_operations o ON o.execution_id = c.execution_id AND o.call_id = c.call_id
                JOIN automation_background_operation_leases original ON original.execution_id = o.execution_id AND original.call_id = o.call_id
                WHERE r.state = 'leased' AND r.request_json IS NOT NULL AND c.result_json IS NULL
                AND (?1 IS NULL OR (r.lease_expires_at IS NOT NULL AND r.lease_expires_at < ?1))
                AND o.tool_name = 'CloudTaskManager'
                AND ((o.state = 'started' AND o.result_json IS NULL) OR
                    (o.state = 'returned' AND o.is_error = 1 AND json_valid(o.result_json)
                     AND json_extract(o.result_json,'$.role') = 'toolResult'
                     AND json_extract(o.result_json,'$.toolCallId') = o.call_id
                     AND json_extract(o.result_json,'$.toolName') = 'CloudTaskManager'
                     AND json_type(o.result_json,'$.isError') = 'true'
                     AND json_type(o.result_json,'$.details.outcomeUncertain') = 'true'))
                AND original.attempt = l.attempt AND original.generation = l.generation AND original.token = l.token
                AND l.generation < 9007199254740990
                AND NOT EXISTS (SELECT 1 FROM automation_background_operations other WHERE other.execution_id = r.execution_id AND other.call_id != o.call_id AND other.state = 'started')
                AND NOT EXISTS (SELECT 1 FROM automation_background_operations failed WHERE failed.execution_id = r.execution_id AND failed.call_id != o.call_id AND failed.is_error = 1 AND CASE WHEN json_valid(failed.result_json) THEN COALESCE(json_extract(failed.result_json,'$.details.outcomeUncertain'),0) = 1 ELSE 1 END)
                AND NOT EXISTS (SELECT 1 FROM automation_prompt_completion_outbox finished WHERE finished.execution_id = r.execution_id)
                AND (SELECT COUNT(*) FROM automation_background_waits w WHERE w.execution_id = r.execution_id) < 32").map_err(|e|e.to_string())?;
            let mapped=query.query_map(params![expired_at],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?,row.get::<_,String>(3)?,row.get::<_,String>(4)?,row.get::<_,u64>(5)?))).map_err(|e|e.to_string())?;
            mapped.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?
        };
        let mut parked=0;
        for (id,raw,call,arguments,context,generation) in rows {
            if park_cloud_row(&tx,&id,&raw,&call,&arguments,&context,generation)?.is_some() {parked+=1;}
        }
        tx.commit().map_err(|e|e.to_string())?;Ok(parked)
    }

    /// Persist bounded backoff before returning candidates to the network layer.
    pub fn due_background_cloud_launch_recoveries(&self) -> Result<Vec<(String,String,String)>,String> {
        let mut conn=self.lock_conn()?;
        let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let rows={
            let mut query=tx.prepare("SELECT c.execution_id,c.wait_id,c.call_id,c.probes FROM automation_background_cloud_recoveries c JOIN automation_cron_runs r ON r.execution_id = c.execution_id WHERE r.state = 'waiting' AND c.retry_at <= ?1 AND NOT EXISTS (SELECT 1 FROM automation_background_resumptions s WHERE s.wait_id = c.wait_id) ORDER BY c.retry_at,c.execution_id LIMIT 4").map_err(|e|e.to_string())?;
            let mapped=query.query_map(params![db::now_ms()],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?,row.get::<_,u32>(3)?))).map_err(|e|e.to_string())?;
            mapped.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?
        };
        let mut candidates=Vec::new();
        for (id,wait,call,probes) in rows {
            let probes=probes.saturating_add(1).min(32);
            let retry=db::now_ms()+(60_000i64*(1i64<<probes.min(5))).min(1_800_000);
            tx.execute("UPDATE automation_background_cloud_recoveries SET retry_at = ?3, probes = ?4 WHERE execution_id = ?1 AND wait_id = ?2",params![id,wait,retry,probes]).map_err(|e|e.to_string())?;
            tx.execute("UPDATE automation_background_waits SET retry_at = ?2, probes = ?3 WHERE wait_id = ?1",params![wait,retry,probes]).map_err(|e|e.to_string())?;
            candidates.push((id,wait,call));
        }
        tx.commit().map_err(|e|e.to_string())?;Ok(candidates)
    }

    pub fn prepare_waiting_background_cloud_launch(&self,id:&str,wait:&str,call:&str,
        load:impl FnOnce(&Connection,&SubmitBackgroundTaskInput)->Result<(String,Value),String>) -> Result<BackgroundCloudLaunch,String> {
        let conn=self.lock_conn()?;
        let lease=recovery_lease(&conn,id,wait,call)?;
        let settings=Self::verify_background_binding(&conn,id,load)?;
        Self::prepare_cloud_launch_on_connection(&conn,id,call,&lease,false,settings)
    }

    /// Receipt and wake are one transaction. Keep the exact model checkpoint:
    /// its unfinished tool group must consume the native receipt on recovery.
    pub fn acknowledge_waiting_background_cloud_launch(&self,id:&str,wait:&str,call:&str,result:&CloudTaskStartResult,
        load:impl FnOnce(&Connection,&SubmitBackgroundTaskInput)->Result<(String,Value),String>) -> Result<bool,String> {
        let mut conn=self.lock_conn()?;
        let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let lease=recovery_lease(&tx,id,wait,call)?;
        let settings=Self::verify_background_binding(&tx,id,load)?;
        Self::prepare_cloud_launch_on_connection(&tx,id,call,&lease,false,settings)?;
        let receipt=Self::acknowledge_cloud_launch_on_connection(&tx,id,call,&lease,result)?;
        if Self::has_uncertain_operations(&tx,id)? {return Err("Other uncertain effects prevent cloud recovery continuation".into());}
        let changed=wake_cloud_row(&tx,id,wait,call,&receipt)?;
        tx.commit().map_err(|e|e.to_string())?;drop(conn);
        if changed==1 {self.with_notifier(|notifier|notifier.prompt_pending());}Ok(changed==1)
    }

    pub fn record_background_cloud_recovery_observation(&self,id:&str,wait:&str,message:&str) -> Result<(),String> {
        let conn=self.lock_conn()?;
        conn.execute("UPDATE automation_background_cloud_recoveries SET last_error = ?3 WHERE execution_id = ?1 AND wait_id = ?2 AND EXISTS (SELECT 1 FROM automation_cron_runs r WHERE r.execution_id = ?1 AND r.state = 'waiting')",params![id,wait,message.chars().take(512).collect::<String>()]).map_err(|e|e.to_string())?;Ok(())
    }
}
