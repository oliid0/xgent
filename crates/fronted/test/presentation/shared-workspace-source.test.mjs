import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

async function harness(format = "text") {
  const hooks = createReactHookHarness(), calls = [], options = {};
  const firstPath = format === "docx" ? "a.docx" : "a.md";
  const mimeType = format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "text/markdown";
  const disk = new Map([firstPath, format === "docx" ? "b.docx" : "b.md"].map(path =>
    [path, { path, mimeType, content: "Original", data: Buffer.from("Original").toString("base64"), contentHash: `initial:${path}`, mtimeMs: 10, sizeBytes: 8 }]));
  const previous = globalThis.window;
  globalThis.window = { setTimeout, clearTimeout, atob, btoa, requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout };
  const translate = key => key;
  const writeSource = args => {
    const old = disk.get(args.path);
    assert.equal(args.expected_content_hash, old.contentHash);
    const next = { ...old, content: args.content, data: Buffer.from(args.content).toString("base64"),
      contentHash: `written:${old.mtimeMs + 1}`, mtimeMs: old.mtimeMs + 1, sizeBytes: Buffer.byteLength(args.content) };
    disk.set(args.path, next);
    return { contentHash: next.contentHash, mtimeMs: next.mtimeMs, bytesWritten: next.sizeBytes };
  };
  const mocks = {
    react: hooks.react,
    "../../i18n": { useLocale: () => ({ t: translate }) },
    "../../lib/shared/utils": { cn: (...values) => values.filter(Boolean).join(" ") },
    "../../lib/system/clipboardText": { writeClipboardText: async value => {
      calls.push(["clipboard", { value }]); return options.copy ? options.copy(value) : true;
    } },
    "../../lib/tools/fsBackend": { invokeFs: async (command, args) => {
      calls.push([command, args]);
      if (command.startsWith("fs_read")) return options.read ? options.read(args) : disk.get(args.path);
      return options.write ? options.write(args) : writeSource(args);
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
  const props = { isOpen: true, openRequest: { id: 1, projectPathKey: "/project", ownerId: "owner", workdir: "/project", path: firstPath }, presentation: "side", width: 500, onClose() {} };
  const render = () => hooks.render(() => WorkspaceFilePreviewOverlay(props));
  const elements = element => {
    if (!element || typeof element !== "object") return [];
    if (Array.isArray(element)) return element.flatMap(elements);
    return [element, ...Object.values(element.props ?? {}).flatMap(value => typeof value === "function" ? [] : elements(value))];
  };
  const find = predicate => elements(render()).find(predicate);
  const controls = () => ({ text: find(element => element.type === "TextArea"),
    save: find(element => element.type === "IconButton" && element.props.label === "workspaceEditor.save"),
    copy: find(element => element.type === "IconButton" && element.props.label === "workspaceFilePreview.copySource"),
    tabs: find(element => element.type === "TabList") });
  const flush = async () => { await new Promise(setImmediate); return render(); };
  const waitFor = async predicate => {
    for (let index = 0; index < 100; index++) { await flush(); if (predicate()) return; }
    throw new Error(`Source preview did not settle: ${find(element => element.type === "Banner")?.props.description}`);
  };
  render(); await waitFor(() => !!controls().tabs);
  controls().tabs.props.onChange("source"); render();
  return { props, calls, options, disk, render, controls, flush, find, waitFor, writeSource, previewDrafts, previewPendingWrites, previewDraftKey,
    unmount() { hooks.unmount(); if (previous === undefined) delete globalThis.window; else globalThis.window = previous; } };
}

test("shared text and DOCX source save immediate input once and retain the source tab", async () => {
  for (const format of ["text", "docx"]) {
    const h = await harness(format);
    try {
      const old = h.controls();
      old.text.props.onChange("Immediate 😀"); old.save.props.onClick(); old.save.props.onClick();
      await h.waitFor(() => !h.previewPendingWrites.size);
      assert.equal(h.calls.filter(([command]) => command.startsWith("fs_write")).length, 1);
      assert.equal(h.calls.find(([command]) => command.startsWith("fs_write"))[0], format === "docx" ? "fs_write_docx_text" : "fs_write_text");
      assert.equal(h.disk.get(h.props.openRequest.path).content, "Immediate 😀");
      assert.equal(h.controls().text.props.value, "Immediate 😀");
      assert.equal(h.controls().save.props.isDisabled, true);
    } finally { h.unmount(); }
  }
});

test("shared source acknowledgement keeps later input and an edit returning to the old disk value", async () => {
  const h = await harness(), wait = Promise.withResolvers();
  try {
    h.options.write = async args => { await wait.promise; return h.writeSource(args); };
    h.controls().text.props.onChange("Sent"); h.controls().save.props.onClick();
    h.controls().text.props.onChange("Original");
    wait.resolve(); await h.waitFor(() => !h.previewPendingWrites.size);
    assert.equal(h.disk.get("a.md").content, "Sent");
    assert.equal(h.controls().text.props.value, "Original");
    assert.equal(h.controls().save.props.isDisabled, false);
    h.options.write = undefined; h.controls().save.props.onClick();
    await h.waitFor(() => !h.previewPendingWrites.size);
    assert.equal(h.disk.get("a.md").content, "Original");
    assert.equal(h.calls.at(-1)[1].expected_content_hash, "written:11");
    assert.equal(h.calls.filter(([command]) => command.startsWith("fs_read")).length, 1);
  } finally { wait.resolve(); h.unmount(); }
});

test("retired shared source callbacks cannot edit a different file and reopening waits for its background write", async () => {
  const h = await harness(), wait = Promise.withResolvers();
  try {
    h.options.write = async args => { await wait.promise; return h.writeSource(args); };
    h.controls().text.props.onChange("Sent"); h.controls().save.props.onClick();
    const old = h.controls(), first = h.props.openRequest;
    old.text.props.onChange("Later");
    h.props.openRequest = { ...first, id: 2, path: "b.md" }; h.render(); await h.flush();
    h.controls().tabs.props.onChange("source"); h.render();
    old.text.props.onChange("Retired"); old.save.props.onClick();
    assert.equal(h.controls().text.props.value, "Original");
    h.props.openRequest = { ...first, id: 3 }; h.render(); await h.flush();
    assert.equal(h.calls.filter(([command, args]) => command.startsWith("fs_read") && args.path === "a.md").length, 1);
    wait.resolve(); await h.waitFor(() => !!h.controls().tabs && !h.previewPendingWrites.size);
    h.controls().tabs.props.onChange("source"); h.render();
    assert.equal(h.controls().text.props.value, "Later");
    h.options.write = undefined; h.controls().save.props.onClick(); await h.waitFor(() => !h.previewPendingWrites.size);
    assert.equal(h.disk.get("a.md").content, "Later");
  } finally { wait.resolve(); h.unmount(); }
});

test("shared source conflicts retain input and closing retires a pending write error", async () => {
  const h = await harness(), wait = Promise.withResolvers();
  try {
    h.options.write = async () => { throw new Error("Source conflict"); };
    h.controls().text.props.onChange("Retained"); h.controls().save.props.onClick(); await h.waitFor(() => !h.previewPendingWrites.size);
    assert.equal(h.controls().text.props.value, "Retained");
    assert.ok(h.find(element => element.type === "Banner" && element.props.description === "Source conflict"));
    h.options.write = () => wait.promise; h.controls().save.props.onClick();
    h.props.isOpen = false; h.render(); wait.reject(new Error("Retired failure"));
    await h.waitFor(() => !h.previewPendingWrites.size);
    assert.equal(h.find(element => element.type === "Banner" && element.props.description === "Retired failure"), undefined);
  } finally { wait.resolve(); h.unmount(); }
});

test("DOCX edits made during preview refresh rebase recovered drafts onto the acknowledged write", async () => {
  const h = await harness("docx"), refresh = Promise.withResolvers();
  try {
    h.options.read = args => args.path === "a.docx" ? refresh.promise : h.disk.get(args.path);
    h.controls().text.props.onChange("Written"); h.controls().save.props.onClick();
    await h.waitFor(() => h.calls.filter(([command]) => command.startsWith("fs_read")).length === 2);
    h.controls().text.props.onChange("Typed during refresh");
    const first = h.props.openRequest;
    h.props.openRequest = { ...first, id: 2, path: "b.docx" }; h.render(); await h.flush();
    refresh.resolve(h.disk.get("a.docx")); await h.waitFor(() => !h.previewPendingWrites.size);
    assert.equal(h.previewDrafts.get(h.previewDraftKey(first)).contentHash, "written:11");
    h.options.read = undefined; h.props.openRequest = { ...first, id: 3 }; h.render(); await h.flush();
    h.controls().tabs.props.onChange("source"); h.render();
    assert.equal(h.controls().text.props.value, "Typed during refresh");
    h.controls().save.props.onClick(); await h.waitFor(() => !h.previewPendingWrites.size);
    assert.equal(h.disk.get("a.docx").content, "Typed during refresh");
  } finally { refresh.resolve(h.disk.get("a.docx")); h.unmount(); }
});

test("source copying uses immediate input and retired callbacks cannot copy or mark another file", async () => {
  const h = await harness(), copy = Promise.withResolvers();
  try {
    const old = h.controls();
    old.text.props.onChange("Immediate clipboard 😀");
    h.options.copy = () => copy.promise;
    old.copy.props.onClick();
    assert.equal(h.calls.at(-1)[1].value, "Immediate clipboard 😀");
    h.props.openRequest = { ...h.props.openRequest, id: 2, path: "b.md" }; h.render(); await h.flush();
    old.copy.props.onClick();
    assert.equal(h.calls.filter(([command]) => command === "clipboard").length, 1);
    copy.resolve(false); await h.flush();
    assert.equal(h.find(element => element.type === "Banner" && element.props.description === "workspaceFilePreview.copyFailed"), undefined);
  } finally { copy.resolve(false); h.unmount(); }
});
