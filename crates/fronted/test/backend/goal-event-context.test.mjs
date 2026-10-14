import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const read=name=>readFileSync(new URL(`../../src-tauri/src/${name}`,import.meta.url),"utf8");
const source=read("services/automation/store/goal_event_context.rs"),goals=read("services/automation/store/goals.rs"),submission=read("services/automation/store/submission.rs");
const sql=(source,prefix)=>{const found=[...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(m=>m[1].trimStart().startsWith(prefix));assert.ok(found,prefix);return found[1];};
const exec=(db,source,prefix,args=[],mode="run")=>db.prepare(sql(source,prefix))[mode](...args);
const owner="aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",peer="bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const original={version:1,taskId:"timer",storeId:"original-goals",revision:3,observedAt:100,hasMoreGoals:false,
  goals:[{id:"fitness",status:"active",activeWork:false,planPreview:{title:"Fitness",steps:[{id:"exercise",done:false}]},work:[],scheduledRuns:[],artifactHints:[]}]};
function open(file=":memory:") {
  const db=new DatabaseSync(file);db.exec(sql(read("services/automation/db.rs"),"CREATE TABLE IF NOT EXISTS automation_meta"));db.exec(read("services/automation/goals.sql"));
  db.prepare("INSERT OR IGNORE INTO automation_meta VALUES ('goal_store_id.v1','original-goals')").run();
  db.prepare("INSERT OR IGNORE INTO automation_meta VALUES ('background_worker_id.v1',?)").run(owner);
  db.prepare("INSERT OR IGNORE INTO automation_goals(goal_id,config_json,status,created_at,updated_at) VALUES ('fitness',?,'active',1,1)").run(JSON.stringify({title:"Fitness",steps:[{id:"exercise",done:false}]}));return db;
}
function stage(db,request="request",at=100) {
  exec(db,source,"INSERT INTO automation_goal_event_contexts",[request,"timer","original-template","original-goals",JSON.stringify(original),at]);
  exec(db,source,"INSERT INTO automation_goal_event_work(",["fitness",request,1]);
  exec(db,submission,"INSERT INTO automation_submission_outbox",[request,owner,peer,JSON.stringify({name:"Fitness follow-up",sourceContext:{version:1,systemPrompt:JSON.stringify(original)}}),"{}",at]);
  db.prepare("INSERT INTO automation_result_watches(request_id,source_host_id,active) VALUES(?,?,1)").run(request,peer);
}
const all=db=>db.prepare("SELECT * FROM automation_goal_all_work WHERE goal_id='fitness'").all();
const display=db=>db.prepare("SELECT * FROM automation_goal_display_work WHERE goal_id='fitness'").all();
const blocked=db=>Object.values(exec(db,read("services/automation/store/goal_launch.rs"),"SELECT EXISTS (",["fitness"],"get"))[0];
const state=db=>exec(db,goals,"SELECT l.request_id",["fitness"],"get");

test("Goal event context/work and the original immutable outbox survive reopen; a failed admission rolls all of them back",()=>{
  const dir=mkdtempSync(path.join(tmpdir(),"xgent-goal-event-")),file=path.join(dir,"state.sqlite");let db=open(file);
  try{
    db.exec("BEGIN IMMEDIATE");stage(db);db.exec("ROLLBACK");assert.equal(all(db).length,0);assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_goal_event_contexts").get().n,0);
    db.exec("BEGIN IMMEDIATE");stage(db);db.exec("COMMIT");const packet=db.prepare("SELECT input_json FROM automation_submission_outbox").get().input_json;
    db.close();db=open(file);assert.equal(all(db).length,1);assert.equal(db.prepare("SELECT input_json FROM automation_submission_outbox").get().input_json,packet);
    assert.deepEqual(JSON.parse(db.prepare("SELECT context_json FROM automation_goal_event_contexts").get().context_json),original);
    assert.throws(()=>stage(db),/UNIQUE/);assert.equal(all(db).length,1);
    assert.equal(JSON.parse(db.prepare("SELECT config_json FROM automation_goals").get().config_json).steps[0].done,false);
  }finally{db.close();unlinkSync(file);rmdirSync(dir);}
});

