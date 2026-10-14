use serde_json::json;

use super::db;
use super::store::AutomationStore;
use super::types::*;
use super::validate::validate_cron_expression;

fn parent_lease(store: &AutomationStore, input: &SubmitBackgroundTaskInput) -> Option<BackgroundExecutionLease> {
    input.delegation.as_ref().and_then(|d| store.background_task(&d.parent_request_id).ok())
        .and_then(|task| store.debug_background_lease(&task.run.id))
}

fn background_input() -> SubmitBackgroundTaskInput {
    SubmitBackgroundTaskInput {
        intelligent_scheduling_enabled: false, request_id: uuid::Uuid::new_v4().to_string(), name: "Report".into(),
        prompt: "Create the requested report".into(), provider_id: "provider-a".into(),
        model: "model-a".into(), workdir: std::env::temp_dir().to_string_lossy().into_owned(),
        timeout_seconds: 300, reasoning: "medium".into(), files: Vec::new(), delegation: None, requirements: None, source_context: None, goal_binding: None,
    }
}

#[test]
fn original_request_version_is_explicit_and_legacy_source_serialization_stays_unchanged() {
    let mut source: BackgroundSourceContext = serde_json::from_value(json!({
        "version": 1, "requestScope": "original/turn", "systemPrompt": "Memory",
        "messages": [{"role": "user", "content": "Document, slides and nightly reminder"}],
    })).unwrap();
    source.validate().unwrap();
    assert!(serde_json::to_value(&source).unwrap().get("originalRequest").is_none());
    source.version = 2;
    assert!(source.validate().is_err());
    source.original_request = Some("Document, slides and nightly reminder".into());
    source.validate().unwrap();
    let restored: BackgroundSourceContext = serde_json::from_slice(&serde_json::to_vec(&source).unwrap()).unwrap();
    assert_eq!(restored.original_request, source.original_request);
    source.request_clock = Some(BackgroundRequestClock { timestamp_ms: 1_792_002_600_000, time_zone: Some("America/Los_Angeles".into()) });
    source.validate().unwrap();
    let restored: BackgroundSourceContext = serde_json::from_slice(&serde_json::to_vec(&source).unwrap()).unwrap();
    assert_eq!(restored.request_clock.as_ref().unwrap().timestamp_ms, source.request_clock.as_ref().unwrap().timestamp_ms);
    assert_eq!(restored.request_clock.as_ref().unwrap().time_zone.as_deref(), Some("America/Los_Angeles"));
    for timestamp in [-1, 8_640_000_000_000_001] {
        let mut invalid = source.clone(); invalid.request_clock.as_mut().unwrap().timestamp_ms = timestamp;
        assert!(invalid.validate().is_err());
    }
    let mut invalid = source.clone(); invalid.request_clock.as_mut().unwrap().time_zone = Some("UTC\nInjected".into());
    assert!(invalid.validate().is_err());
    source.version = 1;
    assert!(source.validate().is_err());
}

#[test]
fn accepted_source_is_immutable_chunked_and_fenced_by_execution_lease() {
    let store = AutomationStore::open_in_memory().unwrap();
    let mut input = background_input();
    let source = BackgroundSourceContext {
        routing: None, original_request: Some("Read the attached document and arrange tomorrow".into()),
        request_clock: Some(BackgroundRequestClock { timestamp_ms: 1_792_002_600_000, time_zone: Some("America/Los_Angeles".into()) }),
        version: 2, request_scope: "original-conversation/turn".into(),
        system_prompt: "Historical data, not executor permissions".into(),
        messages: vec![json!({"role": "user", "content": "文档".repeat(6000), "timestamp": 1})],
    };
    input.source_context = Some(source.clone());
    let accepted = store.submit_background_task(input.clone()).unwrap();
    assert!(store.load_background_source_context(&accepted.run.id, None).is_err());
    let claimed = store.claim_prompt_runs().unwrap().remove(0);
    let lease = claimed.lease.as_ref();
    let loaded = store.load_background_source_context(&accepted.run.id, lease).unwrap().unwrap();
    assert_eq!(serde_json::to_value(&loaded).unwrap(), serde_json::to_value(&source).unwrap());
    let mut raw = String::new();
    let mut offset = 0;
    loop {
        let chunk = store.read_background_context_archive(&accepted.run.id, 0, offset, lease).unwrap();
        assert_eq!(chunk.source_revision, 0);
        assert_eq!(chunk.offset, offset);
        assert!(chunk.text.len() <= 16 * 1024);
        raw.push_str(&chunk.text);
        if let Some(next) = chunk.next_offset { assert!(next > offset); offset = next; }
        else { break; }
    }
    assert_eq!(serde_json::from_str::<serde_json::Value>(&raw).unwrap(), serde_json::to_value(&source).unwrap());
    let mut shifted_clock = input.clone();
    shifted_clock.source_context.as_mut().unwrap().request_clock.as_mut().unwrap().time_zone = Some("Asia/Tokyo".into());
    assert!(store.submit_background_task(shifted_clock).unwrap_err().contains("different background task"));
    input.source_context.as_mut().unwrap().system_prompt = "Replacement history".into();
    assert!(store.submit_background_task(input).unwrap_err().contains("different background task"));
    store.cancel_background_task(&accepted.request_id).unwrap();
    assert!(store.load_background_source_context(&accepted.run.id, lease).is_err());
    assert!(store.read_background_context_archive(&accepted.run.id, 0, 0, lease).is_err());
}

#[test]
fn source_device_constraints_survive_intake_and_forbid_remote_completion_or_capability_rebinding() {
    let store = AutomationStore::open_in_memory().unwrap();
    let source_host = uuid::Uuid::new_v4().to_string();
    let mut input = background_input();
    let routing = BackgroundSourceRouting { version: 1, initiating_host_id: source_host,
        branches: vec![
            BackgroundSourceBranch {observation:None, id: "report".into(), requirement: "Create the report".into(), depends_on: vec![], locality: "portable".into() },
            BackgroundSourceBranch {observation:None, id: "calendar".into(), requirement: "Arrange tomorrow on the original phone".into(), depends_on: vec![], locality: "initiating-device".into() },
        ] };
    input.source_context = Some(BackgroundSourceContext { version: 1, original_request: None, request_clock: None, request_scope: "phone/turn".into(), system_prompt: String::new(),
        messages: vec![json!({"role":"user", "content":"Report plus phone calendar"})], routing: Some(routing.clone()) });
    let proof = BackgroundDeviceChannelProof { version: 1, initiating_host_id: routing.initiating_host_id.clone(), token: "a".repeat(64) };
    let accepted = store.submit_background_task_with_device_channel(input.clone(), Some(&proof), |_, _| Ok("test-binding".into())).unwrap();
    let lease = store.claim_prompt_runs().unwrap().remove(0).lease.unwrap();
    let branch = |id: &str, requirement: &str, criterion| BackgroundBranch { id: id.into(), title: id.into(), requirement: requirement.into(), depends_on: vec![], criteria: vec![criterion] };
    let legitimate = BackgroundTaskPlan { version: 1, branches: vec![
        branch("report", "Create the report", BackgroundCriterion::Answer),
        branch("calendar", "Arrange tomorrow on the original phone", BackgroundCriterion::Unavailable { capability: "Original phone needed".into() }),
    ] };
    let commit = |plan| SaveBackgroundPlanInput { execution_id: accepted.run.id.clone(), lease: Some(lease.clone()), plan };
    let mut dropped = legitimate.clone(); dropped.branches.pop();
    assert!(store.save_background_plan(commit(dropped), |_, _| Ok(())).is_err());
    for criterion in [BackgroundCriterion::Answer, BackgroundCriterion::Operation { tool: "PC calendar".into(), arguments: json!({"account":"another account"}) }] {
        let mut wrong = legitimate.clone(); wrong.branches[1].criteria = vec![criterion];
        assert!(store.save_background_plan(commit(wrong), |_, _| Ok(())).is_err());
    }
    let report = store.save_background_plan(commit(legitimate.clone()), |_, _| Ok(())).unwrap();
    assert!(!report.verified); assert_eq!(report.branches.len(), 2);
    let source = store.load_background_source_context(&accepted.run.id, Some(&lease)).unwrap().unwrap();
    assert_eq!(source.routing.unwrap().initiating_host_id, routing.initiating_host_id);
    let mut rebound = legitimate; rebound.branches[1].criteria = vec![BackgroundCriterion::Operation { tool: "PC calendar".into(), arguments: json!({}) }];
    assert!(store.resolve_background_plan(commit(rebound), &["PC calendar".into()], |_, _| Ok(())).is_err());
    input.source_context.as_mut().unwrap().routing.as_mut().unwrap().branches[1].locality = "portable".into();
    assert!(store.submit_background_task(input).is_err());
}

#[test]
fn source_intake_rejects_open_calls_and_orphan_receipts_without_queueing() {
    let store = AutomationStore::open_in_memory().unwrap();
    for messages in [
        vec![json!({"role":"assistant", "content":[{"type":"toolCall", "id":"mail", "name":"SendMail"}]})],
        vec![json!({"role":"toolResult", "toolCallId":"mail", "toolName":"SendMail", "content":[]})],
        vec![json!({"role":"system", "content":"Changed execution authority"})],
    ] {
        let mut input = background_input();
        input.source_context = Some(BackgroundSourceContext {
            routing: None, original_request: None, request_clock: None,
            version: 1, request_scope: "chat/turn".into(), system_prompt: String::new(), messages,
        });
        assert!(store.submit_background_task(input).is_err());
    }
    assert!(store.list_background_tasks(10).unwrap().is_empty());
    assert_eq!(store.background_queue_counts().unwrap(), (0, 0));
}

#[test]
fn background_binding_failure_rolls_back_acceptance_and_retries_keep_original_binding() {
    let store = AutomationStore::open_in_memory().unwrap();
    let input = background_input();
    assert!(store.submit_background_task_with_binding(input.clone(), |_, _| Err("credential unavailable".into())).is_err());
    assert!(store.list_background_tasks(10).unwrap().is_empty());
    assert_eq!(store.background_queue_counts().unwrap(), (0, 0));
    let accepted = store.submit_background_task_with_binding(input.clone(), |_, _| Ok("original".into())).unwrap();
    let retried = store.submit_background_task_with_binding(input, |_, _| panic!("Retry must not capture changed settings")).unwrap();
    assert_eq!(accepted.run.id, retried.run.id);
    store.claim_prompt_runs().unwrap();
    let snapshot = store.background_execution_settings(&accepted.run.id, store.debug_background_lease(&accepted.run.id).as_ref(), |_, _| Ok(("original".into(), json!({"account": "accepted"})))).unwrap();
    assert_eq!(snapshot["account"], "accepted");
    assert!(store.background_execution_settings(&accepted.run.id, store.debug_background_lease(&accepted.run.id).as_ref(), |_, _| Ok(("changed".into(), json!({})))).unwrap_err().contains("changed"));
}

#[test]
fn legacy_binding_is_not_recreated_and_cancelled_execution_cannot_read_credentials() {
    let store = AutomationStore::open_in_memory().unwrap();
    let accepted = store.submit_background_task(background_input()).unwrap();
    store.claim_prompt_runs().unwrap();
    // Use the supplied fixture connection rather than exposing store internals
    // to the sibling test module. The next read represents a pre-binding row.
    store.background_execution_settings(&accepted.run.id, store.debug_background_lease(&accepted.run.id).as_ref(), |conn, _| {
        conn.execute("DELETE FROM automation_background_configuration_bindings", []).map_err(|e| e.to_string())?;
        Ok(("test-binding".into(), json!({})))
    }).unwrap();
    let error = store.background_execution_settings(&accepted.run.id, store.debug_background_lease(&accepted.run.id).as_ref(), |_, _| panic!("Legacy task must not read today's credentials")).unwrap_err();
    assert!(error.contains("predates"));
    store.cancel_background_task(&accepted.request_id).unwrap();
    assert!(store.background_execution_settings(&accepted.run.id, store.debug_background_lease(&accepted.run.id).as_ref(), |_, _| panic!("Cancelled task must not read credentials")).is_err());
}

#[test]
fn native_configuration_denial_leaves_no_intent_and_existing_receipts_remain_readable() {
    let store = AutomationStore::open_in_memory().unwrap();
    let accepted = store.submit_background_task(background_input()).unwrap();
    store.claim_prompt_runs().unwrap();
    store.save_background_checkpoint(SaveBackgroundCheckpointInput { lease: store.debug_background_lease(&accepted.run.id), execution_id: accepted.run.id.clone(), revision: 1,
        context: json!({"systemPrompt": "task", "messages": []}) }).unwrap();
    let input = BeginBackgroundOperationInput { lease: store.debug_background_lease(&accepted.run.id), execution_id: accepted.run.id.clone(), call_id: "mail".into(), tool_name: "mcp_send_mail".into(), arguments: json!({}) };
    assert!(store.begin_background_operation_with_configuration(input.clone(), |_, _| Err("permission revoked".into())).is_err());
    assert!(store.list_background_operations(&accepted.request_id, 0, 10).unwrap().operations.is_empty());
    ensure_test_outcome_plan(&store, &accepted.run.id, false);
    assert_eq!(store.begin_background_operation_with_configuration(input.clone(), |_, _| Ok(())).unwrap().status, "execute");
    store.complete_background_operation(CompleteBackgroundOperationInput { lease: store.debug_background_lease(&accepted.run.id), execution_id: accepted.run.id.clone(), call_id: input.call_id,
        result: json!({"role": "toolResult", "toolCallId": "mail", "toolName": "mcp_send_mail", "isError": false, "content": [{"type": "text", "text": "sent"}]}) }).unwrap();
    store.cancel_background_task(&accepted.request_id).unwrap();
    assert_eq!(store.list_background_operations(&accepted.request_id, 0, 10).unwrap().operations.len(), 1);
}

fn binary_background_input(name: &str, bytes: &[u8]) -> BackgroundInputFile {
    use base64::Engine;
    use sha2::{Digest, Sha256};
    BackgroundInputFile { name: name.into(), content_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        content_hash: hex::encode(Sha256::digest(bytes)), bytes: bytes.len() as u64 }
}

