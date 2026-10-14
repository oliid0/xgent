//! Goal-linked scheduled/proactive turns receive fresh original-store context.
//! No new timer, model, task, permission, completion or execution authority.
use super::*;
use serde::{Serialize,Deserialize};
use serde_json::json;

#[derive(Debug,Clone,PartialEq,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct GoalPromptContext {
    pub version:u32,
    pub task_id:String,
    pub store_id:String,
    pub revision:u64,
    pub observed_at:i64,
    pub has_more_goals:bool,
    pub goals:Vec<Value>,
}

fn preview(text:&str,limit:usize)->String{
    let mut end=text.len().min(limit);
    while !text.is_char_boundary(end){end-=1;}
    text[..end].to_string()
}
fn task_binding(task:&CronTask,workdir:&str)->Result<String,String>{
    serde_json::to_string(&json!({"name":task.name,"prompt":task.prompt,"provider":task.selected_model,
        "reasoning":task.reasoning.clone().unwrap_or_default(),"timeout":task.timeout_seconds,
        "workdir":workdir,"pinnedWorkdir":task.workdir})).map_err(|e|e.to_string())
}

pub(super) fn followup_capable(conn:&Connection,task:&CronTask)->Result<bool,String>{
    Ok(task.kind=="prompt" && task.enabled && task.remaining_executions!=Some(0)
        && !task_workdir(conn,task)?.trim().is_empty()
        && !task.prompt.as_deref().unwrap_or_default().trim().is_empty()
        && task.selected_model.as_ref().is_some_and(|model|!model.custom_provider_id.trim().is_empty() && !model.model.trim().is_empty()))
}

pub(super) fn set_followup(conn:&Connection,goal:&str,task:&CronTask,enabled:bool)->Result<(),String>{
    if !enabled{
        conn.execute("DELETE FROM automation_goal_prompt_links WHERE goal_id=?1 AND task_id=?2",params![goal,task.id]).map_err(|e|e.to_string())?;return Ok(());
    }
    let active:bool=conn.query_row("SELECT status='active' FROM automation_goals WHERE goal_id=?1",params![goal],|row|row.get(0)).map_err(|e|e.to_string())?;
    let workdir=task_workdir(conn,task)?;
    if !active || !followup_capable(conn,task)?{
        return Err("Ongoing goal follow-up requires an active goal and an enabled configured prompt schedule".into());
    }
    let store:String=conn.query_row("SELECT value FROM automation_meta WHERE key='goal_store_id.v1'",[],|row|row.get(0)).map_err(|e|e.to_string())?;
    conn.execute("INSERT INTO automation_goal_prompt_links (goal_id,task_id,store_id,task_binding) VALUES (?1,?2,?3,?4) ON CONFLICT(goal_id,task_id) DO UPDATE SET store_id=excluded.store_id,task_binding=excluded.task_binding",params![goal,task.id,store,task_binding(task,&workdir)?]).map_err(|e|e.to_string())?;
    Ok(())
}

pub(super) fn followup_status(conn:&Connection,goal:&str,task:&str)->Result<(bool,Option<String>),String>{
    let saved:Option<(String,String)>=conn.query_row("SELECT store_id,task_binding FROM automation_goal_prompt_links WHERE goal_id=?1 AND task_id=?2",params![goal,task],|row|Ok((row.get(0)?,row.get(1)?))).optional().map_err(|e|e.to_string())?;
    let Some((store,binding))=saved else{return Ok((false,None));};
    let owner:String=conn.query_row("SELECT value FROM automation_meta WHERE key='goal_store_id.v1'",[],|row|row.get(0)).map_err(|e|e.to_string())?;
    let active:bool=conn.query_row("SELECT status='active' FROM automation_goals WHERE goal_id=?1",params![goal],|row|row.get(0)).map_err(|e|e.to_string())?;
    if owner!=store{return Ok((false,Some("owner_changed".into())));}
    if !active{return Ok((false,Some("goal_inactive".into())));}
    let Some(task)=db::read_cron_task(conn,task)? else{return Ok((false,Some("task_removed".into())));};
    if !task.enabled || task.remaining_executions==Some(0){return Ok((false,Some("task_unavailable".into())));}
    if task_binding(&task,&task_workdir(conn,&task)?)?!=binding{return Ok((false,Some("task_changed".into())));}
    Ok((true,None))
}

