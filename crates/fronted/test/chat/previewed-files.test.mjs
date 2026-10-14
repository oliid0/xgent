import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { collectPreviewedFiles } = loader.loadModule("src/lib/chat/messages/previewedFiles.ts");

function previewBlock(id, path, isError = false) {
  return {
    kind: "tool",
    item: {
      toolCall: { id, name: "PreviewFile", arguments: { path } },
      toolResult: {
        role: "toolResult", toolCallId: id, toolName: "PreviewFile",
        content: [{ type: "text", text: isError ? "failed" : "opened" }],
        details: { kind: "mobile_file_preview", path }, isError, timestamp: 1,
      },
    },
  };
}

test("PreviewFile output keeps shell-created files and deduplicates later opens", () => {
  const rounds = [{ blocks: [
    previewBlock("first", "slides.pptx"),
    previewBlock("failed", "missing.pdf", true),
    previewBlock("last", "./slides.pptx"),
  ] }];
  assert.deepEqual(collectPreviewedFiles(rounds), [{ path: "./slides.pptx", toolCallId: "last" }]);
});

test("PreviewFile output excludes paths already covered by a file change or deletion", () => {
  const changed = { files: [
    { path: "report.md", deleted: false },
    { path: "removed.pdf", deleted: true },
  ] };
  const rounds = [{ blocks: [
    previewBlock("report", "./report.md"),
    previewBlock("removed", "removed.pdf"),
    previewBlock("slides", "slides.pptx"),
  ] }];
  assert.deepEqual(collectPreviewedFiles(rounds, changed), [
    { path: "slides.pptx", toolCallId: "slides" },
  ]);
});

test("persisted preview sources survive JSON replay and distinguish same paths and case-sensitive names", () => {
  const source = hostId => ({ version: 1, hostId, workdir: "/workspace" });
  const a = source("11111111-1111-4111-8111-111111111111"), b = source("22222222-2222-4222-8222-222222222222");
  const block = (id, path, fileSource) => { const value = previewBlock(id, path); value.item.toolResult.details.fileSource = fileSource; return value; };
  const rounds = JSON.parse(JSON.stringify([{ blocks: [block("a", "report.md", a), block("b", "report.md", b), block("case", "Report.md", a), block("a-new", "./report.md", a)] }]));
  const files = collectPreviewedFiles(rounds, { files: [{ path: "report.md", deleted: true }] });
  assert.deepEqual(files.map(file => [file.toolCallId, file.fileSource.hostId]), [["a-new", a.hostId], ["b", b.hostId], ["case", a.hostId]]);
  assert.ok(files.every(file => Object.keys(file.fileSource).join(",") === "version,hostId,workdir"));
});

test("invalid preview source is preserved as unknown rather than fabricating the current device", () => {
  const block = previewBlock("invalid", "result.pdf");
  block.item.toolResult.details.fileSource = { version: 1, hostId: "Same Mac", workdir: "/workspace", baseUrl: "http://current-pc" };
  assert.deepEqual(collectPreviewedFiles([{ blocks: [block] }]), [{ path: "result.pdf", toolCallId: "invalid", fileSource: null }]);
});
