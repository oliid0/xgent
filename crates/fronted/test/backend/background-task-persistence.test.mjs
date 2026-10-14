import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const source = (name) => readFileSync(new URL(`../../src-tauri/src/${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const dbSource = source("services/automation/db.rs");
const storeSource = source("services/automation/store.rs");
const backgroundSource = source("services/automation/store/background.rs");
const artifactSource = source("services/automation/store/artifacts.rs");
const journalSource = source("services/automation/store/journal.rs");
const completionSource = source("services/automation/store/completion.rs");
const inputSource = source("services/automation/store/inputs.rs");
const compactionSource = source("services/automation/store/compaction.rs");
const leaseSource = source("services/automation/store/lease.rs");
const resumeSource = source("services/automation/store/resume.rs");
const outcomeSource = source("services/automation/store/outcomes.rs");
const waitingSource = source("services/automation/store/waiting.rs");
const cloudWaitingSource = source("services/automation/store/cloud_waiting.rs");
// Execute the actual SQL embedded in Rust; this does not compile or emulate
// the Rust command handlers. Native behavioral tests live in automation/tests.rs.
function sqlFrom(text, start) {
  const literal = [...text.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find((match) => match[1].trimStart().startsWith(start));
  assert.ok(literal, `SQL literal missing: ${start}`);
  return literal[1];
}
const schema = sqlFrom(dbSource, "CREATE TABLE IF NOT EXISTS automation_meta");

test("actual cloud wait SQL survives reopen, retains acknowledged ownership, and uses backoff without inventory recovery",()=>{
  const dir=mkdtempSync(path.join(tmpdir(),"xgent-cloud-wait-")),filename=path.join(dir,"tasks.sqlite");let db;
  try {
    db=new DatabaseSync(filename);db.exec(schema);queue(db,"request","execution");queue(db,"other","other-execution");
    const receipt=JSON.stringify({role:"toolResult",toolCallId:"actual-start",toolName:"CloudTaskManager",isError:false,details:{kind:"cloud_task_manager",action:"start",owner:"actual-owner",repository:"agent-temp",taskId:"task-"+"a".repeat(32)}});
    run(db,sqlFrom(journalSource,"INSERT INTO automation_background_operations"),["execution","actual-start","CloudTaskManager",JSON.stringify({action:"start"}),1,100]);
    run(db,sqlFrom(journalSource,"UPDATE automation_background_operations SET state = 'returned'"),["execution","actual-start",receipt,0,101]);
    run(db,sqlFrom(outcomeSource,"INSERT INTO automation_background_outcomes"),["execution","slides","waiting",null,"Actual cloud job pending",102]);
    run(db,sqlFrom(cloudWaitingSource,"INSERT INTO automation_background_cloud_waits"),["execution","slides","actual-start"]);
    run(db,sqlFrom(waitingSource,"INSERT INTO automation_background_waits"),["occurrence","execution","original stopped context","[]",100,150,'["CloudTaskManager"]',0]);
    db.exec("UPDATE automation_cron_runs SET state = 'waiting' WHERE execution_id = 'execution'");db.close();db=new DatabaseSync(filename);db.exec(schema);
    const due=sqlFrom(waitingSource,"SELECT DISTINCT w.execution_id"),lookup=sqlFrom(cloudWaitingSource,"WITH calls AS"),start=sqlFrom(cloudWaitingSource,"SELECT arguments_json,result_json");
    assert.equal(run(db,due,[200],"all").length,1);assert.deepEqual(run(db,lookup,["execution"],"all").map(row=>row.call_id),["actual-start"]);
    assert.deepEqual(JSON.parse(run(db,start,["execution","actual-start"],"get").result_json),JSON.parse(receipt));assert.equal(run(db,start,["other-execution","actual-start"],"get"),undefined);
    run(db,sqlFrom(waitingSource,"UPDATE automation_background_waits SET retry_at"),["occurrence",1000,1]);assert.equal(run(db,due,[200],"all").length,0);
    db.prepare("UPDATE automation_background_waits SET retry_at = 150").run();
    db.prepare("UPDATE automation_background_outcomes SET state = 'verified' WHERE execution_id = 'execution'").run();assert.equal(run(db,due,[200],"all").length,0);assert.equal(run(db,lookup,["execution"],"all").length,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM automation_background_operations").get().count,1);assert.equal(db.prepare("SELECT COUNT(*) AS count FROM automation_background_resumptions").get().count,0);
  } finally {db?.close();unlinkSync(filename);rmdirSync(dir);}
});

test("actual waiting SQL preserves an unfinished task across reopen and excludes it from claim and expiry", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "xgent-waiting-sql-")), filename = path.join(dir, "tasks.sqlite"); let db;
  try {
    db = new DatabaseSync(filename); db.exec(schema); queue(db, "request", "execution");
    db.exec("UPDATE automation_cron_runs SET state = 'leased'");
    run(db, sqlFrom(leaseSource, "INSERT INTO automation_background_leases"), ["execution", 1, 1, "old-token"]);
    db.exec("BEGIN IMMEDIATE");
    run(db, sqlFrom(waitingSource, "INSERT INTO automation_background_waits"), ["occurrence", "execution", "original-park-input", '["Calendar"]', 100, 150, '["Read"]', 0]);
    run(db, sqlFrom(waitingSource, "UPDATE automation_background_leases SET generation"), ["execution", 2, "revoked-token"]);
    run(db, sqlFrom(waitingSource, "UPDATE automation_cron_runs SET state = 'waiting'"), ["execution", 1000, "Actual report retained; calendar waiting", "retained-request"]);
    db.exec("COMMIT"); db.close(); db = new DatabaseSync(filename);
    const record = run(db, sqlFrom(waitingSource, "SELECT w.wait_id, w.created_at"), ["execution"], "get");
    assert.equal(record.wait_id, "occurrence"); assert.equal(record.probes, 0);
    assert.equal(db.prepare("SELECT finished_at FROM automation_cron_runs").get().finished_at, null);
    assert.equal(run(db, sqlFrom(storeSource, "SELECT request_json FROM automation_cron_runs"), [2], "all").length, 0);
    const expiry = sqlFrom(storeSource, "state = 'leased' AND lease_expires_at IS NOT NULL");
    assert.equal(run(db, `SELECT execution_id FROM automation_cron_runs WHERE ${expiry}`, [10000], "all").length, 0);
    const due = sqlFrom(waitingSource, "SELECT DISTINCT w.execution_id");
    assert.equal(run(db, due, [200], "all").length, 1);
    run(db, sqlFrom(waitingSource, "UPDATE automation_background_waits SET retry_at"), ["occurrence", 1000, 1]);
    assert.equal(run(db, due, [200], "all").length, 0);
  } finally { db?.close(); unlinkSync(filename); rmdirSync(dir); }
});

test("waiting rollback and one-response-per-occurrence SQL preserve source state and forbid duplicate wake acceptance", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(schema); queue(db, "request", "execution"); db.exec("UPDATE automation_cron_runs SET state = 'leased'");
    const park = sqlFrom(waitingSource, "INSERT INTO automation_background_waits");
    db.exec("BEGIN IMMEDIATE"); run(db, park, ["failed", "execution", "input", "[]", 100, 150, "[]", 0]);
    run(db, sqlFrom(waitingSource, "UPDATE automation_cron_runs SET state = 'waiting'"), ["execution", 1000, "Waiting", "request"]);
    db.exec("ROLLBACK"); assert.equal(db.prepare("SELECT state FROM automation_cron_runs").get().state, "leased");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM automation_background_waits").get().count, 0);
    run(db, park, ["occurrence", "execution", "input", "[]", 100, 150, "[]", 0]);
    db.exec("UPDATE automation_cron_runs SET state = 'waiting'");
    const resume = sqlFrom(waitingSource, "INSERT INTO automation_background_resumptions");
    run(db, resume, ["resume-one", "execution", "occurrence", "actual response", 200]);
    assert.throws(() => run(db, resume, ["resume-two", "execution", "occurrence", "duplicate response", 201]), /UNIQUE/);
    run(db, sqlFrom(waitingSource, "UPDATE automation_cron_runs SET state = 'pending'"), ["execution"]);
    assert.equal(db.prepare("SELECT state FROM automation_cron_runs").get().state, "pending");
    assert.equal(run(db, sqlFrom(waitingSource, "SELECT w.wait_id, w.created_at"), ["execution"], "get"), undefined);
  } finally { db.close(); }
});

test("capability resolution SQL retains immutable original plan and already verified branch evidence", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(schema);
    run(db, sqlFrom(outcomeSource, "INSERT INTO automation_background_plans"), ["execution", "original requirements", 100]);
    const outcome = sqlFrom(outcomeSource, "INSERT INTO automation_background_outcomes");
    run(db, outcome, ["execution", "report", "verified", "actual saved report", null, 101]);
    run(db, outcome, ["execution", "calendar", "waiting", null, "Discovery unavailable", 101]);
    const resolve = sqlFrom(outcomeSource, "INSERT INTO automation_background_plan_resolutions");
    run(db, resolve, ["execution", "calendar", '[{"kind":"operation","tool":"Calendar","arguments":{"calendar":"accepted"}}]', 200]);
    assert.throws(() => run(db, resolve, ["execution", "calendar", "weakened criteria", 201]), /UNIQUE/);
    run(db, sqlFrom(outcomeSource, "UPDATE automation_background_outcomes SET state = 'pending'"), ["execution", "calendar", 200]);
    assert.equal(db.prepare("SELECT plan_json FROM automation_background_plans").get().plan_json, "original requirements");
    const rows = db.prepare("SELECT branch_id, state, evidence_json FROM automation_background_outcomes ORDER BY branch_id").all();
    assert.equal(rows[0].state, "pending"); assert.equal(rows[1].state, "verified"); assert.equal(rows[1].evidence_json, "actual saved report");
  } finally { db.close(); }
});

test("durable compound outcomes survive reopen without losing independent waiting branches", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "xgent-outcome-sql-"));
  const filename = path.join(dir, "tasks.sqlite"); let db;
  try {
    db = new DatabaseSync(filename); db.exec(schema);
    queue(db, "owner", "execution"); queue(db, "other", "other-execution");
    const proposal = JSON.stringify({ version: 1, branches: [{ id: "report" }, { id: "calendar" }] });
    const insertPlan = sqlFrom(outcomeSource, "INSERT INTO automation_background_plans");
    run(db, insertPlan, ["execution", proposal, 100]);
    assert.throws(() => run(db, insertPlan, ["execution", "replacement", 101]), /UNIQUE/);
    const upsert = sqlFrom(outcomeSource, "INSERT INTO automation_background_outcomes");
    const evidence = JSON.stringify({ artifactIds: [], callIds: [], answer: "Actual saved text" });
    run(db, upsert, ["execution", "report", "verified", evidence, null, 101]);
    run(db, upsert, ["execution", "calendar", "waiting", null, "No calendar authorization", 102]);
    db.close(); db = new DatabaseSync(filename);
    const readPlan = sqlFrom(outcomeSource, "SELECT plan_json FROM automation_background_plans");
    assert.equal(run(db, readPlan, ["execution"], "get").plan_json, proposal);
    assert.equal(run(db, readPlan, ["other-execution"], "get"), undefined);
    const readOutcome = sqlFrom(outcomeSource, "SELECT state, evidence_json, reason FROM automation_background_outcomes");
    assert.deepEqual(JSON.parse(run(db, readOutcome, ["execution", "report"], "get").evidence_json), JSON.parse(evidence));
    assert.equal(run(db, readOutcome, ["execution", "calendar"], "get").reason, "No calendar authorization");
    assert.equal(run(db, readOutcome, ["other-execution", "calendar"], "get"), undefined);
  } finally { db?.close(); unlinkSync(filename); rmdirSync(dir); }
});

test("outcome transaction rollback preserves the prior plan and branch evidence", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(schema);
    const insert = sqlFrom(outcomeSource, "INSERT INTO automation_background_plans");
    const upsert = sqlFrom(outcomeSource, "INSERT INTO automation_background_outcomes");
    run(db, insert, ["task", "immutable-plan", 100]);
    run(db, upsert, ["task", "report", "waiting", null, "Missing source", 101]);
    db.exec("BEGIN IMMEDIATE");
    run(db, upsert, ["task", "report", "verified", "proposed-evidence", null, 102]);
    db.exec("ROLLBACK");
    const outcome = run(db, sqlFrom(outcomeSource, "SELECT state, evidence_json, reason FROM automation_background_outcomes"), ["task", "report"], "get");
    assert.equal(outcome.state, "waiting"); assert.equal(outcome.evidence_json, null); assert.equal(outcome.reason, "Missing source");
    assert.equal(run(db, sqlFrom(outcomeSource, "SELECT plan_json FROM automation_background_plans"), ["task"], "get").plan_json, "immutable-plan");
  } finally { db.close(); }
});

test("evidence lookup and receipt pagination read actual task-scoped rows", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(schema);
    const insert = sqlFrom(journalSource, "INSERT INTO automation_background_operations");
    for (let i = 0; i < 15; i++) run(db, insert, [i % 3 ? "task" : "other", `call-${i}`, "Read", "{}", 1, 100 + i]);
    const select = sqlFrom(outcomeSource, "SELECT sequence, call_id, tool_name, state, is_error FROM automation_background_operations");
    const first = run(db, select, ["task", 0], "all");
    assert.equal(first.length, 10); assert.ok(first.every((row) => Number(row.call_id.split("-")[1]) % 3));
    assert.equal(run(db, select, ["task", first.at(-1).sequence], "all").length, 0);
    const receipt = sqlFrom(outcomeSource, "SELECT tool_name, arguments_json, state, result_json, is_error FROM automation_background_operations");
    assert.equal(run(db, receipt, ["task", "call-0"], "get"), undefined);
    assert.equal(run(db, receipt, ["task", "call-1"], "get").state, "started");
    const content = Buffer.from("real file snapshot"), hash = createHash("sha256").update(content).digest("hex");
    run(db, sqlFrom(artifactSource, "INSERT INTO automation_background_artifacts"), ["file", "task", "report.txt", hash, content.length, content, 120]);
    const artifact = sqlFrom(outcomeSource, "SELECT relative_path, content_hash, bytes FROM automation_background_artifacts");
    const owned=run(db, artifact, ["task", "file"], "get");
    assert.equal(owned.bytes,content.length);assert.equal(owned.content_hash,hash);
    const pieces=readFileSync(new URL("../../src-tauri/src/services/automation/store/artifact_parts.rs",import.meta.url),"utf8");
    assert.deepEqual(Buffer.from(run(db,sqlFrom(pieces,"SELECT content,content_hash FROM automation_background_artifacts"),["file"],"get").content),content);
    assert.equal(run(db, artifact, ["other", "file"], "get"), undefined);
  } finally { db.close(); }
});
function run(db, sql, values = [], method = "run") {
  const bound = Object.fromEntries(values.map((value, index) => [String(index + 1), value]));
  return db.prepare(sql)[method](bound);
}
function queue(db, id, execution, at = 100) {
  run(db, sqlFrom(backgroundSource, "INSERT INTO automation_background_tasks"), [id, execution, "{}", at]);
  run(db, sqlFrom(backgroundSource, "INSERT INTO automation_cron_runs"), [execution, at, 200, "{}"]);
}

test("restart selection is bounded, excludes terminal/outbox/unbound work and revokes old authority atomically", () => {
  const db = new DatabaseSync(":memory:"); db.exec(schema);
  const candidates = sqlFrom(resumeSource, "SELECT r.execution_id, r.request_json, l.attempt");
  const insertLease = sqlFrom(leaseSource, "INSERT INTO automation_background_leases");
  const fence = sqlFrom(leaseSource, "SELECT EXISTS(SELECT 1 FROM automation_background_leases WHERE execution_id = ?1 AND attempt");
  const ownsOld = () => Object.values(run(db, fence, ["safe", 1, 1, "old-token"], "get"))[0];
  try {
    for (const id of ["safe", "cancelled", "finished", "budget", "outbox", "unbound"]) {
      queue(db, `request-${id}`, id);
      run(db, insertLease, [id, id === "budget" ? 3 : 1, 1, "old-token"]);
      db.prepare("UPDATE automation_cron_runs SET state = ? WHERE execution_id = ?").run(id === "cancelled" ? "expired" : id === "finished" ? "done" : "leased", id);
      if (id !== "unbound") run(db, sqlFrom(backgroundSource, "INSERT INTO automation_background_configuration_bindings"), [id, "accepted-binding"]);
    }
    run(db, sqlFrom(completionSource, "INSERT INTO automation_prompt_completion_outbox"), ["outbox", '{"output":"already persisted"}', 101]);
    assert.deepEqual(run(db, candidates, [3], "all").map((row) => row.execution_id), ["safe"]);
    const revoke = sqlFrom(resumeSource, "UPDATE automation_background_leases SET generation");
    const requeue = sqlFrom(resumeSource, "UPDATE automation_cron_runs SET state = 'pending'");
    db.exec("BEGIN IMMEDIATE");
    run(db, revoke, ["safe", 2, "revoked-token"]);
    run(db, requeue, ["safe", '{"executionId":"safe"}']);
    assert.equal(ownsOld(), 0);
    db.exec("ROLLBACK");
    assert.equal(ownsOld(), 1);
    assert.equal(db.prepare("SELECT state FROM automation_cron_runs WHERE execution_id = 'safe'").get().state, "leased");
    db.exec("BEGIN IMMEDIATE");
    run(db, revoke, ["safe", 2, "revoked-token"]);
    run(db, requeue, ["safe", '{"executionId":"safe"}']);
    db.exec("COMMIT");
    assert.equal(ownsOld(), 0);
    assert.equal(db.prepare("SELECT state FROM automation_cron_runs WHERE execution_id = 'safe'").get().state, "pending");
    run(db, insertLease, ["safe", 2, 3, "fresh-token"]);
    assert.equal(ownsOld(), 0);
    assert.equal(db.prepare("SELECT attempt, generation FROM automation_background_leases WHERE execution_id = 'safe'").get().generation, 3);
  } finally { db.close(); }
});

test("worker checkpoint recovery checks authority/configuration/unknown effects before exposing persisted context", () => {
  const body = resumeSource.split("pub fn restore_background_checkpoint")[1];
  assert.ok(body.indexOf("require_background_execution") < body.indexOf("verify(&tx"));
  assert.ok(body.indexOf("verify(&tx") < body.indexOf("has_uncertain_operations"));
  assert.ok(body.indexOf("has_uncertain_operations") < body.indexOf("SELECT revision, context_json"));
  const commands = source("commands/automation/cron.rs").split("pub async fn automation_background_restore_checkpoint")[1].split("pub async fn automation_background_compact_context")[0];
  assert.match(commands, /window.label\(\) != "agent-worker"/);
  assert.match(commands, /verify_background_configuration/);
  assert.match(source("lib.rs"), /commands::cron::automation_background_restore_checkpoint/);
  assert.doesNotMatch(source("services/local_access.rs"), /"automation_background_restore_checkpoint"\s*=>/);
});

test("actual lease SQL rolls claim metadata back atomically and rejects stale or forged attempts after reclaim", () => {
  const db = new DatabaseSync(":memory:"); db.exec(schema);
  const insert = sqlFrom(leaseSource, "INSERT INTO automation_background_leases");
  const fence = sqlFrom(leaseSource, "SELECT EXISTS(SELECT 1 FROM automation_background_leases WHERE execution_id = ?1 AND attempt");
  const owns = (id, attempt, generation, token) => Object.values(run(db, fence, [id, attempt, generation, token], "get"))[0];
  try {
    queue(db, "request", "execution");
    db.exec("BEGIN IMMEDIATE");
    run(db, insert, ["execution", 1, 1, "first-token"]);
    run(db, sqlFrom(storeSource.split("request.lease = Self::claim_background_lease")[1], "UPDATE automation_cron_runs"), ["execution", 300, '{"lease":"first-token"}']);
    db.exec("ROLLBACK");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_leases").get().n, 0);
    assert.equal(db.prepare("SELECT state FROM automation_cron_runs").get().state, "pending");
    db.exec("BEGIN IMMEDIATE");
    run(db, insert, ["execution", 1, 1, "first-token"]);
    run(db, sqlFrom(storeSource.split("request.lease = Self::claim_background_lease")[1], "UPDATE automation_cron_runs"), ["execution", 300, '{"lease":"first-token"}']);
    db.exec("COMMIT");
    assert.equal(owns("execution", 1, 1, "first-token"), 1);
    run(db, sqlFrom(storeSource, "UPDATE automation_cron_runs SET state = 'pending'"), ["execution", 400]);
    run(db, insert, ["execution", 2, 2, "second-token"]);
    assert.equal(owns("execution", 1, 1, "first-token"), 0);
    assert.equal(owns("execution", 2, 2, "first-token"), 0);
    assert.equal(owns("other-task", 2, 2, "second-token"), 0);
    assert.equal(owns("execution", 2, 2, "second-token"), 1);
  } finally { db.close(); }
});

test("operation ownership SQL retains the original receipt authority across a new claim and cancellation", () => {
  const db = new DatabaseSync(":memory:"); db.exec(schema);
  const owns = sqlFrom(journalSource, "SELECT EXISTS(SELECT 1 FROM automation_background_operation_leases");
  const check = (attempt, generation, token) => Object.values(run(db, owns, ["execution", "send", attempt, generation, token], "get"))[0];
  try {
    queue(db, "request", "execution");
    run(db, sqlFrom(leaseSource, "INSERT INTO automation_background_leases"), ["execution", 1, 1, "old-token"]);
    db.exec("BEGIN IMMEDIATE");
    run(db, sqlFrom(journalSource, "INSERT INTO automation_background_operations"), ["execution", "send", "SendMail", "{}", 1, 100]);
    run(db, sqlFrom(journalSource, "INSERT INTO automation_background_operation_leases"), ["execution", "send", 1, 1, "old-token"]);
    db.exec("COMMIT");
    run(db, sqlFrom(leaseSource, "INSERT INTO automation_background_leases"), ["execution", 2, 2, "new-token"]);
    db.exec("UPDATE automation_cron_runs SET state = 'expired'");
    assert.equal(check(2, 2, "new-token"), 0);
    assert.equal(check(1, 1, "old-token"), 1);
    run(db, sqlFrom(journalSource, "UPDATE automation_background_operations SET state = 'returned'"), ["execution", "send", '{"receipt":"real"}', 0, 101]);
    assert.equal(db.prepare("SELECT state FROM automation_cron_runs").get().state, "expired");
    assert.equal(db.prepare("SELECT result_json FROM automation_background_operations").get().result_json, '{"receipt":"real"}');
    assert.throws(() => run(db, sqlFrom(journalSource, "INSERT INTO automation_background_operation_leases"), ["execution", "send", 2, 2, "new-token"]), /UNIQUE/);
  } finally { db.close(); }
});

test("native mutation handlers validate the supplied attempt in their transaction and strip it before peer transmission", () => {
  for (const text of [journalSource.split("pub fn save_background_checkpoint")[1].split("#[cfg(test)]")[0],
    journalSource.split("pub fn begin_background_operation_with_configuration")[1].split("/// A receipt")[0], compactionSource]) {
    assert.ok(text.indexOf("transaction_with_behavior") < text.indexOf("require_background_execution(&tx"));
    assert.ok(text.indexOf("require_background_execution(&tx") >= 0);
  }
  assert.match(artifactSource, /transaction_with_behavior[\s\S]*require_background_execution\(&tx, execution_id, lease\)/);
  assert.match(completionSource, /require_background_execution\(&tx, &input.execution_id, input.lease.as_ref\(\)\)/);
  const peer = source("commands/integration/lan_pc.rs").split("pub async fn worker_peer_invoke(")[1].split("pub async fn worker_peer_forget(")[0];
  assert.match(peer, /args.get\("parent_lease"\)/);
  assert.ok(peer.indexOf('object.remove("parent_lease")') < peer.indexOf("registry.invoke("));
  assert.match(peer, /registry.invoke\(&peer_id, &command, outbound_args\)/);
  assert.doesNotMatch(source("services/worker_peers.rs"), /parent_lease/);
});

test("actual compaction SQL commits source archive with replacement and rolls both back on failure", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "xgent-context-archive-"));
  const filename = path.join(dir, "tasks.sqlite"); let db;
  const original = JSON.stringify({ systemPrompt: "policy", messages: [{ role: "user", content: "exact goal" },
    { role: "assistant", content: "原始证据".repeat(6000) }] });
  const replacement = JSON.stringify({ systemPrompt: "policy plus summary", messages: [{ role: "user", content: "exact goal" }] });
  const hash = (text) => createHash("sha256").update(text).digest("hex");
  const values = ["execution", 1, 2, original, hash(original), hash(replacement), '{"api":"xgent-compaction"}', 100];
  try {
    db = new DatabaseSync(filename); db.exec(schema);
    run(db, sqlFrom(journalSource, "INSERT INTO automation_background_checkpoints"), ["execution", 1, original, 1]);
    db.exec("BEGIN IMMEDIATE");
    run(db, sqlFrom(compactionSource, "INSERT INTO automation_background_compactions"), values);
    run(db, sqlFrom(compactionSource, "UPDATE automation_background_checkpoints SET revision"), ["execution", 1, 2, replacement, 100]);
    db.exec("ROLLBACK");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_compactions").get().n, 0);
    assert.equal(db.prepare("SELECT context_json FROM automation_background_checkpoints").get().context_json, original);
    db.exec("BEGIN IMMEDIATE");
    run(db, sqlFrom(compactionSource, "INSERT INTO automation_background_compactions"), values);
    assert.equal(run(db, sqlFrom(compactionSource, "UPDATE automation_background_checkpoints SET revision"), ["execution", 1, 2, replacement, 100]).changes, 1);
    db.exec("COMMIT"); db.close(); db = new DatabaseSync(filename);
    const archived = run(db, sqlFrom(compactionSource, "SELECT source_context_json, source_hash"), ["execution", 1], "get");
    assert.equal(archived.source_context_json, original); assert.equal(archived.source_hash, hash(original));
    assert.equal(db.prepare("SELECT context_json FROM automation_background_checkpoints").get().context_json, replacement);
    assert.equal(run(db, sqlFrom(compactionSource, "UPDATE automation_background_checkpoints SET revision"), ["execution", 1, 2, "stale", 101]).changes, 0);
    assert.equal(run(db, sqlFrom(compactionSource, "SELECT source_context_json, source_hash"), ["other-execution", 1], "get"), undefined);
    assert.throws(() => run(db, sqlFrom(compactionSource, "INSERT INTO automation_background_compactions"), values), /UNIQUE/);
    assert.equal(db.prepare("SELECT context_json FROM automation_background_checkpoints").get().context_json, replacement);
  } finally { db?.close(); unlinkSync(filename); rmdirSync(dir); }
});

test("archive SQL pagination is task scoped and quota counts UTF-8 bytes without deleting history", () => {
  const db = new DatabaseSync(":memory:"); db.exec(schema);
  try {
    const raw = "中文证据", summary = "摘要";
    for (let revision = 1; revision <= 12; revision++) {
      run(db, sqlFrom(compactionSource, "INSERT INTO automation_background_compactions"), ["owned", revision, revision + 1, raw, "hash", "new-hash", summary, 100]);
    }
    run(db, sqlFrom(compactionSource, "INSERT INTO automation_background_compactions"), ["other", 1, 2, "private", "other-hash", "new", summary, 100]);
    const page = run(db, sqlFrom(compactionSource, "SELECT source_revision, checkpoint_revision, source_hash"), ["owned", 0], "all");
    assert.equal(page.length, 11); assert.deepEqual(page.map((row) => row.source_revision), Array.from({ length: 11 }, (_, index) => index + 1));
    assert.ok(page.every((row) => row.source_hash === "hash" && row["LENGTH(CAST(source_context_json AS BLOB))"] === Buffer.byteLength(raw)));
    const tail = run(db, sqlFrom(compactionSource, "SELECT source_revision, checkpoint_revision, source_hash"), ["owned", 10], "all");
    assert.deepEqual(tail.map((row) => row.source_revision), [11, 12]);
    const usage = Object.values(run(db, sqlFrom(compactionSource, "SELECT COUNT(*), COALESCE(SUM(LENGTH(CAST(source_context_json"), ["owned"], "get"));
    assert.deepEqual(usage, [12, 12 * (Buffer.byteLength(raw) + Buffer.byteLength(summary))]);
    assert.doesNotMatch(compactionSource, /DELETE FROM automation_background_compactions/);
  } finally { db.close(); }
});

test("archive commands remain native worker-only and bind configuration before the transactional replacement", () => {
  const commands = source("commands/automation/cron.rs");
  for (const name of ["automation_background_compact_context", "automation_background_compactions", "automation_background_read_context_archive"]) {
    const handler = commands.split(`pub async fn ${name}(`)[1].split("#[cfg(desktop)]")[0];
    assert.match(handler, /window\.label\(\) != "agent-worker"/);
    assert.match(source("lib.rs"), new RegExp(`commands::cron::${name}`));
    assert.doesNotMatch(source("services/worker_peers.rs").split("pub async fn invoke(")[1].split("let client")[0], new RegExp(`"${name}"`));
    assert.doesNotMatch(source("services/local_access.rs").split('if command.starts_with("automation_background_")')[1].split('if command == "settings_load_all"')[0], new RegExp(`"${name}"\\s*=>`));
  }
  assert.ok(compactionSource.indexOf("transaction_with_behavior") < compactionSource.indexOf("verify(&tx"));
  assert.ok(compactionSource.indexOf("verify(&tx") < compactionSource.indexOf("INSERT INTO automation_background_compactions"));
  assert.match(commands, /compact_background_context[\s\S]*verify_background_configuration/);
});

test("native binding, immutable input and queue commit together and survive reopen without secret copies", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "xgent-config-binding-"));
  const filename = path.join(dir, "tasks.sqlite"); let db;
  try {
    db = new DatabaseSync(filename); db.exec(schema);
    db.exec("BEGIN IMMEDIATE");
    queue(db, "rolled-back", "failed");
    run(db, sqlFrom(backgroundSource, "INSERT INTO automation_background_configuration_bindings"), ["failed", "device-keyed-commitment"]);
    db.exec("ROLLBACK");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_configuration_bindings").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_cron_runs").get().n, 0);
    db.exec("BEGIN IMMEDIATE");
    queue(db, "accepted", "execution");
    run(db, sqlFrom(backgroundSource, "INSERT INTO automation_background_configuration_bindings"), ["execution", "device-keyed-commitment"]);
    db.exec("COMMIT"); db.close(); db = new DatabaseSync(filename);
    const row = run(db, sqlFrom(backgroundSource, "SELECT b.input_json, c.binding"), ["execution"], "get");
    assert.equal(row.binding, "device-keyed-commitment");
    assert.equal(row.input_json, "{}");
    assert.throws(() => run(db, sqlFrom(backgroundSource, "INSERT INTO automation_background_configuration_bindings"), ["execution", "changed"]), /UNIQUE/);
    assert.equal(run(db, sqlFrom(backgroundSource, "SELECT b.input_json, c.binding"), ["execution"], "get").binding, row.binding);
    db.exec("DELETE FROM automation_background_configuration_bindings");
    assert.equal(run(db, sqlFrom(backgroundSource, "SELECT b.input_json, c.binding"), ["execution"], "get").binding, null);
  } finally { db?.close(); unlinkSync(filename); rmdirSync(dir); }
});

test("configuration reads and native intents require the accepted binding and cannot be relayed to peers", () => {
  const commands = source("commands/automation/cron.rs");
  const peers = source("services/worker_peers.rs");
  const settings = commands.split("pub async fn automation_background_execution_settings(")[1].split("#[cfg(desktop)]")[0];
  assert.match(settings, /window\.label\(\) != "agent-worker"/);
  assert.match(settings, /verified_background_execution_settings/);
  const verify = backgroundSource.split("pub(crate) fn verify_background_configuration(")[1];
  assert.ok(verify.indexOf("require_background_execution") >= 0);
  assert.ok(verify.indexOf("require_background_execution") < verify.indexOf("load(conn"));
  assert.ok(verify.indexOf("accepted.ok_or_else") < verify.indexOf("load(conn"));
  assert.match(verify, /if current != accepted/);
  const intent = journalSource.split("pub fn begin_background_operation_with_configuration(")[1];
  assert.ok(intent.indexOf("transaction_with_behavior") < intent.indexOf("verify(&tx"));
  assert.ok(intent.indexOf("verify(&tx") < intent.indexOf("INSERT INTO automation_background_operations"));
  assert.match(commands, /begin_background_operation_with_configuration[\s\S]*verify_background_configuration/);
  const allowlist = peers.split("pub async fn invoke(")[1].split("let client")[0];
  assert.doesNotMatch(allowlist, /"automation_background_execution_settings"/);
  const access = source("services/local_access.rs").split('if command.starts_with("automation_background_")')[1].split('if command == "settings_load_all"')[0];
  assert.doesNotMatch(access, /"automation_background_execution_settings"\s*=>/);
  assert.match(source("lib.rs"), /commands::cron::automation_background_execution_settings/);
});

test("delegation ancestry and immutable input persist atomically with the accepted queue across reopen", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "xgent-lineage-sql-"));
  const filename = path.join(dir, "tasks.sqlite"); let db;
  const delegation = { rootRequestId: "root", parentRequestId: "parent", ancestorHostIds: ["first", "second"] };
  const inputJson = JSON.stringify({ requestId: "child", delegation });
  const requestJson = JSON.stringify({ executionId: "execution", backgroundContext: {
    rootRequestId: "root", requestId: "child", hostIds: ["first", "second", "receiver"],
  } });
  try {
    db = new DatabaseSync(filename); db.exec(schema); db.exec("BEGIN IMMEDIATE");
    run(db, sqlFrom(backgroundSource, "INSERT INTO automation_background_tasks"), ["child", "execution", inputJson, 100]);
    run(db, sqlFrom(backgroundSource, "INSERT INTO automation_cron_runs"), ["execution", 100, 200, requestJson]);
    db.exec("COMMIT"); db.close(); db = new DatabaseSync(filename);
    const input = run(db, sqlFrom(backgroundSource, "SELECT execution_id, input_json FROM automation_background_tasks WHERE request_id"), ["child"], "get");
    const pending = run(db, sqlFrom(storeSource, "SELECT request_json FROM automation_cron_runs"), [2], "all");
    assert.deepEqual(JSON.parse(input.input_json).delegation, delegation);
    assert.deepEqual(JSON.parse(pending[0].request_json).backgroundContext.hostIds, ["first", "second", "receiver"]);
    const commands = source("commands/integration/lan_pc.rs");
    assert.match(commands, /window\.label\(\) == "agent-worker" && command == "automation_background_submit"/);
    assert.ok(commands.indexOf("require_background_delegation") < commands.indexOf("registry.invoke("));
    const peers = source("services/worker_peers.rs").split("pub async fn invoke(")[1];
    assert.ok(peers.indexOf("host.delegation_version != 1") < peers.indexOf("client.invoke("));
  } finally { db?.close(); unlinkSync(filename); rmdirSync(dir); }
});

test("accepted binary inputs and queue receipt survive reopen as one immutable task input", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "xgent-input-sql-"));
  const filename = path.join(dir, "tasks.sqlite"); let db;
  const bytes = Buffer.from([0, 255, 18, 128]);
  const inputJson = JSON.stringify({ requestId: "owner", workdir: "/host", files: [{ name: "spec.pdf", bytes: bytes.length,
    contentHash: "verified hash", contentBase64: bytes.toString("base64") }] });
  try {
    db = new DatabaseSync(filename); db.exec(schema); db.exec("BEGIN IMMEDIATE");
    run(db, sqlFrom(backgroundSource, "INSERT INTO automation_background_tasks"), ["owner", "execution", inputJson, 100]);
    run(db, sqlFrom(backgroundSource, "INSERT INTO automation_cron_runs"), ["execution", 100, 200, "{}"]);
    db.exec("COMMIT"); db.close(); db = new DatabaseSync(filename);
    const persisted = run(db, sqlFrom(backgroundSource, "SELECT input_json FROM automation_background_tasks WHERE request_id"), ["owner"], "get");
    assert.deepEqual(Buffer.from(JSON.parse(persisted.input_json).files[0].contentBase64, "base64"), bytes);
    db.exec("UPDATE automation_cron_runs SET state = 'leased', lease_expires_at = 9999999999999");
    assert.equal(run(db, sqlFrom(inputSource, "SELECT input_json FROM automation_background_tasks WHERE execution_id"), ["execution"], "get").input_json, inputJson);
    const live = sqlFrom(journalSource, "SELECT EXISTS(SELECT 1 FROM automation_background_tasks");
    assert.equal(Object.values(run(db, live, ["execution", 100], "get"))[0], 1);
    db.exec("UPDATE automation_cron_runs SET state = 'expired'");
    assert.equal(Object.values(run(db, live, ["execution", 100], "get"))[0], 0);
    assert.equal(JSON.parse(persisted.input_json).files[0].contentBase64, bytes.toString("base64"));
  } finally { db?.close(); unlinkSync(filename); rmdirSync(dir); }
});

test("input materialization remains executor-only and accepted files are validated before enqueue", () => {
  const commands = source("commands/automation/cron.rs");
  const native = source("lib.rs");
  const prepare = commands.split("pub async fn automation_background_prepare_inputs(")[1].split("#[cfg(desktop)]")[0];
  assert.match(prepare, /window\.label\(\) != "agent-worker"/);
  assert.match(prepare, /background_inputs_for_execution[\s\S]*require_background_action_lease[\s\S]*create_background_input_copy[\s\S]*require_background_action_lease/);
  assert.match(inputSource, /require_background_execution\(&conn, execution_id, lease\)/);
  const submit = backgroundSource.split("pub fn submit_background_task_with_binding(")[1];
  assert.ok(submit.indexOf("normalize_background_task_input") < submit.indexOf("transaction_with_behavior"));
  assert.match(backgroundSource, /normalize_background_files\(&mut input\.files\)/);
  const handlers = native.split("macro_rules! app_invoke_handler");
  assert.match(handlers[1], /automation_background_prepare_inputs/);
  assert.doesNotMatch(handlers[2], /automation_background_prepare_inputs/);
  assert.match(handlers[1], /fs_snapshot_binary/);
  assert.match(handlers[2], /fs_snapshot_binary/);
});

test("worker identity cache persists across reopen without using addresses or names", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "xgent-worker-id-"));
  const filename = path.join(dir, "tasks.sqlite");
  let db;
  try {
    db = new DatabaseSync(filename); db.exec(schema);
    const insert = sqlFrom(backgroundSource, "INSERT INTO automation_meta (key, value)");
    const select = sqlFrom(backgroundSource, "SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1'");
    run(db, insert, ["stable-worker"]); run(db, insert, ["stable-worker"]);
    assert.equal(db.prepare(select).get().value, "stable-worker");
    db.close(); db = new DatabaseSync(filename);
    run(db, insert, ["stable-worker"]);
    assert.equal(db.prepare(select).get().value, "stable-worker");
  } finally { db?.close(); unlinkSync(filename); rmdirSync(dir); }
});

test("peer credential commands cannot be relayed and request ownership is saved before any task transmission", () => {
  const access = source("services/local_access.rs");
  const peers = source("services/worker_peers.rs");
  assert.match(access, /command\.starts_with\("worker_peer_"\) \|\| command\.starts_with\("lan_pc_"\)/);
  const invoke = peers.split("pub async fn invoke(")[1].split("pub async fn forget(")[0];
  assert.ok(invoke.indexOf("self.bind_request") < invoke.indexOf("Self::probe_entry"));
  assert.ok(invoke.indexOf("Self::probe_entry") < invoke.indexOf("client.invoke("));
  assert.match(invoke, /This request belongs to a different worker/);
});

test("copying a task database does not authorize its unfinished work on another installation", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(schema); queue(db, "copied", "unfinished");
    const predicate = sqlFrom(backgroundSource, "state IN ('pending', 'leased', 'waiting') AND execution_id IN");
    assert.deepEqual(db.prepare(`SELECT execution_id FROM automation_cron_runs WHERE ${predicate}`).all().map((r) => r.execution_id), ["unfinished"]);
    const bind = sqlFrom(backgroundSource, "INSERT INTO automation_meta (key, value)");
    run(db, bind, ["old-installation"]); run(db, bind, ["new-installation"]);
    assert.equal(db.prepare(sqlFrom(backgroundSource, "SELECT value FROM automation_meta WHERE key = 'background_worker_id.v1'")).get().value, "new-installation");
    const vault = source("services/cloud_secret_vault.rs");
    assert.match(vault, /worker_host_identity[\s\S]*worker-host\.identity\.v1[\s\S]*stronghold\.save\(\)/);
    const native = source("lib.rs");
    assert.ok(native.indexOf(".bind_worker_identity(&identity)") < native.indexOf("match Arc::clone(&automation_scheduler).start()"));
    assert.match(native, /let worker_identity_ready = match[\s\S]*\.bind_worker_identity\(&identity\)[\s\S]*Err\(error\)[\s\S]*false/);
    assert.match(native, /if worker_identity_ready \{\s*match Arc::clone\(&automation_scheduler\)\.start\(\)/);
    assert.match(native, /match services::worker_peers::WorkerPeerRegistry::new[\s\S]*Err\(error\) => eprintln!/);
  } finally { db.close(); }
});

test("background SQL schema is additive/idempotent and enqueue rollback leaves no orphan receipt", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(schema); db.exec(schema);
    queue(db, "one", "execution");
    db.exec("BEGIN IMMEDIATE");
    assert.throws(() => queue(db, "other", "execution"), /UNIQUE/);
    db.exec("ROLLBACK");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM automation_background_tasks").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM automation_cron_runs").get().count, 1);
  } finally { db.close(); }
});

test("actual recovery/expiry predicates preserve never-started background work", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(schema);
    queue(db, "request", "background");
    db.exec("INSERT INTO automation_cron_runs (execution_id, task_id, state, started_at, lease_expires_at, request_json) VALUES ('cron', 'cron-task', 'pending', 100, 200, '{}')");
    const pendingPredicate = sqlFrom(storeSource, "state = 'pending' AND lease_expires_at IS NOT NULL");
    assert.deepEqual(run(db, `SELECT execution_id FROM automation_cron_runs WHERE ${pendingPredicate}`, [1_000], "all").map((row) => row.execution_id), ["cron"]);
    const recoveryPredicate = sqlFrom(storeSource, "state = 'leased' OR (state = 'pending'");
    assert.deepEqual(db.prepare(`SELECT execution_id FROM automation_cron_runs WHERE ${recoveryPredicate}`).all().map((row) => row.execution_id), ["cron"]);
    db.exec("UPDATE automation_cron_runs SET state = 'leased' WHERE execution_id = 'background'");
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM automation_cron_runs WHERE ${recoveryPredicate}`).get().count, 2);
  } finally { db.close(); }
});

