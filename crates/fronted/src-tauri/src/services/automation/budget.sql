-- Lifetime of one accepted execution, not one lease or WebView session.
CREATE TABLE IF NOT EXISTS automation_background_budgets (
    execution_id TEXT PRIMARY KEY,
    max_model_requests INTEGER NOT NULL CHECK (max_model_requests BETWEEN 1 AND 9007199254740991),
    max_tool_calls INTEGER NOT NULL CHECK (max_tool_calls BETWEEN 1 AND 9007199254740991),
    model_requests INTEGER NOT NULL DEFAULT 0 CHECK (model_requests BETWEEN 0 AND max_model_requests),
    tool_calls INTEGER NOT NULL DEFAULT 0 CHECK (tool_calls BETWEEN 0 AND max_tool_calls),
    exhausted INTEGER NOT NULL DEFAULT 0 CHECK (exhausted IN (0, 1))
);

-- Separate additive schema: legacy ledgers keep no deadline. Never backfill
-- a deadline from today's setting or from a replacement lease.
CREATE TABLE IF NOT EXISTS automation_background_budget_deadlines (
    execution_id TEXT PRIMARY KEY,
    deadline_at INTEGER NOT NULL CHECK (deadline_at BETWEEN 1 AND 8640000000000000)
);

-- Conservatively allocated before a child send, retained after lost ACK/stop.
-- These slots cannot also be admitted to this host's SDK/tools.
CREATE TABLE IF NOT EXISTS automation_background_budget_grants (
    execution_id TEXT NOT NULL,
    call_id TEXT NOT NULL,
    child_request_id TEXT NOT NULL,
    peer_id TEXT NOT NULL,
    max_model_requests INTEGER NOT NULL CHECK (max_model_requests BETWEEN 1 AND 128),
    max_tool_calls INTEGER NOT NULL CHECK (max_tool_calls BETWEEN 1 AND 256),
    PRIMARY KEY (execution_id, call_id),
    UNIQUE (execution_id, child_request_id)
);

-- Original allocations stay immutable. Unknown/legacy children keep all slots.
CREATE TABLE IF NOT EXISTS automation_background_budget_settlements (
    execution_id TEXT NOT NULL,
    call_id TEXT NOT NULL,
    child_request_id TEXT NOT NULL,
    peer_id TEXT NOT NULL,
    child_execution_id TEXT NOT NULL,
    model_requests INTEGER NOT NULL CHECK (model_requests BETWEEN 0 AND 128),
    tool_calls INTEGER NOT NULL CHECK (tool_calls BETWEEN 0 AND 256),
    settled_at INTEGER NOT NULL,
    PRIMARY KEY (execution_id,call_id)
);
CREATE VIEW IF NOT EXISTS automation_background_budget_committed_grants AS
SELECT g.execution_id,g.call_id,g.child_request_id,g.peer_id,
       COALESCE(s.model_requests,g.max_model_requests) AS model_requests,
       COALESCE(s.tool_calls,g.max_tool_calls) AS tool_calls
FROM automation_background_budget_grants g
LEFT JOIN automation_background_budget_settlements s ON s.execution_id=g.execution_id AND s.call_id=g.call_id
    AND s.child_request_id=g.child_request_id AND s.peer_id=g.peer_id;

-- A confirmed admission refusal caused by live original child reservations.
-- It is not spent usage, a fresh budget, or authority to start another task.
CREATE TABLE IF NOT EXISTS automation_background_budget_deferrals (
    execution_id TEXT PRIMARY KEY,
    deferral_id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK(kind IN ('modelRequests','toolCalls')),
    issuer_host_id TEXT NOT NULL
);
