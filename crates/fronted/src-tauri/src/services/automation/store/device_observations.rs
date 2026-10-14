//! Only an immutable original-device read contract can join native SDK data.
//! Queue admission, model text and calendar writes are never read evidence.
use super::*;
use sha2::{Digest, Sha256};

impl AutomationStore {
    pub(super) fn device_observation_contract(conn:&Connection,execution:&str,branch:&str)->Result<Option<BackgroundHealthObservation>,String>{
        let raw:String=conn.query_row("SELECT input_json FROM automation_background_tasks WHERE execution_id=?1",params![execution],|row|row.get(0)).map_err(|e|e.to_string())?;
        let input:SubmitBackgroundTaskInput=serde_json::from_str(&raw).map_err(|e|e.to_string())?;
        let Some(routing)=input.source_context.as_ref().and_then(|source|source.routing.as_ref()) else{return Ok(None);};
        routing.validate()?;
        let Some(source)=routing.branches.iter().find(|source|source.id==branch && source.locality=="initiating-device") else{return Ok(None);};
        let Some(contract)=source.observation.clone() else{return Ok(None);};
        contract.validate()?;
        let origin:String=conn.query_row("SELECT initiating_host_id FROM automation_background_device_channels WHERE request_id=?1",params![input.request_id],|row|row.get(0)).map_err(|e|e.to_string())?;
        if routing.version!=2 || origin!=routing.initiating_host_id {return Err("Read contract lost its original private device channel".into());}
        Ok(Some(contract))
    }

    pub(super) fn verified_device_observation(conn:&Connection,execution:&str,branch:&BackgroundBranch)->Result<Option<BackgroundBranchEvidence>,String>{
        let Some(contract)=Self::device_observation_contract(conn,execution,&branch.id)? else{return Ok(None);};
        if !branch.criteria.iter().all(|criterion|matches!(criterion,BackgroundCriterion::Unavailable{..})) {return Err("Native read cannot replace an unrelated outcome criterion".into());}
        let raw:String=conn.query_row("SELECT input_json FROM automation_background_tasks WHERE execution_id=?1",params![execution],|row|row.get(0)).map_err(|e|e.to_string())?;
        let input:SubmitBackgroundTaskInput=serde_json::from_str(&raw).map_err(|e|e.to_string())?;
        let routing=input.source_context.as_ref().and_then(|source|source.routing.as_ref()).ok_or("Missing original read source")?;
        if !routing.branches.iter().any(|source|source.id==branch.id && source.requirement==branch.requirement && source.depends_on==branch.depends_on) {return Err("Native read changed original requirements/dependencies".into());}
        let retained:Option<(String,String,String,String)>=conn.query_row(
            "SELECT c.call_id,c.scope_key,c.result_json,s.scope_json FROM automation_background_device_planning_calls c
             JOIN automation_background_device_planning_scopes s ON s.execution_id=c.execution_id AND s.branch_id=c.branch_id AND s.scope_key=c.scope_key
             JOIN automation_background_operations o ON o.execution_id=c.execution_id AND o.call_id=c.call_id AND o.tool_name='OriginalDeviceTask' AND o.state='returned' AND o.is_error=0
             WHERE c.execution_id=?1 AND c.branch_id=?2 AND c.kind='request_read'
             AND json_extract(c.request_json,'$.action')='read_health_samples'
             AND json_extract(c.request_json,'$.request.metric')=?3 AND json_extract(c.request_json,'$.request.startMs')=?4
             AND json_extract(c.request_json,'$.request.endMs')=?5 AND json_extract(c.request_json,'$.request.limit')=?6
             AND json_type(c.result_json,'$.data.health')='object' AND json_type(c.result_json,'$.error') IS NULL
             ORDER BY c.created_at,c.call_id LIMIT 1",
            params![execution,branch.id,contract.metric,contract.start_ms,contract.end_ms,contract.limit],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).optional().map_err(|e|e.to_string())?;
        let Some((call,key,raw,scope))=retained else{return Ok(None);};
        let scope:Value=serde_json::from_str(&scope).map_err(|e|e.to_string())?;
        if Self::device_planning_scope_key(&scope)?!=key || scope["decision"]!="approved"
            || !scope["allowedKinds"].as_array().is_some_and(|kinds|kinds.iter().any(|kind|kind=="health")) {return Ok(None);}
        let response:Value=serde_json::from_str(&raw).map_err(|e|e.to_string())?;
        let health:tauri_plugin_mobile_assistant::HealthSamplesResult=serde_json::from_value(response["data"]["health"].clone()).map_err(|e|e.to_string())?;
        let expected_unit=match contract.metric.as_str(){"heart_rate"=>"bpm","blood_glucose"=>"mg/dL","oxygen_saturation"=>"%","weight"=>"kg",_=>"degC"};
        let mut ids=std::collections::HashSet::new();
        if response["data"]["health"]["metric"]!=contract.metric || health.start_ms!=contract.start_ms || health.end_ms!=contract.end_ms
            || !health.access_limited || health.unit!=expected_unit || !matches!(health.source.as_str(),"healthkit"|"health-connect")
            || health.samples.len()>usize::from(contract.limit) || health.samples.iter().any(|sample|sample.id.is_empty() || sample.id.len()>4096
                || !ids.insert(&sample.id) || sample.source.is_empty() || sample.source.len()>4096 || !sample.value.is_finite()
                || sample.start_ms<contract.start_ms || sample.end_ms>contract.end_ms || sample.end_ms<sample.start_ms)
            || !scope["selections"].as_array().is_some_and(|selections|selections.iter().any(|selection|
                selection["kind"]=="health" && selection["id"]==contract.metric && selection["sourceId"]==health.source
                && selection["writable"]==false && selection["startMs"].as_i64().is_some_and(|start|start<=contract.start_ms)
                && selection["endMs"].as_i64().is_some_and(|end|end>=contract.end_ms))) {
            return Err("Original SDK health observation changed its fixed read contract or account scope".into());
        }
        // Read data remains in its bounded native queue. Evidence exposes only
        // provenance/limits; the controller must read actual chunks before conclusions.
        let summary=serde_json::json!({"kind":"original_device_health_observation","callId":call,"scopeKey":key,
            "sourceHostId":routing.initiating_host_id,"snapshotHash":format!("{:x}",Sha256::digest(raw.as_bytes())),
            "metric":contract.metric,"source":health.source,"startMs":health.start_ms,"endMs":health.end_ms,
            "sampleCount":health.samples.len(),"truncated":health.truncated,"accessLimited":health.access_limited,
            "instruction":"Read OriginalDeviceTask read_result for this original call before interpreting actual samples. This proves only the bounded authorized SDK read; empty/limited data is not normal health, a write, notification, diagnosis or new permission."});
        Ok(Some(BackgroundBranchEvidence{artifact_ids:vec![],call_ids:vec![],answer:Some(serde_json::to_string(&summary).map_err(|e|e.to_string())?)}))
    }
}
