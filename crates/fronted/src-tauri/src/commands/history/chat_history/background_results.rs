// The immutable native inbox remains the delivery source. Project only into an
// existing original receipt; never create a conversation or replay a task.
fn background_source_user_matches(
    conn: &Connection, conversation: &str, user_id: &str, hash: &str,
    incoming: Option<&ChatHistorySegmentInput>,
) -> Result<bool, String> {
    if let Some(segment) = incoming {
        let messages: Vec<Value> = serde_json::from_str(&segment.messages_json).map_err(|e| e.to_string())?;
        let users: Vec<_> = messages.iter().filter(|message| message["role"]=="user"
            && history_message_id_for_ref(message).as_deref()==Some(user_id)).collect();
        if !users.is_empty() { return Ok(users.len()==1 && history_message_content_hash(users[0])==hash); }
    }
    let mut statement = conn.prepare(
        "SELECT m.value FROM chatHistorySegment s,json_each(s.messages_json) m
         WHERE s.conversation_id=?1 AND json_extract(m.value,'$.role')='user'
           AND json_extract(m.value,'$.id')=?2 AND (?3 IS NULL OR s.segment_index!=?3) LIMIT 2"
    ).map_err(|e|e.to_string())?;
    let users = statement.query_map(params![conversation,user_id,incoming.map(|segment|segment.segment_index)],|row|row.get::<_,String>(0))
        .map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    if users.len()!=1{return Ok(false)}
    let user:Value=serde_json::from_str(&users[0]).map_err(|e|e.to_string())?;
    Ok(history_message_content_hash(&user)==hash)
}

/// An old foreground snapshot may update other messages, but cannot downgrade
/// a delivered receipt. Deleted receipts/segments are never put back.
fn preserve_background_results(
    conn: &Connection, conversation: &str, incoming: &ChatHistorySegmentInput,
) -> Result<Option<ChatHistorySegmentInput>, String> {
    if !incoming.messages_json.contains("xgentBackgroundTask") {return Ok(None)}
    let saved:Option<String>=conn.query_row(
        "SELECT messages_json FROM chatHistorySegment WHERE conversation_id=?1 AND segment_index=?2 AND segment_id=?3",
        params![conversation,incoming.segment_index,incoming.segment_id],|row|row.get(0)
    ).optional().map_err(|e|e.to_string())?;
    let Some(saved)=saved else{return Ok(None)};
    if !saved.contains("xgentBackgroundResult"){return Ok(None)}
    let saved:Vec<Value>=serde_json::from_str(&saved).map_err(|e|e.to_string())?;
    let mut messages:Vec<Value>=serde_json::from_str(&incoming.messages_json).map_err(|e|e.to_string())?;
    let mut changed=false;
    for old in &saved {
        let result=&old["xgentBackgroundResult"];
        let (Some(user),Some(hash),Some(sequence))=(result["userMessageId"].as_str(),result["userContentHash"].as_str(),result["sequence"].as_u64()) else{continue};
        if !matches!(result["version"].as_u64(),Some(1|2)) || result["conversationId"]!=conversation || old["role"]!="assistant"
            || !background_source_user_matches(conn,conversation,user,hash,Some(incoming))? {continue}
        let matches:Vec<_>=messages.iter().enumerate().filter(|(_,message)| message["role"]=="assistant"
            && message["xgentBackgroundTask"]==old["xgentBackgroundTask"]
            && message["timestamp"]==old["timestamp"]
            && history_message_id_for_ref(message)==history_message_id_for_ref(old)).map(|(index,_)|index).collect();
        if matches.len()!=1 {continue}
        let index=matches[0];
        if messages[index]["xgentBackgroundResult"]["sequence"].as_u64().is_some_and(|new|new>sequence
            || (new==sequence && messages[index]["xgentBackgroundResult"]["version"].as_u64()>result["version"].as_u64())){continue}
        if messages[index]["content"]!=old["content"] || messages[index]["xgentBackgroundResult"]!=*result {
            messages[index]["content"]=old["content"].clone();
            messages[index]["xgentBackgroundResult"]=result.clone();
            changed=true;
        }
    }
    if !changed{return Ok(None)}
    let mut retained=incoming.clone();
    retained.messages_json=serde_json::to_string(&messages).map_err(|e|e.to_string())?;
    Ok(Some(retained))
}

