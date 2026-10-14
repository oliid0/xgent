import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

// Execute actual embedded native SQL, plus the actual TypeScript checkpoint
// reader. Native Rust orchestration/network calls are not executed here.
const read = file => readFileSync(new URL(`../../src-tauri/src/${file}`, import.meta.url), "utf8");
const schema = read("services/automation/db.rs"), recovery = read("services/automation/store/cloud_recovery.rs");
const launch = read("services/automation/store/cloud_launch.rs"), journal = read("services/automation/store/journal.rs");
const background = read("services/automation/store/background.rs"), lease = read("services/automation/store/lease.rs");
const native = read("commands/automation/cloud_recovery.rs");
const { restoreBackgroundContext } = createTsModuleLoader().loadModule("src/lib/automation/backgroundResume.ts");
const sql = (text, prefix) => {
  const found = [...text.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(match => match[1].trimStart().startsWith(prefix));
  assert.ok(found, `Actual SQL missing: ${prefix}`); return found[1];
};
const prompt = "Generate slides and arrange tomorrow";
const argumentsJson = '{"action":"start","runner":"ubuntu-latest","script":"actual work"}';
const context = { systemPrompt: "Original instructions", messages: [{ role: "user", content: prompt, timestamp: 1 },
  { role: "assistant", stopReason: "toolUse", timestamp: 2, content: [{ type: "toolCall", id: "cloud-call", name: "CloudTaskManager", arguments: JSON.parse(argumentsJson) }] }] };
function fixture(db, id = "original") {
  db.prepare(sql(background, "INSERT INTO automation_background_tasks")).run(`request-${id}`, id, "{}", 100);
  db.prepare(sql(background, "INSERT INTO automation_cron_runs")).run(id, 100, 200, JSON.stringify({ executionId: id, taskId: id }));
  db.prepare("UPDATE automation_cron_runs SET state = 'leased' WHERE execution_id = ?").run(id);
  db.prepare(sql(background, "INSERT INTO automation_background_configuration_bindings")).run(id, "accepted-binding");
  db.prepare(sql(lease, "INSERT INTO automation_background_leases")).run(id, 1, 1, "original-token");
  db.prepare(sql(journal, "INSERT INTO automation_background_checkpoints")).run(id, 1, JSON.stringify(context), 100);
  db.prepare(sql(journal, "INSERT INTO automation_background_operations")).run(id, "cloud-call", "CloudTaskManager", argumentsJson, 1, 100);
  db.prepare(sql(journal, "INSERT INTO automation_background_operation_leases")).run(id, "cloud-call", 1, 1, "original-token");
  db.prepare(sql(launch, "INSERT INTO automation_background_cloud_launches")).run(id, "cloud-call", `task-${id}`, createHash("sha256").update(argumentsJson).digest("hex"), "owner", "agent-temp", "ubuntu-latest", 100);
}
const candidates = sql(recovery, "SELECT r.execution_id,r.request_json");
function park(db, id = "original") {
  db.prepare(sql(recovery, "INSERT INTO automation_background_waits")).run(`wait-${id}`, id, '{"kind":"native_cloud_launch_recovery"}', 101);
  db.prepare(sql(recovery, "INSERT INTO automation_background_cloud_recoveries")).run(id, "cloud-call", `wait-${id}`, 101);
  db.prepare(sql(recovery, "UPDATE automation_background_cloud_recoveries SET last_error = (SELECT error")).run(id, `wait-${id}`, "cloud-call");
  db.prepare(sql(recovery, "UPDATE automation_background_leases SET generation")).run(id, 2, "revoked-token");
  db.prepare(sql(recovery, "UPDATE automation_cron_runs SET state = 'waiting'")).run(id, JSON.stringify({ executionId: id, taskId: id }), "Unknown cloud start; query only");
}

function freezeCloudError(db, id = "original", patch = {}) {
  const failed = { role: "toolResult", toolCallId: "cloud-call", toolName: "CloudTaskManager", isError: true,
    timestamp: 102, content: [{ type: "text", text: "Original dispatch response was lost" }], details: { outcomeUncertain: true }, ...patch };
  db.prepare(sql(journal, "UPDATE automation_background_operations SET state = 'returned', result_json = ?3, is_error = ?4"))
    .run(id, "cloud-call", JSON.stringify(failed), 1, 102);
  return failed;
}

test("actual startup SQL retains a frozen uncertain original cloud error, but rejects unrelated errors and malformed receipt authority", () => {
  const db = new DatabaseSync(":memory:"); try {
    db.exec(sql(schema, "CREATE TABLE IF NOT EXISTS automation_meta"));
    for (const id of ["late", "cancelled-late", "unmarked", "wrong-call", "wrong-tool", "number-error", "other-effect", "completed-late"]) {
      fixture(db, id); freezeCloudError(db, id, id === "unmarked" ? { details: {} } : id === "wrong-call" ? { toolCallId: "another" } : id === "wrong-tool" ? { toolName: "SendMail" } : id === "number-error" ? { isError: 1 } : {});
    }
    db.exec("UPDATE automation_cron_runs SET state = 'expired' WHERE execution_id = 'cancelled-late'; UPDATE automation_cron_runs SET state = 'done' WHERE execution_id = 'completed-late'");
    db.prepare(sql(journal, "INSERT INTO automation_background_operations")).run("other-effect", "mail-call", "SendMail", "{}", 1, 102);
    assert.deepEqual(db.prepare(candidates).all(null).map(row => row.execution_id), ["late"]);
    assert.deepEqual(db.prepare(candidates).all(150), []);
    assert.deepEqual(db.prepare(candidates).all(201).map(row => row.execution_id), ["late"]);
    park(db, "late");
    assert.equal(db.prepare("SELECT is_error FROM automation_background_operations WHERE execution_id = 'late'").get().is_error, 1);
    assert.equal(db.prepare("SELECT token FROM automation_background_operation_leases WHERE execution_id = 'late'").get().token, "original-token");
  } finally { db.close(); }
});

test("actual native proof SQL preserves the frozen receipt and admits only the same reservation with a positive GET run id", () => {
  const db = new DatabaseSync(":memory:"); try {
    db.exec(sql(schema, "CREATE TABLE IF NOT EXISTS automation_meta")); fixture(db); const failed = freezeCloudError(db); park(db);
    const proof = db.prepare(sql(launch, "SELECT c.result_json FROM automation_background_cloud_launches c"));
    const hash = createHash("sha256").update(argumentsJson).digest("hex");
    const observed = { role: "toolResult", toolCallId: "cloud-call", toolName: "CloudTaskManager", isError: false,
      timestamp: 103, content: [{ type: "text", text: "Native GET found the original run" }], details: {
        kind: "cloud_task_manager", action: "start", taskId: "task-original", owner: "owner", repository: "agent-temp", runner: "ubuntu-latest",
        observedRunId: 42, reconcilesFailedReceipt: true } };
    const storeObservation = receipt => db.prepare(sql(launch, "UPDATE automation_background_cloud_launches SET result_json"))
      .run("original", "cloud-call", JSON.stringify(receipt));
    assert.equal(proof.get("original", "cloud-call", hash), undefined);
    for (const patch of [{ observedRunId: null }, { observedRunId: 0 }, { observedRunId: "42" }, { observedRunId: 1.5 },
      { taskId: "task-other" }, { owner: "other" }, { repository: "other" }, { runner: "macos-latest" }, { reconcilesFailedReceipt: false }, { outcomeUncertain: true }, { receiptTruncated: true }]) {
      db.exec("BEGIN IMMEDIATE"); storeObservation({ ...observed, details: { ...observed.details, ...patch } });
      assert.equal(proof.get("original", "cloud-call", hash), undefined); db.exec("ROLLBACK");
    }
    for (const patch of [{ role: "user" }, { toolCallId: "another-call" }, { toolName: "SendMail" }, { isError: true }]) {
      db.exec("BEGIN IMMEDIATE"); storeObservation({ ...observed, ...patch });
      assert.equal(proof.get("original", "cloud-call", hash), undefined); db.exec("ROLLBACK");
    }
    const close = db.prepare(sql(launch, "UPDATE automation_background_operations SET state = 'returned'"));
    assert.equal(close.run("original", "cloud-call", JSON.stringify(observed), 103).changes, 0);
    db.exec("BEGIN IMMEDIATE"); storeObservation(observed);
    assert.deepEqual(JSON.parse(proof.get("original", "cloud-call", hash).result_json), observed);
    db.exec("ROLLBACK"); assert.equal(proof.get("original", "cloud-call", hash), undefined);
    db.exec("BEGIN IMMEDIATE"); storeObservation(observed);
    db.prepare(sql(recovery, "INSERT INTO automation_background_resumptions")).run("late-resume", "original", "wait-original", "{}", 103);
    db.prepare(sql(recovery, "UPDATE automation_cron_runs SET state = 'pending'")).run("original");
    db.prepare(sql(recovery, "DELETE FROM automation_background_cloud_recoveries")).run("original", "wait-original"); db.exec("COMMIT");
    assert.equal(proof.get("other-task", "cloud-call", hash), undefined);
    assert.equal(proof.get("original", "other-call", hash), undefined);
    assert.equal(proof.get("original", "cloud-call", "changed-hash"), undefined);
    const old = db.prepare("SELECT result_json,is_error FROM automation_background_operations").get();
    assert.deepEqual(JSON.parse(old.result_json), failed); assert.equal(old.is_error, 1);
    assert.equal(storeObservation({ ...observed, timestamp: 999 }).changes, 0);
    const saved = db.prepare("SELECT context_json FROM automation_background_checkpoints").get(); assert.equal(saved.context_json, JSON.stringify(context));
    const restored = restoreBackgroundContext({ revision: 1, context: JSON.parse(saved.context_json) }, prompt, []);
    const actual = JSON.parse(proof.get("original", "cloud-call", hash).result_json); restored.context.messages.push(actual);
    assert.equal(restoreBackgroundContext({ revision: 2, context: restored.context }, prompt, []).pendingCalls.length, 0);
    assert.equal(db.prepare("SELECT state FROM automation_cron_runs").get().state, "pending");
  } finally { db.close(); }
});

test("actual recovery SQL parks only original reserved cloud starts; other unknown writes and terminal work remain excluded", () => {
  const db = new DatabaseSync(":memory:"); try {
    db.exec(sql(schema, "CREATE TABLE IF NOT EXISTS automation_meta"));
    for (const id of ["original", "cancelled", "unreserved", "other-write", "failed-write", "read-error", "new-lease", "unbound", "no-context"]) fixture(db, id);
    db.exec("UPDATE automation_cron_runs SET state = 'expired' WHERE execution_id = 'cancelled'; DELETE FROM automation_background_cloud_launches WHERE execution_id = 'unreserved'; UPDATE automation_background_leases SET token = 'new' WHERE execution_id = 'new-lease'; DELETE FROM automation_background_configuration_bindings WHERE execution_id = 'unbound'; DELETE FROM automation_background_checkpoints WHERE execution_id = 'no-context'");
    const insert = db.prepare(sql(journal, "INSERT INTO automation_background_operations"));
    insert.run("other-write", "mail-call", "SendMail", "{}", 1, 101);
    for (const id of ["failed-write", "read-error"]) {
      insert.run(id, "earlier", "Earlier", "{}", 1, 101);
      db.prepare("UPDATE automation_background_operations SET state = 'returned',is_error = 1,result_json = ? WHERE execution_id = ? AND call_id = 'earlier'").run(JSON.stringify({ details: { outcomeUncertain: id === "failed-write" } }), id);
    }
    assert.deepEqual(db.prepare(candidates).all(null).map(row => row.execution_id).sort(), ["original", "read-error"]);
    assert.deepEqual(db.prepare(candidates).all(150), []);
    assert.deepEqual(db.prepare(candidates).all(201).map(row => row.execution_id).sort(), ["original", "read-error"]);
    db.exec("BEGIN IMMEDIATE"); park(db); db.exec("ROLLBACK"); assert.equal(db.prepare("SELECT state FROM automation_cron_runs WHERE execution_id = 'original'").get().state, "leased");
    db.exec("BEGIN IMMEDIATE"); park(db); db.exec("COMMIT");
    assert.equal(db.prepare("SELECT state FROM automation_cron_runs WHERE execution_id = 'original'").get().state, "waiting");
    assert.equal(db.prepare("SELECT token FROM automation_background_leases WHERE execution_id = 'original'").get().token, "revoked-token");
    assert.equal(db.prepare("SELECT token FROM automation_background_operation_leases WHERE execution_id = 'original'").get().token, "original-token");
    assert.equal(db.prepare(candidates).all(null).some(row => row.execution_id === "original"), false);
  } finally { db.close(); }
});

test("actual persisted recovery SQL survives reopen and bounded backoff gates observations without dropping unknown jobs", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "xgent-cloud-recovery-")), file = path.join(dir, "recovery.sqlite"); let db;
  try {
    db = new DatabaseSync(file); db.exec(sql(schema, "CREATE TABLE IF NOT EXISTS automation_meta"));
    for (let index = 0; index < 6; index++) { const id = `original-${index}`; fixture(db, id); park(db, id); }
    db.close(); db = new DatabaseSync(file);
    const due = db.prepare(sql(recovery, "SELECT c.execution_id,c.wait_id,c.call_id,c.probes")); assert.equal(due.all(102).length, 4);
    db.prepare(sql(recovery, "UPDATE automation_background_cloud_recoveries SET retry_at")).run("original-0", "wait-original-0", 1000, 1);
    db.prepare(sql(recovery, "UPDATE automation_background_waits SET retry_at")).run("wait-original-0", 1000, 1);
    assert.equal(due.all(102).some(row => row.execution_id === "original-0"), false);
    // The parking initializer also updates last_error. Select the actual
    // observation statement, whose occurrence and waiting-state fences matter.
    const diagnostic = db.prepare(sql(recovery, "UPDATE automation_background_cloud_recoveries SET last_error = ?3"));
    diagnostic.run("original-0", "wait-original-0", "Run is not visible; outcome remains unknown");
    assert.equal(db.prepare("SELECT last_error FROM automation_background_cloud_recoveries WHERE execution_id = 'original-0'").get().last_error, "Run is not visible; outcome remains unknown");
    assert.equal(diagnostic.run("original-0", "wrong-occurrence", "replacement").changes, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM automation_background_cloud_launches WHERE result_json IS NULL").get().count, 6);
    db.exec("UPDATE automation_cron_runs SET state = 'expired' WHERE execution_id = 'original-1'");
    assert.equal(diagnostic.run("original-1", "wait-original-1", "late observation").changes, 0);
    assert.equal(db.prepare("SELECT last_error FROM automation_background_cloud_recoveries WHERE execution_id = 'original-1'").get().last_error, null);
    assert.equal(due.all(2000).some(row => row.execution_id === "original-1"), false);
  } finally { db?.close(); unlinkSync(file); rmdirSync(dir); }
});

