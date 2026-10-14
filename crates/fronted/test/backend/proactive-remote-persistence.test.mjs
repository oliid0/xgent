import assert from "node:assert/strict";
import {readFileSync,mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import test from "node:test";
const read=name=>readFileSync(new URL(`../../src-tauri/src/${name}`,import.meta.url),"utf8");
const sql=(source,prefix)=>{
  const literal=[...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(entry=>entry[1].trimStart().startsWith(prefix));
  assert.ok(literal,prefix);return literal[1];
};
const remote=read("services/automation/store/proactive_remote.rs"),submission=read("services/automation/store/submission.rs"),proactive=read("services/automation/store/proactive.rs");
const PHONE="aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",PC="bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const run=(db,source,prefix,args=[],mode="run")=>db.prepare(sql(source,prefix))[mode](...args);
function open(file=":memory:") {
  const db=new DatabaseSync(file);db.exec(sql(read("services/automation/db.rs"),"CREATE TABLE IF NOT EXISTS automation_meta"));
  db.exec(read("services/automation/proactive.sql"));
  db.prepare("INSERT OR IGNORE INTO automation_meta (key,value) VALUES ('background_worker_id.v1',?)").run(PHONE);
  return db;
}
function stage(db,request="request-1",event=-1,owner=PHONE,rule="rule",sourceContext=undefined) {
  run(db,submission,"INSERT INTO automation_submission_outbox",[request,owner,PC,JSON.stringify({requestId:request,name:"Actual event task",prompt:"Inspect actual data",providerId:"two",model:"same-model",workdir:"/work",files:[],sourceContext}),JSON.stringify({kind:"proactive-event",ruleId:rule,eventSequence:event}),100]);
  run(db,remote,"INSERT INTO automation_proactive_remote_deliveries",[rule,event,request,PC,owner,"target","original-template",100,60100]);
}
const packet=(state="pending",success=false,execution="actual-run",request="request-1")=>({requestId:request,hostId:PC,run:{id:execution,taskId:execution,state,success}});
const busy=db=>Object.values(run(db,remote,"SELECT EXISTS(SELECT 1 FROM automation_cron_runs",["target",PHONE],"get"))[0];
const view=db=>run(db,remote,"SELECT d.request_id,d.source_host_id,s.last_error",["rule",-1],"get");
function receive(db,entry,body,source=PC) {
  run(db,read("services/automation/store/inbox.rs"),"INSERT INTO automation_result_inbox",[entry,source,"request-1",entry,JSON.stringify(body),300]);
}

test("event intent, unchanged submission packet, tracking receipt and cursor commit together and survive reopen",()=>{
  const dir=mkdtempSync(path.join(tmpdir(),"xgent-event-delivery-")),file=path.join(dir,"store.db");let db=open(file);
  try {
    db.prepare("INSERT INTO automation_proactive_rules(rule_id,config_json,binding_json,cursor,created_at) VALUES('rule','{}','original-template',0,100)").run();
    for(const commit of [false,true]) {
      db.exec("BEGIN IMMEDIATE");stage(db);
      run(db,proactive,"INSERT INTO automation_proactive_deliveries",["rule",-1,"queued",null,"delivery_pending",200]);
      run(db,proactive,"UPDATE automation_proactive_rules SET cursor = ?2",["rule",1]);db.exec(commit?"COMMIT":"ROLLBACK");
      assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_submission_outbox").get().n,commit?1:0);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_proactive_remote_deliveries").get().n,commit?1:0);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_cron_runs").get().n,0,"remote intent never creates local model work");
    }
    db.close();db=open(file);const original=db.prepare("SELECT input_json FROM automation_submission_outbox").get().input_json;
    assert.equal(JSON.parse(original).providerId,"two");assert.equal(busy(db),1);
    db.exec("BEGIN IMMEDIATE");assert.throws(()=>stage(db,"new-request",-1),/UNIQUE/);db.exec("ROLLBACK");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_submission_outbox").get().n,1);
    assert.equal(db.prepare("SELECT input_json FROM automation_submission_outbox").get().input_json,original);
  } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});