test("actual pending selection is FIFO and bounded", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(schema);
    for (let i = 0; i < 5; i++) queue(db, `r-${i}`, `e-${i}`, i);
    const select = sqlFrom(storeSource, "SELECT request_json FROM automation_cron_runs");
    assert.equal(run(db, select, [2], "all").length, 2);
    assert.equal(run(db, select, [1], "all").length, 1);
    assert.match(select, /ORDER BY started_at ASC, execution_id ASC LIMIT \?1/);
  } finally { db.close(); }
});

test("immutable binary artifact survives database reopen and cannot be read through another task", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "xgent-background-sql-"));
  const filename = path.join(dir, "tasks.sqlite");
  let db;
  try {
    db = new DatabaseSync(filename); db.exec(schema);
    queue(db, "owner", "owner-execution"); queue(db, "other", "other-execution");
    const bytes = Buffer.from([0, 255, 17, 128]);
    const insert = sqlFrom(artifactSource, "INSERT INTO automation_background_artifacts");
    run(db, insert, ["artifact", "owner-execution", "report.pptx", "hash", bytes.length, bytes, 101]);
    assert.throws(() => run(db, insert, ["duplicate", "owner-execution", "report.pptx", "hash", bytes.length, bytes, 102]), /UNIQUE/);
    db.close(); db = new DatabaseSync(filename);
    const select = sqlFrom(artifactSource, "SELECT a.artifact_id, a.relative_path");
    const saved = run(db, select, ["owner", "artifact"], "get");
    assert.deepEqual(Buffer.from(saved.content), bytes);
    assert.equal(run(db, select, ["other", "artifact"], "get"), undefined);
  } finally { db?.close(); unlinkSync(filename); rmdirSync(dir); }
});

