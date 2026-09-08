//! Xgent native computer use. The optional platform component is installed in
//! app data, keeping accessibility/capture dependencies out of the main package.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{Emitter, Manager};
use crate::runtime::shell_runner::ShellRunRegistry;

#[path = "cua_component.rs"]
pub mod component;

const OPERATIONS: &[&str] = &["list_apps", "launch_app", "get_app_state", "click", "perform_secondary_action", "scroll", "drag", "type_text", "press_key", "set_value", "sequence"];

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CuaResponse {
    content: Vec<Value>,
    #[serde(default)] is_error: bool,
    #[serde(default)] details: Value,
}
impl CuaResponse {
    fn error(message: impl Into<String>) -> Self {
        Self { content: vec![json!({"type":"text","text":message.into()})], is_error:true, details:Value::Null }
    }
}

fn validate(operation: &str, input: &Value) -> Result<(), String> {
    if !OPERATIONS.contains(&operation) { return Err(format!("Unknown CUA operation: {operation}")); }
    if !input.is_object() { return Err("CUA arguments must be an object".into()); }
    if operation == "list_apps" { return Ok(()); }
    let app = input["app"].as_str().unwrap_or("").trim();
    if app.is_empty() { return Err("Missing required argument: app".into()); }
    if let Some(mode) = input.get("observation") {
        if !["auto","text","image"].contains(&mode.as_str().unwrap_or("")) { return Err("Unknown observation mode".into()); }
    }
    for (key, min, max) in [("max_image_size",320,1920),("settle_ms",0,1000)] {
        if input.get(key).is_some_and(|value| value.as_u64().is_none_or(|value| value < min || value > max)) { return Err(format!("Invalid {key}")); }
    }
    if operation == "sequence" {
        let steps = input["steps"].as_array().ok_or("sequence requires steps")?;
        if steps.is_empty() || steps.len() > 20 { return Err("sequence requires 1-20 steps".into()); }
        for (index, step) in steps.iter().enumerate() {
            let mut arguments = step.as_object().ok_or("Each step must be an object")?.clone();
            let operation = arguments.remove("operation").and_then(|value|value.as_str().map(str::to_string)).ok_or("Each step requires operation")?;
            if !["click","scroll","drag","type_text","press_key","set_value"].contains(&operation.as_str()) { return Err("Unsupported sequence step".into()); }
            if index > 0 && arguments.contains_key("element_index") { return Err("Element indices belong to a single observation. Split indexed actions into separate calls; use sequences for known keyboard/coordinate gestures.".into()); }
            arguments.insert("app".into(),json!(app));
            validate(&operation,&Value::Object(arguments))?;
        }
        return Ok(());
    }
    if ["xgent", "xgent.exe", "com.ohi.xgent", &std::process::id().to_string()]
        .contains(&app.to_lowercase().as_str()) {
        return Err("Choose a target application other than Xgent".into());
    }
    let required: &[&str] = match operation {
        "perform_secondary_action" => &["element_index", "action"],
        "scroll" => &["direction"],
        "set_value" => &["element_index", "value"],
        "type_text" => &["text"], "press_key" => &["key"], _ => &[],
    };
    for key in required {
        if input.get(*key).is_none_or(|value| value.is_null()) {
            return Err(format!("Missing required argument: {key}"));
        }
    }
    let coordinates: &[&str] = if operation == "drag" { &["from_x", "from_y", "to_x", "to_y"] }
        else if operation == "click" && input.get("element_index").is_none() { &["x", "y"] }
        else { &[] };
    for key in coordinates {
        if input[*key].as_f64().is_none_or(|value| !value.is_finite()) {
            return Err(format!("{key} must be a finite number"));
        }
    }
    if operation == "scroll" && !["up", "down", "left", "right"].contains(&input["direction"].as_str().unwrap_or("")) {
        return Err("direction must be up, down, left or right".into());
    }
    for key in ["pages", "click_count", "max_tree_nodes", "max_tree_depth"] {
        if let Some(value) = input.get(key) {
            if value.as_f64().is_none_or(|number| number <= 0.0 || !number.is_finite()) {
                return Err(format!("{key} must be positive"));
            }
        }
    }
    for (key,maximum) in [("pages",20.0),("click_count",3.0),("max_tree_nodes",2000.0),("max_tree_depth",64.0)] {
        if input[key].as_f64().is_some_and(|number|number>maximum || (key!="pages" && number.fract()!=0.0)) {
            return Err(format!("{key} is outside the supported range"));
        }
    }
    for key in ["x","y","from_x","from_y","to_x","to_y"] {
        if input.get(key).is_some_and(|value|value.as_f64().is_none_or(|number|!number.is_finite() || number.abs()>1_000_000.0)) {
            return Err(format!("Invalid coordinate: {key}"));
        }
    }
    if let Some(modifiers)=input.get("modifiers") {
        let modifiers=modifiers.as_array().ok_or("modifiers must be an array")?;
        if modifiers.len()>4 || modifiers.iter().any(|key|!["Shift","Control","Alt","Meta"].contains(&key.as_str().unwrap_or(""))) {
            return Err("Unsupported modifier key".into());
        }
    }
    Ok(())
}


