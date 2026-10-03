import assert from "node:assert/strict";
import test from "node:test";
import { read, utils, write } from "xlsx";
import { editSpreadsheetInBrowser } from "../helpers/document-annotation-browser.mjs";
import { rotateImageInBrowser } from "../helpers/document-annotation-browser.mjs";
import { imageFixture, pngPixels } from "../helpers/image-fixture.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

async function harness(image = false) {
  const hooks = createReactHookHarness(), calls = [], options = {};
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([["First"], ["Old baseline"]]), "Report");
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([["Other"]]), "Second");
  const disk = { data: Buffer.from(image ? imageFixture() : write(workbook, { type: "array", bookType: "xlsx" })).toString("base64"), contentHash: "initial", mtimeMs: 10 };
  const previous = globalThis.window;
  globalThis.window = { setTimeout, clearTimeout, atob, btoa, requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout, confirm: () => true };
  const translate = key => key;
  const saveBinary = async args => {
    disk.data = args.content_base64; disk.contentHash = "written"; disk.mtimeMs = 11;
    return { contentHash: disk.contentHash, mtimeMs: disk.mtimeMs, bytesWritten: Buffer.from(disk.data, "base64").length };
  };
  const mocks = {
    react: hooks.react,
    "../../i18n": { useLocale: () => ({ t: translate }) },
    "../../lib/shared/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
    "../../lib/system/clipboardText": { writeClipboardText: async () => true },
    "../../lib/tools/fsBackend": { invokeFs: async (command, args) => {
      calls.push([command, args]);
      if (command.startsWith("fs_read")) return { ...disk, path: args.path, mimeType: options.mimeType ?? (image ? "image/png" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), sizeBytes: Buffer.from(disk.data, "base64").length, content: null };
      return options.write ? options.write(args) : saveBinary(args);
    } },
    "./workspaceSpreadsheet": {
      ...createTsModuleLoader().loadModule("src/components/workspace-editor/workspaceSpreadsheet.ts"),
      writeSpreadsheetEdits: editSpreadsheetInBrowser,
    },
    "./workspaceImageOperations": {
      ...createTsModuleLoader().loadModule("src/components/workspace-editor/workspaceImageOperations.ts"),
      rotateWorkspaceImage: rotateImageInBrowser,
    },
    "../chat/fileTypeIcons": { getFileTypeIcon: () => "FileIcon" }, "../icons": {}, "../MacOsTitleBarSpacer": {},
    "docx-preview": {}, "./OpenWithMenu": {}, "./WorkspaceMarkdownPreview": {}, "./WorkspacePdfPreview": {}, "./WorkspacePresentationPreview": {},
  };
  for (const name of ["Banner", "Button", "EmptyState", "Icon", "IconButton", "NumberInput", "Layout", "Spinner", "Stack", "TabList", "Text", "TextArea", "Toolbar"]) {
    mocks[`@astryxdesign/core/${name}`] = Object.fromEntries([name, "HStack", "VStack", "Layout", "LayoutContent", "LayoutHeader", "LayoutFooter", "StackItem", "Tab", "TabList", "Heading", "Text"].map(exportName => [exportName, exportName]));
  }
  const loader = createTsModuleLoader({ mocks });
  const { WorkspaceFilePreviewOverlay } = loader.loadModule("src/components/workspace-editor/WorkspaceFilePreviewOverlay.tsx");
  const { previewDrafts, previewPendingWrites, previewDraftKey } = loader.loadModule("src/components/workspace-editor/previewDrafts.ts");
  const props = { isOpen: true, openRequest: { id: 1, projectPathKey: "/project", ownerId: "owner", workdir: "/project", path: image ? "a.png" : "a.xlsx", ...(image ? { imagePaths: ["a.png", "b.png"] } : {}) }, presentation: "side", width: 500, onClose() {} };
  const render = () => hooks.render(() => WorkspaceFilePreviewOverlay(props));
  const elements = element => {
    if (!element || typeof element !== "object") return [];
    if (Array.isArray(element)) return element.flatMap(elements);
    return [element, ...Object.values(element.props ?? {}).flatMap(value => typeof value === "function" ? [] : elements(value))];
  };
  const find = predicate => elements(render()).find(predicate);
  const controls = () => ({
    grid: find(element => typeof element.props?.onSpreadsheetCellChange === "function"),
    save: find(element => element.type === "IconButton" && element.props.label === "workspaceEditor.save"),
  });
  const flush = async () => { await new Promise(resolve => setTimeout(resolve, 20)); return render(); };
  async function waitFor(predicate) {
    for (let index = 0; index < 1500; index++) { await flush(); if (predicate()) return; }
    throw new Error(`Workspace preview did not reach the expected async state: ${find(element => element.type === "Banner")?.props.description ?? "no error banner"}`);
  }
  const unmount = () => { hooks.unmount(); if (previous === undefined) delete globalThis.window; else globalThis.window = previous; };
  render(); await waitFor(() => !!controls().grid);
  return { props, options, disk, calls, render, controls, flush, waitFor, find, saveBinary, previewDrafts, previewPendingWrites, previewDraftKey, unmount };
}

