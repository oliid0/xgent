use std::fs::File;
use super::*;

impl AutomationStore {
    pub(crate) fn import_background_child_artifact_file(&self,id:&str,call:&str,child_call:&str,
        source:&ChildArtifactImport,lease:&BackgroundExecutionLease,file:&mut File,
        load:impl FnOnce(&Connection,&SubmitBackgroundTaskInput)->Result<(String,Value),String>) -> Result<Value,String> {
        if source.artifact.bytes<=8*1024*1024 || source.artifact.bytes>MAX_STREAM_ARTIFACT_BYTES {return Err("Large child import is outside its stream bound".into());}
        let mut conn=self.lock_conn()?;
        let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        Self::verify_background_configuration(&tx,id,Some(lease),load)?;
        let current=super::child_artifacts::prepare(&tx,id,call,child_call,&source.artifact.id,lease)?;
        if current.peer_id!=source.peer_id || current.request_id!=source.request_id || current.child_execution_id!=source.child_execution_id
            || current.target_path!=source.target_path || serde_json::to_value(&current.artifact).map_err(|e|e.to_string())?!=serde_json::to_value(&source.artifact).map_err(|e|e.to_string())? {
            return Err("Original large child binding changed during transfer".into());
        }
        if let Some(receipt)=current.receipt {return Ok(receipt);}
        let small:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_background_child_artifacts WHERE execution_id=?1 AND child_call_id=?2 AND child_artifact_id=?3)",
            params![id,child_call,source.artifact.id],|row|row.get(0)).map_err(|e|e.to_string())?;
        if small {return Err("Original small child provenance cannot be replaced by a large manifest".into());}
        let saved:Option<(String,String,String,String,String,u64,String)>=tx.query_row(
            "SELECT artifact_id,peer_id,child_request_id,child_execution_id,content_hash,bytes,source_path FROM automation_large_child_artifacts WHERE execution_id=?1 AND child_call_id=?2 AND child_artifact_id=?3",
            params![id,child_call,source.artifact.id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?))).optional().map_err(|e|e.to_string())?;
        let existing:Option<(String,String,u64)>=if let Some((artifact,peer,request,execution,hash,bytes,path))=saved {
            if peer!=source.peer_id || request!=source.request_id || execution!=source.child_execution_id || hash!=source.artifact.content_hash
                || bytes!=source.artifact.bytes || path!=source.artifact.relative_path {return Err("Large child provenance is immutable".into());}
            Some(tx.query_row("SELECT artifact_id,relative_path,bytes FROM automation_background_artifacts WHERE execution_id=?1 AND artifact_id=?2 AND content_hash=?3",
                params![id,artifact,source.artifact.content_hash],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).map_err(|e|e.to_string())?)
        } else {
            tx.query_row("SELECT artifact_id,relative_path,bytes FROM automation_background_artifacts WHERE execution_id=?1 AND relative_path=?2 AND content_hash=?3",
                params![id,source.target_path,source.artifact.content_hash],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).optional().map_err(|e|e.to_string())?
        };
        let artifact=if let Some((artifact,path,bytes))=existing {
            if path!=source.target_path || bytes!=source.artifact.bytes {return Err("Previously imported large child changed its destination/length".into());}
            let artifact=BackgroundArtifact {id:artifact,relative_path:path,bytes,content_hash:source.artifact.content_hash.clone()};
            ArtifactReader::new(&tx,artifact.clone())?.verify_hash()?;artifact
        } else {super::artifact_parts::write_snapshot(&tx,id,&source.target_path,source.artifact.bytes,Some(&source.artifact.content_hash),file)?};
        tx.execute("INSERT OR IGNORE INTO automation_large_child_artifacts (execution_id,child_call_id,child_artifact_id,artifact_id,peer_id,child_request_id,child_execution_id,source_path,content_hash,bytes) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![id,child_call,source.artifact.id,artifact.id,source.peer_id,source.request_id,source.child_execution_id,source.artifact.relative_path,source.artifact.content_hash,source.artifact.bytes]).map_err(|e|e.to_string())?;
        let result=serde_json::json!({"artifact":artifact,"source":{"childCallId":child_call,"artifactId":source.artifact.id,"peerId":source.peer_id,
            "requestId":source.request_id,"executionId":source.child_execution_id}});
        let receipt=serde_json::json!({"role":"toolResult","toolCallId":call,"toolName":"ImportBackgroundChildArtifact","isError":false,"timestamp":db::now_ms(),
            "content":[{"type":"text","text":serde_json::to_string(&result).map_err(|e|e.to_string())?}],"details":{"kind":"background_artifact","result":result}});
        Self::complete_background_operation_on_connection(&tx,CompleteBackgroundOperationInput {execution_id:id.into(),call_id:call.into(),lease:Some(lease.clone()),result:receipt.clone()})?;
        tx.commit().map_err(|e|e.to_string())?;Ok(receipt)
    }
}
