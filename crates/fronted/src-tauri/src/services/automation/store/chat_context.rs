//! Bounded originating chat task observations from this installation's durable
//! outbox/inbox. No network, task execution, history/profile writes or ACK.
use super::*;
use sha2::{Digest,Sha256};

fn chat_request_id(scope:&str)->Result<String,String>{
    let identity=serde_json::to_string(&(scope,"default-chat-intake")).map_err(|e|e.to_string())?;
    let hash=hex::encode(Sha256::digest(format!("xgent-background:{identity}").as_bytes()));
    Ok(format!("{}-{}-8{}-a{}-{}",&hash[..8],&hash[8..12],&hash[13..16],&hash[17..20],&hash[20..32]))
}

impl AutomationStore {
    /// Exact immutable received result, never the initial task acceptance.
    pub(crate) fn background_chat_result(&self, request: &str) -> Result<Option<Value>, String> {
        let conn = self.lock_conn()?;
        let row: Option<(String, String, String, String, String, u64, i64, String)> = conn.query_row(
            "SELECT s.origin_json,s.input_json,s.source_host_id,i.entry_id,i.content_hash,i.sequence,i.received_at,s.initiating_host_id
             FROM automation_submission_outbox s
             JOIN automation_result_watches w ON w.request_id=s.request_id AND w.source_host_id=s.source_host_id
             JOIN automation_result_inbox i ON i.sequence=(SELECT MAX(received.sequence) FROM automation_result_inbox received
               WHERE received.request_id=s.request_id AND received.source_host_id=s.source_host_id
                 AND json_extract(received.payload_json,'$.run.id')=COALESCE(json_extract(s.result_json,'$.run.id'),w.execution_id))
             WHERE s.request_id=?1 AND s.initiating_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1')",
            params![request], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?,row.get(7)?)),
        ).optional().map_err(|e| e.to_string())?;
        let Some((origin,input,host,entry,hash,sequence,received,receiver))=row else{return Ok(None)};
        let origin:Value=serde_json::from_str(&origin).map_err(|e|e.to_string())?;
        let Some(scope)=origin["requestScope"].as_str() else{return Ok(None)};
        if chat_request_id(scope)?!=request{return Ok(None)}
        let Ok(parts)=serde_json::from_str::<Vec<String>>(scope) else{return Ok(None)};
        if parts.len()!=2 || parts.iter().any(|part|part.trim().is_empty()){return Ok(None)}
        let input:Value=serde_json::from_str(&input).map_err(|e|e.to_string())?;
        let source_user=input["sourceContext"]["messages"].as_array().and_then(|messages|messages.iter().find(|message|
            message["role"]=="user" && message["id"].as_str()==Some(parts[1].as_str()))).cloned();
        let payload:String=conn.query_row("SELECT payload_json FROM automation_result_inbox WHERE entry_id=?1",params![entry],|row|row.get(0)).map_err(|e|e.to_string())?;
        let payload:Value=serde_json::from_str(&payload).map_err(|e|e.to_string())?;
        if payload["requestId"]!=request || payload["hostId"]!=host{return Ok(None)}
        Ok(Some(serde_json::json!({"conversationId":parts[0],"userMessageId":parts[1],"sourceMessageHash":origin["sourceMessageHash"],
            "sourceUser":source_user,"requestId":request,"sourceHostId":host,"receiverHostId":receiver,"entryId":entry,"snapshotHash":hash,"sequence":sequence,"receivedAt":received,"payload":payload})))
    }

    pub fn background_chat_context(&self,conversation:&str)->Result<Value,String>{
        if conversation.trim().is_empty() || conversation.len()>512{return Err("Invalid original chat identity".into());}
        let conn=self.lock_conn()?;
        let mut stmt=conn.prepare("WITH owned AS (
            SELECT s.*,CASE WHEN json_valid(json_extract(s.origin_json,'$.requestScope'))
              THEN json_extract(s.origin_json,'$.requestScope') ELSE '[]' END AS chat_scope
            FROM automation_submission_outbox s WHERE s.initiating_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1')
        ) SELECT s.request_id,s.source_host_id,s.input_json,s.chat_scope,s.created_at,s.cancel_requested,s.cancel_json IS NOT NULL,
            i.entry_id,COALESCE(i.payload_json,CASE WHEN s.cancel_requested=1 THEN s.cancel_json END,s.result_json),s.result_json IS NOT NULL
          FROM owned s LEFT JOIN automation_result_watches w ON w.request_id=s.request_id AND w.source_host_id=s.source_host_id
          LEFT JOIN automation_result_inbox i ON i.sequence=(SELECT MAX(received.sequence) FROM automation_result_inbox received
            WHERE received.request_id=s.request_id AND received.source_host_id=s.source_host_id
              AND json_extract(received.payload_json,'$.run.id')=COALESCE(json_extract(s.result_json,'$.run.id'),w.execution_id))
          WHERE json_extract(s.chat_scope,'$[0]')=?1 AND json_array_length(s.chat_scope)=2 AND json_type(s.chat_scope,'$[1]')='text'
          ORDER BY s.created_at DESC,s.sequence DESC LIMIT 5").map_err(|e|e.to_string())?;
        let rows=stmt.query_map(params![conversation],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?,row.get::<_,String>(3)?,row.get::<_,i64>(4)?,row.get::<_,bool>(5)?,row.get::<_,bool>(6)?,row.get::<_,Option<String>>(7)?,row.get::<_,Option<String>>(8)?,row.get::<_,bool>(9)?)))
            .map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
        let mut tasks=Vec::new();let mut omitted=rows.len()==5;
        for (request,host,input,scope,created,cancel,stopped,entry,payload,accepted) in rows {
            // Only the actual stable chat-intake request namespace contributes;
            // an arbitrary tool's caller-supplied origin is not a chat result.
            let expected=chat_request_id(&scope)?;
            if request!=expected{continue;}
            if tasks.len()==4{omitted=true;break;}
            let input:SubmitBackgroundTaskInput=serde_json::from_str(&input).map_err(|e|e.to_string())?;
            let payload:Option<Value>=payload.map(|value|serde_json::from_str(&value).map_err(|e|e.to_string())).transpose()?;
            let actual=payload.as_ref().filter(|value|value["requestId"]==request && value["hostId"]==host);
            let preview=actual.and_then(|value|value["run"]["output"].as_str()).unwrap_or_default();
            let artifacts=actual.and_then(|value|value["artifacts"].as_array()).cloned().unwrap_or_default();
            let files:Vec<_>=artifacts.iter().take(4).map(|file|serde_json::json!({"id":file["id"],"relativePath":file["relativePath"],"bytes":file["bytes"],"contentHash":file["contentHash"]})).collect();
            tasks.push(serde_json::json!({"requestId":request,"sourceHostId":host,"name":input.name,"createdAt":created,"submissionAcknowledged":accepted,
                "cancelRequested":cancel,"cancellationConfirmed":stopped,"entryId":entry,
                "executionId":actual.and_then(|value|value["run"]["id"].as_str()),"state":actual.and_then(|value|value["run"]["state"].as_str()),
                "success":actual.and_then(|value|value["run"]["success"].as_bool()),"preview":preview.chars().take(800).collect::<String>(),"previewTruncated":preview.chars().count()>800,
                "artifacts":files,"artifactCount":artifacts.len(),"artifactsTruncated":artifacts.len()>4}));
        }
        let observed=db::now_ms();
        let result=loop {
            let value=serde_json::json!({"version":1,"conversationId":conversation,"observedAt":observed,"tasks":tasks,"hasMore":omitted});
            if serde_json::to_vec(&value).map_err(|e|e.to_string())?.len()<=12*1024{break value;}
            tasks.pop();omitted=true;
        };
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn stage(store:&AutomationStore,conversation:&str,message:&str)->(BackgroundSubmission,BackgroundResultWatch){
        let scope=serde_json::to_string(&[conversation,message]).unwrap();let request=chat_request_id(&scope).unwrap();
        let host=Uuid::new_v4().to_string();
        let pending=store.stage_background_submission(&host,SubmitBackgroundTaskInput {request_id:request.clone(),name:"Actual saved report".into(),prompt:"Write the requested report".into(),
            provider_id:"fixture".into(),model:"fixture".into(),workdir:std::env::temp_dir().to_string_lossy().into_owned(),timeout_seconds:300,reasoning:"medium".into(),
            files:vec![],delegation:None,requirements:None,source_context:None,goal_binding:None,intelligent_scheduling_enabled:false},json!({"requestScope":scope})).unwrap();
        (pending,BackgroundResultWatch{source_host_id:host,request_id:request})
    }
    #[test]
    fn original_chat_observes_retained_native_result_before_ack_without_contacting_executor_or_another_conversation(){
        let store=AutomationStore::open_in_memory().unwrap();
        let (pending,watch)=stage(&store,"original","message");stage(&store,"other","message");
        let execution=Uuid::new_v4().to_string();
        let packet=json!({"hostId":watch.source_host_id,"requestId":watch.request_id,"name":"Actual saved report","workdir":"/fixture",
            "run":{"id":execution,"taskId":execution,"state":"done","success":false,"output":"Actual retained partial result"},"checkpointRevision":1,
            "artifacts":[],"outcomes":{"verified":false,"branches":[]},"operations":{"inFlight":0,"returned":0}});
        store.receive_background_result(&watch,packet.clone()).unwrap();
        let before=store.background_chat_context("original").unwrap();
        assert_eq!(before["tasks"].as_array().unwrap().len(),1);assert_eq!(before["tasks"][0]["requestId"],watch.request_id);
        assert_eq!(before["tasks"][0]["submissionAcknowledged"],false);assert_eq!(before["tasks"][0]["state"],"done");
        assert_eq!(before["tasks"][0]["preview"],"Actual retained partial result");assert!(before["tasks"][0]["entryId"].is_string());
        store.complete_background_submission(&pending,&packet).unwrap();
        assert_eq!(store.background_chat_context("original").unwrap()["tasks"][0]["submissionAcknowledged"],true);
        assert_eq!(store.list_background_inbox(0,20,true).unwrap().items.len(),1,"index read is not a result ACK");
    }
    #[test]
    fn arbitrary_origin_claims_do_not_replace_the_original_scoped_bounded_index(){
        let store=AutomationStore::open_in_memory().unwrap();
        for index in 0..8{stage(&store,"original",&format!("message-{index}"));}
        let context=store.background_chat_context("original").unwrap();
        assert_eq!(context["tasks"].as_array().unwrap().len(),4);assert_eq!(context["hasMore"],true);
        assert!(serde_json::to_vec(&context).unwrap().len()<=12*1024);
        let mut unknown=store.background_submission(context["tasks"][0]["requestId"].as_str().unwrap()).unwrap().unwrap().input;
        unknown.request_id=Uuid::new_v4().to_string();
        let unrelated=unknown.request_id.clone();
        store.stage_background_submission(&Uuid::new_v4().to_string(),unknown,json!({"requestScope":"[\"original\",\"fake\"]"})).unwrap();
        let index=store.background_chat_context("original").unwrap();
        assert!(index["tasks"].as_array().unwrap().iter().all(|task|task["requestId"]!=unrelated));
        assert_eq!(index["hasMore"],true);
        assert!(store.background_chat_context("").is_err());
    }
}
