import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const store=read("../../src-tauri/src/services/automation/store/device_reads.rs");
const command=read("../../src-tauri/src/commands/automation/mobile_branch_reads.rs");
const health=read("../../src-tauri/src/commands/automation/mobile_branch_reads/health.rs");
function sql(source,start) {
  const match=[...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(item=>item[1].trimStart().startsWith(start));
  assert.ok(match,`Missing production SQL ${start}`);return match[1];
}
const schema=sql(read("../../src-tauri/src/services/automation/db.rs"),"CREATE TABLE IF NOT EXISTS automation_meta");
const insert=sql(store,"INSERT INTO automation_mobile_branch_reads");
const run=(db,values)=>db.prepare(insert).run(Object.fromEntries(values.map((value,i)=>[String(i+1),value])));

test("actual read-grant SQL retains a health range, rollback and revocation without granting effects or another task",()=>{
  const db=new DatabaseSync(":memory:");
  try {
    db.exec(schema);
    const scopes=JSON.stringify([{kind:"health",id:"heart_rate",sourceId:"healthkit",title:"heart_rate",source:"HealthKit",writable:false,startMs:1791590400000,endMs:1791676800000}]);
    run(db,["original-task","fitness","captured-context",1,"approved",scopes,100]);
    db.exec("BEGIN IMMEDIATE");run(db,["original-task","fitness","captured-context",2,"revoked",scopes,200]);db.exec("ROLLBACK");
    assert.equal(db.prepare("SELECT decision FROM automation_mobile_branch_reads").get().decision,"approved");
    run(db,["original-task","fitness","captured-context",2,"revoked",scopes,300]);
    db.exec(schema);
    const saved=db.prepare("SELECT * FROM automation_mobile_branch_reads").get();
    assert.equal(saved.decision,"revoked");assert.equal(saved.revision,2);assert.equal(saved.context_hash,"captured-context");assert.equal(saved.selections_json,scopes);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_mobile_branch_reads WHERE request_id='other-task'").get().n,0);
    for(const table of ["automation_mobile_branch_grants","automation_mobile_connector_writes","automation_mobile_branch_plans"])assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0);
  } finally {db.close();}
});

// Node verifies real SQL and source boundaries here, not native SDK execution.
test("health scope enforces original task identity, fixed metric/range and final awaited controller revalidation",()=>{
  assert.match(store,/kind != "health" && decision == "pending" && !ask/);
  assert.match(store,/scope\.kind == "health"/);assert.match(store,/scope\.writable/);assert.match(store,/scope\.start_ms\.is_some\(\) \|\| scope\.end_ms\.is_some\(\)/);
  assert.match(health,/start>=a && end<=b/);assert.match(health,/scope\.id==id && scope\.source_id==backend/);
  assert.match(health,/checked_permission\(app,id,false\)/);assert.match(health,/sample\.value\.is_finite\(\)/);
  assert.match(health,/result\.access_limited/);assert.match(health,/same_revision\(&before,&after\)/);
  const data=command.slice(command.indexOf("pub async fn automation_mobile_branch_read_data"));
  assert.ok(data.lastIndexOf("ready(&app")<data.indexOf("health::revalidate"));
  assert.ok(data.indexOf("health::revalidate")<data.lastIndexOf("same_revision"));
  const approve=command.slice(command.indexOf("pub async fn automation_mobile_branch_read_decide"),command.indexOf("async fn ready"));
  assert.ok(approve.indexOf("health::destination")<approve.indexOf("health::approve"));
  assert.ok(approve.indexOf("same_revision")<approve.indexOf("decide_mobile_branch_read_authorization"));
});

test("SDK metric rechecks are private and never request a new grant; ordinary reads retain their existing SDK path",()=>{
  const swift=read("../../../mobile-assistant/ios/Sources/MobileAssistantPlugin.swift");
  const kotlin=read("../../../mobile-assistant/android/src/main/java/com/ohi/xgent/mobileassistant/MobileAssistantPlugin.kt");
  const iosCheck=swift.slice(swift.indexOf("@objc func checkHealthMetricPermission"),swift.indexOf("@objc func readHealthSamples"));
  assert.match(iosCheck,/getRequestStatusForAuthorization/);assert.match(iosCheck,/status == \.unnecessary \? "requested" : "prompt"/);assert.doesNotMatch(iosCheck,/healthStore\.requestAuthorization/);
  const androidCheck=kotlin.slice(kotlin.indexOf("fun checkHealthMetricPermission"),kotlin.indexOf("fun listCalendarEvents"));
  assert.match(androidCheck,/getGrantedPermissions/);assert.doesNotMatch(androidCheck,/startActivityForResult|createRequestPermissionResultContract/);
  const samples=read("../../../mobile-assistant/android/src/main/java/com/ohi/xgent/mobileassistant/HealthSamples.kt");
  assert.ok(samples.lastIndexOf("getGrantedPermissions")>samples.indexOf("val result = when"));
  assert.ok(samples.lastIndexOf("getGrantedPermissions")<samples.lastIndexOf("return result"));
  for(const path of ["../../../mobile-assistant/build.rs","../../../mobile-assistant/src/commands.rs","../../../mobile-assistant/permissions/default.toml"])assert.doesNotMatch(read(path),/check_health_metric_permission|checkHealthMetricPermission/);
  assert.match(read("../../src/lib/tools/mobilePersonalAssistantTools.ts"),/const permission = await requestMobileHealthMetricPermission\(request.metric, signal\)/);
});