#[test]
fn delegation_context_is_persisted_in_queue_and_cycles_are_rejected_before_acceptance() {
    let first = AutomationStore::open_in_memory().unwrap();
    let second = AutomationStore::open_in_memory().unwrap();
    let root = first.submit_background_task(background_input()).unwrap();
    let claimed = first.claim_prompt_runs().unwrap();
    let context = claimed[0].background_context.as_ref().unwrap();
    assert_eq!(context.root_request_id, root.request_id);
    assert_eq!(context.host_ids, vec![first.background_worker_identity().unwrap()]);
    let mut child = background_input();
    child.delegation = Some(BackgroundDelegation { root_request_id: context.root_request_id.clone(),
        parent_request_id: context.request_id.clone(), ancestor_host_ids: context.host_ids.clone(), budget: None });
    first.require_background_delegation(&child, &second.background_worker_identity().unwrap(), parent_lease(&first, &child).as_ref()).unwrap();
    assert!(first.submit_background_task(child.clone()).unwrap_err().contains("cycle"));
    let accepted = second.submit_background_task(child.clone()).unwrap();
    assert_eq!(second.submit_background_task(child.clone()).unwrap().run.id, accepted.run.id);
    assert_eq!(accepted.delegation, child.delegation);
    let claimed = second.claim_prompt_runs().unwrap();
    let context = claimed[0].background_context.as_ref().unwrap();
    assert_eq!(context.host_ids, vec![first.background_worker_identity().unwrap(), second.background_worker_identity().unwrap()]);
    let mut back = background_input();
    back.delegation = Some(BackgroundDelegation { root_request_id: context.root_request_id.clone(),
        parent_request_id: context.request_id.clone(), ancestor_host_ids: context.host_ids.clone(), budget: None });
    assert!(first.submit_background_task(back.clone()).unwrap_err().contains("cycle"));
    assert!(second.require_background_delegation(&back, &first.background_worker_identity().unwrap(), parent_lease(&second, &back).as_ref()).unwrap_err().contains("cycle"));
    assert_eq!(first.list_background_tasks(100).unwrap().len(), 1);
    child.delegation.as_mut().unwrap().root_request_id = uuid::Uuid::new_v4().to_string();
    assert!(second.submit_background_task(child).is_err());
}

#[test]
fn outgoing_delegation_requires_exact_live_parent_and_stops_after_cancel() {
    let store = AutomationStore::open_in_memory().unwrap();
    let parent = store.submit_background_task(background_input()).unwrap();
    let peer = uuid::Uuid::new_v4().to_string();
    let mut child = background_input();
    child.delegation = Some(BackgroundDelegation { root_request_id: parent.request_id.clone(),
        parent_request_id: parent.request_id.clone(), ancestor_host_ids: vec![store.background_worker_identity().unwrap()], budget: None });
    assert!(store.require_background_delegation(&child, &peer, parent_lease(&store, &child).as_ref()).is_err());
    store.claim_prompt_runs().unwrap();
    store.require_background_delegation(&child, &peer, parent_lease(&store, &child).as_ref()).unwrap();
    for field in ["root", "parent", "hosts"] {
        let mut forged = child.clone();
        let delegation = forged.delegation.as_mut().unwrap();
        match field {
            "root" => delegation.root_request_id = uuid::Uuid::new_v4().to_string(),
            "parent" => delegation.parent_request_id = uuid::Uuid::new_v4().to_string(),
            _ => delegation.ancestor_host_ids = vec![uuid::Uuid::new_v4().to_string()],
        }
        assert!(store.require_background_delegation(&forged, &peer, parent_lease(&store, &forged).as_ref()).is_err());
    }
    store.cancel_background_task(&parent.request_id).unwrap();
    assert!(store.require_background_delegation(&child, &peer, parent_lease(&store, &child).as_ref()).is_err());
}

#[test]
fn delegation_chain_bounds_and_uuid_shapes_are_validated_before_queue_write() {
    let store = AutomationStore::open_in_memory().unwrap();
    let root = uuid::Uuid::new_v4().to_string();
    let mut input = background_input();
    let hosts: Vec<String> = (0..7).map(|_| uuid::Uuid::new_v4().to_string()).collect();
    input.delegation = Some(BackgroundDelegation { root_request_id: root.clone(), parent_request_id: root,
        ancestor_host_ids: hosts.clone(), budget: None });
    store.submit_background_task(input.clone()).unwrap();
    assert_eq!(store.claim_prompt_runs().unwrap()[0].background_context.as_ref().unwrap().host_ids.len(), MAX_BACKGROUND_HOSTS);
    for bad_hosts in [Vec::new(), vec![hosts[0].clone(), hosts[0].clone()], vec!["192.168.1.1".into()],
        (0..8).map(|_| uuid::Uuid::new_v4().to_string()).collect()] {
        let mut rejected = input.clone(); rejected.request_id = uuid::Uuid::new_v4().to_string();
        rejected.delegation.as_mut().unwrap().ancestor_host_ids = bad_hosts;
        assert!(store.submit_background_task(rejected).is_err());
    }
    for self_reference in ["root", "parent"] {
        let mut rejected = input.clone(); rejected.request_id = uuid::Uuid::new_v4().to_string();
        let delegation = rejected.delegation.as_mut().unwrap();
        if self_reference == "root" { delegation.root_request_id = rejected.request_id.clone(); }
        else { delegation.parent_request_id = rejected.request_id.clone(); }
        assert!(store.submit_background_task(rejected).is_err());
    }
    assert_eq!(store.list_background_tasks(100).unwrap().len(), 1);
}

#[test]
fn legacy_background_input_omits_new_fields_and_has_same_idempotent_encoding() {
    let mut input_json = serde_json::to_value(background_input()).unwrap();
    assert!(input_json.get("delegation").is_none());
    let input: SubmitBackgroundTaskInput = serde_json::from_value(input_json.clone()).unwrap();
    assert_eq!(serde_json::to_value(input).unwrap(), input_json);
    input_json["delegation"] = json!({ "rootRequestId": "not-a-uuid", "parentRequestId": "not-a-uuid", "ancestorHostIds": [] });
    let input: SubmitBackgroundTaskInput = serde_json::from_value(input_json).unwrap();
    assert!(AutomationStore::normalize_background_task_input(input).is_err());
}

#[test]
fn accepted_inputs_are_immutable_and_materialization_requires_a_live_lease() {
    let store = AutomationStore::open_in_memory().unwrap();
    let mut input = background_input(); input.files.push(binary_background_input("spec.pdf", &[0, 255, 128]));
    let record = store.submit_background_task(input.clone()).unwrap();
    assert_eq!(record.inputs.len(), 1);
    assert_eq!(record.inputs[0].relative_path, format!(".xgent-background-inputs/{}/spec.pdf", record.run.id));
    assert!(store.background_inputs_for_execution(&record.run.id, store.debug_background_lease(&record.run.id).as_ref()).is_err());
    store.claim_prompt_runs().unwrap();
    let (_, files) = store.background_inputs_for_execution(&record.run.id, store.debug_background_lease(&record.run.id).as_ref()).unwrap();
    assert_eq!(files[0].verified_bytes().unwrap(), [0, 255, 128]);
    input.files[0] = binary_background_input("spec.pdf", &[1, 2]);
    assert!(store.submit_background_task(input).is_err());
    store.cancel_background_task(&record.request_id).unwrap();
    assert!(store.background_inputs_for_execution(&record.run.id, store.debug_background_lease(&record.run.id).as_ref()).is_err());
}

#[test]
fn input_names_hashes_and_total_quota_are_checked_before_acceptance() {
    for name in ["../escape", "sub/file", "CON.txt", "a:b", "a.", "a ", "LPT9"] {
        let mut input = background_input(); input.files.push(binary_background_input(name, b"file"));
        assert!(AutomationStore::normalize_background_task_input(input).is_err());
    }
    let mut input = background_input();
    input.files = vec![binary_background_input("same.pdf", b"one"), binary_background_input("SAME.pdf", b"two")];
    assert!(AutomationStore::normalize_background_task_input(input).is_err());
    let mut input = background_input(); input.files.push(binary_background_input("file.pdf", b"one"));
    input.files[0].content_hash = "wrong".into();
    assert!(AutomationStore::normalize_background_task_input(input).is_err());
    let bytes = vec![1; 4 * 1024 * 1024 + 1];
    let mut input = background_input(); input.files = vec![binary_background_input("a.pdf", &bytes), binary_background_input("b.pdf", &bytes)];
    assert!(AutomationStore::normalize_background_task_input(input).is_err());
}

#[test]
fn empty_input_snapshots_preserve_legacy_submission_serialization() {
    let input = background_input();
    let json = serde_json::to_value(&input).unwrap();
    assert!(json.get("files").is_none());
    assert!(serde_json::from_value::<SubmitBackgroundTaskInput>(json).unwrap().files.is_empty());
}

#[test]
fn worker_identity_and_queue_catalog_are_stable() {
    let store = AutomationStore::open_in_memory().unwrap();
    let identity = store.background_worker_identity().unwrap();
    assert_eq!(identity, store.background_worker_identity().unwrap());
    assert!(uuid::Uuid::parse_str(&identity).is_ok());
    assert_eq!(store.background_queue_counts().unwrap(), (0, 0));
    let record = store.submit_background_task(background_input()).unwrap();
    assert_eq!(record.host_id, identity);
    assert_eq!(store.background_queue_counts().unwrap(), (1, 0));
    store.claim_prompt_runs().unwrap();
    assert_eq!(store.background_queue_counts().unwrap(), (0, 1));
}

#[test]
fn task_input_normalization_is_shared_with_peer_binding() {
    let mut input = background_input();
    input.name = " Report ".into(); input.prompt = " Do real work ".into();
    input.provider_id = " provider ".into(); input.model = " model ".into();
    let normalized = AutomationStore::normalize_background_task_input(input.clone()).unwrap();
    assert_eq!(normalized.name, "Report"); assert_eq!(normalized.prompt, "Do real work");
    assert_eq!(normalized.provider_id, "provider"); assert_eq!(normalized.model, "model");
    input.prompt = " ".into();
    assert!(AutomationStore::normalize_background_task_input(input).is_err());
}

#[test]
fn copied_task_database_does_not_transfer_execution_ownership() {
    let store = AutomationStore::open_in_memory().unwrap();
    let first = uuid::Uuid::new_v4().to_string();
    store.bind_worker_identity(&first).unwrap();
    let task = store.submit_background_task(background_input()).unwrap();
    store.bind_worker_identity(&first).unwrap();
    assert_eq!(store.background_task(&task.request_id).unwrap().run.state, RunState::Pending);
    let replacement = uuid::Uuid::new_v4().to_string();
    store.bind_worker_identity(&replacement).unwrap();
    assert_eq!(store.background_worker_identity().unwrap(), replacement);
    assert_eq!(store.background_task(&task.request_id).unwrap().run.state, RunState::Expired);
    assert!(store.claim_prompt_runs().unwrap().is_empty());
}

#[test]
fn background_submission_is_idempotent_and_rejects_changed_input() {
    let store = AutomationStore::open_in_memory().unwrap();
    let input = background_input();
    let first = store.submit_background_task(input.clone()).unwrap();
    let retry = store.submit_background_task(input.clone()).unwrap();
    assert_eq!(first.run.id, retry.run.id);
    assert_eq!(store.list_background_tasks(100).unwrap().len(), 1);
    let mut changed = input;
    changed.prompt.push_str(" different requirements");
    assert!(store.submit_background_task(changed).unwrap_err().contains("different background task"));
}

#[test]
fn worker_replacement_fences_queued_claims_and_retains_original_task_identity() {
    let store = AutomationStore::open_in_memory().unwrap();
    let input = background_input();
    let task = store.submit_background_task(input.clone()).unwrap();
    let first = uuid::Uuid::new_v4().to_string();
    let second = uuid::Uuid::new_v4().to_string();
    store.install_background_worker_instance(&first).unwrap();
    store.install_background_worker_instance(&second).unwrap();
    assert!(store.claim_prompt_runs_for_worker(1, &first).unwrap_err().contains("superseded"));
    assert_eq!(store.background_task(&input.request_id).unwrap().run.state, RunState::Pending);
    let original = store.claim_prompt_runs_for_worker(1, &second).unwrap().remove(0);
    assert_eq!(original.execution_id, task.run.id);
    assert_eq!(store.recover_interrupted_prompt_runs().unwrap(), 1);
    let replacement = uuid::Uuid::new_v4().to_string();
    store.install_background_worker_instance(&replacement).unwrap();
    assert!(store.claim_prompt_runs_for_worker(1, &second).is_err());
    let resumed = store.claim_prompt_runs_for_worker(1, &replacement).unwrap().remove(0);
    assert_eq!(resumed.execution_id, original.execution_id);
    assert_eq!(resumed.lease.unwrap().attempt, original.lease.unwrap().attempt + 1);
}

#[test]
fn background_queue_survives_restart_and_retries_only_bounded_safe_attempts() {
    let store = AutomationStore::open_in_memory().unwrap();
    let input = background_input();
    let task = store.submit_background_task(input.clone()).unwrap();
    store.debug_set_run_lease(&task.run.id, 1).unwrap();
    assert!(store.sweep_expired_prompt_runs().unwrap().is_empty());
    assert_eq!(store.recover_interrupted_prompt_runs().unwrap(), 0);
    let claims = store.claim_prompt_runs_with_limit(1).unwrap();
    assert_eq!(claims.len(), 1);
    assert_eq!(claims[0].execution_id, task.run.id);
    assert!(claims[0].lease_expires_at > db::now_ms());
    assert_eq!(store.recover_interrupted_prompt_runs().unwrap(), 1);
    let second = store.claim_prompt_runs().unwrap().remove(0);
    assert_eq!(second.execution_id, task.run.id);
    assert_eq!(second.lease.unwrap().attempt, 2);
    assert_eq!(store.recover_interrupted_prompt_runs().unwrap(), 1);
    let third = store.claim_prompt_runs().unwrap().remove(0);
    assert_eq!(third.lease.unwrap().attempt, 3);
    assert_eq!(store.recover_interrupted_prompt_runs().unwrap(), 1);
    assert!(store.claim_prompt_runs().unwrap().is_empty());
    let interrupted = store.background_task(&input.request_id).unwrap();
    assert_eq!(interrupted.run.state, RunState::Expired);
    assert!(interrupted.run.output.contains("External actions may have occurred"));
}

#[test]
fn background_claims_are_bounded_and_cancellation_wins_over_late_success() {
    let store = AutomationStore::open_in_memory().unwrap();
    for _ in 0..3 { store.submit_background_task(background_input()).unwrap(); }
    assert_eq!(store.claim_prompt_runs_with_limit(100).unwrap().len(), 2);
    let task = store.list_background_tasks(100).unwrap().into_iter().find(|task| task.run.state == RunState::Leased).unwrap();
    let cancelled = store.cancel_background_task(&task.request_id).unwrap();
    assert_eq!(cancelled.run.state, RunState::Expired);
    let result = store.complete_prompt_run(CompletePromptRunInput { lease: None,
        execution_id: task.run.id, success: true, duration_ms: 1, output: "late success".into(),
    }).unwrap();
    assert_eq!(result.status, PromptCompletionStatus::AlreadyFinished);
    assert!(store.background_task(&task.request_id).unwrap().run.output.contains("cancelled"));
}

