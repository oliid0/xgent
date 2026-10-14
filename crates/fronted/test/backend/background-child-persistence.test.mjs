import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// Execute the actual embedded production SQL. Native RPC, authorization,
// validation and model resumption are covered by Rust tests that remain UNRUN
// in this non-Cargo suite. These tests prove persistence/selection/atomicity.
const read = name => readFileSync(new URL(`../../src-tauri/src/${name}`, import.meta.url), "utf8");
const children = read("services/automation/store/children.rs"), journal = read("services/automation/store/journal.rs");
const background = read("services/automation/store/background.rs"), store = read("services/automation/store.rs");
const sql = (source, prefix) => {
  const found = [...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(match => match[1].trimStart().replace(/\s+/g, " ").startsWith(prefix.replace(/\s+/g, " ")));
  assert.ok(found, `Production SQL missing: ${prefix}`); return found[1];
};
const migration = sql(read("services/automation/db.rs"), "CREATE TABLE IF NOT EXISTS automation_meta");
const execute = (db, prefix, args = [], method = "run") => db.prepare(sql(children, prefix))[method](...args);
const due = (db, now = 100) => execute(db, "SELECT execution_id,call_id,child_request_id", [now], "all");
const insert = (db, call = "original-call", execution = "parent", issuer = "issuer") => execute(db,
  "INSERT INTO automation_background_children", [execution, call, `request-${execution}-${call}`, "original-peer", issuer, '{"prompt":"Actual document task"}', 90]);
const observe = (db, { call = "original-call", snapshot = '{"actual":"accepted"}', state = "pending", terminal = false, acknowledged = false, revision = 0 } = {}) => execute(db,
  "UPDATE automation_background_children SET receipt_json", ["parent", call, snapshot, "original-execution", revision, state, 0, +terminal, +acknowledged, 200]);
const enqueue = db => execute(db, "UPDATE automation_background_children SET cancel_requested", ["parent", 100]);
function fixture(t) {
  const db = new DatabaseSync(":memory:"); db.exec(migration);
  db.prepare("INSERT INTO automation_meta (key,value) VALUES ('background_worker_id.v1',?)").run("issuer");
  t.after(() => db.close()); return db;
}
function parent(db, id = "parent") {
  db.prepare(sql(background, "INSERT INTO automation_background_tasks")).run(`request-${id}`, id, "{}", 90);
  db.prepare(sql(background, "INSERT INTO automation_cron_runs")).run(id, 90, 300, "{}");
  db.prepare("UPDATE automation_cron_runs SET state = 'leased' WHERE execution_id = ?").run(id);
  db.prepare(sql(journal, "INSERT INTO automation_background_operations")).run(id, "original-call", "BackgroundTask", '{"action":"submit"}', 1, 90);
  db.prepare(sql(journal, "INSERT INTO automation_background_operation_leases")).run(id, "original-call", 1, 2, "actual-lease");
}

test("child display names come from the original immutable input, with legacy and unrelated children kept separate", t => {
  const db=fixture(t);insert(db);insert(db,"other-call","other-parent");
  db.prepare("UPDATE automation_background_children SET input_json=? WHERE execution_id='parent'").run(JSON.stringify({name:"公司资料汇报",prompt:"Private original instructions"}));
  const query=sql(children,"SELECT call_id,child_request_id,peer_id,receipt_json IS NOT NULL");
  const rows=db.prepare(query).all("parent");assert.equal(rows.length,1);assert.equal(rows[0].name,"公司资料汇报");assert.ok(!Object.values(rows[0]).includes("Private original instructions"));
  assert.equal(db.prepare(query).get("other-parent").name,null);
});

test("original child ownership survives reopen before any receipt; neither uniqueness nor retries replace it", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "xgent-child-")), filename = path.join(dir, "tasks.sqlite"); let db;
  try {
    db = new DatabaseSync(filename); db.exec(migration);
    db.prepare("INSERT INTO automation_meta (key,value) VALUES ('background_worker_id.v1',?)").run("issuer");
    insert(db); db.close(); db = new DatabaseSync(filename); db.exec(migration);
    const row = db.prepare("SELECT * FROM automation_background_children").get();
    assert.equal(row.receipt_json, null); assert.equal(row.observed_json, null); assert.equal(row.peer_id, "original-peer");
    assert.equal(row.cancel_requested, 0); assert.equal(due(db).length, 1);
    assert.throws(() => insert(db), /UNIQUE/);
    assert.throws(() => db.prepare(sql(children, "INSERT INTO automation_background_children")).run("other", "other-call", row.child_request_id, "replacement", "issuer", "{}", 91), /UNIQUE/);
    assert.equal(db.prepare("SELECT peer_id FROM automation_background_children").get().peer_id, "original-peer");
  } finally { db?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("native journal admission query requires the original tool, call and lease; input bytes/count include unknown children", t => {
  const db = fixture(t); parent(db); insert(db);
  const query = db.prepare(sql(children, "SELECT EXISTS(SELECT 1 FROM automation_background_operation_leases"));
  assert.equal(Object.values(query.get("parent", "original-call", 1, 2, "actual-lease"))[0], 1);
  for (const args of [["parent", "invented", 1, 2, "actual-lease"], ["parent", "original-call", 2, 2, "actual-lease"], ["parent", "original-call", 1, 2, "forged"]]) assert.equal(Object.values(query.get(...args))[0], 0);
  db.prepare("UPDATE automation_background_operations SET tool_name = 'Write'").run();
  assert.equal(Object.values(query.get("parent", "original-call", 1, 2, "actual-lease"))[0], 0);
  for (let i = 1; i < 16; i++) insert(db, `call-${i}`);
  const count = execute(db, "SELECT COUNT(*),COALESCE(SUM(LENGTH", ["parent"], "get");
  assert.equal(Object.values(count)[0], 16); assert.ok(Object.values(count)[1] > 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_children WHERE receipt_json IS NULL").get().n, 16);
  // Runtime capacity enforcement itself is a native method, not executed here.
  assert.match(children, /count >= MAX_CHILDREN \|\| bytes \+ raw\.len\(\) as i64 > MAX_INPUT_BYTES/);
});

test("explicit parent cancellation commits with local revocation, includes unknown children and survives rollback", t => {
  const db = fixture(t); parent(db); parent(db, "other"); insert(db); insert(db, "other-call", "other");
  const revoke = () => db.prepare(sql(store, "UPDATE automation_cron_runs\n                     SET state = 'expired'")).run("parent", 100, 10, "Original user stop");
  db.exec("BEGIN IMMEDIATE"); enqueue(db); revoke(); db.exec("ROLLBACK");
  assert.equal(db.prepare("SELECT cancel_requested FROM automation_background_children WHERE execution_id = 'parent'").get().cancel_requested, 0);
  assert.equal(db.prepare("SELECT state FROM automation_cron_runs WHERE execution_id = 'parent'").get().state, "leased");
  db.exec("BEGIN IMMEDIATE"); enqueue(db); revoke(); db.exec("COMMIT");
  const row = db.prepare("SELECT * FROM automation_background_children WHERE execution_id = 'parent'").get();
  assert.equal(row.cancel_requested, 1); assert.equal(row.cancel_acknowledged, 0); assert.equal(row.terminal_confirmed, 0); assert.equal(row.receipt_json, null);
  assert.equal(db.prepare("SELECT cancel_requested FROM automation_background_children WHERE execution_id = 'other'").get().cancel_requested, 0);
  assert.match(store, /if cancel_cloud \{[\s\S]*?enqueue_background_child_cancellations/);
});

test("bounded discovery is fair, native-owner scoped and commits fences/backoff before polling", t => {
  const db = fixture(t); for (let i = 0; i < 7; i++) insert(db, `call-${i}`); insert(db, "foreign", "copied", "other-installation");
  const first = due(db); assert.equal(first.length, 4); assert.ok(first.every(row => row.execution_id === "parent"));
  db.exec("BEGIN IMMEDIATE"); for (const row of first) execute(db, "UPDATE automation_background_children SET retry_at", [row.execution_id, row.call_id, 200, 1, "claimed"]); db.exec("COMMIT");
  assert.equal(due(db).length, 3); assert.equal(due(db, 200).length, 4);
  const call = first[0].call_id;
  execute(db, "UPDATE automation_background_children SET retry_at", ["parent", call, 300, 2, "replacement"]);
  assert.equal(execute(db, "UPDATE automation_background_children SET last_error", ["parent", call, "stale", "claimed"]).changes, 0);
  assert.equal(execute(db, "UPDATE automation_background_children SET last_error", ["parent", call, "Current network failure", "replacement"]).changes, 1);
  assert.equal(execute(db, "UPDATE automation_background_children SET last_error", ["copied", "foreign", "Cannot use copied authority", null]).changes, 0);
});

test("first actual admission is immutable while latest terminal and cancellation evidence can settle independently", t => {
  const db = fixture(t); insert(db); enqueue(db); observe(db);
  const accepted = db.prepare("SELECT receipt_json FROM automation_background_children").get().receipt_json;
  observe(db, { snapshot: '{"actual":"done"}', state: "done", terminal: true });
  let row = db.prepare("SELECT * FROM automation_background_children").get();
  assert.equal(row.receipt_json, accepted); assert.equal(row.observed_json, '{"actual":"done"}'); assert.equal(row.cancel_acknowledged, 0);
  assert.equal(due(db, 999).length, 1);
  observe(db, { snapshot: '{"actual":"stop-receipt"}', state: "done", terminal: true, acknowledged: true });
  assert.equal(due(db, 999).length, 0); row = db.prepare("SELECT * FROM automation_background_children").get();
  assert.equal(row.cancel_acknowledged, 1); assert.equal(row.receipt_json, accepted);
});

test("native receipt discovery settles original unknown intent without rewriting the journal or inventing success", t => {
  const db = fixture(t); parent(db); insert(db);
  const unresolved = db.prepare(sql(journal, "SELECT EXISTS(SELECT 1 FROM automation_background_operations o WHERE"));
  assert.equal(Object.values(unresolved.get("parent"))[0], 1); observe(db);
  assert.equal(Object.values(unresolved.get("parent"))[0], 0);
  const row = db.prepare("SELECT state,result_json FROM automation_background_operations").get();
  assert.equal(row.state, "started"); assert.equal(row.result_json, null);
  const summary = execute(db, "SELECT call_id,child_request_id,peer_id,receipt_json", ["parent"], "all")[0];
  assert.equal(summary.observed_success, 0); assert.equal(summary.terminal_confirmed, 0);
});

test("terminal child join selection retains the parked parent and consumes each actual wake once", t => {
  const db = fixture(t); parent(db); insert(db); observe(db);
  db.prepare("UPDATE automation_cron_runs SET state = 'waiting' WHERE execution_id = 'parent'").run();
  db.prepare("INSERT INTO automation_background_outcomes (execution_id,branch_id,state,updated_at) VALUES ('parent','report','waiting',90)").run();
  execute(db, "INSERT INTO automation_background_child_waits", ["parent", "report", "original-call", 0]);
  const ready = () => execute(db, "SELECT DISTINCT c.execution_id FROM automation_background_children", [100], "all");
  assert.equal(ready().length, 0); observe(db, { state: "done", terminal: true }); assert.equal(ready().length, 1);
  execute(db, "UPDATE automation_background_child_waits SET retry_at", ["parent", 200]); assert.equal(ready().length, 0);
  assert.equal(execute(db, "SELECT DISTINCT c.execution_id FROM automation_background_children", [200], "all").length, 1);
  execute(db, "UPDATE automation_background_child_waits SET wake_consumed", ["parent"]); assert.equal(ready().length, 0);
  execute(db, "INSERT INTO automation_background_child_waits", ["parent", "report", "original-call", 1]); assert.equal(ready().length, 0);
  db.prepare(sql(read("services/automation/store/outcomes.rs"), "DELETE FROM automation_background_child_waits")).run("parent", "report");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_child_waits").get().n, 0);
  assert.equal(db.prepare("SELECT state,evidence_json FROM automation_background_outcomes").get().state, "waiting");
  assert.equal(db.prepare("SELECT evidence_json FROM automation_background_outcomes").get().evidence_json, null);
});

const waitingSnapshot = id => JSON.stringify({ waiting: { waitId: id } });
const childWaitId = "11111111-1111-4111-8111-111111111111";
const nextChildWaitId = "22222222-2222-4222-8222-222222222222";
function parkParent(db) {
  db.prepare("UPDATE automation_cron_runs SET state = 'waiting' WHERE execution_id = 'parent'").run();
  db.prepare("INSERT OR IGNORE INTO automation_background_outcomes (execution_id,branch_id,state,updated_at) VALUES ('parent','report','waiting',90)").run();
  execute(db, "INSERT INTO automation_background_child_waits", ["parent", "report", "original-call", 0]);
}
const readyChildren = (db, now = 100) => execute(db, "SELECT DISTINCT c.execution_id FROM automation_background_children", [now], "all");
const consumeChildWaitEvents = db => execute(db, "INSERT OR IGNORE INTO automation_background_child_wait_events", ["parent", 100]);

test("actual child parking wakes supervision once independently of terminal join, without verifying outcomes", t => {
  const db = fixture(t); parent(db); insert(db); parkParent(db);
  observe(db, { state: "waiting", snapshot: waitingSnapshot(childWaitId) });
  assert.equal(readyChildren(db).length, 1);
  assert.equal(consumeChildWaitEvents(db).changes, 1);
  assert.equal(readyChildren(db).length, 0);
  assert.equal(consumeChildWaitEvents(db).changes, 0);
  // More checkpoint/output progress in this SAME child occurrence is no event.
  observe(db, { state: "waiting", revision: 10, snapshot: JSON.stringify({ waiting: { waitId: childWaitId }, output: "Still awaiting input" }) });
  assert.equal(readyChildren(db).length, 0);
  // Re-recording a dependency must not erase supervision's consumption.
  execute(db, "INSERT INTO automation_background_child_waits", ["parent", "report", "original-call", 0]);
  assert.equal(readyChildren(db).length, 0);
  observe(db, { state: "waiting", revision: 11, snapshot: waitingSnapshot(nextChildWaitId) });
  assert.equal(readyChildren(db).length, 1); consumeChildWaitEvents(db);
  observe(db, { state: "done", terminal: true, revision: 12 });
  assert.equal(readyChildren(db).length, 1);
  execute(db, "UPDATE automation_background_child_waits SET wake_consumed", ["parent"]);
  assert.equal(readyChildren(db).length, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_child_wait_events").get().n, 2);
  const outcome = db.prepare("SELECT state,evidence_json FROM automation_background_outcomes").get();
  assert.equal(outcome.state, "waiting"); assert.equal(outcome.evidence_json, null);
  assert.equal(db.prepare("SELECT success FROM automation_cron_runs").get().success, 0);
});

test("network/output changes, missing occurrences and cancelled/foreign children do not wake supervision", t => {
  const db = fixture(t); parent(db); insert(db); parkParent(db);
  for (const state of ["pending", "leased", "done", "expired"])
    for (const snapshot of [waitingSnapshot(childWaitId), "{}"] ) {
      observe(db, { state, snapshot }); assert.equal(readyChildren(db).length, 0);
    }
  for (const snapshot of ["{}", '{"waiting":null}', waitingSnapshot(""), waitingSnapshot(36), waitingSnapshot("short")]) {
    observe(db, { state: "waiting", snapshot }); assert.equal(readyChildren(db).length, 0);
    assert.equal(consumeChildWaitEvents(db).changes, 0);
  }
  observe(db, { state: "waiting", snapshot: waitingSnapshot(childWaitId) });
  execute(db, "UPDATE automation_background_children SET last_error", ["parent", "original-call", "Network offline", null]);
  assert.equal(readyChildren(db).length, 1); consumeChildWaitEvents(db);
  execute(db, "UPDATE automation_background_children SET last_error", ["parent", "original-call", "Network offline again", null]);
  assert.equal(readyChildren(db).length, 0);
  observe(db, { state: "waiting", snapshot: waitingSnapshot(nextChildWaitId) });
  enqueue(db); assert.equal(readyChildren(db).length, 0); assert.equal(consumeChildWaitEvents(db).changes, 0);
  db.prepare("UPDATE automation_background_children SET cancel_requested = 0,issuer_host_id = 'foreign'").run();
  assert.equal(readyChildren(db).length, 0); assert.equal(consumeChildWaitEvents(db).changes, 0);
});

test("supervision requires the current parked parent, unfinished dependency and persistent native backoff", t => {
  const db = fixture(t); parent(db); insert(db); parkParent(db);
  observe(db, { state: "waiting", snapshot: waitingSnapshot(childWaitId) });
  for (const state of ["leased", "pending", "done", "expired"]) {
    db.prepare("UPDATE automation_cron_runs SET state = ? WHERE execution_id = 'parent'").run(state);
    assert.equal(readyChildren(db).length, 0);
  }
  db.prepare("UPDATE automation_cron_runs SET state = 'waiting'").run();
  db.prepare("UPDATE automation_background_outcomes SET state = 'verified'").run();
  assert.equal(readyChildren(db).length, 0); assert.equal(consumeChildWaitEvents(db).changes, 0);
  db.prepare("UPDATE automation_background_outcomes SET state = 'waiting'").run();
  execute(db, "UPDATE automation_background_child_waits SET retry_at", ["parent", 200]);
  assert.equal(readyChildren(db).length, 0); assert.equal(readyChildren(db, 200).length, 1);
});

test("context resumption and child-event consumption roll back and commit together using production statements", t => {
  const db = fixture(t); parent(db); insert(db); parkParent(db);
  observe(db, { state: "waiting", snapshot: waitingSnapshot(childWaitId) });
  const waiting = read("services/automation/store/waiting.rs");
  db.prepare(sql(journal, "INSERT INTO automation_background_checkpoints")).run("parent", 1, '{"messages":[]}', 90);
  const resume = () => {
    db.prepare(sql(waiting, "UPDATE automation_background_checkpoints SET revision")).run("parent", 2, '{"messages":[{"role":"user","content":"Read actual child blocker"}]}', 100);
    db.prepare(sql(waiting, "UPDATE automation_cron_runs SET state = 'pending', lease_expires_at = NULL WHERE execution_id = ?1 AND state = 'waiting'")).run("parent");
    consumeChildWaitEvents(db);
  };
  db.exec("BEGIN IMMEDIATE"); resume(); db.exec("ROLLBACK");
  assert.equal(readyChildren(db).length, 1);
  assert.equal(db.prepare("SELECT revision FROM automation_background_checkpoints").get().revision, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_child_wait_events").get().n, 0);
  db.exec("BEGIN IMMEDIATE"); resume(); db.exec("COMMIT");
  assert.equal(db.prepare("SELECT state FROM automation_cron_runs").get().state, "pending");
  assert.equal(db.prepare("SELECT revision FROM automation_background_checkpoints").get().revision, 2);
  // Re-parking cannot replay the same event, but does not suppress completion.
  parkParent(db); assert.equal(readyChildren(db).length, 0);
  observe(db, { state: "done", terminal: true }); assert.equal(readyChildren(db).length, 1);
  const method = children.split("pub fn resume_ready_background_children")[1].split("#[cfg(test)]")[0];
  assert.ok(method.indexOf("verify_background_binding") < method.indexOf("resume_wait_on_connection"));
  assert.ok(method.indexOf("has_uncertain_operations") < method.indexOf("resume_wait_on_connection"));
  assert.ok(method.indexOf("resume_wait_on_connection") < method.indexOf("INSERT OR IGNORE INTO automation_background_child_wait_events"));
  assert.ok(method.indexOf("INSERT OR IGNORE INTO automation_background_child_wait_events") < method.indexOf("tx.commit()"));
  assert.ok(method.indexOf("tx.commit()") < method.indexOf("notifier.prompt_pending()"));
  assert.match(children, /next_state == "waiting"[\s\S]*?Uuid::parse_str\(id\)[\s\S]*?actual native parking occurrence/);
});

test("additive event migration and consumed child occurrences survive SQLite reopen", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "xgent-child-supervision-")), filename = path.join(dir, "tasks.sqlite"); let db;
  try {
    db = new DatabaseSync(filename);
    const eventTable = /CREATE TABLE IF NOT EXISTS automation_background_child_wait_events \([\s\S]*?\);/;
    assert.match(migration, eventTable); db.exec(migration.replace(eventTable, ""));
    db.prepare("INSERT INTO automation_meta (key,value) VALUES ('background_worker_id.v1','issuer')").run();
    parent(db); insert(db); parkParent(db); db.close();
    db = new DatabaseSync(filename); db.exec(migration);
    assert.equal(db.prepare("SELECT peer_id FROM automation_background_children").get().peer_id, "original-peer");
    observe(db, { state: "waiting", snapshot: waitingSnapshot(childWaitId) });
    assert.equal(readyChildren(db).length, 1); consumeChildWaitEvents(db); db.close();
    db = new DatabaseSync(filename); db.exec(migration);
    assert.equal(readyChildren(db).length, 0);
    assert.equal(db.prepare("SELECT wait_id FROM automation_background_child_wait_events").get().wait_id, childWaitId);
    assert.equal(db.prepare("SELECT wake_consumed FROM automation_background_child_waits").get().wake_consumed, 0);
    observe(db, { state: "done", terminal: true }); assert.equal(readyChildren(db).length, 1);
  } finally { db?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("native discovery has no submit/replay branch and mobile result watches remain active until child stops settle", () => {
  const service = read("services/child_tasks.rs"), inbox = read("services/automation/store/inbox.rs");
  assert.match(service, /"automation_background_get"/); assert.match(service, /"automation_background_cancel"/);
  assert.doesNotMatch(service, /"automation_background_submit"|begin_background_operation/);
  assert.match(service, /resume_ready_background_children/);
  assert.match(inbox, /let active = [^;]*\|\| child_pending/);
  assert.match(inbox, /validated_child_summaries\(payload\.get\("children"\)\)/);
  const notify = inbox.split('notification["children"] =')[1].split("let digest")[0];
  assert.doesNotMatch(notify, /last_error/);
  assert.match(children, /offset>0 && expected_hash\.is_none/);
});
