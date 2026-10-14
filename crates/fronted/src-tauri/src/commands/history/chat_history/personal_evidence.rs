const PERSONAL_HISTORY_MESSAGE_JSON_BYTES: i64 = 128 * 1024;
const PERSONAL_HISTORY_TEXT_CHARS: usize = 2000;

// Read only the requested original message, not an FTS snippet, summary or an
// entire conversation returned to the caller. Bound JSON before Rust parses it.
const PERSONAL_HISTORY_MESSAGE_SQL: &str = r#"
WITH selected AS (
    SELECT CASE WHEN json_valid(s.messages_json)
        THEN json_extract(s.messages_json, ?4) ELSE NULL END AS message
    FROM chatHistorySegment s JOIN chatHistory h ON h.id = s.conversation_id
    WHERE h.id = ?1 AND s.segment_index = ?2 AND s.segment_id = ?3
)
SELECT CASE WHEN typeof(message) = 'text' AND json_valid(message)
    THEN CASE WHEN json_type(message) = 'object'
        AND length(CAST(message AS BLOB)) <= ?5 THEN message ELSE NULL END
    ELSE NULL END FROM selected
"#;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalHistoryEvidenceArgs {
    pub conversation_id: String,
    pub segment_index: i64,
    pub segment_id: String,
    pub message_index: i64,
    pub message_id: String,
    pub expected_content_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalHistoryEvidenceRecord {
    pub conversation_id: String,
    pub segment_index: i64,
    pub segment_id: String,
    pub message_index: i64,
    pub message_id: String,
    pub role: String,
    pub content_hash: String,
    pub timestamp: Option<i64>,
    pub text: String,
    pub truncated: bool,
}

fn read_personal_history_evidence(
    conn: &Connection,
    args: PersonalHistoryEvidenceArgs,
) -> Result<PersonalHistoryEvidenceRecord, String> {
    if args.segment_index < 0 || args.message_index < 0
        || [&args.conversation_id, &args.segment_id, &args.message_id].iter()
            .any(|id| id.trim().is_empty() || id.len() > 512)
        || args.expected_content_hash.as_ref().is_some_and(|hash| hash.len() > 128)
    {
        return Err("Invalid personal history message reference".into());
    }
    let path = format!("$[{}]", args.message_index);
    let raw: Option<Option<String>> = conn.query_row(
        PERSONAL_HISTORY_MESSAGE_SQL,
        params![args.conversation_id, args.segment_index, args.segment_id, path, PERSONAL_HISTORY_MESSAGE_JSON_BYTES],
        |row| row.get(0),
    ).optional().map_err(|error| format!("Read personal history message failed: {error}"))?;
    let raw = raw.flatten().ok_or("Original history message missing, invalid or too large")?;
    let message: Value = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
    let object = message.as_object().ok_or("Original history message is not an object")?;
    if object.get("role").and_then(Value::as_str) != Some("user") {
        return Err("Personal history evidence must be an original user message".into());
    }
    // Never use now_ms/segment updated_at as a surrogate original timestamp.
    let timestamp = object.get("timestamp").and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value > 0.0 && *value < i64::MAX as f64)
        .map(|value| value as i64).filter(|value| *value > 0);
    let message_id = match read_trimmed_string_field(object, "id") {
        Some(id) => id,
        None if timestamp.is_some() => compute_message_stable_id(&message, args.segment_index, args.message_index as usize),
        None => return Err("Original user message has no stable ID or timestamp".into()),
    };
    if message_id != args.message_id {
        return Err("Original personal history message identity changed".into());
    }
    let content_hash = history_message_content_hash(&message);
    if args.expected_content_hash.as_ref().is_some_and(|expected| expected != &content_hash) {
        return Err("Original personal history message content changed".into());
    }
    let full_text = object.get("xgentDisplayContent").and_then(Value::as_str)
        .map(str::to_string).unwrap_or_else(|| flatten_user_content(object.get("content")));
    let full_text = full_text.trim();
    let text: String = full_text.chars().take(PERSONAL_HISTORY_TEXT_CHARS).collect();
    let truncated = text.len() < full_text.len();
    Ok(PersonalHistoryEvidenceRecord {
        conversation_id: args.conversation_id, segment_index: args.segment_index,
        segment_id: args.segment_id, message_index: args.message_index, message_id,
        role: "user".into(), content_hash, timestamp, text, truncated,
    })
}

#[tauri::command]
pub async fn chat_history_read_personal_evidence(
    args: PersonalHistoryEvidenceArgs,
) -> Result<PersonalHistoryEvidenceRecord, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_db()?;
        read_personal_history_evidence(&conn, args)
    }).await.map_err(|error| format!("Personal history evidence read join failed: {error}"))?
}