#[test]
fn background_artifacts_are_immutable_task_scoped_snapshots() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("report.docx");
    std::fs::write(&file, [0_u8, 255, 17, 128]).unwrap();
    let store = AutomationStore::open_in_memory().unwrap();
    let mut input = background_input();
    input.workdir = dir.path().to_string_lossy().into_owned();
    let task = store.submit_background_task(input.clone()).unwrap();
    assert!(store.publish_background_artifact(&task.run.id, "report.docx", None, store.debug_background_lease(&task.run.id).as_ref()).is_err());
    store.claim_prompt_runs().unwrap();
    assert!(store.publish_background_artifact(&task.run.id, "report.docx", Some("wrong-hash"), store.debug_background_lease(&task.run.id).as_ref()).is_err());
    let artifact = store.publish_background_artifact(&task.run.id, "report.docx", None, store.debug_background_lease(&task.run.id).as_ref()).unwrap();
    assert_eq!(store.publish_background_artifact(&task.run.id, "report.docx", None, store.debug_background_lease(&task.run.id).as_ref()).unwrap().id, artifact.id);
    std::fs::write(&file, "changed later").unwrap();
    std::fs::remove_file(&file).unwrap();
    let saved = store.read_background_artifact(&input.request_id, &artifact.id).unwrap();
    assert_eq!(saved.content_base64, "AP8RgA==");
    assert_eq!(saved.artifact.bytes, 4);
    assert!(store.read_background_artifact(&uuid::Uuid::new_v4().to_string(), &artifact.id).is_err());
    assert_eq!(store.background_task(&input.request_id).unwrap().artifacts.len(), 1);
    store.cancel_background_task(&input.request_id).unwrap();
    assert!(store.publish_background_artifact(&task.run.id, "report.docx", None, store.debug_background_lease(&task.run.id).as_ref()).is_err());
    assert!(store.read_background_artifact(&input.request_id, &artifact.id).is_ok());
}

#[test]
fn background_artifacts_reject_workspace_escape_and_expired_lease() {
    let dir = tempfile::tempdir().unwrap();
    let outside = tempfile::NamedTempFile::new().unwrap();
    let store = AutomationStore::open_in_memory().unwrap();
    let mut input = background_input();
    input.workdir = dir.path().to_string_lossy().into_owned();
    let task = store.submit_background_task(input).unwrap();
    store.claim_prompt_runs().unwrap();
    assert!(store.publish_background_artifact(&task.run.id, outside.path().to_str().unwrap(), None, store.debug_background_lease(&task.run.id).as_ref()).unwrap_err().contains("inside the task workspace"));
    std::fs::write(dir.path().join("report.html"), "real file").unwrap();
    store.debug_set_run_lease(&task.run.id, 1).unwrap();
    assert!(store.publish_background_artifact(&task.run.id, "report.html", None, store.debug_background_lease(&task.run.id).as_ref()).is_err());
}

fn leased_background() -> (AutomationStore, BackgroundTaskRecord) {
    let store = AutomationStore::open_in_memory().unwrap();
    let input = background_input();
    store.submit_background_task(input.clone()).unwrap();
    store.claim_prompt_runs().unwrap();
    let task = store.background_task(&input.request_id).unwrap();
    (store, task)
}

#[test]
fn background_restart_restores_checkpoint_receipts_and_revokes_old_writer() {
    let (store, task) = leased_background();
    let old = store.debug_background_lease(&task.run.id).unwrap();
    store.save_background_checkpoint(checkpoint(&store, &task.run.id, 1)).unwrap();
    store.begin_background_operation(operation(&store, &task.run.id)).unwrap();
    store.complete_background_operation(operation_receipt(&store, &task.run.id)).unwrap();
    assert_eq!(store.recover_interrupted_prompt_runs().unwrap(), 1);
    let next = store.claim_prompt_runs().unwrap().remove(0);
    let lease = next.lease.unwrap();
    assert_eq!(lease.attempt, 2);
    assert!(lease.generation > old.generation);
    let mut stale = checkpoint(&store, &task.run.id, 2);
    stale.lease = Some(old.clone());
    assert!(store.save_background_checkpoint(stale).is_err());
    assert!(store.restore_background_checkpoint(&task.run.id, Some(&old), |_, _| panic!("Stale caller must not access configuration")).is_err());
    let restored = store.restore_background_checkpoint(&task.run.id, Some(&lease), |_, _| Ok(())).unwrap();
    assert_eq!(restored.revision, 1);
    assert!(restored.context.is_some());
    assert_eq!(store.begin_background_operation(operation(&store, &task.run.id)).unwrap().status, "returned");
    assert_eq!(store.background_task(&task.request_id).unwrap().operations.returned, 1);
}

#[test]
fn background_restart_never_requeues_unknown_effects_or_cancelled_work() {
    for completed in [false, true] {
        let (store, task) = leased_background();
        store.save_background_checkpoint(checkpoint(&store, &task.run.id, 1)).unwrap();
        store.begin_background_operation(operation(&store, &task.run.id)).unwrap();
        if completed {
            let mut receipt = operation_receipt(&store, &task.run.id);
            receipt.result["isError"] = serde_json::json!(true);
            receipt.result["details"] = serde_json::json!({"outcomeUncertain": true});
            store.complete_background_operation(receipt).unwrap();
        }
        assert_eq!(store.recover_interrupted_prompt_runs().unwrap(), 1);
        assert!(store.claim_prompt_runs().unwrap().is_empty());
        assert_eq!(store.background_task(&task.request_id).unwrap().run.state, RunState::Expired);
    }
    let (store, task) = leased_background();
    store.cancel_background_task(&task.request_id).unwrap();
    assert_eq!(store.recover_interrupted_prompt_runs().unwrap(), 0);
    assert!(store.claim_prompt_runs().unwrap().is_empty());
}

#[test]
fn background_reclaim_rejects_old_callbacks_and_counters_without_the_new_token() {
    let store = AutomationStore::open_in_memory().unwrap();
    let accepted = store.submit_background_task(background_input()).unwrap();
    let first = store.claim_prompt_runs().unwrap().remove(0);
    let old = first.lease.unwrap();
    assert_eq!((old.attempt, old.generation), (1, 1));
    store.release_prompt_run(&accepted.run.id, Some(&old)).unwrap();
    let second = store.claim_prompt_runs().unwrap().remove(0);
    let current = second.lease.unwrap();
    assert_eq!((current.attempt, current.generation), (2, 2));
    assert_ne!(old.token, current.token);
    assert!(store.release_prompt_run(&accepted.run.id, Some(&old)).is_err());
    let mut stale_checkpoint = checkpoint(&store, &accepted.run.id, 1);
    stale_checkpoint.lease = Some(old.clone());
    assert!(store.save_background_checkpoint(stale_checkpoint).is_err());
    let mut forged = checkpoint(&store, &accepted.run.id, 1);
    forged.lease.as_mut().unwrap().token = old.token.clone();
    assert!(store.save_background_checkpoint(forged).is_err());
    let mut no_lease = checkpoint(&store, &accepted.run.id, 1);
    no_lease.lease = None;
    assert!(store.save_background_checkpoint(no_lease).is_err());
    let mut stale_action = operation(&store, &accepted.run.id);
    stale_action.lease = Some(old.clone());
    assert!(store.begin_background_operation_with_configuration(stale_action, |_, _| panic!("Old caller must not read configuration")).is_err());
    assert!(store.background_execution_settings(&accepted.run.id, Some(&old), |_, _| panic!("Old caller must not read credentials")).is_err());
    assert!(store.background_inputs_for_execution(&accepted.run.id, Some(&old)).is_err());
    assert!(store.list_background_compactions(&accepted.run.id, 0, Some(&old)).is_err());
    assert!(store.publish_background_artifact(&accepted.run.id, "report.docx", None, Some(&old)).is_err());
    let mut stale_conclusion = conclusion(&store, &accepted.run.id);
    stale_conclusion.lease = Some(old.clone());
    assert!(store.stage_prompt_completion(stale_conclusion).is_err());
    let mut child = background_input();
    child.delegation = Some(BackgroundDelegation {
        root_request_id: accepted.request_id.clone(), parent_request_id: accepted.request_id.clone(),
        ancestor_host_ids: vec![store.background_worker_identity().unwrap()],
        budget: None,
    });
    let peer = uuid::Uuid::new_v4().to_string();
    assert!(store.require_background_delegation(&child, &peer, Some(&old)).is_err());
    store.require_background_delegation(&child, &peer, Some(&current)).unwrap();
    assert_eq!(store.background_task(&accepted.request_id).unwrap().checkpoint_revision, 0);
    assert_eq!(store.save_background_checkpoint(checkpoint(&store, &accepted.run.id, 1)).unwrap(), 1);
    store.begin_background_operation(operation(&store, &accepted.run.id)).unwrap();
}

#[test]
fn cancelled_operation_accepts_only_its_original_attempt_receipt_and_never_reopens() {
    let (store, task) = leased_background();
    store.save_background_checkpoint(checkpoint(&store, &task.run.id, 1)).unwrap();
    store.begin_background_operation(operation(&store, &task.run.id)).unwrap();
    let receipt = operation_receipt(&store, &task.run.id);
    store.cancel_background_task(&task.request_id).unwrap();
    let mut other = receipt.clone();
    let lease = other.lease.as_mut().unwrap();
    lease.attempt += 1;
    lease.generation += 1;
    lease.token = uuid::Uuid::new_v4().to_string();
    assert!(store.complete_background_operation(other).is_err());
    assert_eq!(store.background_task(&task.request_id).unwrap().operations.in_flight, 1);
    store.complete_background_operation(receipt.clone()).unwrap();
    store.complete_background_operation(receipt).unwrap();
    let final_task = store.background_task(&task.request_id).unwrap();
    assert_eq!(final_task.run.state, RunState::Expired);
    assert_eq!(final_task.operations.returned, 1);
    assert!(store.claim_prompt_runs().unwrap().is_empty());
}

#[test]
fn current_fenced_completion_outbox_settles_after_expiry_without_another_claim() {
    let (store, task) = leased_background();
    let input = conclusion(&store, &task.run.id);
    store.stage_prompt_completion(input.clone()).unwrap();
    let mut invalid = input.clone();
    invalid.lease = None;
    assert!(store.stage_prompt_completion(invalid).is_err());
    store.debug_set_run_lease(&task.run.id, 1).unwrap();
    assert!(store.claim_prompt_runs().unwrap().is_empty());
    assert_eq!(store.flush_prompt_completion_outbox().unwrap(), 1);
    let completed = store.background_task(&task.request_id).unwrap();
    assert_eq!(completed.run.state, RunState::Done);
    assert_eq!(completed.run.output, input.output);
}

#[test]
fn stale_compaction_authority_cannot_archive_or_replace_current_context() {
    let (store, task, _, mut input) = compaction_fixture();
    input.lease.as_mut().unwrap().token = uuid::Uuid::new_v4().to_string();
    assert!(store.compact_background_context(input, |_, _| panic!("Stale caller must stop before configuration read")).is_err());
    assert_eq!(store.background_task(&task.request_id).unwrap().checkpoint_revision, 1);
    assert!(store.list_background_compactions(&task.run.id, 0, store.debug_background_lease(&task.run.id).as_ref()).unwrap().compactions.is_empty());
}

fn cloud_launch_settings() -> serde_json::Value {
    json!({"access":{"cloudExecutionEnabled":true,"githubOwner":"original-owner","githubRepository":"agent-temp","cloudArtifactRetentionDays":7},"system":{"toolPolicies":{}}})
}

#[test]
fn cloud_launch_reserves_once_and_native_ack_is_durable_before_frontend_delivery() {
    let (store,task)=leased_background();
    let lease=store.debug_background_lease(&task.run.id).unwrap();
    store.save_background_checkpoint(checkpoint(&store,&task.run.id,1)).unwrap();
    let mut intent=operation(&store,&task.run.id);
    intent.tool_name="CloudTaskManager".into();intent.arguments=json!({"action":"start","runner":"ubuntu-latest","script":"actual work"});
    store.begin_background_operation(intent.clone()).unwrap();
    let load=|_:&rusqlite::Connection,_:&SubmitBackgroundTaskInput|Ok(("test-binding".into(),cloud_launch_settings()));
    assert!(store.prepare_background_cloud_launch(&task.run.id,&intent.call_id,&lease,false,load).is_err());
    let first=store.prepare_background_cloud_launch(&task.run.id,&intent.call_id,&lease,true,load).unwrap();
    assert!(first.execute);
    let duplicate=store.prepare_background_cloud_launch(&task.run.id,&intent.call_id,&lease,true,load).unwrap();
    assert!(!duplicate.execute);assert_eq!(first.task_id,duplicate.task_id);
    let actual=crate::services::cloud_execution::CloudTaskStartResult{task_id:first.task_id,owner:"original-owner".into(),repository:"agent-temp".into(),runner:"ubuntu-latest".into(),repository_url:"https://github.com/original-owner/agent-temp".into(),repository_visibility:"public".into(),observed_run_id:None};
    let mut wrong=actual.clone();wrong.task_id="task-other".into();
    assert!(store.acknowledge_background_cloud_launch(&task.run.id,&intent.call_id,&lease,&wrong).is_err());
    let receipt=store.acknowledge_background_cloud_launch(&task.run.id,&intent.call_id,&lease,&actual).unwrap();
    assert_eq!(store.begin_background_operation(intent.clone()).unwrap().result,Some(receipt.clone()));
    assert_eq!(store.prepare_background_cloud_launch(&task.run.id,&intent.call_id,&lease,false,load).unwrap().receipt,Some(receipt.clone()));
    assert_eq!(store.acknowledge_background_cloud_launch(&task.run.id,&intent.call_id,&lease,&actual).unwrap(),receipt);
    store.complete_background_operation(CompleteBackgroundOperationInput{execution_id:task.run.id.clone(),call_id:intent.call_id.clone(),lease:Some(lease),result:receipt}).unwrap();
    assert_eq!(store.recover_interrupted_prompt_runs().unwrap(),1);
    assert_eq!(store.claim_prompt_runs().unwrap().len(),1);
}

