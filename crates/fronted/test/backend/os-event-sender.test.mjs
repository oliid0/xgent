import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// Production SQLite is executed below. Native linking, OS scheduling, SDK
// permissions, Stronghold and real paired HTTP are not executed by these tests.
const native = name => readFileSync(new URL(`../../src-tauri/src/${name}`, import.meta.url), "utf8");
const plugin = name => readFileSync(new URL(`../../../mobile-assistant/${name}`, import.meta.url), "utf8");
const android = name => plugin(`android/src/main/java/com/ohi/xgent/mobileassistant/${name}.kt`);
const scope = native("services/automation/store/event_sender.rs");
const submissions = native("services/automation/store/submission.rs");
const remote = native("services/automation/store/proactive_remote.rs");
const sender = native("services/os_event_sender.rs");
const PHONE = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const PC = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
function sql(source, prefix) {
  const literal = [...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)]
    .find(entry => entry[1].replace(/\s+/g, " ").trimStart().startsWith(prefix));
  assert.ok(literal, prefix);
  return literal[1];
}
const run = (db, source, prefix, args = [], mode = "run") => db.prepare(sql(source, prefix))[mode](...args);
const scalar = row => Object.values(row)[0];
function open(file = ":memory:") {
  const db = new DatabaseSync(file);
  db.exec(sql(native("services/automation/db.rs"), "CREATE TABLE IF NOT EXISTS automation_meta"));
  db.exec(native("services/automation/proactive.sql"));
  db.prepare("INSERT OR IGNORE INTO automation_meta (key,value) VALUES ('background_worker_id.v1',?)").run(PHONE);
  return db;
}
function stage(db, id, { event = true, owner = PHONE, source = PC, mappedSource = source } = {}) {
  run(db, submissions, "INSERT INTO automation_submission_outbox", [id, owner, source,
    JSON.stringify({ requestId: id, name: "Saved task", prompt: "Original", providerId: "actual", model: "same-name", files: [] }), "null", 100]);
  if (event) run(db, remote, "INSERT INTO automation_proactive_remote_deliveries",
    [`rule-${id}`, -1, id, mappedSource, owner, "target", "frozen", 100, 100000]);
}
const claim = (db, events = true, now = 100) => run(db, submissions,
  "SELECT source_host_id, input_json, CASE WHEN cancel_requested = 1 THEN cancel_json ELSE result_json END, cancel_requested FROM automation_submission_outbox WHERE ((",
  [PHONE, now, null, events ? 1 : 0], "all");
const pending = db => Boolean(scalar(run(db, scope, "SELECT EXISTS(SELECT 1 FROM automation_proactive_remote_deliveries d JOIN", [], "get")));
const active = db => Boolean(scalar(run(db, scope, "SELECT EXISTS(SELECT 1 FROM automation_proactive_rules WHERE", [], "get")));

