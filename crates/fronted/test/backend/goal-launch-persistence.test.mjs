import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
const read=name=>readFileSync(new URL(`../../src-tauri/src/${name}`,import.meta.url),"utf8");
const query=(source,prefix)=>{const found=[...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(match=>match[1].trimStart().startsWith(prefix));assert.ok(found,prefix);return found[1];};
const goals=read("services/automation/store/goals.rs"),launch=read("services/automation/store/goal_launch.rs"),submission=read("services/automation/store/submission.rs"),inbox=read("services/automation/store/inbox.rs");
const owner=randomUUID(),peer=randomUUID(),request=randomUUID();
const goal={title:"产品发布",description:"制作产品说明书和网站",category:"career",parentId:null,steps:[{id:"docs",title:"整理文档",done:true},{id:"web",title:"完成官网",done:false}]};
const operation={requestId:request,goal:{goalId:"launch",storeId:"original-store",revision:1},peerId:peer,providerId:"p",model:"main",workdir:"/accepted",intelligentSchedulingEnabled:false};
function open(file=":memory:"){
  const db=new DatabaseSync(file);db.exec(query(read("services/automation/db.rs"),"CREATE TABLE IF NOT EXISTS automation_meta"));db.exec(read("services/automation/goals.sql"));
  if(!db.prepare("SELECT 1 FROM automation_goals").get()){
    db.prepare("INSERT INTO automation_meta VALUES ('background_worker_id.v1',?),('goal_store_id.v1','original-store'),('goal_revision','1')").run(owner);
    db.prepare(query(goals,"INSERT INTO automation_goals")).run("launch",JSON.stringify(goal),null,100);
  }return db;
}
function stage(db,sourceContext){
  db.prepare(query(inbox,"INSERT INTO automation_result_watches")).run(request,peer);
  db.prepare(query(submission,"INSERT INTO automation_submission_outbox")).run(request,owner,peer,JSON.stringify({requestId:request,name:goal.title,prompt:goal.description,model:"main",workdir:"/accepted",intelligentSchedulingEnabled:false,...(sourceContext?{sourceContext}:{})}),JSON.stringify({type:"goal",goal:operation.goal}),200);
  db.prepare(query(launch,"INSERT INTO automation_goal_launches")).run(request,"launch",owner,peer,JSON.stringify(operation),200);
  db.prepare(query(launch,"INSERT INTO automation_goal_work")).run("launch",request,goal.title,200);
  db.prepare(query(goals,"INSERT INTO automation_goal_activities")).run("launch","work_linked",goal.title,200);
  db.prepare("UPDATE automation_meta SET value='2' WHERE key='goal_revision'").run();
}

test("Goal launch plan ownership, submission/watch/link/audit/revision commit together and survive disk reopen",()=>{
  const directory=mkdtempSync(path.join(tmpdir(),"xgent-goal-launch-")),file=path.join(directory,"goals.sqlite");let db=open(file);
  try{
    for(const commit of [false,true]){db.exec("BEGIN IMMEDIATE");stage(db);db.exec(commit?"COMMIT":"ROLLBACK");assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_goal_launches").get().n,commit?1:0);assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_submission_outbox").get().n,commit?1:0);assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_result_watches").get().n,commit?1:0);}
    db.close();db=open(file);
    const receipt=db.prepare(query(launch,"SELECT s.source_host_id, s.result_json IS NOT NULL")).get(request);assert.equal(receipt.source_host_id,peer);assert.equal(Object.values(receipt)[1],0);
    const work=db.prepare(query(goals,"SELECT l.request_id")).get("launch");assert.equal(work.state,"submitting");assert.equal(Object.values(work)[4],1);
    assert.equal(Object.values(db.prepare(query(launch,"SELECT EXISTS (")).get("launch"))[0],1);
    assert.deepEqual(JSON.parse(db.prepare("SELECT config_json FROM automation_goals").get().config_json),goal);assert.equal(db.prepare("SELECT status FROM automation_goals").get().status,"active");
    assert.deepEqual(JSON.parse(db.prepare(query(launch,"SELECT operation_json FROM")).get(request).operation_json),operation);
  }finally{db.close();unlinkSync(file);rmdirSync(directory);}
});

