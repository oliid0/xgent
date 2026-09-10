use base64::{engine::general_purpose::STANDARD, Engine};
use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Cursor;
use std::time::Duration;
use xcap::Window;

#[cfg(target_os = "windows")]
#[path = "windows.rs"]
mod platform;
#[cfg(target_os = "linux")]
#[path = "linux.rs"]
mod platform;

#[derive(Clone)]
struct Snapshot {
    id: u64,
    window_id: u32,
    pid: u32,
    bounds: (i32, i32, u32, u32),
    image_size: (u32, u32),
    elements: Vec<Value>,
    text: String,
}

#[derive(Default)]
pub struct Desktop {
    snapshots: HashMap<String, Snapshot>,
    next_id: u64,
    observation: String,
    max_image_size: u32,
    settle_ms: u64,
}

fn fail(error: impl ToString) -> String { error.to_string() }

fn windows() -> Result<Vec<Window>, String> {
    Window::all().map(|windows| windows.into_iter().filter(|window|
        window.pid().ok() != Some(std::process::id()) && window.width().unwrap_or(0) > 0
            && window.height().unwrap_or(0) > 0).collect()).map_err(fail)
}

fn normalized_app_name(query: &str) -> String {
    let name = query.trim().to_lowercase();
    match name.as_str() {
        "\u{8bb0}\u{4e8b}\u{672c}" | "notepad.exe" => "notepad".into(),
        "\u{4fbf}\u{7b7e}" | "\u{5907}\u{5fd8}\u{5f55}" | "sticky notes" => "microsoft notes".into(),
        _ => name.trim_end_matches(".exe").to_string(),
    }
}

#[cfg(target_os = "windows")]
fn installed_apps() -> Result<Vec<Value>, String> {
    use std::os::windows::process::CommandExt;
    let output = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); @(Get-StartApps) | ConvertTo-Json -Compress"])
        .creation_flags(0x08000000).output().map_err(fail)?;
    if !output.status.success() { return Err(String::from_utf8_lossy(&output.stderr).into_owned()); }
    let value: Value = serde_json::from_slice(&output.stdout).map_err(fail)?;
    Ok(match value { Value::Array(items) => items, Value::Object(_) => vec![value], _ => Vec::new() })
}

#[cfg(target_os = "windows")]
fn launch_app(query: &str) -> Result<String, String> {
    let name = normalized_app_name(query);
    let matches: Vec<_> = installed_apps()?.into_iter().filter(|item|
        item["AppID"].as_str().is_some_and(|id| id.eq_ignore_ascii_case(query))
        || item["Name"].as_str().is_some_and(|label| normalized_app_name(label) == name)).collect();
    if matches.len() != 1 { return Err("Choose an unambiguous installed AppID from list_apps; the app may be installed under a different name.".into()); }
    let id = matches[0]["AppID"].as_str().ok_or("Installed app has no AppID")?;
    std::process::Command::new("explorer.exe").arg(format!("shell:AppsFolder\\{id}")).spawn().map_err(fail)?;
    Ok(matches[0]["Name"].as_str().unwrap_or(query).to_string())
}

fn resolve_window(query: &str) -> Result<Window, String> {
    let query = query.trim();
    let windows = windows()?;
    let candidates: Vec<_> = windows.iter().filter(|window|
        format!("window:{}", window.id().unwrap_or(0)).eq_ignore_ascii_case(query)
        || normalized_app_name(&window.app_name().unwrap_or_default()) == normalized_app_name(query)
        || window.title().unwrap_or_default().to_lowercase().contains(&normalized_app_name(query))
        || window.pid().ok().map(|pid| pid.to_string()).as_deref() == Some(query)).collect();
    if candidates.len() == 1 { return Ok(candidates[0].clone()); }
    Err(if candidates.is_empty() { format!("No visible window matches {query:?}. Use list_apps, launch or restore the app, then get_app_state.") }
        else { "Several windows match this app. Use the window:<id> identifier from list_apps.".into() })
}

fn bounds(window: &Window) -> Result<(i32, i32, u32, u32), String> {
    Ok((window.x().map_err(fail)?, window.y().map_err(fail)?, window.width().map_err(fail)?, window.height().map_err(fail)?))
}

