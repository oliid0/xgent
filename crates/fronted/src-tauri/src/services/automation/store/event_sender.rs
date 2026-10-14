//! Private opt-in OS event scope; no public event/data/credential injection API.
use super::*;
use serde::{Deserialize,Serialize};

#[derive(Clone,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct EventSenderScope {
    pub version:u32,
    pub database_path:String,
    pub host_id:String,
    pub enabled:bool,
}

impl AutomationStore {
    pub(crate) fn set_event_sender_error(&self,error:Option<&str>)->Result<(),String>{
        let conn=self.lock_conn()?;
        if let Some(error)=error {
            conn.execute("INSERT INTO automation_meta (key,value) VALUES ('event_sender_error.v1',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                params![error.chars().take(2048).collect::<String>()]).map_err(|e|e.to_string())?;
        }else{conn.execute("DELETE FROM automation_meta WHERE key='event_sender_error.v1'",[]).map_err(|e|e.to_string())?;}
        Ok(())
    }
    pub(crate) fn has_os_event_work(&self)->Result<bool,String>{
        let conn=self.lock_conn()?;
        let active:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM automation_proactive_rules WHERE enabled=1 AND json_type(config_json,'$.remoteExecution')='object')",[],|row|row.get(0)).map_err(|e|e.to_string())?;
        let pending:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM automation_proactive_remote_deliveries d JOIN automation_submission_outbox s ON s.request_id=d.request_id AND s.source_host_id=d.source_host_id
            WHERE d.locally_withdrawn=0 AND d.initiating_host_id=s.initiating_host_id AND s.initiating_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1')
            AND ((s.cancel_requested=0 AND s.result_json IS NULL) OR (s.cancel_requested=1 AND s.cancel_json IS NULL)))",[],|row|row.get(0)).map_err(|e|e.to_string())?;
        Ok(active || pending)
    }

    pub(crate) fn stage_event_sender_scope(&self,path:&str,enabled:bool)->Result<EventSenderScope,String>{
        let path=std::fs::canonicalize(path).map_err(|_|"Original event database unavailable".to_string())?;
        if path.file_name().and_then(|value|value.to_str())!=Some("config.sqlite") || !path.is_file(){return Err("Original event database changed".into());}
        let scope=EventSenderScope {version:1,database_path:path.to_str().ok_or("Invalid event database path")?.to_string(),host_id:self.background_worker_identity()?,enabled};
        let conn=self.lock_conn()?;
        let actual_file:String=conn.query_row("SELECT file FROM pragma_database_list WHERE name='main'",[],|row|row.get(0)).map_err(|e|e.to_string())?;
        if std::fs::canonicalize(actual_file).map_err(|_|"Original event store is not a file database".to_string())?!=path {
            return Err("OS event setup cannot bind a different store's database".into());
        }
        conn.execute("INSERT INTO automation_meta (key,value) VALUES ('event_sender_scope.v1',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![serde_json::to_string(&scope).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
        Ok(scope)
    }

    #[cfg(any(target_os="ios",target_os="android"))]
    pub(crate) fn open_os_event_sender(path:&str,root:&str,host:&str)->Result<Self,String>{
        // Reuse the existing private path/installation validator, not the
        // read-only receiver's capabilities, callback or operation whitelist.
        let store=Self::open_os_result_receiver(path,root,host)?;
        store.validate_event_sender_scope(path,host)?;
        Ok(store)
    }

    pub(crate) fn validate_event_sender_scope(&self,path:&str,host:&str)->Result<(),String>{
        self.validate_event_sender_configuration(path,host,true)
    }

    pub(crate) fn validate_event_sender_configuration(&self,path:&str,host:&str,enabled:bool)->Result<(),String>{
        let conn=self.lock_conn()?;
        let raw:String=conn.query_row("SELECT value FROM automation_meta WHERE key='event_sender_scope.v1'",[],|row|row.get(0)).map_err(|_|"OS event sending was not configured on this installation".to_string())?;
        let scope:EventSenderScope=serde_json::from_str(&raw).map_err(|_|"Invalid original OS event scope".to_string())?;
        let actual:String=conn.query_row("SELECT value FROM automation_meta WHERE key='background_worker_id.v1'",[],|row|row.get(0)).map_err(|e|e.to_string())?;
        if scope.version!=1 || scope.enabled!=enabled || scope.host_id!=host || actual!=host || scope.database_path!=path {
            return Err("Original OS event scope was disabled or changed".into());
        }
        Ok(())
    }
}
