//! Import immutable bytes from an originally accepted child, never a model URL.
use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use sha2::{Digest, Sha256};

pub(crate) struct ChildArtifactImport {
    pub peer_id: String,
    pub request_id: String,
    pub child_execution_id: String,
    pub artifact: BackgroundArtifact,
    pub target_path: String,
    pub receipt: Option<Value>,
}

pub(super) fn portable_path(path: &str) -> bool {
    !path.is_empty() && path.len() <= 4096 && !path.contains('\\')
        && path.split('/').all(|part| !part.is_empty() && part != "." && part != ".."
            && !part.ends_with('.') && !part.ends_with(' ') && part.len() <= 180
            && !part.chars().any(|c| c.is_control() || ":*?\"<>|".contains(c))
            && !matches!(part.split('.').next().unwrap_or("").to_ascii_uppercase().as_str(),
                "CON"|"PRN"|"AUX"|"NUL"|"COM1"|"COM2"|"COM3"|"COM4"|"COM5"|"COM6"|"COM7"|"COM8"|"COM9"|
                "LPT1"|"LPT2"|"LPT3"|"LPT4"|"LPT5"|"LPT6"|"LPT7"|"LPT8"|"LPT9"))
}

pub(super) fn prepare(conn: &Connection, id: &str, call: &str, child_call: &str, artifact_id: &str,
    lease: &BackgroundExecutionLease) -> Result<ChildArtifactImport,String> {
    let (arguments, receipt): (String,Option<String>) = conn.query_row(
        "SELECT o.arguments_json,o.result_json FROM automation_background_operations o
         JOIN automation_background_operation_leases l ON l.execution_id=o.execution_id AND l.call_id=o.call_id
         WHERE o.execution_id=?1 AND o.call_id=?2 AND o.tool_name='ImportBackgroundChildArtifact'
           AND l.attempt=?3 AND l.generation=?4 AND l.token=?5",
        params![id,call,lease.attempt,lease.generation,lease.token],|r|Ok((r.get(0)?,r.get(1)?)),
    ).optional().map_err(|e|e.to_string())?.ok_or("Child artifact import requires its original journal intent/lease")?;
    let arguments: Value = serde_json::from_str(&arguments).map_err(|e|e.to_string())?;
    if arguments["child_call_id"]!=child_call || arguments["artifact_id"]!=artifact_id
        || arguments.as_object().is_none_or(|object|object.keys().any(|key|!["child_call_id","artifact_id","path"].contains(&key.as_str()))) {
        return Err("Child artifact import differs from its original intent".into());
    }
    let (peer,request,execution,snapshot): (String,String,String,String) = conn.query_row(
        "SELECT peer_id,child_request_id,observed_execution_id,observed_json
         FROM automation_background_children WHERE execution_id=?1 AND call_id=?2 AND receipt_json IS NOT NULL
           AND observed_execution_id IS NOT NULL AND observed_json IS NOT NULL
           AND issuer_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1')",
        params![id,child_call],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)),
    ).optional().map_err(|e|e.to_string())?.ok_or("No observed artifact on this parent's original accepted child")?;
    let snapshot: Value = serde_json::from_str(&snapshot).map_err(|e|e.to_string())?;
    if snapshot["hostId"] != peer || snapshot["requestId"] != request || snapshot["run"]["id"] != execution {
        return Err("Child artifact source identity changed".into());
    }
    let artifacts = snapshot["artifacts"].as_array().filter(|items|items.len()<=32).ok_or("Missing bounded child artifact manifest")?;
    let matching: Vec<_> = artifacts.iter().filter(|item|item["id"].as_str()==Some(artifact_id)).collect();
    if matching.len()!=1 { return Err("Artifact is absent or duplicated in the observed child manifest".into()); }
    let artifact: BackgroundArtifact = serde_json::from_value(matching[0].clone()).map_err(|e|e.to_string())?;
    if !Uuid::parse_str(&artifact.id).is_ok_and(|uuid|uuid.to_string()==artifact.id)
        || !Uuid::parse_str(&request).is_ok_and(|uuid|uuid.to_string()==request)
        || artifact.bytes>super::MAX_STREAM_ARTIFACT_BYTES || !portable_path(&artifact.relative_path)
        || artifact.content_hash.len()!=64 || !artifact.content_hash.bytes().all(|b|b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
        return Err("Child artifact metadata is invalid or cannot be saved portably".into());
    }
    let target_path=match arguments.get("path") {
        Some(value)=>value.as_str().filter(|path|portable_path(path)).ok_or("Imported artifact path is not a portable relative path")?.to_string(),
        None=>format!("child-results/{request}/{}",artifact.relative_path),
    };
    if !portable_path(&target_path) {return Err("Imported artifact destination exceeds portable path bounds".into());}
    Ok(ChildArtifactImport {peer_id:peer,request_id:request,child_execution_id:execution,artifact,target_path,
        receipt:receipt.map(|raw|serde_json::from_str(&raw)).transpose().map_err(|e|e.to_string())?})
}