test("pending/unknown Goal effects block another launch even after unlink; only original settled watches release it",()=>{
  const db=open();try{
    stage(db);const blocked=()=>Object.values(db.prepare(query(launch,"SELECT EXISTS (")).get("launch"))[0];assert.equal(blocked(),1);
    db.prepare("DELETE FROM automation_goal_work WHERE goal_id='launch'").run();assert.equal(blocked(),1);
    db.prepare("UPDATE automation_submission_outbox SET result_json=? WHERE request_id=?").run(JSON.stringify({requestId:request,hostId:peer,run:{id:request,taskId:request,state:"expired",success:false}}),request);assert.equal(blocked(),1);
    db.prepare("UPDATE automation_result_watches SET active=0 WHERE request_id=?").run(request);assert.equal(blocked(),0);
  }finally{db.close();}
});

test("pre-acceptance cancellation remains blocked until the original stop receipt and result watch settle",()=>{
  const db=open();try{
    stage(db);const blocked=()=>Object.values(db.prepare(query(launch,"SELECT EXISTS (")).get("launch"))[0];
    const work=()=>db.prepare(query(goals,"SELECT l.request_id")).get("launch");
    db.prepare("UPDATE automation_submission_outbox SET cancel_requested=1 WHERE request_id=?").run(request);
    assert.equal(blocked(),1);assert.equal(work().state,"stopping");
    db.prepare("UPDATE automation_submission_outbox SET cancel_json=? WHERE request_id=?").run(JSON.stringify({requestId:request,hostId:peer,run:{state:"expired",success:false}}),request);
    assert.equal(blocked(),1);assert.equal(work().state,"expired");assert.equal(work().success,0);
    db.prepare("UPDATE automation_result_watches SET active=0 WHERE request_id=?").run(request);
    assert.equal(blocked(),0);assert.equal(db.prepare("SELECT result_json FROM automation_submission_outbox").get().result_json,null);
    db.prepare("UPDATE automation_submission_outbox SET result_json=? WHERE request_id=?").run(JSON.stringify({requestId:request,hostId:peer,run:{id:request,taskId:request,state:"pending",success:false}}),request);
    assert.equal(work().state,"expired");assert.equal(blocked(),0);
    db.prepare("DELETE FROM automation_goal_work WHERE goal_id='launch'").run();assert.equal(blocked(),0);
  }finally{db.close();}
});

test("Goal launch uses the original namespace/CAS/active-state guards before staging and only declared ready planners",()=>{
  const command=read("commands/automation/goal_launch.rs"),lib=read("lib.rs"),access=read("services/local_access.rs");
  assert.match(command,/window\.label\(\) != "main"/);assert.match(command,/registry\.probe\(peer\)/);assert.match(command,/host\.workdir != input\.workdir/);assert.match(command,/provider\.models\.contains\(&input\.model\)/);
  assert.match(command,/"image"\|"video"\|"audio"/);assert.ok(command.indexOf("existing_goal_launch(&original)")<command.indexOf("registry.probe(peer)"));assert.ok(command.indexOf("stage_goal_launch(original")<command.indexOf("dispatch_selected(app"));
  for(const fragment of ["store != input.goal.store_id","goals::REVISION)? != input.goal.revision","if !active","has_active_work(&tx","stage_background_submission_on_connection","goal_binding: None","preserve completed steps","Missing input, device access or account authorization requires a durable wait"])
    assert.ok(launch.includes(fragment),fragment);
  assert.equal((lib.match(/commands::goal_launch::automation_goal_launch,/g)??[]).length,2);assert.match(access,/"automation_goal_launch"/);
  assert.doesNotMatch(command,/api_key|create_empty_registry|GoalOperation::SetStep|goal\.status =/);
});