fn capture_window(window: &Window) -> Result<image::RgbaImage, String> {
    #[cfg(target_os = "windows")]
    if window.is_focused().map_err(fail)? {
        // PrintWindow omits owned menu/popover surfaces. For the foreground
        // app, capture its actual screen region in the same physical-pixel
        // bounds used by input, including intersections on multiple monitors.
        let rect = bounds(window)?;
        let (x, y, width, height) = (i64::from(rect.0), i64::from(rect.1), rect.2, rect.3);
        if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 64_000_000 {
            return Err("Window capture dimensions are empty or too large".into());
        }
        let mut composite = image::RgbaImage::new(width, height);
        let mut captured = false;
        for monitor in xcap::Monitor::all().map_err(fail)? {
            let mx = i64::from(monitor.x().map_err(fail)?);
            let my = i64::from(monitor.y().map_err(fail)?);
            let left = x.max(mx);
            let top = y.max(my);
            let right = (x + i64::from(width)).min(mx + i64::from(monitor.width().map_err(fail)?));
            let bottom = (y + i64::from(height)).min(my + i64::from(monitor.height().map_err(fail)?));
            if right <= left || bottom <= top { continue; }
            let tile = monitor.capture_region((left-mx) as u32, (top-my) as u32,
                (right-left) as u32, (bottom-top) as u32).map_err(fail)?;
            image::imageops::replace(&mut composite, &tile, left-x, top-y);
            captured = true;
        }
        if !captured { return Err("Window is outside the visible desktop".into()); }
        if !window.is_focused().map_err(fail)? || bounds(window)? != rect {
            return Err("Window focus or geometry changed during capture; observe again".into());
        }
        return Ok(composite);
    }
    window.capture_image().map_err(fail)
}

// Monitoring must not consume an agent state token, focus a window, enumerate
// accessibility nodes, or wait behind a long input sequence.
pub fn capture_preview(arguments: &Value) -> Result<Value, String> {
    let window = resolve_window(arguments["app"].as_str().ok_or("Missing preview target")?)?;
    if window.is_minimized().map_err(fail)? { return Err("The app is minimized; restore it to resume the live preview.".into()); }
    let captured = capture_window(&window)?;
    if captured.width() == 0 || captured.height() == 0 { return Err("Preview capture was empty".into()); }
    let max_size = arguments["max_image_size"].as_u64().unwrap_or(768).clamp(320,1280) as u32;
    let image = image::DynamicImage::ImageRgba8(captured).thumbnail(max_size, max_size);
    let mut encoded = Cursor::new(Vec::new());
    image.write_to(&mut encoded, image::ImageFormat::Png).map_err(fail)?;
    Ok(json!({"content":[{"type":"image","data":STANDARD.encode(encoded.into_inner()),"mimeType":"image/png"}],"isError":false}))
}

