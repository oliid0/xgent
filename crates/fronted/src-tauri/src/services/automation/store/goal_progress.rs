//! Reconcile explicitly launched original Goal steps from authenticated,
//! accepted task outcomes. No model/RPC writes, inferred completion or timer.
use super::*;
use super::goals::{self,GoalConfig};
use serde::{Deserialize,Serialize};

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(super) struct FrozenGoalProgress {
    pub version:u32,
    pub created_at:i64,
    pub plan:GoalConfig,
}

impl FrozenGoalProgress {
    pub(super) fn routing(&self,host:&str)->Result<BackgroundSourceRouting,String>{
        let remaining:Vec<_>=self.plan.steps.iter().filter(|step|!step.done).collect();
        // Source routing supports16branches; group at most3 of the40Goal steps
        // and retain one full-requirement review branch, without omitting any.
        let width=((remaining.len()+14)/15).max(1);
        let mut branches=Vec::new();
        for (index,steps) in remaining.chunks(width).enumerate(){
            let titles:Vec<_>=steps.iter().map(|step|step.title.as_str()).collect();
            branches.push(BackgroundSourceBranch {observation:None,id:format!("goal-step-{index}"),locality:"portable".into(),depends_on:vec![],
                requirement:format!("Complete every original Goal step in this group, with actual evidence:\n{}",serde_json::to_string(&titles).map_err(|e|e.to_string())?)});
        }
        branches.push(BackgroundSourceBranch {observation:None,id:"goal-review".into(),locality:"portable".into(),
            depends_on:branches.iter().map(|branch|branch.id.clone()).collect(),
            requirement:"Verify every requirement in the full original accepted Goal plan, including its description and previously completed steps. Inspect actual deliverables and join all authorized delegated work; missing input, permissions or outcomes must remain unfinished. Group completion alone does not complete the Goal.".into()});
        let routing=BackgroundSourceRouting {version:1,initiating_host_id:host.into(),branches};
        routing.validate()?;
        Ok(routing)
    }
}

fn same_requirements(current:&GoalConfig,accepted:&GoalConfig)->bool{
    current.title==accepted.title && current.description==accepted.description && current.category==accepted.category
        && current.parent_id==accepted.parent_id && current.steps.len()==accepted.steps.len()
        && current.steps.iter().zip(&accepted.steps).all(|(now,old)|now.id==old.id && now.title==old.title)
}

