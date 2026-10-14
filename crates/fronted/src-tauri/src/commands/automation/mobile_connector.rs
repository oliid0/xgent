use std::sync::Arc;
use serde_json::{json, Value};
use tauri_plugin_mobile_assistant::{CalendarKind, CalendarListRequest, CreateCalendarEventRequest, CreateReminderRequest, MobileAssistantExt};
use crate::services::automation::{AutomationStore, MobileConnectorWriteInput, MobileConnectorWriteRecord};

pub(crate) fn execute(app: &tauri::AppHandle, store: &AutomationStore, input: MobileConnectorWriteInput, expected_source: Option<&str>) -> Result<MobileConnectorWriteRecord, String> {
    execute_with_branch(app,store,input,expected_source,None)
}

pub(crate) fn execute_branch(app: &tauri::AppHandle, store: &AutomationStore, input: MobileConnectorWriteInput, expected_source: &str, entry: &str, branch: &str, index: usize) -> Result<MobileConnectorWriteRecord,String> {
    execute_with_branch(app,store,input,Some(expected_source),Some((entry,branch,index)))
}

fn execute_with_branch(app: &tauri::AppHandle, store: &AutomationStore, input: MobileConnectorWriteInput, expected_source: Option<&str>, scope: Option<(&str,&str,usize)>) -> Result<MobileConnectorWriteRecord,String> {
    let keys: &[&str] = match input.kind.as_str() {
        "calendar_event" => &["title", "startMs", "endMs", "allDay", "location", "notes", "calendarId"],
        "reminder" => &["title", "dueMs", "notes", "recurrence", "calendarId"],
        "home_power" => &["homeId", "accessoryId", "serviceId", "characteristicId", "power"],
        _ => return Err("Unsupported durable mobile connector action".into()),
    };
    let request = input.request.as_object().ok_or_else(|| "Connector request must be an object".to_string())?;
    if request.keys().any(|key| !keys.contains(&key.as_str())) || serde_json::to_vec(&input.request).map_err(|e| e.to_string())?.len() > 32 * 1024 {
        return Err("Unknown or oversized connector request fields".into());
    }
    // A previous claim is authoritative even when permission/account/default
    // changed. Reading a receipt never performs that effect again.
    if let Some(saved) = store.read_mobile_connector_write(&input)? {
        if expected_source.is_some_and(|source| saved.destination["sourceId"] != source) { return Err("Retained action belongs to another OS account".into()); }
        return Ok(saved);
    }
    if input.kind=="home_power" {
        if scope.is_some() { return Err("Home control has no calendar/reminder branch authorization".into()); }
        return execute_home_power(app,store,input,expected_source);
    }
    if let Some((entry,branch,index)) = scope { store.check_mobile_branch_action(entry,branch,index,&input)?; }
    let mut event = if input.kind == "calendar_event" { Some(serde_json::from_value::<CreateCalendarEventRequest>(input.request.clone()).map_err(|e| e.to_string())?) } else { None };
    let mut reminder = if input.kind == "reminder" { Some(serde_json::from_value::<CreateReminderRequest>(input.request.clone()).map_err(|e| e.to_string())?) } else { None };
    let (title, notes, requested) = if let Some(event) = &event {
        if event.start_ms <= 0 || event.end_ms <= event.start_ms { return Err("A valid positive calendar interval is required".into()); }
        (&event.title, event.notes.as_deref(), event.calendar_id.as_deref())
    } else {
        let reminder = reminder.as_ref().ok_or_else(|| "Reminder request missing".to_string())?;
        if reminder.recurrence.is_some() && reminder.due_ms.is_none() { return Err("Recurring reminders require a first due time".into()); }
        (&reminder.title, reminder.notes.as_deref(), reminder.calendar_id.as_deref())
    };
    if title.trim().is_empty() || title.len() > 4096 || notes.is_some_and(|notes| notes.len() > 16 * 1024) { return Err("Connector title/notes exceed their bounds".into()); }
    let assistant = app.mobile_assistant();
    let kind = if event.is_some() { CalendarKind::Event } else { CalendarKind::Reminder };
    let destinations = assistant.list_calendars(CalendarListRequest { kind, writable_only: true, calendar_ids: requested.map(|id|vec![id.to_string()]) }).map_err(|e| e.to_string())?;
    let candidates: Vec<_> = destinations.calendars.iter().filter(|calendar| match requested {
        Some(id) => calendar.id == id,
        None => calendar.is_default,
    }).collect();
    if candidates.len() != 1 || (requested.is_none() && destinations.truncated) {
        return Err("Choose an actual unique writable calendar/list before starting this operation".into());
    }
    let selected = candidates[0];
    if expected_source.is_some_and(|source| selected.source_id != source) { return Err("The action plan's original OS account changed; no write started".into()); }
    if selected.source_id.is_empty() { return Err("Native connector does not provide an account identity; update before using durable writes".into()); }
    let binding = json!({ "kind": input.kind, "id": selected.id, "sourceId": selected.source_id, "source": selected.source });
    // Freeze both destination and source at the final SDK write; never follow
    // a changed default or reuse a calendar ID under another source/account.
    if let Some(event) = &mut event { event.calendar_id = Some(selected.id.clone()); event.expected_source_id = Some(selected.source_id.clone()); }
    if let Some(reminder) = &mut reminder { reminder.calendar_id = Some(selected.id.clone()); reminder.expected_source_id = Some(selected.source_id.clone()); }
    let (saved, acquired) = match scope {
        Some((entry,branch,index)) => store.begin_mobile_branch_action(entry,branch,index,input.clone(),binding)?,
        None => store.begin_mobile_connector_write(input.clone(), binding)?,
    };
    if !acquired { return Ok(saved); }
    let result = if let Some(event) = event { assistant.create_calendar_event(event) }
        else { assistant.create_reminder(reminder.ok_or_else(|| "Reminder request missing".to_string())?) };
    // Store the actual native ID BEFORE returning to any WebView/model. A lost
    // return message can recover this receipt using the same immutable input.
    store.complete_mobile_connector_write(&input, result.map_err(|e| e.to_string()).and_then(|value| serde_json::to_value(value).map_err(|e| e.to_string())))
}

