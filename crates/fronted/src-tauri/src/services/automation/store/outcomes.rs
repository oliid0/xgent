use std::collections::{HashMap, HashSet};
use sha2::{Digest, Sha256};
use super::*;

// A committed acceptance/resume receipt is not completion of delegated work.
// None denotes another operation; Some(false) keeps this exact child pending.
fn child_operation_completed(conn: &Connection, execution: &str, call: &str) -> Result<Option<bool>,String> {
    conn.query_row(
        "SELECT CASE WHEN o.tool_name='BackgroundTask' AND json_valid(o.arguments_json)
            AND json_extract(o.arguments_json,'$.action') IN ('submit','resume') THEN EXISTS(
            SELECT 1 FROM automation_background_child_operations original
            JOIN automation_background_children child ON child.execution_id=original.execution_id
              AND child.peer_id=original.peer_id AND child.issuer_host_id=original.issuer_host_id
            WHERE original.execution_id=o.execution_id AND original.call_id=o.call_id
              AND original.action=json_extract(o.arguments_json,'$.action') AND original.receipt_json IS NOT NULL
              AND original.issuer_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1')
              AND ((original.action='submit' AND child.call_id=original.call_id) OR
                (original.action='resume' AND child.observed_execution_id=(SELECT child_execution_id
                  FROM automation_background_child_resumes WHERE execution_id=original.execution_id AND call_id=original.call_id)))
              AND child.terminal_confirmed=1 AND child.observed_success=1 AND child.observed_state='done'
              AND (child.cancel_requested=0 OR child.cancel_acknowledged=1)
              AND json_valid(child.observed_json) AND json_extract(child.observed_json,'$.outcomes.verified')=1
        ) ELSE NULL END FROM automation_background_operations o WHERE o.execution_id=?1 AND o.call_id=?2",
        params![execution,call],|row|row.get::<_,Option<bool>>(0),
    ).optional().map(|value|value.flatten()).map_err(|e|e.to_string())
}

// Derived waits are observations of the accepted DAG, never persisted branch
// writes or evidence. They disappear when the original prerequisite verifies.
fn project_dependency_waits(branches: &mut [BackgroundBranchOutcome]) {
    for _ in 0..branches.len() {
        let waiting:HashSet<String>=branches.iter().filter(|item|item.state=="waiting")
            .map(|item|item.branch.id.clone()).collect();
        let mut changed=false;
        for item in branches.iter_mut().filter(|item|item.state=="pending") {
            let dependencies:Vec<_>=item.branch.depends_on.iter().filter(|id|waiting.contains(*id)).cloned().collect();
            if dependencies.is_empty(){continue;}
            item.state="waiting".into();
            item.reason=Some(format!("Waiting for original prerequisite outcomes: {}",dependencies.join(", ")));
            changed=true;
        }
        if !changed {break;}
    }
}