test("OS event metadata binds the actual connected database and original identity, survives reopen and respects transactional revocation", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "xgent-os-event-"));
  const filename = path.join(directory, "config.sqlite"); let db = open(filename);
  try {
    const actual = scalar(run(db, scope, "SELECT file FROM pragma_database_list", [], "get"));
    assert.equal(realpathSync(actual), realpathSync(filename));
    const record = { version: 1, databasePath: realpathSync(filename), hostId: PHONE, enabled: true };
    run(db, scope, "INSERT INTO automation_meta (key,value) VALUES ('event_sender_scope.v1'", [JSON.stringify(record)]);
    db.close(); db = open(filename);
    const read = () => JSON.parse(scalar(run(db, scope, "SELECT value FROM automation_meta WHERE key='event_sender_scope.v1'", [], "get")));
    assert.deepEqual(read(), record);
    assert.equal(scalar(run(db, scope, "SELECT value FROM automation_meta WHERE key='background_worker_id.v1'", [], "get")), PHONE);
    db.exec("BEGIN IMMEDIATE");
    run(db, scope, "INSERT INTO automation_meta (key,value) VALUES ('event_sender_scope.v1'", [JSON.stringify({ ...record, enabled: false })]);
    assert.equal(read().enabled, false); db.exec("ROLLBACK"); assert.equal(read().enabled, true);
    run(db, scope, "INSERT INTO automation_meta (key,value) VALUES ('event_sender_scope.v1'", [JSON.stringify({ ...record, enabled: false })]);
    db.close(); db = open(filename); assert.equal(read().enabled, false);
    assert.deepEqual(Object.keys(read()).sort(), ["databasePath", "enabled", "hostId", "version"]);
    const empty = new DatabaseSync(":memory:");
    try { assert.equal(scalar(run(empty, scope, "SELECT file FROM pragma_database_list", [], "get")), ""); }
    finally { empty.close(); }
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("default local rules do not enable event sending; only an explicit enabled remote rule does", () => {
  const db = open(); try {
    const add = db.prepare("INSERT INTO automation_proactive_rules(rule_id,config_json,binding_json,cursor,created_at,enabled) VALUES (?,?,'{}',0,100,?)");
    add.run("local", JSON.stringify({ eventKind: "run_failed" }), 1);
    add.run("null", JSON.stringify({ remoteExecution: null }), 1);
    add.run("disabled", JSON.stringify({ remoteExecution: { peerId: PC } }), 0);
    assert.equal(active(db), false); assert.equal(pending(db), false);
    db.exec("UPDATE automation_proactive_rules SET enabled=1 WHERE rule_id='disabled'"); assert.equal(active(db), true);
    db.exec("UPDATE automation_proactive_rules SET enabled=0"); assert.equal(active(db), false);
  } finally { db.close(); }
});

test("event sender remains enabled for only its owned outstanding admission or cancellation, never copied or withdrawn work", () => {
  const db = open(); try {
    stage(db, "root", { event: false }); stage(db, "foreign", { owner: PC });
    stage(db, "wrong-target", { mappedSource: PHONE }); assert.equal(pending(db), false);
    stage(db, "event"); assert.equal(pending(db), true);
    db.exec("UPDATE automation_submission_outbox SET result_json='{}' WHERE request_id='event'"); assert.equal(pending(db), false);
    db.exec("UPDATE automation_submission_outbox SET cancel_requested=1 WHERE request_id='event'"); assert.equal(pending(db), true);
    db.exec("UPDATE automation_submission_outbox SET cancel_json='{}' WHERE request_id='event'"); assert.equal(pending(db), false);
    db.exec("UPDATE automation_submission_outbox SET cancel_json=NULL WHERE request_id='event';UPDATE automation_proactive_remote_deliveries SET locally_withdrawn=1 WHERE request_id='event'");
    assert.equal(pending(db), false);
  } finally { db.close(); }
});

test("event-only outbox claims preserve ordinary single-device requests and exclude changed ownership, targets and withdrawn intents", () => {
  const db = open(); try {
    stage(db, "root", { event: false }); stage(db, "foreign", { owner: PC });
    stage(db, "wrong", { mappedSource: PHONE }); stage(db, "withdrawn"); stage(db, "actual");
    db.exec("UPDATE automation_proactive_remote_deliveries SET locally_withdrawn=1 WHERE request_id='withdrawn'");
    assert.deepEqual(claim(db).map(row => JSON.parse(row.input_json).requestId), ["actual"]);
    assert.deepEqual(claim(db, false).map(row => JSON.parse(row.input_json).requestId), ["root", "wrong", "actual"]);
    db.exec("UPDATE automation_submission_outbox SET cancel_requested=1,result_json='{}' WHERE request_id='actual'");
    assert.equal(claim(db)[0].cancel_requested, 1);
    assert.equal(Object.values(claim(db)[0])[2], null, "an acceptance is not a cancellation acknowledgement");
    db.exec("UPDATE automation_submission_outbox SET cancel_json='{}' WHERE request_id='actual'"); assert.equal(claim(db).length, 0);
  } finally { db.close(); }
});

test("OS event claim reserves at most four original packets, rolls back atomically and retains bounded retry across attempts", () => {
  const db = open(); try {
    for (let i = 0; i < 6; i++) stage(db, `event-${i}`);
    const reserve = () => {
      const batch = claim(db);
      for (const row of batch) run(db, submissions, "UPDATE automation_submission_outbox SET retry_at", [JSON.parse(row.input_json).requestId, 100]);
      return batch.map(row => row.input_json);
    };
    db.exec("BEGIN IMMEDIATE"); const original = reserve(); assert.equal(original.length, 4); assert.equal(claim(db).length, 2);
    db.exec("ROLLBACK"); assert.deepEqual(claim(db).map(row => row.input_json), original);
    db.exec("BEGIN IMMEDIATE"); reserve(); db.exec("COMMIT");
    assert.equal(claim(db).length, 2); assert.equal(claim(db, true, 60100).length, 4);
    const row = db.prepare("SELECT probes,retry_at,input_json FROM automation_submission_outbox WHERE request_id='event-0'").get();
    assert.equal(row.probes, 1); assert.equal(row.retry_at, 60100); assert.equal(row.input_json, original[0]);
  } finally { db.close(); }
});

test("native sender source reopens existing credentials and checks the original installation before metadata intake", () => {
  const vault = native("services/cloud_secret_vault.rs");
  const reopen = vault.slice(vault.indexOf("pub(crate) fn open_existing"), vault.indexOf("pub fn new("));
  assert.match(reopen, /canonicalize[\s\S]*validate_device_key[\s\S]*load_client/);
  assert.doesNotMatch(reopen, /create_client|load_or_create|create_dir_all|\.save\(/);
  const identity = vault.slice(vault.indexOf("pub(crate) fn existing_worker_host_identity"), vault.indexOf("pub(crate) fn worker_host_identity"));
  assert.doesNotMatch(identity, /new_v4|\.save\(|\.insert\(/);
  assert.ok(sender.indexOf("vault.existing_worker_host_identity()?") < sender.indexOf("store.ingest_health_events"));
  assert.match(scope, /scope.version!=1 \|\| scope.enabled!=enabled \|\| scope.host_id!=host \|\| actual!=host \|\| scope.database_path!=path/);
  assert.match(scope, /canonicalize\(actual_file\)[^]*?!=path/);
  const shared = native("services/mobile_worker_runtime.rs");
  assert.match(shared, /Weak::upgrade/); assert.match(shared, /Arc::as_ptr\(vault\)/);
  assert.match(shared, /if create \{CloudSecretVault::new[^]*?else \{CloudSecretVault::open_existing/);
  assert.match(native("lib.rs"), /mobile_worker_runtime::vault\(&app_data_dir,true\)/);
  assert.match(native("lib.rs"), /mobile_worker_runtime::peers\(vault\)/);
  const peers = native("services/worker_peers.rs");
  assert.match(peers, /bind_result_delivery_store[^]*?self.bind_delivery_store\(store,false\)/);
  assert.match(peers, /bind_os_result_delivery_store[^]*?self.bind_delivery_store\(store,true\)/);
  assert.match(peers, /if preserve_live \{return Ok\(\(\)\);\}/);
  assert.match(sender, /registry.bind_os_result_delivery_store\(&store\)/);
});

test("native sender source preserves actual event gates and a single future through cancellation; it cannot run local models", () => {
  assert.match(sender, /active_health_event_metrics\(\)[^]*?ingest_health_events\(&events\)[^]*?dispatch_proactive_remote_rules\(credential_root\)/);
  assert.match(sender, /claim_event_submissions\(\)/); assert.doesNotMatch(sender, /claim_background_submissions\(/);
  assert.match(sender, /validate_event_sender_scope[^]*?reconcile_proactive_remote_submissions[^]*?current.cancel_requested!=pending.cancel_requested/);
  assert.match(sender, /receive_background_result[^]*?complete_background_submission/);
  assert.match(sender, /let mut work=Box::pin\(work\);[^]*?loop[^]*?timeout\(slice,work.as_mut\(\)\)/);
  assert.match(sender, /before admission/); assert.match(sender, /before claim/);
  assert.doesNotMatch(sender, /Builder::default|permission_request|start_worker|create_client|enqueue_goal_followup/);
  assert.match(native("services/automation/store/proactive.rs"), /remote_only && config.remote_execution.is_none\(\)\{continue;\}/);
  const ack = sender.slice(sender.indexOf("pub(super) fn acknowledge_targets"), sender.indexOf('#[cfg(target_os="android")]'));
  assert.match(ack, /open_os_result_receiver/); assert.doesNotMatch(ack, /open_os_event_sender|registry.invoke/);
  assert.doesNotMatch(native("services/os_result_receiver.rs"), /os_event_sender|claim_event_submissions|dispatch_proactive_remote_rules/);
});

test("Android event source wiring schedules independent unique native work, releases only committed metadata and stores result grants before ACK", () => {
  const setup = android("EventDelivery"), worker = android("EventDeliveryWorker");
  assert.match(setup, /noBackupFilesDir/); assert.match(setup, /SQLiteDatabase.OPEN_READONLY/);
  assert.match(setup, /event_sender_scope.v1/); assert.match(setup, /ExistingPeriodicWorkPolicy.KEEP/);
  assert.match(setup, /PeriodicWorkRequestBuilder<EventDeliveryWorker>\(15, TimeUnit.MINUTES\)/);
  assert.match(setup, /cancelUniqueWork\(PERIODIC\)/); assert.match(setup, /cancelUniqueWork\(IMMEDIATE\)/);
  assert.match(worker, /if \(isStopped\) return@withContext null/);
  assert.match(worker, /acknowledged.all \{ id -> events.any/);
  assert.ok(worker.indexOf("NativeEventSender.sync") < worker.indexOf("HealthEventCollector.acknowledge"));
  assert.match(worker, /if \(acknowledged.isNotEmpty\(\)\) HealthEventCollector.acknowledge/);
  assert.ok(setup.indexOf("ResultDelivery.configure(context") < setup.indexOf("NativeEventSender.acknowledge"));
  assert.match(worker, /value.getBoolean\("success"\) && !isStopped/);
  assert.match(worker, /CancellationException\) \{ throw error \}/);
  assert.match(sender, /NativeEventSender_sync[^]*?"isStopped","\(\)Z"/);
  assert.match(plugin("android/consumer-rules.pro"), /NativeEventSender/);
  assert.doesNotMatch(android("ResultDeliveryWorker"), /NativeEventSender|HealthEventCollector|EventDeliveryWorker/);
});

test("iOS event source wiring registers early, retains protected metadata and respects the OS expiration callback", () => {
  const worker = plugin("ios/Sources/EventDelivery.swift");
  const lib = plugin("src/lib.rs");
  assert.match(lib, /let results=xgent_result_delivery_register_v1\(\)==1;[^]*?let events=xgent_event_delivery_register_v1\(\)==1;/);
  assert.match(worker, /Thread.isMainThread/); assert.match(worker, /xgent.event.refresh.v1/);
  assert.match(native("../Info.ios.plist"), /<string>xgent.event.refresh.v1<\/string>/);
  assert.match(worker, /completeUntilFirstUserAuthentication/); assert.match(worker, /values.isExcludedFromBackup = true/);
  assert.match(worker, /task.expirationHandler = \{ run.cancel\(\) \}/);
  assert.match(worker, /Unmanaged.passRetained\(run\)/); assert.match(worker, /fromOpaque\(context\).release\(\)/);
  assert.match(worker, /defer \{ xgent_release_result\(reply\) \}/);
  assert.match(worker, /ids.allSatisfy\(\{ id in events.contains/);
  assert.match(worker, /ResultDelivery.acceptEventTargets/);
  const results = plugin("ios/Sources/ResultDelivery.swift");
  const handoff = results.slice(results.indexOf("static func acceptEventTargets"), results.indexOf("private static func encode"));
  assert.ok(handoff.indexOf("saveTargets(scope") < handoff.indexOf("xgent_event_results_ack_v1"));
  assert.ok(handoff.indexOf("scheduleIfNeeded()") < handoff.indexOf("xgent_event_results_ack_v1"));
  const observer = plugin("ios/Sources/HealthEventObserver.swift");
  const ack = observer.slice(observer.indexOf("func acknowledgeNative"), observer.indexOf("func acknowledge(_"));
  assert.ok(ack.indexOf("if ids.isEmpty") < ack.indexOf("self.save(next)"));
  assert.ok(ack.indexOf("self.loadError") < ack.indexOf("self.save(next)"));
  assert.match(observer, /static let shared = HealthEventObserver\(\)/); assert.match(observer, /EventDelivery.kick\(\)/);
});

test("event setup and native callback capabilities are private and the existing read-only result callback stays separate", () => {
  for (const file of ["src/commands.rs", "build.rs", "src/lib.rs"]) {
    assert.doesNotMatch(plugin(file), /commands::configure_event_delivery|"configure_event_delivery"/);
  }
  assert.match(plugin("src/mobile.rs"), /run_mobile_plugin\("configureEventDelivery",request\)/);
  const ffi = native("services/ios_result_receiver.rs");
  const header = plugin("ios/Bridge/include/XgentResultReceiverBridge.h");
  for (const name of ["xgent_event_scope_v1", "xgent_event_sync_v1", "xgent_event_results_ack_v1"]) {
    assert.match(ffi, new RegExp(`fn ${name}\\(`)); assert.ok(header.includes(`${name}(`));
  }
  assert.match(ffi, /text\(events,16384\)/); assert.match(sender, /events.len\(\)>5/);
  assert.match(sender, /targets.len\(\)>2/);
  assert.match(native("services/health_events.rs"), /os_event_sender::configure\(app,store\)[^]*?set_event_sender_error/);
});
