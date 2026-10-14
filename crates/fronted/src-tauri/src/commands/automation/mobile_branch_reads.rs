//! SDK queries enforce original task/account scope before releasing data to a
//! model. Interactive metadata discovery grants no assistant read authority.
use std::sync::Arc;
use serde::Deserialize;
use serde_json::{json,Value};
use tauri_plugin_mobile_assistant::{CalendarKind,CalendarListRequest,CalendarListResult,CalendarRangeRequest,ReminderListRequest,MobileAssistantExt,HealthMetricRequest,HealthSamplesRequest};
use crate::services::automation::{AutomationStore,MobileReadDestination};
use crate::services::worker_peers::WorkerPeerRegistry;
use super::submission::read_owned_device_branches;
mod health;

pub(super) fn available_health_authorization(app:&tauri::AppHandle,mut status:Value) -> Value {
    if let Err(error)=health::available(app) {
        for key in ["allowedKinds","canDiscoverKinds"] {
            if let Some(kinds)=status[key].as_array_mut() {kinds.retain(|kind|kind!="health");}
        }
        status["blockedReasons"]["health"]=json!(error);
        status["canApprove"]=json!(status["canDiscoverKinds"].as_array().is_some_and(|kinds|!kinds.is_empty()));
    }
    status
}

fn calendar_kind(kind:&str) -> Result<CalendarKind,String> {
    match kind {"event"=>Ok(CalendarKind::Event),"reminder"=>Ok(CalendarKind::Reminder),_=>Err("Unknown task read capability".into())}
}
fn lists(app:&tauri::AppHandle,kind:&str,scope:Option<&[MobileReadDestination]>) -> Result<CalendarListResult,String> {
    app.mobile_assistant().list_calendars(CalendarListRequest {kind:calendar_kind(kind)?,writable_only:false,calendar_ids:scope.map(|scope|scope.iter().map(|item|item.id.clone()).collect())}).map_err(|e|e.to_string())
}
fn observed(kind:&str,calendars:&CalendarListResult,selected:&[MobileReadDestination]) -> Result<Vec<MobileReadDestination>,String> {
    selected.iter().filter(|scope|scope.kind==kind).map(|scope| {
        let item=calendars.calendars.iter().find(|calendar|calendar.id==scope.id && calendar.source_id==scope.source_id)
            .ok_or_else(||"Selected task calendar/list or OS account changed or disappeared".to_string())?;
        Ok(MobileReadDestination {kind:kind.into(),id:item.id.clone(),source_id:item.source_id.clone(),title:item.title.clone(),source:item.source.clone(),writable:item.writable,start_ms:None,end_ms:None})
    }).collect()
}
fn same_revision(before:&Value,after:&Value) -> Result<(),String> {
    if before["contextHash"]!=after["contextHash"] || before["revision"]!=after["revision"] || before["decision"]!=after["decision"] {
        return Err("Task/account read authorization changed; discard the late SDK result".into());
    }
    Ok(())
}

#[derive(Clone,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct MobileReadChoice {
    kind:String,id:String,source_id:String,
    #[serde(default)] start_ms:Option<i64>,
    #[serde(default)] end_ms:Option<i64>,
}

#[tauri::command(rename_all="snake_case")]
pub async fn automation_mobile_branch_read_authorization(app:tauri::AppHandle,entry_id:String,branch_id:String,store:tauri::State<'_,Arc<AutomationStore>>) -> Result<Value,String> {
    let store=Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move||store.mobile_branch_read_authorization(&entry_id,&branch_id).map(|status|available_health_authorization(&app,status))).await.map_err(|e|e.to_string())?
}

#[tauri::command(rename_all="snake_case")]
pub async fn automation_mobile_branch_read_choices(window:tauri::WebviewWindow,app:tauri::AppHandle,entry_id:String,branch_id:String,kind:String,store:tauri::State<'_,Arc<AutomationStore>>) -> Result<Value,String> {
    if window.label()=="agent-worker" {return Err("Account discovery belongs to the original client's review".into());}
    let store=Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move|| {
        let before=store.check_mobile_branch_read_discovery(&entry_id,&branch_id,&kind)?;
        let available=if kind=="health" {health::choices(&app)?} else {
            let lists=lists(&app,&kind,None)?;
            json!({"calendars":lists.calendars,"truncated":lists.truncated})
        };
        let after=store.check_mobile_branch_read_discovery(&entry_id,&branch_id,&kind)?;
        same_revision(&before,&after)?;
        Ok(json!({"authorization":after,"kind":kind,"calendars":available["calendars"],"truncated":available["truncated"]}))
    }).await.map_err(|e|e.to_string())?
}

