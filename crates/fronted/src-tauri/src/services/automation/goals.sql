CREATE TABLE IF NOT EXISTS automation_goals (
    goal_id TEXT PRIMARY KEY,
    config_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'completed')),
    parent_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goals_parent ON automation_goals(parent_id);
CREATE TABLE IF NOT EXISTS automation_goal_tasks (
    goal_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    task_name TEXT NOT NULL,
    linked_at INTEGER NOT NULL,
    PRIMARY KEY(goal_id, task_id)
);
CREATE TABLE IF NOT EXISTS automation_goal_activities (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    occurred_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS automation_goal_work (
    goal_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    task_name TEXT NOT NULL,
    linked_at INTEGER NOT NULL,
    PRIMARY KEY(goal_id, request_id)
);
CREATE INDEX IF NOT EXISTS idx_goal_work_request ON automation_goal_work(request_id);
CREATE INDEX IF NOT EXISTS idx_goal_activity ON automation_goal_activities(goal_id, occurred_at DESC);
CREATE TABLE IF NOT EXISTS automation_goal_receipts (
    request_id TEXT PRIMARY KEY,
    operation_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS automation_goal_launches (
    request_id TEXT PRIMARY KEY,
    goal_id TEXT NOT NULL,
    initiating_host_id TEXT NOT NULL,
    source_host_id TEXT NOT NULL,
    operation_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goal_launches_goal ON automation_goal_launches(goal_id);
-- Evidence consumption and explicit user resets survive retries/reopen. A
-- repeated remote result must not undo a later manual step reset.
CREATE TABLE IF NOT EXISTS automation_goal_step_receipts (
    request_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    goal_id TEXT NOT NULL,
    recorded_at INTEGER NOT NULL,
    PRIMARY KEY(request_id,step_id)
);

-- Scheduling a linked prompt is the existing explicit execution authority.
-- Context selection is observed metadata, never goal completion or a grant.
CREATE TABLE IF NOT EXISTS automation_goal_prompt_links (
    goal_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    store_id TEXT NOT NULL,
    task_binding TEXT NOT NULL,
    PRIMARY KEY(goal_id,task_id)
);
CREATE TABLE IF NOT EXISTS automation_goal_prompt_contexts (
    execution_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    task_binding TEXT NOT NULL,
    store_id TEXT NOT NULL,
    context_json TEXT,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS automation_goal_prompt_rotation (
    task_id TEXT NOT NULL,
    goal_id TEXT NOT NULL,
    selected_at INTEGER NOT NULL,
    PRIMARY KEY(task_id,goal_id)
);

-- Native event intake freezes original-store context with its exact outbox request.
CREATE TABLE IF NOT EXISTS automation_goal_event_contexts (
    request_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    task_binding TEXT NOT NULL,
    store_id TEXT NOT NULL,
    context_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS automation_goal_event_work (
    goal_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    goal_created_at INTEGER NOT NULL,
    unlinked INTEGER NOT NULL DEFAULT 0 CHECK(unlinked IN (0,1)),
    PRIMARY KEY(goal_id,request_id)
);
CREATE INDEX IF NOT EXISTS idx_goal_event_work_request ON automation_goal_event_work(request_id);

-- Manual links keep their semantics. Automatic event links require this original
-- goal incarnation, store and owned submission; duplicate appearances read once.
CREATE VIEW IF NOT EXISTS automation_goal_all_work AS
SELECT goal_id,request_id,task_name,linked_at FROM automation_goal_work
UNION ALL
SELECT l.goal_id,l.request_id,json_extract(s.input_json,'$.name') AS task_name,c.created_at AS linked_at
FROM automation_goal_event_work l
JOIN automation_goal_event_contexts c ON c.request_id=l.request_id
JOIN automation_goals g ON g.goal_id=l.goal_id AND g.created_at=l.goal_created_at
JOIN automation_submission_outbox s ON s.request_id=l.request_id
WHERE l.unlinked=0 AND c.store_id=(SELECT value FROM automation_meta WHERE key='goal_store_id.v1')
  AND s.initiating_host_id=(SELECT value FROM automation_meta WHERE key='background_worker_id.v1')
  AND NOT EXISTS(SELECT 1 FROM automation_goal_work manual WHERE manual.goal_id=l.goal_id AND manual.request_id=l.request_id);

-- All history remains in the paginated activity/artifact paths. The detail
-- surface shows all manual links, live event requests and four latest events.
CREATE VIEW IF NOT EXISTS automation_goal_display_work AS
SELECT w.goal_id,w.request_id,w.task_name,w.linked_at FROM automation_goal_all_work w
WHERE EXISTS(SELECT 1 FROM automation_goal_work manual WHERE manual.goal_id=w.goal_id AND manual.request_id=w.request_id)
   OR EXISTS(SELECT 1 FROM automation_result_watches watch WHERE watch.request_id=w.request_id AND watch.active=1)
   OR w.request_id IN (SELECT recent.request_id FROM automation_goal_event_work recent
       JOIN automation_goal_event_contexts context ON context.request_id=recent.request_id
       WHERE recent.goal_id=w.goal_id AND recent.unlinked=0 ORDER BY context.created_at DESC,recent.request_id DESC LIMIT 4);

-- Only this installation's originally accepted submissions can join a Goal.
-- An inbox entry by itself does not transfer task ownership from another phone.
CREATE VIEW IF NOT EXISTS automation_goal_remote_work AS
SELECT s.request_id, s.source_host_id,
       json_extract(s.input_json, '$.name') AS task_name,
       COALESCE(i.payload_json, s.result_json) AS payload_json,
       i.entry_id, COALESCE(i.received_at, s.created_at) AS observed_at,
       s.created_at
FROM automation_submission_outbox s
LEFT JOIN automation_result_inbox i ON i.sequence = (
    SELECT MAX(latest.sequence) FROM automation_result_inbox latest
    WHERE latest.request_id = s.request_id AND latest.source_host_id = s.source_host_id
      AND json_extract(latest.payload_json, '$.run.id') = json_extract(s.result_json, '$.run.id')
)
WHERE s.initiating_host_id = (SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1')
  AND s.source_host_id <> s.initiating_host_id AND s.result_json IS NOT NULL
  AND json_extract(s.result_json, '$.requestId') = s.request_id
  AND json_extract(s.result_json, '$.hostId') = s.source_host_id
  AND json_extract(s.result_json, '$.run.id') = json_extract(s.result_json, '$.run.taskId')
  AND NOT EXISTS (SELECT 1 FROM automation_background_tasks local WHERE local.request_id = s.request_id);

-- Files require a validated received snapshot, not dispatch/acceptance alone.
CREATE VIEW IF NOT EXISTS automation_goal_remote_artifacts AS
SELECT w.request_id, w.source_host_id, w.entry_id, w.task_name,
       json_extract(a.value, '$.id') AS artifact_id,
       json_extract(a.value, '$.relativePath') AS relative_path,
       json_extract(a.value, '$.contentHash') AS content_hash,
       json_extract(a.value, '$.bytes') AS bytes,
       COALESCE(json_extract(a.value, '$.createdAt'), (
           SELECT MIN(previous.received_at)
           FROM automation_result_inbox previous,
                json_each(previous.payload_json, '$.artifacts') original
           WHERE previous.request_id = w.request_id AND previous.source_host_id = w.source_host_id
             AND json_extract(original.value, '$.id') = json_extract(a.value, '$.id')
             AND json_extract(original.value, '$.relativePath') = json_extract(a.value, '$.relativePath')
             AND json_extract(original.value, '$.contentHash') = json_extract(a.value, '$.contentHash')
             AND json_extract(original.value, '$.bytes') = json_extract(a.value, '$.bytes')
       ), w.observed_at) AS created_at
FROM automation_goal_remote_work w, json_each(w.payload_json, '$.artifacts') a
WHERE w.entry_id IS NOT NULL;
