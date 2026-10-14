//! A cloud wait is bound to an actual successful START receipt, never to a
//! model-supplied repository/task ID. GET status does not replay a cloud job.
use super::*;
use crate::services::cloud_execution::{CloudTaskLocator, CloudTaskStatus};

pub(super) fn started_cloud_task(conn: &Connection, id: &str, call_id: &str) -> Result<CloudTaskLocator,String> {
    let stored:Option<(String,String)>=conn.query_row(
        "SELECT arguments_json,result_json FROM automation_background_operations WHERE execution_id = ?1 AND call_id = ?2 AND tool_name = 'CloudTaskManager' AND state = 'returned' AND is_error = 0",
        params![id,call_id],|row|Ok((row.get(0)?,row.get(1)?))).optional().map_err(|e|e.to_string())?;
    let (arguments,receipt)=if let Some(stored)=stored {stored} else {
        let observed=super::cloud_launch::confirmed_late_cloud_start_receipt(conn,id,call_id)?
            .ok_or_else(||"Cloud wait requires this execution's actual successful start call".to_string())?;
        let arguments:String=conn.query_row("SELECT arguments_json FROM automation_background_operations WHERE execution_id = ?1 AND call_id = ?2",params![id,call_id],|row|row.get(0)).map_err(|e|e.to_string())?;
        (arguments,serde_json::to_string(&observed).map_err(|e|e.to_string())?)
    };
    let arguments:Value=serde_json::from_str(&arguments).map_err(|e|e.to_string())?;
    let receipt:Value=serde_json::from_str(&receipt).map_err(|e|e.to_string())?;
    let details=&receipt["details"];
    if arguments["action"]!="start" || receipt["role"]!="toolResult" || receipt["toolCallId"]!=call_id || receipt["toolName"]!="CloudTaskManager" || receipt["isError"]!=false
        || details["kind"]!="cloud_task_manager" || details["action"]!="start" {
        return Err("Only an acknowledged native cloud start receipt can bind a wait".into());
    }
    let text=|key:&str|details[key].as_str().filter(|value|!value.trim().is_empty()).ok_or_else(||format!("Cloud start receipt has no actual {key}"));
    Ok(CloudTaskLocator {
        owner:crate::services::cloud_execution::normalize_owner(text("owner")?)?,
        repository:crate::services::cloud_execution::normalize_repository_name(text("repository")?)?,
        task_id:crate::services::cloud_execution::validate_task_id(text("taskId")?)?,
    })
}

/// A start receipt proves dispatch, not success. Only the native GET/wait
/// collector can retain a terminal observation, bound to that same start.
pub(super) fn cloud_operation_completed(conn:&Connection,id:&str,call:&str) -> Result<Option<bool>,String> {
    let start:bool=conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM automation_background_operations WHERE execution_id=?1 AND call_id=?2 AND tool_name='CloudTaskManager' AND json_valid(arguments_json) AND json_extract(arguments_json,'$.action')='start')",
        params![id,call],|row|row.get(0)).map_err(|e|e.to_string())?;
    if !start {return Ok(None);}
    let cloud=match started_cloud_task(conn,id,call) {Ok(cloud)=>cloud,Err(_)=>return Ok(Some(false))};
    let completed=conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM automation_background_cloud_completions p
         JOIN automation_background_cloud_launches c ON c.execution_id=p.execution_id AND c.call_id=p.call_id AND c.task_id=p.task_id
         WHERE p.execution_id=?1 AND p.call_id=?2 AND p.owner=?3 COLLATE NOCASE AND p.repository=?4 COLLATE NOCASE AND p.task_id=?5 AND p.conclusion='success'
           AND (c.owner='' OR c.owner=p.owner COLLATE NOCASE) AND c.repository=p.repository COLLATE NOCASE
           AND NOT EXISTS(SELECT 1 FROM automation_background_cloud_cancellations cancel WHERE cancel.execution_id=p.execution_id AND cancel.call_id=p.call_id AND cancel.terminal_at IS NULL))",
        params![id,call,cloud.owner,cloud.repository,cloud.task_id],|row|row.get(0)).map_err(|e|e.to_string())?;
    Ok(Some(completed))
}

