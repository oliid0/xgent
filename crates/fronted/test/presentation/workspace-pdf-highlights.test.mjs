import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, PDFName, PDFDict, PDFString, degrees } from "pdf-lib";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { verifyPdfHighlightsInBrowser } from "../helpers/pdf-highlight-browser.mjs";

const { writePdfHighlights, validPdfHighlights, parsePdfHighlights, remainingPdfHighlights, isEditablePdf } =
  createTsModuleLoader().loadModule("src/components/workspace-editor/workspacePdfHighlights.ts");
const mark = (id = "first", color = "yellow") => ({ id, color, pageIndex: 1, rects: [[30, 70, 100, 15], [30, 50, 50, 15]] });

test("actual PDF.js text selection and saved highlight rendering stay aligned across rotation and zoom", async () => {
  const pdf = await PDFDocument.create(); const page = pdf.addPage([400, 500]);
  page.drawText("Original selectable text", { x: 30, y: 70, size: 16 });
  const results = await verifyPdfHighlightsInBrowser(await pdf.save());
  assert.equal(results.length, 8);
  assert.ok(results.every(result => result.changed > 100));
});

test("PDF highlights round-trip real annotations while retaining forms, page rotation and existing annotations", async () => {
  const original = await PDFDocument.create();
  original.setTitle("Original title"); original.addPage([400, 500]);
  const page = original.addPage([600, 700]); page.setRotation(degrees(90));
  page.drawText("Original page text", { x: 30, y: 70 });
  const form = original.getForm().createTextField("amount"); form.setText("123");
  form.addToPage(original.getPage(0), { x: 20, y: 20, width: 100, height: 25 });
  page.node.addAnnot(original.context.register(original.context.obj({ Type: "Annot", Subtype: "Text", Rect: [10, 10, 25, 25], Contents: PDFString.of("Existing note") })));
  const input = await original.save();
  const output = await writePdfHighlights(input, [mark()]);
  const saved = await PDFDocument.load(output);
  assert.equal(saved.getTitle(), "Original title");
  assert.equal(saved.getPageCount(), 2);
  assert.equal(saved.getPage(1).getRotation().angle, 90);
  assert.equal(saved.getForm().getTextField("amount").getText(), "123");
  const annotations = saved.getPage(1).node.Annots();
  assert.equal(annotations.size(), 2);
  assert.equal(annotations.lookup(0, PDFDict).lookup(PDFName.of("Contents")).decodeText(), "Existing note");
  const highlight = annotations.lookup(1, PDFDict);
  assert.equal(highlight.lookup(PDFName.of("Subtype")).toString(), "/Highlight");
  assert.equal(highlight.lookup(PDFName.of("NM")).decodeText(), "xgent-first");
  assert.equal(highlight.lookup(PDFName.of("QuadPoints")).toString(), "[ 30 85 130 85 30 70 130 70 30 65 80 65 30 50 80 50 ]");
  assert.equal(highlight.lookup(PDFName.of("C")).toString(), "[ 1 0.85 0.15 ]");
  assert.ok(highlight.lookup(PDFName.of("AP"), PDFDict).lookup(PDFName.of("N")));
  const twice = await PDFDocument.load(await writePdfHighlights(output, [mark("second", "pink")]));
  assert.equal(twice.getPage(1).node.Annots().size(), 3);
});

test("PDF highlight payloads and page bounds reject invalid mutations before producing output", async () => {
  const pdf = await PDFDocument.create(); pdf.addPage([400, 500]);
  const bytes = await pdf.save();
  for (const value of [[], [null], [{ ...mark(), color: "unknown" }], [{ ...mark(), pageIndex: 1.2 }], [{ ...mark(), rects: [[0, NaN, 2, 4]] }], [mark(), mark()]]) {
    assert.equal(validPdfHighlights(value), false);
    await assert.rejects(writePdfHighlights(bytes, value), /Invalid PDF highlights/);
  }
  await assert.rejects(writePdfHighlights(bytes, [mark()]), /page is unavailable/);
  await assert.rejects(writePdfHighlights(bytes, [{ ...mark(), pageIndex: 0, rects: [[399, 20, 10, 10]] }]), /outside the page/);
  assert.equal(parsePdfHighlights("{broken"), null);
  assert.equal(parsePdfHighlights("[]"), null);
  assert.equal(parsePdfHighlights(JSON.stringify([mark()]))?.length, 1);
  assert.equal(isEditablePdf("converted.pptx", "application/pdf"), false);
  assert.equal(isEditablePdf("original.pdf", "text/html"), false);
  assert.equal(isEditablePdf("original.PDF", "application/pdf"), true);
  assert.deepEqual(Array.from(remainingPdfHighlights([mark(), mark("later")], [mark()]), entry => entry.id), ["later"]);
});
