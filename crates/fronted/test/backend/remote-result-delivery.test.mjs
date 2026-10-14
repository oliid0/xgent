import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// Actual production schema/SQL. These cases do not compile Rust/Kotlin,
// execute JNI/HTTP/Keystore/WorkManager or prove real mobile delivery timing.
const native = name => readFileSync(new URL(`../../src-tauri/src/${name}`, import.meta.url), "utf8");
const mobile = name => readFileSync(new URL(`../../../mobile-assistant/${name}`, import.meta.url), "utf8");
const source = native("services/automation/store/result_delivery.rs");
const inbox = native("services/automation/store/inbox.rs");
const normalize = value => value.replace(/\s+/g, " ").trim();
function sql(text, prefix) {
  const value = [...text.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)]
    .map(item => item[1]).find(value => normalize(value).startsWith(prefix));
  assert.ok(value, prefix);return value;
}
const query = prefix => sql(source, prefix);
const run = (db, statement, values = [], method = "run") => db.prepare(statement)[method](
  Object.fromEntries(values.map((value, index) => [String(index + 1), value])));
const host = randomUUID(), receiver = randomUUID(), device = randomUUID();
const capability = "ab".repeat(32), digest = createHash("sha256").update(capability).digest("hex");
function fixture(filename = ":memory:") {
  const db = new DatabaseSync(filename);
  db.exec(sql(native("services/automation/db.rs"), "CREATE TABLE IF NOT EXISTS automation_meta"));
  db.exec(native("services/automation/result_delivery.sql"));
  const paired = native("commands/config/settings/db.rs").match(/CREATE TABLE IF NOT EXISTS local_access_devices[\s\S]*?\);/)[0];
  db.exec(paired);
  db.prepare("INSERT INTO automation_meta VALUES ('background_worker_id.v1',?)").run(receiver);
  db.prepare("INSERT INTO local_access_devices (device_id,label,session_hash,csrf_hash,created_at,last_seen_at,expires_at) VALUES (?,'original','full-session-hash','csrf',0,0,100000)").run(device);
  return db;
}
function watch(db, request = randomUUID(), sourceHost = host) {
  db.prepare("INSERT INTO automation_result_watches (request_id,source_host_id) VALUES (?,?)").run(request, sourceHost);
  return request;
}
function setup(db, request, hash = "original-target-hash") {
  run(db, query("INSERT INTO automation_result_delivery_targets"), [request,host,100,1]);
  run(db, query("UPDATE automation_result_delivery_targets SET binding_hash"), [request,host,hash]);
  assert.equal(run(db, query("UPDATE automation_result_delivery_targets SET configured"), [request,host,hash,300000]).changes, 1);
}
const readGrant = (db,request,scope=receiver,now=100,session=device) => run(db, query("SELECT g.token_hash"), [request,scope,session,now], "get");
const owns = (db,request,binding="original-target-hash",local=receiver,sourceHost=host) => Boolean(
  Object.values(run(db, sql(inbox,"SELECT EXISTS(SELECT 1 FROM automation_meta m JOIN automation_result_delivery_targets"),
    [local,request,sourceHost,binding], "get"))[0]);

test("scoped grant SQL binds only the original task/receiver/session and stores no bearer plaintext", () => {
  const db = fixture(), request = randomUUID();try {
    const issue = query("INSERT INTO automation_result_read_grants");
    run(db,issue,[device,request,receiver,digest,100000]);
    assert.equal(readGrant(db,request).token_hash,digest);
    assert.equal(readGrant(db,randomUUID()),undefined);
    assert.equal(readGrant(db,request,randomUUID()),undefined);
    assert.equal(readGrant(db,request,receiver,100,randomUUID()),undefined);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_result_read_grants").get().n,1);
    assert.equal(run(db,issue,[device,request,receiver,digest,100000]).changes,1);
    const row = db.prepare("SELECT * FROM automation_result_read_grants").get();
    assert.equal(row.token_hash,digest);assert.doesNotMatch(JSON.stringify(row),new RegExp(capability));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_result_watches").get().n,0);
  } finally {db.close();}
});

