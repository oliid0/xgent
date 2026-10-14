//! An owned Actions entry is snapshotted locally, never a model URL or status.
use std::io::Read;
use super::*;
use crate::services::cloud_execution::{CloudTaskArtifactResult,CloudTaskLocator};

pub(crate) struct CloudArtifactImport {
    pub locator:CloudTaskLocator,
    pub entry_path:String,
    pub target_path:String,
    pub receipt:Option<Value>,
}

fn prepare(conn:&Connection,id:&str,call:&str,cloud_call:&str,lease:&BackgroundExecutionLease)->Result<CloudArtifactImport,String>{
    let (raw,receipt):(String,Option<String>)=conn.query_row(
        "SELECT o.arguments_json,o.result_json FROM automation_background_operations o JOIN automation_background_operation_leases l ON l.execution_id=o.execution_id AND l.call_id=o.call_id WHERE o.execution_id=?1 AND o.call_id=?2 AND o.tool_name='ImportBackgroundCloudArtifact' AND l.attempt=?3 AND l.generation=?4 AND l.token=?5",
        params![id,call,lease.attempt,lease.generation,lease.token],|row|Ok((row.get(0)?,row.get(1)?))).map_err(|_|"Cloud import has no original fenced operation".to_string())?;
    let args:Value=serde_json::from_str(&raw).map_err(|error|error.to_string())?;
    let args=args.as_object().ok_or("Invalid original cloud import arguments")?;
    if args.keys().any(|key|!matches!(key.as_str(),"cloud_call_id"|"entry_path"|"path")) || args.get("cloud_call_id").and_then(Value::as_str)!=Some(cloud_call) {return Err("Cloud import changed its original start call".into());}
    let entry=args.get("entry_path").and_then(Value::as_str).ok_or("Cloud import needs its original archive entry")?;
    crate::services::cloud_artifacts::portable_name(entry,false)?;
    let locator=super::cloud_waiting::started_cloud_task(conn,id,cloud_call)?;
    let owned:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM automation_background_cloud_launches WHERE execution_id=?1 AND call_id=?2 AND task_id=?3 AND result_json IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM automation_background_cloud_cancellations WHERE execution_id=?1 AND call_id=?2 AND terminal_at IS NULL)",
        params![id,cloud_call,locator.task_id],|row|row.get(0)).map_err(|error|error.to_string())?;
    if !owned {return Err("Cloud import needs the original native launch without unresolved cancellation".into());}
    let target=match args.get("path") {
        None=>format!("cloud-results/{}/{entry}",locator.task_id),
        Some(value)=>value.as_str().ok_or("Invalid cloud result path")?.to_string(),
    };
    if !super::child_artifacts::portable_path(&target) {return Err("Cloud result needs a portable relative path".into());}
    Ok(CloudArtifactImport{locator,entry_path:entry.into(),target_path:target,receipt:receipt.map(|value|serde_json::from_str(&value)).transpose().map_err(|error|error.to_string())?})
}

