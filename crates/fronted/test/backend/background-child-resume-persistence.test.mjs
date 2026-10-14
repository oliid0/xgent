import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// Executes embedded production SQL, not compiled Rust or actual RPC/model
// resumption. Native identity/input/configuration guards are source-reviewed.
const read = name => readFileSync(new URL(`../../src-tauri/src/${name}`, import.meta.url), "utf8");
const source = read("services/automation/store/child_resumes.rs");
const recovery = read("services/automation/store/child_recovery.rs");
const journal = read("services/automation/store/journal.rs");
const background = read("services/automation/store/background.rs");
const children = read("services/automation/store/children.rs");
const sql = (code, prefix) => {
  const found = [...code.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)]
    .find(match => match[1].trimStart().replace(/\s+/g, " ").startsWith(prefix.replace(/\s+/g, " ")));
  assert.ok(found, `Missing production SQL: ${prefix}`); return found[1];
};
const schema = sql(read("services/automation/db.rs"), "CREATE TABLE IF NOT EXISTS automation_meta");
const run = (db, prefix, args = [], method = "run") => db.prepare(sql(source, prefix))[method](...args);
const input = { requestId: "actual-child-request", waitId: "actual-child-wait", resumeId: "fixed-response-id", response: "Original requested time: 10:00" };
function parent(db, id = "parent", state = "leased") {
  db.prepare(sql(background, "INSERT INTO automation_background_tasks")).run(`request-${id}`, id, "{}", 90);
  db.prepare(sql(background, "INSERT INTO automation_cron_runs")).run(id, 90, 300, "{}");
  db.prepare("UPDATE automation_cron_runs SET state = ? WHERE execution_id = ?").run(state, id);
}
const stage = (db, call = "response-call", id = "parent", issuer = "issuer") => run(db,
  "INSERT INTO automation_background_child_resumes", [id, call, "original-peer", issuer, "actual-child-execution", JSON.stringify(input), 90, 100, "original-token"]);
const due = (db, now = 100) => run(db, "SELECT c.execution_id,c.call_id,c.peer_id,c.input_json,c.probes", [now], "all");
const save = (db, call = "response-call", token = "original-token") => run(db,
  "UPDATE automation_background_child_resumes SET receipt_json", ["parent", call, token, JSON.stringify({ version: 1, hostId: "original-peer", executionId: "actual-child-execution", input, acceptedAt: 95 })]);
function fixture(t) {
  const db = new DatabaseSync(":memory:"); db.exec(schema);
  db.prepare("INSERT INTO automation_meta (key,value) VALUES ('background_worker_id.v1','issuer')").run();
  t.after(() => db.close()); return db;
}
function intent(db, call = "response-call", args = { action: "resume", peer_id: "original-peer", request_id: input.requestId, wait_id: input.waitId, response: input.response }) {
  db.prepare(sql(journal, "INSERT INTO automation_background_operations")).run("parent", call, "BackgroundTask", JSON.stringify(args), 1, 90);
  db.prepare(sql(journal, "INSERT INTO automation_background_operation_leases")).run("parent", call, 1, 1, "lease-token");
}

