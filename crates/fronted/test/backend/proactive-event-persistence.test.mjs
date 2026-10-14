import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const read = name => readFileSync(new URL(`../../src-tauri/src/services/automation/${name}`, import.meta.url), "utf8");
const sql = (source, prefix) => {
  const entry = [...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(item => item[1].trimStart().startsWith(prefix));
  assert.ok(entry, prefix); return entry[1];
};
const schema = sql(read("db.rs"), "CREATE TABLE IF NOT EXISTS automation_meta");
const proactiveSchema = read("proactive.sql"), source = read("store/proactive.rs");
const deliverySql = sql(source, "INSERT INTO automation_proactive_deliveries");
const cursorSql = sql(source, "UPDATE automation_proactive_rules SET cursor = ?2");
const revokeRunSql = sql(source, "UPDATE automation_cron_runs SET state = 'expired'");
const revokeReceiptSql = sql(source, "UPDATE automation_proactive_deliveries SET state = 'revoked'");
const queueSql = sql(read("store.rs").slice(read("store.rs").indexOf("fn queue_prompt_in_transaction(")), "INSERT INTO automation_cron_runs");
const eventSql = sql(source, "SELECT sequence, execution_id, task_id, kind, occurred_at FROM automation_proactive_events");
const viewSql = sql(source, "SELECT d.rule_id, d.event_sequence");
function open(file = ":memory:") { const db = new DatabaseSync(file); db.exec(schema); db.exec(proactiveSchema); return db; }
function run(db, id, state = "done", success = 1, output = "actual result") {
  db.prepare("INSERT INTO automation_cron_runs (execution_id,task_id,state,success,started_at,finished_at,output) VALUES (?, 'source', ?, ?, 100, 200, ?)").run(id, state, success, output);
}
function rule(db, cursor = 0) { db.prepare("INSERT INTO automation_proactive_rules (rule_id,config_json,binding_json,cursor,created_at) VALUES ('rule', '{}', '{}', ?, 100)").run(cursor); }

test("real terminal transitions are immutable, deduplicated, and ignore cancellation, expiry and skipped overlap", () => {
  const db = open();
  try {
    for (const state of ["pending", "leased", "expired", "waiting", "suspended"] ) run(db, state, state);
    run(db, "skip", "done", 0, "Skipped: previous run is still in progress.");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_proactive_events").get().n, 0);
    db.prepare("UPDATE automation_cron_runs SET state = 'done', success = 0, finished_at = 300 WHERE execution_id = 'leased'").run();
    run(db, "success");
    assert.deepEqual(db.prepare("SELECT execution_id, kind, occurred_at FROM automation_proactive_events ORDER BY sequence").all().map(Object.values), [["leased", "run_failed", 300], ["success", "run_succeeded", 200]]);
    db.prepare("UPDATE automation_cron_runs SET output = 'late', finished_at = 999, state = 'done' WHERE execution_id = 'leased'").run();
    db.prepare("UPDATE automation_cron_runs SET state = 'leased' WHERE execution_id = 'leased'").run();
    db.prepare("UPDATE automation_cron_runs SET state = 'done' WHERE execution_id = 'leased'").run();
    assert.equal(db.prepare("SELECT occurred_at FROM automation_proactive_events WHERE execution_id = 'leased'").get().occurred_at, 300);
  } finally { db.close(); }
});

test("migration does not invent old events; generated agent completions cannot start recursive rules", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(schema); run(db, "historical"); db.exec(proactiveSchema); db.exec(proactiveSchema);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_proactive_events").get().n, 0);
    run(db, "actual"); rule(db);
    db.prepare(queueSql).run("follow-up", "target", 300, 600000, "{}");
    db.prepare(deliverySql).run("rule", 1, "queued", "follow-up", "accepted", 300);
    db.prepare("UPDATE automation_cron_runs SET state = 'done', finished_at = 400, success = 1 WHERE execution_id = 'follow-up'").run();
    assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_proactive_events").get().n, 1);
    db.prepare("DELETE FROM automation_cron_runs WHERE state = 'done'").run();
    assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_proactive_events").get().n, 1);
    assert.equal(db.prepare(viewSql).get().state, "queued");
    assert.equal(db.prepare(viewSql).get().run_state, null);
    assert.equal(db.prepare(viewSql).get().run_success, null);
  } finally { db.close(); }
});

