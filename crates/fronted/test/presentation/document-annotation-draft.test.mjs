import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const { documentAnnotationFormat, boundedAnnotationText, parseAnnotationDraft, remainingAnnotationDraft } =
  createTsModuleLoader().loadModule("src/components/workspace-editor/documentAnnotationDraft.ts");

test("document annotation formats require matching original MIME and file formats", () => {
  assert.equal(documentAnnotationFormat("Notes.PDF", "application/pdf; charset=binary"), "pdf");
  assert.equal(documentAnnotationFormat("Slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"), "pptx");
  for (const path of ["Slides.pptx", "Notes.docx", "Slides.ppt", "note.txt"]) assert.equal(documentAnnotationFormat(path, "application/pdf"), null);
});

test("document annotation limits count UTF16 and never cut a surrogate pair", () => {
  assert.equal(boundedAnnotationText("😀".repeat(6001)), "😀".repeat(6000));
  assert.equal(boundedAnnotationText("X".repeat(11999) + "😀"), "X".repeat(11999));
  assert.equal(boundedAnnotationText("X".repeat(11999) + "A😀"), "X".repeat(11999) + "A");
  assert.equal(parseAnnotationDraft(JSON.stringify({ text: "😀".repeat(6000), page: 2 })).page, 2);
  assert.equal(parseAnnotationDraft(JSON.stringify({ text: "😀".repeat(6001), page: 2 })), null);
  for (const page of [-1, 0, 1.5, null, "2", 2147483648]) assert.equal(parseAnnotationDraft(JSON.stringify({ text: "Note", page })), null);
});

test("annotation acknowledgements clear only the same text and page", () => {
  const written = { text: "Saved", page: 1 };
  assert.deepEqual(remainingAnnotationDraft(written, written), { text: "", page: 1 });
  assert.deepEqual(remainingAnnotationDraft({ text: "Saved", page: 2 }, written), { text: "Saved", page: 2 });
  assert.deepEqual(remainingAnnotationDraft({ text: "Later", page: 1 }, written), { text: "Later", page: 1 });
  assert.deepEqual(remainingAnnotationDraft({ text: "Later", page: 1 }, undefined), { text: "Later", page: 1 });
});