#[test]
fn cloud_launch_unknown_does_not_replay_and_late_native_ack_never_reopens_cancelled_task() {
    let (store,task)=leased_background();let lease=store.debug_background_lease(&task.run.id).unwrap();
    store.save_background_checkpoint(checkpoint(&store,&task.run.id,1)).unwrap();
    let mut intent=operation(&store,&task.run.id);intent.tool_name="CloudTaskManager".into();intent.arguments=json!({"action":"start","runner":"ubuntu-latest","script":"actual work"});
    store.begin_background_operation(intent.clone()).unwrap();
    let load=|_:&rusqlite::Connection,_:&SubmitBackgroundTaskInput|Ok(("test-binding".into(),cloud_launch_settings()));
    let reserved=store.prepare_background_cloud_launch(&task.run.id,&intent.call_id,&lease,true,load).unwrap();
    assert!(store.prepare_background_cloud_launch(&task.run.id,&intent.call_id,&lease,false,|_,_|Ok(("changed-binding".into(),cloud_launch_settings()))).is_err());
    let mut replaced=lease.clone();replaced.token="other-token".into();
    assert!(store.prepare_background_cloud_launch(&task.run.id,&intent.call_id,&replaced,true,load).is_err());
    store.cancel_background_task(&task.request_id).unwrap();
    let actual=crate::services::cloud_execution::CloudTaskStartResult{task_id:reserved.task_id,owner:"original-owner".into(),repository:"agent-temp".into(),runner:"ubuntu-latest".into(),repository_url:"https://github.com/original-owner/agent-temp".into(),repository_visibility:"public".into(),observed_run_id:None};
    assert!(store.acknowledge_background_cloud_launch(&task.run.id,&intent.call_id,&lease,&actual).is_ok());
    assert!(store.prepare_background_cloud_launch(&task.run.id,&intent.call_id,&lease,false,load).is_err());
    assert!(store.claim_prompt_runs().unwrap().is_empty());
}

fn interrupted_cloud_fixture() -> (AutomationStore,BackgroundTaskRecord,BeginBackgroundOperationInput,crate::services::cloud_execution::CloudTaskStartResult) {
    let (store,task)=leased_background();
    let mut intent=operation(&store,&task.run.id);intent.tool_name="CloudTaskManager".into();intent.arguments=json!({"action":"start","runner":"ubuntu-latest","script":"actual work"});
    let mut snapshot=checkpoint(&store,&task.run.id,1);
    snapshot.context=json!({"systemPrompt":"Original instructions","messages":[{"role":"user","content":background_input().prompt,"timestamp":1},{"role":"assistant","stopReason":"toolUse","timestamp":2,"content":[{"type":"toolCall","id":intent.call_id,"name":intent.tool_name,"arguments":intent.arguments}]}]});
    store.save_background_checkpoint(snapshot).unwrap();store.begin_background_operation(intent.clone()).unwrap();
    let launch=store.prepare_background_cloud_launch(&task.run.id,&intent.call_id,intent.lease.as_ref().unwrap(),true,|_,_|Ok(("test-binding".into(),cloud_launch_settings()))).unwrap();
    let result=crate::services::cloud_execution::CloudTaskStartResult{task_id:launch.task_id,owner:"original-owner".into(),repository:"agent-temp".into(),runner:"ubuntu-latest".into(),repository_url:"https://github.com/original-owner/agent-temp".into(),repository_visibility:"public".into(),observed_run_id:None};
    (store,task,intent,result)
}

#[test]
fn explicit_cloud_cancellation_keeps_unknown_start_and_acceptance_pending_until_actual_terminal_get() {
    let (store,task,intent,result) = interrupted_cloud_fixture();
    let stopped = store.cancel_background_task(&task.request_id).unwrap();
    assert_eq!(stopped.run.state,RunState::Expired);
    assert_eq!(stopped.cloud_cancellation.pending,1);
    let due = store.due_background_cloud_cancellations().unwrap();
    assert_eq!(due.len(),1);
    let (id,call,probe) = &due[0];
    let load = |_: &rusqlite::Connection,_: &SubmitBackgroundTaskInput| Ok(("test-binding".to_string(),cloud_launch_settings()));
    assert!(store.prepare_background_cloud_cancellation(id,call,probe,|_,_|Ok(("replaced-account".into(),cloud_launch_settings()))).is_err());
    let (target,known) = store.prepare_background_cloud_cancellation(id,call,probe,load).unwrap();
    assert_eq!(target.task_id,result.task_id); assert_eq!(known,None);
    let mut status = crate::services::cloud_execution::CloudTaskStatus { task_id: result.task_id.clone(),state: "in_progress".into(),conclusion: None,run_id: Some(42),run_url: None,updated_at: None };
    assert!(!store.record_background_cloud_cancellation(id,call,probe,&status,false,load).unwrap());
    assert_eq!(store.prepare_background_cloud_cancellation(id,call,probe,load).unwrap().1,Some(42));
    assert!(!store.record_background_cloud_cancellation(id,call,probe,&status,true,load).unwrap());
    assert_eq!(store.background_task(&task.request_id).unwrap().cloud_cancellation.pending,1);
    assert_eq!(store.prepare_background_cloud_cancellation(id,call,probe,load).unwrap().1,Some(42));
    status.run_id = Some(99); status.state = "completed".into();
    assert!(store.record_background_cloud_cancellation(id,call,probe,&status,false,load).is_err());
    status.run_id = Some(42); status.conclusion = Some("success".into());
    assert!(store.record_background_cloud_cancellation(id,call,probe,&status,false,load).unwrap());
    let final_task = store.background_task(&task.request_id).unwrap();
    assert_eq!(final_task.run.state,RunState::Expired); assert!(!final_task.run.success);
    assert_eq!(final_task.cloud_cancellation.pending,0); assert_eq!(final_task.cloud_cancellation.observed_terminal,1);
    assert_eq!(final_task.operations.in_flight,1); // Never manufacture a START receipt.
    assert!(store.due_background_cloud_cancellations().unwrap().is_empty());
    assert!(store.record_background_cloud_cancellation(id,call,probe,&status,false,load).is_err());
    assert!(store.begin_background_operation(intent).is_err());
}

#[test]
fn runtime_cloud_parking_preserves_original_intent_diagnostics_and_ack_retry() {
    let (store,task,intent,mut result)=interrupted_cloud_fixture();
    let lease=intent.lease.as_ref().unwrap();
    let load=|_:&rusqlite::Connection,_:&SubmitBackgroundTaskInput|Ok(("test-binding".to_string(),cloud_launch_settings()));
    store.record_native_cloud_launch_failure(&task.run.id,&intent.call_id,lease,"Actual dispatch response lost").unwrap();
    store.record_native_cloud_launch_failure(&task.run.id,&intent.call_id,lease,"Later error").unwrap();
    let before:String=store.lock_conn().unwrap().query_row("SELECT context_json FROM automation_background_checkpoints WHERE execution_id = ?1",rusqlite::params![task.run.id],|row|row.get(0)).unwrap();
    assert!(store.park_unconfirmed_background_cloud_start(&task.run.id,&intent.call_id,lease,load).unwrap());
    let parked=store.background_task(&task.request_id).unwrap();
    assert_eq!(parked.run.state,RunState::Waiting);assert_eq!(parked.operations.in_flight,1);assert_eq!(parked.operations.errors,0);
    let recovery=parked.cloud_recovery.unwrap();assert_eq!(recovery.task_id,result.task_id);assert_eq!(recovery.launch_error.as_deref(),Some("Actual dispatch response lost"));
    assert!(store.park_unconfirmed_background_cloud_start(&task.run.id,&intent.call_id,lease,|_,_|panic!("ACK retry must not reload or perform effects")).unwrap());
    assert_eq!(store.background_task(&task.request_id).unwrap().waiting.unwrap().wait_id,recovery.wait_id);
    let mut replacement=lease.clone();replacement.token="other-token".into();
    assert!(store.park_unconfirmed_background_cloud_start(&task.run.id,&intent.call_id,&replacement,load).is_err());
    result.observed_run_id=Some(42);
    assert!(store.acknowledge_waiting_background_cloud_launch(&task.run.id,&recovery.wait_id,&intent.call_id,&result,load).unwrap());
    let resumed=store.background_task(&task.request_id).unwrap();assert_eq!(resumed.run.state,RunState::Pending);assert!(resumed.cloud_recovery.is_none());
    assert!(store.park_unconfirmed_background_cloud_start(&task.run.id,&intent.call_id,lease,load).unwrap());
    let claim=store.claim_prompt_runs().unwrap().remove(0);
    let after=store.restore_background_checkpoint(&task.run.id,claim.lease.as_ref(),|_,_|Ok(())).unwrap();
    assert_eq!(after.context.unwrap(),serde_json::from_str::<serde_json::Value>(&before).unwrap());
}

#[test]
fn runtime_cloud_parking_does_not_convert_unreserved_failures_or_cancelled_work_into_new_execution() {
    let (store,task,intent,_)=interrupted_cloud_fixture();
    let lease=intent.lease.as_ref().unwrap();
    let load=|_:&rusqlite::Connection,_:&SubmitBackgroundTaskInput|Ok(("test-binding".to_string(),cloud_launch_settings()));
    store.cancel_background_task(&task.request_id).unwrap();
    assert!(store.park_unconfirmed_background_cloud_start(&task.run.id,&intent.call_id,lease,load).unwrap());
    assert_eq!(store.background_task(&task.request_id).unwrap().run.state,RunState::Expired);
    assert!(store.background_task(&task.request_id).unwrap().cloud_recovery.is_none());
    assert!(store.claim_prompt_runs().unwrap().is_empty());
    let (store,task)=leased_background();let intent=operation(&store,&task.run.id);store.begin_background_operation(intent.clone()).unwrap();
    assert!(!store.park_unconfirmed_background_cloud_start(&task.run.id,&intent.call_id,intent.lease.as_ref().unwrap(),load).unwrap());
    assert_eq!(store.background_task(&task.request_id).unwrap().run.state,RunState::Leased);
}

#[test]
fn cancellation_claims_are_fenced_and_ordinary_interruption_does_not_invent_cancellation() {
    let (store,task,_,_) = interrupted_cloud_fixture();
    store.recover_interrupted_prompt_runs().unwrap();
    assert!(store.due_background_cloud_cancellations().unwrap().is_empty());
    store.cancel_background_task(&task.request_id).unwrap();
    let first = store.due_background_cloud_cancellations().unwrap().remove(0);
    assert!(store.due_background_cloud_cancellations().unwrap().is_empty());
    {
        let conn = store.lock_conn().unwrap();
        conn.execute("UPDATE automation_background_cloud_cancellations SET retry_at = 0",[]).unwrap();
    }
    let second = store.due_background_cloud_cancellations().unwrap().remove(0);
    assert_ne!(first.2,second.2);
    let load = |_: &rusqlite::Connection,_: &SubmitBackgroundTaskInput| Ok(("test-binding".to_string(),cloud_launch_settings()));
    assert!(store.prepare_background_cloud_cancellation(&first.0,&first.1,&first.2,load).is_err());
    assert!(store.prepare_background_cloud_cancellation(&second.0,&second.1,&second.2,load).is_ok());
    store.cancel_background_task(&task.request_id).unwrap();
    assert_eq!(store.background_task(&task.request_id).unwrap().cloud_cancellation.pending,1);
}

#[test]
fn startup_parks_reserved_cloud_start_then_actual_ack_wakes_original_checkpoint_once() {
    let (store,task,intent,result)=interrupted_cloud_fixture();
    let original=intent.lease.as_ref().unwrap();
    let source:String=store.lock_conn().unwrap().query_row("SELECT context_json FROM automation_background_checkpoints WHERE execution_id = ?1",rusqlite::params![task.run.id],|row|row.get(0)).unwrap();
    assert_eq!(store.recover_interrupted_prompt_runs().unwrap(),1);
    let current=store.background_task(&task.request_id).unwrap();assert_eq!(current.run.state,RunState::Waiting);
    assert!(store.claim_prompt_runs().unwrap().is_empty());
    assert!(store.prepare_background_cloud_launch(&task.run.id,&intent.call_id,original,true,|_,_|Ok(("test-binding".into(),cloud_launch_settings()))).is_err());
    let wait=current.waiting.unwrap().wait_id;
    assert_eq!(store.recover_interrupted_prompt_runs().unwrap(),0);
    assert_eq!(store.due_background_cloud_launch_recoveries().unwrap(),vec![(task.run.id.clone(),wait.clone(),intent.call_id.clone())]);
    assert!(store.due_background_cloud_launch_recoveries().unwrap().is_empty());
    assert!(store.prepare_waiting_background_cloud_launch(&task.run.id,&wait,&intent.call_id,|_,_|Ok(("changed".into(),cloud_launch_settings()))).is_err());
    let observed=store.prepare_waiting_background_cloud_launch(&task.run.id,&wait,&intent.call_id,|_,_|Ok(("test-binding".into(),cloud_launch_settings()))).unwrap();
    assert!(!observed.execute);assert_eq!(observed.task_id,result.task_id);
    let mut wrong=result.clone();wrong.task_id="task-other".into();
    assert!(store.acknowledge_waiting_background_cloud_launch(&task.run.id,&wait,&intent.call_id,&wrong,|_,_|Ok(("test-binding".into(),cloud_launch_settings()))).is_err());
    assert_eq!(store.background_task(&task.request_id).unwrap().operations.in_flight,1);
    assert!(store.acknowledge_waiting_background_cloud_launch(&task.run.id,&wait,&intent.call_id,&result,|_,_|Ok(("test-binding".into(),cloud_launch_settings()))).unwrap());
    assert!(store.acknowledge_waiting_background_cloud_launch(&task.run.id,&wait,&intent.call_id,&result,|_,_|Ok(("test-binding".into(),cloud_launch_settings()))).is_err());
    let requests=store.claim_prompt_runs().unwrap();assert_eq!(requests.len(),1);
    let next=requests[0].lease.as_ref().unwrap();assert_ne!(next.token,original.token);
    let restored=store.restore_background_checkpoint(&task.run.id,Some(next),|_,_|Ok(())).unwrap();
    assert_eq!(restored.context.unwrap(),serde_json::from_str::<serde_json::Value>(&source).unwrap());
    let mut resumed=intent;resumed.lease=Some(next.clone());
    let receipt=store.begin_background_operation(resumed).unwrap();assert_eq!(receipt.status,"returned");assert_eq!(receipt.result.unwrap()["details"]["taskId"],result.task_id);
}

#[test]
fn cancelled_or_revoked_interrupted_cloud_recovery_cannot_release_ack_or_resume() {
    for cancel in [false,true] {
        let (store,task,intent,result)=interrupted_cloud_fixture();store.recover_interrupted_prompt_runs().unwrap();
        let wait=store.background_task(&task.request_id).unwrap().waiting.unwrap().wait_id;
        if cancel {store.cancel_background_task(&task.request_id).unwrap();}
        assert!(store.acknowledge_waiting_background_cloud_launch(&task.run.id,&wait,&intent.call_id,&result,|_,_|Ok(("changed".into(),cloud_launch_settings()))).is_err());
        assert!(store.claim_prompt_runs().unwrap().is_empty());assert_eq!(store.background_task(&task.request_id).unwrap().operations.in_flight,1);
        if cancel {assert!(store.due_background_cloud_launch_recoveries().unwrap().is_empty());}
    }
}