pub(crate) fn project_background_chat_result_sync(
    conn:&mut Connection, result:&Value,
) -> Result<Option<ChatHistorySummary>,String> {
    let required=|key:&str| result[key].as_str().filter(|value|!value.is_empty()).ok_or_else(||format!("Missing chat result {key}"));
    let conversation=required("conversationId")?;
    let user=required("userMessageId")?;
    let request=required("requestId")?;
    let host=required("sourceHostId")?;
    let entry=required("entryId")?;
    let snapshot=required("snapshotHash")?;
    let Some(sequence)=result["sequence"].as_u64() else{return Err("Missing chat result sequence".into())};
    let source_hash=result["sourceMessageHash"].as_str().map(str::to_string).or_else(|| {
        let source=&result["sourceUser"];
        (source["role"]=="user" && history_message_id_for_ref(source).as_deref()==Some(user))
            .then(||history_message_content_hash(source))
    });
    let Some(source_hash)=source_hash else{return Ok(None)};
    let payload=&result["payload"];
    if payload["hostId"]!=host || payload["requestId"]!=request
        || !matches!(payload["run"]["state"].as_str(),Some("waiting"|"done"|"expired")){return Ok(None)}
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
    if !background_source_user_matches(&tx,conversation,user,&source_hash,None)? {return Ok(None)}
    let indices:Vec<i64>={
        let mut statement=tx.prepare(
            "SELECT s.segment_index FROM chatHistorySegment s,json_each(s.messages_json) m
             WHERE s.conversation_id=?1 AND json_extract(m.value,'$.role')='assistant'
               AND json_extract(m.value,'$.xgentBackgroundTask.requestId')=?2
               AND json_extract(m.value,'$.xgentBackgroundTask.hostId')=?3 LIMIT 2"
        ).map_err(|e|e.to_string())?;
        let indices=statement.query_map(params![conversation,request,host],|row|row.get(0)).map_err(|e|e.to_string())?
            .collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
        indices
    };
    if indices.len()!=1{return Ok(None)}
    let record=get_record_by_id(&tx,conversation)?;
    let segment=load_segment_by_index(&tx,conversation,indices[0])?;
    let mut messages:Vec<Value>=serde_json::from_str(&segment.messages_json).map_err(|e|e.to_string())?;
    let Some(receipt)=messages.iter_mut().find(|message|message["role"]=="assistant"
        && message["xgentBackgroundTask"]["requestId"]==request && message["xgentBackgroundTask"]["hostId"]==host) else{return Ok(None)};
    if receipt["xgentBackgroundResult"]["sequence"].as_u64().is_some_and(|saved|saved>sequence
        || (saved>=sequence && receipt["xgentBackgroundResult"]["version"]==2)){return Ok(None)}
    // These are the worker's exact retained words, not a new model reply or
    // fabricated tool trace. Success and manifest metadata remain observations.
    let output=payload["run"]["output"].as_str().unwrap_or_default();
    let text=if output.trim().is_empty(){format!("{} · {}",payload["name"].as_str().unwrap_or("Task"),payload["run"]["state"].as_str().unwrap_or_default())}else{output.to_string()};
    receipt["content"]=serde_json::json!([{"type":"text","text":text}]);
    receipt["xgentBackgroundResult"]=serde_json::json!({"version":2,"conversationId":conversation,"userMessageId":user,"userContentHash":source_hash,
        "requestId":request,"sourceHostId":host,"entryId":entry,"snapshotHash":snapshot,"sequence":sequence,
        "executionId":payload["run"]["id"],"receiverHostId":result["receiverHostId"],"artifacts":payload["artifacts"],
        "state":payload["run"]["state"],"success":payload["run"]["success"],"receivedAt":result["receivedAt"]});
    let mut replacement=record_to_segment_input(&segment);
    replacement.messages_json=serde_json::to_string(&messages).map_err(|e|e.to_string())?;
    replacement.updated_at=now_ms().max(record.updated_at.saturating_add(1));
    tx.execute("UPDATE chatHistory SET updated_at=?1 WHERE id=?2",params![replacement.updated_at,conversation]).map_err(|e|e.to_string())?;
    upsert_single_segment(&tx,conversation,&replacement)?;
    verify_chat_history_consistency(&tx,conversation)?;
    let summary=get_summary_by_id(&tx,conversation)?;
    tx.commit().map_err(|e|e.to_string())?;
    Ok(Some(summary))
}

