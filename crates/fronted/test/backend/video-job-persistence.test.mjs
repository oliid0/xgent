import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,mkdtempSync,unlinkSync,rmdirSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import test from "node:test";

// Execute actual production SQLite statements; this does not execute Rust,
// real upstream video generation, MP4 validation or OS/network APIs.
const read=name=>readFileSync(new URL(`../../src-tauri/src/${name}`,import.meta.url),"utf8");
function sql(source,prefix){const found=[...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs)].find(item=>item[1].trimStart().startsWith(prefix));assert.ok(found,prefix);return found[1];}
const source=read("services/automation/store/videos.rs"),background=read("services/automation/store/background.rs"),journal=read("services/automation/store/journal.rs"),parts=read("services/automation/store/artifact_parts.rs");
const schema=sql(read("services/automation/db.rs"),"CREATE TABLE IF NOT EXISTS automation_meta"),videoDDL=read("services/automation/videos.sql");
const intended=JSON.stringify({provider_id:"original-account",model:"configured-video",prompt:"Original task brief",path:"media/product.mp4",duration:6,resolution:"1080p",aspect_ratio:"16:9"});
const run=(db,statement,values=[],method="run")=>db.prepare(statement)[method](Object.fromEntries(values.map((value,index)=>[String(index+1),value])));
const query=(prefix)=>sql(source,prefix);
function fixture(filename=":memory:"){
  const db=new DatabaseSync(filename);db.exec(schema);db.exec(videoDDL);db.exec(read("services/automation/artifact_parts.sql"));
  db.exec("INSERT INTO automation_meta VALUES ('background_worker_id.v1','original-host')");return db;
}
function stage(db,id="parent",call="video"){
  run(db,sql(background,"INSERT INTO automation_background_tasks"),[`${id}-request`,id,"{}",1]);
  run(db,sql(background,"INSERT INTO automation_cron_runs"),[id,1,5000,"{}"]);
  run(db,sql(journal,"INSERT INTO automation_background_operations"),[id,call,"GenerateVideo",intended,1,1]);
  db.prepare("INSERT INTO automation_background_operation_leases VALUES (?,?,1,2,'original-lease')").run(id,call);
  run(db,query("INSERT INTO automation_video_jobs"),[id,call,intended,"original-host","original-nonce",1]);
}
const receipt=JSON.stringify({role:"toolResult",toolCallId:"video",toolName:"GenerateVideo",isError:false,timestamp:100,content:[{type:"text",text:'{"callId":"video","jobId":"original-job","status":"pending"}'}],details:{kind:"video_job",callId:"video",jobId:"original-job",status:"pending"}});
function acknowledge(db,id="parent"){
  db.exec("BEGIN IMMEDIATE");try{
    assert.equal(run(db,query("UPDATE automation_video_jobs SET job_id"),[id,"video","original-nonce","original-job",100]).changes,1);
    run(db,sql(journal,"UPDATE automation_background_operations SET state = 'returned'"),[id,"video",receipt,0,100]);db.exec("COMMIT");
  }catch(error){db.exec("ROLLBACK");throw error;}
}

test("original upstream job and exact operation receipt survive reopen in one transaction",()=>{
  const dir=mkdtempSync(path.join(tmpdir(),"xgent-video-job-")),filename=path.join(dir,"db.sqlite");let db;
  try{db=fixture(filename);stage(db);acknowledge(db);db.close();db=new DatabaseSync(filename);db.exec(videoDDL);
    const job=db.prepare("SELECT * FROM automation_video_jobs").get();assert.equal(job.job_id,"original-job");assert.equal(job.issuer_host_id,"original-host");assert.equal(job.input_json,intended);
    assert.equal(db.prepare("SELECT result_json FROM automation_background_operations").get().result_json,receipt);
    assert.equal(run(db,query("SELECT o.arguments_json,o.result_json"),["parent","video",1,2,"original-lease"],"get").result_json,receipt);
    assert.equal(run(db,query("SELECT o.arguments_json,o.result_json"),["parent","video",1,2,"replacement"],"get"),undefined);
    assert.equal(run(db,query("SELECT job_id,state,artifact_id,error"),["foreign","video"],"get"),undefined);
  }finally{db?.close();unlinkSync(filename);rmdirSync(dir);}
});

