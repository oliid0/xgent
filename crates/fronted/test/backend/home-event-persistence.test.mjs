import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const root = new URL("../../src-tauri/src/services/automation/", import.meta.url);
const read = name => readFileSync(new URL(name, root), "utf8");
const sql = (source, prefix) => {
  const entry = [...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(x => x[1].trimStart().startsWith(prefix));
  assert.ok(entry, prefix); return entry[1];
};
const source = read("store/proactive.rs"), intake = read("store/home_events.rs");
const select = sql(source, "SELECT -h.sequence,h.event_id,h.metric"), view = sql(source, "SELECT d.rule_id, d.event_sequence");
const insert = sql(intake, "INSERT INTO automation_health_events"), valueInsert = sql(intake, "INSERT INTO automation_home_event_values");
const observed = sql(intake, "SELECT v.payload_json"), seen = sql(intake, "SELECT h.metric,h.occurred_at");
const receipt = sql(source, "INSERT INTO automation_proactive_deliveries"), cursor = sql(source, "UPDATE automation_proactive_rules SET cursor = ?2");
const activation = sql(source, "INSERT INTO automation_health_rule_activations"), revoke = sql(source, "UPDATE automation_cron_runs SET state = 'expired'");
const queueSource = read("store.rs"), queue = sql(queueSource.slice(queueSource.indexOf("fn queue_prompt_in_transaction(")), "INSERT INTO automation_cron_runs");
const homeId = "11111111-1111-4111-8111-111111111111";
function open(file = ":memory:") {
  const db = new DatabaseSync(file); db.exec(sql(read("db.rs"), "CREATE TABLE IF NOT EXISTS automation_meta")); db.exec(read("proactive.sql"));
  db.exec("PRAGMA foreign_keys=ON"); return db;
}
function rule(db) { db.prepare("INSERT INTO automation_proactive_rules (rule_id,config_json,binding_json,cursor,created_at) VALUES ('rule','{}','{}',0,100)").run(); db.prepare(activation).run("rule", 100); }
function event(db, id, home = homeId, occurred = 200) {
  const payload = JSON.stringify({ id, homeId: home, accessoryId: "22222222-2222-4222-8222-222222222222", serviceId: "33333333-3333-4333-8333-333333333333", characteristicId: "44444444-4444-4444-8444-444444444444", homeNamePreview: "Original Home", accessoryNamePreview: "Living room lamp", serviceNamePreview: "Power", power: true, occurredAtMs: occurred });
  db.prepare(insert).run(id, `home:${home}`, occurred); db.prepare(valueInsert).run(id, payload); return payload;
}

test("production Home, Health and task events share receipts without cursor collisions or incorrect history labels", () => {
  const db = open(); try {
    rule(db); const payload = event(db, "actual-home-change"); db.prepare(insert).run("health-change", "heart_rate", 210);
    db.prepare("INSERT INTO automation_cron_runs (execution_id,task_id,state,success,started_at,finished_at,output) VALUES ('task-change','source','done',1,100,220,'actual')").run();
    for (const [ruleId, sequence] of [["rule", -1], ["health-rule", -2], ["task-rule", 1]]) db.prepare(receipt).run(ruleId, sequence, "suppressed", null, "cooldown", 300);
    assert.deepEqual(db.prepare(view).all().map(row => [row.source_execution_id, row.event_kind, row.source_task_id]).sort(), [
      ["actual-home-change", "home_power_changed", `home:${homeId}`], ["health-change", "health_updated", "health:heart_rate"], ["task-change", "run_succeeded", "source"],
    ]);
    assert.equal(db.prepare(observed).get("actual-home-change", `home:${homeId}`).payload_json, payload);
    assert.equal(db.prepare(observed).get("actual-home-change", "home:another-home"), undefined);
    assert.equal(db.prepare(seen).get("actual-home-change").payload_json, payload);
    assert.throws(() => event(db, "actual-home-change"), /UNIQUE/);
    db.exec(read("proactive.sql")); assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_home_event_values").get().n, 1);
  } finally { db.close(); }
});

test("production Home selection excludes other homes, missing values and events predating activation or re-enable", () => {
  const db = open(); try {
    rule(db); event(db, "old", homeId, 90); event(db, "fresh"); event(db, "other", "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa");
    db.prepare(insert).run("missing-sdk-value", `home:${homeId}`, 220);
    assert.deepEqual(db.prepare(select).all("rule", 0, homeId).map(row => row.event_id), ["fresh"]);
    db.prepare(activation).run("rule", 300); event(db, "late-pre-enable", homeId, 290); event(db, "new-after-enable", homeId, 310);
    assert.deepEqual(db.prepare(select).all("rule", 0, homeId).map(row => row.event_id), ["new-after-enable"]);
    db.prepare("DELETE FROM automation_health_rule_activations WHERE rule_id='rule'").run();
    assert.deepEqual(db.prepare(select).all("rule", 0, homeId), []);
  } finally { db.close(); }
});

test("production Home queue, immutable receipt and cursor survive rollback/reopen and never create recursive task events", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "xgent-home-events-")); let db = open(path.join(directory, "events.sqlite"));
  try {
    rule(db); event(db, "home-change");
    for (const commit of [false, true]) {
      db.exec("BEGIN IMMEDIATE"); db.prepare(queue).run("home-follow-up", "target", 300, 600000, "{}");
      db.prepare(receipt).run("rule", -1, "queued", "home-follow-up", "accepted", 300); db.prepare(cursor).run("rule", 1);
      db.exec(commit ? "COMMIT" : "ROLLBACK"); assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_cron_runs WHERE state='pending'").get().n, commit ? 1 : 0);
    }
    db.close(); db = open(path.join(directory, "events.sqlite"));
    assert.deepEqual(db.prepare(select).all("rule", 1, homeId), []); assert.equal(db.prepare(view).get().run_state, "pending");
    db.prepare("UPDATE automation_cron_runs SET state='done',finished_at=400,success=1 WHERE execution_id='home-follow-up'").run();
    assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_proactive_events").get().n, 0); assert.equal(db.prepare(view).get().run_success, 1);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("production disable withdraws unclaimed Home work while preserving a currently leased task", () => {
  const db = open(); try {
    rule(db);
    for (let i = 1; i <= 2; i++) { event(db, `change-${i}`); db.prepare(queue).run(`follow-${i}`, "target", 300, 600000, "{}"); db.prepare(receipt).run("rule", -i, "queued", `follow-${i}`, "accepted", 300); }
    db.prepare("UPDATE automation_cron_runs SET state='leased' WHERE execution_id='follow-2'").run(); db.prepare(revoke).run("rule", 400);
    assert.equal(db.prepare("SELECT state FROM automation_cron_runs WHERE execution_id='follow-1'").get().state, "expired");
    assert.equal(db.prepare("SELECT state FROM automation_cron_runs WHERE execution_id='follow-2'").get().state, "leased");
  } finally { db.close(); }
});

