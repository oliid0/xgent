import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const read = name => readFileSync(new URL(`../../src-tauri/src/${name}`, import.meta.url), "utf8");
const source = read("services/automation/store/goals.rs");
const sql = (text, prefix) => {
  const found = [...text.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)]
    .find(match => match[1].trimStart().startsWith(prefix));
  assert.ok(found, prefix); return found[1];
};
const owner = randomUUID(), peer = randomUUID();
const config = { title: "产品发布", description: "完成汇报与网站", category: "career", parentId: null, steps: [{ id: "report", title: "制作汇报", done: false }] };
function open(file = ":memory:") {
  const db = new DatabaseSync(file);
  db.exec(sql(read("services/automation/db.rs"), "CREATE TABLE IF NOT EXISTS automation_meta"));
  db.exec(read("services/automation/goals.sql"));
  db.prepare("INSERT OR REPLACE INTO automation_meta (key,value) VALUES ('background_worker_id.v1',?)").run(owner);
  if (!db.prepare("SELECT 1 FROM automation_goals").get()) {
    db.prepare(sql(source,"INSERT INTO automation_goals")).run("launch", JSON.stringify(config), null, 100);
  }
  return db;
}
function task() {
  const requestId = randomUUID(), execution = randomUUID();
  return { hostId: peer, requestId, name: "产品汇报", workdir: "/private", run: { id: execution, taskId: execution, state: "pending", success: false, startedAt: 200, output: "" }, artifacts: [] };
}
function submit(db, record, accepted = true, initiating = owner, sourceHost = peer) {
  db.prepare("INSERT INTO automation_submission_outbox (request_id,initiating_host_id,source_host_id,input_json,origin_json,created_at,result_json) VALUES (?,?,?,?,?,?,?)")
    .run(record.requestId, initiating, sourceHost, JSON.stringify({ name: record.name, prompt: "Private input", providerId: "provider" }), "null", 200, accepted ? JSON.stringify(record) : null);
}
function receive(db, record, at) {
  const id = randomUUID();
  db.prepare("INSERT INTO automation_result_inbox (entry_id,source_host_id,request_id,content_hash,payload_json,received_at) VALUES (?,?,?,?,?,?)")
    .run(id, record.hostId, record.requestId, randomUUID(), JSON.stringify(record), at);
  return id;
}
function link(db, record) {
  const label = db.prepare(sql(source, "SELECT name FROM (")).get(record.requestId)?.name;
  assert.equal(label, record.name);
  db.prepare(sql(source, "INSERT OR IGNORE INTO automation_goal_work")).run("launch", record.requestId, label, 300);
}
const files = db => db.prepare(sql(source,"SELECT a.artifact_id, a.relative_path, a.content_hash, a.bytes, b.request_id")).all("launch",null,null,50);

test("Goals can link only an originally accepted remote request owned by this installation, never an inbox alone or guessed source", () => {
  const db = open();
  try {
    const accepted = task(), pending = task(), otherPhone = task(), foreignHost = task(), orphan = task();
    submit(db, accepted); submit(db,pending,false); submit(db,otherPhone,true,randomUUID()); submit(db,foreignHost,true,owner,randomUUID()); receive(db,orphan,400);
    const rows = db.prepare("SELECT request_id, task_name FROM automation_goal_remote_work").all();
    assert.deepEqual(rows.map(row=>row.request_id),[accepted.requestId]); assert.ok(!JSON.stringify(rows).includes("Private input"));
    link(db,accepted); assert.equal(db.prepare(sql(source,"SELECT l.request_id")).get("launch").state,"pending");
    db.prepare("UPDATE automation_meta SET value=? WHERE key='background_worker_id.v1'").run(randomUUID());
    assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_goal_remote_work").get().n,0);
    assert.equal(Object.values(db.prepare(sql(source,"SELECT l.request_id")).get("launch"))[4],0);
  } finally { db.close(); }
});

