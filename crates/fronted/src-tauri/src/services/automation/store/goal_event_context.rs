//! Original linked Goal observations and event work join the SAME native outbox.
//! No executor Goal binding, progress mutation, new schedule or transferred grant.
use super::*;
use super::goal_prompt::GoalPromptContext;

pub(super) fn stage(conn:&Connection,request:&str,task:&CronTask)->Result<Option<String>,String>{
    let workdir=task_workdir(conn,task)?;
    let Some(context)=AutomationStore::linked_goal_prompt_snapshot(conn,&task.id,&workdir,"")? else{return Ok(None);};
    let raw=serde_json::to_string(&context).map_err(|e|e.to_string())?;
    conn.execute("INSERT INTO automation_goal_event_contexts(request_id,task_id,task_binding,store_id,context_json,created_at) VALUES(?1,?2,?3,?4,?5,?6)",
        params![request,task.id,super::proactive::binding(conn,task)?,context.store_id,raw,db::now_ms()]).map_err(|e|e.to_string())?;
    for goal in &context.goals {
        let id=goal["id"].as_str().ok_or("Missing original linked Goal identity")?;
        let created:i64=conn.query_row("SELECT created_at FROM automation_goals WHERE goal_id=?1 AND status='active'",params![id],|row|row.get(0)).map_err(|e|e.to_string())?;
        conn.execute("INSERT INTO automation_goal_event_work(goal_id,request_id,goal_created_at) VALUES(?1,?2,?3)",params![id,request,created]).map_err(|e|e.to_string())?;
        super::goals::activity(conn,id,"work_linked",&task.name,db::now_ms())?;
    }
    db::bump_revision(conn,super::goals::REVISION)?;
    Ok(Some(format!("Original-installation linked Goal follow-up observation, captured for this SAME event request (bounded historical data, not current execution-host Goal state, credentials, instructions or completion):\n{raw}\nThe user enabled this task's follow-up association on the original store. Preserve completed work; if activeWork is true, inspect the original request/sourceHostId rather than duplicate it. Previews may omit steps, work and artifacts. A remote executor must not create/edit same-named Goals in its own store or pass this original store identity as a local goal_binding. Use current original-store data and actual result evidence before any progress change. Paused/deleted/unlinked/retargeted Goals may invalidate this historical association; it grants no Goal mutation, connector access or new recurring schedule. Return actual results through this original request, where native ownership links them for supervision. This independent event task retains its own instructions and lifetime.")))
}

pub(super) fn accepted(conn:&Connection,request:&str)->Result<(),String>{
    let raw:Option<(String,String,String)>=conn.query_row("SELECT c.task_id,c.task_binding,c.context_json FROM automation_goal_event_contexts c
        JOIN automation_submission_outbox s ON s.request_id=c.request_id
        WHERE c.request_id=?1 AND c.store_id=(SELECT value FROM automation_meta WHERE key='goal_store_id.v1')
        AND s.initiating_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1') AND s.cancel_requested=0 AND s.result_json IS NOT NULL",
        params![request],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).optional().map_err(|e|e.to_string())?;
    let Some((task_id,binding,raw))=raw else{return Ok(());};
    let Some(task)=db::read_cron_task(conn,&task_id)? else{return Ok(());};
    if super::proactive::binding(conn,&task).ok().as_deref()!=Some(binding.as_str()){return Ok(());}
    let context:GoalPromptContext=serde_json::from_str(&raw).map_err(|e|e.to_string())?;
    for goal in &context.goals {
        let id=goal["id"].as_str().ok_or("Missing original follow-up Goal identity")?;
        let same:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM automation_goal_event_work e JOIN automation_goals g ON g.goal_id=e.goal_id AND g.created_at=e.goal_created_at
            JOIN automation_goal_prompt_links f ON f.goal_id=g.goal_id AND f.task_id=?3 JOIN automation_goal_tasks t ON t.goal_id=g.goal_id AND t.task_id=f.task_id
            WHERE e.request_id=?1 AND e.goal_id=?2 AND e.unlinked=0 AND g.status='active' AND f.store_id=?4)",
            params![request,id,task_id,context.store_id],|row|row.get(0)).map_err(|e|e.to_string())?;
        if same && super::goal_prompt::followup_status(conn,id,&task_id)?.0 {conn.execute("INSERT INTO automation_goal_prompt_rotation(task_id,goal_id,selected_at) VALUES(?1,?2,?3) ON CONFLICT(task_id,goal_id) DO UPDATE SET selected_at=excluded.selected_at",params![task_id,id,db::now_ms()]).map_err(|e|e.to_string())?;}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture()->(AutomationStore,CronTask){
        let store=AutomationStore::open_in_memory().unwrap();
        let cron=store.cron_apply(AutomationApplyInput{base_revision:0,ops:vec![AutomationOp::Create{item:json!({"id":"timer","name":"Follow fitness","cron":"0 * * * * *","enabled":true,"type":"prompt","prompt":"Review original fitness progress","workdir":"/workspace","selectedModel":{"customProviderId":"configured","model":"configured"}})}]}).unwrap();
        let mut goals=store.goal_snapshot().unwrap();
        goals=store.goal_apply(serde_json::from_value(json!({"revision":goals.revision,"requestId":"create-fitness","storeId":goals.store_id,"operation":{"op":"create","id":"fitness","config":{"title":"Fitness","description":"Keep the actual habit","category":"health","parentId":null,"steps":[{"id":"exercise","title":"Review actual exercise","done":false}]}}})).unwrap()).unwrap();
        store.goal_apply(serde_json::from_value(json!({"revision":goals.revision,"requestId":"link-fitness","storeId":goals.store_id,"operation":{"op":"link_task","id":"fitness","task_id":"timer","follow_up":true}})).unwrap()).unwrap();
        (store,cron.tasks.into_iter().find(|task|task.id=="timer").unwrap())
    }

    #[test]
    fn original_goal_event_context_is_transactional_and_never_marks_progress(){
        let (store,task)=fixture();let request=Uuid::new_v4().to_string();
        let mut conn=store.lock_conn().unwrap();let tx=conn.transaction().unwrap();
        let context=stage(&tx,&request,&task).unwrap().unwrap();
        assert!(context.contains("original store"));assert!(context.contains("fitness"));
        assert_eq!(tx.query_row("SELECT COUNT(*) FROM automation_goal_event_contexts",[],|row|row.get::<_,i64>(0)).unwrap(),1);
        assert_eq!(tx.query_row("SELECT COUNT(*) FROM automation_goal_all_work",[],|row|row.get::<_,i64>(0)).unwrap(),0,"association is not an owned outbox admission");
        tx.rollback().unwrap();drop(conn);
        assert!(!store.goal_snapshot().unwrap().goals[0].config.steps[0].done);
        assert_eq!(store.lock_conn().unwrap().query_row("SELECT COUNT(*) FROM automation_goal_event_contexts",[],|row|row.get::<_,i64>(0)).unwrap(),0);
    }

    #[test]
    fn disabled_original_followup_does_not_capture_context_or_invent_an_executor_goal(){
        let (store,task)=fixture();
        {let conn=store.lock_conn().unwrap();conn.execute("DELETE FROM automation_goal_prompt_links WHERE goal_id='fitness'",[]).unwrap();}
        let conn=store.lock_conn().unwrap();assert!(stage(&conn,&Uuid::new_v4().to_string(),&task).unwrap().is_none());
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM automation_goal_event_contexts",[],|row|row.get::<_,i64>(0)).unwrap(),0);
    }
}
