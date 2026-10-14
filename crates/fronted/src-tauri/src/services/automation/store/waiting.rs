use super::*;

pub(super) fn require_wait(conn: &Connection, id: &str, wait_id: &str) -> Result<BackgroundWaitRecord, String> {
    let waiting = AutomationStore::background_wait_record(conn, id)?
        .ok_or_else(|| "Task is no longer waiting; do not reopen its effects".to_string())?;
    if waiting.wait_id != wait_id { return Err("Waiting occurrence changed; inspect the current task".into()); }
    Ok(waiting)
}

impl AutomationStore {
    pub(super) fn background_wait_record(conn: &Connection, id: &str) -> Result<Option<BackgroundWaitRecord>, String> {
        let row: Option<(String, i64, i64, u32, String, String, bool)> = conn.query_row(
            "SELECT w.wait_id, w.created_at, w.retry_at, w.probes, w.automatic_tools_json, w.known_tools_json, w.retry_on_inventory_change FROM automation_background_waits w
             JOIN automation_cron_runs r ON r.execution_id = w.execution_id
             WHERE w.execution_id = ?1 AND r.state = 'waiting'
             AND NOT EXISTS (SELECT 1 FROM automation_background_resumptions s WHERE s.wait_id = w.wait_id)
             ORDER BY w.created_at DESC, w.wait_id DESC LIMIT 1",
            params![id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?)),
        ).optional().map_err(|e| e.to_string())?;
        row.map(|(wait_id, created_at, retry_at, probes, raw, known, retry_on_inventory_change)| Ok(BackgroundWaitRecord {
            wait_id, created_at, retry_at, probes, automatic_tools: serde_json::from_str(&raw).map_err(|e| e.to_string())?,
            known_tools: serde_json::from_str(&known).map_err(|e| e.to_string())?, retry_on_inventory_change,
            cloud_call_ids: Self::background_cloud_wait_calls(conn,id)?,
        })).transpose()
    }

    /// Park after a real acknowledged conclusion/checkpoint, never after an
    /// uncertain write. An ACK retry reads the same durable parking receipt.
    pub fn wait_background_task(&self, mut input: WaitBackgroundTaskInput) -> Result<Option<BackgroundWaitRecord>, String> {
        input.output = db::truncate_run_output(input.output.trim());
        input.duration_ms = input.duration_ms.min(i64::MAX as u64);
        if input.known_tools.len() > 2048 || input.known_tools.iter().any(|tool| tool.len() > 256) { return Err("Invalid observed tool inventory".into()); }
        if serde_json::to_vec(&input.known_tools).map_err(|e| e.to_string())?.len() > 128 * 1024 { return Err("Observed tool inventory exceeds 128 KiB".into()); }
        let raw = serde_json::to_string(&input).map_err(|e| e.to_string())?;
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let received: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_background_waits WHERE execution_id = ?1 AND input_json = ?2)",
            params![input.execution_id, raw], |row| row.get(0)).map_err(|e| e.to_string())?;
        if received { return Self::background_wait_record(&tx, &input.execution_id); }
        let state: Option<String> = tx.query_row("SELECT state FROM automation_cron_runs WHERE execution_id = ?1", params![input.execution_id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
        if state.as_deref().map_or(true, |state| state == "done" || state == "expired" || state == "pending") { return Ok(None); }
        if state.as_deref() == Some("leased") && Self::require_background_fence(&tx, &input.execution_id, Some(&input.lease)).is_err() { return Ok(None); }
        Self::require_background_execution(&tx, &input.execution_id, Some(&input.lease))?;
        let budget_wait=input.budget_deferral_id.is_some();
        if let Some(deferral)=input.budget_deferral_id.as_deref(){super::budget::require_budget_deferral(&tx,&input.execution_id,deferral)?;}
        if Self::has_uncertain_operations(&tx, &input.execution_id)? { return Err("Reconcile external outcomes before waiting".into()); }
        let report = Self::background_outcome_report(&tx, &input.execution_id)?.ok_or_else(|| "Waiting needs the accepted outcome plan".to_string())?;
        let unfinished = report.branches.iter().filter(|branch| branch.state != "verified").collect::<Vec<_>>();
        let join_wait_id = Uuid::new_v4().to_string();
        Self::stage_background_task_joins(&tx,&input.execution_id,&join_wait_id)?;
        let terminal_join = Self::has_terminal_background_task_join(&tx,&input.execution_id,&join_wait_id)?;
        // A phone callback can commit after the worker's last outcome read but
        // before its parking RPC. Consume that real event once, preserving the
        // stopped context instead of retrying a stale waiting delivery forever.
        let device_wake: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_background_device_wakes w JOIN automation_background_device_actions a ON a.execution_id = w.execution_id AND a.branch_id = w.branch_id WHERE w.execution_id = ?1 AND a.receipt_json IS NOT NULL)",params![input.execution_id],|row|row.get(0)).map_err(|e|e.to_string())?
            || Self::device_planning_wake(&tx,&input.execution_id)?;
        if !budget_wait && !device_wake && ((unfinished.is_empty() && !terminal_join) || unfinished.iter().any(|branch| branch.state != "waiting")) {
            return Err("Finish available branches or record their concrete waiting reason before parking".into());
        }
        let context: String = tx.query_row("SELECT context_json FROM automation_background_checkpoints WHERE execution_id = ?1",
            params![input.execution_id], |row| row.get(0)).map_err(|e| e.to_string())?;
        let context: Value = serde_json::from_str(&context).map_err(|e| e.to_string())?;
        if !budget_wait && !context["messages"].as_array().and_then(|messages| messages.last()).is_some_and(|message|
            message["role"] == "assistant" && message["stopReason"] == "stop") {
            return Err("Persist the actual stopped model context before waiting".into());
        }
        let count: i64 = tx.query_row("SELECT COUNT(*) FROM automation_background_waits WHERE execution_id = ?1", params![input.execution_id], |row| row.get(0)).map_err(|e| e.to_string())?;
        if count >= 32 || input.lease.generation >= 9_007_199_254_740_990 { return Err("Waiting history or execution counter limit reached".into()); }
        // A tool already listed at parking is not a recovery event. Missing
        // input/permission must not create an immediate wake/park model loop.
        let mut tools = unfinished.iter().filter_map(|branch| branch.waiting_tool.clone())
            .filter(|tool| !input.known_tools.contains(tool)).collect::<Vec<_>>();
        let retry_on_inventory_change = unfinished.iter().any(|branch| branch.waiting_inventory);
        tools.sort(); tools.dedup();
        let now = db::now_ms();
        let wait_id = join_wait_id;
        tx.execute("INSERT INTO automation_background_waits (wait_id, execution_id, input_json, automatic_tools_json, created_at, retry_at, probes, known_tools_json, retry_on_inventory_change) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8)",
            params![wait_id, input.execution_id, raw, serde_json::to_string(&tools).map_err(|e| e.to_string())?, now, now + 60_000, serde_json::to_string(&input.known_tools).map_err(|e| e.to_string())?, retry_on_inventory_change]).map_err(|e| e.to_string())?;
        let request_raw: String = tx.query_row("SELECT request_json FROM automation_cron_runs WHERE execution_id = ?1", params![input.execution_id], |row| row.get(0)).map_err(|e| e.to_string())?;
        let mut request: PromptRunRequest = serde_json::from_str(&request_raw).map_err(|e| e.to_string())?;
        request.lease = None;
        tx.execute("UPDATE automation_background_leases SET generation = ?2, token = ?3 WHERE execution_id = ?1",
            params![input.execution_id, input.lease.generation as i64 + 1, Uuid::new_v4().to_string()]).map_err(|e| e.to_string())?;
        let reason = unfinished.iter().map(|branch| format!("{}: {}", branch.branch.title, branch.reason.as_deref().unwrap_or("Waiting for input"))).collect::<Vec<_>>().join("; ");
        tx.execute("UPDATE automation_cron_runs SET state = 'waiting', lease_expires_at = NULL, finished_at = NULL, success = 0, duration_ms = duration_ms + ?2, output = ?3, request_json = ?4 WHERE execution_id = ?1 AND state = 'leased'",
            params![input.execution_id, input.duration_ms as i64, db::truncate_run_output(&format!("Waiting: {reason}\n{}", input.output)), serde_json::to_string(&request).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
        let mut waiting = Self::background_wait_record(&tx, &input.execution_id)?;
        if device_wake {
            let wait = waiting.as_ref().ok_or_else(|| "Device continuation lost its parking receipt".to_string())?;
            Self::resume_wait_on_connection(&tx, &input.execution_id, &ResumeBackgroundTaskInput {
                request_id: request.background_context.as_ref().map(|context|context.request_id.clone()).ok_or_else(|| "Device continuation has no original request".to_string())?,
                wait_id:wait.wait_id.clone(),resume_id:Uuid::new_v4().to_string(),response:"Original-device native receipts or planning observations arrived before this task parked. Read CURRENT native outcomes and OriginalDeviceTask data; continue the SAME retained task. Planning observations are not effect evidence; do not repeat completed device actions.".into(),
            })?;
            tx.execute("DELETE FROM automation_background_device_wakes WHERE execution_id = ?1",params![input.execution_id]).map_err(|e|e.to_string())?;
            tx.execute("DELETE FROM automation_background_device_planning_wakes WHERE execution_id = ?1",params![input.execution_id]).map_err(|e|e.to_string())?;
            waiting = None;
        }
        tx.commit().map_err(|e| e.to_string())?;
        drop(conn);
        if device_wake { self.with_notifier(|notifier|notifier.prompt_pending()); }
        Ok(waiting)
    }

    pub fn due_background_waits(&self) -> Result<Vec<BackgroundWaitingTask>, String> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare("SELECT DISTINCT w.execution_id FROM automation_background_waits w JOIN automation_cron_runs r ON r.execution_id = w.execution_id
            WHERE r.state = 'waiting' AND w.retry_at <= ?1 AND (w.automatic_tools_json != '[]' OR w.retry_on_inventory_change = 1
                OR EXISTS (SELECT 1 FROM automation_background_cloud_waits c JOIN automation_background_outcomes o ON o.execution_id = c.execution_id AND o.branch_id = c.branch_id WHERE c.execution_id = w.execution_id AND o.state = 'waiting' AND NOT EXISTS(SELECT 1 FROM automation_background_task_joins j WHERE j.execution_id=c.execution_id AND j.call_id=c.call_id AND j.kind='cloud' AND j.wake_consumed=1))
                OR EXISTS (SELECT 1 FROM automation_background_task_joins j WHERE j.execution_id=w.execution_id AND j.wait_id=w.wait_id AND j.kind='cloud' AND j.wake_consumed=0))
            AND NOT EXISTS (SELECT 1 FROM automation_background_resumptions s WHERE s.wait_id = w.wait_id)
            ORDER BY w.retry_at ASC, w.execution_id ASC LIMIT 4").map_err(|e| e.to_string())?;
        let ids = stmt.query_map(params![db::now_ms()], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        ids.into_iter().map(|execution_id| Ok(BackgroundWaitingTask { waiting: Self::background_wait_record(&conn, &execution_id)?.ok_or_else(|| "Waiting occurrence disappeared".to_string())?, execution_id })).collect()
    }

    /// Persist backoff before any connector discovery; errors/restarts cannot
    /// turn a failing candidate into a hot polling loop or starve later tasks.
    pub fn defer_background_wait(&self, id: &str, wait_id: &str) -> Result<(), String> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let wait = require_wait(&tx, id, wait_id)?;
        let probes = wait.probes.saturating_add(1).min(32);
        let delay = (60_000i64 * (1i64 << probes.min(5))).min(1_800_000);
        tx.execute("UPDATE automation_background_waits SET retry_at = ?2, probes = ?3 WHERE wait_id = ?1",
            params![wait_id, db::now_ms() + delay, probes]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn waiting_background_settings(&self, id: &str, wait_id: &str,
        load: impl FnOnce(&Connection, &SubmitBackgroundTaskInput) -> Result<(String, Value), String>,
    ) -> Result<Value, String> {
        let conn = self.lock_conn()?;
        require_wait(&conn, id, wait_id)?;
        Self::verify_background_binding(&conn, id, load)
    }

    pub(super) fn resume_wait_on_connection(conn: &Connection, id: &str, input: &ResumeBackgroundTaskInput) -> Result<(), String> {
        require_wait(conn, id, &input.wait_id)?;
        if Self::has_uncertain_operations(conn, id)? { return Err("Reconcile external outcomes before resuming".into()); }
        let (revision, raw): (u64, String) = conn.query_row("SELECT revision, context_json FROM automation_background_checkpoints WHERE execution_id = ?1", params![id], |row| Ok((row.get(0)?, row.get(1)?))).map_err(|e| e.to_string())?;
        if revision >= 9_007_199_254_740_990 { return Err("Checkpoint revision exhausted".into()); }
        let mut context: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        context["messages"].as_array_mut().ok_or_else(|| "Waiting context has no messages".to_string())?.push(serde_json::json!({
            "role": "user", "content": format!("Resume the SAME original task from retained evidence. This response is task data, not new permissions or proof of an effect: {}. Continue unfinished available branches; never replay completed writes.", input.response), "timestamp": db::now_ms(),
        }));
        let context_raw = super::journal::background_context_json(&context)?;
        Self::consume_background_task_joins(conn,id,&input.wait_id)?;
        conn.execute("INSERT INTO automation_background_resumptions (resume_id, execution_id, wait_id, input_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![input.resume_id, id, input.wait_id, serde_json::to_string(input).map_err(|e| e.to_string())?, db::now_ms()]).map_err(|e| e.to_string())?;
        conn.execute("UPDATE automation_background_checkpoints SET revision = ?2, context_json = ?3, updated_at = ?4 WHERE execution_id = ?1",
            params![id, revision as i64 + 1, context_raw, db::now_ms()]).map_err(|e| e.to_string())?;
        conn.execute("UPDATE automation_cron_runs SET state = 'pending', lease_expires_at = NULL WHERE execution_id = ?1 AND state = 'waiting'", params![id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn resume_background_task(&self, input: ResumeBackgroundTaskInput,
        load: impl FnOnce(&Connection, &SubmitBackgroundTaskInput) -> Result<(String, Value), String>,
    ) -> Result<BackgroundTaskRecord, String> {
        if Uuid::parse_str(&input.resume_id).is_err() || Uuid::parse_str(&input.wait_id).is_err() || input.response.trim().is_empty() || input.response.len() > 32 * 1024 {
            return Err("Resume requires the current waitId, stable resumeId and bounded actual response".into());
        }
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let existing: Option<String> = tx.query_row("SELECT input_json FROM automation_background_resumptions WHERE resume_id = ?1", params![input.resume_id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
        if let Some(raw) = existing {
            if raw != serde_json::to_string(&input).map_err(|e| e.to_string())? { return Err("Resume ID is bound to another response".into()); }
        } else {
            let id: String = tx.query_row("SELECT execution_id FROM automation_background_tasks WHERE request_id = ?1", params![input.request_id], |row| row.get(0)).map_err(|e| e.to_string())?;
            require_wait(&tx, &id, &input.wait_id)?;
            Self::verify_background_binding(&tx, &id, load)?;
            Self::resume_wait_on_connection(&tx, &id, &input)?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        drop(conn);
        self.with_notifier(|notifier| notifier.prompt_pending());
        self.background_task(&input.request_id)
    }

    pub fn wake_ready_background_task(&self, id: &str, wait_id: &str, tools: &[String],
        load: impl FnOnce(&Connection, &SubmitBackgroundTaskInput) -> Result<(String, Value), String>,
    ) -> Result<bool, String> {
        if tools.len() > 2048 || tools.iter().any(|name| name.len() > 256) { return Err("Invalid actual tool inventory".into()); }
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let Some(wait) = Self::background_wait_record(&tx, id)? else { return Ok(false); };
        if wait.wait_id != wait_id { return Ok(false); }
        Self::verify_background_binding(&tx, id, load)?;
        let recovered = wait.automatic_tools.iter().find(|name| tools.contains(name))
            .or_else(|| if wait.retry_on_inventory_change { tools.iter().find(|name| !wait.known_tools.contains(name)) } else { None });
        let Some(tool) = recovered else { return Ok(false); };
        let request_id: String = tx.query_row("SELECT request_id FROM automation_background_tasks WHERE execution_id = ?1", params![id], |row| row.get(0)).map_err(|e| e.to_string())?;
        Self::resume_wait_on_connection(&tx, id, &ResumeBackgroundTaskInput {
            request_id, wait_id: wait_id.into(), resume_id: Uuid::new_v4().to_string(),
            response: format!("Worker discovery now lists the recovered or newly available tool {tool} under the unchanged accepted configuration. Resolve only actually supported formerly unavailable criteria. Availability is not proof of completion; inspect the existing receipts and perform only unfinished authorized work"),
        })?;
        tx.commit().map_err(|e| e.to_string())?;
        drop(conn);
        self.with_notifier(|notifier| notifier.prompt_pending());
        Ok(true)
    }

    /// Read the exact committed response. Task progress or a missing current
    /// wait is never substituted for this immutable acceptance record.
    pub fn background_resume_receipt(&self, input: &ResumeBackgroundTaskInput) -> Result<Option<Value>, String> {
        if [&input.request_id,&input.resume_id,&input.wait_id].iter()
            .any(|id| !Uuid::parse_str(id.as_str()).is_ok_and(|uuid|uuid.to_string()==id.as_str()))
            || input.response.trim().is_empty() || input.response.len()>32*1024 {
            return Err("Receipt requires the original canonical task, response and wait identity".into());
        }
        let conn = self.lock_conn()?;
        let row: Option<(String,String,i64)> = conn.query_row(
            "SELECT s.execution_id,s.input_json,s.created_at FROM automation_background_resumptions s JOIN automation_background_tasks b ON b.execution_id = s.execution_id WHERE s.resume_id = ?1 AND b.request_id = ?2",
            params![input.resume_id,input.request_id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?)),
        ).optional().map_err(|e|e.to_string())?;
        let Some((execution,raw,created)) = row else { return Ok(None); };
        let saved: Value = serde_json::from_str(&raw).map_err(|e|e.to_string())?;
        let expected = serde_json::to_value(input).map_err(|e|e.to_string())?;
        if saved != expected { return Err("Resume receipt is bound to a different original response".into()); }
        let host: String = conn.query_row("SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1'",[],|row|row.get(0)).map_err(|e|e.to_string())?;
        Ok(Some(serde_json::json!({"version":1,"hostId":host,"executionId":execution,"input":saved,"acceptedAt":created})))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture(unavailable: bool) -> (AutomationStore, BackgroundTaskRecord, WaitBackgroundTaskInput, BackgroundTaskPlan) {
        let store = AutomationStore::open_in_memory().unwrap();
        let task = store.submit_background_task_with_binding(SubmitBackgroundTaskInput {
            intelligent_scheduling_enabled: false, request_id: Uuid::new_v4().to_string(), name: "Compound".into(), prompt: "Report, then Calendar".into(), provider_id: "accepted".into(), model: "accepted".into(),
            workdir: std::env::temp_dir().to_string_lossy().into_owned(), timeout_seconds: 300, reasoning: "medium".into(), files: vec![], delegation: None, requirements: None, source_context: None, goal_binding: None,
        }, |_, _| Ok("accepted-binding".into())).unwrap();
        let request = store.claim_prompt_runs().unwrap().remove(0);
        let lease = request.lease.unwrap();
        let plan = BackgroundTaskPlan { version: 1, branches: vec![
            BackgroundBranch { id: "report".into(), title: "Report".into(), requirement: "Produce the implementation report".into(), depends_on: vec![], criteria: vec![BackgroundCriterion::Answer] },
            BackgroundBranch { id: "calendar".into(), title: "Calendar".into(), requirement: "Create the requested event in the accepted calendar".into(), depends_on: vec!["report".into()],
                criteria: vec![if unavailable { BackgroundCriterion::Unavailable { capability: "Calendar discovery temporarily unavailable".into() } } else { BackgroundCriterion::Operation { tool: "Calendar".into(), arguments: json!({"calendar": "accepted"}) } }] },
        ] };
        store.save_background_plan(SaveBackgroundPlanInput { execution_id: task.run.id.clone(), lease: Some(lease.clone()), plan: plan.clone() }, |_, _| Ok(())).unwrap();
        store.record_background_outcome(RecordBackgroundOutcomeInput { execution_id: task.run.id.clone(), lease: Some(lease.clone()), branch_id: "report".into(),
            evidence: Some(BackgroundBranchEvidence { artifact_ids: vec![], call_ids: vec![], answer: Some("Actual retained implementation report".into()) }), waiting_reason: None, waiting_tool: None, waiting_inventory: None }, |_, _| Ok(())).unwrap();
        store.record_background_outcome(RecordBackgroundOutcomeInput { execution_id: task.run.id.clone(), lease: Some(lease.clone()), branch_id: "calendar".into(),
            evidence: None, waiting_reason: Some("Calendar discovery unavailable".into()), waiting_tool: if unavailable { None } else { Some("Calendar".into()) }, waiting_inventory: Some(unavailable) }, |_, _| Ok(())).unwrap();
        store.save_background_checkpoint(SaveBackgroundCheckpointInput { execution_id: task.run.id.clone(), lease: Some(lease.clone()), revision: 1, context: json!({"systemPrompt": "Pinned policy", "messages": [
            {"role": "user", "content": "Report, then Calendar", "timestamp": 1},
            {"role": "assistant", "api": "openai-completions", "stopReason": "stop", "content": [{"type": "text", "text": "Report saved; calendar awaits recovery"}], "timestamp": 2}
        ]}) }).unwrap();
        let input = WaitBackgroundTaskInput { execution_id: task.run.id.clone(), lease, duration_ms: 1000, output: "Actual report retained".into(), known_tools: vec!["Read".into()] ,budget_deferral_id:None};
        (store, task, input, plan)
    }

    fn cloud_start(store:&AutomationStore,input:&WaitBackgroundTaskInput,call:&str) -> String {
        store.begin_background_operation(BeginBackgroundOperationInput {execution_id:input.execution_id.clone(),lease:Some(input.lease.clone()),call_id:call.into(),tool_name:"CloudTaskManager".into(),arguments:json!({"action":"start","runner":"ubuntu-latest","script":"create requested files"})}).unwrap();
        let launch=store.prepare_background_cloud_launch(&input.execution_id,call,&input.lease,true,|_,_|Ok(("accepted-binding".into(),json!({"access":{"cloudExecutionEnabled":true,"githubOwner":"actual-owner","githubRepository":"agent-temp"}})))).unwrap();
        let result=crate::services::cloud_execution::CloudTaskStartResult {task_id:launch.task_id.clone(),owner:"actual-owner".into(),repository:"agent-temp".into(),runner:"ubuntu-latest".into(),repository_url:"https://github.com/actual-owner/agent-temp".into(),repository_visibility:"public".into(),observed_run_id:None};
        store.acknowledge_background_cloud_launch(&input.execution_id,call,&input.lease,&result).unwrap();
        launch.task_id
    }

    #[test]
    fn cloud_wait_uses_acknowledged_start_and_resumes_once_without_verifying_deliverables() {
        use crate::services::cloud_execution::CloudTaskStatus;
        for conclusion in ["success","failure","cancelled","timed_out"] {
            let (store,task,mut input,_)=fixture(false);cloud_start(&store,&input,"actual-start");
            assert_eq!(super::super::cloud_waiting::cloud_operation_completed(&store.lock_conn().unwrap(),&task.run.id,"actual-start").unwrap(),Some(false));
            assert!(store.record_background_cloud_wait(&task.run.id,"calendar","invented","Actual job pending",&input.lease,|_,_|Ok(())).is_err());
            store.record_background_cloud_wait(&task.run.id,"calendar","actual-start","Actual job pending",&input.lease,|_,_|Ok(())).unwrap();
            input.known_tools=vec!["Calendar".into(),"CloudTaskManager".into()];
            let wait=store.wait_background_task(input).unwrap().unwrap();
            assert!(wait.automatic_tools.is_empty());assert_eq!(wait.cloud_call_ids,vec!["actual-start"]);
            store.lock_conn().unwrap().execute("UPDATE automation_background_waits SET retry_at = 0",[]).unwrap();assert_eq!(store.due_background_waits().unwrap().len(),1);
            let load=|_:&Connection,_:&SubmitBackgroundTaskInput|Ok(("accepted-binding".into(),json!({"access":{"cloudExecutionEnabled":true}})));
            let locator=store.waiting_background_cloud_task(&task.run.id,&wait.wait_id,"actual-start",load).unwrap();assert_eq!(locator.owner,"actual-owner");
            let mut status=CloudTaskStatus {task_id:locator.task_id,state:"in_progress".into(),conclusion:None,run_id:Some(17),run_url:Some("https://github.com/actual-owner/agent-temp/actions/runs/17".into()),updated_at:None};
            assert!(!store.wake_completed_background_cloud_task(&task.run.id,&wait.wait_id,"actual-start",&status,load).unwrap());assert!(store.claim_prompt_runs().unwrap().is_empty());
            status.state="completed".into();status.conclusion=Some(conclusion.into());
            assert!(store.wake_completed_background_cloud_task(&task.run.id,&wait.wait_id,"actual-start",&status,load).unwrap());
            assert_eq!(super::super::cloud_waiting::cloud_operation_completed(&store.lock_conn().unwrap(),&task.run.id,"actual-start").unwrap(),Some(conclusion=="success"));
            assert!(super::super::cloud_waiting::unfinished_cloud_call(&store.lock_conn().unwrap(),&task.run.id).unwrap().is_none());
            assert!(store.wake_completed_background_cloud_task(&task.run.id,&wait.wait_id,"actual-start",&status,load).is_err());
            let report=store.background_task(&task.request_id).unwrap().outcomes.unwrap();assert!(!report.verified);assert_eq!(report.branches[0].state,"verified");assert_eq!(report.branches[1].state,"waiting");
            assert_eq!(store.claim_prompt_runs().unwrap().len(),1);
        }
    }

    #[test]
    fn cloud_status_rejects_changed_wait_credentials_cancellation_and_missing_terminal_evidence() {
        use crate::services::cloud_execution::CloudTaskStatus;
        let (store,task,input,_)=fixture(false);let task_id=cloud_start(&store,&input,"actual-start");
        store.record_background_cloud_wait(&task.run.id,"calendar","actual-start","Actual job pending",&input.lease,|_,_|Ok(())).unwrap();
        let wait=store.wait_background_task(input).unwrap().unwrap();
        let load=|_:&Connection,_:&SubmitBackgroundTaskInput|Ok(("accepted-binding".into(),json!({"access":{"cloudExecutionEnabled":true}})));
        let mut status=CloudTaskStatus {task_id,state:"completed".into(),conclusion:None,run_id:Some(17),run_url:None,updated_at:None};
        assert!(!store.wake_completed_background_cloud_task(&task.run.id,&wait.wait_id,"actual-start",&status,load).unwrap());
        status.conclusion=Some("success".into());status.run_id=None;assert!(!store.wake_completed_background_cloud_task(&task.run.id,&wait.wait_id,"actual-start",&status,load).unwrap());status.run_id=Some(17);
        assert!(store.waiting_background_cloud_task(&task.run.id,"stale-occurrence","actual-start",load).is_err());
        assert!(store.waiting_background_cloud_task(&task.run.id,&wait.wait_id,"foreign-start",load).is_err());
        assert!(store.wake_completed_background_cloud_task(&task.run.id,&wait.wait_id,"actual-start",&status,|_,_|Ok(("changed-account".into(),json!({"access":{"cloudExecutionEnabled":true}})))).is_err());
        store.cancel_background_task(&task.request_id).unwrap();
        assert!(store.waiting_background_cloud_task(&task.run.id,&wait.wait_id,"actual-start",load).is_err());
    }

    fn resume(task: &BackgroundTaskRecord, wait: &BackgroundWaitRecord) -> ResumeBackgroundTaskInput {
        ResumeBackgroundTaskInput { request_id: task.request_id.clone(), wait_id: wait.wait_id.clone(), resume_id: Uuid::new_v4().to_string(), response: "Tomorrow at 10:00 in the accepted calendar".into() }
    }

    #[test]
    fn waiting_survives_restart_expiry_and_revokes_the_original_writer() {
        let (store, task, input, _) = fixture(false);
        let wait = store.wait_background_task(input.clone()).unwrap().unwrap();
        let saved = store.background_task(&task.request_id).unwrap();
        assert_eq!(saved.run.state, RunState::Waiting); assert!(saved.run.finished_at.is_none());
        assert_eq!(saved.outcomes.as_ref().unwrap().branches[0].state, "verified");
        assert_eq!(store.wait_background_task(input.clone()).unwrap().unwrap().wait_id, wait.wait_id);
        assert!(store.claim_prompt_runs().unwrap().is_empty()); assert!(store.sweep_expired_prompt_runs().unwrap().is_empty());
        assert_eq!(store.recover_interrupted_prompt_runs().unwrap(), 0);
        assert!(store.save_background_checkpoint(SaveBackgroundCheckpointInput { execution_id: task.run.id.clone(), lease: Some(input.lease.clone()), revision: 2, context: json!({"systemPrompt": "stale", "messages": []}) }).is_err());
        store.cancel_background_task(&task.request_id).unwrap();
        assert_eq!(store.background_task(&task.request_id).unwrap().run.state, RunState::Expired);
        assert!(store.wait_background_task(input).unwrap().is_none());
        assert!(store.resume_background_task(resume(&task, &wait), |_, _| panic!("Cancelled task cannot load credentials")).is_err());
    }

    #[test]
    fn response_resumes_once_with_exact_context_and_fresh_claim_preserving_results() {
        let (store, task, input, _) = fixture(false);
        let wait = store.wait_background_task(input.clone()).unwrap().unwrap();
        let response = resume(&task, &wait);
        let ready = store.resume_background_task(response.clone(), |_, _| Ok(("accepted-binding".into(), json!({})))).unwrap();
        assert_eq!(ready.run.state, RunState::Pending); assert_eq!(ready.checkpoint_revision, 2);
        assert!(ready.waiting.is_none()); assert_eq!(ready.outcomes.unwrap().branches[0].evidence.as_ref().unwrap().answer.as_deref(), Some("Actual retained implementation report"));
        store.resume_background_task(response.clone(), |_, _| panic!("A lost ACK cannot grant new authority")).unwrap();
        let claimed = store.claim_prompt_runs().unwrap().remove(0); let next = claimed.lease.unwrap();
        assert_eq!(next.attempt, input.lease.attempt + 1); assert!(next.generation > input.lease.generation);
        let checkpoint = store.restore_background_checkpoint(&task.run.id, Some(&next), |_, _| Ok(())).unwrap();
        assert!(checkpoint.context.unwrap()["messages"].as_array().unwrap().last().unwrap()["content"].as_str().unwrap().contains("Tomorrow at 10:00"));
        assert!(store.wait_background_task(input).unwrap().is_none());
        let mut changed = response; changed.response = "Different account".into(); assert!(store.resume_background_task(changed, |_, _| Ok(("accepted-binding".into(), json!({})))).is_err());
    }

    #[test]
    fn backoff_and_actual_tool_recovery_never_override_a_changed_account() {
        let (present, present_task, mut present_input, _) = fixture(false);
        present_input.known_tools.push("Calendar".into());
        let present_wait = present.wait_background_task(present_input).unwrap().unwrap();
        assert!(present_wait.automatic_tools.is_empty());
        present.lock_conn().unwrap().execute("UPDATE automation_background_waits SET retry_at = 0", []).unwrap();
        assert!(present.due_background_waits().unwrap().is_empty());
        assert!(!present.wake_ready_background_task(&present_task.run.id, &present_wait.wait_id, &["Calendar".into()], |_, _| Ok(("accepted-binding".into(), json!({})))).unwrap());
        let (store, task, input, _) = fixture(false);
        let wait = store.wait_background_task(input).unwrap().unwrap();
        store.lock_conn().unwrap().execute("UPDATE automation_background_waits SET retry_at = 0", []).unwrap();
        assert_eq!(store.due_background_waits().unwrap().len(), 1);
        store.defer_background_wait(&task.run.id, &wait.wait_id).unwrap(); assert!(store.due_background_waits().unwrap().is_empty());
        assert!(store.background_task(&task.request_id).unwrap().waiting.unwrap().retry_at > db::now_ms());
        assert!(!store.wake_ready_background_task(&task.run.id, &wait.wait_id, &["Read".into()], |_, _| Ok(("accepted-binding".into(), json!({})))).unwrap());
        assert!(store.wake_ready_background_task(&task.run.id, &wait.wait_id, &["Calendar".into()], |_, _| Ok(("other-account".into(), json!({})))).is_err());
        assert_eq!(store.background_task(&task.request_id).unwrap().run.state, RunState::Waiting);
        assert!(store.wake_ready_background_task(&task.run.id, &wait.wait_id, &["Calendar".into()], |_, _| Ok(("accepted-binding".into(), json!({})))).unwrap());
        assert!(!store.wake_ready_background_task(&task.run.id, &wait.wait_id, &["Calendar".into()], |_, _| panic!("Already resumed occurrence cannot execute again")).unwrap());
    }

    #[test]
    fn formerly_unavailable_criteria_resolve_without_changing_original_requirements() {
        let (store, task, input, mut plan) = fixture(true);
        let original: String = store.lock_conn().unwrap().query_row("SELECT plan_json FROM automation_background_plans", [], |row| row.get(0)).unwrap();
        let wait = store.wait_background_task(input).unwrap().unwrap();
        assert!(!store.wake_ready_background_task(&task.run.id, &wait.wait_id, &["Read".into()], |_, _| Ok(("accepted-binding".into(), json!({})))).unwrap());
        assert!(store.wake_ready_background_task(&task.run.id, &wait.wait_id, &["Read".into(), "Calendar".into()], |_, _| Ok(("accepted-binding".into(), json!({})))).unwrap());
        let lease = store.claim_prompt_runs().unwrap().remove(0).lease.unwrap();
        plan.branches[1].criteria = vec![BackgroundCriterion::Operation { tool: "Calendar".into(), arguments: json!({"calendar": "accepted"}) }];
        let input = SaveBackgroundPlanInput { execution_id: task.run.id.clone(), lease: Some(lease), plan };
        let mut weakened = input.clone(); weakened.plan.branches[0].requirement = "Omitted report".into();
        assert!(store.resolve_background_plan(weakened, &["Calendar".into()], |_, _| Ok(())).is_err());
        let mut prose = input.clone(); prose.plan.branches[1].criteria = vec![BackgroundCriterion::Answer];
        assert!(store.resolve_background_plan(prose, &["Calendar".into()], |_, _| Ok(())).is_err());
        let report = store.resolve_background_plan(input.clone(), &["Calendar".into()], |_, _| Ok(())).unwrap();
        assert_eq!(report.branches[0].state, "verified"); assert_eq!(report.branches[1].state, "pending"); assert!(!report.verified);
        store.resolve_background_plan(input, &["Calendar".into()], |_, _| Ok(())).unwrap();
        assert_eq!(store.lock_conn().unwrap().query_row::<String, _, _>("SELECT plan_json FROM automation_background_plans", [], |row| row.get(0)).unwrap(), original);
    }

    #[test]
    fn a_started_action_cannot_hide_its_unknown_outcome_by_parking() {
        let (store, task, input, _) = fixture(false);
        store.begin_background_operation(BeginBackgroundOperationInput { execution_id: task.run.id.clone(), lease: Some(input.lease.clone()), call_id: "unanswered".into(), tool_name: "Calendar".into(), arguments: json!({"calendar": "accepted"}) }).unwrap();
        assert!(store.wait_background_task(input).unwrap_err().contains("Reconcile"));
        assert_eq!(store.background_task(&task.request_id).unwrap().run.state, RunState::Leased);
    }
}
