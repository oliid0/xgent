import assert from "node:assert/strict";
import test from "node:test";
import * as pdfLib from "pdf-lib";
import JSZip from "jszip";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader({ mocks: { "pdf-lib": pdfLib, jszip: { default: JSZip } } });
const { annotateDocument } = loader.loadModule("src/components/workspace-editor/documentAnnotations.ts");

test("PDF annotation survives a real save/reload with Unicode contents and existing pages", async () => {
  const original = await pdfLib.PDFDocument.create();
  original.addPage([400, 500]);
  original.addPage([600, 700]);
  const bytes = await original.save();
  const saved = await annotateDocument(bytes, "pdf", 2, "\u5907\u6ce8: verified");
  const reopened = await pdfLib.PDFDocument.load(saved);
  assert.equal(reopened.getPageCount(), 2);
  assert.equal(reopened.getPage(0).node.Annots(), undefined);
  const annotations = reopened.getPage(1).node.Annots();
  assert.equal(annotations.size(), 1);
  const note = reopened.context.lookup(annotations.get(0));
  assert.equal(note.get(pdfLib.PDFName.of("Subtype")).toString(), "/Text");
  assert.equal(note.get(pdfLib.PDFName.of("Contents")).decodeText(), "\u5907\u6ce8: verified");
  const untouched = await pdfLib.PDFDocument.load(bytes);
  assert.equal(untouched.getPage(1).node.Annots(), undefined);
  await assert.rejects(annotateDocument(bytes, "pdf", 3, "note"), /outside/);
});
