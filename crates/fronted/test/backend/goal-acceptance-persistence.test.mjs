import assert from "node:assert/strict";
import { mkdtempSync,readFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const read=name=>readFileSync(new URL(`../../src-tauri/src/services/automation/${name}`,import.meta.url),"utf8");
const sql=(source,prefix)=>{const literal=[...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(match=>match[1].trimStart().startsWith(prefix));assert.ok(literal,prefix);return literal[1];};
const background=read("store/background.rs"),goals=read("store/goals.rs"),dbSource=read("db.rs"),admission=goals.slice(goals.indexOf("pub(super) fn accept_background_goal"),goals.indexOf("pub fn goal_snapshot"));
const config={title:"Product",description:"Read documents and deliver actual report",category:"career",parentId:null,steps:[{id:"docs",title:"Read",done:false}]};
const input={requestId:"original-request",name:"Report",prompt:"Create report",goalBinding:{goalId:"launch",storeId:"original-store",revision:4}};
function open(file=":memory:"){
  const db=new DatabaseSync(file);db.exec(sql(dbSource,"CREATE TABLE IF NOT EXISTS automation_meta"));db.exec(read("goals.sql"));
  return db;
}
function seed(db){
  db.prepare(sql(goals,"INSERT INTO automation_goals")).run("launch",JSON.stringify(config),null,100);
  const meta=db.prepare(sql(dbSource,"INSERT INTO automation_meta (key, value) VALUES (?1, ?2)"));meta.run("goal_store_id.v1","original-store");meta.run("goal_revision","4");
}
// Execute the production statements and admission predicates against SQLite.
// This deliberately does not claim that the Rust host was compiled/executed.
function accept(db,packet=input){
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing=db.prepare(sql(background,"SELECT input_json FROM automation_background_tasks WHERE request_id = ?1")).get(packet.requestId);
    if(existing){assert.equal(existing.input_json,JSON.stringify(packet),"request payload changed");db.exec("COMMIT");return;}
    db.prepare(sql(background,"INSERT INTO automation_background_tasks")).run(packet.requestId,"execution",JSON.stringify(packet),200);
    db.prepare(sql(background,"INSERT INTO automation_cron_runs (execution_id, task_id, state, success")).run("execution",200,1000,"{}");
    db.prepare(sql(background,"INSERT INTO automation_background_configuration_bindings")).run("execution","actual-model-binding");
    const goal=packet.goalBinding;
    if(db.prepare(sql(admission,"SELECT value FROM automation_meta WHERE key = 'goal_store_id.v1'")).get().value!==goal.storeId)throw new Error("owner");
    if(Number(db.prepare("SELECT value FROM automation_meta WHERE key='goal_revision'").get().value)!==goal.revision)throw new Error("revision");
    const state=db.prepare(sql(admission,"SELECT status FROM automation_goals WHERE goal_id")).get(goal.goalId);if(!state)throw new Error("missing");if(state.status!=="active")throw new Error("inactive");
    if(Object.values(db.prepare(sql(admission,"SELECT COUNT(*) FROM automation_goal_work WHERE goal_id")).get(goal.goalId))[0]>=32)throw new Error("quota");
    db.prepare(sql(admission,"INSERT INTO automation_goal_work")).run(goal.goalId,packet.requestId,packet.name,200);
    db.prepare(sql(goals,"INSERT INTO automation_goal_activities")).run(goal.goalId,"work_linked",packet.name,200);
    db.prepare(sql(dbSource,"INSERT INTO automation_meta (key, value) VALUES (?1, ?2)")).run("goal_revision",String(goal.revision+1));
    db.exec("COMMIT");
  }catch(error){db.exec("ROLLBACK");throw error;}
}

test("queue, configuration, goal link and audit commit together; exact replay after disk reopen does not relink a stopped goal",()=>{
  const directory=mkdtempSync(path.join(tmpdir(),"xgent-goal-acceptance-")),file=path.join(directory,"goals.sqlite");let db=open(file);
  try{
    seed(db);accept(db);assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_goal_work").get().n,1);assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_goal_activities").get().n,1);assert.equal(db.prepare("SELECT value FROM automation_meta WHERE key='goal_revision'").get().value,"5");
    db.close();db=open(file);db.prepare("UPDATE automation_goals SET status='paused' WHERE goal_id='launch'").run();db.prepare("DELETE FROM automation_goal_work WHERE goal_id='launch'").run();db.prepare("UPDATE automation_cron_runs SET state='expired' WHERE execution_id='execution'").run();
    accept(db);assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_background_tasks").get().n,1);assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_goal_work").get().n,0);assert.equal(db.prepare("SELECT state FROM automation_cron_runs").get().state,"expired");assert.equal(db.prepare("SELECT value FROM automation_meta WHERE key='goal_revision'").get().value,"5");
    assert.throws(()=>accept(db,{...input,goalBinding:{...input.goalBinding,goalId:"other"}}),/payload changed/);
  }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});

test("wrong store, stale plan, missing or inactive goal and quota roll back every pending execution row",()=>{
  for(const mode of ["owner","revision","missing","paused","completed","quota","disk failure"]){const db=open();try{
    seed(db);let packet=input;
    if(["owner","revision","missing"].includes(mode))packet={...input,goalBinding:{...input.goalBinding,...(mode==="owner"?{storeId:"other"}:mode==="revision"?{revision:3}:{goalId:"missing"})}};
    if(["paused","completed"].includes(mode))db.prepare("UPDATE automation_goals SET status=?").run(mode);
    if(mode==="quota")for(let i=0;i<32;i++)db.prepare(sql(admission,"INSERT INTO automation_goal_work")).run("launch",`accepted-${i}`,"Actual work",100);
    if(mode==="disk failure")db.exec("CREATE TRIGGER simulate_goal_write_failure BEFORE INSERT ON automation_goal_work BEGIN SELECT RAISE(ABORT, 'disk failure'); END");
    assert.throws(()=>accept(db,packet),new RegExp(["paused","completed"].includes(mode)?"inactive":mode));
    for(const table of ["automation_background_tasks","automation_cron_runs","automation_background_configuration_bindings","automation_goal_activities"])assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0,`${mode}: ${table}`);
    assert.equal(db.prepare("SELECT value FROM automation_meta WHERE key='goal_revision'").get().value,"4");
  }finally{db.close();}}
});

test("native wiring pins binding in accepted input, execution context and receipt, within only the new-request transaction branch",()=>{
  assert.match(background,/if let Some\(existing\) = existing \{[\s\S]*?existing != input_json[\s\S]*?\} else \{[\s\S]*?Self::accept_background_goal\(&tx, goal, &input.request_id, &input.name, now\)\?;[\s\S]*?tx.commit\(\)/);
  assert.match(background,/goal_binding: input.goal_binding.clone\(\)/);assert.match(background,/children, videos, goal_binding: input.goal_binding/);
  assert.match(admission,/db::read_revision\(conn, REVISION\)\? != goal.revision/);assert.match(admission,/status != "active"/);assert.match(admission,/activity\(conn[\s\S]*?db::bump_revision\(conn, REVISION\)/);
  const peers=readFileSync(new URL("../../src-tauri/src/services/worker_peers.rs",import.meta.url),"utf8");assert.match(peers,/input.get\("goalBinding"\)[\s\S]*?host.goal_acceptance_version != 1/);
  assert.match(read("store/submission.rs"),/if !pending.cancel_requested \{[\s\S]*?pending.input.goal_binding[\s\S]*?result\["goalBinding"\][\s\S]*?&accepted != expected/);
});
