use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(all(target_os = "macos", not(test)))]
use std::process::{Child, Command, Stdio};
#[cfg(all(windows, not(test)))]
use std::{io, sync::mpsc, thread::JoinHandle};

#[derive(Default)]
pub struct PowerActivityManager {
    state: Arc<Mutex<PowerActivityState>>,
}

#[derive(Default)]
struct PowerActivityState {
    requests: HashMap<String, PowerActivityRequest>,
    keep_awake: Option<KeepAwakeHandle>,
    watchdog_running: bool,
}

struct PowerActivityRequest {
    #[cfg_attr(not(test), allow(dead_code))]
    reason: String,
    expires_at: Instant,
}

impl PowerActivityManager {
    pub fn begin(
        &self,
        activity_id: impl Into<String>,
        reason: impl Into<String>,
        ttl_ms: Option<u64>,
    ) -> Result<(),String> {
        let activity_id = activity_id.into().trim().to_string();
        if activity_id.is_empty() {
            return Err("Power activity needs a nonempty identity".into());
        }

        let reason = reason.into().trim().to_string();
        let mut should_spawn_watchdog = false;
        {
            let mut state = self.state.lock().map_err(|_|"Power activity lock unavailable".to_string())?;

            prune_expired_requests(&mut state);
            state.requests.insert(
                activity_id.clone(),
                PowerActivityRequest {
                    reason,
                    expires_at: Instant::now() + normalize_ttl(ttl_ms),
                },
            );
            if let Err(error)=sync_keep_awake(&mut state) {state.requests.remove(&activity_id);return Err(error);}
            if state.keep_awake.is_some() && !state.watchdog_running {
                state.watchdog_running = true;
                should_spawn_watchdog = true;
            }
        }

        if should_spawn_watchdog && !spawn_watchdog(Arc::clone(&self.state)) {
            if let Ok(mut state) = self.state.lock() {
                state.watchdog_running = false;
                state.requests.remove(&activity_id);
                let _=sync_keep_awake(&mut state);
            }
            return Err("Power activity watchdog could not start".into());
        }
        Ok(())
    }

    pub fn end(&self, activity_id: impl AsRef<str>) {
        let activity_id = activity_id.as_ref().trim();
        if activity_id.is_empty() {
            return;
        }

        let mut state = match self.state.lock() {
            Ok(state) => state,
            Err(_) => return,
        };

        state.requests.remove(activity_id);
        if let Err(error)=sync_keep_awake(&mut state) {eprintln!("Power activity release failed: {error}");}
    }

    pub fn clear_all(&self) {
        let mut state = match self.state.lock() {
            Ok(state) => state,
            Err(_) => return,
        };
        state.requests.clear();
        if let Err(error)=sync_keep_awake(&mut state) {eprintln!("Power activity cleanup failed: {error}");}
    }

    #[cfg(test)]
    fn snapshot(&self) -> HashMap<String, String> {
        self.state
            .lock()
            .map(|state| {
                state
                    .requests
                    .iter()
                    .map(|(id, request)| (id.clone(), request.reason.clone()))
                    .collect()
            })
            .unwrap_or_default()
    }
}

impl Drop for PowerActivityManager {
    fn drop(&mut self) {
        self.clear_all();
    }
}

const POWER_ACTIVITY_DEFAULT_TTL: Duration = Duration::from_secs(15 * 60);
const POWER_ACTIVITY_MIN_TTL: Duration = Duration::from_secs(60);
const POWER_ACTIVITY_MAX_TTL: Duration = Duration::from_secs(6 * 60 * 60);
const POWER_ACTIVITY_WATCHDOG_INTERVAL: Duration = Duration::from_secs(30);

fn normalize_ttl(ttl_ms: Option<u64>) -> Duration {
    let ttl = ttl_ms
        .map(Duration::from_millis)
        .unwrap_or(POWER_ACTIVITY_DEFAULT_TTL);
    ttl.clamp(POWER_ACTIVITY_MIN_TTL, POWER_ACTIVITY_MAX_TTL)
}

