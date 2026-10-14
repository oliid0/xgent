//! C ABI used only by the native iOS refresh worker. Payloads are validated by
//! the same private store as Android/foreground; no public invoke surface.
use std::ffi::{c_char,c_void,CStr,CString};
use std::time::Duration;
use super::automation::{AutomationStore,store::ResultDeliveryTarget};

unsafe fn text<'a>(value:*const c_char,max:usize)->Result<&'a str,String>{
    if value.is_null(){return Err("Missing native result argument".into());}
    let raw=CStr::from_ptr(value).to_bytes();
    if raw.len()>max{return Err("Native result argument exceeds bounds".into());}
    std::str::from_utf8(raw).map_err(|_|"Native result argument is not UTF-8".into())
}
unsafe fn store(path:*const c_char,root:*const c_char,host:*const c_char)->Result<AutomationStore,String>{
    AutomationStore::open_os_result_receiver(text(path,32768)?,text(root,32768)?,text(host,36)?)
}
fn json_reply(work:impl FnOnce()->Result<serde_json::Value,String>)->*mut c_char{
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(work)){
        Ok(Ok(value))=>CString::new(value.to_string()).map(CString::into_raw).unwrap_or(std::ptr::null_mut()),
        _=>std::ptr::null_mut(),
    }
}

#[no_mangle]
pub unsafe extern "C" fn xgent_result_targets_v1(path:*const c_char,root:*const c_char,host:*const c_char,targets:*const c_char)->*mut c_char{
    json_reply(||{
        let targets:Vec<ResultDeliveryTarget>=serde_json::from_str(text(targets,2*1024*1024)?).map_err(|_|"Invalid OS result targets".to_string())?;
        serde_json::to_value(store(path,root,host)?.retain_os_result_targets(targets)?).map_err(|e|e.to_string())
    })
}

#[no_mangle]
pub unsafe extern "C" fn xgent_result_sync_v1(path:*const c_char,root:*const c_char,host:*const c_char,targets:*const c_char,
    cancelled:Option<extern "C" fn(*mut c_void)->i32>,context:*mut c_void)->i32{
    let result=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||{
        let cancelled=cancelled.ok_or("Missing native expiration probe")?;
        if context.is_null(){return Err("Missing native refresh context".to_string());}
        let mut stopped=||cancelled(context)!=0;
        super::os_result_receiver::sync(text(path,32768)?,text(root,32768)?,text(host,36)?,text(targets,2*1024*1024)?,Duration::from_secs(18),&mut stopped)
    }));
    if matches!(result,Ok(Ok(()))){1}else{0}
}

#[no_mangle]
pub unsafe extern "C" fn xgent_result_pending_v1(path:*const c_char,root:*const c_char,host:*const c_char)->*mut c_char{
    json_reply(||serde_json::to_value(store(path,root,host)?.pending_background_notifications(4)?).map_err(|e|e.to_string()))
}

#[no_mangle]
pub unsafe extern "C" fn xgent_result_notice_v1(path:*const c_char,root:*const c_char,host:*const c_char,entry:*const c_char,accepted:i32)->i32{
    let result=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||{
        let store=store(path,root,host)?;let entry=text(entry,36)?;
        let status=store.background_inbox_notification_status(entry)?;
        if accepted==1 {store.record_background_notification_accepted(entry)?;return Ok::<_,String>(2);}
        Ok(match status.as_str(){"ready"=>1,"accepted"=>2,"obsolete"=>3,_=>0})
    }));
    match result {Ok(Ok(code))=>code,_=>0}
}

#[no_mangle]
pub unsafe extern "C" fn xgent_result_free_v1(value:*mut c_char){
    if !value.is_null(){drop(CString::from_raw(value));}
}

/// A separate write-authorized native event callback, never the scoped result
/// reader. The original private scope and actual rule gates are checked again.
#[no_mangle]
pub unsafe extern "C" fn xgent_event_scope_v1(path:*const c_char,root:*const c_char,host:*const c_char,enabled:i32)->i32{
    let result=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||{
        store(path,root,host)?.validate_event_sender_configuration(text(path,32768)?,text(host,36)?,enabled==1)
    }));
    if matches!(result,Ok(Ok(()))){1}else{0}
}

#[no_mangle]
pub unsafe extern "C" fn xgent_event_sync_v1(path:*const c_char,root:*const c_char,host:*const c_char,events:*const c_char,
    cancelled:Option<extern "C" fn(*mut c_void)->i32>,context:*mut c_void)->*mut c_char{
    json_reply(||{
        let cancelled=cancelled.ok_or("Missing original event expiration probe")?;
        if context.is_null(){return Err("Missing original event run context".into());}
        let mut stopped=||cancelled(context)!=0;
        super::os_event_sender::sync(text(path,32768)?,text(root,32768)?,text(host,36)?,text(events,160*1024)?,Duration::from_secs(18),&mut stopped)
    })
}

#[no_mangle]
pub unsafe extern "C" fn xgent_event_results_ack_v1(path:*const c_char,root:*const c_char,host:*const c_char,targets:*const c_char)->i32{
    let result=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||{
        super::os_event_sender::acknowledge_targets(text(path,32768)?,text(root,32768)?,text(host,36)?,text(targets,2*1024*1024)?)
    }));
    if matches!(result,Ok(Ok(()))){1}else{0}
}

#[no_mangle]
pub unsafe extern "C" fn xgent_event_health_scopes_v1(path:*const c_char,root:*const c_char,host:*const c_char,events:*const c_char)->*mut c_char{
    json_reply(||super::os_event_sender::prepare_health(text(path,32768)?,text(root,32768)?,text(host,36)?,text(events,16384)?))
}