fn execute_home_power(app:&tauri::AppHandle,store:&AutomationStore,input:MobileConnectorWriteInput,expected_source:Option<&str>)->Result<MobileConnectorWriteRecord,String> {
    #[cfg(target_os="ios")]
    {
        use tauri_plugin_mobile_assistant::HomePowerRequest;
        let request:HomePowerRequest=serde_json::from_value(input.request.clone()).map_err(|e|e.to_string())?;
        for id in [&request.home_id,&request.accessory_id,&request.service_id,&request.characteristic_id] {
            if !uuid::Uuid::parse_str(id).is_ok_and(|uuid|uuid.to_string()==*id) { return Err("Home power requires exact observed UUIDs".into()); }
        }
        store.check_home_power_policy()?;
        let assistant=app.mobile_assistant();
        let destination=assistant.resolve_home_power_destination(request.clone()).map_err(|e|e.to_string())?;
        if destination.id!=request.characteristic_id || destination.source_id!=request.home_id
            || expected_source.is_some_and(|source|source!=destination.source_id) { return Err("HomeKit changed the original target identity".into()); }
        let binding=json!({"kind":"home_power","id":destination.id,"sourceId":destination.source_id,"source":destination.source,
            "accessoryId":request.accessory_id,"serviceId":request.service_id});
        // The store rechecks native policy while committing the effect claim.
        let (saved,acquired)=store.begin_mobile_connector_write(input.clone(),binding)?;
        if !acquired {return Ok(saved);}
        let result=assistant.set_home_power(request).map_err(|e|e.to_string()).and_then(|receipt|serde_json::to_value(receipt).map_err(|e|e.to_string()));
        store.complete_mobile_connector_write(&input,result)
    }
    #[cfg(not(target_os="ios"))]
    {let _=(app,store,input,expected_source);Err("Home power requires the authorized initiating iOS device".into())}
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_mobile_connector_execute(app: tauri::AppHandle, window:tauri::WebviewWindow, input: MobileConnectorWriteInput,
    store: tauri::State<'_, Arc<AutomationStore>>) -> Result<MobileConnectorWriteRecord, String> {
    if input.kind=="home_power" && window.label()=="agent-worker" {return Err("Home control requires original client authorization; worker branches do not grant Home access".into());}
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || execute(&app, &store, input, None)).await.map_err(|e| e.to_string())?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn automation_mobile_connector_read(input: MobileConnectorWriteInput,
    store: tauri::State<'_, Arc<AutomationStore>>) -> Result<Option<MobileConnectorWriteRecord>, String> {
    let store = Arc::clone(store.inner());
    tauri::async_runtime::spawn_blocking(move || store.read_mobile_connector_write(&input)).await.map_err(|e| e.to_string())?
}
