use super::*;

pub(super) const MAX_SOURCE_CONTEXT_BYTES: usize = 2 * 1024 * 1024;

impl BackgroundSourceContext {
    pub(super) fn delegated_snapshot(&self, request: &str, prompt: &str, include_history: bool) -> Result<Self, String> {
        self.validate()?;
        if prompt.trim().is_empty() { return Err("A delegated source requires its exact accepted task brief".into()); }
        let source = Self {
            version: self.version, request_scope: format!("delegated-task/{request}"),
            system_prompt: if include_history { self.system_prompt.clone() } else { String::new() },
            messages: if include_history { self.messages.clone() } else { vec![serde_json::json!({"role":"user","content":prompt.trim()})] },
            original_request: if self.version == 2 { Some(prompt.trim().into()) } else { None },
            request_clock: self.request_clock.clone(), routing: None,
        };
        source.validate()?;
        Ok(source)
    }

    pub fn validate(&self) -> Result<(), String> {
        if let Some(routing) = &self.routing { routing.validate()?; }
        if let Some(clock) = &self.request_clock {
            if self.version != 2 || !(0..=8_640_000_000_000_000).contains(&clock.timestamp_ms)
                || clock.time_zone.as_ref().is_some_and(|zone| zone.is_empty() || zone.len() > 128
                    || !zone.bytes().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, b'_' | b'+' | b'-' | b'/'))) {
                return Err("Invalid original request clock".into());
            }
        }
        if !matches!(self.version, 1 | 2)
            || (self.version == 1 && self.original_request.is_some())
            || (self.version == 2 && !self.original_request.as_ref().is_some_and(|text| !text.trim().is_empty() && text.len() <= 262_144))
            || self.request_scope.is_empty() || self.request_scope.len() > 1024
            || self.messages.is_empty() || self.messages.len() > 512
            || serde_json::to_vec(self).map_err(|e| e.to_string())?.len() > MAX_SOURCE_CONTEXT_BYTES {
            return Err("Source conversation needs version 1 or 2, a scope, 1–512 messages and at most 2 MiB; no history was silently dropped".into());
        }
        let mut pending = std::collections::BTreeMap::<String, String>::new();
        for message in &self.messages {
            let object = message.as_object().ok_or_else(|| "Invalid source message".to_string())?;
            let role = object.get("role").and_then(Value::as_str).unwrap_or_default();
            if !matches!(role, "user" | "assistant" | "toolResult") {
                return Err("Source conversation roles are historical user/assistant/toolResult data".into());
            }
            if role != "toolResult" && !pending.is_empty() {
                return Err("Source conversation contains unfinished tool calls".into());
            }
            let content = object.get("content").ok_or_else(|| "Source message content is required".to_string())?;
            if !content.is_array() && !(role == "user" && content.is_string()) {
                return Err("Invalid source message content".into());
            }
            if role == "assistant" {
                for part in content.as_array().into_iter().flatten() {
                    if part.get("type").and_then(Value::as_str) != Some("toolCall") { continue; }
                    let id = part.get("id").and_then(Value::as_str).unwrap_or_default();
                    let name = part.get("name").and_then(Value::as_str).unwrap_or_default();
                    if id.is_empty() || id.len() > 256 || name.is_empty() || name.len() > 256
                        || pending.insert(id.into(), name.into()).is_some() {
                        return Err("Invalid or duplicate source tool call".into());
                    }
                }
            } else if role == "toolResult" {
                let id = object.get("toolCallId").and_then(Value::as_str).unwrap_or_default();
                let name = object.get("toolName").and_then(Value::as_str).unwrap_or_default();
                if pending.remove(id).as_deref() != Some(name) {
                    return Err("Source conversation has an orphaned or mismatched tool receipt".into());
                }
            }
        }
        if !pending.is_empty() { return Err("Source conversation ends with unfinished tool calls".into()); }
        Ok(())
    }
}

