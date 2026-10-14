CREATE TABLE IF NOT EXISTS automation_proactive_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    execution_id TEXT NOT NULL UNIQUE,
    task_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('run_succeeded', 'run_failed')),
    occurred_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS automation_proactive_rules (
    rule_id TEXT PRIMARY KEY,
    config_json TEXT NOT NULL,
    binding_json TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    cursor INTEGER NOT NULL,
    last_queued_at INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS automation_proactive_deliveries (
    rule_id TEXT NOT NULL,
    event_sequence INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('queued', 'deferred', 'suppressed', 'rejected', 'revoked')),
    execution_id TEXT UNIQUE,
    reason TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (rule_id, event_sequence)
);
CREATE INDEX IF NOT EXISTS idx_proactive_delivery_execution
    ON automation_proactive_deliveries (execution_id);
CREATE INDEX IF NOT EXISTS idx_proactive_event_kind
    ON automation_proactive_events (kind, sequence);
CREATE INDEX IF NOT EXISTS idx_proactive_event_task
    ON automation_proactive_events (task_id, sequence);
CREATE TABLE IF NOT EXISTS automation_health_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    metric TEXT NOT NULL,
    occurred_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS automation_health_rule_activations (
    rule_id TEXT PRIMARY KEY,
    activated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_health_event_metric ON automation_health_events (metric,sequence);
-- Home notifications share the legacy device-event sequence namespace, so
-- delivery cursors/negative event identities cannot collide with Health.
CREATE TABLE IF NOT EXISTS automation_home_event_values (
    event_id TEXT PRIMARY KEY REFERENCES automation_health_events(event_id) ON DELETE CASCADE,
    payload_json TEXT NOT NULL
);
-- Actual opt-in SDK observations, frozen to the original rule and event scope.
CREATE TABLE IF NOT EXISTS automation_health_event_snapshots (
    rule_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    binding_hash TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    observed_at INTEGER NOT NULL,
    PRIMARY KEY (rule_id,event_id)
);
-- Original local receipts are not paired-host acceptance or completion.
CREATE TABLE IF NOT EXISTS automation_proactive_remote_deliveries (
    rule_id TEXT NOT NULL,
    event_sequence INTEGER NOT NULL,
    request_id TEXT NOT NULL UNIQUE,
    source_host_id TEXT NOT NULL,
    initiating_host_id TEXT NOT NULL,
    target_task_id TEXT NOT NULL,
    task_binding TEXT NOT NULL,
    occurred_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    locally_withdrawn INTEGER NOT NULL DEFAULT 0 CHECK (locally_withdrawn IN (0,1)),
    counted INTEGER NOT NULL DEFAULT 0 CHECK (counted IN (0,1)),
    PRIMARY KEY (rule_id,event_sequence)
);
CREATE INDEX IF NOT EXISTS idx_proactive_remote_target
    ON automation_proactive_remote_deliveries (target_task_id,request_id);
CREATE TRIGGER IF NOT EXISTS automation_proactive_run_insert
AFTER INSERT ON automation_cron_runs
WHEN NEW.state = 'done' AND NEW.finished_at IS NOT NULL
    AND NEW.output <> 'Skipped: previous run is still in progress.'
    AND NOT EXISTS (SELECT 1 FROM automation_proactive_deliveries d WHERE d.execution_id = NEW.execution_id)
BEGIN
    INSERT OR IGNORE INTO automation_proactive_events (execution_id, task_id, kind, occurred_at)
    VALUES (NEW.execution_id, NEW.task_id,
        CASE WHEN NEW.success = 1 THEN 'run_succeeded' ELSE 'run_failed' END, NEW.finished_at);
END;
CREATE TRIGGER IF NOT EXISTS automation_proactive_run_update
AFTER UPDATE OF state ON automation_cron_runs
WHEN NEW.state = 'done' AND OLD.state <> 'done' AND NEW.finished_at IS NOT NULL
    AND NEW.output <> 'Skipped: previous run is still in progress.'
    AND NOT EXISTS (SELECT 1 FROM automation_proactive_deliveries d WHERE d.execution_id = NEW.execution_id)
BEGIN
    INSERT OR IGNORE INTO automation_proactive_events (execution_id, task_id, kind, occurred_at)
    VALUES (NEW.execution_id, NEW.task_id,
        CASE WHEN NEW.success = 1 THEN 'run_succeeded' ELSE 'run_failed' END, NEW.finished_at);
END;
