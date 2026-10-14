use std::collections::HashMap;
use std::fs::File;
use std::io::{Seek,SeekFrom,Write};
use std::sync::{Arc,Mutex};
use std::time::{Duration,Instant};
use base64::{engine::general_purpose::STANDARD,Engine};
use sha2::{Digest,Sha256};
use tauri::Manager;
use crate::services::automation::{AutomationStore,BackgroundArtifact,BackgroundArtifactChunk};
use crate::services::worker_peers::WorkerPeerRegistry;

struct Prepared {window:String,entry:String,artifact:BackgroundArtifact,workdir:String,path:String,file:File,expires:Instant}
#[derive(Default)]
struct Transfers(Mutex<HashMap<String,Option<Prepared>>>);
fn transfers(app:&tauri::AppHandle) -> tauri::State<'_,Transfers> {
    if app.try_state::<Transfers>().is_none() && app.manage(Transfers::default()) {
        let app=app.clone();tauri::async_runtime::spawn(async move {
            let mut ticks=tokio::time::interval(Duration::from_secs(30));
            ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {ticks.tick().await;let state=app.state::<Transfers>();
                if let Ok(mut entries)=state.0.lock() {prune(&mut entries);};}
        });
    }
    app.state::<Transfers>()
}
fn prune(entries:&mut HashMap<String,Option<Prepared>>) {
    entries.retain(|_,value|value.as_ref().is_none_or(|prepared|prepared.expires>Instant::now()));
}

/// Verified anonymous staging; no target file and no encoded data in WebView.
pub(crate) async fn receive_file(store:Arc<AutomationStore>,registry:&WorkerPeerRegistry,
    peer:&str,request:&str,expected:&BackgroundArtifact) -> Result<File,String> {
    if expected.bytes>512*1024*1024 {return Err("Artifact exceeds 512 MiB".into());}
    let mut file=tempfile::tempfile().map_err(|e|e.to_string())?;let mut offset=0u64;let mut hash=Sha256::new();
    while offset<expected.bytes {
        let args=serde_json::json!({"request_id":request,"artifact_id":expected.id,"offset":offset,"length":262144});
        let value=if peer==store.background_worker_identity()? {
            let owned=Arc::clone(&store);let request=request.to_string();let artifact=expected.id.clone();
            tauri::async_runtime::spawn_blocking(move||owned.read_background_artifact_chunk(&request,&artifact,offset,262144))
                .await.map_err(|e|e.to_string())?.and_then(|value|serde_json::to_value(value).map_err(|e|e.to_string()))?
        } else {registry.invoke(peer,"automation_background_read_artifact_chunk",args).await?};
        let chunk:BackgroundArtifactChunk=serde_json::from_value(value).map_err(|e|e.to_string())?;
        let length=(expected.bytes-offset).min(262144) as usize;
        if serde_json::to_value(&chunk.artifact).map_err(|e|e.to_string())?!=serde_json::to_value(expected).map_err(|e|e.to_string())?
            || chunk.offset!=offset || chunk.content_base64.len()>349528 {return Err("Artifact stream left its original manifest/cursor".into());}
        let bytes=STANDARD.decode(&chunk.content_base64).map_err(|e|e.to_string())?;
        let next=offset+bytes.len() as u64;
        if bytes.len()!=length || chunk.chunk_hash!=hex::encode(Sha256::digest(&bytes))
            || chunk.next_offset!=if next<expected.bytes {Some(next)} else {None} {
            return Err("Artifact chunk failed range/hash/progress verification".into());
        }
        file.write_all(&bytes).map_err(|e|e.to_string())?;hash.update(&bytes);offset=next;
    }
    if hex::encode(hash.finalize())!=expected.content_hash {return Err("Artifact stream failed whole-file hash verification".into());}
    file.seek(SeekFrom::Start(0)).map_err(|e|e.to_string())?;Ok(file)
}