#[test]
fn frozen_cloud_error_is_preserved_while_late_native_get_resumes_original_tail() {
    let (store,task,intent,mut result)=interrupted_cloud_fixture();
    let original=intent.lease.as_ref().unwrap();
    let failed=json!({"role":"toolResult","toolCallId":intent.call_id,"toolName":"CloudTaskManager","isError":true,
        "timestamp":3,"content":[{"type":"text","text":"Dispatch response was lost"}],"details":{"outcomeUncertain":true}});
    store.complete_background_operation(CompleteBackgroundOperationInput{execution_id:task.run.id.clone(),call_id:intent.call_id.clone(),lease:Some(original.clone()),result:failed.clone()}).unwrap();
    let before=store.restore_background_checkpoint(&task.run.id,Some(original),|_,_|Ok(()));assert!(before.is_err());
    assert_eq!(store.recover_interrupted_prompt_runs().unwrap(),1);
    let waiting=store.background_task(&task.request_id).unwrap().waiting.unwrap();
    let load=|_:&rusqlite::Connection,_:&SubmitBackgroundTaskInput|Ok(("test-binding".into(),cloud_launch_settings()));
    let launch=store.prepare_waiting_background_cloud_launch(&task.run.id,&waiting.wait_id,&intent.call_id,load).unwrap();
    assert!(!launch.execute);assert!(launch.receipt.is_none());
    assert!(store.acknowledge_waiting_background_cloud_launch(&task.run.id,&waiting.wait_id,&intent.call_id,&result,load).is_err());
    assert_eq!(store.background_task(&task.request_id).unwrap().run.state,RunState::Waiting);
    result.observed_run_id=Some(42);
    assert!(store.acknowledge_waiting_background_cloud_launch(&task.run.id,&waiting.wait_id,&intent.call_id,&result,load).unwrap());
    let audit=store.list_background_operations(&task.request_id,0,10).unwrap();assert_eq!(audit.operations[0].result.as_ref().unwrap(),&failed);
    assert_eq!(store.background_task(&task.request_id).unwrap().operations.errors,1);
    let requests=store.claim_prompt_runs().unwrap();assert_eq!(requests.len(),1);
    let lease=requests[0].lease.as_ref().unwrap();assert_ne!(lease.token,original.token);
    let restored=store.restore_background_checkpoint(&task.run.id,Some(lease),|_,_|Ok(())).unwrap();
    assert_eq!(restored.context.as_ref().unwrap()["messages"].as_array().unwrap().len(),2);
    let mut replay=intent.clone();replay.lease=Some(lease.clone());
    let observed=store.begin_background_operation(replay).unwrap();assert_eq!(observed.status,"returned");
    let receipt=observed.result.unwrap();assert_eq!(receipt["details"]["observedRunId"],42);assert_eq!(receipt["details"]["reconcilesFailedReceipt"],true);
    assert!(store.complete_background_operation(CompleteBackgroundOperationInput{execution_id:task.run.id.clone(),call_id:intent.call_id.clone(),lease:Some(original.clone()),result:receipt}).is_err());
    let options=store.background_evidence_options(&task.run.id,Some(lease),0).unwrap();
    assert_eq!(options["receipts"][0]["isError"],true);assert_eq!(options["receipts"][0]["reconciledCloudStart"]["details"]["observedRunId"],42);
    assert!(store.record_background_cloud_wait(&task.run.id,"fixture-answer",&intent.call_id,"Await original job",lease,|_,_|Ok(())).is_ok());
}

#[test]
fn frozen_cloud_error_cannot_reopen_cancelled_tasks_or_a_closed_error_tail() {
    for closed_tail in [false,true] {
        let (store,task,intent,mut result)=interrupted_cloud_fixture();
        let original=intent.lease.as_ref().unwrap();
        let failed=json!({"role":"toolResult","toolCallId":intent.call_id,"toolName":"CloudTaskManager","isError":true,"timestamp":3,"content":[],"details":{"outcomeUncertain":true}});
        store.complete_background_operation(CompleteBackgroundOperationInput{execution_id:task.run.id.clone(),call_id:intent.call_id.clone(),lease:Some(original.clone()),result:failed.clone()}).unwrap();
        if closed_tail {
            let mut snapshot=checkpoint(&store,&task.run.id,2);
            let raw:String=store.lock_conn().unwrap().query_row("SELECT context_json FROM automation_background_checkpoints WHERE execution_id = ?1",rusqlite::params![task.run.id],|row|row.get(0)).unwrap();
            snapshot.context=serde_json::from_str(&raw).unwrap();snapshot.context["messages"].as_array_mut().unwrap().push(failed);
            store.save_background_checkpoint(snapshot).unwrap();store.recover_interrupted_prompt_runs().unwrap();
            assert!(store.due_background_cloud_launch_recoveries().unwrap().is_empty());
        } else {
            store.recover_interrupted_prompt_runs().unwrap();let wait=store.background_task(&task.request_id).unwrap().waiting.unwrap().wait_id;
            store.cancel_background_task(&task.request_id).unwrap();result.observed_run_id=Some(42);
            assert!(store.acknowledge_waiting_background_cloud_launch(&task.run.id,&wait,&intent.call_id,&result,|_,_|Ok(("test-binding".into(),cloud_launch_settings()))).is_err());
        }
        assert!(store.claim_prompt_runs().unwrap().is_empty());
        assert_eq!(store.background_task(&task.request_id).unwrap().run.state,RunState::Expired);
    }
}

#[test]
fn periodic_sweep_parks_only_expired_reserved_cloud_writers_without_requiring_restart() {
    for failed in [false,true] {
        let (store,task,intent,_)=interrupted_cloud_fixture();
        if failed {
            store.complete_background_operation(CompleteBackgroundOperationInput{execution_id:task.run.id.clone(),call_id:intent.call_id.clone(),lease:intent.lease.clone(),result:json!({"role":"toolResult","toolCallId":intent.call_id,"toolName":"CloudTaskManager","isError":true,"timestamp":3,"content":[],"details":{"outcomeUncertain":true}})}).unwrap();
        }
        assert!(store.sweep_expired_prompt_runs().unwrap().is_empty());
        assert_eq!(store.background_task(&task.request_id).unwrap().run.state,RunState::Leased);
        store.lock_conn().unwrap().execute("UPDATE automation_cron_runs SET lease_expires_at = 0 WHERE execution_id = ?1",rusqlite::params![task.run.id]).unwrap();
        assert!(store.sweep_expired_prompt_runs().unwrap().is_empty());
        let current=store.background_task(&task.request_id).unwrap();assert_eq!(current.run.state,RunState::Waiting);
        assert!(store.sweep_expired_prompt_runs().unwrap().is_empty());assert!(store.claim_prompt_runs().unwrap().is_empty());
        assert_eq!(store.due_background_cloud_launch_recoveries().unwrap().len(),1);
    }
}

#[test]
fn unreserved_cloud_or_other_unknown_write_keeps_existing_interruption_stop() {
    for reserve in [false,true] {
        let (store,task,intent,_)=interrupted_cloud_fixture();
        if !reserve {store.lock_conn().unwrap().execute("DELETE FROM automation_background_cloud_launches",[]).unwrap();}
        else {
            let mut other=operation(&store,&task.run.id);other.call_id="other-write".into();store.begin_background_operation(other).unwrap();
        }
        store.recover_interrupted_prompt_runs().unwrap();
        assert_eq!(store.background_task(&task.request_id).unwrap().run.state,RunState::Expired);
        assert!(store.due_background_cloud_launch_recoveries().unwrap().is_empty());assert!(store.claim_prompt_runs().unwrap().is_empty());
        assert!(store.prepare_waiting_background_cloud_launch(&task.run.id,"not-a-wait",&intent.call_id,|_,_|Ok(("test-binding".into(),cloud_launch_settings()))).is_err());
    }
}

fn checkpoint(store: &AutomationStore, execution_id: &str, revision: u64) -> SaveBackgroundCheckpointInput {
    SaveBackgroundCheckpointInput { lease: store.debug_background_lease(execution_id), execution_id: execution_id.into(), revision,
        context: json!({"systemPrompt": "Pinned instructions", "messages": [{"role": "user", "content": "Send the report"}]}) }
}

fn operation(store: &AutomationStore, execution_id: &str) -> BeginBackgroundOperationInput {
    ensure_test_outcome_plan(store, execution_id, false);
    BeginBackgroundOperationInput { lease: store.debug_background_lease(execution_id), execution_id: execution_id.into(), call_id: "send-1".into(),
        tool_name: "SendMail".into(), arguments: json!({"to": "user@example.test"}) }
}

fn operation_receipt(store: &AutomationStore, execution_id: &str) -> CompleteBackgroundOperationInput {
    CompleteBackgroundOperationInput { lease: store.debug_background_lease(execution_id), execution_id: execution_id.into(), call_id: "send-1".into(),
        result: json!({"role": "toolResult", "toolCallId": "send-1", "toolName": "SendMail", "isError": false,
            "content": [{"type": "text", "text": "Receipt 42"}]}) }
}

fn conclusion(store: &AutomationStore, execution_id: &str) -> CompletePromptRunInput {
    ensure_test_outcome_plan(store, execution_id, true);
    CompletePromptRunInput { lease: store.debug_background_lease(execution_id), execution_id: execution_id.into(), success: true, duration_ms: 10, output: "Saved conclusion".into() }
}

// Existing journal/outbox tests isolate those protocols. Give their fixtures
// a real accepted/verified text criterion instead of bypassing the new gate.
fn ensure_test_outcome_plan(store: &AutomationStore, execution_id: &str, verified: bool) {
    let lease = store.debug_background_lease(execution_id);
    let Ok(current) = store.read_background_outcomes(execution_id, lease.as_ref()) else { return; };
    if current.is_none() {
        store.save_background_plan(SaveBackgroundPlanInput { execution_id: execution_id.into(), lease: lease.clone(),
            plan: BackgroundTaskPlan { version: 1, branches: vec![BackgroundBranch { id: "fixture-answer".into(), title: "Fixture answer".into(), requirement: "Saved conclusion".into(), depends_on: vec![], criteria: vec![BackgroundCriterion::Answer] }] }
        }, |_, _| Ok(())).unwrap();
    }
    if verified && store.read_background_outcomes(execution_id, lease.as_ref()).unwrap().unwrap().branches.iter().any(|branch| branch.branch.id == "fixture-answer" && branch.state != "verified") {
        store.record_background_outcome(RecordBackgroundOutcomeInput { execution_id: execution_id.into(), lease, branch_id: "fixture-answer".into(), waiting_reason: None, waiting_tool: None, waiting_inventory: None,
            evidence: Some(BackgroundBranchEvidence { artifact_ids: vec![], call_ids: vec![], answer: Some("Saved conclusion".into()) })
        }, |_, _| Ok(())).unwrap();
    }
}

fn compaction_fixture() -> (AutomationStore, BackgroundTaskRecord, String, CompactBackgroundContextInput) {
    let (store, task) = leased_background();
    let source = json!({"systemPrompt": "Pinned policy", "messages": [
        {"role": "user", "content": "Create the requested report"},
        {"role": "assistant", "content": [{"type": "text", "text": "原始文档与操作证据".repeat(3000)}]}
    ]});
    let raw = serde_json::to_string(&source).unwrap();
    store.save_background_checkpoint(SaveBackgroundCheckpointInput { lease: store.debug_background_lease(&task.run.id), execution_id: task.run.id.clone(), revision: 1, context: source }).unwrap();
    let input = CompactBackgroundContextInput { lease: store.debug_background_lease(&task.run.id), execution_id: task.run.id.clone(), source_revision: 1,
        context: json!({"systemPrompt": "Pinned policy and validated summary", "messages": [{"role": "user", "content": "Create the requested report"}]}),
        summary: json!({"api": "xgent-compaction", "promptVersion": "summary-v3", "content": [{"type": "text", "text": "Report pending, original evidence archived"}]}) };
    (store, task, raw, input)
}

#[test]
fn background_compaction_archives_exact_context_and_reads_utf8_without_rewinding() {
    use sha2::{Digest, Sha256};
    let (store, task, raw, input) = compaction_fixture();
    assert_eq!(store.compact_background_context(input.clone(), |_, _| Ok(())).unwrap(), 2);
    assert_eq!(store.compact_background_context(input.clone(), |_, _| Ok(())).unwrap(), 2);
    let page = store.list_background_compactions(&task.run.id, 0, store.debug_background_lease(&task.run.id).as_ref()).unwrap();
    assert_eq!(page.compactions.len(), 1);
    assert_eq!(page.compactions[0].source_hash, hex::encode(Sha256::digest(raw.as_bytes())));
    assert_eq!(page.compactions[0].source_bytes, raw.len() as u64);
    let mut recovered = String::new();
    let mut offset = 0;
    loop {
        let chunk = store.read_background_context_archive(&task.run.id, 1, offset, store.debug_background_lease(&task.run.id).as_ref()).unwrap();
        assert!(chunk.text.len() <= 16 * 1024);
        assert_eq!(chunk.total_bytes, raw.len());
        assert_eq!(chunk.offset, offset);
        recovered.push_str(&chunk.text);
        if let Some(next) = chunk.next_offset { offset = next; } else { break; }
    }
    assert_eq!(recovered, raw);
    let invalid = raw.find('原').unwrap() + 1;
    assert!(store.read_background_context_archive(&task.run.id, 1, invalid, store.debug_background_lease(&task.run.id).as_ref()).unwrap_err().contains("UTF-8"));
    assert!(store.read_background_context_archive(&task.run.id, 1, raw.len() + 1, store.debug_background_lease(&task.run.id).as_ref()).is_err());
    let mut changed = input.clone();
    changed.summary["promptVersion"] = json!("different-summary");
    assert!(store.compact_background_context(changed, |_, _| Ok(())).is_err());
    store.save_background_checkpoint(SaveBackgroundCheckpointInput { lease: store.debug_background_lease(&task.run.id), execution_id: task.run.id.clone(), revision: 3, context: input.context.clone() }).unwrap();
    assert!(store.compact_background_context(input, |_, _| Ok(())).unwrap_err().contains("advanced"));
    assert_eq!(store.background_task(&task.request_id).unwrap().checkpoint_revision, 3);
    let other = store.submit_background_task(background_input()).unwrap();
    store.claim_prompt_runs().unwrap();
    assert!(store.read_background_context_archive(&other.run.id, 1, 0, store.debug_background_lease(&other.run.id).as_ref()).is_err());
    store.cancel_background_task(&task.request_id).unwrap();
    assert!(store.read_background_context_archive(&task.run.id, 1, 0, store.debug_background_lease(&task.run.id).as_ref()).is_err());
}

