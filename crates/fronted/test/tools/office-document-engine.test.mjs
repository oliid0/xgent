import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { read, utils } from "xlsx";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const { createOfficeDocument } = createTsModuleLoader().loadModule("src/lib/office/createOfficeDocument.ts");
const png = readFileSync(new URL("../../src-tauri/icons/StoreLogo.png", import.meta.url));

test("actual PNG assets are embedded into DOCX and PPTX packages with real relationships and alt text", async () => {
  const reads=[],readImage=async path=>{reads.push(path);return {data:png.toString("base64"),mimeType:"image/png"};};
  const word=await createOfficeDocument({format:"docx",paragraphs:[{text:"实施方案",heading:1},{text:"产品图说明",image:{path:"assets/产品.png",width:320,height:200,altText:"产品示意图 <&>"}}]},{readImage});
  let zip=await JSZip.loadAsync(word),media=Object.keys(zip.files).filter(path=>path.startsWith("word/media/")&&!zip.files[path].dir);
  assert.equal(media.length,1);assert.deepEqual(Buffer.from(await zip.file(media[0]).async("uint8array")),png);
  const body=await zip.file("word/document.xml").async("string");assert.match(body,/<w:drawing>/);assert.match(body,/产品示意图 &lt;&amp;&gt;/);assert.match(body,/产品图说明/);
  const relations=await zip.file("word/_rels/document.xml.rels").async("string");assert.ok(relations.includes("/image"));assert.ok(!relations.includes("assets/产品.png"));
  reads.length=0;
  const slides=await createOfficeDocument({format:"pptx",slides:[{elements:[{type:"text",x:1,y:0.5,width:10,height:1,text:"产品汇报"},{type:"image",path:"assets/产品.png",x:1,y:2,width:4,height:3,altText:"产品图"}]},{elements:[{type:"image",path:"assets/产品.png",x:2,y:1,width:4,height:3}]}]},{readImage});
  zip=await JSZip.loadAsync(slides);media=Object.keys(zip.files).filter(path=>path.startsWith("ppt/media/")&&!zip.files[path].dir);assert.ok(media.length>0);
  for(const path of media)assert.deepEqual(Buffer.from(await zip.file(path).async("uint8array")),png);
  assert.match(await zip.file("ppt/slides/slide1.xml").async("string"),/<p:pic>/);assert.match(await zip.file("ppt/slides/slide1.xml").async("string"),/产品图/);
  assert.deepEqual(reads,["assets/产品.png"]);assert.ok(!(await zip.file("ppt/slides/_rels/slide1.xml.rels").async("string")).includes("TargetMode=\"External\""));
});

test("missing reader, remote paths, MIME mismatch, malformed data and excess image placements fail before an Office result exists",async()=>{
  const spec=path=>({format:"pptx",slides:[{elements:[{type:"image",path,x:1,y:1,width:4,height:3}]}]});
  await assert.rejects(createOfficeDocument(spec("assets/product.png")),/scoped file reader/);
  for(const path of ["https://example.test/product.png","data:image/png;base64,AAAA","file:///private/image.png",""])await assert.rejects(createOfficeDocument(spec(path),{readImage:async()=>{throw new Error("must not read URL");}}),/workspace path/);
  for(const source of [{data:png.toString("base64"),mimeType:"image/jpeg"},{data:"not-base64",mimeType:"image/png"},{data:Buffer.from("not PNG bytes").toString("base64"),mimeType:"image/png"}])await assert.rejects(createOfficeDocument(spec("assets/product.png"),{readImage:async()=>source}));
  const many=spec("assets/product.png");many.slides[0].elements=Array.from({length:17},()=>many.slides[0].elements[0]);await assert.rejects(createOfficeDocument(many,{readImage:async()=>({data:png.toString("base64"),mimeType:"image/png"})}),/16 image placements/);
  await assert.rejects(createOfficeDocument({format:"docx",paragraphs:[{text:"caption",image:{path:"asset.png",width:601,height:100}}]},{readImage:async()=>{throw new Error("must not read out-of-page image");}}),/content area/);
});

test("large base64 snapshots reach the combined byte budget without regexp stack overflow or rereading a repeated asset",async()=>{
  const bytes=Buffer.alloc(5*1024*1024);png.copy(bytes);let reads=0;
  const element={type:"image",path:"assets/large.png",x:1,y:1,width:4,height:3};
  await assert.rejects(createOfficeDocument({format:"pptx",slides:[{elements:[element,element]}]},
    {readImage:async()=>{reads++;return {data:bytes.toString("base64"),mimeType:"image/png"};}}),/combined 8 MiB byte budget/);
  assert.equal(reads,1);
});

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
