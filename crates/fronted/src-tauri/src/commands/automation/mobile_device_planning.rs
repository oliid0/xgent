//! SDK responses never originate in model/WebView arguments. Cache before RPC.
use std::sync::Arc;
use serde_json::{json,Value};
use crate::services::automation::AutomationStore;
use crate::services::worker_peers::WorkerPeerRegistry;
use super::submission::{invoke_owned_device_channel,read_owned_device_branches};

fn scope(app:&tauri::AppHandle,store:&AutomationStore,entry:&str,branch:&str)->Result<Value,String>{
    store.mobile_branch_read_authorization(entry,branch).map(|scope|super::mobile_branch_reads::available_health_authorization(app,scope))
}

#[tauri::command(rename_all="snake_case")]
pub async fn automation_mobile_branch_planning_exchange(app:tauri::AppHandle,entry_id:String,branch_id:String,
    store:tauri::State<'_,Arc<AutomationStore>>,registry:tauri::State<'_,Arc<WorkerPeerRegistry>>)->Result<(),String>{
    let store=Arc::clone(store.inner());let registry=Arc::clone(registry.inner());
    let handoff=read_owned_device_branches(&app,Arc::clone(&store),&registry,&entry_id).await?;
    if handoff["planningVersion"]!=1 || !handoff["branches"].as_array().is_some_and(|branches|branches.iter().any(|branch|branch["source"]["id"]==branch_id && branch["ready"]==true)) {return Err("Original controller has not released this planning branch".into());}
    let access=scope(&app,&store,&entry_id,&branch_id)?;
    let key=AutomationStore::device_planning_scope_key(&access)?;
    let (packet,_)=invoke_owned_device_channel(&app,Arc::clone(&store),&registry,&entry_id,"automation_background_device_planning_exchange",json!({"branch_id":branch_id,"scope":access})).await?;
    if packet["scopeKey"]!=key {return Err("Original controller changed the native read scope".into());}
    let calls=packet["calls"].as_array().filter(|calls|calls.len()<=4).ok_or("Invalid bounded original planning calls")?;
    for call in calls {
        let call_id=call["callId"].as_str().filter(|call|!call.is_empty() && call.len()<=256).ok_or("Missing original planning call identity")?;
        if AutomationStore::device_planning_scope_key(&scope(&app,&store,&entry_id,&branch_id)?)?!=key {return Err("Original phone read scope changed before planning work".into());}
        let cached=store.mobile_planning_receipt(&entry_id,&branch_id,call_id,&key,None)?;
        let result=if let Some(cached)=cached {cached} else {
            let observed=match call["kind"].as_str(){
                Some("request_read")=>{
                    let action=call["request"]["action"].as_str().ok_or("Missing native read action")?;
                    super::mobile_branch_reads::read_for_controller(app.clone(),entry_id.clone(),branch_id.clone(),action.into(),call["request"]["request"].clone(),Arc::clone(&store),Arc::clone(&registry)).await
                },
                Some("propose")=>{
                    let actions=serde_json::from_value(call["request"]["actions"].clone()).map_err(|e|format!("Invalid controller action proposal: {e}"))?;
                    match super::mobile_branch::prepare_on_client(app.clone(),entry_id.clone(),branch_id.clone(),actions,Arc::clone(&store),Arc::clone(&registry)).await {
                        Ok(_)=>Ok(json!({"accepted":true,"effectCompleted":false})),
                        Err(error)=>{
                            if store.read_mobile_branch_plan(&entry_id,&branch_id)?.is_some(){return Err(error);}
                            Err(error)
                        }
                    }
                },
                _=>return Err("Controller requested an unsupported phone planning operation".into()),
            };
            if AutomationStore::device_planning_scope_key(&scope(&app,&store,&entry_id,&branch_id)?)?!=key {return Err("Original phone read scope changed during planning work; late data was not released".into());}
            let result=match observed {Ok(data)=>json!({"data":data}),Err(error)=>json!({"error":error.chars().take(4096).collect::<String>()})};
            store.mobile_planning_receipt(&entry_id,&branch_id,call_id,&key,Some(result))?.ok_or("Native planning receipt was not retained")?
        };
        // Reopening after a lost reply sends this EXACT cached native result.
        if AutomationStore::device_planning_scope_key(&scope(&app,&store,&entry_id,&branch_id)?)?!=key {return Err("Read scope changed before native observation delivery".into());}
        invoke_owned_device_channel(&app,Arc::clone(&store),&registry,&entry_id,"automation_background_device_planning_exchange",json!({"branch_id":branch_id,"scope":access,"response":{"callId":call_id,"scopeKey":key,"result":result}})).await?;
    }
    Ok(())
}