fn validate_plan(plan: &BackgroundTaskPlan) -> Result<(), String> {
    if plan.version != 1 || plan.branches.is_empty() || plan.branches.len() > 32
        || serde_json::to_vec(plan).map_err(|e| e.to_string())?.len() > 64 * 1024 {
        return Err("A background plan needs version 1 and 1–32 bounded branches".into());
    }
    let mut graph = HashMap::new();
    let mut total = 0;
    for branch in &plan.branches {
        if branch.id.is_empty() || branch.id.len() > 64 || !branch.id.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_' || c == b'-')
            || branch.title.trim().is_empty() || branch.title.len() > 512 || branch.requirement.trim().is_empty() || branch.requirement.len() > 8192
            || branch.criteria.is_empty() || branch.criteria.len() > 8 || branch.depends_on.len() > 31 {
            return Err("Each branch needs a stable ID, requirement and 1–8 explicit criteria".into());
        }
        if graph.insert(branch.id.as_str(), branch.depends_on.as_slice()).is_some() { return Err("Duplicate background branch ID".into()); }
        let mut criteria = HashSet::new();
        for criterion in &branch.criteria {
            if !criteria.insert(serde_json::to_string(criterion).map_err(|e| e.to_string())?) { return Err("Duplicate branch criterion".into()); }
            match criterion {
                BackgroundCriterion::Artifact { path } => {
                    if path.is_empty() || path.len() > 1024 || path.contains(['\\', ':']) || path.chars().any(char::is_control)
                        || path.split('/').any(|part| part.is_empty() || part == "." || part == "..") {
                        return Err("Artifact criteria need a relative workspace path".into());
                    }
                }
                BackgroundCriterion::Operation { tool, arguments } => {
                    if tool.trim().is_empty() || tool.len() > 256 || !arguments.is_object()
                        || tool == "RecordBackgroundOutcome" || tool == "ReadBackgroundOutcomes" {
                        return Err("Operation criteria need an actual tool and expected argument object".into());
                    }
                }
                BackgroundCriterion::Answer => {}
                BackgroundCriterion::Unavailable { capability } => {
                    if capability.trim().is_empty() || capability.len() > 2048 { return Err("Unavailable criterion needs its real missing capability".into()); }
                }
            }
        }
        total += branch.criteria.len();
    }
    if total > 96 { return Err("Background plan exceeds 96 criteria".into()); }
    fn visit<'a>(id: &'a str, graph: &HashMap<&'a str, &'a [String]>, active: &mut HashSet<&'a str>, done: &mut HashSet<&'a str>) -> Result<(), String> {
        if done.contains(id) { return Ok(()); }
        if !active.insert(id) { return Err("Background branch dependencies contain a cycle".into()); }
        let dependencies = graph.get(id).ok_or_else(|| "Unknown background branch dependency".to_string())?;
        let mut seen = HashSet::new();
        for dependency in *dependencies {
            if !seen.insert(dependency.as_str()) { return Err("Duplicate branch dependency".into()); }
            visit(dependency.as_str(), graph, active, done)?;
        }
        active.remove(id);
        done.insert(id);
        Ok(())
    }
    let mut done = HashSet::new();
    for id in graph.keys() { visit(id, &graph, &mut HashSet::new(), &mut done)?; }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn branch(id: &str, criteria: Vec<BackgroundCriterion>) -> BackgroundBranch {
        BackgroundBranch { id: id.into(), title: id.into(), requirement: format!("Requested {id}"), depends_on: vec![], criteria }
    }

    fn leased() -> (AutomationStore, String, BackgroundExecutionLease) {
        let store = AutomationStore::open_in_memory().unwrap();
        let task = store.submit_background_task(SubmitBackgroundTaskInput {
            intelligent_scheduling_enabled: false, request_id: Uuid::new_v4().to_string(), name: "Compound request".into(), prompt: "Report and calendar".into(),
            provider_id: "fixture".into(), model: "fixture".into(), workdir: std::env::temp_dir().to_string_lossy().into_owned(),
            timeout_seconds: 300, reasoning: "medium".into(), files: vec![], delegation: None, requirements: None, source_context: None, goal_binding: None,
        }).unwrap();
        store.claim_prompt_runs().unwrap();
        let lease = store.debug_background_lease(&task.run.id).unwrap();
        store.save_background_checkpoint(SaveBackgroundCheckpointInput { execution_id: task.run.id.clone(), lease: Some(lease.clone()), revision: 1,
            context: json!({"systemPrompt": "Fixture", "messages": [{"role": "user", "content": "Report and calendar"}]}) }).unwrap();
        (store, task.run.id, lease)
    }

    fn plan(store: &AutomationStore, id: &str, lease: &BackgroundExecutionLease, branches: Vec<BackgroundBranch>) -> BackgroundOutcomeReport {
        store.save_background_plan(SaveBackgroundPlanInput { execution_id: id.into(), lease: Some(lease.clone()), plan: BackgroundTaskPlan { version: 1, branches } }, |_, _| Ok(())).unwrap()
    }

    fn record(store: &AutomationStore, id: &str, lease: &BackgroundExecutionLease, branch_id: &str, evidence: BackgroundBranchEvidence) -> Result<BackgroundOutcomeReport, String> {
        store.record_background_outcome(RecordBackgroundOutcomeInput { execution_id: id.into(), lease: Some(lease.clone()), branch_id: branch_id.into(), evidence: Some(evidence), waiting_reason: None, waiting_tool: None, waiting_inventory: None }, |_, _| Ok(()))
    }

    fn answer() -> BackgroundBranchEvidence { BackgroundBranchEvidence { artifact_ids: vec![], call_ids: vec![], answer: Some("Actual requested text".into()) } }

    #[test]
    fn actions_and_success_need_a_durable_immutable_plan() {
        let (store, id, lease) = leased();
        let operation = BeginBackgroundOperationInput { execution_id: id.clone(), lease: Some(lease.clone()), call_id: "write".into(), tool_name: "SendMail".into(), arguments: json!({}) };
        assert!(store.begin_background_operation(operation).unwrap_err().contains("outcome plan"));
        let completion = CompletePromptRunInput { execution_id: id.clone(), lease: Some(lease.clone()), success: true, duration_ms: 1, output: "Done".into() };
        assert!(store.stage_prompt_completion(completion.clone()).unwrap_err().contains("outcome plan"));
        let branches = vec![branch("report", vec![BackgroundCriterion::Answer])];
        assert!(!plan(&store, &id, &lease, branches.clone()).verified);
        assert!(!plan(&store, &id, &lease, branches).verified);
        assert!(store.stage_prompt_completion(completion.clone()).unwrap_err().contains("unfinished"));
        let replacement = SaveBackgroundPlanInput { execution_id: id.clone(), lease: Some(lease.clone()), plan: BackgroundTaskPlan { version: 1, branches: vec![branch("easier", vec![BackgroundCriterion::Answer])] } };
        assert!(store.save_background_plan(replacement, |_, _| Ok(())).unwrap_err().contains("immutable"));
        assert!(record(&store, &id, &lease, "report", answer()).unwrap().verified);
        assert!(store.stage_prompt_completion(completion).unwrap().is_some());
    }

    #[test]
    fn dependency_and_waiting_preserve_independent_real_work() {
        let (store, id, lease) = leased();
        let mut delivery = branch("delivery", vec![BackgroundCriterion::Answer]); delivery.depends_on.push("report".into());
        plan(&store, &id, &lease, vec![branch("report", vec![BackgroundCriterion::Answer]), delivery,
            branch("calendar", vec![BackgroundCriterion::Unavailable { capability: "No authorized calendar connector".into() }])]);
        assert!(record(&store, &id, &lease, "delivery", answer()).unwrap_err().contains("dependencies"));
        record(&store, &id, &lease, "report", answer()).unwrap();
        record(&store, &id, &lease, "delivery", answer()).unwrap();
        assert!(record(&store, &id, &lease, "calendar", answer()).is_err());
        let report = store.record_background_outcome(RecordBackgroundOutcomeInput { execution_id: id.clone(), lease: Some(lease.clone()), branch_id: "calendar".into(), evidence: None,
            waiting_reason: Some("Authorize the calendar connector".into()), waiting_tool: None, waiting_inventory: None }, |_, _| Ok(())).unwrap();
        assert!(!report.verified);
        assert_eq!(report.branches[0].state, "verified");
        assert_eq!(report.branches[2].state, "waiting");
        let mut different = answer(); different.answer = Some("Replacement proof".into());
        assert!(record(&store, &id, &lease, "report", different).unwrap_err().contains("immutable"));
    }

    #[test]
    fn dependency_frontier_parks_without_fabricating_descendant_outcomes() {
        let (store,id,lease)=leased();
        let mut slides=branch("slides",vec![BackgroundCriterion::Answer]);slides.depends_on=vec!["plan".into()];
        let mut implementation=branch("plan",vec![BackgroundCriterion::Answer]);implementation.depends_on=vec!["documents".into()];
        plan(&store,&id,&lease,vec![slides,implementation,branch("documents",vec![BackgroundCriterion::Answer]),branch("reminder",vec![BackgroundCriterion::Answer])]);
        let report=store.record_background_outcome(RecordBackgroundOutcomeInput {execution_id:id.clone(),lease:Some(lease.clone()),branch_id:"documents".into(),evidence:None,
            waiting_reason:Some("Original authorized document source is not yet available".into()),waiting_tool:None,waiting_inventory:None},|_,_|Ok(())).unwrap();
        assert_eq!(report.branches.iter().map(|item|item.state.as_str()).collect::<Vec<_>>(),vec!["waiting","waiting","waiting","pending"]);
        assert!(record(&store,&id,&lease,"plan",answer()).unwrap_err().contains("dependencies"));
        store.save_background_checkpoint(SaveBackgroundCheckpointInput {execution_id:id.clone(),lease:Some(lease.clone()),revision:2,
            context:json!({"systemPrompt":"Original policy","messages":[{"role":"assistant","api":"openai-completions","stopReason":"stop","content":[{"type":"text","text":"Original documents are waiting"}]}]})}).unwrap();
        let wait=WaitBackgroundTaskInput {execution_id:id.clone(),lease:lease.clone(),duration_ms:1,output:"Retained original task".into(),known_tools:vec![],budget_deferral_id:None};
        assert!(store.wait_background_task(wait.clone()).unwrap_err().contains("available branches"));
        record(&store,&id,&lease,"reminder",answer()).unwrap();
        assert!(store.wait_background_task(wait).unwrap().is_some());
        let conn=store.lock_conn().unwrap();
        let descendants:i64=conn.query_row("SELECT COUNT(*) FROM automation_background_outcomes WHERE execution_id=?1 AND branch_id IN ('plan','slides')",params![id],|row|row.get(0)).unwrap();
        assert_eq!(descendants,0);
    }

    #[test]
    fn verified_original_prerequisite_releases_pending_descendants_without_new_plan_or_evidence() {
        let (store,id,lease)=leased();
        let mut slides=branch("slides",vec![BackgroundCriterion::Answer]);slides.depends_on=vec!["plan".into()];
        let mut implementation=branch("plan",vec![BackgroundCriterion::Answer]);implementation.depends_on=vec!["documents".into()];
        plan(&store,&id,&lease,vec![slides,implementation,branch("documents",vec![BackgroundCriterion::Answer])]);
        store.record_background_outcome(RecordBackgroundOutcomeInput {execution_id:id.clone(),lease:Some(lease.clone()),branch_id:"documents".into(),evidence:None,
            waiting_reason:Some("Actual missing document input".into()),waiting_tool:None,waiting_inventory:None},|_,_|Ok(())).unwrap();
        let report=record(&store,&id,&lease,"documents",answer()).unwrap();
        assert_eq!(report.branches.iter().map(|item|item.state.as_str()).collect::<Vec<_>>(),vec!["pending","pending","verified"]);
        assert!(report.branches[..2].iter().all(|item|item.evidence.is_none() && item.reason.is_none()));
        record(&store,&id,&lease,"plan",answer()).unwrap();
        assert!(record(&store,&id,&lease,"slides",answer()).unwrap().verified);
    }

    #[test]
    fn matched_receipts_require_the_actual_target_and_success() {
        let (store, id, lease) = leased();
        plan(&store, &id, &lease, vec![branch("calendar", vec![BackgroundCriterion::Operation { tool: "CreateEvent".into(), arguments: json!({"calendar": {"id": "mine"}, "date": "2030-01-01"}) }])]);
        let proof = BackgroundBranchEvidence { artifact_ids: vec![], call_ids: vec!["event".into()], answer: None };
        assert!(record(&store, &id, &lease, "calendar", proof.clone()).is_err());
        store.begin_background_operation(BeginBackgroundOperationInput { execution_id: id.clone(), lease: Some(lease.clone()), call_id: "event".into(), tool_name: "CreateEvent".into(),
            arguments: json!({"calendar": {"id": "other"}, "date": "2030-01-01"}) }).unwrap();
        store.complete_background_operation(CompleteBackgroundOperationInput { execution_id: id.clone(), lease: Some(lease.clone()), call_id: "event".into(),
            result: json!({"role": "toolResult", "toolCallId": "event", "toolName": "CreateEvent", "isError": false, "content": [{"type": "text", "text": "Created"}]}) }).unwrap();
        assert!(record(&store, &id, &lease, "calendar", proof.clone()).unwrap_err().contains("lacks evidence"));
        // Database corruption/fault fixtures; production writes use immutable receipts.
        store.lock_conn().unwrap().execute("UPDATE automation_background_operations SET arguments_json = ?1", params![json!({"calendar": {"id": "mine", "name": "Personal"}, "date": "2030-01-01", "title": "Workout"}).to_string()]).unwrap();
        assert!(record(&store, &id, &lease, "calendar", proof).unwrap().verified);
        store.lock_conn().unwrap().execute("UPDATE automation_background_operations SET is_error = 1", []).unwrap();
        assert!(AutomationStore::require_background_outcomes(&store.lock_conn().unwrap(), &id).is_err());
    }

    #[test]
    fn artifacts_cannot_cross_tasks_or_fake_document_bytes() {
        let (store, id, lease) = leased();
        plan(&store, &id, &lease, vec![branch("slides", vec![BackgroundCriterion::Artifact { path: "report.pptx".into() }])]);
        let proof = BackgroundBranchEvidence { artifact_ids: vec!["artifact".into()], call_ids: vec![], answer: None };
        let bytes = b"Text renamed as a deck";
        let hash = hex::encode(Sha256::digest(bytes));
        store.lock_conn().unwrap().execute("INSERT INTO automation_background_artifacts VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params!["artifact", "another-task", "report.pptx", hash, bytes.len() as i64, bytes.as_slice(), 1]).unwrap();
        assert!(record(&store, &id, &lease, "slides", proof.clone()).unwrap_err().contains("belong"));
        store.lock_conn().unwrap().execute("UPDATE automation_background_artifacts SET execution_id = ?1", params![id]).unwrap();
        assert!(record(&store, &id, &lease, "slides", proof).unwrap_err().contains("Office"));
    }

    #[test]
    fn graph_cycles_and_revoked_authority_cannot_commit_plan_or_evidence() {
        let mut a = branch("a", vec![BackgroundCriterion::Answer]); a.depends_on.push("b".into());
        let mut b = branch("b", vec![BackgroundCriterion::Answer]); b.depends_on.push("a".into());
        assert!(validate_plan(&BackgroundTaskPlan { version: 1, branches: vec![a, b] }).unwrap_err().contains("cycle"));
        let (store, id, lease) = leased();
        let input = SaveBackgroundPlanInput { execution_id: id.clone(), lease: Some(lease.clone()), plan: BackgroundTaskPlan { version: 1, branches: vec![branch("report", vec![BackgroundCriterion::Answer])] } };
        assert!(store.save_background_plan(input.clone(), |_, _| Err("Configuration revoked".into())).is_err());
        assert!(store.read_background_outcomes(&id, Some(&lease)).unwrap().is_none());
        store.save_background_plan(input, |_, _| Ok(())).unwrap();
        let evidence = RecordBackgroundOutcomeInput { execution_id: id.clone(), lease: Some(lease.clone()), branch_id: "report".into(), evidence: Some(answer()), waiting_reason: None, waiting_tool: None, waiting_inventory: None };
        assert!(store.record_background_outcome(evidence.clone(), |_, _| Err("Account revoked".into())).is_err());
        assert!(!store.read_background_outcomes(&id, Some(&lease)).unwrap().unwrap().verified);
        let mut stale = evidence; stale.lease.as_mut().unwrap().token = "old-token".into();
        assert!(store.record_background_outcome(stale, |_, _| panic!("Stale lease cannot read configuration")).is_err());
    }
}

