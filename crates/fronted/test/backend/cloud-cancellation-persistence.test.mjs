import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// Actual embedded production SQL. Rust orchestration and GitHub HTTP are not
// executed by these non-Cargo tests; their native assertions are separate.
const read = name => readFileSync(new URL(`../../src-tauri/src/${name}`, import.meta.url), "utf8");
const cancellation = read("services/automation/store/cloud_cancellation.rs");
const background = read("services/automation/store/background.rs");
const journal = read("services/automation/store/journal.rs");
const launch = read("services/automation/store/cloud_launch.rs");
const schema = read("services/automation/db.rs");
const store = read("services/automation/store.rs");
const sql = (source, prefix) => {
  const found = [...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(match => match[1].trimStart().replace(/\s+/g, " ").startsWith(prefix.replace(/\s+/g, " ")));
  assert.ok(found, `Actual SQL missing: ${prefix}`);
  return found[1];
};
const migration = sql(schema, "CREATE TABLE IF NOT EXISTS automation_meta");
const execute = (db, prefix, args, method = "run") => db.prepare(sql(cancellation, prefix))[method](...args);
const due = (db, now = 100) => execute(db, "SELECT c.execution_id,c.call_id,c.probes", [now], "all");
const enqueue = (db, id = "original") => execute(db, "INSERT OR IGNORE INTO automation_background_cloud_cancellations", [id, 100]);
const claim = (db, id = "original", token = "first-probe", retry = 200) => execute(db, "UPDATE automation_background_cloud_cancellations SET retry_at", [id, "cloud-call", retry, 1, token]);
const observe = (db, { id = "original", token = "first-probe", run = 42, state = "in_progress", conclusion = null, accepted = true, terminal = false } = {}) =>
  execute(db, "UPDATE automation_background_cloud_cancellations SET run_id", [id, "cloud-call", token, run, state, conclusion, +accepted, 150, +terminal]);
const summary = (db, id = "original") => execute(db, "SELECT COALESCE(SUM(terminal_at IS NULL)", [id], "get");
function fixture(db, id = "original") {
  const args = '{"action":"start","runner":"ubuntu-latest","script":"actual work"}';
  db.prepare(sql(background, "INSERT INTO automation_background_tasks")).run(`request-${id}`, id, "{}", 90);
  db.prepare(sql(background, "INSERT INTO automation_cron_runs")).run(id, 90, 200, "{}");
  db.prepare("UPDATE automation_cron_runs SET state = 'leased' WHERE execution_id = ?").run(id);
  db.prepare(sql(background, "INSERT INTO automation_background_configuration_bindings")).run(id, "original-binding");
  db.prepare(sql(journal, "INSERT INTO automation_background_operations")).run(id, "cloud-call", "CloudTaskManager", args, 1, 90);
  db.prepare(sql(journal, "INSERT INTO automation_background_operation_leases")).run(id, "cloud-call", 1, 1, "writer-token");
  db.prepare(sql(launch, "INSERT INTO automation_background_cloud_launches")).run(id, "cloud-call", `task-${id}`, createHash("sha256").update(args).digest("hex"), "owner", "agent-temp", "ubuntu-latest", 90);
}
function cancel(db, id = "original") {
  db.exec("BEGIN IMMEDIATE");
  enqueue(db, id);
  db.prepare(sql(store, "UPDATE automation_cron_runs\n                     SET state = 'expired'")).run(id, 100, 10, "Local stop; remote confirmation pending");
  db.exec("COMMIT");
}
function inMemory(t) {
  const db = new DatabaseSync(":memory:"); db.exec(migration); t.after(() => db.close()); return db;
}

test("actual cancellation and local revocation commit atomically, retaining unknown START and immutable receipts", t => {
  const db = inMemory(t); fixture(db); fixture(db, "other");
  const failed = JSON.stringify({ role: "toolResult", toolCallId: "cloud-call", toolName: "CloudTaskManager", isError: true, details: { outcomeUncertain: true } });
  db.prepare(sql(journal, "UPDATE automation_background_operations SET state = 'returned', result_json = ?3, is_error = ?4")).run("original", "cloud-call", failed, 1, 95);
  db.exec("BEGIN IMMEDIATE"); enqueue(db);
  db.prepare(sql(store, "UPDATE automation_cron_runs\n                     SET state = 'expired'")).run("original", 100, 10, "Local stop");
  db.exec("ROLLBACK");
  assert.equal(db.prepare("SELECT state FROM automation_cron_runs WHERE execution_id = 'original'").get().state, "leased");
  assert.equal(due(db).length, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_cloud_cancellations").get().n, 0);
  cancel(db);
  assert.deepEqual(due(db).map(row => row.execution_id), ["original"]);
  assert.equal(db.prepare("SELECT result_json FROM automation_background_operations WHERE execution_id = 'original'").get().result_json, failed);
  assert.equal(db.prepare("SELECT result_json FROM automation_background_cloud_launches WHERE execution_id = 'original'").get().result_json, null);
  assert.equal(db.prepare("SELECT state FROM automation_cron_runs WHERE execution_id = 'other'").get().state, "leased");
});

test("cancel before dispatch acknowledgement, POST acceptance and retries survive reopen without pretending remote completion", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "xgent-cancel-")); const filename = path.join(directory, "store.sqlite"); let db;
  try {
    db = new DatabaseSync(filename); db.exec(migration); fixture(db); cancel(db); claim(db);
    assert.equal(observe(db).changes, 1);
    let row = db.prepare("SELECT * FROM automation_background_cloud_cancellations").get();
    assert.equal(row.accepted_at, 150); assert.equal(row.terminal_at, null); assert.equal(row.run_id, 42);
    execute(db, "UPDATE automation_background_cloud_cancellations SET last_error", ["original", "cloud-call", "first-probe", "GET failed; retain request"]);
    db.close(); db = new DatabaseSync(filename); db.exec(migration); enqueue(db);
    row = db.prepare("SELECT * FROM automation_background_cloud_cancellations").get();
    assert.equal(row.retry_at, 200); assert.equal(row.accepted_at, 150); assert.equal(row.last_error, "GET failed; retain request");
    assert.equal(due(db, 199).length, 0); assert.equal(due(db, 200).length, 1);
    claim(db, "original", "next-probe", 400);
    assert.equal(observe(db, { token: "first-probe", state: "completed", terminal: true }).changes, 0);
    assert.equal(observe(db, { token: "next-probe", state: "completed", conclusion: "success", accepted: false, terminal: true }).changes, 1);
    assert.equal(due(db, 999).length, 0);
    assert.equal(db.prepare("SELECT state,success FROM automation_cron_runs WHERE execution_id = 'original'").get().state, "expired");
    assert.equal(db.prepare("SELECT success FROM automation_cron_runs WHERE execution_id = 'original'").get().success, 0);
    enqueue(db); assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_cloud_cancellations").get().n, 1);
  } finally { db?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("actual due selection is four at a time, fair across tasks, with persisted probe fences and no live-task cancellation", t => {
  const db = inMemory(t);
  for (let index = 0; index < 7; index++) { fixture(db, `job-${index}`); cancel(db, `job-${index}`); }
  fixture(db, "live"); enqueue(db, "live");
  const first = due(db); assert.equal(first.length, 4);
  db.exec("BEGIN IMMEDIATE"); for (const row of first) claim(db, row.execution_id, "claimed", 200); db.exec("COMMIT");
  assert.equal(due(db).length, 3); assert.equal(due(db, 200).length, 4);
  assert.ok(!due(db, 200).some(row => row.execution_id === "live"));
  claim(db, "job-0", "replacement", 300);
  assert.equal(execute(db, "UPDATE automation_background_cloud_cancellations SET last_error", ["job-0", "cloud-call", "claimed", "stale error"]).changes, 0);
  assert.equal(observe(db, { id: "job-0", token: "claimed" }).changes, 0);
});

test("positive GET identity survives a lost cancel POST before acceptance; a later probe cannot replace the original run", t => {
  const db = inMemory(t); fixture(db); cancel(db); claim(db);
  assert.equal(observe(db, { accepted: false }).changes, 1);
  execute(db, "UPDATE automation_background_cloud_cancellations SET last_error", ["original", "cloud-call", "first-probe", "POST response lost"]);
  const original = db.prepare("SELECT run_id,accepted_at,terminal_at FROM automation_background_cloud_cancellations").get();
  assert.deepEqual({ ...original }, { run_id: 42, accepted_at: null, terminal_at: null });
  claim(db, "original", "new-probe", 400);
  assert.equal(observe(db, { token: "new-probe", run: 99 }).changes, 0);
  assert.equal(observe(db, { token: "new-probe" }).changes, 1);
  assert.equal(db.prepare("SELECT terminal_at FROM automation_background_cloud_cancellations").get().terminal_at, null);
});

test("preparation requires the original cancellation/task/call/probe and actual journal reservation", t => {
  const db = inMemory(t); fixture(db); cancel(db); claim(db);
  const prepare = db.prepare(sql(cancellation, "SELECT c.task_id,c.owner,c.repository,c.arguments_hash,o.arguments_json,x.run_id"));
  const original = prepare.get("original", "cloud-call", "first-probe");
  assert.equal(original.task_id, "task-original"); assert.equal(original.arguments_hash, createHash("sha256").update(original.arguments_json).digest("hex"));
  for (const args of [["other", "cloud-call", "first-probe"], ["original", "other", "first-probe"], ["original", "cloud-call", "stale"]]) assert.equal(prepare.get(...args), undefined);
  for (const mutation of ["UPDATE automation_cron_runs SET state = 'pending'", "UPDATE automation_background_operations SET tool_name = 'Shell'", "DELETE FROM automation_background_operation_leases"]) {
    db.exec("BEGIN IMMEDIATE"); db.exec(mutation); assert.equal(prepare.get("original", "cloud-call", "first-probe"), undefined); db.exec("ROLLBACK");
  }
});

test("only the pinned original run/occurrence settles; terminal acknowledgement is immutable and cannot resume the task", t => {
  const db = inMemory(t); fixture(db); cancel(db); claim(db); observe(db);
  assert.equal(observe(db, { run: 99, terminal: true, state: "completed" }).changes, 0);
  assert.equal(observe(db, { state: "completed", conclusion: "cancelled", terminal: true, accepted: false }).changes, 1);
  assert.equal(observe(db, { state: "completed", conclusion: "success", terminal: true }).changes, 0);
  const row = db.prepare("SELECT * FROM automation_background_cloud_cancellations").get();
  assert.equal(row.conclusion, "cancelled"); assert.equal(row.terminal_at, 150); assert.equal(row.accepted_at, 150);
  assert.equal(Object.values(summary(db)).join(","), "0,1");
  assert.equal(execute(db, "UPDATE automation_background_cloud_cancellations SET last_error", ["original", "cloud-call", "first-probe", "late failure"]).changes, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_resumptions").get().n, 0);
});

test("native source restricts cancellation to worker-selected original identity and confirms 202 separately from GET completion", () => {
  const native = read("commands/automation/cloud_recovery.rs");
  const service = read("services/cloud_execution.rs");
  const entry = native.split("pub async fn automation_background_cloud_reconcile_cancellations(")[1];
  assert.match(entry, /window.label\(\) != "agent-worker"/); assert.match(entry, /due_background_cloud_cancellations/);
  assert.doesNotMatch(entry.split("Result<u32,String>")[0], /run_id|request_id|execution_id|locator|token/);
  const remote = service.split("pub\(crate\) async fn request_task_cancellation(")[1].split("pub async fn wait_for_task(")[0];
  assert.match(remote, /run\.display_title != format!/); assert.match(remote, /status\.state == "completed"/);
  assert.match(remote, /authorize\(&status\)\?/); assert.match(remote, /StatusCode::ACCEPTED/); assert.match(remote, /Ok\(Some\(\(status,true\)\)\)/);
  assert.match(native, /\|status\|[\s\S]*record_background_cloud_cancellation\(id,call,probe,status,false,load\)/);
  assert.doesNotMatch(remote, /force-cancel|workflow_dispatch|start_task/);
  assert.match(cancellation, /Self::verify_background_binding\(conn,id,load\)/);
  assert.match(cancellation, /Sha256::digest\(raw.as_bytes\(\)\)/);
  assert.match(cancellation, /known_run.is_some_and/);
  assert.match(cancellation, /let terminal = status.state == "completed"/);
  assert.match(store, /if cancel_cloud\s*\{\s*Self::enqueue_background_cloud_cancellations/);
  assert.match(background, /expire_prompt_runs_where_with_cloud_cancel/);
  assert.match(read("lib.rs"), /automation_background_cloud_reconcile_cancellations/);
  const inbox = read("services/automation/store/inbox.rs");
  assert.match(inbox, /if cloud_cancellation.pending > 0 \|\| cloud_cancellation.observed_terminal > 0\s*\{\s*notification\["cloudCancellation"\]/);
  assert.match(inbox, /in_flight > 0 \|\| cloud_cancellation.pending > 0/);
});
