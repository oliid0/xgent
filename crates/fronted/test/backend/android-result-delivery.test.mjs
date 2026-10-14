import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// Executes the actual Kotlin/native SQL and database schema. It does not
// compile Kotlin, schedule Android jobs or exercise NotificationManager.
const native = name => readFileSync(new URL(`../../src-tauri/src/${name}`, import.meta.url), "utf8");
const plugin = name => readFileSync(new URL(`../../../mobile-assistant/${name}`, import.meta.url), "utf8");
const root = "android/src/main/java/com/ohi/xgent/mobileassistant/";
const delivery = plugin(`${root}ResultDelivery.kt`);
const normalize = value => value.replace(/\s+/g, " ").trim();
const rustSQL = (source, prefix) => {
  const match = [...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(value => normalize(value[1]).startsWith(prefix));
  assert.ok(match, prefix);return match[1];
};
const kotlinSQL = prefix => {
  const match = [...delivery.matchAll(/"""([\s\S]*?)"""|"([^"\r\n]+)"/g)]
    .map(value => value[1] ?? value[2]).find(value => normalize(value).startsWith(prefix));
  assert.ok(match, prefix);return match;
};
const schema = rustSQL(native("services/automation/db.rs"), "CREATE TABLE IF NOT EXISTS automation_meta");
const candidateSQL = kotlinSQL("SELECT i.entry_id FROM automation_result_inbox i WHERE i.read_at IS NULL");
const readySQL = kotlinSQL("SELECT i.entry_id FROM automation_result_inbox i WHERE i.entry_id = ?1");
const acceptedSQL = kotlinSQL("INSERT OR IGNORE INTO automation_result_notifications");
const ownerSQL = kotlinSQL("SELECT value FROM automation_meta");
const owner = randomUUID();
function fixture(filename = ":memory:") {
  const db = new DatabaseSync(filename);db.exec(schema);
  db.prepare("INSERT OR IGNORE INTO automation_meta VALUES ('background_worker_id.v1', ?)").run(owner);
  return db;
}
function notice(db, request = randomUUID()) {
  const id = randomUUID();
  db.prepare("INSERT INTO automation_result_inbox (entry_id,source_host_id,request_id,content_hash,payload_json,received_at) VALUES (?, 'original-pc', ?, ?, ?, 100)")
    .run(id, request, randomUUID(), JSON.stringify({requestId:request,output:"Private result must not enter OS notice"}));
  return {id,request};
}
const pending = db => db.prepare(candidateSQL).all(20).map(row => row.entry_id);

test("OS worker candidate SQL matches native ownership selection and fairly drains actual retained receipts", () => {
  assert.equal(normalize(candidateSQL),normalize(rustSQL(native("services/automation/store/inbox_notifications.rs"),"SELECT i.entry_id FROM")));
  const db=fixture();try {
    const entries=Array.from({length:45},()=>notice(db));
    for(let offset=0;offset<entries.length;offset+=20){
      const batch=pending(db);assert.deepEqual(batch,entries.slice(offset,offset+20).map(entry=>entry.id));
      for(const id of batch)db.prepare(acceptedSQL).run(id,200);
    }
    assert.deepEqual(pending(db),[]);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_result_inbox WHERE read_at IS NULL").get().n,45);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_result_responses").get().n,0);
  }finally{db.close();}
});

test("fresh worker ready SQL excludes read, superseded, foreign and already OS-accepted entries",()=>{
  const db=fixture(),other=fixture();try{
    const previous=notice(db),read=notice(db),accepted=notice(db);
    const chosen=pending(db);const newer=notice(db,previous.request);
    db.prepare("UPDATE automation_result_inbox SET read_at=300 WHERE entry_id=?").run(read.id);
    db.prepare(acceptedSQL).run(accepted.id,200);
    for(const id of chosen)assert.equal(db.prepare(readySQL).get(id),undefined);
    assert.ok(db.prepare(readySQL).get(newer.id));assert.equal(other.prepare(readySQL).get(newer.id),undefined);
    assert.equal(db.prepare(acceptedSQL).run("unknown",200).changes,0);
    assert.equal(db.prepare(ownerSQL).get().value,owner);
    other.prepare("UPDATE automation_meta SET value=? WHERE key='background_worker_id.v1'").run(randomUUID());
    assert.notEqual(other.prepare(ownerSQL).get().value,owner);
  }finally{db.close();other.close();}
});

test("portable OS acceptance retains its first time and native duplicate acknowledgment cannot mark a result read",()=>{
  const db=fixture();try{
    const entry=notice(db),payload=db.prepare("SELECT payload_json FROM automation_result_inbox WHERE entry_id=?").get(entry.id).payload_json;
    db.prepare(acceptedSQL).run(entry.id,200);db.prepare(acceptedSQL).run(entry.id,300);
    db.prepare(rustSQL(native("services/automation/store/inbox_notifications.rs"),"INSERT INTO automation_result_notifications")).run(entry.id,400);
    assert.equal(db.prepare("SELECT accepted_at FROM automation_result_notifications WHERE entry_id=?").get(entry.id).accepted_at,200);
    const actual=db.prepare("SELECT payload_json,read_at FROM automation_result_inbox WHERE entry_id=?").get(entry.id);
    assert.equal(actual.read_at,null);assert.equal(actual.payload_json,payload);
  }finally{db.close();}
});

