//! An RPC timeout is not proof of rejection. Park a reserved child submission
//! and resume the same model tail once native observations confirm acceptance.
use super::*;

/// Inspect every unresolved effect before revoking the writer. A sibling is
/// recoverable only under the same native lease, issuer and retained model tail.
fn recoverable_child_group(conn: &Connection, id: &str, context: &Value) -> Result<Option<Vec<String>>, String> {
    let mut query = conn.prepare("SELECT o.call_id,o.arguments_json,CASE WHEN
        o.tool_name = 'BackgroundTask' AND json_valid(o.arguments_json)
        AND json_extract(o.arguments_json,'$.action') = c.action
        AND c.issuer_host_id = (SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1')
        AND original.attempt = l.attempt AND original.generation = l.generation AND original.token = l.token
        AND ((o.state = 'started' AND o.result_json IS NULL) OR
            (o.state = 'returned' AND o.is_error = 1 AND json_valid(o.result_json)
             AND json_extract(o.result_json,'$.role') = 'toolResult'
             AND json_extract(o.result_json,'$.toolCallId') = o.call_id
             AND json_extract(o.result_json,'$.toolName') = 'BackgroundTask'
             AND json_type(o.result_json,'$.isError') = 'true'
             AND json_type(o.result_json,'$.details.outcomeUncertain') = 'true'))
        THEN 1 ELSE 0 END
        FROM automation_background_operations o
        LEFT JOIN automation_background_child_operations c ON c.execution_id = o.execution_id AND c.call_id = o.call_id
        LEFT JOIN automation_background_operation_leases original ON original.execution_id = o.execution_id AND original.call_id = o.call_id
        JOIN automation_background_leases l ON l.execution_id = o.execution_id
        WHERE o.execution_id = ?1 AND (o.state = 'started' OR
            (o.is_error = 1 AND CASE WHEN json_valid(o.result_json) THEN COALESCE(json_extract(o.result_json,'$.details.outcomeUncertain'),0) = 1 ELSE 1 END))
        ORDER BY o.call_id").map_err(|e|e.to_string())?;
    let rows = query.query_map(params![id], |row| Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,bool>(2)?))).map_err(|e|e.to_string())?;
    let mut calls = Vec::new();
    for row in rows {
        let (call,arguments,eligible) = row.map_err(|e|e.to_string())?;
        if !eligible || !has_original_child_tail(context,&call,&arguments) { return Ok(None); }
        calls.push(call);
    }
    // A retained model tail can include submissions and bounded responses.
    Ok((!calls.is_empty() && calls.len() <= 32).then_some(calls))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> (Connection,Value) {
        let conn = Connection::open_in_memory().unwrap();
        db::initialize(&conn).unwrap();
        conn.execute("INSERT INTO automation_meta (key,value) VALUES ('background_worker_id.v1','issuer') ON CONFLICT(key) DO UPDATE SET value = excluded.value",[]).unwrap();
        conn.execute("INSERT INTO automation_background_leases VALUES ('parent',1,1,'original-token')",[]).unwrap();
        let mut calls = Vec::new();
        for call in ["document","slides"] {
            let arguments = json!({"action":"submit","name":call,"prompt":"Create and verify actual deliverables"});
            calls.push(json!({"type":"toolCall","id":call,"name":"BackgroundTask","arguments":arguments}));
            conn.execute("INSERT INTO automation_background_operations (execution_id,call_id,tool_name,arguments_json,context_revision,state,started_at) VALUES ('parent',?1,'BackgroundTask',?2,1,'started',100)",params![call,arguments.to_string()]).unwrap();
            conn.execute("INSERT INTO automation_background_operation_leases VALUES ('parent',?1,1,1,'original-token')",params![call]).unwrap();
            conn.execute("INSERT INTO automation_background_children (execution_id,call_id,child_request_id,peer_id,issuer_host_id,input_json,issued_at,retry_at) VALUES ('parent',?1,?1,?1,'issuer','{}',100,100)",params![call]).unwrap();
        }
        (conn,json!({"systemPrompt":"Original scope","messages":[{"role":"user","content":"Create document and slides","timestamp":1},{"role":"assistant","stopReason":"toolUse","content":calls,"timestamp":2}]}))
    }

    #[test]
    fn actual_group_requires_every_original_tail_and_same_lease_reservation() {
        let (conn,context) = fixture();
        assert_eq!(recoverable_child_group(&conn,"parent",&context).unwrap().unwrap(),vec!["document","slides"]);
        for mutation in [
            "UPDATE automation_background_operation_leases SET token = 'old' WHERE call_id = 'slides'",
            "UPDATE automation_background_children SET issuer_host_id = 'foreign' WHERE call_id = 'slides'",
            "DELETE FROM automation_background_children WHERE call_id = 'slides'",
            "UPDATE automation_background_operations SET tool_name = 'SendMail' WHERE call_id = 'slides'",
        ] {
            conn.execute_batch("SAVEPOINT invalid_member").unwrap();
            conn.execute(mutation,[]).unwrap();
            assert!(recoverable_child_group(&conn,"parent",&context).unwrap().is_none());
            conn.execute_batch("ROLLBACK TO invalid_member; RELEASE invalid_member").unwrap();
        }
    }

    #[test]
    fn changed_missing_duplicate_and_already_delivered_tail_cannot_authorize_group_parking() {
        let (conn,context) = fixture();
        let mut changed = context.clone();
        changed["messages"][1]["content"][1]["arguments"]["prompt"] = json!("Different work");
        let mut missing = context.clone();
        missing["messages"][1]["content"].as_array_mut().unwrap().pop();
        let mut duplicate = context.clone();
        duplicate["messages"][1]["content"].as_array_mut().unwrap().push(context["messages"][1]["content"][1].clone());
        let mut delivered = context.clone();
        delivered["messages"].as_array_mut().unwrap().push(json!({"role":"toolResult","toolCallId":"slides"}));
        for invalid in [changed,missing,duplicate,delivered] {
            assert!(recoverable_child_group(&conn,"parent",&invalid).unwrap().is_none());
        }
    }
}

