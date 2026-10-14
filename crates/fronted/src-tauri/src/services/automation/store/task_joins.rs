//! Native joins supplement explicit waits without changing saved requirements
//! or evidence. Only retained original operations are registered.
use super::*;

pub(super) fn unfinished_child_call(conn: &Connection, id: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT c.call_id FROM automation_background_children c WHERE c.execution_id=?1
         AND c.issuer_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1')
         AND (c.terminal_confirmed=0 OR (c.cancel_requested=1 AND c.cancel_acknowledged=0))
         ORDER BY c.issued_at,c.call_id LIMIT 1",
        params![id], |row| row.get(0),
    ).optional().map_err(|e| e.to_string())
}

impl AutomationStore {
    pub(super) fn stage_background_task_joins(conn: &Connection, id: &str, wait: &str) -> Result<(), String> {
        // Re-parking changes the occurrence, never rearms a terminal event.
        conn.execute(
            "INSERT INTO automation_background_task_joins (execution_id,kind,call_id,wait_id,wake_consumed)
             SELECT c.execution_id,'child',c.call_id,?2,COALESCE((SELECT MAX(w.wake_consumed) FROM automation_background_child_waits w WHERE w.execution_id=c.execution_id AND w.call_id=c.call_id),0)
             FROM automation_background_children c WHERE c.execution_id=?1
             AND c.issuer_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1')
             ON CONFLICT(execution_id,kind,call_id) DO UPDATE SET wait_id=excluded.wait_id,retry_at=0",
            params![id,wait],
        ).map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO automation_background_task_joins (execution_id,kind,call_id,wait_id)
             SELECT c.execution_id,'cloud',c.call_id,?2 FROM automation_background_cloud_launches c
             WHERE c.execution_id=?1 AND c.result_json IS NOT NULL
             ON CONFLICT(execution_id,kind,call_id) DO UPDATE SET wait_id=excluded.wait_id,retry_at=0",
            params![id,wait],
        ).map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO automation_background_task_joins (execution_id,kind,call_id,wait_id,wake_consumed)
             SELECT v.execution_id,'video',v.call_id,?2,v.wake_ack FROM automation_video_jobs v WHERE v.execution_id=?1
             AND v.issuer_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1')
             ON CONFLICT(execution_id,kind,call_id) DO UPDATE SET wait_id=excluded.wait_id,retry_at=0",
            params![id,wait],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub(super) fn has_terminal_background_task_join(conn: &Connection, id: &str, wait: &str) -> Result<bool, String> {
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM automation_background_task_joins j WHERE j.execution_id=?1 AND j.wait_id=?2 AND j.wake_consumed=0 AND (
               (j.kind='child' AND EXISTS(SELECT 1 FROM automation_background_children c WHERE c.execution_id=j.execution_id AND c.call_id=j.call_id AND c.terminal_confirmed=1 AND (c.cancel_requested=0 OR c.cancel_acknowledged=1) AND c.issuer_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1')))
               OR (j.kind='video' AND EXISTS(SELECT 1 FROM automation_video_jobs v WHERE v.execution_id=j.execution_id AND v.call_id=j.call_id AND v.terminal_at IS NOT NULL AND v.wake_ack=0 AND v.issuer_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1')))
               OR (j.kind='cloud' AND EXISTS(SELECT 1 FROM automation_background_cloud_launches c JOIN automation_background_cloud_completions p ON p.execution_id=c.execution_id AND p.call_id=c.call_id AND p.task_id=c.task_id AND (c.owner='' OR c.owner=p.owner COLLATE NOCASE) AND c.repository=p.repository COLLATE NOCASE WHERE c.execution_id=j.execution_id AND c.call_id=j.call_id))
             ))",
            params![id,wait], |row| row.get(0),
        ).map_err(|e| e.to_string())
    }

    pub(super) fn consume_background_task_joins(conn: &Connection, id: &str, wait: &str) -> Result<(), String> {
        // Adopt legacy explicit waits in the same resumption transaction.
        // Any authorized resume observes the currently retained native events;
        // those same events must not cause another model turn after re-parking.
        Self::stage_background_task_joins(conn,id,wait)?;
        conn.execute(
            "UPDATE automation_background_task_joins AS j SET wake_consumed=1 WHERE j.execution_id=?1 AND j.wait_id=?2 AND (
               (j.kind='child' AND EXISTS(SELECT 1 FROM automation_background_children c WHERE c.execution_id=j.execution_id AND c.call_id=j.call_id AND c.terminal_confirmed=1 AND (c.cancel_requested=0 OR c.cancel_acknowledged=1) AND c.issuer_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1')))
               OR (j.kind='video' AND EXISTS(SELECT 1 FROM automation_video_jobs v WHERE v.execution_id=j.execution_id AND v.call_id=j.call_id AND v.terminal_at IS NOT NULL AND v.issuer_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1')))
               OR (j.kind='cloud' AND EXISTS(SELECT 1 FROM automation_background_cloud_launches c JOIN automation_background_cloud_completions p ON p.execution_id=c.execution_id AND p.call_id=c.call_id AND p.task_id=c.task_id AND (c.owner='' OR c.owner=p.owner COLLATE NOCASE) AND c.repository=p.repository COLLATE NOCASE WHERE c.execution_id=j.execution_id AND c.call_id=j.call_id))
             )",
            params![id,wait],
        ).map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR IGNORE INTO automation_background_child_wait_events (execution_id,call_id,wait_id,consumed_at)
             SELECT c.execution_id,c.call_id,json_extract(c.observed_json,'$.waiting.waitId'),?3
             FROM automation_background_task_joins j JOIN automation_background_children c ON c.execution_id=j.execution_id AND c.call_id=j.call_id
             WHERE j.execution_id=?1 AND j.wait_id=?2 AND j.kind='child' AND c.observed_state='waiting' AND c.cancel_requested=0
             AND c.issuer_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1')
             AND json_type(c.observed_json,'$.waiting.waitId')='text' AND LENGTH(json_extract(c.observed_json,'$.waiting.waitId'))=36",
            params![id,wait,db::now_ms()],
        ).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE automation_background_child_waits SET wake_consumed=1 WHERE execution_id=?1 AND call_id IN
             (SELECT j.call_id FROM automation_background_task_joins j WHERE j.execution_id=?1 AND j.wait_id=?2 AND j.kind='child' AND j.wake_consumed=1)",
            params![id,wait],
        ).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE automation_video_jobs SET wake_ack=1 WHERE execution_id=?1 AND call_id IN
             (SELECT j.call_id FROM automation_background_task_joins j WHERE j.execution_id=?1 AND j.wait_id=?2 AND j.kind='video' AND j.wake_consumed=1)",
            params![id,wait],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }
}
