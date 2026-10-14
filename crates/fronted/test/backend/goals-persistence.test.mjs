import assert from "node:assert/strict";
import { mkdtempSync,readFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const read=name=>readFileSync(new URL(`../../src-tauri/src/services/automation/${name}`,import.meta.url),"utf8");
const source=read("store/goals.rs"),schema=read("goals.sql");
const sql=(text,prefix)=>{const match=[...text.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(item=>item[1].trimStart().startsWith(prefix));assert.ok(match,prefix);return match[1];};
const base=sql(read("db.rs"),"CREATE TABLE IF NOT EXISTS automation_meta"),create=sql(source,"INSERT INTO automation_goals"),link=sql(source,"INSERT OR IGNORE INTO automation_goal_tasks"),audit=sql(source,"INSERT INTO automation_goal_activities"),receipt=sql(source,"INSERT INTO automation_goal_receipts"),activity=sql(source,"SELECT id, kind, label, at"),tasks=sql(source,"SELECT l.task_id");
const config={title:"Product",description:"Actual plan",category:"career",parentId:null,steps:[{id:"docs",title:"Read documents",done:true}]};
function open(file=":memory:"){const db=new DatabaseSync(file);db.exec(base);db.exec(schema);return db;}
function seed(db){db.prepare(create).run("launch",JSON.stringify(config),null,100);db.prepare(link).run("launch","fitness","Fitness",200);}
function run(db,id,state,at=300,success=0,output=""){db.prepare("INSERT INTO automation_cron_runs (execution_id,task_id,state,started_at,success,output) VALUES (?, 'fitness', ?, ?, ?, ?)").run(id,state,at,success,output);}

test("actual Goals SQL commits config, audit and receipt atomically and survives disk reopen",()=>{
  const directory=mkdtempSync(path.join(tmpdir(),"xgent-goals-")),file=path.join(directory,"goals.sqlite");let db=open(file);
  try{
    for(const commit of [false,true]){db.exec("BEGIN IMMEDIATE");seed(db);db.prepare(audit).run("launch","created",config.title,100);db.prepare(receipt).run("exact-request",JSON.stringify({op:"create",id:"launch",config}),100);db.exec(commit?"COMMIT":"ROLLBACK");assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_goals").get().n,commit?1:0);assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_goal_receipts").get().n,commit?1:0);}
    db.close();db=open(file);assert.deepEqual(JSON.parse(db.prepare("SELECT config_json FROM automation_goals").get().config_json),config);assert.equal(db.prepare("SELECT operation_json FROM automation_goal_receipts WHERE request_id = ?").get("exact-request").operation_json,JSON.stringify({op:"create",id:"launch",config}));
    assert.throws(()=>db.prepare(receipt).run("exact-request","different mutation",101));assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_goal_activities").get().n,1);
  }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});

test("activity uses real linked executions after linking, stable paging and bounded Unicode output",()=>{
  const db=open();try{
    seed(db);run(db,"old","done",199,1,"Old history");
    for(const state of ["pending","leased","waiting","suspended","expired"])run(db,state,state);
    run(db,"success","done",300,1,"好".repeat(2500));run(db,"failure","done",300,0,"Actual failure");
    db.prepare(audit).run("launch","created","Product",100);
    const rows=db.prepare(activity).all("launch",null,null,50);assert.equal(rows.length,8);assert.ok(!rows.some(row=>row.id==="run:old"));assert.equal(rows.find(row=>row.id==="run:leased").state,"leased");assert.equal(rows.find(row=>row.id==="run:failure").success,0);assert.equal(rows.find(row=>row.id==="run:success").output.length,2000);
    const first=db.prepare(activity).all("launch",null,null,3),last=first.at(-1),next=db.prepare(activity).all("launch",last.at,last.id,50);assert.deepEqual([...first,...next],rows);
    assert.equal(db.prepare("SELECT status FROM automation_goals").get().status,"active");assert.equal(JSON.parse(db.prepare("SELECT config_json FROM automation_goals").get().config_json).steps[0].done,true);
  }finally{db.close();}
});

test("a removed linked schedule retains its real name and duplicate linking does not reset its watermark",()=>{
  const db=open();try{
    seed(db);db.prepare("INSERT INTO automation_cron_tasks (task_id,name,cron_expr,kind,enabled,config_json,sort_index,updated_at) VALUES ('fitness','Fitness','0 20 * * *','prompt',1,'{}',0,100)").run();
    assert.equal(Object.values(db.prepare(tasks).get("launch"))[3],1);
    assert.equal(db.prepare(link).run("launch","fitness","Changed label",999).changes,0);assert.equal(db.prepare("SELECT linked_at FROM automation_goal_tasks").get().linked_at,200);
    db.prepare("DELETE FROM automation_cron_tasks WHERE task_id = 'fitness'").run();const task=db.prepare(tasks).get("launch");assert.equal(Object.values(task)[1],"Fitness");assert.equal(Object.values(task)[3],0);
  }finally{db.close();}
});