test("desktop execution is isolated from presentation and paired clients cannot own leases", () => {
  const native = source("lib.rs");
  const commands = source("commands/automation/cron.rs");
  const access = source("services/local_access.rs");
  const readFrontend = (name) => readFileSync(new URL(`../../src/${name}`, import.meta.url), "utf8");
  const supervisor = source("services/worker_supervisor.rs");
  assert.match(supervisor, /const LABEL: &str = "agent-worker"/);
  assert.match(supervisor, /WebviewWindowBuilder::new[\s\S]*LABEL[\s\S]*\.visible\(false\)/);
  const handlers = native.split("macro_rules! app_invoke_handler");
  assert.match(handlers[1], /automation_background_submit/);
  assert.doesNotMatch(handlers[2], /automation_background_submit/);
  assert.match(commands, /if window\.label\(\) != "agent-worker"/);
  assert.match(access, /"automation_claim_prompt_runs" \| "automation_release_prompt_run" \| "automation_complete_prompt_run"/);
  assert.match(access, /matches!\(command, "automation_background_submit" \| "automation_background_resume"\) && !config\.blocked_local_capabilities\.is_empty\(\)/);
  assert.doesNotMatch(readFrontend("App.tsx"), /startLocalAccessHostBridge/);
  assert.match(readFrontend("runtime/agentWorker.ts"), /await startLocalAccessHostBridge\(\)/);
  assert.doesNotMatch(readFrontend("main.tsx"), /import App|createRoot/);
  const capability = JSON.parse(readFileSync(new URL("../../src-tauri/capabilities/default.json", import.meta.url), "utf8"));
  assert.ok(capability.windows.includes("agent-worker"));
  const scheduler = source("services/automation/scheduler.rs");
  assert.match(scheduler, /pub fn start[\s\S]*self\.store\.recover_interrupted_prompt_runs\(\)\?[\s\S]*tauri::async_runtime::spawn/);
  assert.doesNotMatch(scheduler.split("async fn run_loop")[1], /recover_interrupted_prompt_runs/);
  assert.match(native, /match Arc::clone\(&automation_scheduler\)\.start\(\)[\s\S]*Ok\(\(\)\) =>[\s\S]*enable_execution\(\)[\s\S]*Err\(error\) =>[\s\S]*if let Err\(error\) = services::worker_supervisor::initialize/);
  assert.doesNotMatch(native.slice(native.indexOf("match Arc::clone(&automation_scheduler).start()"), native.indexOf(".on_window_event({")), /\.build\(\)\?/);
  assert.match(commands, /pub async fn automation_claim_prompt_runs[\s\S]*state\.require_instance\(worker_instance_id\.as_deref\(\)\)\?[\s\S]*claim_prompt_runs_for_worker/);
  const workerState = source("services/agent_worker.rs");
  assert.match(workerState, /if !self\.execution_enabled\(\)[\s\S]*return Err/);
  assert.match(workerState, /self\.execution_enabled\(\) && seen > 0/);
});