#[tauri::command(rename_all="snake_case")]
pub async fn automation_mobile_branch_read_decide(window:tauri::WebviewWindow,app:tauri::AppHandle,entry_id:String,branch_id:String,expected_hash:String,expected_revision:u32,selections:Vec<MobileReadChoice>,approve:bool,store:tauri::State<'_,Arc<AutomationStore>>) -> Result<(),String> {
    if window.label()=="agent-worker" {return Err("Task read authorization belongs to the original client's review".into());}
    if selections.len()>16 || (approve && selections.is_empty()) {return Err("Select 1–16 task lists for approval".into());}
    let store=Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move|| {
        let mut actual=Vec::new();
        if approve {
            let status=store.mobile_branch_read_authorization(&entry_id,&branch_id)?;
            if status["contextHash"]!=expected_hash || status["revision"]!=expected_revision {return Err("The reviewed task read scope is stale".into());}
            let mut seen=std::collections::HashSet::new();
            for choice in &selections {
                if choice.id.trim().is_empty() || choice.id.len()>4096 || choice.source_id.trim().is_empty() || choice.source_id.len()>4096 || !seen.insert((&choice.kind,&choice.id)) {return Err("Invalid/duplicate task read choice".into());}
                if choice.kind=="health" {health::destination(&app,choice)?;}
                if choice.kind!="health" {calendar_kind(&choice.kind)?;if choice.start_ms.is_some() || choice.end_ms.is_some() {return Err("Calendar choices cannot carry health ranges".into());}}
            }
            for choice in selections.iter().filter(|choice|choice.kind=="health") {
                let before=store.check_mobile_branch_read_discovery(&entry_id,&branch_id,"health")?;
                if before["contextHash"]!=expected_hash || before["revision"]!=expected_revision {return Err("Reviewed health authorization changed before OS request".into());}
                let scope=health::approve(&app,choice)?;
                let after=store.check_mobile_branch_read_discovery(&entry_id,&branch_id,"health")?;
                same_revision(&before,&after)?;
                actual.push(scope);
            }
            for kind in ["event","reminder"] {
                let chosen:Vec<_>=selections.iter().filter(|choice|choice.kind==kind).map(|choice|MobileReadDestination {kind:choice.kind.clone(),id:choice.id.clone(),source_id:choice.source_id.clone(),title:String::new(),source:String::new(),writable:false,start_ms:None,end_ms:None}).collect();
                if chosen.is_empty() {continue;}
                store.check_mobile_branch_read_discovery(&entry_id,&branch_id,kind)?;
                actual.extend(observed(kind,&lists(&app,kind,Some(&chosen))?,&chosen)?);
            }
        }
        store.decide_mobile_branch_read_authorization(&entry_id,&branch_id,&expected_hash,expected_revision,actual,approve)
    }).await.map_err(|e|e.to_string())?
}

async fn ready(app:&tauri::AppHandle,store:Arc<AutomationStore>,registry:&WorkerPeerRegistry,entry:&str,branch:&str) -> Result<(),String> {
    let packet=read_owned_device_branches(app,store,registry,entry).await?;
    if !packet["branches"].as_array().is_some_and(|branches|branches.iter().any(|item|item["source"]["id"]==branch && item["ready"]==true)) {return Err("The original controller has not released this branch for reading".into());}
    Ok(())
}

