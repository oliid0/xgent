import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import test from "node:test";

// Actual production SQL; this does not execute compiled Rust, native queues,
// model requests, physical devices, or prove that a goal has been achieved.
const read=name=>readFileSync(new URL(`../../src-tauri/src/${name}`,import.meta.url),"utf8");
const source=read("services/automation/store/goal_prompt.rs"),store=read("services/automation/store.rs");
function sql(text,prefix){const value=[...text.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].map(m=>m[1]).find(v=>v.replace(/\s+/g," ").trim().startsWith(prefix));assert.ok(value,prefix);return value;}
const query=prefix=>sql(source,prefix);
const run=(db,q,values=[],method="run")=>db.prepare(q)[method](Object.fromEntries(values.map((v,i)=>[String(i+1),v])));
const owner=randomUUID(),peer=randomUUID();
const config={title:"产品发布",description:"先整理文档，再做汇报和官网",category:"career",parentId:null,steps:[{id:"read",title:"已阅读资料",done:true},{id:"ppt",title:"制作真实汇报",done:false}]};
function fixture(){const db=new DatabaseSync(":memory:");db.exec(sql(read("services/automation/db.rs"),"CREATE TABLE IF NOT EXISTS automation_meta"));db.exec(read("services/automation/goals.sql"));db.prepare("INSERT INTO automation_meta VALUES ('goal_store_id.v1','original-goals')").run();db.prepare("INSERT INTO automation_meta VALUES ('background_worker_id.v1',?)").run(owner);return db;}
function goal(db,id="launch",task="timer",opt=false){
  db.prepare("INSERT INTO automation_goals (goal_id,config_json,status,created_at,updated_at) VALUES (?,?,'active',1,1)").run(id,JSON.stringify(config));
  db.prepare("INSERT INTO automation_goal_tasks VALUES (?,?,'Goal review',1)").run(id,task);
  if(opt)run(db,query("INSERT INTO automation_goal_prompt_links"),[id,task,"original-goals","original-template"]);
  return id;
}
const selected=(db,task="timer",binding="original-template")=>run(db,query("SELECT g.goal_id FROM automation_goal_tasks"),[task,binding],"all").map(r=>r.goal_id);
function queued(db,id="run",task="timer"){
  db.prepare("INSERT INTO automation_cron_runs (execution_id,task_id,state,success,started_at,request_json) VALUES (?,?,'pending',0,1,'{}')").run(id,task);
}

test("tracking-only links never activate planning; explicit follow-up is pinned to the original template/store",()=>{
  const db=fixture();try{
    goal(db);assert.deepEqual(selected(db),[]);
    run(db,query("INSERT INTO automation_goal_prompt_links"),["launch","timer","original-goals","original-template"]);
    assert.deepEqual(selected(db),["launch"]);assert.deepEqual(selected(db,"another"),[]);assert.deepEqual(selected(db,"timer","changed-template"),[]);
    db.prepare("UPDATE automation_meta SET value='other-owner' WHERE key='goal_store_id.v1'").run();assert.deepEqual(selected(db),[]);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_cron_runs").get().n,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_tasks").get().n,0);
  }finally{db.close();}
});

test("paused/completed/deleted/unlinked/disabled follow-up cannot leak an old goal context into an independent schedule",()=>{
  const db=fixture();try{
    goal(db,"launch","timer",true);queued(db);
    for(const state of ["paused","completed"]){db.prepare("UPDATE automation_goals SET status=?").run(state);assert.deepEqual(selected(db),[]);}
    db.exec("UPDATE automation_goals SET status='active'");assert.deepEqual(selected(db),["launch"]);
    run(db,query("DELETE FROM automation_goal_prompt_links WHERE goal_id"),["launch","timer"]);assert.deepEqual(selected(db),[]);
    assert.equal(db.prepare("SELECT state FROM automation_cron_runs").get().state,"pending");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_goal_tasks").get().n,1);
  }finally{db.close();}
});