pub(super) fn reconcile(conn:&Connection,request:&str)->Result<(),String>{
    let owned:Option<(String,String,String,String)>=conn.query_row(
        "SELECT l.goal_id,s.origin_json,s.input_json,i.payload_json FROM automation_goal_launches l
         JOIN automation_goal_work link ON link.goal_id=l.goal_id AND link.request_id=l.request_id
         JOIN automation_submission_outbox s ON s.request_id=l.request_id AND s.source_host_id=l.source_host_id AND s.initiating_host_id=l.initiating_host_id
         JOIN automation_result_inbox i ON i.sequence=(SELECT MAX(received.sequence) FROM automation_result_inbox received
           WHERE received.request_id=s.request_id AND received.source_host_id=s.source_host_id
             AND json_extract(received.payload_json,'$.run.id')=json_extract(s.result_json,'$.run.id'))
         WHERE l.request_id=?1 AND l.initiating_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1')
           AND s.cancel_requested=0 AND json_extract(s.result_json,'$.requestId')=s.request_id
           AND json_extract(s.result_json,'$.hostId')=s.source_host_id
           AND json_extract(s.result_json,'$.run.id')=json_extract(s.result_json,'$.run.taskId')",
        params![request],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))
    ).optional().map_err(|e|e.to_string())?;
    let Some((id,origin,input,payload))=owned else{return Ok(());};
    let origin:Value=serde_json::from_str(&origin).map_err(|e|e.to_string())?;
    let Some(frozen)=origin.get("progress").and_then(|value|serde_json::from_value::<FrozenGoalProgress>(value.clone()).ok()) else{return Ok(());};
    let store:Option<String>=conn.query_row("SELECT value FROM automation_meta WHERE key='goal_store_id.v1'",[],|row|row.get(0)).optional().map_err(|e|e.to_string())?;
    if frozen.version!=1 || origin["goal"]["goalId"]!=id || store.as_deref()!=origin["goal"]["storeId"].as_str(){return Ok(());}
    let current:Option<(String,String,i64)>=conn.query_row("SELECT config_json,status,created_at FROM automation_goals WHERE goal_id=?1",
        params![id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).optional().map_err(|e|e.to_string())?;
    let Some((raw,status,created_at))=current else{return Ok(());};
    let mut goal:GoalConfig=serde_json::from_str(&raw).map_err(|e|e.to_string())?;
    if status!="active" || created_at!=frozen.created_at || !same_requirements(&goal,&frozen.plan){return Ok(());}
    let input:SubmitBackgroundTaskInput=serde_json::from_str(&input).map_err(|e|e.to_string())?;
    let Some(source)=input.source_context else{return Ok(());};
    let host:String=conn.query_row("SELECT value FROM automation_meta WHERE key='background_worker_id.v1'",[],|row|row.get(0)).map_err(|e|e.to_string())?;
    let routing=frozen.routing(&host)?;
    if source.routing.as_ref().is_none_or(|actual|serde_json::to_value(actual).ok()!=serde_json::to_value(&routing).ok()){return Ok(());}
    let payload:Value=serde_json::from_str(&payload).map_err(|e|e.to_string())?;
    let Some(outcomes)=payload["outcomes"]["branches"].as_array().filter(|items|items.len()<=32) else{return Ok(());};
    let remaining:Vec<_>=frozen.plan.steps.iter().filter(|step|!step.done).collect();
    let width=((remaining.len()+14)/15).max(1);
    let now=db::now_ms();
    let mut changed=false;
    for (index,steps) in remaining.chunks(width).enumerate(){
        let expected=&routing.branches[index];
        let matching:Vec<_>=outcomes.iter().filter(|item|item["branch"]["id"]==expected.id).collect();
        if matching.len()!=1 {continue;}
        let outcome=matching[0];
        let Ok(branch)=serde_json::from_value::<BackgroundBranch>(outcome["branch"].clone()) else{continue;};
        let Ok(evidence)=serde_json::from_value::<BackgroundBranchEvidence>(outcome["evidence"].clone()) else{continue;};
        if outcome["state"]!="verified" || !outcome["evidence"].is_object() || branch.requirement!=expected.requirement
            || branch.depends_on!=expected.depends_on || branch.criteria.is_empty()
            || branch.criteria.len()>8 || evidence.artifact_ids.len()>32 || evidence.call_ids.len()>32
            || branch.criteria.iter().any(|criterion|match criterion {
                BackgroundCriterion::Unavailable{..}=>true,
                BackgroundCriterion::Answer=>evidence.answer.as_deref().is_none_or(|answer|answer.trim().is_empty()),
                BackgroundCriterion::Operation{..}=>evidence.call_ids.is_empty(),
                BackgroundCriterion::Artifact{path}=>payload["artifacts"].as_array().is_none_or(|artifacts|!artifacts.iter().any(|artifact|
                    artifact["relativePath"]==*path && artifact["id"].as_str().is_some_and(|id|evidence.artifact_ids.iter().any(|actual|actual==id)))),
            }){continue;}
        for accepted in steps {
            if conn.execute("INSERT OR IGNORE INTO automation_goal_step_receipts(request_id,step_id,goal_id,recorded_at) VALUES(?1,?2,?3,?4)",
                params![request,accepted.id,id,now]).map_err(|e|e.to_string())?==0 {continue;}
            let step=goal.steps.iter_mut().find(|step|step.id==accepted.id).ok_or("Original Goal step disappeared")?;
            if !step.done {
                step.done=true;changed=true;
                goals::activity(conn,&id,"step_done",&step.title,now)?;
            }
        }
    }
    if changed {
        conn.execute("UPDATE automation_goals SET config_json=?2 WHERE goal_id=?1",params![id,serde_json::to_string(&goal).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
        db::bump_revision(conn,goals::REVISION)?;
    }
    Ok(())
}

pub(super) fn fence_reset(conn:&Connection,goal:&str,step:&str,now:i64)->Result<(),String>{
    conn.execute("INSERT OR IGNORE INTO automation_goal_step_receipts(request_id,step_id,goal_id,recorded_at) SELECT request_id,?2,goal_id,?3 FROM automation_goal_launches WHERE goal_id=?1",
        params![goal,step,now]).map_err(|e|e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::goals::{GoalApplyInput,GoalOperation,GoalStep};
    use super::super::goal_launch::GoalLaunchInput;

    fn launched()->(AutomationStore,BackgroundSubmission,BackgroundResultWatch,Value){
        let store=AutomationStore::open_in_memory().unwrap();
        let initial=store.goal_snapshot().unwrap();
        let plan=GoalConfig {title:"Prepare summaries".into(),description:"Write both requested summaries".into(),category:"career".into(),parent_id:None,
            steps:vec![GoalStep{id:"first".into(),title:"First summary".into(),done:false},GoalStep{id:"second".into(),title:"Second summary".into(),done:false}]};
        let snapshot=store.goal_apply(GoalApplyInput{revision:initial.revision,request_id:Uuid::new_v4().to_string(),store_id:Some(initial.store_id.clone()),
            operation:GoalOperation::Create{id:"original".into(),config:plan}}).unwrap();
        let request=Uuid::new_v4().to_string();let peer=Uuid::new_v4().to_string();
        store.stage_goal_launch(GoalLaunchInput {request_id:request.clone(),goal:BackgroundGoalBinding {goal_id:"original".into(),store_id:snapshot.store_id,revision:snapshot.revision},
            peer_id:Some(peer.clone()),provider_id:"fixture".into(),model:"fixture".into(),workdir:std::env::temp_dir().to_string_lossy().into_owned(),intelligent_scheduling_enabled:false},&peer,None).unwrap();
        let pending=store.background_submission(&request).unwrap().unwrap();
        let routing=pending.input.source_context.as_ref().unwrap().routing.as_ref().unwrap();
        let branches:Vec<_>=routing.branches.iter().enumerate().map(|(index,branch)|serde_json::json!({
            "branch":{"id":branch.id,"title":branch.id,"requirement":branch.requirement,"dependsOn":branch.depends_on,"criteria":[{"kind":"answer"}]},
            "state":if index==0{"verified"}else{"pending"},"evidence":if index==0{serde_json::json!({"artifactIds":[],"callIds":[],"answer":"Actual first requested summary."})}else{Value::Null},
        })).collect();
        let execution=Uuid::new_v4().to_string();
        let payload=serde_json::json!({"requestId":request,"hostId":peer,"name":"Prepare summaries","workdir":"/fixture",
            "run":{"id":execution,"taskId":execution,"state":"waiting","success":false,"startedAt":100,"output":"First summary ready; second pending."},
            "checkpointRevision":1,"artifacts":[],"operations":{"inFlight":0,"returned":0},"outcomes":{"branches":branches,"verified":false},
            "waiting":{"waitId":Uuid::new_v4().to_string(),"createdAt":200}});
        (store,pending,BackgroundResultWatch{source_host_id:peer,request_id:request},payload)
    }
    #[test]
    fn original_goal_progress_handles_result_before_acceptance_and_cannot_undo_manual_resets(){
        let (store,pending,watch,mut payload)=launched();
        assert!(store.receive_background_result(&watch,payload.clone()).unwrap());
        assert!(!store.goal_snapshot().unwrap().goals[0].config.steps[0].done);
        store.complete_background_submission(&pending,&payload).unwrap();
        let snapshot=store.goal_snapshot().unwrap();
        assert!(snapshot.goals[0].config.steps[0].done);assert!(!snapshot.goals[0].config.steps[1].done);
        assert_eq!(snapshot.goals[0].status,"active");
        for id in ["first","second"] {
            let snapshot=store.goal_snapshot().unwrap();
            store.goal_apply(GoalApplyInput {revision:snapshot.revision,request_id:Uuid::new_v4().to_string(),store_id:Some(snapshot.store_id.clone()),
                operation:GoalOperation::SetStep{id:"original".into(),step_id:id.into(),done:false}}).unwrap();
        }
        payload["checkpointRevision"]=serde_json::json!(2);
        payload["outcomes"]["branches"][1]["state"]=serde_json::json!("verified");
        payload["outcomes"]["branches"][1]["evidence"]=serde_json::json!({"artifactIds":[],"callIds":[],"answer":"Actual second summary."});
        store.receive_background_result(&watch,payload).unwrap();
        assert!(store.goal_snapshot().unwrap().goals[0].config.steps.iter().all(|step|!step.done));
    }
    #[test]
    fn result_stop_rolls_back_goal_steps_receipts_revision_and_inbox_together(){
        let (store,pending,watch,payload)=launched();
        store.complete_background_submission(&pending,&payload).unwrap();
        let revision=store.goal_snapshot().unwrap().revision;
        let mut calls=0;
        assert!(store.receive_background_result_guarded(&watch,payload,None,&mut ||{calls+=1;calls==2}).is_err());
        assert_eq!(store.goal_snapshot().unwrap().revision,revision);
        assert!(!store.goal_snapshot().unwrap().goals[0].config.steps[0].done);
        let conn=store.lock_conn().unwrap();
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM automation_goal_step_receipts",[],|row|row.get::<_,i64>(0)).unwrap(),0);
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM automation_result_inbox",[],|row|row.get::<_,i64>(0)).unwrap(),0);
    }
    #[test]
    fn changed_requirements_and_unavailable_evidence_never_advance_the_original_goal(){
        for changed in [false,true] {
            let (store,pending,watch,mut payload)=launched();
            store.complete_background_submission(&pending,&payload).unwrap();
            if changed {
                let snapshot=store.goal_snapshot().unwrap();let mut config=snapshot.goals[0].config.clone();config.description="Different current requirement".into();
                store.goal_apply(GoalApplyInput{revision:snapshot.revision,request_id:Uuid::new_v4().to_string(),store_id:Some(snapshot.store_id.clone()),operation:GoalOperation::Update{id:"original".into(),config}}).unwrap();
            }else{payload["outcomes"]["branches"][0]["branch"]["criteria"]=serde_json::json!([{"kind":"unavailable","capability":"Actual absent input"}]);}
            store.receive_background_result(&watch,payload).unwrap();
            assert!(store.goal_snapshot().unwrap().goals[0].config.steps.iter().all(|step|!step.done));
        }
    }
    #[test]
    fn all_forty_unicode_goal_steps_fit_existing_source_routing_without_losing_requirements(){
        let plan=GoalConfig {title:"Maximum goal".into(),description:"Keep all requirements".into(),category:"custom".into(),parent_id:None,
            steps:(0..40).map(|index|GoalStep{id:format!("Step_{index}"),title:"🎯".repeat(160),done:false}).collect()};
        let frozen=FrozenGoalProgress{version:1,created_at:1,plan};
        let routing=frozen.routing(&Uuid::new_v4().to_string()).unwrap();
        assert!(routing.branches.len()<=16);
        let mut count=0;
        for branch in &routing.branches[..routing.branches.len()-1] {
            let titles:Vec<String>=serde_json::from_str(branch.requirement.split_once('\n').unwrap().1).unwrap();count+=titles.len();
            assert!(titles.iter().all(|title|title.chars().count()==160));
        }
        assert_eq!(count,40);assert_eq!(routing.branches.last().unwrap().depends_on.len(),routing.branches.len()-1);
    }
}