test("unknown POST is never polled/resubmitted and failed ACK storage cannot fabricate acceptance",()=>{
  const db=fixture();try{stage(db);
    assert.equal(run(db,query("SELECT j.execution_id,j.call_id"),[100],"all").length,0);
    assert.equal(run(db,query("SELECT EXISTS(SELECT 1 FROM automation_video_jobs WHERE"),["parent","video"],"get")["EXISTS(SELECT 1 FROM automation_video_jobs WHERE execution_id=?1 AND call_id=?2)"],1);
    assert.equal(run(db,query("UPDATE automation_video_jobs SET job_id"),["parent","video","wrong-nonce","foreign-job",100]).changes,0);
    db.exec("CREATE TEMP TRIGGER fail_ack BEFORE UPDATE OF result_json ON automation_background_operations BEGIN SELECT RAISE(ABORT,'ACK storage failed'); END;");
    assert.throws(()=>acknowledge(db),/ACK storage failed/);assert.equal(db.prepare("SELECT job_id FROM automation_video_jobs").get().job_id,null);
    assert.equal(db.prepare("SELECT state FROM automation_background_operations").get().state,"started");
    db.exec("DROP TRIGGER fail_ack");acknowledge(db);
    assert.equal(run(db,query("UPDATE automation_video_jobs SET job_id"),["parent","video","original-nonce","replacement-job",200]).changes,0);
    assert.equal(db.prepare("SELECT job_id FROM automation_video_jobs").get().job_id,"original-job");
  }finally{db.close();}
});

test("native polling is bounded/fair, excludes stopped/foreign/unaccepted sources and pins the original account/probe",()=>{
  const db=fixture();try{
    for(let i=0;i<7;i++){stage(db,`task${i}`);acknowledge(db,`task${i}`);}
    const due=query("SELECT j.execution_id,j.call_id"),defer=query("UPDATE automation_video_jobs SET retry_at=?3");
    const first=run(db,due,[100],"all");assert.equal(first.length,4);
    db.exec("BEGIN IMMEDIATE");for(const row of first)run(db,defer,[row.execution_id,row.call_id,700]);db.exec("COMMIT");
    assert.equal(run(db,due,[100],"all").length,3);
    db.exec("UPDATE automation_cron_runs SET state='expired' WHERE execution_id='task4'");
    db.exec("UPDATE automation_video_jobs SET issuer_host_id='foreign-host' WHERE execution_id='task5'");
    assert.deepEqual(run(db,due,[100],"all").map(row=>row.execution_id),["task6"]);
    const prepare=query("SELECT j.input_json,j.job_id,j.probes");assert.equal(run(db,prepare,["task4","video"],"get"),undefined);assert.equal(run(db,prepare,["task5","video"],"get"),undefined);
    assert.equal(run(db,prepare,["task6","video"],"get").input_json,intended);
    run(db,query("UPDATE automation_video_jobs SET nonce"),["task6","video","new-probe",1,700]);
    const owns=query("SELECT EXISTS(SELECT 1 FROM automation_video_jobs j JOIN automation_cron_runs");
    const check=(nonce="new-probe",job="original-job",input=intended)=>Object.values(run(db,owns,["task6","video",nonce,job,input],"get"))[0];
    assert.equal(check(),1);assert.equal(check("old-probe"),0);assert.equal(check("new-probe","foreign-job"),0);assert.equal(check("new-probe","original-job",intended.replace("original-account","replacement")),0);
  }finally{db.close();}
});

test("terminal status cannot claim a video until original retained file bytes commit, and publication failure rolls back",()=>{
  const db=fixture();try{stage(db);acknowledge(db);
    const complete=query("UPDATE automation_video_jobs SET state"),proof=query("SELECT j.state='completed'");
    assert.equal(Object.values(run(db,proof,["parent","video"],"get"))[0],0);
    const data=Buffer.alloc(9*1024*1024+17,7),hash=bytes=>createHash("sha256").update(bytes).digest("hex");
    const publish=()=>{db.exec("BEGIN IMMEDIATE");try{
      run(db,sql(parts,"INSERT INTO automation_background_artifacts"),["actual-file","parent","media/product.mp4","0".repeat(64),data.length,Buffer.alloc(0),200]);
      for(let index=0,offset=0;offset<data.length;index++,offset+=524288){const piece=data.subarray(offset,offset+524288);run(db,sql(parts,"INSERT INTO automation_artifact_parts"),["actual-file",index,piece,hash(piece)]);}
      run(db,sql(parts,"UPDATE automation_background_artifacts SET content_hash"),["actual-file",hash(data)]);
      run(db,complete,["parent","video","completed","actual-file",null,200,230,0]);db.exec("COMMIT");
    }catch(error){db.exec("ROLLBACK");throw error;}};
    db.exec("CREATE TEMP TRIGGER fail_video BEFORE UPDATE OF artifact_id ON automation_video_jobs BEGIN SELECT RAISE(ABORT,'video completion failed'); END;");
    assert.throws(publish,/video completion failed/);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_artifact_parts").get().n,0);assert.equal(db.prepare("SELECT artifact_id FROM automation_video_jobs").get().artifact_id,null);
    db.exec("DROP TRIGGER fail_video");publish();assert.equal(Object.values(run(db,proof,["parent","video"],"get"))[0],1);
    const stored=run(db,query("SELECT artifact_id,relative_path,content_hash,bytes FROM"),["parent","actual-file"],"get");assert.equal(stored.content_hash,hash(data));assert.equal(stored.bytes,data.length);
    assert.equal(run(db,query("SELECT artifact_id,relative_path,content_hash,bytes FROM"),["another-parent","actual-file"],"get"),undefined);
    db.prepare("UPDATE automation_background_artifacts SET execution_id='foreign'").run();assert.equal(Object.values(run(db,proof,["parent","video"],"get"))[0],0);
  }finally{db.close();}
});