impl AutomationStore {
    pub(crate) fn prepare_background_child_artifact(&self,id:&str,call:&str,child_call:&str,artifact:&str,
        lease:&BackgroundExecutionLease,
        load:impl FnOnce(&Connection,&SubmitBackgroundTaskInput)->Result<(String,Value),String>) -> Result<ChildArtifactImport,String> {
        let conn=self.lock_conn()?;
        Self::verify_background_configuration(&conn,id,Some(lease),load)?;
        prepare(&conn,id,call,child_call,artifact,lease)
    }

    pub(crate) fn import_background_child_artifact(&self,id:&str,call:&str,child_call:&str,
        source:&ChildArtifactImport,lease:&BackgroundExecutionLease,value:Value,
        load:impl FnOnce(&Connection,&SubmitBackgroundTaskInput)->Result<(String,Value),String>) -> Result<Value,String> {
        // A bounded, read-only response must agree with the previously observed
        // manifest. Base64 and metadata never enter the model context.
        let data: BackgroundArtifactContent=serde_json::from_value(value).map_err(|e|e.to_string())?;
        if data.content_base64.len()>11_184_812 || serde_json::to_value(&data.artifact).map_err(|e|e.to_string())?
            != serde_json::to_value(&source.artifact).map_err(|e|e.to_string())? {return Err("Child artifact response differs from observed metadata".into());}
        let content=STANDARD.decode(&data.content_base64).map_err(|_|"Invalid child artifact encoding")?;
        if content.len() as u64!=source.artifact.bytes || content.len()>8*1024*1024
            || hex::encode(Sha256::digest(&content))!=source.artifact.content_hash {
            return Err("Child artifact bytes failed length/SHA-256 verification".into());
        }
        let mut conn=self.lock_conn()?;
        let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        Self::verify_background_configuration(&tx,id,Some(lease),load)?;
        let current=prepare(&tx,id,call,child_call,&source.artifact.id,lease)?;
        if current.peer_id!=source.peer_id || current.request_id!=source.request_id || current.child_execution_id!=source.child_execution_id || current.target_path!=source.target_path
            || serde_json::to_value(&current.artifact).map_err(|e|e.to_string())?!=serde_json::to_value(&source.artifact).map_err(|e|e.to_string())? {
            return Err("Original child binding changed during artifact read".into());
        }
        if let Some(receipt)=current.receipt {return Ok(receipt);}
        let large:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_large_child_artifacts WHERE execution_id=?1 AND child_call_id=?2 AND child_artifact_id=?3)",
            params![id,child_call,source.artifact.id],|row|row.get(0)).map_err(|e|e.to_string())?;
        if large {return Err("Original large child provenance cannot be replaced by a small manifest".into());}
        let saved: Option<(String,String,String,String,String,u64,String)> = tx.query_row(
            "SELECT artifact_id,peer_id,child_request_id,child_execution_id,content_hash,bytes,source_path
             FROM automation_background_child_artifacts WHERE execution_id=?1 AND child_call_id=?2 AND child_artifact_id=?3",
            params![id,child_call,source.artifact.id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?)),
        ).optional().map_err(|e|e.to_string())?;
        let relative_path=source.target_path.clone();
        let artifact_id=if let Some((artifact,peer,request,execution,hash,bytes,path))=saved {
            if peer!=source.peer_id || request!=source.request_id || execution!=source.child_execution_id
                || hash!=source.artifact.content_hash || bytes!=source.artifact.bytes || path!=source.artifact.relative_path {return Err("Imported child provenance is immutable".into());}
            let (stored,path): (Vec<u8>,String)=tx.query_row("SELECT content,relative_path FROM automation_background_artifacts WHERE execution_id=?1 AND artifact_id=?2",
                params![id,artifact],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|e|e.to_string())?;
            if stored!=content || path!=relative_path {return Err("Previously imported child artifact failed integrity or destination verification".into());}
            artifact
        } else {
            let existing: Option<(String,Vec<u8>)>=tx.query_row("SELECT artifact_id,content FROM automation_background_artifacts WHERE execution_id=?1 AND relative_path=?2 AND content_hash=?3",
                params![id,relative_path,source.artifact.content_hash],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e|e.to_string())?;
            let artifact=if let Some((artifact,stored))=existing {
                if stored!=content {return Err("Parent artifact content failed integrity verification".into());}
                artifact
            } else {
            let (count,bytes):(i64,i64)=tx.query_row("SELECT COUNT(*),COALESCE(SUM(bytes),0) FROM automation_background_artifacts WHERE execution_id=?1",
                params![id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|e|e.to_string())?;
            if count>=32 || bytes+content.len() as i64>1024*1024*1024 {return Err("Parent artifact quota exceeded (32 files / 1 GiB)".into());}
            let artifact=Uuid::new_v4().to_string();
            tx.execute("INSERT INTO automation_background_artifacts (artifact_id,execution_id,relative_path,content_hash,bytes,content,created_at)
                VALUES (?1,?2,?3,?4,?5,?6,?7)",params![artifact,id,relative_path,source.artifact.content_hash,content.len() as i64,content,db::now_ms()]).map_err(|e|e.to_string())?;
            artifact
            };
            tx.execute("INSERT INTO automation_background_child_artifacts (execution_id,child_call_id,child_artifact_id,artifact_id,peer_id,child_request_id,child_execution_id,source_path,content_hash,bytes)
                VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",params![id,child_call,source.artifact.id,artifact,source.peer_id,source.request_id,source.child_execution_id,source.artifact.relative_path,source.artifact.content_hash,source.artifact.bytes]).map_err(|e|e.to_string())?;
            artifact
        };
        let artifact=BackgroundArtifact {id:artifact_id,relative_path,content_hash:source.artifact.content_hash.clone(),bytes:source.artifact.bytes};
        let result=serde_json::json!({"artifact":artifact,"source":{"childCallId":child_call,"artifactId":source.artifact.id,
            "peerId":source.peer_id,"requestId":source.request_id,"executionId":source.child_execution_id}});
        let receipt=serde_json::json!({"role":"toolResult","toolCallId":call,"toolName":"ImportBackgroundChildArtifact",
            "content":[{"type":"text","text":serde_json::to_string(&result).map_err(|e|e.to_string())?}],
            "details":{"kind":"background_artifact","result":result},"isError":false,"timestamp":db::now_ms()});
        Self::complete_background_operation_on_connection(&tx,CompleteBackgroundOperationInput {
            execution_id:id.into(),call_id:call.into(),lease:Some(lease.clone()),result:receipt.clone()})?;
        tx.commit().map_err(|e|e.to_string())?;
        Ok(receipt)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn load(_: &Connection,_: &SubmitBackgroundTaskInput) -> Result<(String,Value),String> {Ok(("accepted".into(),json!({})))}

    fn fixture() -> (AutomationStore,BackgroundTaskRecord,BackgroundExecutionLease,String,Value) {
        let store=AutomationStore::open_in_memory().unwrap();
        let parent=store.submit_background_task_with_binding(SubmitBackgroundTaskInput {
            request_id:Uuid::new_v4().to_string(),name:"Report".into(),prompt:"Produce actual report".into(),
            provider_id:"configured".into(),model:"configured".into(),workdir:std::env::temp_dir().to_string_lossy().into_owned(),
            timeout_seconds:300,reasoning:"medium".into(),files:vec![],delegation:None,requirements:None,
            source_context:None,goal_binding:None,intelligent_scheduling_enabled:false,
        },|_,_|Ok("accepted".into())).unwrap();
        let lease=store.claim_prompt_runs().unwrap().remove(0).lease.unwrap();
        store.save_background_plan(SaveBackgroundPlanInput {execution_id:parent.run.id.clone(),lease:Some(lease.clone()),
            plan:BackgroundTaskPlan {version:1,branches:vec![BackgroundBranch {id:"report".into(),title:"Report".into(),
                requirement:"Actual report".into(),depends_on:vec![],criteria:vec![BackgroundCriterion::Artifact {path:"report.txt".into()}]}]}},|_,_|Ok(())).unwrap();
        store.save_background_checkpoint(SaveBackgroundCheckpointInput {execution_id:parent.run.id.clone(),lease:Some(lease.clone()),revision:1,
            context:json!({"systemPrompt":"Original task","messages":[{"role":"user","content":"Produce report"}]})}).unwrap();
        let bytes=b"Actual retained report";
        let artifact=BackgroundArtifact {id:Uuid::new_v4().to_string(),relative_path:"report.txt".into(),
            content_hash:hex::encode(Sha256::digest(bytes)),bytes:bytes.len() as u64};
        let request=Uuid::new_v4().to_string();let execution=Uuid::new_v4().to_string();let peer=Uuid::new_v4().to_string();
        let snapshot=json!({"hostId":peer,"requestId":request,"run":{"id":execution},"artifacts":[artifact]});
        store.lock_conn().unwrap().execute("INSERT INTO automation_background_children (execution_id,call_id,child_request_id,peer_id,issuer_host_id,input_json,issued_at,retry_at,receipt_json,observed_json,observed_execution_id)
            VALUES (?1,'child',?2,?3,?4,'{}',1,1,?5,?5,?6)",params![parent.run.id,request,peer,parent.host_id,snapshot.to_string(),execution]).unwrap();
        store.begin_background_operation(BeginBackgroundOperationInput {execution_id:parent.run.id.clone(),call_id:"import".into(),lease:Some(lease.clone()),
            tool_name:"ImportBackgroundChildArtifact".into(),arguments:json!({"child_call_id":"child","artifact_id":artifact.id,"path":"report.txt"})}).unwrap();
        let response=json!({"artifact":artifact,"contentBase64":STANDARD.encode(bytes)});
        (store,parent,lease,artifact.id,response)
    }

    #[test]
    fn verified_bytes_receipt_and_parent_criterion_commit_together() {
        let (store,parent,lease,artifact,response)=fixture();
        let source=store.prepare_background_child_artifact(&parent.run.id,"import","child",&artifact,&lease,load).unwrap();
        let receipt=store.import_background_child_artifact(&parent.run.id,"import","child",&source,&lease,response,load).unwrap();
        let id=receipt["details"]["result"]["artifact"]["id"].as_str().unwrap().to_string();
        assert_eq!(store.read_background_artifact(&parent.request_id,&id).unwrap().content_base64,STANDARD.encode(b"Actual retained report"));
        store.complete_background_operation(CompleteBackgroundOperationInput {execution_id:parent.run.id.clone(),call_id:"import".into(),lease:Some(lease.clone()),result:receipt.clone()}).unwrap();
        assert_eq!(store.prepare_background_child_artifact(&parent.run.id,"import","child",&artifact,&lease,load).unwrap().receipt,Some(receipt));
        assert!(store.record_background_outcome(RecordBackgroundOutcomeInput {execution_id:parent.run.id,branch_id:"report".into(),lease:Some(lease),
            evidence:Some(BackgroundBranchEvidence {artifact_ids:vec![id],call_ids:vec![],answer:None}),waiting_reason:None,waiting_tool:None,waiting_inventory:None},|_,_|Ok(())).unwrap().verified);
    }

    #[test]
    fn corruption_revocation_and_receipt_storage_failure_publish_nothing() {
        let (store,parent,lease,artifact,mut response)=fixture();
        let source=store.prepare_background_child_artifact(&parent.run.id,"import","child",&artifact,&lease,load).unwrap();
        response["contentBase64"]=json!(STANDARD.encode(b"Wrong bytes"));
        assert!(store.import_background_child_artifact(&parent.run.id,"import","child",&source,&lease,response.clone(),load).is_err());
        response["contentBase64"]=json!(STANDARD.encode(b"Actual retained report"));
        assert!(store.import_background_child_artifact(&parent.run.id,"import","child",&source,&lease,response.clone(),|_,_|Err("Revoked configuration".into())).is_err());
        store.lock_conn().unwrap().execute_batch("CREATE TEMP TRIGGER fail_import_receipt BEFORE UPDATE OF result_json ON automation_background_operations BEGIN SELECT RAISE(ABORT,'storage failure'); END;").unwrap();
        assert!(store.import_background_child_artifact(&parent.run.id,"import","child",&source,&lease,response,load).is_err());
        let conn=store.lock_conn().unwrap();
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM automation_background_artifacts",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM automation_background_child_artifacts",[],|r|r.get::<_,i64>(0)).unwrap(),0);
    }

    #[test]
    fn original_intent_and_portable_destination_are_required() {
        let (store,parent,lease,artifact,_)=fixture();
        assert!(store.prepare_background_child_artifact(&parent.run.id,"import","foreign-child",&artifact,&lease,load).is_err());
        assert!(store.prepare_background_child_artifact(&parent.run.id,"invented","child",&artifact,&lease,load).is_err());
        for path in ["../report","/absolute","dir\\report","CON.txt","dir/file.","c:/file"] {
            store.lock_conn().unwrap().execute("UPDATE automation_background_operations SET arguments_json=?1 WHERE call_id='import'",
                params![json!({"child_call_id":"child","artifact_id":artifact,"path":path}).to_string()]).unwrap();
            assert!(store.prepare_background_child_artifact(&parent.run.id,"import","child",&artifact,&lease,load).is_err());
        }
    }

    #[test]
    fn parent_quota_and_second_operation_deduplication_are_enforced() {
        let (store,parent,lease,artifact,response)=fixture();
        let source=store.prepare_background_child_artifact(&parent.run.id,"import","child",&artifact,&lease,load).unwrap();
        {
            let conn=store.lock_conn().unwrap();
            for index in 0..32 {
                conn.execute("INSERT INTO automation_background_artifacts VALUES (?1,?2,?3,?4,0,?5,1)",
                    params![Uuid::new_v4().to_string(),parent.run.id,format!("existing-{index}.txt"),hex::encode(Sha256::digest(b"")),b"".as_slice()]).unwrap();
            }
        }
        assert!(store.import_background_child_artifact(&parent.run.id,"import","child",&source,&lease,response.clone(),load).unwrap_err().contains("quota"));
        store.lock_conn().unwrap().execute("DELETE FROM automation_background_artifacts WHERE execution_id=?1",params![parent.run.id]).unwrap();
        let first=store.import_background_child_artifact(&parent.run.id,"import","child",&source,&lease,response.clone(),load).unwrap();
        store.begin_background_operation(BeginBackgroundOperationInput {execution_id:parent.run.id.clone(),call_id:"second-import".into(),lease:Some(lease.clone()),
            tool_name:"ImportBackgroundChildArtifact".into(),arguments:json!({"child_call_id":"child","artifact_id":artifact,"path":"report.txt"})}).unwrap();
        let source=store.prepare_background_child_artifact(&parent.run.id,"second-import","child",&artifact,&lease,load).unwrap();
        let second=store.import_background_child_artifact(&parent.run.id,"second-import","child",&source,&lease,response,load).unwrap();
        assert_eq!(first["details"]["result"]["artifact"],second["details"]["result"]["artifact"]);
        let conn=store.lock_conn().unwrap();
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM automation_background_artifacts",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM automation_background_child_artifacts",[],|r|r.get::<_,i64>(0)).unwrap(),1);
    }
}
