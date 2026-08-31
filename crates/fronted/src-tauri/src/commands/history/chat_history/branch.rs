


/// Must match BRANCH_CONVERSATION_DEFAULT_TITLE in src/lib/chat/page/chatPageHelpers.ts.
pub(crate) const BRANCH_DEFAULT_TITLE: &str = "新分支";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatHistoryBranchAnchor {
    pub segment_index: i64,
    pub message_index: i64,
    pub segment_id: String,
    pub message_id: String,
    pub role: String,
    pub content_hash: String,
}

fn validate_branch_anchor(anchor: &ChatHistoryBranchAnchor) -> Result<(), String> {
    if anchor.segment_index < 0 || anchor.message_index < 0 {
        return Err("分支锚点 segmentIndex/messageIndex 不能小于 0".to_string());
    }
    if anchor.segment_id.trim().is_empty()
        || anchor.message_id.trim().is_empty()
        || anchor.content_hash.trim().is_empty()
    {
        return Err("分支锚点缺少 segmentId、messageId 或 contentHash".to_string());
    }
    if anchor.role.trim() != "user" {
        return Err("分支锚点 role 必须为 user".to_string());
    }
    Ok(())
}

fn parse_branch_segment_messages(segment: &ChatHistorySegmentRecord) -> Result<Vec<Value>, String> {
    let parsed = serde_json::from_str::<Value>(&segment.messages_json)
        .map_err(|e| format!("解析历史分段 {} 失败：{e}", segment.segment_id))?;
    parsed
        .as_array()
        .cloned()
        .ok_or_else(|| format!("历史分段 {} 的消息不是数组", segment.segment_id))
}

fn branch_message_role_is_user(message: &Value) -> bool {
    message
        .as_object()
        .and_then(|object| object.get("role"))
        .and_then(Value::as_str)
        .map(str::trim)
        == Some("user")
}

fn branch_stable_message_id(message: &Value, segment_index: i64, message_index: usize) -> String {
    history_message_id_for_ref(message).unwrap_or_else(|| {
        format!(
            "segment-{segment_index}-message-{message_index}-{}",
            read_message_timestamp(message)
        )
    })
}

fn build_branch_sliced_segment(
    record: &ChatHistorySegmentRecord,
    kept_messages: &[Value],
    new_segment_index: i64,
) -> Result<ChatHistorySegmentInput, String> {
    let last_index = kept_messages.len().saturating_sub(1);
    let start_message_id = kept_messages
        .first()
        .map(|message| branch_stable_message_id(message, new_segment_index, 0));
    let end_message_id = kept_messages
        .last()
        .map(|message| branch_stable_message_id(message, new_segment_index, last_index));
    let updated_at = kept_messages
        .last()
        .map(read_message_timestamp)
        .unwrap_or(record.updated_at);
    let messages_json =
        serde_json::to_string(kept_messages).map_err(|e| format!("序列化分支分段消息失败：{e}"))?;

    Ok(ChatHistorySegmentInput {
        segment_index: new_segment_index,
        segment_id: record.segment_id.clone(),
        summary_json: record.summary_json.clone(),
        messages_json,
        message_count: i64::try_from(kept_messages.len()).unwrap_or(i64::MAX),
        start_message_id,
        end_message_id,
        created_at: record.created_at,
        updated_at,
    })
}

pub(crate) fn build_branch_segments(
    segments: &[ChatHistorySegmentRecord],
    anchor: &ChatHistoryBranchAnchor,
) -> Result<(Vec<ChatHistorySegmentInput>, i64), String> {
    let message_ref = ChatHistoryMessageRef {
        segment_index: anchor.segment_index,
        message_index: anchor.message_index,
        segment_id: anchor.segment_id.clone(),
        message_id: anchor.message_id.clone(),
        role: anchor.role.clone(),
        content_hash: anchor.content_hash.clone(),
    };
    let location = locate_history_message_ref(segments, &message_ref)
        .map_err(|error| format!("未找到匹配的分支锚点消息：{error}"))?;
    let anchor_segment_pos = location.segment_position;
    let anchor_messages = location.messages;
    let anchor_position = location.message_index;




    let mut cut: Option<(usize, usize)> = None;
    let mut saw_reply_after_anchor = false;
    'scan: for (segment_pos, segment) in segments.iter().enumerate().skip(anchor_segment_pos) {
        let parsed;
        let messages: &[Value] = if segment_pos == anchor_segment_pos {
            &anchor_messages
        } else {
            parsed = parse_branch_segment_messages(segment)?;
            &parsed
        };
        let scan_from = if segment_pos == anchor_segment_pos {
            anchor_position + 1
        } else {
            0
        };
        for (message_index, message) in messages.iter().enumerate().skip(scan_from) {
            if branch_message_role_is_user(message) {
                cut = Some((segment_pos, message_index));
                break 'scan;
            }
            saw_reply_after_anchor = true;
        }
    }
    if !saw_reply_after_anchor {
        return Err("分支目标回复尚未写入历史，请稍后重试".to_string());
    }

    let mut kept: Vec<ChatHistorySegmentInput> = Vec::new();
    match cut {
        Some((cut_segment_pos, cut_message_index)) if cut_segment_pos == anchor_segment_pos => {

            for segment in &segments[..anchor_segment_pos] {
                kept.push(record_to_segment_input(segment));
            }
            let new_index = kept.len() as i64;
            kept.push(build_branch_sliced_segment(
                &segments[anchor_segment_pos],
                &anchor_messages[..cut_message_index],
                new_index,
            )?);
        }
        Some((cut_segment_pos, cut_message_index)) => {


            for segment in &segments[..cut_segment_pos] {
                kept.push(record_to_segment_input(segment));
            }
            if cut_message_index > 0 {
                let cut_messages = parse_branch_segment_messages(&segments[cut_segment_pos])?;
                let new_index = kept.len() as i64;
                kept.push(build_branch_sliced_segment(
                    &segments[cut_segment_pos],
                    &cut_messages[..cut_message_index],
                    new_index,
                )?);
            }
        }
        None => {
            for segment in segments {
                kept.push(record_to_segment_input(segment));
            }
        }
    }

    for (index, segment) in kept.iter_mut().enumerate() {
        segment.segment_index = index as i64;
    }
    let total_message_count = kept.iter().fold(0_i64, |acc, segment| {
        acc.saturating_add(segment.message_count.max(0))
    });

    Ok((kept, total_message_count))
}

