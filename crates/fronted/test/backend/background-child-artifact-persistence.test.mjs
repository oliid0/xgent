import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// Actual production SQL executed against SQLite. This proves transaction,
// identity selection and durable bytes; it does not execute Rust validation/RPC.
const read=name=>readFileSync(new URL(`../../src-tauri/src/${name}`,import.meta.url),"utf8").replace(/\r\n/g,"\n");
const source=read("services/automation/store/child_artifacts.rs"),journal=read("services/automation/store/journal.rs");
function sql(source,prefix){const found=[...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(item=>item[1].trimStart().replace(/\s+/g," ").startsWith(prefix.replace(/\s+/g," ")));assert.ok(found,`Production SQL missing: ${prefix}`);return found[1];}
const migration=sql(read("services/automation/db.rs"),"CREATE TABLE IF NOT EXISTS automation_meta");
const provenance=read("services/automation/child_artifacts.sql");
const bytes=Buffer.from("Actual immutable report"),hash=createHash("sha256").update(bytes).digest("hex");
const ownIntent=sql(source,"SELECT o.arguments_json,o.result_json");
const ownChild=sql(source,"SELECT peer_id,child_request_id,observed_execution_id,observed_json");
const artifactInsert=sql(source,"INSERT INTO automation_background_artifacts");
const provenanceInsert=sql(source,"INSERT INTO automation_background_child_artifacts");
const complete=sql(journal,"UPDATE automation_background_operations SET state = 'returned'");

function fixture(filename=":memory:"){
  const db=new DatabaseSync(filename);db.exec(migration);db.exec(provenance);
  db.prepare("INSERT INTO automation_meta VALUES ('background_worker_id.v1','original-issuer')").run();
  db.prepare(sql(read("services/automation/store/background.rs"),"INSERT INTO automation_background_tasks")).run("parent-request","parent","{}",1);
  db.prepare("INSERT INTO automation_background_operations (execution_id,call_id,tool_name,arguments_json,context_revision,state,started_at) VALUES ('parent','import','ImportBackgroundChildArtifact',?,1,'started',1)").run(JSON.stringify({child_call_id:"child",artifact_id:"source-artifact",path:"report.txt"}));
  db.prepare("INSERT INTO automation_background_operation_leases VALUES ('parent','import',1,2,'captured-lease')").run();
  db.prepare("INSERT INTO automation_background_children (execution_id,call_id,child_request_id,peer_id,issuer_host_id,input_json,issued_at,retry_at,receipt_json,observed_json,observed_execution_id) VALUES ('parent','child','child-request','original-peer','original-issuer','{}',1,1,'{}',?,'child-execution')").run(JSON.stringify({artifacts:[{id:"source-artifact",relativePath:"report.txt",contentHash:hash,bytes:bytes.length}]}));
  return db;
}
function commit(db,call="import",artifact="parent-artifact"){
  db.exec("BEGIN IMMEDIATE");
  try{
    db.prepare(artifactInsert).run(artifact,"parent","report.txt",hash,bytes.length,bytes,2);
    db.prepare(provenanceInsert).run("parent","child","source-artifact",artifact,"original-peer","child-request","child-execution","report.txt",hash,bytes.length);
    db.prepare(complete).run("parent",call,JSON.stringify({role:"toolResult",toolCallId:call,toolName:"ImportBackgroundChildArtifact",isError:false,artifact}),0,2);
    db.exec("COMMIT");
  }catch(error){db.exec("ROLLBACK");throw error;}
}

test("production schema, bytes, provenance and exact operation receipt survive reopen and migration replay",()=>{
  const directory=mkdtempSync(path.join(tmpdir(),"xgent-child-artifact-")),filename=path.join(directory,"tasks.sqlite");let db;
  try{
    db=fixture(filename);commit(db);db.close();db=new DatabaseSync(filename);db.exec(migration);db.exec(provenance);
    const artifact=db.prepare(sql(read("services/automation/store/artifacts.rs"),"SELECT a.artifact_id, a.relative_path")).get("parent-request","parent-artifact");
    assert.deepEqual(Buffer.from(artifact.content),bytes);assert.equal(artifact.content_hash,hash);
    const imported=db.prepare("SELECT * FROM automation_background_child_artifacts").get();
    assert.equal(imported.peer_id,"original-peer");assert.equal(imported.child_execution_id,"child-execution");
    const operation=db.prepare(ownIntent).get("parent","import",1,2,"captured-lease");
    assert.equal(JSON.parse(operation.result_json).artifact,"parent-artifact");
    assert.equal(db.prepare("SELECT state FROM automation_background_operations").get().state,"returned");
    assert.equal(db.prepare(sql(read("services/automation/store/artifacts.rs"),"SELECT a.artifact_id, a.relative_path")).get("other-request","parent-artifact"),undefined);
  }finally{db?.close();rmSync(directory,{recursive:true,force:true});}
});

test("actual source/intent queries reject another parent, lease, tool, issuer or unaccepted source",()=>{
  const db=fixture();try{
    assert.ok(db.prepare(ownIntent).get("parent","import",1,2,"captured-lease"));
    for(const args of [["other","import",1,2,"captured-lease"],["parent","invented",1,2,"captured-lease"],["parent","import",2,2,"captured-lease"],["parent","import",1,2,"foreign"]])assert.equal(db.prepare(ownIntent).get(...args),undefined);
    assert.ok(db.prepare(ownChild).get("parent","child"));assert.equal(db.prepare(ownChild).get("other","child"),undefined);
    for(const change of ["UPDATE automation_background_children SET issuer_host_id='foreign'","UPDATE automation_background_children SET receipt_json=NULL","UPDATE automation_background_children SET observed_execution_id=NULL","UPDATE automation_background_children SET observed_json=NULL"]){
      db.exec("SAVEPOINT invalid_source");db.exec(change);assert.equal(db.prepare(ownChild).get("parent","child"),undefined);db.exec("ROLLBACK TO invalid_source; RELEASE invalid_source");
    }
    db.exec("UPDATE automation_background_operations SET tool_name='OtherTool'");assert.equal(db.prepare(ownIntent).get("parent","import",1,2,"captured-lease"),undefined);
  }finally{db.close();}
});

test("execution-bound composition SQL reads retained parent bytes after child observations disappear and excludes other tasks",()=>{
  const db=fixture();try{
    commit(db);
    db.exec("DELETE FROM automation_background_children");
    db.prepare(sql(read("services/automation/store/background.rs"),"INSERT INTO automation_background_tasks")).run("other-request","other-parent","{}",2);
    const artifacts=read("services/automation/store/artifacts.rs");
    const request=db.prepare(sql(artifacts,"SELECT request_id FROM automation_background_tasks WHERE execution_id = ?1"));
    const content=db.prepare(sql(artifacts,"SELECT a.artifact_id, a.relative_path"));
    const own=request.get("parent");assert.equal(own.request_id,"parent-request");
    const saved=content.get(own.request_id,"parent-artifact");assert.deepEqual(Buffer.from(saved.content),bytes);assert.equal(saved.content_hash,hash);
    assert.equal(content.get(request.get("other-parent").request_id,"parent-artifact"),undefined);
    assert.equal(content.get(own.request_id,"source-artifact"),undefined);
    assert.equal(request.get("invented-parent"),undefined);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_child_artifacts").get().n,1);
  }finally{db.close();}
});

test("receipt persistence failure rolls back the blob and provenance instead of claiming delivery",()=>{
  const db=fixture();try{
    db.exec("CREATE TEMP TRIGGER receipt_storage_failure BEFORE UPDATE OF result_json ON automation_background_operations BEGIN SELECT RAISE(ABORT,'receipt storage failure'); END;");
    assert.throws(()=>commit(db),/receipt storage failure/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_artifacts").get().n,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_child_artifacts").get().n,0);
    assert.equal(db.prepare("SELECT state,result_json FROM automation_background_operations").get().state,"started");
    db.exec("DROP TRIGGER receipt_storage_failure");commit(db);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_artifacts").get().n,1);
  }finally{db.close();}
});

