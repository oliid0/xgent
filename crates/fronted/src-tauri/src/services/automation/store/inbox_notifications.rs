use super::*;

impl AutomationStore {
    /// Fair bounded OS-delivery candidates, independent of in-app card capacity.
    /// Read/superseded/already accepted receipts cannot starve newer results.
    pub(crate) fn pending_background_notifications(&self, limit: usize) -> Result<Vec<String>, String> {
        if !(1..=20).contains(&limit) { return Err("Result notification batch is outside its bound".into()); }
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT i.entry_id FROM automation_result_inbox i WHERE i.read_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM automation_result_inbox newer WHERE newer.request_id = i.request_id AND newer.sequence > i.sequence)
             AND NOT EXISTS (SELECT 1 FROM automation_result_notifications n WHERE n.entry_id = i.entry_id)
             ORDER BY i.sequence ASC LIMIT ?1"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![limit], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    /// Only this device's latest unread immutable receipt can originate a notice.
    /// OS acceptance is independent of read_at and artifact download receipts.
    pub fn background_inbox_notification_status(&self, id: &str) -> Result<String, String> {
        if Uuid::parse_str(id).map_err(|e| e.to_string())?.to_string() != id {
            return Err("A canonical inbox entry ID is required".into());
        }
        let conn = self.lock_conn()?;
        let row: Option<(bool, bool)> = conn.query_row(
            "SELECT i.read_at IS NULL AND NOT EXISTS (SELECT 1 FROM automation_result_inbox newer WHERE newer.request_id = i.request_id AND newer.sequence > i.sequence), EXISTS (SELECT 1 FROM automation_result_notifications n WHERE n.entry_id = i.entry_id) FROM automation_result_inbox i WHERE i.entry_id = ?1",
            params![id], |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(|e| e.to_string())?;
        match row {
            None => Err("Inbox entry not found on this device".into()),
            Some((false, _)) => Ok("obsolete".into()),
            Some((true, true)) => Ok("accepted".into()),
            Some((true, false)) => Ok("ready".into()),
        }
    }

    pub fn record_background_notification_accepted(&self, id: &str) -> Result<(), String> {
        let conn = self.lock_conn()?;
        conn.execute(
            "INSERT INTO automation_result_notifications (entry_id, accepted_at) SELECT entry_id, ?2 FROM automation_result_inbox WHERE entry_id = ?1 ON CONFLICT(entry_id) DO NOTHING",
            params![id, db::now_ms()],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }
}