#[cfg(test)]
mod delegated_completion_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn acceptance_cannot_verify_and_original_started_receipt_recovers_only_after_real_completion() {
        let store=AutomationStore::open_in_memory().unwrap();
        let task=store.submit_background_task(SubmitBackgroundTaskInput {
            intelligent_scheduling_enabled:false,request_id:Uuid::new_v4().to_string(),name:"Compound".into(),prompt:"Finish delegated work".into(),
            provider_id:"fixture".into(),model:"fixture".into(),workdir:std::env::temp_dir().to_string_lossy().into_owned(),timeout_seconds:300,
            reasoning:"medium".into(),files:vec![],delegation:None,requirements:None,source_context:None,goal_binding:None,
        }).unwrap();
        let lease=store.claim_prompt_runs().unwrap().remove(0).lease.unwrap();let id=task.run.id;
        let branch=BackgroundBranch {id:"delegated".into(),title:"Delegated work".into(),requirement:"Finish original work".into(),depends_on:vec![],
            criteria:vec![BackgroundCriterion::Operation {tool:"BackgroundTask".into(),arguments:json!({"action":"submit"})}]};
        store.save_background_plan(SaveBackgroundPlanInput {execution_id:id.clone(),lease:Some(lease.clone()),plan:BackgroundTaskPlan {version:1,branches:vec![branch]}},|_,_|Ok(())).unwrap();
        store.save_background_checkpoint(SaveBackgroundCheckpointInput {execution_id:id.clone(),lease:Some(lease.clone()),revision:1,
            context:json!({"systemPrompt":"Original contract","messages":[{"role":"user","content":"Finish delegated work"}]})}).unwrap();
        store.begin_background_operation(BeginBackgroundOperationInput {execution_id:id.clone(),call_id:"child-call".into(),lease:Some(lease.clone()),
            tool_name:"BackgroundTask".into(),arguments:json!({"action":"submit"})}).unwrap();
        let issuer=store.background_worker_identity().unwrap();
        store.lock_conn().unwrap().execute("INSERT INTO automation_background_children (execution_id,call_id,child_request_id,peer_id,issuer_host_id,input_json,issued_at,retry_at,receipt_json,observed_json,observed_state)
            VALUES (?1,'child-call',?2,?3,?4,'{}',1,1,'{}',?5,'pending')",params![id,Uuid::new_v4().to_string(),Uuid::new_v4().to_string(),issuer,json!({"outcomes":{"verified":false}}).to_string()]).unwrap();
        let input=RecordBackgroundOutcomeInput {execution_id:id.clone(),lease:Some(lease.clone()),branch_id:"delegated".into(),
            evidence:Some(BackgroundBranchEvidence {artifact_ids:vec![],call_ids:vec!["child-call".into()],answer:None}),waiting_reason:None,waiting_tool:None,waiting_inventory:None};
        assert!(store.record_background_outcome(input.clone(),|_,_|Ok(())).unwrap_err().contains("acceptance is not completion"));
        store.lock_conn().unwrap().execute("UPDATE automation_background_children SET terminal_confirmed=1,observed_success=1,observed_state='done',observed_json=?1",params![json!({"outcomes":{"verified":true}}).to_string()]).unwrap();
        assert!(store.record_background_outcome(input,|_,_|Ok(())).unwrap().verified);
        // Historical intent/receipt state is not silently overwritten.
        assert_eq!(store.lock_conn().unwrap().query_row("SELECT state FROM automation_background_operations",[],|row|row.get::<_,String>(0)).unwrap(),"started");
        store.lock_conn().unwrap().execute("UPDATE automation_background_children SET cancel_requested=1,cancel_acknowledged=0",[]).unwrap();
        let report=store.read_background_outcomes(&id,Some(&lease)).unwrap().unwrap();
        assert!(!report.verified);assert_eq!(report.branches[0].state,"waiting");
        assert_eq!(store.lock_conn().unwrap().query_row("SELECT state FROM automation_background_outcomes",[],|row|row.get::<_,String>(0)).unwrap(),"verified");
    }
}