test("four-goal selection rotates without changing user progress and remains isolated from other tasks",()=>{
  const db=fixture();try{
    for(let i=0;i<9;i++)goal(db,`g${i}`,"timer",true);goal(db,"foreign","different",true);
    const first=selected(db);assert.equal(first.length,5);
    db.exec("BEGIN IMMEDIATE");for(const id of first.slice(0,4))run(db,query("INSERT INTO automation_goal_prompt_rotation"),["timer",id,100]);db.exec("COMMIT");
    const second=selected(db);assert.ok(second.slice(0,4).every(id=>!first.slice(0,4).includes(id)));
    assert.ok(!second.includes("foreign"));
    assert.ok(db.prepare("SELECT config_json,status FROM automation_goals").all().every(row=>row.status==="active"&&JSON.parse(row.config_json).steps[0].done));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_goal_activities").get().n,0);
  }finally{db.close();}
});

test("original context receipt is atomic with queue/claim state and refreshes without rewriting the frozen task input",()=>{
  const db=fixture();try{
    goal(db,"launch","timer",true);
    const insert=query("INSERT INTO automation_goal_prompt_contexts"),update=query("UPDATE automation_goal_prompt_contexts SET context_json");
    db.exec("BEGIN IMMEDIATE");queued(db);run(db,insert,["run","timer","original-template","original-goals",'{"observedAt":1}',1]);db.exec("ROLLBACK");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_goal_prompt_contexts").get().n,0);
    queued(db);run(db,insert,["run","timer","original-template","original-goals",'{"observedAt":1}',1]);
    const receipt=run(db,query("SELECT task_binding,store_id FROM automation_goal_prompt_contexts"),["run","timer"],"get");assert.equal(receipt.task_binding,"original-template");
    run(db,update,["run",'{"observedAt":2,"completedSteps":1}']);
    assert.equal(db.prepare("SELECT request_json FROM automation_cron_runs").get().request_json,"{}");
    run(db,update,["run",null]);assert.equal(db.prepare("SELECT context_json FROM automation_goal_prompt_contexts").get().context_json,null);
    db.exec("DELETE FROM automation_cron_runs");run(db,query("DELETE FROM automation_goal_prompt_contexts"));assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_goal_prompt_contexts").get().n,0);
  }finally{db.close();}
});

test("work hints preserve actual local and original owned remote statuses, including uncertain submission and stop intent",()=>{
  const db=fixture();try{
    goal(db);
    const q=query("SELECT l.request_id,l.task_name,b.execution_id");
    const request=randomUUID(),execution=randomUUID();
    db.prepare("INSERT INTO automation_background_tasks (request_id,execution_id,input_json,created_at) VALUES (?,?,'{}',1)").run(request,execution);
    db.prepare("INSERT INTO automation_cron_runs (execution_id,task_id,state,success,started_at,output) VALUES (?,?,'waiting',0,1,'Actual missing approval')").run(execution,execution);
    db.prepare("INSERT INTO automation_goal_work VALUES ('launch',?,'Local report',1)").run(request);
    const remote=randomUUID();
    db.prepare("INSERT INTO automation_goal_work VALUES ('launch',?,'Remote report',2)").run(remote);
    db.prepare("INSERT INTO automation_goal_launches VALUES (?,'launch',?,?,'{}',2)").run(remote,owner,peer);
    db.prepare("INSERT INTO automation_submission_outbox (request_id,initiating_host_id,source_host_id,input_json,origin_json,created_at) VALUES (?,?,?,'{}','{}',2)").run(remote,owner,peer);
    let rows=run(db,q,["launch"],"all");assert.equal(rows[0].state,"submitting");assert.equal(rows[0].source_host_id,peer);assert.equal(rows[1].state,"waiting");
    db.prepare("UPDATE automation_submission_outbox SET cancel_requested=1 WHERE request_id=?").run(remote);
    rows=run(db,q,["launch"],"all");assert.equal(rows[0].state,"stopping");assert.equal(rows[0].source_host_id,peer);
    db.prepare("UPDATE automation_submission_outbox SET initiating_host_id=? WHERE request_id=?").run(randomUUID(),remote);
    rows=run(db,q,["launch"],"all");assert.equal(rows[0].source_host_id,null);
  }finally{db.close();}
});

