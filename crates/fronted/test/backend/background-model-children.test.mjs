import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// Real production SQLite statements prove transaction boundaries and durable
// ownership. Native model/lease/configuration guards have Rust tests (UNRUN).
const read=name=>readFileSync(new URL(`../../src-tauri/src/${name}`,import.meta.url),"utf8");
const base="services/automation/", background=read(`${base}store/background.rs`), models=read(`${base}store/model_children.rs`), children=read(`${base}store/children.rs`), budget=read(`${base}store/budget.rs`), journal=read(`${base}store/journal.rs`);
const sql=(source,prefix)=>{const match=[...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(m=>m[1].trimStart().replace(/\s+/g," ").startsWith(prefix.replace(/\s+/g," ")));assert.ok(match,prefix);return match[1];};
const migration=sql(read(`${base}db.rs`),"CREATE TABLE IF NOT EXISTS automation_meta");
const root="root-execution", child="child-execution", host="original-host", request="child-request";
const insertTask=sql(background,"INSERT INTO automation_background_tasks"), insertQueue=sql(background,"INSERT INTO automation_cron_runs"), insertBinding=sql(background,"INSERT INTO automation_background_configuration_bindings");
const grant=sql(budget,"INSERT INTO automation_background_budget_grants"), ledger=sql(budget,"INSERT INTO automation_background_budgets (execution_id, max_model_requests, max_tool_calls) VALUES (?1, ?2, ?3)");
const insertChild=sql(models,"INSERT INTO automation_background_children"), observe=sql(children,"UPDATE automation_background_children SET receipt_json"), localGuard=sql(models,"SELECT EXISTS(SELECT 1 FROM automation_background_children c JOIN automation_background_tasks");
const originalInput={requestId:request,name:"Slides",prompt:"Produce actual slides",providerId:"configured",model:"specialist",workdir:"/accepted",intelligentSchedulingEnabled:true,files:[{name:"report.txt",contentBase64:"YWN0dWFs",sha256:"immutable-input"}]};
const queueContext={executionId:child,taskId:child,providerId:"configured",model:"specialist",workdir:"/accepted",backgroundContext:{rootRequestId:"original-root-request",requestId:request,hostIds:[host]}};
const receipt={hostId:host,requestId:request,name:"Slides",run:{id:child,state:"pending",success:false},checkpointRevision:0};
function open(file=":memory:") {const db=new DatabaseSync(file);db.exec(migration);db.exec(read(`${base}budget.sql`));db.prepare("INSERT OR IGNORE INTO automation_meta(key,value) VALUES('background_worker_id.v1',?)").run(host);if(!db.prepare("SELECT 1 FROM automation_background_tasks WHERE execution_id=?").get(root)){db.prepare(insertTask).run("original-root-request",root,"{}",1);db.prepare(insertQueue).run(root,1,100,"{}");db.prepare(ledger).run(root,128,256);}return db;}
function accept(db,requests=10,tools=20) {db.exec("BEGIN IMMEDIATE");try{assert.equal(db.prepare(grant).run(root,"original-call",request,host,requests,tools).changes,1,"remaining allocation");db.prepare(insertChild).run(root,"original-call",request,host,JSON.stringify(originalInput),2);db.prepare(insertTask).run(request,child,JSON.stringify(originalInput),2);db.prepare(insertQueue).run(child,2,100,JSON.stringify(queueContext));db.prepare(insertBinding).run(child,"frozen-child-binding");db.prepare(ledger).run(child,requests,tools);db.prepare(observe).run(root,"original-call",JSON.stringify(receipt),child,0,"pending",0,0,0,30);db.exec("COMMIT");}catch(error){db.exec("ROLLBACK");throw error;}}

test("grant, independent native queue, exact binding and original accepted child receipt survive disk reopen together",()=>{
 const dir=mkdtempSync(path.join(tmpdir(),"xgent-model-child-")),file=path.join(dir,"tasks.sqlite");let db=open(file);
 try {accept(db);db.close();db=open(file);
  const owned=db.prepare("SELECT * FROM automation_background_children").get();assert.equal(owned.peer_id,host);assert.equal(owned.issuer_host_id,host);assert.deepEqual(JSON.parse(owned.receipt_json),receipt);
  const queued=JSON.parse(db.prepare("SELECT request_json FROM automation_cron_runs WHERE execution_id=?").get(child).request_json);assert.deepEqual(queued,queueContext);assert.notEqual(queued.executionId,root);
  assert.equal(db.prepare("SELECT binding FROM automation_background_configuration_bindings WHERE execution_id=?").get(child).binding,"frozen-child-binding");
  assert.equal(db.prepare("SELECT max_model_requests FROM automation_background_budgets WHERE execution_id=?").get(child).max_model_requests,10);
  assert.deepEqual(JSON.parse(db.prepare("SELECT input_json FROM automation_background_tasks WHERE execution_id=?").get(child).input_json).files,originalInput.files);
  assert.equal(Object.values(db.prepare(localGuard).get(request))[0],1);
  assert.throws(()=>accept(db),/UNIQUE/);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_budget_grants").get().n,1);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test("failure in configuration capture or acceptance receipt rolls back all queue and budget authority",()=>{
 for(const table of ["automation_background_configuration_bindings","automation_background_budgets","automation_background_children"]) {
  const db=open();try {const operation=table==="automation_background_children"?"UPDATE":"INSERT";db.exec(`CREATE TRIGGER storage_failure BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'storage failure'); END`);assert.throws(()=>accept(db),/storage failure/);
   assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_tasks").get().n,1);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_budget_grants").get().n,0);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_children").get().n,0);
  }finally{db.close();}
 }
});

