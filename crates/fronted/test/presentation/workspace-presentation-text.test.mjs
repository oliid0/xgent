import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { editPresentationInBrowser, readPresentationInBrowser } from "../helpers/document-annotation-browser.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { createOfficeDocument } = loader.loadModule("src/lib/office/createOfficeDocument.ts");
const { validPresentationText, remainingPresentationEdits } = loader.loadModule("src/components/workspace-editor/workspacePresentationText.ts");
const textElement = (text, options = {}) => ({ type: "text", x: 1, y: 1, width: 8, height: 1, text, ...options });

test("real editable PPTX text changes preserve slide order, run style and every unrelated package part", async () => {
  const original = await createOfficeDocument({ format: "pptx", slides: [
    { elements: [textElement("Old title", { bold: true, fontSize: 32, color: "123456" }), textElement("Body", { y: 3, fontSize: 18 })] },
    { elements: [textElement("Second slide")] },
  ] });
  const before = await JSZip.loadAsync(original);
  const fields = await readPresentationInBrowser(original);
  assert.deepEqual(fields.map(field => [field.slide, field.text]), [[1, "Old title"], [1, "Body"], [2, "Second slide"]]);
  const changed = await editPresentationInBrowser(original, { [fields[0].id]: "新标题 <& 😀", [fields[2].id]: "" });
  const after = await JSZip.loadAsync(changed);
  assert.deepEqual((await readPresentationInBrowser(changed)).map(field => field.text), ["新标题 <& 😀", "Body", ""]);
  assert.match(await after.file("ppt/slides/slide1.xml").async("string"), /sz="3200"/);
  assert.match(await after.file("ppt/slides/slide1.xml").async("string"), /123456/);
  for (const path of Object.keys(before.files).filter(path => !before.files[path].dir && !/^ppt\/slides\/slide[12]\.xml$/.test(path)))
    assert.deepEqual(await after.file(path).async("uint8array"), await before.file(path).async("uint8array"), path);
});

test("PPTX text edits reject retired fields, invalid XML scalars, overflow and external slide relationships", async () => {
  const bytes = await createOfficeDocument({ format: "pptx", slides: [{ elements: [textElement("Title")] }] });
  const [field] = await readPresentationInBrowser(bytes);
  for (const edits of [{ missing: "x" }, { [field.id]: "\0" }, { [field.id]: "\ud800" }, { [field.id]: "x".repeat(32768) }])
    await assert.rejects(editPresentationInBrowser(bytes, edits), /Invalid presentation|no longer available/);
  const zip = await JSZip.loadAsync(bytes);
  const rels = zip.file("ppt/_rels/presentation.xml.rels");
  zip.file(rels.name, (await rels.async("string")).replace('Target="slides/slide1.xml"', 'Target="https://example.test/slide.xml" TargetMode="External"'));
  await assert.rejects(readPresentationInBrowser(await zip.generateAsync({ type: "uint8array" })), /Invalid slide relationship/);
});

test("presentation acknowledgements retain later edits including an intentional empty title", () => {
  assert.deepEqual(remainingPresentationEdits({ a: "saved", b: "", c: "later" }, { a: "saved", b: "old" }), { b: "", c: "later" });
  assert.equal(validPresentationText("标题 😀"), true);
  assert.equal(validPresentationText("line\nline"), false);
});
