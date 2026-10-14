import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Worker } from "node:worker_threads";

const read = name => readFileSync(new URL(`../../src-tauri/src/services/automation/${name}`, import.meta.url), "utf8");
const source = read("store/budget.rs");
const sql = (text, prefix) => { const match = [...text.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(item => item[1].trimStart().startsWith(prefix)); assert.ok(match, prefix); return match[1]; };
const initialize = sql(source.slice(source.indexOf("pub(super) fn initialize_background_budget")), "INSERT INTO automation_background_budgets");
const model = sql(source, "UPDATE automation_background_budgets SET model_requests");
const tool = sql(source, "UPDATE automation_background_budgets SET tool_calls");
const refuse = sql(source, "UPDATE automation_background_budgets SET exhausted");
const snapshot = sql(source, "SELECT model_requests");
function open(file = ":memory:") { const db = new DatabaseSync(file); db.exec("PRAGMA busy_timeout=5000"); db.exec(read("budget.sql")); return db; }
function consume(db, kind = "model") {
  db.exec("BEGIN IMMEDIATE");
  try {
    const changed = db.prepare(kind === "model" ? model : tool).run("execution").changes;
    if (!changed) db.prepare(refuse).run("execution");
    const state = db.prepare(snapshot).get("execution"); db.exec("COMMIT");
    return { admitted: changed === 1, state };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

test("accepted ledger keeps model/tool usage and durable refusal across close/reopen and lease replacement", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "xgent-budget-")), file = path.join(dir, "budget.sqlite"); let db = open(file);
  try {
    db.prepare(initialize).run("execution");
    assert.equal(consume(db).state.model_requests, 1); assert.equal(consume(db, "tool").state.tool_calls, 1);
    db.close(); db = open(file);
    for (let i = 1; i < 128; i++) assert.equal(consume(db).admitted, true);
    assert.equal(consume(db).admitted, false);
    db.close(); db = open(file);
    const stopped = consume(db, "tool"); assert.equal(stopped.admitted, false); assert.equal(stopped.state.tool_calls, 1); assert.equal(stopped.state.exhausted, 1);
    assert.throws(() => db.prepare(initialize).run("execution"), /UNIQUE/);
    assert.equal(db.prepare(snapshot).get("execution").model_requests, 128);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("two independent SQLite writers cannot consume beyond the one accepted limit", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "xgent-budget-writers-")), file = path.join(dir, "budget.sqlite"); const db = open(file);
  try {
    db.exec("PRAGMA journal_mode=WAL"); db.prepare(initialize).run("execution");
    const worker = () => new Promise((resolve, reject) => {
      const instance = new Worker(`const {workerData,parentPort}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(workerData.file);db.exec('PRAGMA busy_timeout=5000');let accepted=0;for(let i=0;i<100;i++){db.exec('BEGIN IMMEDIATE');const n=db.prepare(workerData.model).run('execution').changes;if(n)accepted++;else db.prepare(workerData.refuse).run('execution');db.exec('COMMIT');}db.close();parentPort.postMessage(accepted);`, { eval: true, workerData: { file, model, refuse } });
      let count; instance.on("message", value => { count = value; }); instance.on("error", reject); instance.on("exit", code => code ? reject(new Error(`writer exited ${code}`)) : resolve(count));
    });
    const accepted = await Promise.all([worker(), worker()]); assert.equal(accepted[0] + accepted[1], 128);
    const state = db.prepare(snapshot).get("execution"); assert.equal(state.model_requests, 128); assert.equal(state.exhausted, 1);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("failed ledger writes roll back and schema rejects overflow or invalid counters", () => {
  const db = open(); try {
    db.prepare(initialize).run("execution");
    db.exec("CREATE TRIGGER unavailable_budget BEFORE UPDATE ON automation_background_budgets BEGIN SELECT RAISE(ABORT, 'disk unavailable'); END");
    assert.throws(() => consume(db), /disk unavailable/); assert.equal(db.prepare(snapshot).get("execution").model_requests, 0);
    db.exec("DROP TRIGGER unavailable_budget");
    for (const invalid of ["model_requests=-1", "model_requests=129", "max_tool_calls=0", "exhausted=2"]) assert.throws(() => db.exec(`UPDATE automation_background_budgets SET ${invalid}`), /CHECK/);
  } finally { db.close(); }
});

test("native admission wiring fences live leases, verifies exact configuration and does not reset legacy/replayed work", () => {
  assert.match(source, /TransactionBehavior::Immediate[\s\S]*?require_background_execution[\s\S]*?verify\(&tx\)\?/);
  assert.match(source, /if !input.intelligent_scheduling_enabled/);
  const execute = source.slice(source.indexOf("pub fn background_budget")); assert.doesNotMatch(execute, /INSERT INTO automation_background_budgets\b|initialize_background_budget/);
  assert.doesNotMatch(execute, /SET model_requests = 0|SET tool_calls = 0|SET exhausted = 0/);
  assert.match(execute, /read_budget\(&tx[\s\S]*?submit a new task explicitly/);
  assert.match(execute, /let budget = read_budget[\s\S]*?tx.commit\(\)[\s\S]*?Ok\(BackgroundBudgetAdmission/);
  const acceptance = read("store/background.rs"); assert.match(acceptance, /\} else \{[\s\S]*?if input.intelligent_scheduling_enabled \{[\s\S]*?initialize_delegated_background_budget\(&tx, &execution_id, budget\)[\s\S]*?else \{ Self::initialize_background_budget\(&tx, &execution_id\)\?;[\s\S]*?tx.commit/);
  const commands = readFileSync(new URL("../../src-tauri/src/commands/automation/cron.rs", import.meta.url), "utf8");
  for (const name of ["automation_background_budget", "automation_background_budget_consume"]) {
    const command = commands.slice(commands.indexOf(`pub async fn ${name}(`)); assert.match(command.slice(0, 1600), /window.label\(\) != "agent-worker"/); assert.match(command.slice(0, 1600), /verify_background_configuration/);
  }
  assert.match(read("db.rs"), /include_str!\("budget.sql"\)/);
});
