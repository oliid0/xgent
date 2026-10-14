import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const artifactId="22222222-2222-4222-8222-222222222222";
const lease={attempt:1,generation:2,token:"11111111-1111-4111-8111-111111111111"};
const bytes=readFileSync(new URL("../../src-tauri/icons/StoreLogo.png",import.meta.url));
const snapshot=()=>({artifact:{id:artifactId,relativePath:"child-results/original/产品.png",bytes:bytes.length,contentHash:createHash("sha256").update(bytes).digest("hex")},contentBase64:bytes.toString("base64")});
function fixture({response=snapshot(),onRead,verify}={}){
  const reads=[],checks=[];
  const api=createTsModuleLoader({mocks:{"./backend":{backend:{async readBackgroundExecutionArtifact(...args){reads.push(args);onRead?.();return response;}}}}}).loadModule("src/lib/automation/backgroundOfficeImages.ts");
  const input={...lease};
  const read=api.createBackgroundOfficeImageReader("original-parent",input,async()=>{checks.push(checks.length+1);await verify?.(checks.length);});
  input.attempt=9;input.token="replacement";
  return {read,reads,checks};
}

test("parent composition pins native execution and copied lease, verifies actual bytes and rechecks configuration",async()=>{
  const f=fixture();assert.deepEqual(await f.read(artifactId),{data:bytes.toString("base64"),mimeType:"image/png"});
  assert.deepEqual(f.reads,[["original-parent",artifactId,lease]]);assert.deepEqual(f.checks,[1,2]);
});

test("invented sources and changed artifact ID, size, hash, encoding or content cannot become an Office image",async()=>{
  for(const id of ["", "child/image.png", `https://peer/${artifactId}`, `${artifactId}/other`, "other-request"]){const f=fixture();await assert.rejects(f.read(id),/actual retained parent/);assert.equal(f.reads.length,0);}
  const original=snapshot();
  for(const response of [
    {...original,artifact:{...original.artifact,id:"foreign"}},
    {...original,artifact:{...original.artifact,bytes:bytes.length+1}},
    {...original,artifact:{...original.artifact,bytes:8*1024*1024+1}},
    {...original,artifact:{...original.artifact,contentHash:"0".repeat(64)}},
    {...original,contentBase64:"not base64"},
    {...original,contentBase64:original.contentBase64.slice(4)},
    {artifact:{id:artifactId,bytes:4,contentHash:createHash("sha256").update("text").digest("hex")},contentBase64:Buffer.from("text").toString("base64")},
  ])await assert.rejects(fixture({response}).read(artifactId),/evidence|integrity|PNG or JPEG/);
});

test("revocation before or after reads and cancellation retain no usable image snapshot",async()=>{
  for(const stage of [1,2]){const f=fixture({verify:async(count)=>{if(count===stage)throw new Error("Original configuration revoked");}});await assert.rejects(f.read(artifactId),/revoked/);assert.equal(f.reads.length,stage-1);}
  const controller=new AbortController(),f=fixture({onRead:()=>controller.abort()});await assert.rejects(f.read(artifactId,controller.signal),/abort/i);assert.equal(f.checks.length,1);
  const stopped=new AbortController();stopped.abort();const idle=fixture();await assert.rejects(idle.read(artifactId,stopped.signal),/abort/i);assert.equal(idle.reads.length,0);
});

test("composition artifact backend uses native authority even when selected-PC transport exists",async()=>{
  const reads=[],response=snapshot();
  const {backend}=createTsModuleLoader({mocks:{"@xgent/runtime":{invokeNative:async(command,args)=>{reads.push({command,args});return response;},invoke:()=>assert.fail("No mutable selected-PC routing")}}}).loadModule("src/lib/automation/backend.ts");
  assert.equal(await backend.readBackgroundExecutionArtifact("original-parent",artifactId,lease),response);
  assert.deepEqual(reads,[{command:"automation_background_execution_read_artifact",args:{execution_id:"original-parent",artifact_id:artifactId,lease}}]);
});
