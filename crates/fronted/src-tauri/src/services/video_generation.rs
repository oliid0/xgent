//! Original-account async jobs: native GET/download survives the sending phone.
use std::fs::File;
use std::io::{Seek,SeekFrom,Write};
use std::sync::{Arc,atomic::{AtomicBool,Ordering}};
use std::time::Duration;
use futures_util::{stream,StreamExt};
use reqwest::{Client,Url,header::{HeaderMap,HeaderName,HeaderValue}};
use serde_json::{Value,json};
use sha2::{Digest,Sha256};
use crate::services::automation::{AutomationStore,store::VideoInput};

pub(crate) fn client(provider:&Value) -> Result<(Client,HeaderMap),String> {
    let builder=if provider["useSystemProxy"]==true {super::system_proxy::async_client_builder()?} else {Client::builder().no_proxy()};
    let client=builder.retry(reqwest::retry::never()).redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(180)).build().map_err(|_|"Video HTTP client is unavailable")?;
    let mut headers=HeaderMap::new();
    for item in provider["customHeaders"].as_array().into_iter().flatten() {
        let name=item["key"].as_str().unwrap_or("");let value=item["value"].as_str().unwrap_or("");let lower=name.to_ascii_lowercase();
        if ["authorization","x-api-key","x-goog-api-key","anthropic-beta","host","content-length"].contains(&lower.as_str()) || lower.starts_with("x-xgent-") {continue;}
        if let (Ok(name),Ok(value))=(HeaderName::from_bytes(name.as_bytes()),HeaderValue::from_str(value)) {headers.insert(name,value);}
    }
    headers.insert(reqwest::header::AUTHORIZATION,HeaderValue::from_str(&format!("Bearer {}",provider["apiKey"].as_str().ok_or("Video account key is absent")?)).map_err(|_|"Invalid video account key")?);
    headers.insert(reqwest::header::CONTENT_TYPE,HeaderValue::from_static("application/json"));
    Ok((client,headers))
}
pub(crate) fn endpoint(job:Option<&str>,content:bool) -> Result<Url,String> {
    let mut url=Url::parse("https://openrouter.ai/api/v1/videos").map_err(|e|e.to_string())?;
    if let Some(job)=job {
        if job.trim().is_empty() || job.len()>256 || job.chars().any(char::is_control) || [".",".."].contains(&job) {return Err("Invalid original video job ID".into());}
        url.path_segments_mut().map_err(|_|"Video endpoint has no path")?.push(job);
    }
    if content {url.path_segments_mut().map_err(|_|"Video endpoint has no path")?.push("content");url.query_pairs_mut().append_pair("index","0");}
    Ok(url)
}
pub(crate) async fn json_response(response:reqwest::Response) -> Result<Value,String> {
    if !response.status().is_success() || response.content_length().is_some_and(|n|n>2*1024*1024) {return Err("Video service did not return bounded successful metadata".into());}
    let mut stream=response.bytes_stream();let mut bytes=Vec::new();
    while let Some(chunk)=stream.next().await {let chunk=chunk.map_err(|_|"Video metadata stream failed")?;
        if chunk.len()>(2*1024*1024usize).saturating_sub(bytes.len()) {return Err("Video metadata exceeds 2 MiB".into());}bytes.extend_from_slice(&chunk);}
    serde_json::from_slice(&bytes).map_err(|_|"Video service returned invalid JSON".into())
}
pub(crate) async fn catalog(provider:&Value)->Result<Vec<Value>,String> {
    let (client,headers)=client(provider)?;
    let value=json_response(client.get("https://openrouter.ai/api/v1/videos/models").headers(headers).send().await.map_err(|_|"Video model discovery failed")?).await?;
    let models=value["data"].as_array().filter(|items|items.len()<=4096).ok_or("Invalid bounded video model catalog")?;
    let mut result=Vec::new();let mut seen=std::collections::HashSet::new();
    for model in models {
        let Some(id)=model["id"].as_str().filter(|id|!id.is_empty() && id.len()<=512) else {return Err("Invalid video model identity".into());};
        if !provider["activeModels"].as_array().is_some_and(|ids|ids.iter().any(|configured|configured==id))
            || !provider["models"].as_array().is_some_and(|models|models.iter().any(|m|m["id"]==id)) {continue;}
        if !seen.insert(id.to_string()) {return Err("Video model catalog has duplicate configured identities".into());}
        if let Some(inputs)=model["architecture"]["input_modalities"].as_array() {if !inputs.iter().any(|input|input=="text") {continue;}}
        let durations=model["supported_durations"].as_array().filter(|values|values.len()<=64 && values.iter().all(|v|v.as_u64().is_some_and(|n|n>0 && n<=600))).ok_or("Invalid actual video duration capabilities")?;
        let strings=|key:&str|->Result<Vec<Value>,String>{model[key].as_array().filter(|values|values.len()<=64 && values.iter().all(|v|v.as_str().is_some_and(|s|!s.is_empty() && s.len()<=64))).cloned().ok_or_else(||format!("Invalid actual video {key} capabilities"))};
        result.push(json!({"id":id,"supportedDurations":durations,"supportedResolutions":strings("supported_resolutions")?,"supportedAspectRatios":strings("supported_aspect_ratios")?}));
    }
    Ok(result)
}
pub(crate) fn request_body(input:&VideoInput,models:&[Value])->Result<Value,String> {
    let matches:Vec<_>=models.iter().filter(|model|model["id"]==input.model).collect();
    if matches.len()!=1 {return Err("Selected model has no actual text-to-video capability on this account".into());}
    let model=matches[0];
    let mut body=json!({"model":input.model,"prompt":input.prompt});
    if let Some(duration)=input.duration {if !model["supportedDurations"].as_array().is_some_and(|values|values.iter().any(|v|v.as_u64()==Some(duration.into()))) {return Err("Unsupported actual video duration".into());}body["duration"]=json!(duration);}
    for (key,value,capability) in [("resolution",input.resolution.as_ref(),"supportedResolutions"),("aspect_ratio",input.aspect_ratio.as_ref(),"supportedAspectRatios")] {
        if let Some(value)=value {if !model[capability].as_array().is_some_and(|values|values.iter().any(|v|v==value)) {return Err(format!("Unsupported actual video {key}"));}body[key]=json!(value);}
    }
    Ok(body)
}

