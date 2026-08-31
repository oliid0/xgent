


//!






























use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::Write as _;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_BLOB_BYTES: u64 = 32 * 1024 * 1024;
const MAX_TOTAL_BLOB_BYTES: u64 = 512 * 1024 * 1024;
const MAX_RECORDS_PER_CONVERSATION: usize = 10_000;

const RECORD_CAP_ERROR_RESERVE: usize = 64;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointCtx {
    pub conversation_id: String,
    pub turn_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointRecord {
        pub schema: u32,
    pub turn_seq: u64,
    pub turn_id: String,
        pub root: String,
        pub rel_path: String,
    pub kind: String,
    pub existed_before: bool,
        pub blob: Option<String>,
    pub size: u64,
    pub mtime_ms: u64,
    pub captured_at: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
                #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<u32>,
}

pub enum PreImage<'a> {
        Missing,
        File(Option<&'a [u8]>),
        Dir,
}




//



static INDEX_LOCK: Mutex<()> = Mutex::new(());

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex_encode(&Sha256::digest(bytes))
}

fn sanitize_conversation_id(id: &str) -> Option<String> {
    let cleaned: String = id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('.').to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn checkpoints_root() -> Result<PathBuf, String> {
    let home =
        dirs::home_dir().ok_or_else(|| "Failed to locate the user home directory".to_string())?;
    Ok(home.join(".xgent").join("checkpoints"))
}

fn conversation_dir(conversation_id: &str) -> Result<PathBuf, String> {
    let safe = sanitize_conversation_id(conversation_id)
        .ok_or_else(|| "checkpoint conversationId is empty".to_string())?;
    Ok(checkpoints_root()?.join(safe))
}

fn index_path(dir: &Path) -> PathBuf {
    dir.join("index.jsonl")
}

fn blobs_dir(dir: &Path) -> PathBuf {
    dir.join("blobs")
}

#[cfg(unix)]
fn tighten_permissions(path: &Path, is_dir: bool) {
    use std::os::unix::fs::PermissionsExt;
    let mode = if is_dir { 0o700 } else { 0o600 };
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(mode));
}

#[cfg(not(unix))]
fn tighten_permissions(_path: &Path, _is_dir: bool) {}

#[cfg(unix)]
fn file_mode(path: &Path) -> Option<u32> {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(path).ok().map(|md| md.permissions().mode())
}

#[cfg(not(unix))]
fn file_mode(_path: &Path) -> Option<u32> {
    None
}

#[cfg(unix)]
fn restore_file_mode(path: &Path, mode: Option<u32>) {
    use std::os::unix::fs::PermissionsExt;
    if let Some(mode) = mode {
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(mode));
    }
}

#[cfg(not(unix))]
fn restore_file_mode(_path: &Path, _mode: Option<u32>) {}

fn ensure_conversation_dirs(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    tighten_permissions(dir, true);
    let blobs = blobs_dir(dir);
    fs::create_dir_all(&blobs).map_err(|e| e.to_string())?;
    tighten_permissions(&blobs, true);
    Ok(())
}

fn path_hash16(key: &str) -> String {
    let digest = Sha256::digest(key.as_bytes());
    hex_encode(&digest)[..16].to_string()
}

fn read_index(dir: &Path) -> Vec<CheckpointRecord> {
    let Ok(text) = fs::read_to_string(index_path(dir)) else {
        return Vec::new();
    };
    text.lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| serde_json::from_str::<CheckpointRecord>(line).ok())
        .filter(|record| record.schema == 2)
        .collect()
}

fn append_record(dir: &Path, record: &CheckpointRecord) -> Result<(), String> {
    let line = serde_json::to_string(record).map_err(|e| e.to_string())?;
    let path = index_path(dir);
    let existed = path.exists();
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    file.write_all(format!("{line}\n").as_bytes())
        .map_err(|e| e.to_string())?;
    if !existed {
        tighten_permissions(&path, false);
    }
    Ok(())
}

fn write_blob(dir: &Path, key: &str, bytes: &[u8]) -> Result<String, String> {
    let blobs = blobs_dir(dir);
    let hash = path_hash16(key);
    for version in 1..u32::MAX {
        let name = format!("{hash}@v{version}");
        let target = blobs.join(&name);
        if target.exists() {
            continue;
        }
        fs::write(&target, bytes).map_err(|e| e.to_string())?;
        tighten_permissions(&target, false);
        return Ok(name);
    }
    Err("checkpoint blob version space exhausted".to_string())
}

fn record_key(root: &str, rel_path: &str) -> String {
    format!("{root}\u{1}{rel_path}")
}

fn normalize_root(root: &Path) -> String {
    root.to_string_lossy().replace('\\', "/")
}

fn normalize_rel(rel: &Path) -> String {
    rel.to_string_lossy().replace('\\', "/")
}


fn resolve_turn_seq(records: &[CheckpointRecord], turn_id: &str) -> u64 {
    if let Some(existing) = records
        .iter()
        .find(|r| r.kind != "rewind" && r.turn_id == turn_id)
    {
        return existing.turn_seq;
    }
    records.iter().map(|r| r.turn_seq).max().unwrap_or(0) + 1
}

fn append_error_record(
    dir: &Path,
    turn_seq: u64,
    turn_id: &str,
    root: &str,
    rel_path: &str,
    reason: &str,
) {
    let record = CheckpointRecord {
        schema: 2,
        turn_seq,
        turn_id: turn_id.to_string(),
        root: root.to_string(),
        rel_path: rel_path.to_string(),
        kind: "error".to_string(),
        existed_before: false,
        blob: None,
        size: 0,
        mtime_ms: 0,
        captured_at: now_ms(),
        note: Some(reason.to_string()),
        mode: None,
    };
    if let Err(e) = append_record(dir, &record) {
        eprintln!("checkpoint error-record append failed for {rel_path}: {e}");
    }
}

fn capture_at(
    dir: &Path,
    turn_id: &str,
    root: &Path,
    rel_path: &Path,
    pre_image: PreImage,
) -> Result<u64, String> {
    capture_at_with_limits(
        dir,
        turn_id,
        root,
        rel_path,
        pre_image,
        MAX_BLOB_BYTES,
        MAX_TOTAL_BLOB_BYTES,
    )
}

fn capture_at_with_limits(
    dir: &Path,
    turn_id: &str,
    root: &Path,
    rel_path: &Path,
    pre_image: PreImage,
    max_blob_bytes: u64,
    max_total_blob_bytes: u64,
) -> Result<u64, String> {
    ensure_conversation_dirs(dir)?;
    let root_str = normalize_root(root);
    let rel_str = normalize_rel(rel_path);
    let abs_path = root.join(rel_path);

    let _guard = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());

    let existing = read_index(dir);
    let turn_seq = resolve_turn_seq(&existing, turn_id);




    if existing.len() + RECORD_CAP_ERROR_RESERVE >= MAX_RECORDS_PER_CONVERSATION {
        return Err(format!(
            "checkpoint record cap reached ({MAX_RECORDS_PER_CONVERSATION})"
        ));
    }


    if existing
        .iter()
        .any(|r| r.turn_seq == turn_seq && r.root == root_str && r.rel_path == rel_str)
    {
        return Ok(turn_seq);
    }

    let record = match pre_image {
        PreImage::Missing => CheckpointRecord {
            schema: 2,
            turn_seq,
            turn_id: turn_id.to_string(),
            root: root_str,
            rel_path: rel_str,
            kind: "file".to_string(),
            existed_before: false,
            blob: None,
            size: 0,
            mtime_ms: 0,
            captured_at: now_ms(),
            note: None,
            mode: None,
        },
        PreImage::Dir => CheckpointRecord {
            schema: 2,
            turn_seq,
            turn_id: turn_id.to_string(),
            root: root_str,
            rel_path: rel_str,
            kind: "dir".to_string(),
            existed_before: true,
            blob: None,
            size: 0,
            mtime_ms: 0,
            captured_at: now_ms(),
            note: None,
            mode: None,
        },
        PreImage::File(bytes) => {
            let owned;
            let bytes = match bytes {
                Some(b) => b,
                None => {


                    let len = fs::metadata(&abs_path).map_err(|e| e.to_string())?.len();
                    if len > max_blob_bytes {
                        append_error_record(
                            dir,
                            turn_seq,
                            turn_id,
                            &root_str,
                            &rel_str,
                            &format!("file too large to checkpoint ({len} bytes)"),
                        );
                        return Ok(turn_seq);
                    }
                    owned = fs::read(&abs_path).map_err(|e| e.to_string())?;
                    &owned
                }
            };
            if bytes.len() as u64 > max_blob_bytes {
                append_error_record(
                    dir,
                    turn_seq,
                    turn_id,
                    &root_str,
                    &rel_str,
                    &format!("file too large to checkpoint ({} bytes)", bytes.len()),
                );
                return Ok(turn_seq);
            }
            let total: u64 = existing
                .iter()
                .filter(|r| r.blob.is_some())
                .map(|r| r.size)
                .sum();
            if total.saturating_add(bytes.len() as u64) > max_total_blob_bytes {
                append_error_record(
                    dir,
                    turn_seq,
                    turn_id,
                    &root_str,
                    &rel_str,
                    "conversation checkpoint storage cap reached",
                );
                return Ok(turn_seq);
            }



            let mtime_ms = fs::symlink_metadata(&abs_path)
                .ok()
                .and_then(|md| md.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis().min(u128::from(u64::MAX)) as u64)
                .unwrap_or(0);
            let size = bytes.len() as u64;
            let mode = file_mode(&abs_path);
            let blob = write_blob(dir, &record_key(&root_str, &rel_str), bytes)?;
            CheckpointRecord {
                schema: 2,
                turn_seq,
                turn_id: turn_id.to_string(),
                root: root_str,
                rel_path: rel_str,
                kind: "file".to_string(),
                existed_before: true,
                blob: Some(blob),
                size,
                mtime_ms,
                captured_at: now_ms(),
                note: None,
                mode,
            }
        }
    };

    append_record(dir, &record)?;
    Ok(turn_seq)
}

