use serde_json::{json, Value};
use std::time::{Duration, Instant};
use windows::core::Interface;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
use windows::Win32::UI::Accessibility::*;
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId, PeekMessageW, SetForegroundWindow, ShowWindowAsync, MSG, PM_NOREMOVE, SW_RESTORE};
use xcap::Window;

struct Apartment(bool);
impl Drop for Apartment { fn drop(&mut self) { if self.0 { unsafe { CoUninitialize(); } } } }

struct Automation {
    root: IUIAutomationElement,
    walker: IUIAutomationTreeWalker,
    _automation: IUIAutomation,
    _apartment: Apartment,
}

fn automation(window: &Window) -> Result<Automation, String> {
    unsafe {
        let apartment = Apartment(CoInitializeEx(None, COINIT_MULTITHREADED).is_ok());
        let automation: IUIAutomation = CoCreateInstance(&CUIAutomation8, None, CLSCTX_INPROC_SERVER).map_err(|e| e.to_string())?;
        if let Ok(automation2) = automation.cast::<IUIAutomation2>() {
            let _ = automation2.SetConnectionTimeout(1500);
            let _ = automation2.SetTransactionTimeout(1500);
        }
        let root=automation.ElementFromHandle(HWND(window.id().map_err(|e| e.to_string())? as usize as *mut _)).map_err(|e| e.to_string())?;
        let walker=automation.ControlViewWalker().map_err(|e| e.to_string())?;
        Ok(Automation {root,walker,_automation:automation,_apartment:apartment})
    }
}

pub fn focus(window: &Window) -> Result<(), String> {
    let hwnd=HWND(window.id().map_err(|e| e.to_string())? as usize as *mut _);
    if window.is_focused().unwrap_or(false) && !window.is_minimized().unwrap_or(false) { return Ok(()); }
    unsafe {
        if window.is_minimized().unwrap_or(false) { let _=ShowWindowAsync(hwnd,SW_RESTORE); }
        let _=SetForegroundWindow(hwnd);
        if GetForegroundWindow() != hwnd {
            // CUA runs on a worker, outside the foreground UI thread's input
            // queue. Join it only for activation and always detach afterwards.
            let current = GetCurrentThreadId();
            let foreground = GetWindowThreadProcessId(GetForegroundWindow(), None);
            let mut message = MSG::default();
            let _ = PeekMessageW(&mut message, None, 0, 0, PM_NOREMOVE);
            if foreground != 0 && foreground != current && AttachThreadInput(current, foreground, true).as_bool() {
                let _ = SetForegroundWindow(hwnd);
                let _ = AttachThreadInput(current, foreground, false);
            }
        }
    }
    for _ in 0..25 {
        if window.is_focused().unwrap_or(false) && !window.is_minimized().unwrap_or(true) {
            // ShowWindowAsync and the target app's layout complete separately.
            // Observe a restored frame, never the iconic 187x32 caption.
            std::thread::sleep(Duration::from_millis(80));
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(40));
    }
    Err("Windows did not focus the target window. Activate it and retry; no input was sent to another app.".into())
}