test("original event source context survives offline retry and database reopen unchanged",()=>{
  const dir=mkdtempSync(path.join(tmpdir(),"xgent-event-origin-")),file=path.join(dir,"store.db");let db=open(file);
  const sourceContext={version:1,requestScope:"proactive-event/rule/actual-event",systemPrompt:JSON.stringify({
    version:1,records:[{slug:"fitness-time",scope:"global",type:"user",excerpt:"晚上九点健身。",confidence:"high",unreviewed:false,updatedAt:100,source:{conversationId:"original-chat"}}]}),
    messages:[{role:"user",content:"Configured actual fitness task",timestamp:200}]};
  try {
    stage(db,"request-1",-1,PHONE,"rule",sourceContext);
    const raw=db.prepare("SELECT input_json FROM automation_submission_outbox").get().input_json;
    db.prepare("UPDATE automation_submission_outbox SET probes=1,last_error='Original PC offline',retry_at=400").run();
    db.close();db=open(file);
    const due=run(db,submission,"SELECT source_host_id, input_json, CASE WHEN cancel_requested = 1 THEN cancel_json ELSE result_json END, cancel_requested FROM automation_submission_outbox WHERE ((",[PHONE,500,null,0],"all");
    assert.equal(due.length,1);assert.equal(due[0].input_json,raw);
    assert.deepEqual(JSON.parse(due[0].input_json).sourceContext,sourceContext);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_cron_runs").get().n,0);
  } finally {db.close();rmSync(dir,{recursive:true,force:true});}
});

test("busy admission follows actual original receipt, owned updates and terminal cancellation rather than dispatch",()=>{
  const db=open();try {
    stage(db);assert.equal(busy(db),1);
    db.prepare("UPDATE automation_submission_outbox SET result_json=?").run(JSON.stringify(packet()));assert.equal(busy(db),1);
    receive(db,"foreign-execution",packet("done",true,"different-run"));assert.equal(busy(db),1);
    receive(db,"foreign-source",packet("done",true),"other-pc");assert.equal(busy(db),1);
    receive(db,"actual-wait",packet("waiting"));assert.equal(busy(db),1);
    receive(db,"actual-end",packet("done",true));assert.equal(busy(db),0);
    db.prepare("DELETE FROM automation_result_inbox").run();db.prepare("UPDATE automation_submission_outbox SET result_json=NULL,cancel_requested=1").run();assert.equal(busy(db),1);
    db.prepare("UPDATE automation_submission_outbox SET cancel_json=?").run(JSON.stringify(packet("expired")));assert.equal(busy(db),0);
  } finally {db.close();}
});

test("public progress stays pending before ACK and uses only exact owned run snapshots and truthful errors",()=>{
  const db=open();try {
    stage(db);db.prepare("UPDATE automation_submission_outbox SET last_error='PC offline'").run();
    assert.equal(view(db).last_error,"PC offline");assert.equal(Object.values(view(db)).at(-1),null);
    db.prepare("UPDATE automation_submission_outbox SET result_json=?").run(JSON.stringify(packet()));
    receive(db,"wrong-run",packet("done",true,"unrelated-run"));receive(db,"wrong-host",packet("done",true),"unrelated-pc");
    assert.equal(JSON.parse(Object.values(view(db)).at(-1)).run.state,"pending");
    receive(db,"verified-result",packet("done",true));assert.equal(JSON.parse(Object.values(view(db)).at(-1)).run.success,true);
    db.prepare("UPDATE automation_meta SET value='copied-phone' WHERE key='background_worker_id.v1'").run();assert.equal(view(db),undefined);
  } finally {db.close();}
});

test("rule withdrawal retains original stop intention, uncertain request and confirmed remote work",()=>{
  const db=open();try {
    for(const [request,event,owner] of [["request-1",-1,PHONE],["accepted",-2,PHONE],["copied",-3,"another-phone"]]) {
      stage(db,request,event,owner);run(db,proactive,"INSERT INTO automation_proactive_deliveries",["rule",event,"queued",null,"delivery_pending",200]);
    }
    db.prepare("UPDATE automation_submission_outbox SET result_json=? WHERE request_id='accepted'").run(JSON.stringify(packet("leased",false,"run-accepted","accepted")));
    run(db,remote,"UPDATE automation_submission_outbox SET cancel_requested=1",["rule"]);
    run(db,remote,"UPDATE automation_proactive_deliveries SET state='revoked'",["rule",300]);
    assert.deepEqual(db.prepare("SELECT request_id,cancel_requested FROM automation_submission_outbox ORDER BY request_id").all().map(Object.values),[["accepted",0],["copied",0],["request-1",1]]);
    assert.deepEqual(db.prepare("SELECT event_sequence,state FROM automation_proactive_deliveries ORDER BY event_sequence").all().map(Object.values),[[-3,"queued"],[-2,"queued"],[-1,"revoked"]]);
    assert.equal(db.prepare("SELECT cancel_json FROM automation_submission_outbox WHERE request_id='request-1'").get().cancel_json,null,"stop intention is not confirmed cancellation");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_submission_outbox").get().n,3,"no replacement request/host is created");
  }finally{db.close();}
});