impl Desktop {
    fn rejected_state(&mut self, window: &Window, query: &str, note: &str) -> Result<Value, String> {
        let mut response = self.snapshot(window, query, note)?;
        response["isError"] = json!(true);
        response["details"]["actionApplied"] = json!(false);
        Ok(response)
    }
    fn after_input(&mut self, window: &Window, query: &str, previous: &Snapshot, defer: bool) -> Result<Value,String> {
        if !defer { return self.snapshot(window, query, "Input dispatched. Verify the returned state before continuing."); }
        // Only the native sequence coordinator requests this between known
        // coordinate/keyboard gestures. Bounds and process identity are still
        // checked on the next action; no stale accessibility index is reused.
        self.next_id += 1;
        let mut state=previous.clone();
        state.id=self.next_id;
        state.elements.clear();
        state.text="Input dispatched; observation deferred until the sequence boundary.".into();
        for key in [query.to_lowercase(),format!("window:{}",state.window_id)] { self.snapshots.insert(key,state.clone()); }
        Ok(json!({"content":[{"type":"text","text":state.text}],"isError":false,"details":{"stateId":state.id.to_string(),"observationDeferred":true}}))
    }
    fn snapshot(&mut self, window: &Window, query: &str, note: &str) -> Result<Value, String> {
        let started = std::time::Instant::now();
        let mut capture = self.observation != "text";
        let mut capture_note=String::new();
        if capture && window.is_minimized().map_err(fail)? {
            if self.observation == "image" { return Err("The app is minimized. Request get_app_state with focus=true to restore it before capturing.".into()); }
            capture=false;
            capture_note="\nThe app is minimized; accessibility observation is available. Request focus=true to restore it before using screenshot coordinates.".into();
        }
        let mut image = if capture {
            match capture_window(window) {
                Ok(image) => image,
                Err(error) if self.observation == "auto" => {
                    capture=false;
                    capture_note=format!("\nScreenshot unavailable ({error}); accessibility observation is still available. Request focus=true to restore a minimized window, or observation=text for background semantic work.");
                    image::RgbaImage::new(0,0)
                },
                Err(error) => return Err(format!("Cannot capture app window: {error}. Use observation=text for accessibility or explicitly restore the window with focus=true.")),
            }
        } else { image::RgbaImage::new(0, 0) };
        if capture && (image.width() == 0 || image.height() == 0) { return Err("Window capture was empty".into()); }
        let rect = bounds(window)?;
        if image.width().max(image.height()) > self.max_image_size {
            let scale = self.max_image_size as f64 / image.width().max(image.height()) as f64;
            image = image::imageops::resize(&image, (image.width() as f64 * scale).round() as u32,
                (image.height() as f64 * scale).round() as u32, image::imageops::FilterType::Triangle);
        }
        let capture_ms = started.elapsed().as_millis();
        self.next_id += 1;
        let (elements, accessibility_note) = if self.observation == "image" { (Vec::new(), "Screenshot-only observation; accessibility traversal skipped.".into()) }
            else { platform::elements(window) };
        let accessibility_ms = started.elapsed().as_millis().saturating_sub(capture_ms);
        let mut snapshot = Snapshot { id: self.next_id, window_id: window.id().map_err(fail)?, pid: window.pid().map_err(fail)?,
            bounds: rect, image_size: image.dimensions(), elements, text: String::new() };
        let mut text = format!("{note}\nApp: {}\nWindow: {}\nTarget: window:{}\nstate_id: {}\nScreenshot: {} x {}. Coordinates are relative to the top-left of this screenshot.\n{}",
            window.app_name().unwrap_or_default(), window.title().unwrap_or_default(), snapshot.window_id,
            snapshot.id, image.width(), image.height(), accessibility_note);
        for (index, element) in snapshot.elements.iter().enumerate() {
            text.push_str(&format!("\n[{index}] {}", element["label"].as_str().unwrap_or("")));
        }
        text.push_str(&capture_note);
        text.push_str("\nBackground: accessibility actions do not activate the window. Keyboard/pointer fallback requires foreground; set allow_foreground=false to prevent it.");
        if !capture { text.push_str("\nNo screenshot was captured. Use element_index for actions, or observe with observation=auto/image before using coordinates."); }
        snapshot.text = text.clone();
        let mut content = vec![json!({"type":"text","text":text})];
        if capture {
            let mut encoded = Cursor::new(Vec::new());
            image.write_to(&mut encoded, image::ImageFormat::Png).map_err(fail)?;
            content.push(json!({"type":"image","data":STANDARD.encode(encoded.into_inner()),"mimeType":"image/png"}));
        }
        let details = json!({"stateId":snapshot.id.to_string(),"windowId":snapshot.window_id,
            "observationMs":started.elapsed().as_millis(),"captureMs":capture_ms,"accessibilityMs":accessibility_ms,
            "pid":snapshot.pid,"coordinateSpace":"screenshot","width":image.width(),"height":image.height()});
        for key in [query.to_lowercase(), format!("window:{}", snapshot.window_id)] { self.snapshots.insert(key, snapshot.clone()); }
        self.snapshots.retain(|_, snapshot| self.next_id.saturating_sub(snapshot.id) < 128);
        Ok(json!({"content":content,"isError":false,"details":details}))
    }

