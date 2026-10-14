-- Only hashes are retained here. The OS receiver keeps task-scoped tokens in
-- platform-protected storage, never the paired client's full session cookie.
CREATE TABLE IF NOT EXISTS automation_result_read_grants (
    device_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    receiver_host_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (device_id, request_id, receiver_host_id)
);
CREATE TABLE IF NOT EXISTS automation_result_delivery_targets (
    request_id TEXT PRIMARY KEY,
    source_host_id TEXT NOT NULL,
    binding_hash TEXT,
    configured INTEGER NOT NULL DEFAULT 0 CHECK (configured IN (0,1)),
    retry_at INTEGER NOT NULL DEFAULT 0,
    probes INTEGER NOT NULL DEFAULT 0
);
-- One immediate, original-acceptance setup attempt. Background refresh keeps
-- its own existing backoff; replaying an accepted submission cannot reset it.
CREATE TABLE IF NOT EXISTS automation_result_delivery_admissions (
    request_id TEXT PRIMARY KEY,
    source_host_id TEXT NOT NULL,
    attempted_at INTEGER NOT NULL
);
