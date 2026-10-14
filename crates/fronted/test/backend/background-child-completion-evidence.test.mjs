import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
const read=name=>readFileSync(new URL(`../../src-tauri/src/${name}`,import.meta.url),"utf8").replace(/\r\n/g,"\n");
const source=read("services/automation/store/outcomes.rs");
const sql=(text,prefix)=>{const found=[...text.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(value=>value[1].trimStart().startsWith(prefix));assert.ok(found,prefix);return found[1];};
const schema=sql(read("services/automation/db.rs"),"CREATE TABLE IF NOT EXISTS automation_meta");
const proof=sql(source,"SELECT CASE WHEN o.tool_name='BackgroundTask'");
function fixture(){
  const db=new DatabaseSync(":memory:");db.exec(schema);
  db.prepare("INSERT INTO automation_meta VALUES ('background_worker_id.v1','issuer')").run();
  db.prepare("INSERT INTO automation_background_operations (execution_id,call_id,tool_name,arguments_json,context_revision,state,started_at) VALUES ('parent','submit','BackgroundTask','{\"action\":\"submit\"}',1,'started',1)").run();
  db.prepare("INSERT INTO automation_background_children (execution_id,call_id,child_request_id,peer_id,issuer_host_id,input_json,issued_at,retry_at,receipt_json,observed_json,observed_execution_id,observed_state) VALUES ('parent','submit','child-request','peer','issuer','{}',1,1,'{}','{\"outcomes\":{\"verified\":true}}','child-execution','pending')").run();
  return db;
}
const completed=db=>Object.values(db.prepare(proof).get("parent","submit"))[0];

test("actual native completion predicate refuses queue acceptance, failures, unverified outcomes and unsettled cancellation",()=>{
  const db=fixture();try{
    assert.equal(completed(db),0);
    db.exec("UPDATE automation_background_children SET terminal_confirmed=1,observed_success=1,observed_state='done'");assert.equal(completed(db),1);
    for(const change of ["terminal_confirmed=0","observed_success=0","observed_state='expired'","cancel_requested=1,cancel_acknowledged=0","receipt_json=NULL","issuer_host_id='foreign'","observed_json='{\"outcomes\":{\"verified\":false}}'"]){
      db.exec("SAVEPOINT invalid_proof");db.exec(`UPDATE automation_background_children SET ${change}`);assert.equal(completed(db),0);db.exec("ROLLBACK TO invalid_proof; RELEASE invalid_proof");
    }
    db.exec("UPDATE automation_background_children SET cancel_requested=1,cancel_acknowledged=1");assert.equal(completed(db),1);
  }finally{db.close();}
});

test("completion is bound to the original parent/call/action and does not turn another operation into delegation",()=>{
  const db=fixture();try{
    db.exec("UPDATE automation_background_children SET terminal_confirmed=1,observed_success=1,observed_state='done'");
    assert.equal(db.prepare(proof).get("foreign-parent","submit"),undefined);assert.equal(db.prepare(proof).get("parent","invented"),undefined);
    db.exec("UPDATE automation_background_operations SET tool_name='Calendar'");assert.equal(completed(db),null);
    db.exec("UPDATE automation_background_operations SET tool_name='BackgroundTask',arguments_json='{\"action\":\"get\"}'");assert.equal(completed(db),null);
    db.exec("UPDATE automation_background_operations SET arguments_json='{\"action\":\"resume\"}'");assert.equal(completed(db),0);
  }finally{db.close();}
});

test("a response ACK verifies only the same original child execution after it genuinely completes",()=>{
  const db=fixture();try{
    db.exec("INSERT INTO automation_background_operations (execution_id,call_id,tool_name,arguments_json,context_revision,state,started_at) VALUES ('parent','response','BackgroundTask','{\"action\":\"resume\"}',1,'returned',2)");
    db.exec("INSERT INTO automation_background_child_resumes (execution_id,call_id,peer_id,issuer_host_id,child_execution_id,input_json,issued_at,retry_at,receipt_json) VALUES ('parent','response','peer','issuer','child-execution','{}',2,2,'{}')");
    const current=()=>Object.values(db.prepare(proof).get("parent","response"))[0];assert.equal(current(),0);
    db.exec("UPDATE automation_background_children SET terminal_confirmed=1,observed_success=1,observed_state='done'");assert.equal(current(),1);
    for(const field of ["peer_id='other'","issuer_host_id='foreign'","child_execution_id='different'"]){
      db.exec("SAVEPOINT invalid_response");db.exec(`UPDATE automation_background_child_resumes SET ${field}`);assert.equal(current(),0);db.exec("ROLLBACK TO invalid_response; RELEASE invalid_response");
    }
  }finally{db.close();}
});

test("verification and saved branch reads recheck completion while preserving original late acceptance and evidence",()=>{
  assert.match(source,/child_operation_completed\(conn,execution_id,id\)\?==Some\(false\)/);
  assert.match(source,/child_operation_completed\(conn,execution_id,call\)\?==Some\(false\)/);
  assert.match(source,/state != "returned" && !child_reconciled/);
  assert.match(source,/confirmed_child_start_receipt\(conn,execution_id,id\)/);
  assert.match(source,/receipt\["childCompleted"\]/);
  const report=source.slice(source.indexOf("pub(super) fn background_outcome_report"),source.indexOf("pub(super) fn require_background_outcomes"));
  assert.ok(report.includes("child_operation_completed"));
  assert.doesNotMatch(report,/UPDATE automation_background_outcomes/);
});