test("Home subscription and event transmission use actual SDK values, protected original scopes and commit-before-ACK boundaries", () => {
  const plugin = new URL("../../../mobile-assistant/", import.meta.url);
  const sdk = readFileSync(new URL("ios/Sources/HomeKitAccess.swift", plugin), "utf8"), buffer = readFileSync(new URL("ios/Sources/HomeEventBuffer.swift", plugin), "utf8");
  const sender = readFileSync(new URL("ios/Sources/EventDelivery.swift", plugin), "utf8"), bridge = readFileSync(new URL("../os_event_sender.rs", root), "utf8");
  const native = readFileSync(new URL("../home_events.rs", root), "utf8"), privateBridge = readFileSync(new URL("src/lib.rs", plugin), "utf8");
  assert.match(sdk, /HMAccessoryDelegate/); assert.match(sdk, /HMCharacteristicPropertySupportsEventNotification/); assert.match(sdk, /enableNotification\(true\)/);
  assert.match(sdk, /didUpdateValueFor characteristic: HMCharacteristic/); assert.match(sdk, /self.eventTargetStillPresent\(target\)/); assert.match(sdk, /value\.doubleValue == 0 \|\| value\.doubleValue == 1/);
  assert.match(sdk, /targets\.values\.allSatisfy\(\{ \$0\.3\.isNotificationEnabled/); assert.match(sdk, /args\.authorize \|\| args\.homes\.allSatisfy/);
  assert.match(buffer, /completeFileProtectionUntilFirstUserAuthentication/); assert.match(buffer, /ids\.contains\(\$0\.id\)/); assert.match(buffer, /state\.hostId == host/);
  assert.ok(native.indexOf("store.ingest_home_events(&events)?") < native.indexOf("acknowledge_home_events("));
  assert.ok(bridge.indexOf("store.ingest_home_events(&home_events)?") < bridge.indexOf('"acknowledgedHomeEventIds"'));
  assert.match(sender, /HomeEventBuffer\.pending\(host: scope\.hostId\)/); assert.match(sender, /homeIds\.allSatisfy/); assert.match(sender, /HomeEventBuffer\.acknowledge\(homeIds,host: scope\.hostId\)/);
  assert.doesNotMatch(privateBridge, /commands::configure_home_events|commands::pending_home_events|commands::acknowledge_home_events/);
  assert.match(intake, /observed\.as_deref\(\)!=Some\(payload\.as_str\(\)\)/);
  const command = readFileSync(new URL("../../commands/automation/proactive.rs", root), "utf8");
  assert.match(command, /if store\.home_event_sources_allowed\(\)\? \{ match app\.mobile_assistant\(\)\.home_event_sources\(\)/);
  assert.match(intake, /mobile_task_read_requires_approval\(&conn,"home"\)\.is_ok\(\)/);
  assert.match(sdk, /accessoryNamePreview: accessory\.name\.unicodeScalars\.prefix\(64\)/);
  assert.match(buffer, /\$0\.unicodeScalars\.count <= 64/);
  assert.match(intake, /name\.chars\(\)\.count\(\)>64/);
});
