//! Original phone owns execution; the controller receives only native ledger receipts.
use std::sync::Arc;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri_plugin_mobile_assistant::{CalendarKind, CalendarListRequest, MobileAssistantExt};
use crate::services::automation::{AutomationStore, BackgroundSourceBranch, DeviceBranchAction, DeviceBranchPlan, MobileConnectorWriteInput, MobileConnectorWriteRecord};
use crate::services::worker_peers::WorkerPeerRegistry;
use super::submission::{invoke_owned_device_channel, read_owned_device_branches};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MobileBranchActionProposal { kind: String, request: Value, source_id: String }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MobilePlanningTicket { attempts: u32, recovery: u32 }

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_mobile_branch_authorization(entry_id: String, branch_id: String, store: tauri::State<'_, Arc<AutomationStore>>) -> Result<Value,String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.mobile_branch_authorization(&entry_id,&branch_id)).await.map_err(|e|e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_mobile_branch_decide(window: tauri::WebviewWindow, app: tauri::AppHandle, entry_id: String, branch_id: String, expected_hash: String, expected_revision: u32, approve: bool,
    store: tauri::State<'_, Arc<AutomationStore>>, registry: tauri::State<'_, Arc<WorkerPeerRegistry>>) -> Result<(),String> {
    if window.label() == "agent-worker" { return Err("Task approval belongs to the initiating client's review".into()); }
    let store = Arc::clone(store.inner());
    if approve {
        let packet = read_owned_device_branches(&app,Arc::clone(&store),registry.inner(),&entry_id).await?;
        if !packet["branches"].as_array().is_some_and(|branches|branches.iter().any(|branch|branch["source"]["id"] == branch_id && branch["ready"] == true)) { return Err("Original controller has not released this branch for approval".into()); }
    }
    // Revocation needs no network; the final native effect claim sees it.
    tauri::async_runtime::spawn_blocking(move || store.decide_mobile_branch_authorization(&entry_id,&branch_id,&expected_hash,expected_revision,approve)).await.map_err(|e|e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_mobile_branch_inspect(app:tauri::AppHandle,entry_id: String, store: tauri::State<'_, Arc<AutomationStore>>) -> Result<Value, String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let mut review=store.inspect_mobile_branches(&entry_id)?;
        if let Some(branches)=review["branches"].as_array_mut() {
            for branch in branches {
                if branch["readAuthorization"].is_object() {
                    branch["readAuthorization"]=super::mobile_branch_reads::available_health_authorization(&app,branch["readAuthorization"].clone());
                }
            }
        }
        Ok(review)
    }).await.map_err(|e|e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_mobile_branch_error(entry_id: String, branch_id: String, error: Option<String>, planning: Option<MobilePlanningTicket>, store: tauri::State<'_, Arc<AutomationStore>>) -> Result<(), String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.note_mobile_branch_error(&entry_id,&branch_id,error.as_deref(),planning.map(|ticket|(ticket.attempts,ticket.recovery)))).await.map_err(|e|e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_mobile_branch_retry(window: tauri::WebviewWindow, app: tauri::AppHandle, entry_id: String, branch_id: String, expected_recovery: u32,
    store: tauri::State<'_, Arc<AutomationStore>>, registry: tauri::State<'_, Arc<WorkerPeerRegistry>>) -> Result<(), String> {
    if window.label() == "agent-worker" { return Err("Planning recovery belongs to the initiating client's task view".into()); }
    let store = Arc::clone(store.inner());
    let packet = read_owned_device_branches(&app,Arc::clone(&store),registry.inner(),&entry_id).await?;
    if !packet["branches"].as_array().is_some_and(|branches|branches.iter().any(|branch|branch["source"]["id"] == branch_id && branch["ready"] == true)) {
        return Err("Original controller has not released this branch for recovery".into());
    }
    tauri::async_runtime::spawn_blocking(move || store.retry_mobile_branch_planning(&entry_id,&branch_id,expected_recovery)).await.map_err(|e|e.to_string())?
}

fn accepted(plan: &DeviceBranchPlan, reply: &Value) -> Result<(), String> {
    if reply["accepted"] != true || reply["requestId"] != plan.request_id || reply["sourceHostId"] != plan.source_host_id || reply["branchId"] != plan.source.id
        || serde_json::to_vec(reply).map_err(|e|e.to_string())?.len() > 4096 {
        return Err("Controller did not retain the exact original-device action plan/receipt".into());
    }
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_mobile_branch_context(entry_id: String, branch_id: String, store: tauri::State<'_, Arc<AutomationStore>>) -> Result<Value, String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.reserve_mobile_branch_planning(&entry_id,&branch_id)).await.map_err(|e|e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_mobile_branch_pending(cursor: Option<u64>, store: tauri::State<'_, Arc<AutomationStore>>) -> Result<Value, String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.pending_mobile_branch_plans(cursor.unwrap_or(0), 20)).await.map_err(|e|e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_mobile_branch_read(entry_id: String, branch_id: String, store: tauri::State<'_, Arc<AutomationStore>>) -> Result<Value, String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let plan = store.read_mobile_branch_plan(&entry_id, &branch_id)?;
        let states = plan.as_ref().map(|plan| plan.actions.iter().map(|action| Ok(store.read_mobile_connector_write(&action.input)?.map(|record|record.state).unwrap_or_else(||"unexecuted".into()))).collect::<Result<Vec<String>,String>>()).transpose()?.unwrap_or_default();
        Ok(json!({"plan":plan,"states":states}))
    }).await.map_err(|e|e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_mobile_branch_prepare(app: tauri::AppHandle, entry_id: String, branch_id: String, actions: Vec<MobileBranchActionProposal>,
    store: tauri::State<'_, Arc<AutomationStore>>, registry: tauri::State<'_, Arc<WorkerPeerRegistry>>) -> Result<DeviceBranchPlan, String> {
    prepare_on_client(app,entry_id,branch_id,actions,Arc::clone(store.inner()),Arc::clone(registry.inner())).await
}

pub(super) async fn prepare_on_client(app:tauri::AppHandle,entry_id:String,branch_id:String,actions:Vec<MobileBranchActionProposal>,store:Arc<AutomationStore>,registry:Arc<WorkerPeerRegistry>)->Result<DeviceBranchPlan,String>{
    if actions.is_empty() || actions.len() > 8 || serde_json::to_vec(&actions.iter().map(|action|json!({"kind":action.kind,"request":action.request,"sourceId":action.source_id})).collect::<Vec<_>>()).map_err(|e|e.to_string())?.len() > 64 * 1024 {
        return Err("Device action proposal exceeds its bounds".into());
    }
    let packet = read_owned_device_branches(&app, Arc::clone(&store), &registry, &entry_id).await?;
    let branch = packet["branches"].as_array().and_then(|branches|branches.iter().find(|branch|branch["source"]["id"] == branch_id && branch["ready"] == true))
        .ok_or_else(|| "Original branch has not become ready; no device plan accepted".to_string())?;
    let source: BackgroundSourceBranch = serde_json::from_value(branch["source"].clone()).map_err(|e|e.to_string())?;
    if source.observation.is_some() {return Err("An original read-only branch cannot accept a device write plan".into());}
    let device = store.background_worker_identity()?;
    let request = packet["requestId"].as_str().ok_or_else(||"Missing original request".to_string())?.to_string();
    let controller = packet["hostId"].as_str().ok_or_else(||"Missing original controller".to_string())?.to_string();
    let save = Arc::clone(&store); let app_read = app.clone(); let entry = entry_id.clone();
    let plan = tauri::async_runtime::spawn_blocking(move || {
        let mut bound = Vec::new();
        let mut labels = Vec::new();
        for (index, proposal) in actions.into_iter().enumerate() {
            let kind = match proposal.kind.as_str() { "calendar_event" => CalendarKind::Event, "reminder" => CalendarKind::Reminder, _ => return Err("Unsupported original-device branch action".into()) };
            let id = proposal.request["calendarId"].as_str().filter(|id|!id.trim().is_empty()).ok_or_else(||"Choose an explicit original-device calendar/list".to_string())?;
            let read_kind=if proposal.kind=="calendar_event" {"event"} else {"reminder"};
            let (_,read_scopes)=save.mobile_branch_read_scope(&entry,&source.id,read_kind)?;
            if read_scopes.as_ref().is_some_and(|scopes|!scopes.iter().any(|scope|scope.id==id && scope.source_id==proposal.source_id)) {return Err("Proposed destination is outside this task's authorized observations".into());}
            let calendars = app_read.mobile_assistant().list_calendars(CalendarListRequest { kind, writable_only: true, calendar_ids: Some(vec![id.to_string()]) }).map_err(|e|e.to_string())?;
            let matches: Vec<_> = calendars.calendars.iter().filter(|calendar|calendar.id == id && calendar.source_id == proposal.source_id && !calendar.source_id.is_empty()).collect();
            if matches.len() != 1 { return Err("Proposed OS calendar/list/account was not actually observed here".into()); }
            let observed = matches[0];
            labels.push(json!({"id":observed.id,"title":observed.title,"sourceId":observed.source_id,"source":observed.source}));
            bound.push(DeviceBranchAction {input:MobileConnectorWriteInput {
                operation_id:crate::services::automation::store::device_action_id(&device,&request,&source.id,index),
                device_host_id:device.clone(),kind:proposal.kind,request:proposal.request},source_id:proposal.source_id});
        }
        let plan = save.save_mobile_branch_plan(&entry, DeviceBranchPlan {version:1,request_id:request,source_host_id:controller,source,actions:bound})?;
        save.save_mobile_branch_labels(&entry,&plan.source.id,json!(labels))?;
        Ok::<_,String>(plan)
    }).await.map_err(|e|e.to_string())??;
    // Persist locally before transmission. Lost ACK/reopen uses the SAME plan.
    let (reply, _) = invoke_owned_device_channel(&app, store, &registry, &entry_id, "automation_background_device_plan", json!({"plan":plan})).await?;
    accepted(&plan,&reply)?;
    Ok(plan)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_mobile_branch_execute(app: tauri::AppHandle, entry_id: String, branch_id: String, index: usize, request: Value,
    store: tauri::State<'_, Arc<AutomationStore>>, registry: tauri::State<'_, Arc<WorkerPeerRegistry>>) -> Result<MobileConnectorWriteRecord, String> {
    let store = Arc::clone(store.inner()); let read = Arc::clone(&store); let entry = entry_id.clone();
    let plan = tauri::async_runtime::spawn_blocking(move || read.read_mobile_branch_plan(&entry,&branch_id)?.ok_or_else(||"No accepted device action plan".to_string())).await.map_err(|e|e.to_string())??;
    let action = plan.actions.get(index).ok_or_else(||"Device action index out of bounds".to_string())?.clone();
    if action.input.request != request { return Err("Tool arguments differ from the frozen native action; no write started".into()); }
    // Fresh original-controller readiness/immutable plan check before EVERY
    // effect. Network failures stop new writes; they never select another PC.
    let (reply, _) = invoke_owned_device_channel(&app, Arc::clone(&store), registry.inner(), &entry_id, "automation_background_device_plan", json!({"plan":plan})).await?;
    accepted(&plan,&reply)?;
    tauri::async_runtime::spawn_blocking(move || {
        store.mobile_branch_context(&entry_id)?; // Recheck local cancellation.
        super::mobile_connector::execute_branch(&app,&store,action.input,&action.source_id,&entry_id,&plan.source.id,index)
    }).await.map_err(|e|e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_mobile_branch_complete(app: tauri::AppHandle, entry_id: String, branch_id: String,
    store: tauri::State<'_, Arc<AutomationStore>>, registry: tauri::State<'_, Arc<WorkerPeerRegistry>>) -> Result<Value, String> {
    let store = Arc::clone(store.inner()); let read = Arc::clone(&store); let entry = entry_id.clone(); let branch = branch_id.clone();
    // Receipt bytes can ONLY originate in the actual native ledger. There is
    // no WebView/model receipt argument, even when delivery is retried.
    let receipt = tauri::async_runtime::spawn_blocking(move || read.mobile_branch_receipt(&entry,&branch)).await.map_err(|e|e.to_string())??;
    let (reply, _) = invoke_owned_device_channel(&app, Arc::clone(&store), registry.inner(), &entry_id, "automation_background_device_complete", json!({"receipt":receipt})).await?;
    accepted(&receipt.plan,&reply)?;
    tauri::async_runtime::spawn_blocking(move || store.acknowledge_mobile_branch(&entry_id,&branch_id)).await.map_err(|e|e.to_string())??;
    Ok(reply)
}
