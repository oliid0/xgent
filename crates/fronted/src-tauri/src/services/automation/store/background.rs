use super::*;

impl AutomationStore {
    pub fn bind_worker_identity(&self, identity: &str) -> Result<(), String> {
        let identity = Uuid::parse_str(identity).map_err(|_| "Invalid worker installation identity".to_string())?.to_string();
        let previous: Option<String> = {
            let conn = self.lock_conn()?;
            conn.query_row("SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1'", [], |row| row.get(0))
                .optional().map_err(|e| e.to_string())?
        };
        if previous.as_deref() != Some(identity.as_str()) {
            // A copied/restored task DB is history, not a transfer of execution
            // ownership. Never start its pending external actions on this host.
            self.expire_prompt_runs_where(
                "state IN ('pending', 'leased', 'waiting') AND execution_id IN (SELECT execution_id FROM automation_background_tasks)",
                &[], "Worker installation identity changed or is unknown; imported unfinished tasks were stopped without replay.",
            )?;
            let conn = self.lock_conn()?;
            conn.execute("INSERT INTO automation_meta (key, value) VALUES ('background_worker_id.v1', ?1)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value", params![identity]).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn background_worker_identity(&self) -> Result<String, String> {
        let conn = self.lock_conn()?;
        let id: String = conn.query_row("SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1'", [], |row| row.get(0))
            .optional().map_err(|e| e.to_string())?.ok_or_else(|| "Worker identity has not been initialized from the device vault".to_string())?;
        Uuid::parse_str(&id).map_err(|_| "Invalid persisted worker identity".to_string())?;
        Ok(id)
    }

    pub fn background_queue_counts(&self) -> Result<(u64, u64), String> {
        let conn = self.lock_conn()?;
        conn.query_row("SELECT COALESCE(SUM(state = 'pending'), 0), COALESCE(SUM(state = 'leased'), 0)
            FROM automation_cron_runs", [], |row| Ok((row.get(0)?, row.get(1)?))).map_err(|e| e.to_string())
    }

    pub fn background_model_queue_counts(&self) -> Result<std::collections::BTreeMap<(String, String), (u64, u64, u64)>, String> {
        let conn = self.lock_conn()?;
        let mut statement = conn.prepare("SELECT json_extract(b.input_json, '$.providerId'), json_extract(b.input_json, '$.model'),
            SUM(r.state = 'pending'), SUM(r.state = 'leased'), SUM(r.state = 'waiting')
            FROM automation_background_tasks b JOIN automation_cron_runs r ON r.execution_id = b.execution_id
            WHERE r.state IN ('pending', 'leased', 'waiting')
            GROUP BY json_extract(b.input_json, '$.providerId'), json_extract(b.input_json, '$.model')").map_err(|e| e.to_string())?;
        let rows = statement.query_map([], |row| Ok(((row.get::<_, String>(0)?, row.get::<_, String>(1)?),
            (row.get::<_, u64>(2)?, row.get::<_, u64>(3)?, row.get::<_, u64>(4)?)))).map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    pub fn normalize_background_task_input(mut input: SubmitBackgroundTaskInput) -> Result<SubmitBackgroundTaskInput, String> {
        input.request_id = Uuid::parse_str(input.request_id.trim())
            .map_err(|_| "Background requestId must be a UUID".to_string())?.to_string();
        input.name = input.name.trim().to_string();
        input.prompt = input.prompt.trim().to_string();
        input.provider_id = input.provider_id.trim().to_string();
        input.model = input.model.trim().to_string();
        input.workdir = input.workdir.trim().to_string();
        if input.name.is_empty() || input.name.len() > 256 || input.prompt.is_empty() || input.prompt.len() > 262_144 {
            return Err("Background task needs a name (up to 256 bytes) and prompt (up to 256 KiB)".to_string());
        }
        if input.provider_id.is_empty() || input.model.is_empty() || input.workdir.is_empty() {
            return Err("Background task requires a model, provider and explicit host workspace".to_string());
        }
        if !(1..=validate::MAX_PROMPT_CRON_TIMEOUT_SECONDS).contains(&input.timeout_seconds)
            || (!input.reasoning.is_empty() && !CRON_REASONING_LEVELS.contains(&input.reasoning.as_str())) {
            return Err("Invalid background task timeout or reasoning level".to_string());
        }
        Self::normalize_background_files(&mut input.files)?;
        if let Some(source) = &input.source_context { source.validate()?; }
        if let Some(goal) = &input.goal_binding { goal.validate()?; }
        if input.intelligent_scheduling_enabled && input.delegation.as_ref().is_some_and(|delegation| delegation.budget.is_none()) {
            return Err("Scheduled device children require a budget allocated by their original parent; no fresh root budget is granted".into());
        }
        if let Some(budget) = input.delegation.as_ref().and_then(|delegation| delegation.budget.as_ref()) {
            budget.validate()?;
            if !input.intelligent_scheduling_enabled { return Err("A delegated budget requires enabled lifetime accounting".into()); }
        }
        if let Some(requirements) = &mut input.requirements { requirements.normalize()?; }
        if let Some(delegation) = &input.delegation {
            Self::validate_background_delegation(delegation, &input.request_id)?;
        }
        Ok(input)
    }

    fn validate_background_delegation(delegation: &BackgroundDelegation, request_id: &str) -> Result<(), String> {
        let canonical_uuid = |id: &str| Uuid::parse_str(id).is_ok_and(|value| value.to_string() == id);
        if !canonical_uuid(&delegation.root_request_id) || !canonical_uuid(&delegation.parent_request_id)
            || delegation.root_request_id == request_id || delegation.parent_request_id == request_id
            || delegation.ancestor_host_ids.is_empty() || delegation.ancestor_host_ids.len() >= MAX_BACKGROUND_HOSTS
            || delegation.ancestor_host_ids.iter().any(|id| !canonical_uuid(id))
            || delegation.ancestor_host_ids.iter().collect::<std::collections::BTreeSet<_>>().len() != delegation.ancestor_host_ids.len() {
            return Err("Invalid or exhausted background delegation chain".to_string());
        }
        Ok(())
    }

    fn background_context(input: &SubmitBackgroundTaskInput, host_id: &str) -> Result<BackgroundTaskContext, String> {
        let (root_request_id, mut host_ids) = match &input.delegation {
            Some(delegation) => {
                Self::validate_background_delegation(delegation, &input.request_id)?;
                (delegation.root_request_id.clone(), delegation.ancestor_host_ids.clone())
            }
            None => (input.request_id.clone(), Vec::new()),
        };
        if host_ids.iter().any(|id| id == host_id) {
            return Err("Background delegation cycle: this host already owns an ancestor task".to_string());
        }
        host_ids.push(host_id.to_string());
        Ok(BackgroundTaskContext { root_request_id, request_id: input.request_id.clone(), host_ids, goal_binding: input.goal_binding.clone() })
    }

    /// Verify a worker's outgoing handoff against its persisted parent, rather
    /// than accepting a caller-supplied chain as permission to use saved peers.
    pub fn require_background_delegation(&self, input: &SubmitBackgroundTaskInput, peer_id: &str, lease: Option<&BackgroundExecutionLease>) -> Result<(), String> {
        let delegation = input.delegation.as_ref().ok_or_else(|| "Background worker handoff requires its persisted parent task".to_string())?;
        Self::validate_background_delegation(delegation, &input.request_id)?;
        if delegation.ancestor_host_ids.iter().any(|id| id == peer_id) {
            return Err("Background delegation cycle: target is an ancestor host".to_string());
        }
        let conn = self.lock_conn()?;
        let (execution_id, input_json): (String, String) = conn.query_row(
            "SELECT execution_id, input_json FROM automation_background_tasks WHERE request_id = ?1",
            params![delegation.parent_request_id], |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(|e| e.to_string())?.ok_or_else(|| "Background delegation parent is not owned by this host".to_string())?;
        Self::require_background_execution(&conn, &execution_id, lease)?;
        let parent: SubmitBackgroundTaskInput = serde_json::from_str(&input_json).map_err(|e| e.to_string())?;
        let host_id: String = conn.query_row("SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1'", [], |row| row.get(0)).map_err(|e| e.to_string())?;
        let context = Self::accepted_background_context(&conn, &execution_id, &parent, &host_id)?;
        if delegation.root_request_id != context.root_request_id || delegation.ancestor_host_ids != context.host_ids {
            return Err("Background delegation chain does not match the persisted parent".to_string());
        }
        Ok(())
    }

    pub(super) fn accepted_background_context(conn: &Connection, id: &str, input: &SubmitBackgroundTaskInput, host: &str) -> Result<BackgroundTaskContext, String> {
        let raw: String = conn.query_row("SELECT request_json FROM automation_cron_runs WHERE execution_id = ?1",params![id],|row|row.get(0)).map_err(|e|e.to_string())?;
        let request: PromptRunRequest = serde_json::from_str(&raw).map_err(|e|e.to_string())?;
        let context = request.background_context.ok_or("Accepted background task has no retained execution context")?;
        if request.execution_id != id || request.task_id != id || request.provider_id != input.provider_id || request.model != input.model
            || request.workdir != input.workdir || context.request_id != input.request_id || context.goal_binding != input.goal_binding
            || !Uuid::parse_str(&context.root_request_id).is_ok_and(|value|value.to_string()==context.root_request_id)
            || context.host_ids.last().map(String::as_str)!=Some(host) || context.host_ids.len()>MAX_BACKGROUND_HOSTS
            || context.host_ids.iter().any(|id|!Uuid::parse_str(id).is_ok_and(|value|value.to_string()==*id))
            || context.host_ids.iter().collect::<std::collections::BTreeSet<_>>().len()!=context.host_ids.len() {
            return Err("Accepted background context differs from its original execution and host".into());
        }
        Ok(context)
    }

    #[cfg(test)]
    pub fn submit_background_task(&self, input: SubmitBackgroundTaskInput) -> Result<BackgroundTaskRecord, String> {
        self.submit_background_task_with_binding(input, |_, _| Ok("test-binding".to_string()))
    }

    /// Capture host-owned settings under the same write transaction as the
    /// queue. A retry never replaces the originally accepted configuration.
    pub fn submit_background_task_with_binding(
        &self, input: SubmitBackgroundTaskInput,
        capture: impl FnOnce(&Connection, &SubmitBackgroundTaskInput) -> Result<String, String>,
    ) -> Result<BackgroundTaskRecord, String> {
        self.submit_background_task_with_device_channel(input, None, capture)
    }

    pub fn submit_background_task_with_device_channel(
        &self, input: SubmitBackgroundTaskInput, channel: Option<&BackgroundDeviceChannelProof>,
        capture: impl FnOnce(&Connection, &SubmitBackgroundTaskInput) -> Result<String, String>,
    ) -> Result<BackgroundTaskRecord, String> {
        let input = Self::normalize_background_task_input(input)?;
        let context = Self::background_context(&input, &self.background_worker_identity()?)?;
        {
            let mut conn = self.lock_conn()?;
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
            Self::accept_background_on_connection(&tx, &input, context, channel,
                input.delegation.as_ref().and_then(|delegation| delegation.budget.as_ref()), capture)?;
            tx.commit().map_err(|e| e.to_string())?;
        }
        self.with_notifier(|notifier| notifier.prompt_pending());
        self.background_task(&input.request_id)
    }

    pub(super) fn accept_background_on_connection(
        tx: &Connection, input: &SubmitBackgroundTaskInput, context: BackgroundTaskContext,
        channel: Option<&BackgroundDeviceChannelProof>, budget: Option<&BackgroundDelegationBudget>,
        capture: impl FnOnce(&Connection, &SubmitBackgroundTaskInput) -> Result<String, String>,
    ) -> Result<(), String> {
        let input_json = serde_json::to_string(input).map_err(|e| e.to_string())?;
        Self::bind_background_device_channel(&tx, &input, channel)?;
        let existing: Option<String> = tx.query_row(
            "SELECT input_json FROM automation_background_tasks WHERE request_id = ?1",
            params![input.request_id], |row| row.get(0),
        ).optional().map_err(|e| e.to_string())?;
        if let Some(existing) = existing {
            if existing != input_json {
                return Err("requestId is already bound to a different background task".to_string());
            }
        } else {
            let queued: i64 = tx.query_row(
                "SELECT COUNT(*) FROM automation_cron_runs WHERE state IN ('pending', 'leased', 'waiting')",
                [], |row| row.get(0),
            ).map_err(|e| e.to_string())?;
            if queued >= 128 { return Err("Background execution queue is full".to_string()); }
            let binding = capture(&tx, &input)?;
            if binding.is_empty() { return Err("Background configuration binding is required".to_string()); }
            let now = db::now_ms();
            let execution_id = Uuid::new_v4().to_string();
            let request = PromptRunRequest {
                lease: None,
                execution_id: execution_id.clone(), task_id: execution_id.clone(),
                task_name: input.name.clone(), prompt: input.prompt.clone(),
                provider_id: input.provider_id.clone(), model: input.model.clone(),
                started_at: now, lease_expires_at: now + PROMPT_PENDING_CLAIM_WINDOW_MS,
                timeout_seconds: input.timeout_seconds, counted: false,
                workdir: input.workdir.clone(), reasoning: input.reasoning.clone(),
                background_context: Some(context),
                goal_context: None,
            };
            tx.execute(
                "INSERT INTO automation_background_tasks (request_id, execution_id, input_json, created_at) VALUES (?1, ?2, ?3, ?4)",
                params![input.request_id, execution_id, input_json, now],
            ).map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT INTO automation_cron_runs (execution_id, task_id, state, success, started_at, duration_ms, output, lease_expires_at, request_json)
                 VALUES (?1, ?1, 'pending', 0, ?2, 0, '', ?3, ?4)",
                params![execution_id, now, request.lease_expires_at, serde_json::to_string(&request).map_err(|e| e.to_string())?],
            ).map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT INTO automation_background_configuration_bindings (execution_id, binding) VALUES (?1, ?2)",
                params![execution_id, binding],
            ).map_err(|e| e.to_string())?;
            let host_id: String = tx.query_row("SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1'", [], |row| row.get(0)).map_err(|e| e.to_string())?;
            if input.intelligent_scheduling_enabled {
                if let Some(budget) = budget {
                    Self::initialize_delegated_background_budget(&tx, &execution_id, budget)?;
                } else { Self::initialize_background_budget(&tx, &execution_id)?; }
            }
            Self::track_result_on_connection(&tx, &host_id, &input.request_id)?;
            if let Some(goal) = &input.goal_binding {
                Self::accept_background_goal(&tx, goal, &input.request_id, &input.name, now)?;
            }
        }
        Ok(())
    }

    /// Read configuration and its binding from one SQLite snapshot. Missing
    /// legacy bindings are not silently filled in using today's credentials.
    pub fn background_execution_settings(
        &self, execution_id: &str, lease: Option<&BackgroundExecutionLease>,
        load: impl FnOnce(&Connection, &SubmitBackgroundTaskInput) -> Result<(String, Value), String>,
    ) -> Result<Value, String> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let settings = Self::verify_background_configuration(&tx, execution_id, lease, load)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(settings)
    }

    pub(crate) fn verify_background_configuration(
        conn: &Connection, execution_id: &str, lease: Option<&BackgroundExecutionLease>,
        load: impl FnOnce(&Connection, &SubmitBackgroundTaskInput) -> Result<(String, Value), String>,
    ) -> Result<Value, String> {
        Self::require_background_execution(conn, execution_id, lease)?;
        Self::verify_background_binding(conn, execution_id, load)
    }

    pub(super) fn verify_background_binding(
        conn: &Connection, execution_id: &str,
        load: impl FnOnce(&Connection, &SubmitBackgroundTaskInput) -> Result<(String, Value), String>,
    ) -> Result<Value, String> {
        let (raw, accepted): (String, Option<String>) = conn.query_row(
            "SELECT b.input_json, c.binding FROM automation_background_tasks b
             LEFT JOIN automation_background_configuration_bindings c ON c.execution_id = b.execution_id
             WHERE b.execution_id = ?1",
            params![execution_id], |row| Ok((row.get(0)?, row.get(1)?)),
        ).map_err(|e| e.to_string())?;
        let accepted = accepted.ok_or_else(|| "This background task predates account/configuration binding; inspect it and submit a new task explicitly".to_string())?;
        let input: SubmitBackgroundTaskInput = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let (current, settings) = load(conn, &input)?;
        if current != accepted {
            return Err("Background account, credentials, model, MCP configuration or execution permissions changed; no further actions were authorized. Inspect completed operations and submit a new task explicitly".to_string());
        }
        Ok(settings)
    }

    pub fn background_task(&self, request_id: &str) -> Result<BackgroundTaskRecord, String> {
        let host_id = self.background_worker_identity()?;
        let conn = self.lock_conn()?;
        Self::background_task_on_connection(&conn, request_id, &host_id)
    }

    pub(super) fn background_task_on_connection(conn: &Connection, request_id: &str, host_id: &str) -> Result<BackgroundTaskRecord, String> {
        let (execution_id, input_json): (String, String) = conn.query_row(
            "SELECT execution_id, input_json FROM automation_background_tasks WHERE request_id = ?1",
            params![request_id], |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(|e| e.to_string())?.ok_or_else(|| "Background task not found".to_string())?;
        let input: SubmitBackgroundTaskInput = serde_json::from_str(&input_json).map_err(|e| e.to_string())?;
        let run = db::read_runs(&conn, &execution_id, 1)?.into_iter().next()
            .ok_or_else(|| "Background result is no longer retained".to_string())?;
        let artifacts = Self::artifact_manifest(&conn, &execution_id)?;
        let operations = Self::operation_summary(&conn, &execution_id)?;
        let checkpoint_revision = conn.query_row("SELECT revision FROM automation_background_checkpoints WHERE execution_id = ?1",
            params![execution_id], |row| row.get(0)).optional().map_err(|e| e.to_string())?.unwrap_or(0);
        let inputs = Self::background_input_manifest(&execution_id, &input.files);
        let outcomes = Self::background_outcome_report(&conn, &execution_id)?;
        let waiting = Self::background_wait_record(&conn, &execution_id)?;
        let cloud_recovery = Self::background_cloud_recovery_record(&conn, &execution_id)?;
        let cloud_cancellation = Self::background_cloud_cancellation_summary(&conn, &execution_id)?;
        let children = Self::background_children_summary(&conn, &execution_id)?;
        let videos = Self::background_video_summary(&conn, &execution_id)?;
        let has_budget:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM automation_background_budgets WHERE execution_id=?1)",params![execution_id],|row|row.get(0)).map_err(|e|e.to_string())?;
        let execution_budget=if input.intelligent_scheduling_enabled && has_budget {Some(super::budget::read_budget(conn,&execution_id)?)}else{None};
        Ok(BackgroundTaskRecord { execution_budget, request_id: input.request_id, host_id: host_id.to_string(), name: input.name, workdir: input.workdir, run, artifacts, inputs, operations, checkpoint_revision, delegation: input.delegation, outcomes, waiting, cloud_recovery, cloud_cancellation, children, videos, goal_binding: input.goal_binding })
    }

    pub fn list_background_tasks(&self, limit: usize) -> Result<Vec<BackgroundTaskRecord>, String> {
        let ids = {
            let conn = self.lock_conn()?;
            let mut stmt = conn.prepare(
                "SELECT b.request_id FROM automation_background_tasks b
                 JOIN automation_cron_runs r ON r.execution_id = b.execution_id
                 ORDER BY b.created_at DESC, b.request_id DESC LIMIT ?1",
            ).map_err(|e| e.to_string())?;
            let rows = stmt.query_map(params![limit.clamp(1, 100) as i64], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
        };
        ids.iter().map(|id| self.background_task(id)).collect()
    }

    pub fn cancel_background_task(&self, request_id: &str) -> Result<BackgroundTaskRecord, String> {
        let task = self.background_task(request_id)?;
        self.expire_prompt_runs_where_with_cloud_cancel(
            "execution_id = ?1 AND state IN ('pending', 'leased', 'waiting')",
            params![task.run.id], "Local background execution stopped by the user. Cancellation of any originally reserved cloud jobs is retained for native reconciliation; a remote stop is not yet confirmed. Completed external actions remain in effect.", true,
        )?;
        // Terminal parents may still own running/unknown descendants. Their
        // explicit stop also persists cascade intent; ordinary expiry does not.
        self.request_background_child_cancellation(&task.run.id)?;
        self.background_task(request_id)
    }
}