pub(crate) fn emit_background_chat_result(app:&tauri::AppHandle,summary:&ChatHistorySummary) {
    emit_history_upsert(app,summary);
}

pub(crate) fn validate_background_chat_artifact_sync(conn:&Connection,result:&Value,entry:&str)->Result<(),String>{
    let conversation=result["conversationId"].as_str().ok_or("Missing original conversation")?;
    let user=result["userMessageId"].as_str().ok_or("Missing original user")?;
    let hash=result["sourceMessageHash"].as_str().map(str::to_string).or_else(|| {
        let source=&result["sourceUser"];
        (source["role"]=="user" && history_message_id_for_ref(source).as_deref()==Some(user)).then(||history_message_content_hash(source))
    }).ok_or("Original task input cannot be verified")?;
    if !background_source_user_matches(conn,conversation,user,&hash,None)? || result["entryId"]!=entry{
        return Err("Original chat result changed; refresh the conversation".into());
    }
    let count:i64=conn.query_row(
        "SELECT COUNT(*) FROM chatHistorySegment s,json_each(s.messages_json) m
         WHERE s.conversation_id=?1 AND json_extract(m.value,'$.role')='assistant'
           AND json_extract(m.value,'$.xgentBackgroundTask.requestId')=?2
           AND json_extract(m.value,'$.xgentBackgroundTask.hostId')=?3
           AND json_extract(m.value,'$.xgentBackgroundResult.entryId')=?4
           AND json_extract(m.value,'$.xgentBackgroundResult.snapshotHash')=?5",
        params![conversation,result["requestId"].as_str(),result["sourceHostId"].as_str(),entry,result["snapshotHash"].as_str()],|row|row.get(0)
    ).map_err(|e|e.to_string())?;
    if count!=1{return Err("Original chat artifact receipt is missing or ambiguous".into())}Ok(())
}

#[cfg(test)]
mod background_result_tests {
    use super::*;
    use serde_json::json;

    fn setup()->(Connection,ChatHistorySegmentInput,Value){
        let conn=Connection::open_in_memory().unwrap();
        history_db::initialize_connection(&conn).unwrap();
        let user=json!({"role":"user","id":"user-original","content":"Create the report","timestamp":100});
        let receipt=json!({"role":"assistant","id":"receipt-original","content":[{"type":"text","text":"Accepted"}],"timestamp":101,
            "xgentBackgroundTask":{"requestId":"request-original","hostId":"host-original","accepted":true}});
        let segment=ChatHistorySegmentInput{segment_index:0,segment_id:"segment-original".into(),summary_json:None,messages_json:json!([user,receipt]).to_string(),
            message_count:2,start_message_id:Some("user-original".into()),end_message_id:Some("receipt-original".into()),created_at:100,updated_at:101};
        let header=ChatHistoryConversationInput{id:"conversation-original".into(),title:"Report".into(),provider_id:"fixture".into(),model:"fixture".into(),
            session_id:None,cwd:None,selected_model_json:None,context_meta_json:"{}".into(),active_segment_index:0,total_segment_count:1,total_message_count:2,created_at:Some(100),updated_at:101};
        upsert_chat_history_header(&conn,&header).unwrap();upsert_single_segment(&conn,&header.id,&segment).unwrap();
        let result=json!({"conversationId":header.id,"userMessageId":"user-original","sourceMessageHash":history_message_content_hash(&user),
            "requestId":"request-original","sourceHostId":"host-original","entryId":"entry-original","snapshotHash":"hash-original","sequence":1,"receivedAt":200,
            "payload":{"requestId":"request-original","hostId":"host-original","name":"Report","run":{"id":"execution-original","state":"waiting","success":false,"output":"Actual saved partial report"}}});
        (conn,segment,result)
    }

