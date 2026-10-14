-- Large snapshots are bounded pieces, committed with their manifest/receipt.
-- Small historical snapshots keep the original content column and wire API.
CREATE TABLE IF NOT EXISTS automation_artifact_parts (
    artifact_id TEXT NOT NULL,
    part_index INTEGER NOT NULL CHECK (part_index BETWEEN 0 AND 1023),
    content BLOB NOT NULL CHECK (length(content) BETWEEN 1 AND 524288),
    content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
    PRIMARY KEY (artifact_id, part_index)
);
CREATE TABLE IF NOT EXISTS automation_large_child_artifacts (
    execution_id TEXT NOT NULL, child_call_id TEXT NOT NULL, child_artifact_id TEXT NOT NULL,
    artifact_id TEXT NOT NULL, peer_id TEXT NOT NULL, child_request_id TEXT NOT NULL,
    child_execution_id TEXT NOT NULL, source_path TEXT NOT NULL, content_hash TEXT NOT NULL,
    bytes INTEGER NOT NULL CHECK (bytes BETWEEN 8388609 AND 536870912),
    PRIMARY KEY (execution_id, child_call_id, child_artifact_id)
);