#[test]
fn background_compaction_denial_conflicts_and_missing_goal_leave_source_untouched() {
    let (store, task, _, input) = compaction_fixture();
    assert!(store.compact_background_context(input.clone(), |_, _| Err("configuration revoked".into())).unwrap_err().contains("revoked"));
    for kind in 0..3 {
        let mut invalid = input.clone();
        if kind == 0 { invalid.context["messages"] = json!([]); }
        if kind == 1 { invalid.source_revision = 2; }
        if kind == 2 { invalid.context["systemPrompt"] = json!("large".repeat(60000)); }
        assert!(store.compact_background_context(invalid, |_, _| Ok(())).is_err());
        assert_eq!(store.background_task(&task.request_id).unwrap().checkpoint_revision, 1);
        assert!(store.list_background_compactions(&task.run.id, 0, store.debug_background_lease(&task.run.id).as_ref()).unwrap().compactions.is_empty());
    }
}

#[test]
fn background_compaction_refuses_unfinished_or_uncertain_operations() {
    let (store, task, _, input) = compaction_fixture();
    store.begin_background_operation(operation(&store, &task.run.id)).unwrap();
    assert!(store.compact_background_context(input.clone(), |_, _| Ok(())).unwrap_err().contains("uncertain"));
    let mut receipt = operation_receipt(&store, &task.run.id);
    receipt.result["isError"] = json!(true);
    receipt.result["details"] = json!({"outcomeUncertain": true});
    store.complete_background_operation(receipt).unwrap();
    assert!(store.compact_background_context(input, |_, _| Ok(())).is_err());
    assert_eq!(store.background_task(&task.request_id).unwrap().checkpoint_revision, 1);
    assert!(store.list_background_compactions(&task.run.id, 0, store.debug_background_lease(&task.run.id).as_ref()).unwrap().compactions.is_empty());
}

#[test]
fn background_compaction_quota_never_deletes_evidence_and_pages_in_revision_order() {
    let (store, task, raw, mut input) = compaction_fixture();
    for index in 0..32 {
        if index > 0 {
            input.source_revision = (index * 2 + 1) as u64;
            store.save_background_checkpoint(SaveBackgroundCheckpointInput { lease: store.debug_background_lease(&task.run.id), execution_id: task.run.id.clone(), revision: input.source_revision,
                context: serde_json::from_str(&raw).unwrap() }).unwrap();
        }
        store.compact_background_context(input.clone(), |_, _| Ok(())).unwrap();
    }
    let mut revisions = Vec::new();
    let mut cursor = 0;
    loop {
        let page = store.list_background_compactions(&task.run.id, cursor, store.debug_background_lease(&task.run.id).as_ref()).unwrap();
        assert!(page.compactions.len() <= 10);
        revisions.extend(page.compactions.iter().map(|record| record.source_revision));
        if let Some(next) = page.next_cursor { cursor = next; } else { break; }
    }
    assert_eq!(revisions, (0..32).map(|i| (i * 2 + 1) as u64).collect::<Vec<_>>());
    input.source_revision = 65;
    store.save_background_checkpoint(SaveBackgroundCheckpointInput { lease: store.debug_background_lease(&task.run.id), execution_id: task.run.id.clone(), revision: 65,
        context: serde_json::from_str(&raw).unwrap() }).unwrap();
    assert!(store.compact_background_context(input, |_, _| Ok(())).unwrap_err().contains("quota"));
    assert_eq!(store.background_task(&task.request_id).unwrap().checkpoint_revision, 65);
    assert_eq!(store.read_background_context_archive(&task.run.id, 1, 0, store.debug_background_lease(&task.run.id).as_ref()).unwrap().total_bytes, raw.len());
}

#[test]
fn background_checkpoints_enforce_live_lease_and_revision_binding() {
    let (store, task) = leased_background();
    assert!(store.begin_background_operation(operation(&store, &task.run.id)).unwrap_err().contains("Persist the model context"));
    assert_eq!(store.save_background_checkpoint(checkpoint(&store, &task.run.id, 1)).unwrap(), 1);
    assert_eq!(store.save_background_checkpoint(checkpoint(&store, &task.run.id, 1)).unwrap(), 1);
    let mut conflict = checkpoint(&store, &task.run.id, 1);
    conflict.context["systemPrompt"] = json!("Changed instructions");
    assert!(store.save_background_checkpoint(conflict).unwrap_err().contains("different context"));
    assert!(store.save_background_checkpoint(checkpoint(&store, &task.run.id, 3)).unwrap_err().contains("revision conflict"));
    assert_eq!(store.save_background_checkpoint(checkpoint(&store, &task.run.id, 2)).unwrap(), 2);
    assert_eq!(store.background_task(&task.request_id).unwrap().checkpoint_revision, 2);
    store.release_prompt_run(&task.run.id, store.debug_background_lease(&task.run.id).as_ref()).unwrap();
    assert_eq!(store.background_task(&task.request_id).unwrap().run.state, RunState::Leased);
    store.cancel_background_task(&task.request_id).unwrap();
    assert!(store.save_background_checkpoint(checkpoint(&store, &task.run.id, 3)).is_err());
}

#[test]
fn background_operation_decisions_distinguish_uncertain_and_returned_without_replay() {
    let (store, task) = leased_background();
    store.save_background_checkpoint(checkpoint(&store, &task.run.id, 1)).unwrap();
    assert_eq!(store.begin_background_operation(operation(&store, &task.run.id)).unwrap().status, "execute");
    assert_eq!(store.begin_background_operation(operation(&store, &task.run.id)).unwrap().status, "uncertain");
    let mut changed = operation(&store, &task.run.id);
    changed.arguments = json!({"to": "someone-else"});
    assert!(store.begin_background_operation(changed).is_err());
    let receipt = operation_receipt(&store, &task.run.id);
    store.complete_background_operation(receipt.clone()).unwrap();
    store.complete_background_operation(receipt.clone()).unwrap();
    let reused = store.begin_background_operation(operation(&store, &task.run.id)).unwrap();
    assert_eq!(reused.status, "returned");
    assert_eq!(reused.result, Some(receipt.result));
    let mut changed = operation_receipt(&store, &task.run.id);
    changed.result["isError"] = json!(true);
    assert!(store.complete_background_operation(changed).unwrap_err().contains("immutable"));
    let page = store.list_background_operations(&task.request_id, 0, 10).unwrap();
    assert_eq!(page.operations.len(), 1);
    assert_eq!(page.operations[0].context_revision, 1);
    assert!(page.next_cursor.is_none());
    assert_eq!(store.background_task(&task.request_id).unwrap().operations.returned, 1);
}

#[test]
fn background_late_operation_receipt_does_not_reopen_cancelled_execution() {
    let (store, task) = leased_background();
    store.save_background_checkpoint(checkpoint(&store, &task.run.id, 1)).unwrap();
    store.begin_background_operation(operation(&store, &task.run.id)).unwrap();
    let mut wrong = operation_receipt(&store, &task.run.id);
    wrong.result["toolName"] = json!("OtherTool");
    assert!(store.complete_background_operation(wrong).is_err());
    store.cancel_background_task(&task.request_id).unwrap();
    store.complete_background_operation(operation_receipt(&store, &task.run.id)).unwrap();
    let saved = store.background_task(&task.request_id).unwrap();
    assert_eq!(saved.run.state, RunState::Expired);
    assert_eq!(saved.operations.returned, 1);
    assert!(store.begin_background_operation(operation(&store, &task.run.id)).is_err());
}

#[test]
fn staged_conclusion_survives_deadline_and_is_recovered_without_an_executor() {
    let (store, task) = leased_background();
    store.stage_prompt_completion(conclusion(&store, &task.run.id)).unwrap().unwrap();
    store.stage_prompt_completion(conclusion(&store, &task.run.id)).unwrap().unwrap();
    let mut changed = conclusion(&store, &task.run.id);
    changed.output = "Different conclusion".into();
    assert!(store.stage_prompt_completion(changed).unwrap_err().contains("different conclusion"));
    assert!(store.save_background_checkpoint(checkpoint(&store, &task.run.id, 1)).is_err());
    store.debug_set_run_lease(&task.run.id, 1).unwrap();
    assert!(store.sweep_expired_prompt_runs().unwrap().is_empty());
    assert_eq!(store.recover_interrupted_prompt_runs().unwrap(), 0);
    let saved = store.background_task(&task.request_id).unwrap();
    assert_eq!(saved.run.state, RunState::Done);
    assert_eq!(saved.run.output, "Saved conclusion");
    assert_eq!(store.flush_prompt_completion_outbox().unwrap(), 0);
    assert_eq!(store.complete_prompt_run(conclusion(&store, &task.run.id)).unwrap().status, PromptCompletionStatus::AlreadyFinished);
}

#[test]
fn unresolved_operations_reject_success_and_cancellation_wins_over_staged_results() {
    let (store, task) = leased_background();
    store.save_background_checkpoint(checkpoint(&store, &task.run.id, 1)).unwrap();
    store.begin_background_operation(operation(&store, &task.run.id)).unwrap();
    assert!(store.stage_prompt_completion(conclusion(&store, &task.run.id)).unwrap_err().contains("awaiting receipts"));
    let mut failed = conclusion(&store, &task.run.id);
    failed.success = false;
    failed.output = "Uncertain external outcome".into();
    store.stage_prompt_completion(failed).unwrap().unwrap();
    store.cancel_background_task(&task.request_id).unwrap();
    store.flush_prompt_completion_outbox().unwrap();
    let saved = store.background_task(&task.request_id).unwrap();
    assert_eq!(saved.run.state, RunState::Expired);
    assert!(saved.run.output.contains("cancelled"));
    assert_eq!(store.flush_prompt_completion_outbox().unwrap(), 0);
}

#[test]
fn uncertain_write_errors_cannot_be_finalized_as_success() {
    let (store, task) = leased_background();
    store.save_background_checkpoint(checkpoint(&store, &task.run.id, 1)).unwrap();
    store.begin_background_operation(operation(&store, &task.run.id)).unwrap();
    let mut receipt = operation_receipt(&store, &task.run.id);
    receipt.result["isError"] = json!(true);
    receipt.result["details"] = json!({"outcomeUncertain": true});
    store.complete_background_operation(receipt).unwrap();
    assert!(store.stage_prompt_completion(conclusion(&store, &task.run.id)).unwrap_err().contains("unresolved external outcomes"));
    let mut failed = conclusion(&store, &task.run.id);
    failed.success = false;
    assert!(store.stage_prompt_completion(failed).unwrap().is_some());
}

fn apply_input(base_revision: u64, ops: Vec<AutomationOp>) -> AutomationApplyInput {
    AutomationApplyInput { base_revision, ops }
}

fn create_bash_task_op(id: &str, name: &str) -> AutomationOp {
    AutomationOp::Create {
        item: json!({
            "id": id,
            "name": name,
            "cron": "0 * * * * *",
            "enabled": true,
            "type": "bash",
            "script": "echo hello",
        }),
    }
}

fn create_prompt_task_op(id: &str) -> AutomationOp {
    AutomationOp::Create {
        item: json!({
            "id": id,
            "name": "Prompt task",
            "cron": "0 * * * * *",
            "enabled": true,
            "type": "prompt",
            "prompt": "Summarize the repo",
            "selectedModel": { "customProviderId": "provider-a", "model": "gpt-5" },
        }),
    }
}

fn store_with_task(op: AutomationOp) -> (AutomationStore, CronTask) {
    let store = AutomationStore::open_in_memory().expect("open store");
    let base = store.snapshot().expect("snapshot").cron.revision;
    let response = store
        .cron_apply(apply_input(base, vec![op]))
        .expect("apply create");
    assert_eq!(response.status, ApplyStatus::Ok);
    let task = response.cron.tasks[0].clone();
    (store, task)
}

#[test]
fn validate_cron_expression_accepts_six_field_syntax() {
    validate_cron_expression("0 * * * * *").expect("validate six-field cron");
}

#[test]
fn validate_cron_expression_rejects_five_field_syntax() {
    let error = validate_cron_expression("* * * * *").expect_err("reject five-field cron");
    assert!(error.contains("六段"));
}

#[test]
fn cron_run_now_response_uses_camel_case() {
    let value = serde_json::to_value(CronRunNowResponse { started_at: 1234 })
        .expect("serialize run-now response");
    assert_eq!(value, json!({ "startedAt": 1234 }));
}

#[test]
fn cron_apply_rejects_stale_revision() {
    let store = AutomationStore::open_in_memory().expect("open store");
    let base = store.snapshot().expect("snapshot").cron.revision;
    store
        .cron_apply(apply_input(base, vec![create_bash_task_op("a", "First")]))
        .expect("first apply");

    let stale = store
        .cron_apply(apply_input(base, vec![create_bash_task_op("b", "Second")]))
        .expect("stale apply returns");
    assert_eq!(stale.status, ApplyStatus::Conflict);
    assert_eq!(stale.cron.tasks.len(), 1);

    let fresh = store
        .cron_apply(apply_input(
            stale.cron.revision,
            vec![create_bash_task_op("b", "Second")],
        ))
        .expect("rebased apply");
    assert_eq!(fresh.status, ApplyStatus::Ok);
    assert_eq!(fresh.cron.tasks.len(), 2);
}

#[test]
fn cron_apply_update_patches_only_named_fields() {
    let (store, task) = store_with_task(create_bash_task_op("a", "First"));
    let revision = store.snapshot().expect("snapshot").cron.revision;
    let response = store
        .cron_apply(apply_input(
            revision,
            vec![AutomationOp::Update {
                id: task.id.clone(),
                patch: json!({ "name": "Renamed" }),
            }],
        ))
        .expect("apply update");
    assert_eq!(response.status, ApplyStatus::Ok);
    let updated = &response.cron.tasks[0];
    assert_eq!(updated.name, "Renamed");
    assert_eq!(updated.script.as_deref(), Some("echo hello"));
    assert!(updated.enabled);
}

#[test]
fn cron_apply_update_switching_kind_drops_stale_config() {
    let (store, task) = store_with_task(create_bash_task_op("a", "First"));
    let revision = store.snapshot().expect("snapshot").cron.revision;
    let response = store
        .cron_apply(apply_input(
            revision,
            vec![AutomationOp::Update {
                id: task.id.clone(),
                patch: json!({
                    "type": "http",
                    "requests": [{ "url": "https://example.com/ping", "method": "GET" }],
                }),
            }],
        ))
        .expect("apply kind switch");
    let updated = &response.cron.tasks[0];
    assert_eq!(updated.kind, "http");
    assert!(updated.script.is_none());
    assert_eq!(updated.requests.as_ref().map(Vec::len), Some(1));
}

