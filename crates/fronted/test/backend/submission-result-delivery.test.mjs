import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// Execute real production SQL/persistence/transaction boundaries. This does
// not compile Rust or execute mobile SDKs/HTTP/configuration/physical delivery.
const read = name => readFileSync(new URL(`../../src-tauri/src/${name}`, import.meta.url), "utf8");
const source = read("services/automation/store/result_delivery.rs");
const sql = (text, prefix, contains = "") => {
  const found = [...text.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(item => item[1].trimStart().startsWith(prefix) && item[1].includes(contains));
  assert.ok(found, `${prefix} ${contains}`); return found[1];
};
const run = (db, query, values = [], mode = "run") => db.prepare(query)[mode](Object.fromEntries(values.map((value, i) => [String(i + 1), value])));
const host = randomUUID(), phone = randomUUID(), request = randomUUID();
const receipt = JSON.stringify({ requestId: request, hostId: host, run: { state: "pending" }, actual: "original-host-acceptance" });
function open(file = ":memory:") {
  const db = new DatabaseSync(file); db.exec(sql(read("services/automation/db.rs"), "CREATE TABLE IF NOT EXISTS automation_meta"));
  db.exec(read("services/automation/result_delivery.sql")); db.exec(read("services/automation/proactive.sql"));
  db.prepare("INSERT OR IGNORE INTO automation_meta VALUES('background_worker_id.v1',?)").run(phone); return db;
}
function stage(db, accepted = true) {
  db.prepare("INSERT INTO automation_result_watches(request_id,source_host_id) VALUES(?,?)").run(request, host);
  db.prepare("INSERT INTO automation_submission_outbox(request_id,initiating_host_id,source_host_id,input_json,origin_json,created_at,result_json) VALUES(?,?,?,'{}','null',1,?)").run(request, phone, host, accepted ? receipt : null);
}
const candidate = db => run(db, sql(source, "SELECT w.request_id,w.source_host_id,COALESCE", "JOIN automation_submission_outbox s"), [request], "get");
const mark = db => run(db, sql(source, "INSERT OR IGNORE INTO automation_result_delivery_admissions"), [request, host, 100]).changes;
const reserve = db => run(db, sql(source, "INSERT INTO automation_result_delivery_targets"), [request, host, 1000, 1]);
const error = db => run(db, sql(source, "UPDATE automation_submission_outbox SET last_error='OS result delivery setup pending'"), [request, 100]);
const setup = db => run(db, sql(source, "UPDATE automation_result_delivery_targets SET binding_hash"), [request, host, "exact-private-binding"]);
const ack = (db, hash = "exact-private-binding") => run(db, sql(source, "UPDATE automation_result_delivery_targets SET configured"), [request, host, hash, 300000]);
const clear = db => run(db, sql(source, "UPDATE automation_submission_outbox SET last_error=NULL"), [request, host]);

test("only the original active accepted remote submission can claim immediate result setup", t => {
  const db = open(); t.after(() => db.close()); stage(db, false); assert.equal(candidate(db), undefined);
  db.prepare("UPDATE automation_submission_outbox SET result_json=?").run(receipt); assert.equal(candidate(db).source_host_id, host);
  for (const change of ["UPDATE automation_submission_outbox SET cancel_requested=1", "UPDATE automation_submission_outbox SET initiating_host_id='copied-phone'", "UPDATE automation_submission_outbox SET source_host_id='other-host'", "UPDATE automation_result_watches SET active=0", `UPDATE automation_result_watches SET source_host_id='${phone}'; UPDATE automation_submission_outbox SET source_host_id='${phone}'`]) {
    db.exec("SAVEPOINT invalid_owner"); db.exec(change); assert.equal(candidate(db), undefined); db.exec("ROLLBACK TO invalid_owner; RELEASE invalid_owner");
  }
  for (const changed of [{ requestId: randomUUID(), hostId: host }, { requestId: request, hostId: randomUUID() }]) {
    db.prepare("UPDATE automation_submission_outbox SET result_json=?").run(JSON.stringify(changed)); assert.equal(candidate(db), undefined);
  }
  db.prepare("UPDATE automation_submission_outbox SET result_json=?").run(receipt);
  db.prepare("INSERT INTO automation_result_delivery_targets(request_id,source_host_id) VALUES(?,'replaced-host')").run(request); assert.equal(candidate(db), undefined);
});

test("first accepted setup can bypass an earlier generic failure once; repeat receipt cannot rearm the reservation", t => {
  const db = open(); t.after(() => db.close()); stage(db); reserve(db); db.exec("UPDATE automation_result_delivery_targets SET retry_at=999999,probes=5");
  assert.equal(candidate(db).configured, 0); assert.equal(mark(db), 1); reserve(db); error(db);
  const target = db.prepare("SELECT * FROM automation_result_delivery_targets").get(); assert.equal(mark(db), 0);
  assert.deepEqual(db.prepare("SELECT * FROM automation_result_delivery_targets").get(), target);
  const saved = db.prepare("SELECT result_json,last_error,cancel_requested FROM automation_submission_outbox").get();
  assert.equal(saved.result_json, receipt); assert.equal(saved.cancel_requested, 0); assert.equal(saved.last_error, "OS result delivery setup pending");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_result_delivery_admissions").get().n, 1);
  const method = source.slice(source.indexOf("fn claim_submission_result_delivery_setup"), source.indexOf("fn note_submission_result_delivery_error"));
  assert.ok(method.indexOf("if first==0") < method.indexOf('tx.execute("INSERT INTO automation_result_delivery_targets'));
  assert.match(method, /count>=128/); assert.match(method, /configured && retry>now/);
});

test("OS acknowledgement clears only this exact delivery diagnostic, leaving actual task receipt and unrelated errors intact", t => {
  const db = open(); t.after(() => db.close()); stage(db); reserve(db); mark(db); setup(db); error(db);
  assert.equal(ack(db, "foreign-binding").changes, 0); assert.equal(db.prepare("SELECT configured FROM automation_result_delivery_targets").get().configured, 0);
  db.exec("BEGIN IMMEDIATE"); assert.equal(ack(db).changes, 1); clear(db); db.exec("COMMIT");
  assert.equal(db.prepare("SELECT last_error FROM automation_submission_outbox").get().last_error, null); assert.equal(db.prepare("SELECT result_json FROM automation_submission_outbox").get().result_json, receipt);
  assert.equal(error(db).changes, 0); db.exec("UPDATE automation_submission_outbox SET last_error='Unrelated actual diagnostic'"); clear(db);
  assert.equal(db.prepare("SELECT last_error FROM automation_submission_outbox").get().last_error, "Unrelated actual diagnostic");
});

test("failed diagnostic cleanup rolls OS ACK back with its configuration, retaining original acceptance for retry", t => {
  const db = open(); t.after(() => db.close()); stage(db); reserve(db); setup(db); error(db);
  db.exec("CREATE TEMP TRIGGER fail_cleanup BEFORE UPDATE OF last_error ON automation_submission_outbox WHEN NEW.last_error IS NULL BEGIN SELECT RAISE(ABORT,'cleanup failed'); END;");
  db.exec("BEGIN IMMEDIATE"); assert.equal(ack(db).changes, 1); assert.throws(() => clear(db), /cleanup failed/); db.exec("ROLLBACK");
  assert.equal(db.prepare("SELECT configured FROM automation_result_delivery_targets").get().configured, 0);
  assert.equal(db.prepare("SELECT result_json FROM automation_submission_outbox").get().result_json, receipt);
  db.exec("DROP TRIGGER fail_cleanup; BEGIN IMMEDIATE"); ack(db); clear(db); db.exec("COMMIT");
  assert.equal(db.prepare("SELECT configured FROM automation_result_delivery_targets").get().configured, 1);
});

test("immediate reservation rollback/reopen/replay preserves the first original attempt and native setup identity", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "xgent-submission-os-")), file = path.join(dir, "config.sqlite"); let db = open(file);
  try {
    stage(db); db.exec("BEGIN IMMEDIATE"); assert.equal(mark(db), 1); reserve(db); db.exec("ROLLBACK");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_result_delivery_admissions").get().n, 0);
    db.exec("BEGIN IMMEDIATE"); mark(db); reserve(db); db.exec("COMMIT"); db.close(); db = open(file);
    assert.equal(mark(db), 0); assert.equal(db.prepare("SELECT source_host_id FROM automation_result_delivery_admissions").get().source_host_id, host);
    assert.equal(db.prepare("SELECT result_json FROM automation_submission_outbox").get().result_json, receipt);
    const second = open(file); try { assert.equal(mark(second), 0); } finally { second.close(); }
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("retiring a result watch prunes its admission marker; peer revocation still blocks a late OS ACK", t => {
  const db = open(); t.after(() => db.close()); stage(db); mark(db); reserve(db); setup(db);
  run(db, sql(source, "DELETE FROM automation_result_delivery_targets WHERE source_host_id"), [host]); assert.equal(ack(db).changes, 0);
  db.exec("UPDATE automation_result_watches SET active=0"); run(db, sql(source, "DELETE FROM automation_result_delivery_admissions"));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_result_delivery_admissions").get().n, 0); assert.equal(candidate(db), undefined);
});

test("existing-only OS setup works without the additive admission schema and a stale ACK cannot hide new failure", t => {
  const db = open(); t.after(() => db.close()); stage(db); reserve(db); setup(db); ack(db);
  db.exec("DROP TABLE automation_result_delivery_admissions; UPDATE automation_result_delivery_targets SET retry_at=50");
  const exists = () => Object.values(run(db, sql(source, "SELECT EXISTS(SELECT 1 FROM sqlite_master"), [], "get"))[0];
  assert.equal(exists(), 0); assert.equal(error(db).changes, 1);
  assert.equal(db.prepare("SELECT result_json FROM automation_submission_outbox").get().result_json, receipt);
  const candidates = run(db, sql(source, "SELECT w.request_id,w.source_host_id,COALESCE(t.probes,0) FROM automation_result_watches"), [phone, 100], "all");
  assert.equal(candidates.length, 1); assert.equal(candidates[0].request_id, request);
  db.exec(read("services/automation/result_delivery.sql")); assert.equal(exists(), 1);
});

test("actual OS configuration recovery accepts only the existing original active staged binding and can roll back", t => {
  const db = open(); t.after(() => db.close()); stage(db); reserve(db); setup(db); error(db);
  const recover = sql(source, "UPDATE automation_result_delivery_targets SET configured=1 WHERE");
  const confirm = (owner = phone, hash = "exact-private-binding", sourceHost = host) => run(db, recover, [request, sourceHost, hash, owner]);
  assert.equal(confirm(randomUUID()).changes, 0); assert.equal(confirm(phone, "not-original").changes, 0); assert.equal(confirm(phone, "exact-private-binding", randomUUID()).changes, 0);
  db.exec("UPDATE automation_result_watches SET active=0"); assert.equal(confirm().changes, 0); db.exec("UPDATE automation_result_watches SET active=1");
  db.exec("BEGIN IMMEDIATE"); assert.equal(confirm().changes, 1); clear(db); db.exec("ROLLBACK");
  assert.equal(db.prepare("SELECT configured FROM automation_result_delivery_targets").get().configured, 0);
  assert.equal(db.prepare("SELECT last_error FROM automation_submission_outbox").get().last_error, "OS result delivery setup pending");
  db.exec("BEGIN IMMEDIATE"); confirm(); clear(db); db.exec("COMMIT"); assert.equal(confirm().changes, 0);
  assert.equal(db.prepare("SELECT result_json FROM automation_submission_outbox").get().result_json, receipt);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_result_responses").get().n, 0);
  const method = source.slice(source.indexOf("fn recover_os_result_configuration"), source.indexOf("fn claim_os_result_delivery"));
  assert.match(method, /endpoints.iter\(\).any[\s\S]*expires_at/); assert.match(method, /recovered==4/);
  assert.ok(method.indexOf("stopped before commit") < method.indexOf("tx.commit()"));
  const callback = read("services/os_result_receiver.rs");
  assert.ok(callback.indexOf("if stopped()") < callback.indexOf("recover_os_result_configuration"));
  assert.ok(callback.indexOf("recover_os_result_configuration") < callback.indexOf("claim_os_result_delivery"));
});

test("submission acceptance and saved replay await the private SDK path, and failed setup never causes resubmission", () => {
  const commands = read("commands/automation/submission.rs"), receiver = read("services/result_receiver.rs");
  const deliver = commands.slice(commands.indexOf("pub(crate) async fn deliver"), commands.indexOf("pub(crate) async fn dispatch_selected"));
  assert.ok(deliver.indexOf("complete_background_submission") < deliver.indexOf("provision_submission_result"));
  assert.match(deliver, /if attempt.is_ok\(\)[\s\S]*provision_submission_result[\s\S]*attempt\s*\}/);
  const submit = commands.slice(commands.indexOf("pub async fn automation_result_submission_submit"), commands.indexOf("pub async fn automation_result_submission_list"));
  assert.match(submit, /if let Some\(result\) = pending.result[\s\S]*provision_submission_result[\s\S]*return Ok\(result\)/);
  const immediate = receiver.slice(receiver.indexOf("pub(crate) async fn provision_submission_result"), receiver.indexOf("async fn notify_pending"));
  assert.match(immediate, /os_result_setup_lock\(\).lock\(\).await/); assert.match(immediate, /claim_submission_result_delivery_setup/);
  assert.match(immediate, /result_delivery_target[\s\S]*stage_result_delivery_target[\s\S]*configure_os_target/);
  assert.doesNotMatch(immediate, /automation_background_submit|automation_background_resume|submit_background_task|target_json.*return/);
  assert.match(immediate, /note_submission_result_delivery_error/);
  const configured = receiver.slice(receiver.indexOf("async fn configure_os_target"), receiver.indexOf("async fn provision_os_results"));
  assert.match(configured, /configure_result_delivery[\s\S]*if !configured[\s\S]*acknowledge_result_delivery/);
});