test("original Goal observes submitting/stopping/actual completion and artifacts without accepting a foreign run or completing steps",()=>{
  const db=open();try{
    stage(db);assert.equal(blocked(db),1);assert.equal(state(db).state,"submitting");assert.equal(state(db).success,null);
    db.prepare("UPDATE automation_submission_outbox SET cancel_requested=1").run();assert.equal(state(db).state,"stopping");assert.equal(blocked(db),1);
    db.prepare("UPDATE automation_submission_outbox SET cancel_requested=0,result_json=?").run(JSON.stringify({requestId:"request",hostId:peer,run:{id:"actual-run",taskId:"actual-run",state:"pending",success:false,startedAt:100}}));
    const packet={requestId:"request",hostId:peer,run:{id:"actual-run",taskId:"actual-run",state:"done",success:true,startedAt:100,output:"Actual delivered report"},artifacts:[{id:"file",relativePath:"fitness.docx",contentHash:"a".repeat(64),bytes:10,createdAt:200}]};
    const insert=db.prepare("INSERT INTO automation_result_inbox(entry_id,source_host_id,request_id,content_hash,payload_json,received_at) VALUES(?,?,'request',?,?,?)");
    const receive=(id,body,at)=>{const raw=JSON.stringify(body);insert.run(id,peer,createHash("sha256").update(raw).digest("hex"),raw,at);};
    receive("foreign",{...packet,run:{...packet.run,id:"foreign-run"}},400);assert.equal(state(db).state,"pending");
    receive("actual",packet,500);db.prepare("UPDATE automation_result_watches SET active=0").run();assert.equal(state(db).state,"done");assert.equal(blocked(db),0);
    const artifacts=exec(db,goals,"SELECT a.artifact_id, a.relative_path",["fitness",null,null,20],"all");assert.equal(artifacts[0].relative_path,"fitness.docx");
    assert.equal(exec(db,goals,"SELECT a.entry_id FROM automation_goal_all_work",["fitness","request","file"],"get").entry_id,"actual");
    assert.equal(JSON.parse(db.prepare("SELECT config_json FROM automation_goals").get().config_json).steps[0].done,false);
  }finally{db.close();}
});

test("automatic work keeps all history, only live/recent detail rows, explicit unlinking, and original store/incarnation boundaries",()=>{
  const db=open();try{
    for(let i=0;i<9;i++)stage(db,`request-${i}`,100+i);
    db.prepare("UPDATE automation_result_watches SET active=0 WHERE request_id<>'request-0'").run();assert.equal(all(db).length,9);assert.equal(display(db).length,5);
    db.prepare("INSERT INTO automation_goal_work VALUES('fitness','request-0','Explicit manual link',100)").run();assert.equal(all(db).length,9);
    db.prepare("DELETE FROM automation_goal_work WHERE request_id='request-0'").run();exec(db,goals,"UPDATE automation_goal_event_work SET unlinked",["fitness","request-0"]);
    assert.equal(all(db).length,8);assert.equal(display(db).length,4);assert.equal(db.prepare("SELECT cancel_requested FROM automation_submission_outbox WHERE request_id='request-0'").get().cancel_requested,0);
    db.prepare("UPDATE automation_meta SET value='other-store' WHERE key='goal_store_id.v1'").run();assert.equal(all(db).length,0);
    db.prepare("UPDATE automation_meta SET value='original-goals' WHERE key='goal_store_id.v1'").run();assert.equal(all(db).length,8);
    db.prepare("UPDATE automation_goals SET created_at=2").run();assert.equal(all(db).length,0);
    db.prepare("UPDATE automation_goals SET created_at=1").run();db.prepare("UPDATE automation_meta SET value='another-phone' WHERE key='background_worker_id.v1'").run();assert.equal(all(db).length,0);
  }finally{db.close();}
});

test("event goal selection rotates only for actual owned acceptance and never transfers a local executor goal binding",()=>{
  const db=open();try{
    stage(db);const select=()=>exec(db,source,"SELECT c.task_id,c.task_binding,c.context_json",["request"],"all");assert.equal(select().length,0);
    db.prepare("UPDATE automation_submission_outbox SET result_json='{}'").run();assert.equal(select().length,1);
    db.prepare("UPDATE automation_submission_outbox SET cancel_requested=1").run();assert.equal(select().length,0);
    const remote=read("services/automation/store/proactive_remote.rs");assert.ok(remote.indexOf("goal_event_context::stage")<remote.indexOf("stage_background_submission_on_connection"));
    assert.match(remote,/goal_binding:None/);assert.match(remote,/goal_event_context::accepted/);assert.match(source,/actual result evidence/);assert.doesNotMatch(source,/GoalOperation::SetStep|UPDATE automation_goals SET config_json/);
  }finally{db.close();}
});
