use std::fs::File;
use super::*;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct VideoInput {
    pub provider_id: String, pub model: String, pub prompt: String, pub path: String,
    pub duration: Option<u32>, pub resolution: Option<String>, pub aspect_ratio: Option<String>,
}
pub(crate) struct VideoLaunch {
    pub nonce: String, pub receipt: Option<Value>,
}
pub(crate) struct VideoProbe {
    pub execution: String, pub call: String, pub job: String, pub nonce: String,
    pub input: VideoInput, pub provider: Value,
}

/// Only an implemented protocol, on the originally bound account.
pub(crate) fn video_account(settings:&Value, id:&str, model:Option<&str>) -> Result<Value,String> {
    if settings["intelligentSchedulingEnabled"]!=true {return Err("Video execution requires accepted intelligent scheduling".into());}
    let matches:Vec<_>=settings["delegationProviders"].as_array().into_iter().flatten().filter(|p|p["id"]==id).collect();
    if matches.len()!=1 {return Err("Video account is absent or ambiguous in the accepted configuration".into());}
    let provider=matches[0];
    let url=reqwest::Url::parse(provider["baseUrl"].as_str().unwrap_or("")).map_err(|_|"Invalid video account URL")?;
    // Dedicated media endpoints do not depend on the account's chat API mode.
    if provider["type"]!="codex" || !matches!(provider["requestFormat"].as_str(),None|Some("openai-completions"|"openai-responses")) || provider["authMode"]=="oauth-managed"
        || provider["isFullUrl"]==true || provider["apiKey"].as_str().is_none_or(|key|key.trim().is_empty())
        || url.origin().ascii_serialization()!="https://openrouter.ai" || url.path().trim_end_matches('/')!="/api/v1"
        || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err("Video account does not implement canonical OpenRouter API-key authentication".into());
    }
    if let Some(model)=model {
        if !provider["activeModels"].as_array().is_some_and(|ids|ids.iter().any(|id|id==model))
            || !provider["models"].as_array().is_some_and(|models|models.iter().any(|m|m["id"]==model)) {
            return Err("Video model is not active on the original account".into());
        }
    }
    Ok(provider.clone())
}

pub(super) fn video_operation_completed(conn:&Connection,id:&str,call:&str) -> Result<Option<bool>,String> {
    conn.query_row("SELECT j.state='completed' AND j.artifact_id IS NOT NULL AND EXISTS(SELECT 1 FROM automation_background_artifacts a WHERE a.execution_id=j.execution_id AND a.artifact_id=j.artifact_id) FROM automation_video_jobs j WHERE j.execution_id=?1 AND j.call_id=?2",
        params![id,call],|row|row.get(0)).optional().map_err(|e|e.to_string())
}
pub(super) fn unfinished_video_call(conn:&Connection,id:&str) -> Result<Option<String>,String> {
    conn.query_row("SELECT call_id FROM automation_video_jobs WHERE execution_id=?1 AND terminal_at IS NULL ORDER BY created_at,call_id LIMIT 1",
        params![id],|row|row.get(0)).optional().map_err(|e|e.to_string())
}