test("shared XLSX save reads immediate cell edits and rejects duplicate clicks", async () => {
  const h = await harness();
  try {
    const old = h.controls();
    old.grid.props.onSpreadsheetCellChange("Report", 0, 0, "Current 😀");
    old.save.props.onClick(); old.save.props.onClick();
    await h.waitFor(() => h.calls.some(([command]) => command === "fs_write_binary") && !h.previewPendingWrites.size);
    assert.equal(h.calls.filter(([command]) => command === "fs_write_binary").length, 1);
    assert.equal(read(Buffer.from(h.disk.data, "base64"), { type: "buffer" }).Sheets.Report.A1.v, "Current 😀");
    assert.deepEqual(h.controls().grid.props.spreadsheetEdits, {});
    assert.equal(h.calls.filter(([command]) => command.startsWith("fs_read")).length, 1);
  } finally { h.unmount(); }
});

test("shared XLSX acknowledgements keep later cells, worksheet selection and a return to the old baseline", async () => {
  const h = await harness(), wait = Promise.withResolvers();
  try {
    h.options.write = async args => { await wait.promise; return h.saveBinary(args); };
    h.controls().grid.props.onSpreadsheetCellChange("Report", 1, 0, "Sent"); h.controls().save.props.onClick();
    await h.waitFor(() => h.calls.some(([command]) => command === "fs_write_binary"));
    const old = h.controls().grid;
    old.props.onSpreadsheetCellChange("Report", 1, 0, "Old baseline");
    old.props.onActiveSheetNameChange("Second");
    old.props.onSpreadsheetCellChange("Report", 0, 0, "Retired sheet");
    const second = h.controls().grid;
    second.props.onSpreadsheetCellChange("Second", 0, 0, "Later sheet");
    wait.resolve(); await h.waitFor(() => !h.previewPendingWrites.size);
    assert.equal(h.controls().grid.props.spreadsheet.activeSheetName, "Second");
    assert.deepEqual(h.controls().grid.props.spreadsheetEdits, { Report: { "1:0": "Old baseline" }, Second: { "0:0": "Later sheet" } });
    h.options.write = undefined; h.controls().save.props.onClick(); await h.waitFor(() => !h.previewPendingWrites.size);
    const saved = read(Buffer.from(h.disk.data, "base64"), { type: "buffer" });
    assert.equal(saved.Sheets.Report.A1.v, "First"); assert.equal(saved.Sheets.Report.A2.v, "Old baseline");
    assert.equal(saved.Sheets.Second.A1.v, "Later sheet");
    assert.equal(h.calls.at(-1)[1].expected_content_hash, "written");
  } finally { wait.resolve(); h.unmount(); }
});

test("shared XLSX callbacks retire on file switches and reopen waits for the written version", async () => {
  const h = await harness(), wait = Promise.withResolvers();
  try {
    h.options.write = async args => { await wait.promise; return h.saveBinary(args); };
    h.controls().grid.props.onSpreadsheetCellChange("Report", 0, 0, "Written"); h.controls().save.props.onClick();
    await h.waitFor(() => h.calls.some(([command]) => command === "fs_write_binary"));
    const old = h.controls(); old.grid.props.onSpreadsheetCellChange("Report", 0, 0, "Later draft");
    const first = h.props.openRequest;
    h.props.openRequest = { ...first, id: 2, path: "b.xlsx" }; h.render(); await h.flush();
    old.grid.props.onSpreadsheetCellChange("Report", 0, 0, "Retired"); old.save.props.onClick();
    assert.deepEqual(h.controls().grid.props.spreadsheetEdits, {});
    h.props.openRequest = { ...first, id: 3 }; h.render(); await h.flush();
    assert.equal(h.calls.filter(([command, args]) => command.startsWith("fs_read") && args.path === "a.xlsx").length, 1);
    wait.resolve(); await h.waitFor(() => !!h.controls().grid && !h.previewPendingWrites.size);
    assert.equal(h.controls().grid.props.spreadsheetEdits.Report["0:0"], "Later draft");
    h.options.write = undefined; h.controls().save.props.onClick(); await h.waitFor(() => !h.previewPendingWrites.size);
    assert.equal(h.calls.at(-1)[1].expected_content_hash, "written");
    assert.equal(read(Buffer.from(h.disk.data, "base64"), { type: "buffer" }).Sheets.Report.A1.v, "Later draft");
  } finally { wait.resolve(); h.unmount(); }
});