    #[test]
    fn delivery_updates_original_receipt_and_fts_once_then_retains_newer_foreground_messages(){
        let (mut conn,mut incoming,mut result)=setup();
        assert!(project_background_chat_result_sync(&mut conn,&result).unwrap().is_some());
        assert!(project_background_chat_result_sync(&mut conn,&result).unwrap().is_none());
        let mut messages:Vec<Value>=serde_json::from_str(&incoming.messages_json).unwrap();
        messages.push(json!({"role":"user","id":"later-user","content":"Keep working","timestamp":300}));
        incoming.messages_json=serde_json::to_string(&messages).unwrap();incoming.message_count=3;incoming.end_message_id=Some("later-user".into());
        upsert_single_segment(&conn,"conversation-original",&incoming).unwrap();
        let saved=load_segment_by_index(&conn,"conversation-original",0).unwrap();
        let saved:Vec<Value>=serde_json::from_str(&saved.messages_json).unwrap();
        assert_eq!(saved[1]["content"][0]["text"],"Actual saved partial report");assert_eq!(saved[2]["id"],"later-user");
        result["sequence"]=json!(2);result["payload"]["run"]["state"]=json!("done");result["payload"]["run"]["output"]=json!("Actual completed report");
        // Keep header counts consistent with the independently saved user turn.
        conn.execute("UPDATE chatHistory SET total_message_count=3 WHERE id='conversation-original'",[]).unwrap();
        assert!(project_background_chat_result_sync(&mut conn,&result).unwrap().is_some());
        let saved=load_segment_by_index(&conn,"conversation-original",0).unwrap();
        assert!(saved.messages_json.contains("Actual completed report"));
        assert!(conn.query_row("SELECT COUNT(*) FROM chatHistoryMessageFts WHERE body LIKE '%Actual completed report%'",[],|row|row.get::<_,i64>(0)).unwrap()>0);
    }

    #[test]
    fn changed_deleted_or_foreign_original_input_cannot_receive_or_restore_results(){
        let (mut conn,segment,mut result)=setup();
        result["sourceHostId"]=json!("wrong-host");assert!(project_background_chat_result_sync(&mut conn,&result).unwrap().is_none());
        result["sourceHostId"]=json!("host-original");
        let mut messages:Vec<Value>=serde_json::from_str(&segment.messages_json).unwrap();messages[0]["content"]=json!("Different request");
        conn.execute("UPDATE chatHistorySegment SET messages_json=?1",params![serde_json::to_string(&messages).unwrap()]).unwrap();
        assert!(project_background_chat_result_sync(&mut conn,&result).unwrap().is_none());
        conn.execute("DELETE FROM chatHistorySegment",[]).unwrap();
        assert!(project_background_chat_result_sync(&mut conn,&result).unwrap().is_none());
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM chatHistorySegment",[],|row|row.get::<_,i64>(0)).unwrap(),0);
    }

    #[test]
    fn original_artifact_receipt_is_fenced_by_input_entry_and_snapshot_and_upgrades_legacy_metadata_once(){
        let (mut conn,_,mut result)=setup();
        result["receiverHostId"]=json!(Uuid::new_v4().to_string());
        result["payload"]["artifacts"]=json!([{ "id":Uuid::new_v4().to_string(),"relativePath":"product.docx","bytes":48,"contentHash":"a".repeat(64) }]);
        assert!(project_background_chat_result_sync(&mut conn,&result).unwrap().is_some());
        assert!(validate_background_chat_artifact_sync(&conn,&result,"entry-original").is_ok());
        assert!(validate_background_chat_artifact_sync(&conn,&result,"other-entry").is_err());
        let segment=load_segment_by_index(&conn,"conversation-original",0).unwrap();
        let mut messages:Vec<Value>=serde_json::from_str(&segment.messages_json).unwrap();
        messages[1]["xgentBackgroundResult"]["version"]=json!(1);
        messages[1]["xgentBackgroundResult"].as_object_mut().unwrap().remove("artifacts");
        conn.execute("UPDATE chatHistorySegment SET messages_json=?1",params![serde_json::to_string(&messages).unwrap()]).unwrap();
        assert!(project_background_chat_result_sync(&mut conn,&result).unwrap().is_some());
        assert!(project_background_chat_result_sync(&mut conn,&result).unwrap().is_none());
        let segment=load_segment_by_index(&conn,"conversation-original",0).unwrap();
        let mut messages:Vec<Value>=serde_json::from_str(&segment.messages_json).unwrap();
        assert_eq!(messages[1]["xgentBackgroundResult"]["artifacts"].as_array().unwrap().len(),1);
        messages[0]["content"]=json!("Corrected request");
        conn.execute("UPDATE chatHistorySegment SET messages_json=?1",params![serde_json::to_string(&messages).unwrap()]).unwrap();
        assert!(validate_background_chat_artifact_sync(&conn,&result,"entry-original").is_err());
    }
}