    pub fn call(&mut self, operation: &str, arguments: &Value, cancelled: &dyn Fn() -> bool) -> Result<Value, String> {
        self.observation = arguments["observation"].as_str().unwrap_or("auto").to_string();
        self.max_image_size = arguments["max_image_size"].as_u64().unwrap_or(1280).clamp(320,1920) as u32;
        self.settle_ms = arguments["settle_ms"].as_u64().unwrap_or(80).min(1000);
        if operation == "status" { return Ok(json!({"content":[],"isError":false,"details":{"abi":1,"platform":std::env::consts::OS}})); }
        if operation == "list_apps" {
            let mut apps: Vec<_> = windows()?.iter().map(|window| json!({"app":window.app_name().unwrap_or_default(),
                "target":format!("window:{}",window.id().unwrap_or(0)),"pid":window.pid().unwrap_or(0),
                "title":window.title().unwrap_or_default(),"minimized":window.is_minimized().unwrap_or(false)})).collect();
            #[cfg(target_os = "windows")]
            match installed_apps() {
                Ok(installed) => apps.extend(installed.into_iter().map(|item| json!({"app":item["Name"],"app_id":item["AppID"],"installed":true,"hint":"Use launch_app with app_id, then list_apps to find its window target."}))),
                Err(error) => apps.push(json!({"catalog_error":error,"hint":"This is only the open-window list; absence does not mean an app is uninstalled."})),
            }
            return Ok(json!({"content":[{"type":"text","text":serde_json::to_string_pretty(&apps).map_err(fail)?}],"isError":false}));
        }
        let query = arguments["app"].as_str().filter(|app| !app.trim().is_empty()).ok_or("Missing app")?;
        #[cfg(target_os = "windows")]
        if operation == "launch_app" {
            let app_name = launch_app(query)?;
            // Get-StartApps is the launch catalog; wait for its real window
            // instead of making the model race Explorer's asynchronous launch.
            for _ in 0..50 {
                if cancelled() { return Err("Launch requested, but observation cancelled. Inspect before retrying.".into()); }
                if let Ok(window) = resolve_window(&app_name) {
                    if !window.is_minimized().unwrap_or(true) {
                        return self.snapshot(&window, query, "Application window is available. Inspect this state before acting.");
                    }
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            return Err("Launch requested but no unambiguous window appeared within 5 seconds. Use list_apps before retrying; do not launch again blindly.".into());
        }
        if operation == "get_cached_state" {
            let state = self.snapshots.get(&query.to_lowercase()).ok_or("Call get_app_state before a sequence")?;
            return Ok(json!({"content":[{"type":"text","text":state.text}],"isError":false,"details":{"stateId":state.id.to_string()}}));
        }
        let window = resolve_window(query)?;
        if operation == "_target_is_focused" {
            return Ok(json!({"content":[{"type":"text","text":window.is_focused().map_err(fail)?.to_string()}],"isError":false}));
        }
        if operation == "get_app_state" {
            if arguments["focus"].as_bool() == Some(true) { platform::focus(&window)?; }
            return self.snapshot(&window, query, "Current app state. Inspect before acting.");
        }
        let previous = self.snapshots.get(&query.to_lowercase()).cloned().ok_or("Call get_app_state before an action")?;
        let state_id = arguments["state_id"].as_str().unwrap_or("");
        if state_id != previous.id.to_string() {
            return self.rejected_state(&window, query, "ACTION NOT APPLIED: state_id is missing or stale. Inspect this state and use its state_id for the next action.");
        }
        if previous.window_id != window.id().map_err(fail)? || previous.pid != window.pid().map_err(fail)? || previous.bounds != bounds(&window)? {
            return self.rejected_state(&window, query, "ACTION NOT APPLIED: the window moved, resized or changed. Re-evaluate the new screenshot.");
        }
        // State tokens are single-use, including errors after partial delivery.
        self.snapshots.retain(|_, state| state.window_id != previous.window_id);
        let mut element = arguments.get("element_index").map(|index| index.as_str().map(str::to_string).unwrap_or_else(|| index.to_string()))
            .map(|index| index.parse::<usize>().ok().and_then(|index| previous.elements.get(index)).cloned().ok_or("Unknown element_index; call get_app_state"))
            .transpose()?;
        #[cfg(target_os = "windows")]
        if operation == "type_text" && element.is_none() && !previous.elements.is_empty() {
            element = previous.elements.iter().find(|item| item["focused"] == true && item["editable"] == true).cloned();
            if element.is_none() {
                return Err("No focused editable control in the observed window. Use type_text with the editor's element_index, or click the editor and observe before typing.".into());
            }
        }
        if let Some(element) = element.as_ref() {
            let modified = arguments["modifiers"].as_array().is_some_and(|keys| !keys.is_empty());
            let semantic_click = operation != "click" || (!modified
                && arguments["mouse_button"].as_str().unwrap_or("left") == "left"
                && arguments["click_count"].as_u64().unwrap_or(1) == 1
                && ["auto", "accessibility"].contains(&arguments["click_method"].as_str().unwrap_or("auto")));
            if semantic_click && platform::semantic_action(&window, element, operation, arguments)? {
                std::thread::sleep(Duration::from_millis(self.settle_ms));
                return self.snapshot(&window, query, "Accessibility action dispatched. Verify the returned state before the next action.");
            }
        }
        if ["set_value", "perform_secondary_action"].contains(&operation) {
            return Err("This element does not expose the requested accessibility action. Use a screenshot-targeted click and keyboard input instead.".into());
        }
        if arguments["allow_foreground"].as_bool() == Some(false) {
            return Err("This action requires foreground input. No input was sent. Use a supported accessibility action or allow foreground input.".into());
        }
        platform::focus(&window)?;
        if previous.bounds != bounds(&window)? {
            return self.rejected_state(&window, query, "ACTION NOT APPLIED: focusing changed the window geometry. Inspect this new state.");
        }
        if ["type_text", "press_key"].contains(&operation) {
            if let Some(element) = element.as_ref() { platform::focus_element(&window, element)?; }
        }
        let settings = if operation == "input" {
            Settings { linux_delay: 0, windows_subject_to_mouse_speed_and_acceleration_level: true, ..Settings::default() }
        } else { Settings::default() };
        let mut input = Enigo::new(&settings).map_err(|error| format!("Input permission unavailable: {error}"))?;
        let point = |x: &str, y: &str| -> Result<(i32,i32),String> {
            let (x,y) = if let Some(element) = element.as_ref().filter(|_| x == "x") {
                let frame = &element["frame"];
                return Ok(((frame[0].as_f64().ok_or("Element has no position")? + frame[2].as_f64().unwrap_or(0.0)/2.0).round() as i32,
                    (frame[1].as_f64().ok_or("Element has no position")? + frame[3].as_f64().unwrap_or(0.0)/2.0).round() as i32));
            } else { (arguments[x].as_f64().ok_or("Missing x coordinate")?, arguments[y].as_f64().ok_or("Missing y coordinate")?) };
            if !x.is_finite() || !y.is_finite() || x < 0.0 || y < 0.0 || x >= previous.image_size.0 as f64 || y >= previous.image_size.1 as f64 {
                return Err("Coordinates are outside the last screenshot".into());
            }
            Ok((previous.bounds.0 + (x * previous.bounds.2 as f64 / previous.image_size.0 as f64).round() as i32,
                previous.bounds.1 + (y * previous.bounds.3 as f64 / previous.image_size.1 as f64).round() as i32))
        };
        let modifiers=arguments["modifiers"].as_array().map(|values|values.iter().map(|value|
            parse_key(value.as_str().unwrap_or(""))).collect::<Result<Vec<_>,_>>()).transpose()?.unwrap_or_default();
        let mut held=Vec::new();
        let action_result=(|| {
        if cancelled() || !window.is_focused().unwrap_or(false) { return Err("Cancelled or target lost focus; no input was sent".into()); }
        for modifier in modifiers { input.key(modifier,Direction::Press).map_err(fail)?; held.push(modifier); }
        match operation {
            "input" => input_burst(&mut input, &window, arguments, cancelled)?,
            "click" => {
                let (x,y)=point("x","y")?;
                let button=match arguments["mouse_button"].as_str().unwrap_or("left") { "left"=>Button::Left,"right"=>Button::Right,"middle"=>Button::Middle,_=>return Err("Unknown mouse_button".into()) };
                let count=arguments["click_count"].as_u64().unwrap_or(1);
                if !(1..=3).contains(&count) { return Err("click_count must be 1, 2 or 3".into()); }
                input.move_mouse(x,y,Coordinate::Abs).map_err(fail)?;
                for index in 0..count {
                    if cancelled() || !window.is_focused().unwrap_or(false) { return Err("Target lost focus or click cancelled".into()); }
                    input.button(button,Direction::Click).map_err(fail)?;
                    if index+1<count { std::thread::sleep(Duration::from_millis(70)); }
                }
            }
            "drag" => {
                let (from_x,from_y)=point("from_x","from_y")?;
                let (to_x,to_y)=point("to_x","to_y")?;
                input.move_mouse(from_x,from_y,Coordinate::Abs).map_err(fail)?;
                let button=match arguments["mouse_button"].as_str().unwrap_or("left") { "left"=>Button::Left,"middle"=>Button::Middle,"right"=>Button::Right,_=>return Err("Unknown mouse_button".into()) };
                input.button(button,Direction::Press).map_err(fail)?;
                let drag = (|| {
                    for step in 1..=20 {
                        if cancelled() || !window.is_focused().unwrap_or(false) { return Err("Target lost focus or drag cancelled".into()); }
                        input.move_mouse(from_x+(to_x-from_x)*step/20,from_y+(to_y-from_y)*step/20,Coordinate::Abs).map_err(fail)?; std::thread::sleep(Duration::from_millis(15)); }
                    Ok::<(),String>(())
                })();
                let release=input.button(button,Direction::Release).map_err(fail);
                drag?; release?;
            }
            "scroll" => {
                if let Ok((x,y))=point("x","y") { input.move_mouse(x,y,Coordinate::Abs).map_err(fail)?; }
                else { input.move_mouse(previous.bounds.0+previous.bounds.2 as i32/2,previous.bounds.1+previous.bounds.3 as i32/2,Coordinate::Abs).map_err(fail)?; }
                let pages=arguments["pages"].as_f64().unwrap_or(1.0);
                if !pages.is_finite() || pages<=0.0 || pages>20.0 { return Err("pages must be greater than zero and at most 20".into()); }
                let (axis,sign)=match arguments["direction"].as_str().unwrap_or("") { "up"=>(Axis::Vertical,-1),"down"=>(Axis::Vertical,1),"left"=>(Axis::Horizontal,-1),"right"=>(Axis::Horizontal,1),_=>return Err("Invalid scroll direction".into()) };
                input.scroll((pages*6.0).round() as i32*sign,axis).map_err(fail)?;
            }
            "type_text" => input.text(arguments["text"].as_str().ok_or("Missing text")?).map_err(fail)?,
            "press_key" => press_keys(&mut input,arguments["key"].as_str().ok_or("Missing key")?)?,
            _ => return Err(format!("Unknown operation: {operation}")),
        }
        Ok::<(),String>(())
        })();
        let mut release_error=None;
        for modifier in held.into_iter().rev() { if let Err(error)=input.key(modifier,Direction::Release) { release_error=Some(error.to_string()); } }
        action_result?;
        if let Some(error)=release_error { return Err(error); }
        std::thread::sleep(Duration::from_millis(self.settle_ms));
        self.after_input(&window, query, &previous, arguments["_defer_observation"].as_bool()==Some(true))
    }
}

// A burst holds keys/buttons together while moving the pointer. One local
// timing loop replaces model/IPC round trips between down, move and up events.
fn input_burst(input: &mut Enigo, window: &Window, arguments: &Value, cancelled: &dyn Fn() -> bool) -> Result<(), String> {
    let duration = arguments["duration_ms"].as_u64().filter(|value| (1..=2000).contains(value))
        .ok_or("duration_ms must be 1-2000")?;
    let keys = arguments["keys"].as_array().map(|keys| keys.iter().map(|key| parse_key(key.as_str().unwrap_or(""))).collect::<Result<Vec<_>,_>>()).transpose()?.unwrap_or_default();
    let buttons = arguments["buttons"].as_array().map(|buttons| buttons.iter().map(|button| match button.as_str() {
        Some("left") => Ok(Button::Left), Some("middle") => Ok(Button::Middle), Some("right") => Ok(Button::Right),
        _ => Err("Unknown held mouse button".to_string()),
    }).collect::<Result<Vec<_>,_>>()).transpose()?.unwrap_or_default();
    if keys.len() > 8 || buttons.len() > 3 { return Err("Too many held inputs".into()); }
    let delta = |name: &str| -> Result<i32,String> {
        if arguments.get(name).is_none() { return Ok(0); }
        arguments[name].as_i64().filter(|value| (-4096..=4096).contains(value)).map(|value| value as i32).ok_or(format!("{name} must be an integer from -4096 to 4096"))
    };
    let (dx,dy) = (delta("dx")?,delta("dy")?);
    struct Held<'a> { input: &'a mut Enigo, keys: Vec<Key>, buttons: Vec<Button> }
    impl Drop for Held<'_> {
        fn drop(&mut self) {
            for button in self.buttons.iter().rev() { let _ = self.input.button(*button,Direction::Release); }
            for key in self.keys.iter().rev() { let _ = self.input.key(*key,Direction::Release); }
        }
    }
    let mut held = Held { input, keys: Vec::new(), buttons: Vec::new() };
    for key in keys { held.keys.push(key); held.input.key(key,Direction::Press).map_err(fail)?; }
    for button in buttons { held.buttons.push(button); held.input.button(button,Direction::Press).map_err(fail)?; }
    let start = std::time::Instant::now();
    let steps = duration.div_ceil(8) as i32;
    let (mut sent_x, mut sent_y) = (0,0);
    for step in 1..=steps {
        if cancelled() { return Err("Input burst cancelled; held inputs released".into()); }
        if !window.is_focused().unwrap_or(false) { return Err("Input burst stopped after focus changed; held inputs released".into()); }
        let (x,y) = (dx*step/steps,dy*step/steps);
        if x != sent_x || y != sent_y { held.input.move_mouse(x-sent_x,y-sent_y,Coordinate::Rel).map_err(fail)?; }
        (sent_x,sent_y) = (x,y);
        let deadline = start + Duration::from_millis(duration * step as u64 / steps as u64);
        std::thread::sleep(deadline.saturating_duration_since(std::time::Instant::now()));
    }
    Ok(())
}