fn prune_expired_requests(state: &mut PowerActivityState) {
    let now = Instant::now();
    state.requests.retain(|_, request| request.expires_at > now);
}

fn spawn_watchdog(state: Arc<Mutex<PowerActivityState>>) -> bool {
    thread::Builder::new()
        .name("xgent-power-activity-watchdog".to_string())
        .spawn(move || loop {
            thread::sleep(POWER_ACTIVITY_WATCHDOG_INTERVAL);
            let should_continue = match state.lock() {
                Ok(mut state) => {
                    prune_expired_requests(&mut state);
                    if let Err(error)=sync_keep_awake(&mut state) {eprintln!("Power activity refresh failed: {error}");}
                    if state.requests.is_empty() {
                        state.watchdog_running = false;
                        false
                    } else {
                        true
                    }
                }
                Err(_) => false,
            };
            if !should_continue {
                break;
            }
        })
        .map(|_| true)
        .unwrap_or(false)
}

fn sync_keep_awake(state: &mut PowerActivityState) -> Result<(),String> {
    if state.requests.is_empty() {
        if let Some(mut handle) = state.keep_awake.take() {
            handle.stop();
        }
        return Ok(());
    }

    if state.keep_awake.as_mut().is_some_and(KeepAwakeHandle::alive) {
        return Ok(());
    }
    if let Some(mut handle)=state.keep_awake.take() {handle.stop();}

    match KeepAwakeHandle::start() {
        Ok(handle) => {
            state.keep_awake = Some(handle);
            Ok(())
        }
        Err(error) => {
            Err(error)
        }
    }
}

#[cfg(all(target_os = "macos", not(test)))]
struct KeepAwakeHandle {
    child: Child,
}

#[cfg(all(windows, not(test)))]
struct KeepAwakeHandle {
    stop_tx: Option<mpsc::Sender<()>>,
    thread: Option<JoinHandle<()>>,
}

#[cfg(all(target_os="linux",not(test)))]
struct KeepAwakeHandle {
    connection:gio::DBusConnection,
    fd:Option<std::os::fd::OwnedFd>,
}

#[cfg(any(test, not(any(target_os = "macos", target_os="linux", windows))))]
struct KeepAwakeHandle;

#[cfg(all(target_os = "macos", not(test)))]
impl KeepAwakeHandle {
    fn start() -> Result<Self, String> {
        // `-w <pid>` binds the assertion to this process: if the app crashes
        // without running stop(), caffeinate exits on its own instead of
        // blocking system sleep until reboot.
        let child = Command::new("caffeinate")
            .arg("-i")
            .arg("-w")
            .arg(std::process::id().to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("spawn caffeinate failed: {error}"))?;
        Ok(Self { child })
    }

    fn stop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
    fn alive(&mut self)->bool {matches!(self.child.try_wait(),Ok(None))}
}

#[cfg(all(target_os="linux",not(test)))]
impl KeepAwakeHandle {
    fn start()->Result<Self,String>{
        use gio::prelude::*;
        use gio::glib::variant::ToVariant;
        use std::os::fd::FromRawFd;
        let connection=gio::bus_get_sync(gio::BusType::System,gio::Cancellable::NONE).map_err(|error|format!("System power bus unavailable: {error}"))?;
        connection.set_exit_on_close(false);
        let parameters=("sleep:idle","Xgent","Original task work in progress","block").to_variant();
        let (reply,fds)=connection.call_with_unix_fd_list_sync(Some("org.freedesktop.login1"),"/org/freedesktop/login1","org.freedesktop.login1.Manager","Inhibit",Some(&parameters),None,gio::DBusCallFlags::NONE,5000,None::<&gio::UnixFDList>,gio::Cancellable::NONE)
            .map_err(|error|format!("System sleep inhibitor unavailable: {error}"))?;
        let (index,)=reply.get::<(gio::glib::variant::Handle,)>().ok_or("System sleep inhibitor returned an invalid handle")?;
        let raw=fds.get(index.0).map_err(|error|error.to_string())?;
        if raw<0 {return Err("System sleep inhibitor returned an invalid descriptor".into());}
        // g_unix_fd_list_get duplicates the FD; its caller owns this copy.
        // Dropping it (including process death) releases our actual lock.
        let fd=unsafe {std::os::fd::OwnedFd::from_raw_fd(raw)};
        Ok(Self{connection,fd:Some(fd)})
    }
    fn stop(&mut self){self.fd.take();}
    fn alive(&mut self)->bool {self.fd.is_some() && !self.connection.is_closed()}
}

