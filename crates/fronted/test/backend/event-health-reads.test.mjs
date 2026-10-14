import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// Execute production SQL. Other assertions inspect native source; they do not
// execute Rust, JNI, C, Swift, HealthKit, Health Connect, permissions or models.
const native = name => readFileSync(new URL(`../../src-tauri/src/${name}`, import.meta.url), "utf8");
const plugin = name => readFileSync(new URL(`../../../mobile-assistant/${name}`, import.meta.url), "utf8");
const source = native("services/automation/store/event_health_reads.rs");
function sql(text, prefix) {
  const literal = [...text.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)]
    .find(entry => entry[1].replace(/\s+/g, " ").trimStart().startsWith(prefix));
  assert.ok(literal, prefix); return literal[1];
}
const run = (db, prefix, args = [], mode = "run") => db.prepare(sql(source, prefix))[mode](...args);
const PHONE = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
function fixture(filename = ":memory:") {
  const db = new DatabaseSync(filename);
  db.exec(sql(native("services/automation/db.rs"), "CREATE TABLE IF NOT EXISTS automation_meta"));
  db.exec(native("services/automation/proactive.sql"));
  db.prepare("INSERT OR IGNORE INTO automation_meta(key,value) VALUES('background_worker_id.v1',?)").run(PHONE);
  return db;
}
function rule(db, id, changes = {}, activated = 100) {
  const config = { eventKind: "health_updated", healthMetric: "heart_rate", backgroundHealthReads: true,
    remoteExecution: { peerId: "pc", providerId: "account", model: "actual", workdir: "/real" }, ...changes };
  db.prepare("INSERT INTO automation_proactive_rules(rule_id,config_json,binding_json,cursor,created_at) VALUES(?,?,'original',0,?)").run(id, JSON.stringify(config), activated);
  db.prepare("INSERT INTO automation_health_rule_activations VALUES(?,?)").run(id, activated);
}
function event(db, id, time = 101, metric = "heart_rate") {
  db.prepare("INSERT INTO automation_health_events(event_id,metric,occurred_at) VALUES(?,?,?)").run(id, metric, time);
}
const candidates = db => run(db, "SELECT r.rule_id,h.event_id FROM automation_proactive_rules", [], "all");
const save = (db, rule, event, hash, payload, time = 200) => run(db,
  "INSERT INTO automation_health_event_snapshots(rule_id,event_id,binding_hash,payload_json,observed_at)", [rule, event, hash, payload, time]);
const read = (db, rule, event, hash) => run(db, "SELECT payload_json FROM automation_health_event_snapshots WHERE", [rule, event, hash], "get")?.payload_json;

test("actual pending-read query requires opt-in, enabled remote rule and original activation; it selects one oldest event per rule", () => {
  const db = fixture(); try {
    rule(db, "actual"); rule(db, "local", { remoteExecution: null });
    rule(db, "default", { backgroundHealthReads: undefined }); rule(db, "manual", { backgroundHealthReads: false });
    rule(db, "late", {}, 500); rule(db, "disabled"); db.exec("UPDATE automation_proactive_rules SET enabled=0 WHERE rule_id='disabled'");
    event(db, "before-activation", 90); event(db, "first"); event(db, "second", 102); event(db, "other-metric", 103, "weight");
    assert.deepEqual(candidates(db).map(row => ({ ...row })), [{ rule_id: "actual", event_id: "first" }]);
    db.exec("UPDATE automation_proactive_rules SET cursor=(SELECT sequence FROM automation_health_events WHERE event_id='first') WHERE rule_id='actual'");
    assert.equal(candidates(db)[0].event_id, "second");
    db.exec("UPDATE automation_proactive_rules SET enabled=0 WHERE rule_id='actual'"); assert.equal(candidates(db).length, 0);
  } finally { db.close(); }
});

test("read candidate SQL stays bounded and fair without pre-reading future events behind an unresolved original event", () => {
  const db = fixture(); try {
    for (let i = 0; i < 25; i++) rule(db, `rule-${i}`, {}, 100 + i);
    for (let i = 0; i < 90; i++) event(db, `event-${i}`, 1000 + i);
    const batch = candidates(db); assert.equal(batch.length, 20);
    assert.equal(new Set(batch.map(row => row.rule_id)).size, 20);
    assert.ok(batch.every(row => row.event_id === "event-0"));
    db.exec("UPDATE automation_proactive_rules SET last_queued_at=10000 WHERE rule_id='rule-0'");
    assert.equal(candidates(db).some(row => row.rule_id === "rule-0"), false);
    assert.match(source, /if pending.len\(\)==4\{break;\}/);
  } finally { db.close(); }
});

