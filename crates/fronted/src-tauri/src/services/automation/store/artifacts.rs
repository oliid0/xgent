use std::io::{Read, Seek, SeekFrom};

use base64::{engine::general_purpose::STANDARD, Engine};
use sha2::{Digest, Sha256};

use super::*;

const MAX_ARTIFACT_BYTES: usize = 8 * 1024 * 1024;
const MAX_TASK_ARTIFACT_BYTES: i64 = 1024 * 1024 * 1024;
const MAX_TASK_ARTIFACTS: i64 = 32;

impl AutomationStore {
    pub(super) fn artifact_manifest(conn: &Connection, execution_id: &str) -> Result<Vec<BackgroundArtifact>, String> {
        let mut stmt = conn.prepare(
            "SELECT artifact_id, relative_path, content_hash, bytes FROM automation_background_artifacts
             WHERE execution_id = ?1 ORDER BY created_at ASC, artifact_id ASC",
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![execution_id], |row| Ok(BackgroundArtifact {
            id: row.get(0)?, relative_path: row.get(1)?, content_hash: row.get(2)?, bytes: row.get(3)?,
        })).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    /// Snapshot actual bytes while the task owns a live lease. Client reads
    /// address this immutable snapshot, never a host path supplied by a peer.
    pub fn publish_background_artifact(&self, execution_id: &str, path: &str, expected_hash: Option<&str>, lease: Option<&BackgroundExecutionLease>) -> Result<BackgroundArtifact, String> {
        let workdir: String = {
            let conn = self.lock_conn()?;
            Self::require_background_execution(&conn, execution_id, lease)?;
            conn.query_row(
                "SELECT b.input_json FROM automation_background_tasks b
                 JOIN automation_cron_runs r ON r.execution_id = b.execution_id
                 WHERE b.execution_id = ?1 AND r.state = 'leased' AND r.lease_expires_at > ?2",
                params![execution_id, db::now_ms()], |row| row.get::<_, String>(0),
            ).optional().map_err(|e| e.to_string())?
                .ok_or_else(|| "Artifact publication requires a live background task lease".to_string())?
        };
        let input: SubmitBackgroundTaskInput = serde_json::from_str(&workdir).map_err(|e| e.to_string())?;
        let root = std::fs::canonicalize(&input.workdir).map_err(|e| e.to_string())?;
        let candidate = std::path::Path::new(path);
        let resolved = std::fs::canonicalize(if candidate.is_absolute() { candidate.to_path_buf() } else { root.join(candidate) })
            .map_err(|e| e.to_string())?;
        let relative = resolved.strip_prefix(&root)
            .map_err(|_| "Artifact must be inside the task workspace".to_string())?;
        let relative_path = relative.to_str().ok_or_else(|| "Artifact path must be UTF-8".to_string())?.replace('\\', "/");
        let file = std::fs::File::open(&resolved).map_err(|e| e.to_string())?;
        let meta = file.metadata().map_err(|e| e.to_string())?;
        if !meta.is_file() || meta.len() > super::MAX_STREAM_ARTIFACT_BYTES {
            return Err("Artifact must be a regular file of at most 512 MiB".to_string());
        }
        if meta.len()>MAX_ARTIFACT_BYTES as u64 {
            let mut stream=file;let mut hash=Sha256::new();let mut total=0u64;let mut buffer=[0u8;65536];
            loop {let count=stream.read(&mut buffer).map_err(|e|e.to_string())?;if count==0 {break;}total+=count as u64;
                if total>meta.len() {return Err("Artifact size changed before its snapshot".into());}hash.update(&buffer[..count]);}
            if total!=meta.len() {return Err("Artifact size changed before its snapshot".into());}
            let digest=format!("{:x}",hash.finalize());
            if expected_hash.is_some_and(|expected|expected!=digest) {return Err("Artifact changed after the tool write".into());}
            stream.seek(SeekFrom::Start(0)).map_err(|e|e.to_string())?;
            let mut conn=self.lock_conn()?;
            let tx=conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|e.to_string())?;
            Self::require_background_execution(&tx,execution_id,lease)?;
            let existing:Option<(String,u64)>=tx.query_row("SELECT artifact_id,bytes FROM automation_background_artifacts WHERE execution_id=?1 AND relative_path=?2 AND content_hash=?3",
                params![execution_id,relative_path,digest],|row|Ok((row.get(0)?,row.get(1)?))).optional().map_err(|e|e.to_string())?;
            let artifact=if let Some((id,bytes))=existing {
                if bytes!=meta.len() {return Err("Existing artifact length disagrees with its hash".into());}
                let artifact=BackgroundArtifact {id,relative_path,content_hash:digest,bytes};
                super::ArtifactReader::new(&tx,artifact.clone())?.verify_hash()?;artifact
            } else {super::artifact_parts::write_snapshot(&tx,execution_id,&relative_path,meta.len(),Some(&digest),&mut stream)?};
            Self::require_background_execution(&tx,execution_id,lease)?;
            tx.commit().map_err(|e|e.to_string())?;return Ok(artifact);
        }
        let mut content = Vec::new();
        file.take((MAX_ARTIFACT_BYTES + 1) as u64).read_to_end(&mut content).map_err(|e| e.to_string())?;
        if content.len() > MAX_ARTIFACT_BYTES { return Err("Artifact exceeds 8 MiB".to_string()); }
        let content_hash = format!("{:x}", Sha256::digest(&content));
        if expected_hash.is_some_and(|hash| hash != content_hash) {
            return Err("Artifact changed after the tool write; refusing to publish different bytes".to_string());
        }
        let mut conn = self.lock_conn()?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        Self::require_background_execution(&tx, execution_id, lease)?;
        let live: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM automation_cron_runs WHERE execution_id = ?1 AND state = 'leased' AND lease_expires_at > ?2)",
            params![execution_id, db::now_ms()], |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        if !live { return Err("Background task stopped before artifact publication".to_string()); }
        let existing: Option<String> = tx.query_row(
            "SELECT artifact_id FROM automation_background_artifacts WHERE execution_id = ?1 AND relative_path = ?2 AND content_hash = ?3",
            params![execution_id, relative_path, content_hash], |row| row.get(0),
        ).optional().map_err(|e| e.to_string())?;
        let id = if let Some(id) = existing { id } else {
            let (count, bytes): (i64, i64) = tx.query_row(
                "SELECT COUNT(*), COALESCE(SUM(bytes), 0) FROM automation_background_artifacts WHERE execution_id = ?1",
                params![execution_id], |row| Ok((row.get(0)?, row.get(1)?)),
            ).map_err(|e| e.to_string())?;
            if count >= MAX_TASK_ARTIFACTS || bytes + content.len() as i64 > MAX_TASK_ARTIFACT_BYTES {
                return Err("Task artifact quota exceeded (32 files / 1 GiB)".to_string());
            }
            let id = Uuid::new_v4().to_string();
            tx.execute(
                "INSERT INTO automation_background_artifacts (artifact_id, execution_id, relative_path, content_hash, bytes, content, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![id, execution_id, relative_path, content_hash, content.len() as i64, content, db::now_ms()],
            ).map_err(|e| e.to_string())?;
            id
        };
        tx.commit().map_err(|e| e.to_string())?;
        Ok(BackgroundArtifact { id, relative_path, content_hash, bytes: content.len() as u64 })
    }

    pub fn read_background_artifact(&self, request_id: &str, artifact_id: &str) -> Result<BackgroundArtifactContent, String> {
        let conn = self.lock_conn()?;
        Self::read_background_artifact_content(&conn, request_id, artifact_id)
    }

    /// Composition reads only this execution's retained immutable bytes. A
    /// child artifact must already have been imported with its provenance.
    pub(crate) fn read_background_execution_artifact(&self, execution_id: &str, artifact_id: &str,
        lease: &BackgroundExecutionLease,
        load: impl FnOnce(&Connection, &SubmitBackgroundTaskInput) -> Result<(String, Value), String>,
    ) -> Result<BackgroundArtifactContent, String> {
        let conn = self.lock_conn()?;
        Self::verify_background_configuration(&conn, execution_id, Some(lease), load)?;
        let request_id: String = conn.query_row(
            "SELECT request_id FROM automation_background_tasks WHERE execution_id = ?1",
            params![execution_id], |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        let content = Self::read_background_artifact_content(&conn, &request_id, artifact_id)?;
        Self::require_background_execution(&conn, execution_id, Some(lease))?;
        Ok(content)
    }

    pub(super) fn read_background_artifact_content(conn: &Connection, request_id: &str, artifact_id: &str) -> Result<BackgroundArtifactContent, String> {
        let (artifact, content) = conn.query_row(
            "SELECT a.artifact_id, a.relative_path, a.content_hash, a.bytes, a.content
             FROM automation_background_artifacts a JOIN automation_background_tasks b ON b.execution_id = a.execution_id
             WHERE b.request_id = ?1 AND a.artifact_id = ?2 AND length(a.content)<=8388608",
            params![request_id, artifact_id], |row| Ok((BackgroundArtifact {
                id: row.get(0)?, relative_path: row.get(1)?, content_hash: row.get(2)?, bytes: row.get(3)?,
            }, row.get::<_, Vec<u8>>(4)?)),
        ).optional().map_err(|e| e.to_string())?.ok_or_else(|| "Artifact not found for this task".to_string())?;
        if artifact.bytes>MAX_ARTIFACT_BYTES as u64 {return Err("Large artifacts require the bounded chunk protocol".into());}
        if content.len() > MAX_ARTIFACT_BYTES || artifact.bytes != content.len() as u64
            || artifact.content_hash != format!("{:x}", Sha256::digest(&content)) {
            return Err("Stored artifact failed integrity verification".to_string());
        }
        Ok(BackgroundArtifactContent { artifact, content_base64: STANDARD.encode(content) })
    }
}