#[cfg(any(test, not(any(target_os = "macos", target_os="linux", windows))))]
impl KeepAwakeHandle {
    fn start() -> Result<Self, String> {
        Ok(Self)
    }

    fn stop(&mut self) {}
    fn alive(&mut self)->bool {true}
}

#[cfg(all(windows, not(test)))]
impl KeepAwakeHandle {
    fn alive(&mut self)->bool {self.thread.as_ref().is_some_and(|handle|!handle.is_finished())}
    fn start() -> Result<Self, String> {
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let thread = thread::Builder::new()
            .name("xgent-keep-awake".to_string())
            .spawn(move || {
                let start_result = set_windows_keep_awake(true);
                let should_wait = start_result.is_ok();
                let _ = ready_tx.send(start_result);
                if should_wait {
                    let _ = stop_rx.recv();
                    if let Err(error) = set_windows_keep_awake(false) {
                        eprintln!("stop Windows power activity keep-awake failed: {error}");
                    }
                }
            })
            .map_err(|error| format!("spawn Windows keep-awake thread failed: {error}"))?;

        match ready_rx.recv_timeout(Duration::from_secs(2)) {
            Ok(Ok(())) => Ok(Self {
                stop_tx: Some(stop_tx),
                thread: Some(thread),
            }),
            Ok(Err(error)) => {
                let _ = thread.join();
                Err(error)
            }
            Err(error) => {
                let _ = stop_tx.send(());
                let _ = thread.join();
                Err(format!("start Windows keep-awake timed out: {error}"))
            }
        }
    }

    fn stop(&mut self) {
        if let Some(stop_tx) = self.stop_tx.take() {
            let _ = stop_tx.send(());
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[cfg(all(windows, not(test)))]
fn set_windows_keep_awake(active: bool) -> Result<(), String> {
    const ES_CONTINUOUS: u32 = 0x8000_0000;
    const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;
    const ES_DISPLAY_REQUIRED: u32 = 0x0000_0002;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn SetThreadExecutionState(es_flags: u32) -> u32;
    }

    let flags = if active {
        ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
    } else {
        ES_CONTINUOUS
    };
    let previous = unsafe { SetThreadExecutionState(flags) };
    if previous == 0 {
        Err(format!(
            "SetThreadExecutionState failed: {}",
            io::Error::last_os_error()
        ))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::PowerActivityManager;
    use std::collections::HashMap;

    #[test]
    fn tracks_request_lifecycle() {
        let activity = PowerActivityManager::default();

        activity.begin("req-a", "conversation", None).unwrap();
        activity.begin("req-b", "cron", None).unwrap();

        assert_eq!(
            activity.snapshot(),
            HashMap::from([
                ("req-a".to_string(), "conversation".to_string()),
                ("req-b".to_string(), "cron".to_string()),
            ]),
        );

        activity.end("req-a");

        assert_eq!(
            activity.snapshot(),
            HashMap::from([("req-b".to_string(), "cron".to_string())]),
        );
    }

    #[test]
    fn ignores_empty_activity_id() {
        let activity = PowerActivityManager::default();

        assert!(activity.begin("", "noop", None).is_err());
        activity.end("");

        assert!(activity.snapshot().is_empty());
    }
}
