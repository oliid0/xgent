import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, PDFName } from "pdf-lib";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

async function harness() {
  const hooks = createReactHookHarness(), calls = [];
  const pdf = await PDFDocument.create(); pdf.addPage([400, 500]); pdf.addPage([600, 700]);
  const disk = { data: Buffer.from(await pdf.save()).toString("base64"), contentHash: "initial", mtimeMs: 10 };
  const previous = globalThis.window;
  globalThis.window = { setTimeout, clearTimeout, atob, btoa, requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout, confirm: () => true };
  const options = {};
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
  const props = { isOpen: true, openRequest: { id: 1, projectPathKey: "/project", ownerId: "owner", workdir: "/project", path: "a.pdf" }, presentation: "side", width: 500, onClose() {} };
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
  render(); await waitFor(() => !!controls().tabs);
  controls().tabs.props.onChange("annotations");
  render();
  return { props, options, disk, calls, render, controls, flush, waitFor, find, saveBinary, previewDrafts, previewPendingWrites, previewDraftKey, unmount };
}

async function notes(data, page) {
  const pdf = await PDFDocument.load(Buffer.from(data, "base64"));
  const annotations = pdf.getPage(page - 1).node.Annots();
  return annotations ? Array.from({ length: annotations.size() }, (_, index) => pdf.context.lookup(annotations.get(index)).get(PDFName.of("Contents")).decodeText()) : [];
}

test("shared document annotations save immediate drafts and page selection without a rerender", async () => {
  const h = await harness();
  try {
    const old = h.controls();
    old.text.props.onChange("Current note 😀"); old.page.props.onChange(2); old.save.props.onClick(); old.save.props.onClick();
    await h.waitFor(() => h.calls.some(([command]) => command === "fs_write_binary") && !h.previewPendingWrites.size);
    assert.equal(h.calls.filter(([command]) => command === "fs_write_binary").length, 1);
    assert.deepEqual(await notes(h.disk.data, 2), ["Current note 😀"]);
    assert.equal(h.controls().text.props.value, "");
  } finally { h.unmount(); }
});

test("shared annotations preserve later text and page edits after a pending write", async () => {
  const h = await harness(), wait = Promise.withResolvers();
  try {
    h.options.write = async args => { await wait.promise; return h.saveBinary(args); };
    h.controls().text.props.onChange("Written"); h.controls().save.props.onClick();
    await h.waitFor(() => h.calls.some(([command]) => command === "fs_write_binary"));
    const fields = h.controls(); fields.text.props.onChange("Later"); fields.page.props.onChange(2);
    wait.resolve(); await h.waitFor(() => !h.previewPendingWrites.size);
    assert.equal(h.controls().text.props.value, "Later"); assert.equal(h.controls().page.props.value, 2);
    h.options.write = undefined; h.controls().save.props.onClick();
    await h.waitFor(() => !h.previewPendingWrites.size);
    assert.equal(h.calls.at(-1)[1].expected_content_hash, "written");
    assert.deepEqual(await notes(h.disk.data, 1), ["Written"]); assert.deepEqual(await notes(h.disk.data, 2), ["Later"]);
  } finally { wait.resolve(); h.unmount(); }
});

test("shared annotation callbacks retire on file changes and reopening waits for a background save", async () => {
  const h = await harness(), wait = Promise.withResolvers();
  try {
    h.options.write = async args => { await wait.promise; return h.saveBinary(args); };
    h.controls().text.props.onChange("Written"); h.controls().save.props.onClick();
    await h.waitFor(() => h.calls.some(([command]) => command === "fs_write_binary"));
    const old = h.controls(); old.text.props.onChange("Later draft");
    const first = h.props.openRequest;
    h.props.openRequest = { ...first, id: 2, path: "b.pdf" }; h.render(); await h.flush();
    h.controls().tabs.props.onChange("annotations"); h.render();
    old.text.props.onChange("Retired"); old.save.props.onClick();
    assert.equal(h.controls().text.props.value, "");
    h.props.openRequest = { ...first, id: 3 }; h.render(); await h.flush();
    assert.equal(h.calls.filter(([command, args]) => command.startsWith("fs_read") && args.path === "a.pdf").length, 1);
    wait.resolve(); await h.waitFor(() => h.calls.filter(([command, args]) => command.startsWith("fs_read") && args.path === "a.pdf").length === 2);
    h.controls().tabs.props.onChange("annotations"); h.render();
    assert.equal(h.controls().text.props.value, "Later draft");
    h.options.write = undefined; h.controls().save.props.onClick(); await h.waitFor(() => !h.previewPendingWrites.size);
    assert.equal(h.calls.at(-1)[1].expected_content_hash, "written");
  } finally { wait.resolve(); h.unmount(); }
});

test("shared annotation errors preserve drafts and a closed preview ignores late failures", async () => {
  const h = await harness();
  try {
    h.options.write = async () => { throw new Error("Write conflict"); };
    h.controls().text.props.onChange("Retained"); h.controls().save.props.onClick();
    await h.waitFor(() => !h.previewPendingWrites.size);
    assert.equal(h.controls().text.props.value, "Retained");
    assert.ok(h.find(element => element.type === "Banner" && element.props.description === "Write conflict"));
    const wait = Promise.withResolvers(); h.options.write = () => wait.promise;
    h.controls().save.props.onClick(); await h.waitFor(() => h.calls.filter(([command]) => command === "fs_write_binary").length === 2);
    h.props.isOpen = false; h.render(); wait.reject(new Error("Retired error"));
    await h.waitFor(() => !h.previewPendingWrites.size);
    assert.equal(h.find(element => element.type === "Banner" && element.props.description === "Retired error"), undefined);
  } finally { h.unmount(); }
});
