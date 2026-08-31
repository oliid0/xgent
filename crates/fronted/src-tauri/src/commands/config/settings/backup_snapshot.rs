
//





pub(crate) const BACKUP_PROTOCOL_VERSION: u32 = 1;
pub(crate) const BACKUP_SCHEMA_VERSION: u32 = 1;

const BACKUP_MANIFEST_FIELD: &str = "_manifest";
const BACKUP_MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;
const BACKUP_RETENTION: usize = 10;
const BACKUP_DIRNAME: &str = "backups";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub protocol_version: u32,
    pub schema_version: u32,
    pub snapshot_id: String,
        pub created_at: String,
    pub device_name: String,
    pub app_version: String,
        #[serde(default = "default_backup_encryption")]
    pub encryption: String,
        #[serde(default)]
    pub domains: BackupDomainCounts,
}

fn default_backup_encryption() -> String {
    "none".to_string()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupDomainCounts {
    #[serde(default)]
    pub providers: usize,
    #[serde(default)]
    pub mcp: usize,
    #[serde(default)]
    pub system: usize,
    #[serde(default)]
    pub skills: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSnapshot {
    #[serde(default)]
    pub providers: Option<Value>,
    #[serde(default)]
    pub mcp: Option<Value>,
    #[serde(default)]
    pub system: Option<Value>,
        #[serde(default)]
    pub skills: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupImportPreview {
    pub path: String,
    pub manifest: BackupManifest,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupApplyOutcome {
    pub applied: BackupDomainCounts,
    pub skills: Option<Value>,
        pub backup_path: Option<String>,
}

fn backup_dir() -> Result<PathBuf, String> {
    let dir = config_dir()?.join(BACKUP_DIRNAME);
    fs::create_dir_all(&dir).map_err(|e| format!("创建备份目录失败：{e}"))?;
    Ok(dir)
}

fn backup_device_name() -> String {
    hostname_label().unwrap_or_else(|| "unknown-device".to_string())
}

fn hostname_label() -> Option<String> {
    for key in ["COMPUTERNAME", "HOSTNAME"] {
        if let Ok(value) = std::env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}


fn rfc3339_now() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

fn count_domain(value: Option<&Value>) -> usize {
    match value {
        Some(Value::Array(items)) => items.len(),
        Some(Value::Object(map)) => map.len(),
        _ => 0,
    }
}

fn count_mcp_servers(value: Option<&Value>) -> usize {
    value
        .and_then(|mcp| mcp.get("servers"))
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0)
}

fn count_skills(value: Option<&Value>) -> usize {
    value
        .and_then(|skills| skills.get("selected"))
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0)
}

pub(crate) fn snapshot_domain_counts(snapshot: &BackupSnapshot) -> BackupDomainCounts {
    BackupDomainCounts {
        providers: count_domain(snapshot.providers.as_ref()),
        mcp: count_mcp_servers(snapshot.mcp.as_ref()),
        system: count_domain(snapshot.system.as_ref()),
        skills: count_skills(snapshot.skills.as_ref()),
    }
}

pub(crate) fn build_backup_manifest(snapshot: &BackupSnapshot) -> BackupManifest {
    BackupManifest {
        protocol_version: BACKUP_PROTOCOL_VERSION,
        schema_version: BACKUP_SCHEMA_VERSION,
        snapshot_id: Uuid::new_v4().to_string(),
        created_at: rfc3339_now(),
        device_name: backup_device_name(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        encryption: default_backup_encryption(),
        domains: snapshot_domain_counts(snapshot),
    }
}


pub(crate) fn collect_backup_snapshot(
    conn: &Connection,
    skills: Option<Value>,
) -> Result<BackupSnapshot, String> {
    Ok(BackupSnapshot {
        providers: load_providers(conn)?,
        mcp: load_mcp(conn)?,
        system: load_system(conn)?,
        skills,
    })
}

pub(crate) fn validate_backup_manifest(manifest: &BackupManifest) -> Result<(), String> {
    if manifest.protocol_version > BACKUP_PROTOCOL_VERSION {
        return Err(format!(
            "备份文件格式版本 {} 高于当前支持的 {BACKUP_PROTOCOL_VERSION}，请升级应用后重试",
            manifest.protocol_version
        ));
    }
    if manifest.schema_version > BACKUP_SCHEMA_VERSION {
        return Err(format!(
            "备份文件配置版本 {} 高于当前支持的 {BACKUP_SCHEMA_VERSION}，请升级应用后重试",
            manifest.schema_version
        ));
    }
    if manifest.encryption != "none" {
        return Err(format!(
            "暂不支持的加密方式：{}",
            manifest.encryption
        ));
    }
    Ok(())
}

pub(crate) fn validate_backup_snapshot(snapshot: &BackupSnapshot) -> Result<(), String> {
    if let Some(providers) = &snapshot.providers {
        if !providers.is_array() {
            return Err("备份内容 providers 必须是数组".to_string());
        }
    }
    if let Some(mcp) = &snapshot.mcp {
        let mcp = mcp
            .as_object()
            .ok_or_else(|| "备份内容 mcp 必须是对象".to_string())?;
        if let Some(servers) = mcp.get("servers") {
            if !servers.is_array() {
                return Err("备份内容 mcp.servers 必须是数组".to_string());
            }
        }
        if let Some(selected) = mcp.get("selected") {
            if !selected.is_array() {
                return Err("备份内容 mcp.selected 必须是数组".to_string());
            }
        }
    }
    if let Some(system) = &snapshot.system {
        if !system.is_object() {
            return Err("备份内容 system 必须是对象".to_string());
        }
    }
    if let Some(skills) = &snapshot.skills {
        if !skills.is_object() {
            return Err("备份内容 skills 必须是对象".to_string());
        }
    }
    Ok(())
}

pub(crate) fn serialize_backup_document(
    snapshot: &BackupSnapshot,
    manifest: &BackupManifest,
) -> Result<String, String> {
    let mut document = match serde_json::to_value(snapshot)
        .map_err(|e| format!("序列化备份内容失败：{e}"))?
    {
        Value::Object(map) => map,
        _ => return Err("序列化备份内容失败：预期对象".to_string()),
    };
    document.insert(
        BACKUP_MANIFEST_FIELD.to_string(),
        serde_json::to_value(manifest).map_err(|e| format!("序列化备份元信息失败：{e}"))?,
    );
    serde_json::to_string_pretty(&Value::Object(document))
        .map_err(|e| format!("序列化备份文件失败：{e}"))
}

pub(crate) fn parse_backup_document(raw: &str) -> Result<(BackupSnapshot, BackupManifest), String> {
    let mut document = expect_object(
        parse_json(raw, "备份文件")?,
        "备份文件",
    )?;
    let manifest_value = document
        .remove(BACKUP_MANIFEST_FIELD)
        .ok_or_else(|| "备份文件缺少元信息，可能不是 Xgent 导出的配置".to_string())?;
    let manifest = serde_json::from_value::<BackupManifest>(manifest_value)
        .map_err(|e| format!("解析备份元信息失败：{e}"))?;
    validate_backup_manifest(&manifest)?;

    let snapshot = serde_json::from_value::<BackupSnapshot>(Value::Object(document))
        .map_err(|e| format!("解析备份内容失败：{e}"))?;
    validate_backup_snapshot(&snapshot)?;
    Ok((snapshot, manifest))
}

pub(crate) fn read_backup_file(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|e| format!("读取备份文件失败：{e}"))?;
    if metadata.len() > BACKUP_MAX_FILE_BYTES {
        return Err(format!(
            "备份文件过大（{} 字节），上限为 {BACKUP_MAX_FILE_BYTES} 字节",
            metadata.len()
        ));
    }
    fs::read_to_string(path).map_err(|e| format!("读取备份文件失败：{e}"))
}

pub(crate) fn backup_current_config(conn: &Connection) -> Result<Option<String>, String> {

    let snapshot = collect_backup_snapshot(conn, None)?;
    let manifest = build_backup_manifest(&snapshot);
    let document = serialize_backup_document(&snapshot, &manifest)?;

    let dir = backup_dir()?;
    let filename = format!("config-{}.json", now_ms());
    let path = dir.join(filename);
    fs::write(&path, document).map_err(|e| format!("写入备份文件失败：{e}"))?;
    prune_backups(&dir)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

fn prune_backups(dir: &Path) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("读取备份目录失败：{e}"))?;
    let mut files: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("config-") && name.ends_with(".json"))
        })
        .collect();
    if files.len() <= BACKUP_RETENTION {
        return Ok(());
    }

    files.sort();
    for path in files.iter().take(files.len() - BACKUP_RETENTION) {

        let _ = fs::remove_file(path);
    }
    Ok(())
}


pub(crate) fn apply_backup_snapshot_to_db(
    conn: &mut Connection,
    snapshot: &BackupSnapshot,
) -> Result<(), String> {
    if let Some(providers) = snapshot.providers.clone() {
        save_providers(conn, providers)?;
    }
    if let Some(mcp) = snapshot.mcp.clone() {
        save_mcp(conn, mcp)?;
    }
    if let Some(system) = snapshot.system.clone() {
        save_system(conn, system)?;
    }
    Ok(())
}


pub(crate) fn apply_backup_snapshot(
    conn: &mut Connection,
    snapshot: BackupSnapshot,
) -> Result<BackupApplyOutcome, String> {
    validate_backup_snapshot(&snapshot)?;
    let applied = snapshot_domain_counts(&snapshot);
    let backup_path = backup_current_config(conn)?;

    apply_backup_snapshot_to_db(conn, &snapshot)?;
    if snapshot.system.is_some() {

        refresh_system_proxy_state(conn)?;
    }

    Ok(BackupApplyOutcome {
        applied,
        skills: snapshot.skills,
        backup_path,
    })
}
