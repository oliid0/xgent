//! Attention delays only not-yet-started proactive events. No task authority,
//! credentials, cancellation, foreground model flow or connector grant changes.
use super::*;

const TTL_MS: i64 = 30_000;

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ForegroundAttentionInput {
    pub session_id: String,
    pub sequence: u64,
    pub busy: bool,
    pub issued_at: i64,
}

pub(super) fn is_foreground_busy(conn: &Connection, now: i64) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM automation_foreground_attention a
         WHERE a.host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1')
         AND a.closed=0 AND a.issued_at<=?1 AND a.observed_at<=?1
         AND a.expires_at>?1 AND a.expires_at<=?1+30000)",
        params![now], |row| row.get(0),
    ).map_err(|e|e.to_string())
}

impl AutomationStore {
    pub fn observe_foreground_attention(&self, input: ForegroundAttentionInput) -> Result<(), String> {
        if !Uuid::parse_str(&input.session_id).is_ok_and(|id|id.to_string()==input.session_id)
            || input.sequence==0 || input.sequence>9_007_199_254_740_990
            || input.issued_at<=0 || input.issued_at>8_640_000_000_000_000 {
            return Err("Invalid foreground attention observation".into());
        }
        let host=self.background_worker_identity()?;
        let mut conn=self.lock_conn()?;
        let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
        let now=db::now_ms();
        // Late IPC cannot renew a retired observation after its tombstone was
        // pruned. Clock changes cannot extend attention beyond one short TTL.
        if input.issued_at>now || now-input.issued_at>=TTL_MS { return Ok(()); }
        tx.execute("DELETE FROM automation_foreground_attention WHERE expires_at<?1",params![now-TTL_MS]).map_err(|e|e.to_string())?;
        let count:i64=tx.query_row("SELECT COUNT(*) FROM automation_foreground_attention",[],|row|row.get(0)).map_err(|e|e.to_string())?;
        let existing:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM automation_foreground_attention WHERE session_id=?1)",params![input.session_id],|row|row.get(0)).map_err(|e|e.to_string())?;
        if !existing && count>=64 { return Err("Foreground attention observation capacity reached".into()); }
        tx.execute(
            "INSERT INTO automation_foreground_attention(session_id,host_id,sequence,closed,issued_at,observed_at,expires_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7)
             ON CONFLICT(session_id) DO UPDATE SET sequence=excluded.sequence,closed=excluded.closed,
                 issued_at=excluded.issued_at,observed_at=excluded.observed_at,expires_at=excluded.expires_at
             WHERE automation_foreground_attention.host_id=excluded.host_id
             AND automation_foreground_attention.closed=0
             AND excluded.sequence>automation_foreground_attention.sequence",
            params![input.session_id,host,input.sequence as i64,!input.busy,input.issued_at,now,input.issued_at+TTL_MS],
        ).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e|e.to_string())?;
        Ok(())
    }
}