test("real accepted work state, artifact paging and unlinking are scoped to the goal without cancelling execution",()=>{
  const db=open();try {
    seed(db);const workLink=sql(source,"INSERT OR IGNORE INTO automation_goal_work"),workRows=sql(source,"SELECT l.request_id"),files=sql(source,"SELECT a.artifact_id, a.relative_path, a.content_hash, a.bytes, b.request_id");
    for(const [request,execution,name] of [["accepted","product","Actual report"],["other-request","unrelated","Other task"]]){
      db.prepare("INSERT INTO automation_background_tasks VALUES (?, ?, ?, ?)").run(request,execution,JSON.stringify({name,workdir:"/private",run:{prompt:"Private input"}}),100);
      db.prepare("INSERT INTO automation_cron_runs (execution_id,task_id,state,started_at,success,output) VALUES (?, ?, 'leased', 150, 0, 'Actual progress')").run(execution,execution);
    }
    db.prepare(workLink).run("launch","accepted","Original name",200);assert.equal(db.prepare(workLink).run("launch","accepted","Wrong replay",999).changes,0);
    let work=db.prepare(workRows).get("launch");assert.equal(work.request_id,"accepted");assert.equal(Object.values(work)[1],"Actual report");assert.equal(work.state,"leased");assert.equal(work.success,0);
    for(const [id,execution,at] of [["file-z","product",300],["file-y","product",300],["file-x","product",200],["private-other","unrelated",400]])db.prepare("INSERT INTO automation_background_artifacts VALUES (?, ?, ?, ?, ?, ?, ?)").run(id,execution,`${id}.pptx`,"a".repeat(64),4,Buffer.from("real"),at);
    const all=db.prepare(files).all("launch",null,null,50);assert.equal(all.length,3);assert.ok(all.every(row=>row.request_id==="accepted"));assert.ok(all.every(row=>!Object.hasOwn(row,"content")));
    const first=db.prepare(files).all("launch",null,null,2),last=first.at(-1),next=db.prepare(files).all("launch",last.created_at,last.artifact_id,50);assert.deepEqual([...first,...next],all);
    const events=db.prepare(activity).all("launch",null,null,50);assert.equal(events.find(row=>row.id==="work:product").state,"leased");assert.ok(!events.some(row=>row.id==="work:unrelated"));
    db.prepare("UPDATE automation_cron_runs SET state='done', success=1 WHERE execution_id='product'").run();work=db.prepare(workRows).get("launch");assert.equal(work.state,"done");assert.equal(work.success,1);assert.equal(db.prepare("SELECT status FROM automation_goals").get().status,"active");
    db.exec("BEGIN");db.prepare(sql(source,"DELETE FROM automation_goal_work WHERE goal_id = ?1 AND request_id")).run("launch","accepted");assert.equal(db.prepare(files).all("launch",null,null,50).length,0);db.exec("ROLLBACK");assert.equal(db.prepare(files).all("launch",null,null,50).length,3);
    db.prepare(sql(source,"DELETE FROM automation_goal_work WHERE goal_id = ?1 AND request_id")).run("launch","accepted");assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_background_tasks").get().n,2);assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_background_artifacts").get().n,4);assert.equal(db.prepare("SELECT state FROM automation_cron_runs WHERE execution_id='product'").get().state,"done");
  }finally{db.close();}
});

test("artifact content query requires both original accepted request and artifact",()=>{
  const db=open();try {
    seed(db);db.prepare(sql(source,"INSERT OR IGNORE INTO automation_goal_work")).run("launch","accepted","Report",200);
    db.prepare("INSERT INTO automation_background_tasks VALUES ('accepted','execution','{}',100)").run();db.prepare("INSERT INTO automation_background_artifacts VALUES ('file','execution','real.pptx',?,4,?,100)").run("a".repeat(64),Buffer.from("real"));
    const linked=db.prepare(sql(source.slice(source.indexOf("pub fn goal_artifact_content")),"SELECT EXISTS")),contentQuery=db.prepare(sql(read("store/artifacts.rs"),"SELECT a.artifact_id, a.relative_path, a.content_hash, a.bytes, a.content"));
    assert.equal(Object.values(linked.get("launch","accepted"))[0],1);assert.equal(Object.values(linked.get("other-goal","accepted"))[0],0);assert.equal(Object.values(linked.get("launch","other-request"))[0],0);
    assert.equal(Buffer.from(contentQuery.get("accepted","file").content).toString(),"real");assert.equal(contentQuery.get("other-request","file"),undefined);assert.equal(contentQuery.get("accepted","other-file"),undefined);
  }finally{db.close();}
});
