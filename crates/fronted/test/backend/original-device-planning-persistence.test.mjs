import assert from "node:assert/strict";
import { mkdtempSync,readFileSync,unlinkSync,rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const read=name=>readFileSync(new URL(`../../src-tauri/src/${name}`,import.meta.url),"utf8");
const source=read("services/automation/store/device_planning.rs");
const sql=(text,prefix)=>{const match=[...text.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(match=>match[1].trimStart().startsWith(prefix));assert.ok(match,prefix);return match[1];};
const schema=sql(read("services/automation/db.rs"),"CREATE TABLE IF NOT EXISTS automation_meta");
const exec=(db,prefix,args,method="run")=>db.prepare(sql(source,prefix))[method](...args);
const canonical={role:"toolResult",toolCallId:"call",toolName:"OriginalDeviceTask",isError:false,timestamp:10,content:[{type:"text",text:'{"queued":true,"effectCompleted":false}'}],details:{kind:"original_device_planning",knownNoEffect:false}};
function seed(db){
  db.exec(schema);
  db.prepare("INSERT INTO automation_background_operations(execution_id,call_id,tool_name,arguments_json,context_revision,state,started_at) VALUES('execution','call','OriginalDeviceTask','{}',1,'started',1)").run();
}
function admit(db){
  db.exec("BEGIN IMMEDIATE");
  try{
    exec(db,"INSERT INTO automation_background_device_planning_calls(",["execution","call","calendar","native-scope","request_read",'{"action":"list_calendars","request":{"kind":"event"}}',5]);
    assert.equal(exec(db,"UPDATE automation_background_operations SET state='returned'",["execution","call",JSON.stringify(canonical),10,0]).changes,1);
    db.exec("COMMIT");
  }catch(error){db.exec("ROLLBACK");throw error;}
}
test("production queue and canonical receipt commit together, reopen unchanged and cannot admit a second original call",()=>{
  const directory=mkdtempSync(path.join(tmpdir(),"xgent-device-planning-")),file=path.join(directory,"planning.sqlite");let db=new DatabaseSync(file);
  try{
    seed(db);admit(db);db.close();db=new DatabaseSync(file);
    const stored=db.prepare("SELECT state,result_json FROM automation_background_operations").get();
    assert.equal(stored.state,"returned");assert.deepEqual(JSON.parse(stored.result_json),canonical);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM automation_background_device_planning_calls").get().count,1);
    assert.throws(()=>admit(db),/UNIQUE/);assert.deepEqual(JSON.parse(db.prepare("SELECT result_json FROM automation_background_operations").get().result_json),canonical);
    assert.equal(exec(db,"SELECT call_id,kind,request_json FROM automation_background_device_planning_calls",["execution","calendar","native-scope"],"all").length,1);
    assert.equal(exec(db,"SELECT call_id,kind,request_json FROM automation_background_device_planning_calls",["execution","calendar","revoked-scope"],"all").length,0);
  }finally{db.close();unlinkSync(file);rmdirSync(directory);}
});
test("failed receipt persistence rolls back planning admission; original phone caches one immutable response before delivery",()=>{
  const db=new DatabaseSync(":memory:");try{
    seed(db);db.exec("CREATE TRIGGER refuse_receipt BEFORE UPDATE OF result_json ON automation_background_operations BEGIN SELECT RAISE(ABORT,'disk failure'); END");
    assert.throws(()=>admit(db),/disk failure/);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM automation_background_device_planning_calls").get().count,0);
    const actual=JSON.stringify({data:{calendars:[{id:"actual-phone-calendar",sourceId:"actual-account"}]}});
    exec(db,"INSERT INTO automation_mobile_device_planning_receipts(",["request","calendar","read-call","native-scope",actual]);
    assert.throws(()=>exec(db,"INSERT INTO automation_mobile_device_planning_receipts(",["request","calendar","read-call","changed-scope","{}"]),/UNIQUE/);
    assert.deepEqual({...exec(db,"SELECT scope_key,result_json FROM automation_mobile_device_planning_receipts",["request","calendar","read-call"],"get")},{scope_key:"native-scope",result_json:actual});
  }finally{db.close();}
});
test("SDK execution/callbacks and wake wiring remain native, scoped, authenticated and separate from effect proof",()=>{
  const phone=read("commands/automation/mobile_device_planning.rs"),channel=read("services/local_access.rs"),waiting=read("services/automation/store/waiting.rs");
  assert.match(phone,/read_for_controller/);assert.match(phone,/prepare_on_client/);assert.match(phone,/mobile_planning_receipt/);
  assert.ok(phone.indexOf("Some(result)")<phone.lastIndexOf('"response"'));
  assert.match(phone,/scope changed before native observation delivery/);
  assert.doesNotMatch(phone,/api_key|load_provider|selected_model|response:Value|result:Value/);
  assert.match(source,/authorize_background_device_channel\(request,proof\)/);
  assert.match(source,/verify_background_binding/);assert.match(source,/result_json IS NULL/);
  assert.match(source,/resume_wait_on_connection/);assert.match(waiting,/device_planning_wake/);
  assert.match(channel,/"automation_background_device_planning_exchange"/);
  const effects=read("services/automation/store/device_actions.rs");
  assert.match(effects,/verify_receipt\(&receipt, device\)/);
  assert.doesNotMatch(source,/UPDATE automation_background_outcomes SET state.*verified/);
});

test("native read-proof selector requires actual matching SDK data, a successful original intent and the current original branch scope",()=>{
  const observations=read("services/automation/store/device_observations.rs"),db=new DatabaseSync(":memory:");
  const contract={metric:"heart_rate",startMs:1000,endMs:2000,limit:200};
  const result=JSON.stringify({data:{health:{...contract,unit:"bpm",source:"healthkit",samples:[],truncated:false,accessLimited:true}}});
  const select=()=>db.prepare(sql(observations,"SELECT c.call_id,c.scope_key,c.result_json,s.scope_json")).all("execution","health",contract.metric,contract.startMs,contract.endMs,contract.limit);
  try {
    seed(db);
    db.prepare("UPDATE automation_background_operations SET state='returned',is_error=0").run();
    exec(db,"INSERT INTO automation_background_device_planning_scopes(",["execution","health","original-key","{}"]);
    exec(db,"INSERT INTO automation_background_device_planning_calls(",["execution","call","health","original-key","request_read",JSON.stringify({action:"read_health_samples",request:contract}),5]);
    assert.equal(select().length,0,"queue acceptance is not a native read result");
    db.prepare("UPDATE automation_background_device_planning_calls SET result_json=?").run(result);
    assert.equal(select().length,1);assert.deepEqual(JSON.parse(select()[0].result_json).data.health.samples,[]);
    for(const request of [{...contract,startMs:1500},{...contract,endMs:3000},{...contract,metric:"weight"},{...contract,limit:100}]) {
      db.prepare("UPDATE automation_background_device_planning_calls SET request_json=?").run(JSON.stringify({action:"read_health_samples",request}));
      assert.equal(select().length,0,"a substitute/partial query cannot fulfill the accepted read requirement");
    }
    db.prepare("UPDATE automation_background_device_planning_calls SET request_json=?").run(JSON.stringify({action:"read_health_samples",request:contract}));
    db.prepare("UPDATE automation_background_device_planning_scopes SET scope_key='revoked-key'").run();assert.equal(select().length,0);
    db.prepare("UPDATE automation_background_device_planning_scopes SET scope_key='original-key'").run();
    db.prepare("UPDATE automation_background_operations SET is_error=1").run();assert.equal(select().length,0);
    db.prepare("UPDATE automation_background_operations SET is_error=0").run();
    db.prepare("UPDATE automation_background_device_planning_calls SET result_json=?").run(JSON.stringify({error:"Original SDK permission denied"}));assert.equal(select().length,0);
    db.prepare("UPDATE automation_background_device_planning_calls SET result_json=?").run(JSON.stringify({data:{health:{...contract}},error:"Not a successful observation"}));assert.equal(select().length,0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM automation_background_device_actions").get().count,0,"the proof cannot manufacture OS writes");
  }finally{db.close();}
});