test("shared XLSX conflicts retain cells and closed previews ignore late write errors", async () => {
  const h = await harness();
  try {
    h.options.write = async () => { throw new Error("Write conflict"); };
    h.controls().grid.props.onSpreadsheetCellChange("Report", 0, 0, "Retained"); h.controls().save.props.onClick();
    await h.waitFor(() => !h.previewPendingWrites.size);
    assert.equal(h.controls().grid.props.spreadsheetEdits.Report["0:0"], "Retained");
    assert.ok(h.find(element => element.type === "Banner" && element.props.description === "Write conflict"));
    const wait = Promise.withResolvers(); h.options.write = () => wait.promise;
    h.controls().save.props.onClick(); await h.waitFor(() => h.calls.filter(([command]) => command === "fs_write_binary").length === 2);
    h.props.isOpen = false; h.render(); wait.reject(new Error("Retired error"));
    await h.waitFor(() => !h.previewPendingWrites.size);
    assert.equal(h.find(element => element.type === "Banner" && element.props.description === "Retired error"), undefined);
  } finally { h.unmount(); }
});

test("shared image saving reads rapid rotations before a render and prevents duplicate raster writes", async () => {
  const h = await harness(true);
  try {
    const old = h.controls().grid.props;
    old.onRotateImage(); old.onRotateImage();
    const saving = old.onSaveImageRotation();
    assert.equal(await old.onSaveImageRotation(), false);
    await saving; h.render();
    assert.deepEqual(pngPixels(Buffer.from(h.disk.data, "base64")).pixels, pngPixels(imageFixture()).pixels.toReversed());
    assert.deepEqual(h.controls().grid.props.imageRotation, { angle: 180, saved: 180, editable: true });
    assert.equal(h.calls.filter(([command]) => command === "fs_write_binary").length, 1);
    assert.equal(h.calls.filter(([command]) => command.startsWith("fs_read")).length, 1);
  } finally { h.unmount(); }
});

test("shared image saving retains later rotations including returning to the old orientation", async () => {
  const h = await harness(true), wait = Promise.withResolvers();
  let saving;
  try {
    h.options.write = async args => { await wait.promise; return h.saveBinary(args); };
    h.controls().grid.props.onRotateImage();
    saving = h.controls().grid.props.onSaveImageRotation();
    await h.waitFor(() => h.calls.some(([command]) => command === "fs_write_binary") || !h.previewPendingWrites.size);
    assert.ok(h.calls.some(([command]) => command === "fs_write_binary"), h.find(element => element.type === "Banner")?.props.description);
    const props = h.controls().grid.props; props.onRotateImage(); props.onRotateImage(); props.onRotateImage();
    wait.resolve(); await saving; h.render();
    assert.deepEqual(h.controls().grid.props.imageRotation, { angle: 0, saved: 90, editable: true });
    h.options.write = undefined; assert.equal(await h.controls().grid.props.onSaveImageRotation(), true,
      h.find(element => element.type === "Banner")?.props.description); h.render();
    assert.deepEqual(pngPixels(Buffer.from(h.disk.data, "base64")).pixels, pngPixels(imageFixture()).pixels);
    assert.equal(h.calls.at(-1)[1].expected_content_hash, "written");
  } finally { wait.resolve(); await saving; h.unmount(); }
});