#[test]
fn cron_apply_reorder_requires_full_permutation() {
    let store = AutomationStore::open_in_memory().expect("open store");
    let base = store.snapshot().expect("snapshot").cron.revision;
    let response = store
        .cron_apply(apply_input(
            base,
            vec![create_bash_task_op("a", "A"), create_bash_task_op("b", "B")],
        ))
        .expect("seed");

    let error = store
        .cron_apply(apply_input(
            response.cron.revision,
            vec![AutomationOp::Reorder {
                ids: vec!["a".to_string()],
            }],
        ))
        .expect_err("partial reorder rejected");
    assert!(error.contains("全部"));

    let reordered = store
        .cron_apply(apply_input(
            response.cron.revision,
            vec![AutomationOp::Reorder {
                ids: vec!["b".to_string(), "a".to_string()],
            }],
        ))
        .expect("full reorder");
    let ids: Vec<&str> = reordered.cron.tasks.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(ids, vec!["b", "a"]);
}

#[test]
fn record_completed_run_decrements_and_disables_at_zero() {
    let store = AutomationStore::open_in_memory().expect("open store");
    let base = store.snapshot().expect("snapshot").cron.revision;
    store
        .cron_apply(apply_input(
            base,
            vec![AutomationOp::Create {
                item: json!({
                    "id": "finite",
                    "name": "Finite",
                    "cron": "0 * * * * *",
                    "enabled": true,
                    "remainingExecutions": 1,
                    "type": "bash",
                    "script": "echo finite",
                }),
            }],
        ))
        .expect("seed finite task");

    store
        .record_completed_run(CompletedRun {
            task_id: "finite".to_string(),
            success: true,
            started_at: db::now_ms(),
            duration_ms: 5,
            exit_code: Some(0),
            output: "ok".to_string(),
            counted: true,
        })
        .expect("record run");

    let snapshot = store.snapshot().expect("snapshot").cron;
    let task = &snapshot.tasks[0];
    assert_eq!(task.remaining_executions, Some(0));
    assert!(!task.enabled);
    let runs = store.list_runs("finite", 10).expect("list runs");
    assert_eq!(runs.len(), 1);
    assert!(runs[0].success);
}

#[test]
fn prompt_run_lifecycle_queue_claim_complete() {
    let (store, task) = store_with_task(create_prompt_task_op("p1"));

    assert!(matches!(
        store
            .queue_prompt_run(&task, "", true)
            .expect("queue prompt run"),
        super::store::PromptQueueOutcome::Queued
    ));

    let pending_runs = store.list_runs("p1", 10).expect("list pending runs");
    assert_eq!(pending_runs.len(), 1);
    assert_eq!(pending_runs[0].state, RunState::Pending);

    // Second fire while pending is skipped.
    assert!(matches!(
        store
            .queue_prompt_run(&task, "", true)
            .expect("second queue"),
        super::store::PromptQueueOutcome::SkippedActiveRun
    ));

    let claims = store.claim_prompt_runs().expect("claim");
    assert_eq!(claims.len(), 1);
    let execution_id = claims[0].execution_id.clone();

    // Claim is consuming: a second claim returns nothing.
    assert!(store.claim_prompt_runs().expect("second claim").is_empty());

    let completion = store
        .complete_prompt_run(CompletePromptRunInput { lease: None,
            execution_id: execution_id.clone(),
            success: true,
            duration_ms: 1200,
            output: "conclusion".to_string(),
        })
        .expect("complete");
    assert_eq!(completion.status, PromptCompletionStatus::Completed);

    let repeat = store
        .complete_prompt_run(CompletePromptRunInput { lease: None,
            execution_id: execution_id.clone(),
            success: true,
            duration_ms: 1200,
            output: "late".to_string(),
        })
        .expect("repeat complete");
    assert_eq!(repeat.status, PromptCompletionStatus::AlreadyFinished);

    let runs = store.list_runs("p1", 10).expect("list runs");
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].output, "conclusion");
}

#[test]
fn complete_prompt_run_input_uses_camel_case_wire_fields() {
    let input: CompletePromptRunInput = serde_json::from_value(json!({
        "executionId": "execution-1",
        "success": true,
        "durationMs": 1200,
        "output": "conclusion",
    }))
    .expect("deserialize camelCase completion input");
    assert_eq!(input.execution_id, "execution-1");
    assert_eq!(input.duration_ms, 1200);

    let error = serde_json::from_value::<CompletePromptRunInput>(json!({
        "execution_id": "execution-1",
        "success": true,
        "duration_ms": 1200,
        "output": "conclusion",
    }))
    .expect_err("reject snake_case completion input");
    assert!(error.to_string().contains("executionId"));

    let legacy_request: PromptRunRequest = serde_json::from_value(json!({
        "executionId": "execution-1",
        "taskId": "task-1",
        "taskName": "Task",
        "prompt": "Run",
        "providerId": "provider-a",
        "model": "gpt-5",
        "startedAt": 100,
        "leaseExpiresAt": 200,
    }))
    .expect("deserialize legacy prompt request");
    assert!(legacy_request.counted);
    assert_eq!(legacy_request.workdir, "");
}

#[test]
fn manual_prompt_run_does_not_consume_remaining_execution() {
    let (store, task) = store_with_task(AutomationOp::Create {
        item: json!({
            "id": "manual-prompt",
            "name": "Manual Prompt",
            "cron": "0 * * * * *",
            "enabled": true,
            "remainingExecutions": 1,
            "type": "prompt",
            "prompt": "Summarize the repo",
            "selectedModel": { "customProviderId": "provider-a", "model": "gpt-5" },
        }),
    });

    store
        .queue_prompt_run(&task, "", false)
        .expect("queue manual prompt run");
    let claims = store.claim_prompt_runs().expect("claim manual prompt run");
    assert_eq!(claims.len(), 1);
    assert!(!claims[0].counted);
    store
        .complete_prompt_run(CompletePromptRunInput { lease: None,
            execution_id: claims[0].execution_id.clone(),
            success: true,
            duration_ms: 10,
            output: "manual conclusion".to_string(),
        })
        .expect("complete manual prompt run");

    let snapshot = store.snapshot().expect("snapshot after manual run").cron;
    assert_eq!(snapshot.tasks[0].remaining_executions, Some(1));
    assert!(snapshot.tasks[0].enabled);
}

#[test]
fn interrupted_manual_prompt_run_does_not_consume_remaining_execution() {
    let (store, task) = store_with_task(AutomationOp::Create {
        item: json!({
            "id": "manual-prompt",
            "name": "Manual Prompt",
            "cron": "0 * * * * *",
            "enabled": true,
            "remainingExecutions": 1,
            "type": "prompt",
            "prompt": "Summarize the repo",
            "selectedModel": { "customProviderId": "provider-a", "model": "gpt-5" },
        }),
    });

    store
        .queue_prompt_run(&task, "", false)
        .expect("queue manual prompt run");
    assert_eq!(
        store
            .recover_interrupted_prompt_runs()
            .expect("expire manual prompt run"),
        1
    );

    let snapshot = store.snapshot().expect("snapshot after manual expiry").cron;
    assert_eq!(snapshot.tasks[0].remaining_executions, Some(1));
    assert!(snapshot.tasks[0].enabled);
}

#[test]
fn manual_run_context_allows_disabled_exhausted_task() {
    let (store, task) = store_with_task(AutomationOp::Create {
        item: json!({
            "id": "manual-bash",
            "name": "Manual Bash",
            "cron": "0 * * * * *",
            "enabled": false,
            "remainingExecutions": 0,
            "type": "bash",
            "script": "echo manual",
        }),
    });

    let (_, manual_task) = store
        .cron_task_for_manual_run(&task.id)
        .expect("load disabled exhausted task for manual run");
    assert!(!manual_task.enabled);
    assert_eq!(manual_task.remaining_executions, Some(0));
}

#[test]
fn released_prompt_run_returns_to_pending() {
    let (store, task) = store_with_task(create_prompt_task_op("p1"));
    assert!(matches!(
        store.queue_prompt_run(&task, "", true).expect("queue"),
        super::store::PromptQueueOutcome::Queued
    ));
    let claims = store.claim_prompt_runs().expect("claim");
    assert_eq!(claims.len(), 1);
    let execution_id = claims[0].execution_id.clone();
    store.release_prompt_run(&execution_id, store.debug_background_lease(&execution_id).as_ref()).expect("release");
    let reclaimed = store.claim_prompt_runs().expect("reclaim");
    assert_eq!(reclaimed.len(), 1);
    assert_eq!(reclaimed[0].execution_id, execution_id);
}

#[test]
fn recover_marks_interrupted_runs_expired() {
    let (store, task) = store_with_task(create_prompt_task_op("p1"));
    store.queue_prompt_run(&task, "", true).expect("queue");
    let recovered = store.recover_interrupted_prompt_runs().expect("recover");
    assert_eq!(recovered, 1);

    let runs = store.list_runs("p1", 10).expect("list runs");
    assert_eq!(runs.len(), 1);
    assert!(matches!(runs[0].state, RunState::Expired));
    assert!(runs[0].output.contains("restart"));

    // Completion after expiry is idempotent.
    let completion = store
        .complete_prompt_run(CompletePromptRunInput { lease: None,
            execution_id: runs[0].id.clone(),
            success: true,
            duration_ms: 10,
            output: "late".to_string(),
        })
        .expect("late completion");
    assert_eq!(completion.status, PromptCompletionStatus::AlreadyFinished);
}

#[test]
fn run_retention_prunes_old_rows() {
    let (store, _task) = store_with_task(create_bash_task_op("a", "A"));
    for index in 0..(db::RUN_RETENTION_PER_TASK + 25) {
        store
            .record_completed_run(CompletedRun {
                task_id: "a".to_string(),
                success: true,
                started_at: db::now_ms() + index as i64,
                duration_ms: 1,
                exit_code: Some(0),
                output: format!("run {index}"),
                counted: false,
            })
            .expect("record run");
    }
    let runs = store.list_runs("a", 500).expect("list runs");
    assert_eq!(runs.len(), db::RUN_RETENTION_PER_TASK as usize);
}

#[test]
fn masked_headers_round_trip_keeps_stored_secret() {
    let store = AutomationStore::open_in_memory().expect("open store");
    let base = store.snapshot().expect("snapshot").cron.revision;
    let response = store
        .cron_apply(apply_input(
            base,
            vec![AutomationOp::Create {
                item: json!({
                    "id": "h1",
                    "name": "Http",
                    "cron": "0 * * * * *",
                    "type": "http",
                    "requests": [{
                        "id": "r1",
                        "url": "https://example.com/hook",
                        "method": "POST",
                        "headers": { "Authorization": "Bearer secret-token" },
                    }],
                }),
            }],
        ))
        .expect("seed http task");

    // A remote client edits the URL and round-trips masked headers.
    let masked = store
        .cron_apply(apply_input(
            response.cron.revision,
            vec![AutomationOp::Update {
                id: "h1".to_string(),
                patch: json!({
                    "requests": [{
                        "id": "r1",
                        "url": "https://example.com/hook-v2",
                        "method": "POST",
                        "headers": { "Authorization": MASKED_HEADER_VALUE },
                    }],
                }),
            }],
        ))
        .expect("masked update");

    let task = &masked.cron.tasks[0];
    let headers = task.requests.as_ref().unwrap()[0].headers.as_ref().unwrap();
    assert_eq!(
        headers.get("Authorization").map(String::as_str),
        Some("Bearer secret-token")
    );
    assert_eq!(
        task.requests.as_ref().unwrap()[0].url,
        "https://example.com/hook-v2"
    );
}

#[test]
fn hooks_apply_validates_event_and_conflicts() {
    let store = AutomationStore::open_in_memory().expect("open store");
    let base = store.snapshot().expect("snapshot").hooks.revision;

    let error = store
        .hooks_apply(apply_input(
            base,
            vec![AutomationOp::Create {
                item: json!({
                    "id": "bad",
                    "name": "Bad",
                    "event": "message_update",
                    "type": "command",
                    "script": "echo hi",
                }),
            }],
        ))
        .expect_err("unsupported event rejected");
    assert!(error.contains("event"));

    let ok = store
        .hooks_apply(apply_input(
            base,
            vec![AutomationOp::Create {
                item: json!({
                    "id": "good",
                    "name": "Good",
                    "event": "agent_end",
                    "enabled": true,
                    "type": "command",
                    "script": "echo done",
                }),
            }],
        ))
        .expect("create hook");
    assert_eq!(ok.status, ApplyStatus::Ok);

    let conflict = store
        .hooks_apply(apply_input(base, vec![]))
        .expect("stale hooks apply");
    assert_eq!(conflict.status, ApplyStatus::Conflict);
}

#[test]
fn cron_apply_persists_and_trims_workdir() {
    let (store, task) = store_with_task(AutomationOp::Create {
        item: json!({
            "id": "pinned-bash",
            "name": "Pinned Bash",
            "cron": "0 * * * * *",
            "enabled": true,
            "type": "bash",
            "script": "pwd",
            "workdir": "  /tmp/pinned-workspace  ",
        }),
    });
    assert_eq!(task.workdir.as_deref(), Some("/tmp/pinned-workspace"));

    let (_, empty_task) = store_with_task(AutomationOp::Create {
        item: json!({
            "id": "unpinned-bash",
            "name": "Unpinned Bash",
            "cron": "0 * * * * *",
            "enabled": true,
            "type": "bash",
            "script": "pwd",
            "workdir": "",
        }),
    });
    assert!(empty_task.workdir.is_none());

    // Round-trips through config_json.
    let reread = store
        .cron_task_for_manual_run("pinned-bash")
        .expect("reload pinned task")
        .1;
    assert_eq!(reread.workdir.as_deref(), Some("/tmp/pinned-workspace"));
}

#[test]
fn cron_apply_update_empty_workdir_clears_pin() {
    let (store, task) = store_with_task(AutomationOp::Create {
        item: json!({
            "id": "pinned",
            "name": "Pinned",
            "cron": "0 * * * * *",
            "enabled": true,
            "type": "bash",
            "script": "pwd",
            "workdir": "/tmp/pinned-workspace",
        }),
    });

    // A patch without the workdir key keeps the stored pin (old clients).
    let revision = store.snapshot().expect("snapshot").cron.revision;
    let kept = store
        .cron_apply(apply_input(
            revision,
            vec![AutomationOp::Update {
                id: task.id.clone(),
                patch: json!({ "name": "Renamed" }),
            }],
        ))
        .expect("patch without workdir");
    assert_eq!(
        kept.cron.tasks[0].workdir.as_deref(),
        Some("/tmp/pinned-workspace")
    );

    // An explicit empty string clears the pin (follow the active workspace).
    let cleared = store
        .cron_apply(apply_input(
            kept.cron.revision,
            vec![AutomationOp::Update {
                id: task.id.clone(),
                patch: json!({ "workdir": "" }),
            }],
        ))
        .expect("patch clearing workdir");
    assert!(cleared.cron.tasks[0].workdir.is_none());
}

