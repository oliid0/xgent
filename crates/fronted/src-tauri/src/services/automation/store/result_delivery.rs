use super::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use background_hmac::{Hmac,KeyInit,Mac};

const READ_DOMAIN:&[u8]=b"xgent.result-read.request.v1\0";
const REPLY_DOMAIN:&[u8]=b"xgent.result-read.response.v1\0";
fn read_mac(key:&str,host:&str,receiver:&str,session:&str,request:&str,nonce:&str)->Result<Hmac<Sha256>,String>{
    if !token(key) || ![host,receiver,session,request,nonce].iter().all(|value|id(value)){return Err("Invalid result read proof scope".into());}
    let mut mac=Hmac::<Sha256>::new_from_slice(key.as_bytes()).map_err(|_|"Invalid result read proof key".to_string())?;
    mac.update(READ_DOMAIN);
    for value in [host,receiver,session,request,nonce]{mac.update(value.as_bytes());}
    Ok(mac)
}
fn reply_mac(key:&str,nonce:&str,body:&[u8])->Result<Hmac<Sha256>,String>{
    if !token(key) || !id(nonce){return Err("Invalid result reply proof scope".into());}
    let mut mac=Hmac::<Sha256>::new_from_slice(key.as_bytes()).map_err(|_|"Invalid result reply proof key".to_string())?;
    mac.update(REPLY_DOMAIN);mac.update(nonce.as_bytes());mac.update(body);Ok(mac)
}
fn signature_bytes(value:&str)->Result<Vec<u8>,String>{
    if !token(value){return Err("Invalid result proof signature".into());}
    (0..64).step_by(2).map(|i|u8::from_str_radix(&value[i..i+2],16).map_err(|_|"Invalid result proof signature".into())).collect()
}
fn signature(mac:Hmac<Sha256>)->String{mac.finalize().into_bytes().iter().map(|byte|format!("{byte:02x}")).collect()}
pub(crate) fn result_read_proof(key:&str,host:&str,receiver:&str,session:&str,request:&str,nonce:&str)->Result<String,String>{
    Ok(signature(read_mac(key,host,receiver,session,request,nonce)?))
}
pub(crate) fn result_reply_proof(key:&str,nonce:&str,body:&[u8])->Result<String,String>{Ok(signature(reply_mac(key,nonce,body)?))}
pub(crate) fn verify_result_reply_proof(key:&str,nonce:&str,body:&[u8],proof:&str)->Result<(),String>{
    reply_mac(key,nonce,body)?.verify_slice(&signature_bytes(proof)?).map_err(|_|"Original result reply proof failed".into())
}