test("persisted completion outbox survives reopen and excludes expiry and another claim", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "xgent-completion-sql-"));
  const filename = path.join(dir, "tasks.sqlite"); let db;
  try {
    db = new DatabaseSync(filename); db.exec(schema);
    queue(db, "owner", "execution");
    const input = JSON.stringify({ executionId: "execution", success: true, output: "real conclusion", durationMs: 10 });
    run(db, sqlFrom(completionSource, "INSERT INTO automation_prompt_completion_outbox"), ["execution", input, 101]);
    const selectPending = sqlFrom(storeSource, "SELECT request_json FROM automation_cron_runs");
    assert.deepEqual(run(db, selectPending, [2], "all"), []);
    db.exec("UPDATE automation_cron_runs SET state = 'leased'");
    db.close(); db = new DatabaseSync(filename);
    const persisted = db.prepare(sqlFrom(completionSource, "SELECT input_json FROM automation_prompt_completion_outbox ORDER BY")).all();
    assert.deepEqual(JSON.parse(persisted[0].input_json), JSON.parse(input));
    const expiry = sqlFrom(storeSource, "state = 'leased' AND lease_expires_at IS NOT NULL");
    assert.deepEqual(run(db, `SELECT execution_id FROM automation_cron_runs WHERE ${expiry}`, [1000], "all"), []);
    assert.match(storeSource, /recover_interrupted_prompt_runs[\s\S]*flush_prompt_completion_outbox\(\)\?[\s\S]*expire_prompt_runs_where/);
    assert.match(dbSource, /pragma_update\(None, "synchronous", "FULL"\)/);
  } finally { db?.close(); unlinkSync(filename); rmdirSync(dir); }
});

