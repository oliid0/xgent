import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import test from "node:test";

const read=file=>readFileSync(new URL(`../../src-tauri/src/${file}`,import.meta.url),"utf8");
const dbSource=read("services/automation/db.rs"),waiting=read("services/automation/store/cloud_waiting.rs"),outcomes=read("services/automation/store/outcomes.rs");
const sql=(text,prefix)=>{const match=[...text.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(item=>item[1].trimStart().startsWith(prefix));assert.ok(match,prefix);return match[1];};
const schema=sql(dbSource,"CREATE TABLE IF NOT EXISTS automation_meta"),insert=sql(waiting,"INSERT INTO automation_background_cloud_completions"),pending=sql(waiting,"SELECT c.call_id FROM automation_background_cloud_launches"),completed=sql(waiting,"SELECT EXISTS(SELECT 1 FROM automation_background_cloud_completions p"),retained=sql(waiting,"UPDATE automation_background_outcomes SET evidence_json=?3");
function open(file=":memory:"){const db=new DatabaseSync(file);db.exec(schema);return db;}
function launch(db,call="start",task="task-original",owner="owner",repo="agent-temp"){
  db.prepare("INSERT INTO automation_background_cloud_launches(execution_id,call_id,task_id,arguments_hash,owner,repository,runner,issued_at,result_json) VALUES(?,?,?,?,?,?,?,?,?)").run("execution",call,task,"original-hash",owner,repo,"ubuntu-latest",100,JSON.stringify({details:{taskId:task,owner,repository:repo}}));
}
function observe(db,{call="start",task="task-original",owner="owner",repo="agent-temp",run=17,conclusion="success",status}={}){
  return db.prepare(insert).run("execution",call,owner,repo,task,run,conclusion,JSON.stringify(status??{taskId:task,state:"completed",runId:run,conclusion}),200);
}
const success=(db,call="start",task="task-original",owner="owner",repo="agent-temp")=>Object.values(db.prepare(completed).get("execution",call,owner,repo,task))[0];

test("native cloud terminal proof survives reopening and acceptance alone never completes an owned operation",()=>{
  const directory=mkdtempSync(path.join(tmpdir(),"xgent-cloud-complete-")),file=path.join(directory,"state.sqlite");let db=open(file);
  try{
    launch(db);assert.equal(success(db),0);assert.equal(db.prepare(pending).get("execution").call_id,"start");
    observe(db);db.close();db=open(file);
    assert.equal(success(db),1);assert.equal(db.prepare(pending).get("execution"),undefined);
    assert.throws(()=>observe(db,{run:99}),/UNIQUE/);
    assert.equal(db.prepare("SELECT run_id FROM automation_background_cloud_completions").get().run_id,17);
  }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});

test("failure/cancellation/timeout settle their run but cannot become successful evidence; a corrected owned job can finish",()=>{
  for(const conclusion of ["failure","cancelled","timed_out","skipped","neutral"]){
    const db=open();try{
      launch(db);observe(db,{conclusion});assert.equal(success(db),0);assert.equal(db.prepare(pending).get("execution"),undefined);
      launch(db,"retry","task-corrected");assert.equal(db.prepare(pending).get("execution").call_id,"retry");
      observe(db,{call:"retry",task:"task-corrected",run:18});assert.equal(success(db,"retry","task-corrected"),1);
      assert.equal(db.prepare(pending).get("execution"),undefined);assert.equal(success(db),0);
    }finally{db.close();}
  }
});

test("foreign namespace/task/call proofs and pending cancellation cannot complete the original work",()=>{
  for(const change of [{owner:"other"},{repo:"other"},{task:"task-other"},{call:"other"}]){
    const db=open();try{launch(db);observe(db,change);assert.equal(success(db),0);assert.equal(db.prepare(pending).get("execution").call_id,"start");}finally{db.close();}
  }
  const db=open();try{
    launch(db);observe(db);db.prepare("INSERT INTO automation_background_cloud_cancellations(execution_id,call_id,requested_at,retry_at) VALUES(?,?,?,?)").run("execution","start",300,300);
    assert.equal(success(db),0);
    db.prepare("UPDATE automation_background_cloud_cancellations SET terminal_at=400 WHERE execution_id=? AND call_id=?").run("execution","start");assert.equal(success(db),1);
  }finally{db.close();}
});

test("schema rejects missing, inconsistent, nonterminal and oversized status; failed wake transaction rolls back proof",()=>{
  const db=open();try{
    launch(db);
    for(const status of [{},{taskId:"task-original",state:"in_progress",runId:17,conclusion:"success"},{taskId:"other",state:"completed",runId:17,conclusion:"success"},{taskId:"task-original",state:"completed",runId:18,conclusion:"success"},{taskId:"task-original",state:"completed",runId:17,conclusion:"failure"},{taskId:"task-original",state:"completed",runId:17,conclusion:"success",extra:"x".repeat(8192)}])assert.throws(()=>observe(db,{status}),/CHECK/);
    assert.throws(()=>observe(db,{run:0}),/CHECK/);
    db.exec("BEGIN IMMEDIATE");observe(db);assert.equal(success(db),1);db.exec("ROLLBACK");
    assert.equal(success(db),0);assert.equal(db.prepare(pending).get("execution").call_id,"start");
  }finally{db.close();}
});

test("cloud parking preserves existing actual outcome evidence while keeping the branch waiting",()=>{
  const db=open();try{
    const proof=JSON.stringify({artifactIds:["real-file"],callIds:[],answer:null});
    db.prepare("INSERT INTO automation_background_outcomes(execution_id,branch_id,state,evidence_json,reason,updated_at) VALUES(?,?,?,?,?,?)").run("execution","files","waiting",null,"Owned cloud run still active",100);
    db.prepare(retained).run("execution","files",proof);
    const row=db.prepare("SELECT state,evidence_json FROM automation_background_outcomes").get();assert.equal(row.state,"waiting");assert.equal(row.evidence_json,proof);
  }finally{db.close();}
});

test("native GET collector fences scope/configuration before and after network and persists observation atomically with wake",()=>{
  const command=read("commands/automation/cloud_waiting.rs");
  assert.match(command,/window.label\(\)!="agent-worker"/);assert.match(command,/waiting_background_cloud_task[\s\S]*task_status\(&token,&locator\)[\s\S]*wake_completed_background_cloud_task/);
  assert.doesNotMatch(command,/status:CloudTaskStatus|status:Value|task_start|workflow_dispatch/);
  const wake=waiting.slice(waiting.indexOf("pub fn wake_completed_background_cloud_task"));
  assert.match(wake,/require_wait[\s\S]*verify_background_binding[\s\S]*started_cloud_task[\s\S]*Original cloud terminal observation is immutable/);
  assert.match(wake,/INSERT INTO automation_background_cloud_completions[\s\S]*resume_wait_on_connection[\s\S]*tx.commit/);
  assert.match(outcomes,/cloud_operation_completed\(conn,execution_id,id\)/);
  assert.match(outcomes,/cloud_operation_completed\(conn,execution_id,call\)/);
  assert.match(outcomes,/branches.iter\(\).all[\s\S]*unfinished_cloud_call[\s\S]*branch.state="waiting"/);
});
