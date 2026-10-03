import assert from "node:assert/strict";
import test from "node:test";
import { read, utils, write } from "xlsx";
import JSZip from "jszip";
import { editSpreadsheetInBrowser } from "../helpers/document-annotation-browser.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const { buildSpreadsheetTable, boundedSpreadsheetText, parseSpreadsheetCellEdit, remainingSpreadsheetEdits, previewBytes, previewBytesBase64 } =
  createTsModuleLoader().loadModule("src/components/workspace-editor/workspaceSpreadsheet.ts");
const writeSpreadsheetEdits = editSpreadsheetInBrowser;

function workbookBytes() {
  const workbook = utils.book_new();
  const sheet = utils.aoa_to_sheet([["Name", "Total", "Formula"], ["First", 12.5, 25]]);
  sheet.B2.z = "0.00";
  sheet.C2.f = "B2*2";
  utils.book_append_sheet(workbook, sheet, "Report");
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([["Other"]]), "Second");
  return new Uint8Array(write(workbook, { type: "array", bookType: "xlsx" }));
}

test("shared spreadsheet parser keeps formatted values, empty coordinates and sheet selection", () => {
  const bytes = workbookBytes();
  const first = buildSpreadsheetTable({ kind: "spreadsheet", bytes }, "missing", "Failed");
  assert.deepEqual(first.sheetNames, ["Report", "Second"]);
  assert.equal(first.activeSheetName, "Report");
  assert.equal(first.rows[1].cells[1].value, "12.50");
  assert.equal(buildSpreadsheetTable({ kind: "spreadsheet", bytes }, "Second", "Failed").rows[0].cells[0].value, "Other");
  assert.equal(buildSpreadsheetTable({ kind: "pdf", bytes }, "", "Failed"), null);
});

test("shared spreadsheet write updates selected cells and preserves unrelated formulas and sheets", async () => {
  const output = await writeSpreadsheetEdits(workbookBytes(), { Report: { "1:0": "Edited", "0:1": "" }, Second: { "0:0": "Updated" } });
  const workbook = read(output, { type: "array", cellNF: true });
  assert.equal(workbook.Sheets.Report.A2.v, "Edited");
  assert.equal(workbook.Sheets.Report.B1.v, "");
  assert.equal(workbook.Sheets.Report.C2.f, "B2*2");
  assert.equal(workbook.Sheets.Report.B2.z, "0.00");
  assert.equal(workbook.Sheets.Report.B2.w, "12.50");
  assert.equal(workbook.Sheets.Second.A1.v, "Updated");
  assert.deepEqual(Buffer.from(previewBytes(previewBytesBase64(output))), Buffer.from(output));
  assert.deepEqual(Buffer.from(previewBytes(`data:application/octet-stream;base64,${previewBytesBase64(output)}`)), Buffer.from(output));
});

test("shared spreadsheet limits retain first 250 rows and 80 columns without dropping them during write", async () => {
  const workbook = utils.book_new();
  const sheet = { A1: { t: "s", v: "First" }, CE251: { t: "s", v: "Beyond viewport" }, "!ref": "A1:CE251" };
  utils.book_append_sheet(workbook, sheet, "Large");
  const bytes = new Uint8Array(write(workbook, { type: "array", bookType: "xlsx" }));
  const table = buildSpreadsheetTable({ kind: "spreadsheet", bytes }, "", "Failed");
  assert.equal(table.rows.length, 250); assert.equal(table.rows[0].cells.length, 80);
  assert.equal(table.truncatedRows, true); assert.equal(table.truncatedColumns, true);
  const saved = read(await writeSpreadsheetEdits(bytes, { Large: { "249:79": "Last visible" } }), { type: "array" });
  assert.equal(saved.Sheets.Large.CB250.v, "Last visible");
  assert.equal(saved.Sheets.Large.CE251.v, "Beyond viewport");
});

test("spreadsheet writes and native patches reject invalid coordinates, values and unknown sheets", async () => {
  for (const changes of [{ Missing: { "0:0": "Text" } }, { Report: { "250:0": "Text" } }, { Report: { "0:80": "Text" } }, { Report: { "-1:0": "Text" } }, { Report: { "0:0": null } }]) {
    await assert.rejects(() => writeSpreadsheetEdits(workbookBytes(), changes));
  }
  for (const value of [null, "{", JSON.stringify({ sheet: "Report", row: 0.5, column: 0, value: "Text" }), JSON.stringify({ sheet: "Report", row: -1, column: 0, value: "Text" }), JSON.stringify({ sheet: "Report", row: 0, column: 80, value: "Text" }), JSON.stringify({ sheet: "Report", row: 0, column: 0, value: null })]) {
    assert.equal(parseSpreadsheetCellEdit(value), null);
  }
  assert.equal(parseSpreadsheetCellEdit(JSON.stringify({ sheet: "Report", row: 249, column: 79, value: "" })).value, "");
});

