import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// Executes the actual native SQLite statements. Window destruction, Rust
// orchestration and OS lifecycle still require native/physical acceptance.
const read = name => readFileSync(new URL(`../../src-tauri/src/${name}`, import.meta.url), "utf8");
const identity = read("services/automation/store/worker_instance.rs");
const store = read("services/automation/store.rs");
const schema = read("services/automation/db.rs");
const sql = (source, prefix) => {
  const found = [...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)]
    .find(match => match[1].trimStart().replace(/\s+/g, " ").startsWith(prefix));
  assert.ok(found, `Actual SQL missing: ${prefix}`); return found[1];
};
const migrate = db => db.exec(sql(schema, "CREATE TABLE IF NOT EXISTS automation_meta"));
const install = (db, owner) => db.prepare(sql(identity, "INSERT INTO automation_meta")).run(owner);
const admitted = (db, owner) => !!Object.values(db.prepare(sql(identity, "SELECT EXISTS")).get(owner))[0];

test("actual worker fence survives reopen and rejects queued old owner without issuing a task lease", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "xgent-worker-owner-")); let db;
  try {
    const filename = path.join(directory, "tasks.sqlite");
    db = new DatabaseSync(filename); migrate(db);
    db.prepare(sql(read("services/automation/store/background.rs"), "INSERT INTO automation_cron_runs")).run("pending-task", 90, 200, "{}");
    install(db, "11111111-1111-4111-8111-111111111111");
    assert.equal(admitted(db, "11111111-1111-4111-8111-111111111111"), true);
    install(db, "22222222-2222-4222-8222-222222222222"); db.close();
    db = new DatabaseSync(filename);
    db.exec("BEGIN IMMEDIATE");
    assert.equal(admitted(db, "11111111-1111-4111-8111-111111111111"), false);
    assert.equal(admitted(db, ""), false);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_cron_runs WHERE state = 'leased'").get().n, 0);
    assert.equal(db.prepare("SELECT state FROM automation_cron_runs WHERE execution_id = 'pending-task'").get().state, "pending");
    db.exec("ROLLBACK");
    assert.equal(admitted(db, "22222222-2222-4222-8222-222222222222"), true);
  } finally { db?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("production claim checks persisted owner inside immediate transaction before any lease is issued", () => {
  const claim = store.slice(store.indexOf("fn claim_prompt_runs_on_worker"), store.indexOf("/// Release", store.indexOf("fn claim_prompt_runs_on_worker")));
  const transaction = claim.indexOf("transaction_with_behavior(TransactionBehavior::Immediate)");
  const fence = claim.indexOf("Self::require_worker_instance(&tx, instance)?");
  const select = claim.indexOf("SELECT request_json FROM automation_cron_runs");
  const lease = claim.indexOf("Self::claim_background_lease");
  assert.ok(transaction >= 0 && transaction < fence && fence < select && select < lease);
  assert.match(identity, /WORKER_SUPERSEDED/);
});

test("native replacement fences old claims, proves retirement, then recovers and builds a distinct owner", () => {
  const supervisor = read("services/worker_supervisor.rs");
  const replacement = supervisor.slice(supervisor.indexOf("async fn replace_worker"), supervisor.indexOf("pub(crate) fn start"));
  const order = ["state.suspend_execution()?", "owned.install_background_worker_instance", "window.destroy()", "Old execution host has not retired", "owned.recover_interrupted_prompt_runs()", "state.install_instance", "build_worker(&device"]
    .map(text => replacement.indexOf(text));
  assert.ok(order.every((position, i) => position >= 0 && (!i || position > order[i - 1])));
  assert.match(replacement, /spawn_blocking\(move \|\| \{\s*if quitting.load/);
  assert.match(supervisor, /writable:false,configurable:false/);
  assert.match(supervisor, /restart_due[\s\S]*replace_worker[\s\S]*\.await[\s\S]*restart_failed/);
  assert.doesNotMatch(supervisor, /enable_execution\(/);
  assert.match(read("services/agent_worker.rs"), /supervision_armed[\s\S]*300_000/);
});
