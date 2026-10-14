import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {createTsModuleLoader} from "../helpers/load-ts-module.mjs";

const lease={attempt:1,generation:2,token:"11111111-1111-4111-8111-111111111111"};
const operation={id:"original-video-call",name:"GenerateVideo",arguments:{provider_id:"accepted-account",model:"configured-video",prompt:"Actual product film",path:"media/product.mp4",duration:6,resolution:"1080p",aspect_ratio:"16:9"}};
const accepted=()=>({role:"toolResult",toolCallId:operation.id,toolName:operation.name,isError:false,timestamp:123,content:[{type:"text",text:JSON.stringify({callId:operation.id,jobId:"actual-job",status:"pending"})}],details:{kind:"video_job",callId:operation.id,jobId:"actual-job",status:"pending"}});
function fixture({native=true,reply,verify,budgetError}={}){
  const calls=[];let admitted=0,checks=0;const original={...lease};
  const port={async invoke(command,args){calls.push({command,args});return reply?reply(command,args):command==="automation_video_start"?accepted():{status:"pending",accounts:[],models:[]};},homeDir:async()=>"/native",listen:async()=>()=>{}};
  const {createVideoGenerationTools}=createTsModuleLoader({mocks:{"@xgent/runtime":{isTauriRuntime:()=>native}}}).loadModule("src/lib/tools/videoGenerationTools.ts");
  const bundle=createVideoGenerationTools({providers:[],executionId:"original-execution",lease:original,async verifyConfiguration(){checks++;await verify?.(checks);},async beforeRequest(){if(budgetError)throw new Error("Original shared budget exhausted");admitted++;}},port);
  original.token="replacement";original.generation=99;
  return {bundle,calls,admitted:()=>admitted,run:(call=operation,signal)=>bundle.executeToolCall(call,signal)};
}

test("native video start admits once and returns the exact durably accepted original receipt",async()=>{
  const f=fixture(),result=await f.run();assert.deepEqual(result,accepted());assert.equal(f.admitted(),1);assert.equal(f.calls.length,1);
  assert.deepEqual(f.calls[0],{command:"automation_video_start",args:{execution_id:"original-execution",lease,call_id:operation.id,input:operation.arguments}});
  assert.equal(result.details.status,"pending");assert.equal(result.details.artifact,undefined);
  assert.equal(f.bundle.metadataByName.get("GenerateVideo").isReadOnly,false);
});

test("video catalog and retained job reads use original execution/lease and never admit or start",async()=>{
  const f=fixture();
  for(const call of [{id:"accounts",name:"VideoModels",arguments:{offset:20}},{id:"models",name:"VideoModels",arguments:{provider_id:"second-account"}},{id:"read",name:"VideoJob",arguments:{call_id:operation.id}}])assert.equal((await f.run(call)).isError,false);
  assert.equal(f.admitted(),0);assert.deepEqual(f.calls.map(({command})=>command),["automation_video_models","automation_video_models","automation_video_result"]);
  assert.ok(f.calls.every(({args})=>args.execution_id==="original-execution" && args.lease.token===lease.token));
  assert.equal(f.calls[2].args.call_id,operation.id);assert.equal(f.bundle.metadataByName.get("VideoJob").isReadOnly,true);
});

test("unsupported native protocol/parameter preflight differs from a lost submission ACK, with no replay",async()=>{
  for(const message of ["video_preflight_rejected: unsupported actual duration","video_submission_unconfirmed: original POST did not return","Native IPC ACK was lost"]){
    const f=fixture({reply:()=>{throw new Error(message);}});const result=await f.run();assert.equal(result.isError,true);assert.equal(f.calls.length,1);
    assert.equal(result.details.outcomeUncertain===true,!message.startsWith("video_preflight_rejected:"));
  }
  for(const patch of [{toolCallId:"other"},{toolName:"foreign"},{isError:true},{details:{kind:"not-video"}}]){
    const f=fixture({reply:()=>({...accepted(),...patch})});assert.equal((await f.run()).details.outcomeUncertain,true);assert.equal(f.calls.length,1);
  }
});

