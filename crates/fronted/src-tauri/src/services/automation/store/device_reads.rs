//! Original-task read authority is separate from exact write-plan approval.
use super::*;
use sha2::{Digest, Sha256};
use serde_json::json;

fn owner(conn: &Connection, entry: &str, branch: &str) -> Result<(BackgroundResultWatch, BackgroundSubmission, String, String), String> {
    let (watch, submission, device) = AutomationStore::local_device_plan_owner(conn, entry)?;
    let source = submission.input.source_context.as_ref().and_then(|context|context.routing.as_ref())
        .and_then(|routing|routing.branches.iter().find(|source|source.id == branch && source.locality == "initiating-device"))
        .ok_or_else(||"Unknown original-device read branch".to_string())?;
    let binding = json!({"requestId":watch.request_id,"sourceHostId":watch.source_host_id,"deviceHostId":device,
        "source":source,"prompt":submission.input.prompt,"sourceContext":submission.input.source_context});
    let hash = hex::encode(Sha256::digest(serde_json::to_vec(&binding).map_err(|e|e.to_string())?));
    Ok((watch,submission,device,hash))
}

#[cfg(test)]
mod health_scope_tests {
    use super::*;
    fn scope() -> MobileReadDestination {
        MobileReadDestination {kind:"health".into(),id:"heart_rate".into(),source_id:"healthkit".into(),title:"heart_rate".into(),source:"HealthKit".into(),writable:false,start_ms:Some(1000),end_ms:Some(2000)}
    }
    #[test]
    fn exact_health_scope_is_bounded_and_never_writable() {
        validate_selections(&[scope()],true).unwrap();
        for change in ["metric","source","write","missing","interval","future-bound"] {
            let mut changed=scope();
            match change {"metric"=>changed.id="steps".into(),"source"=>changed.source_id="caller-account".into(),"write"=>changed.writable=true,"missing"=>changed.start_ms=None,"interval"=>changed.end_ms=Some(7*24*60*60*1000+1001),_=>changed.end_ms=Some(i64::MAX)}
            assert!(validate_selections(&[changed],true).is_err(),"{change}");
        }
        assert!(validate_selections(&[scope(),scope()],true).is_err());
    }
    #[test]
    fn legacy_calendar_read_scopes_keep_their_original_wire_shape() {
        let value=json!({"kind":"event","id":"list","sourceId":"account","title":"Calendar","source":"OS account","writable":true});
        let decoded:MobileReadDestination=serde_json::from_value(value.clone()).unwrap();
        validate_selections(&[decoded.clone()],true).unwrap();
        assert_eq!(serde_json::to_value(decoded.clone()).unwrap(),value);
        let mut invalid=decoded;invalid.start_ms=Some(1000);
        assert!(validate_selections(&[invalid],true).is_err());
    }
}

fn validate_selections(selections: &[MobileReadDestination], approved: bool) -> Result<(),String> {
    if selections.len() > 16 || (approved && selections.is_empty()) || serde_json::to_vec(selections).map_err(|e|e.to_string())?.len() > 64 * 1024 {
        return Err("Select 1–16 bounded native read scopes".into());
    }
    let mut seen = std::collections::HashSet::new();
    for scope in selections {
        if !matches!(scope.kind.as_str(),"event"|"reminder"|"health") || scope.id.trim().is_empty() || scope.id.len() > 4096 || scope.source_id.trim().is_empty() || scope.source_id.len() > 4096
            || scope.title.len() > 2048 || scope.source.len() > 2048 || !seen.insert((&scope.kind,&scope.id)) {
            return Err("Invalid/duplicate native read account/list identity".into());
        }
        if scope.kind == "health" {
            if !matches!(scope.id.as_str(),"heart_rate"|"blood_glucose"|"oxygen_saturation"|"weight"|"body_temperature")
                || !matches!(scope.source_id.as_str(),"healthkit"|"health-connect") || scope.writable
                || !matches!((scope.start_ms,scope.end_ms), (Some(start),Some(end)) if start>0 && end>start && end-start<=7*24*60*60*1000 && end<=8_640_000_000_000_000) {
                return Err("Health reads require an exact metric/source and a fixed interval of at most seven days".into());
            }
        } else if scope.start_ms.is_some() || scope.end_ms.is_some() {
            return Err("Calendar/list scopes cannot carry health ranges".into());
        }
    }
    Ok(())
}

impl AutomationStore {
    pub(super) fn mobile_branch_read_authorization_on_connection(conn: &Connection, entry: &str, branch: &str) -> Result<Value,String> {
        let (watch,submission,_,context_hash) = owner(conn,entry,branch)?;
        let retained: Option<(String,u32,String,String)> = conn.query_row("SELECT context_hash,revision,decision,selections_json FROM automation_mobile_branch_reads WHERE request_id = ?1 AND branch_id = ?2",params![watch.request_id,branch],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).optional().map_err(|e|e.to_string())?;
        if retained.as_ref().is_some_and(|record|record.0 != context_hash) { return Err("Read grant changed its original task/context/device binding".into()); }
        let (revision,decision,selections) = if let Some(record) = retained {
            let selections: Vec<MobileReadDestination> = serde_json::from_str(&record.3).map_err(|e|e.to_string())?;
            validate_selections(&selections,record.2 == "approved")?;
            (record.1,record.2,selections)
        } else { (0,"pending".into(),vec![]) };
        let mut allowed = Vec::new(); let mut discover = Vec::new(); let mut blocked = serde_json::Map::new();
        for kind in ["event","reminder","health"] {
            match crate::commands::settings::mobile_task_read_requires_approval(conn,kind) {
                Ok(ask) if !submission.cancel_requested => {
                    discover.push(kind);
                    // Even an ALLOW policy cannot invent a metric OS grant or
                    // an unbounded health range for a detached task.
                    if decision != "revoked" && ((decision == "approved" && selections.iter().any(|scope|scope.kind == kind)) || (kind != "health" && decision == "pending" && !ask)) { allowed.push(kind); }
                },
                Ok(_) => { blocked.insert(kind.into(),json!("Task cancellation requested")); },
                Err(error) => { blocked.insert(kind.into(),json!(error)); },
            }
        }
        Ok(json!({"contextHash":context_hash,"revision":revision,"decision":decision,"selections":selections,"allowedKinds":allowed,"canDiscoverKinds":discover,"blockedReasons":blocked,
            "canApprove":!discover.is_empty(),"canRevoke":decision != "revoked"}))
    }