test("interrupted SQLite acceptance remains pending across reopen and the retained OS journal can complete the same identity",()=>{
  const directory=mkdtempSync(path.join(tmpdir(),"xgent-os-result-")),filename=path.join(directory,"config.sqlite");let db;
  try{
    db=fixture(filename);const entry=notice(db);
    db.exec("BEGIN IMMEDIATE");db.prepare(acceptedSQL).run(entry.id,200);db.exec("ROLLBACK");
    db.close();db=new DatabaseSync(filename);
    assert.deepEqual(pending(db),[entry.id]);assert.equal(db.prepare(ownerSQL).get().value,owner);
    db.prepare(acceptedSQL).run(entry.id,300);db.close();db=new DatabaseSync(filename);
    assert.deepEqual(pending(db),[]);assert.equal(db.prepare("SELECT accepted_at FROM automation_result_notifications").get().accepted_at,300);
    assert.equal(db.prepare("SELECT read_at FROM automation_result_inbox").get().read_at,null);
  }finally{db?.close();unlinkSync(filename);rmdirSync(directory);}
});

test("the worker write transaction fences a concurrent read/superseding write until the original notice receipt commits",()=>{
  const directory=mkdtempSync(path.join(tmpdir(),"xgent-os-result-lock-")),filename=path.join(directory,"config.sqlite");let db,second;
  try{
    db=fixture(filename);const entry=notice(db);second=new DatabaseSync(filename);second.exec("PRAGMA busy_timeout=0");
    db.exec("BEGIN IMMEDIATE");assert.ok(db.prepare(readySQL).get(entry.id));
    assert.throws(()=>second.prepare("UPDATE automation_result_inbox SET read_at=300 WHERE entry_id=?").run(entry.id),/locked/);
    db.prepare(acceptedSQL).run(entry.id,200);db.exec("COMMIT");
    second.prepare("UPDATE automation_result_inbox SET read_at=300 WHERE entry_id=?").run(entry.id);
    assert.equal(db.prepare(readySQL).get(entry.id),undefined);
  }finally{second?.close();db?.close();unlinkSync(filename);rmdirSync(directory);}
});

test("Android cached notice phase is privately configured, shares the actual platform journal and needs no UI/model permissions",()=>{
  const worker=plugin(`${root}ResultDeliveryWorker.kt`),notices=plugin(`${root}ResultNotifications.kt`);
  const service=native("services/result_receiver.rs"),bridge=plugin("src/mobile.rs");
  assert.match(worker,/Worker\(context, parameters\)/);assert.match(worker,/applicationContext/);assert.match(worker,/isStopped/);
  assert.doesNotMatch(worker+delivery,/invokeNative|Activity|http[s]?:|apiKey|requestPermissions|payload_json|model|HealthConnect/);
  assert.match(delivery,/noBackupFilesDir/);assert.match(delivery,/AtomicFile/);assert.match(delivery,/candidate\.isFile/);
  assert.match(delivery,/prior == null \|\| prior == scope/);assert.match(delivery,/verifyOwner\(db, scope\)/);
  assert.match(delivery,/ExistingPeriodicWorkPolicy.KEEP/);assert.match(delivery,/PeriodicWorkRequestBuilder<ResultDeliveryWorker>\(15/);
  assert.match(delivery,/beginTransactionNonExclusive/);assert.match(delivery,/ENABLE_WRITE_AHEAD_LOGGING/);assert.match(delivery,/PRAGMA synchronous=FULL/);
  assert.match(delivery,/rows.getInt\(0\) == 2/);assert.match(delivery,/finally \{ db.endTransaction\(\) \}/);
  assert.ok(delivery.indexOf("if (stopped()) return false",delivery.indexOf("val ready ="))<delivery.indexOf("ResultNotifications.postRetained"));
  assert.match(notices,/@Synchronized[\s\S]*postRetained\(context: Context/);
  assert.match(notices,/context.checkSelfPermission\(Manifest.permission.POST_NOTIFICATIONS\)/);
  assert.match(notices,/receipts.getBoolean\(tag, false\).*return "accepted"/);
  assert.match(notices,/receipts.edit\(\).putBoolean\(tag, true\).commit\(\)/);
  assert.ok(notices.indexOf("receipts.edit()")>notices.indexOf("manager.notify(tag, 0, notice)"));
  assert.match(service,/target_os="android"/);assert.match(service,/host_id: store.background_worker_identity\(\)\?/);
  assert.match(service,/Ok\(Ok\(\(\)\)\) => os_delivery_ready = true/);assert.match(bridge,/run_mobile_plugin\("configureResultDelivery", request\)/);
  assert.doesNotMatch(plugin("build.rs")+plugin("src/commands.rs"),/configure_result_delivery|configureResultDelivery/);
});