pub fn elements(window: &Window) -> (Vec<Value>,String) {
    let automation=match automation(window) { Ok(value)=>value, Err(error)=>return (Vec::new(),format!("Accessibility unavailable ({error}); use screenshot coordinates.")) };
    // Cache one control at a time: bounded traversal, one cross-process fetch
    // per node instead of a remote call for each property and pattern probe.
    let cache = unsafe { (|| -> windows::core::Result<IUIAutomationCacheRequest> {
        let cache = automation._automation.CreateCacheRequest()?;
        cache.SetTreeScope(TreeScope_Element)?;
        for property in [UIA_NamePropertyId, UIA_AutomationIdPropertyId,
            UIA_ClassNamePropertyId, UIA_ControlTypePropertyId, UIA_IsEnabledPropertyId,
            UIA_HasKeyboardFocusPropertyId, UIA_IsPasswordPropertyId,
            UIA_BoundingRectanglePropertyId, UIA_ValueValuePropertyId, UIA_ValueIsReadOnlyPropertyId] {
            cache.AddProperty(property)?;
        }
        for pattern in [UIA_InvokePatternId, UIA_ValuePatternId, UIA_TextPatternId,
            UIA_LegacyIAccessiblePatternId, UIA_TogglePatternId, UIA_ExpandCollapsePatternId] {
            cache.AddPattern(pattern)?;
        }
        Ok(cache)
    })() };
    let cache = match cache { Ok(value) => value, Err(error) => return (Vec::new(),
        format!("Accessibility cache unavailable ({error}); use screenshot coordinates.")) };
    let root = match unsafe { automation.root.BuildUpdatedCache(&cache) } {
        Ok(value) => value,
        Err(error) => return (Vec::new(), format!("Accessibility snapshot unavailable ({error}); use screenshot coordinates.")),
    };
    let mut output=Vec::new();
    let started=Instant::now();
    fn walk(element:&IUIAutomationElement, walker:&IUIAutomationTreeWalker, cache:&IUIAutomationCacheRequest, path:Vec<usize>, output:&mut Vec<Value>, started:Instant) {
        if output.len()>=400 || path.len()>32 || started.elapsed()>Duration::from_secs(4) { return; }
        unsafe {
            let name=element.CachedName().map(|s| s.to_string()).unwrap_or_default();
            let automation_id=element.CachedAutomationId().map(|s| s.to_string()).unwrap_or_default();
            let class_name=element.CachedClassName().map(|s| s.to_string()).unwrap_or_default();
            let control=element.CachedControlType().map(|id|id.0).unwrap_or(0);
            let enabled=element.CachedIsEnabled().map(|value|value.as_bool()).unwrap_or(false);
            let focused=element.CachedHasKeyboardFocus().map(|value|value.as_bool()).unwrap_or(false);
            let password=element.CachedIsPassword().map(|value|value.as_bool()).unwrap_or(true);
            // Names identify controls, but editable document contents live in Value/Text patterns.
            // Return bounded text so the next observation can verify typing and sequence conditions.
            let value=if password { String::new() } else {
                element.GetCachedPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
                    .and_then(|pattern|pattern.CachedValue()).map(|value|value.to_string())
                    .or_else(|error| {
                        // Only editors/documents need expensive live document ranges.
                        if !focused && ![UIA_EditControlTypeId.0, UIA_DocumentControlTypeId.0].contains(&control) { return Err(error); }
                        element.GetCachedPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
                            .and_then(|pattern|pattern.DocumentRange()).and_then(|range|range.GetText(2000))
                            .map(|value|value.to_string())
                    }).unwrap_or_default()
                    .chars().take(2000).collect::<String>()
            };
            let mut actions=Vec::new();
            if element.GetCachedPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId).is_ok(){actions.push("Invoke");}
            if element.GetCachedPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId).is_ok_and(|p|p.CachedIsReadOnly().is_ok_and(|v|!v.as_bool())){actions.push("SetValue");}
            else if [UIA_EditControlTypeId.0,UIA_DocumentControlTypeId.0].contains(&control)
                && element.GetCachedPatternAs::<IUIAutomationLegacyIAccessiblePattern>(UIA_LegacyIAccessiblePatternId).is_ok() { actions.push("SetValue (legacy; provider may reject)"); }
            if element.GetCachedPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId).is_ok(){actions.push("Toggle");}
            if element.GetCachedPatternAs::<IUIAutomationExpandCollapsePattern>(UIA_ExpandCollapsePatternId).is_ok(){actions.extend(["Expand","Collapse"]);}
            let rect=element.CachedBoundingRectangle().ok();
            let frame=rect.map(|rect|json!([rect.left,rect.top,rect.right-rect.left,rect.bottom-rect.top])).unwrap_or(Value::Null);
            output.push(json!({"path":path,"name":name,"automationId":automation_id,"className":class_name,"controlType":control,"frame":frame,"actions":actions,
                "value":value,"enabled":enabled,"focused":focused,
                "editable":!password && [UIA_EditControlTypeId.0,UIA_DocumentControlTypeId.0].contains(&control),
                "label":format!("{} (type {}, enabled: {}, focused: {}, actions: {}){}",name,control,enabled,focused,actions.join(", "),
                    if value.is_empty() { String::new() } else { format!(" value: {value:?}") })}));
            let mut child=walker.GetFirstChildElementBuildCache(element,cache).ok();
            let mut index=0;
            while let Some(current)=child {
                if output.len()>=400 || started.elapsed()>Duration::from_secs(4) { break; }
                let mut child_path=path.clone(); child_path.push(index);
                walk(&current,walker,cache,child_path,output,started);
                child=walker.GetNextSiblingElementBuildCache(&current,cache).ok(); index+=1;
            }
        }
    }
    walk(&root,&automation.walker,&cache,vec![],&mut output,started);
    let note=if output.len()>=400 || started.elapsed()>Duration::from_secs(4) { "Accessibility tree is partial; screenshot remains authoritative." } else { "Prefer an element_index when its label and action match the target." };
    (output,note.into())
}