test("actual ACK and wake SQL roll back together; unchanged model tail consumes the stored receipt without another dispatch", () => {
  const db = new DatabaseSync(":memory:"); try {
    db.exec(sql(schema, "CREATE TABLE IF NOT EXISTS automation_meta")); fixture(db); park(db);
    const receipt = { role: "toolResult", toolCallId: "cloud-call", toolName: "CloudTaskManager", isError: false, timestamp: 103, content: [{ type: "text", text: "Actual native receipt" }], details: { kind: "cloud_task_manager", action: "start", taskId: "task-original" } };
    const raw = JSON.stringify(receipt), close = db.prepare(sql(launch, "UPDATE automation_background_operations SET state = 'returned'"));
    const wake = () => {
      close.run("original", "cloud-call", raw, 103);
      db.prepare(sql(launch, "UPDATE automation_background_cloud_launches SET result_json")).run("original", "cloud-call", raw);
      db.prepare(sql(recovery, "INSERT INTO automation_background_resumptions")).run("native-resume", "original", "wait-original", "{}", 103);
      db.prepare(sql(recovery, "UPDATE automation_cron_runs SET state = 'pending'")).run("original");
      db.prepare(sql(recovery, "DELETE FROM automation_background_cloud_recoveries")).run("original", "wait-original");
    };
    db.exec("BEGIN IMMEDIATE"); wake(); db.exec("ROLLBACK");
    assert.equal(db.prepare("SELECT state FROM automation_cron_runs").get().state, "waiting"); assert.equal(db.prepare("SELECT result_json FROM automation_background_operations").get().result_json, null);
    db.exec("BEGIN IMMEDIATE"); wake(); db.exec("COMMIT");
    assert.equal(db.prepare("SELECT state FROM automation_cron_runs").get().state, "pending"); assert.equal(close.run("original", "cloud-call", "replacement", 104).changes, 0);
    const saved = db.prepare("SELECT revision,context_json FROM automation_background_checkpoints").get(); assert.equal(saved.context_json, JSON.stringify(context));
    const restored = restoreBackgroundContext({ revision: saved.revision, context: JSON.parse(saved.context_json) }, prompt, []);
    assert.equal(restored.pendingCalls.length, 1); assert.equal(restored.pendingCalls[0].id, receipt.toolCallId);
    const actual = JSON.parse(db.prepare(sql(journal, "SELECT tool_name, arguments_json, state, result_json")).get("original", "cloud-call").result_json);
    assert.deepEqual(actual, receipt); restored.context.messages.push(actual);
    assert.equal(restoreBackgroundContext({ revision: saved.revision + 1, context: restored.context }, prompt, []).pendingCalls.length, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM automation_background_resumptions").get().count, 1);
  } finally { db.close(); }
});

test("native diagnostic SQL binds the original intent and preserves the first actual error across parking and observation", () => {
  const db = new DatabaseSync(":memory:"); try {
    db.exec(sql(schema, "CREATE TABLE IF NOT EXISTS automation_meta")); fixture(db);
    const save = db.prepare(sql(recovery, "INSERT OR IGNORE INTO automation_background_cloud_launch_failures"));
    assert.equal(save.run("original", "cloud-call", 1, 1, "replacement-token", "forged", 100).changes, 0);
    assert.equal(save.run("original", "other-call", 1, 1, "original-token", "forged", 100).changes, 0);
    assert.equal(save.run("original", "cloud-call", 1, 1, "original-token", "Actual response lost", 100).changes, 1);
    assert.equal(save.run("original", "cloud-call", 1, 1, "original-token", "replacement error", 101).changes, 0);
    db.exec("BEGIN IMMEDIATE"); park(db); db.exec("COMMIT");
    const project = db.prepare(sql(recovery, "SELECT c.call_id,l.task_id,c.wait_id"));
    let row = project.get("original");
    assert.equal(row.error, "Actual response lost"); assert.equal(row.last_error, row.error); assert.equal(row.task_id, "task-original"); assert.equal(row.probes, 0);
    db.prepare(sql(recovery, "UPDATE automation_background_cloud_recoveries SET last_error = ?3")).run("original", "wait-original", "Actual GET still cannot see the run");
    row = project.get("original"); assert.equal(row.error, "Actual response lost"); assert.equal(row.last_error, "Actual GET still cannot see the run");
    assert.equal(db.prepare("SELECT state,result_json FROM automation_background_operations").get().state, "started");
    assert.equal(db.prepare("SELECT result_json FROM automation_background_operations").get().result_json, null);
    db.exec("UPDATE automation_cron_runs SET state = 'expired' WHERE execution_id = 'original'");
    assert.equal(project.get("original"), undefined, "Cancelled jobs cannot be projected as active recovery");
    assert.equal(db.prepare("SELECT error FROM automation_background_cloud_launch_failures").get().error, "Actual response lost");
  } finally { db.close(); }
});

test("native source contracts keep collector GET-only and recheck original waiting/configuration before actual ACK", () => {
  assert.match(native, /window.label\(\)!="agent-worker"/); assert.match(native, /recover_task_start/); assert.doesNotMatch(native, /start_task_with_id|dispatch_workflow|Method::POST/);
  assert.match(native, /prepare_waiting_background_cloud_launch/); assert.match(native, /acknowledge_waiting_background_cloud_launch/);
  assert.ok(native.indexOf("due_background_cloud_launch_recoveries") < native.indexOf("for (id,wait,call)"));
  assert.match(recovery, /verify_background_binding/); assert.match(recovery, /recovery_lease\(&tx,id,wait,call\)/);
  assert.match(recovery, /prepare_cloud_launch_on_connection\(&tx,id,call,&lease,false,settings\)/);
  assert.doesNotMatch(recovery, /resume_wait_on_connection|UPDATE automation_background_checkpoints/);
});
