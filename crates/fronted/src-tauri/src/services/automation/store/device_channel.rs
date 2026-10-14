use super::*;
use background_hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;

fn verifier(proof: &BackgroundDeviceChannelProof) -> Result<Hmac<Sha256>, String> {
    if proof.version != 1 || Uuid::parse_str(&proof.initiating_host_id).map(|id| id.to_string() != proof.initiating_host_id).unwrap_or(true)
        || proof.token.len() != 64 || !proof.token.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)) {
        return Err("Invalid native origin-device channel".into());
    }
    let mut mac = Hmac::<Sha256>::new_from_slice(proof.token.as_bytes()).map_err(|_| "Invalid channel key".to_string())?;
    mac.update(b"xgent.device-channel-verifier.v1\0");
    Ok(mac)
}

impl AutomationStore {
    pub(super) fn bind_background_device_channel(conn: &Connection, input: &SubmitBackgroundTaskInput, proof: Option<&BackgroundDeviceChannelProof>) -> Result<(), String> {
        let routing = input.source_context.as_ref().and_then(|source| source.routing.as_ref());
        let receiver: String = conn.query_row("SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1'", [], |row| row.get(0)).map_err(|e| e.to_string())?;
        let required = routing.is_some_and(|routing| routing.initiating_host_id != receiver && routing.branches.iter().any(|branch| branch.locality == "initiating-device"));
        if !required {
            if proof.is_some() { return Err("A device channel must belong to a remote original-device branch".into()); }
            return Ok(());
        }
        let proof = proof.ok_or_else(|| "Remote original-device branches require the initiating installation's native channel".to_string())?;
        if routing.is_none_or(|routing| routing.initiating_host_id != proof.initiating_host_id) { return Err("Channel origin differs from immutable source branches".into()); }
        let mac = verifier(proof)?;
        let saved: Option<(String, Vec<u8>)> = conn.query_row("SELECT initiating_host_id, verifier FROM automation_background_device_channels WHERE request_id = ?1", params![input.request_id], |row| Ok((row.get(0)?, row.get(1)?))).optional().map_err(|e| e.to_string())?;
        if let Some((origin, tag)) = saved {
            if origin != proof.initiating_host_id || mac.verify_slice(&tag).is_err() { return Err("Accepted device channel is immutable; another client cannot replace it".into()); }
        } else {
            let accepted: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM automation_background_tasks WHERE request_id = ?1)", params![input.request_id], |row| row.get(0)).map_err(|e| e.to_string())?;
            if accepted { return Err("Legacy accepted task has no original channel; it cannot be adopted by a later client".into()); }
            // Called inside the same transaction as task/configuration acceptance.
            // Failed admission rolls back this binding too.
            let tag = mac.finalize().into_bytes();
            conn.execute("INSERT INTO automation_background_device_channels (request_id, initiating_host_id, verifier) VALUES (?1, ?2, ?3)", params![input.request_id, proof.initiating_host_id, tag.as_slice()]).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub(crate) fn authorize_background_device_channel(&self, request: &str, proof: &BackgroundDeviceChannelProof) -> Result<(), String> {
        let conn = self.lock_conn()?;
        let (origin, tag): (String, Vec<u8>) = conn.query_row("SELECT initiating_host_id, verifier FROM automation_background_device_channels WHERE request_id = ?1", params![request], |row| Ok((row.get(0)?, row.get(1)?))).map_err(|_| "Task has no accepted native device channel".to_string())?;
        if origin != proof.initiating_host_id || verifier(proof)?.verify_slice(&tag).is_err() { return Err("Origin-device channel authentication failed".into()); }
        Ok(())
    }

    /// Reading this handoff is not a grant to use OS or external app permissions.
    pub(crate) fn background_device_branches(&self, request: &str, proof: &BackgroundDeviceChannelProof) -> Result<Value, String> {
        self.authorize_background_device_channel(request, proof)?;
        let conn = self.lock_conn()?;
        let (execution, raw): (String, String) = conn.query_row("SELECT execution_id, input_json FROM automation_background_tasks WHERE request_id = ?1", params![request], |row| Ok((row.get(0)?, row.get(1)?))).map_err(|e| e.to_string())?;
        let input: SubmitBackgroundTaskInput = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let routing = input.source_context.and_then(|source| source.routing).ok_or_else(|| "Task has no immutable source branch graph".to_string())?;
        if routing.initiating_host_id != proof.initiating_host_id { return Err("Task origin changed".into()); }
        let run = db::read_runs(&conn, &execution, 1)?.into_iter().next().ok_or_else(|| "Task state is no longer retained".to_string())?;
        let active = matches!(run.state, RunState::Pending | RunState::Leased | RunState::Waiting);
        let report = Self::background_outcome_report(&conn, &execution)?;
        let branches: Vec<Value> = routing.branches.iter().filter(|branch| branch.locality == "initiating-device").map(|branch| {
            let outcome = report.as_ref().and_then(|report| report.branches.iter().find(|outcome| outcome.branch.id == branch.id));
            let dependencies_ready = report.as_ref().is_some_and(|report| branch.depends_on.iter().all(|dependency| report.branches.iter().any(|outcome| outcome.branch.id == *dependency && outcome.state == "verified")));
            serde_json::json!({"source":branch, "state":outcome.map(|outcome| outcome.state.as_str()).unwrap_or("unplanned"),
                "ready":active && dependencies_ready && outcome.is_some_and(|outcome| outcome.state != "verified"), "reason":outcome.and_then(|outcome| outcome.reason.as_ref())})
        }).collect();
        let host: String = conn.query_row("SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1'", [], |row| row.get(0)).map_err(|e| e.to_string())?;
        Ok(serde_json::json!({"version":1,"planningVersion":1,"requestId":input.request_id,"hostId":host,"initiatingHostId":routing.initiating_host_id,"executionId":execution,"state":run.state.as_str(),"branches":branches}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn packet() -> (SubmitBackgroundTaskInput, BackgroundDeviceChannelProof) {
        let origin = Uuid::new_v4().to_string();
        let input = SubmitBackgroundTaskInput { intelligent_scheduling_enabled: false, request_id: Uuid::new_v4().to_string(), name:"Report and calendar".into(),prompt:"Produce report and schedule on the phone".into(),
            provider_id:"model".into(),model:"model".into(),workdir:std::env::temp_dir().to_string_lossy().into_owned(),timeout_seconds:300,reasoning:"medium".into(), files:vec![],delegation:None,requirements:None,goal_binding:None,
            source_context:Some(BackgroundSourceContext {version:1,original_request:None,request_clock:None,request_scope:"original-turn".into(),system_prompt:String::new(), messages:vec![json!({"role":"user","content":"Report and calendar"})],
                routing:Some(BackgroundSourceRouting {version:1,initiating_host_id:origin.clone(),branches:vec![
                    BackgroundSourceBranch {observation:None,id:"report".into(),requirement:"Produce the report".into(),depends_on:vec![],locality:"portable".into()},
                    BackgroundSourceBranch {observation:None,id:"calendar".into(),requirement:"Schedule on the original phone".into(),depends_on:vec!["report".into()],locality:"initiating-device".into()}]})}) };
        (input, BackgroundDeviceChannelProof {version:1,initiating_host_id:origin,token:"a".repeat(64)})
    }
    #[test]
    fn channel_acceptance_is_atomic_immutable_and_private() {
        let store = AutomationStore::open_in_memory().unwrap(); let (input, proof) = packet();
        assert!(store.submit_background_task_with_binding(input.clone(), |_,_| panic!("Missing channel must fail before configuration capture")).is_err());
        assert!(store.submit_background_task_with_device_channel(input.clone(), Some(&proof), |_,_|Err("Account unavailable".into())).is_err());
        assert_eq!(store.lock_conn().unwrap().query_row("SELECT COUNT(*) FROM automation_background_device_channels", [], |row|row.get::<_,i64>(0)).unwrap(),0);
        let accepted=store.submit_background_task_with_device_channel(input.clone(),Some(&proof),|_,_|Ok("accepted".into())).unwrap();
        let retry=store.submit_background_task_with_device_channel(input.clone(),Some(&proof),|_,_|panic!("Retry cannot replace configuration")).unwrap();
        assert_eq!(accepted.run.id,retry.run.id);
        let wrong=BackgroundDeviceChannelProof {token:"b".repeat(64),..proof.clone()};
        assert!(store.submit_background_task_with_device_channel(input.clone(),Some(&wrong),|_,_|Ok("changed".into())).is_err());
        assert!(store.background_device_branches(&input.request_id,&wrong).is_err());
        assert!(!serde_json::to_string(&accepted).unwrap().contains(&proof.token));
        let raw:String=store.lock_conn().unwrap().query_row("SELECT input_json FROM automation_background_tasks WHERE request_id=?1",params![input.request_id],|row|row.get(0)).unwrap();
        assert!(!raw.contains(&proof.token));
    }
    #[test]
    fn handoff_readiness_uses_actual_dependencies_and_stops_after_cancellation() {
        let store=AutomationStore::open_in_memory().unwrap(); let (input,proof)=packet();
        let accepted=store.submit_background_task_with_device_channel(input.clone(),Some(&proof),|_,_|Ok("accepted".into())).unwrap();
        assert_eq!(store.background_device_branches(&input.request_id,&proof).unwrap()["branches"][0]["ready"],false);
        let lease=store.claim_prompt_runs().unwrap().remove(0).lease.unwrap();
        let plan=BackgroundTaskPlan {version:1,branches:vec![
            BackgroundBranch {id:"report".into(),title:"Report".into(),requirement:"Produce the report".into(),depends_on:vec![],criteria:vec![BackgroundCriterion::Answer]},
            BackgroundBranch {id:"calendar".into(),title:"Calendar".into(),requirement:"Schedule on the original phone".into(),depends_on:vec!["report".into()],criteria:vec![BackgroundCriterion::Unavailable {capability:"Original phone".into()}]}]};
        store.save_background_plan(SaveBackgroundPlanInput {execution_id:accepted.run.id.clone(),lease:Some(lease.clone()),plan},|_,_|Ok(())).unwrap();
        assert_eq!(store.background_device_branches(&input.request_id,&proof).unwrap()["branches"][0]["ready"],false);
        store.record_background_outcome(RecordBackgroundOutcomeInput {execution_id:accepted.run.id,lease:Some(lease),branch_id:"report".into(),evidence:Some(BackgroundBranchEvidence {artifact_ids:vec![],call_ids:vec![],answer:Some("Actual report answer".into())}),waiting_reason:None,waiting_tool:None,waiting_inventory:None},|_,_|Ok(())).unwrap();
        let handoff=store.background_device_branches(&input.request_id,&proof).unwrap();
        assert_eq!(handoff["branches"][0]["ready"],true);assert!(!serde_json::to_string(&handoff).unwrap().contains(&proof.token));
        store.cancel_background_task(&input.request_id).unwrap();
        assert_eq!(store.background_device_branches(&input.request_id,&proof).unwrap()["branches"][0]["ready"],false);
    }
    #[test]
    fn an_existing_task_without_a_channel_cannot_be_adopted_after_the_fact() {
        let store=AutomationStore::open_in_memory().unwrap();let (input,proof)=packet();
        store.submit_background_task_with_device_channel(input.clone(),Some(&proof),|_,_|Ok("accepted".into())).unwrap();
        store.lock_conn().unwrap().execute("DELETE FROM automation_background_device_channels WHERE request_id=?1",params![input.request_id]).unwrap();
        assert!(store.submit_background_task_with_device_channel(input.clone(),Some(&proof),|_,_|Ok("adopted".into())).is_err());
        assert!(store.background_device_branches(&input.request_id,&proof).is_err());
    }
}
