-- Original owned Actions file -> immutable parent snapshot. No URLs or keys.
CREATE TABLE IF NOT EXISTS automation_background_cloud_artifacts (
    execution_id TEXT NOT NULL,
    cloud_call_id TEXT NOT NULL,
    source_path TEXT NOT NULL,
    artifact_id TEXT NOT NULL,
    owner TEXT NOT NULL,
    repository TEXT NOT NULL,
    task_id TEXT NOT NULL,
    run_id INTEGER NOT NULL CHECK (run_id > 0),
    cloud_artifact_id INTEGER NOT NULL CHECK (cloud_artifact_id > 0),
    archive_digest TEXT,
    content_hash TEXT NOT NULL,
    bytes INTEGER NOT NULL CHECK (bytes BETWEEN 0 AND 536870912),
    PRIMARY KEY (execution_id,cloud_call_id,source_path)
);