fn capture_inner(
    ctx: &CheckpointCtx,
    root: &Path,
    rel_path: &Path,
    pre_image: PreImage,
) -> Result<(), String> {
    let dir = conversation_dir(&ctx.conversation_id)?;
    capture_at(&dir, &ctx.turn_id, root, rel_path, pre_image).map(|_| ())
}

fn record_capture_skip(ctx: &CheckpointCtx, root: &Path, rel_path: &Path, reason: &str) {
    let Ok(dir) = conversation_dir(&ctx.conversation_id) else {
        return;
    };
    if ensure_conversation_dirs(&dir).is_err() {
        return;
    }
    let _guard = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let existing = read_index(&dir);
    if existing.len() >= MAX_RECORDS_PER_CONVERSATION {
        eprintln!(
            "checkpoint record cap reached; dropping skip record for {}",
            root.join(rel_path).display()
        );
        return;
    }
    let seq = resolve_turn_seq(&existing, &ctx.turn_id);
    append_error_record(
        &dir,
        seq,
        &ctx.turn_id,
        &normalize_root(root),
        &normalize_rel(rel_path),
        reason,
    );
}

fn begin_turn_at(dir: &Path, turn_id: &str) -> Result<(), String> {
    let turn_id = turn_id.trim();
    if turn_id.is_empty() {
        return Err("checkpoint turnId is empty".to_string());
    }
    ensure_conversation_dirs(dir)?;
    let _guard = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let existing = read_index(dir);
    if existing.iter().any(|record| record.turn_id == turn_id) {
        return Ok(());
    }
    if existing.len() + RECORD_CAP_ERROR_RESERVE >= MAX_RECORDS_PER_CONVERSATION {
        return Err(format!(
            "checkpoint record cap reached ({MAX_RECORDS_PER_CONVERSATION})"
        ));
    }
    let turn_seq = resolve_turn_seq(&existing, turn_id);
    append_record(
        dir,
        &CheckpointRecord {
            schema: 2,
            turn_seq,
            turn_id: turn_id.to_string(),
            root: String::new(),
            rel_path: String::new(),
            kind: "turn".to_string(),
            existed_before: false,
            blob: None,
            size: 0,
            mtime_ms: 0,
            captured_at: now_ms(),
            note: None,
            mode: None,
        },
    )
}

#[tauri::command(rename_all = "snake_case")]
pub async fn checkpoint_begin_turn(conversation_id: String, turn_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = conversation_dir(&conversation_id)?;
        begin_turn_at(&dir, &turn_id)
    })
    .await
    .map_err(|e| format!("checkpoint_begin_turn join failed: {e}"))?
}

pub fn capture_pre_image(
    ctx: Option<&CheckpointCtx>,
    root: &Path,
    rel_path: &Path,
    pre_image: PreImage,
) {
    let Some(ctx) = ctx else { return };
    if let Err(error) = capture_inner(ctx, root, rel_path, pre_image) {
        eprintln!(
            "checkpoint capture failed for {}: {error}",
            root.join(rel_path).display()
        );

        record_capture_skip(ctx, root, rel_path, &error);
    }
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointTurnSummary {
    pub turn_seq: u64,
    pub turn_id: String,
    pub file_count: usize,
    pub dir_count: usize,
        pub incomplete: bool,
    pub first_captured_at: u64,
}

fn live_records(records: Vec<CheckpointRecord>) -> Vec<CheckpointRecord> {
    let mut out: Vec<CheckpointRecord> = Vec::new();
    for record in records {
        if record.kind == "rewind" {
            if record.turn_seq > 0 {
                out.retain(|r| r.turn_seq < record.turn_seq);
            }
            continue;
        }
        out.push(record);
    }
    out
}

fn checkpoint_turn_summaries(records: Vec<CheckpointRecord>) -> Vec<CheckpointTurnSummary> {
    let records = live_records(records);
    let mut turns: Vec<CheckpointTurnSummary> = Vec::new();
    for record in records {
        let summary = match turns.iter_mut().find(|t| t.turn_seq == record.turn_seq) {
            Some(existing) => existing,
            None => {
                turns.push(CheckpointTurnSummary {
                    turn_seq: record.turn_seq,
                    turn_id: record.turn_id.clone(),
                    file_count: 0,
                    dir_count: 0,
                    incomplete: false,
                    first_captured_at: record.captured_at,
                });
                turns.last_mut().expect("just pushed")
            }
        };
        match record.kind.as_str() {
            "dir" => summary.dir_count += 1,
            "error" => summary.incomplete = true,
            "file" => summary.file_count += 1,


            _ => {}
        }
        if record.captured_at < summary.first_captured_at {
            summary.first_captured_at = record.captured_at;
        }
    }
    turns.sort_by_key(|t| t.turn_seq);
    turns
}

fn checkpoint_list_sync(conversation_id: String) -> Result<Vec<CheckpointTurnSummary>, String> {
    let dir = conversation_dir(&conversation_id)?;
    Ok(checkpoint_turn_summaries(read_index(&dir)))
}

#[tauri::command(rename_all = "snake_case")]
pub async fn checkpoint_list(
    conversation_id: String,
) -> Result<Vec<CheckpointTurnSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || checkpoint_list_sync(conversation_id))
        .await
        .map_err(|e| format!("checkpoint_list join failed: {e}"))?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointDiffEntry {
        pub path: String,
        pub key: String,
    /// "restore" | "delete" | "clean" | "skip-dir" | "missing-blob" | "unresolvable"
    pub action: String,
                #[serde(skip_serializing_if = "Option::is_none")]
    pub current_hash: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointDiffStats {
    pub turn_seq: u64,
    pub restore_files: usize,
    pub delete_files: usize,
    pub clean_files: usize,
    pub skipped_dirs: usize,
    pub missing_blobs: usize,
        pub unresolvable_files: usize,
        pub capture_errors: usize,
    pub entries: Vec<CheckpointDiffEntry>,
}

fn earliest_records_since(dir: &Path, turn_seq: u64) -> (Vec<CheckpointRecord>, usize) {
    let mut seen: Vec<String> = Vec::new();
    let mut out: Vec<CheckpointRecord> = Vec::new();
    let mut errors = 0usize;
    for record in live_records(read_index(dir)) {
        if record.turn_seq < turn_seq {
            continue;
        }
        if record.kind == "error" {
            errors += 1;
            continue;
        }
        if record.kind == "turn" {
            continue;
        }
        let key = record_key(&record.root, &record.rel_path);
        if seen.iter().any(|p| p == &key) {
            continue;
        }
        seen.push(key);
        out.push(record);
    }
    (out, errors)
}

fn canonical_authorized_roots(roots: &[String]) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    let mut push = |candidate: PathBuf| {
        if !out.contains(&candidate) {
            out.push(candidate);
        }
    };
    for raw in roots {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let path = Path::new(trimmed);
        if matches!(fs::symlink_metadata(path), Ok(md) if md.file_type().is_symlink()) {
            continue;
        }
        let Ok(canonical) = fs::canonicalize(path) else {
            continue;
        };



        if let Some(repo_root) = enclosing_repo_root(&canonical) {
            push(repo_root);
        }
        push(canonical);
    }


    if let Ok(skills_root) = crate::services::skills::skills_root_dir() {
        push(skills_root);
    }
    out
}


