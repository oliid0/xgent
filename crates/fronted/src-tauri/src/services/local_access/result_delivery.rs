use super::*;
use crate::services::automation::AutomationStore;
use crate::services::automation::store::result_reply_proof;
fn error_response(status:StatusCode,message:impl Into<String>)->Response {super::error_response(status,message.into())}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GrantArgs {
    request_id:String,
    receiver_host_id:String,
    source_host_id:String,
    token:String,
}

fn authorize_read(controller:&LocalAccessController)->Result<(),String>{
    let config=controller.config.lock().map_err(|_|"Local access policy unavailable".to_string())?;
    if !config.web_ui_enabled {return Err("Local access is disabled".into());}
    authorize_local_command("automation_background_get",&config)
}

pub(super) async fn issue_grant(controller:&Arc<LocalAccessController>,session:&DeviceSession,args:Value)->Response {
    if let Err(error)=authorize_read(controller){return error_response(StatusCode::FORBIDDEN,error);}
    let args:GrantArgs=match serde_json::from_value(args){Ok(args)=>args,Err(_)=>return error_response(StatusCode::BAD_REQUEST,"Invalid result grant fields")};
    let Some(store)=controller.app_handle.try_state::<Arc<AutomationStore>>() else {return error_response(StatusCode::SERVICE_UNAVAILABLE,"Result store unavailable");};
    let store=Arc::clone(store.inner());let device=session.device_id.clone();
    match tauri::async_runtime::spawn_blocking(move ||store.issue_result_read_grant(&device,&args.receiver_host_id,&args.source_host_id,&args.request_id,&args.token)).await {
        Ok(Ok(result))=>Json(json!({"ok":true,"result":result})).into_response(),
        _=>error_response(StatusCode::BAD_REQUEST,"Scoped result grant was not admitted"),
    }
}

/// Dedicated read-only route: read proofs are never valid for RPC, artifact
/// reads, credentials, device branches, task resumption or task cancellation.
pub(super) async fn read_result(State(controller):State<Arc<LocalAccessController>>,Path(request):Path<String>,headers:HeaderMap)->Response{
    if let Err(error)=controller.validate_request_origin(&headers){return error_response(StatusCode::FORBIDDEN,error);}
    if let Err(error)=authorize_read(&controller){return error_response(StatusCode::FORBIDDEN,error);}
    let header=|name:&str|headers.get(name).and_then(|value|value.to_str().ok()).map(ToOwned::to_owned);
    let (Some(receiver),Some(session),Some(nonce),Some(proof))=(header("x-xgent-receiver"),header("x-xgent-session"),header("x-xgent-result-nonce"),header("x-xgent-result-proof")) else {return error_response(StatusCode::UNAUTHORIZED,"Scoped result proof required");};
    let Some(store)=controller.app_handle.try_state::<Arc<AutomationStore>>() else {return error_response(StatusCode::SERVICE_UNAVAILABLE,"Result store unavailable");};
    let store=Arc::clone(store.inner());
    match tauri::async_runtime::spawn_blocking(move ||{
        let binding=store.result_read_grant(&request,&receiver,&session,&nonce,&proof)?;
        let snapshot=serde_json::to_value(store.background_task(&request)?).map_err(|e|e.to_string())?;
        // Revocation during a store read cannot return a fresh usable response.
        if store.result_read_grant(&request,&receiver,&session,&nonce,&proof)?!=binding{return Err("Result scope changed".to_string());}
        let body=serde_json::to_vec(&json!({"version":1,"receiverHostId":receiver,"sessionId":session,"snapshot":snapshot})).map_err(|e|e.to_string())?;
        let signature=result_reply_proof(&binding,&nonce,&body)?;
        Ok::<_,String>((body,signature))
    }).await {
        Ok(Ok((body,signature)))=>{
            if let Err(error)=authorize_read(&controller){return error_response(StatusCode::FORBIDDEN,error);}
            let mut response=body.into_response();
            response.headers_mut().insert(CONTENT_TYPE,HeaderValue::from_static("application/json"));
            let Ok(signature)=HeaderValue::from_str(&signature) else {return error_response(StatusCode::INTERNAL_SERVER_ERROR,"Result proof was not encoded");};
            response.headers_mut().insert("x-xgent-result-proof",signature);
            response.headers_mut().insert(CACHE_CONTROL,HeaderValue::from_static("no-store"));
            response
        },
        _=>error_response(StatusCode::UNAUTHORIZED,"Original result credential or task is unavailable"),
    }
}