async fn content(client:&Client,mut headers:HeaderMap,job:&str)->Result<(File,u64,String),String> {
    headers.insert(reqwest::header::ACCEPT,HeaderValue::from_static("video/mp4"));
    let response=client.get(endpoint(Some(job),true)?).headers(headers).send().await.map_err(|_|"Original video content request failed")?;
    let advertised=response.content_length();
    if response.status()!=reqwest::StatusCode::OK || advertised.is_some_and(|n|n==0 || n>512*1024*1024)
        || response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v|v.to_str().ok()).and_then(|v|v.split(';').next())!=Some("video/mp4") {return Err("Video service did not return bounded MP4 content".into());}
    let mut file=tempfile::tempfile().map_err(|e|e.to_string())?;let mut stream=response.bytes_stream();let mut bytes=0u64;let mut hash=Sha256::new();let mut prefix=Vec::new();
    while let Some(chunk)=stream.next().await {let chunk=chunk.map_err(|_|"Original video content stream failed")?;
        bytes=bytes.checked_add(chunk.len() as u64).filter(|n|*n<=512*1024*1024).ok_or("Video content exceeds 512 MiB")?;
        let wanted=(32usize).saturating_sub(prefix.len()).min(chunk.len());prefix.extend_from_slice(&chunk[..wanted]);
        file.write_all(&chunk).map_err(|e|e.to_string())?;hash.update(&chunk);
    }
    if advertised.is_some_and(|n|n!=bytes) || prefix.len()<16 || &prefix[4..8]!=b"ftyp" {return Err("MP4 content failed its actual length/file-type checks".into());}
    let size=u32::from_be_bytes(prefix[..4].try_into().map_err(|_|"Invalid MP4 header")?) as u64;
    let extended=size==1;
    let size=if extended {if prefix.len()<24 {return Err("Truncated extended MP4 header".into());}u64::from_be_bytes(prefix[8..16].try_into().map_err(|_|"Invalid MP4 header")?)} else {size};
    if size<(if extended {24} else {16}) || size>bytes {return Err("Truncated MP4 file-type box".into());}
    file.sync_all().map_err(|e|e.to_string())?;file.seek(SeekFrom::Start(0)).map_err(|e|e.to_string())?;
    Ok((file,bytes,hex::encode(hash.finalize())))
}

async fn observe(app:tauri::AppHandle,store:Arc<AutomationStore>,id:String,call:String)->Result<(),String> {
    let owned=Arc::clone(&store);let device=app.clone();
    let probe=tauri::async_runtime::spawn_blocking(move||owned.prepare_video_probe(&id,&call,|conn,input|crate::commands::cron::background_configuration_on_connection(&device,conn,input))).await.map_err(|e|e.to_string())??;
    let (client,headers)=client(&probe.provider)?;
    let value=json_response(client.get(endpoint(Some(&probe.job),false)?).headers(headers.clone()).send().await.map_err(|_|"Original video polling request failed")?).await?;
    if value["id"]!=probe.job {return Err("Video status differs from its original job".into());}
    let status=value["status"].as_str().filter(|status|["pending","in_progress","completed","failed","cancelled","expired"].contains(status)).ok_or("Unknown original video status")?.to_string();
    let error=if ["failed","cancelled","expired"].contains(&status.as_str()) {Some(value["error"].as_str().unwrap_or("Original video did not complete").chars().take(512).collect::<String>())} else {None};
    let mut file=if status=="completed" {Some(content(&client,headers,&probe.job).await?)} else {None};
    // Current original configuration and probe are rechecked before retaining bytes.
    tauri::async_runtime::spawn_blocking(move||store.finish_video_probe(&probe,&status,error.as_deref(),file.as_mut().map(|(file,bytes,hash)|(file,*bytes,hash.as_str())),
        |conn,input|crate::commands::cron::background_configuration_on_connection(&app,conn,input))).await.map_err(|e|e.to_string())?
}
pub(crate) fn start(app:tauri::AppHandle,store:Arc<AutomationStore>,quitting:Arc<AtomicBool>) {
    tauri::async_runtime::spawn(async move {
        let mut ticks=tokio::time::interval(Duration::from_secs(15));ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            ticks.tick().await;if quitting.load(Ordering::Relaxed) {break;}
            let owned=Arc::clone(&store);
            if let Ok(Ok(jobs))=tauri::async_runtime::spawn_blocking(move||owned.due_videos()).await {
                stream::iter(jobs).map(|(id,call)| {
                    let app=app.clone();let store=Arc::clone(&store);
                    async move {if let Err(error)=observe(app,Arc::clone(&store),id.clone(),call.clone()).await {
                        let _=tauri::async_runtime::spawn_blocking(move||store.record_video_observation_error(&id,&call,&error)).await;
                    }}
                }).buffer_unordered(2).for_each(|_|async {}).await;
            }
            let owned=Arc::clone(&store);let device=app.clone();
            let _=tauri::async_runtime::spawn_blocking(move||owned.wake_terminal_videos(|conn,input|crate::commands::cron::background_configuration_on_connection(&device,conn,input))).await;
        }
    });
}