test("acknowledged spreadsheet changes subtract only matching values across worksheets", () => {
  const remaining = remainingSpreadsheetEdits({ Report: { "0:0": "Written", "1:0": "Old baseline" }, Second: { "0:0": "Later" } }, { Report: { "0:0": "Written", "1:0": "Sent" } });
  assert.deepEqual(remaining, { Report: { "1:0": "Old baseline" }, Second: { "0:0": "Later" } });
});

test("spreadsheet cell text follows Excel UTF16 limits without splitting emoji", () => {
  const prefix = "a".repeat(32766);
  assert.equal(boundedSpreadsheetText(prefix + "😀"), prefix);
  assert.equal(boundedSpreadsheetText(prefix + "b😀"), prefix + "b");
  assert.equal(parseSpreadsheetCellEdit(JSON.stringify({ sheet: "Report", row: 0, column: 0, value: prefix + "😀" })), null);
});

test("XLSX edits retain original charts, media, styles, relationships and untouched worksheet bytes", async () => {
  const zip = await JSZip.loadAsync(workbookBytes());
  const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
  const officeRel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  zip.file("xl/media/image1.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6fKAAAAAASUVORK5CYII=", "base64"));
  zip.file("xl/charts/chart1.xml", '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:layout/></c:plotArea></c:chart></c:chartSpace>');
  zip.file("xl/drawings/drawing1.xml", '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"/>');
  zip.file("xl/worksheets/_rels/sheet1.xml.rels", `<Relationships xmlns="${rel}"><Relationship Id="drawing" Type="${officeRel}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
  zip.file("xl/drawings/_rels/drawing1.xml.rels", `<Relationships xmlns="${rel}"><Relationship Id="chart" Type="${officeRel}/chart" Target="../charts/chart1.xml"/><Relationship Id="image" Type="${officeRel}/image" Target="../media/image1.png"/></Relationships>`);
  zip.file("xl/calcChain.xml", `<calcChain xmlns="${ns}"><c r="C2" i="1"/></calcChain>`);
  const originalRel = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  zip.file("xl/_rels/workbook.xml.rels", originalRel.replace("</Relationships>", `<Relationship Id="calculation" Type="${officeRel}/calcChain" Target="calcChain.xml"/></Relationships>`));
  const types = await zip.file("[Content_Types].xml").async("string");
  zip.file("[Content_Types].xml", types.replace("</Types>", '<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/></Types>'));
  const sheet = await zip.file("xl/worksheets/sheet1.xml").async("string");
  zip.file("xl/worksheets/sheet1.xml", sheet.replace("</worksheet>", '<drawing r:id="drawing"/></worksheet>'));
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const output = await writeSpreadsheetEdits(bytes, { Report: { "1:1": "  literal _x0041_ 中文 😀\r\n\u0001 <xml>  ", "1:0": "=SUM(B2)" } });
  const saved = await JSZip.loadAsync(output);
  const changed = new Set(["xl/worksheets/sheet1.xml", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "[Content_Types].xml", "xl/calcChain.xml"]);
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || changed.has(name)) continue;
    assert.deepEqual(await saved.file(name).async("uint8array"), await entry.async("uint8array"), name);
  }
  assert.equal(saved.file("xl/calcChain.xml"), null);
  assert.doesNotMatch(await saved.file("xl/_rels/workbook.xml.rels").async("string"), /calcChain/);
  assert.doesNotMatch(await saved.file("[Content_Types].xml").async("string"), /calcChain/);
  assert.match(await saved.file("xl/workbook.xml").async("string"), /fullCalcOnLoad="1"/);
  const cells = read(output, { type: "array", cellNF: true }).Sheets.Report;
  assert.equal(cells.B2.v, "  literal _x0041_ 中文 😀\r\n\u0001 <xml>  ");
  assert.equal(cells.B2.z, "0.00");
  assert.equal(cells.A2.v, "=SUM(B2)"); assert.equal(cells.A2.f, undefined);
  assert.equal(cells.C2.f, "B2*2");
});

test("XLSX insertion expands the used range and preserves a blank workbook on empty edits", async () => {
  const bytes = workbookBytes();
  const unchanged = await writeSpreadsheetEdits(bytes, {});
  assert.deepEqual(unchanged, bytes);
  const result = read(await writeSpreadsheetEdits(bytes, { Second: { "2:2": "C3", "1:1": "B2", "1:0": "A2" } }), { type: "array" });
  assert.equal(result.Sheets.Second["!ref"], "A1:C3");
  assert.equal(result.Sheets.Second.C3.v, "C3"); assert.equal(result.Sheets.Second.B2.v, "B2");
});

test("XLSX writer rejects external sheet parts and grouped formulas without returning a damaged package", async () => {
  const zip = await JSZip.loadAsync(workbookBytes());
  const rels = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  zip.file("xl/_rels/workbook.xml.rels", rels.replace('Target="worksheets/sheet1.xml"', 'Target="https://external.invalid/sheet.xml" TargetMode="External"'));
  const externalBytes = await zip.generateAsync({ type: "uint8array" });
  await assert.rejects(() => writeSpreadsheetEdits(externalBytes, { Report: { "0:0": "Text" } }), /External/);
  // Use real XML formula groups, including a member which has no formula element of its own.
  const grouped = await JSZip.loadAsync(workbookBytes());
  const source = await grouped.file("xl/worksheets/sheet1.xml").async("string");
  grouped.file("xl/worksheets/sheet1.xml", source.replace("<f>B2*2</f>", '<f t="array" ref="C2:D2">B2*2</f>'));
  const bytes = await grouped.generateAsync({ type: "uint8array" });
  await assert.rejects(() => writeSpreadsheetEdits(bytes, { Report: { "1:2": "Replacement" } }), /array formula/);
  await assert.rejects(() => writeSpreadsheetEdits(bytes, { Report: { "1:3": "Replacement" } }), /array formula/);
});

test("XLSX writer resolves prefixed relationships and escaped internal names while retaining ranges without dimension metadata", async () => {
  const zip = await JSZip.loadAsync(workbookBytes());
  const source = await zip.file("xl/worksheets/sheet1.xml").async("string");
  zip.file("xl/worksheets/report data.xml", source.replace(/<dimension[^>]*\/>/, ""));
  zip.remove("xl/worksheets/sheet1.xml");
  const rels = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  zip.file("xl/_rels/workbook.xml.rels", rels
    .replace('Target="worksheets/sheet1.xml"', 'Target="worksheets/report%20data.xml"')
    .replace('<Relationships xmlns=', '<pkg:Relationships xmlns:pkg=')
    .replaceAll('<Relationship ', '<pkg:Relationship ').replace('</Relationships>', '</pkg:Relationships>'));
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const output = await writeSpreadsheetEdits(bytes, { Report: { "0:0": "Edited" } });
  const saved = await JSZip.loadAsync(output);
  const sheet = await saved.file("xl/worksheets/report data.xml").async("string");
  assert.match(sheet, /dimension[^>]*ref="A1:C2"/);
  assert.match(sheet, /<f>B2\*2<\/f>/);
  assert.match(sheet, /Edited/);
  assert.deepEqual(await saved.file("xl/worksheets/sheet2.xml").async("uint8array"), await zip.file("xl/worksheets/sheet2.xml").async("uint8array"));
});

test("XLSX inserted cells precede row extension metadata and retain existing row features", async () => {
  const zip = await JSZip.loadAsync(workbookBytes());
  const source = await zip.file("xl/worksheets/sheet2.xml").async("string");
  zip.file("xl/worksheets/sheet2.xml", source.replace("</row>", '<extLst><ext uri="retained-row-feature"/></extLst></row>'));
  const output = await writeSpreadsheetEdits(await zip.generateAsync({ type: "uint8array" }), { Second: { "0:1": "Inserted B1" } });
  const saved = await JSZip.loadAsync(output);
  const xml = await saved.file("xl/worksheets/sheet2.xml").async("string");
  assert.match(xml, /r="B1"[^]*Inserted B1[^]*<extLst>/);
  assert.match(xml, /retained-row-feature/);
  assert.equal(read(output, { type: "array" }).Sheets.Second.B1.v, "Inserted B1");
});