test("remote Goal state, bounded activity and actual file metadata survive reopen without falsely completing the Goal", () => {
  const directory=mkdtempSync(path.join(tmpdir(),"xgent-remote-goal-")),file=path.join(directory,"goals.sqlite");
  let db=open(file);
  try {
    const record=task(); submit(db,record); link(db,record);
    record.run={...record.run,state:"done",success:true,output:"已完成报告\n".repeat(700)};
    record.artifacts=[{id:randomUUID(),relativePath:"reports/产品汇报.pptx",contentHash:"a".repeat(64),bytes:200}];
    receive(db,record,400); db.close(); db=open(file);
    const work=db.prepare(sql(source,"SELECT l.request_id")).get("launch"); assert.equal(work.state,"done"); assert.equal(work.success,1);
    const activity=db.prepare(sql(source,"SELECT id, kind, label, at")).all("launch",null,null,50);
    assert.equal(activity.length,1); assert.equal(activity[0].id,`remote:${peer}:${record.run.id}`); assert.equal(activity[0].output.length,2000);
    const artifacts=files(db); assert.equal(artifacts.length,1); assert.equal(artifacts[0].relative_path,record.artifacts[0].relativePath); assert.equal(artifacts[0].request_id,record.requestId);
    assert.equal(db.prepare(sql(source,"SELECT a.entry_id FROM automation_goal_all_work")).get("launch",record.requestId,record.artifacts[0].id).entry_id,db.prepare("SELECT entry_id FROM automation_result_inbox").get().entry_id);
    assert.equal(db.prepare("SELECT status FROM automation_goals").get().status,"active"); assert.equal(JSON.parse(db.prepare("SELECT config_json FROM automation_goals").get().config_json).steps[0].done,false);
  } finally { db.close(); unlinkSync(file); rmdirSync(directory); }
});

test("acceptance does not expose files; original execution/file provenance and stable cursor survive later status receipts", () => {
  const db=open();
  try {
    const record=task(); record.artifacts=[{id:randomUUID(),relativePath:"product.html",contentHash:"b".repeat(64),bytes:30},{id:randomUUID(),relativePath:"product.docx",contentHash:"c".repeat(64),bytes:40}];
    submit(db,record); link(db,record); assert.deepEqual(files(db),[]);
    receive(db,record,400); const before=files(db);
    const wrong={...record,run:{...record.run,id:randomUUID(),taskId:randomUUID(),state:"done",success:true}};
    receive(db,wrong,999); assert.equal(db.prepare(sql(source,"SELECT l.request_id")).get("launch").state,"pending");
    record.run.state="leased";receive(db,record,500);assert.deepEqual(files(db),before);
    const first=db.prepare(sql(source,"SELECT a.artifact_id, a.relative_path, a.content_hash, a.bytes, b.request_id")).all("launch",null,null,1),last=first[0];
    const next=db.prepare(sql(source,"SELECT a.artifact_id, a.relative_path, a.content_hash, a.bytes, b.request_id")).all("launch",last.created_at,last.artifact_id,50);
    assert.deepEqual([...first,...next],before);
    db.prepare("DELETE FROM automation_goal_work WHERE goal_id='launch'").run();assert.deepEqual(files(db),[]);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_submission_outbox").get().n,1);assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_result_inbox").get().n,3);
  } finally { db.close(); }
});

test("remote Goal file reads reuse original receipt/host/hash verification and check membership after asynchronous transfer", () => {
  const commands=read("commands/automation/goals.rs"),artifacts=read("commands/automation/cron.rs");
  assert.match(commands,/goal_remote_artifact_entry\(&goal, &request, &artifact\)/);
  assert.match(commands,/super::cron::read_received_artifact\(entry\.clone\(\), artifact_id\.clone\(\)/);
  assert.match(commands,/goal_remote_artifact_entry\(&goal_id, &request_id, &artifact_id\)\? != Some\(entry\)/);
  const helper=artifacts.split("pub(crate) async fn read_received_artifact(")[1].split("pub async fn automation_background_outcomes(")[0];
  for(const fragment of ["background_inbox_artifact_source",'registry.invoke(&watch.source_host_id, "automation_background_read_artifact"',"actual[\"artifact\"] != expected","Sha256::digest(&bytes)"])
    assert.ok(helper.includes(fragment),fragment);
  assert.doesNotMatch(commands,/automation_background_submit|stage_background_submission|set_step|payload_json.*INSERT/);
});
