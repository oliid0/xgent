import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,mkdtempSync,unlinkSync,rmdirSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import test from "node:test";

// Actual production schema/SQL and real >8 MiB bytes. Rust networking,
// Read/Seek/FS/tempfile APIs are not executed by these non-Cargo tests.
const read=name=>readFileSync(new URL(`../../src-tauri/src/${name}`,import.meta.url),"utf8");
const source=read("services/automation/store/artifact_parts.rs");
function sql(source,prefix){const found=[...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(item=>item[1].trimStart().startsWith(prefix));assert.ok(found,prefix);return found[1];}
const schema=sql(read("services/automation/db.rs"),"CREATE TABLE IF NOT EXISTS automation_meta");
const parts=read("services/automation/artifact_parts.sql"),pieceSize=524288;
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const content=Buffer.alloc(9*1024*1024+17);for(let offset=0;offset<content.length;offset+=65536)content.writeUInt32LE(offset,offset);
const artifactSQL=sql(source,"INSERT INTO automation_background_artifacts");
const pieceSQL=sql(source,"INSERT INTO automation_artifact_parts");
const finalizeSQL=sql(source,"UPDATE automation_background_artifacts SET content_hash");
const metaSQL=sql(source,"SELECT a.artifact_id,a.relative_path,a.content_hash,a.bytes");
const pieceReadSQL=sql(source,"SELECT content,content_hash FROM automation_artifact_parts");
function fixture(filename=":memory:"){
  const db=new DatabaseSync(filename);db.exec(schema);db.exec(parts);
  db.prepare(sql(read("services/automation/store/background.rs"),"INSERT INTO automation_background_tasks")).run("original-request","parent","{}",1);
  return db;
}
function publish(db,id="large",onSnapshot=()=>{}){
  db.exec("BEGIN IMMEDIATE");try{
    db.prepare(artifactSQL).run(id,"parent","产品.apk","0".repeat(64),content.length,Buffer.alloc(0),1);
    for(let offset=0,index=0;offset<content.length;offset+=pieceSize,index++){
      const data=content.subarray(offset,Math.min(content.length,offset+pieceSize));db.prepare(pieceSQL).run(id,index,data,hash(data));
    }
    db.prepare(finalizeSQL).run(id,hash(content));onSnapshot();db.exec("COMMIT");
  }catch(error){db.exec("ROLLBACK");throw error;}
}

test("large metadata/pieces atomically survive reopen and reconstruct exact bytes with bounded reads",()=>{
  const directory=mkdtempSync(path.join(tmpdir(),"xgent-stream-snapshot-")),filename=path.join(directory,"data.sqlite");let db;
  try{
    db=fixture(filename);publish(db);db.close();db=new DatabaseSync(filename);db.exec(parts);
    const original=db.prepare(metaSQL).get("original-request","large");assert.equal(original.bytes,content.length);assert.equal(original.content_hash,hash(content));
    assert.equal(db.prepare(metaSQL).get("different-request","large"),undefined);
    const digest=createHash("sha256");let total=0;
    for(let index=0;total<content.length;index++){
      const row=db.prepare(pieceReadSQL).get("large",index),data=Buffer.from(row.content);
      assert.ok(data.length<=pieceSize);assert.equal(hash(data),row.content_hash);assert.deepEqual(data,content.subarray(total,total+data.length));digest.update(data);total+=data.length;
    }
    assert.equal(total,content.length);assert.equal(digest.digest("hex"),original.content_hash);
    assert.equal(db.prepare("SELECT length(content) AS size FROM automation_background_artifacts").get().size,0);
  }finally{db?.close();unlinkSync(filename);rmdirSync(directory);}
});

test("piece failure rolls back the whole publication and no partially hashed manifest becomes readable",()=>{
  const db=fixture();try{
    db.exec("CREATE TEMP TRIGGER piece_failure BEFORE INSERT ON automation_artifact_parts WHEN NEW.part_index=2 BEGIN SELECT RAISE(ABORT,'piece failure'); END;");
    assert.throws(()=>publish(db),/piece failure/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_artifacts").get().n,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_artifact_parts").get().n,0);
    db.exec("DROP TRIGGER piece_failure");publish(db);assert.ok(db.prepare(metaSQL).get("original-request","large"));
  }finally{db.close();}
});

