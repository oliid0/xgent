use serde_json::Value;
use x11rb::connection::Connection;
use x11rb::protocol::xproto::{ClientMessageEvent, ConnectionExt, EventMask};
use xcap::Window;
use zbus::blocking::{Connection as BusConnection, Proxy};
use zbus::zvariant::OwnedObjectPath;
use std::time::{Duration, Instant};

type Accessible = (String, OwnedObjectPath);

fn accessibility_bus() -> Result<BusConnection,String> {
    let session=BusConnection::session().map_err(|e|e.to_string())?;
    let bus=Proxy::new(&session,"org.a11y.Bus","/org/a11y/bus","org.a11y.Bus").map_err(|e|e.to_string())?;
    let address:String=bus.call("GetAddress",&()).map_err(|e|e.to_string())?;
    zbus::blocking::connection::Builder::address(address.as_str()).map_err(|e|e.to_string())?
        .method_timeout(Duration::from_millis(1200)).build().map_err(|e|e.to_string())
}

fn accessible_proxy<'a>(connection:&'a BusConnection, node:&'a Accessible, interface:&'a str)->Result<Proxy<'a>,String> {
    Proxy::new(connection,node.0.as_str(),node.1.as_str(),interface).map_err(|e|e.to_string())
}

fn app_root(connection:&BusConnection, window:&Window)->Result<Accessible,String> {
    let registry=Proxy::new(connection,"org.a11y.atspi.Registry","/org/a11y/atspi/accessible/root","org.a11y.atspi.Accessible").map_err(|e|e.to_string())?;
    let apps:Vec<Accessible>=registry.call("GetChildren",&()).map_err(|e|e.to_string())?;
    let bus=Proxy::new(connection,"org.freedesktop.DBus","/org/freedesktop/DBus","org.freedesktop.DBus").map_err(|e|e.to_string())?;
    let pid=window.pid().map_err(|e|e.to_string())?;
    for app in apps {
        let app_pid:Result<u32,_>=bus.call("GetConnectionUnixProcessID",&(app.0.as_str(),));
        if app_pid.ok()!=Some(pid) { continue; }
        let proxy=accessible_proxy(connection,&app,"org.a11y.atspi.Accessible")?;
        let children:Vec<Accessible>=proxy.call("GetChildren",&()).unwrap_or_default();
        for child in children {
            if let Ok(proxy)=accessible_proxy(connection,&child,"org.a11y.atspi.Accessible") {
                let name:String=proxy.get_property("Name").unwrap_or_default();
                if name==window.title().unwrap_or_default() { return Ok(child.clone()); }
            }
        }
        return Ok(app.clone());
    }
    Err("No accessibility tree was published by this application".into())
}

pub fn focus(window:&Window)->Result<(),String> {
    if window.is_focused().unwrap_or(false) { return Ok(()); }
    let (connection,screen)=x11rb::connect(None).map_err(|error|format!("Cannot activate this window through X11: {error}. Activate the target app in your desktop session."))?;
    let root=connection.setup().roots[screen].root;
    if window.is_minimized().unwrap_or(false) {
        connection.map_window(window.id().map_err(|e|e.to_string())?).map_err(|e|e.to_string())?
            .check().map_err(|e|e.to_string())?;
    }
    let atom=connection.intern_atom(false,b"_NET_ACTIVE_WINDOW").map_err(|e|e.to_string())?.reply().map_err(|e|e.to_string())?.atom;
    let event=ClientMessageEvent::new(32,window.id().map_err(|e|e.to_string())?,atom,[2,0,0,0,0]);
    connection.send_event(false,root,EventMask::SUBSTRUCTURE_REDIRECT|EventMask::SUBSTRUCTURE_NOTIFY,event).map_err(|e|e.to_string())?;
    connection.flush().map_err(|e|e.to_string())?;
    for _ in 0..10 {
        if window.is_focused().unwrap_or(false) { return Ok(()); }
        std::thread::sleep(std::time::Duration::from_millis(40));
    }
    Err("The desktop did not activate the target window. No keyboard input was sent.".into())
}

