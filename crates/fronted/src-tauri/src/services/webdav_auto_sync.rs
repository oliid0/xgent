
//!



use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Mutex, OnceLock,
};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::{sync::mpsc, time::Duration};

const DEBOUNCE: Duration = Duration::from_secs(1);
const MAX_WAIT: Duration = Duration::from_secs(10);

const STATUS_EVENT: &str = "backup-sync-status-updated";

static DIRTY_TX: OnceLock<mpsc::Sender<()>> = OnceLock::new();
static SUPPRESSION: AtomicUsize = AtomicUsize::new(0);
static CACHED_SKILLS: OnceLock<Mutex<Option<Value>>> = OnceLock::new();

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AutoSyncStatus {
        last_sync_at: Option<i64>,
    last_error: Option<String>,
}

fn skills_cache() -> &'static Mutex<Option<Value>> {
    CACHED_SKILLS.get_or_init(|| Mutex::new(None))
}

pub struct AutoSyncSuppressionGuard;

impl Drop for AutoSyncSuppressionGuard {
    fn drop(&mut self) {
        SUPPRESSION.fetch_sub(1, Ordering::SeqCst);
    }
}


pub fn suppress() -> AutoSyncSuppressionGuard {
    SUPPRESSION.fetch_add(1, Ordering::SeqCst);
    AutoSyncSuppressionGuard
}

pub fn mark_dirty() {
    if suppressed() {
        return;
    }
    if let Some(tx) = DIRTY_TX.get() {
        
        let _ = tx.try_send(());
    }
}

fn suppressed() -> bool {
    SUPPRESSION.load(Ordering::SeqCst) > 0
}


pub fn cache_skills(skills: Option<Value>) {
    if let Ok(mut slot) = skills_cache().lock() {
        *slot = skills;
    }
}

fn cached_skills() -> Option<Value> {
    skills_cache().lock().ok().and_then(|slot| slot.clone())
}

pub fn start(app: AppHandle) {
    let (tx, rx) = mpsc::channel(1);
    if DIRTY_TX.set(tx).is_err() {
        return;
    }
    tauri::async_runtime::spawn(run(app, rx));
}

async fn run(app: AppHandle, mut rx: mpsc::Receiver<()>) {
    loop {
        
        if rx.recv().await.is_none() {
            return;
        }

        let cap = tokio::time::sleep(MAX_WAIT);
        tokio::pin!(cap);
        loop {
            tokio::select! {
                
                _ = tokio::time::sleep(DEBOUNCE) => break,
                
                _ = &mut cap => break,
                signal = rx.recv() => {
                    if signal.is_none() {
                        return;
                    }
                }
            }
        }

        sync_once(&app).await;
    }
}

async fn sync_once(app: &AppHandle) {
    
    //
    
    
    
    
    //
    
    
    if suppressed() {
        if let Some(tx) = DIRTY_TX.get() {
            let _ = tx.try_send(());
        }
        return;
    }

    match crate::commands::settings::auto_upload_backup_snapshot(cached_skills()).await {
        
        Ok(None) => {}
        Ok(Some(last_sync_at)) => emit_status(
            app,
            AutoSyncStatus {
                last_sync_at: Some(last_sync_at),
                last_error: None,
            },
        ),
        
        Err(error) => emit_status(
            app,
            AutoSyncStatus {
                last_sync_at: None,
                last_error: Some(error),
            },
        ),
    }
}

fn emit_status(app: &AppHandle, status: AutoSyncStatus) {
    if let Err(error) = app.emit(STATUS_EVENT, status) {
        eprintln!("failed to emit backup sync status: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

            #[test]
    fn suppression_is_reference_counted_and_gates_dirty_marks() {
        assert!(!suppressed(), "初始状态不应处于抑制期");

        let outer = suppress();
        assert!(suppressed());
        
        mark_dirty();

        {
            let _inner = suppress();
            assert!(suppressed());
        }
        
        assert!(suppressed(), "仍有外层 guard 存活时必须保持抑制");

        drop(outer);
        assert!(!suppressed(), "全部 guard 释放后应恢复标脏");
    }

        #[test]
    fn dirty_channel_coalesces_bursts_into_one_signal() {
        let (tx, mut rx) = mpsc::channel::<()>(1);
        for _ in 0..5 {
            let _ = tx.try_send(());
        }
        assert!(rx.try_recv().is_ok());
        assert!(rx.try_recv().is_err(), "5 次变更只应留下 1 个待处理信号");
    }

        #[test]
    fn skills_cache_round_trips_and_clears_to_none() {
        cache_skills(Some(serde_json::json!({ "enabled": ["a"] })));
        assert_eq!(
            cached_skills(),
            Some(serde_json::json!({ "enabled": ["a"] }))
        );
        cache_skills(None);
        assert!(cached_skills().is_none());
    }
}
