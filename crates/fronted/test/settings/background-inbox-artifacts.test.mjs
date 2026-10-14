import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
const bytes = Buffer.from("actual document bytes"), hash = createHash("sha256").update(bytes).digest("hex");
const artifact = { id: "file", relativePath: "product.docx", bytes: bytes.length, contentHash: hash };
const entry = { id: "notice", requestId: "original-request", sourceHostId: "original-host" };
function setup(options = {}) {
  const calls = [];
  const { saveInboxArtifact } = createTsModuleLoader({ mocks: {
    "@xgent/runtime": { isTauriRuntime: () => options.native !== false },
    "./backend": { backend: { async readReceivedBackgroundArtifact(id, artifactId) { calls.push(["fetch", id, artifactId]); if (options.offline) throw new Error("Offline original host"); await options.fetchWait; return { artifact: options.manifest ?? artifact, contentBase64: options.content ?? bytes.toString("base64") }; } } },
    "@tauri-apps/api/core": { async invoke(command, args) { calls.push([command, args]); if (options.writeFails) throw new Error("File already exists"); await options.writeWait; return { path: args.path, bytesWritten: artifact.bytes, contentHash: hash, ...(options.writeResult ?? {}) }; } },
  } }).loadModule("src/lib/automation/backgroundInboxArtifacts.ts");
  return { save: (workdir = "/actual-phone", current = () => true) => saveInboxArtifact(entry, artifact, workdir, current), calls };
}

test("leaving an inbox before fetch settlement prevents a write, and late write receipts cannot report saved files", async () => {
  for (const phase of ["fetch", "write"]) {
    let release, current = true;
    const wait = new Promise(resolve => { release = resolve; });
    const f = setup({ [phase + "Wait"]: wait });
    const saving = f.save("/actual-phone", () => current);
    for (let i=0;i<20;i++) await Promise.resolve();
    current = false; release();
    await assert.rejects(saving, /original inbox view/);
    assert.equal(f.calls.some(([name]) => name === "fs_create_binary"), phase === "write");
  }
  const f = setup(); await assert.rejects(f.save("/actual-phone", () => false), /original inbox view/); assert.deepEqual(f.calls, []);
});
test("received artifact uses immutable entry coordinates and writes verified bytes only to this native workspace", async () => {
  const f = setup(); const saved = await f.save(); assert.equal(saved.path, "background-results/original-request/file/product.docx");
  assert.deepEqual(f.calls[0], ["fetch", "notice", "file"]); assert.equal(f.calls[1][0], "fs_create_binary");
  assert.equal(f.calls[1][1].workdir, "/actual-phone"); assert.equal(f.calls[1][1].expected_content_hash, hash);
});
test("offline, changed manifest, corrupted bytes or missing native workspace cannot write a file", async () => {
  for (const options of [{ offline: true }, { manifest: { ...artifact, id: "other" } }, { content: Buffer.from("corrupt").toString("base64") }, { native: false }]) {
    const f = setup(options); await assert.rejects(f.save()); assert.equal(f.calls.some(([name]) => name === "fs_create_binary"), false);
  }
  const f = setup(); await assert.rejects(f.save("")); assert.deepEqual(f.calls, []);
});
test("failed local create or inconsistent write receipt never reports file delivery", async () => {
  await assert.rejects(setup({ writeFails: true }).save(), /already exists/);
  await assert.rejects(setup({ writeResult: { bytesWritten: 0 } }).save(), /inconsistent evidence/);
});

function largeSetup({retireAfterPrepare=false,retireAfterCommit=false,manifestPatch={},savedPatch={},prepareError,commitError}={}) {
  const file={id:"file",relativePath:"product.apk",bytes:10*1024*1024,contentHash:hash};
  const calls=[];let current=true;
  const transferId="11111111-1111-4111-8111-111111111111";
  const {saveInboxArtifact}=createTsModuleLoader({mocks:{"@xgent/runtime":{isTauriRuntime:()=>true},
    "./backend":{backend:{readReceivedBackgroundArtifact:()=>assert.fail("No whole-file WebView read")}},
    "@tauri-apps/api/core":{async invoke(command,args){calls.push({command,args});
      if(command==="automation_result_artifact_prepare"){if(prepareError)throw new Error(prepareError);if(retireAfterPrepare)current=false;return {transferId,artifact:{...file,...manifestPatch}};}
      if(command==="automation_result_artifact_commit"){if(commitError)throw new Error(commitError);if(retireAfterCommit)current=false;return {path:"background-results/original-request/file/product.apk",bytesWritten:file.bytes,contentHash:hash,...savedPatch};}
      if(command==="automation_result_artifact_abort")return;assert.fail(command);
    }}}}).loadModule("src/lib/automation/backgroundInboxArtifacts.ts");
  return {calls,save:()=>saveInboxArtifact(entry,file,"/actual-phone",()=>current)};
}

test("large downloads stage bounded native bytes and commit only their original receipt/workspace",async()=>{
  const f=largeSetup(),result=await f.save();assert.equal(result.bytesWritten,10*1024*1024);
  assert.deepEqual(f.calls.map(call=>call.command),["automation_result_artifact_prepare","automation_result_artifact_commit","automation_result_artifact_abort"]);
  assert.deepEqual(f.calls[0].args,{entry_id:"notice",artifact_id:"file",workdir:"/actual-phone"});
  assert.deepEqual(f.calls[1].args,{transfer_id:"11111111-1111-4111-8111-111111111111"});
});

test("retired views and changed manifests cannot create a late large destination; prepared files are released",async()=>{
  for(const options of [{retireAfterPrepare:true},{manifestPatch:{id:"foreign"}},{manifestPatch:{bytes:1}},{manifestPatch:{contentHash:"bad"}}]){
    const f=largeSetup(options);await assert.rejects(f.save());assert.equal(f.calls.some(call=>call.command.endsWith("commit")),false);assert.equal(f.calls.at(-1).command,"automation_result_artifact_abort");
  }
  const late=largeSetup({retireAfterCommit:true});await assert.rejects(late.save(),/original inbox view/);assert.equal(late.calls.at(-1).command,"automation_result_artifact_abort");
});

test("native large create failure or inconsistent receipt cannot fabricate delivery or replay a destination write",async()=>{
  for(const options of [{commitError:"File already exists"},{savedPatch:{bytesWritten:1}},{savedPatch:{path:"foreign/root"}},{savedPatch:{contentHash:"bad"}}]){
    const f=largeSetup(options);await assert.rejects(f.save());assert.equal(f.calls.filter(call=>call.command.endsWith("commit")).length,1);assert.equal(f.calls.at(-1).command,"automation_result_artifact_abort");
  }
  const unavailable=largeSetup({prepareError:"Original peer does not support artifact chunks"});await assert.rejects(unavailable.save(),/artifact chunks/);assert.equal(unavailable.calls.length,1);
});
