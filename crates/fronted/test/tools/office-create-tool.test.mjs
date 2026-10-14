import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function harness({ exists = false, failure, additionalRoots, onStatus, imageFailure, onImage, imageCalls = [], readOfficeArtifactImage } = {}) {
  const calls = [], saved = new Map();
  const loader = createTsModuleLoader({ mocks: {
    "@tauri-apps/api/core": { async invoke(command, args) {
      calls.push({ command, args });
      if (command === "fs_path_status") { onStatus?.(); return { exists, kind: exists ? "file" : null }; }
      if (command === "fs_read_image_source") {
        imageCalls.push(args);onImage?.();if(imageFailure)throw new Error(imageFailure);
        return {kind:"image",data:readFileSync(new URL("../../src-tauri/icons/StoreLogo.png",import.meta.url)).toString("base64"),mimeType:"image/png"};
      }
      if (command === "fs_create_office_document") {
        if (failure) throw new Error(failure);
        const bytes = Buffer.from(args.content_base64, "base64");
        saved.set(args.path, bytes);
        return { path: args.path, bytesWritten: bytes.length, mtimeMs: 1234, contentHash: "hash", fileId: "file-1" };
      }
      if (command === "fs_read_text") return {
        kind: "presentation", path: args.path, content: "Slide 1: Actual slide content", truncated: false,
        mtimeMs: 1234, contentHash: "hash", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      };
      throw new Error(`Unexpected command: ${command}`);
    } },
  } });
  const { createFsTools } = loader.loadModule("src/lib/tools/fsTools.ts");
  const { createFileToolState } = loader.loadModule("src/lib/tools/fileToolState.ts");
  const bundle = createFsTools({ workdir: "/workspace", fileState: createFileToolState(), additionalRoots, readOfficeArtifactImage,
    checkpoint: { conversationId: "chat-1", turnId: "turn-2" } });
  return { calls, saved, bundle, run: (path, document, signal) => bundle.executeToolCall({
    id: "office-1", name: "OfficeCreate", arguments: { path, document },
  }, signal) };
}

test("OfficeCreate reads actual images through the original scoped file port and permits readonly source roots without granting writes",async()=>{
  const imageCalls=[],h=harness({imageCalls,additionalRoots:[{id:"reference",alias:"reference",path:"/references",access:"read"}]});
  const document={format:"pptx",slides:[{elements:[{type:"image",path:"root://reference/产品.png",x:1,y:1,width:5,height:3,altText:"产品图"}]}]};
  validateToolArguments(h.bundle.tools.find(tool=>tool.name==="OfficeCreate"),{id:"schema",name:"OfficeCreate",arguments:{path:"reports/product.pptx",document}});
  const result=await h.run("reports/product.pptx",document);assert.equal(result.isError,false,JSON.stringify(result));
  assert.equal(imageCalls.length,1);assert.equal(imageCalls[0].workdir,"/references");assert.equal(imageCalls[0].source,"产品.png");assert.equal(imageCalls[0].source_type,"path");
  const zip=await JSZip.loadAsync(h.saved.get("reports/product.pptx"));assert.ok(Object.keys(zip.files).some(path=>path.startsWith("ppt/media/")&&!zip.files[path].dir));
  assert.ok(h.calls.findIndex(call=>call.command==="fs_read_image_source")<h.calls.findIndex(call=>call.command==="fs_create_office_document"));
});

test("OfficeCreate composes retained parent images without a child request or filesystem source read",async()=>{
  const artifactId="22222222-2222-4222-8222-222222222222",reads=[];
  const bytes=readFileSync(new URL("../../src-tauri/icons/StoreLogo.png",import.meta.url));
  const h=harness({readOfficeArtifactImage:async(id,signal)=>{reads.push({id,signal});return {data:bytes.toString("base64"),mimeType:"image/png"};}});
  const controller=new AbortController();
  const result=await h.run("report.pptx",{format:"pptx",slides:[{elements:[{type:"image",path:`background-artifact://${artifactId}`,x:1,y:1,width:3,height:2}]}]},controller.signal);
  assert.equal(result.isError,false,JSON.stringify(result));assert.deepEqual(reads,[{id:artifactId,signal:controller.signal}]);
  assert.equal(h.calls.some(call=>call.command==="fs_read_image_source"),false);
  const zip=await JSZip.loadAsync(h.saved.get("report.pptx"));
  const media=Object.keys(zip.files).find(path=>path.startsWith("ppt/media/")&&!zip.files[path].dir);
  assert.deepEqual(await zip.file(media).async("nodebuffer"),bytes);
  assert.match(h.bundle.tools.find(tool=>tool.name==="OfficeCreate").description,/parent artifact UUID/);
});

