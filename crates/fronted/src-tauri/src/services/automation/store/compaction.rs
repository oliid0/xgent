use sha2::{Digest, Sha256};
use super::*;

const MAX_COMPACTIONS: i64 = 32;
const MAX_ARCHIVE_BYTES: i64 = 32 * 1024 * 1024;
const MAX_SUMMARY_BYTES: usize = 64 * 1024;
const ARCHIVE_CHUNK_BYTES: usize = 16 * 1024;

impl AutomationStore {
    /// Archive the actual acknowledged checkpoint and replace it atomically.
    /// The client must not continue with a summary before this commit succeeds.
    pub fn compact_background_context(
        &self, input: CompactBackgroundContextInput,
        verify: impl FnOnce(&Connection, &str) -> Result<(), String>,
    ) -> Result<u64, String> {
        if input.source_revision == 0 || input.source_revision >= i64::MAX as u64 {
            return Err("Invalid compaction source revision".to_string());
        }
        let context_json = super::journal::background_context_json(&input.context)?;
        let context_hash = format!("{:x}", Sha256::digest(context_json.as_bytes()));
        let summary_json = serde_json::to_string(&input.summary).map_err(|e| e.to_string())?;
        if summary_json.len() > MAX_SUMMARY_BYTES
            || input.summary.get("api").and_then(Value::as_str) != Some("xgent-compaction")
            || !input.summary.get("promptVersion").is_some_and(Value::is_string) {
            return Err("Compaction needs a bounded validated checkpoint summary".to_string());
        }
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        Self::require_background_execution(&tx, &input.execution_id, input.lease.as_ref())?;
        verify(&tx, &input.execution_id)?;
        if Self::has_uncertain_operations(&tx, &input.execution_id)? {
            return Err("Reconcile unfinished or uncertain operations before compacting background context".to_string());
        }
        let next = input.source_revision + 1;
        let (current, source): (u64, String) = tx.query_row(
            "SELECT revision, context_json FROM automation_background_checkpoints WHERE execution_id = ?1",
            params![input.execution_id], |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(|e| e.to_string())?.ok_or_else(|| "Persist the source context before compaction".to_string())?;
        let existing: Option<(String, String)> = tx.query_row(
            "SELECT context_hash, summary_json FROM automation_background_compactions WHERE execution_id = ?1 AND source_revision = ?2",
            params![input.execution_id, input.source_revision as i64], |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(|e| e.to_string())?;
        if let Some((hash, summary)) = existing {
            if hash != context_hash || summary != summary_json {
                return Err("Compaction revision is already bound to a different context or summary".to_string());
            }
            if current != next || format!("{:x}", Sha256::digest(source.as_bytes())) != context_hash {
                return Err("Compaction was archived but the current checkpoint has advanced; do not restore an older context".to_string());
            }
            return Ok(next);
        }
        if current != input.source_revision { return Err("Compaction source revision conflict".to_string()); }
        if context_json.len() >= source.len() { return Err("Compaction did not reduce persisted context".to_string()); }
        let raw: String = tx.query_row("SELECT input_json FROM automation_background_tasks WHERE execution_id = ?1",
            params![input.execution_id], |row| row.get(0)).map_err(|e| e.to_string())?;
        let accepted: SubmitBackgroundTaskInput = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        if !input.context["messages"].as_array().is_some_and(|messages| messages.iter().any(|message|
            message["role"].as_str() == Some("user") && message["content"].as_str() == Some(accepted.prompt.as_str()))) {
            return Err("Compacted context must retain the exact accepted user request".to_string());
        }
        let (count, bytes): (i64, i64) = tx.query_row(
            "SELECT COUNT(*), COALESCE(SUM(LENGTH(CAST(source_context_json AS BLOB)) + LENGTH(CAST(summary_json AS BLOB))), 0)
             FROM automation_background_compactions WHERE execution_id = ?1",
            params![input.execution_id], |row| Ok((row.get(0)?, row.get(1)?)),
        ).map_err(|e| e.to_string())?;
        if count >= MAX_COMPACTIONS || bytes + source.len() as i64 + summary_json.len() as i64 > MAX_ARCHIVE_BYTES {
            return Err("Background context archive quota exceeded; old evidence was retained".to_string());
        }
        let source_hash = format!("{:x}", Sha256::digest(source.as_bytes()));
        let now = db::now_ms();
        tx.execute(
            "INSERT INTO automation_background_compactions (execution_id, source_revision, checkpoint_revision, source_context_json, source_hash, context_hash, summary_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![input.execution_id, current as i64, next as i64, source, source_hash, context_hash, summary_json, now],
        ).map_err(|e| e.to_string())?;
        let changed = tx.execute(
            "UPDATE automation_background_checkpoints SET revision = ?3, context_json = ?4, updated_at = ?5 WHERE execution_id = ?1 AND revision = ?2",
            params![input.execution_id, current as i64, next as i64, context_json, now],
        ).map_err(|e| e.to_string())?;
        if changed != 1 { return Err("Compaction checkpoint was not replaced".to_string()); }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(next)
    }

    pub fn list_background_compactions(&self, execution_id: &str, cursor: u64, lease: Option<&BackgroundExecutionLease>) -> Result<BackgroundCompactionPage, String> {
        if cursor > i64::MAX as u64 { return Err("Invalid archive cursor".to_string()); }
        let conn = self.lock_conn()?;
        Self::require_background_execution(&conn, execution_id, lease)?;
        let mut stmt = conn.prepare(
            "SELECT source_revision, checkpoint_revision, source_hash, LENGTH(CAST(source_context_json AS BLOB)), created_at
             FROM automation_background_compactions WHERE execution_id = ?1 AND source_revision > ?2 ORDER BY source_revision ASC LIMIT 11",
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![execution_id, cursor as i64], |row| Ok(BackgroundCompactionRecord {
            source_revision: row.get(0)?, checkpoint_revision: row.get(1)?, source_hash: row.get(2)?, source_bytes: row.get(3)?, created_at: row.get(4)?,
        })).map_err(|e| e.to_string())?;
        let mut compactions = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        let next_cursor = if compactions.len() > 10 {
            compactions.truncate(10);
            compactions.last().map(|record| record.source_revision)
        } else { None };
        Ok(BackgroundCompactionPage { compactions, next_cursor })
    }

    pub fn read_background_context_archive(&self, execution_id: &str, source_revision: u64, offset: usize, lease: Option<&BackgroundExecutionLease>) -> Result<BackgroundContextArchiveChunk, String> {
        if source_revision == 0 {
            let source = self.load_background_source_context(execution_id, lease)?
                .ok_or_else(|| "This task has no accepted source conversation".to_string())?;
            let raw = serde_json::to_string(&source).map_err(|e| e.to_string())?;
            return Self::context_archive_chunk(&raw, format!("{:x}", Sha256::digest(raw.as_bytes())), 0, offset);
        }
        if source_revision > i64::MAX as u64 { return Err("Invalid archive revision".to_string()); }
        let conn = self.lock_conn()?;
        Self::require_background_execution(&conn, execution_id, lease)?;
        let (source, source_hash): (String, String) = conn.query_row(
            "SELECT source_context_json, source_hash FROM automation_background_compactions WHERE execution_id = ?1 AND source_revision = ?2",
            params![execution_id, source_revision as i64], |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional().map_err(|e| e.to_string())?.ok_or_else(|| "Context archive not found for this execution".to_string())?;
        Self::context_archive_chunk(&source, source_hash, source_revision, offset)
    }

    fn context_archive_chunk(source: &str, source_hash: String, source_revision: u64, offset: usize) -> Result<BackgroundContextArchiveChunk, String> {
        if offset > source.len() || !source.is_char_boundary(offset) { return Err("Archive offset must be a valid UTF-8 byte boundary".to_string()); }
        let mut end = offset.saturating_add(ARCHIVE_CHUNK_BYTES).min(source.len());
        while !source.is_char_boundary(end) { end -= 1; }
        Ok(BackgroundContextArchiveChunk {
            source_revision, source_hash, total_bytes: source.len(), offset,
            text: source[offset..end].to_string(), next_offset: if end < source.len() { Some(end) } else { None },
        })
    }
}