impl AutomationStore {
    pub(super) fn background_video_summary(conn:&Connection,id:&str)->Result<Vec<BackgroundVideoSummary>,String> {
        let mut stmt=conn.prepare("SELECT call_id,state,artifact_id,error FROM automation_video_jobs WHERE execution_id=?1 AND issuer_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1') ORDER BY created_at,call_id LIMIT 4").map_err(|e|e.to_string())?;
        let rows=stmt.query_map(params![id],|r|Ok(BackgroundVideoSummary {call_id:r.get(0)?,status:r.get(1)?,artifact_id:r.get(2)?,error:r.get(3)?})).map_err(|e|e.to_string())?;
        rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())
    }
    pub(crate) fn record_video_observation_error(&self,id:&str,call:&str,error:&str)->Result<(),String> {
        let conn=self.lock_conn()?;let error=error.chars().take(512).collect::<String>();
        conn.execute("UPDATE automation_video_jobs SET error=?3 WHERE execution_id=?1 AND call_id=?2 AND state IN ('pending','in_progress') AND issuer_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1')",params![id,call,error]).map_err(|e|e.to_string())?;
        Ok(())
    }
    pub(crate) fn stage_video(&self,id:&str,call:&str,lease:&BackgroundExecutionLease,input:VideoInput,
        load:impl FnOnce(&Connection,&SubmitBackgroundTaskInput)->Result<(String,Value),String>) -> Result<VideoLaunch,String> {
        if call.trim().is_empty() || call.len()>256 || input.provider_id.is_empty() || input.provider_id.len()>128 || input.model.is_empty() || input.model.len()>512
            || input.prompt.trim().is_empty() || input.prompt.len()>64000 || !super::child_artifacts::portable_path(&input.path)
            || !input.path.to_ascii_lowercase().ends_with(".mp4") {return Err("Video requires an original account/model, bounded brief and portable .mp4 path".into());}
        let mut conn=self.lock_conn()?;let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let settings=Self::verify_background_configuration(&tx,id,Some(lease),load)?;
        if Self::background_budget_deadline(&tx,id)?.is_some_and(|deadline|deadline<=db::now_ms()) {
            return Err("Shared execution deadline reached before video submission".into());
        }
        video_account(&settings,&input.provider_id,Some(&input.model))?;
        let (raw,result):(String,Option<String>)=tx.query_row("SELECT o.arguments_json,o.result_json FROM automation_background_operations o JOIN automation_background_operation_leases l ON l.execution_id=o.execution_id AND l.call_id=o.call_id WHERE o.execution_id=?1 AND o.call_id=?2 AND o.tool_name='GenerateVideo' AND l.attempt=?3 AND l.generation=?4 AND l.token=?5",
            params![id,call,lease.attempt,lease.generation,lease.token],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|e|e.to_string())?;
        let intended:VideoInput=serde_json::from_str(&raw).map_err(|e|e.to_string())?;
        if serde_json::to_value(intended).map_err(|e|e.to_string())?!=serde_json::to_value(&input).map_err(|e|e.to_string())? {return Err("Video differs from its original journal intent".into());}
        if let Some(result)=result {return Ok(VideoLaunch {nonce:String::new(),receipt:Some(serde_json::from_str(&result).map_err(|e|e.to_string())?)});}
        let exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_video_jobs WHERE execution_id=?1 AND call_id=?2)",params![id,call],|r|r.get(0)).map_err(|e|e.to_string())?;
        if exists {return Err("video_submission_unconfirmed: original submission must not be sent again".into());}
        let count:u32=tx.query_row("SELECT COUNT(*) FROM automation_video_jobs WHERE execution_id=?1",params![id],|r|r.get(0)).map_err(|e|e.to_string())?;
        if count>=4 {return Err("Task video generation limit is four original submissions".into());}
        let nonce=Uuid::new_v4().to_string();let host:String=tx.query_row("SELECT value FROM automation_meta WHERE key='background_worker_id.v1'",[],|r|r.get(0)).map_err(|e|e.to_string())?;
        tx.execute("INSERT INTO automation_video_jobs (execution_id,call_id,input_json,issuer_host_id,nonce,state,retry_at,created_at) VALUES (?1,?2,?3,?4,?5,'issuing',?6,?6)",
            params![id,call,serde_json::to_string(&input).map_err(|e|e.to_string())?,host,nonce,db::now_ms()]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e|e.to_string())?;Ok(VideoLaunch {nonce,receipt:None})
    }

    /// Original POST acknowledgment is valuable after stop; it never reopens work.
    pub(crate) fn acknowledge_video(&self,id:&str,call:&str,nonce:&str,job:&str,status:&str,lease:&BackgroundExecutionLease) -> Result<Value,String> {
        if job.trim().is_empty() || job.len()>256 || job.chars().any(char::is_control) || !["pending","in_progress","completed"].contains(&status) {return Err("Invalid video submission acknowledgment".into());}
        let mut conn=self.lock_conn()?;let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let changed=tx.execute("UPDATE automation_video_jobs SET job_id=?4,state='pending',retry_at=?5 WHERE execution_id=?1 AND call_id=?2 AND nonce=?3 AND state='issuing' AND job_id IS NULL AND issuer_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1')",
            params![id,call,nonce,job,db::now_ms()+30000]).map_err(|e|e.to_string())?;
        if changed!=1 {return Err("Video acknowledgment lost its original submission".into());}
        let receipt=serde_json::json!({"role":"toolResult","toolCallId":call,"toolName":"GenerateVideo","isError":false,"timestamp":db::now_ms(),
            "content":[{"type":"text","text":serde_json::to_string(&serde_json::json!({"callId":call,"jobId":job,"status":"pending"})).map_err(|e|e.to_string())?}],
            "details":{"kind":"video_job","callId":call,"jobId":job,"status":"pending"}});
        Self::complete_background_operation_on_connection(&tx,CompleteBackgroundOperationInput {execution_id:id.into(),call_id:call.into(),lease:Some(lease.clone()),result:receipt.clone()})?;
        tx.commit().map_err(|e|e.to_string())?;Ok(receipt)
    }

    pub(crate) fn due_videos(&self)->Result<Vec<(String,String)>,String> {
        let mut conn=self.lock_conn()?;let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let jobs={let mut stmt=tx.prepare("SELECT j.execution_id,j.call_id FROM automation_video_jobs j JOIN automation_cron_runs r ON r.execution_id=j.execution_id WHERE j.state IN ('pending','in_progress') AND j.job_id IS NOT NULL AND j.retry_at<=?1 AND r.state IN ('pending','leased','waiting') AND j.issuer_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1') ORDER BY j.retry_at,j.created_at LIMIT 4").map_err(|e|e.to_string())?;
            let rows=stmt.query_map(params![db::now_ms()],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(|e|e.to_string())?;
            rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?};
        // Persist fairness before configuration loading or network work. A
        // revoked/failing original account cannot starve later ready jobs.
        for (id,call) in &jobs {tx.execute("UPDATE automation_video_jobs SET retry_at=?3 WHERE execution_id=?1 AND call_id=?2",params![id,call,db::now_ms()+60000]).map_err(|e|e.to_string())?;}
        tx.commit().map_err(|e|e.to_string())?;Ok(jobs)
    }
    pub(crate) fn prepare_video_probe(&self,id:&str,call:&str,load:impl FnOnce(&Connection,&SubmitBackgroundTaskInput)->Result<(String,Value),String>) -> Result<VideoProbe,String> {
        let mut conn=self.lock_conn()?;let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let settings=Self::verify_background_binding(&tx,id,load)?;
        let (raw,job,probes):(String,String,u32)=tx.query_row("SELECT j.input_json,j.job_id,j.probes FROM automation_video_jobs j JOIN automation_cron_runs r ON r.execution_id=j.execution_id WHERE j.execution_id=?1 AND j.call_id=?2 AND j.state IN ('pending','in_progress') AND j.job_id IS NOT NULL AND r.state IN ('pending','leased','waiting') AND j.issuer_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1')",
            params![id,call],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|e|e.to_string())?;
        let input:VideoInput=serde_json::from_str(&raw).map_err(|e|e.to_string())?;let provider=video_account(&settings,&input.provider_id,Some(&input.model))?;
        let nonce=Uuid::new_v4().to_string();let probes=probes.saturating_add(1).min(32);
        tx.execute("UPDATE automation_video_jobs SET nonce=?3,probes=?4,retry_at=?5 WHERE execution_id=?1 AND call_id=?2",params![id,call,nonce,probes,db::now_ms()+(30000i64*(1i64<<probes.min(3))).min(240000)]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e|e.to_string())?;Ok(VideoProbe {execution:id.into(),call:call.into(),job,nonce,input,provider})
    }

    pub(crate) fn finish_video_probe(&self,probe:&VideoProbe,status:&str,error:Option<&str>,file:Option<(&mut File,u64,&str)>,
        load:impl FnOnce(&Connection,&SubmitBackgroundTaskInput)->Result<(String,Value),String>) -> Result<(),String> {
        if !["pending","in_progress","completed","failed","cancelled","expired"].contains(&status) || error.is_some_and(|e|e.len()>2048) {return Err("Invalid bounded video status".into());}
        let mut conn=self.lock_conn()?;let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let settings=Self::verify_background_binding(&tx,&probe.execution,load)?;video_account(&settings,&probe.input.provider_id,Some(&probe.input.model))?;
        let owns:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_video_jobs j JOIN automation_cron_runs r ON r.execution_id=j.execution_id WHERE j.execution_id=?1 AND j.call_id=?2 AND j.nonce=?3 AND j.job_id=?4 AND j.input_json=?5 AND j.state IN ('pending','in_progress') AND r.state IN ('pending','leased','waiting') AND j.issuer_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1'))",
            params![probe.execution,probe.call,probe.nonce,probe.job,serde_json::to_string(&probe.input).map_err(|e|e.to_string())?],|r|r.get(0)).map_err(|e|e.to_string())?;
        if !owns {return Err("Video observation lost original job/probe/authority".into());}
        let artifact=match file {Some((file,bytes,hash)) if status=="completed"=>Some(super::artifact_parts::write_snapshot(&tx,&probe.execution,&probe.input.path,bytes,Some(hash),file)?),
            None if status!="completed"=>None,_=>return Err("Completed video requires actual verified bytes".into())};
        let terminal=["completed","failed","cancelled","expired"].contains(&status);
        tx.execute("UPDATE automation_video_jobs SET state=?3,artifact_id=?4,error=?5,terminal_at=?6,retry_at=?7,probes=?8 WHERE execution_id=?1 AND call_id=?2",
            params![probe.execution,probe.call,status,artifact.as_ref().map(|a|&a.id),error,terminal.then(db::now_ms),db::now_ms()+30000,0]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e|e.to_string())
    }

    pub(crate) fn video_result(&self,id:&str,call:&str,lease:&BackgroundExecutionLease,load:impl FnOnce(&Connection,&SubmitBackgroundTaskInput)->Result<(String,Value),String>) -> Result<Value,String> {
        let conn=self.lock_conn()?;Self::verify_background_configuration(&conn,id,Some(lease),load)?;
        let (job,status,artifact,error):(Option<String>,String,Option<String>,Option<String>)=conn.query_row("SELECT job_id,state,artifact_id,error FROM automation_video_jobs WHERE execution_id=?1 AND call_id=?2 AND issuer_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1')",params![id,call],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(|e|e.to_string())?;
        let artifact=artifact.map(|artifact|conn.query_row("SELECT artifact_id,relative_path,content_hash,bytes FROM automation_background_artifacts WHERE execution_id=?1 AND artifact_id=?2",params![id,artifact],|r|Ok(BackgroundArtifact {id:r.get(0)?,relative_path:r.get(1)?,content_hash:r.get(2)?,bytes:r.get(3)?})).map_err(|e|e.to_string())).transpose()?;
        Ok(serde_json::json!({"callId":call,"jobId":job,"status":status,"artifact":artifact,"error":error}))
    }

    pub(crate) fn record_video_wait(&self,id:&str,branch:&str,call:&str,reason:&str,lease:&BackgroundExecutionLease,verify:impl FnOnce(&Connection,&str)->Result<(),String>) -> Result<BackgroundOutcomeReport,String> {
        if reason.trim().is_empty() || reason.len()>512 {return Err("Video wait requires a bounded reason".into());}
        let mut conn=self.lock_conn()?;let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        Self::require_background_execution(&tx,id,Some(lease))?;
        let accepted:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_video_jobs j JOIN automation_background_operations o ON o.execution_id=j.execution_id AND o.call_id=j.call_id WHERE j.execution_id=?1 AND j.call_id=?2 AND j.job_id IS NOT NULL AND o.state='returned' AND o.is_error=0 AND j.issuer_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1'))",params![id,call],|r|r.get(0)).map_err(|e|e.to_string())?;
        if !accepted {return Err("Video wait requires its original accepted generation call".into());}
        Self::record_background_outcome_on_connection(&tx,&RecordBackgroundOutcomeInput {execution_id:id.into(),lease:Some(lease.clone()),branch_id:branch.into(),evidence:None,waiting_reason:Some(reason.into()),waiting_tool:None,waiting_inventory:None},verify)?;
        let original:Option<String>=tx.query_row("SELECT call_id FROM automation_video_waits WHERE execution_id=?1 AND branch_id=?2",params![id,branch],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
        if let Some(original)=original.filter(|original|original!=call) {
            let failed:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_video_jobs WHERE execution_id=?1 AND call_id=?2 AND state IN ('failed','cancelled','expired') AND terminal_at IS NOT NULL AND issuer_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1'))",params![id,original],|r|r.get(0)).map_err(|e|e.to_string())?;
            if !failed {return Err("Active, unknown or successful video work cannot be replaced by another wait".into());}
            // A new admitted call can recover an authoritative terminal failure;
            // its original receipt is retained and an unknown POST is not replayed.
            tx.execute("UPDATE automation_video_waits SET call_id=?3 WHERE execution_id=?1 AND branch_id=?2 AND call_id=?4",params![id,branch,call,original]).map_err(|e|e.to_string())?;
        }
        tx.execute("INSERT OR IGNORE INTO automation_video_waits VALUES (?1,?2,?3)",params![id,branch,call]).map_err(|e|e.to_string())?;
        let report=Self::background_outcome_report(&tx,id)?.ok_or("Missing video outcome plan")?;tx.commit().map_err(|e|e.to_string())?;Ok(report)
    }

    pub(crate) fn wake_terminal_videos(&self,load:impl Fn(&Connection,&SubmitBackgroundTaskInput)->Result<(String,Value),String>) -> Result<usize,String> {
        let mut conn=self.lock_conn()?;let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let ids={let mut stmt=tx.prepare("SELECT DISTINCT j.execution_id FROM automation_video_jobs j JOIN automation_cron_runs r ON r.execution_id=j.execution_id WHERE j.terminal_at IS NOT NULL AND j.wake_ack=0 AND j.retry_at<=?1 AND r.state='waiting' AND j.issuer_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1') AND (
            EXISTS(SELECT 1 FROM automation_video_waits v JOIN automation_background_outcomes o ON o.execution_id=v.execution_id AND o.branch_id=v.branch_id WHERE v.execution_id=j.execution_id AND v.call_id=j.call_id AND o.state='waiting')
            OR EXISTS(SELECT 1 FROM automation_background_task_joins a JOIN automation_background_waits b ON b.execution_id=a.execution_id AND b.wait_id=a.wait_id WHERE a.execution_id=j.execution_id AND a.call_id=j.call_id AND a.kind='video' AND a.wake_consumed=0 AND NOT EXISTS(SELECT 1 FROM automation_background_resumptions s WHERE s.wait_id=b.wait_id))
            ) ORDER BY j.retry_at,j.terminal_at LIMIT 4").map_err(|e|e.to_string())?;
            let rows=stmt.query_map(params![db::now_ms()],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())?;rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?};
        let mut count=0;
        for id in ids {
            tx.execute("UPDATE automation_video_jobs SET retry_at=?2 WHERE execution_id=?1 AND terminal_at IS NOT NULL AND wake_ack=0",params![id,db::now_ms()+60000]).map_err(|e|e.to_string())?;
            if Self::verify_background_binding(&tx,&id,&load).is_err() {continue;}
            let Some(wait)=Self::background_wait_record(&tx,&id)? else {continue;};
            let request:String=tx.query_row("SELECT request_id FROM automation_background_tasks WHERE execution_id=?1",params![id],|r|r.get(0)).map_err(|e|e.to_string())?;
            Self::resume_wait_on_connection(&tx,&id,&ResumeBackgroundTaskInput {request_id:request,wait_id:wait.wait_id,resume_id:Uuid::new_v4().to_string(),response:"Original video work reached a retained terminal observation. Read VideoJob using the original call ID and inspect the actual artifact or error. Continue this same compound task; do not resubmit an accepted generation or repeat completed independent actions.".into()})?;
            tx.execute("UPDATE automation_video_jobs SET wake_ack=1 WHERE execution_id=?1 AND terminal_at IS NOT NULL",params![id]).map_err(|e|e.to_string())?;count+=1;
        }
        tx.commit().map_err(|e|e.to_string())?;drop(conn);if count>0 {self.with_notifier(|notifier|notifier.prompt_pending());}Ok(count)
    }
}