test("small asynchronously retained media keeps the original whole-file reader and hash/size manifest",()=>{
  const db=fixture();try{stage(db);
    const data=Buffer.from("actual bounded snapshot bytes"),hash=createHash("sha256").update(data).digest("hex");
    run(db,sql(parts,"INSERT INTO automation_background_artifacts"),["small","parent","media/small.mp4","0".repeat(64),data.length,Buffer.alloc(0),100]);
    run(db,sql(parts,"UPDATE automation_background_artifacts SET content=?2,content_hash=?3"),["small",data,hash]);
    const stored=run(db,sql(read("services/automation/store/artifacts.rs"),"SELECT a.artifact_id, a.relative_path"),["parent-request","small"],"get");assert.deepEqual(Buffer.from(stored.content),data);assert.equal(stored.content_hash,hash);assert.equal(stored.bytes,data.length);
  }finally{db.close();}
});

test("native configuration fences, atomic original receipt and actual byte completion remain connected",()=>{
  assert.match(source,/verify_background_configuration/);assert.match(source,/verify_background_binding/);assert.match(source,/video_account/);assert.match(source,/issuer_host_id=.*background_worker_id.v1/s);
  assert.match(source,/background_budget_deadline\(&tx,id\).*deadline<=db::now_ms\(\)/);
  assert.match(source,/original submission must not be sent again/);assert.match(source,/complete_background_operation_on_connection/);
  assert.match(source,/write_snapshot\(&tx,&probe.execution/);assert.match(source,/j.input_json=\?5/);assert.match(source,/j.wake_ack=0/);assert.match(source,/SET wake_ack=1/);
  const outcomes=read("services/automation/store/outcomes.rs");assert.match(outcomes,/video_operation_completed/);assert.match(outcomes,/unfinished_video_call/);
  const service=read("services/video_generation.rs");assert.equal((service.match(/\.post\(/g)||[]).length,0);assert.match(service,/buffer_unordered\(2\)/);assert.match(service,/finish_video_probe/);assert.match(service,/wake_terminal_videos/);
  const command=read("commands/automation/videos.rs");assert.equal((command.match(/\.post\(/g)||[]).length,1);assert.ok(command.indexOf("stage_video")<command.indexOf("client.post"));assert.ok(command.indexOf("client.post")<command.indexOf("acknowledge_video"));
});

test("real native observation errors/summary retain the original call and cannot create a terminal result",()=>{
  const db=fixture();try{stage(db);acknowledge(db);
    const error=query("UPDATE automation_video_jobs SET error"),summary=query("SELECT call_id,state,artifact_id,error");
    assert.equal(run(db,error,["parent","video","Original polling failed"]).changes,1);
    const row=run(db,summary,["parent"],"all")[0];assert.equal(row.call_id,"video");assert.equal(row.state,"pending");assert.equal(row.error,"Original polling failed");assert.equal(row.artifact_id,null);
    assert.equal(run(db,error,["foreign","video","Forged completion"]).changes,0);assert.deepEqual(run(db,summary,["foreign"],"all"),[]);
    db.exec("UPDATE automation_video_jobs SET state='failed',terminal_at=200,error='Actual terminal failure'");
    assert.equal(run(db,error,["parent","video","Late polling failure"]).changes,0);assert.equal(run(db,summary,["parent"],"all")[0].error,"Actual terminal failure");
    assert.match(read("services/automation/store/background.rs"),/background_video_summary/);
    assert.match(read("services/automation/types.rs"),/skip_serializing_if = "Vec::is_empty"[\s\S]*?pub videos/);
  }finally{db.close();}
});

test("new video wait can recover only a confirmed terminal failure, without replacing active/unknown/successful ownership",()=>{
  const db=fixture();try{stage(db);acknowledge(db);
    const failed=query("SELECT EXISTS(SELECT 1 FROM automation_video_jobs WHERE execution_id=?1 AND call_id=?2 AND state IN");
    const allowed=()=>Object.values(run(db,failed,["parent","video"],"get"))[0];
    assert.equal(allowed(),0);
    for(const state of ["issuing","pending","in_progress","completed"]){db.prepare("UPDATE automation_video_jobs SET state=?,terminal_at=200").run(state);assert.equal(allowed(),0);}
    for(const state of ["failed","cancelled","expired"]){db.prepare("UPDATE automation_video_jobs SET state=?,terminal_at=200").run(state);assert.equal(allowed(),1);}
    db.exec("UPDATE automation_video_jobs SET terminal_at=NULL");assert.equal(allowed(),0);
    db.exec("UPDATE automation_video_jobs SET terminal_at=200,issuer_host_id='foreign'");assert.equal(allowed(),0);
    run(db,query("INSERT OR IGNORE INTO automation_video_waits"),["parent","video","video"]);
    const replace=query("UPDATE automation_video_waits SET call_id");assert.equal(run(db,replace,["parent","video","new-admitted-call","foreign-call"]).changes,0);
    assert.equal(run(db,replace,["parent","video","new-admitted-call","video"]).changes,1);
    assert.equal(db.prepare("SELECT call_id FROM automation_video_waits").get().call_id,"new-admitted-call");
  }finally{db.close();}
});

test("only a linked waiting original parent wakes once; wake ACK and resumption roll back together",()=>{
  const db=fixture();try{stage(db);acknowledge(db);
    const waiting=read("services/automation/store/waiting.rs");
    db.exec("UPDATE automation_cron_runs SET state='waiting'");
    db.exec("INSERT INTO automation_background_checkpoints VALUES ('parent',1,'{\"systemPrompt\":\"Original\",\"messages\":[]}',1)");
    run(db,sql(waiting,"INSERT INTO automation_background_waits"),["original-wait","parent","{}","[]",1,1,"[]",0]);
    db.exec("INSERT INTO automation_background_outcomes VALUES ('parent','video','waiting',NULL,'Await actual MP4',1)");
    run(db,query("INSERT OR IGNORE INTO automation_video_waits"),["parent","video","video"]);
    const candidates=query("SELECT DISTINCT j.execution_id"),complete=query("UPDATE automation_video_jobs SET state");
    assert.deepEqual(run(db,candidates,[500],"all"),[]);
    run(db,complete,["parent","video","failed",null,"Actual provider failure",200,230,0]);
    assert.deepEqual(run(db,candidates,[500],"all").map(row=>row.execution_id),["parent"]);
    db.exec("SAVEPOINT foreign_source");db.exec("UPDATE automation_video_jobs SET issuer_host_id='foreign-host'");assert.deepEqual(run(db,candidates,[500],"all"),[]);db.exec("ROLLBACK TO foreign_source; RELEASE foreign_source");
    const resume=sql(waiting,"INSERT INTO automation_background_resumptions"),state=sql(waiting,"UPDATE automation_cron_runs SET state = 'pending'"),ack=query("UPDATE automation_video_jobs SET wake_ack");
    const wake=()=>{db.exec("BEGIN IMMEDIATE");try{
      run(db,resume,["native-response","parent","original-wait",JSON.stringify({requestId:"parent-request",waitId:"original-wait",response:"Original terminal video observation"}),300]);
      run(db,state,["parent"]);run(db,ack,["parent"]);db.exec("COMMIT");
    }catch(error){db.exec("ROLLBACK");throw error;}};
    db.exec("CREATE TEMP TRIGGER fail_wake BEFORE UPDATE OF wake_ack ON automation_video_jobs BEGIN SELECT RAISE(ABORT,'wake ACK failed'); END;");
    assert.throws(wake,/wake ACK failed/);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM automation_background_resumptions").get().n,0);assert.equal(db.prepare("SELECT state FROM automation_cron_runs").get().state,"waiting");
    db.exec("DROP TRIGGER fail_wake");wake();assert.equal(db.prepare("SELECT wake_ack FROM automation_video_jobs").get().wake_ack,1);
    db.exec("UPDATE automation_cron_runs SET state='waiting'");assert.deepEqual(run(db,candidates,[500],"all"),[]);
  }finally{db.close();}
});