fn id(value: &str) -> bool { Uuid::parse_str(value).is_ok_and(|id| id.to_string() == value) }
fn token(value: &str) -> bool { value.len() == 64 && value.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)) }

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub(crate) struct ResultDeliveryEndpoint {
    pub base_url: String,
    pub session_id: String,
    pub token: String,
    pub expires_at: i64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub(crate) struct ResultDeliveryTarget {
    pub request_id: String,
    pub source_host_id: String,
    pub endpoints: Vec<ResultDeliveryEndpoint>,
}

impl ResultDeliveryTarget {
    pub(crate) fn binding_hash(&self) -> Result<String,String> {
        if !id(&self.request_id) || !id(&self.source_host_id) || self.endpoints.is_empty() || self.endpoints.len() > 4 {
            return Err("Invalid original result delivery target".into());
        }
        let mut urls = std::collections::BTreeSet::new();
        let mut sessions = std::collections::BTreeSet::new();
        for endpoint in &self.endpoints {
            if !id(&endpoint.session_id) || !token(&endpoint.token) || endpoint.expires_at <= 0
                || endpoint.base_url.len() > 2048
                || crate::services::lan_pc_client::normalize_base_url(&endpoint.base_url)? != endpoint.base_url
                || !urls.insert(&endpoint.base_url) || !sessions.insert(&endpoint.session_id) {
                return Err("Invalid original result endpoint or scoped credential".into());
            }
        }
        Ok(hex::encode(Sha256::digest(serde_json::to_vec(self).map_err(|e|e.to_string())?)))
    }
}

impl AutomationStore {
    /// Called only by the authenticated paired route. No task creation, tool
    /// execution, file access or user response authority is granted.
    pub(crate) fn issue_result_read_grant(&self, device: &str, receiver: &str, host: &str, request: &str, capability: &str) -> Result<Value,String> {
        if ![device,receiver,host,request].iter().all(|value|id(value)) || !token(capability) {
            return Err("Invalid scoped result grant".into());
        }
        let mut conn=self.lock_conn()?;
        let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let actual: String=tx.query_row("SELECT value FROM automation_meta WHERE key='background_worker_id.v1'",[],|row|row.get(0)).map_err(|e|e.to_string())?;
        if actual!=host { return Err("Original execution host changed".into()); }
        let expires: i64=tx.query_row("SELECT expires_at FROM local_access_devices WHERE device_id=?1 AND revoked_at IS NULL AND expires_at>?2",params![device,db::now_ms()],|row|row.get(0)).map_err(|_|"Original paired session is no longer valid".to_string())?;
        let accepted: bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_background_tasks WHERE request_id=?1)",params![request],|row|row.get(0)).map_err(|e|e.to_string())?;
        if !accepted { return Err("Only an already accepted original task can be observed".into()); }
        tx.execute("DELETE FROM automation_result_read_grants WHERE expires_at<=?1 OR NOT EXISTS(SELECT 1 FROM local_access_devices d WHERE d.device_id=automation_result_read_grants.device_id AND d.revoked_at IS NULL AND d.expires_at>?1)",params![db::now_ms()]).map_err(|e|e.to_string())?;
        let existing: bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_result_read_grants WHERE device_id=?1 AND request_id=?2 AND receiver_host_id=?3)",params![device,request,receiver],|row|row.get(0)).map_err(|e|e.to_string())?;
        let count: u64=tx.query_row("SELECT COUNT(*) FROM automation_result_read_grants",[],|row|row.get(0)).map_err(|e|e.to_string())?;
        if !existing && count>=32768 { return Err("Scoped result grant capacity reached".into()); }
        let hash=hex::encode(Sha256::digest(capability.as_bytes()));
        tx.execute("INSERT INTO automation_result_read_grants (device_id,request_id,receiver_host_id,token_hash,expires_at) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(device_id,request_id,receiver_host_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at",params![device,request,receiver,hash,expires]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e|e.to_string())?;
        Ok(serde_json::json!({"version":1,"requestId":request,"sourceHostId":host,"receiverHostId":receiver,"sessionId":device,"expiresAt":expires}))
    }

    pub(crate) fn result_read_grant(&self, request: &str, receiver:&str,session:&str,nonce:&str,proof:&str) -> Result<String,String> {
        if ![request,receiver,session,nonce].iter().all(|value|id(value)) || !token(proof) { return Err("Invalid scoped result proof".into()); }
        let conn=self.lock_conn()?;
        let key:String=conn.query_row("SELECT g.token_hash FROM automation_result_read_grants g JOIN local_access_devices d ON d.device_id=g.device_id WHERE g.request_id=?1 AND g.receiver_host_id=?2 AND g.device_id=?3 AND g.expires_at>?4 AND d.expires_at>?4 AND d.revoked_at IS NULL",params![request,receiver,session,db::now_ms()],|row|row.get(0)).map_err(|_|"Scoped result credential is unavailable or revoked".to_string())?;
        let host:String=conn.query_row("SELECT value FROM automation_meta WHERE key='background_worker_id.v1'",[],|row|row.get(0)).map_err(|e|e.to_string())?;
        read_mac(&key,&host,receiver,session,request,nonce)?.verify_slice(&signature_bytes(proof)?).map_err(|_|"Original task result read proof failed".to_string())?;
        Ok(key)
    }

    pub(crate) fn claim_result_delivery_setup(&self) -> Result<Vec<BackgroundResultWatch>,String> {
        let mut conn=self.lock_conn()?;
        let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        tx.execute("DELETE FROM automation_result_delivery_targets WHERE NOT EXISTS(SELECT 1 FROM automation_result_watches w WHERE w.request_id=automation_result_delivery_targets.request_id AND w.source_host_id=automation_result_delivery_targets.source_host_id AND w.active=1)",[]).map_err(|e|e.to_string())?;
        // An existing-only OS worker may run after an app update, before the
        // foreground opener applies this additive schema. Its old reader setup
        // must remain usable; only the new foreground admission needs the table.
        let admission_schema:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='automation_result_delivery_admissions')",[],|row|row.get(0)).map_err(|e|e.to_string())?;
        if admission_schema {
            tx.execute("DELETE FROM automation_result_delivery_admissions WHERE NOT EXISTS(SELECT 1 FROM automation_result_watches w WHERE w.request_id=automation_result_delivery_admissions.request_id AND w.source_host_id=automation_result_delivery_admissions.source_host_id AND w.active=1)",[]).map_err(|e|e.to_string())?;
        }
        let host: String=tx.query_row("SELECT value FROM automation_meta WHERE key='background_worker_id.v1'",[],|row|row.get(0)).map_err(|e|e.to_string())?;
        let candidates={
            let mut stmt=tx.prepare("SELECT w.request_id,w.source_host_id,COALESCE(t.probes,0) FROM automation_result_watches w LEFT JOIN automation_result_delivery_targets t ON t.request_id=w.request_id WHERE w.active=1 AND w.source_host_id!=?1 AND COALESCE(t.retry_at,0)<=?2 ORDER BY COALESCE(t.retry_at,0),w.request_id LIMIT 2").map_err(|e|e.to_string())?;
            let rows=stmt.query_map(params![host,db::now_ms()],|row|Ok((BackgroundResultWatch{request_id:row.get(0)?,source_host_id:row.get(1)?},row.get::<_,u32>(2)?))).map_err(|e|e.to_string())?;
            rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?
        };
        let mut claimed=Vec::new();
        for (watch,probes) in candidates {
            let count:u64=tx.query_row("SELECT COUNT(*) FROM automation_result_delivery_targets",[],|row|row.get(0)).map_err(|e|e.to_string())?;
            let existing:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_result_delivery_targets WHERE request_id=?1)",params![watch.request_id],|row|row.get(0)).map_err(|e|e.to_string())?;
            if !existing && count>=128 { continue; }
            let probes=probes.saturating_add(1).min(32);
            let delay=(30_000i64*(1i64<<probes.min(5))).min(900_000);
            tx.execute("INSERT INTO automation_result_delivery_targets (request_id,source_host_id,retry_at,probes) VALUES (?1,?2,?3,?4) ON CONFLICT(request_id) DO UPDATE SET retry_at=excluded.retry_at,probes=excluded.probes",params![watch.request_id,watch.source_host_id,db::now_ms()+delay,probes]).map_err(|e|e.to_string())?;
            claimed.push(watch);
        }
        tx.commit().map_err(|e|e.to_string())?;
        Ok(claimed)
    }

    /// Before returning the first actual remote acceptance, prepare this exact
    /// owned task's OS reader. Never claim a queued packet/copied receipt or
    /// make another submission replay reset the existing setup backoff.
    pub(crate) fn claim_submission_result_delivery_setup(&self,request:&str) -> Result<Option<BackgroundResultWatch>,String> {
        let mut conn=self.lock_conn()?;
        let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let now=db::now_ms();
        let candidate:Option<(BackgroundResultWatch,u32,bool,i64)>=tx.query_row(
            "SELECT w.request_id,w.source_host_id,COALESCE(t.probes,0) AS probes,COALESCE(t.configured,0) AS configured,COALESCE(t.retry_at,0) AS retry_at
             FROM automation_result_watches w JOIN automation_submission_outbox s ON s.request_id=w.request_id AND s.source_host_id=w.source_host_id
             LEFT JOIN automation_result_delivery_targets t ON t.request_id=w.request_id AND t.source_host_id=w.source_host_id
             WHERE w.request_id=?1 AND w.active=1 AND s.cancel_requested=0 AND s.result_json IS NOT NULL
             AND s.initiating_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1') AND w.source_host_id!=s.initiating_host_id
             AND json_extract(s.result_json,'$.requestId')=w.request_id AND json_extract(s.result_json,'$.hostId')=w.source_host_id
             AND (t.request_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM automation_result_delivery_targets other WHERE other.request_id=w.request_id))
             AND NOT EXISTS(SELECT 1 FROM automation_proactive_remote_deliveries d WHERE d.request_id=s.request_id AND d.initiating_host_id=s.initiating_host_id AND d.locally_withdrawn=1)",
            params![request],|row|Ok((BackgroundResultWatch{request_id:row.get(0)?,source_host_id:row.get(1)?},row.get(2)?,row.get(3)?,row.get(4)?)),
        ).optional().map_err(|e|e.to_string())?;
        let Some((watch,probes,configured,retry))=candidate else {return Ok(None);};
        if configured && retry>now {return Ok(None);}
        let count:u64=tx.query_row("SELECT COUNT(*) FROM automation_result_delivery_targets",[],|row|row.get(0)).map_err(|e|e.to_string())?;
        let existing:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_result_delivery_targets WHERE request_id=?1 AND source_host_id=?2)",params![watch.request_id,watch.source_host_id],|row|row.get(0)).map_err(|e|e.to_string())?;
        if !existing && count>=128 {return Err("OS result delivery capacity reached; original task acceptance retained".into());}
        let first=tx.execute("INSERT OR IGNORE INTO automation_result_delivery_admissions (request_id,source_host_id,attempted_at) VALUES (?1,?2,?3)",params![watch.request_id,watch.source_host_id,now]).map_err(|e|e.to_string())?;
        if first==0 {return Ok(None);}
        let probes=probes.saturating_add(1).min(32);
        let delay=(30_000i64*(1i64<<probes.min(5))).min(900_000);
        tx.execute("INSERT INTO automation_result_delivery_targets (request_id,source_host_id,retry_at,probes) VALUES (?1,?2,?3,?4) ON CONFLICT(request_id) DO UPDATE SET retry_at=excluded.retry_at,probes=excluded.probes",params![watch.request_id,watch.source_host_id,now+delay,probes]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e|e.to_string())?;
        Ok(Some(watch))
    }

    pub(crate) fn note_submission_result_delivery_error(&self,request:&str) -> Result<(),String> {
        // Fixed diagnostic only: SDK/network/credential text never enters the
        // receipt. The task remains actually accepted by its original host.
        self.lock_conn()?.execute("UPDATE automation_submission_outbox SET last_error='OS result delivery setup pending'
            WHERE request_id=?1 AND initiating_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1') AND result_json IS NOT NULL AND cancel_requested=0
            AND NOT EXISTS(SELECT 1 FROM automation_result_delivery_targets t WHERE t.request_id=automation_submission_outbox.request_id AND t.source_host_id=automation_submission_outbox.source_host_id AND t.configured=1 AND t.retry_at>?2)",params![request,db::now_ms()]).map_err(|e|e.to_string())?;
        Ok(())
    }

    pub(crate) fn stage_result_delivery(&self, target: &ResultDeliveryTarget) -> Result<(),String> {
        let hash=target.binding_hash()?;
        let conn=self.lock_conn()?;
        let changed=conn.execute("UPDATE automation_result_delivery_targets SET binding_hash=?3,configured=0 WHERE request_id=?1 AND source_host_id=?2 AND EXISTS(SELECT 1 FROM automation_result_watches w WHERE w.request_id=?1 AND w.source_host_id=?2 AND w.active=1)",params![target.request_id,target.source_host_id,hash]).map_err(|e|e.to_string())?;
        if changed!=1 { return Err("Original result delivery setup is no longer active".into()); }
        Ok(())
    }

    pub(crate) fn acknowledge_result_delivery(&self,target:&ResultDeliveryTarget)->Result<(),String>{
        let mut conn=self.lock_conn()?;
        let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let changed=tx.execute("UPDATE automation_result_delivery_targets SET configured=1,probes=0,retry_at=?4 WHERE request_id=?1 AND source_host_id=?2 AND binding_hash=?3",params![target.request_id,target.source_host_id,target.binding_hash()?,db::now_ms()+300_000]).map_err(|e|e.to_string())?;
        if changed!=1 { return Err("Result delivery was revoked during OS configuration".into()); }
        tx.execute("UPDATE automation_submission_outbox SET last_error=NULL WHERE request_id=?1 AND source_host_id=?2 AND initiating_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1') AND last_error='OS result delivery setup pending'",params![target.request_id,target.source_host_id]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e|e.to_string())?;
        Ok(())
    }

    pub(crate) fn revoke_result_delivery_peer(&self,host:&str)->Result<(),String>{
        self.lock_conn()?.execute("DELETE FROM automation_result_delivery_targets WHERE source_host_id=?1",params![host]).map_err(|e|e.to_string())?;
        Ok(())
    }

    /// A real OS callback loaded these targets from platform-protected storage.
    /// Its running job proves the original configuration reached the SDK even
    /// if the foreground configuration ACK was lost. This confirms only an
    /// existing exact private binding, never grants authority or ACKs a result.
    #[cfg(any(target_os="android",target_os="ios"))]
    pub(crate) fn recover_os_result_configuration(&self,installation:&str,targets:&[ResultDeliveryTarget],stopped:&mut impl FnMut()->bool)->Result<(),String>{
        if targets.len()>128 || targets.iter().map(|t|&t.request_id).collect::<std::collections::BTreeSet<_>>().len()!=targets.len(){return Err("Invalid original OS configuration count".into());}
        let mut conn=self.lock_conn()?;
        let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let mut recovered=0;
        for target in targets {
            if stopped(){return Err("OS result configuration recovery stopped".into());}
            if !target.endpoints.iter().any(|endpoint|endpoint.expires_at>db::now_ms()){continue;}
            let changed=tx.execute("UPDATE automation_result_delivery_targets SET configured=1 WHERE request_id=?1 AND source_host_id=?2 AND binding_hash=?3 AND configured=0
                AND ?4=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1')
                AND EXISTS(SELECT 1 FROM automation_result_watches w WHERE w.request_id=?1 AND w.source_host_id=?2 AND w.active=1)",params![target.request_id,target.source_host_id,target.binding_hash()?,installation]).map_err(|e|e.to_string())?;
            if changed==0 {continue;}
            tx.execute("UPDATE automation_submission_outbox SET last_error=NULL WHERE request_id=?1 AND source_host_id=?2 AND initiating_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1') AND last_error='OS result delivery setup pending'",params![target.request_id,target.source_host_id]).map_err(|e|e.to_string())?;
            recovered+=1;
            if recovered==4 {break;}
        }
        if stopped(){return Err("OS result configuration recovery stopped before commit".into());}
        tx.commit().map_err(|e|e.to_string())?;
        Ok(())
    }

    pub(crate) fn claim_os_result_delivery(&self,installation:&str,targets:&[ResultDeliveryTarget])->Result<Vec<ResultDeliveryTarget>,String>{
        let bindings=targets.iter().map(|t|Ok((t.request_id.clone(),(t.clone(),t.binding_hash()?)))).collect::<Result<std::collections::BTreeMap<_,_>,String>>()?;
        let mut conn=self.lock_conn()?;
        let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let host:String=tx.query_row("SELECT value FROM automation_meta WHERE key='background_worker_id.v1'",[],|row|row.get(0)).map_err(|e|e.to_string())?;
        if host!=installation { return Err("Original receiving installation changed".into()); }
        let rows={
            let mut stmt=tx.prepare("SELECT w.request_id,t.binding_hash,w.probes FROM automation_result_watches w JOIN automation_result_delivery_targets t ON t.request_id=w.request_id AND t.source_host_id=w.source_host_id WHERE w.active=1 AND w.retry_at<=?1 AND t.configured=1 ORDER BY w.retry_at,w.request_id LIMIT 128").map_err(|e|e.to_string())?;
            let rows=stmt.query_map(params![db::now_ms()],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,u32>(2)?))).map_err(|e|e.to_string())?;
            rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?
        };
        let mut claimed=Vec::new();
        for (request,hash,probes) in rows {
            let Some((target,actual))=bindings.get(&request) else {continue;};
            if actual!=&hash {continue;}
            let probes=probes.saturating_add(1).min(32);
            let delay=(30_000i64*(1i64<<probes.min(5))).min(900_000);
            tx.execute("UPDATE automation_result_watches SET retry_at=?2,probes=?3 WHERE request_id=?1",params![request,db::now_ms()+delay,probes]).map_err(|e|e.to_string())?;
            claimed.push(target.clone());
            if claimed.len()==4 {break;}
        }
        tx.commit().map_err(|e|e.to_string())?;
        Ok(claimed)
    }

    /// Existing private DB only: no schema creation, worker startup, lost-write
    /// recovery, pairing adoption or Stronghold/session access from an OS job.
    #[cfg(any(target_os="android",target_os="ios"))]
    pub(crate) fn open_os_result_receiver(path:&str,root:&str,host:&str)->Result<Self,String>{
        let root=std::fs::canonicalize(root).map_err(|e|e.to_string())?;
        let path=std::fs::canonicalize(path).map_err(|e|e.to_string())?;
        if !id(host) || !path.starts_with(&root) || path.file_name().and_then(|name|name.to_str())!=Some("config.sqlite") || !path.is_file() {
            return Err("OS result receiver requires the original private database".into());
        }
        let conn=Connection::open_with_flags(path,rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX).map_err(|e|e.to_string())?;
        conn.busy_timeout(std::time::Duration::from_secs(5)).map_err(|e|e.to_string())?;
        conn.pragma_update(None,"synchronous","FULL").map_err(|e|e.to_string())?;
        let actual:String=conn.query_row("SELECT value FROM automation_meta WHERE key='background_worker_id.v1'",[],|row|row.get(0)).map_err(|e|e.to_string())?;
        if actual!=host {return Err("OS result receiving installation changed".into());}
        Ok(Self{conn:Mutex::new(conn),notifier:Mutex::new(None)})
    }

    /// Platform-encrypted snapshots can retain removed/finished scopes. Only
    /// the current original private binding can remain in an OS configuration.
    #[cfg(target_os="ios")]
    pub(crate) fn retain_os_result_targets(&self,targets:Vec<ResultDeliveryTarget>)->Result<Vec<ResultDeliveryTarget>,String>{
        if targets.len()>128 || targets.iter().map(|t|&t.request_id).collect::<std::collections::BTreeSet<_>>().len()!=targets.len(){return Err("Invalid OS result target count or duplicate".into());}
        let conn=self.lock_conn()?;
        let mut retained=Vec::new();
        for target in targets {
            let hash=target.binding_hash()?;
            let owned:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM automation_result_delivery_targets t JOIN automation_result_watches w ON w.request_id=t.request_id AND w.source_host_id=t.source_host_id WHERE t.request_id=?1 AND t.source_host_id=?2 AND t.binding_hash=?3 AND w.active=1)",params![target.request_id,target.source_host_id,hash],|row|row.get(0)).map_err(|e|e.to_string())?;
            if owned{retained.push(target);}
        }
        Ok(retained)
    }
}
