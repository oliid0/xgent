//! Import actual ZIP bytes into a new workspace directory. Never execute archive
//! contents or treat a successful job/import as verified user-task completion.
use std::collections::BTreeSet;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

const MAX_ENTRIES: usize = 256;
const MAX_FILE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudExtractedFile { pub path: String, pub bytes: u64, pub content_hash: String }

pub(crate) fn portable_name(raw: &str, directory: bool) -> Result<String, String> {
    let name = if directory { raw.strip_suffix('/').unwrap_or(raw) } else { raw };
    if name.is_empty() || name.len() > 1024 || name.chars().any(|c| matches!(c, '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        || name.chars().any(|c| c.is_control()) { return Err("Artifact entry has an unsafe portable path".into()); }
    for part in name.split('/') {
        let stem = part.split('.').next().unwrap_or_default().to_ascii_uppercase();
        if part.is_empty() || matches!(part, "." | "..") || part.ends_with('.') || part.ends_with(' ') || part.len() > 180
            || matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")) && matches!(stem.as_bytes()[3], b'1'..=b'9')) {
            return Err("Artifact entry has a non-portable path component".into());
        }
    }
    Ok(name.to_string())
}

pub(crate) fn open_archive(archive:&Path)->Result<zip::ZipArchive<File>,String>{
    let mut zip = zip::ZipArchive::new(File::open(archive).map_err(|e| e.to_string())?).map_err(|e| format!("Unreadable cloud ZIP: {e}"))?;
    if zip.len() > MAX_ENTRIES { return Err("Cloud artifact exceeds 256 entries".into()); }
    let mut paths = BTreeSet::new(); let mut declared = 0_u64;
    for index in 0..zip.len() {
        let entry = zip.by_index(index).map_err(|e| e.to_string())?;
        if entry.encrypted() || entry.is_symlink() || entry.enclosed_name().is_none() { return Err("Encrypted, linked or escaping artifact entry is unsupported".into()); }
        if let Some(mode) = entry.unix_mode() {
            if !matches!(mode & 0o170000, 0 | 0o100000 | 0o040000) { return Err("Artifact special files are unsupported".into()); }
        }
        let name = portable_name(entry.name(), entry.is_dir())?;
        if !paths.insert(name.to_lowercase()) { return Err("Artifact paths collide on portable filesystems".into()); }
        if !entry.is_dir() {
            if entry.size() > MAX_FILE_BYTES { return Err("Artifact file exceeds 512 MiB".into()); }
            declared = declared.saturating_add(entry.size());
            if declared > MAX_TOTAL_BYTES { return Err("Expanded artifact exceeds 1 GiB".into()); }
        }
    }
    Ok(zip)
}

pub(crate) fn extract(archive: &Path, base: &Path, task: &str, artifact: u64) -> Result<(PathBuf, Vec<CloudExtractedFile>), String> {
    fs::create_dir_all(base).map_err(|e| e.to_string())?;
    let base = base.canonicalize().map_err(|e| e.to_string())?;
    if base.as_os_str().to_string_lossy().len() > 4096 { return Err("Artifact destination path exceeds receipt bounds".into()); }
    let mut zip=open_archive(archive)?;
    let prefix = format!("cloud-results-{task}-{artifact}-{}", Uuid::new_v4().simple());
    let staging = base.join(format!(".{prefix}.part")); let published = base.join(&prefix);
    fs::create_dir(&staging).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    { use std::os::unix::fs::PermissionsExt; fs::set_permissions(&staging, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?; }
    let result = (|| {
        let mut files = Vec::new(); let mut actual = 0_u64;
        for index in 0..zip.len() {
            let mut entry = zip.by_index(index).map_err(|e| e.to_string())?;
            let name = portable_name(entry.name(), entry.is_dir())?; let destination = staging.join(&name);
            if entry.is_dir() { fs::create_dir_all(&destination).map_err(|e| e.to_string())?; continue; }
            let expected = entry.size(); let mut bytes=0_u64;let mut hash=Sha256::new();let mut buffer=vec![0;256*1024];
            fs::create_dir_all(destination.parent().ok_or("Artifact path has no parent")?).map_err(|e| e.to_string())?;
            let mut file = OpenOptions::new().write(true).create_new(true).open(&destination).map_err(|e| e.to_string())?;
            loop {
                let size=entry.read(&mut buffer).map_err(|e|format!("Artifact decompression/CRC failed: {e}"))?;
                if size==0 {break;}
                bytes=bytes.checked_add(size as u64).ok_or("Expanded artifact length overflow")?;
                actual=actual.checked_add(size as u64).ok_or("Expanded artifact total overflow")?;
                if bytes>expected || bytes>MAX_FILE_BYTES || actual>MAX_TOTAL_BYTES {return Err("Expanded artifact exceeds its declared file/total bound".into());}
                hash.update(&buffer[..size]);file.write_all(&buffer[..size]).map_err(|e|e.to_string())?;
            }
            if bytes!=expected {return Err("Expanded artifact file size is inconsistent".into());}
            file.sync_all().map_err(|e|e.to_string())?;
            files.push(CloudExtractedFile { path: format!("{prefix}/{name}"), bytes, content_hash: hex::encode(hash.finalize()) });
        }
        if serde_json::to_vec(&files).map_err(|e| e.to_string())?.len() > 96 * 1024 { return Err("Artifact file manifest exceeds durable receipt bounds".into()); }
        fs::rename(&staging, &published).map_err(|e| format!("Publish extracted cloud artifact failed: {e}"))?;
        Ok((published, files))
    })();
    if result.is_err() && staging.parent() == Some(base.as_path()) {
        // Only this newly-created private staging directory; archive names
        // cannot select a cleanup target and links are never extracted.
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn portable_paths_do_not_silently_rewrite_escaping_or_colliding_names() {
        for name in ["../escape", "/absolute", "a/../b", "a\\b", "a:stream", "CON.txt", "LPT1", "tail.", "a//b"] { assert!(portable_name(name, false).is_err(), "{name}"); }
        assert_eq!(portable_name("docs/report.docx", false).unwrap(), "docs/report.docx");
        assert_eq!(portable_name("docs/", true).unwrap(), "docs");
    }

    #[test]
    fn actual_zip_import_publishes_files_and_hashes_and_rejects_case_collisions_without_publishing() {
        use zip::write::SimpleFileOptions;
        let root = std::env::temp_dir().join(format!("xgent-cloud-import-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let archive = root.join("input.zip"); let output = root.join("workspace");
        let create = |entries: &[(&str, &[u8])]| {
            let mut zip = zip::ZipWriter::new(File::create(&archive).unwrap());
            for (name, content) in entries { zip.start_file(*name, SimpleFileOptions::default()).unwrap(); zip.write_all(content).unwrap(); }
            zip.finish().unwrap();
        };
        create(&[("product.html", b"<h1>Product</h1>"), ("docs/plan.txt", b"actual plan")]);
        let (published, files) = extract(&archive, &output, "task-actual", 42).unwrap();
        assert_eq!(files.len(), 2); assert_eq!(fs::read(published.join("docs/plan.txt")).unwrap(), b"actual plan");
        assert_eq!(files[0].content_hash, hex::encode(Sha256::digest(b"<h1>Product</h1>")));
        assert_eq!(fs::read_dir(&output).unwrap().count(), 1);
        create(&[("report.txt", b"one"), ("REPORT.txt", b"two")]);
        assert!(extract(&archive, &output, "task-actual", 43).is_err());
        assert_eq!(fs::read_dir(&output).unwrap().count(), 1);
        create(&[("safe.txt", b"safe"), ("../escape.txt", b"escape")]);
        assert!(extract(&archive, &output, "task-actual", 44).is_err());
        assert_eq!(fs::read_dir(&output).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}
