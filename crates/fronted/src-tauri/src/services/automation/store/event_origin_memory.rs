//! Optional recall precedes queue locks; exact rule/template signatures fence
//! staged evidence against concurrent retargeting or configuration changes.
use super::*;

pub(super) type EventOriginMemory=std::collections::BTreeMap<(String,String,String),String>;

impl AutomationStore {
    pub(super) fn prepare_event_origin_memory(&self,storage:Option<&std::path::Path>)->EventOriginMemory{
        let mut captured=EventOriginMemory::new();
        let Some(storage)=storage else{return captured;};
        let candidates=(||->Result<Vec<(String,String,String,String)>,String>{
            let conn=self.lock_conn()?;
            let now=db::now_ms();
            if super::foreground_attention::is_foreground_busy(&conn,now)? {return Ok(Vec::new());}
            let mut stmt=conn.prepare(
                "SELECT r.rule_id,r.binding_json,r.config_json,substr(t.name || char(10) || COALESCE(json_extract(t.config_json,'$.prompt'),''),1,512)
                 FROM automation_proactive_rules r JOIN automation_cron_tasks t ON t.task_id=json_extract(r.config_json,'$.targetTaskId')
                 WHERE r.enabled=1 AND t.enabled=1 AND t.kind='prompt' AND COALESCE(t.remaining_runs,1)>0 AND json_type(r.config_json,'$.remoteExecution')='object'
                 AND (r.last_queued_at IS NULL OR r.last_queued_at<=?1-json_extract(r.config_json,'$.cooldownMinutes')*60000)
                 AND (EXISTS(SELECT 1 FROM automation_proactive_events e WHERE e.sequence>r.cursor
                     AND e.kind=json_extract(r.config_json,'$.eventKind') AND e.task_id<>t.task_id
                     AND (json_extract(r.config_json,'$.sourceTaskId') IS NULL OR e.task_id=json_extract(r.config_json,'$.sourceTaskId'))
                     AND e.occurred_at BETWEEN ?1-json_extract(r.config_json,'$.maxAgeMinutes')*60000 AND ?1)
                   OR EXISTS(SELECT 1 FROM automation_health_events h JOIN automation_health_rule_activations a ON a.rule_id=r.rule_id
                     WHERE h.sequence>r.cursor AND h.occurred_at>=a.activated_at
                     AND h.occurred_at BETWEEN ?1-json_extract(r.config_json,'$.maxAgeMinutes')*60000 AND ?1
                     AND ((json_extract(r.config_json,'$.eventKind')='health_updated' AND h.metric=json_extract(r.config_json,'$.healthMetric'))
                       OR (json_extract(r.config_json,'$.eventKind')='home_power_changed' AND h.metric='home:'||json_extract(r.config_json,'$.homeId')))))
                 ORDER BY COALESCE(r.last_queued_at,0),r.created_at LIMIT 20"
            ).map_err(|e|e.to_string())?;
            let rows=stmt.query_map(params![now],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).map_err(|e|e.to_string())?;
            rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())
        })().unwrap_or_default();
        if candidates.is_empty(){return captured;}
        // The candidate read guard was dropped before any memory filesystem IO.
        let Ok(memory)=crate::services::memory::MemoryStore::open_existing_readonly_at(storage) else{return captured;};
        for (rule,binding,config,query) in candidates {
            if let Some(snapshot)=super::super::origin_memory::capture(&memory,&query){captured.insert((rule,binding,config),snapshot);}
        }
        captured
    }
}
