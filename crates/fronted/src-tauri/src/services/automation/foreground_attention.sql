-- Expiring, original-installation foreground observations. Closed scopes are
-- retained beyond their message lifetime to fence reordered heartbeats.
CREATE TABLE IF NOT EXISTS automation_foreground_attention (
    session_id TEXT PRIMARY KEY,
    host_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    closed INTEGER NOT NULL CHECK(closed IN (0,1)),
    issued_at INTEGER NOT NULL,
    observed_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_foreground_attention_expiry
    ON automation_foreground_attention(expires_at);