#[test]
fn cron_apply_http_task_drops_workdir() {
    let (_, task) = store_with_task(AutomationOp::Create {
        item: json!({
            "id": "http-task",
            "name": "Http",
            "cron": "0 * * * * *",
            "enabled": true,
            "type": "http",
            "requests": [{ "url": "https://example.com/ping", "method": "GET" }],
            "workdir": "/tmp/pinned-workspace",
        }),
    });
    assert!(task.workdir.is_none());
}

#[test]
fn manual_run_resolves_task_workdir() {
    let (store, task) = store_with_task(AutomationOp::Create {
        item: json!({
            "id": "pinned",
            "name": "Pinned",
            "cron": "0 * * * * *",
            "enabled": true,
            "type": "bash",
            "script": "pwd",
            "workdir": "/tmp/pinned-workspace",
        }),
    });
    let (workdir, _) = store
        .cron_task_for_manual_run(&task.id)
        .expect("manual run context");
    assert_eq!(workdir, "/tmp/pinned-workspace");

    // Without a pin the resolution falls back to the global workdir, which is
    // empty in the in-memory store (no system_settings table).
    let (unpinned_store, unpinned) = store_with_task(create_bash_task_op("plain", "Plain"));
    let (fallback_workdir, _) = unpinned_store
        .cron_task_for_manual_run(&unpinned.id)
        .expect("manual run context without pin");
    assert_eq!(fallback_workdir, "");
}

#[test]
fn scheduled_fire_reads_fresh_task() {
    let (store, task) = store_with_task(AutomationOp::Create {
        item: json!({
            "id": "fresh",
            "name": "Fresh",
            "cron": "0 * * * * *",
            "enabled": true,
            "type": "bash",
            "script": "pwd",
            "workdir": "/tmp/pinned-workspace",
        }),
    });

    let fired = store
        .cron_task_for_scheduled_fire(&task.id)
        .expect("scheduled fire read");
    let (workdir, fresh) = fired.expect("task exists");
    assert_eq!(workdir, "/tmp/pinned-workspace");
    assert_eq!(fresh.id, task.id);

    // A deleted task resolves to None instead of an error.
    assert!(store
        .cron_task_for_scheduled_fire("missing-task")
        .expect("missing task read")
        .is_none());
}

#[test]
fn queue_prompt_run_stamps_workdir() {
    let (store, task) = store_with_task(create_prompt_task_op("p1"));
    store
        .queue_prompt_run(&task, "/tmp/pinned-workspace", true)
        .expect("queue with workdir");
    let claims = store.claim_prompt_runs().expect("claim");
    assert_eq!(claims.len(), 1);
    assert_eq!(claims[0].workdir, "/tmp/pinned-workspace");
    // No per-task reasoning configured -> empty (runner default).
    assert_eq!(claims[0].reasoning, "");
}

#[test]
fn cron_apply_validates_and_stamps_prompt_reasoning() {
    let (store, task) = store_with_task(AutomationOp::Create {
        item: json!({
            "id": "thinker",
            "name": "Thinker",
            "cron": "0 * * * * *",
            "enabled": true,
            "type": "prompt",
            "prompt": "Summarize the repo",
            "selectedModel": { "customProviderId": "provider-a", "model": "gpt-5" },
            "reasoning": "xhigh",
        }),
    });
    assert_eq!(task.reasoning.as_deref(), Some("xhigh"));

    // Queue carries the level to the runner.
    store
        .queue_prompt_run(&task, "", true)
        .expect("queue with reasoning");
    let claims = store.claim_prompt_runs().expect("claim");
    assert_eq!(claims[0].reasoning, "xhigh");

    // Empty clears back to the runtime default; unknown levels are rejected.
    let revision = store.snapshot().expect("snapshot").cron.revision;
    let cleared = store
        .cron_apply(apply_input(
            revision,
            vec![AutomationOp::Update {
                id: task.id.clone(),
                patch: json!({ "reasoning": "" }),
            }],
        ))
        .expect("clear reasoning");
    assert!(cleared.cron.tasks[0].reasoning.is_none());

    let error = store
        .cron_apply(apply_input(
            cleared.cron.revision,
            vec![AutomationOp::Update {
                id: task.id.clone(),
                patch: json!({ "reasoning": "ultra" }),
            }],
        ))
        .expect_err("reject unknown reasoning level");
    assert!(error.contains("reasoning"));
}

#[test]
fn disable_task_with_error_flips_enabled_and_bumps_revision() {
    let (store, task) = store_with_task(create_bash_task_op("a", "First"));
    let before = store.snapshot().expect("snapshot before").cron;
    assert!(before.tasks[0].enabled);

    store
        .disable_task_with_error(&task.id, "Cron task workspace is unavailable")
        .expect("disable task");

    let after = store.snapshot().expect("snapshot after").cron;
    assert_eq!(after.revision, before.revision + 1);
    assert!(!after.tasks[0].enabled);
    assert_eq!(
        after.tasks[0].last_error.as_deref(),
        Some("Cron task workspace is unavailable")
    );

    // Disabling an unknown task is a no-op instead of an error.
    store
        .disable_task_with_error("missing-task", "irrelevant")
        .expect("disable missing task");
    let unchanged = store.snapshot().expect("snapshot unchanged").cron;
    assert_eq!(unchanged.revision, after.revision);
}

#[test]
fn cron_apply_defaults_and_validates_timeout_seconds() {
    // Creates without the field resolve to the default and always serialize it.
    let (store, task) = store_with_task(create_bash_task_op("a", "First"));
    assert_eq!(task.timeout_seconds, DEFAULT_CRON_TIMEOUT_SECONDS);
    let wire = serde_json::to_value(&task).expect("serialize task");
    assert_eq!(wire.get("timeoutSeconds"), Some(&json!(300)));

    let revision = store.snapshot().expect("snapshot").cron.revision;
    let response = store
        .cron_apply(apply_input(
            revision,
            vec![AutomationOp::Update {
                id: task.id.clone(),
                patch: json!({ "timeoutSeconds": 45 }),
            }],
        ))
        .expect("apply timeout update");
    assert_eq!(response.status, ApplyStatus::Ok);
    assert_eq!(response.cron.tasks[0].timeout_seconds, 45);

    // Patches that do not name the field keep the stored value.
    let response = store
        .cron_apply(apply_input(
            response.cron.revision,
            vec![AutomationOp::Update {
                id: task.id.clone(),
                patch: json!({ "name": "Renamed" }),
            }],
        ))
        .expect("apply unrelated update");
    assert_eq!(response.cron.tasks[0].timeout_seconds, 45);

    // Out-of-range and non-integer values are rejected, not silently clamped.
    let revision = response.cron.revision;
    for bad in [json!(0), json!(601), json!("300"), json!(-5)] {
        let error = store
            .cron_apply(apply_input(
                revision,
                vec![AutomationOp::Update {
                    id: task.id.clone(),
                    patch: json!({ "timeoutSeconds": bad }),
                }],
            ))
            .expect_err("reject invalid timeout");
        assert!(error.contains("timeoutSeconds"), "error: {error}");
    }
}

#[test]
fn cron_timeout_upper_bound_is_per_kind() {
    // Prompt tasks accept values beyond the bash/http cap, up to one hour.
    let (store, task) = store_with_task(create_prompt_task_op("p1"));
    let revision = store.snapshot().expect("snapshot").cron.revision;
    let response = store
        .cron_apply(apply_input(
            revision,
            vec![AutomationOp::Update {
                id: task.id.clone(),
                patch: json!({ "timeoutSeconds": 601 }),
            }],
        ))
        .expect("prompt accepts 601");
    assert_eq!(response.status, ApplyStatus::Ok);
    let response = store
        .cron_apply(apply_input(
            response.cron.revision,
            vec![AutomationOp::Update {
                id: task.id.clone(),
                patch: json!({ "timeoutSeconds": 3600 }),
            }],
        ))
        .expect("prompt accepts 3600");
    assert_eq!(response.status, ApplyStatus::Ok);
    assert_eq!(response.cron.tasks[0].timeout_seconds, 3600);

    // Beyond the prompt cap is still rejected.
    let revision = response.cron.revision;
    for bad in [json!(3601), json!(0)] {
        let error = store
            .cron_apply(apply_input(
                revision,
                vec![AutomationOp::Update {
                    id: task.id.clone(),
                    patch: json!({ "timeoutSeconds": bad }),
                }],
            ))
            .expect_err("reject out-of-range prompt timeout");
        assert!(error.contains("timeoutSeconds"), "error: {error}");
    }

    // Switching a long-timeout prompt task to bash re-validates against the
    // bash cap and rejects instead of clamping.
    let error = store
        .cron_apply(apply_input(
            revision,
            vec![AutomationOp::Update {
                id: task.id.clone(),
                patch: json!({ "type": "bash", "script": "echo hi" }),
            }],
        ))
        .expect_err("reject kind switch with oversized timeout");
    assert!(error.contains("timeoutSeconds"), "error: {error}");

    // bash/http creations stay capped at 600.
    let revision = store.snapshot().expect("snapshot").cron.revision;
    let error = store
        .cron_apply(apply_input(
            revision,
            vec![AutomationOp::Create {
                item: json!({
                    "id": "b1",
                    "name": "Bash",
                    "cron": "0 * * * * *",
                    "type": "bash",
                    "script": "echo hello",
                    "timeoutSeconds": 601,
                }),
            }],
        ))
        .expect_err("bash rejects 601");
    assert!(error.contains("timeoutSeconds"), "error: {error}");
}

#[test]
fn prompt_lease_starts_at_claim_not_enqueue() {
    let (store, task) = store_with_task(create_prompt_task_op("p1"));
    let revision = store.snapshot().expect("snapshot").cron.revision;
    let response = store
        .cron_apply(apply_input(
            revision,
            vec![AutomationOp::Update {
                id: task.id.clone(),
                patch: json!({ "timeoutSeconds": 30 }),
            }],
        ))
        .expect("apply timeout update");
    let task = response.cron.tasks[0].clone();

    let before_queue = db::now_ms();
    assert!(matches!(
        store
            .queue_prompt_run(&task, "", true)
            .expect("queue prompt run"),
        super::store::PromptQueueOutcome::Queued
    ));

    // While pending, the row carries the fixed claim window, not the task
    // timeout.
    let claims = store.claim_prompt_runs().expect("claim");
    assert_eq!(claims.len(), 1);
    let claim = &claims[0];
    assert_eq!(claim.timeout_seconds, 30);
    let pending_deadline = claim.started_at + super::store::PROMPT_PENDING_CLAIM_WINDOW_MS;
    assert!(
        claim.lease_expires_at < pending_deadline,
        "claim re-stamps the lease from the timeout, not the pending window"
    );

    // The execution lease is stamped at claim time from the timeout snapshot.
    let after_claim = db::now_ms();
    assert!(claim.lease_expires_at >= before_queue + 30_000);
    assert!(claim.lease_expires_at <= after_claim + 30_000);

    // Column and returned request agree.
    let column = store
        .debug_run_lease(&claim.execution_id)
        .expect("read lease column");
    assert_eq!(column, Some(claim.lease_expires_at));
}

#[test]
fn released_prompt_run_gets_fresh_claim_window() {
    let (store, task) = store_with_task(create_prompt_task_op("p1"));
    store.queue_prompt_run(&task, "", true).expect("queue");
    let claims = store.claim_prompt_runs().expect("claim");
    let execution_id = claims[0].execution_id.clone();
    let execution_lease = claims[0].lease_expires_at;

    store.release_prompt_run(&execution_id, store.debug_background_lease(&execution_id).as_ref()).expect("release");
    let released_lease = store
        .debug_run_lease(&execution_id)
        .expect("read lease after release")
        .expect("lease present");
    // Back to a pending claim window (longer than the 300s execution lease).
    assert!(released_lease > execution_lease);

    // Re-claiming re-stamps the execution lease again.
    let reclaimed = store.claim_prompt_runs().expect("reclaim");
    assert_eq!(reclaimed.len(), 1);
    assert_eq!(reclaimed[0].execution_id, execution_id);
    assert!(reclaimed[0].lease_expires_at < released_lease);
}

#[test]
fn sweep_distinguishes_unclaimed_from_execution_timeout() {
    // An overdue pending run expires with the "never claimed" message.
    let (store, task) = store_with_task(create_prompt_task_op("p1"));
    store.queue_prompt_run(&task, "", false).expect("queue");
    let pending_id = {
        let claims_probe = store.list_runs("p1", 10).expect("list runs");
        claims_probe[0].id.clone()
    };
    store
        .debug_set_run_lease(&pending_id, db::now_ms() - 1_000)
        .expect("force pending expiry");
    let events = store.sweep_expired_prompt_runs().expect("sweep pending");
    assert_eq!(events.len(), 1);
    let runs = store.list_runs("p1", 10).expect("list runs");
    assert!(matches!(runs[0].state, RunState::Expired));
    assert!(
        runs[0].output.contains("before any runner claimed"),
        "output: {}",
        runs[0].output
    );

    // An overdue leased run expires with the execution-timeout message.
    store.queue_prompt_run(&task, "", false).expect("requeue");
    let claims = store.claim_prompt_runs().expect("claim");
    assert_eq!(claims.len(), 1);
    store
        .debug_set_run_lease(&claims[0].execution_id, db::now_ms() - 1_000)
        .expect("force leased expiry");
    let events = store.sweep_expired_prompt_runs().expect("sweep leased");
    assert_eq!(events.len(), 1);
    let runs = store.list_runs("p1", 10).expect("list runs");
    let leased_run = runs
        .iter()
        .find(|run| run.id == claims[0].execution_id)
        .expect("find leased run");
    assert!(
        leased_run.output.contains("timed out before the front-end"),
        "output: {}",
        leased_run.output
    );
}

#[test]
fn prompt_run_request_missing_timeout_defaults() {
    // Rows serialized before the timeout snapshot existed resolve to the
    // default instead of failing to parse.
    let request: PromptRunRequest = serde_json::from_value(json!({
        "executionId": "e1",
        "taskId": "t1",
        "taskName": "Old row",
        "prompt": "hi",
        "providerId": "provider-a",
        "model": "gpt-5",
        "startedAt": 1,
        "leaseExpiresAt": 2,
    }))
    .expect("parse legacy request json");
    assert_eq!(request.timeout_seconds, DEFAULT_CRON_TIMEOUT_SECONDS);
}
