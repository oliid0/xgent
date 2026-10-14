//! Persist exact outgoing responses before RPC. Native probes read acceptance
//! only; neither a lost ACK nor a process restart sends the response again.
use super::*;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone)]
pub struct BackgroundChildResumeProbe {
    pub execution_id: String,
    pub call_id: String,
    pub peer_id: String,
    pub input: ResumeBackgroundTaskInput,
    pub token: String,
}

// Same identity as backgroundTaskIdentity.ts. The native reservation checks
// it against its own execution/call instead of accepting an arbitrary nonce.
pub(super) fn response_identity(id: &str, call: &str) -> String {
    let identity = serde_json::json!([id,call]).to_string();
    let hash = hex::encode(Sha256::digest(format!("xgent-background:{identity}").as_bytes()));
    format!("{}-{}-8{}-a{}-{}",&hash[..8],&hash[8..12],&hash[13..16],&hash[17..20],&hash[20..32])
}

impl AutomationStore {
    pub fn stage_background_child_resume(&self, id: &str, call: &str, peer: &str,
        input: ResumeBackgroundTaskInput, lease: &BackgroundExecutionLease,
        verify: impl FnOnce(&Connection,&str) -> Result<(),String>,
    ) -> Result<(BackgroundChildResumeProbe,Option<Value>),String> {
        let canonical = |id: &str|Uuid::parse_str(id).is_ok_and(|value|value.to_string()==id);
        if call.is_empty() || call.len()>256 || ![id,peer,&input.request_id,&input.wait_id,&input.resume_id].iter().all(|id|canonical(id))
            || input.response.trim().is_empty() || input.response.len()>32*1024 || input.resume_id!=response_identity(id,call) {
            return Err("Child response requires the exact original execution/call identity and bounded input".into());
        }
        let raw = serde_json::to_string(&input).map_err(|e|e.to_string())?;
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        Self::require_background_execution(&tx,id,Some(lease))?;
        verify(&tx,id)?;
        let original: Option<String> = tx.query_row(
            "SELECT o.arguments_json FROM automation_background_operations o JOIN automation_background_operation_leases l ON l.execution_id = o.execution_id AND l.call_id = o.call_id WHERE o.execution_id = ?1 AND o.call_id = ?2 AND o.tool_name = 'BackgroundTask' AND o.state = 'started' AND l.attempt = ?3 AND l.generation = ?4 AND l.token = ?5",
            params![id,call,lease.attempt,lease.generation,lease.token],|row|row.get(0),
        ).optional().map_err(|e|e.to_string())?;
        let original: Value = serde_json::from_str(&original.ok_or("Child response requires its original live journal intent and lease")?).map_err(|e|e.to_string())?;
        if original["action"]!="resume" || original["request_id"].as_str().map(str::trim)!=Some(input.request_id.as_str())
            || original["peer_id"].as_str().map(str::trim)!=Some(peer) || original["wait_id"]!=input.wait_id || original["response"]!=input.response {
            return Err("Child response changed its original journal input or device".into());
        }
        let existing: Option<(String,String,Option<String>)> = tx.query_row(
            "SELECT peer_id,input_json,receipt_json FROM automation_background_child_resumes WHERE execution_id = ?1 AND call_id = ?2",
            params![id,call],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?)),
        ).optional().map_err(|e|e.to_string())?;
        if let Some((owner,previous,receipt)) = existing {
            if owner!=peer || previous!=raw { return Err("Child response is already reserved for different input or owner".into()); }
            let receipt = receipt.ok_or("Original child response is already reserved; query its acceptance, do not resend")?;
            return Ok((BackgroundChildResumeProbe {execution_id:id.into(),call_id:call.into(),peer_id:peer.into(),input,token:String::new()},Some(serde_json::from_str(&receipt).map_err(|e|e.to_string())?)));
        }
        let child: Option<String> = tx.query_row(
            "SELECT observed_execution_id FROM automation_background_children WHERE execution_id = ?1 AND child_request_id = ?2 AND peer_id = ?3 AND receipt_json IS NOT NULL AND cancel_requested = 0 AND observed_state = 'waiting' AND json_extract(observed_json,'$.waiting.waitId') = ?4 AND issuer_host_id = (SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1')",
            params![id,input.request_id,peer,input.wait_id],|row|row.get(0),
        ).optional().map_err(|e|e.to_string())?;
        let child = child.ok_or("Resume belongs to an actually accepted original child and its observed waiting occurrence")?;
        if !canonical(&child) { return Err("Original child execution identity is invalid".into()); }
        let (count,bytes): (i64,i64) = tx.query_row(
            "SELECT COUNT(*),COALESCE(SUM(LENGTH(CAST(input_json AS BLOB))),0) FROM automation_background_child_resumes WHERE execution_id = ?1",
            params![id],|row|Ok((row.get(0)?,row.get(1)?)),
        ).map_err(|e|e.to_string())?;
        if count>=32 || bytes+raw.len() as i64>1024*1024 { return Err("Retained child response capacity exhausted".into()); }
        let issuer: String = tx.query_row("SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1'",[],|row|row.get(0)).map_err(|e|e.to_string())?;
        let token = Uuid::new_v4().to_string(); let now = db::now_ms();
        tx.execute("INSERT INTO automation_background_child_resumes (execution_id,call_id,peer_id,issuer_host_id,child_execution_id,input_json,issued_at,retry_at,probe_token) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![id,call,peer,issuer,child,raw,now,now+60_000,token]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e|e.to_string())?;
        Ok((BackgroundChildResumeProbe {execution_id:id.into(),call_id:call.into(),peer_id:peer.into(),input,token},None))
    }

    pub fn due_background_child_resumes(&self) -> Result<Vec<BackgroundChildResumeProbe>,String> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let now = db::now_ms();
        let rows = {
            let mut query = tx.prepare("SELECT c.execution_id,c.call_id,c.peer_id,c.input_json,c.probes FROM automation_background_child_resumes c JOIN automation_cron_runs r ON r.execution_id = c.execution_id WHERE c.receipt_json IS NULL AND c.retry_at <= ?1 AND r.state IN ('pending','leased','waiting') AND c.issuer_host_id = (SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1') AND NOT EXISTS (SELECT 1 FROM automation_prompt_completion_outbox finished WHERE finished.execution_id = c.execution_id) ORDER BY c.retry_at,c.execution_id,c.call_id LIMIT 4").map_err(|e|e.to_string())?;
            let rows = query.query_map(params![now],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?,row.get::<_,String>(3)?,row.get::<_,u32>(4)?))).map_err(|e|e.to_string())?;
            rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?
        };
        let mut probes = Vec::new();
        for (id,call,peer,raw,attempts) in rows {
            let token = Uuid::new_v4().to_string(); let attempts = attempts.saturating_add(1).min(32);
            let retry = now+(5_000_i64*(1_i64<<attempts.min(6))).min(300_000);
            tx.execute("UPDATE automation_background_child_resumes SET retry_at = ?3,probes = ?4,probe_token = ?5 WHERE execution_id = ?1 AND call_id = ?2",params![id,call,retry,attempts,token]).map_err(|e|e.to_string())?;
            probes.push(BackgroundChildResumeProbe {execution_id:id,call_id:call,peer_id:peer,input:serde_json::from_str(&raw).map_err(|e|e.to_string())?,token});
        }
        tx.commit().map_err(|e|e.to_string())?;
        Ok(probes)
    }

    pub fn record_background_child_resume_receipt(&self, probe: &BackgroundChildResumeProbe, value: &Value) -> Result<(),String> {
        let raw = serde_json::to_string(value).map_err(|e|e.to_string())?;
        if raw.len()>256*1024 { return Err("Child response receipt exceeds retained bounds".into()); }
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let (peer,input,child,previous): (String,String,String,Option<String>) = tx.query_row(
            "SELECT peer_id,input_json,child_execution_id,receipt_json FROM automation_background_child_resumes WHERE execution_id = ?1 AND call_id = ?2 AND probe_token = ?3 AND issuer_host_id = (SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1')",
            params![probe.execution_id,probe.call_id,probe.token],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?)),
        ).map_err(|e|e.to_string())?;
        let expected: Value = serde_json::from_str(&input).map_err(|e|e.to_string())?;
        if peer!=probe.peer_id || expected!=serde_json::to_value(&probe.input).map_err(|e|e.to_string())?
            || value["version"]!=1 || value["hostId"]!=peer || value["executionId"]!=child || value["input"]!=expected
            || !value["acceptedAt"].as_u64().is_some_and(|time|time<=9_007_199_254_740_991) {
            return Err("Actual child response receipt does not match its reserved owner, execution and exact input".into());
        }
        let raw = serde_json::to_string(&serde_json::json!({"version":1,"hostId":peer,"executionId":child,"input":expected,"acceptedAt":value["acceptedAt"]})).map_err(|e|e.to_string())?;
        if previous.as_ref().is_some_and(|saved|saved!=&raw) { return Err("Child response receipt is immutable".into()); }
        tx.execute("UPDATE automation_background_child_resumes SET receipt_json = COALESCE(receipt_json,?4),last_error = NULL WHERE execution_id = ?1 AND call_id = ?2 AND probe_token = ?3",params![probe.execution_id,probe.call_id,probe.token,raw]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e|e.to_string())
    }

    pub fn record_background_child_resume_error(&self, probe: &BackgroundChildResumeProbe, error: &str) -> Result<(),String> {
        self.lock_conn()?.execute("UPDATE automation_background_child_resumes SET last_error = ?4 WHERE execution_id = ?1 AND call_id = ?2 AND probe_token = ?3 AND receipt_json IS NULL AND issuer_host_id = (SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1')",params![probe.execution_id,probe.call_id,probe.token,error.chars().take(512).collect::<String>()]).map_err(|e|e.to_string())?;
        Ok(())
    }

    pub fn read_background_child_resume_receipt(&self, id: &str, call: &str, lease: &BackgroundExecutionLease) -> Result<Option<Value>,String> {
        let conn = self.lock_conn()?;
        Self::require_background_execution(&conn,id,Some(lease))?;
        let saved: Option<String> = conn.query_row("SELECT receipt_json FROM automation_background_child_resumes WHERE execution_id = ?1 AND call_id = ?2 AND receipt_json IS NOT NULL AND issuer_host_id = (SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1')",params![id,call],|row|row.get(0)).optional().map_err(|e|e.to_string())?;
        saved.map(|raw|serde_json::from_str(&raw).map_err(|e|e.to_string())).transpose()
    }
}