impl AutomationStore {
    pub(super) fn linked_goal_prompt_snapshot(conn:&Connection,task_id:&str,workdir:&str,exclude_execution:&str)->Result<Option<GoalPromptContext>,String>{
        let Some(task)=db::read_cron_task(conn,task_id)? else{return Ok(None);};
        let binding=task_binding(&task,workdir)?;
        let ids={
            let mut stmt=conn.prepare("SELECT g.goal_id FROM automation_goal_tasks l JOIN automation_goals g ON g.goal_id=l.goal_id JOIN automation_goal_prompt_links f ON f.goal_id=l.goal_id AND f.task_id=l.task_id LEFT JOIN automation_goal_prompt_rotation p ON p.task_id=l.task_id AND p.goal_id=g.goal_id WHERE l.task_id=?1 AND g.status='active' AND f.store_id=(SELECT value FROM automation_meta WHERE key='goal_store_id.v1') AND f.task_binding=?2 ORDER BY COALESCE(p.selected_at,0),l.linked_at,g.goal_id LIMIT 5").map_err(|e|e.to_string())?;
            let rows=stmt.query_map(params![task_id,binding],|row|row.get::<_,String>(0)).map_err(|e|e.to_string())?;
            rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?
        };
        if ids.is_empty(){return Ok(None);}
        let store_id:String=conn.query_row("SELECT value FROM automation_meta WHERE key='goal_store_id.v1'",[],|row|row.get(0)).map_err(|e|e.to_string())?;
        let revision=db::read_revision(conn,super::goals::REVISION)?;
        let host:String=conn.query_row("SELECT value FROM automation_meta WHERE key='background_worker_id.v1'",[],|row|row.get(0)).map_err(|e|e.to_string())?;
        let mut goals=Vec::new();
        for id in ids.iter().take(4){
            let config=super::goals::read_config(conn,id)?;
            let steps:Vec<Value>=config.steps.iter().take(8).map(|step|json!({"id":step.id,"title":preview(&step.title,128),"done":step.done})).collect();
            let work={
                let mut stmt=conn.prepare("SELECT l.request_id,l.task_name,b.execution_id,COALESCE(r.state,CASE WHEN s.request_id IS NOT NULL AND remote.request_id IS NULL THEN CASE WHEN s.cancel_requested=1 THEN 'stopping' ELSE 'submitting' END END) AS state,r.success,r.output,COALESCE(remote.source_host_id,s.source_host_id) AS source_host_id,COALESCE(CASE WHEN s.cancel_requested=1 THEN s.cancel_json END,remote.payload_json) FROM automation_goal_all_work l LEFT JOIN automation_background_tasks b ON b.request_id=l.request_id LEFT JOIN automation_cron_runs r ON r.execution_id=b.execution_id LEFT JOIN automation_goal_remote_work remote ON remote.request_id=l.request_id LEFT JOIN automation_submission_outbox s ON s.request_id=l.request_id AND s.initiating_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1') WHERE l.goal_id=?1 ORDER BY l.linked_at DESC,l.request_id LIMIT 4").map_err(|e|e.to_string())?;
                let rows=stmt.query_map(params![id],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,Option<String>>(2)?,row.get::<_,Option<String>>(3)?,row.get::<_,Option<bool>>(4)?,row.get::<_,Option<String>>(5)?,row.get::<_,Option<String>>(6)?,row.get::<_,Option<String>>(7)?))).map_err(|e|e.to_string())?;
                let rows=rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
                let mut observations=Vec::new();
                for (request_id,name,execution,state,success,output,remote_host,remote_json) in rows{
                    let remote:Option<Value>=remote_json.map(|raw|serde_json::from_str(&raw).map_err(|e|e.to_string())).transpose()?;
                    let actual_state=remote.as_ref().and_then(|value|value["run"]["state"].as_str()).map(ToOwned::to_owned).or(state);
                    let actual_success=success.or_else(||remote.as_ref().and_then(|value|value["run"]["success"].as_bool()));
                    let source_host=remote_host.or_else(||execution.is_some().then(||host.clone()));
                    let output=output.or_else(||remote.as_ref().and_then(|value|value["run"]["output"].as_str()).map(ToOwned::to_owned)).unwrap_or_default();
                    observations.push(json!({"requestId":request_id,"name":preview(&name,256),"executionId":execution.or_else(||remote.as_ref().and_then(|value|value["run"]["id"].as_str()).map(ToOwned::to_owned)),"sourceHostId":source_host,"state":actual_state,"success":if actual_state.as_deref()==Some("done"){actual_success}else{None},"outputPreview":preview(&output,512)}));
                }
                observations
            };
            let scheduled={
                let mut stmt=conn.prepare("SELECT r.execution_id,r.state,r.success,r.output,r.started_at FROM automation_goal_tasks l JOIN automation_cron_runs r ON r.task_id=l.task_id WHERE l.goal_id=?1 AND r.execution_id<>?2 ORDER BY r.started_at DESC,r.execution_id LIMIT 3").map_err(|e|e.to_string())?;
                let rows=stmt.query_map(params![id,exclude_execution],|row|{
                    let state:String=row.get(1)?;let success:bool=row.get(2)?;let output:String=row.get(3)?;
                    Ok(json!({"executionId":row.get::<_,String>(0)?,"state":state,"success":if state=="done"{Some(success)}else{None},"outputPreview":preview(&output,512),"at":row.get::<_,i64>(4)?}))
                }).map_err(|e|e.to_string())?;
                rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?
            };
            let artifacts={
                let mut stmt=conn.prepare("SELECT id,relative_path,content_hash,bytes,request_id,source_host_id FROM (SELECT a.artifact_id AS id,a.relative_path,a.content_hash,a.bytes,b.request_id,?2 AS source_host_id,a.created_at AS at FROM automation_goal_all_work l JOIN automation_background_tasks b ON b.request_id=l.request_id JOIN automation_background_artifacts a ON a.execution_id=b.execution_id WHERE l.goal_id=?1 UNION ALL SELECT a.artifact_id,a.relative_path,a.content_hash,a.bytes,a.request_id,a.source_host_id,a.created_at FROM automation_goal_all_work l JOIN automation_goal_remote_artifacts a ON a.request_id=l.request_id WHERE l.goal_id=?1) ORDER BY at DESC,id LIMIT 4").map_err(|e|e.to_string())?;
                let rows=stmt.query_map(params![id,host],|row|{
                    let path:String=row.get(1)?;
                    Ok(json!({"id":row.get::<_,String>(0)?,"pathPreview":preview(&path,256),"contentHash":row.get::<_,String>(2)?,"bytes":row.get::<_,u64>(3)?,"requestId":row.get::<_,String>(4)?,"sourceHostId":row.get::<_,String>(5)?}))
                }).map_err(|e|e.to_string())?;
                rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?
            };
            goals.push(json!({"id":id,"status":"active","planPreview":{"title":config.title,"description":preview(&config.description,1024),"category":config.category,"parentId":config.parent_id,"steps":steps,"totalSteps":config.steps.len(),"completedSteps":config.steps.iter().filter(|step|step.done).count()},"activeWork":super::goal_launch::has_active_work(conn,id)?,"work":work,"scheduledRuns":scheduled,"artifactHints":artifacts}));
        }
        let context=GoalPromptContext{version:1,task_id:task_id.into(),store_id,revision,observed_at:db::now_ms(),has_more_goals:ids.len()>4,goals};
        if serde_json::to_vec(&context).map_err(|e|e.to_string())?.len()>64*1024{return Err("Linked goal context exceeds its bound; original metadata was not truncated into false proof".into());}
        Ok(Some(context))
    }

    pub(super) fn capture_goal_prompt_context(conn:&Connection,task:&CronTask,request:&mut PromptRunRequest)->Result<(),String>{
        let Some(base)=db::read_cron_task(conn,&task.id)? else{return Ok(());};
        let mut original=task.clone();original.prompt=base.prompt.clone();
        if !base.enabled || task_binding(&original,&request.workdir)?!=task_binding(&base,&task_workdir(conn,&base)?)?{return Ok(());}
        request.goal_context=Self::linked_goal_prompt_snapshot(conn,&request.task_id,&request.workdir,&request.execution_id)?;
        let Some(context)=&request.goal_context else{return Ok(());};
        conn.execute("DELETE FROM automation_goal_prompt_contexts WHERE NOT EXISTS(SELECT 1 FROM automation_cron_runs r WHERE r.execution_id=automation_goal_prompt_contexts.execution_id)",[]).map_err(|e|e.to_string())?;
        conn.execute("INSERT INTO automation_goal_prompt_contexts (execution_id,task_id,task_binding,store_id,context_json,created_at) VALUES (?1,?2,?3,?4,?5,?6)",params![request.execution_id,request.task_id,task_binding(&base,&request.workdir)?,context.store_id,serde_json::to_string(context).map_err(|e|e.to_string())?,db::now_ms()]).map_err(|e|e.to_string())?;
        Ok(())
    }

    pub(super) fn refresh_goal_prompt_context(conn:&Connection,request:&mut PromptRunRequest)->Result<(),String>{
        if request.background_context.is_some() || request.task_id==request.execution_id{request.goal_context=None;return Ok(());}
        let prior:Option<(String,String)>=conn.query_row("SELECT task_binding,store_id FROM automation_goal_prompt_contexts WHERE execution_id=?1 AND task_id=?2",params![request.execution_id,request.task_id],|row|Ok((row.get(0)?,row.get(1)?))).optional().map_err(|e|e.to_string())?;
        let Some((binding,store))=prior else{request.goal_context=None;return Ok(());};
        let task=db::read_cron_task(conn,&request.task_id)?;
        let current_store:String=conn.query_row("SELECT value FROM automation_meta WHERE key='goal_store_id.v1'",[],|row|row.get(0)).map_err(|e|e.to_string())?;
        request.goal_context=match task{
            Some(task) if task.enabled && current_store==store && task_binding(&task,&task_workdir(conn,&task)?)?==binding=>Self::linked_goal_prompt_snapshot(conn,&request.task_id,&request.workdir,&request.execution_id)?,
            _=>None,
        };
        conn.execute("UPDATE automation_goal_prompt_contexts SET context_json=?2 WHERE execution_id=?1",params![request.execution_id,request.goal_context.as_ref().map(serde_json::to_string).transpose().map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
        if let Some(context)=&request.goal_context{
            for goal in &context.goals{
                let id=goal["id"].as_str().ok_or("Missing native linked goal identity")?;
                conn.execute("INSERT INTO automation_goal_prompt_rotation (task_id,goal_id,selected_at) VALUES (?1,?2,?3) ON CONFLICT(task_id,goal_id) DO UPDATE SET selected_at=excluded.selected_at",params![request.task_id,id,db::now_ms()]).map_err(|e|e.to_string())?;
            }
        }
        conn.execute("DELETE FROM automation_goal_prompt_rotation WHERE NOT EXISTS(SELECT 1 FROM automation_goal_tasks l JOIN automation_goals g ON g.goal_id=l.goal_id WHERE l.task_id=automation_goal_prompt_rotation.task_id AND l.goal_id=automation_goal_prompt_rotation.goal_id)",[]).map_err(|e|e.to_string())?;
        Ok(())
    }
}
