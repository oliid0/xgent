import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
const read = (name) => readFileSync(new URL(`../../src-tauri/src/${name}`, import.meta.url), "utf8");
const source = read("services/automation/store/result_continuation.rs");
const sql = (text, prefix) => { const match = [...text.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find((m) => m[1].trimStart().startsWith(prefix)); assert.ok(match, prefix); return match[1]; };
const schema = sql(read("services/automation/db.rs"), "CREATE TABLE IF NOT EXISTS automation_meta");
const run = (db, prefix, args, method = "run") => db.prepare(sql(source, prefix))[method](...args);
const stage = (db, id = "resume", wait = "occurrence", response = "实际补充信息") => run(db, "INSERT INTO automation_result_responses", [id, "entry", "original-host", "original-request", wait, response, 100]);
test("actual response outbox SQL survives reopen with exact response/owner/resume identity and unique occurrence", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "xgent-response-")), file = path.join(dir, "response.sqlite"); let db;
  try {
    db = new DatabaseSync(file); db.exec(schema); stage(db); db.close(); db = new DatabaseSync(file);
    const actual = run(db, "SELECT source_host_id, request_id, wait_id", ["occurrence"], "get");
    assert.equal(actual.source_host_id, "original-host"); assert.equal(actual.resume_id, "resume"); assert.equal(actual.response, "实际补充信息"); assert.equal(actual.result_json, null);
    assert.throws(() => stage(db, "different-id"), /UNIQUE/); assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_result_responses").get().n, 1);
  } finally { db?.close(); unlinkSync(file); rmdirSync(dir); }
});
test("actual response reservation persists bounded backoff before RPC and concurrent pollers cannot repeat the same batch", () => {
  const db = new DatabaseSync(":memory:"); try {
    db.exec(schema); for (let i = 0; i < 7; i++) stage(db, `resume-${i}`, `wait-${i}`);
    db.exec("BEGIN IMMEDIATE"); const first = run(db, "SELECT source_host_id, request_id, wait_id, resume_id, response, result_json FROM automation_result_responses WHERE result_json IS NULL", [100, null], "all"); assert.equal(first.length, 4);
    for (const row of first) run(db, "UPDATE automation_result_responses SET retry_at", [row.resume_id, 100]); db.exec("COMMIT");
    const next = run(db, "SELECT source_host_id, request_id, wait_id, resume_id, response, result_json FROM automation_result_responses WHERE result_json IS NULL", [100, null], "all"); assert.equal(next.length, 3);
    assert.equal(db.prepare("SELECT retry_at FROM automation_result_responses WHERE resume_id = ?").get(first[0].resume_id).retry_at, 60100);
    for (let i = 0; i < 40; i++) run(db, "UPDATE automation_result_responses SET retry_at", [first[0].resume_id, 100]);
    const retry = db.prepare("SELECT retry_at, probes FROM automation_result_responses WHERE resume_id = ?").get(first[0].resume_id); assert.equal(retry.retry_at, 900100); assert.equal(retry.probes, 32);
  } finally { db.close(); }
});
test("receipt persistence retains the first actual acceptance and transaction rollback keeps an unconfirmed delivery retryable", () => {
  const db = new DatabaseSync(":memory:"); try {
    db.exec(schema); stage(db); db.exec("BEGIN IMMEDIATE"); run(db, "UPDATE automation_result_responses SET result_json", ["resume", '{"actual":"first"}']); db.exec("ROLLBACK");
    assert.equal(run(db, "SELECT source_host_id, request_id, wait_id", ["occurrence"], "get").result_json, null);
    run(db, "UPDATE automation_result_responses SET result_json", ["resume", '{"actual":"first"}']); run(db, "UPDATE automation_result_responses SET result_json", ["resume", '{"actual":"later"}']);
    assert.equal(run(db, "SELECT source_host_id, request_id, wait_id", ["occurrence"], "get").result_json, '{"actual":"first"}');
    assert.equal(run(db, "SELECT source_host_id, request_id, wait_id, resume_id, response, result_json FROM automation_result_responses WHERE result_json IS NULL", [999999, null], "all").length, 0);
    assert.equal(run(db, "SELECT COALESCE(SUM(LENGTH(CAST(response AS BLOB))", [], "get")["COALESCE(SUM(LENGTH(CAST(response AS BLOB)) + COALESCE(LENGTH(CAST(result_json AS BLOB)), 0)), 0)"], Buffer.byteLength("实际补充信息") + Buffer.byteLength('{"actual":"first"}'));
  } finally { db.close(); }
});
test("delivery code uses native persisted identity and original-host resume, while reads cannot stage responses", () => {
  const commands = read("commands/automation/cron.rs"), delivery = commands.split("async fn deliver_received_response(")[1].split("pub async fn automation_result_resume(")[0];
  assert.match(delivery, /resume_background_on_host/); assert.match(delivery, /registry\.invoke\(&delivery\.source_host_id, "automation_background_resume"/); assert.match(delivery, /receive_background_result/); assert.match(delivery, /complete_received_response/);
  const current = commands.split("pub async fn automation_result_current(")[1].split("pub async fn automation_result_list(")[0]; assert.doesNotMatch(current, /stage_received_response|automation_background_submit|automation_background_resume/);
  assert.match(source, /saved\.input\.response != response/); assert.match(source, /state\.as_deref\(\) != Some\("waiting"\)/);
});