#[tauri::command(rename_all="snake_case")]
pub async fn automation_result_artifact_prepare(window:tauri::WebviewWindow,app:tauri::AppHandle,
    entry_id:String,artifact_id:String,workdir:String,store:tauri::State<'_,Arc<AutomationStore>>,
    registry:tauri::State<'_,Arc<WorkerPeerRegistry>>) -> Result<serde_json::Value,String> {
    if workdir.trim().is_empty() || workdir.len()>32767 {return Err("Original local download workspace is required".into());}
    let owned=Arc::clone(store.inner());let entry=entry_id.clone();let artifact=artifact_id.clone();
    let (watch,expected)=tauri::async_runtime::spawn_blocking(move||owned.background_inbox_artifact_source(&entry,&artifact))
        .await.map_err(|e|e.to_string())??;
    let expected:BackgroundArtifact=serde_json::from_value(expected).map_err(|e|e.to_string())?;
    let id=uuid::Uuid::new_v4().to_string();
    {let state=transfers(&app);let mut entries=state.0.lock().map_err(|_|"Artifact staging lock poisoned")?;
        // Pending downloads reserve capacity too; completed expired files drop.
        entries.retain(|_,value|value.as_ref().is_none_or(|prepared|prepared.expires>Instant::now()));
        if entries.len()>=4 {return Err("Four original artifact downloads are already retained".into());}entries.insert(id.clone(),None);}
    let received=receive_file(Arc::clone(store.inner()),registry.inner(),&watch.source_host_id,&watch.request_id,&expected).await;
    let file=match received {Ok(file)=>file,Err(error)=>{transfers(&app).0.lock().map_err(|_|"Artifact staging lock poisoned")?.remove(&id);return Err(error);}};
    let path=format!("background-results/{}/{}/{}",watch.request_id,expected.id,expected.relative_path);
    let prepared=Prepared {window:window.label().into(),entry:entry_id,artifact:expected.clone(),workdir,path,file,expires:Instant::now()+Duration::from_secs(900)};
    let state=transfers(&app);let mut entries=state.0.lock().map_err(|_|"Artifact staging lock poisoned")?;
    entries.insert(id.clone(),Some(prepared));
    Ok(serde_json::json!({"transferId":id,"artifact":expected}))
}

#[tauri::command(rename_all="snake_case")]
pub async fn automation_result_artifact_abort(window:tauri::WebviewWindow,app:tauri::AppHandle,transfer_id:String) -> Result<(),String> {
    let state=transfers(&app);let mut entries=state.0.lock().map_err(|_|"Artifact staging lock poisoned")?;
    if entries.get(&transfer_id).and_then(Option::as_ref).is_some_and(|prepared|prepared.window==window.label()) {entries.remove(&transfer_id);}
    Ok(())
}

#[tauri::command(rename_all="snake_case")]
pub async fn automation_result_chat_artifact(window:tauri::WebviewWindow,conversation_id:String,request_id:String,
    entry_id:String,artifact_id:String,workdir:String,store:tauri::State<'_,Arc<AutomationStore>>)->Result<serde_json::Value,String>{
    if window.label()!="main"{return Err("Original chat artifacts belong to the main native client".into())}
    let store=Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move||{
        let result=store.background_chat_result(&request_id)?.ok_or("Original received chat task is unavailable")?;
        if result["conversationId"]!=conversation_id{return Err("Artifact does not belong to this conversation".into())}
        let (_,manifest)=store.background_inbox_artifact_source(&entry_id,&artifact_id)?;
        let artifact:BackgroundArtifact=serde_json::from_value(manifest).map_err(|e|e.to_string())?;
        let mut conn=crate::commands::history_db::open_connection()?;
        let tx=conn.transaction().map_err(|e|e.to_string())?;
        crate::commands::chat_history::validate_background_chat_artifact_sync(&tx,&result,&entry_id)?;
        tx.commit().map_err(|e|e.to_string())?;
        let path=format!("background-results/{}/{}/{}",request_id,artifact.id,artifact.relative_path);
        let saved=crate::commands::fs::verified_artifact_copy(&workdir,&path,artifact.bytes,&artifact.content_hash)?;
        Ok(serde_json::json!({"artifact":artifact,"saved":saved,"receiverHostId":result["receiverHostId"],"sourceHostId":result["sourceHostId"],"entryId":entry_id,"snapshotHash":result["snapshotHash"]}))
    }).await.map_err(|e|e.to_string())?
}

#[tauri::command(rename_all="snake_case")]
pub async fn automation_result_artifact_commit(window:tauri::WebviewWindow,app:tauri::AppHandle,transfer_id:String,
    store:tauri::State<'_,Arc<AutomationStore>>) -> Result<crate::commands::fs::WriteBinaryResponse,String> {
    let mut prepared={let state=transfers(&app);let mut entries=state.0.lock().map_err(|_|"Artifact staging lock poisoned")?;prune(&mut entries);
        if entries.get(&transfer_id).and_then(Option::as_ref).is_none_or(|prepared|prepared.window!=window.label()) {return Err("Artifact transfer left its original native window".into());}
        entries.remove(&transfer_id).flatten().ok_or("Artifact transfer is not prepared")?};
    let store=Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move|| {
        let (_,expected)=store.background_inbox_artifact_source(&prepared.entry,&prepared.artifact.id)?;
        if expected!=serde_json::to_value(&prepared.artifact).map_err(|e|e.to_string())? {return Err("Prepared artifact lost its original receipt".into());}
        prepared.file.seek(SeekFrom::Start(0)).map_err(|e|e.to_string())?;
        crate::commands::fs::create_streamed_artifact_copy(&prepared.workdir,&prepared.path,&mut prepared.file,prepared.artifact.bytes,&prepared.artifact.content_hash)
    }).await.map_err(|e|e.to_string())?
}