fn saved_artifact(conn:&Connection,id:&str,cloud_call:&str,source:&CloudArtifactImport)->Result<Option<(BackgroundArtifact,Value)>,String>{
    let row:Option<(String,String,String,String,u64,u64,Option<String>,String,u64,String)>=conn.query_row(
        "SELECT p.artifact_id,p.owner,p.repository,p.task_id,p.run_id,p.cloud_artifact_id,p.archive_digest,p.content_hash,p.bytes,a.relative_path FROM automation_background_cloud_artifacts p JOIN automation_background_artifacts a ON a.artifact_id=p.artifact_id AND a.execution_id=p.execution_id AND a.content_hash=p.content_hash AND a.bytes=p.bytes WHERE p.execution_id=?1 AND p.cloud_call_id=?2 AND p.source_path=?3",
        params![id,cloud_call,source.entry_path],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?,row.get(7)?,row.get(8)?,row.get(9)?))).optional().map_err(|error|error.to_string())?;
    let Some((artifact,owner,repository,task,run,cloud_artifact,digest,hash,bytes,path))=row else {
        let orphan:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM automation_background_cloud_artifacts WHERE execution_id=?1 AND cloud_call_id=?2 AND source_path=?3)",params![id,cloud_call,source.entry_path],|row|row.get(0)).map_err(|error|error.to_string())?;
        if orphan {return Err("Retained cloud artifact snapshot is missing or changed".into());}
        return Ok(None);
    };
    if !owner.eq_ignore_ascii_case(&source.locator.owner) || !repository.eq_ignore_ascii_case(&source.locator.repository) || task!=source.locator.task_id || path!=source.target_path || super::cloud_waiting::cloud_operation_completed(conn,id,cloud_call)?!=Some(true) {return Err("Retained cloud artifact cannot change source/destination or completion proof".into());}
    let artifact=BackgroundArtifact{id:artifact,relative_path:path,content_hash:hash,bytes};
    ArtifactReader::new(conn,artifact.clone())?.verify_hash()?;
    Ok(Some((artifact,serde_json::json!({"cloudCallId":cloud_call,"owner":owner,"repository":repository,"taskId":task,"runId":run,"cloudArtifactId":cloud_artifact,"archiveDigest":digest,"entryPath":source.entry_path}))))
}

fn complete(conn:&Connection,id:&str,call:&str,lease:&BackgroundExecutionLease,artifact:BackgroundArtifact,source:Value)->Result<Value,String>{
    let result=serde_json::json!({"artifact":artifact,"source":source});
    let receipt=serde_json::json!({"role":"toolResult","toolCallId":call,"toolName":"ImportBackgroundCloudArtifact","isError":false,"timestamp":db::now_ms(),"content":[{"type":"text","text":serde_json::to_string(&result).map_err(|error|error.to_string())?}],"details":{"kind":"background_artifact","result":result}});
    AutomationStore::complete_background_operation_on_connection(conn,CompleteBackgroundOperationInput {execution_id:id.into(),call_id:call.into(),lease:Some(lease.clone()),result:receipt.clone()})?;
    Ok(receipt)
}

