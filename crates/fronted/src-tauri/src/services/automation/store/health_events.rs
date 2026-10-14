use super::*;
use super::proactive::{ProactiveApplyInput, ProactiveOperation};
use tauri_plugin_mobile_assistant::HealthChangeEvent;

pub(super) const HEALTH_EVENT_METRICS: &[&str] = &[
    "heart_rate", "blood_glucose", "oxygen_saturation", "weight", "body_temperature",
];

impl AutomationStore {
    /// Preflight before the explicit create/enable action can open an OS
    /// authorization sheet. proactive_apply repeats the CAS after that sheet.
    pub fn health_metric_for_proactive_apply(&self, input: &ProactiveApplyInput) -> Result<Option<String>, String> {
        let conn = self.lock_conn()?;
        if db::read_revision(&conn, "proactive_revision")? != input.revision {
            return Err("Rules changed on another client. Refresh before changing them.".into());
        }
        let config = match &input.operation {
            ProactiveOperation::Create { config } => {
                let count:i64=conn.query_row("SELECT COUNT(*) FROM automation_proactive_rules",[],|r|r.get(0)).map_err(|e|e.to_string())?;
                if count>=20 {return Err("At most 20 proactive rules are supported on this host".into());}
                Some(config.clone())
            },
            ProactiveOperation::SetEnabled { id, enabled: true } => {
                let (raw,frozen):(String,String) = conn.query_row("SELECT config_json,binding_json FROM automation_proactive_rules WHERE rule_id=?1",params![id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|e|e.to_string())?;
                let config=serde_json::from_str(&raw).map_err(|e|e.to_string())?;
                if super::proactive::validate_config(&conn,&config)? != frozen {return Err("Target configuration changed. Delete and explicitly recreate the rule.".into());}
                Some(config)
            },
            _ => None,
        };
        let Some(config) = config else { return Ok(None); };
        super::proactive::validate_config(&conn, &config)?;
        Ok(config.health_metric)
    }

    pub fn active_health_event_metrics(&self) -> Result<Vec<String>, String> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare("SELECT config_json FROM automation_proactive_rules WHERE enabled=1").map_err(|e|e.to_string())?;
        let rows = stmt.query_map([],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())?;
        let mut metrics = std::collections::BTreeSet::new();
        for raw in rows {
            let config: super::proactive::ProactiveRuleConfig = serde_json::from_str(&raw.map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
            if config.event_kind == "health_updated" {
                if super::proactive::validate_config(&conn,&config).is_err() { continue; }
                if let Some(metric) = config.health_metric { metrics.insert(metric); }
            }
        }
        Ok(metrics.into_iter().collect())
    }

    pub(crate) fn set_health_event_error(&self, error: Option<&str>) -> Result<(),String> {
        let conn=self.lock_conn()?;
        if let Some(error)=error {
            conn.execute("INSERT INTO automation_meta (key,value) VALUES ('health_event_error.v1',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![error.chars().take(2048).collect::<String>()]).map_err(|e|e.to_string())?;
        } else { conn.execute("DELETE FROM automation_meta WHERE key='health_event_error.v1'",[]).map_err(|e|e.to_string())?; }
        Ok(())
    }

    /// Internal native intake only. No public IPC accepts fabricated health
    /// events or measurements. SDK metadata commits before its buffer ACK.
    pub(crate) fn ingest_health_events(&self, events: &[HealthChangeEvent]) -> Result<(), String> {
        if events.len()>5 { return Err("Health event batch exceeds the metric bound".into()); }
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        for event in events {
            if !Uuid::parse_str(&event.id).is_ok_and(|id|id.to_string()==event.id)
                || !HEALTH_EVENT_METRICS.contains(&event.metric.as_str()) || event.occurred_at_ms<=0 {
                return Err("Invalid native health change metadata".into());
            }
            let saved: Option<(String,i64)> = tx.query_row("SELECT metric,occurred_at FROM automation_health_events WHERE event_id=?1",params![event.id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e|e.to_string())?;
            if let Some((metric, occurred)) = saved {
                if metric!=event.metric || occurred!=event.occurred_at_ms { return Err("Retained health event changed its immutable identity".into()); }
                continue;
            }
            // Events with no retained delivery become irrelevant after the
            // maximum rule age. AUTOINCREMENT prevents cursor identity reuse.
            tx.execute("DELETE FROM automation_health_events WHERE occurred_at<?1 AND NOT EXISTS (SELECT 1 FROM automation_proactive_deliveries d WHERE d.event_sequence=-automation_health_events.sequence)",params![db::now_ms()-14*24*60*60*1000_i64]).map_err(|e|e.to_string())?;
            let count: i64 = tx.query_row("SELECT COUNT(*) FROM automation_health_events",[],|r|r.get(0)).map_err(|e|e.to_string())?;
            if count>=16384 { return Err("Health event ledger capacity reached; native buffer was not acknowledged".into()); }
            tx.execute("INSERT INTO automation_health_events (event_id,metric,occurred_at) VALUES (?1,?2,?3)",params![event.id,event.metric,event.occurred_at_ms]).map_err(|e|e.to_string())?;
        }
        tx.commit().map_err(|e|e.to_string())
    }
}