test("revoking or expiring the paired session immediately invalidates its scoped task read without bearer rotation", () => {
  const db=fixture(),request=randomUUID();try {
    run(db,query("INSERT INTO automation_result_read_grants"),[device,request,receiver,digest,100000]);
    db.prepare("UPDATE local_access_devices SET revoked_at=200").run();assert.equal(readGrant(db,request),undefined);
    db.prepare("UPDATE local_access_devices SET revoked_at=NULL,expires_at=50").run();assert.equal(readGrant(db,request),undefined);
    db.prepare("UPDATE local_access_devices SET expires_at=100000").run();assert.equal(readGrant(db,request,receiver,100000),undefined);
    db.exec("DELETE FROM local_access_devices");assert.equal(readGrant(db,request),undefined);
    run(db,query("DELETE FROM automation_result_read_grants"),[100]);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_result_read_grants").get().n,0);
  } finally {db.close();}
});

test("foreground grant setup is bounded and fair, backs off before network, and refreshes available LAN endpoints", () => {
  const db=fixture();try {
    const requests=Array.from({length:7},()=>watch(db));watch(db,randomUUID(),receiver);
    const candidates=query("SELECT w.request_id,w.source_host_id,COALESCE(t.probes,0)");
    const first=run(db,candidates,[receiver,0],"all");assert.equal(first.length,2);
    db.exec("BEGIN IMMEDIATE");for(const row of first)run(db,query("INSERT INTO automation_result_delivery_targets"),[row.request_id,host,60000,1]);db.exec("COMMIT");
    assert.ok(run(db,candidates,[receiver,0],"all").every(row=>!first.some(prior=>prior.request_id===row.request_id)));
    for(const row of first){run(db,query("UPDATE automation_result_delivery_targets SET binding_hash"),[row.request_id,host,"ready"]);run(db,query("UPDATE automation_result_delivery_targets SET configured"),[row.request_id,host,"ready",300000]);}
    assert.ok(run(db,candidates,[receiver,300000],"all").length<=2);
    db.exec("UPDATE automation_result_watches SET active=0");
    run(db,query("DELETE FROM automation_result_delivery_targets"));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_result_delivery_targets").get().n,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_result_watches").get().n,requests.length+1);
  } finally {db.close();}
});

test("OS configuration ACK cannot manufacture missing ownership, adopt another host or replace a staged hash", () => {
  const db=fixture(),request=watch(db);try {
    const stage=query("UPDATE automation_result_delivery_targets SET binding_hash");
    const ack=query("UPDATE automation_result_delivery_targets SET configured");
    assert.equal(run(db,stage,[request,host,"desired"]).changes,0);
    run(db,query("INSERT INTO automation_result_delivery_targets"),[request,host,100,1]);
    assert.equal(run(db,stage,[request,randomUUID(),"desired"]).changes,0);
    assert.equal(run(db,stage,[request,host,"desired"]).changes,1);
    assert.equal(run(db,ack,[request,host,"stale-hash",300000]).changes,0);
    assert.equal(owns(db,request,"desired"),false);
    assert.equal(run(db,ack,[request,host,"desired",300000]).changes,1);
    assert.equal(owns(db,request,"desired"),true);
    assert.equal(owns(db,request,"desired",randomUUID()),false);
    assert.equal(owns(db,request,"desired",receiver,randomUUID()),false);
  } finally {db.close();}
});

test("OS polling claims only configured original active watches, persists ordinary backoff and cannot replay an ACK", () => {
  const db=fixture();try {
    const requests=Array.from({length:7},()=>watch(db));for(const request of requests)setup(db,request);
    const selection=query("SELECT w.request_id,t.binding_hash,w.probes");
    const first=run(db,selection,[100],"all").slice(0,4);assert.equal(first.length,4);
    db.exec("BEGIN IMMEDIATE");for(const row of first)run(db,query("UPDATE automation_result_watches SET retry_at"),[row.request_id,60000,1]);db.exec("COMMIT");
    assert.equal(run(db,selection,[100],"all").length,3);
    db.prepare("UPDATE automation_result_watches SET active=0 WHERE request_id=?").run(requests[0]);
    db.prepare("UPDATE automation_result_delivery_targets SET configured=0 WHERE request_id=?").run(requests[1]);
    const due=run(db,selection,[60000],"all").map(row=>row.request_id);
    assert.ok(!due.includes(requests[0])&&!due.includes(requests[1]));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_result_responses").get().n,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_result_notifications").get().n,0);
  } finally {db.close();}
});