test("actual intent/receipt SQL binds calls to tasks and survives restart", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "xgent-operation-sql-"));
  const filename = path.join(dir, "tasks.sqlite"); let db;
  try {
    db = new DatabaseSync(filename); db.exec(schema); queue(db, "owner", "execution"); queue(db, "other", "another");
    const insert = sqlFrom(journalSource, "INSERT INTO automation_background_operations");
    run(db, insert, ["execution", "call", "SendMail", '{"to":"user"}', 1, 101]);
    assert.throws(() => run(db, insert, ["execution", "call", "SendMail", "{}", 1, 102]), /UNIQUE/);
    const query = sqlFrom(journalSource, "SELECT tool_name, arguments_json, state, result_json");
    assert.equal(run(db, query, ["execution", "call"], "get").state, "started");
    const receipt = JSON.stringify({ role: "toolResult", toolCallId: "call", toolName: "SendMail", isError: false, content: [] });
    const update = sqlFrom(journalSource, "UPDATE automation_background_operations SET state = 'returned'");
    assert.equal(run(db, update, ["execution", "call", receipt, 0, 102]).changes, 1);
    assert.equal(run(db, update, ["execution", "call", "changed", 1, 103]).changes, 0);
    db.close(); db = new DatabaseSync(filename);
    assert.equal(run(db, query, ["execution", "call"], "get").result_json, receipt);
    assert.equal(run(db, query, ["another", "call"], "get"), undefined);
    const page = sqlFrom(journalSource, "SELECT sequence, call_id, tool_name, arguments_json");
    assert.equal(run(db, page, ["execution", 0, 11], "all").length, 1);
    assert.deepEqual(run(db, page, ["another", 0, 11], "all"), []);
  } finally { db?.close(); unlinkSync(filename); rmdirSync(dir); }
});

