//! Native outgoing child ownership. Reserve before sending; discover by GET
//! after uncertainty; only an explicit user stop creates cascade intent.
use super::*;
use sha2::{Digest, Sha256};

pub(super) const MAX_CHILDREN: i64 = 16;
pub(super) const MAX_INPUT_BYTES: i64 = 32 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES: usize = 512 * 1024;

fn stage(state: &str) -> i32 { match state { "pending" => 0, "leased" => 1, "waiting" => 2, "done" | "expired" => 3, _ => -1 } }

pub(super) fn validated_child_summaries(value: Option<&Value>) -> Result<Vec<BackgroundChildSummary>, String> {
    let children: Vec<BackgroundChildSummary> = value.map(|value|serde_json::from_value(value.clone()).map_err(|e|e.to_string())).transpose()?.unwrap_or_default();
    if children.len() > MAX_CHILDREN as usize { return Err("Invalid descendant count".into()); }
    let mut calls = std::collections::BTreeSet::new();
    for child in &children {
        let canonical = |id: &str| Uuid::parse_str(id).is_ok_and(|value|value.to_string()==id);
        if child.call_id.is_empty() || child.call_id.len()>256 || !calls.insert(&child.call_id)
            || !canonical(&child.request_id) || !canonical(&child.peer_id)
            || child.state.as_deref().is_some_and(|state|stage(state)<0)
            || (child.accepted != child.state.is_some()) || (child.success && child.state.as_deref()!=Some("done"))
            || (child.terminal_confirmed && !child.state.as_deref().is_some_and(|state|stage(state)==3))
            || (child.cancel_acknowledged && !child.cancel_requested)
            || child.last_error.as_ref().is_some_and(|error|error.chars().count()>512)
            || child.name.as_ref().is_some_and(|name|name.trim().is_empty() || name.len()>256) {
            return Err("Invalid actual child observation summary".into());
        }
    }
    Ok(children)
}

fn child_snapshot_chunk(raw: &str, offset: usize, expected_hash: Option<&str>) -> Result<Value,String> {
    let hash = format!("{:x}",Sha256::digest(raw.as_bytes()));
    if offset>raw.len() || !raw.is_char_boundary(offset) { return Err("Child offset must be an actual UTF-8 byte boundary".into()); }
    if (offset>0 && expected_hash.is_none()) || expected_hash.is_some_and(|expected|expected!=hash) {
        return Err("Child snapshot changed or is unbound; reread from offset zero".into());
    }
    let mut end = offset.saturating_add(8192).min(raw.len());
    while !raw.is_char_boundary(end) { end -= 1; }
    Ok(serde_json::json!({"offset":offset,"totalBytes":raw.len(),"text":&raw[offset..end],"nextOffset":if end<raw.len(){Some(end)}else{None},"snapshotHash":hash}))
}

pub(super) fn confirmed_child_start_receipt(conn: &Connection, id: &str, call: &str) -> Result<Option<Value>, String> {
    let row: Option<(String, String, i64, String)> = conn.query_row(
        "SELECT peer_id,receipt_json,issued_at,action FROM automation_background_child_operations WHERE execution_id = ?1 AND call_id = ?2 AND receipt_json IS NOT NULL AND issuer_host_id = (SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1')",
        params![id, call], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    ).optional().map_err(|e| e.to_string())?;
    row.map(|(peer, raw, time, action)| {
        let saved = serde_json::from_str::<Value>(&raw).map_err(|e|e.to_string())?;
        if action == "resume" {
            let result = serde_json::json!({"peerId":peer,"result":{"status":"response_accepted","receipt":saved}});
            return Ok(serde_json::json!({"role":"toolResult","toolCallId":call,"toolName":"BackgroundTask","isError":false,
                "timestamp":time,"content":[{"type":"text","text":result.to_string()}],"details":{"kind":"background_task","action":"resume","result":result,"reconciledResume":true}}));
        }
        let result = serde_json::json!({"peerId":peer,"result":saved});
        Ok(serde_json::json!({"role":"toolResult","toolCallId":call,"toolName":"BackgroundTask","isError":false,
            "timestamp":time,"content":[{"type":"text","text":result.to_string()}],"details":{"kind":"background_task","result":result,"reconciledChildStart":true}}))
    }).transpose()
}