fn resolve_element(window:&Window, record:&Value)->Result<(Automation,IUIAutomationElement),String> {
    let automation=automation(window)?;
    let mut element=automation.root.clone();
    unsafe {
        for index in record["path"].as_array().ok_or("Invalid element path")? {
            element=automation.walker.GetFirstChildElement(&element).map_err(|_|"Element disappeared; inspect the app again")?;
            for _ in 0..index.as_u64().ok_or("Invalid element path")? {
                element=automation.walker.GetNextSiblingElement(&element).map_err(|_|"Element changed; inspect the app again")?;
            }
        }
        let name=element.CurrentName().map_err(|e|e.to_string())?.to_string();
        let id=element.CurrentAutomationId().map_err(|e|e.to_string())?.to_string();
        let class_name=element.CurrentClassName().map_err(|e|e.to_string())?.to_string();
        let control=element.CurrentControlType().map_err(|e|e.to_string())?.0;
        if name!=record["name"].as_str().unwrap_or("") || id!=record["automationId"].as_str().unwrap_or("")
            || class_name!=record["className"].as_str().unwrap_or("") || Some(control as i64)!=record["controlType"].as_i64() {
            return Err("The target element changed since the screenshot; call get_app_state before acting".into());
        }
        if !element.CurrentIsEnabled().map_err(|e|e.to_string())?.as_bool() { return Err("The target control is disabled".into()); }
        Ok((automation,element))
    }
}

pub fn focus_element(window:&Window, record:&Value)->Result<(),String> {
    let (_automation,element)=resolve_element(window,record)?;
    unsafe {
        element.SetFocus().map_err(|e|format!("Cannot focus target control: {e}"))?;
        if !element.CurrentHasKeyboardFocus().map_err(|e|e.to_string())?.as_bool() {
            return Err("The target control did not receive keyboard focus; no text was sent".into());
        }
    }
    Ok(())
}

pub fn semantic_action(window:&Window, record:&Value, operation:&str, arguments:&Value)->Result<bool,String> {
    if !["click","set_value","perform_secondary_action"].contains(&operation) { return Ok(false); }
    let (_automation,element)=resolve_element(window,record)?;
    unsafe {
        match operation {
            "click" if arguments["mouse_button"].as_str().unwrap_or("left")=="left" && arguments["click_count"].as_u64().unwrap_or(1)==1 => {
                if let Ok(pattern)=element.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId) { pattern.Invoke().map_err(|e|e.to_string())?; return Ok(true); }
            }
            "set_value" => {
                let text=arguments["value"].as_str().ok_or("Missing value")?;
                if let Ok(pattern)=element.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId) {
                    if pattern.CurrentIsReadOnly().map_err(|e|e.to_string())?.as_bool() { return Err("Element is read-only".into()); }
                    pattern.SetValue(&windows::core::BSTR::from(text)).map_err(|e|e.to_string())?;
                } else {
                    let pattern=element.GetCurrentPatternAs::<IUIAutomationLegacyIAccessiblePattern>(UIA_LegacyIAccessiblePatternId)
                        .map_err(|_|"This editor has no writable accessibility pattern. Use type_text with its element_index to focus the editor precisely.")?;
                    pattern.SetValue(&windows::core::HSTRING::from(text)).map_err(|e|format!("Editor rejected background SetValue ({e}). Observe before retrying; type_text with element_index supports keyboard-only editors."))?;
                }
                return Ok(true);
            }
            "perform_secondary_action" => {
                let result=match arguments["action"].as_str().unwrap_or("").to_lowercase().as_str() {
                    "invoke"=>element.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId).and_then(|p|p.Invoke()),
                    "toggle"=>element.GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId).and_then(|p|p.Toggle()),
                    "expand"=>element.GetCurrentPatternAs::<IUIAutomationExpandCollapsePattern>(UIA_ExpandCollapsePatternId).and_then(|p|p.Expand()),
                    "collapse"=>element.GetCurrentPatternAs::<IUIAutomationExpandCollapsePattern>(UIA_ExpandCollapsePatternId).and_then(|p|p.Collapse()),
                    _=>return Err("Unknown secondary action; use an action listed in the latest app state".into()),
                };
                result.map_err(|e|e.to_string())?; return Ok(true);
            }
            _=>{}
        }
        if arguments["click_method"].as_str()==Some("accessibility") { return Err("Element has no matching accessibility action".into()); }
        Ok(false)
    }
}