test("queue, event receipt and cursor commit together and survive reopen; rollback cannot leave executable work", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "xgent-proactive-"));
  const file = path.join(directory, "rules.sqlite"); let db = open(file);
  try {
    run(db, "source-event"); rule(db);
    for (const commit of [false, true]) {
      db.exec("BEGIN IMMEDIATE");
      db.prepare(queueSql).run("follow-up", "target", 300, 600000, "{}");
      db.prepare(deliverySql).run("rule", 1, "queued", "follow-up", "accepted", 300);
      db.prepare(cursorSql).run("rule", 1);
      db.exec(commit ? "COMMIT" : "ROLLBACK");
      assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_cron_runs WHERE state = 'pending'").get().n, commit ? 1 : 0);
    }
    db.close(); db = open(file);
    assert.equal(db.prepare("SELECT cursor FROM automation_proactive_rules").get().cursor, 1);
    assert.deepEqual(db.prepare(eventSql).all(1, "run_succeeded", "target", null), []);
    assert.equal(db.prepare(viewSql).get().execution_id, "follow-up");
    assert.throws(() => db.prepare(deliverySql).run("different-rule", 1, "queued", "follow-up", "accepted", 500), /UNIQUE/);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("deferred receipt updates in place; terminal accepted receipt cannot be overwritten on replay", () => {
  const db = open();
  try {
    run(db, "source-event"); rule(db);
    db.prepare(deliverySql).run("rule", 1, "deferred", null, "quiet_hours", 300);
    db.prepare(deliverySql).run("rule", 1, "deferred", null, "target_busy", 400);
    assert.equal(db.prepare(viewSql).get().reason, "target_busy");
    db.prepare(queueSql).run("follow-up", "target", 500, 600000, "{}");
    db.prepare(deliverySql).run("rule", 1, "queued", "follow-up", "accepted", 500);
    db.prepare(deliverySql).run("rule", 1, "suppressed", null, "stale", 600);
    assert.equal(db.prepare(viewSql).get().execution_id, "follow-up");
    assert.equal(db.prepare(viewSql).get().updated_at, 500);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_proactive_deliveries").get().n, 1);
  } finally { db.close(); }
});

test("disable revokes unclaimed work and deferrals, while leased work keeps its actual lease and receipt", () => {
  const db = open();
  try {
    rule(db);
    for (const [i, state] of [[1, "pending"], [2, "leased"]]) {
      run(db, `source-${i}`); db.prepare(queueSql).run(`follow-${i}`, "target", 300, 600000, "{}");
      db.prepare(deliverySql).run("rule", i, "queued", `follow-${i}`, "accepted", 300);
      if (state === "leased") db.prepare("UPDATE automation_cron_runs SET state = 'leased' WHERE execution_id = ?").run(`follow-${i}`);
    }
    run(db, "source-3"); db.prepare(deliverySql).run("rule", 3, "deferred", null, "quiet_hours", 300);
    db.exec("BEGIN IMMEDIATE"); db.prepare(revokeRunSql).run("rule", 400); db.prepare(revokeReceiptSql).run("rule", 400); db.exec("COMMIT");
    assert.equal(db.prepare("SELECT state FROM automation_cron_runs WHERE execution_id = 'follow-1'").get().state, "expired");
    assert.deepEqual(Object.values(db.prepare("SELECT state,lease_expires_at FROM automation_cron_runs WHERE execution_id = 'follow-2'").get()), ["leased", 600000]);
    assert.deepEqual(db.prepare("SELECT state FROM automation_proactive_deliveries ORDER BY event_sequence").all().map(r => r.state), ["revoked", "queued", "revoked"]);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_proactive_events").get().n, 3);
  } finally { db.close(); }
});

test("event selection respects enable watermark, exact source, event kind and self-task exclusion", () => {
  const db = open();
  try {
    run(db, "old"); run(db, "new"); run(db, "failure", "done", 0);
    assert.deepEqual(db.prepare(eventSql).all(1, "run_succeeded", "target", "source").map(r => r.execution_id), ["new"]);
    assert.equal(db.prepare(eventSql).all(0, "run_succeeded", "source", null).length, 0);
    assert.equal(db.prepare(eventSql).all(0, "run_failed", "target", "other-source").length, 0);
    assert.equal(db.prepare(eventSql).all(0, "run_failed", "target", null)[0].execution_id, "failure");
  } finally { db.close(); }
});
