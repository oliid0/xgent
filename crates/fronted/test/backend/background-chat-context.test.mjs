import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
const read = name => readFileSync(new URL(`../../src-tauri/src/${name}`, import.meta.url), "utf8");
const source = read("services/automation/store/chat_context.rs");
const sql = (text, prefix) => { const match = [...text.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(entry => entry[1].trimStart().startsWith(prefix)); assert.ok(match, prefix); return match[1]; };
const owner = randomUUID(), peer = randomUUID(), execution = randomUUID();
function fixture() {
  const db = new DatabaseSync(":memory:"); db.exec(sql(read("services/automation/db.rs"), "CREATE TABLE IF NOT EXISTS automation_meta"));
  db.prepare("INSERT OR IGNORE INTO automation_meta VALUES('background_worker_id.v1',?)").run(owner); return db;
}
function stage(db, conversation, message, initiating = owner, origin = undefined) {
  const scope = JSON.stringify([conversation, message]);
  const hash = createHash("sha256").update(`xgent-background:${JSON.stringify([scope, "default-chat-intake"])}`).digest("hex");
  const request = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  db.prepare("INSERT INTO automation_submission_outbox(request_id,initiating_host_id,source_host_id,input_json,origin_json,created_at,result_json) VALUES(?,?,?,? ,?,100,?)")
    .run(request, initiating, peer, JSON.stringify({ name: "Actual saved task" }), JSON.stringify(origin ?? { requestScope: scope }), JSON.stringify({ requestId: request, hostId: peer, run: { id: execution, taskId: execution, state: "pending" } }));
  db.prepare("INSERT INTO automation_result_watches(request_id,source_host_id,execution_id) VALUES(?,?,?)").run(request, peer, execution); return request;
}
const rows = (db, id) => db.prepare(sql(source, "WITH owned AS (")).all(id);
function receive(db, request, host = peer, run = execution, state = "done") {
  const body = JSON.stringify({ requestId: request, hostId: host, run: { id: run, taskId: run, state, success: state === "done", output: "Actual result" } });
  db.prepare("INSERT INTO automation_result_inbox(entry_id,source_host_id,request_id,content_hash,payload_json,received_at) VALUES(?,?,?,?,?,200)").run(randomUUID(), host, request, randomUUID(), body); return body;
}
test("native conversation SQL selects only the original installation's exact chat scope, excluding unrelated malformed origins", () => {
  const db = fixture(); try {
    const request = stage(db, "original", "message"); stage(db, "another", "message"); stage(db, "original", "foreign", randomUUID());
    stage(db, "original", "invalid", owner, { requestScope: "not JSON" }); stage(db, "original", "scalar", owner, { requestScope: "123" });
    const found = rows(db, "original"); assert.equal(found.length, 1); assert.equal(found[0].request_id, request);
    db.prepare("UPDATE automation_meta SET value=? WHERE key='background_worker_id.v1'").run(randomUUID()); assert.equal(rows(db, "original").length, 0);
  } finally { db.close(); }
});
test("latest retained exact source/execution updates are available offline and cannot be replaced by other host or run snapshots", () => {
  const db = fixture(); try {
    const request = stage(db, "original", "message"), actual = receive(db, request);
    receive(db, request, randomUUID()); receive(db, request, peer, randomUUID());
    assert.equal(Object.values(rows(db, "original")[0])[8], actual);
    db.prepare("UPDATE automation_submission_outbox SET result_json=NULL").run();
    assert.equal(Object.values(rows(db, "original")[0])[8], actual, "validated original watch identity survives an unconfirmed submission ACK");
    assert.equal(Object.values(rows(db, "original")[0])[9], 0);
  } finally { db.close(); }
});
test("native task observations are bounded, read-only and main-client-only on both platform handler registries", () => {
  const db = fixture(); try {
    for (let i = 0; i < 8; i++) stage(db, "original", `message-${i}`);
    assert.equal(rows(db, "original").length, 5);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_submission_outbox").get().n, 8);
  } finally { db.close(); }
  assert.match(source, /tasks.len\(\)==4/); assert.match(source, /len\(\)<=12\*1024/);
  assert.match(source, /request!=expected/); assert.match(source, /default-chat-intake/);
  assert.doesNotMatch(source, /INSERT|UPDATE|DELETE|\.invoke\(|\.write\(|acknowledge/);
  assert.match(read("commands/automation/submission.rs"), /window.label\(\)!="main"/);
  assert.equal((read("lib.rs").match(/commands::submission::automation_result_chat_context,/g) ?? []).length, 2);
  assert.match(read("services/local_access.rs"), /command.starts_with\("automation_result_"\)[^]*?return Err/);
});

test("original chat delivery selects received snapshots, including acknowledged notices, but never the initial acceptance", () => {
  const db = fixture(); try {
    const request = stage(db, "original", "message");
    const select = db.prepare(sql(source, "SELECT s.origin_json,s.input_json"));
    assert.equal(select.get(request), undefined, "Acceptance is not a delivered result");
    const actual = receive(db, request);
    const selected = select.get(request);
    assert.equal(selected.source_host_id, peer);
    const entry = db.prepare("SELECT payload_json FROM automation_result_inbox WHERE entry_id=?").get(selected.entry_id);
    assert.equal(entry.payload_json, actual);
    db.prepare("UPDATE automation_result_inbox SET read_at=300").run();
    assert.equal(select.get(request).entry_id, selected.entry_id, "Notice ACK does not remove chat delivery");
    receive(db, request, peer, randomUUID()); receive(db, request, randomUUID());
    assert.equal(select.get(request).entry_id, selected.entry_id);
    db.prepare("UPDATE automation_submission_outbox SET result_json=NULL").run();
    assert.equal(select.get(request).entry_id, selected.entry_id);
    db.prepare("UPDATE automation_meta SET value=? WHERE key='background_worker_id.v1'").run(randomUUID());
    assert.equal(select.get(request), undefined);
  } finally { db.close(); }
});

test("native history receipt selection rejects foreign or duplicate targets and excludes replaced original-user segments", () => {
  const native = read("commands/history/chat_history/background_results.rs");
  const db = new DatabaseSync(":memory:"); try {
    db.exec("CREATE TABLE chatHistorySegment(conversation_id TEXT,segment_index INTEGER,segment_id TEXT,messages_json TEXT)");
    const user = { role: "user", id: "source-user", content: "Actual request" };
    const receipt = { role: "assistant", xgentBackgroundTask: { requestId: "source-request", hostId: peer } };
    db.prepare("INSERT INTO chatHistorySegment VALUES(?,0,'original',?)").run("original", JSON.stringify([user, receipt]));
    db.prepare("INSERT INTO chatHistorySegment VALUES(?,0,'foreign',?)").run("foreign", JSON.stringify([user, receipt]));
    const receipts = db.prepare(sql(native, "SELECT s.segment_index"));
    assert.equal(receipts.all("original", "source-request", peer).length, 1);
    assert.equal(receipts.all("original", "source-request", randomUUID()).length, 0);
    const users = db.prepare(sql(native, "SELECT m.value"));
    assert.equal(users.all("original", "source-user", null).length, 1);
    assert.equal(users.all("original", "source-user", 0).length, 0, "An incoming replacement cannot retain its deleted user's old copy");
    db.prepare("INSERT INTO chatHistorySegment VALUES('original',1,'duplicate',?)").run(JSON.stringify([receipt]));
    assert.equal(receipts.all("original", "source-request", peer).length, 2, "Ambiguous original receipts must be rejected");
  } finally { db.close(); }
  assert.match(native, /TransactionBehavior::Immediate/);
  assert.match(native, /indices.len\(\)!=1/);
  assert.match(native, /saved>=sequence/);
  assert.match(native, /verify_chat_history_consistency/);
  assert.match(native, /upsert_single_segment/);
  assert.ok(native.indexOf('tx.execute("UPDATE chatHistory SET updated_at=') < native.indexOf("upsert_single_segment(&tx,conversation,&replacement)"), "FTS indexes the committed result revision in the same transaction");
  assert.doesNotMatch(native, /acknowledge|submit_background_task|INSERT INTO chatHistory/);
  const segments = read("commands/history/chat_history/segments.rs");
  assert.equal((segments.match(/preserve_background_results\(conn,conversation_id,segment\)/g) ?? []).length, 2, "Full-state and active-segment writers preserve actual delivered results");
  assert.match(segments, /MAX\(chatHistory.updated_at, excluded.updated_at\)/);
  const registrations = read("lib.rs");
  assert.equal((registrations.match(/commands::submission::automation_result_chat_project,/g) ?? []).length, 2);
});

test("chat artifact authorization requires the exact original projected receipt and cache verification reads actual bytes without replacement",()=>{
  const native=read("commands/history/chat_history/background_results.rs"),db=new DatabaseSync(":memory:");
  try{
    db.exec("CREATE TABLE chatHistorySegment(conversation_id TEXT,messages_json TEXT)");
    const receipt={role:"assistant",xgentBackgroundTask:{requestId:"request",hostId:peer},xgentBackgroundResult:{entryId:"entry",snapshotHash:"hash"}};
    db.prepare("INSERT INTO chatHistorySegment VALUES('original',?)").run(JSON.stringify([receipt]));
    const select=db.prepare(sql(native,"SELECT COUNT(*) FROM chatHistorySegment"));
    assert.equal(Object.values(select.get("original","request",peer,"entry","hash"))[0],1);
    for(const parameters of [["foreign","request",peer,"entry","hash"],["original","request",peer,"foreign","hash"],["original","request",peer,"entry","foreign"]])assert.equal(Object.values(select.get(...parameters))[0],0);
    db.prepare("DELETE FROM chatHistorySegment").run();assert.equal(Object.values(select.get("original","request",peer,"entry","hash"))[0],0);
  }finally{db.close()}
  const command=read("commands/automation/artifact_streams.rs");assert.match(command,/window.label\(\)!="main"/);assert.match(command,/validate_background_chat_artifact_sync/);assert.match(command,/verified_artifact_copy/);
  const fs=read("commands/workspace/fs.rs").replace(/\r\n/g,"\n"),start=fs.indexOf("pub(crate) fn verified_artifact_copy"),end=fs.indexOf("#[cfg(test)]\nmod received_artifact_cache_tests",start),cache=fs.slice(start,end);
  assert.ok(start>=0 && end>start,"Check the actual cache function, not later unrelated file writers");
  assert.match(cache,/file.read/);assert.match(cache,/hash.finalize/);assert.match(cache,/streamed_file_identity/);assert.match(cache,/resolve_existing_file_target/);assert.match(cache,/512\*1024\*1024/);
  assert.doesNotMatch(cache,/write_all|remove_file|create_dir|persist/);
  assert.equal((read("lib.rs").match(/commands::artifact_streams::automation_result_chat_artifact,/g)??[]).length,2);
});
