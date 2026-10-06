import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const { isLargePasteText, makeLargePaste } = createTsModuleLoader().loadModule("src/lib/chat/largePaste.ts");

test("large-paste thresholds count the shared LF text, UTF-16 characters and empty final lines", () => {
  assert.equal(isLargePasteText("x".repeat(7999)), false);
  assert.equal(isLargePasteText("x".repeat(8000)), true);
  assert.equal(isLargePasteText("😀".repeat(4000)), true);
  assert.equal(isLargePasteText("\n".repeat(198)), false);
  assert.equal(isLargePasteText("\r\n".repeat(199)), true);
  assert.equal(isLargePasteText("\r".repeat(199)), true);
  assert.equal(isLargePasteText(""), false);
  assert.equal(isLargePasteText("x".repeat(7997) + "\r\n"), false);
});

test("both editors create the same normalized large-paste content, counts, label and preview", () => {
  const paste = makeLargePaste("\r\n  first  line\rsecond 😀\r\n", 3, "paste");
  assert.deepEqual(paste, { id: "paste", label: "Pasted text 3", text: "\n  first  line\nsecond 😀\n",
    charCount: "\n  first  line\nsecond 😀\n".length, lineCount: 4, preview: "first line second 😀" });
  assert.equal(makeLargePaste("x".repeat(1000), 1).preview.length, 160);
});
