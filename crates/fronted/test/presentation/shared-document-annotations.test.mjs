import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

async function harness(initial = {}) {
  const hooks = createReactHookHarness(), calls = [];
  const pdf = await PDFDocument.create(); pdf.addPage([400, 500]); pdf.addPage([600, 700]);
  const disk = { data: Buffer.from(await pdf.save()).toString("base64"), contentHash: "initial", mtimeMs: 10 };
  const previous = globalThis.window;
  globalThis.window = { setTimeout, clearTimeout, atob, btoa, requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout, confirm: () => true };
  const options = { ...initial };
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
      if (command.startsWith("fs_read")) return { ...disk, path: args.path, mimeType: "application/pdf", sizeBytes: 500, content: null };
      return options.write ? options.write(args) : saveBinary(args);
    } },
    "../chat/fileTypeIcons": { getFileTypeIcon: () => "FileIcon" }, "../icons": {}, "../MacOsTitleBarSpacer": {},
    "docx-preview": {}, "./OpenWithMenu": {}, "./WorkspaceMarkdownPreview": {}, "./WorkspacePdfPreview": {}, "./WorkspacePresentationPreview": {},
  };
  for (const name of ["Banner", "Button", "EmptyState", "Icon", "IconButton", "NumberInput", "Layout", "Spinner", "Stack", "TabList", "Text", "TextArea", "Toolbar"]) {
    mocks[`@astryxdesign/core/${name}`] = Object.fromEntries([name, "HStack", "VStack", "Layout", "LayoutContent", "LayoutHeader", "LayoutFooter", "StackItem", "Tab", "TabList", "Heading", "Text"].map(exportName => [exportName, exportName]));
  }
  const loader = createTsModuleLoader({ mocks });
  const { WorkspaceFilePreviewOverlay } = loader.loadModule("src/components/workspace-editor/WorkspaceFilePreviewOverlay.tsx");
  const { previewDrafts, previewPendingWrites, previewDraftKey } = loader.loadModule("src/components/workspace-editor/previewDrafts.ts");
  const props = { isOpen: true, openRequest: { id: 1, projectPathKey: "/project", ownerId: "owner", workdir: "/project", path: initial.path ?? "a.pdf" }, presentation: "side", width: 500, onClose() {} };
  const render = () => hooks.render(() => WorkspaceFilePreviewOverlay(props));
  const elements = element => {
    if (!element || typeof element !== "object") return [];
    if (Array.isArray(element)) return element.flatMap(elements);
    return [element, ...Object.values(element.props ?? {}).flatMap(value => typeof value === "function" ? [] : elements(value))];
  };
  const find = predicate => elements(render()).find(predicate);
  const controls = () => ({
    text: find(element => element.type === "TextArea" && element.props.label === "workspaceFilePreview.annotations"),
    page: find(element => element.type === "NumberInput"),
    save: find(element => element.type === "IconButton" && element.props.label === "workspaceEditor.save"),
    tabs: find(element => element.type === "TabList"),
  });
  const flush = async () => { await new Promise(setImmediate); return render(); };
  async function waitFor(predicate) {
    for (let index = 0; index < 50; index++) { await flush(); if (predicate()) return; }
    throw new Error("Preview did not reach the expected async state");
  }
  const unmount = () => { hooks.unmount(); if (previous === undefined) delete globalThis.window; else globalThis.window = previous; };
  render(); await waitFor(() => !!find(element => element.props?.preview?.kind === "pdf"));
  return { props, options, disk, calls, render, controls, flush, waitFor, find, saveBinary, previewDrafts, previewPendingWrites, previewDraftKey, unmount };
}

test("shared PDF preview preserves file bytes and omits the standalone annotation editor", async () => {
  const h = await harness();
  try {
    const original = h.disk.data;
    assert.equal(h.controls().text, undefined);
    assert.equal(h.controls().page, undefined);
    assert.equal(h.controls().save.props.isDisabled, true);
    assert.equal(h.controls().tabs, undefined);
    assert.equal(h.disk.data, original);
    assert.equal(h.calls.some(([command]) => command === "fs_write_binary"), false);
  } finally { h.unmount(); }
});

const highlight = (id = "first") => ({ id, color: "green", pageIndex: 1, rects: [[20, 30, 100, 18]] });
const body = h => h.find(element => element.props?.preview?.kind === "pdf");

