import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// Execute actual production SQLite and independent standard crypto fixtures.
// Swift/Rust/C linking, Keychain, CryptoKit, BGTask/NotificationCenter and
// real HTTP are not executed by Node; source wiring does not prove them.
const native = name => readFileSync(new URL(`../../src-tauri/src/${name}`, import.meta.url), "utf8");
const plugin = name => readFileSync(new URL(`../../../mobile-assistant/${name}`, import.meta.url), "utf8");
const source = native("services/automation/store/result_delivery.rs");
const notices = native("services/automation/store/inbox_notifications.rs");
const storage = plugin("ios/Sources/ResultDeliveryStorage.swift");
const worker = plugin("ios/Sources/ResultDelivery.swift");
function sql(text, prefix) {
  const value = [...text.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].map(match=>match[1])
    .find(value=>value.replace(/\s+/g," ").trim().startsWith(prefix));
  assert.ok(value,prefix);return value;
}
const run = (db,statement,values=[],method="run") => db.prepare(statement)[method](Object.fromEntries(values.map((value,i)=>[String(i+1),value])));
const retain = sql(source,"SELECT EXISTS(SELECT 1 FROM automation_result_delivery_targets t JOIN automation_result_watches");
const own = (db,request,host,hash) => Boolean(Object.values(run(db,retain,[request,host,hash],"get"))[0]);
function fixture(){
  const db = new DatabaseSync(":memory:");
  db.exec(sql(native("services/automation/db.rs"),"CREATE TABLE IF NOT EXISTS automation_meta"));
  db.exec(native("services/automation/result_delivery.sql"));
  return db;
}
function target(db,host=randomUUID(),hash=randomUUID()){
  const request=randomUUID();
  db.prepare("INSERT INTO automation_result_watches (request_id,source_host_id) VALUES (?,?)").run(request,host);
  db.prepare("INSERT INTO automation_result_delivery_targets (request_id,source_host_id,binding_hash) VALUES (?,?,?)").run(request,host,hash);
  return {request,host,hash};
}

test("iOS native configuration retains only exact original staged/live bindings; unknown and retired scopes cannot be adopted",()=>{
  const db=fixture();try{
    const t=target(db);
    assert.equal(own(db,t.request,t.host,t.hash),true); // Staged before OS ACK, never a new grant.
    assert.equal(own(db,randomUUID(),t.host,t.hash),false);
    assert.equal(own(db,t.request,randomUUID(),t.hash),false);
    assert.equal(own(db,t.request,t.host,randomUUID()),false);
    db.prepare("UPDATE automation_result_watches SET active=0 WHERE request_id=?").run(t.request);
    assert.equal(own(db,t.request,t.host,t.hash),false);
    db.prepare("UPDATE automation_result_watches SET active=1,source_host_id=? WHERE request_id=?").run(randomUUID(),t.request);
    assert.equal(own(db,t.request,t.host,t.hash),false);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_result_watches").get().n,1);
  }finally{db.close();}
});

test("native pruning releases 128 retired encrypted scopes before merging the next original accepted task",()=>{
  const db=fixture();try{
    const stale=Array.from({length:128},()=>target(db));
    db.exec("UPDATE automation_result_watches SET active=0");
    const next=target(db);
    const retained=stale.filter(t=>own(db,t.request,t.host,t.hash));
    assert.equal(retained.length,0);
    assert.equal(own(db,next.request,next.host,next.hash),true);
    assert.match(worker,/const|let prior = try targets\(try retained\(scope\)\)/);
    assert.ok(worker.indexOf("let prior = try targets(try retained(scope))")<worker.indexOf("next.append(target)"));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_result_inbox").get().n,0);
  }finally{db.close();}
});

test("OS notice selection excludes read/superseded/accepted results; actual acceptance never creates read or response ACKs",()=>{
  const db=fixture();try{
    const selected=[];
    for(let i=0;i<6;i++){
      const entry=randomUUID();selected.push(entry);
      db.prepare("INSERT INTO automation_result_inbox (entry_id,source_host_id,request_id,content_hash,payload_json,received_at) VALUES (?,?,?,?,?,1)")
        .run(entry,randomUUID(),randomUUID(),randomUUID(),"{}");
    }
    const pending=sql(notices,"SELECT i.entry_id FROM automation_result_inbox i WHERE i.read_at IS NULL");
    assert.deepEqual(run(db,pending,[4],"all").map(row=>row.entry_id),selected.slice(0,4));
    const ack=sql(notices,"INSERT INTO automation_result_notifications");
    run(db,ack,[selected[0],100]);run(db,ack,[selected[0],200]);
    assert.equal(db.prepare("SELECT accepted_at FROM automation_result_notifications").get().accepted_at,100);
    assert.equal(run(db,ack,[randomUUID(),200]).changes,0);
    db.prepare("UPDATE automation_result_inbox SET read_at=200 WHERE entry_id=?").run(selected[1]);
    assert.deepEqual(run(db,pending,[4],"all").map(row=>row.entry_id),selected.slice(2));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_result_responses").get().n,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_result_inbox WHERE read_at IS NULL").get().n,5);
  }finally{db.close();}
});

