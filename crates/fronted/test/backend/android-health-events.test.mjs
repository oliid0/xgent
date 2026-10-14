import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const pluginRoot = new URL("../../../mobile-assistant/", import.meta.url);
const readPlugin = name => readFileSync(new URL(name, pluginRoot), "utf8");
const androidRoot = "android/src/main/java/com/ohi/xgent/mobileassistant/";
const collector = readPlugin(`${androidRoot}HealthEventCollector.kt`);
const plugin = readPlugin(`${androidRoot}MobileAssistantPlugin.kt`);
const nativeRoot = new URL("../../src-tauri/src/", import.meta.url);
const native = name => readFileSync(new URL(name, nativeRoot), "utf8");
const sql = prefix => {
  const found = [...collector.matchAll(/db\.rawQuery\("([^"\n]+)", null\)/g)].find(match => match[1].startsWith(prefix));
  assert.ok(found, prefix);
  return found[1];
};

test("the Activity-independent health worker reads live policy and enabled rules from the same durable database", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const schema = [...native("services/automation/db.rs").matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)]
      .find(match => match[1].trimStart().startsWith("CREATE TABLE IF NOT EXISTS automation_meta"));
    assert.ok(schema);
    db.exec(schema[1]);
    db.exec(native("services/automation/proactive.sql"));
    db.exec("CREATE TABLE system_settings (setting_key TEXT PRIMARY KEY,payload_json TEXT NOT NULL,updated_at INTEGER NOT NULL)");
    db.prepare("INSERT INTO system_settings VALUES ('toolPolicies',?,0)").run(JSON.stringify({ "personal:health": "deny" }));
    db.prepare("INSERT INTO system_settings VALUES ('executionMode',?,0)").run(JSON.stringify("chat"));
    db.prepare("INSERT INTO system_settings VALUES ('workdir',?,0)").run(JSON.stringify("private unrelated value"));
    const create = db.prepare("INSERT INTO automation_proactive_rules (rule_id,config_json,binding_json,cursor,created_at,enabled) VALUES (?,?,'{}',0,1,?)");
    create.run("heart", JSON.stringify({ eventKind: "health_updated", healthMetric: "heart_rate", sourceTaskId: null }), 1);
    create.run("weight", JSON.stringify({ eventKind: "health_updated", healthMetric: "weight", sourceTaskId: null }), 0);
    const settings = db.prepare(sql("SELECT setting_key,payload_json"));
    const rules = db.prepare(sql("SELECT config_json"));
    assert.deepEqual(settings.all().map(row => row.setting_key).sort(), ["executionMode", "toolPolicies"]);
    assert.deepEqual(rules.all().map(row => JSON.parse(row.config_json).healthMetric), ["heart_rate"]);
    db.exec("BEGIN IMMEDIATE;UPDATE automation_proactive_rules SET enabled=0 WHERE rule_id='heart';UPDATE automation_proactive_rules SET enabled=1 WHERE rule_id='weight'");
    assert.deepEqual(rules.all().map(row => JSON.parse(row.config_json).healthMetric), ["weight"]);
    db.exec("ROLLBACK");
    assert.deepEqual(rules.all().map(row => JSON.parse(row.config_json).healthMetric), ["heart_rate"]);
    db.prepare("UPDATE system_settings SET payload_json=? WHERE setting_key='toolPolicies'").run(JSON.stringify({ "MobilePersonalData": "deny", "personal:health": "allow" }));
    const current = Object.fromEntries(settings.all().map(row => [row.setting_key, JSON.parse(row.payload_json)]));
    assert.equal(current.toolPolicies.MobilePersonalData, "deny");
    assert.ok(collector.includes("SQLiteDatabase.OPEN_READONLY"));
    assert.ok(collector.includes('File(context.applicationInfo.dataDir).canonicalFile.toPath()'));
    assert.ok(collector.includes('file.name == "config.sqlite" && file.isFile'));
    for (const key of ["MobilePersonalData", "group:system", "personal:health", "tools", "agent-dev"]) {
      assert.ok(native("commands/config/settings/system.rs").includes(`"${key}"`));
      assert.ok(collector.includes(`"${key}"`));
    }
  } finally { db.close(); }
});