fn enclosing_repo_root(start: &Path) -> Option<PathBuf> {
    let home = dirs::home_dir().and_then(|h| fs::canonicalize(h).ok());
    let mut cursor = Some(start);
    while let Some(dir) = cursor {

        let parent = dir.parent()?;
        if home.as_deref() == Some(dir) {
            return None;
        }
        if dir.join(".git").exists() {
            return fs::canonicalize(dir).ok();
        }
        cursor = Some(parent);
    }
    None
}

fn resolve_authorized_root(
    root_str: &str,
    authorized_roots: &[PathBuf],
) -> Result<PathBuf, String> {
    let raw = Path::new(root_str);
    match fs::symlink_metadata(raw) {
        Ok(md) if md.file_type().is_symlink() => {
            return Err("refusing to follow a symlinked checkpoint root".to_string());
        }
        Ok(md) if !md.is_dir() => {
            return Err("checkpoint root is no longer a directory".to_string());
        }
        Ok(_) => {}
        Err(e) => return Err(format!("checkpoint root unavailable: {e}")),
    }
    let root = fs::canonicalize(raw).map_err(|e| format!("checkpoint root unavailable: {e}"))?;
    if !authorized_roots.iter().any(|allowed| allowed == &root) {
        return Err("checkpoint root is not an authorized workspace root".to_string());
    }
    Ok(root)
}

fn resolve_rewind_target(
    root_str: &str,
    rel_str: &str,
    authorized_roots: &[PathBuf],
) -> Result<PathBuf, String> {
    let root = resolve_authorized_root(root_str, authorized_roots)?;
    let rel = PathBuf::from(rel_str);
    if rel.as_os_str().is_empty() {
        return Err("empty relative path".to_string());
    }
    for comp in rel.components() {
        match comp {
            Component::Normal(_) => {}
            _ => return Err(format!("unsafe relative path: {rel_str}")),
        }
    }
    let mut current = root;
    for comp in rel.components() {
        current.push(comp);
        match fs::symlink_metadata(&current) {
            Ok(md) if md.file_type().is_symlink() => {
                return Err(format!(
                    "refusing to follow symlink at {}",
                    current.display()
                ));
            }
            _ => {}
        }
    }
    Ok(current)
}

#[cfg(unix)]
fn reject_multi_hardlink(md: &fs::Metadata) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;
    if md.nlink() > 1 {
        return Err("refusing to modify a multi-hardlink file".to_string());
    }
    Ok(())
}

#[cfg(not(unix))]
fn reject_multi_hardlink(_md: &fs::Metadata) -> Result<(), String> {
    Ok(())
}

fn current_state_hash(target: &Path) -> String {
    match fs::symlink_metadata(target) {
        Ok(md) if md.is_file() => match fs::read(target) {
            Ok(bytes) => match file_mode(target) {
                Some(mode) => format!("{}@{:o}", sha256_hex(&bytes), mode),
                None => sha256_hex(&bytes),
            },
            Err(_) => "unreadable".to_string(),
        },
        Ok(_) => "non-file".to_string(),
        Err(_) => "absent".to_string(),
    }
}

fn mode_differs(recorded: Option<u32>, target: &Path) -> bool {
    match recorded {
        Some(want) => matches!(file_mode(target), Some(have) if have != want),
        None => false,
    }
}

fn classify_entry(
    dir: &Path,
    record: &CheckpointRecord,
    authorized_roots: &[PathBuf],
) -> CheckpointDiffEntry {
    let key = record_key(&record.root, &record.rel_path);
    let display = format!("{}/{}", record.root, record.rel_path);
    if record.kind == "dir" {
        return CheckpointDiffEntry {
            path: display,
            key,
            action: "skip-dir".to_string(),
            current_hash: None,
        };
    }


    let target = match resolve_rewind_target(&record.root, &record.rel_path, authorized_roots) {
        Ok(target) => target,
        Err(_) => {
            return CheckpointDiffEntry {
                path: display,
                key,
                action: "unresolvable".to_string(),
                current_hash: None,
            };
        }
    };
    let hash = current_state_hash(&target);
    let action = if !record.existed_before {
        if hash == "absent" {
            "clean"
        } else {
            "delete"
        }
    } else {
        match &record.blob {
            None => "missing-blob",
            Some(blob) => match fs::read(blobs_dir(dir).join(blob)) {
                Err(_) => "missing-blob",
                Ok(expected) => {



                    let current_content = hash.split_once('@').map_or(hash.as_str(), |(c, _)| c);
                    if sha256_hex(&expected) == current_content
                        && !mode_differs(record.mode, &target)
                    {
                        "clean"
                    } else {
                        "restore"
                    }
                }
            },
        }
    };


    CheckpointDiffEntry {
        path: display,
        key,
        action: action.to_string(),
        current_hash: Some(hash),
    }
}

