import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// Production SQL selection/persistence/transactions, not execution of Rust,
// configuration checks, RPC, model calls, native APIs or actual deliverables.
const read = name => readFileSync(new URL(`../../src-tauri/src/services/automation/${name}`, import.meta.url), "utf8");
const joins = read("store/task_joins.rs"), waiting = read("store/waiting.rs"), children = read("store/children.rs"), cloud = read("store/cloud_waiting.rs"), videos = read("store/videos.rs");
const sql = (source, prefix, contains = "") => {
  const match = [...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(item => item[1].trimStart().startsWith(prefix) && item[1].includes(contains));
  assert.ok(match, `Missing production SQL: ${prefix} ${contains}`); return match[1];
};
const run = (db, query, values = [], mode = "run") => db.prepare(query)[mode](Object.fromEntries(values.map((value, i) => [String(i + 1), value])));
const stageStatements = [
  sql(joins, "INSERT INTO automation_background_task_joins", "FROM automation_background_children"),
  sql(joins, "INSERT INTO automation_background_task_joins", "FROM automation_background_cloud_launches"),
  sql(joins, "INSERT INTO automation_background_task_joins", "FROM automation_video_jobs"),
];
const stage = (db, id = "parent", wait = "park-1") => stageStatements.forEach(query => run(db, query, [id, wait]));
const childReady = (db, now = 100) => run(db, sql(children, "SELECT DISTINCT c.execution_id FROM automation_background_children"), [now], "all");
const videoReady = (db, now = 100) => run(db, sql(videos, "SELECT DISTINCT j.execution_id"), [now], "all");
const cloudCalls = db => run(db, sql(cloud, "WITH calls AS"), ["parent"], "all").slice(0, 4).map(row => row.call_id);
const terminal = (db, wait = "park-1") => Object.values(run(db, sql(joins, "SELECT EXISTS(SELECT 1 FROM automation_background_task_joins j"), ["parent", wait], "get"))[0];
function open(file = ":memory:") {
  const db = new DatabaseSync(file); db.exec(sql(read("db.rs"), "CREATE TABLE IF NOT EXISTS automation_meta")); db.exec(read("videos.sql"));
  db.exec("INSERT OR IGNORE INTO automation_meta VALUES ('background_worker_id.v1','original-host')"); return db;
}
function parent(db, id = "parent") {
  run(db, sql(read("store/background.rs"), "INSERT INTO automation_background_tasks"), [`request-${id}`, id, '{"original":true}', 1]);
  run(db, sql(read("store/background.rs"), "INSERT INTO automation_cron_runs"), [id, 1, 5000, '{"original":true}']);
  db.prepare("INSERT INTO automation_background_outcomes(execution_id,branch_id,state,evidence_json,updated_at) VALUES(?,'file','verified','{\"artifactIds\":[\"retained-file\"]}',1)").run(id);
}
function child(db, call = "code", id = "parent", issuer = "original-host") {
  db.prepare("INSERT INTO automation_background_children(execution_id,call_id,child_request_id,peer_id,issuer_host_id,input_json,issued_at,retry_at,receipt_json,observed_json,observed_state) VALUES(?,?,?,?,?,'{}',1,0,'{}','{}','running')").run(id, call, `request-${id}-${call}`, "original-peer", issuer);
}
function video(db, call = "video") {
  db.prepare("INSERT INTO automation_video_jobs(execution_id,call_id,input_json,issuer_host_id,nonce,job_id,state,retry_at,created_at) VALUES('parent',?,'{}','original-host','original-nonce','original-job','in_progress',0,1)").run(call);
}
function launch(db, call = "actions", receipt = "{}") {
  db.prepare("INSERT INTO automation_background_cloud_launches(execution_id,call_id,task_id,arguments_hash,owner,repository,runner,issued_at,result_json) VALUES('parent',?,?, 'original-hash','owner','repo','ubuntu-latest',1,?)").run(call, `task-${call}`, receipt);
}
function observeCloud(db, call = "actions", conclusion = "success", owner = "owner") {
  run(db, sql(cloud, "INSERT INTO automation_background_cloud_completions"), ["parent", call, owner, "repo", `task-${call}`, 17, conclusion, JSON.stringify({ taskId: `task-${call}`, state: "completed", runId: 17, conclusion }), 90]);
}
function park(db, wait = "park-1", id = "parent") {
  stage(db, id, wait);
  run(db, sql(waiting, "INSERT INTO automation_background_waits"), [wait, id, "{}", "[]", 1, 0, "[]", 0]);
  db.prepare("UPDATE automation_cron_runs SET state='waiting' WHERE execution_id=?").run(id);
}
function consume(db, wait = "park-1") {
  stage(db, "parent", wait);
  run(db, sql(joins, "UPDATE automation_background_task_joins AS j"), ["parent", wait]);
  run(db, sql(joins, "INSERT OR IGNORE INTO automation_background_child_wait_events"), ["parent", wait, 100]);
  run(db, sql(joins, "UPDATE automation_background_child_waits"), ["parent", wait]);
  run(db, sql(joins, "UPDATE automation_video_jobs"), ["parent", wait]);
}
function resume(db, wait = "park-1") {
  db.exec("BEGIN IMMEDIATE"); try {
    consume(db, wait);
    run(db, sql(waiting, "INSERT INTO automation_background_resumptions"), [`resume-${wait}`, "parent", wait, '{"original":true}', 100]);
    run(db, sql(waiting, "UPDATE automation_cron_runs SET state = 'pending'"), ["parent"]);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

test("artifact-only plans cannot ignore owned unfinished children or unsettled cancellation", t => {
  const db = open(); t.after(() => db.close()); parent(db); child(db); child(db, "foreign", "parent", "other-host");
  const pending = () => run(db, sql(joins, "SELECT c.call_id FROM automation_background_children c"), ["parent"], "get");
  for (const state of ["pending", "running", "waiting", "done"]) { db.prepare("UPDATE automation_background_children SET observed_state=? WHERE call_id='code'").run(state); assert.equal(pending().call_id, "code"); }
  db.exec("UPDATE automation_background_children SET terminal_confirmed=1,cancel_requested=1 WHERE call_id='code'"); assert.equal(pending().call_id, "code");
  db.exec("UPDATE automation_background_children SET cancel_acknowledged=1 WHERE call_id='code'"); assert.equal(pending(), undefined);
  const outcomes = read("store/outcomes.rs"); assert.match(outcomes, /task_joins::unfinished_child_call\(conn,execution_id\)/);
  assert.match(read("store/completion.rs"), /require_background_outcomes/);
});

test("parking joins original child, cloud and video work without editing verified branch proof", t => {
  const db = open(); t.after(() => db.close()); parent(db); child(db); launch(db); launch(db, "unknown", null); video(db); child(db, "foreign", "parent", "other-host");
  park(db); assert.deepEqual(db.prepare("SELECT kind,call_id FROM automation_background_task_joins ORDER BY kind").all().map(row => ({ ...row })), [{ kind: "child", call_id: "code" }, { kind: "cloud", call_id: "actions" }, { kind: "video", call_id: "video" }]);
  assert.equal(db.prepare("SELECT evidence_json FROM automation_background_outcomes").get().evidence_json, '{"artifactIds":["retained-file"]}');
  assert.equal(terminal(db), 0); assert.deepEqual(cloudCalls(db), ["actions"]);
});

test("an automatically joined child's current parking occurrence supervises once and its terminal event remains separate", t => {
  const db = open(); t.after(() => db.close()); parent(db); child(db); park(db);
  const occurrence = "11111111-1111-4111-8111-111111111111";
  db.prepare("UPDATE automation_background_children SET observed_state='waiting',observed_json=?").run(JSON.stringify({ waiting: { waitId: occurrence } }));
  assert.equal(childReady(db).length, 1); resume(db); park(db, "park-2"); assert.equal(childReady(db).length, 0);
  db.prepare("UPDATE automation_background_children SET observed_json=?").run(JSON.stringify({ waiting: { waitId: "22222222-2222-4222-8222-222222222222" } }));
  assert.equal(childReady(db).length, 1); resume(db, "park-2"); park(db, "park-3"); assert.equal(childReady(db).length, 0);
  db.exec("UPDATE automation_background_children SET observed_state='done',terminal_confirmed=1"); assert.equal(childReady(db).length, 1);
  resume(db, "park-3"); park(db, "park-4"); assert.equal(childReady(db).length, 0); assert.equal(terminal(db, "park-4"), 0);
});

test("the native join waits for cancellation ACK and consumes simultaneous child/video terminal events together", t => {
  const db = open(); t.after(() => db.close()); parent(db); child(db); video(db); park(db);
  db.exec("UPDATE automation_background_children SET terminal_confirmed=1,cancel_requested=1"); assert.equal(childReady(db).length, 0);
  db.exec("UPDATE automation_background_children SET cancel_acknowledged=1; UPDATE automation_video_jobs SET state='completed',terminal_at=90,artifact_id='actual-file'");
  assert.equal(childReady(db).length, 1); assert.equal(videoReady(db).length, 1); resume(db);
  park(db, "park-2"); assert.equal(childReady(db).length, 0); assert.equal(videoReady(db).length, 0);
  assert.equal(db.prepare("SELECT wake_ack FROM automation_video_jobs").get().wake_ack, 1);
  assert.deepEqual(db.prepare("SELECT wake_consumed FROM automation_background_task_joins ORDER BY kind").all().map(row => row.wake_consumed), [1, 1]);
});

test("cloud jobs omitted from operation criteria enter original GET recovery and completed jobs cannot wake another park", t => {
  const db = open(); t.after(() => db.close()); parent(db); launch(db); park(db);
  const due = () => run(db, sql(waiting, "SELECT DISTINCT w.execution_id FROM automation_background_waits"), [100], "all");
  assert.equal(due().length, 1); assert.deepEqual(cloudCalls(db), ["actions"]);
  const joined = (wait, call) => Object.values(run(db, sql(cloud, "SELECT EXISTS(SELECT 1 FROM automation_background_cloud_waits c"), ["parent", wait, call], "get"))[0];
  assert.equal(joined("park-1", "actions"), 1); assert.equal(joined("other-wait", "actions"), 0); assert.equal(joined("park-1", "forged"), 0);
  observeCloud(db, "actions", "failure"); assert.equal(terminal(db), 1); resume(db);
  db.exec("INSERT INTO automation_background_cloud_waits VALUES('parent','file','actions'); UPDATE automation_background_outcomes SET state='waiting'");
  park(db, "park-2"); assert.deepEqual(cloudCalls(db), []); assert.equal(due().length, 0); assert.equal(joined("park-2", "actions"), 0);
  assert.equal(db.prepare("SELECT conclusion FROM automation_background_cloud_completions").get().conclusion, "failure");
});

test("native cloud batch rotates original owned calls and valid late completion stays bound after rotation", t => {
  const db = open(); t.after(() => db.close()); parent(db); for (let i = 0; i < 7; i++) launch(db, `job-${i}`); park(db);
  assert.deepEqual(cloudCalls(db), ["job-0", "job-1", "job-2", "job-3"]);
  const rotate = sql(cloud, "UPDATE automation_background_task_joins SET retry_at=?4");
  for (let i = 0; i < 4; i++) run(db, rotate, ["parent", "park-1", `job-${i}`, 100 + i]);
  assert.deepEqual(cloudCalls(db), ["job-4", "job-5", "job-6", "job-0"]);
  const original = run(db, sql(cloud, "SELECT EXISTS(SELECT 1 FROM automation_background_cloud_waits c"), ["parent", "park-1", "job-3"], "get");
  assert.equal(Object.values(original)[0], 1); observeCloud(db, "job-3"); assert.equal(terminal(db), 1);
});

test("terminal-before-parking race is an actual one-time join and wrong cloud namespace is never that event", t => {
  const db = open(); t.after(() => db.close()); parent(db); child(db); stage(db);
  assert.equal(terminal(db), 0); db.exec("UPDATE automation_background_children SET terminal_confirmed=1,observed_state='done'"); assert.equal(terminal(db), 1);
  park(db); resume(db); park(db, "park-2"); assert.equal(terminal(db, "park-2"), 0);
  launch(db); stage(db, "parent", "park-2"); observeCloud(db, "actions", "success", "other-owner"); assert.equal(terminal(db, "park-2"), 0);
  assert.match(waiting, /unfinished\.is_empty\(\) && !terminal_join/);
  assert.ok(waiting.indexOf("consume_background_task_joins") < waiting.indexOf('conn.execute("INSERT INTO automation_background_resumptions'));
});

test("consumption and resumption are atomic, retained across reopen, and never rearm completed events", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "xgent-task-joins-")), file = path.join(dir, "store.sqlite"); let db = open(file);
  try {
    parent(db); child(db); video(db); launch(db); park(db); observeCloud(db);
    db.exec("UPDATE automation_background_children SET terminal_confirmed=1; UPDATE automation_video_jobs SET terminal_at=90; CREATE TEMP TRIGGER fail_resume BEFORE INSERT ON automation_background_resumptions BEGIN SELECT RAISE(ABORT,'resume failed'); END;");
    assert.throws(() => resume(db), /resume failed/); assert.equal(terminal(db), 1); assert.equal(db.prepare("SELECT wake_ack FROM automation_video_jobs").get().wake_ack, 0);
    assert.equal(db.prepare("SELECT SUM(wake_consumed) AS n FROM automation_background_task_joins").get().n, 0);
    db.exec("DROP TRIGGER fail_resume"); resume(db); db.close(); db = open(file);
    assert.equal(db.prepare("SELECT state FROM automation_cron_runs").get().state, "pending"); park(db, "park-2"); assert.equal(terminal(db, "park-2"), 0);
    assert.deepEqual(cloudCalls(db), []); assert.equal(childReady(db).length, 0); assert.equal(videoReady(db).length, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_resumptions").get().n, 1);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("automatic child wake candidates exclude resumed/active/foreign/unknown/cancelled work and retain four-task backoff", t => {
  const db = open(); t.after(() => db.close());
  for (let i = 0; i < 7; i++) { const id = `parent-${i}`; parent(db, id); child(db, "code", id); park(db, `park-${i}`, id); }
  assert.equal(childReady(db).length, 0); db.exec("UPDATE automation_background_children SET terminal_confirmed=1"); assert.equal(childReady(db).length, 4);
  db.exec("UPDATE automation_cron_runs SET state='pending' WHERE execution_id='parent-0'; UPDATE automation_background_children SET issuer_host_id='foreign' WHERE execution_id='parent-1'; UPDATE automation_background_task_joins SET retry_at=200 WHERE execution_id='parent-2'; INSERT INTO automation_background_resumptions VALUES('old-resume','parent-3','park-3','{}',90);");
  assert.deepEqual(childReady(db).map(row => row.execution_id), ["parent-4", "parent-5", "parent-6"]);
  assert.equal(childReady(db, 200).length, 4);
});