impl AutomationStore {
    pub(crate) fn prepare_background_cloud_artifact(&self,id:&str,call:&str,cloud_call:&str,lease:&BackgroundExecutionLease,
        load:impl FnOnce(&Connection,&SubmitBackgroundTaskInput)->Result<(String,Value),String>)->Result<CloudArtifactImport,String>{
        let mut conn=self.lock_conn()?;
        let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|error|error.to_string())?;
        let settings=Self::verify_background_configuration(&tx,id,Some(lease),load)?;
        if settings["access"]["cloudExecutionEnabled"]!=true {return Err("Cloud execution was disabled".into());}
        let mut source=prepare(&tx,id,call,cloud_call,lease)?;
        if source.receipt.is_none() {
            if let Some((artifact,provenance))=saved_artifact(&tx,id,cloud_call,&source)? {source.receipt=Some(complete(&tx,id,call,lease,artifact,provenance)?);}
        }
        tx.commit().map_err(|error|error.to_string())?;Ok(source)
    }

    pub(crate) fn import_background_cloud_artifact(&self,id:&str,call:&str,cloud_call:&str,source:&CloudArtifactImport,lease:&BackgroundExecutionLease,
        downloaded:&CloudTaskArtifactResult,bytes:u64,reader:&mut impl Read,
        load:impl FnOnce(&Connection,&SubmitBackgroundTaskInput)->Result<(String,Value),String>)->Result<Value,String>{
        let mut conn=self.lock_conn()?;
        let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|error|error.to_string())?;
        let settings=Self::verify_background_configuration(&tx,id,Some(lease),load)?;
        if settings["access"]["cloudExecutionEnabled"]!=true {return Err("Cloud execution was disabled during import".into());}
        let current=prepare(&tx,id,call,cloud_call,lease)?;
        if current.locator.owner!=source.locator.owner || current.locator.repository!=source.locator.repository || current.locator.task_id!=source.locator.task_id || current.entry_path!=source.entry_path || current.target_path!=source.target_path {return Err("Original cloud artifact binding changed during download".into());}
        if let Some(receipt)=current.receipt {return Ok(receipt);}
        if let Some((artifact,provenance))=saved_artifact(&tx,id,cloud_call,&current)? {let receipt=complete(&tx,id,call,lease,artifact,provenance)?;tx.commit().map_err(|error|error.to_string())?;return Ok(receipt);}
        let status=&downloaded.observed_status;
        if downloaded.task_id!=source.locator.task_id || downloaded.artifact_name!=format!("xgent-{}",source.locator.task_id)
            || downloaded.artifact_id==0 || downloaded.artifact_id>i64::MAX as u64 || downloaded.run_id==0 || downloaded.run_id>i64::MAX as u64
            || downloaded.run_conclusion!="success" || status.task_id!=source.locator.task_id || status.state!="completed" || status.conclusion.as_deref()!=Some("success") || status.run_id!=Some(downloaded.run_id) {
            return Err("Cloud import requires an actual successful original-run artifact observation".into());
        }
        let (task,owner,repository,known_run):(String,String,String,Option<u64>)=tx.query_row("SELECT task_id,owner,repository,json_extract(result_json,'$.details.observedRunId') FROM automation_background_cloud_launches WHERE execution_id=?1 AND call_id=?2 AND result_json IS NOT NULL",
            params![id,cloud_call],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).map_err(|_|"Original native cloud launch is missing".to_string())?;
        if task!=source.locator.task_id || (!owner.is_empty() && !owner.eq_ignore_ascii_case(&source.locator.owner)) || !repository.eq_ignore_ascii_case(&source.locator.repository) || known_run.is_some_and(|run|run!=downloaded.run_id) {return Err("Cloud artifact changed the original namespace/run".into());}
        let prior:Option<(String,String,String,u64,String)>=tx.query_row("SELECT owner,repository,task_id,run_id,conclusion FROM automation_background_cloud_completions WHERE execution_id=?1 AND call_id=?2",params![id,cloud_call],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?))).optional().map_err(|error|error.to_string())?;
        if let Some((owner,repository,task,run,conclusion))=prior {
            if !owner.eq_ignore_ascii_case(&source.locator.owner) || !repository.eq_ignore_ascii_case(&source.locator.repository) || task!=source.locator.task_id || run!=downloaded.run_id || conclusion!="success" {return Err("Original cloud completion observation is immutable".into());}
        }else {
            let observed=serde_json::to_string(status).map_err(|error|error.to_string())?;
            if observed.len()>8192 {return Err("Cloud terminal status exceeds its checkpoint bound".into());}
            tx.execute("INSERT INTO automation_background_cloud_completions (execution_id,call_id,owner,repository,task_id,run_id,conclusion,status_json,observed_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![id,cloud_call,source.locator.owner,source.locator.repository,source.locator.task_id,downloaded.run_id,"success",observed,db::now_ms()]).map_err(|error|error.to_string())?;
        }
        let artifact=super::artifact_parts::write_snapshot(&tx,id,&source.target_path,bytes,None,reader)?;
        tx.execute("INSERT INTO automation_background_cloud_artifacts (execution_id,cloud_call_id,source_path,artifact_id,owner,repository,task_id,run_id,cloud_artifact_id,archive_digest,content_hash,bytes) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",params![id,cloud_call,source.entry_path,artifact.id,source.locator.owner,source.locator.repository,source.locator.task_id,downloaded.run_id,downloaded.artifact_id,downloaded.archive_digest,artifact.content_hash,artifact.bytes]).map_err(|error|error.to_string())?;
        let provenance=serde_json::json!({"cloudCallId":cloud_call,"owner":source.locator.owner,"repository":source.locator.repository,"taskId":source.locator.task_id,"runId":downloaded.run_id,"cloudArtifactId":downloaded.artifact_id,"archiveDigest":downloaded.archive_digest,"entryPath":source.entry_path});
        let receipt=complete(&tx,id,call,lease,artifact,provenance)?;
        tx.commit().map_err(|error|error.to_string())?;Ok(receipt)
    }
}
