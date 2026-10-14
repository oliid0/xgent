import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Worker } from "node:worker_threads";

const read = name => readFileSync(new URL(`../../src-tauri/src/services/automation/${name}`, import.meta.url), "utf8");
const source = read("store/budget.rs");
const sql = prefix => {
  const match = [...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(item => item[1].trimStart().startsWith(prefix));
  assert.ok(match, prefix); return match[1];
};
const initialize = sql("INSERT INTO automation_background_budgets (execution_id, max_model_requests, max_tool_calls) VALUES (?1, ?2, ?3)");
const grant = sql("INSERT INTO automation_background_budget_grants");
const model = sql("UPDATE automation_background_budgets SET model_requests");
const tool = sql("UPDATE automation_background_budgets SET tool_calls");
const snapshot = sql("SELECT model_requests");
const childrenSource = read("store/children.rs");
const childInsert = [...childrenSource.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(item => item[1].startsWith("INSERT INTO automation_background_children"))[1];
const childSchema = read("db.rs").match(/CREATE TABLE IF NOT EXISTS automation_background_children \([\s\S]*?\);/)[0];
function open(file = ":memory:", limits = [128, 256]) {
  const db = new DatabaseSync(file); db.exec("PRAGMA busy_timeout=5000"); db.exec(read("budget.sql")); db.exec(childSchema);
  if (!db.prepare(snapshot).get("execution")) db.prepare(initialize).run("execution", ...limits);
  return db;
}
function reserve(db, call, requests, tools, peer = "pc") {
  db.exec("BEGIN IMMEDIATE");
  try {
    const changed = db.prepare(grant).run("execution", call, `request-${call}`, peer, requests, tools).changes;
    if (changed !== 1) throw new Error("no remaining parent slots");
    db.prepare(childInsert).run("execution", call, `request-${call}`, peer, "original-host", JSON.stringify({ budget: [requests, tools] }), 1);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
const spend = (db, kind) => db.prepare(kind === "model" ? model : tool).run("execution").changes;
function spendRemaining(db, kind) { let count = 0; while (spend(db, kind)) count++; return count; }

test("root, two PCs and a grandchild spend only partitions of the original model/tool ceilings", () => {
  const root = open(), a = open(":memory:", [40, 80]), b = open(":memory:", [30, 60]), grandchild = open(":memory:", [10, 20]);
  try {
    assert.equal(spend(root, "model"), 1); assert.equal(spend(root, "tool"), 1);
    reserve(root, "a", 40, 80, "pc-a"); reserve(root, "b", 30, 60, "pc-b");
    reserve(a, "grandchild", 10, 20, "pc-c");
    const usage = db => [spendRemaining(db, "model"), spendRemaining(db, "tool")];
    const counts = [usage(root), usage(a), usage(b), usage(grandchild)];
    assert.deepEqual(counts, [[57, 115], [30, 60], [30, 60], [10, 20]]);
    assert.equal(1 + counts.reduce((sum, pair) => sum + pair[0], 0), 128);
    assert.equal(1 + counts.reduce((sum, pair) => sum + pair[1], 0), 256);
    assert.throws(() => reserve(root, "overspend", 1, 1), /remaining/);
    assert.equal(root.prepare("SELECT COUNT(*) AS n FROM automation_background_children").get().n, 2);
  } finally { for (const db of [root, a, b, grandchild]) db.close(); }
});

test("lost acceptance, restart, completion or cancellation retain original grants without another allocation", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "xgent-child-budget-")), file = path.join(dir, "parent.sqlite"); let db = open(file);
  try {
    reserve(db, "lost-ack", 10, 20, "original-pc");
    db.close(); db = open(file);
    assert.throws(() => reserve(db, "lost-ack", 10, 20, "original-pc"), /UNIQUE/);
    assert.throws(() => reserve(db, "lost-ack", 11, 20, "other-pc"), /UNIQUE/);
    db.exec("UPDATE automation_background_children SET observed_state='done',terminal_confirmed=1,cancel_requested=1,cancel_acknowledged=1");
    db.close(); db = open(file);
    assert.equal(db.prepare(snapshot).get("execution").max_model_requests, 128);
    assert.equal(spendRemaining(db, "model"), 118); assert.equal(spendRemaining(db, "tool"), 236);
    const retained = db.prepare("SELECT peer_id,max_model_requests,max_tool_calls FROM automation_background_budget_grants").get();
    assert.deepEqual({ ...retained }, { peer_id: "original-pc", max_model_requests: 10, max_tool_calls: 20 });
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("budget and outgoing ownership roll back together on storage failure or either insufficient category", () => {
  const db = open(":memory:", [8, 9]);
  try {
    db.exec("CREATE TRIGGER ownership_failure BEFORE INSERT ON automation_background_children BEGIN SELECT RAISE(ABORT, 'storage unavailable'); END");
    assert.throws(() => reserve(db, "failed", 2, 2), /storage unavailable/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_budget_grants").get().n, 0);
    db.exec("DROP TRIGGER ownership_failure");
    for (const pair of [[9, 1], [1, 10]]) assert.throws(() => reserve(db, "too-large", ...pair), /remaining/);
    reserve(db, "fits", 7, 8); assert.equal(spend(db, "model"), 1); assert.equal(spend(db, "tool"), 1);
    assert.equal(spend(db, "model"), 0); assert.equal(spend(db, "tool"), 0);
    assert.throws(() => reserve(db, "no-slots", 1, 1), /remaining/);
  } finally { db.close(); }
});

test("concurrent parent consumption and child reservations serialize against one persistent cap", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "xgent-child-budget-writers-")), file = path.join(dir, "parent.sqlite"); const db = open(file);
  try {
    db.exec("PRAGMA journal_mode=WAL");
    const run = kind => new Promise((resolve, reject) => {
      const worker = new Worker(`const {workerData:d,parentPort}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(d.file);db.exec('PRAGMA busy_timeout=5000');let n=0;for(let i=0;i<160;i++){db.exec('BEGIN IMMEDIATE');n+=d.kind==='parent'?db.prepare(d.model).run('execution').changes:db.prepare(d.grant).run('execution','call-'+i,'child-'+i,'pc',2,2).changes;db.exec('COMMIT');}db.close();parentPort.postMessage(n);`, { eval: true, workerData: { file, kind, model, grant } });
      let count; worker.on("message", value => { count = value; }); worker.on("error", reject); worker.on("exit", code => code ? reject(new Error(`writer exited ${code}`)) : resolve(count));
    });
    const [used, allocations] = await Promise.all([run("parent"), run("children")]);
    assert.equal(used + allocations * 2, 128);
    assert.equal(db.prepare(snapshot).get("execution").model_requests, used);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("native reservation commits before the only RPC and receiver rejects missing or disabled delegated accounting", () => {
  const stage = childrenSource.slice(childrenSource.indexOf("pub fn stage_background_child"), childrenSource.indexOf("pub(super) fn enqueue_background_child"));
  assert.match(stage, /TransactionBehavior::Immediate[\s\S]*require_background_execution[\s\S]*verify\(&tx/);
  assert.match(stage, /if let Some\(\(owner, original, receipt\)\)[\s\S]*return Ok[\s\S]*reserve_background_child_budget[\s\S]*INSERT INTO automation_background_children[\s\S]*tx.commit/);
  assert.match(source, /input.intelligent_scheduling_enabled \|\| budget.is_some/);
  assert.match(source, /intent\["delegation_budget"\][\s\S]*Child budget differs from its original journal intent/);
  const receiver = read("store/background.rs");
  assert.match(receiver, /intelligent_scheduling_enabled && input.delegation[\s\S]*budget.is_none\(\)[\s\S]*no fresh root budget/);
  assert.match(receiver, /if !input.intelligent_scheduling_enabled[\s\S]*requires enabled lifetime accounting/);
  const native = readFileSync(new URL("../../src-tauri/src/commands/integration/lan_pc.rs", import.meta.url), "utf8");
  assert.match(native, /stage_background_child[\s\S]*if let Some\(existing\)[\s\S]*return Ok\(existing\)[\s\S]*registry.invoke/);
  const peer = readFileSync(new URL("../../src-tauri/src/services/worker_peers.rs", import.meta.url), "utf8");
  assert.match(peer, /delegation.get\("budget"\)[\s\S]*host.budget_delegation_version != 1[\s\S]*no task was sent/);
});
