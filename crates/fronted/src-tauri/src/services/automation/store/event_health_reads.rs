//! Private SDK-only observations for explicit remote Health rules. A scope is
//! not an OS permission, an arbitrary read range or a portable connector grant.
use super::*;
use serde::{Deserialize,Serialize};
use sha2::{Digest,Sha256};
use tauri_plugin_mobile_assistant::HealthSamplesResult;

#[derive(Clone,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct EventHealthReadScope {
    version:u32,
    rule_id:String,
    event_id:String,
    metric:String,
    start_ms:i64,
    end_ms:i64,
    binding_hash:String,
}

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct EventHealthReadResult {
    scope:EventHealthReadScope,
    result:HealthSamplesResult,
}

impl EventHealthReadScope {
    pub(crate) fn sample_request(&self)->Result<tauri_plugin_mobile_assistant::HealthSamplesRequest,String>{
        Ok(tauri_plugin_mobile_assistant::HealthSamplesRequest{
            metric:serde_json::from_value(serde_json::json!(self.metric)).map_err(|e|e.to_string())?,
            start_ms:self.start_ms,end_ms:self.end_ms,limit:50,
        })
    }
    pub(crate) fn observation(self,result:HealthSamplesResult)->EventHealthReadResult {EventHealthReadResult{scope:self,result}}
}

fn current_scope(conn:&Connection,rule:&str,event:&str)->Result<Option<EventHealthReadScope>,String>{
    let saved:Option<(String,String,String,i64,i64,i64)>=conn.query_row(
        "SELECT r.config_json,r.binding_json,h.metric,h.occurred_at,h.sequence,r.cursor FROM automation_proactive_rules r JOIN automation_health_rule_activations a ON a.rule_id=r.rule_id JOIN automation_health_events h ON h.event_id=?2 AND h.occurred_at>=a.activated_at WHERE r.rule_id=?1 AND r.enabled=1",
        params![rule,event],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?))).optional().map_err(|e|e.to_string())?;
    let Some((raw,frozen,metric,occurred,sequence,cursor))=saved else{return Ok(None);};
    let config:super::proactive::ProactiveRuleConfig=serde_json::from_str(&raw).map_err(|e|e.to_string())?;
    let now=db::now_ms();
    if !config.background_health_reads.unwrap_or(false) || config.remote_execution.is_none() || config.event_kind!="health_updated"
        || config.health_metric.as_deref()!=Some(metric.as_str()) || sequence<=cursor || occurred>now
        || occurred.saturating_add(i64::from(config.max_age_minutes)*60000)<=now {return Ok(None);}
    let actual=match super::proactive::validate_config(conn,&config){Ok(actual)=>actual,Err(_)=>return Ok(None)};
    if actual!=frozen {return Ok(None);}
    let approval=crate::commands::settings::mobile_task_read_requires_approval(conn,"health")?;
    let owner:String=conn.query_row("SELECT value FROM automation_meta WHERE key='background_worker_id.v1'",[],|row|row.get(0)).map_err(|e|e.to_string())?;
    let start=occurred.saturating_sub(600000).max(1);
    let material=serde_json::to_vec(&serde_json::json!({"domain":"xgent.event-health-read.v1","ruleId":rule,"eventId":event,
        "owner":owner,"config":raw,"binding":frozen,"metric":metric,"startMs":start,"endMs":occurred,"approval":approval})).map_err(|e|e.to_string())?;
    Ok(Some(EventHealthReadScope{version:1,rule_id:rule.into(),event_id:event.into(),metric,start_ms:start,end_ms:occurred,
        binding_hash:format!("{:x}",Sha256::digest(material))}))
}

fn observation(conn:&Connection,scope:&EventHealthReadScope)->Result<Option<Value>,String>{
    let raw:Option<String>=conn.query_row("SELECT payload_json FROM automation_health_event_snapshots WHERE rule_id=?1 AND event_id=?2 AND binding_hash=?3",
        params![scope.rule_id,scope.event_id,scope.binding_hash],|row|row.get(0)).optional().map_err(|e|e.to_string())?;
    raw.map(|raw|serde_json::from_str(&raw).map_err(|e|e.to_string())).transpose()
}

pub(super) fn event_observation(conn:&Connection,rule:&str,event:&str)->Result<Option<Value>,String>{
    let Some(scope)=current_scope(conn,rule,event)? else{return Ok(None);};
    observation(conn,&scope)
}

