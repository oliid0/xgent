
//


//




#[tauri::command]
pub async fn settings_backup_export(skills: Option<Value>) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db()?;
        let snapshot = collect_backup_snapshot(&conn, skills)?;
        let manifest = build_backup_manifest(&snapshot);
        let document = serialize_backup_document(&snapshot, &manifest)?;

        let default_name = format!("xgent-config-{}.json", now_ms());
        let Some(target) = rfd::FileDialog::new()
            .set_file_name(&default_name)
            .add_filter("Xgent 配置", &["json"])
            .save_file()
        else {
            return Ok(None);
        };

        fs::write(&target, document).map_err(|e| format!("写入备份文件失败：{e}"))?;
        Ok(Some(target.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| format!("settings_backup_export join 失败：{e}"))?
}


#[tauri::command]
pub async fn settings_backup_peek_import(
    path: Option<String>,
) -> Result<Option<BackupImportPreview>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let target = match path {
            Some(value) => PathBuf::from(value),
            None => {
                let Some(picked) = rfd::FileDialog::new()
                    .add_filter("Xgent 配置", &["json"])
                    .pick_file()
                else {
                    return Ok(None);
                };
                picked
            }
        };

        let raw = read_backup_file(&target)?;
        let (_, manifest) = parse_backup_document(&raw)?;
        Ok(Some(BackupImportPreview {
            path: target.to_string_lossy().into_owned(),
            manifest,
        }))
    })
    .await
    .map_err(|e| format!("settings_backup_peek_import join 失败：{e}"))?
}




#[tauri::command]
pub async fn settings_backup_apply_import(path: String) -> Result<BackupApplyOutcome, String> {
    let _guard = backup_sync_mutex().lock().await;
    tauri::async_runtime::spawn_blocking(move || {
        let target = PathBuf::from(path);
        let raw = read_backup_file(&target)?;
        let (snapshot, _) = parse_backup_document(&raw)?;
        let mut conn = open_db()?;
        apply_backup_snapshot(&mut conn, snapshot)
    })
    .await
    .map_err(|e| format!("settings_backup_apply_import join 失败：{e}"))?
}