fn parse_key(text: &str) -> Result<Key, String> {
    Ok(match text.trim().to_lowercase().as_str() {
        "ctrl"|"control"=>Key::Control,"shift"=>Key::Shift,"alt"|"option"=>Key::Alt,"meta"|"super"|"win"|"command"|"cmd"=>Key::Meta,
        "enter"|"return"=>Key::Return,"esc"|"escape"=>Key::Escape,"tab"=>Key::Tab,"space"=>Key::Space,
        "backspace"=>Key::Backspace,"delete"=>Key::Delete,"home"=>Key::Home,"end"=>Key::End,"pageup"=>Key::PageUp,"pagedown"=>Key::PageDown,
        "left"|"arrowleft"=>Key::LeftArrow,"right"|"arrowright"=>Key::RightArrow,"up"|"arrowup"=>Key::UpArrow,"down"|"arrowdown"=>Key::DownArrow,
        "f1"=>Key::F1,"f2"=>Key::F2,"f3"=>Key::F3,"f4"=>Key::F4,"f5"=>Key::F5,"f6"=>Key::F6,"f7"=>Key::F7,"f8"=>Key::F8,"f9"=>Key::F9,"f10"=>Key::F10,"f11"=>Key::F11,"f12"=>Key::F12,
        key if key.chars().count()==1=>Key::Unicode(key.chars().next().unwrap()),_=>return Err(format!("Unsupported key: {text}")),
    })
}

fn press_keys(input: &mut Enigo, text: &str) -> Result<(), String> {
    let keys=text.split('+').map(parse_key).collect::<Result<Vec<_>,_>>()?;
    let mut pressed=Vec::new();
    let result=(|| { for key in &keys { input.key(*key,Direction::Press).map_err(fail)?; pressed.push(*key); } Ok::<(),String>(()) })();
    let mut release_error=None;
    for key in pressed.into_iter().rev() { if let Err(error)=input.key(key,Direction::Release) { release_error=Some(error.to_string()); } }
    result?;
    if let Some(error)=release_error { return Err(error); }
    Ok(())
}