fn checkpoint_diff_stats_sync(
    conversation_id: String,
    turn_seq: u64,
    authorized_roots: Vec<String>,
) -> Result<CheckpointDiffStats, String> {
    let dir = conversation_dir(&conversation_id)?;
    let authorized = canonical_authorized_roots(&authorized_roots);
    let (records, capture_errors) = earliest_records_since(&dir, turn_seq);
    let mut stats = CheckpointDiffStats {
        turn_seq,
        restore_files: 0,
        delete_files: 0,
        clean_files: 0,
        skipped_dirs: 0,
        missing_blobs: 0,
        unresolvable_files: 0,
        capture_errors,
        entries: Vec::new(),
    };
    for record in records {
        let entry = classify_entry(&dir, &record, &authorized);
        match entry.action.as_str() {
            "restore" => stats.restore_files += 1,
            "delete" => stats.delete_files += 1,
            "clean" => stats.clean_files += 1,
            "skip-dir" => stats.skipped_dirs += 1,
            "missing-blob" => stats.missing_blobs += 1,
            "unresolvable" => stats.unresolvable_files += 1,
            _ => {}
        }
        stats.entries.push(entry);
    }
    Ok(stats)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn checkpoint_diff_stats(
    conversation_id: String,
    turn_seq: u64,
    authorized_roots: Vec<String>,
) -> Result<CheckpointDiffStats, String> {
    tauri::async_runtime::spawn_blocking(move || {
        checkpoint_diff_stats_sync(conversation_id, turn_seq, authorized_roots)
    })
    .await
    .map_err(|e| format!("checkpoint_diff_stats join failed: {e}"))?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointExpectedEntry {
    pub key: String,
    pub current_hash: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointRewindResult {
    pub turn_seq: u64,
    pub restored_files: usize,
    pub deleted_files: usize,
    pub clean_files: usize,
    pub skipped_dirs: usize,
            pub capture_errors: usize,
        pub conflicts: Vec<String>,
    pub failed: Vec<String>,
}

fn rewind_is_complete(result: &CheckpointRewindResult) -> bool {
    result.conflicts.is_empty()
        && result.failed.is_empty()
        && result.skipped_dirs == 0
        && result.capture_errors == 0
}

fn atomic_write(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "target has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let tmp = parent.join(format!(".ckpt-tmp-{}-{}", std::process::id(), now_ms()));
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    match fs::rename(&tmp, target) {
        Ok(()) => Ok(()),





        Err(_) if target.exists() => {
            let backup = parent.join(format!(".ckpt-bak-{}-{}", std::process::id(), now_ms()));
            if let Err(e) = fs::rename(target, &backup) {
                let _ = fs::remove_file(&tmp);
                return Err(e.to_string());
            }
            match fs::rename(&tmp, target) {
                Ok(()) => {
                    let _ = fs::remove_file(&backup);
                    Ok(())
                }
                Err(e) => {
                    let _ = fs::rename(&backup, target);
                    let _ = fs::remove_file(&tmp);
                    Err(e.to_string())
                }
            }
        }
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(e.to_string())
        }
    }
}

fn checkpoint_rewind_code_sync(
    conversation_id: String,
    turn_seq: u64,
    authorized_roots: Vec<String>,
    expected: Vec<CheckpointExpectedEntry>,
) -> Result<CheckpointRewindResult, String> {
    let dir = conversation_dir(&conversation_id)?;
    let authorized = canonical_authorized_roots(&authorized_roots);




    let _guard = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    Ok(rewind_and_mark_at(
        &dir,
        turn_seq,
        &authorized,
        Some(&expected),
    ))
}

fn rewind_and_mark_at(
    dir: &Path,
    turn_seq: u64,
    authorized: &[PathBuf],
    expected: Option<&[CheckpointExpectedEntry]>,
) -> CheckpointRewindResult {
    let result = rewind_at(dir, turn_seq, authorized, expected);



    let complete = rewind_is_complete(&result);

    let marker = CheckpointRecord {
        schema: 2,
        turn_seq: if complete { turn_seq } else { 0 },
        turn_id: String::new(),
        root: String::new(),
        rel_path: String::new(),
        kind: "rewind".to_string(),
        existed_before: false,
        blob: None,
        size: 0,
        mtime_ms: 0,
        captured_at: now_ms(),
        note: Some(format!(
            "target={} restored={} deleted={} conflicts={} failed={} capture_errors={} complete={}",
            turn_seq,
            result.restored_files,
            result.deleted_files,
            result.conflicts.len(),
            result.failed.len(),
            result.capture_errors,
            complete
        )),
        mode: None,
    };

    let _ = append_record(dir, &marker);
    result
}

fn rewind_at(
    dir: &Path,
    turn_seq: u64,
    authorized_roots: &[PathBuf],
    expected: Option<&[CheckpointExpectedEntry]>,
) -> CheckpointRewindResult {
    let expected_by_key: Option<HashMap<&str, &str>> = expected.map(|entries| {
        entries
            .iter()
            .map(|e| (e.key.as_str(), e.current_hash.as_str()))
            .collect()
    });
    let (records, capture_errors) = earliest_records_since(dir, turn_seq);
    let mut result = CheckpointRewindResult {
        turn_seq,
        restored_files: 0,
        deleted_files: 0,
        clean_files: 0,
        skipped_dirs: 0,
        capture_errors,
        conflicts: Vec::new(),
        failed: Vec::new(),
    };
    for record in records {
        let display = format!("{}/{}", record.root, record.rel_path);
        if record.kind == "dir" {
            result.skipped_dirs += 1;
            continue;
        }


        let target = match resolve_rewind_target(&record.root, &record.rel_path, authorized_roots) {
            Ok(t) => t,
            Err(e) => {
                result.failed.push(format!("{display}: {e}"));
                continue;
            }
        };




        let key = record_key(&record.root, &record.rel_path);
        if let Some(map) = &expected_by_key {
            let current = current_state_hash(&target);
            match map.get(key.as_str()) {
                Some(expected) if current != "unreadable" && current == **expected => {}
                _ => {
                    result.conflicts.push(display);
                    continue;
                }
            }
        }
        if !record.existed_before {
            match fs::symlink_metadata(&target) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    result.clean_files += 1;
                }
                Err(e) => result.failed.push(format!("{display}: {e}")),
                Ok(md) => {
                    if !md.is_file() {
                        result.failed.push(format!("{display}: not a regular file"));
                        continue;
                    }
                    if let Err(e) = reject_multi_hardlink(&md) {
                        result.failed.push(format!("{display}: {e}"));
                        continue;
                    }

                    if let Err(e) = reverify_target(&record, &target, authorized_roots) {
                        result.failed.push(format!("{display}: {e}"));
                        continue;
                    }
                    match fs::remove_file(&target) {
                        Ok(()) => result.deleted_files += 1,
                        Err(e) => result.failed.push(format!("{display}: {e}")),
                    }
                }
            }
            continue;
        }
        let Some(blob) = &record.blob else {
            result.failed.push(format!("{display}: blob missing"));
            continue;
        };
        let blob_path = blobs_dir(dir).join(blob);
        let restore = (|| -> Result<bool, String> {
            let pre_image = fs::read(&blob_path).map_err(|e| e.to_string())?;
            match fs::symlink_metadata(&target) {
                Ok(md) => {
                    if !md.is_file() {
                        return Err("not a regular file".to_string());
                    }
                    reject_multi_hardlink(&md)?;
                    if let Ok(current) = fs::read(&target) {
                        if current == pre_image {




                            let mode_changed = mode_differs(record.mode, &target);
                            restore_file_mode(&target, record.mode);
                            return Ok(mode_changed);
                        }
                    }
                }
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                    return Err(e.to_string());
                }
                Err(_) => {}
            }

            reverify_target(&record, &target, authorized_roots)?;
            atomic_write(&target, &pre_image)?;


            restore_file_mode(&target, record.mode);
            Ok(true)
        })();
        match restore {
            Ok(true) => result.restored_files += 1,
            Ok(false) => result.clean_files += 1,
            Err(e) => result.failed.push(format!("{display}: {e}")),
        }
    }
    result
}

fn reverify_target(
    record: &CheckpointRecord,
    target: &Path,
    authorized_roots: &[PathBuf],
) -> Result<(), String> {
    let again = resolve_rewind_target(&record.root, &record.rel_path, authorized_roots)?;
    if again != target {
        return Err("checkpoint target changed during rewind".to_string());
    }
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn checkpoint_rewind_code(
    conversation_id: String,
    turn_seq: u64,
    authorized_roots: Vec<String>,
    expected: Vec<CheckpointExpectedEntry>,
) -> Result<CheckpointRewindResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        checkpoint_rewind_code_sync(conversation_id, turn_seq, authorized_roots, expected)
    })
    .await
    .map_err(|e| format!("checkpoint_rewind_code join failed: {e}"))?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn checkpoint_clear(conversation_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let dir = conversation_dir(&conversation_id)?;
        match fs::remove_dir_all(&dir) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    })
    .await
    .map_err(|e| format!("checkpoint_clear join failed: {e}"))?
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

fn classify_worktree_pre_image(abs: &Path) -> Result<PreImage<'static>, String> {
    match fs::symlink_metadata(abs) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(PreImage::Missing),
        Err(e) => Err(format!("pre-image stat failed: {e}")),

        Ok(md) if md.file_type().is_symlink() => Err("symlink pre-image not captured".to_string()),
        Ok(md) if md.is_file() => Ok(PreImage::File(None)),
        Ok(md) if md.is_dir() => Ok(PreImage::Dir),
        Ok(_) => Err("unsupported file type; pre-image not captured".to_string()),
    }
}



#[must_use = "捕获缺口必须由调用方按 apply 结果决定是否落账"]
pub fn capture_worktree_apply_pre_images(
    ctx: Option<&CheckpointCtx>,
    parent_repo_root: &Path,
    rel_paths: &[String],
) -> Vec<(PathBuf, String)> {
    let Some(ctx) = ctx else {
        return Vec::new();
    };
    let mut skipped = Vec::new();
    for rel in rel_paths {
        let rel_path = PathBuf::from(rel);
        let abs = parent_repo_root.join(&rel_path);
        match classify_worktree_pre_image(&abs) {
            Ok(pre_image) => capture_pre_image(Some(ctx), parent_repo_root, &rel_path, pre_image),
            Err(reason) => {
                eprintln!(
                    "checkpoint worktree pre-image skipped for {}: {reason}",
                    abs.display()
                );
                skipped.push((rel_path, reason));
            }
        }
    }
    skipped
}

