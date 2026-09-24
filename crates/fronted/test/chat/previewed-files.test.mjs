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