    pub(crate) fn mobile_branch_read_authorization(&self, entry: &str, branch: &str) -> Result<Value,String> {
        let conn=self.lock_conn()?;
        Self::mobile_branch_read_authorization_on_connection(&conn,entry,branch)
    }

    pub(crate) fn check_mobile_branch_read_discovery(&self, entry: &str, branch: &str, kind: &str) -> Result<Value,String> {
        let status = self.mobile_branch_read_authorization(entry,branch)?;
        if !status["canDiscoverKinds"].as_array().is_some_and(|kinds|kinds.iter().any(|value|value == kind)) {
            return Err(status["blockedReasons"][kind].as_str().unwrap_or("Task read discovery is unavailable").to_string());
        }
        Ok(status)
    }

    /// Called ONLY with selections reconstructed from fresh SDK calendars by
    /// the local review command, not with caller/model supplied account labels.
    pub(crate) fn decide_mobile_branch_read_authorization(&self, entry: &str, branch: &str, expected_hash: &str, expected_revision: u32, selections: Vec<MobileReadDestination>, approve: bool) -> Result<(),String> {
        validate_selections(&selections,approve)?;
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let (watch,submission,_,_) = owner(&tx,entry,branch)?;
        let status = Self::mobile_branch_read_authorization_on_connection(&tx,entry,branch)?;
        if status["contextHash"] != expected_hash || status["revision"] != expected_revision || expected_revision == u32::MAX {
            return Err("Reviewed task read scope or authorization revision is stale".into());
        }
        if approve {
            if submission.cancel_requested { return Err("Task cancellation requested".into()); }
            for scope in &selections { crate::commands::settings::mobile_task_read_requires_approval(&tx,&scope.kind)?; }
        } else if status["canRevoke"] != true { return Err("Read authorization is already revoked".into()); }
        let count: u32 = tx.query_row("SELECT COUNT(*) FROM automation_mobile_branch_reads",[],|row|row.get(0)).map_err(|e|e.to_string())?;
        if expected_revision == 0 && count >= 4096 { return Err("Task read authorization capacity reached".into()); }
        let saved = if approve { serde_json::to_string(&selections).map_err(|e|e.to_string())? } else { serde_json::to_string(&status["selections"]).map_err(|e|e.to_string())? };
        tx.execute("INSERT INTO automation_mobile_branch_reads (request_id,branch_id,context_hash,revision,decision,selections_json,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(request_id,branch_id) DO UPDATE SET revision = excluded.revision, decision = excluded.decision, selections_json = excluded.selections_json, updated_at = excluded.updated_at",params![watch.request_id,branch,expected_hash,expected_revision+1,if approve {"approved"} else {"revoked"},saved,db::now_ms()]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e|e.to_string())
    }

    /// None means the user's current explicit ALLOW covers all readable lists.
    /// Some is always a nonempty exact list/account scope, never an all fallback.
    pub(crate) fn mobile_branch_read_scope(&self, entry: &str, branch: &str, kind: &str) -> Result<(Value,Option<Vec<MobileReadDestination>>),String> {
        let status = self.mobile_branch_read_authorization(entry,branch)?;
        if !status["allowedKinds"].as_array().is_some_and(|kinds|kinds.iter().any(|value|value == kind)) {
            return Err(status["blockedReasons"][kind].as_str().unwrap_or("Task/account read authorization is required or was revoked").to_string());
        }
        let selections = if status["decision"] == "approved" {
            let selected: Vec<MobileReadDestination> = serde_json::from_value(status["selections"].clone()).map_err(|e|e.to_string())?;
            Some(selected.into_iter().filter(|scope|scope.kind == kind).collect())
        } else { None };
        Ok((status,selections))
    }

    pub(super) fn validate_mobile_branch_read_destination(conn:&Connection,entry:&str,branch:&str,action:&DeviceBranchAction) -> Result<(),String> {
        let kind=if action.input.kind=="calendar_event" {"event"} else {"reminder"};
        let status=Self::mobile_branch_read_authorization_on_connection(conn,entry,branch)?;
        if !status["allowedKinds"].as_array().is_some_and(|kinds|kinds.iter().any(|value|value==kind)) {
            return Err("This action lost its original task's read authorization before plan acceptance".into());
        }
        if status["decision"]=="approved" && !status["selections"].as_array().is_some_and(|scopes|scopes.iter().any(|scope|scope["kind"]==kind && scope["id"]==action.input.request["calendarId"] && scope["sourceId"]==action.source_id)) {
            return Err("A proposed task action selected an account/list outside its authorized observations".into());
        }
        Ok(())
    }
}