test("the outgoing response is durable before any ACK, immutable by call and bounded with exact serialized bytes", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "xgent-child-response-")), file = path.join(dir, "tasks.sqlite"); let db;
  try {
    db = new DatabaseSync(file); db.exec(schema); parent(db);
    db.prepare("INSERT INTO automation_meta (key,value) VALUES ('background_worker_id.v1','issuer')").run();
    stage(db); assert.throws(() => stage(db), /UNIQUE/); db.close();
    db = new DatabaseSync(file); db.exec(schema);
    const row = db.prepare("SELECT * FROM automation_background_child_resumes").get();
    assert.equal(row.peer_id, "original-peer"); assert.equal(row.receipt_json, null);
    assert.equal(row.child_execution_id, "actual-child-execution"); assert.deepEqual(JSON.parse(row.input_json), input);
    assert.equal(due(db).length, 1);
    const usage = run(db, "SELECT COUNT(*),COALESCE(SUM(LENGTH", ["parent"], "get");
    assert.equal(Object.values(usage)[0], 1); assert.equal(Object.values(usage)[1], Buffer.byteLength(JSON.stringify(input)));
    save(db); db.close(); db = new DatabaseSync(file); db.exec(schema);
    assert.equal(due(db, 999).length, 0); assert.equal(JSON.parse(db.prepare("SELECT receipt_json FROM automation_background_child_resumes").get().receipt_json).input.response, input.response);
  } finally { db?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("original operation lease and actually accepted child's current occurrence are required before reservation", t => {
  const db = fixture(t); parent(db); intent(db);
  const admission = db.prepare(sql(source, "SELECT o.arguments_json FROM automation_background_operations"));
  assert.ok(admission.get("parent", "response-call", 1, 1, "lease-token"));
  for (const args of [["parent", "response-call", 2, 1, "lease-token"], ["parent", "invented", 1, 1, "lease-token"], ["parent", "response-call", 1, 1, "stale"]]) assert.equal(admission.get(...args), undefined);
  db.prepare(sql(children, "INSERT INTO automation_background_children")).run("parent", "child-submit", input.requestId, "original-peer", "issuer", "{}", 90);
  const child = db.prepare(sql(source, "SELECT observed_execution_id FROM automation_background_children"));
  assert.equal(child.get("parent", input.requestId, "original-peer", input.waitId), undefined);
  db.prepare(sql(children, "UPDATE automation_background_children SET receipt_json")).run("parent", "child-submit", JSON.stringify({ waiting: { waitId: input.waitId } }), "actual-child-execution", 1, "waiting", 0, 0, 0, 100);
  assert.equal(child.get("parent", input.requestId, "original-peer", input.waitId).observed_execution_id, "actual-child-execution");
  for (const args of [["other-parent", input.requestId, "original-peer", input.waitId], ["parent", input.requestId, "another-peer", input.waitId], ["parent", input.requestId, "original-peer", "changed-wait"]]) assert.equal(child.get(...args), undefined);
  for (const update of ["cancel_requested = 1", "observed_state = 'done'", "issuer_host_id = 'copied'"]) {
    db.exec("SAVEPOINT invalid_owner"); db.prepare(`UPDATE automation_background_children SET ${update}`).run();
    assert.equal(child.get("parent", input.requestId, "original-peer", input.waitId), undefined); db.exec("ROLLBACK TO invalid_owner; RELEASE invalid_owner");
  }
  const method = source.split("pub fn stage_background_child_resume")[1].split("pub fn due_background_child_resumes")[0];
  assert.ok(method.indexOf("require_background_execution") < method.indexOf("INSERT INTO automation_background_child_resumes"));
  assert.ok(method.indexOf("verify(&tx,id)") < method.indexOf("INSERT INTO automation_background_child_resumes"));
  assert.match(method, /input\.resume_id!=response_identity\(id,call\)/);
  assert.match(method, /original\["response"\]!=input\.response/);
  assert.match(method, /already reserved; query its acceptance, do not resend/);
});

test("native response probes persist fair backoff/fences and exclude completed, stopped or copied execution owners", t => {
  const db = fixture(t); parent(db);
  for (let i = 0; i < 7; i++) stage(db, `response-${i}`);
  parent(db, "copied"); stage(db, "foreign", "copied", "copied-issuer");
  parent(db, "cancelled", "expired"); stage(db, "stopped", "cancelled");
  const first = due(db); assert.equal(first.length, 4); assert.ok(first.every(row => row.execution_id === "parent"));
  db.exec("BEGIN IMMEDIATE");
  for (const row of first) run(db, "UPDATE automation_background_child_resumes SET retry_at", [row.execution_id, row.call_id, 200, 1, "new-token"]);
  db.exec("COMMIT"); assert.equal(due(db).length, 3);
  const call = first[0].call_id;
  assert.equal(run(db, "SELECT peer_id,input_json,child_execution_id,receipt_json", ["parent", call, "original-token"], "get"), undefined);
  assert.ok(run(db, "SELECT peer_id,input_json,child_execution_id,receipt_json", ["parent", call, "new-token"], "get"));
  assert.equal(run(db, "UPDATE automation_background_child_resumes SET last_error", ["parent", call, "original-token", "stale error"]).changes, 0);
  assert.equal(run(db, "UPDATE automation_background_child_resumes SET last_error", ["parent", call, "new-token", "Still offline"]).changes, 1);
  assert.equal(save(db, call, "original-token").changes, 0); assert.equal(save(db, call, "new-token").changes, 1);
  assert.equal(run(db, "UPDATE automation_background_child_resumes SET last_error", ["parent", call, "new-token", "late failure"]).changes, 0);
  db.prepare("UPDATE automation_cron_runs SET state = 'done' WHERE execution_id = 'parent'").run();
  assert.equal(due(db, 999).length, 0);
});

test("mixed submissions and responses park/join together only after every exact native ACK, preserving original failed receipts", t => {
  const db = fixture(t); parent(db, "parent", "waiting");
  intent(db); stage(db);
  intent(db, "child-submit", { action: "submit", name: "Website", prompt: "Original task" });
  db.prepare(sql(children, "INSERT INTO automation_background_children")).run("parent", "child-submit", "next-child", "other-peer", "issuer", "{}", 90);
  db.prepare("INSERT INTO automation_background_leases VALUES ('parent',1,1,'lease-token')").run();
  const group = () => db.prepare(sql(recovery, "SELECT o.call_id,o.arguments_json,CASE WHEN")).all("parent");
  assert.equal(group().length, 2); assert.ok(group().every(row => Object.values(row)[2] === 1));
  const failed = { role: "toolResult", toolName: "BackgroundTask", toolCallId: "response-call", isError: true, details: { outcomeUncertain: true } };
  db.prepare("UPDATE automation_background_operations SET state = 'returned',is_error = 1,result_json = ? WHERE call_id = 'response-call'").run(JSON.stringify(failed));
  assert.ok(group().every(row => Object.values(row)[2] === 1));
  db.prepare(sql(recovery, "INSERT INTO automation_background_waits")).run("parent-wait", "parent", JSON.stringify({ kind: "native_child_acceptance_recovery", callId: "response-call", callIds: ["response-call", "child-submit"] }), 90);
  const wakes = () => db.prepare(sql(recovery, "SELECT w.execution_id,w.wait_id,c.call_id")).all(100);
  assert.equal(wakes().length, 0); save(db); assert.equal(wakes().length, 0);
  db.prepare(sql(children, "UPDATE automation_background_children SET receipt_json")).run("parent", "child-submit", "{}", "other-execution", 1, "pending", 0, 0, 0, 100);
  assert.equal(wakes().length, 1);
  const observed = db.prepare(sql(children, "SELECT peer_id,receipt_json,issued_at,action")).get("parent", "response-call");
  assert.equal(observed.action, "resume"); assert.equal(JSON.parse(observed.receipt_json).input.resumeId, input.resumeId);
  assert.deepEqual(JSON.parse(db.prepare("SELECT result_json FROM automation_background_operations WHERE call_id = 'response-call'").get().result_json), failed);
  const unresolved = db.prepare(sql(journal, "SELECT EXISTS(SELECT 1 FROM automation_background_operations o WHERE"));
  assert.equal(Object.values(unresolved.get("parent"))[0], 0);
  db.prepare("INSERT INTO automation_background_resumptions (resume_id,execution_id,wait_id,input_json,created_at) VALUES ('wake','parent','parent-wait','{}',100)").run();
  assert.equal(wakes().length, 0);
});

test("proof is bound to the reserved child execution/input/issuer and the discovery service contains no response send", () => {
  const method = source.split("pub fn record_background_child_resume_receipt")[1].split("pub fn record_background_child_resume_error")[0];
  assert.match(method, /value\["executionId"\]!=child/); assert.match(method, /value\["input"\]!=expected/);
  assert.match(method, /expected!=serde_json::to_value\(&probe\.input\)/);
  assert.match(method, /receipt is immutable/);
  const service = read("services/child_tasks.rs").split("let responses =")[1].split("let joined =")[0];
  assert.match(service, /due_background_child_resumes/); assert.match(service, /"automation_background_resume_receipt"/);
  assert.doesNotMatch(service, /"automation_background_resume"|"automation_background_submit"|begin_background_operation/);
  const command = read("commands/automation/children.rs").split("pub async fn automation_background_child_resume(")[1].split("pub async fn automation_background_child_resume_receipt")[0];
  assert.match(command, /window.label\(\)!="agent-worker"/);
  assert.ok(command.indexOf("stage_background_child_resume") < command.indexOf('"automation_background_resume"'));
  assert.equal([...command.matchAll(/"automation_background_resume"/g)].length, 1);
  assert.match(read("lib.rs"), /commands::children::automation_background_child_resume,/);
});