test("ordinary chats cannot interpret retained artifact references as filesystem paths; cancelled or refused composition never creates a file",async()=>{
  const document={format:"docx",paragraphs:[{text:"Image",image:{path:"background-artifact://22222222-2222-4222-8222-222222222222",width:200,height:100}}]};
  const ordinary=harness();assert.equal((await ordinary.run("report.docx",document)).isError,true);
  assert.equal(ordinary.calls.some(call=>call.command==="fs_read_image_source"),false);assert.equal(ordinary.saved.size,0);
  assert.doesNotMatch(ordinary.bundle.tools.find(tool=>tool.name==="OfficeCreate").description,/parent artifact UUID/);
  const refused=harness({readOfficeArtifactImage:async()=>{throw new Error("No retained artifact in this execution");}});
  assert.equal((await refused.run("report.docx",document)).isError,true);assert.equal(refused.saved.size,0);
  const controller=new AbortController(),cancelled=harness({readOfficeArtifactImage:async()=>{controller.abort();return {data:"",mimeType:"image/png"};}});
  assert.equal((await cancelled.run("report.docx",document,controller.signal)).isError,true);assert.equal(cancelled.saved.size,0);
});

test("OfficeCreate rejects outside/missing/retired image reads without saving any output document",async()=>{
  for(const [path,options] of [["../private.png",{}],["https://example.test/product.png",{}],["root://unknown/product.png",{}],["assets/product.png",{imageFailure:"Original image is unavailable"}]]){
    const h=harness(options);const result=await h.run("reports/product.pptx",{format:"pptx",slides:[{elements:[{type:"image",path,x:1,y:1,width:4,height:3}]}]});assert.equal(result.isError,true);assert.equal(h.saved.size,0);
  }
  const controller=new AbortController(),h=harness({onImage:()=>controller.abort()});const result=await h.run("product.docx",{format:"docx",paragraphs:[{text:"Caption",image:{path:"asset.png",width:200,height:100}}]},controller.signal);assert.equal(result.isError,true);assert.equal(h.saved.size,0);
});

test("OfficeCreate writes real editable files with permission metadata and checkpoints", async () => {
  const h = harness();
  const documents = [
    { format: "docx", paragraphs: [{ text: "Actual document" }] },
    { format: "xlsx", sheets: [{ name: "Data", rows: [[12, { formula: "A1*2" }]] }] },
    { format: "pptx", slides: [{ elements: [{ type: "text", x: 1, y: 1, width: 8, height: 1, text: "Actual slide content" }] }] },
  ];
  const tool = h.bundle.tools.find(tool => tool.name === "OfficeCreate");
  assert.equal(h.bundle.metadataByName.get("OfficeCreate").isReadOnly, false);
  assert.equal(h.bundle.metadataByName.get("OfficeCreate").displayCategory, "file");
  for (const document of documents) {
    const path = `reports/result.${document.format}`;
    validateToolArguments(tool, { id: "schema", name: tool.name, arguments: { path, document } });
    const result = await h.run(path, document);
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.equal(result.details.kind, "write");
    assert.equal(result.details.absolutePath, `/workspace/${path}`);
    assert.equal(result.details.existedBefore, false);
    assert.equal(result.details.bytesWritten, h.saved.get(path).length);
    const zip = await JSZip.loadAsync(h.saved.get(path));
    assert.ok(zip.file("[Content_Types].xml"));
    const write = h.calls.filter(c => c.command === "fs_create_office_document").at(-1);
    assert.deepEqual(write.args.checkpoint, { conversationId: "chat-1", turnId: "turn-2" });
    assert.equal(write.args.workdir, "/workspace");
  }
  assert.ok(h.calls.every(c => c.command.startsWith("fs_")));
  const read = await h.bundle.executeToolCall({ id: "inspect", name: "Read", arguments: { path: "reports/result.pptx" } });
  assert.equal(read.isError, false);
  assert.equal(read.details.kind, "read_presentation");
  assert.match(read.content[0].text, /Actual slide content/);
});

test("OfficeCreate blocks invalid paths, existing files, malformed data and read-only roots", async () => {
  for (const [path, document, options] of [
    ["../outside.docx", { format: "docx", paragraphs: [{ text: "x" }] }],
    ["wrong.pptx", { format: "docx", paragraphs: [{ text: "x" }] }],
    ["old.docx", { format: "docx", paragraphs: [{ text: "x" }] }, { exists: true }],
    ["bad.docx", { format: "docx", paragraphs: [{ text: "bad\0" }] }],
    ["root://reference/report.docx", { format: "docx", paragraphs: [{ text: "x" }] },
      { additionalRoots: [{ id: "reference", alias: "reference", path: "/references", access: "read" }] }],
  ]) {
    const h = harness(options); const result = await h.run(path, document);
    assert.equal(result.isError, true, path);
    assert.equal(h.saved.size, 0); assert.equal(h.calls.some(c => c.command === "fs_create_office_document"), false);
  }
});

test("OfficeCreate cannot report success after cancellation or backend failure", async () => {
  const document = { format: "docx", paragraphs: [{ text: "x" }] };
  const controller = new AbortController();
  const cancelled = harness({ onStatus: () => controller.abort() });
  const result = await cancelled.run("report.docx", document, controller.signal);
  assert.equal(result.isError, true); assert.equal(cancelled.saved.size, 0);
  const denied = harness({ failure: "Path already exists" });
  const error = await denied.run("report.docx", document);
  assert.equal(error.isError, true); assert.match(error.content[0].text, /Path already exists/);
  assert.equal(denied.saved.size, 0);
});