test("source uniqueness survives duplicate inserts and parent data cannot be replaced by a sibling",()=>{
  const db=fixture();try{
    commit(db);assert.throws(()=>db.prepare(provenanceInsert).run("parent","child","source-artifact","replacement","foreign","different","different","different",hash,bytes.length),/UNIQUE/);
    const original=db.prepare(sql(source,"SELECT artifact_id,peer_id,child_request_id,child_execution_id,content_hash,bytes,source_path")).get("parent","child","source-artifact");
    assert.equal(original.artifact_id,"parent-artifact");assert.equal(original.peer_id,"original-peer");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_artifacts").get().n,1);
    assert.throws(()=>db.prepare(provenanceInsert).run("another","child","source","new","peer","request","execution","file",hash,8388609),/CHECK/);
  }finally{db.close();}
});

test("native wiring uses original read-only child routing, double configuration fences, bounded verified bytes and an atomic receipt",()=>{
  const command=read("commands/automation/children.rs"),app=read("lib.rs");
  const section=command.slice(command.indexOf("pub async fn automation_background_child_import_artifact"),command.indexOf("pub async fn automation_background_model_submit"));
  assert.match(section,/window.label\(\)!="agent-worker"/);assert.match(section,/source\.receipt.*return Ok/s);
  assert.match(section,/"automation_background_read_artifact"/);assert.doesNotMatch(section,/automation_background_submit|automation_background_resume|submit_background_task/);
  assert.equal((source.match(/Self::verify_background_configuration/g)||[]).length,2);
  assert.match(source,/Sha256::digest\(&content\)/);assert.match(source,/content\.len\(\)>8\*1024\*1024/);assert.match(source,/count>=32.*1024\*1024\*1024/);
  assert.ok(source.indexOf("Self::complete_background_operation_on_connection")<source.indexOf("tx.commit()"));
  assert.match(app,/commands::children::automation_background_child_import_artifact/);
  const transport=read("services/lan_pc_client.rs");
  assert.match(transport,/command == "automation_background_read_artifact"/);
  assert.match(transport,/const LIMIT: usize = 16 \* 1024 \* 1024/);
  assert.match(transport,/content_length\(\).*LIMIT/);
  assert.match(transport,/chunk\.len\(\) > LIMIT\.saturating_sub\(bytes\.len\(\)\)/);
});
