-- The original operation owns one upstream job; an unknown POST is never retried.
CREATE TABLE IF NOT EXISTS automation_video_jobs (
    execution_id TEXT NOT NULL, call_id TEXT NOT NULL,
    input_json TEXT NOT NULL, issuer_host_id TEXT NOT NULL, nonce TEXT NOT NULL,
    job_id TEXT, state TEXT NOT NULL CHECK (state IN ('issuing','pending','in_progress','completed','failed','cancelled','expired')),
    artifact_id TEXT, error TEXT, retry_at INTEGER NOT NULL, probes INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, terminal_at INTEGER, wake_ack INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (execution_id, call_id)
);
CREATE INDEX IF NOT EXISTS automation_video_due ON automation_video_jobs(state,retry_at);
CREATE TABLE IF NOT EXISTS automation_video_waits (
    execution_id TEXT NOT NULL, branch_id TEXT NOT NULL, call_id TEXT NOT NULL,
    PRIMARY KEY (execution_id, branch_id)
);
