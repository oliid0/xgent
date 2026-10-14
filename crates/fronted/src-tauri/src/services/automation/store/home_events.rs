use super::*;
use super::proactive::{ProactiveApplyInput,ProactiveOperation};
use tauri_plugin_mobile_assistant::HomeChangeEvent;

impl AutomationStore {
    pub fn home_event_sources_allowed(&self)->Result<bool,String>{
        let conn=self.lock_conn()?;
        Ok(crate::commands::settings::mobile_task_read_requires_approval(&conn,"home").is_ok())
    }

    pub fn home_for_proactive_apply(&self,input:&ProactiveApplyInput)->Result<Option<String>,String>{
        let conn=self.lock_conn()?;
        if db::read_revision(&conn,"proactive_revision")?!=input.revision {return Err("Rules changed on another client. Refresh before changing them.".into());}
        let config=match &input.operation {
            ProactiveOperation::Create{config}=>{
                let count:i64=conn.query_row("SELECT COUNT(*) FROM automation_proactive_rules",[],|row|row.get(0)).map_err(|e|e.to_string())?;
                if count>=20{return Err("At most 20 proactive rules are supported on this host".into());}
                Some(config.clone())
            },
            ProactiveOperation::SetEnabled{id,enabled:true}=>{
                let (raw,frozen):(String,String)=conn.query_row("SELECT config_json,binding_json FROM automation_proactive_rules WHERE rule_id=?1",params![id],|row|Ok((row.get(0)?,row.get(1)?))).map_err(|e|e.to_string())?;
                let config=serde_json::from_str(&raw).map_err(|e|e.to_string())?;
                if super::proactive::validate_config(&conn,&config)?!=frozen{return Err("Original rule configuration changed".into());}
                Some(config)
            },
            _=>None,
        };
        let Some(config)=config else{return Ok(None);};
        super::proactive::validate_config(&conn,&config)?;
        Ok(config.home_id)
    }

    pub fn active_home_event_homes(&self)->Result<Vec<String>,String>{
        let conn=self.lock_conn()?;
        let mut stmt=conn.prepare("SELECT config_json,binding_json FROM automation_proactive_rules WHERE enabled=1 AND json_extract(config_json,'$.eventKind')='home_power_changed'").map_err(|e|e.to_string())?;
        let rows=stmt.query_map([],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?))).map_err(|e|e.to_string())?;
        let mut homes=std::collections::BTreeSet::new();
        for row in rows {
            let (raw,frozen)=row.map_err(|e|e.to_string())?;
            let config:super::proactive::ProactiveRuleConfig=serde_json::from_str(&raw).map_err(|e|e.to_string())?;
            if super::proactive::validate_config(&conn,&config).ok().as_deref()==Some(frozen.as_str()) {
                if let Some(home)=config.home_id {homes.insert(home);}
            }
        }
        Ok(homes.into_iter().collect())
    }

    pub(crate) fn set_home_event_error(&self,error:Option<&str>)->Result<(),String>{
        let conn=self.lock_conn()?;
        if let Some(error)=error {
            conn.execute("INSERT INTO automation_meta (key,value) VALUES ('home_event_error.v1',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![error.chars().take(2048).collect::<String>()]).map_err(|e|e.to_string())?;
        }else{conn.execute("DELETE FROM automation_meta WHERE key='home_event_error.v1'",[]).map_err(|e|e.to_string())?;}
        Ok(())
    }

    /// Private SDK intake only; one committed immutable event UUID can be
    /// acknowledged repeatedly, never mutated into another power observation.
    pub(crate) fn ingest_home_events(&self,events:&[HomeChangeEvent])->Result<(),String>{
        if events.len()>16{return Err("Home event batch exceeds its characteristic bound".into());}
        let mut conn=self.lock_conn()?;
        let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        for event in events {
            if [&event.id,&event.home_id,&event.accessory_id,&event.service_id,&event.characteristic_id].iter().any(|id|!Uuid::parse_str(id).is_ok_and(|uuid|uuid.to_string()==id.as_str())) || event.occurred_at_ms<=0
                || [&event.home_name_preview,&event.accessory_name_preview,&event.service_name_preview].iter().any(|name|name.chars().count()>64) {
                return Err("Invalid native Home power observation".into());
            }
            let metric=format!("home:{}",event.home_id);
            let payload=serde_json::to_string(event).map_err(|e|e.to_string())?;
            let saved:Option<(String,i64,Option<String>)>=tx.query_row("SELECT h.metric,h.occurred_at,v.payload_json FROM automation_health_events h LEFT JOIN automation_home_event_values v ON v.event_id=h.event_id WHERE h.event_id=?1",params![event.id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).optional().map_err(|e|e.to_string())?;
            if let Some((saved_metric,occurred,observed))=saved {
                if saved_metric!=metric || occurred!=event.occurred_at_ms || observed.as_deref()!=Some(payload.as_str()) {return Err("Retained Home event changed its immutable observation".into());}
                continue;
            }
            tx.execute("DELETE FROM automation_health_events WHERE occurred_at<?1 AND NOT EXISTS (SELECT 1 FROM automation_proactive_deliveries d WHERE d.event_sequence=-automation_health_events.sequence)",params![db::now_ms()-14*24*60*60*1000_i64]).map_err(|e|e.to_string())?;
            tx.execute("DELETE FROM automation_home_event_values WHERE NOT EXISTS(SELECT 1 FROM automation_health_events h WHERE h.event_id=automation_home_event_values.event_id)",[]).map_err(|e|e.to_string())?;
            let count:i64=tx.query_row("SELECT COUNT(*) FROM automation_health_events",[],|row|row.get(0)).map_err(|e|e.to_string())?;
            if count>=16384{return Err("Device event ledger capacity reached; Home buffer was not acknowledged".into());}
            tx.execute("INSERT INTO automation_health_events (event_id,metric,occurred_at) VALUES (?1,?2,?3)",params![event.id,metric,event.occurred_at_ms]).map_err(|e|e.to_string())?;
            tx.execute("INSERT INTO automation_home_event_values (event_id,payload_json) VALUES (?1,?2)",params![event.id,payload]).map_err(|e|e.to_string())?;
        }
        tx.commit().map_err(|e|e.to_string())
    }
}

pub(super) fn observation(conn:&Connection,event:&str,home:&str)->Result<HomeChangeEvent,String>{
    let raw:String=conn.query_row("SELECT v.payload_json FROM automation_home_event_values v JOIN automation_health_events h ON h.event_id=v.event_id WHERE h.event_id=?1 AND h.metric=?2",params![event,format!("home:{home}")],|row|row.get(0)).map_err(|_|"Original Home notification evidence is missing".to_string())?;
    serde_json::from_str(&raw).map_err(|_|"Invalid retained Home notification evidence".to_string())
}
