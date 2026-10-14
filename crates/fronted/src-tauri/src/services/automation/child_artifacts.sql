-- Source identity is independent of network addresses and model narration.
-- Insert this provenance and the parent bytes/operation receipt in one transaction.
CREATE TABLE IF NOT EXISTS automation_background_child_artifacts (
    execution_id TEXT NOT NULL,
    child_call_id TEXT NOT NULL,
    child_artifact_id TEXT NOT NULL,
    artifact_id TEXT NOT NULL,
    peer_id TEXT NOT NULL,
    child_request_id TEXT NOT NULL,
    child_execution_id TEXT NOT NULL,
    source_path TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    bytes INTEGER NOT NULL CHECK (bytes BETWEEN 0 AND 8388608),
    PRIMARY KEY (execution_id, child_call_id, child_artifact_id)
);