test("revoke, cancellation, invalid arguments and exhausted shared allowance cannot submit",async()=>{
  const f=fixture({verify:()=>{throw new Error("Original account changed");}});assert.equal((await f.run()).isError,true);assert.equal(f.calls.length,0);
  const blocked=fixture({budgetError:true});assert.equal((await blocked.run()).isError,true);assert.equal(blocked.calls.length,0);
  const abort=new AbortController();abort.abort();const cancelled=fixture();assert.equal((await cancelled.run(operation,abort.signal)).isError,true);assert.equal(cancelled.calls.length,0);
  for(const patch of [{provider_id:""},{path:"video.html"},{model:undefined},{prompt:""},{duration:-1},{resolution:0},{url:"https://arbitrary.invalid"},{job_id:"invented"}]){
    const invalid=fixture();assert.equal((await invalid.run({...operation,arguments:{...operation.arguments,...patch}})).isError,true);assert.equal(invalid.calls.length,0);assert.equal(invalid.admitted(),0);
  }
  assert.equal(fixture({native:false}).bundle,null);
});

test("a confirmed native acceptance survives late cancellation while stale read observations are not exposed",async()=>{
  const abort=new AbortController();const f=fixture({reply:()=>{abort.abort();return accepted();}});
  assert.deepEqual(await f.run(operation,abort.signal),accepted());
  const late=new AbortController(),read=fixture({reply:()=>{late.abort();return {status:"completed",artifact:{id:"actual"}};}});
  assert.equal((await read.run({id:"read",name:"VideoJob",arguments:{call_id:operation.id}},late.signal)).isError,true);
});

test("video wait uses only the original accepted call, rejecting mixed waits and fabricated verification",async()=>{
  const calls=[];const {createBackgroundOutcomeTools}=createTsModuleLoader({mocks:{"../automation/backend":{backend:{async recordBackgroundVideoWait(...args){calls.push(args);return {verified:false,branches:[{branch:{id:"video"},state:"waiting",evidence:null}]};}}}}}).loadModule("src/lib/tools/backgroundOutcomeTools.ts");
  const bundle=createBackgroundOutcomeTools("original-execution",lease);
  const call={id:"wait",name:"RecordBackgroundOutcome",arguments:{branch_id:"video",action:"wait",wait_for_video_call_id:operation.id,reason:"Await actual generated MP4"}};
  assert.equal((await bundle.executeToolCall(call)).isError,false);assert.deepEqual(calls[0],["original-execution","video",operation.id,call.arguments.reason,lease]);
  for(const patch of [{wait_for_child_call_id:"foreign"},{wait_for_cloud_call_id:"cloud"},{artifact_ids:["claim"]},{action:"verify"},{reason:""}])assert.equal((await bundle.executeToolCall({...call,arguments:{...call.arguments,...patch}})).isError,true);
  assert.equal(calls.length,1);
});

test("native private routes and background-only registry preserve ordinary single-model/cron paths",()=>{
  const read=name=>readFileSync(new URL(`../../${name}`,import.meta.url),"utf8");
  const app=read("src-tauri/src/lib.rs"),commands=read("src-tauri/src/commands/automation/videos.rs"),service=read("src-tauri/src/services/video_generation.rs");
  for(const name of ["models","start","result","wait"]){assert.match(app,new RegExp(`commands::videos::automation_video_${name}`));assert.match(commands,new RegExp(`pub async fn automation_video_${name}`));}
  assert.equal((commands.match(/window.label\(\)!="agent-worker"/g)||[]).length,4);
  assert.doesNotMatch(read("src-tauri/src/services/local_access.rs"),/"automation_video_(?:start|wait|result|models)"\s*=>/);
  assert.match(app,/services::video_generation::start/);assert.match(service,/retry\(reqwest::retry::never\(\)\)/);assert.match(service,/Policy::none\(\)/);
  assert.match(service,/bytes_stream\(\)/);assert.match(service,/video\/mp4/);assert.match(service,/ftyp/);assert.match(service,/content\(&client,headers,&probe.job\)/);
  assert.match(read("src/lib/automation/promptExecution.ts"),/videoGeneration:[\s\S]*?background && schedulingEnabled && lease/);
  assert.match(read("src/lib/tools/builtinRegistry.ts"),/if \(params.videoGeneration && commandPort\)/);
});