test("AES-GCM combined fixtures bind original installation and private DB path and reject corrupted ciphertext",()=>{
  // CryptoKit's documented combined layout is 12-byte nonce / ciphertext / tag.
  // Standard Node crypto proves the fixture format and AAD property, not Apple's APIs.
  const key=randomBytes(32),nonce=randomBytes(12),host=randomUUID(),path="/private/app/config.sqlite";
  const aad=Buffer.from(`xgent.result.read.v1\0${host}\0${path}`),plain=Buffer.from('[{"requestId":"original"}]');
  const cipher=createCipheriv("aes-256-gcm",key,nonce);cipher.setAAD(aad);
  const sealed=Buffer.concat([nonce,cipher.update(plain),cipher.final(),cipher.getAuthTag()]);
  const decrypt=(body,associated)=>{
    const d=createDecipheriv("aes-256-gcm",key,body.subarray(0,12));d.setAAD(associated);d.setAuthTag(body.subarray(-16));
    return Buffer.concat([d.update(body.subarray(12,-16)),d.final()]);
  };
  assert.deepEqual(decrypt(sealed,aad),plain);
  assert.throws(()=>decrypt(sealed,Buffer.from(`xgent.result.read.v1\0${randomUUID()}\0${path}`)));
  assert.throws(()=>decrypt(sealed,Buffer.from(`xgent.result.read.v1\0${host}\0/another/config.sqlite`)));
  const changed=Buffer.from(sealed);changed[15]^=1;assert.throws(()=>decrypt(changed,aad));
  assert.match(storage,/AES.GCM.open[\s\S]*authenticating: aad\(scope\)/);
  assert.match(storage,/kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly/);assert.match(storage,/kSecAttrSynchronizable as String: false/);
  assert.match(storage,/\.atomic, \.completeUntilFirstUserAuthentication/);assert.match(storage,/handle.synchronize\(\)/);
  assert.doesNotMatch(storage,/SecItemDelete|UserDefaults|requestAuthorization/);
});

function domain(name){return Buffer.from(source.match(new RegExp(`const ${name}:&\\[u8\\]=b"([^"]+)"`))[1].replace(/\\0/g,"\0"));}
const key=createHash("sha256").update("ab".repeat(32)).digest("hex");
const readProof=ids=>createHmac("sha256",key).update(domain("READ_DOMAIN")).update(ids.join("")).digest("hex");
const replyProof=(nonce,body)=>createHmac("sha256",key).update(domain("REPLY_DOMAIN")).update(nonce).update(body).digest("hex");