test("piece size/index uniqueness and large child provenance prevent unbounded or duplicate storage",()=>{
  const db=fixture();try{
    publish(db);
    for(const [index,data]of [[0,Buffer.from("duplicate")],[1024,Buffer.from("past bound")],[200,Buffer.alloc(pieceSize+1)],[200,Buffer.alloc(0)]])assert.throws(()=>db.prepare(pieceSQL).run("large",index,data,hash(data)),/UNIQUE|CHECK/);
    const large=read("services/automation/store/large_child_artifacts.rs");
    const provenance=sql(large,"INSERT OR IGNORE INTO automation_large_child_artifacts");
    db.prepare(provenance).run("parent","child","original-artifact","large","original-peer","child-request","child-execution","产品.apk",hash(content),content.length);
    db.prepare(provenance).run("parent","child","original-artifact","replacement","new-peer","changed","changed","renamed.apk","0".repeat(64),content.length);
    const saved=db.prepare("SELECT * FROM automation_large_child_artifacts").get();assert.equal(saved.artifact_id,"large");assert.equal(saved.peer_id,"original-peer");
    // Production INSERT OR IGNORE suppresses a CHECK violation too. It must
    // retain no invalid row; Rust rejects the bound before this transaction.
    assert.equal(db.prepare(provenance).run("parent","child","oversized","new","peer","request","exec","file","0".repeat(64),536870913).changes,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_large_child_artifacts WHERE child_artifact_id='oversized'").get().n,0);
  }finally{db.close();}
});

test("actual reader storage queries expose corruption without substituting empty/partial success",()=>{
  const db=fixture();try{
    publish(db);db.prepare("UPDATE automation_artifact_parts SET content=? WHERE artifact_id='large' AND part_index=0").run(Buffer.alloc(pieceSize,3));
    const corrupt=db.prepare(pieceReadSQL).get("large",0);assert.notEqual(hash(Buffer.from(corrupt.content)),corrupt.content_hash);
    db.prepare("DELETE FROM automation_artifact_parts WHERE artifact_id='large' AND part_index=1").run();assert.equal(db.prepare(pieceReadSQL).get("large",1),undefined);
    const storage=db.prepare(sql(source,"SELECT length(content),(SELECT COUNT(*)")).get("large");assert.notEqual(Object.values(storage)[1],Math.ceil(content.length/pieceSize));
  }finally{db.close();}
});

test("failed large child receipt rolls back pieces/provenance together and an exact receipt survives reopen",()=>{
  const directory=mkdtempSync(path.join(tmpdir(),"xgent-large-child-")),filename=path.join(directory,"data.sqlite");let db;
  try{
    db=fixture(filename);db.exec(read("services/automation/child_artifacts.sql"));
    db.exec("INSERT INTO automation_background_operations (execution_id,call_id,tool_name,arguments_json,context_revision,state,started_at) VALUES ('parent','import','ImportBackgroundChildArtifact','{}',1,'started',1)");
    const provenance=sql(read("services/automation/store/large_child_artifacts.rs"),"INSERT OR IGNORE INTO automation_large_child_artifacts");
    const complete=sql(read("services/automation/store/journal.rs"),"UPDATE automation_background_operations SET state = 'returned'");
    const receipt=JSON.stringify({role:"toolResult",toolCallId:"import",toolName:"ImportBackgroundChildArtifact",isError:false,artifact:"large",contentHash:hash(content)});
    const commit=()=>publish(db,"large",()=>{
      db.prepare(provenance).run("parent","child","source-artifact","large","original-peer","child-request","child-execution","产品.apk",hash(content),content.length);
      db.prepare(complete).run("parent","import",receipt,0,2);
    });
    db.exec("CREATE TEMP TRIGGER fail_receipt BEFORE UPDATE OF result_json ON automation_background_operations BEGIN SELECT RAISE(ABORT,'receipt failure'); END;");
    assert.throws(commit,/receipt failure/);
    for(const table of ["automation_background_artifacts","automation_artifact_parts","automation_large_child_artifacts"])assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0);
    assert.equal(db.prepare("SELECT state FROM automation_background_operations").get().state,"started");
    db.exec("DROP TRIGGER fail_receipt");commit();db.close();db=new DatabaseSync(filename);db.exec(parts);
    assert.equal(db.prepare("SELECT result_json FROM automation_background_operations").get().result_json,receipt);
    assert.equal(db.prepare("SELECT peer_id FROM automation_large_child_artifacts").get().peer_id,"original-peer");
    assert.equal(db.prepare(metaSQL).get("original-request","large").content_hash,hash(content));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_artifact_parts").get().n,Math.ceil(content.length/pieceSize));
  }finally{db?.close();unlinkSync(filename);rmdirSync(directory);}
});

test("native routes, original bindings, bounded transport and staged native-only final creation remain wired",()=>{
  const receive=read("commands/automation/artifact_streams.rs"),fs=read("commands/workspace/fs.rs"),children=read("commands/automation/children.rs"),large=read("services/automation/store/large_child_artifacts.rs");
  assert.match(source,/MAX_STREAM_ARTIFACT_BYTES: u64 = 512/);assert.match(source,/ARTIFACT_CHUNK_BYTES: usize = 256/);assert.match(source,/reader.read_exact/);assert.match(source,/chunk_hash/);
  assert.match(read("services/automation/store/inbox.rs"),/artifact_bytes.checked_add[\s\S]*?Result artifact manifest exceeds 1 GiB/);
  assert.match(receive,/background_inbox_artifact_source/);assert.match(receive,/registry.invoke\(peer,"automation_background_read_artifact_chunk"/);
  assert.match(receive,/Sha256::digest\(&bytes\)/);assert.match(receive,/hash.finalize\(\).*expected.content_hash/);assert.match(receive,/tempfile::tempfile\(\)/);
  assert.match(receive,/entries.len\(\)>=4/);assert.match(receive,/prepared.window!=window.label\(\)/);assert.match(receive,/Duration::from_secs\(900\)/);
  assert.match(fs,/temporary.persist_noclobber\(&target\)/);assert.match(fs,/streamed_file_identity/);assert.match(fs,/Artifact copy failed whole-file integrity/);
  assert.match(children,/import_background_child_artifact_file/);assert.match(large,/verify_background_configuration/);assert.match(large,/Original large child binding changed/);
  assert.ok(large.indexOf("complete_background_operation_on_connection")<large.indexOf("tx.commit()"));
  assert.match(read("services/local_access.rs"),/"automation_background_read_artifact_chunk" =>/);
  assert.match(read("services/worker_peers.rs"),/"automation_background_read_artifact_chunk"/);assert.match(read("services/lan_pc_client.rs"),/command == "automation_background_read_artifact_chunk"/);
  const app=read("lib.rs");assert.equal((app.match(/artifact_streams::automation_result_artifact_prepare/g)||[]).length,2);
});