test("frozen originating Goal context survives reopen with original source/evidence and cannot be replaced by another snapshot",()=>{
  const directory=mkdtempSync(path.join(tmpdir(),"xgent-goal-context-")),file=path.join(directory,"state.sqlite");let db=open(file);
  const sourceContext={version:1,requestScope:`goal/original-store/launch/${request}`,systemPrompt:JSON.stringify({version:1,capturedAt:200,records:[{slug:"report-style",scope:"global",memoryType:"feedback",excerpt:"Use a concise report",confidence:"low",unreviewed:true,updatedAt:100,sourceExcerpt:"original user feedback",truncated:false}]}),messages:[{role:"user",content:JSON.stringify(goal)}]};
  try{
    db.exec("BEGIN IMMEDIATE");stage(db,sourceContext);db.exec("COMMIT");db.close();db=open(file);
    const input=()=>JSON.parse(db.prepare("SELECT input_json FROM automation_submission_outbox WHERE request_id=?").get(request).input_json);
    assert.deepEqual(input().sourceContext,sourceContext);assert.equal(JSON.parse(input().sourceContext.messages[0].content).steps[0].done,true);
    assert.equal(Object.values(db.prepare(query(launch,"SELECT EXISTS (")).get("launch"))[0],1);
    db.exec("BEGIN IMMEDIATE");assert.throws(()=>stage(db,{...sourceContext,systemPrompt:"Changed later memory"}),/UNIQUE/);db.exec("ROLLBACK");
    assert.deepEqual(input().sourceContext,sourceContext);assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_goal_launches").get().n,1);
  }finally{db.close();unlinkSync(file);rmdirSync(directory);}
});

test("native Goal memory is captured outside queue locks after replay/target checks and sealed only with the original accepted plan",()=>{
  const command=read("commands/automation/goal_launch.rs"),capture=read("services/automation/origin_memory.rs");
  assert.ok(command.indexOf("existing_goal_launch(&original)")<command.indexOf("goal_launch_memory_query(&original)"));
  assert.ok(command.indexOf("valid_target(&host,&input)")<command.indexOf("origin_memory::capture(&memory,&query)"));
  assert.ok(command.indexOf("origin_memory::capture(&memory,&query)")<command.indexOf("stage_goal_launch(original"));
  assert.match(command,/!matches!\(host.source_context_version, 1 \| 2\) \|\| !matches!\(host.source_routing_version,1\|2\)/);
  assert.match(command,/try_state::<Arc<crate::services::memory::MemoryStore>>/);
  assert.match(launch,/routing:Some\(progress.routing\(&initiating\)\?\)/);
  assert.match(launch,/source.validate\(\)\?[\s\S]*?Some\(source\)/);
  assert.match(launch,/system_prompt:origin_memory.unwrap_or_default\(\)/);assert.match(launch,/requirements: None, source_context, goal_binding: None/);
  assert.match(launch,/chrono::Local::now\(\).to_rfc3339\(\)/);assert.match(launch,/"timestamp":accepted_at/);
  assert.match(capture,/store.overview\(None\)/);assert.match(capture,/entry.scope=="global" && matches!\(entry.memory_type.as_str\(\),"user"\|"feedback"\)/);
  assert.match(capture,/scope:Some\("global".into\(\)\),workdir:None/);assert.match(capture,/if reads>=4/);assert.match(capture,/length:Some\(16\)/);
  assert.match(capture,/store.read\(MemoryReadArgs/);assert.match(capture,/record.meta.archived/);assert.match(capture,/record.memory_type!=entry.memory_type/);
  assert.match(capture,/body.chars\(\).take\(600\)/);assert.match(capture,/source.chars\(\).take\(300\)/);assert.match(capture,/if text.len\(\)<=6400/);
  assert.doesNotMatch(capture,/entry.snippet|history_matches|\.write\(|\.update\(|\.delete\(|api_key|workdir:Some/);
  assert.match(read("services/automation/mod.rs"),/mod origin_memory/);
  assert.match(capture,/chars.windows\(2\)/);assert.match(capture,/word.as_str\(\).chars\(\).count\(\)>=2/);
  assert.match(capture,/OnceLock<Option<regex::Regex>>/);assert.doesNotMatch(capture,/store.search\(/);
});