test("Android health scope is gated by the real feature, actual grants and explicit native action", () => {
  assert.ok(collector.includes("FEATURE_READ_HEALTH_DATA_IN_BACKGROUND"));
  assert.ok(collector.includes("FEATURE_STATUS_AVAILABLE"));
  assert.ok(collector.includes("PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND"));
  assert.ok(collector.includes("getGrantedPermissions().containsAll(requiredPermissions(requested))"));
  assert.ok(collector.includes("args.authorize || requested.all { it in prior.metrics }"));
  assert.ok(plugin.includes("requested - granted"));
  assert.ok(native("commands/automation/proactive.rs").includes("available_health_event_metrics()"));
  assert.ok(native("commands/automation/proactive.rs").includes('window.label()=="agent-worker"'));
  const publicBridge = readPlugin("src/lib.rs");
  for (const command of ["configure_health_events", "pending_health_events", "acknowledge_health_events", "available_health_event_metrics"]) {
    assert.ok(!publicBridge.includes(`commands::${command}`), `private SDK endpoint: ${command}`);
    assert.ok(!readPlugin("build.rs").includes(`"${command}"`));
  }
  assert.ok(readPlugin("android/src/main/AndroidManifest.xml").includes("android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND"));
});

test("SDK cursor advancement and exact-ID acknowledgments preserve metadata across crash and concurrent replacement", () => {
  assert.ok(collector.includes('AtomicFile(File(context.noBackupFilesDir, "xgent-health-events-v1.json"))'));
  assert.ok(collector.includes("file.finishWrite(stream)"));
  assert.ok(collector.includes("file.failWrite(stream)"));
  assert.ok(!collector.includes("readNBytes("), "keep Android API 26 compatibility");
  assert.ok(collector.includes("state = state.copy(tokens = state.tokens + (metric to response.nextChangesToken), pending = pending)\n                        save(context, state)"));
  assert.ok(collector.includes("prior.pending.filter { it.id !in ids }"));
  assert.ok(collector.includes("state.pending.filter { it.metric != metric } + HealthChangeMetadata(UUID.randomUUID().toString()"));
  assert.ok(collector.includes("state = state.copy(tokens = state.tokens - metric)\n                            save(context, state)"));
  assert.ok(collector.includes("for (page in 0 until 10)"));
  const service = native("services/health_events.rs");
  assert.ok(service.indexOf("store.ingest_health_events(&events)?") < service.indexOf("acknowledge_health_events("));
  assert.ok(!collector.includes("response.changes.map"), "sample values must not enter the retained buffer");
});

test("OS worker scheduling confirms acceptance after durable scope and cancellation cannot retain an active grant", () => {
  const saveScope = collector.indexOf("if (next != prior) save(context, next)");
  assert.ok(saveScope > 0 && saveScope < collector.indexOf("enqueueUniquePeriodicWork("));
  assert.ok(collector.includes("ExistingPeriodicWorkPolicy.KEEP"));
  assert.ok(collector.includes("PeriodicWorkRequestBuilder<HealthChangesWorker>(15, TimeUnit.MINUTES)"));
  assert.ok(collector.includes(".result.get(15, TimeUnit.SECONDS)"));
  assert.ok(collector.indexOf("save(context, HealthCollectionState())") < collector.indexOf("cancelUniqueWork("));
  assert.ok(collector.includes("if (metric !in activeMetrics(context, state)) break\n                        val response = client.getChanges(token)"));
  const worker = readPlugin(`${androidRoot}HealthChangesWorker.kt`);
  assert.ok(worker.includes("HealthEventCollector.collect(applicationContext, true)"));
  assert.ok(worker.includes("catch (error: CancellationException) { throw error }"));
  assert.ok(worker.includes("Result.retry()"));
  assert.ok(!worker.includes("Activity"));
  assert.ok(readPlugin("android/build.gradle.kts").includes('implementation("androidx.work:work-runtime:2.9.1")'));
});
