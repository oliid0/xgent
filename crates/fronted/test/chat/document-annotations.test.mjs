import assert from "node:assert/strict";
import test from "node:test";
import * as pdfLib from "pdf-lib";
import JSZip from "jszip";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { annotationBrowser, annotateInBrowser, presentationFixture } from "../helpers/document-annotation-browser.mjs";

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

test("PPTX annotation round trips actual XML namespaces, editable shapes and unrelated package parts", { skip: !annotationBrowser }, async () => {
  const bytes = await presentationFixture(JSZip, { prefixedRelationships: true });
  const saved = await annotateInBrowser(bytes, "pptx", 2, '中文 <备注> & "引用" 😀');
  const original = await JSZip.loadAsync(bytes);
  const reopened = await JSZip.loadAsync(saved);
  for (const path of Object.keys(original.files).filter(path => !original.files[path].dir && path !== "ppt/slides/slide2.xml")) {
    assert.deepEqual(await reopened.file(path).async("nodebuffer"), await original.file(path).async("nodebuffer"), path);
  }
  const slide = await reopened.file("ppt/slides/slide2.xml").async("string");
  assert.match(slide, /name="Xgent annotation 8"/);
  assert.match(slide, /txBox="1"/);
  assert.match(slide, /中文 &lt;备注&gt; &amp; "引用" 😀/);
  assert.match(slide, /Second original/);
  const again = await JSZip.loadAsync(await annotateInBrowser(saved, "pptx", 2, "Second note"));
  const second = await again.file("ppt/slides/slide2.xml").async("string");
  assert.match(second, /name="Xgent annotation 9"/); assert.match(second, /Second note/);
});

test("PPTX annotation resolves escaped internal slide names and rejects missing or external targets", { skip: !annotationBrowser }, async () => {
  const valid = await presentationFixture(JSZip, { target: "slides/slide%20two.xml", slidePath: "ppt/slides/slide two.xml" });
  const zip = await JSZip.loadAsync(await annotateInBrowser(valid, "pptx", 2, "Named slide"));
  assert.match(await zip.file("ppt/slides/slide two.xml").async("string"), /Named slide/);
  const external = await presentationFixture(JSZip, { external: true });
  await assert.rejects(annotateInBrowser(external, "pptx", 2, "Note"), /Invalid slide relationship/);
  const missing = await presentationFixture(JSZip);
  await assert.rejects(annotateInBrowser(missing, "pptx", 3, "Note"), /outside/);
});