impl AutomationStore {
    pub(crate) fn pending_event_health_reads(&self)->Result<Vec<EventHealthReadScope>,String>{
        let conn=self.lock_conn()?;
        let candidates={
            let mut statement=conn.prepare("SELECT r.rule_id,h.event_id FROM automation_proactive_rules r JOIN automation_health_rule_activations a ON a.rule_id=r.rule_id JOIN automation_health_events h ON h.metric=json_extract(r.config_json,'$.healthMetric') AND h.sequence>r.cursor AND h.occurred_at>=a.activated_at WHERE r.enabled=1 AND json_extract(r.config_json,'$.backgroundHealthReads')=1 AND json_type(r.config_json,'$.remoteExecution')='object' AND h.sequence=(SELECT MIN(first.sequence) FROM automation_health_events first WHERE first.metric=h.metric AND first.sequence>r.cursor AND first.occurred_at>=a.activated_at) ORDER BY COALESCE(r.last_queued_at,0),r.created_at,h.sequence LIMIT 20").map_err(|e|e.to_string())?;
            let rows=statement.query_map([],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?))).map_err(|e|e.to_string())?;
            rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?
        };
        let mut pending=Vec::new();
        for (rule,event) in candidates {
            if let Some(scope)=current_scope(&conn,&rule,&event)? {
                if observation(&conn,&scope)?.is_none(){pending.push(scope);}
                if pending.len()==4{break;}
            }
        }
        Ok(pending)
    }

    pub(crate) fn commit_event_health_reads(&self,reads:&[EventHealthReadResult])->Result<(),String>{
        if reads.len()>4{return Err("OS health observations exceed their fair batch".into());}
        let mut conn=self.lock_conn()?;
        let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let owner:String=tx.query_row("SELECT value FROM automation_meta WHERE key='background_worker_id.v1'",[],|row|row.get(0)).map_err(|e|e.to_string())?;
        for read in reads {
            if current_scope(&tx,&read.scope.rule_id,&read.scope.event_id)?.as_ref()!=Some(&read.scope) {
                // Revoked/revised/expired SDK reads cannot enter model context.
                continue;
            }
            let result=&read.result;
            let unit=match read.scope.metric.as_str(){"heart_rate"=>"bpm","blood_glucose"=>"mg/dL","oxygen_saturation"=>"%","weight"=>"kg","body_temperature"=>"degC",_=>return Err("Unsupported event health metric".into())};
            if serde_json::to_value(&result.metric).map_err(|e|e.to_string())?!=read.scope.metric
                || result.start_ms!=read.scope.start_ms || result.end_ms!=read.scope.end_ms || result.samples.len()>50
                || !matches!(result.source.as_str(),"healthkit" | "health-connect") || result.unit!=unit || !result.access_limited
                || (cfg!(target_os="ios") && result.source!="healthkit") || (cfg!(target_os="android") && result.source!="health-connect")
                || result.samples.iter().any(|sample|sample.id.is_empty() || sample.id.len()>1024 || sample.source.is_empty() || sample.source.len()>1024
                    || !sample.value.is_finite() || sample.start_ms<result.start_ms || sample.end_ms<sample.start_ms || sample.end_ms>result.end_ms) {
                return Err("Actual event health observation differs from its fixed SDK scope".into());
            }
            let observed=serde_json::to_string(&serde_json::json!({"eventId":read.scope.event_id,"originHostId":owner,
                "scope":read.scope,"result":result,"observedAt":db::now_ms()})).map_err(|e|e.to_string())?;
            if observed.len()>32768{return Err("Event health observation exceeds bounds".into());}
            let existing:Option<(String,String)>=tx.query_row("SELECT binding_hash,payload_json FROM automation_health_event_snapshots WHERE rule_id=?1 AND event_id=?2",
                params![read.scope.rule_id,read.scope.event_id],|row|Ok((row.get(0)?,row.get(1)?))).optional().map_err(|e|e.to_string())?;
            if let Some((binding,_))=existing {if binding==read.scope.binding_hash {continue;}}
            tx.execute("DELETE FROM automation_health_event_snapshots WHERE observed_at<?1 OR NOT EXISTS(SELECT 1 FROM automation_health_events h WHERE h.event_id=automation_health_event_snapshots.event_id)",params![db::now_ms()-14*24*60*60*1000_i64]).map_err(|e|e.to_string())?;
            let (count,bytes):(i64,i64)=tx.query_row("SELECT COUNT(*),COALESCE(SUM(LENGTH(CAST(payload_json AS BLOB))),0) FROM automation_health_event_snapshots",[],|row|Ok((row.get(0)?,row.get(1)?))).map_err(|e|e.to_string())?;
            if count>=4096 || bytes+observed.len() as i64>32*1024*1024 {return Err("Original health observation ledger is full; no sample data sent".into());}
            tx.execute("INSERT INTO automation_health_event_snapshots(rule_id,event_id,binding_hash,payload_json,observed_at) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(rule_id,event_id) DO UPDATE SET binding_hash=excluded.binding_hash,payload_json=excluded.payload_json,observed_at=excluded.observed_at WHERE automation_health_event_snapshots.binding_hash<>excluded.binding_hash",
                params![read.scope.rule_id,read.scope.event_id,read.scope.binding_hash,observed,db::now_ms()]).map_err(|e|e.to_string())?;
        }
        tx.commit().map_err(|e|e.to_string())
    }
}