fn read(app:&tauri::AppHandle,store:&AutomationStore,entry:&str,branch:&str,action:&str,request:Value) -> Result<(Value,String,Value),String> {
    if action=="read_health_samples" {return health::read(app,store,entry,branch,request);}
    let (kind,keys):(&str,&[&str])=match action {
        "list_calendars"=>(request["kind"].as_str().ok_or_else(||"Task calendar discovery requires an explicit kind".to_string())?,&["kind"]),
        "list_calendar_events"=>("event",&["startMs","endMs","limit"]),
        "list_reminders"=>("reminder",&["incompleteOnly","limit"]),
        _=>return Err("Task planning permits only authorized calendar/reminder reads".into()),
    };
    calendar_kind(kind)?;
    if request.as_object().is_none_or(|object|object.keys().any(|key|!keys.contains(&key.as_str()))) {return Err("Unexpected task read arguments; callers cannot inject calendar scope".into());}
    let (before,scope)=store.mobile_branch_read_scope(entry,branch,kind)?;
    let assistant=app.mobile_assistant();
    let available=lists(app,kind,scope.as_deref())?;
    let selected=scope.as_ref().map(|scope|observed(kind,&available,scope)).transpose()?;
    let ids=selected.as_ref().map(|selected|selected.iter().map(|scope|scope.id.clone()).collect::<Vec<_>>());
    if ids.as_ref().is_some_and(|ids|ids.is_empty()) {return Err("No task lists are authorized for this read".into());}
    let payload=if action=="list_calendars" {
        let calendars=available.calendars.into_iter().filter(|calendar|selected.as_ref().is_none_or(|scopes|scopes.iter().any(|scope|scope.id==calendar.id && scope.source_id==calendar.source_id))).collect::<Vec<_>>();
        json!({"calendars":calendars,"truncated":available.truncated})
    } else {
        let (rows,limit)=if action=="list_calendar_events" {
            let mut query:CalendarRangeRequest=serde_json::from_value(request.clone()).map_err(|e|e.to_string())?;
            if query.start_ms<=0 || query.end_ms<=query.start_ms || query.end_ms.saturating_sub(query.start_ms)>365*4*24*60*60*1000_i64 || query.limit==0 || query.limit>200 {return Err("Task event read needs a positive interval of at most 1460 days and 1–200 records".into());}
            query.calendar_ids=ids;
            let limit=query.limit;
            (serde_json::to_value(assistant.list_calendar_events(query).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?,limit)
        } else {
            let mut query:ReminderListRequest=serde_json::from_value(request.clone()).map_err(|e|e.to_string())?;
            if query.limit==0 || query.limit>200 {return Err("Task reminder read needs 1–200 records".into());}
            query.calendar_ids=ids;
            let limit=query.limit;
            (serde_json::to_value(assistant.list_reminders(query).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?,limit)
        };
        let records=rows.as_array().ok_or_else(||"Native task read returned no record array".to_string())?;
        if records.len()>usize::from(limit) || records.iter().any(|row|row["calendarId"].as_str().is_none_or(str::is_empty) || row["sourceId"].as_str().is_none_or(str::is_empty)
            || selected.as_ref().is_some_and(|scopes|!scopes.iter().any(|scope|row["calendarId"]==scope.id && row["sourceId"]==scope.source_id))) {return Err("SDK task read returned records outside its authorized list/account scope".into());}
        let truncated=records.len()>=usize::from(limit);
        if action=="list_calendar_events" {json!({"events":rows,"truncated":truncated})} else {json!({"reminders":rows,"truncated":truncated})}
    };
    if serde_json::to_vec(&payload).map_err(|e|e.to_string())?.len()>1024*1024 {return Err("Task read exceeds its bounded model payload".into());}
    Ok((payload,kind.into(),before))
}

#[tauri::command(rename_all="snake_case")]
pub async fn automation_mobile_branch_read_data(app:tauri::AppHandle,entry_id:String,branch_id:String,action:String,request:Value,store:tauri::State<'_,Arc<AutomationStore>>,registry:tauri::State<'_,Arc<WorkerPeerRegistry>>) -> Result<Value,String> {
    read_for_controller(app,entry_id,branch_id,action,request,Arc::clone(store.inner()),Arc::clone(registry.inner())).await
}

pub(super) async fn read_for_controller(app:tauri::AppHandle,entry_id:String,branch_id:String,action:String,request:Value,store:Arc<AutomationStore>,registry:Arc<WorkerPeerRegistry>) -> Result<Value,String> {
    if serde_json::to_vec(&request).map_err(|e|e.to_string())?.len()>8192 {return Err("Task read arguments exceed their bound".into());}
    ready(&app,Arc::clone(&store),&registry,&entry_id,&branch_id).await?;
    let native=Arc::clone(&store);let device=app.clone();let entry=entry_id.clone();let branch=branch_id.clone();
    let (payload,kind,before)=tauri::async_runtime::spawn_blocking(move||read(&device,&native,&entry,&branch,&action,request)).await.map_err(|e|e.to_string())??;
    ready(&app,Arc::clone(&store),&registry,&entry_id,&branch_id).await?;
    // Recheck after the LAST awaited RPC, so a revoked grant, OS permission,
    // account, controller or local cancellation cannot release a late result.
    tauri::async_runtime::spawn_blocking(move|| {
        let (status,scope)=store.mobile_branch_read_scope(&entry_id,&branch_id,&kind)?;same_revision(&before,&status)?;
        if kind=="health" {health::revalidate(&app,&payload,scope.as_deref())?;} else {
            let fresh=lists(&app,&kind,scope.as_deref())?;if let Some(scope)=scope {observed(&kind,&fresh,&scope)?;}
        }
        let (after,_)=store.mobile_branch_read_scope(&entry_id,&branch_id,&kind)?;same_revision(&before,&after)?;
        Ok(payload)
    }).await.map_err(|e|e.to_string())?
}
