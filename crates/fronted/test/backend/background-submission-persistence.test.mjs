import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const read = name => readFileSync(new URL(`../../src-tauri/src/${name}`, import.meta.url), "utf8");
const source = read("services/automation/store/submission.rs");
const sql = (text, start) => {
  const literal = [...text.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(m => m[1].trimStart().startsWith(start));
  assert.ok(literal, start); return literal[1];
};
const schema = sql(read("services/automation/db.rs"), "CREATE TABLE IF NOT EXISTS automation_meta") + read("services/automation/proactive.sql");
const run = (db, prefix, args = [], mode = "run") => db.prepare(sql(source, prefix))[mode](...args);
const packet = id => JSON.stringify({ requestId: id, name: "真实文档任务", prompt: "Report and website", files: [{ name: "input.txt", contentBase64: Buffer.from("actual input 中文").toString("base64") }] });
const stage = (db, id, origin = '{"conversationId":"actual"}', device = "phone") => run(db, "INSERT INTO automation_submission_outbox", [id, device, "original-worker", packet(id), origin, 100]);
const due = (db, now, device = "phone", selected = null) => run(db, "SELECT source_host_id, input_json, CASE WHEN cancel_requested = 1 THEN cancel_json ELSE result_json END, cancel_requested FROM automation_submission_outbox WHERE ((", [device, now, selected,0], "all");

test("actual submission SQL retains exact attachment bytes and conversation origin across database reopen", () => {
  const folder = mkdtempSync(path.join(tmpdir(), "xgent-submission-")), filename = path.join(folder, "tasks.db"); let db;
  try {
    db = new DatabaseSync(filename); db.exec(schema); stage(db, "request"); db.close(); db = new DatabaseSync(filename);
    const row = run(db, "SELECT initiating_host_id, source_host_id, input_json, origin_json, result_json, cancel_requested", ["request"], "get");
    assert.equal(row.input_json, packet("request")); assert.equal(row.source_host_id, "original-worker"); assert.equal(row.initiating_host_id, "phone"); assert.equal(row.origin_json, '{"conversationId":"actual"}'); assert.equal(row.result_json, null);
    assert.throws(() => stage(db, "request"), /UNIQUE/);
    assert.equal(Buffer.from(JSON.parse(row.input_json).files[0].contentBase64, "base64").toString(), "actual input 中文");
  } finally { db?.close(); rmSync(folder, { recursive: true }); }
});

test("actual claim SQL persists fair bounded backoff and excludes copied installation records", () => {
  const db = new DatabaseSync(":memory:"); try {
    db.exec(schema); for (let i = 0; i < 7; i++) stage(db, `request-${i}`); stage(db, "foreign", "null", "other-phone");
    db.exec("BEGIN IMMEDIATE"); const first = due(db, 100); assert.equal(first.length, 4);
    for (const row of first) run(db, "UPDATE automation_submission_outbox SET retry_at", [JSON.parse(row.input_json).requestId, 100]); db.exec("COMMIT");
    assert.equal(due(db, 100).length, 3); assert.equal(due(db, 100, "copied-installation").length, 0);
    assert.equal(due(db, 60100).length, 4);
    for (let i = 0; i < 40; i++) run(db, "UPDATE automation_submission_outbox SET retry_at", ["request-0", 100]);
    const row = db.prepare("SELECT retry_at, probes FROM automation_submission_outbox WHERE request_id = ?").get("request-0"); assert.equal(row.retry_at, 900100); assert.equal(row.probes, 32);
  } finally { db.close(); }
});

test("cancellation atomically stops submission, survives late acceptance, and awaits an actual terminal receipt", () => {
  const db = new DatabaseSync(":memory:"); try {
    db.exec(schema); stage(db, "request"); run(db, "UPDATE automation_submission_outbox SET retry_at", ["request", 100]);
    run(db, "UPDATE automation_submission_outbox SET cancel_requested", ["request"]);
    run(db, "UPDATE automation_submission_outbox SET result_json", ["request", '{"state":"pending"}']);
    let row = due(db, 100)[0]; assert.equal(row.cancel_requested, 1); assert.equal(row["CASE WHEN cancel_requested = 1 THEN cancel_json ELSE result_json END"], null);
    run(db, "UPDATE automation_submission_outbox SET retry_at", ["request", 100]);
    run(db, "UPDATE automation_submission_outbox SET cancel_requested", ["request"]); assert.equal(due(db, 100).length, 0); // repeated cancel cannot reset backoff
    assert.equal(due(db, 60100).length, 0); // second reservation uses 120 seconds, even when switching to cancellation
    db.exec("BEGIN IMMEDIATE"); run(db, "UPDATE automation_submission_outbox SET cancel_json", ["request", '{"state":"expired"}']); db.exec("ROLLBACK"); assert.equal(due(db, 120100).length, 1);
    run(db, "UPDATE automation_submission_outbox SET cancel_json", ["request", '{"state":"expired"}']); run(db, "UPDATE automation_submission_outbox SET cancel_json", ["request", '{"state":"invented"}']);
    assert.equal(due(db, 999999).length, 0);
    assert.equal(db.prepare("SELECT cancel_json FROM automation_submission_outbox").get().cancel_json, '{"state":"expired"}');
  } finally { db.close(); }
});

test("submission list pagination returns bounded metadata and UTF-8 quotas include context and both receipts", () => {
  const db = new DatabaseSync(":memory:"); try {
    db.exec(schema); stage(db, "one", '"上下文"'); stage(db, "two");
    run(db, "UPDATE automation_submission_outbox SET result_json", ["one", '"接受"']); run(db, "UPDATE automation_submission_outbox SET cancel_json", ["one", '"终态"']);
    const page = run(db, "SELECT sequence, request_id, source_host_id, json_extract", [0, 1], "all"); assert.equal(page[0].request_id, "two"); assert.equal(page[0].input_json, undefined);
    assert.equal(run(db, "SELECT sequence, request_id, source_host_id, json_extract", [page[0].sequence, 1], "get").request_id, "one");
    const quota = run(db, "SELECT COUNT(*), COALESCE(SUM(LENGTH(CAST(input_json AS BLOB))", [], "get");
    const bytes = Object.values(quota)[1]; assert.equal(bytes, Buffer.byteLength(packet("one") + packet("two") + '"上下文"' + '{"conversationId":"actual"}' + '"接受"' + '"终态"'));
  } finally { db.close(); }
});

test("native submission commands stage before delivery, fence worker delegation and expose no attachment bytes in state", () => {
  const command = read("commands/automation/submission.rs"), lib = read("lib.rs");
  const submit = command.split("pub async fn automation_result_submission_submit(")[1].split("pub async fn automation_result_submission_list(")[0];
  assert.ok(submit.indexOf("stage_background_submission") < submit.indexOf("dispatch_selected"));
  assert.match(submit, /window\.label\(\) == "agent-worker" \|\| input\.delegation\.is_some\(\)/);
  assert.match(command, /current\.cancel_requested != pending\.cancel_requested/);
  assert.match(command, /receive_background_result[\s\S]*complete_background_submission/);
  for (const name of ["submit", "list", "state", "current", "cancel"]) assert.equal(lib.split(`commands::submission::automation_result_submission_${name},`).length - 1, 2);
  assert.match(read("services/local_access.rs"), /command\.starts_with\("automation_result_"\)/);
  assert.match(source, /saved\.0 != initiating \|\| saved\.1 != source \|\| saved\.2 != raw \|\| saved\.3 != origin_raw/);
  assert.match(source, /Submission belongs to a different installation/);
  assert.match(read("commands/automation/cron.rs"), /claim_background_submissions\(None\)[\s\S]*submission::deliver/);
  const state = command.split("pub async fn automation_result_submission_state(")[1].split("pub async fn automation_result_submission_cancel(")[0];
  assert.doesNotMatch(state, /content_base64|"input"|"origin"/);
});
