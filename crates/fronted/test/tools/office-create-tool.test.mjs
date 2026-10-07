import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function harness({ exists = false, failure, additionalRoots, onStatus } = {}) {
  const calls = [], saved = new Map();
  const loader = createTsModuleLoader({ mocks: {
    "@tauri-apps/api/core": { async invoke(command, args) {
      calls.push({ command, args });
      if (command === "fs_path_status") { onStatus?.(); return { exists, kind: exists ? "file" : null }; }
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
  const bundle = createFsTools({ workdir: "/workspace", fileState: createFileToolState(), additionalRoots,
    checkpoint: { conversationId: "chat-1", turnId: "turn-2" } });
  return { calls, saved, bundle, run: (path, document, signal) => bundle.executeToolCall({
    id: "office-1", name: "OfficeCreate", arguments: { path, document },
  }, signal) };
}

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
