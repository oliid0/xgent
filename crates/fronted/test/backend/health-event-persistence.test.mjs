import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const root = new URL("../../src-tauri/src/services/automation/", import.meta.url);
const read = name => readFileSync(new URL(name, root), "utf8");
const sql = (source, prefix) => {
  const entry=[...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(x=>x[1].trimStart().startsWith(prefix));
  assert.ok(entry,prefix);return entry[1];
};
const source=read("store/proactive.rs"), intake=read("store/health_events.rs");
const select=sql(source,"SELECT -h.sequence"), view=sql(source,"SELECT d.rule_id, d.event_sequence");
const insert=sql(intake,"INSERT INTO automation_health_events"), seen=sql(intake,"SELECT metric,occurred_at");
const receipt=sql(source,"INSERT INTO automation_proactive_deliveries"), cursor=sql(source,"UPDATE automation_proactive_rules SET cursor = ?2");
const activation=sql(source,"INSERT INTO automation_health_rule_activations"), revoke=sql(source,"UPDATE automation_cron_runs SET state = 'expired'");
const queueSource=read("store.rs");const queue=sql(queueSource.slice(queueSource.indexOf("fn queue_prompt_in_transaction(")),"INSERT INTO automation_cron_runs");
function open(file=":memory:") {
  const db=new DatabaseSync(file);db.exec(sql(read("db.rs"),"CREATE TABLE IF NOT EXISTS automation_meta"));db.exec(read("proactive.sql"));return db;
}
function rule(db) {db.prepare("INSERT INTO automation_proactive_rules (rule_id,config_json,binding_json,cursor,created_at) VALUES ('rule','{}','{}',0,100)").run();db.prepare(activation).run("rule",100);}

test("health metadata and status events share receipts without sequence or identity collisions",()=>{
  const db=open();try {
    rule(db);db.prepare(insert).run("health-change","heart_rate",200);
    db.prepare("INSERT INTO automation_cron_runs (execution_id,task_id,state,success,started_at,finished_at,output) VALUES ('status-change','source','done',1,100,200,'actual')").run();
    db.prepare(receipt).run("rule",-1,"suppressed",null,"cooldown",300);
    db.prepare(receipt).run("status-rule",1,"suppressed",null,"cooldown",300);
    const rows=db.prepare(view).all();
    assert.deepEqual(rows.map(r=>[r.source_execution_id,r.event_kind,r.source_task_id]).sort(),[
      ["health-change","health_updated","health:heart_rate"],["status-change","run_succeeded","source"],
    ]);
    assert.deepEqual(Object.values(db.prepare(seen).get("health-change")),["heart_rate",200]);
    assert.throws(()=>db.prepare(insert).run("health-change","weight",201),/UNIQUE/);
    db.exec(read("proactive.sql"));assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_health_events").get().n,1);
  } finally {db.close();}
});

test("activation and re-enable gates exclude delayed pre-authorization buffers and preserve exact metric filters",()=>{
  const db=open();try {
    rule(db);db.prepare(insert).run("old-buffer","heart_rate",90);db.prepare(insert).run("new-heart","heart_rate",110);db.prepare(insert).run("new-weight","weight",120);
    assert.deepEqual(db.prepare(select).all("rule",0,"heart_rate").map(r=>r.event_id),["new-heart"]);
    db.prepare(activation).run("rule",130);db.prepare(insert).run("delayed-before-enable","heart_rate",125);db.prepare(insert).run("fresh-after-enable","heart_rate",140);
    assert.deepEqual(db.prepare(select).all("rule",0,"heart_rate").map(r=>r.event_id),["fresh-after-enable"]);
    db.prepare("DELETE FROM automation_health_rule_activations WHERE rule_id='rule'").run();
    assert.deepEqual(db.prepare(select).all("rule",0,"heart_rate"),[]);
  }finally{db.close();}
});

test("health queue, negative event receipt and positive cursor commit atomically, survive reopen and cannot recurse",()=>{
  const directory=mkdtempSync(path.join(tmpdir(),"xgent-health-events-"));let db=open(path.join(directory,"events.sqlite"));
  try {
    rule(db);db.prepare(insert).run("actual-change","heart_rate",200);
    for(const commit of [false,true]) {
      db.exec("BEGIN IMMEDIATE");db.prepare(queue).run("health-follow-up","target",300,600000,"{}");
      db.prepare(receipt).run("rule",-1,"queued","health-follow-up","accepted",300);db.prepare(cursor).run("rule",1);
      db.exec(commit?"COMMIT":"ROLLBACK");assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_cron_runs WHERE state='pending'").get().n,commit?1:0);
    }
    db.close();db=open(path.join(directory,"events.sqlite"));
    assert.deepEqual(db.prepare(select).all("rule",1,"heart_rate"),[]);
    assert.equal(db.prepare(view).get().run_state,"pending");
    db.prepare("UPDATE automation_cron_runs SET state='done',finished_at=400,success=1 WHERE execution_id='health-follow-up'").run();
    assert.equal(db.prepare("SELECT COUNT(*) n FROM automation_proactive_events").get().n,0);
    assert.equal(db.prepare(view).get().run_success,1);
  }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});

test("disabling a health rule withdraws pending work while leaving a claimed execution untouched",()=>{
  const db=open();try {
    rule(db);for(let i=1;i<=2;i++) {
      db.prepare(insert).run(`change-${i}`,"heart_rate",200+i);db.prepare(queue).run(`follow-${i}`,"target",300,600000,"{}");
      db.prepare(receipt).run("rule",-i,"queued",`follow-${i}`,"accepted",300);
    }
    db.prepare("UPDATE automation_cron_runs SET state='leased' WHERE execution_id='follow-2'").run();db.prepare(revoke).run("rule",400);
    assert.equal(db.prepare("SELECT state FROM automation_cron_runs WHERE execution_id='follow-1'").get().state,"expired");
    assert.equal(db.prepare("SELECT state FROM automation_cron_runs WHERE execution_id='follow-2'").get().state,"leased");
  }finally{db.close();}
});

test("native-only intake and launch-time observer wiring use real receipts and retain SDK data before completion",()=>{
  const pluginRoot=new URL("../../../mobile-assistant/",import.meta.url);
  const observer=readFileSync(new URL("ios/Sources/HealthEventObserver.swift",pluginRoot),"utf8");
  const bridge=readFileSync(new URL("src/lib.rs",pluginRoot),"utf8");
  const service=readFileSync(new URL("../health_events.rs",root),"utf8");
  assert.ok(observer.includes("HKObserverQuery(sampleType:"));assert.ok(observer.includes("enableBackgroundDelivery(for:"));
  assert.ok(observer.includes(".completeFileProtectionUntilFirstUserAuthentication"));
  assert.ok(observer.indexOf("try self.save(next); self.observationError = nil; completion()")>=0);
  assert.ok(observer.includes("args.ids.contains($0.id)"));assert.ok(observer.includes("!args.authorize"));
  assert.ok(observer.indexOf("try self.save(prepared)")<observer.indexOf("self.store.enableBackgroundDelivery(for:"));
  assert.ok(observer.includes("next.startMetrics = (next.startMetrics ?? []).filter"));
  assert.ok(observer.includes("next.stopMetrics = pending.filter"));
  assert.ok(!bridge.includes("commands::configure_health_events"));assert.ok(!bridge.includes("commands::pending_health_events"));
  assert.ok(service.indexOf("store.ingest_health_events(&events)?")<service.indexOf("acknowledge_health_events("));
});
