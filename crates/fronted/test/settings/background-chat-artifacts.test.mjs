import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const receiver = randomUUID(), worker = randomUUID(), request = randomUUID(), entry = randomUUID(), artifactId = randomUUID();
const artifact = { id: artifactId, relativePath: "product.docx", bytes: 48, contentHash: "a".repeat(64) };
const ref = { version: 1, conversationId: "original", receiverHostId: receiver, sourceHostId: worker, requestId: request, entryId: entry, snapshotHash: "b".repeat(64), artifact };
const path = `background-results/${request}/${artifactId}/product.docx`;
const saved = { path, bytesWritten: 48, contentHash: artifact.contentHash };
const flush = async () => { for (let i=0;i<50;i++) await Promise.resolve(); };
function setup(options={}) {
  const calls=[];let copied=false;
  const checked=()=>({artifact, saved: options.cached || copied ? saved : null, receiverHostId:receiver, sourceHostId:worker, entryId:entry, snapshotHash:ref.snapshotHash, ...options.checked});
  const module=createTsModuleLoader({mocks:{
    "@xgent/runtime": {isTauriRuntime:()=>options.native!==false,getLanPcCommandHostConfig:()=>options.route??{enabled:false},async invokeNative(command,args){
      calls.push([command,args]);
      if(command==="automation_device_identity")return {hostId:options.host??receiver};
      assert.equal(command,"automation_result_chat_artifact");
      if(options.onCheck)await options.onCheck();
      if(options.nativeError)throw new Error(options.nativeError);
      return checked();
    }},
    "./backgroundInboxArtifacts":{async saveInboxArtifact(owner,file,workdir,isCurrent){calls.push(["save",owner,file,workdir]);assert.equal(isCurrent(),true);
      await options.onCopy?.();if(options.copyError){if(options.competingWriter)copied=true;throw new Error(options.copyError)}copied=true;return saved;
    }},
  }}).loadModule("src/lib/automation/backgroundChatArtifactOpen.ts");
  return {calls,open:(current=()=>true,workdir="/local-phone")=>module.openBackgroundChatArtifact(ref,workdir,current)};
}

test("actual original artifact is downloaded once to the local receiver and verified before returning a source-bound preview",async()=>{
  const f=setup({route:{enabled:true,localWorkdir:"/local-phone",workdir:"/selected-remote"}});
  const result=await f.open();assert.deepEqual(result,{path,fileSource:{version:1,hostId:receiver,workdir:"/local-phone"}});
  assert.deepEqual(f.calls.map(([command])=>command),["automation_device_identity","automation_result_chat_artifact","save","automation_result_chat_artifact"]);
  assert.deepEqual(f.calls[2].slice(1),[{id:entry,requestId:request},artifact,"/local-phone"]);
  for(const [command,args]of f.calls.filter(([command])=>command==="automation_result_chat_artifact")){assert.equal(args.conversation_id,"original");assert.equal(args.entry_id,entry);assert.equal(args.request_id,request);assert.equal(args.artifact_id,artifactId);}
});

test("verified local copy reopens with no download or executor query even after the original host is offline",async()=>{
  const f=setup({cached:true});assert.equal((await f.open()).path,path);assert.equal(f.calls.length,2);assert.equal(f.calls.some(([command])=>command==="save"),false);
});

test("foreign receiving device, browser, or absent local workspace cannot redirect the artifact to a selected PC",async()=>{
  for(const options of [{host:randomUUID()},{native:false},{route:{enabled:true,workdir:"/selected-remote"}}]){
    const f=setup(options);await assert.rejects(f.open(),/original receiving device|native app|local receiving workspace/);assert.equal(f.calls.some(([command])=>command==="save"),false);
  }
});

test("native reference/manifest/cache inconsistencies are errors before any transfer or preview",async()=>{
  for(const patch of [{sourceHostId:randomUUID()},{entryId:randomUUID()},{snapshotHash:"c".repeat(64)},{artifact:{...artifact,bytes:50}},{saved:{...saved,path:"other"}},{saved:{...saved,contentHash:"c".repeat(64)}}]){
    const f=setup({checked:patch});await assert.rejects(f.open(),/changed|verified/);assert.equal(f.calls.some(([command])=>command==="save"),false);
  }
  const failed=setup({nativeError:"Original chat result changed"});await assert.rejects(failed.open(),/changed/);assert.equal(failed.calls.some(([command])=>command==="save"),false);
});

test("repeated clicks share the same real transfer and a completed competing writer requires actual cache proof",async()=>{
  let finish;const gate=new Promise(resolve=>finish=resolve);const f=setup({onCopy:()=>gate});
  const first=f.open(),second=f.open();await flush();assert.equal(f.calls.filter(([command])=>command==="save").length,1);finish();assert.deepEqual(await first,await second);
  const competing=setup({copyError:"Already exists",competingWriter:true});assert.equal((await competing.open()).path,path);
  const failed=setup({copyError:"Transfer failed"});await assert.rejects(failed.open(),/Transfer failed/);
});

test("leaving the originating view prevents late transfers or opening a returned file",async()=>{
  let active=true;const f=setup({onCheck:()=>{active=false}});await assert.rejects(f.open(()=>active),/original conversation/);assert.equal(f.calls.some(([command])=>command==="save"),false);
  active=true;const after=setup({onCopy:()=>{active=false}});await assert.rejects(after.open(()=>active),/original conversation/);
});