#[tauri::command(rename_all = "snake_case")]
pub async fn cua_call(app: tauri::AppHandle, operation: String, arguments: Value, run_id: String) -> Result<CuaResponse, String> {
    if let Err(error)=validate(&operation,&arguments) { return Ok(CuaResponse::error(error)); }
    let registry=app.state::<Arc<ShellRunRegistry>>().inner().clone();
    let token=registry.register(&run_id);
    let run_token=token.clone();
    let activity_run_id=run_id.clone();
    let result=tauri::async_runtime::spawn_blocking(move || {
        static EXECUTION: OnceLock<Mutex<()>>=OnceLock::new();
        let _guard=EXECUTION.get_or_init(Mutex::default).lock().map_err(|_|"Computer-use state lock poisoned".to_string())?;
        if run_token.is_cancelled() { return Err("Cancelled".into()); }
        let module=component::ensure_installed(&app)?;
        if run_token.is_cancelled() { return Err("Cancelled".into()); }
        if operation != "sequence" { return component::call(&module,&operation,&arguments); }
        let mut current = component::call(&module,"get_cached_state",&arguments)?;
        let state_id = |response:&CuaResponse| -> Option<String> {
            response.details["stateId"].as_str().map(str::to_string).or_else(|| response.content.iter()
                .filter_map(|item|item["text"].as_str()).flat_map(str::lines)
                .find_map(|line|line.strip_prefix("state_id: ").map(|value|value.trim().to_string())))
        };
        if current.is_error || state_id(&current).as_deref() != arguments["state_id"].as_str() {
            let mut fresh = component::call(&module,"get_app_state",&arguments)?;
            fresh.content.insert(0,json!({"type":"text","text":"ACTION NOT APPLIED: stale sequence state. Inspect this observation."}));
            return Ok(fresh);
        }
        let steps=arguments["steps"].as_array().ok_or("Missing steps")?;
        let mut completed=0usize;
        let started=std::time::Instant::now();
        for step in steps {
            if run_token.is_cancelled() || started.elapsed() > std::time::Duration::from_secs(30) {
                current.is_error=true;
                current.content.insert(0,json!({"type":"text","text":"Sequence stopped before the next step: cancelled or deadline exceeded."}));
                break;
            }
            if let Some(expected)=step["expected_text"].as_str() {
                let text=current.content.iter().filter_map(|item|item["text"].as_str()).collect::<Vec<_>>().join("\n").to_lowercase();
                if !text.contains(&expected.to_lowercase()) {
                    current.is_error=true;
                    current.content.insert(0,json!({"type":"text","text":format!("Sequence stopped: expected text {expected:?} is absent. No next action was applied.")}));
                    break;
                }
            }
            let mut input=arguments.as_object().ok_or("Invalid sequence arguments")?.clone();
            input.remove("steps");
            input.extend(step.as_object().ok_or("Invalid step")?.clone());
            input.insert("state_id".into(),json!(state_id(&current).ok_or("No state returned after the previous step")?));
            let action=input.remove("operation").ok_or("Missing step operation")?;
            let next=component::call(&module,action.as_str().ok_or("Invalid operation")?,&Value::Object(input));
            match next { Ok(response)=>current=response, Err(error)=>{current=CuaResponse::error(format!("Action outcome uncertain: {error}. Observe before retrying."));break;} }
            let _ = app.emit("cua-activity", json!({"runId":activity_run_id,"step":completed,"operation":action,"response":&current}));
            if current.is_error || current.content.iter().any(|item|item["text"].as_str().is_some_and(|text|text.contains("ACTION NOT APPLIED"))) { break; }
            completed+=1;
        }
        current.content.insert(0,json!({"type":"text","text":format!("Sequence dispatched {completed}/{} steps. Verify the final app state before continuing.",steps.len())}));
        current.details=json!({"completedSteps":completed,"totalSteps":steps.len(),"elapsedMs":started.elapsed().as_millis(),"stateId":state_id(&current)});
        Ok(current)
    }).await;
    // The native call retains serialization until it returns, even if the
    // frontend was cancelled, so an interrupted action cannot overlap a new one.
    registry.unregister(&run_id,&token);
    Ok(match result {
        Ok(Ok(response))=>response, Ok(Err(error))=>CuaResponse::error(error),
        Err(error)=>CuaResponse::error(format!("Computer-use task failed: {error}")),
    })
}