pub fn record_worktree_capture_skips(
    ctx: Option<&CheckpointCtx>,
    parent_repo_root: &Path,
    skipped: &[(PathBuf, String)],
) {
    let Some(ctx) = ctx else { return };
    for (rel_path, reason) in skipped {
        record_capture_skip(ctx, parent_repo_root, rel_path, reason);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rel(file: &Path, root: &Path) -> PathBuf {
        file.strip_prefix(root).unwrap().to_path_buf()
    }

        fn roots(root: &Path) -> Vec<PathBuf> {
        vec![root.to_path_buf()]
    }

    fn expected_from_diff(ckpt: &Path, turn_seq: u64, root: &Path) -> Vec<CheckpointExpectedEntry> {
        let (records, _) = earliest_records_since(ckpt, turn_seq);
        records
            .iter()
            .map(|r| classify_entry(ckpt, r, &roots(root)))
            .filter_map(|entry| {
                entry.current_hash.map(|hash| CheckpointExpectedEntry {
                    key: entry.key,
                    current_hash: hash,
                })
            })
            .collect()
    }

    #[test]
    fn capture_and_rewind_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");
        let file = root.join("a.txt");
        fs::write(&file, "v1").unwrap();


        let seq = capture_at(
            &ckpt,
            "turn-1",
            &root,
            &rel(&file, &root),
            PreImage::File(None),
        )
        .unwrap();
        fs::write(&file, "v2").unwrap();


        let result = rewind_at(&ckpt, seq, &roots(&root), None);
        assert_eq!(result.restored_files, 1);
        assert_eq!(fs::read_to_string(&file).unwrap(), "v1");
    }

    #[test]
    fn missing_pre_image_rewinds_to_deletion() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");
        let file = root.join("new.txt");

        let seq = capture_at(
            &ckpt,
            "turn-1",
            &root,
            &rel(&file, &root),
            PreImage::Missing,
        )
        .unwrap();
        fs::write(&file, "created").unwrap();

        let result = rewind_at(&ckpt, seq, &roots(&root), None);
        assert_eq!(result.deleted_files, 1);
        assert!(!file.exists());
    }

    #[test]
    fn earliest_record_wins_across_turns() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");
        let file = root.join("a.txt");
        let r = rel(&file, &root);
        fs::write(&file, "v1").unwrap();

        let seq1 = capture_at(&ckpt, "turn-1", &root, &r, PreImage::File(None)).unwrap();
        fs::write(&file, "v2").unwrap();
        let seq2 = capture_at(&ckpt, "turn-2", &root, &r, PreImage::File(None)).unwrap();
        assert!(seq2 > seq1);
        fs::write(&file, "v3").unwrap();


        let result = rewind_at(&ckpt, seq1, &roots(&root), None);
        assert_eq!(result.restored_files, 1);
        assert_eq!(fs::read_to_string(&file).unwrap(), "v1");
    }

    #[test]
    fn rewind_to_later_turn_keeps_earlier_changes() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");
        let file = root.join("a.txt");
        let r = rel(&file, &root);
        fs::write(&file, "v1").unwrap();

        capture_at(&ckpt, "turn-1", &root, &r, PreImage::File(None)).unwrap();
        fs::write(&file, "v2").unwrap();
        let seq2 = capture_at(&ckpt, "turn-2", &root, &r, PreImage::File(None)).unwrap();
        fs::write(&file, "v3").unwrap();


        let result = rewind_at(&ckpt, seq2, &roots(&root), None);
        assert_eq!(result.restored_files, 1);
        assert_eq!(fs::read_to_string(&file).unwrap(), "v2");
    }

    #[test]
    fn same_turn_same_path_dedupes() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");
        let file = root.join("a.txt");
        let r = rel(&file, &root);
        fs::write(&file, "v1").unwrap();

        capture_at(&ckpt, "turn-1", &root, &r, PreImage::File(None)).unwrap();
        fs::write(&file, "v1a").unwrap();

        capture_at(&ckpt, "turn-1", &root, &r, PreImage::File(None)).unwrap();

        let records = read_index(&ckpt);
        assert_eq!(records.len(), 1);
        let blobs: Vec<_> = fs::read_dir(blobs_dir(&ckpt)).unwrap().collect();
        assert_eq!(blobs.len(), 1);
    }

    #[test]
    fn turn_seq_is_monotonic_and_clock_independent() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");
        let a = root.join("a.txt");
        let b = root.join("b.txt");
        fs::write(&a, "a").unwrap();
        fs::write(&b, "b").unwrap();


        let s1 = capture_at(&ckpt, "t-x", &root, &rel(&a, &root), PreImage::File(None)).unwrap();
        let s1b = capture_at(&ckpt, "t-x", &root, &rel(&b, &root), PreImage::File(None)).unwrap();
        let s2 = capture_at(&ckpt, "t-y", &root, &rel(&a, &root), PreImage::File(None)).unwrap();
        assert_eq!(s1, s1b);
        assert_eq!(s2, s1 + 1);
    }

    #[test]
    fn begin_turn_creates_stable_zero_file_boundary() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");
        let file = root.join("a.txt");

        begin_turn_at(&ckpt, "turn-1").unwrap();
        let records = read_index(&ckpt);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].kind, "turn");
        assert_eq!(records[0].turn_seq, 1);


        fs::write(&file, "created").unwrap();
        let seq = capture_at(
            &ckpt,
            "turn-1",
            &root,
            &rel(&file, &root),
            PreImage::Missing,
        )
        .unwrap();
        assert_eq!(seq, records[0].turn_seq);
        let records = read_index(&ckpt);
        assert!(records.iter().any(|record| record.kind == "turn"));
        assert!(records
            .iter()
            .any(|record| record.kind == "file" && record.turn_seq == seq));
    }

    #[test]
    fn rewind_from_zero_file_turn_rewinds_later_file_changes() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");
        let file = root.join("later.txt");

        begin_turn_at(&ckpt, "turn-without-files").unwrap();
        let later_seq = capture_at(
            &ckpt,
            "later-turn",
            &root,
            &rel(&file, &root),
            PreImage::Missing,
        )
        .unwrap();
        fs::write(&file, "created later").unwrap();

        let result = rewind_at(&ckpt, 1, &roots(&root), None);
        assert_eq!(later_seq, 2);
        assert_eq!(result.deleted_files, 1);
        assert!(!file.exists());
    }

    #[test]
    fn turn_boundary_is_not_a_file_rewind_entry() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");

        begin_turn_at(&ckpt, "turn-only").unwrap();
        let (records, errors) = earliest_records_since(&ckpt, 1);
        assert!(records.is_empty());
        assert_eq!(errors, 0);
        let summaries = checkpoint_turn_summaries(read_index(&ckpt));
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].turn_id, "turn-only");
        assert_eq!(summaries[0].file_count, 0);
        assert_eq!(summaries[0].dir_count, 0);

        let result = rewind_at(&ckpt, 1, &roots(&root), None);
        assert_eq!(result.restored_files, 0);
        assert_eq!(result.deleted_files, 0);
        assert_eq!(result.clean_files, 0);
        assert!(result.failed.is_empty());
    }

    #[test]
    fn rewind_marker_is_never_reused_as_a_turn_seq() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");
        let a = root.join("a.txt");
        fs::write(&a, "a").unwrap();
        let s1 = capture_at(&ckpt, "t-x", &root, &rel(&a, &root), PreImage::File(None)).unwrap();

        append_rewind_marker(&ckpt, 0);


        let records = read_index(&ckpt);
        assert_eq!(resolve_turn_seq(&records, ""), s1 + 1);
    }

    #[test]
    fn dir_marker_is_skipped_but_counted() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");
        let dir_path = root.join("subdir");
        fs::create_dir_all(&dir_path).unwrap();

        let seq = capture_at(
            &ckpt,
            "turn-1",
            &root,
            &rel(&dir_path, &root),
            PreImage::Dir,
        )
        .unwrap();
        fs::remove_dir_all(&dir_path).unwrap();

        let result = rewind_at(&ckpt, seq, &roots(&root), None);
        assert_eq!(result.skipped_dirs, 1);
        assert!(!dir_path.exists());
    }

    #[test]
    fn restore_recreates_missing_parent_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");
        let nested = root.join("x").join("y").join("a.txt");
        fs::create_dir_all(nested.parent().unwrap()).unwrap();
        fs::write(&nested, "v1").unwrap();

        let seq = capture_at(
            &ckpt,
            "turn-1",
            &root,
            &rel(&nested, &root),
            PreImage::File(None),
        )
        .unwrap();
        fs::remove_dir_all(root.join("x")).unwrap();

        let result = rewind_at(&ckpt, seq, &roots(&root), None);
        assert_eq!(result.restored_files, 1);
        assert_eq!(fs::read_to_string(&nested).unwrap(), "v1");
    }

    #[test]
    fn conflict_hash_mismatch_skips_restore() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");
        let file = root.join("a.txt");
        let r = rel(&file, &root);
        fs::write(&file, "v1").unwrap();

        let seq = capture_at(&ckpt, "turn-1", &root, &r, PreImage::File(None)).unwrap();
        fs::write(&file, "v2").unwrap();


        let preview_hash = current_state_hash(&file);
        fs::write(&file, "v3").unwrap();
        let expected = vec![CheckpointExpectedEntry {
            key: record_key(&normalize_root(&root), &normalize_rel(&r)),
            current_hash: preview_hash,
        }];
        let result = rewind_at(&ckpt, seq, &roots(&root), Some(&expected));
        assert_eq!(result.restored_files, 0);
        assert_eq!(result.conflicts.len(), 1);
        assert_eq!(fs::read_to_string(&file).unwrap(), "v3");


        let expected = vec![CheckpointExpectedEntry {
            key: record_key(&normalize_root(&root), &normalize_rel(&r)),
            current_hash: current_state_hash(&file),
        }];
        let result = rewind_at(&ckpt, seq, &roots(&root), Some(&expected));
        assert_eq!(result.restored_files, 1);
        assert_eq!(fs::read_to_string(&file).unwrap(), "v1");
    }

    #[cfg(unix)]
    #[test]
    fn symlink_swap_after_capture_is_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");
        let file = root.join("a.txt");
        let r = rel(&file, &root);
        fs::write(&file, "v1").unwrap();
        let outside = root.join("outside-secret");
        fs::write(&outside, "secret").unwrap();

        let seq = capture_at(&ckpt, "turn-1", &root, &r, PreImage::File(None)).unwrap();

        fs::remove_file(&file).unwrap();
        std::os::unix::fs::symlink(&outside, &file).unwrap();

        let result = rewind_at(&ckpt, seq, &roots(&root), None);
        assert_eq!(result.restored_files, 0);
        assert_eq!(result.failed.len(), 1);
        assert_eq!(fs::read_to_string(&outside).unwrap(), "secret");
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_parent_after_capture_is_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");
        let sub = root.join("sub");
        fs::create_dir_all(&sub).unwrap();
        let file = sub.join("a.txt");
        fs::write(&file, "v1").unwrap();

        let seq = capture_at(
            &ckpt,
            "turn-1",
            &root,
            &rel(&file, &root),
            PreImage::File(None),
        )
        .unwrap();

        let elsewhere = root.join("elsewhere");
        fs::create_dir_all(&elsewhere).unwrap();
        fs::remove_dir_all(&sub).unwrap();
        std::os::unix::fs::symlink(&elsewhere, &sub).unwrap();

        let result = rewind_at(&ckpt, seq, &roots(&root), None);
        assert_eq!(result.restored_files, 0);
        assert_eq!(result.failed.len(), 1);
        assert!(!elsewhere.join("a.txt").exists());
    }

    #[cfg(unix)]
    #[test]
    fn multi_hardlink_target_is_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");
        let file = root.join("a.txt");
        let r = rel(&file, &root);
        fs::write(&file, "v1").unwrap();

        let seq = capture_at(&ckpt, "turn-1", &root, &r, PreImage::File(None)).unwrap();
        fs::write(&file, "v2").unwrap();

        fs::hard_link(&file, root.join("alias.txt")).unwrap();

        let result = rewind_at(&ckpt, seq, &roots(&root), None);
        assert_eq!(result.restored_files, 0);
        assert_eq!(result.failed.len(), 1);
        assert_eq!(fs::read_to_string(&file).unwrap(), "v2");
    }

    #[test]
    fn missing_blob_reports_failure_without_touching_file() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");
        let file = root.join("a.txt");
        let r = rel(&file, &root);
        fs::write(&file, "v1").unwrap();

        let seq = capture_at(&ckpt, "turn-1", &root, &r, PreImage::File(None)).unwrap();
        fs::write(&file, "v2").unwrap();

        for entry in fs::read_dir(blobs_dir(&ckpt)).unwrap() {
            fs::remove_file(entry.unwrap().path()).unwrap();
        }

        let result = rewind_at(&ckpt, seq, &roots(&root), None);
        assert_eq!(result.restored_files, 0);
        assert_eq!(result.failed.len(), 1);
        assert_eq!(fs::read_to_string(&file).unwrap(), "v2");
    }

    #[test]
    fn capture_failure_is_recorded_and_marks_turn_incomplete() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");
        let missing = root.join("does-not-exist.txt");


        let ctx = CheckpointCtx {
            conversation_id: "unused".to_string(),
            turn_id: "turn-1".to_string(),
        };
        let err = capture_at(
            &ckpt,
            &ctx.turn_id,
            &root,
            &rel(&missing, &root),
            PreImage::File(None),
        );
        assert!(err.is_err());

        append_error_record(
            &ckpt,
            1,
            &ctx.turn_id,
            &normalize_root(&root),
            "does-not-exist.txt",
            "read failed",
        );
        let records = read_index(&ckpt);
        assert!(records.iter().any(|r| r.kind == "error"));
        let (recs, errors) = earliest_records_since(&ckpt, 1);
        assert_eq!(recs.len(), 0);
        assert_eq!(errors, 1);
    }

    #[test]
    fn oversized_file_records_error_instead_of_blob() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");
        let big = root.join("big.bin");
        let small = root.join("small.bin");
        fs::write(&big, "0123456789").unwrap();
        fs::write(&small, "ok").unwrap();


        capture_at_with_limits(
            &ckpt,
            "turn-1",
            &root,
            &rel(&big, &root),
            PreImage::File(None),
            4,
            MAX_TOTAL_BLOB_BYTES,
        )
        .unwrap();

        capture_at_with_limits(
            &ckpt,
            "turn-1",
            &root,
            &rel(&small, &root),
            PreImage::File(Some(b"too-long-for-cap")),
            4,
            MAX_TOTAL_BLOB_BYTES,
        )
        .unwrap();

        let records = read_index(&ckpt);
        assert_eq!(records.len(), 2);
        assert!(records.iter().all(|r| r.kind == "error"));
        assert!(records.iter().all(|r| r.blob.is_none()));
        assert!(records[0].note.as_deref().unwrap().contains("10 bytes"));
        let blobs: Vec<_> = fs::read_dir(blobs_dir(&ckpt)).unwrap().collect();
        assert!(blobs.is_empty());


        capture_at_with_limits(
            &ckpt,
            "turn-2",
            &root,
            &rel(&small, &root),
            PreImage::File(None),
            4,
            MAX_TOTAL_BLOB_BYTES,
        )
        .unwrap();
        assert_eq!(fs::read_dir(blobs_dir(&ckpt)).unwrap().count(), 1);
    }

    #[test]
    fn total_storage_cap_records_error_instead_of_blob() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");
        let a = root.join("a.txt");
        let b = root.join("b.txt");
        fs::write(&a, "aaaa").unwrap();
        fs::write(&b, "bbbb").unwrap();

        capture_at_with_limits(
            &ckpt,
            "t-1",
            &root,
            &rel(&a, &root),
            PreImage::File(None),
            64,
            6,
        )
        .unwrap();
        capture_at_with_limits(
            &ckpt,
            "t-2",
            &root,
            &rel(&b, &root),
            PreImage::File(None),
            64,
            6,
        )
        .unwrap();

        let records = read_index(&ckpt);
        assert_eq!(records.len(), 2);
        assert!(records[0].blob.is_some());
        assert_eq!(records[1].kind, "error");
        assert!(records[1]
            .note
            .as_deref()
            .unwrap()
            .contains("storage cap reached"));
    }

    #[test]
    fn v1_index_lines_are_ignored() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");
        fs::create_dir_all(&ckpt).unwrap();

        fs::write(
            index_path(&ckpt),
            "{\"turnSeq\":1,\"path\":\"/tmp/a\",\"kind\":\"file\",\"existedBefore\":true,\"blob\":null,\"size\":0,\"mtimeMs\":0,\"capturedAt\":0}\n",
        )
        .unwrap();
        assert!(read_index(&ckpt).is_empty());
    }

    #[test]
    fn worktree_apply_pre_images_capture_parent_state() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let parent = root.join("parent");
        fs::create_dir_all(&parent).unwrap();
        let existing = parent.join("mod.txt");
        fs::write(&existing, "parent-v1").unwrap();




        let ckpt = root.join("ckpt");
        let paths = ["mod.txt".to_string(), "new.txt".to_string()];
        for rel_str in &paths {
            let rel_path = PathBuf::from(rel_str);
            let abs = parent.join(&rel_path);
            let pre_image = match fs::symlink_metadata(&abs) {
                Err(_) => PreImage::Missing,
                Ok(md) if md.is_file() => PreImage::File(None),
                Ok(_) => PreImage::Dir,
            };
            capture_at(&ckpt, "turn-1", &parent, &rel_path, pre_image).unwrap();
        }

        fs::write(&existing, "worktree-v2").unwrap();
        fs::write(parent.join("new.txt"), "worktree-new").unwrap();

        let result = rewind_at(&ckpt, 1, &roots(&parent), None);
        assert_eq!(result.restored_files, 1);
        assert_eq!(result.deleted_files, 1);
        assert_eq!(fs::read_to_string(&existing).unwrap(), "parent-v1");
        assert!(!parent.join("new.txt").exists());
    }

                ///
            #[test]
    fn worktree_noop_apply_records_rewind_as_clean() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let parent = root.join("parent");
        fs::create_dir_all(&parent).unwrap();
        let ckpt = root.join("ckpt");


        let already = parent.join("same.txt");
        fs::write(&already, "identical").unwrap();
        capture_at(
            &ckpt,
            "turn-1",
            &parent,
            &PathBuf::from("same.txt"),
            PreImage::File(None),
        )
        .unwrap();



        capture_at(
            &ckpt,
            "turn-1",
            &parent,
            &PathBuf::from("never-created.txt"),
            PreImage::Missing,
        )
        .unwrap();


        let result = rewind_at(&ckpt, 1, &roots(&parent), None);
        assert_eq!(result.restored_files, 0, "内容未变不该被当成 restore 写回");
        assert_eq!(
            result.deleted_files, 0,
            "本轮没创建过文件,不该被当成新建去删"
        );
        assert_eq!(result.clean_files, 2);
        assert!(result.failed.is_empty());
        assert!(result.conflicts.is_empty());

        assert_eq!(fs::read_to_string(&already).unwrap(), "identical");
        assert!(!parent.join("never-created.txt").exists());
    }

    #[test]
    fn diff_classification_matches_state() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");
        let dirty = root.join("dirty.txt");
        let clean = root.join("clean.txt");
        fs::write(&dirty, "v1").unwrap();
        fs::write(&clean, "same").unwrap();

        capture_at(
            &ckpt,
            "turn-1",
            &root,
            &rel(&dirty, &root),
            PreImage::File(None),
        )
        .unwrap();
        capture_at(
            &ckpt,
            "turn-1",
            &root,
            &rel(&clean, &root),
            PreImage::File(None),
        )
        .unwrap();
        fs::write(&dirty, "v2").unwrap();

        let (records, _) = earliest_records_since(&ckpt, 1);
        let entries: Vec<_> = records
            .iter()
            .map(|r| classify_entry(&ckpt, r, &roots(&root)))
            .collect();
        let dirty_entry = entries
            .iter()
            .find(|e| e.path.ends_with("dirty.txt"))
            .unwrap();
        let clean_entry = entries
            .iter()
            .find(|e| e.path.ends_with("clean.txt"))
            .unwrap();
        assert_eq!(dirty_entry.action, "restore");
        assert_eq!(clean_entry.action, "clean");

        assert_eq!(
            dirty_entry.current_hash.as_deref(),
            Some(current_state_hash(&dirty).as_str())
        );
    }

    #[test]
    fn authorized_roots_include_backend_owned_repo_and_skills_roots() {
        let tmp = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(tmp.path()).unwrap();
        let repo = base.join("repo");
        let workspace = repo.join("crates").join("app");
        fs::create_dir_all(&workspace).unwrap();
        fs::create_dir_all(repo.join(".git")).unwrap();

        let authorized = canonical_authorized_roots(&[workspace.to_string_lossy().to_string()]);
        assert!(authorized.contains(&workspace));

        assert!(authorized.contains(&fs::canonicalize(&repo).unwrap()));

        let skills_root = crate::services::skills::skills_root_dir().unwrap();
        assert!(authorized.contains(&skills_root));
    }

    #[test]
    fn worktree_records_under_parent_repo_root_stay_rewindable() {
        let tmp = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(tmp.path()).unwrap();
        let repo = base.join("repo");
        let workspace = repo.join("crates").join("app");
        fs::create_dir_all(&workspace).unwrap();
        fs::create_dir_all(repo.join(".git")).unwrap();
        let ckpt = base.join("ckpt");


        let file = repo.join("shared.txt");
        fs::write(&file, "v1").unwrap();
        let seq = capture_at(
            &ckpt,
            "turn-1",
            &fs::canonicalize(&repo).unwrap(),
            &rel(&file, &repo),
            PreImage::File(None),
        )
        .unwrap();
        fs::write(&file, "v2").unwrap();


        let authorized = canonical_authorized_roots(&[workspace.to_string_lossy().to_string()]);
        let result = rewind_at(&ckpt, seq, &authorized, None);
        assert!(result.failed.is_empty(), "failed: {:?}", result.failed);
        assert_eq!(result.restored_files, 1);
        assert_eq!(fs::read_to_string(&file).unwrap(), "v1");
    }

    #[test]
    fn rewind_marker_cuts_stale_future_turns() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");
        let file = root.join("a.txt");
        let r = rel(&file, &root);
        fs::write(&file, "v1").unwrap();

        let seq = capture_at(&ckpt, "turn-1", &root, &r, PreImage::File(None)).unwrap();
        fs::write(&file, "v2").unwrap();
        let result = rewind_at(&ckpt, seq, &roots(&root), None);
        assert_eq!(result.restored_files, 1);



        append_rewind_marker(&ckpt, seq);
        assert!(live_records(read_index(&ckpt)).is_empty());
        let (records, errors) = earliest_records_since(&ckpt, 1);
        assert!(records.is_empty());
        assert_eq!(errors, 0);


        fs::write(&file, "v3").unwrap();
        let next = capture_at(&ckpt, "turn-2", &root, &r, PreImage::File(None)).unwrap();
        assert!(next > seq);
        let (records, _) = earliest_records_since(&ckpt, next);
        assert_eq!(records.len(), 1);
    }

    #[test]
    fn partial_rewind_marker_does_not_cut_timeline() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");
        let file = root.join("a.txt");
        let r = rel(&file, &root);
        fs::write(&file, "v1").unwrap();

        let seq = capture_at(&ckpt, "turn-1", &root, &r, PreImage::File(None)).unwrap();
        fs::write(&file, "v2").unwrap();


        append_rewind_marker(&ckpt, 0);
        let (records, _) = earliest_records_since(&ckpt, seq);
        assert_eq!(records.len(), 1);
        let result = rewind_at(&ckpt, seq, &roots(&root), None);
        assert_eq!(result.restored_files, 1);
    }

    fn append_rewind_marker(ckpt: &Path, turn_seq: u64) {
        append_record(
            ckpt,
            &CheckpointRecord {
                schema: 2,
                turn_seq,
                turn_id: String::new(),
                root: String::new(),
                rel_path: String::new(),
                kind: "rewind".to_string(),
                existed_before: false,
                blob: None,
                size: 0,
                mtime_ms: 0,
                captured_at: now_ms(),
                note: None,
                mode: None,
            },
        )
        .unwrap();
    }

    #[test]
    fn missing_expected_hash_is_treated_as_conflict() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");
        let dirty = root.join("dirty.txt");
        let untouched = root.join("clean.txt");
        fs::write(&dirty, "v1").unwrap();
        fs::write(&untouched, "same").unwrap();

        let seq = capture_at(
            &ckpt,
            "turn-1",
            &root,
            &rel(&dirty, &root),
            PreImage::File(None),
        )
        .unwrap();
        capture_at(
            &ckpt,
            "turn-1",
            &root,
            &rel(&untouched, &root),
            PreImage::File(None),
        )
        .unwrap();
        fs::write(&dirty, "v2").unwrap();



        let only_restore: Vec<CheckpointExpectedEntry> = expected_from_diff(&ckpt, seq, &root)
            .into_iter()
            .filter(|e| e.key.ends_with("dirty.txt"))
            .collect();
        assert_eq!(only_restore.len(), 1);
        fs::write(&untouched, "hand-edited").unwrap();

        let result = rewind_at(&ckpt, seq, &roots(&root), Some(&only_restore));
        assert_eq!(result.restored_files, 1);
        assert_eq!(result.conflicts.len(), 1);
        assert!(result.conflicts[0].ends_with("clean.txt"));
        assert_eq!(fs::read_to_string(&untouched).unwrap(), "hand-edited");


        let full = expected_from_diff(&ckpt, seq, &root);
        let result = rewind_at(&ckpt, seq, &roots(&root), Some(&full));
        assert!(result.conflicts.is_empty());
        assert_eq!(fs::read_to_string(&untouched).unwrap(), "same");
    }

    #[test]
    fn unauthorized_root_is_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");
        let file = root.join("a.txt");
        let r = rel(&file, &root);
        fs::write(&file, "v1").unwrap();

        let seq = capture_at(&ckpt, "turn-1", &root, &r, PreImage::File(None)).unwrap();
        fs::write(&file, "v2").unwrap();


        let result = rewind_at(&ckpt, seq, &[], None);
        assert_eq!(result.restored_files, 0);
        assert_eq!(result.failed.len(), 1);
        assert!(result.failed[0].contains("authorized workspace root"));
        assert_eq!(fs::read_to_string(&file).unwrap(), "v2");


        let (records, _) = earliest_records_since(&ckpt, seq);
        let entry = classify_entry(&ckpt, &records[0], &[]);
        assert_eq!(entry.action, "unresolvable");
        assert!(entry.current_hash.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_root_after_rename_is_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(tmp.path()).unwrap();
        let root = base.join("workspace");
        fs::create_dir_all(&root).unwrap();
        let ckpt = base.join("ckpt");
        let file = root.join("a.txt");
        let r = rel(&file, &root);
        fs::write(&file, "v1").unwrap();

        let seq = capture_at(&ckpt, "turn-1", &root, &r, PreImage::File(None)).unwrap();
        fs::write(&file, "v2").unwrap();



        let outside = base.join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("a.txt"), "outside-secret").unwrap();
        fs::rename(&root, base.join("workspace-moved")).unwrap();
        std::os::unix::fs::symlink(&outside, &root).unwrap();


        let result = rewind_at(&ckpt, seq, &roots(&root), None);
        assert_eq!(result.restored_files, 0);
        assert_eq!(result.failed.len(), 1);
        assert!(result.failed[0].contains("symlinked checkpoint root"));
        assert_eq!(
            fs::read_to_string(outside.join("a.txt")).unwrap(),
            "outside-secret"
        );


        let authorized = canonical_authorized_roots(&[root.to_string_lossy().to_string()]);
        assert!(!authorized.contains(&root));
    }

    #[cfg(unix)]
    #[test]
    fn worktree_pre_image_classification_reports_skips() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let file = root.join("a.txt");
        fs::write(&file, "v1").unwrap();
        let dir_path = root.join("sub");
        fs::create_dir_all(&dir_path).unwrap();
        let link = root.join("link");
        std::os::unix::fs::symlink(&file, &link).unwrap();

        assert!(matches!(
            classify_worktree_pre_image(&file),
            Ok(PreImage::File(None))
        ));
        assert!(matches!(
            classify_worktree_pre_image(&dir_path),
            Ok(PreImage::Dir)
        ));
        assert!(matches!(
            classify_worktree_pre_image(&root.join("nope.txt")),
            Ok(PreImage::Missing)
        ));



        let Err(err) = classify_worktree_pre_image(&link) else {
            panic!("符号链接不能被当成可捕获的前像");
        };
        assert!(err.contains("symlink"));
    }

    #[test]
    fn capture_error_marks_rewind_partial_and_keeps_timeline() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");
        let file = root.join("a.txt");
        let r = rel(&file, &root);
        fs::write(&file, "v1").unwrap();

        let seq = capture_at(&ckpt, "turn-1", &root, &r, PreImage::File(None)).unwrap();

        append_error_record(
            &ckpt,
            seq,
            "turn-1",
            &normalize_root(&root),
            "big.bin",
            "file too large to checkpoint",
        );
        fs::write(&file, "v2").unwrap();

        let result = {
            let _guard = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            rewind_and_mark_at(&ckpt, seq, &roots(&root), None)
        };

        assert_eq!(result.restored_files, 1);
        assert_eq!(result.capture_errors, 1);
        assert!(!rewind_is_complete(&result));


        let live = live_records(read_index(&ckpt));
        assert!(live.iter().any(|rec| rec.kind == "error"));
        assert!(live.iter().any(|rec| rec.kind == "file"));
    }

    #[test]
    fn complete_rewind_marker_prunes_timeline() {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");
        let file = root.join("a.txt");
        let r = rel(&file, &root);
        fs::write(&file, "v1").unwrap();

        let seq = capture_at(&ckpt, "turn-1", &root, &r, PreImage::File(None)).unwrap();
        fs::write(&file, "v2").unwrap();

        let result = {
            let _guard = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            rewind_and_mark_at(&ckpt, seq, &roots(&root), None)
        };
        assert!(rewind_is_complete(&result));
        assert_eq!(fs::read_to_string(&file).unwrap(), "v1");

        assert!(live_records(read_index(&ckpt)).is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn chmod_between_preview_and_rewind_is_a_conflict() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");
        let file = root.join("a.txt");
        let r = rel(&file, &root);
        fs::write(&file, "v1").unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();

        let seq = capture_at(&ckpt, "turn-1", &root, &r, PreImage::File(None)).unwrap();
        fs::write(&file, "v2").unwrap();



        let expected = expected_from_diff(&ckpt, seq, &root);
        fs::set_permissions(&file, fs::Permissions::from_mode(0o755)).unwrap();

        let result = rewind_at(&ckpt, seq, &roots(&root), Some(&expected));
        assert_eq!(result.restored_files, 0);
        assert_eq!(result.conflicts.len(), 1);
        assert_eq!(fs::read_to_string(&file).unwrap(), "v2");
        assert_eq!(file_mode(&file).unwrap() & 0o777, 0o755);
    }

    #[cfg(unix)]
    #[test]
    fn mode_only_drift_previews_as_restore_and_is_restored() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let ckpt = root.join("ckpt");
        let file = root.join("run.sh");
        let r = rel(&file, &root);
        fs::write(&file, "#!/bin/sh\n").unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o755)).unwrap();

        let seq = capture_at(&ckpt, "turn-1", &root, &r, PreImage::File(None)).unwrap();


        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();

        let (records, _) = earliest_records_since(&ckpt, seq);
        let entry = classify_entry(&ckpt, &records[0], &roots(&root));
        assert_eq!(entry.action, "restore");

        let expected = expected_from_diff(&ckpt, seq, &root);
        let result = rewind_at(&ckpt, seq, &roots(&root), Some(&expected));
        assert_eq!(result.restored_files, 1);
        assert_eq!(file_mode(&file).unwrap() & 0o777, 0o755);
        assert_eq!(fs::read_to_string(&file).unwrap(), "#!/bin/sh\n");
    }
}
