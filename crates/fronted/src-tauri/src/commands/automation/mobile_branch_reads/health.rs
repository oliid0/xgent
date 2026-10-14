//! A reviewed task metric and fixed range, never a background observer grant.
use super::*;
use tauri_plugin_mobile_assistant::{HealthMetric, MobileAssistantBackend};

const METRICS: [&str;5]=["heart_rate","blood_glucose","oxygen_saturation","weight","body_temperature"];
const WEEK: i64=7*24*60*60*1000;
fn now() -> Result<i64,String> {
    i64::try_from(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e|e.to_string())?.as_millis()).map_err(|e|e.to_string())
}
fn metric(id:&str) -> Result<HealthMetric,String> {
    if !METRICS.contains(&id) {return Err("Unsupported task health metric".into());}
    serde_json::from_value(json!(id)).map_err(|e|e.to_string())
}
fn source(app:&tauri::AppHandle) -> Result<(&'static str,&'static str),String> {
    let status=app.mobile_assistant().status().map_err(|e|e.to_string())?;
    if !status.health_available {return Err("Health reads are unavailable on this device".into());}
    match status.backend {
        MobileAssistantBackend::IosNative=>Ok(("healthkit","HealthKit")),
        MobileAssistantBackend::AndroidNative=>Ok(("health-connect","Health Connect")),
        _=>Err("Task health reads require the original native phone".into()),
    }
}
fn checked_permission(app:&tauri::AppHandle,id:&str,authorize:bool) -> Result<(),String> {
    let (backend,_)=source(app)?;
    let request=HealthMetricRequest {metric:metric(id)?};
    let states=if authorize {app.mobile_assistant().request_health_metric_permission(request)} else {app.mobile_assistant().check_health_metric_permission(request)}.map_err(|e|e.to_string())?;
    if states.get("health").is_some_and(|state|state=="granted" || (backend=="healthkit" && state=="requested")) {Ok(())}
    else {Err("Task health metric permission is unavailable or was revoked".into())}
}
pub(super) fn available(app:&tauri::AppHandle) -> Result<(),String> {source(app).map(|_|())}
pub(super) fn choices(app:&tauri::AppHandle) -> Result<Value,String> {
    let (id,name)=source(app)?;let end=now()?;let start=end-WEEK;
    // Metadata only; neither samples nor a permission prompt occurs here.
    Ok(json!({"calendars":METRICS.iter().map(|metric|json!({"id":metric,"sourceId":id,"title":metric,"source":name,"writable":false,"isDefault":false,"startMs":start,"endMs":end})).collect::<Vec<_>>(),"truncated":false}))
}
pub(super) fn destination(app:&tauri::AppHandle,choice:&MobileReadChoice) -> Result<MobileReadDestination,String> {
    metric(&choice.id)?;
    let (id,name)=source(app)?;
    let (start,end)=match (choice.start_ms,choice.end_ms) {(Some(start),Some(end))=>(start,end),_=>return Err("Review a fixed health read interval before approval".into())};
    let current=now()?;
    if choice.source_id!=id || start<=0 || end<=start || end-start>WEEK || start<current-30*24*60*60*1000 || end>current {
        return Err("Task health source/range is invalid or changed; refresh the review".into());
    }
    Ok(MobileReadDestination {kind:"health".into(),id:choice.id.clone(),source_id:id.into(),title:choice.id.clone(),source:name.into(),writable:false,start_ms:Some(start),end_ms:Some(end)})
}
pub(super) fn approve(app:&tauri::AppHandle,choice:&MobileReadChoice) -> Result<MobileReadDestination,String> {
    destination(app,choice)?;
    // Only the original client's explicit approval command reaches this path.
    checked_permission(app,&choice.id,true)?;
    checked_permission(app,&choice.id,false)?;
    destination(app,choice)
}
fn authorized<'a>(app:&tauri::AppHandle,scopes:Option<&'a [MobileReadDestination]>,id:&str,start:i64,end:i64) -> Result<&'a MobileReadDestination,String> {
    metric(id)?;let (backend,_)=source(app)?;
    let scope=scopes.and_then(|scopes|scopes.iter().find(|scope|scope.kind=="health" && scope.id==id && scope.source_id==backend))
        .ok_or_else(||"Select and approve this task's health metric first".to_string())?;
    if start<=0 || end<=start || !matches!((scope.start_ms,scope.end_ms),(Some(a),Some(b)) if start>=a && end<=b) {
        return Err("Health query exceeds the task's reviewed metric/time scope".into());
    }
    checked_permission(app,id,false)?;
    Ok(scope)
}
pub(super) fn read(app:&tauri::AppHandle,store:&AutomationStore,entry:&str,branch:&str,request:Value) -> Result<(Value,String,Value),String> {
    if request.as_object().is_none_or(|object|object.keys().any(|key|!["metric","startMs","endMs","limit"].contains(&key.as_str()))) {return Err("Unexpected task health arguments".into());}
    let query:HealthSamplesRequest=serde_json::from_value(request.clone()).map_err(|e|e.to_string())?;
    let id=request["metric"].as_str().ok_or_else(||"Missing task health metric".to_string())?;
    if query.limit==0 || query.limit>200 {return Err("Health read needs 1–200 records".into());}
    let (before,scope)=store.mobile_branch_read_scope(entry,branch,"health")?;
    let selected=authorized(app,scope.as_deref(),id,query.start_ms,query.end_ms)?;
    let result=app.mobile_assistant().read_health_samples(query.clone()).map_err(|e|e.to_string())?;
    let value=serde_json::to_value(&result).map_err(|e|e.to_string())?;
    let unit=match id {"heart_rate"=>"bpm","blood_glucose"=>"mg/dL","oxygen_saturation"=>"%","weight"=>"kg",_=>"degC"};
    let mut seen=std::collections::HashSet::new();
    if value["metric"]!=id || result.source!=selected.source_id || result.unit!=unit || result.start_ms!=query.start_ms || result.end_ms!=query.end_ms || !result.access_limited
        || result.samples.len()>usize::from(query.limit) || result.samples.iter().any(|sample|sample.id.is_empty() || sample.id.len()>4096 || !seen.insert(&sample.id)
            || sample.source.is_empty() || sample.source.len()>4096 || !sample.value.is_finite() || sample.start_ms<query.start_ms || sample.end_ms>query.end_ms || sample.end_ms<sample.start_ms) {
        return Err("SDK health records changed metric, range, units, visibility or bounded identities".into());
    }
    authorized(app,scope.as_deref(),id,query.start_ms,query.end_ms)?;
    let (after,_)=store.mobile_branch_read_scope(entry,branch,"health")?;same_revision(&before,&after)?;
    let payload=json!({"health":result});
    if serde_json::to_vec(&payload).map_err(|e|e.to_string())?.len()>1024*1024 {return Err("Health task read exceeds its bounded payload".into());}
    Ok((payload,"health".into(),before))
}
pub(super) fn revalidate(app:&tauri::AppHandle,payload:&Value,scope:Option<&[MobileReadDestination]>) -> Result<(),String> {
    let health=&payload["health"];
    let id=health["metric"].as_str().ok_or_else(||"Missing retained health metric".to_string())?;
    let start=health["startMs"].as_i64().ok_or_else(||"Missing retained health interval".to_string())?;
    let end=health["endMs"].as_i64().ok_or_else(||"Missing retained health interval".to_string())?;
    authorized(app,scope,id,start,end)?;
    Ok(())
}