pub fn elements(window:&Window)->(Vec<Value>,String) {
    let collect=|| -> Result<Vec<Value>,String> {
        let connection=accessibility_bus()?;
        let root=app_root(&connection,window)?;
        let mut pending=vec![(root,0)];
        let mut output=Vec::new();
        let started=Instant::now();
        while let Some((node,depth))=pending.pop() {
            if output.len()>=400 || started.elapsed()>Duration::from_secs(4) { break; }
            let Ok(proxy)=accessible_proxy(&connection,&node,"org.a11y.atspi.Accessible") else { continue; };
            let name:String=proxy.get_property("Name").unwrap_or_default();
            let role:String=proxy.call("GetRoleName",&()).unwrap_or_default();
            let interfaces:Vec<String>=proxy.call("GetInterfaces",&()).unwrap_or_default();
            let actions:Vec<(String,String,String)>=accessible_proxy(&connection,&node,"org.a11y.atspi.Action").ok()
                .and_then(|proxy|proxy.call("GetActions",&()).ok()).unwrap_or_default();
            let frame:Option<(i32,i32,i32,i32)>=accessible_proxy(&connection,&node,"org.a11y.atspi.Component").ok()
                .and_then(|proxy|proxy.call("GetExtents",&(0u32,)).ok());
            output.push(serde_json::json!({"bus":node.0,"path":node.1.as_str(),"name":name,"role":role,"interfaces":interfaces,
                "frame":frame,"actions":actions.iter().map(|action|&action.0).collect::<Vec<_>>(),
                "label":format!("{role}: {name} (actions: {})",actions.iter().map(|action|action.0.as_str()).collect::<Vec<_>>().join(", "))}));
            if depth<32 {
                let children:Vec<Accessible>=proxy.call("GetChildren",&()).unwrap_or_default();
                pending.extend(children.into_iter().rev().map(|child|(child,depth+1)));
            }
        }
        Ok(output)
    };
    match collect() {
        Ok(elements)=>(elements,"AT-SPI accessibility state (bounded to 400 nodes). Use screenshot coordinates when no matching element is exposed.".into()),
        Err(error)=>(Vec::new(),format!("Accessibility unavailable: {error}. Use screenshot coordinates.")),
    }
}

pub fn semantic_action(_window:&Window,element:&Value,operation:&str,arguments:&Value)->Result<bool,String> {
    let connection=accessibility_bus()?;
    let node=(element["bus"].as_str().ok_or("Missing accessibility bus")?.to_string(),
        OwnedObjectPath::try_from(element["path"].as_str().ok_or("Missing accessibility path")?).map_err(|e|e.to_string())?);
    let proxy=accessible_proxy(&connection,&node,"org.a11y.atspi.Accessible")?;
    let name:String=proxy.get_property("Name").map_err(|e|e.to_string())?;
    if name!=element["name"].as_str().unwrap_or("") { return Err("The target element changed; inspect the app again".into()); }
    if operation=="set_value" {
        let interfaces:Vec<String>=proxy.call("GetInterfaces",&()).map_err(|e|e.to_string())?;
        let value=arguments["value"].as_str().ok_or("Missing value")?;
        if interfaces.iter().any(|interface|interface.ends_with("EditableText")) {
            let proxy=accessible_proxy(&connection,&node,"org.a11y.atspi.EditableText")?;
            let changed:bool=proxy.call("SetTextContents",&(value,)).map_err(|e|e.to_string())?;
            if !changed { return Err("Application rejected the text value".into()); }
            return Ok(true);
        }
        if interfaces.iter().any(|interface|interface.ends_with("Value")) {
            accessible_proxy(&connection,&node,"org.a11y.atspi.Value")?
                .set_property("CurrentValue",value.parse::<f64>().map_err(|_|"This element requires a numeric value")?).map_err(|e|e.to_string())?;
            return Ok(true);
        }
        return Err("This element is not settable".into());
    }
    if operation=="click" || operation=="perform_secondary_action" {
        let proxy=accessible_proxy(&connection,&node,"org.a11y.atspi.Action")?;
        let actions:Vec<(String,String,String)>=proxy.call("GetActions",&()).unwrap_or_default();
        let requested=arguments["action"].as_str().unwrap_or("").to_lowercase();
        let index=actions.iter().position(|action|if operation=="click" {
            ["click","press","activate","open"].contains(&action.0.to_lowercase().as_str())
        } else { action.0.to_lowercase()==requested });
        if let Some(index)=index {
            let applied:bool=proxy.call("DoAction",&(index as i32,)).map_err(|e|e.to_string())?;
            if !applied { return Err("Application rejected the accessibility action".into()); }
            return Ok(true);
        }
    }
    if arguments["click_method"].as_str()==Some("accessibility") { return Err("No matching accessibility action".into()); }
    Ok(false)
}