test("live action lease is revoked by staged completion and journal usage measures UTF-8 bytes", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(schema); queue(db, "owner", "execution");
    db.exec("UPDATE automation_cron_runs SET state = 'leased', lease_expires_at = 1000");
    const live = sqlFrom(journalSource, "SELECT EXISTS(SELECT 1 FROM automation_background_tasks");
    assert.equal(Object.values(run(db, live, ["execution", 101], "get"))[0], 1);
    assert.equal(Object.values(run(db, live, ["execution", 1001], "get"))[0], 0);
    const argumentsJson = JSON.stringify({ text: "中文" });
    run(db, sqlFrom(journalSource, "INSERT INTO automation_background_operations"), ["execution", "call", "Read", argumentsJson, 1, 101]);
    const usage = Object.values(run(db, sqlFrom(journalSource, "SELECT COUNT(*), COALESCE(SUM(LENGTH"), ["execution"], "get"));
    assert.deepEqual(usage, [1, Buffer.byteLength(argumentsJson)]);
    run(db, sqlFrom(completionSource, "INSERT INTO automation_prompt_completion_outbox"), ["execution", "{}", 102]);
    assert.equal(Object.values(run(db, live, ["execution", 103], "get"))[0], 0);
    const release = sqlFrom(storeSource, "UPDATE automation_cron_runs SET state = 'pending'");
    assert.equal(run(db, release, ["execution", 2000]).changes, 0);
  } finally { db.close(); }
});

test("automatic Cron age retention keeps delegated conclusions for offline clients", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(schema); queue(db, "owner", "background");
    db.exec("UPDATE automation_cron_runs SET state = 'done', output = 'Saved report'");
    db.exec("INSERT INTO automation_cron_runs (execution_id, task_id, state, started_at, output) VALUES ('cron', 'cron-task', 'done', 100, 'old cron result')");
    const retention = sqlFrom(dbSource, "DELETE FROM automation_cron_runs\n         WHERE state");
    assert.equal(run(db, retention, [1000]).changes, 1);
    assert.equal(db.prepare("SELECT output FROM automation_cron_runs WHERE execution_id = 'background'").get().output, "Saved report");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM automation_cron_runs WHERE execution_id = 'cron'").get().count, 0);
  } finally { db.close(); }
});