test("observation SQL freezes the first result for an exact binding, excludes foreign rule/event/hash and survives reopen", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "xgent-event-health-")); let db = fixture(path.join(directory, "config.sqlite"));
  try {
    const payload = JSON.stringify({ eventId: "event", originHostId: PHONE, result: { samples: [{ value: 88, source: "fixture-only" }] } });
    event(db, "event"); save(db, "rule", "event", "actual-binding", payload);
    save(db, "rule", "event", "actual-binding", '{"samples":"changed"}');
    assert.equal(read(db, "rule", "event", "actual-binding"), payload);
    assert.equal(read(db, "other-rule", "event", "actual-binding"), undefined);
    assert.equal(read(db, "rule", "other-event", "actual-binding"), undefined);
    assert.equal(read(db, "rule", "event", "foreign-binding"), undefined);
    db.close(); db = fixture(path.join(directory, "config.sqlite")); assert.equal(read(db, "rule", "event", "actual-binding"), payload);
    db.exec("BEGIN IMMEDIATE"); save(db, "rule", "event", "revalidated-binding", "{}");
    assert.equal(read(db, "rule", "event", "actual-binding"), undefined); db.exec("ROLLBACK");
    assert.equal(read(db, "rule", "event", "actual-binding"), payload);
    const bytes = run(db, "SELECT COUNT(*),COALESCE(SUM", [], "get");
    assert.equal(Object.values(bytes)[0], 1); assert.equal(Object.values(bytes)[1], Buffer.byteLength(payload));
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("current read-scope SQL excludes disabled/deleted/old-activation events; pruning removes only expired or orphaned observations", () => {
  const db = fixture(); try {
    rule(db, "actual"); event(db, "before", 90); event(db, "event", 101);
    const current = () => run(db, "SELECT r.config_json,r.binding_json,h.metric", ["actual", "event"], "get");
    assert.equal(current().metric, "heart_rate");
    assert.equal(run(db, "SELECT r.config_json,r.binding_json,h.metric", ["actual", "before"], "get"), undefined);
    db.exec("BEGIN IMMEDIATE;UPDATE automation_proactive_rules SET enabled=0"); assert.equal(current(), undefined); db.exec("ROLLBACK");
    save(db, "actual", "event", "binding", "{}", 200); save(db, "orphan", "absent", "binding", "{}", 200);
    run(db, "DELETE FROM automation_health_event_snapshots WHERE observed_at", [100]);
    assert.equal(read(db, "actual", "event", "binding"), "{}"); assert.equal(read(db, "orphan", "absent", "binding"), undefined);
    run(db, "DELETE FROM automation_health_event_snapshots WHERE observed_at", [201]); assert.equal(read(db, "actual", "event", "binding"), undefined);
    db.exec("DELETE FROM automation_proactive_rules"); assert.equal(current(), undefined);
  } finally { db.close(); }
});

test("native source binds read scope to actual original installation, config, template, policy, event and bounded samples", () => {
  assert.match(source, /config.background_health_reads.unwrap_or\(false\)/);
  assert.match(source, /sequence<=cursor/); assert.match(source, /actual!=frozen/);
  assert.match(source, /mobile_task_read_requires_approval\(conn,"health"\)/);
  for (const field of ["owner", "config", "binding", "metric", "startMs", "endMs", "approval"]) assert.ok(source.includes(`"${field}":`));
  assert.match(source, /current_scope\(&tx,&read.scope.rule_id,&read.scope.event_id\)\?\.as_ref\(\)!=Some\(&read.scope\)/);
  assert.match(source, /result.samples.len\(\)>50/); assert.match(source, /!sample.value.is_finite\(\)/);
  assert.match(source, /result.start_ms!=read.scope.start_ms/); assert.match(source, /result.end_ms!=read.scope.end_ms/);
  assert.match(source, /32\*1024\*1024/); assert.match(source, /observed.len\(\)>32768/);
  assert.doesNotMatch(source, /requestAuthorization|permission_request|worker_identity\(&tx\)/);
  const dispatch = native("services/automation/store/proactive.rs");
  assert.match(dispatch, /binding\["backgroundHealthOrigin"\]=serde_json::json!\(origin\)/);
  assert.match(dispatch, /Ok\(current\) if current != frozen => Some\("target_changed"\)/);
  assert.match(dispatch, /background_health_reads.unwrap_or\(false\)[^]*?event_observation[^]*?state="deferred";reason="health_read_pending"/);
  const remote = native("services/automation/store/proactive_remote.rs");
  assert.match(remote, /if observed.is_none\(\)\{return Ok\(false\);\}/);
  assert.match(remote, /if health_observation.is_some\(\)[^]*?locality:"portable"[^]*?else if let Some\(metric\)/);
  assert.match(remote, /locality:"initiating-device"/); // Original per-task review remains.
  assert.ok(remote.indexOf("health_observation=") < remote.indexOf("Uuid::new_v4()"));
  const foreground = native("services/health_events.rs");
  assert.match(foreground, /pending_event_health_reads\(\)[^]*?scope.sample_request\(\)[^]*?read_health_samples\(request\)[^]*?commit_event_health_reads\(&\[scope.observation\(actual\)\]\)/);
  assert.ok(foreground.indexOf("let after=") < foreground.indexOf("scope.observation(actual)"));
  assert.doesNotMatch(foreground, /request_health_metric_permission/);
});

test("Android source uses actual Health Connect samples and rechecks saved metric, policy and background SDK grants without opening a sheet", () => {
  const collector = plugin("android/src/main/java/com/ohi/xgent/mobileassistant/HealthEventCollector.kt");
  const block = collector.slice(collector.indexOf("internal suspend fun readEventSamples"), collector.indexOf("internal suspend fun acknowledge"));
  assert.match(block, /metric in prior.metrics && metric in activeMetrics/);
  assert.match(block, /requiredPermissions\(listOf\(metric\)\)/);
  assert.match(block, /readHealthMetricSamples/); assert.match(block, /limit = 50/);
  assert.match(block, /current.policyDatabase == prior.policyDatabase/);
  assert.match(block, /getGrantedPermissions\(\).containsAll\(required\)/);
  assert.doesNotMatch(block, /requestPermissions|requestAuthorization|startActivity/);
  const worker = plugin("android/src/main/java/com/ohi/xgent/mobileassistant/EventDeliveryWorker.kt");
  assert.match(worker, /withTimeoutOrNull\(2000\)/); assert.match(worker, /"healthReads", reads/);
  assert.ok(worker.indexOf("healthScopes(") < worker.indexOf("NativeEventSender.sync("));
});

test("iOS source runs bounded real sample queries, preserves limited/empty data and cancels late work without requesting OS authorization", () => {
  const reader = plugin("ios/Sources/NativeHealthReader.swift");
  assert.match(reader, /HKSampleQuery[^]*?limit: 51/); assert.match(reader, /quantities.prefix\(50\)/);
  assert.match(reader, /strictStartDate, .strictEndDate/); assert.match(reader, /sample.sourceRevision.source.bundleIdentifier/);
  assert.match(reader, /accessLimited: true/); assert.match(reader, /store.stop\(pending\)/);
  assert.match(reader, /query = value; store.execute\(value\); lock.unlock\(\)/);
  assert.match(reader, /defer \{ attempt.finish\(\) \}/);
  const observer = plugin("ios/Sources/HealthEventObserver.swift");
  const block = observer.slice(observer.indexOf("func readNative"), observer.indexOf("func acknowledgeNative"));
  assert.match(block, /getRequestStatusForAuthorization/); assert.match(block, /status == .unnecessary/);
  assert.match(block, /self.state.metrics.contains\(scope.metric\)/); assert.match(block, /scope.endMs - scope.startMs <= 600000/);
  assert.doesNotMatch(block, /requestAuthorization\(/);
  const worker = plugin("ios/Sources/EventDelivery.swift");
  assert.match(worker, /xgent_event_health_scopes_v1/); assert.match(worker, /scopes.count <= 4/);
  assert.match(worker, /attempt.cancel\(\)/); assert.match(worker, /healthReads: healthReads/);
  assert.match(worker, /min\(2, run.remaining\)/);
  assert.match(native("services/ios_result_receiver.rs"), /text\(events,160\*1024\)/);
});