test("standard request proof fixtures bind host/receiver/session/task/fresh nonce without sending the capability key",()=>{
  const ids=Array.from({length:5},()=>randomUUID()),expected=readProof(ids);
  for(let i=0;i<ids.length;i++){
    const changed=[...ids];changed[i]=randomUUID();assert.notEqual(readProof(changed),expected);
  }
  assert.notEqual(expected,key);
  const actual=native("services/os_result_receiver.rs");
  assert.doesNotMatch(actual,/Bearer|header\("authorization"/);
  assert.match(actual,/Uuid::new_v4\(\)/);assert.match(actual,/header\("x-xgent-result-proof",proof\)/);
  assert.match(source,/read_mac[\s\S]*verify_slice/);
});

test("standard response proofs bind exact returned bytes and original nonce, so altered/old/unsigned results cannot be published",()=>{
  const nonce=randomUUID(),body=Buffer.from('{"snapshot":{"success":false}}'),proof=replyProof(nonce,body);
  assert.notEqual(replyProof(nonce,Buffer.from('{"snapshot":{"success":true}}')),proof);
  assert.notEqual(replyProof(randomUUID(),body),proof);
  assert.notEqual(createHmac("sha256",key).update(domain("READ_DOMAIN")).update(nonce).update(body).digest("hex"),proof);
  const actual=native("services/os_result_receiver.rs");
  assert.ok(actual.indexOf("verify_result_reply_proof(&key,&nonce,&bytes,&signature)")<actual.indexOf("serde_json::from_slice(&bytes)"));
  assert.ok(actual.indexOf("verify_result_reply_proof(&key,&nonce,&bytes,&signature)")<actual.indexOf("store.receive_background_result_guarded"));
  assert.match(actual,/verify_result_reply_proof\(&key,&nonce,&bytes,&signature\).is_err\(\)\{continue;\}/);
  assert.doesNotMatch(actual,/continue 'targets/);
  const server=native("services/local_access/result_delivery.rs");
  assert.match(server,/result_read_grant[\s\S]*background_task[\s\S]*result_read_grant[\s\S]*result_reply_proof/);
  assert.match(server,/body.into_response/);
});

test("iOS registration precedes the Tauri event loop, uses one permitted identifier, and private configuration has no public JS grant",()=>{
  const lib=native("lib.rs"),start=lib.slice(lib.lastIndexOf("pub fn run()"));
  assert.ok(start.indexOf("register_background_results()")<start.indexOf("tauri::Builder::default()"));
  assert.match(worker,/if attempted \{ return registered \? 1 : 0 \}/);
  assert.match(worker,/Thread.isMainThread/);assert.match(worker,/BGTaskScheduler.shared.register/);
  assert.doesNotMatch(plugin("ios/Sources/MobileAssistantPlugin.swift"),/BGTaskScheduler|registerEarly/);
  assert.match(plugin("ios/Sources/MobileAssistantPlugin.swift"),/configureResultDelivery/);
  const plist=native("../Info.ios.plist");
  assert.match(plist,/<key>BGTaskSchedulerPermittedIdentifiers<\/key>\s*<array><string>xgent.result.refresh.v1<\/string>/);
  assert.match(plist,/<key>UIBackgroundModes<\/key>\s*<array><string>fetch<\/string>/);
  assert.doesNotMatch(plugin("build.rs")+plugin("src/commands.rs"),/configure_result_delivery|register_background_results/);
});

test("iOS expiration fences the shared receiver and caches actual late OS receipts without marking a message read",()=>{
  assert.match(worker,/task.expirationHandler = \{ run.cancel\(\) \}/);
  assert.match(worker,/setTaskCompleted\(success: success && !run.stopped\)/);
  assert.match(worker,/Unmanaged.passRetained\(run\)/);assert.match(worker,/fromOpaque\(context\).release\(\)/);
  assert.match(worker,/let cached = \(try\? drain/);assert.match(worker,/let delivered = \(try\? drain/);
  assert.match(worker,/catch \{\s*success = false\s*retryAfterUnavailableStorage\(\)/);
  const retry=worker.slice(worker.indexOf("private static func retryAfterUnavailableStorage"),worker.indexOf("private static func drain"));
  assert.match(retry,/BGAppRefreshTaskRequest/);assert.doesNotMatch(retry,/ResultDeliveryStorage|xgent_result_|Keychain|SecItem/);
  assert.ok(worker.indexOf("receipt == \"accepted\"")<worker.indexOf("host, $0, 1)"));
  const ffi=native("services/ios_result_receiver.rs");
  assert.match(ffi,/Duration::from_secs\(18\)/);assert.match(ffi,/pending_background_notifications\(4\)/);
  assert.match(ffi,/record_background_notification_accepted/);
  assert.doesNotMatch(ffi,/acknowledge.*inbox|initialize|submit_background|read_health|grant_device/);
  const nativeInbox=native("services/automation/store/inbox.rs");
  assert.match(nativeInbox,/if stopped\(\).*stopped before durable publication/);
  const platform=plugin("ios/Sources/ResultNotifications.swift");
  assert.match(platform,/post\(entryId: String/);assert.match(platform,/center.add\(UNNotificationRequest/);
  assert.match(platform,/UserDefaults.standard.set\(true, forKey: receiptKey\)/);
  assert.doesNotMatch(platform,/requestAuthorization|content.userInfo|content.body.*taskName/);
});

test("iOS bridge and shared DTO explicitly link actual Rust entry points with paired-platform scope revocation",()=>{
  const header=plugin("ios/Bridge/include/XgentResultReceiverBridge.h"),ffi=native("services/ios_result_receiver.rs");
  for(const symbol of ["xgent_result_targets_v1","xgent_result_sync_v1","xgent_result_pending_v1","xgent_result_notice_v1"]){
    assert.ok(header.includes(symbol));assert.ok(ffi.includes(`fn ${symbol}(`));
  }
  assert.match(plugin("ios/Bridge/XgentResultReceiverBridge.c"),/xgent_result_free_v1\(value\)/);
  assert.match(plugin("ios/Package.swift"),/byName\(name: "XgentResultReceiverBridge"\)/);
  assert.match(plugin("src/mobile.rs"),/any\(target_os="android",target_os="ios"\)[\s\S]*configure_result_delivery/);
  assert.match(native("services/worker_peers.rs"),/any\(target_os="android",target_os="ios"\)[\s\S]*invalidate_result_delivery/);
  assert.doesNotMatch(storage+worker,/apiKey|csrfToken|sessionToken|initPlugin\(/);
});