fn has_original_child_tail(context: &Value, call: &str, arguments: &str) -> bool {
    let Some(messages) = context["messages"].as_array() else { return false; };
    let Some(index) = messages.iter().rposition(|message| message["role"] == "assistant") else { return false; };
    let Ok(original) = serde_json::from_str::<Value>(arguments) else { return false; };
    let assistant = &messages[index];
    assistant["stopReason"] == "toolUse" && matches!(original["action"].as_str(),Some("submit"|"resume"))
        && assistant["content"].as_array().is_some_and(|parts|
            parts.iter().filter(|part| part["type"] == "toolCall" && part["id"] == call).count() == 1
            && parts.iter().any(|part| part["type"] == "toolCall" && part["id"] == call && part["name"] == "BackgroundTask" && part["arguments"] == original))
        && messages[index + 1..].iter().all(|message| message["role"] == "toolResult" && message["toolCallId"] != call)
}

fn park_child_row(tx: &Connection, id: &str, raw: &str, call: &str, arguments: &str, context: &str, generation: u64) -> Result<bool, String> {
    let Ok(mut request) = serde_json::from_str::<PromptRunRequest>(raw) else { return Ok(false); };
    let Ok(context) = serde_json::from_str::<Value>(context) else { return Ok(false); };
    if generation >= 9_007_199_254_740_990 || request.execution_id != id || request.task_id != id
        || super::journal::background_context_json(&context).is_err() || !has_original_child_tail(&context, call, arguments) { return Ok(false); }
    let Some(calls) = recoverable_child_group(tx,id,&context)? else { return Ok(false); };
    if !calls.iter().any(|candidate| candidate == call) { return Ok(false); }
    request.lease = None;
    let wait = Uuid::new_v4().to_string(); let now = db::now_ms();
    let input = serde_json::json!({"kind":"native_child_acceptance_recovery","executionId":id,"callId":call,"callIds":calls});
    tx.execute("INSERT INTO automation_background_waits (wait_id,execution_id,input_json,automatic_tools_json,known_tools_json,retry_on_inventory_change,created_at,retry_at,probes) VALUES (?1,?2,?3,'[]','[]',0,?4,?4,0)",params![wait,id,input.to_string(),now]).map_err(|e|e.to_string())?;
    tx.execute("UPDATE automation_background_leases SET generation = ?2, token = ?3 WHERE execution_id = ?1",params![id,(generation + 1) as i64,Uuid::new_v4().to_string()]).map_err(|e|e.to_string())?;
    let changed = tx.execute("UPDATE automation_cron_runs SET state = 'waiting', lease_expires_at = NULL, request_json = ?2, output = ?3 WHERE execution_id = ?1 AND state = 'leased'",params![id,serde_json::to_string(&request).map_err(|e|e.to_string())?,"Original child acceptance is unconfirmed. Native recovery queries its reserved device; no task is resubmitted."]).map_err(|e|e.to_string())?;
    if changed != 1 { return Err("Child parking lost its original execution".into()); }
    Ok(true)
}