test("one actual host acceptance can count only once, without consuming attempts for offline delivery or another owner",()=>{
  const db=open();try {
    stage(db);assert.ok(run(db,remote,"SELECT target_task_id,task_binding",["request-1",PC],"get"));
    assert.equal(run(db,remote,"SELECT target_task_id,task_binding",["request-1","other-pc"],"get"),undefined);
    db.exec("BEGIN IMMEDIATE");run(db,remote,"UPDATE automation_proactive_remote_deliveries SET counted=1",["request-1"]);db.exec("ROLLBACK");
    assert.ok(run(db,remote,"SELECT target_task_id,task_binding",["request-1",PC],"get"));
    run(db,remote,"UPDATE automation_proactive_remote_deliveries SET counted=1",["request-1"]);
    assert.equal(run(db,remote,"SELECT target_task_id,task_binding",["request-1",PC],"get"),undefined);
    assert.match(remote,/if pending\.cancel_requested \{return Ok\(false\);\}/);
    assert.match(remote,/decrement_remaining\(conn,&task_id\)/);assert.match(remote,/Some\(frozen\.as_str\(\)\)/);
    assert.ok(submission.indexOf("record_acceptance(&tx,pending)")>submission.indexOf("UPDATE automation_submission_outbox SET result_json"));
  } finally{db.close();}
});

test("expired unsent events stop locally, while an attempted or accepted original request retains truthful reconciliation",()=>{
  const db=open();try {
    for(const [request,event] of [["request-1",-1],["attempted",-2],["accepted",-3]]) {
      stage(db,request,event);run(db,proactive,"INSERT INTO automation_proactive_deliveries",["rule",event,"queued",null,"delivery_pending",200]);
    }
    db.prepare("UPDATE automation_submission_outbox SET probes=1 WHERE request_id='attempted'").run();
    db.prepare("UPDATE automation_submission_outbox SET result_json=?,probes=1 WHERE request_id='accepted'").run(JSON.stringify(packet("leased",false,"accepted-run","accepted")));
    run(db,remote,"UPDATE automation_proactive_remote_deliveries SET locally_withdrawn=1",[null,60101]);
    run(db,remote,"UPDATE automation_submission_outbox SET cancel_requested=1",["rule"]);
    run(db,remote,"UPDATE automation_proactive_deliveries SET state='revoked',reason='stale'",[60101]);
    assert.deepEqual(db.prepare("SELECT request_id,locally_withdrawn FROM automation_proactive_remote_deliveries ORDER BY request_id").all().map(Object.values),[["accepted",0],["attempted",0],["request-1",1]]);
    const due=run(db,submission,"SELECT source_host_id, input_json, CASE WHEN cancel_requested = 1 THEN cancel_json ELSE result_json END, cancel_requested FROM automation_submission_outbox WHERE ((",[PHONE,100000,null,0],"all");
    assert.deepEqual(due.map(row=>JSON.parse(row.input_json).requestId),["attempted"],"never submit or cancel a provably unsent expired event on a PC");
    const list=run(db,submission,"SELECT sequence, request_id, source_host_id, json_extract",[0,20],"all");
    assert.equal(list.find(row=>row.request_id==="request-1").locally_withdrawn,1);
    assert.equal(list.find(row=>row.request_id==="request-1")["cancel_json IS NOT NULL"],0,"no fake remote cancellation ACK");
    db.prepare("DELETE FROM automation_submission_outbox WHERE request_id IN ('attempted','accepted')").run();
    assert.equal(busy(db),0,"withdrawn unsent history never blocks new valid events");
  }finally{db.close();}
});

test("original policy, task binding, actual peer probe and fixed device-read dependency remain on the execution path",()=>{
  const command=read("commands/automation/proactive.rs"),deliver=read("commands/automation/submission.rs"),intake=read("services/health_events.rs");
  assert.match(command,/registry\.probe\(&remote\.peer_id\)/);assert.match(command,/host\.workdir!=remote\.workdir/);
  assert.match(command,/provider\.id==remote\.provider_id && provider\.models\.contains\(&remote\.model\)/);
  assert.match(remote,/source_context,goal_binding:None/);assert.match(remote,/intelligent_scheduling_enabled:false/);
  assert.match(remote,/id:"event-health"\.into\(\),locality:"initiating-device"/);
  assert.match(remote,/depends_on:vec!\["event-health"\.into\(\)\]/);assert.match(remote,/occurred\.saturating_sub\(600_000\)/);
  assert.match(remote,/An inactive,/);assert.match(remote,/validate_config\(&tx,&config\)/);
  assert.ok(deliver.indexOf("reconcile_proactive_remote_submissions()")<deliver.indexOf("read.background_submission(&id)"));
  assert.match(submission,/claim_background_submissions[^]*?reconcile_proactive_remote_submissions\(\)/);
  assert.ok(intake.indexOf("store.ingest_health_events(&events)?")<intake.indexOf("acknowledge_health_events("));
  assert.match(proactive,/remote_execution\.is_some\(\)[^]*?proactive_remote::stage/);
  assert.match(proactive,/serde\(default, skip_serializing_if = "Option::is_none"\)[^]*?remote_execution/);
});