impl AutomationStore {
    /// The call is bound once. Unknown acceptance never authorizes resubmission.
    pub fn stage_background_child(&self, input: SubmitBackgroundTaskInput, peer: &str, call: &str,
        lease: &BackgroundExecutionLease, verify: impl FnOnce(&Connection, &str) -> Result<(), String>,
    ) -> Result<(String, Option<Value>, SubmitBackgroundTaskInput), String> {
        let mut input = Self::normalize_background_task_input(input)?;
        let delegation = input.delegation.as_ref().ok_or("Missing persisted child parent")?;
        if call.is_empty() || call.len() > 256 || !Uuid::parse_str(peer).is_ok_and(|value|value.to_string()==peer) { return Err("Invalid child call or peer identity".into()); }
        self.require_background_delegation(&input, peer, Some(lease))?;
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let id: String = tx.query_row("SELECT execution_id FROM automation_background_tasks WHERE request_id = ?1",params![delegation.parent_request_id],|r|r.get(0)).map_err(|e|e.to_string())?;
        Self::require_background_execution(&tx, &id, Some(lease))?;
        verify(&tx, &id)?;
        let owns: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM automation_background_operation_leases l JOIN automation_background_operations o ON o.execution_id = l.execution_id AND o.call_id = l.call_id WHERE l.execution_id = ?1 AND l.call_id = ?2 AND l.attempt = ?3 AND l.generation = ?4 AND l.token = ?5 AND o.tool_name = 'BackgroundTask' AND json_extract(o.arguments_json,'$.action') = 'submit')",
            params![id,call,lease.attempt,lease.generation,lease.token],|r|r.get(0),
        ).map_err(|e|e.to_string())?;
        if !owns { return Err("Child submission requires its original journal intent and lease".into()); }
        let intent: String = tx.query_row("SELECT arguments_json FROM automation_background_operations WHERE execution_id = ?1 AND call_id = ?2",params![id,call],|r|r.get(0)).map_err(|e|e.to_string())?;
        let intent: Value = serde_json::from_str(&intent).map_err(|e|e.to_string())?;
        if intent["name"].as_str().map(str::trim)!=Some(input.name.as_str()) || intent["prompt"].as_str().map(str::trim)!=Some(input.prompt.as_str())
            || intent.get("timeout_seconds").map(|v|v.as_u64()).unwrap_or(Some(300))!=Some(input.timeout_seconds)
            || intent["request_id"].as_str().is_some_and(|request|Uuid::parse_str(request.trim()).map(|v|v.to_string()).ok().as_deref()!=Some(input.request_id.as_str()))
            || intent["peer_id"].as_str().is_some_and(|owner|!owner.trim().is_empty() && owner.trim()!=peer) {
            return Err("Child input changed its original journal intent".into());
        }
        let saved: Option<(String,String,Option<String>)> = tx.query_row(
            "SELECT peer_id,input_json,receipt_json FROM automation_background_children WHERE execution_id = ?1 AND call_id = ?2",
            params![id,call],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)),
        ).optional().map_err(|e|e.to_string())?;
        let parent_raw: String = tx.query_row("SELECT input_json FROM automation_background_tasks WHERE execution_id=?1", params![id], |row|row.get(0)).map_err(|e|e.to_string())?;
        let parent: SubmitBackgroundTaskInput = serde_json::from_str(&parent_raw).map_err(|e|e.to_string())?;
        let expected_source = parent.source_context.as_ref().map(|source|source.delegated_snapshot(&input.request_id,&input.prompt,true)).transpose()?;
        if let Some(provided) = &input.source_context {
            let provided = serde_json::to_value(provided).map_err(|e|e.to_string())?;
            if Some(&provided) != expected_source.as_ref().map(serde_json::to_value).transpose().map_err(|e|e.to_string())?.as_ref()
                && Some(&provided) != parent.source_context.as_ref().map(serde_json::to_value).transpose().map_err(|e|e.to_string())?.as_ref() {
                return Err("Child source differs from its immutable parent and accepted brief".into());
            }
        }
        // Native ownership supplies the origin snapshot, not model arguments.
        // Existing children keep their original protocol/input on upgrades.
        input.source_context = match &saved {
            Some((_, original, _)) => serde_json::from_str::<SubmitBackgroundTaskInput>(original).map_err(|e|e.to_string())?.source_context,
            None => expected_source,
        };
        let raw = serde_json::to_string(&input).map_err(|e|e.to_string())?;
        if let Some((owner, original, receipt)) = saved {
            if owner != peer || original != raw { return Err("Child call is already bound to different input or device".into()); }
            let receipt = receipt.ok_or("Child was already reserved; acceptance is unknown. Query the original child; do not resend")?;
            return Ok((id, Some(serde_json::from_str(&receipt).map_err(|e|e.to_string())?), input));
        }
        let (count, bytes): (i64,i64) = tx.query_row(
            "SELECT COUNT(*),COALESCE(SUM(LENGTH(CAST(input_json AS BLOB))),0) FROM automation_background_children WHERE execution_id = ?1",
            params![id],|r|Ok((r.get(0)?,r.get(1)?)),
        ).map_err(|e|e.to_string())?;
        if count >= MAX_CHILDREN || bytes + raw.len() as i64 > MAX_INPUT_BYTES { return Err("Persistent child admission capacity exhausted".into()); }
        let issuer: String = tx.query_row("SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1'",[],|r|r.get(0)).map_err(|e|e.to_string())?;
        let now = db::now_ms();
        Self::reserve_background_child_budget(&tx, &id, call, peer, &input, &intent)?;
        tx.execute(
            "INSERT INTO automation_background_children (execution_id,call_id,child_request_id,peer_id,issuer_host_id,input_json,issued_at,retry_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?7)",
            params![id,call,input.request_id,peer,issuer,raw,now],
        ).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e|e.to_string())?;
        Ok((id,None,input))
    }

    pub(super) fn enqueue_background_child_cancellations(conn: &Connection, id: &str, now: i64) -> Result<(),String> {
        conn.execute(
            "UPDATE automation_background_children SET cancel_requested = 1,retry_at = CASE WHEN cancel_requested = 0 THEN ?2 ELSE retry_at END WHERE execution_id = ?1",
            params![id,now],
        ).map_err(|e|e.to_string())?;
        Ok(())
    }

    pub fn request_background_child_cancellation(&self, id: &str) -> Result<(),String> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        Self::enqueue_background_child_cancellations(&tx,id,db::now_ms())?;
        tx.commit().map_err(|e|e.to_string())
    }

    /// Claim fences and retry times commit before network; no WebView timer.
    pub fn due_background_children(&self) -> Result<Vec<BackgroundChildProbe>,String> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let now = db::now_ms();
        let rows = {
            let mut query = tx.prepare(
                "SELECT execution_id,call_id,child_request_id,peer_id,cancel_requested,cancel_acknowledged,probes FROM automation_background_children WHERE retry_at <= ?1 AND (terminal_confirmed = 0 OR (cancel_requested = 1 AND cancel_acknowledged = 0)) AND issuer_host_id = (SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1') ORDER BY retry_at,execution_id,call_id LIMIT 4",
            ).map_err(|e|e.to_string())?;
            let mapped = query.query_map(params![now],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,bool>(4)?,r.get::<_,bool>(5)?,r.get::<_,u32>(6)?))).map_err(|e|e.to_string())?;
            mapped.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?
        };
        let mut due = Vec::new();
        for (id,call,request,peer,cancel,ack,probes) in rows {
            let token = Uuid::new_v4().to_string(); let probes = probes.saturating_add(1).min(32);
            let retry = now + (5_000_i64 * (1_i64 << probes.min(6))).min(300_000);
            tx.execute("UPDATE automation_background_children SET retry_at = ?3,probes = ?4,probe_token = ?5 WHERE execution_id = ?1 AND call_id = ?2",params![id,call,retry,probes,token]).map_err(|e|e.to_string())?;
            due.push(BackgroundChildProbe {execution_id:id,call_id:call,request_id:request,peer_id:peer,token,cancel_requested:cancel,cancel_acknowledged:ack});
        }
        tx.commit().map_err(|e|e.to_string())?;
        Ok(due)
    }

    pub fn record_background_child_observation(&self, id: &str, call: &str, probe: Option<&str>, value: &Value, cancel_response: bool) -> Result<(),String> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        Self::record_background_child_observation_on_connection(&tx, id, call, probe, value, cancel_response)?;
        tx.commit().map_err(|e|e.to_string())
    }

    pub(super) fn record_background_child_observation_on_connection(tx: &Connection, id: &str, call: &str, probe: Option<&str>, value: &Value, cancel_response: bool) -> Result<(),String> {
        let raw = serde_json::to_string(value).map_err(|e|e.to_string())?;
        if raw.len() > MAX_SNAPSHOT_BYTES { return Err("Child result exceeds retained snapshot bounds".into()); }
        let (peer,input,execution,revision,state,token,issuer): (String,String,Option<String>,u64,Option<String>,Option<String>,String) = tx.query_row(
            "SELECT peer_id,input_json,observed_execution_id,observed_revision,observed_state,probe_token,issuer_host_id FROM automation_background_children WHERE execution_id = ?1 AND call_id = ?2",
            params![id,call],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?)),
        ).map_err(|e|e.to_string())?;
        let current: String = tx.query_row("SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1'",[],|r|r.get(0)).map_err(|e|e.to_string())?;
        if current != issuer || probe.is_some_and(|probe|token.as_deref()!=Some(probe)) { return Err("Child observation owner or probe was superseded".into()); }
        let input: SubmitBackgroundTaskInput = serde_json::from_str(&input).map_err(|e|e.to_string())?;
        let run = &value["run"]; let run_id = run["id"].as_str().ok_or("Missing child execution")?;
        let next_state = run["state"].as_str().ok_or("Missing child state")?;
        let next_revision = value["checkpointRevision"].as_u64().filter(|n|*n<=9_007_199_254_740_990).ok_or("Invalid child revision")?;
        let success = run["success"].as_bool().ok_or("Missing actual child success")?;
        if value["hostId"] != peer || value["requestId"] != input.request_id || value["name"] != input.name || value["workdir"] != input.workdir
            || value["delegation"] != serde_json::to_value(&input.delegation).map_err(|e|e.to_string())?
            || Uuid::parse_str(run_id).is_err() || run["taskId"] != run_id || execution.as_deref().is_some_and(|previous|previous!=run_id)
            || !matches!(next_state,"pending"|"leased"|"waiting"|"done"|"expired") || (next_state!="done" && success)
            || (success && value["outcomes"]["verified"] != true) { return Err("Child result does not match the original device, input, execution and actual outcome".into()); }
        if next_revision < revision || (next_revision==revision && state.as_deref().is_some_and(|previous|stage(previous)>stage(next_state)))
            || state.as_deref().is_some_and(|previous|stage(previous)==3 && previous!=next_state) { return Ok(()); }
        // Only a real native parking occurrence can trigger supervision. A
        // changed output/checkpoint or failed network probe is not a wake.
        if next_state == "waiting" && !value["waiting"]["waitId"].as_str()
            .is_some_and(|id|Uuid::parse_str(id).is_ok_and(|uuid|uuid.to_string()==id)) {
            return Err("Waiting child omitted its actual native parking occurrence".into());
        }
        let in_flight = value["operations"]["inFlight"].as_u64().filter(|n|*n<=1024).ok_or("Invalid child operation count")?;
        let cloud_pending = value.get("cloudCancellation").map(|v|v["pending"].as_u64().filter(|n|*n<=1024).ok_or("Invalid child cloud cancellation count")).transpose()?.unwrap_or(0);
        let descendants = value.get("children").ok_or("Child host omitted its required persistent descendant observations")?;
        let descendants_done = validated_child_summaries(Some(descendants))?.iter().all(|child|child.terminal_confirmed && (!child.cancel_requested || child.cancel_acknowledged));
        let terminal = matches!(next_state,"done"|"expired") && in_flight==0 && cloud_pending==0 && descendants_done;
        tx.execute(
            "UPDATE automation_background_children SET receipt_json = COALESCE(receipt_json,?3),observed_json = ?3,observed_execution_id = ?4,observed_revision = ?5,observed_state = ?6,observed_success = ?7,terminal_confirmed = ?8,cancel_acknowledged = CASE WHEN ?9 = 1 AND cancel_requested = 1 THEN 1 ELSE cancel_acknowledged END,last_error = NULL,probes = 0,retry_at = ?10 WHERE execution_id = ?1 AND call_id = ?2",
            params![id,call,raw,run_id,next_revision as i64,next_state,success,terminal,cancel_response,db::now_ms()+30_000],
        ).map_err(|e|e.to_string())?;
        if terminal {Self::settle_background_child_budget(tx,id,call,run_id,value)?;}
        Ok(())
    }

    pub fn record_background_child_error(&self, id: &str, call: &str, probe: Option<&str>, message: &str) -> Result<(),String> {
        self.lock_conn()?.execute(
            "UPDATE automation_background_children SET last_error = ?3 WHERE execution_id = ?1 AND call_id = ?2 AND (?4 IS NULL OR probe_token = ?4) AND issuer_host_id = (SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1')",
            params![id,call,message.chars().take(512).collect::<String>(),probe],
        ).map_err(|e|e.to_string())?;
        Ok(())
    }

    pub(super) fn background_children_summary(conn: &Connection, id: &str) -> Result<Vec<BackgroundChildSummary>,String> {
        let mut query = conn.prepare("SELECT call_id,child_request_id,peer_id,receipt_json IS NOT NULL,observed_state,observed_success,terminal_confirmed,cancel_requested,cancel_acknowledged,last_error,json_extract(input_json, '$.name') AS name FROM automation_background_children WHERE execution_id = ?1 ORDER BY issued_at,call_id LIMIT 16").map_err(|e|e.to_string())?;
        let mapped = query.query_map(params![id],|r|Ok(BackgroundChildSummary {call_id:r.get(0)?,request_id:r.get(1)?,peer_id:r.get(2)?,accepted:r.get(3)?,state:r.get(4)?,success:r.get(5)?,terminal_confirmed:r.get(6)?,cancel_requested:r.get(7)?,cancel_acknowledged:r.get(8)?,last_error:r.get(9)?,name:r.get(10)?})).map_err(|e|e.to_string())?;
        mapped.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())
    }

    pub fn read_background_children(&self, request: &str, call: Option<&str>, offset: usize, hash: Option<&str>) -> Result<Value,String> {
        let parent = self.background_task(request)?;
        let Some(call) = call else {
            if offset!=0 || hash.is_some() { return Err("Child snapshot chunks require an actual call ID".into()); }
            return Ok(serde_json::json!({"requestId":request,"hostId":parent.host_id,"children":parent.children}));
        };
        let child = parent.children.iter().find(|child|child.call_id==call).ok_or("Unknown original child call")?;
        let conn = self.lock_conn()?;
        let raw: Option<String> = conn.query_row("SELECT observed_json FROM automation_background_children WHERE execution_id = ?1 AND call_id = ?2",params![parent.run.id,call],|r|r.get(0)).map_err(|e|e.to_string())?;
        Ok(serde_json::json!({"requestId":request,"hostId":parent.host_id,"child":child,"available":raw.is_some(),"snapshot":raw.map(|raw|child_snapshot_chunk(&raw,offset,hash)).transpose()?}))
    }

    pub fn record_background_child_wait(&self,id:&str,branch:&str,call:&str,reason:&str,lease:&BackgroundExecutionLease,
        verify:impl FnOnce(&Connection,&str)->Result<(),String>) -> Result<BackgroundOutcomeReport,String> {
        if call.is_empty() || call.len()>256 || reason.trim().is_empty() || reason.len()>512 { return Err("Child wait requires an actual call ID and bounded reason".into()); }
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        Self::require_background_execution(&tx,id,Some(lease))?;
        if confirmed_child_start_receipt(&tx,id,call)?.is_none() { return Err("Child wait requires an actually acknowledged original child".into()); }
        let previous: Option<(String,bool)> = tx.query_row("SELECT call_id,wake_consumed FROM automation_background_child_waits WHERE execution_id = ?1 AND branch_id = ?2",params![id,branch],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e|e.to_string())?;
        let consumed = previous.is_some_and(|(previous,consumed)|previous==call && consumed);
        Self::record_background_outcome_on_connection(&tx,&RecordBackgroundOutcomeInput {execution_id:id.into(),lease:Some(lease.clone()),branch_id:branch.into(),evidence:None,waiting_reason:Some(reason.trim().into()),waiting_tool:None,waiting_inventory:None},verify)?;
        tx.execute("INSERT INTO automation_background_child_waits (execution_id,branch_id,call_id,wake_consumed) VALUES (?1,?2,?3,?4) ON CONFLICT(execution_id,branch_id) DO UPDATE SET wake_consumed = excluded.wake_consumed,call_id = excluded.call_id",params![id,branch,call,consumed]).map_err(|e|e.to_string())?;
        let report = Self::background_outcome_report(&tx,id)?.ok_or("Child wait lost its outcome plan")?;
        tx.commit().map_err(|e|e.to_string())?;
        Ok(report)
    }

    /// Supervise each actual child parking occurrence once, then join its
    /// terminal receipt once. Consumption and retained-context wake commit
    /// together; neither polling nor a restart spends new model turns.
    pub fn resume_ready_background_children(&self, load:impl Fn(&Connection,&SubmitBackgroundTaskInput)->Result<(String,Value),String>) -> Result<usize,String> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let ids = {
            let mut query = tx.prepare("SELECT DISTINCT c.execution_id FROM automation_background_children c JOIN automation_cron_runs r ON r.execution_id=c.execution_id
                WHERE r.state='waiting' AND c.issuer_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1') AND (
                  EXISTS(SELECT 1 FROM automation_background_child_waits w JOIN automation_background_outcomes o ON o.execution_id=w.execution_id AND o.branch_id=w.branch_id WHERE w.execution_id=c.execution_id AND w.call_id=c.call_id AND w.retry_at<=?1 AND o.state='waiting' AND ((w.wake_consumed=0 AND c.terminal_confirmed=1 AND (c.cancel_requested=0 OR c.cancel_acknowledged=1)) OR (c.observed_state='waiting' AND c.cancel_requested=0 AND json_type(c.observed_json,'$.waiting.waitId')='text' AND LENGTH(json_extract(c.observed_json,'$.waiting.waitId'))=36 AND NOT EXISTS(SELECT 1 FROM automation_background_child_wait_events e WHERE e.execution_id=c.execution_id AND e.call_id=c.call_id AND e.wait_id=json_extract(c.observed_json,'$.waiting.waitId')))))
                  OR EXISTS(SELECT 1 FROM automation_background_task_joins j JOIN automation_background_waits b ON b.execution_id=j.execution_id AND b.wait_id=j.wait_id WHERE j.execution_id=c.execution_id AND j.call_id=c.call_id AND j.kind='child' AND j.retry_at<=?1 AND NOT EXISTS(SELECT 1 FROM automation_background_resumptions s WHERE s.wait_id=b.wait_id) AND ((j.wake_consumed=0 AND c.terminal_confirmed=1 AND (c.cancel_requested=0 OR c.cancel_acknowledged=1)) OR (c.observed_state='waiting' AND c.cancel_requested=0 AND json_type(c.observed_json,'$.waiting.waitId')='text' AND LENGTH(json_extract(c.observed_json,'$.waiting.waitId'))=36 AND NOT EXISTS(SELECT 1 FROM automation_background_child_wait_events e WHERE e.execution_id=c.execution_id AND e.call_id=c.call_id AND e.wait_id=json_extract(c.observed_json,'$.waiting.waitId')))))
                ) ORDER BY c.retry_at,c.execution_id LIMIT 4").map_err(|e|e.to_string())?;
            let rows = query.query_map(params![db::now_ms()],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())?;
            rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?
        };
        let mut resumed = 0;
        for id in ids {
            if Self::verify_background_binding(&tx,&id,|conn,input|load(conn,input)).is_err() || Self::has_uncertain_operations(&tx,&id)? {
                tx.execute("UPDATE automation_background_child_waits SET retry_at = ?2 WHERE execution_id = ?1",params![id,db::now_ms()+60_000]).map_err(|e|e.to_string())?;
                tx.execute("UPDATE automation_background_task_joins SET retry_at=?2 WHERE execution_id=?1 AND kind='child'",params![id,db::now_ms()+60_000]).map_err(|e|e.to_string())?;
                continue;
            }
            let wait = Self::background_wait_record(&tx,&id)?.ok_or("Child join lost its parked occurrence")?;
            let request: String = tx.query_row("SELECT request_id FROM automation_background_tasks WHERE execution_id = ?1",params![id],|r|r.get(0)).map_err(|e|e.to_string())?;
            Self::resume_wait_on_connection(&tx,&id,&ResumeBackgroundTaskInput {request_id:request,wait_id:wait.wait_id,resume_id:Uuid::new_v4().to_string(),response:"Native authenticated child observations contain a newly parked child or a settled terminal receipt. Continue the SAME retained task. Read BackgroundTask action=children for CURRENT actual child outcomes, waiting occurrence/reasons and files. For a blocked child, supply only information established by the original request or verified evidence through BackgroundTask action=resume with its original peerId, requestId and CURRENT waiting.waitId; missing user input or permission must remain waiting. Do not invent credentials, approvals or completion. If you cannot resolve the blocker, record the same child wait and stop normally; this occurrence will not wake you again. Other children and independent branches continue. For terminal children inspect/download required deliverables and verify original criteria. Do not resubmit a child or repeat completed writes.".into()})?;
            tx.execute("INSERT OR IGNORE INTO automation_background_child_wait_events (execution_id,call_id,wait_id,consumed_at) SELECT DISTINCT c.execution_id,c.call_id,json_extract(c.observed_json,'$.waiting.waitId'),?2 FROM automation_background_child_waits w JOIN automation_background_children c ON c.execution_id = w.execution_id AND c.call_id = w.call_id JOIN automation_background_outcomes o ON o.execution_id = w.execution_id AND o.branch_id = w.branch_id WHERE w.execution_id = ?1 AND o.state = 'waiting' AND c.observed_state = 'waiting' AND c.cancel_requested = 0 AND c.issuer_host_id = (SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1') AND json_type(c.observed_json,'$.waiting.waitId') = 'text' AND LENGTH(json_extract(c.observed_json,'$.waiting.waitId')) = 36",params![id,db::now_ms()]).map_err(|e|e.to_string())?;
            tx.execute("UPDATE automation_background_child_waits SET wake_consumed = 1 WHERE execution_id = ?1 AND call_id IN (SELECT call_id FROM automation_background_children WHERE execution_id = ?1 AND terminal_confirmed = 1)",params![id]).map_err(|e|e.to_string())?;
            resumed += 1;
        }
        tx.commit().map_err(|e|e.to_string())?;
        if resumed>0 { self.with_notifier(|notifier|notifier.prompt_pending()); }
        Ok(resumed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn input(name: &str) -> SubmitBackgroundTaskInput {
        SubmitBackgroundTaskInput { intelligent_scheduling_enabled: false, request_id:Uuid::new_v4().to_string(),name:name.into(),prompt:format!("Create {name}"),provider_id:"fixture".into(),model:"fixture".into(),workdir:std::env::temp_dir().to_string_lossy().into_owned(),timeout_seconds:300,reasoning:"medium".into(),files:vec![],delegation:None,requirements:None,source_context:None,goal_binding:None }
    }

    #[test]
    fn delegated_budget_is_reserved_with_original_child_and_accepted_without_a_fresh_root_limit() {
        let parent = AutomationStore::open_in_memory().unwrap();
        let mut root = input("Parent"); root.intelligent_scheduling_enabled = true;
        let task = parent.submit_background_task(root).unwrap();
        let lease = parent.claim_prompt_runs().unwrap().remove(0).lease.unwrap();
        let remote = AutomationStore::open_in_memory().unwrap();
        let peer = remote.background_worker_identity().unwrap();
        let mut child = input("Child"); child.intelligent_scheduling_enabled = true;
        child.delegation = Some(BackgroundDelegation {
            root_request_id:task.request_id.clone(),parent_request_id:task.request_id.clone(),ancestor_host_ids:vec![task.host_id.clone()],
            budget:Some(BackgroundDelegationBudget {version:1,max_model_requests:8,max_tool_calls:12,deadline_at:None}),
        });
        let mut missing = child.clone(); missing.delegation.as_mut().unwrap().budget = None;
        assert!(remote.submit_background_task(missing).unwrap_err().contains("no fresh root budget"));
        let mut disabled = child.clone(); disabled.intelligent_scheduling_enabled = false;
        assert!(remote.submit_background_task(disabled).is_err());
        parent.begin_background_operation(BeginBackgroundOperationInput {
            execution_id:task.run.id.clone(),lease:Some(lease.clone()),call_id:"allocated-child".into(),tool_name:"BackgroundTask".into(),
            arguments:json!({"action":"submit","name":child.name,"prompt":child.prompt,"peer_id":peer,"delegation_budget":{"max_model_requests":8,"max_tool_calls":12}}),
        }).unwrap();
        let mut changed = child.clone(); changed.delegation.as_mut().unwrap().budget.as_mut().unwrap().max_model_requests = 9;
        assert!(parent.stage_background_child(changed,&peer,"allocated-child",&lease,|_,_|Ok(())).is_err());
        assert!(parent.stage_background_child(child.clone(),&peer,"allocated-child",&lease,|_,_|Ok(())).unwrap().1.is_none());
        let saved = parent.background_budget(&task.run.id,&lease,|_|Ok(()),None).unwrap().budget;
        assert_eq!(saved.model_requests.reserved,8); assert_eq!(saved.tool_calls.reserved,12);
        assert!(parent.stage_background_child(child.clone(),&peer,"allocated-child",&lease,|_,_|Ok(())).unwrap_err().contains("do not resend"));
        let accepted = remote.submit_background_task(child.clone()).unwrap();
        assert_eq!(remote.submit_background_task(child).unwrap().run.id,accepted.run.id);
        let child_lease = remote.claim_prompt_runs().unwrap().remove(0).lease.unwrap();
        let actual = remote.background_budget(&accepted.run.id,&child_lease,|_|Ok(()),None).unwrap().budget;
        assert_eq!(actual.model_requests.limit,8); assert_eq!(actual.tool_calls.limit,12);
        for _ in 0..8 {
            assert!(remote.background_budget(&accepted.run.id,&child_lease,|_|Ok(()),Some(budget::BackgroundBudgetKind::ModelRequests)).unwrap().admitted);
        }
        assert!(!remote.background_budget(&accepted.run.id,&child_lease,|_|Ok(()),Some(budget::BackgroundBudgetKind::ModelRequests)).unwrap().admitted);
        assert_eq!(parent.background_budget(&task.run.id,&lease,|_|Ok(()),None).unwrap().budget.model_requests.reserved,8);
    }

    #[test]
    fn authoritative_child_snapshot_is_the_actual_outbound_input_and_keeps_root_graph_on_parent() {
        let parent=AutomationStore::open_in_memory().unwrap();
        let origin=parent.background_worker_identity().unwrap();
        let mut root=input("Parent");
        root.source_context=Some(serde_json::from_value(json!({"version":2,"requestScope":"original/turn","systemPrompt":"Origin context",
            "originalRequest":"Report and phone calendar","messages":[{"role":"user","content":"Read original documents"}],
            "requestClock":{"timestampMs":1791959400000_i64,"timeZone":"America/Los_Angeles"},
            "routing":{"version":1,"initiatingHostId":origin,"branches":[
                {"id":"report","requirement":"Create report","dependsOn":[],"locality":"portable"},
                {"id":"calendar","requirement":"Original phone calendar","dependsOn":[],"locality":"initiating-device"}]}})).unwrap());
        let original=root.source_context.clone().unwrap();
        let task=parent.submit_background_task(root).unwrap();
        let lease=parent.claim_prompt_runs().unwrap().remove(0).lease.unwrap();
        parent.save_background_plan(SaveBackgroundPlanInput {execution_id:task.run.id.clone(),lease:Some(lease.clone()),plan:BackgroundTaskPlan {version:1,branches:vec![
            BackgroundBranch {id:"report".into(),title:"Report".into(),requirement:"Create report".into(),depends_on:vec![],criteria:vec![BackgroundCriterion::Answer]},
            BackgroundBranch {id:"calendar".into(),title:"Calendar".into(),requirement:"Original phone calendar".into(),depends_on:vec![],criteria:vec![BackgroundCriterion::Unavailable {capability:"Original phone".into()}]},
        ]}},|_,_|Ok(())).unwrap();
        let remote=AutomationStore::open_in_memory().unwrap();let peer=remote.background_worker_identity().unwrap();
        let mut child=input("Slides");child.source_context=Some(original.clone());
        child.delegation=Some(BackgroundDelegation {root_request_id:task.request_id.clone(),parent_request_id:task.request_id.clone(),ancestor_host_ids:vec![task.host_id.clone()],budget:None});
        parent.begin_background_operation(BeginBackgroundOperationInput {execution_id:task.run.id.clone(),lease:Some(lease.clone()),call_id:"scoped-child".into(),tool_name:"BackgroundTask".into(),arguments:json!({"action":"submit","name":child.name,"prompt":child.prompt,"peer_id":peer})}).unwrap();
        let mut changed=child.clone();changed.source_context.as_mut().unwrap().request_clock.as_mut().unwrap().time_zone=Some("Asia/Tokyo".into());
        assert!(parent.stage_background_child(changed,&peer,"scoped-child",&lease,|_,_|Ok(())).unwrap_err().contains("Child source differs"));
        let (_,cached,outbound)=parent.stage_background_child(child,&peer,"scoped-child",&lease,|_,_|Ok(())).unwrap();assert!(cached.is_none());
        let source=outbound.source_context.as_ref().unwrap();assert!(source.routing.is_none());
        assert_eq!(source.original_request.as_deref(),Some(outbound.prompt.as_str()));
        assert_eq!(source.request_clock.as_ref().unwrap().time_zone.as_deref(),Some("America/Los_Angeles"));
        assert_eq!(serde_json::to_value(parent.load_background_source_context(&task.run.id,Some(&lease)).unwrap().unwrap()).unwrap(),serde_json::to_value(original).unwrap());
        let accepted=remote.submit_background_task(outbound.clone()).unwrap();
        let child_lease=remote.claim_prompt_runs().unwrap().remove(0).lease.unwrap();
        assert_eq!(serde_json::to_value(remote.load_background_source_context(&accepted.run.id,Some(&child_lease)).unwrap().unwrap()).unwrap(),serde_json::to_value(outbound.source_context.unwrap()).unwrap());
    }

    #[test]
    fn actual_child_admission_observation_join_and_cancel_keep_original_ownership() {
        let parent = AutomationStore::open_in_memory().unwrap();
        let task = parent.submit_background_task(input("Parent")).unwrap();
        let lease = parent.claim_prompt_runs().unwrap().remove(0).lease.unwrap();
        parent.save_background_plan(SaveBackgroundPlanInput {execution_id:task.run.id.clone(),lease:Some(lease.clone()),plan:BackgroundTaskPlan {version:1,branches:vec![BackgroundBranch {id:"report".into(),title:"Report".into(),requirement:"Actual report".into(),depends_on:vec![],criteria:vec![BackgroundCriterion::Answer]}]}},|_,_|Ok(())).unwrap();
        let remote = AutomationStore::open_in_memory().unwrap();
        let peer = remote.background_worker_identity().unwrap();
        let mut child = input("Child");
        child.delegation = Some(BackgroundDelegation {root_request_id:task.request_id.clone(),parent_request_id:task.request_id.clone(),ancestor_host_ids:vec![task.host_id.clone()],budget:None});
        let intent = BeginBackgroundOperationInput {execution_id:task.run.id.clone(),lease:Some(lease.clone()),call_id:"child-submit".into(),tool_name:"BackgroundTask".into(),arguments:json!({"action":"submit","name":child.name,"prompt":child.prompt,"peer_id":peer})};
        parent.begin_background_operation(intent.clone()).unwrap();
        assert!(parent.stage_background_child(child.clone(),&peer,"invented",&lease,|_,_|Ok(())).is_err());
        let mut changed = child.clone(); changed.prompt = "Unjournaled action".into();
        assert!(parent.stage_background_child(changed,&peer,"child-submit",&lease,|_,_|Ok(())).is_err());
        assert!(parent.stage_background_child(child.clone(),&peer,"child-submit",&lease,|_,_|Ok(())).unwrap().1.is_none());
        assert!(parent.stage_background_child(child.clone(),&peer,"child-submit",&lease,|_,_|Ok(())).unwrap_err().contains("do not resend"));
        let accepted = remote.submit_background_task(child.clone()).unwrap();
        let actual = serde_json::to_value(&accepted).unwrap();
        let mut foreign = actual.clone(); foreign["hostId"] = json!(Uuid::new_v4().to_string());
        assert!(parent.record_background_child_observation(&task.run.id,"child-submit",None,&foreign,false).is_err());
        parent.record_background_child_observation(&task.run.id,"child-submit",None,&actual,false).unwrap();
        assert_eq!(parent.begin_background_operation(intent).unwrap().status,"returned");
        assert_eq!(parent.stage_background_child(child,&peer,"child-submit",&lease,|_,_|Ok(())).unwrap().1,Some(actual.clone()));
        parent.save_background_checkpoint(SaveBackgroundCheckpointInput {execution_id:task.run.id.clone(),lease:Some(lease.clone()),revision:1,context:json!({"systemPrompt":"Accepted task","messages":[]})}).unwrap();
        parent.record_background_child_wait(&task.run.id,"report","child-submit","Actual child pending",&lease,|_,_|Ok(())).unwrap();
        parent.wait_background_task(WaitBackgroundTaskInput {execution_id:task.run.id.clone(),lease:lease.clone(),duration_ms:1,output:"Waiting for child".into(),known_tools:vec![],budget_deferral_id:None}).unwrap().unwrap();
        let load = |_:&Connection,_:&SubmitBackgroundTaskInput|Ok(("test-binding".into(),json!({})));
        assert_eq!(parent.resume_ready_background_children(load).unwrap(),0);
        let child_lease = remote.claim_prompt_runs().unwrap().remove(0).lease.unwrap();
        remote.complete_prompt_run(CompletePromptRunInput {execution_id:accepted.run.id,lease:Some(child_lease),success:false,duration_ms:1,output:"Actual failed attempt".into()}).unwrap();
        let done = serde_json::to_value(remote.background_task(&accepted.request_id).unwrap()).unwrap();
        parent.record_background_child_observation(&task.run.id,"child-submit",None,&done,false).unwrap();
        // A delayed admission ACK cannot regress the actual terminal receipt.
        parent.record_background_child_observation(&task.run.id,"child-submit",None,&actual,false).unwrap();
        assert_eq!(parent.background_task(&task.request_id).unwrap().children[0].state.as_deref(),Some("done"));
        assert_eq!(parent.resume_ready_background_children(load).unwrap(),1);
        assert_eq!(parent.resume_ready_background_children(load).unwrap(),0);
        assert!(!parent.background_task(&task.request_id).unwrap().outcomes.unwrap().verified);
        parent.cancel_background_task(&task.request_id).unwrap();
        let stopped = parent.background_task(&task.request_id).unwrap();
        assert!(stopped.children[0].cancel_requested); assert!(!stopped.children[0].cancel_acknowledged);
        parent.record_background_child_observation(&task.run.id,"child-submit",None,&done,true).unwrap();
        assert!(parent.background_task(&task.request_id).unwrap().children[0].cancel_acknowledged);
    }

    #[test]
    fn actual_snapshot_chunks_are_utf8_bounded_and_hash_bound() {
        let raw = "文档".repeat(5000);
        let first = child_snapshot_chunk(&raw,0,None).unwrap();
        let hash = first["snapshotHash"].as_str().unwrap();
        let offset = first["nextOffset"].as_u64().unwrap() as usize;
        assert!(first["text"].as_str().unwrap().len()<=8192);
        assert!(child_snapshot_chunk(&raw,1,None).is_err());
        assert!(child_snapshot_chunk(&raw,offset,None).is_err());
        assert!(child_snapshot_chunk(&(raw.clone()+"changed"),offset,Some(hash)).is_err());
        let mut reconstructed = first["text"].as_str().unwrap().to_string();
        let mut next = Some(offset);
        while let Some(offset) = next {
            let chunk = child_snapshot_chunk(&raw,offset,Some(hash)).unwrap();
            reconstructed.push_str(chunk["text"].as_str().unwrap());
            next = chunk["nextOffset"].as_u64().map(|offset|offset as usize);
        }
        assert_eq!(reconstructed,raw);
        assert!(validated_child_summaries(Some(&json!([{"terminalConfirmed":true}]))).is_err());
        assert!(validated_child_summaries(None).unwrap().is_empty());
    }
}
