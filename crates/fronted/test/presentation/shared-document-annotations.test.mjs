import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
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
  render(); await waitFor(() => !!find(element => element.props?.preview?.kind === "pdf"));
  return { props, options, disk, calls, render, controls, flush, waitFor, find, saveBinary, previewDrafts, previewPendingWrites, previewDraftKey, unmount };
}

test("shared PDF preview preserves file bytes and omits the standalone annotation editor", async () => {
  const h = await harness();
  try {
    const original = h.disk.data;
    assert.equal(h.controls().text, undefined);
    assert.equal(h.controls().page, undefined);
    assert.equal(h.controls().save, undefined);
    assert.equal(h.controls().tabs, undefined);
    assert.equal(h.disk.data, original);
    assert.equal(h.calls.some(([command]) => command === "fs_write_binary"), false);
  } finally { h.unmount(); }
});