// Expected fields are checked recursively; array order and scalar values are
// exact. Extra provider/default fields do not change the declared target.
fn contains_expected(actual: &Value, expected: &Value) -> bool {
    if let Some(expected) = expected.as_object() {
        actual.as_object().is_some_and(|actual| expected.iter().all(|(key, value)|
            actual.get(key).is_some_and(|actual| contains_expected(actual, value))))
    } else { actual == expected }
}

fn verify_evidence(conn: &Connection, execution_id: &str, branch: &BackgroundBranch, evidence: &BackgroundBranchEvidence) -> Result<(), String> {
    if evidence.artifact_ids.len() > 8 || evidence.call_ids.len() > 8 || evidence.answer.as_ref().is_some_and(|text| text.len() > 32 * 1024)
        || evidence.artifact_ids.iter().chain(evidence.call_ids.iter()).any(|id| id.is_empty() || id.len() > 512) {
        return Err("Branch evidence exceeds bounded artifact/receipt/answer limits".into());
    }
    let mut artifacts = Vec::new();
    for id in &evidence.artifact_ids {
        let row: Option<(String, String, u64)> = conn.query_row(
            "SELECT relative_path, content_hash, bytes FROM automation_background_artifacts WHERE execution_id = ?1 AND artifact_id = ?2",
            params![execution_id, id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).optional().map_err(|e| e.to_string())?;
        let (path, hash, bytes) = row.ok_or_else(|| "Evidence artifact does not belong to this task".to_string())?;
        if bytes == 0 || bytes > super::MAX_STREAM_ARTIFACT_BYTES {
            return Err("Branch artifact failed byte/hash integrity verification".into());
        }
        let mut reader=super::ArtifactReader::new(conn,BackgroundArtifact {id:id.clone(),relative_path:path.clone(),content_hash:hash,bytes})?;
        reader.verify_hash()?;
        crate::services::document_validation::validate_document_reader(&path, reader)?;
        artifacts.push(path);
    }
    let mut operations = Vec::new();
    for id in &evidence.call_ids {
        let row: Option<(String, String, String, Option<String>, bool)> = conn.query_row(
            "SELECT tool_name, arguments_json, state, result_json, is_error FROM automation_background_operations WHERE execution_id = ?1 AND call_id = ?2",
            params![execution_id, id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        ).optional().map_err(|e| e.to_string())?;
        let (tool, arguments, state, result, error) = row.ok_or_else(|| "Evidence operation does not belong to this task".to_string())?;
        let child_receipt=super::children::confirmed_child_start_receipt(conn,execution_id,id)?;
        let child_reconciled=child_receipt.is_some();
        let observed=super::cloud_launch::confirmed_late_cloud_start_receipt(conn,execution_id,id)?.or(child_receipt);
        let reconciled=observed.is_some();
        let result: Value = match observed {Some(receipt)=>receipt,None=>serde_json::from_str(result.as_deref().ok_or_else(|| "Evidence operation has no receipt".to_string())?).map_err(|e| e.to_string())?};
        if (state != "returned" && !child_reconciled) || (error && !reconciled) || result["role"] != "toolResult" || result["toolCallId"].as_str() != Some(id.as_str())
            || result["toolName"].as_str() != Some(tool.as_str()) || result["isError"].as_bool() != Some(false)
            || result["details"]["outcomeUncertain"].as_bool() == Some(true) || result["details"]["receiptTruncated"].as_bool() == Some(true) {
            return Err("Branch operation needs a complete successful matching receipt".into());
        }
        if child_operation_completed(conn,execution_id,id)?==Some(false) {
            return Err("Delegated acceptance is not completion; wait for the original child's verified successful terminal result".into());
        }
        if super::cloud_waiting::cloud_operation_completed(conn,execution_id,id)?==Some(false) {
            return Err("Cloud start acceptance is not completion; await the original start call's native successful terminal observation and verify requested artifacts separately".into());
        }
        if super::videos::video_operation_completed(conn,execution_id,id)?==Some(false) {
            return Err("Video acceptance is not completion; await actual original MP4 publication and verify its artifact separately".into());
        }
        operations.push((tool, serde_json::from_str::<Value>(&arguments).map_err(|e| e.to_string())?));
    }
    for criterion in &branch.criteria {
        let satisfied = match criterion {
            BackgroundCriterion::Artifact { path } => artifacts.contains(path),
            BackgroundCriterion::Operation { tool, arguments } => operations.iter().any(|(name, actual)| name == tool && contains_expected(actual, arguments)),
            BackgroundCriterion::Answer => evidence.answer.as_ref().is_some_and(|text| !text.trim().is_empty()),
            BackgroundCriterion::Unavailable { .. } => false,
        };
        if !satisfied { return Err(format!("Branch {} lacks evidence for {}", branch.id, serde_json::to_string(criterion).map_err(|e| e.to_string())?)); }
    }
    Ok(())
}

impl AutomationStore {
    pub(super) fn background_outcome_report(conn: &Connection, execution_id: &str) -> Result<Option<BackgroundOutcomeReport>, String> {
        let raw: Option<String> = conn.query_row("SELECT plan_json FROM automation_background_plans WHERE execution_id = ?1",
            params![execution_id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
        let Some(raw) = raw else { return Ok(None); };
        let mut plan: BackgroundTaskPlan = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        for branch in &mut plan.branches {
            let resolved: Option<String> = conn.query_row("SELECT criteria_json FROM automation_background_plan_resolutions WHERE execution_id = ?1 AND branch_id = ?2",
                params![execution_id, branch.id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
            if let Some(raw) = resolved { branch.criteria = serde_json::from_str(&raw).map_err(|e| e.to_string())?; }
        }
        validate_plan(&plan)?;
        let mut branches = Vec::new();
        for branch in plan.branches {
            let row: Option<(String, Option<String>, Option<String>)> = conn.query_row(
                "SELECT state, evidence_json, reason FROM automation_background_outcomes WHERE execution_id = ?1 AND branch_id = ?2",
                params![execution_id, branch.id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            ).optional().map_err(|e| e.to_string())?;
            let (mut state, mut evidence, mut reason) = row.unwrap_or_else(|| ("pending".into(), None, None));
            if let Some(native) = Self::verified_device_branch(conn, execution_id, &branch)? {
                state = "verified".into();
                evidence = Some(serde_json::to_string(&native).map_err(|e| e.to_string())?);
                reason = None;
            }
            let condition: Option<(Option<String>, bool)> = conn.query_row("SELECT tool_name, inventory_change FROM automation_background_wait_conditions WHERE execution_id = ?1 AND branch_id = ?2",
                params![execution_id, branch.id], |row| Ok((row.get(0)?, row.get(1)?))).optional().map_err(|e| e.to_string())?;
            let (waiting_tool, waiting_inventory) = condition.unwrap_or((None, false));
            let evidence: Option<BackgroundBranchEvidence> = evidence.map(|raw|serde_json::from_str(&raw).map_err(|e|e.to_string())).transpose()?;
            if state=="verified" {
                if let Some(proof)=&evidence {
                    for call in &proof.call_ids {
                        if child_operation_completed(conn,execution_id,call)?==Some(false)
                            || super::cloud_waiting::cloud_operation_completed(conn,execution_id,call)?==Some(false)
                            || super::videos::video_operation_completed(conn,execution_id,call)?==Some(false) {
                            // Preserve the immutable saved evidence. Legacy
                            // shallow acceptance claims become effective waits
                            // until that same original child genuinely settles.
                            state="waiting".into();
                            reason=Some("Original delegated work is not yet confirmed successfully complete".into());
                            break;
                        }
                    }
                }
            }
            branches.push(BackgroundBranchOutcome { branch, state,
                evidence, reason, waiting_tool, waiting_inventory });
        }
        if branches.iter().all(|branch|branch.state=="verified") {
            if let Some(call)=super::task_joins::unfinished_child_call(conn,execution_id)?
                .or(super::cloud_waiting::unfinished_cloud_call(conn,execution_id)?)
                .or(super::videos::unfinished_video_call(conn,execution_id)?) {
                if let Some(branch)=branches.first_mut() {
                    // Effective wait only: preserve saved branch evidence and
                    // do not replay writes just because cloud work remains.
                    branch.state="waiting".into();
                    branch.reason=Some(format!("Original asynchronous work from call {call} has no confirmed terminal observation. Await that original call before final completion; preserve already verified files and independent work."));
                }
            }
        }
        project_dependency_waits(&mut branches);
        Ok(Some(BackgroundOutcomeReport { verified: branches.iter().all(|branch| branch.state == "verified"), branches }))
    }

    pub(super) fn require_background_outcomes(conn: &Connection, execution_id: &str) -> Result<(), String> {
        let report = Self::background_outcome_report(conn, execution_id)?.ok_or_else(|| "Background task has no durable outcome plan; a conclusion alone is not completion".to_string())?;
        if !report.verified {
            let unfinished = report.branches.iter().filter(|branch| branch.state != "verified")
                .map(|branch| format!("{} ({}): {}", branch.branch.title, branch.state, branch.reason.as_deref().unwrap_or("missing verified evidence"))).collect::<Vec<_>>().join("; ");
            return Err(format!("Background requirements remain unfinished: {unfinished}"));
        }
        // Recheck the immutable source evidence at the success boundary. A
        // status string or corrupted/missing proof row is never sufficient.
        for branch in &report.branches {
            if Self::verified_device_branch(conn, execution_id, &branch.branch)?.is_some() { continue; }
            let evidence = branch.evidence.as_ref().ok_or_else(|| "Verified branch has no stored evidence".to_string())?;
            verify_evidence(conn, execution_id, &branch.branch, evidence)?;
        }
        Ok(())
    }

    pub fn read_background_outcomes(&self, execution_id: &str, lease: Option<&BackgroundExecutionLease>) -> Result<Option<BackgroundOutcomeReport>, String> {
        let conn = self.lock_conn()?;
        Self::require_background_execution(&conn, execution_id, lease)?;
        Self::background_outcome_report(&conn, execution_id)
    }

    pub fn background_evidence_options(&self, execution_id: &str, lease: Option<&BackgroundExecutionLease>, cursor: i64) -> Result<Value, String> {
        let conn = self.lock_conn()?;
        Self::require_background_execution(&conn, execution_id, lease)?;
        let mut stmt = conn.prepare(
            "SELECT sequence, call_id, tool_name, state, is_error FROM automation_background_operations
             WHERE execution_id = ?1 AND sequence > ?2 ORDER BY sequence ASC LIMIT 11",
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![execution_id, cursor.max(0)], |row| Ok(serde_json::json!({
            "sequence": row.get::<_, i64>(0)?, "callId": row.get::<_, String>(1)?, "toolName": row.get::<_, String>(2)?,
            "state": row.get::<_, String>(3)?, "isError": row.get::<_, bool>(4)?,
        }))).map_err(|e| e.to_string())?;
        let mut receipts = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        for receipt in &mut receipts {
            let call=receipt["callId"].as_str().unwrap_or_default().to_owned();
            if let Some(completed)=super::cloud_waiting::cloud_operation_completed(&conn,execution_id,&call)? {
                receipt["cloudCompleted"]=serde_json::json!(completed);
            }
            if let Some(observed)=super::cloud_launch::confirmed_late_cloud_start_receipt(&conn,execution_id,&call)? {
                receipt["reconciledCloudStart"]=observed;
            }
            if let Some(observed)=super::children::confirmed_child_start_receipt(&conn,execution_id,&call)? {
                receipt["reconciledChildAcceptance"]=observed;
                receipt["childCompleted"]=serde_json::json!(child_operation_completed(&conn,execution_id,&call)?==Some(true));
            }
        }
        let next_cursor = if receipts.len() > 10 { receipts.truncate(10); receipts.last().and_then(|receipt| receipt["sequence"].as_i64()) } else { None };
        let artifacts = Self::artifact_manifest(&conn, execution_id)?;
        Ok(serde_json::json!({ "receipts": receipts, "nextCursor": next_cursor, "artifacts": artifacts }))
    }

    pub fn save_background_plan(&self, input: SaveBackgroundPlanInput, verify: impl FnOnce(&Connection, &str) -> Result<(), String>) -> Result<BackgroundOutcomeReport, String> {
        validate_plan(&input.plan)?;
        let raw = serde_json::to_string(&input.plan).map_err(|e| e.to_string())?;
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        Self::require_background_execution(&tx, &input.execution_id, input.lease.as_ref())?;
        verify(&tx, &input.execution_id)?;
        Self::validate_background_source_plan(&tx, &input.execution_id, &input.plan)?;
        let existing: Option<String> = tx.query_row("SELECT plan_json FROM automation_background_plans WHERE execution_id = ?1",
            params![input.execution_id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
        if let Some(existing) = existing {
            if existing != raw { return Err("Background outcome plan is immutable; do not remove unfinished requirements".into()); }
        } else {
            tx.execute("INSERT INTO automation_background_plans (execution_id, plan_json, created_at) VALUES (?1, ?2, ?3)",
                params![input.execution_id, raw, db::now_ms()]).map_err(|e| e.to_string())?;
        }
        let report = Self::background_outcome_report(&tx, &input.execution_id)?.ok_or_else(|| "Plan commit produced no report".to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(report)
    }

    pub fn record_background_outcome(&self, input: RecordBackgroundOutcomeInput, verify: impl FnOnce(&Connection, &str) -> Result<(), String>) -> Result<BackgroundOutcomeReport, String> {
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let report = Self::record_background_outcome_on_connection(&tx,&input,verify)?;
        tx.commit().map_err(|e|e.to_string())?;
        Ok(report)
    }

    pub(super) fn record_background_outcome_on_connection(conn: &Connection, input: &RecordBackgroundOutcomeInput, verify: impl FnOnce(&Connection, &str) -> Result<(), String>) -> Result<BackgroundOutcomeReport, String> {
        Self::require_background_execution(conn, &input.execution_id, input.lease.as_ref())?;
        verify(conn, &input.execution_id)?;
        let report = Self::background_outcome_report(conn, &input.execution_id)?.ok_or_else(|| "Create the durable plan before recording outcomes".to_string())?;
        let branch = report.branches.iter().find(|branch| branch.branch.id == input.branch_id).ok_or_else(|| "Unknown background branch".to_string())?;
        let (state, evidence_json, reason) = if let Some(evidence) = &input.evidence {
            if input.waiting_reason.is_some() || input.waiting_tool.is_some() || input.waiting_inventory == Some(true) { return Err("Evidence and waiting reason are separate outcome states".into()); }
            for dependency in &branch.branch.depends_on {
                if !report.branches.iter().any(|branch| branch.branch.id == *dependency && branch.state == "verified") { return Err("Verify branch dependencies before its outcome".into()); }
            }
            verify_evidence(conn, &input.execution_id, &branch.branch, evidence)?;
            ("verified", Some(serde_json::to_string(evidence).map_err(|e| e.to_string())?), None)
        } else {
            if input.waiting_inventory == Some(true) && !branch.branch.criteria.iter().any(|criterion| matches!(criterion, BackgroundCriterion::Unavailable { .. })) {
                return Err("Inventory-change waiting requires a declared unavailable capability".into());
            }
            if let Some(tool) = &input.waiting_tool {
                if !branch.branch.criteria.iter().any(|criterion| matches!(criterion, BackgroundCriterion::Operation { tool: name, .. } if name == tool)) {
                    return Err("An automatic wait must name the branch's exact declared operation tool".into());
                }
            }
            let reason = input.waiting_reason.as_deref().map(str::trim).filter(|reason| !reason.is_empty() && reason.len() <= 2048)
                .ok_or_else(|| "A waiting branch needs its actual missing capability or information".to_string())?;
            ("waiting", None, Some(reason.to_string()))
        };
        if branch.state == "verified" {
            let existing = branch.evidence.as_ref().map(|evidence| serde_json::to_string(evidence).map_err(|e| e.to_string())).transpose()?;
            if state != "verified" || existing != evidence_json { return Err("Verified branch evidence is immutable".into()); }
        } else {
            conn.execute("DELETE FROM automation_background_child_waits WHERE execution_id = ?1 AND branch_id = ?2",
                params![input.execution_id, input.branch_id]).map_err(|e|e.to_string())?;
            conn.execute("DELETE FROM automation_background_cloud_waits WHERE execution_id = ?1 AND branch_id = ?2",
                params![input.execution_id, input.branch_id]).map_err(|e|e.to_string())?;
            conn.execute("DELETE FROM automation_background_wait_conditions WHERE execution_id = ?1 AND branch_id = ?2",
                params![input.execution_id, input.branch_id]).map_err(|e| e.to_string())?;
            if input.waiting_tool.is_some() || input.waiting_inventory == Some(true) {
                conn.execute("INSERT INTO automation_background_wait_conditions (execution_id, branch_id, tool_name, inventory_change) VALUES (?1, ?2, ?3, ?4)",
                    params![input.execution_id, input.branch_id, input.waiting_tool, input.waiting_inventory.unwrap_or(false)]).map_err(|e| e.to_string())?;
            }
            conn.execute(
                "INSERT INTO automation_background_outcomes (execution_id, branch_id, state, evidence_json, reason, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(execution_id, branch_id) DO UPDATE SET state = excluded.state, evidence_json = excluded.evidence_json, reason = excluded.reason, updated_at = excluded.updated_at",
                params![input.execution_id, input.branch_id, state, evidence_json, reason, db::now_ms()],
            ).map_err(|e| e.to_string())?;
        }
        let report = Self::background_outcome_report(conn, &input.execution_id)?.ok_or_else(|| "Outcome plan disappeared".to_string())?;
        Ok(report)
    }

    /// Append concrete criteria for a formerly unavailable capability. Never
    /// edit the accepted original requirements or any completed proof.
    pub fn resolve_background_plan(&self, input: SaveBackgroundPlanInput, tools: &[String],
        verify: impl FnOnce(&Connection, &str) -> Result<(), String>,
    ) -> Result<BackgroundOutcomeReport, String> {
        validate_plan(&input.plan)?;
        if tools.len() > 2048 || tools.iter().any(|tool| tool.len() > 256) { return Err("Invalid actual tool inventory".into()); }
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        Self::require_background_execution(&tx, &input.execution_id, input.lease.as_ref())?;
        verify(&tx, &input.execution_id)?;
        Self::validate_background_source_plan(&tx, &input.execution_id, &input.plan)?;
        if Self::has_uncertain_operations(&tx, &input.execution_id)? { return Err("Reconcile external outcomes before resolving unavailable criteria".into()); }
        let report = Self::background_outcome_report(&tx, &input.execution_id)?.ok_or_else(|| "Missing original outcome plan".to_string())?;
        if input.plan.branches.len() != report.branches.len() { return Err("Capability resolution cannot drop or add requirements".into()); }
        for (next, previous) in input.plan.branches.iter().zip(&report.branches) {
            let original = &previous.branch;
            if next.id != original.id || next.title != original.title || next.requirement != original.requirement || next.depends_on != original.depends_on {
                return Err("Capability resolution must preserve exact original requirements and dependencies".into());
            }
            if next.criteria == original.criteria { continue; }
            if previous.state != "waiting" || !original.criteria.iter().any(|criterion| matches!(criterion, BackgroundCriterion::Unavailable { .. })) {
                return Err("Only waiting unavailable criteria can be resolved".into());
            }
            for criterion in &original.criteria {
                if !matches!(criterion, BackgroundCriterion::Unavailable { .. }) && !next.criteria.contains(criterion) {
                    return Err("Capability resolution cannot weaken existing criteria".into());
                }
            }
            for criterion in &next.criteria {
                match criterion {
                    BackgroundCriterion::Unavailable { .. } => return Err("A capability resolution must provide concrete evidence criteria".into()),
                    BackgroundCriterion::Answer if !original.criteria.contains(criterion) => return Err("An unavailable action or file cannot become a text claim".into()),
                    BackgroundCriterion::Operation { tool, .. } if !tools.contains(tool) && !original.criteria.contains(criterion) => return Err("Capability resolution invented an unavailable tool".into()),
                    _ => {}
                }
            }
            tx.execute("INSERT INTO automation_background_plan_resolutions (execution_id, branch_id, criteria_json, created_at) VALUES (?1, ?2, ?3, ?4)",
                params![input.execution_id, next.id, serde_json::to_string(&next.criteria).map_err(|e| e.to_string())?, db::now_ms()]).map_err(|e| e.to_string())?;
            tx.execute("UPDATE automation_background_outcomes SET state = 'pending', reason = NULL, updated_at = ?3 WHERE execution_id = ?1 AND branch_id = ?2 AND state = 'waiting'",
                params![input.execution_id, next.id, db::now_ms()]).map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM automation_background_wait_conditions WHERE execution_id = ?1 AND branch_id = ?2", params![input.execution_id, next.id]).map_err(|e| e.to_string())?;
        }
        let report = Self::background_outcome_report(&tx, &input.execution_id)?.ok_or_else(|| "Missing resolved plan".to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(report)
    }
}