test("parent plus native child can consume only the originally partitioned lifetime limits",()=>{
 const db=open();try {accept(db);const admit=sql(budget,"UPDATE automation_background_budgets SET model_requests"), spend=id=>{let n=0;while(db.prepare(admit).run(id).changes)n++;return n;};assert.equal(spend(root),118);assert.equal(spend(child),10);assert.equal(spend(root),0);
  db.exec("UPDATE automation_background_children SET cancel_requested=1,cancel_acknowledged=1,observed_state='done',terminal_confirmed=1");assert.equal(spend(root),0);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_budget_grants").get().n,1);
 }finally{db.close();}
});

test("original local ownership cannot be substituted by copied installation or another request",()=>{
 const db=open();try {accept(db);assert.equal(Object.values(db.prepare(localGuard).get("other"))[0],0);db.exec("UPDATE automation_meta SET value='copied-device' WHERE key='background_worker_id.v1'");assert.equal(Object.values(db.prepare(localGuard).get(request))[0],0);
 }finally{db.close();}
});

test("native model child intent is tied to original scoped call and captured lease",()=>{
 const db=open();try {const intent=JSON.stringify({action:"submit",execution:"model"});db.prepare(sql(journal,"INSERT INTO automation_background_operations")).run(root,"original-call","BackgroundTask",intent,1,1);db.prepare(sql(journal,"INSERT INTO automation_background_operation_leases")).run(root,"original-call",1,2,"token");const query=db.prepare(sql(models,"SELECT o.arguments_json FROM automation_background_operations"));assert.equal(query.get(root,"original-call",1,2,"token").arguments_json,intent);
  for(const values of [[root,"other",1,2,"token"],[root,"original-call",1,3,"token"],[root,"original-call",1,2,"stale"]])assert.equal(query.get(...values),undefined);
  db.prepare("UPDATE automation_background_operations SET arguments_json=?").run(JSON.stringify({action:"submit",execution:"device"}));assert.equal(query.get(root,"original-call",1,2,"token"),undefined);
 }finally{db.close();}
});

test("native acceptance uses a single transaction and original child supervision for every read, stop and response",()=>{
 assert.match(models,/verify_background_configuration[\s\S]*accepted_background_context[\s\S]*allocate_background_child_budget[\s\S]*accept_background_on_connection[\s\S]*record_background_child_observation_on_connection[\s\S]*tx.commit/);
 assert.match(models,/delegated_snapshot\(&request,[\s\S]*false\)/);assert.match(models,/source_context,goal_binding:None/);assert.match(models,/context.request_id=request.clone\(\); context.goal_binding=None/);
 const supervisor=read("services/child_tasks.rs");assert.match(supervisor,/is_local_background_model_child/);assert.match(supervisor,/invoke_child[\s\S]*background_resume_receipt/);assert.match(supervisor,/invoke_child\(Arc::clone\(&store\),&registry,&probe.peer_id,"automation_background_get"/);assert.match(supervisor,/invoke_child\(Arc::clone\(&store\),&registry,&probe.peer_id,"automation_background_cancel"/);
 const command=read("commands/automation/children.rs");assert.match(command,/automation_background_model_submit[\s\S]*window.label\(\)!="agent-worker"[\s\S]*submit_background_model_child/);
 assert.match(command,/stage_background_child_resume[\s\S]*if let Some\(saved\)[\s\S]*resume_background_task[\s\S]*automation_background_resume_receipt/);
});