/// All native-owned cloud effects must settle before the parent finishes,
/// even when an artifact-only branch omitted the start from its evidence.
/// A terminal failure is settled, but never successful operation evidence.
pub(super) fn unfinished_cloud_call(conn:&Connection,id:&str) -> Result<Option<String>,String> {
    conn.query_row(
        "SELECT c.call_id FROM automation_background_cloud_launches c
         WHERE c.execution_id=?1 AND NOT EXISTS(
           SELECT 1 FROM automation_background_cloud_completions p WHERE p.execution_id=c.execution_id AND p.call_id=c.call_id AND p.task_id=c.task_id
             AND (c.owner='' OR c.owner=p.owner COLLATE NOCASE) AND c.repository=p.repository COLLATE NOCASE)
         ORDER BY c.issued_at,c.call_id LIMIT 1",
        params![id],|row|row.get(0)).optional().map_err(|e|e.to_string())
}

impl AutomationStore {
    pub(super) fn background_cloud_wait_calls(conn:&Connection,id:&str) -> Result<Vec<String>,String> {
        let mut query=conn.prepare("WITH calls AS (SELECT DISTINCT c.call_id FROM automation_background_cloud_waits c JOIN automation_background_outcomes o ON o.execution_id = c.execution_id AND o.branch_id = c.branch_id WHERE c.execution_id = ?1 AND o.state = 'waiting'
            AND NOT EXISTS(SELECT 1 FROM automation_background_task_joins j WHERE j.execution_id=c.execution_id AND j.call_id=c.call_id AND j.kind='cloud' AND j.wake_consumed=1)
            UNION SELECT j.call_id FROM automation_background_task_joins j JOIN automation_background_waits b ON b.execution_id=j.execution_id AND b.wait_id=j.wait_id JOIN automation_cron_runs r ON r.execution_id=j.execution_id
            WHERE j.execution_id=?1 AND j.kind='cloud' AND j.wake_consumed=0 AND r.state='waiting' AND NOT EXISTS(SELECT 1 FROM automation_background_resumptions s WHERE s.wait_id=b.wait_id)
            ) SELECT c.call_id FROM calls c LEFT JOIN automation_background_task_joins j ON j.execution_id=?1 AND j.kind='cloud' AND j.call_id=c.call_id ORDER BY COALESCE(j.retry_at,0),c.call_id LIMIT 5").map_err(|e|e.to_string())?;
        let mut calls=query.query_map(params![id],|row|row.get::<_,String>(0)).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
        if calls.len()>4 {
            let parked:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM automation_cron_runs WHERE execution_id=?1 AND state='waiting')",params![id],|row|row.get(0)).map_err(|e|e.to_string())?;
            if !parked {return Err("Cloud waiting receipt capacity was exceeded".into());}
            calls.truncate(4);
        }
        Ok(calls)
    }

    fn background_cloud_call_is_joined(conn:&Connection,id:&str,wait:&str,call:&str) -> Result<bool,String> {
        conn.query_row("SELECT EXISTS(SELECT 1 FROM automation_background_cloud_waits c JOIN automation_background_outcomes o ON o.execution_id=c.execution_id AND o.branch_id=c.branch_id WHERE c.execution_id=?1 AND c.call_id=?3 AND o.state='waiting' AND NOT EXISTS(SELECT 1 FROM automation_background_task_joins j WHERE j.execution_id=c.execution_id AND j.call_id=c.call_id AND j.kind='cloud' AND j.wake_consumed=1))
            OR EXISTS(SELECT 1 FROM automation_background_task_joins j WHERE j.execution_id=?1 AND j.wait_id=?2 AND j.call_id=?3 AND j.kind='cloud' AND j.wake_consumed=0)",params![id,wait,call],|row|row.get(0)).map_err(|e|e.to_string())
    }

    pub fn record_background_cloud_wait(&self,id:&str,branch:&str,call_id:&str,reason:&str,lease:&BackgroundExecutionLease,
        verify:impl FnOnce(&Connection,&str)->Result<(),String>) -> Result<BackgroundOutcomeReport,String> {
        if reason.trim().is_empty() || reason.len()>512 || call_id.trim().is_empty() || call_id.len()>256 {return Err("Cloud wait requires a bounded actual call ID and reason".into());}
        let mut conn=self.lock_conn()?;
        let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        Self::require_background_execution(&tx,id,Some(lease))?;
        let cloud=started_cloud_task(&tx,id,call_id)?;
        let retained:Option<String>=tx.query_row("SELECT evidence_json FROM automation_background_outcomes WHERE execution_id=?1 AND branch_id=?2",
            params![id,branch],|row|row.get::<_,Option<String>>(0)).optional().map_err(|e|e.to_string())?.flatten();
        let input=RecordBackgroundOutcomeInput {execution_id:id.into(),lease:Some(lease.clone()),branch_id:branch.into(),evidence:None,
            waiting_reason:Some(format!("{}; awaiting actual GitHub Actions task {}/{}/{} (start call {call_id})",reason.trim(),cloud.owner,cloud.repository,cloud.task_id)),waiting_tool:None,waiting_inventory:None};
        Self::record_background_outcome_on_connection(&tx,&input,verify)?;
        if let Some(raw)=retained {
            // Park without discarding actual work that the model already
            // proved. It remains evidence, not automatic completion.
            tx.execute("UPDATE automation_background_outcomes SET evidence_json=?3 WHERE execution_id=?1 AND branch_id=?2 AND state='waiting'",params![id,branch,raw]).map_err(|e|e.to_string())?;
        }
        let calls=Self::background_cloud_wait_calls(&tx,id)?;
        if calls.len()>=4 && !calls.iter().any(|call|call==call_id) {return Err("At most four acknowledged cloud jobs may be awaited per task".into());}
        tx.execute("INSERT INTO automation_background_cloud_waits (execution_id,branch_id,call_id) VALUES (?1,?2,?3) ON CONFLICT(execution_id,branch_id) DO UPDATE SET call_id = excluded.call_id",params![id,branch,call_id]).map_err(|e|e.to_string())?;
        let report=Self::background_outcome_report(&tx,id)?.ok_or("Cloud wait lost the original outcome plan")?;
        tx.commit().map_err(|e|e.to_string())?;
        Ok(report)
    }

    /// Final task/configuration checks are repeated after the network read.
    /// The retained native vault and accepted owner/repository supply access.
    pub fn waiting_background_cloud_task(&self,id:&str,wait_id:&str,call_id:&str,
        load:impl FnOnce(&Connection,&SubmitBackgroundTaskInput)->Result<(String,Value),String>) -> Result<CloudTaskLocator,String> {
        let conn=self.lock_conn()?;
        let wait=super::waiting::require_wait(&conn,id,wait_id)?;
        if !Self::background_cloud_call_is_joined(&conn,id,&wait.wait_id,call_id)? {return Err("Cloud call does not belong to the current waiting occurrence".into());}
        let settings=Self::verify_background_binding(&conn,id,load)?;
        if settings["access"]["cloudExecutionEnabled"]!=true {return Err("Cloud execution was disabled".into());}
        let cloud=started_cloud_task(&conn,id,call_id)?;
        conn.execute("UPDATE automation_background_task_joins SET retry_at=?4 WHERE execution_id=?1 AND wait_id=?2 AND kind='cloud' AND call_id=?3 AND wake_consumed=0",params![id,wait_id,call_id,db::now_ms()]).map_err(|e|e.to_string())?;
        Ok(cloud)
    }

    pub fn wake_completed_background_cloud_task(&self,id:&str,wait_id:&str,call_id:&str,status:&CloudTaskStatus,
        load:impl FnOnce(&Connection,&SubmitBackgroundTaskInput)->Result<(String,Value),String>) -> Result<bool,String> {
        let mut conn=self.lock_conn()?;
        let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let wait=super::waiting::require_wait(&tx,id,wait_id)?;
        if !Self::background_cloud_call_is_joined(&tx,id,&wait.wait_id,call_id)? {return Err("Cloud completion changed its waiting occurrence/branch".into());}
        let settings=Self::verify_background_binding(&tx,id,load)?;
        if settings["access"]["cloudExecutionEnabled"]!=true {return Err("Cloud execution was disabled before status release".into());}
        let cloud=started_cloud_task(&tx,id,call_id)?;
        if status.task_id!=cloud.task_id {return Err("Cloud status does not match the acknowledged task".into());}
        if status.state!="completed" || status.run_id.is_none_or(|id|id==0 || id>i64::MAX as u64) || status.conclusion.as_deref().is_none_or(|value|value.trim().is_empty() || value.len()>64) {return Ok(false);}
        let request_id:String=tx.query_row("SELECT request_id FROM automation_background_tasks WHERE execution_id = ?1",params![id],|row|row.get(0)).map_err(|e|e.to_string())?;
        let observed=serde_json::to_string(status).map_err(|e|e.to_string())?;
        if observed.len()>8192 {return Err("Cloud terminal status exceeds its checkpoint bound".into());}
        let owned:Option<(String,String,String,Option<u64>)>=tx.query_row(
            "SELECT task_id,owner,repository,json_extract(result_json,'$.details.observedRunId') FROM automation_background_cloud_launches WHERE execution_id=?1 AND call_id=?2 AND result_json IS NOT NULL",
            params![id,call_id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).optional().map_err(|e|e.to_string())?;
        let (task,owner,repository,known_run)=owned.ok_or("Cloud completion needs the original native launch reservation; legacy receipts require review")?;
        if task!=cloud.task_id || (!owner.is_empty() && !owner.eq_ignore_ascii_case(&cloud.owner)) || !repository.eq_ignore_ascii_case(&cloud.repository)
            || known_run.is_some_and(|run|Some(run)!=status.run_id) {return Err("Cloud terminal observation changed the original namespace/task/run".into());}
        let prior:Option<(String,String,String,u64,String)>=tx.query_row(
            "SELECT owner,repository,task_id,run_id,conclusion FROM automation_background_cloud_completions WHERE execution_id=?1 AND call_id=?2",
            params![id,call_id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?))).optional().map_err(|e|e.to_string())?;
        if let Some((owner,repository,task,run,conclusion))=prior {
            if !owner.eq_ignore_ascii_case(&cloud.owner) || !repository.eq_ignore_ascii_case(&cloud.repository) || task!=status.task_id || Some(run)!=status.run_id || Some(conclusion.as_str())!=status.conclusion.as_deref() {
                return Err("Original cloud terminal observation is immutable; inspect changed runs before recovery".into());
            }
        } else {
            tx.execute("INSERT INTO automation_background_cloud_completions (execution_id,call_id,owner,repository,task_id,run_id,conclusion,status_json,observed_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![id,call_id,cloud.owner,cloud.repository,cloud.task_id,status.run_id.map(|run|run as i64),status.conclusion,observed,db::now_ms()]).map_err(|e|e.to_string())?;
        }
        Self::resume_wait_on_connection(&tx,id,&ResumeBackgroundTaskInput {
            request_id,wait_id:wait_id.into(),resume_id:Uuid::new_v4().to_string(),
            response:format!("Native GitHub GET observed the acknowledged cloud job {}/{}/{} from start call {call_id}: {observed}. This is job state, NOT proof of requested deliverables. Continue the SAME task and retained original work. For success, download and inspect actual artifacts and publish the requested files; for failure/cancellation/timeout, inspect actual logs and decide recovery within existing authority/budgets. Never redispatch the existing cloud start or mark a branch verified from job status alone.",cloud.owner,cloud.repository,cloud.task_id),
        })?;
        tx.commit().map_err(|e|e.to_string())?;drop(conn);
        self.with_notifier(|notifier|notifier.prompt_pending());
        Ok(true)
    }
}
