import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { read, utils } from "xlsx";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const { createOfficeDocument } = createTsModuleLoader().loadModule("src/lib/office/createOfficeDocument.ts");

test("shared DOCX generator creates real Unicode paragraphs, styled runs and table cells", async () => {
  const bytes = await createOfficeDocument({ format: "docx", paragraphs: [
    { text: "工作文稿 <&> 😀", heading: 1 }, { text: "Editable paragraph", bold: true },
  ], tables: [[["名称", "Value"], ["A", "42"]]] });
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml").async("string");
  assert.match(xml, /工作文稿 &lt;&amp;&gt; 😀/);
  assert.match(xml, /Heading1/); assert.match(xml, /<w:b\/>/);
  assert.match(xml, /<w:tbl>/); assert.match(xml, /<w:t[^>]*>42<\/w:t>/);
  assert.ok(zip.file("[Content_Types].xml")); assert.ok(zip.file("_rels/.rels"));
});

test("shared XLSX generator retains literal types and actual Excel formulas", async () => {
  const bytes = await createOfficeDocument({ format: "xlsx", sheets: [
    { name: "数据", rows: [["Name", "Value"], ["A", 12], ["B", 30], [true, { formula: "=SUM(B2:B3)" }]] },
    { name: "Other", rows: [[null, "text"]] },
  ] });
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("xl/worksheets/sheet1.xml").async("string");
  assert.match(xml, /<c r="B4"[^>]*><f>SUM\(B2:B3\)<\/f><\/c>/);
  // A formula without a calculated cache is retained only with sheetStubs in
  // the installed SheetJS parser; never fabricate a result for the writer.
  const workbook = read(bytes, { type: "array", cellFormula: true, sheetStubs: true });
  assert.deepEqual(workbook.SheetNames, ["数据", "Other"]);
  assert.equal(workbook.Sheets.数据.B2.v, 12);
  assert.equal(workbook.Sheets.数据.A4.v, true);
  assert.equal(workbook.Sheets.数据.B4.f, "SUM(B2:B3)");
  assert.equal(workbook.Sheets.Other.B1.t, "s");
  assert.equal(utils.sheet_to_json(workbook.Sheets.数据).length, 3);
});

test("shared PPTX generator stores editable foreground shapes and speaker notes", async () => {
  const bytes = await createOfficeDocument({ format: "pptx", slides: [{ background: "F5F5F5", notes: "Speaker note", elements: [
    { type: "rectangle", x: 1, y: 1, width: 10, height: 3, color: "FFFFFF" },
    { type: "text", x: 1.5, y: 1.5, width: 9, height: 1, text: "原生文字 <&> 😀", fontSize: 24, bold: true },
  ] }] });
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("ppt/slides/slide1.xml").async("string");
  assert.match(xml, /原生文字 &lt;&amp;&gt; 😀/);
  assert.match(xml, /<a:t>/); assert.match(xml, /prst="rect"/);
  assert.equal((xml.match(/<p:sp>/g) ?? []).length, 2);
  assert.equal(Object.keys(zip.files).some(path => path.startsWith("ppt/media/") && !zip.files[path].dir), false);
  assert.match(await zip.file("ppt/notesSlides/notesSlide1.xml").async("string"), /Speaker note/);
});

test("invalid Office content cannot reach a writer", async () => {
  const cases = [
    { format: "docx", paragraphs: [{ text: "bad\u0000" }] },
    { format: "docx", paragraphs: [{ text: "bad\ud800" }] },
    { format: "docx", paragraphs: [{ text: "bad\ufffe" }] },
    { format: "docx", paragraphs: [{ text: "heading", heading: 7 }] },
    { format: "xlsx", sheets: [{ name: "bad/name", rows: [[1]] }] },
    { format: "xlsx", sheets: [{ name: "Data", rows: [[1]] }, { name: "data", rows: [[2]] }] },
    { format: "xlsx", sheets: [{ name: "Data", rows: [[Infinity]] }] },
    { format: "xlsx", sheets: [{ name: "Data", rows: [[{ formula: "=" }]] }] },
    { format: "pptx", slides: [{ elements: [{ type: "text", x: 12, y: 0, width: 2, height: 1, text: "clipped" }] }] },
    { format: "pptx", slides: [{ background: "invalid", elements: [] }] },
  ];
  for (const document of cases) await assert.rejects(createOfficeDocument(document));
});
