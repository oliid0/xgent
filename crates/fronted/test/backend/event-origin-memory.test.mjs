import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// Execute the production preflight SQL; source checks do not execute Rust or
// certify mobile SDK/headless behavior. Native readonly recall has a Rust test.
const native = name => readFileSync(new URL(`../../src-tauri/src/${name}`, import.meta.url), "utf8");
const source = native("services/automation/store/event_origin_memory.rs");
const sql = (text, prefix) => {
  const entry = [...text.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)]
    .find(match => match[1].trimStart().startsWith(prefix));
  assert.ok(entry, prefix); return entry[1];
};
const NOW = 600000;
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(sql(native("services/automation/db.rs"), "CREATE TABLE IF NOT EXISTS automation_meta"));
  db.exec(native("services/automation/proactive.sql"));
  db.prepare("INSERT INTO automation_cron_tasks(task_id,name,cron_expr,kind,enabled,config_json,sort_index,updated_at) VALUES('target','Fitness','0 21 * * *','prompt',1,?,0,1)")
    .run(JSON.stringify({ prompt: "提醒今晚健身时间" }));
  return db;
}
function rule(db, id, changes = {}) {
  const config = { targetTaskId: "target", eventKind: "run_succeeded", cooldownMinutes: 5, maxAgeMinutes: 1,
    remoteExecution: { peerId: "pc", providerId: "actual-provider", model: "actual-model", workdir: "/work" }, ...changes };
  db.prepare("INSERT INTO automation_proactive_rules(rule_id,config_json,binding_json,cursor,created_at) VALUES(?,?,'frozen-task',0,100)")
    .run(id, JSON.stringify(config));
}
const candidates = db => db.prepare(sql(source, "SELECT r.rule_id,r.binding_json,r.config_json,substr")).all(NOW);
const event = (db, id, task = "source", time = NOW - 1, kind = "run_succeeded") =>
  db.prepare("INSERT INTO automation_proactive_events(execution_id,task_id,kind,occurred_at) VALUES(?,?,?,?)").run(id, task, kind, time);

test("event recall preflight reads the real prompt config and only eligible original pending remote rules", () => {
  const db = fixture(); try {
    rule(db, "ready"); rule(db, "local", { remoteExecution: null });
    rule(db, "disabled"); rule(db, "cooldown"); rule(db, "wrong-source", { sourceTaskId: "other" });
    rule(db, "wrong-kind", { eventKind: "run_failed" }); rule(db, "removed-target", { targetTaskId: "removed" });
    db.exec("UPDATE automation_proactive_rules SET enabled=0 WHERE rule_id='disabled'");
    db.prepare("UPDATE automation_proactive_rules SET last_queued_at=? WHERE rule_id='cooldown'").run(NOW - 2);
    event(db, "first"); event(db, "second");
    let selected = candidates(db); assert.equal(selected.length, 1);
    assert.equal(selected[0].rule_id, "ready");
    assert.equal(selected[0].binding_json, "frozen-task");
    assert.equal(Object.values(selected[0]).at(-1), "Fitness\n提醒今晚健身时间");
    db.exec("UPDATE automation_proactive_rules SET cursor=(SELECT MAX(sequence) FROM automation_proactive_events)");
    assert.equal(candidates(db).length, 0);
    event(db, "self", "target"); event(db, "stale", "source", NOW - 60001);
    event(db, "future", "source", NOW + 1); assert.equal(candidates(db).length, 0);
    event(db, "actual"); assert.equal(candidates(db).length, 1);
    db.exec("UPDATE automation_cron_tasks SET enabled=0"); assert.equal(candidates(db).length, 0);
    db.exec("UPDATE automation_cron_tasks SET enabled=1,remaining_runs=0"); assert.equal(candidates(db).length, 0);
    db.exec("UPDATE automation_cron_tasks SET remaining_runs=NULL,kind='script'"); assert.equal(candidates(db).length, 0);
  } finally { db.close(); }
});

