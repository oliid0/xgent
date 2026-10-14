import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
const read = name => readFileSync(new URL(`../../src-tauri/src/services/automation/${name}`, import.meta.url), "utf8");
const budget = read("store/budget.rs"), children = read("store/children.rs");
const sql = (text, prefix) => { const entry = [...text.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(match => match[1].trimStart().startsWith(prefix)); assert.ok(entry, prefix); return entry[1]; };
const owner = randomUUID();
function open(file = ":memory:") {
  const db = new DatabaseSync(file); db.exec(sql(read("db.rs"), "CREATE TABLE IF NOT EXISTS automation_meta")); db.exec(read("budget.sql"));
  db.prepare("INSERT OR IGNORE INTO automation_meta VALUES('background_worker_id.v1',?)").run(owner);
  db.prepare("INSERT OR IGNORE INTO automation_background_budgets(execution_id,max_model_requests,max_tool_calls) VALUES('parent',2,3)").run(); return db;
}
function child(db) {
  db.prepare(sql(budget, "INSERT INTO automation_background_budget_grants")).run("parent", "child", "request", "peer", 2, 3);
  db.prepare(sql(children, "INSERT INTO automation_background_children")).run("parent", "child", "request", "peer", owner, "{}", 100);
}
const held = (db, kind = "modelRequests") => Boolean(Object.values(db.prepare(sql(budget, "SELECT b.exhausted=0 AND")).get("parent", kind))[0]);
const cause = (db, id, now = 200) => Boolean(Object.values(db.prepare(sql(budget, "SELECT EXISTS(SELECT 1 FROM automation_background_budget_deferrals")).get("parent", id, now))[0]);
test("only real live original child allocations distinguish temporary reservation from actual exhaustion", () => {
  const db = open(); try {
    assert.equal(held(db), false); child(db); assert.equal(held(db), true); assert.equal(held(db, "toolCalls"), true);
    for (const [field, value] of [["issuer_host_id", "copied"], ["peer_id", "foreign"], ["child_request_id", "other"]]) {
      const previous = db.prepare(`SELECT ${field} FROM automation_background_children`).get()[field];
      db.prepare(`UPDATE automation_background_children SET ${field}=?`).run(value); assert.equal(held(db), false);
      db.prepare(`UPDATE automation_background_children SET ${field}=?`).run(previous);
    }
    db.exec("UPDATE automation_background_children SET terminal_confirmed=1"); assert.equal(held(db), false, "unknown terminal usage stays charged");
    db.exec("UPDATE automation_background_children SET terminal_confirmed=0; UPDATE automation_background_budgets SET exhausted=1"); assert.equal(held(db), false);
  } finally { db.close(); }
});
test("confirmed deferral commits atomically, survives reopen and cannot cross owner, execution, deadline or an admitted request", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "xgent-budget-deferral-")), file = path.join(dir, "store.sqlite"); let db = open(file); const id = randomUUID();
  try {
    child(db); const insert = () => db.prepare(sql(budget, "INSERT INTO automation_background_budget_deferrals")).run("parent", id, "modelRequests");
    db.exec("BEGIN IMMEDIATE"); insert(); assert.equal(cause(db, id), true); db.exec("ROLLBACK"); assert.equal(cause(db, id), false);
    insert(); db.close(); db = open(file); assert.equal(cause(db, id), true); assert.equal(cause(db, randomUUID()), false);
    db.prepare("UPDATE automation_meta SET value='copied' WHERE key='background_worker_id.v1'").run(); assert.equal(cause(db, id), false);
    db.prepare("UPDATE automation_meta SET value=? WHERE key='background_worker_id.v1'").run(owner);
    db.prepare("INSERT INTO automation_background_budget_deadlines VALUES('parent',300)").run(); assert.equal(cause(db, id, 300), false);
    db.prepare("DELETE FROM automation_background_budget_deadlines").run();
    db.prepare(sql(budget, "DELETE FROM automation_background_budget_deferrals")).run("parent"); assert.equal(cause(db, id), false);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
test("actual settled unused slots become admissible within the unchanged original quota", () => {
  const db = open(); try {
    child(db); const admit = db.prepare(sql(budget, "UPDATE automation_background_budgets SET model_requests")); assert.equal(admit.run("parent").changes, 0); assert.equal(held(db), true);
    db.prepare("UPDATE automation_background_children SET terminal_confirmed=1,observed_execution_id='actual-child'").run();
    db.prepare(sql(read("store/budget_settlements.rs"), "INSERT INTO automation_background_budget_settlements")).run("parent", "child", "actual-child", 0, 1, 200);
    assert.equal(held(db), false); assert.equal(admit.run("parent").changes, 1); assert.equal(admit.run("parent").changes, 1); assert.equal(admit.run("parent").changes, 0);
    assert.equal(db.prepare("SELECT max_model_requests FROM automation_background_budgets").get().max_model_requests, 2);
  } finally { db.close(); }
});
test("parking bypass is limited to confirmed native budget refusal and preserves ordinary wait guards and original joins", () => {
  const waiting = read("store/waiting.rs");
  assert.match(waiting, /require_budget_deferral\(&tx,&input.execution_id,deferral\)/);
  assert.match(waiting, /if !budget_wait && !device_wake/); assert.match(waiting, /if !budget_wait && !context\["messages"\]/);
  assert.match(waiting, /has_uncertain_operations/); assert.match(waiting, /stage_background_task_joins/);
  assert.ok(budget.indexOf("deferred=Some(BackgroundBudgetDeferral") < budget.lastIndexOf("tx.commit()"));
  assert.doesNotMatch(budget, /SET exhausted = 0|SET model_requests = 0|SET tool_calls = 0/);
});
