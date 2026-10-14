//! Original iOS HomeKit subscriptions feed the existing durable event lane.
use std::sync::{Arc,Mutex};
use tauri_plugin_mobile_assistant::{HomeEventConfiguration,HealthEventAcknowledgement,MobileAssistantExt};
use super::automation::AutomationStore;

pub(crate) static HOME_CONFIG_LOCK:Mutex<()>=Mutex::new(());

pub(crate) fn configure(app:&tauri::AppHandle,store:&AutomationStore,authorize_home:Option<String>)->Result<(),String>{
    let mut homes=store.active_home_event_homes()?;
    let authorize=authorize_home.is_some();
    if let Some(home)=authorize_home {if !homes.contains(&home){homes.push(home);}}
    homes.sort();
    let observed=app.mobile_assistant().configure_home_events(HomeEventConfiguration {
        host_id:store.background_worker_identity()?,homes:homes.clone(),authorize,
    }).map_err(|error|error.to_string())?;
    if observed!=homes{return Err("Native Home adapter did not confirm its exact observation scope".into());}
    let delivered=super::os_event_sender::configure(app,store);
    store.set_event_sender_error(delivered.as_ref().err().map(String::as_str))?;
    Ok(())
}

pub(crate) fn start(app:tauri::AppHandle,store:Arc<AutomationStore>){
    tauri::async_runtime::spawn(async move {
        let mut ticks=tokio::time::interval(std::time::Duration::from_secs(5));
        ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            ticks.tick().await;
            let app=app.clone();let store=Arc::clone(&store);
            let _=tauri::async_runtime::spawn_blocking(move || {
                let result=(||{
                    let _guard=HOME_CONFIG_LOCK.lock().map_err(|_|"Home observation setup lock unavailable".to_string())?;
                    configure(&app,&store,None)?;
                    let scopes=store.active_home_event_homes()?;
                    let events:Vec<_>=app.mobile_assistant().pending_home_events().map_err(|error|error.to_string())?.into_iter().filter(|event|scopes.contains(&event.home_id)).collect();
                    store.ingest_home_events(&events)?;
                    app.mobile_assistant().acknowledge_home_events(HealthEventAcknowledgement {ids:events.iter().map(|event|event.id.clone()).collect()}).map_err(|error|error.to_string())?;
                    store.dispatch_proactive_rules()?;
                    Ok::<(),String>(())
                })();
                let _=store.set_home_event_error(result.as_ref().err().map(String::as_str));
            }).await;
        }
    });
}
