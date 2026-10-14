import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Worker } from "node:worker_threads";

// Real production SQLite; native Rust/paired HTTP/provider usage is not run.
const read = name => readFileSync(new URL(`../../src-tauri/src/services/automation/${name}`, import.meta.url), "utf8");
const budget = read("store/budget.rs"), settlement = read("store/budget_settlements.rs"), children = read("store/children.rs");
function sql(source, prefix) {
  const literal = [...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(entry => entry[1].trimStart().startsWith(prefix));
  assert.ok(literal, prefix); return literal[1];
}
const schema = sql(read("db.rs"), "CREATE TABLE IF NOT EXISTS automation_meta") + read("budget.sql");
const settle = sql(settlement, "INSERT INTO automation_background_budget_settlements");
const snapshot = sql(budget, "SELECT model_requests");
const own = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
function open(file = ":memory:") {
  const db = new DatabaseSync(file); db.exec("PRAGMA busy_timeout=5000"); db.exec(schema);
  db.prepare("INSERT OR IGNORE INTO automation_meta(key,value) VALUES('background_worker_id.v1',?)").run(own);
  db.prepare("INSERT OR IGNORE INTO automation_background_budgets(execution_id,max_model_requests,max_tool_calls) VALUES('parent',128,256)").run();
  return db;
}
function child(db, call, requests = 40, tools = 80) {
  db.prepare(sql(budget, "INSERT INTO automation_background_budget_grants")).run("parent", call, `request-${call}`, `pc-${call}`, requests, tools);
  db.prepare(sql(children, "INSERT INTO automation_background_children")).run("parent", call, `request-${call}`, `pc-${call}`, own, "{}", 100);
  db.prepare("UPDATE automation_background_children SET observed_execution_id=? WHERE call_id=?").run(`execution-${call}`, call);
}
const observeTerminal = (db, call) => db.prepare("UPDATE automation_background_children SET terminal_confirmed=1,observed_state='done' WHERE call_id=?").run(call);
const record = (db, call, models = 3, tools = 4) => db.prepare(settle).run("parent", call, `execution-${call}`, models, tools, 200).changes;
const reserved = db => {
  const row = db.prepare(snapshot).get("parent");
  return [Object.values(row)[5], Object.values(row)[6], Object.values(row)[8]];
};

test("terminal settlement returns only unused original slots; real spent slots stay charged and the original allocation is unchanged", () => {
  const db = open(); try {
    child(db, "a"); child(db, "b", 30, 60); assert.deepEqual(reserved(db), [70, 140, 0]);
    assert.equal(record(db, "a"), 0, "queued/running is not a terminal usage proof");
    observeTerminal(db, "a"); assert.equal(record(db, "a", 3, 4), 1); assert.deepEqual(reserved(db), [33, 64, 1]);
    assert.equal(record(db, "a", 0, 0), 0); assert.deepEqual(reserved(db), [33, 64, 1], "later reports cannot rewrite the first settlement");
    assert.equal(db.prepare("SELECT max_model_requests FROM automation_background_budget_grants WHERE call_id='a'").get().max_model_requests, 40);
    observeTerminal(db, "b"); record(db, "b", 0, 1); assert.deepEqual(reserved(db), [3, 5, 2]);
    assert.equal(Object.values(db.prepare(snapshot).get("parent"))[7], 1, "delegation ownership remains after settlement");
  } finally { db.close(); }
});

test("settlement and original child observation commit together, roll back together and survive reopen", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "xgent-budget-settlement-")); const file = path.join(directory, "config.sqlite"); let db = open(file);
  try {
    child(db, "a");
    for (const commit of [false, true]) {
      db.exec("BEGIN IMMEDIATE"); observeTerminal(db, "a"); record(db, "a"); db.exec(commit ? "COMMIT" : "ROLLBACK");
      assert.deepEqual(reserved(db), commit ? [3, 4, 1] : [40, 80, 0]);
    }
    db.close(); db = open(file); assert.deepEqual(reserved(db), [3, 4, 1]);
    assert.equal(record(db, "a"), 0);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("foreign installation, changed child request/host/execution and over-budget usage cannot return capacity", () => {
  for (const mutation of ["issuer_host_id='foreign'", "peer_id='other-pc'", "child_request_id='other-request'", "observed_execution_id='other-run'", "terminal_confirmed=0"]) {
    const db = open(); try {
      child(db, "a"); observeTerminal(db, "a"); db.exec(`UPDATE automation_background_children SET ${mutation}`);
      assert.equal(record(db, "a"), 0); assert.deepEqual(reserved(db), [40, 80, 0]);
    } finally { db.close(); }
  }
  const db = open(); try {
    child(db, "a"); observeTerminal(db, "a"); assert.equal(record(db, "a", 41, 4), 0);
    assert.equal(record(db, "a", 3, 81), 0); assert.equal(record(db, "a", -1, 0), 0);
    assert.deepEqual(reserved(db), [40, 80, 0]);
  } finally { db.close(); }
});

test("released slots support another compound branch and the parent integration within the original shared ceiling", () => {
  const db = open(); try {
    child(db, "a", 100, 200);
    const spend = db.prepare(sql(budget, "UPDATE automation_background_budgets SET model_requests"));
    for (let i = 0; i < 5; i++) assert.equal(spend.run("parent").changes, 1);
    observeTerminal(db, "a"); record(db, "a", 8, 20);
    child(db, "website", 60, 100); assert.deepEqual(reserved(db), [68, 120, 1]);
    let extra = 0; while (spend.run("parent").changes) extra++;
    assert.equal(extra, 55); assert.equal(db.prepare("SELECT model_requests FROM automation_background_budgets").get().model_requests + 68, 128);
    assert.equal(db.prepare(sql(budget, "INSERT INTO automation_background_budget_grants")).run("parent", "overflow", "r", "pc", 1, 1).changes, 0);
  } finally { db.close(); }
});

test("zero-use terminal children return their complete allocation without losing the original ownership or creating a fake completion", () => {
  const db = open(); try {
    child(db, "a"); observeTerminal(db, "a"); record(db, "a", 0, 0);
    assert.deepEqual(reserved(db), [0, 0, 1]); assert.equal(Object.values(db.prepare(snapshot).get("parent"))[7], 1);
    assert.equal(db.prepare("SELECT observed_state FROM automation_background_children").get().observed_state, "done");
    db.exec("UPDATE automation_background_budgets SET exhausted=1");
    assert.equal(db.prepare(sql(budget, "UPDATE automation_background_budgets SET model_requests")).run("parent").changes, 0, "settlement cannot revive prior budget exhaustion");
  } finally { db.close(); }
});

test("concurrent replays settle one original child once and cannot manufacture extra capacity", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "xgent-budget-race-")), file = path.join(directory, "config.sqlite"); const db = open(file);
  try {
    child(db, "a"); observeTerminal(db, "a");
    const work = () => new Promise((resolve, reject) => {
      const worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(workerData.file);db.exec('PRAGMA busy_timeout=5000');db.exec('BEGIN IMMEDIATE');const changed=db.prepare(workerData.sql).run('parent','a','execution-a',3,4,200).changes;db.exec('COMMIT');db.close();parentPort.postMessage(changed);`,
        { eval: true, workerData: { file, sql: settle } });
      worker.once("message", resolve); worker.once("error", reject);
    });
    assert.deepEqual((await Promise.all([work(), work()])).sort(), [0, 1]); assert.deepEqual(reserved(db), [3, 4, 1]);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("native source publishes protected ledger metadata and settles only after original authenticated fully terminal observation", () => {
  assert.match(settlement, /value.get\("executionBudget"\)/); assert.match(settlement, /budget\["executionId"\]!=child_execution/);
  assert.match(settlement, /counter\["limit"\].as_u64\(\)!=Some\(limit\)/);
  assert.match(settlement, /used.checked_add\(reserved\).filter/);
  assert.match(settlement, /observed_deadline!=deadline/); assert.match(settlement, /None=>return Ok\(\(\)\)/);
  assert.match(children, /current != issuer \|\| probe.is_some_and/);
  assert.match(children, /terminal = matches![^]*?in_flight==0 && cloud_pending==0 && descendants_done/);
  assert.ok(children.indexOf('"UPDATE automation_background_children SET receipt_json') < children.indexOf("if terminal {Self::settle_background_child_budget"));
  assert.match(read("store/background.rs"), /input.intelligent_scheduling_enabled && has_budget[^]*?read_budget/);
  assert.match(read("types.rs"), /execution_budget: Option<super::store::BackgroundBudgetSnapshot>/);
  assert.doesNotMatch(settlement, /pub fn|tauri::command|exhausted\s*=\s*0|DELETE FROM automation_background_budget_grants/);
});