test("shared inline PDF highlights save guarded original bytes and restore a retained dirty draft", async () => {
  const h = await harness();
  try {
    const original = h.disk.data;
    body(h).props.onPdfHighlightsChange([highlight()]); h.render();
    assert.equal(h.previewDrafts.get(h.previewDraftKey(h.props.openRequest)).highlights.length, 1);
    assert.equal(h.controls().save.props.isDisabled, false);
    await h.controls().save.props.onClick(); await h.flush();
    const call = h.calls.find(([command]) => command === "fs_write_binary");
    assert.equal(call[1].expected_content_hash, "initial");
    assert.equal(call[1].expected_mtime_ms, 10);
    assert.equal(call[1].path, "a.pdf");
    assert.notEqual(h.disk.data, original);
    assert.equal((await PDFDocument.load(Buffer.from(h.disk.data, "base64"))).getPage(1).node.Annots().size(), 1);
    assert.equal(body(h).props.pdfHighlights.length, 0);
    body(h).props.onPdfHighlightsChange([highlight("later")]); h.render();
    h.props.openRequest = { ...h.props.openRequest, id: 2, path: "other.pdf" }; h.render();
    await h.waitFor(() => body(h)?.props.preview.path === "other.pdf");
    h.props.openRequest = { ...h.props.openRequest, id: 3, path: "a.pdf" }; h.render();
    await h.waitFor(() => body(h)?.props.preview.path === "a.pdf");
    assert.equal(body(h).props.pdfHighlights[0].id, "later");
    body(h).props.onPdfHighlightsChange([]); h.render();
    assert.equal(h.controls().save.props.isDisabled, true);
  } finally { h.unmount(); }
});

test("shared PDF conflict retains highlights; retired file callbacks cannot mutate the new file", async () => {
  const h = await harness();
  try {
    const original = h.disk.data;
    const oldBody = body(h);
    oldBody.props.onPdfHighlightsChange([highlight()]); h.render();
    h.options.write = async () => { throw new Error("stale_file: changed externally"); };
    h.controls().save.props.onClick();
    await h.waitFor(() => h.find(element => element.props?.description?.includes?.("stale_file")) || h.find(element => element.props?.children?.includes?.("stale_file")) || !h.controls().save.props.isLoading);
    assert.equal(h.disk.data, original);
    assert.equal(body(h).props.pdfHighlights.length, 1);
    h.props.openRequest = { ...h.props.openRequest, id: 2, path: "other.pdf" }; h.render();
    await h.waitFor(() => body(h)?.props.preview.path === "other.pdf");
    oldBody.props.onPdfHighlightsChange([highlight("stale")]); h.render();
    assert.equal(body(h).props.pdfHighlights.length, 0);
  } finally { h.unmount(); }
});

test("converted Office PDF previews stay read-only and never overwrite their Office source", async () => {
  const h = await harness({ path: "converted.docx" });
  try {
    assert.equal(body(h).props.pdfEditable, false);
    assert.equal(h.controls().save, undefined);
    body(h).props.onPdfHighlightsChange([highlight()]); h.render();
    assert.equal(body(h).props.pdfHighlights.length, 0);
    assert.equal(h.calls.some(([command]) => command === "fs_write_binary"), false);
  } finally { h.unmount(); }
});

test("shared PDF caches selection before a file switch and keeps the toolbar stable during a background write", async () => {
  const h = await harness();
  try {
    const originalRequest = h.props.openRequest;
    body(h).props.onPdfHighlightsChange([highlight()]);
    // Switch before the editing render's effects have run.
    assert.equal(h.previewDrafts.get(h.previewDraftKey(originalRequest)).highlights.length, 1);
    h.props.openRequest = { ...originalRequest, path: "other.pdf", id: 2 }; h.render();
    await h.waitFor(() => body(h)?.props.preview.path === "other.pdf");
    h.props.openRequest = { ...originalRequest, id: 3 }; h.render();
    await h.waitFor(() => body(h)?.props.preview.path === "a.pdf");
    assert.equal(body(h).props.pdfHighlights[0].id, "first");
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    h.options.write = async args => { await pending; return h.saveBinary(args); };
    const old = body(h);
    h.controls().save.props.onClick(); await h.flush();
    assert.equal(body(h).props.pdfEditable, true);
    assert.equal(body(h).props.pdfDisabled, true);
    old.props.onPdfHighlightsChange([highlight("rejected-during-save")]); h.render();
    assert.equal(body(h).props.pdfHighlights[0].id, "first");
    h.props.openRequest = { ...originalRequest, path: "other.pdf", id: 4 }; h.render();
    await h.waitFor(() => body(h)?.props.preview.path === "other.pdf");
    finish();
    await h.waitFor(() => !h.previewPendingWrites.has(h.previewDraftKey(originalRequest)));
    assert.equal(body(h).props.preview.path, "other.pdf");
    h.props.openRequest = { ...originalRequest, id: 5 }; h.render();
    await h.waitFor(() => body(h)?.props.preview.path === "a.pdf");
    assert.equal(body(h).props.pdfHighlights.length, 0);
    assert.equal(body(h).props.preview.contentHash, "written");
  } finally { h.unmount(); }
});
