import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const bytes=Buffer.from("Actual published presentation"),contentHash=createHash("sha256").update(bytes).digest("hex");
const artifact={id:"file",requestId:"11111111-1111-4111-8111-111111111111",relativePath:"reports/product.pptx",contentHash,bytes:bytes.length,taskName:"Product",at:100};
const content={artifact,contentBase64:bytes.toString("base64")};
function fixture(options={}) {
  const calls=[];
  const {transferGoalArtifact}=createTsModuleLoader({mocks:{"@xgent/runtime":{isTauriRuntime:()=>options.native!==false,invoke:()=>{throw new Error("Remote filesystem forbidden");},invokeNative:async(command,args)=>{calls.push({command,args});return {path:args.path,bytesWritten:bytes.length,contentHash,...options.receipt};}},"../shared/id":{createUuid:()=>"transfer"}}}).loadModule("src/lib/automation/goalArtifacts.ts");
  return {calls,save:(expected=artifact,actual=content,workdir="/phone",current=()=>true)=>transferGoalArtifact("launch",expected,actual,workdir,current)};
}

test("goal artifact transfer verifies real bytes and writes only to the native local workspace",async()=>{
  const f=fixture(),saved=await f.save();assert.equal(saved.status,"saved");assert.equal(f.calls.length,1);assert.equal(f.calls[0].command,"fs_create_binary");
  assert.equal(f.calls[0].args.workdir,"/phone");assert.equal(f.calls[0].args.expected_content_hash,contentHash);
  assert.equal(saved.path,`goal-results/launch/${artifact.requestId}/file/transfer/reports/product.pptx`);
});

test("changed manifests, corrupt bytes, unsafe paths, excessive files and retired views cannot write",async()=>{
  for(const [expected,actual] of [
    [artifact,{...content,artifact:{...artifact,id:"other"}}],
    [artifact,{...content,contentBase64:Buffer.from("corrupt").toString("base64")}],
    [artifact,{...content,contentBase64:bytes.subarray(1).toString("base64")}],
    ...["../file","/file","a\\file","a/./file","a//file","C:file"].map(relativePath=>{const value={...artifact,relativePath};return [value,{...content,artifact:value}];}),
    [{...artifact,bytes:8*1024*1024+1},content],
  ]){const f=fixture();await assert.rejects(f.save(expected,actual));assert.equal(f.calls.length,0);}
  for(const [workdir,current] of [["",()=>true],["/phone",()=>false]]){const f=fixture();await assert.rejects(f.save(artifact,content,workdir,current));assert.equal(f.calls.length,0);}
});

test("inconsistent native receipts never report a saved artifact",async()=>{
  for(const receipt of [{path:"different"},{bytesWritten:0},{contentHash:"0".repeat(64)}])await assert.rejects(fixture({receipt}).save(),/goals.saveUnconfirmed/);
});

test("browser requests a real download and releases its URL without claiming delivery",async()=>{
  const previous={document:globalThis.document,create:URL.createObjectURL,revoke:URL.revokeObjectURL,timeout:globalThis.setTimeout};
  let blob,timer,clicked=false,removed=false,revoked=false;
  const anchor={style:{},click(){clicked=true;},remove(){removed=true;}};
  try {
    globalThis.document={createElement:name=>{assert.equal(name,"a");return anchor;},body:{appendChild:node=>assert.equal(node,anchor)}};
    URL.createObjectURL=value=>{blob=value;return "blob:actual";};URL.revokeObjectURL=url=>{assert.equal(url,"blob:actual");revoked=true;};
    globalThis.setTimeout=(callback,delay)=>{assert.equal(delay,60000);timer=callback;};
    const f=fixture({native:false});assert.equal((await f.save()).status,"download_requested");assert.equal(f.calls.length,0);
    assert.equal(clicked,true);assert.equal(removed,true);assert.equal(anchor.download,"product.pptx");assert.deepEqual(Buffer.from(await blob.arrayBuffer()),bytes);timer();assert.equal(revoked,true);
  } finally {globalThis.document=previous.document;URL.createObjectURL=previous.create;URL.revokeObjectURL=previous.revoke;globalThis.setTimeout=previous.timeout;}
});
