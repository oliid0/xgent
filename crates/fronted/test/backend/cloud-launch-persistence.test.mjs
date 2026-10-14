import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const read = (file) => readFileSync(new URL(`../../src-tauri/src/${file}`, import.meta.url), "utf8");
const schemaSource = read("services/automation/db.rs");
const launch = read("services/automation/store/cloud_launch.rs");
const handler = read("commands/automation/cloud_launch.rs");
const service = read("services/cloud_execution.rs");
const journal = read("services/automation/store/journal.rs");
function sql(text, prefix) {
  const literal = [...text.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find((match) => match[1].trimStart().startsWith(prefix));
  assert.ok(literal, `Actual SQL missing: ${prefix}`);
  return literal[1];
}

test("actual native reservation SQL survives reopen and prevents duplicate or cross-execution task ids", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "xgent-cloud-launch-"));
  const file = path.join(dir, "launch.sqlite");
  let db;
  try {
    db = new DatabaseSync(file); db.exec(sql(schemaSource, "CREATE TABLE IF NOT EXISTS automation_meta"));
    const reserve = db.prepare(sql(launch, "INSERT INTO automation_background_cloud_launches"));
    reserve.run("original", "call", "task-actual", "original-hash", "original-owner", "agent-temp", "ubuntu-latest", 100);
    assert.throws(() => reserve.run("original", "call", "task-new", "new-hash", "other", "other", "macos-latest", 101), /UNIQUE/);
    assert.throws(() => reserve.run("other", "call", "task-actual", "new-hash", "other", "other", "macos-latest", 101), /UNIQUE/);
    db.close(); db = new DatabaseSync(file); db.exec(sql(schemaSource, "CREATE TABLE IF NOT EXISTS automation_meta"));
    const read = db.prepare(sql(launch, "SELECT task_id,arguments_hash"));
    assert.equal(read.get("original", "call").task_id, "task-actual");
    assert.equal(read.get("original", "call").arguments_hash, "original-hash");
    assert.equal(read.get("other", "call"), undefined);
  } finally { db?.close(); unlinkSync(file); rmdirSync(dir); }
});

test("actual native ACK SQL and launch receipt commit atomically; original operation lease cannot be replaced", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(sql(schemaSource, "CREATE TABLE IF NOT EXISTS automation_meta"));
    db.prepare(sql(journal, "INSERT INTO automation_background_operations")).run("original", "call", "CloudTaskManager", '{"action":"start"}', 1, 100);
    db.prepare(sql(journal, "INSERT INTO automation_background_operation_leases")).run("original", "call", 1, 2, "original-token");
    db.prepare(sql(launch, "INSERT INTO automation_background_cloud_launches")).run("original", "call", "task-actual", "hash", "owner", "agent-temp", "ubuntu-latest", 100);
    const owns = db.prepare(sql(launch, "SELECT EXISTS(SELECT 1 FROM automation_background_operation_leases"));
    assert.equal(Object.values(owns.get("original", "call", 1, 2, "original-token"))[0], 1);
    for (const args of [["other", "call", 1, 2, "original-token"], ["original", "call", 2, 3, "new-token"], ["original", "other", 1, 2, "original-token"]]) assert.equal(Object.values(owns.get(...args))[0], 0);
    const close = db.prepare(sql(launch, "UPDATE automation_background_operations SET state = 'returned'"));
    const ack = db.prepare(sql(launch, "UPDATE automation_background_cloud_launches SET result_json"));
    const native = '{"role":"toolResult","toolCallId":"call","toolName":"CloudTaskManager","isError":false,"details":{"action":"start","taskId":"task-actual"}}';
    db.exec("BEGIN IMMEDIATE"); close.run("original", "call", native, 101); ack.run("original", "call", native); db.exec("ROLLBACK");
    assert.equal(db.prepare("SELECT state FROM automation_background_operations").get().state, "started");
    assert.equal(db.prepare(sql(launch, "SELECT task_id,arguments_hash")).get("original", "call").result_json, null);
    db.exec("BEGIN IMMEDIATE"); assert.equal(close.run("original", "call", native, 101).changes, 1); ack.run("original", "call", native); db.exec("COMMIT");
    assert.equal(close.run("original", "call", "invented replacement", 102).changes, 0);
    assert.equal(db.prepare("SELECT result_json FROM automation_background_operations").get().result_json, native);
    assert.equal(db.prepare(sql(launch, "SELECT task_id,arguments_hash")).get("original", "call").result_json, native);
  } finally { db.close(); }
});

test("native source admission contracts reserve once and derive inputs from owned journal/configuration", () => {
  assert.match(launch, /verify_background_configuration\(&tx,id,Some\(lease\),load\)/);
  assert.match(launch, /arguments\["action"\]!="start"/);
  assert.match(launch, /arguments\.get\("owner"\)\.is_some\(\)/);
  assert.match(launch, /input\.owner=settings\["access"\]\["githubOwner"\]/);
  assert.match(launch, /input\.repository=crate::services::cloud_execution::normalize_repository_name/);
  assert.match(launch, /if policy!="allow"/);
  assert.match(launch, /if original!=hash/);
  assert.match(launch, /\(task,false,receipt/);
  assert.match(launch, /if !reserve \|\| state!="started"/);
  assert.match(handler, /window\.label\(\)!="agent-worker"/);
  assert.match(handler, /start_task_with_id\(&token,launch\.input,&launch\.task_id\)/);
  assert.ok(handler.indexOf("prepare(&app,&store,&execution_id,&call_id,&lease,true)") < handler.indexOf("start_task_with_id"));
});

test("native source recovery contracts use positive actual run observation without dispatch or caller status", () => {
  const recover = handler.slice(handler.indexOf("async fn recover("), handler.indexOf("pub async fn automation_background_cloud_start"));
  assert.doesNotMatch(recover, /start_task_with_id|dispatch_workflow/);
  assert.match(recover, /prepare\(app,&store,&id,&call,&lease,false\)/);
  assert.match(recover, /recover_task_start\(&token,&locator/);
  assert.match(recover, /let Some\(result\)=result else \{return Ok\(None\);\}/);
  const serviceRecovery = service.slice(service.indexOf("async fn recover_task_start"), service.indexOf("pub async fn task_status"));
  assert.match(serviceRecovery, /status\.run_id\.is_none_or\(\|id\| id == 0\)/);
  assert.doesNotMatch(serviceRecovery, /dispatch_workflow|Method::POST/);
});