test("Health and Home event recall respects original activation, metric scope, cursor and age", () => {
  const db = fixture(); try {
    rule(db, "health", { eventKind: "health_updated", healthMetric: "heart_rate" });
    rule(db, "home", { eventKind: "home_power_changed", homeId: "my-home" });
    for (const id of ["health", "home"])
      db.prepare("INSERT INTO automation_health_rule_activations VALUES(?,?)").run(id, NOW - 1000);
    const add = (id, metric, time) => db.prepare("INSERT INTO automation_health_events(event_id,metric,occurred_at) VALUES(?,?,?)").run(id, metric, time);
    add("old-activation", "heart_rate", NOW - 1001); add("other-metric", "weight", NOW - 1);
    add("other-home", "home:other-home", NOW - 1); add("future", "heart_rate", NOW + 1);
    assert.equal(candidates(db).length, 0);
    add("actual-health", "heart_rate", NOW - 1); add("actual-home", "home:my-home", NOW - 1);
    assert.deepEqual(candidates(db).map(row => row.rule_id).sort(), ["health", "home"]);
    db.exec("UPDATE automation_proactive_rules SET cursor=(SELECT MAX(sequence) FROM automation_health_events)");
    assert.equal(candidates(db).length, 0);
    db.exec("DELETE FROM automation_health_rule_activations");
    add("revoked", "heart_rate", NOW); assert.equal(candidates(db).length, 0);
  } finally { db.close(); }
});

test("preflight remains bounded and leaves original event state untouched", () => {
  const db = fixture(); try {
    for (let i = 0; i < 30; i++) rule(db, `rule-${i}`);
    event(db, "actual"); const selected = candidates(db); assert.equal(selected.length, 20);
    assert.equal(new Set(selected.map(row => row.rule_id)).size, 20);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_proactive_rules WHERE cursor<>0 OR last_queued_at IS NOT NULL").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_submission_outbox").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_cron_runs").get().n, 0);
  } finally { db.close(); }
});

test("native path checks original identity, reads existing memory before queue locking and freezes source context", () => {
  const sender = native("services/os_event_sender.rs"), dispatch = native("services/automation/store/proactive.rs");
  assert.ok(sender.indexOf("vault.existing_worker_host_identity()?") < sender.indexOf("dispatch_proactive_remote_rules(credential_root)"));
  const filtered = dispatch.slice(dispatch.indexOf("fn dispatch_proactive_rules_filtered"));
  assert.ok(filtered.indexOf("prepare_event_origin_memory(storage)") < filtered.indexOf("self.lock_conn()?"));
  assert.match(filtered, /origin_memories.get\(&\(id.clone\(\),frozen.clone\(\),raw.clone\(\)\)\)/);
  const readonly = native("services/memory/store.rs").split("pub fn open()")[0];
  assert.match(readonly, /canonicalize[^]*?root.starts_with\(&storage\)[^]*?db_path.starts_with\(&root\)/);
  assert.match(readonly, /SQLITE_OPEN_READ_ONLY/);
  assert.doesNotMatch(readonly, /SQLITE_OPEN_CREATE|ensure_root_dirs|reconcile\(|open_memory_connection|create_dir/);
  assert.ok(source.indexOf("})().unwrap_or_default()") < source.indexOf("open_existing_readonly_at(storage)"));
  const remote = native("services/automation/store/proactive_remote.rs");
  assert.match(remote, /proactive-event\/\{rule\}\/\{source_execution\}/);
  assert.match(remote, /source.system_prompt=origin_memory.unwrap_or_default\(\).to_string\(\);[^]*?source.validate\(\)/);
  assert.match(remote, /"timestamp":occurred/);
  assert.ok(remote.indexOf("source.validate()?") < remote.indexOf("stage_background_submission_on_connection"));
  assert.match(native("commands/automation/proactive.rs"), /!matches!\(host.source_context_version, 1 \| 2\)/);
});