test("shared image saves retire callbacks, retain drafts and wait for background writes when reopening", async () => {
  const h = await harness(true), wait = Promise.withResolvers();
  let saving;
  try {
    h.options.write = async args => { await wait.promise; return h.saveBinary(args); };
    h.controls().grid.props.onRotateImage(); saving = h.controls().grid.props.onSaveImageRotation();
    await h.waitFor(() => h.calls.some(([command]) => command === "fs_write_binary") || !h.previewPendingWrites.size);
    assert.ok(h.calls.some(([command]) => command === "fs_write_binary"), h.find(element => element.type === "Banner")?.props.description);
    const old = h.controls().grid.props; old.onRotateImage();
    const first = h.props.openRequest; h.props.openRequest = { ...first, id: 2, path: "b.png" }; h.render(); await h.flush();
    old.onRotateImage(); assert.equal(await old.onSaveImageRotation(), false);
    assert.equal(h.controls().grid.props.imageRotation.angle, 0);
    h.props.openRequest = { ...first, id: 3 }; h.render(); await h.flush();
    assert.equal(h.calls.filter(([command, args]) => command.startsWith("fs_read") && args.path === "a.png").length, 1);
    wait.resolve(); await saving; await h.waitFor(() => !!h.controls().grid && !h.previewPendingWrites.size);
    assert.deepEqual(h.controls().grid.props.imageRotation, { angle: 180, saved: 90, editable: true });
    h.options.write = undefined;
    assert.equal(await h.controls().grid.props.onSaveImageRotation(), true, h.find(element => element.type === "Banner")?.props.description);
    h.render();
    assert.deepEqual(pngPixels(Buffer.from(h.disk.data, "base64")).pixels, pngPixels(imageFixture()).pixels.toReversed());
    assert.equal(h.calls.at(-1)[1].expected_content_hash, "written");
  } finally { wait.resolve(); await saving; h.unmount(); }
});

test("shared image conflicts keep rotation drafts and readonly MIME mismatches have no write path", async () => {
  const h = await harness(true);
  try {
    h.options.write = async () => { throw new Error("Image conflict"); };
    h.controls().grid.props.onRotateImage(); await h.controls().grid.props.onSaveImageRotation(); h.render();
    assert.equal(h.controls().grid.props.imageRotation.angle, 90);
    const banner = h.find(element => element.type === "Banner");
    assert.ok(String(banner?.props.description).includes("Image conflict"), `Expected the actual write conflict, received: ${banner?.props.description ?? "no banner"}`);
    h.options.mimeType = "image/gif"; h.props.openRequest = { ...h.props.openRequest, id: 2, path: "b.png" };
    h.render(); await h.flush();
    h.controls().grid.props.onRotateImage();
    assert.equal(await h.controls().grid.props.onSaveImageRotation(), false);
    assert.equal(h.calls.filter(([command]) => command === "fs_write_binary").length, 1);
  } finally { h.unmount(); }
});

test("shared image navigation supports cancel, save before switching and discard with retired confirmation guards", async () => {
  const h = await harness(true);
  try {
    const confirmation = label => h.find(element => element.type === "Button" && element.props.label === label);
    h.controls().grid.props.onRotateImage(); h.controls().grid.props.onOpenImagePath("b.png", 1);
    assert.ok(confirmation("workspaceEditor.cancel"));
    confirmation("workspaceEditor.cancel").props.onClick();
    assert.equal(h.controls().grid.props.activePath, "a.png");
    assert.equal(h.controls().grid.props.imageRotation.angle, 90);
    h.controls().grid.props.onOpenImagePath("b.png", 1);
    const oldDiscard = confirmation("workspaceEditor.discard");
    confirmation("workspaceEditor.save").props.onClick();
    await h.waitFor(() => h.controls().grid?.props.activePath === "b.png" && !h.controls().grid.props.isSwitchingImage);
    assert.equal(pngPixels(Buffer.from(h.disk.data, "base64")).width, 3);
    oldDiscard.props.onClick(); h.render();
    assert.equal(h.controls().grid.props.activePath, "b.png");
    h.controls().grid.props.onRotateImage(); h.controls().grid.props.onOpenImagePath("a.png", -1);
    confirmation("workspaceEditor.discard").props.onClick();
    await h.waitFor(() => h.controls().grid?.props.activePath === "a.png" && !h.controls().grid.props.isSwitchingImage);
    assert.equal(h.controls().grid.props.imageRotation.angle, 0);
    assert.equal(h.calls.filter(([command]) => command === "fs_write_binary").length, 1);
  } finally { h.unmount(); }
});