test("artifact hint SQL uses actual local manifests and only received owned remote file evidence",()=>{
  const db=fixture();try{
    goal(db);const request=randomUUID(),execution=randomUUID(),artifact=randomUUID();
    db.prepare("INSERT INTO automation_background_tasks (request_id,execution_id,input_json,created_at) VALUES (?,?,'{}',1)").run(request,execution);
    db.prepare("INSERT INTO automation_goal_work VALUES ('launch',?,'Report',1)").run(request);
    db.prepare("INSERT INTO automation_background_artifacts (artifact_id,execution_id,relative_path,content_hash,bytes,content,created_at) VALUES (?,?,'reports/product.pptx',?,4,X'01020304',10)").run(artifact,execution,"a".repeat(64));
    const rows=run(db,query("SELECT id,relative_path,content_hash,bytes,request_id,source_host_id"),["launch",owner],"all");
    assert.equal(rows[0].id,artifact);assert.equal(rows[0].bytes,4);assert.equal(rows[0].source_host_id,owner);
    const remote=randomUUID(),remoteExecution=randomUUID();
    db.prepare("INSERT INTO automation_goal_work VALUES ('launch',?,'Remote',2)").run(remote);
    const record={hostId:peer,requestId:remote,name:"Remote",run:{id:remoteExecution,taskId:remoteExecution,state:"done",success:false},artifacts:[{id:randomUUID(),relativePath:"site/index.html",contentHash:"b".repeat(64),bytes:100,createdAt:20}]};
    db.prepare("INSERT INTO automation_submission_outbox (request_id,initiating_host_id,source_host_id,input_json,origin_json,result_json,created_at) VALUES (?,?,?,'{}','{}',?,2)").run(remote,owner,peer,JSON.stringify(record));
    assert.equal(run(db,query("SELECT id,relative_path,content_hash,bytes,request_id,source_host_id"),["launch",owner],"all").length,1);
    db.prepare("INSERT INTO automation_result_inbox (entry_id,source_host_id,request_id,content_hash,payload_json,received_at) VALUES (?,?,?,?,?,30)").run(randomUUID(),peer,remote,"c".repeat(64),JSON.stringify(record));
    assert.equal(run(db,query("SELECT id,relative_path,content_hash,bytes,request_id,source_host_id"),["launch",owner],"all").length,2);
  }finally{db.close();}
});

test("claim-time integration retains legacy/background behavior, original prompt and counted lease semantics",()=>{
  assert.match(store,/let mut request = PromptRunRequest/);assert.match(store,/capture_goal_prompt_context\(tx,task,&mut request\)/);
  assert.ok(store.indexOf("Self::refresh_goal_prompt_context(&tx,request)")<store.indexOf("request.lease = Self::claim_background_lease"));
  assert.match(source,/request.background_context.is_some\(\) \|\| request.task_id==request.execution_id/);
  assert.match(source,/original.prompt=base.prompt.clone\(\)/);
  assert.match(source,/current_store==store.*task_binding/);
  assert.doesNotMatch(source,/request.prompt\s*=|request.provider_id\s*=|request.model\s*=|queue_prompt_in_transaction\(|submit_background_task\(|UPDATE automation_goals SET/);
  assert.match(read("services/automation/types.rs"),/goal_context: Option/);
  assert.match(read("services/automation/store/background.rs"),/goal_context: None/);
  assert.match(read("services/automation/store/goals.rs"),/skip_serializing_if="Option::is_none".*follow_up/);
});