impl BackgroundSourceRouting {
    pub fn validate(&self) -> Result<(), String> {
        if !matches!(self.version, 1 | 2) || Uuid::parse_str(&self.initiating_host_id).map(|id| id.to_string() != self.initiating_host_id).unwrap_or(true)
            || self.branches.is_empty() || self.branches.len() > 16
            || serde_json::to_vec(self).map_err(|e| e.to_string())?.len() > 64 * 1024 {
            return Err("Invalid immutable source routing".into());
        }
        let mut ids = std::collections::BTreeSet::new();
        for branch in &self.branches {
            if let Some(observation) = &branch.observation {
                if self.version != 2 || branch.locality != "initiating-device" {
                    return Err("Original-device observations require source routing version 2".into());
                }
                observation.validate()?;
            }
            if branch.id.is_empty() || branch.id.len() > 64 || !branch.id.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_' || c == b'-')
                || !ids.insert(branch.id.as_str()) || branch.requirement.trim().is_empty() || branch.requirement.len() > 2048
                || !matches!(branch.locality.as_str(), "portable" | "initiating-device") || branch.depends_on.len() > 15 {
                return Err("Invalid immutable source branch".into());
            }
        }
        fn visit<'a>(id: &'a str, branches: &'a [BackgroundSourceBranch], active: &mut std::collections::BTreeSet<&'a str>, done: &mut std::collections::BTreeSet<&'a str>) -> Result<(), String> {
            if done.contains(id) { return Ok(()); }
            if !active.insert(id) { return Err("Source dependencies contain a cycle".into()); }
            let branch = branches.iter().find(|branch| branch.id == id).ok_or_else(|| "Unknown source dependency".to_string())?;
            let mut seen = std::collections::BTreeSet::new();
            for dependency in &branch.depends_on {
                if !seen.insert(dependency) { return Err("Duplicate source dependency".into()); }
                visit(dependency, branches, active, done)?;
            }
            active.remove(id); done.insert(id); Ok(())
        }
        let mut active = std::collections::BTreeSet::new(); let mut done = std::collections::BTreeSet::new();
        for branch in &self.branches { visit(&branch.id, &self.branches, &mut active, &mut done)?; }
        Ok(())
    }

    pub fn validate_plan(&self, plan: &BackgroundTaskPlan, executing_host: &str) -> Result<(), String> {
        self.validate()?;
        for original in &self.branches {
            let branch = plan.branches.iter().find(|branch| branch.id == original.id).ok_or_else(|| format!("Missing original source branch {}", original.id))?;
            let mut actual = branch.depends_on.clone(); actual.sort();
            let mut required = original.depends_on.clone(); required.sort();
            if branch.requirement != original.requirement || actual != required { return Err("Original source requirement/dependencies are immutable".into()); }
            if original.locality == "initiating-device" && executing_host != self.initiating_host_id
                && (branch.criteria.is_empty() || branch.criteria.iter().any(|criterion| !matches!(criterion, BackgroundCriterion::Unavailable { .. }))) {
                return Err("Initiating-device outcome must stay unavailable on another host; account discovery or historical receipts cannot transfer its authority".into());
            }
        }
        Ok(())
    }
}

impl BackgroundHealthObservation {
    pub(super) fn validate(&self) -> Result<(), String> {
        if self.kind != "health_samples"
            || !matches!(self.metric.as_str(), "heart_rate" | "blood_glucose" | "oxygen_saturation" | "weight" | "body_temperature")
            || self.start_ms <= 0 || self.end_ms <= self.start_ms
            || self.end_ms > 8_640_000_000_000_000
            || self.end_ms - self.start_ms > 7 * 24 * 60 * 60 * 1000
            || !(1..=200).contains(&self.limit) {
            return Err("Original health observation requires a fixed metric, interval and 1–200 records".into());
        }
        Ok(())
    }

    pub(super) fn request(&self) -> Value {
        serde_json::json!({"metric":self.metric,"startMs":self.start_ms,"endMs":self.end_ms,"limit":self.limit})
    }
}

impl AutomationStore {
    pub(super) fn validate_background_source_plan(conn: &Connection, execution_id: &str, plan: &BackgroundTaskPlan) -> Result<(), String> {
        let raw: String = conn.query_row("SELECT input_json FROM automation_background_tasks WHERE execution_id = ?1", params![execution_id], |row| row.get(0)).map_err(|e| e.to_string())?;
        let input: SubmitBackgroundTaskInput = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        // A pre-upgrade child may retain the parent's whole graph in its
        // historical source. The root still verifies it; the child owns its brief.
        let routing = if input.delegation.is_none() { input.source_context.and_then(|source| source.routing) } else { None };
        if let Some(routing) = routing {
            let identity: String = conn.query_row("SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1'", [], |row| row.get(0)).map_err(|e| e.to_string())?;
            routing.validate_plan(plan, &identity)?;
        }
        Ok(())
    }
    pub fn load_background_source_context(&self, execution_id: &str, lease: Option<&BackgroundExecutionLease>)
        -> Result<Option<BackgroundSourceContext>, String> {
        let conn = self.lock_conn()?;
        Self::require_background_execution(&conn, execution_id, lease)?;
        let raw: String = conn.query_row("SELECT input_json FROM automation_background_tasks WHERE execution_id = ?1",
            params![execution_id], |row| row.get(0)).map_err(|e| e.to_string())?;
        let input: SubmitBackgroundTaskInput = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        if let Some(source) = &input.source_context { source.validate()?; }
        Ok(input.source_context)
    }
}