test("forgetting a peer while a GET is in flight prevents inbox commit or re-adoption by a late OS ACK", () => {
  const db=fixture(),request=watch(db),other=watch(db);try {
    setup(db,request);setup(db,other);
    assert.equal(owns(db,request),true);
    run(db,query("DELETE FROM automation_result_delivery_targets WHERE source_host_id"),[host]);
    assert.equal(owns(db,request),false);
    assert.equal(run(db,query("UPDATE automation_result_delivery_targets SET configured"),[request,host,"original-target-hash",300000]).changes,0);
    assert.equal(run(db,query("UPDATE automation_result_delivery_targets SET binding_hash"),[request,host,"replacement"]).changes,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_result_inbox").get().n,0);
  } finally {db.close();}
});

test("original receiver scope and accepted OS config survive DB reopen; stopped publication rolls back actual inbox and watch SQL", () => {
  const directory=mkdtempSync(path.join(tmpdir(),"xgent-result-read-")),filename=path.join(directory,"config.sqlite");
  let db=fixture(filename);const request=watch(db);setup(db,request);db.close();db=new DatabaseSync(filename);
  try {
    assert.equal(owns(db,request),true);
    const insert=sql(inbox,"INSERT INTO automation_result_inbox (entry_id");
    const update=sql(inbox,"UPDATE automation_result_watches SET execution_id");
    db.exec("BEGIN IMMEDIATE");
    run(db,insert,[randomUUID(),host,request,"actual-digest",'{"run":{"state":"waiting"}}',100]);
    run(db,update,[request,randomUUID(),1,"waiting","actual-digest",100,30000,1]);
    // Same transaction rolls back if the native stop callback fires before commit.
    db.exec("ROLLBACK");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_result_inbox").get().n,0);
    assert.equal(db.prepare("SELECT execution_id FROM automation_result_watches").get().execution_id,null);
    assert.equal(owns(db,request),true);
  } finally {db.close();unlinkSync(filename);rmdirSync(directory);}
});

test("remote OS source wiring uses the original Rust validator, read-only route and encrypted native storage", () => {
  const server=native("services/local_access/result_delivery.rs"),registry=native("services/worker_peers.rs");
  const worker=mobile("android/src/main/java/com/ohi/xgent/mobileassistant/ResultDeliveryWorker.kt");
  const storage=mobile("android/src/main/java/com/ohi/xgent/mobileassistant/RemoteResultDelivery.kt");
  const receiverSource=native("services/os_result_receiver.rs");
  assert.match(server,/result_read_grant[\s\S]*background_task[\s\S]*result_read_grant/);
  assert.match(server,/CACHE_CONTROL.*no-store/);assert.doesNotMatch(server,/dispatch_rpc|resume_background|read_background_artifact/);
  assert.match(receiverSource,/receive_background_result_guarded/);assert.match(receiverSource,/retry\(reqwest::retry::never\(\)\)/);
  assert.match(receiverSource,/Policy::none/);assert.match(receiverSource,/MAX_BODY\+1/);
  assert.match(receiverSource,/receiverHostId.*host/);assert.match(receiverSource,/sessionId.*endpoint.session_id/);
  assert.match(storage,/AndroidKeyStore/);assert.match(storage,/AES\/GCM\/NoPadding/);
  assert.match(storage,/updateAAD\(aad\(scope\)\)/);assert.match(storage,/noBackupFilesDir/);
  assert.doesNotMatch(storage+receiverSource,/sessionToken|csrfToken|apiKey|grant_device|requestPermissions|initialize\(&conn\)/);
  assert.match(worker,/ResultDelivery.drain[\s\S]*RemoteResultDelivery.receive[\s\S]*ResultDelivery.drain/);
  assert.match(registry,/forget_session[\s\S]*invalidate_result_delivery\(id\)/);
  assert.match(registry,/pub async fn forget\([\s\S]*invalidate_result_delivery\(peer_id\)/);
  const provisioning=native("services/result_receiver.rs");
  assert.match(provisioning,/stage_result_delivery_target[\s\S]*configure_os_target\(app,store,target\)/);
  const configured=provisioning.slice(provisioning.indexOf("async fn configure_os_target"),provisioning.indexOf("async fn provision_os_results"));
  assert.match(configured,/configure_result_delivery[\s\S]*if !configured[\s\S]*acknowledge_result_delivery/);
});