impl AutomationStore {
    /// Only absence of a native reservation permits an ordinary failure
    /// receipt. A previous parking ACK remains valid after wake/cancellation.
    pub fn park_unconfirmed_background_child_start(&self, id: &str, call: &str, lease: &BackgroundExecutionLease,
        load: impl FnOnce(&Connection, &SubmitBackgroundTaskInput) -> Result<(String,Value),String>) -> Result<bool,String> {
        if call.is_empty() || call.len() > 256 { return Err("Child parking requires an actual bounded call ID".into()); }
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let owns: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_background_operation_leases l JOIN automation_background_operations o ON o.execution_id = l.execution_id AND o.call_id = l.call_id WHERE l.execution_id = ?1 AND l.call_id = ?2 AND l.attempt = ?3 AND l.generation = ?4 AND l.token = ?5 AND o.tool_name = 'BackgroundTask' AND json_valid(o.arguments_json) AND json_extract(o.arguments_json,'$.action') IN ('submit','resume'))",params![id,call,lease.attempt,lease.generation,lease.token],|row|row.get(0)).map_err(|e|e.to_string())?;
        if !owns { return Err("Child parking requires its original operation lease".into()); }
        let reserved: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_background_child_operations WHERE execution_id = ?1 AND call_id = ?2)",params![id,call],|row|row.get(0)).map_err(|e|e.to_string())?;
        if !reserved { return Ok(false); }
        let original_host: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_background_child_operations WHERE execution_id = ?1 AND call_id = ?2 AND issuer_host_id = (SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1'))",params![id,call],|row|row.get(0)).map_err(|e|e.to_string())?;
        if !original_host { return Err("Child reservation belongs to another execution host".into()); }
        let parked: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_background_waits WHERE execution_id = ?1 AND json_valid(input_json) AND json_extract(input_json,'$.kind') = 'native_child_acceptance_recovery' AND (json_extract(input_json,'$.callId') = ?2 OR EXISTS (SELECT 1 FROM json_each(input_json,'$.callIds') member WHERE member.value = ?2)))",params![id,call],|row|row.get(0)).map_err(|e|e.to_string())?;
        if parked { return Ok(true); }
        let state: String = tx.query_row("SELECT state FROM automation_cron_runs WHERE execution_id = ?1",params![id],|row|row.get(0)).map_err(|e|e.to_string())?;
        if matches!(state.as_str(),"done"|"expired") { return Ok(true); }
        Self::verify_background_configuration(&tx,id,Some(lease),load)?;
        let (raw,args,context,generation): (String,String,String,u64) = tx.query_row("SELECT r.request_json,o.arguments_json,p.context_json,l.generation FROM automation_cron_runs r JOIN automation_background_operations o ON o.execution_id = r.execution_id AND o.call_id = ?2 JOIN automation_background_checkpoints p ON p.execution_id = r.execution_id JOIN automation_background_leases l ON l.execution_id = r.execution_id WHERE r.execution_id = ?1 AND r.state = 'leased' AND ((o.state = 'started' AND o.result_json IS NULL) OR (o.state = 'returned' AND o.is_error = 1 AND json_valid(o.result_json) AND json_extract(o.result_json,'$.role') = 'toolResult' AND json_extract(o.result_json,'$.toolCallId') = o.call_id AND json_extract(o.result_json,'$.toolName') = 'BackgroundTask' AND json_type(o.result_json,'$.isError') = 'true' AND json_type(o.result_json,'$.details.outcomeUncertain') = 'true')) AND NOT EXISTS (SELECT 1 FROM automation_prompt_completion_outbox finished WHERE finished.execution_id = r.execution_id) AND (SELECT COUNT(*) FROM automation_background_waits w WHERE w.execution_id = r.execution_id) < 32",params![id,call],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).map_err(|e|e.to_string())?;
        if !park_child_row(&tx,id,&raw,call,&args,&context,generation)? { return Err("Child parking requires the original model tail and same-lease reservations for every uncertain effect".into()); }
        tx.commit().map_err(|e|e.to_string())?;
        Ok(true)
    }

    /// Startup runs before a new worker exists. Sweeps require an expired
    /// native lease; a live writer is never parked merely for a slow RPC.
    pub(super) fn park_interrupted_child_submissions(&self) -> Result<usize,String> { self.park_child_submissions(None) }
    pub(super) fn park_expired_child_submissions(&self) -> Result<usize,String> { self.park_child_submissions(Some(db::now_ms())) }

    fn park_child_submissions(&self, expired_at: Option<i64>) -> Result<usize,String> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let rows = {
            let mut query = tx.prepare("SELECT r.execution_id,r.request_json,c.call_id,o.arguments_json,p.context_json,l.generation FROM automation_cron_runs r
                JOIN automation_background_tasks b ON b.execution_id = r.execution_id
                JOIN automation_background_child_operations c ON c.execution_id = r.execution_id
                JOIN automation_background_operations o ON o.execution_id = c.execution_id AND o.call_id = c.call_id
                JOIN automation_background_checkpoints p ON p.execution_id = r.execution_id
                JOIN automation_background_leases l ON l.execution_id = r.execution_id
                JOIN automation_background_operation_leases original ON original.execution_id = c.execution_id AND original.call_id = c.call_id
                WHERE r.state = 'leased' AND r.request_json IS NOT NULL AND o.tool_name = 'BackgroundTask'
                AND json_valid(o.arguments_json) AND json_extract(o.arguments_json,'$.action') = c.action
                AND c.issuer_host_id = (SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1')
                AND (?1 IS NULL OR (r.lease_expires_at IS NOT NULL AND r.lease_expires_at < ?1))
                AND ((o.state = 'started' AND o.result_json IS NULL) OR (o.state = 'returned' AND o.is_error = 1
                    AND json_valid(o.result_json) AND json_extract(o.result_json,'$.role') = 'toolResult'
                    AND json_extract(o.result_json,'$.toolCallId') = o.call_id AND json_extract(o.result_json,'$.toolName') = 'BackgroundTask'
                    AND json_type(o.result_json,'$.isError') = 'true' AND json_type(o.result_json,'$.details.outcomeUncertain') = 'true'))
                AND original.attempt = l.attempt AND original.generation = l.generation AND original.token = l.token
                AND l.generation < 9007199254740990
                AND NOT EXISTS (SELECT 1 FROM automation_prompt_completion_outbox finished WHERE finished.execution_id = r.execution_id)
                AND (SELECT COUNT(*) FROM automation_background_waits w WHERE w.execution_id = r.execution_id) < 32
                ORDER BY r.execution_id,c.call_id").map_err(|e|e.to_string())?;
            let rows = query.query_map(params![expired_at],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?,row.get::<_,String>(3)?,row.get::<_,String>(4)?,row.get::<_,u64>(5)?))).map_err(|e|e.to_string())?;
            rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?
        };
        let mut parked = 0;
        let mut inspected = std::collections::BTreeSet::new();
        for (id,raw,call,args,context,generation) in rows {
            if inspected.insert(id.clone()) && park_child_row(&tx,&id,&raw,&call,&args,&context,generation)? { parked += 1; }
        }
        tx.commit().map_err(|e|e.to_string())?;
        Ok(parked)
    }

    /// Acceptance (including a failed terminal child) resumes the original
    /// parent call. It never verifies parent outcomes or starts a replacement.
    pub fn resume_ready_background_child_starts(&self, load: impl Fn(&Connection,&SubmitBackgroundTaskInput) -> Result<(String,Value),String>) -> Result<usize,String> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let rows = {
            let mut query = tx.prepare("SELECT w.execution_id,w.wait_id,c.call_id FROM automation_background_waits w
                JOIN automation_cron_runs r ON r.execution_id = w.execution_id
                JOIN automation_background_child_operations c ON c.execution_id = w.execution_id AND c.call_id = json_extract(w.input_json,'$.callId')
                JOIN automation_background_operations o ON o.execution_id = c.execution_id AND o.call_id = c.call_id
                WHERE r.state = 'waiting' AND json_valid(w.input_json) AND json_extract(w.input_json,'$.kind') = 'native_child_acceptance_recovery'
                AND w.retry_at <= ?1 AND c.receipt_json IS NOT NULL AND o.tool_name = 'BackgroundTask'
                AND json_valid(o.arguments_json) AND json_extract(o.arguments_json,'$.action') = c.action
                AND c.issuer_host_id = (SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1')
                AND NOT EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(w.input_json,'$.callIds'),json_array(c.call_id))) member
                    LEFT JOIN automation_background_child_operations sibling ON sibling.execution_id = w.execution_id AND sibling.call_id = member.value
                    WHERE member.type != 'text' OR sibling.receipt_json IS NULL
                    OR sibling.issuer_host_id != (SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1'))
                AND NOT EXISTS (SELECT 1 FROM automation_background_resumptions s WHERE s.wait_id = w.wait_id)
                AND NOT EXISTS (SELECT 1 FROM automation_prompt_completion_outbox finished WHERE finished.execution_id = r.execution_id)
                ORDER BY w.retry_at,w.execution_id LIMIT 4").map_err(|e|e.to_string())?;
            let rows = query.query_map(params![db::now_ms()],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?))).map_err(|e|e.to_string())?;
            rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?
        };
        let mut resumed = 0;
        for (id,wait,call) in rows {
            if Self::verify_background_binding(&tx,&id,|conn,input|load(conn,input)).is_err() || Self::has_uncertain_operations(&tx,&id)? {
                tx.execute("UPDATE automation_background_waits SET retry_at = ?3 WHERE execution_id = ?1 AND wait_id = ?2",params![id,wait,db::now_ms() + 60_000]).map_err(|e|e.to_string())?;
                continue;
            }
            super::waiting::require_wait(&tx,&id,&wait)?;
            let receipt = super::children::confirmed_child_start_receipt(&tx,&id,&call)?.ok_or("Child acceptance lost its native receipt")?;
            let child_request = if receipt["details"]["action"] == "resume" {
                receipt["details"]["result"]["result"]["receipt"]["input"]["requestId"].clone()
            } else { receipt["details"]["result"]["result"]["requestId"].clone() };
            let input = serde_json::json!({"kind":"native_child_acceptance_recovered","callId":call,"requestId":child_request});
            tx.execute("INSERT INTO automation_background_resumptions (resume_id,execution_id,wait_id,input_json,created_at) VALUES (?1,?2,?3,?4,?5)",params![Uuid::new_v4().to_string(),id,wait,input.to_string(),db::now_ms()]).map_err(|e|e.to_string())?;
            let changed = tx.execute("UPDATE automation_cron_runs SET state = 'pending', lease_expires_at = NULL WHERE execution_id = ?1 AND state = 'waiting'",params![id]).map_err(|e|e.to_string())?;
            if changed != 1 { return Err("Child acceptance wake lost its parked parent".into()); }
            resumed += 1;
        }
        tx.commit().map_err(|e|e.to_string())?;
        if resumed > 0 { self.with_notifier(|notifier|notifier.prompt_pending()); }
        Ok(resumed)
    }
}