fn patch_branch_context_meta(
    raw: &str,
    active_segment_index: i64,
    total_segment_count: i64,
    total_message_count: i64,
) -> String {
    match serde_json::from_str::<Value>(raw) {
        Ok(mut parsed) => match parsed.as_object_mut() {
            Some(object) => {
                object.insert(
                    "activeSegmentIndex".to_string(),
                    Value::from(active_segment_index),
                );
                object.insert(
                    "totalSegmentCount".to_string(),
                    Value::from(total_segment_count),
                );
                object.insert(
                    "totalMessageCount".to_string(),
                    Value::from(total_message_count),
                );
                parsed.to_string()
            }
            None => raw.to_string(),
        },
        Err(_) => raw.to_string(),
    }
}

pub(crate) fn chat_history_branch_sync(
    conn: &mut Connection,
    source_id: &str,
    anchor: &ChatHistoryBranchAnchor,
) -> Result<ChatHistorySummary, String> {
    let source_id = source_id.trim();
    if source_id.is_empty() {
        return Err("历史对话 id 不能为空".to_string());
    }
    validate_branch_anchor(anchor)?;

    let tx = conn
        .transaction()
        .map_err(|e| format!("开启分支会话事务失败：{e}"))?;

    let source = get_record_by_id(&tx, source_id)?;
    let source_segments = load_segments(&tx, &source.id)?;
    if source_segments.is_empty() {
        return Err("历史对话缺少分段数据".to_string());
    }

    let (segments, total_message_count) = build_branch_segments(&source_segments, anchor)?;
    let total_segment_count = segments.len() as i64;
    let active_segment_index = total_segment_count - 1;
    let context_meta_json = patch_branch_context_meta(
        &source.context_meta_json,
        active_segment_index,
        total_segment_count,
        total_message_count,
    );

    let new_id = Uuid::new_v4().to_string();
    let now = now_ms();
    let conversation = ChatHistoryConversationInput {
        id: new_id.clone(),
        title: BRANCH_DEFAULT_TITLE.to_string(),
        provider_id: source.provider_id.clone(),
        model: source.model.clone(),
        session_id: None,
        cwd: source.cwd.clone(),
        selected_model_json: source.selected_model_json.clone(),
        context_meta_json,
        active_segment_index,
        total_segment_count,
        total_message_count,
        created_at: Some(now),
        updated_at: now,
    };
    validate_conversation_input(&conversation)?;

    upsert_chat_history_header(&tx, &conversation)?;
    for segment in &segments {
        insert_single_segment(&tx, &new_id, segment)?;
    }
    verify_chat_history_consistency(&tx, &new_id)?;

    tx.commit()
        .map_err(|e| format!("提交分支会话事务失败：{e}"))?;

    get_summary_by_id(conn, &new_id)
}

pub(crate) async fn chat_history_branch_inner(
    id: String,
    anchor: ChatHistoryBranchAnchor,
) -> Result<ChatHistorySummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_db()?;
        chat_history_branch_sync(&mut conn, &id, &anchor)
    })
    .await
    .map_err(|e| format!("chat_history_branch join 失败：{e}"))?
}

#[tauri::command]
pub async fn chat_history_branch(
    id: String,
    base_message_ref: ChatHistoryBranchAnchor,
) -> Result<ChatHistorySummary, String> {
    chat_history_branch_inner(id, base_message_ref).await
}
