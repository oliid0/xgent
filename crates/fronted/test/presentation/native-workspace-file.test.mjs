import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { read, utils, write } from "xlsx";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { editPresentationInBrowser, editSpreadsheetInBrowser, presentationFixture, readPresentationInBrowser } from "../helpers/document-annotation-browser.mjs";
import { rotateImageInBrowser } from "../helpers/document-annotation-browser.mjs";
import { imageFixture, pngPixels } from "../helpers/image-fixture.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function harness(options = {}) {
  const calls = [];
  const files = new Map([["a.txt", "Original"], ["b.txt", "Second"], ["report.docx", "Document"]]);
  let frame;
  const parent = { state: [], cursor: 0, effects: [] };
  let sequence = 0;
  let request = 0;
  let closed = 0;
  let translate = key => key;
  const same = (a, b) => a?.length === b?.length && a.every((item, index) => Object.is(item, b[index]));
  const fsBackend = {
    isFsBackendError: error => typeof error?.code === "string",
    invokeFs: async (command, args) => {
      calls.push([command, { ...args }]);
      if (command === "fs_file_applications") return options.applications ? options.applications(args) : [];
      if (command.startsWith("fs_read")) {
        if (options.read) return options.read(command, args);
        return readResult(args.path, files.get(args.path) ?? "");
      }
      if (options.write) return options.write(command, args);
      files.set(args.path, args.content);
      return writeResult(args.content);
    },
  };
  const loader = createTsModuleLoader({ mocks: {
    ...(options.presentation ? { [fileURLToPath(new URL("../../src/components/workspace-editor/workspacePresentationText.ts", import.meta.url))]: {
      ...createTsModuleLoader().loadModule("src/components/workspace-editor/workspacePresentationText.ts"),
      ...options.presentation,
    } } : {}),
    "@xgent/runtime": { invoke: async (command, args) => {
      calls.push([command, { ...args }]);
      return options.invoke ? options.invoke(command, args) : { stdout: "Output", stderr: "", exitCode: 0 };
    } },
    "../components/workspace-editor/workspaceImageOperations": {
      ...createTsModuleLoader().loadModule("src/components/workspace-editor/workspaceImageOperations.ts"),
      rotateWorkspaceImage: rotateImageInBrowser,
    },
    "../components/workspace-editor/workspaceSpreadsheet": {
      ...createTsModuleLoader().loadModule("src/components/workspace-editor/workspaceSpreadsheet.ts"),
      writeSpreadsheetEdits: editSpreadsheetInBrowser,
    },
    react: {
      useState(initial) {
        const owner = frame;
        const index = owner.cursor++;
        if (!(index in owner.state)) owner.state[index] = typeof initial === "function" ? initial() : initial;
        return [owner.state[index], value => {
          const next = typeof value === "function" ? value(owner.state[index]) : value;
          if (!Object.is(next, owner.state[index])) { owner.state[index] = next; owner.dirty = true; }
        }];
      },
      useRef(initial) {
        const index = frame.cursor++;
        return frame.state[index] ??= { current: initial };
      },
      useCallback(callback, deps) {
        const index = frame.cursor++;
        if (!same(frame.state[index]?.deps, deps)) frame.state[index] = { callback, deps };
        return frame.state[index].callback;
      },
      useMemo(factory, deps) {
        const index = frame.cursor++;
        if (!same(frame.state[index]?.deps, deps)) frame.state[index] = { value: factory(), deps };
        return frame.state[index].value;
      },
      useEffect(effect, deps) {
        const owner = frame;
        const index = owner.cursor++;
        if (!same(owner.state[index]?.deps, deps)) {
          owner.effects.push(() => {
            owner.state[index]?.cleanup?.();
            owner.state[index] = { deps, cleanup: effect() };
          });
        }
      },
    },
    "../i18n": { useLocale: () => ({ t: translate }) },
    "../lib/runtimePlatform": { isNativeMobileRuntime: () => options.compact !== false },
    "./NativeSurface": { NativeSurface: "NativeSurface" },
    "./nativeTheme": { createNativePresentationTheme: () => undefined },
    "../lib/tools/fsBackend": fsBackend,
    "../../lib/tools/fsBackend": fsBackend,
  } });
  const { NativeWorkspaceFilePage } = loader.loadModule("src/presentation/NativeWorkspaceFilePage.tsx");
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  const registry = createPresentationActionRegistry();
  const props = {
    settings: { theme: "light" }, editorOpen: true, previewOpen: false, previewRequest: null,
    editorRequest: { id: 1, projectPathKey: "/project", workdir: "/project", path: "a.txt" },
    onEditorClose: () => closed++, onPreviewClose: () => closed++,
  };
  const unmount = () => {
    if (!frame) return;
    for (const slot of frame.state) slot?.cleanup?.();
    registry.remove(frame.surface);
    frame = undefined;
  };
  const render = () => {
    const child = frame;
    frame = parent;
    let element;
    do {
      parent.dirty = false; parent.cursor = 0;
      element = NativeWorkspaceFilePage(props);
      for (const effect of parent.effects.splice(0)) effect();
    } while (parent.dirty);
    frame = child;
    if (!element) { unmount(); return null; }
    if (frame?.key !== element.key) {
      unmount();
      frame = { key: element.key, surface: `file-${++sequence}`, state: [], effects: [], cursor: 0 };
    }
    do {
      frame.dirty = false;
      frame.cursor = 0;
      frame.view = element.type(element.props);
      const document = { version: 1, surface: frame.surface, revision: 1, ...frame.view.props.document };
      validatePresentationDocument(document, frame.view.props.handlers);
      registry.register(frame.surface, frame.view.props.handlers);
      for (const effect of frame.effects.splice(0)) effect();
    } while (frame.dirty);
    return frame.view.props.document;
  };
  const dispatch = (action, value = null, surface = frame.surface) => registry.dispatch({ surface, action, value, requestId: String(++request) });
  const node = id => {
    const visit = nodes => nodes.flatMap(item => [item, ...visit(item.children ?? [])]);
    return visit(render()?.nodes ?? []).find(item => item.id === id);
  };
  render();
  return { props, options, calls, files, render, node, dispatch, unmount() {
    unmount(); for (const slot of parent.state) slot?.cleanup?.();
  },
    get closed() { return closed; }, get surface() { return frame.surface; },
    changeLocale() { translate = key => `translated:${key}`; },
    async flush() { await new Promise(setImmediate); return render(); },
  };
}

function readResult(path, content) {
  return { path, content, mimeType: path.endsWith("docx") ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "text/plain",
    data: "", mtimeMs: 10, contentHash: "initial", sizeBytes: Buffer.byteLength(content), totalLines: 1 };
}
function writeResult(content) {
  return { path: "a.txt", mtimeMs: 11, contentHash: "written", bytesWritten: Buffer.byteLength(content), totalLines: 1 };
}

const sourcePayload = content => JSON.stringify({ kind: "source", content });

test("native source views publish canonical language and exact shared syntax for current drafts and cached sessions", async () => {
  const h = harness();
  try {
    h.props.editorRequest = { ...h.props.editorRequest, path: "a.ts" };
    h.files.set("a.ts", "const value = 42;");
    h.render(); await h.flush(); await h.flush();
    const first = h.node("workspace-file-editor"), syntax = JSON.parse(first.text).syntax;
    assert.equal(first.language, "typescript"); assert.equal(syntax.source, first.value); assert.ok(syntax.runs.length > 0);
    await h.dispatch(first.action, "const value = 'native draft';");
    const edited = JSON.parse(h.node("workspace-file-editor").text).syntax;
    assert.equal(edited.source, "const value = 'native draft';"); assert.ok(edited.revision > syntax.revision);
    h.props.editorRequest = { ...h.props.editorRequest, id: 2, path: "b.rs" }; h.files.set("b.rs", "fn main() {}");
    h.render(); await h.flush(); await h.flush();
    assert.equal(h.node("workspace-file-editor").language, "rust");
    assert.equal(JSON.parse(h.node("workspace-file-editor").text).syntax.source, "fn main() {}");
    h.props.editorRequest = { ...h.props.editorRequest, id: 3, path: "a.ts" };
    h.render(); await h.flush(); await h.flush();
    assert.equal(JSON.parse(h.node("workspace-file-editor").text).syntax.source, "const value = 'native draft';");
  } finally { h.unmount(); }
});
const findPayload = (content, changes = {}) => JSON.stringify({ kind: "workspaceFind", command: "query", content,
  query: "cat", replacement: "dog", options: { matchCase: false, wholeWord: false, regex: false, selection: false, preserveCase: false },
  selections: [{ location: 0, length: 0 }], ...changes });

test("native editor lifecycle reports hidden sessions and evicts every session on close-all before reopening", async () => {
  const h = harness(), snapshots = [];
  h.props.onEditorSessionsChanged = value => snapshots.push(value);
  try {
    h.render(); await h.flush();
    const first = JSON.parse(h.node("workspace-file-editor").text).session;
    assert.deepEqual(snapshots.at(-1).open, [first.key]);
    assert.equal(snapshots.at(-1).scope, first.scope);
    h.props.editorOpen = false; h.render();
    assert.deepEqual(snapshots.at(-1).open, [first.key]);
    h.props.editorOpen = true; h.props.editorRequest = { ...h.props.editorRequest, id: 2, path: "b.txt" };
    h.render(); await h.flush(); await h.flush();
    assert.equal(snapshots.at(-1).open.length, 2);
    const revision = snapshots.at(-1).revision;
    await h.dispatch(h.node("workspace-file-close-all").action, sourcePayload("Second"));
    await h.flush();
    assert.deepEqual(snapshots.at(-1).open, []);
    assert.ok(snapshots.at(-1).revision > revision);
    h.props.editorOpen = true; h.props.editorRequest = { ...h.props.editorRequest, id: 3, path: "a.txt" };
    h.render(); await h.flush(); await h.flush();
    const reopened = JSON.parse(h.node("workspace-file-editor").text).session;
    assert.notEqual(reopened.key, first.key);
    assert.equal(reopened.scope, first.scope);
    assert.deepEqual(snapshots.at(-1).open, [reopened.key]);
  } finally { h.unmount(); }
});

test("native closing the last editor publishes an empty session snapshot and preserves guarded-save behavior", async () => {
  const h = harness(), snapshots = [];
  h.props.onEditorSessionsChanged = value => snapshots.push(value);
  try {
    h.render(); await h.flush();
    await h.dispatch("workspace-file-close", sourcePayload("Latest native draft"));
    assert.equal(snapshots.at(-1).open.length, 1);
    assert.ok(h.node("workspace-file-confirm-save"));
    await h.dispatch("workspace-file-confirm-save", sourcePayload("Latest native draft"));
    await h.flush();
    assert.deepEqual(snapshots.at(-1).open, []);
    assert.equal(h.files.get("a.txt"), "Latest native draft");
    assert.equal(h.closed, 1);
  } finally { h.unmount(); }
});

test("native find consumes unacknowledged source and only actual replacement acknowledgements advance its result", async () => {
  const h = harness();
  try {
    await h.flush();
    assert.equal((await h.dispatch(h.node("workspace-file-find-action").action, findPayload("cat cat"))).ok, true);
    let find = JSON.parse(h.node("workspace-file-editor").text).find;
    assert.equal(find.count, 2); assert.equal(find.open, true);
    assert.deepEqual(find.decorations.matches, [{ location: 0, length: 3 }, { location: 4, length: 3 }]);
    assert.equal(h.node("workspace-file-editor").value, "cat cat");
    await h.dispatch(h.node("workspace-file-find-action").action, findPayload("cat cat", { command: "replace", selections: [{ location: 0, length: 3 }] }));
    find = JSON.parse(h.node("workspace-file-editor").text).find;
    assert.equal(find.edit.before, "cat cat"); assert.equal(find.edit.text, "dog");
    assert.equal(h.node("workspace-file-editor").value, "cat cat");
    await h.dispatch("workspace-file-editor", "dog cat");
    await h.dispatch(h.node("workspace-file-find-action").action, findPayload("dog cat", { command: "ack", editRequest: find.edit.request, applied: true }));
    find = JSON.parse(h.node("workspace-file-editor").text).find;
    assert.equal(find.edit, null); assert.equal(find.count, 1); assert.equal(find.reveal.location, 4);
    assert.equal(find.decorations.source, "dog cat");
    assert.deepEqual(find.decorations.matches, [{ location: 4, length: 3 }]);
    assert.equal(h.calls.some(([command]) => command.startsWith("fs_write")), false);
  } finally { h.unmount(); }
});

test("native find belongs to a tab session, survives hidden editors and rejects retired file actions", async () => {
  const h = harness();
  try {
    await h.flush();
    await h.dispatch(h.node("workspace-file-find-action").action, findPayload("cat cat"));
    const oldAction = h.node("workspace-file-find-action").action, identity = JSON.parse(h.node("workspace-file-editor").text).find.identity;
    h.props.editorOpen = false; h.render();
    h.props.editorOpen = true; h.render(); await h.flush();
    assert.equal(JSON.parse(h.node("workspace-file-editor").text).find.identity, identity);
    assert.equal(JSON.parse(h.node("workspace-file-editor").text).find.query, "cat");
    h.props.editorRequest = { ...h.props.editorRequest, id: 2, path: "b.txt" }; h.render(); await h.flush(); await h.flush();
    assert.equal(JSON.parse(h.node("workspace-file-editor").text).find.open, false);
    assert.equal((await h.dispatch(oldAction, findPayload("WRONG FILE"))).ok, false);
    assert.equal(h.node("workspace-file-editor").value, "Second");
  } finally { h.unmount(); }
});
const editorTabs = h => h.node("workspace-editor-tabs")?.children ?? [];
const editorTab = (h, path) => editorTabs(h).find(tab => tab.text.endsWith(`/${path}`));
const bulkDialog = h => h.render()?.nodes[0]?.children.find(node => node.variant === "workspace-editor-close-all");
const bulkAction = (h, type) => bulkDialog(h)?.children.find(node => node.id.startsWith(`workspace-editor-bulk-${type}:`));
async function dirtyNativeTabs(h) {
  await h.flush(); await h.dispatch("workspace-file-editor", "Draft A");
  h.props.editorRequest = { ...h.props.editorRequest, id: 2, path: "b.txt" }; h.render(); await h.flush();
  await h.dispatch("workspace-file-editor", "Draft B"); h.render();
}

test("native Save All writes every opened draft and the latest native input through guarded Rust commands", async () => {
  for (const compact of [true, false]) {
    const h = harness({ compact });
    try {
      await dirtyNativeTabs(h); await h.dispatch("workspace-file-save-all", sourcePayload("Immediate B")); await h.flush();
      const writes = h.calls.filter(([command]) => command === "fs_write_text");
      assert.deepEqual(writes.map(([, args]) => [args.path, args.content, args.expected_content_hash]), [["a.txt", "Draft A", "initial"], ["b.txt", "Immediate B", "initial"]]);
      assert.equal(editorTabs(h).every(tab => tab.current === 0), true);
      assert.equal(h.node("workspace-file-unsaved"), undefined);
      await h.dispatch("workspace-file-save", sourcePayload("Next B")); await h.flush();
      assert.equal(h.calls.at(-1)[1].expected_content_hash, "written");
    } finally { h.unmount(); }
  }
});

test("native Close All saves actual files before closing and clean tabs close without writes", async () => {
  const h = harness();
  try {
    await dirtyNativeTabs(h); await h.dispatch("workspace-file-close-all", sourcePayload("Final B"));
    assert.equal(bulkDialog(h).children.filter(item => item.variant === "workspace-editor-close-file").length, 2);
    await h.dispatch(bulkAction(h, "save").action); await h.flush();
    assert.equal(h.closed, 1); assert.equal(h.render(), null);
    assert.deepEqual(h.calls.filter(([command]) => command === "fs_write_text").map(([, args]) => args.content), ["Draft A", "Final B"]);
  } finally { h.unmount(); }
  const clean = harness();
  try { await clean.flush(); await clean.dispatch("workspace-file-close-all"); await clean.flush(); assert.equal(clean.closed, 1); assert.equal(clean.calls.some(([command]) => command === "fs_write_text"), false); } finally { clean.unmount(); }
});

test("native bulk save reports individual conflicts while saving other files and keeps all tabs open", async () => {
  let failed = true;
  const h = harness({ write: async (command, args) => { if (failed && args.path === "a.txt") throw { code: "stale_file" }; return writeResult(args.content); } });
  try {
    await dirtyNativeTabs(h); await h.dispatch("workspace-file-close-all"); h.render();
    await h.dispatch(bulkAction(h, "save").action); await h.flush();
    assert.equal(h.closed, 0); assert.ok(bulkDialog(h));
    assert.equal(bulkDialog(h).children.find(item => item.kind === "Banner").text, "workspaceEditor.conflictMessage");
    assert.equal(h.node(`workspace-editor-bulk-error:${editorTab(h, "a.txt").id.split(":")[1]}`).text, "workspaceEditor.conflictMessage");
    assert.equal(editorTab(h, "b.txt").current, 0); assert.equal(editorTab(h, "a.txt").current, 1);
    failed = false; await h.dispatch(bulkAction(h, "save").action); await h.flush(); assert.equal(h.closed, 1);
    assert.deepEqual(h.calls.filter(([command]) => command === "fs_write_text").map(([, args]) => args.path), ["a.txt", "b.txt", "a.txt"]);
  } finally { h.unmount(); }
});

test("native Save All waits for an individual save and does not issue a duplicate write", async () => {
  const pending = Promise.withResolvers(); const h = harness({ write: async (command, args) => { await pending.promise; return writeResult(args.content); } });
  try {
    await h.flush(); await h.dispatch("workspace-file-editor", "Submitted"); h.render();
    const saving = h.dispatch("workspace-file-save"); await h.flush();
    const all = h.dispatch("workspace-file-save-all"); await h.flush();
    assert.equal(h.calls.filter(([command]) => command === "fs_write_text").length, 1);
    pending.resolve(); await saving; await all; await h.flush();
    assert.equal(h.node("workspace-file-unsaved"), undefined);
  } finally { pending.resolve(); h.unmount(); }
});

test("native bulk save retains edits made to an earlier file while a later file writes", async () => {
  const pending = Promise.withResolvers(); const h = harness({ write: async (command, args) => { if (args.path === "b.txt") await pending.promise; return writeResult(args.content); } });
  try {
    await dirtyNativeTabs(h); await h.dispatch("workspace-file-close-all"); h.render();
    const saving = h.dispatch(bulkAction(h, "save").action); await h.flush();
    await h.dispatch(editorTab(h, "a.txt").children[0].action); await h.flush(); await h.flush();
    assert.equal((await h.dispatch("workspace-file-editor", "Later A")).ok, true);
    assert.equal(h.node("workspace-file-editor").value, "Later A");
    assert.equal(editorTab(h, "a.txt").current, 1);
    pending.resolve(); await saving; await h.flush();
    assert.equal(h.closed, 0); assert.ok(bulkDialog(h)); assert.equal(h.node("workspace-file-editor").value, "Later A");
    assert.equal(h.node(`workspace-editor-bulk-error:${editorTab(h, "a.txt").id.split(":")[1]}`).text, "workspaceEditor.editedDuringSave");
    await h.dispatch(bulkAction(h, "save").action); await h.flush(); assert.equal(h.closed, 1);
    assert.equal(h.calls.at(-1)[1].expected_content_hash, "written");
  } finally { pending.resolve(); h.unmount(); }
});

test("native bulk cancel stops unstarted writes and retired confirmation actions cannot close a newer dialog", async () => {
  const pending = Promise.withResolvers(); const h = harness({ write: async (command, args) => { await pending.promise; return writeResult(args.content); } });
  try {
    await dirtyNativeTabs(h); await h.dispatch("workspace-file-close-all");
    const oldSave = bulkAction(h, "save"), oldDiscard = bulkAction(h, "discard"), oldCancel = bulkAction(h, "cancel");
    const saving = h.dispatch(oldSave.action); await h.flush();
    await h.dispatch(oldCancel.action); h.render(); pending.resolve(); await saving; await h.flush();
    assert.equal(bulkDialog(h), undefined); assert.equal(h.closed, 0);
    assert.deepEqual(h.calls.filter(([command]) => command === "fs_write_text").map(([, args]) => args.path), ["a.txt"]);
    await h.dispatch("workspace-file-close-all"); const newer = bulkDialog(h).id;
    for (const old of [oldSave, oldDiscard, oldCancel]) assert.equal((await h.dispatch(old.action)).ok, false);
    assert.equal(bulkDialog(h).id, newer); assert.equal(h.closed, 0);
    await h.dispatch(bulkAction(h, "discard").action); await h.flush(); assert.equal(h.closed, 1);
  } finally { pending.resolve(); h.unmount(); }
});

test("native Close All reconfirms a tab opened during saving instead of silently closing it", async () => {
  const pending = Promise.withResolvers(); const h = harness({ write: async (command, args) => { await pending.promise; return writeResult(args.content); } });
  try {
    await dirtyNativeTabs(h); await h.dispatch("workspace-file-close-all"); const original = bulkDialog(h).id;
    const saving = h.dispatch(bulkAction(h, "save").action); await h.flush();
    h.props.editorRequest = { ...h.props.editorRequest, id: 3, path: "c.txt" }; h.render(); await h.flush();
    pending.resolve(); await saving; await h.flush();
    assert.equal(h.closed, 0); assert.equal(editorTabs(h).length, 3); assert.notEqual(bulkDialog(h).id, original);
    await h.dispatch(bulkAction(h, "discard").action); await h.flush(); assert.equal(h.closed, 1);
  } finally { pending.resolve(); h.unmount(); }
});

test("native cancelled bulk dialog callbacks cannot replace immediate source before another render", async () => {
  const h = harness();
  try {
    await dirtyNativeTabs(h); await h.dispatch("workspace-file-close-all");
    const save = bulkAction(h, "save"), discard = bulkAction(h, "discard"), cancel = bulkAction(h, "cancel");
    await h.dispatch(cancel.action);
    await h.dispatch(save.action, sourcePayload("Retired Save source"));
    await h.dispatch(discard.action, sourcePayload("Retired Discard source"));
    assert.equal(h.node("workspace-file-editor").value, "Draft B");
    assert.equal(h.calls.some(([command]) => command === "fs_write_text"), false); assert.equal(h.closed, 0);
  } finally { h.unmount(); }
});

test("native failed reload keeps visible source and input during reload cannot be lost", async () => {
  for (const fail of [true, false]) {
    const h = harness(); const pending = Promise.withResolvers();
    try {
      await h.flush(); h.options.read = () => pending.promise;
      await h.dispatch("workspace-file-reload"); h.render(); assert.equal(h.node("workspace-file-editor").value, "Original");
      await h.dispatch("workspace-file-editor", "Typed while reading"); h.render();
      if (fail) pending.reject(new Error("Read denied")); else pending.resolve(readResult("a.txt", "Original"));
      await h.flush(); assert.equal(h.node("workspace-file-editor").value, "Typed while reading");
      assert.ok(h.node("workspace-file-unsaved"));
      assert.equal(h.node("workspace-file-error"), undefined, "A retired refresh must not report failure against newer input");
    } finally { pending.resolve(readResult("a.txt", "Original")); h.unmount(); }
  }
});

test("native discard before a failed reload retains the saved version without resurrecting discarded input", async () => {
  const h = harness();
  try {
    await h.flush(); await h.dispatch("workspace-file-editor", "Discard me"); h.render();
    await h.dispatch("workspace-file-reload"); h.render(); h.options.read = () => { throw new Error("Missing file"); };
    await h.dispatch("workspace-file-confirm-discard"); await h.flush();
    assert.equal(h.node("workspace-file-editor").value, "Original"); assert.equal(h.node("workspace-file-unsaved"), undefined);
    assert.equal(h.node("workspace-file-error").label, "Missing file");
  } finally { h.unmount(); }
});

test("native failed refresh without newer input retains visible source and reports the actual read failure", async () => {
  const h = harness();
  try {
    await h.flush(); h.options.read = () => { throw new Error("Read denied"); };
    await h.dispatch("workspace-file-reload"); await h.flush();
    assert.equal(h.node("workspace-file-editor").value, "Original");
    assert.equal(h.node("workspace-file-error").label, "Read denied");
    assert.equal(h.node("workspace-file-unsaved"), undefined);
  } finally { h.unmount(); }
});

test("native tabs preserve immediate source input and reuse each opened file without another disk read", async () => {
  for (const compact of [true, false]) {
    const h = harness({ compact });
    try {
      await h.flush(); const original = h.props.editorRequest;
      await h.dispatch("workspace-file-editor", "Draft A");
      h.props.editorRequest = { ...original, id: 2, path: "b.txt" }; h.render(); await h.flush();
      assert.equal(editorTabs(h).length, 2);
      const a = editorTab(h, "a.txt"), b = editorTab(h, "b.txt"), surface = h.surface;
      await h.dispatch(a.children[0].action, sourcePayload("Immediate B")); await h.flush();
      assert.equal(h.node("workspace-file-editor").value, "Draft A");
      assert.equal(editorTab(h, "b.txt").current, 1);
      assert.equal((await h.dispatch(b.children[0].action, null, surface)).ok, false);
      await h.dispatch(editorTab(h, "b.txt").children[0].action, sourcePayload("Immediate A")); await h.flush();
      assert.equal(h.node("workspace-file-editor").value, "Immediate B");
      assert.equal(h.calls.filter(([command]) => command.startsWith("fs_read")).length, 2);
      h.props.editorRequest = { ...original, id: 3, path: "b.txt" }; h.render(); await h.flush();
      assert.equal(editorTabs(h).length, 2);
      assert.equal(h.calls.filter(([command]) => command.startsWith("fs_read")).length, 2);
      await h.dispatch("workspace-file-save");
      assert.equal(h.files.get("b.txt"), "Immediate B");
    } finally { h.unmount(); }
  }
});

test("closing a background dirty native tab confirms its actual file and retains other drafts", async () => {
  const h = harness();
  try {
    await h.flush(); const original = h.props.editorRequest;
    await h.dispatch("workspace-file-editor", "Unsaved A");
    h.props.editorRequest = { ...original, id: 2, path: "b.txt" }; h.render(); await h.flush();
    await h.dispatch(editorTab(h, "a.txt").children[1].action, sourcePayload("Immediate B")); await h.flush();
    assert.equal(h.node("workspace-file-editor").value, "Unsaved A");
    assert.ok(h.node("workspace-file-confirmation")); assert.equal(h.closed, 0);
    await h.dispatch("workspace-file-confirm-cancel");
    await h.dispatch(editorTab(h, "a.txt").children[1].action); await h.flush();
    assert.ok(h.node("workspace-file-confirmation"));
    await h.dispatch("workspace-file-confirm-discard"); await h.flush();
    assert.equal(editorTabs(h).length, 1);
    assert.equal(h.node("workspace-file-editor").value, "Immediate B");
    assert.equal(h.closed, 0);
    h.props.editorRequest = { ...original, id: 3 }; h.render(); await h.flush();
    assert.equal(h.node("workspace-file-editor").value, "Original");
    assert.equal(editorTab(h, "a.txt").current, 0);
  } finally { h.unmount(); }
});

test("native tab save-and-close writes the target file then selects its remaining neighbor", async () => {
  const h = harness();
  try {
    await h.flush(); h.props.editorRequest = { ...h.props.editorRequest, id: 2, path: "b.txt" }; h.render(); await h.flush();
    await h.dispatch("workspace-file-close", sourcePayload("Latest B"));
    assert.ok(h.node("workspace-file-confirmation"));
    await h.dispatch("workspace-file-confirm-save", sourcePayload("Current B")); await h.flush();
    assert.equal(h.files.get("b.txt"), "Current B");
    assert.equal(h.calls.filter(([command]) => command === "fs_write_text").length, 1);
    assert.equal(editorTabs(h).length, 1); assert.equal(h.closed, 0);
    assert.equal(h.node("workspace-file-editor").value, "Original");
    await h.dispatch("workspace-file-close"); assert.equal(h.closed, 1);
  } finally { h.unmount(); }
});

test("native immediate source close and reload preserve drafts until explicit user confirmation", async () => {
  for (const action of ["workspace-file-close", "workspace-file-reload"]) {
    const h = harness();
    try {
      await h.flush(); const count = h.calls.length;
      assert.equal(h.node(action).variant, "workspace-source-action");
      await h.dispatch(action, sourcePayload("Immediate source"));
      assert.ok(h.node("workspace-file-confirmation"));
      assert.equal(h.node("workspace-file-editor").value, "Immediate source");
      assert.equal(h.calls.length, count); assert.equal(h.closed, 0);
      await h.dispatch("workspace-file-confirm-cancel");
      assert.equal(h.node("workspace-file-editor").value, "Immediate source");
    } finally { h.unmount(); }
  }
});

test("native hide retains immediate input and all tabs when the editor is reopened", async () => {
  const h = harness();
  try {
    await h.flush(); h.props.editorRequest = { ...h.props.editorRequest, id: 2, path: "b.txt" }; h.render(); await h.flush();
    await h.dispatch("workspace-file-hide", sourcePayload("Hidden B"));
    assert.equal(h.closed, 1);
    h.props.editorOpen = false; h.render(); h.props.editorOpen = true; h.render(); await h.flush();
    assert.equal(h.node("workspace-file-editor").value, "Hidden B");
    assert.equal(editorTabs(h).length, 2);
    assert.equal(h.calls.filter(([command]) => command.startsWith("fs_read")).length, 2);
  } finally { h.unmount(); }
});
async function openScript(options = {}, path = "scripts/example.py") {
  const h = harness(options);
  h.files.set(path, "print('Original')");
  h.props.editorRequest = { ...h.props.editorRequest, id: 2, path };
  h.render(); await h.flush(); return h;
}

test("native save consumes the optimistic source payload before an edit acknowledgement", async () => {
  for (const compact of [true, false]) {
    const h = await openScript({ compact });
    try {
      assert.equal(h.node("workspace-file-save").variant, "workspace-source-action");
      assert.equal(h.node("workspace-file-save").current, 0);
      const content = "print('当前 😀')\n";
      assert.equal((await h.dispatch("workspace-file-save", sourcePayload(content))).ok, true);
      assert.equal(h.files.get("scripts/example.py"), content);
      const write = h.calls.find(([command]) => command === "fs_write_text");
      assert.equal(write[1].expected_content_hash, "initial");
      assert.equal(h.node("workspace-file-editor").value, content);
      assert.equal(h.node("workspace-file-unsaved"), undefined);
      assert.equal((await h.dispatch("workspace-file-save", '{"kind":"source","content":1}')).ok, false);
    } finally { h.unmount(); }
  }
});

test("native run saves current input once then invokes the same guarded Rust shell command", async () => {
  for (const compact of [true, false]) {
    const h = await openScript({ compact, invoke: () => ({ stdout: "中文 output", stderr: "Diagnostic", exit_code: 0 }) });
    try {
      const content = "print('Current')";
      const first = h.dispatch("workspace-file-run", sourcePayload(content));
      const duplicate = h.dispatch("workspace-file-run", sourcePayload("Duplicate"));
      await Promise.all([first, duplicate]);
      const runs = h.calls.filter(([command]) => command === "shell_run");
      assert.equal(runs.length, 1);
      assert.equal(h.calls.filter(([command]) => command === "fs_write_text").length, 1);
      assert.equal(h.files.get("scripts/example.py"), content);
      assert.deepEqual({ ...runs[0][1], run_id: "ID" }, { workdir: "/project", command: 'python -- "example.py"', cwd: "scripts",
        timeout_ms: 120000, max_timeout_ms: 1800000, provider_id: null, run_id: "ID", sandbox: false, sandbox_allow_network: true });
      assert.equal(h.node("workspace-file-run-text").text, "中文 output\n[stderr]\nDiagnostic");
      assert.equal(h.node("workspace-file-run-status").status, "completed");
      assert.equal(h.node("workspace-file-run-output").disabled, undefined);
      assert.equal(h.node("workspace-file-run-result-action").disabled, false);
      await h.dispatch(h.node("workspace-file-run-dismiss").action);
      assert.equal(h.node("workspace-file-run-output"), undefined);
    } finally { h.unmount(); }
  }
});

test("native run refuses to launch the saved snapshot if the user edits during its write", async () => {
  const pending = Promise.withResolvers();
  const h = await openScript({ write: async (_command, args) => { await pending.promise; h.files.set(args.path, args.content); return writeResult(args.content); } });
  try {
    const run = h.dispatch("workspace-file-run", sourcePayload("Submitted"));
    await h.flush(); await h.dispatch("workspace-file-editor", "Later input");
    pending.resolve(); await run; await h.flush();
    assert.equal(h.files.get("scripts/example.py"), "Submitted");
    assert.equal(h.node("workspace-file-editor").value, "Later input");
    assert.ok(h.node("workspace-file-unsaved"));
    assert.equal(h.calls.filter(([command]) => command === "shell_run").length, 0);
    h.options.write = undefined;
    await h.dispatch("workspace-file-run", sourcePayload("Later input"));
    assert.equal(h.files.get("scripts/example.py"), "Later input");
    assert.equal(h.calls.filter(([command]) => command === "shell_run").length, 1);
    assert.equal(h.calls.filter(([command]) => command === "fs_write_text").at(-1)[1].expected_content_hash, "written");
  } finally { pending.resolve(); h.unmount(); }
});

test("native run waits for an existing write and rejects a different optimistic draft", async () => {
  for (const later of [false, true]) {
    const pending = Promise.withResolvers();
    const h = await openScript({ write: async (_command, args) => { await pending.promise; return writeResult(args.content); } });
    try {
      const saving = h.dispatch("workspace-file-save", sourcePayload("Submitted")); await h.flush();
      const run = h.dispatch("workspace-file-run", sourcePayload(later ? "Later" : "Submitted")); await h.flush();
      assert.equal(h.calls.filter(([command]) => command === "shell_run").length, 0);
      pending.resolve(); await Promise.all([saving, run]); await h.flush();
      assert.equal(h.calls.filter(([command]) => command === "fs_write_text").length, 1);
      assert.equal(h.calls.filter(([command]) => command === "shell_run").length, later ? 0 : 1);
      assert.equal(h.node("workspace-file-editor").value, later ? "Later" : "Submitted");
    } finally { pending.resolve(); h.unmount(); }
  }
});

test("native stopping reserves cancellation and accepts backend early-registration responses", async () => {
  const response = Promise.withResolvers(), cancelled = Promise.withResolvers();
  const h = await openScript({ invoke: command => command === "shell_run" ? response.promise : cancelled.promise });
  try {
    const run = h.dispatch("workspace-file-run"); await h.flush();
    assert.equal(h.node("workspace-file-run-output").current, 1);
    assert.equal(h.node("workspace-file-run-result-action").disabled, false);
    const stop = h.dispatch(h.node("workspace-file-stop").action), duplicate = h.dispatch(h.node("workspace-file-run-result-action").action);
    await h.flush();
    assert.equal(h.calls.filter(([command]) => command === "shell_cancel").length, 1);
    assert.equal(h.calls.find(([command]) => command === "shell_cancel")[1].run_id,
      h.calls.find(([command]) => command === "shell_run")[1].run_id);
    cancelled.resolve(false); await Promise.all([stop, duplicate]); await h.flush();
    assert.equal(h.node("workspace-file-run-stop-error"), undefined);
    response.resolve({ stdout: "Partial output", stderr: "", exit_code: 0, cancelled: true }); await run;
    assert.equal(h.node("workspace-file-run-status").label, "workspaceEditor.runCancelled");
    assert.equal(h.node("workspace-file-run-status").status, "paused");
  } finally { cancelled.resolve(false); response.resolve({ stdout: "", stderr: "", exitCode: 0 }); h.unmount(); }
});

test("native stopping errors remain retryable while the same process is active", async () => {
  const pending = Promise.withResolvers(); let stops = 0;
  const h = await openScript({ invoke: command => {
    if (command === "shell_run") return pending.promise;
    if (++stops === 1) throw new Error("Cancellation unavailable"); return true;
  } });
  try {
    const run = h.dispatch("workspace-file-run"); await h.flush();
    await h.dispatch(h.node("workspace-file-stop").action);
    assert.match(h.node("workspace-file-run-stop-error").label, /Cancellation unavailable/);
    assert.equal(h.node("workspace-file-stop").disabled, false);
    await h.dispatch(h.node("workspace-file-stop").action);
    assert.equal(h.node("workspace-file-run-stop-error"), undefined); assert.equal(stops, 2);
    pending.resolve({ stdout: "", stderr: "", exitCode: 1, cancelled: true }); await run;
  } finally { pending.resolve({ stdout: "", stderr: "", exitCode: 0 }); h.unmount(); }
});

test("native runs retain their actual origin and result when switching to a different file", async () => {
  for (const failing of [false, true]) {
    const pending = Promise.withResolvers(); const h = await openScript({ invoke: () => pending.promise });
    try {
      const run = h.dispatch("workspace-file-run"); await h.flush();
      h.props.editorRequest = { ...h.props.editorRequest, id: 3, path: "b.txt" }; h.render(); await h.flush();
      if (failing) pending.reject(new Error("Retired process failed"));
      else pending.resolve({ stdout: "Retired output", stderr: "", exitCode: 0 });
      await run; await h.flush();
      assert.equal(h.node("workspace-file-editor").value, "Second");
      assert.match(h.node("workspace-file-run-output").label, /example.py/);
      assert.equal(h.node("workspace-file-run-source").text, "/project/scripts/example.py");
      if (failing) assert.match(h.node("workspace-file-run-error").label, /Retired process failed/);
      else assert.equal(h.node("workspace-file-run-text").text, "Retired output");
      assert.equal(h.calls.filter(([command]) => command === "shell_cancel").length, 0);
    } finally { pending.resolve({}); h.unmount(); }
  }
});

test("native failures, nonzero exit codes and timeouts do not announce a successful run", async () => {
  for (const response of [{ stdout: "", stderr: "Failure", exitCode: 3 }, { stdout: "Partial", stderr: "", exit_code: 0, timed_out: true }, { stdout: "Unknown status", stderr: "" }, new Error("Shell unavailable")]) {
    const h = await openScript({ invoke: () => { if (response instanceof Error) throw response; return response; } });
    try {
      await h.dispatch("workspace-file-run");
      assert.equal(h.node("workspace-file-run-status").status, "error");
      assert.equal(h.node("workspace-file-run-status").label, response.timed_out ? "workspaceEditor.runTimedOut" : "workspaceEditor.runFailed");
      assert.equal(h.node("workspace-file-run").disabled, false);
    } finally { h.unmount(); }
  }
});

test("native execution survives switching files while saving and launches only its guarded origin", async () => {
  const writing = Promise.withResolvers(), running = Promise.withResolvers();
  const h = await openScript({ write: async (_command, args) => { await writing.promise; h.files.set(args.path, args.content); return writeResult(args.content); }, invoke: () => running.promise });
  try {
    const origin = h.props.editorRequest;
    const run = h.dispatch("workspace-file-run", sourcePayload("print('Origin')")); await h.flush();
    h.props.editorRequest = { ...origin, id: 5, path: "b.txt" }; h.render(); await h.flush();
    writing.resolve(); await h.flush(); await h.flush();
    const shell = h.calls.find(([command]) => command === "shell_run");
    assert.equal(shell[1].command, 'python -- "example.py"');
    assert.equal(h.node("workspace-file-editor").value, "Second");
    assert.equal(h.node("workspace-file-run-source").text, "/project/scripts/example.py");
    assert.equal(h.files.get("scripts/example.py"), "print('Origin')");
    running.resolve({ stdout: "Origin result", stderr: "", exitCode: 0 }); await run; await h.flush();
    assert.equal(h.node("workspace-file-run-text").text, "Origin result");
  } finally { writing.resolve(); running.resolve({ stdout: "", stderr: "", exitCode: 0 }); h.unmount(); }
});

test("native hidden editors retain running output and recover it when reopened", async () => {
  const pending = Promise.withResolvers(); const h = await openScript({ invoke: () => pending.promise });
  try {
    const original = h.props.editorRequest, run = h.dispatch("workspace-file-run"); await h.flush();
    h.props.editorOpen = false; h.props.editorRequest = null; assert.equal(h.render(), null);
    pending.resolve({ stdout: "Finished while hidden", stderr: "", exitCode: 0 }); await run; await h.flush();
    h.props.editorOpen = true; h.props.editorRequest = { ...original, id: 8 }; h.render(); await h.flush();
    assert.equal(h.node("workspace-file-run-text").text, "Finished while hidden");
    assert.equal(h.node("workspace-file-run-status").status, "completed");
    assert.equal(h.calls.filter(([command]) => command === "shell_run").length, 1);
    assert.equal(h.calls.some(([command]) => command === "shell_cancel"), false);
  } finally { pending.resolve({ stdout: "", stderr: "", exitCode: 0 }); h.unmount(); }
});

test("native old result actions cannot stop or dismiss a newer process on the same surface", async () => {
  const first = Promise.withResolvers(), second = Promise.withResolvers(); let runs = 0;
  const h = await openScript({ invoke: command => command === "shell_run" ? (++runs === 1 ? first.promise : second.promise) : true });
  try {
    const firstRun = h.dispatch("workspace-file-run"); await h.flush();
    const oldStop = h.node("workspace-file-run-result-action").action;
    const oldToolbarStop = h.node("workspace-file-stop").action;
    first.resolve({ stdout: "First", stderr: "", exitCode: 0 }); await firstRun; await h.flush();
    const oldDismiss = h.node("workspace-file-run-dismiss").action;
    await h.dispatch(oldDismiss); h.render();
    const secondRun = h.dispatch("workspace-file-run"); await h.flush();
    assert.equal((await h.dispatch(oldStop)).ok, false); assert.equal((await h.dispatch(oldDismiss)).ok, false);
    assert.equal((await h.dispatch(oldToolbarStop)).ok, false);
    assert.equal(h.calls.some(([command]) => command === "shell_cancel"), false);
    assert.equal(h.node("workspace-file-run-output").current, 1);
    await h.dispatch(h.node("workspace-file-run-result-action").action);
    assert.equal(h.calls.filter(([command]) => command === "shell_cancel").length, 1);
    second.resolve({ stdout: "Second", stderr: "", exitCode: 0, cancelled: true }); await secondRun;
  } finally { first.resolve({ stdout: "", stderr: "", exitCode: 0 }); second.resolve({ stdout: "", stderr: "", exitCode: 0 }); h.unmount(); }
});

test("native Run cannot bypass an actual filesystem conflict and retains its source", async () => {
  const h = await openScript({ write: async () => { throw { code: "stale_file" }; } });
  try {
    await h.dispatch("workspace-file-run", sourcePayload("Unsaved origin")); await h.flush();
    assert.equal(h.calls.some(([command]) => command === "shell_run"), false);
    assert.equal(h.node("workspace-file-editor").value, "Unsaved origin");
    assert.equal(h.node("workspace-file-error").label, "workspaceEditor.conflictMessage");
  } finally { h.unmount(); }
});

test("native editor session metadata retains identity across switches and hide but replaces explicitly closed tabs", async () => {
  const h = harness();
  try {
    await h.flush(); const request = h.props.editorRequest;
    const original = JSON.parse(h.node("workspace-file-editor").text).session;
    h.props.editorRequest = { ...request, id: 2, path: "b.txt" }; h.render(); await h.flush();
    const other = JSON.parse(h.node("workspace-file-editor").text).session;
    assert.notEqual(other.key, original.key); assert.equal(other.scope, original.scope); assert.ok(other.open.includes(original.key));
    h.props.editorOpen = false; h.props.editorRequest = null; h.render();
    h.props.editorOpen = true; h.props.editorRequest = { ...request, id: 3 }; h.render(); await h.flush();
    assert.equal(JSON.parse(h.node("workspace-file-editor").text).session.key, original.key);
    await h.dispatch("workspace-file-close"); h.render(); await h.flush();
    h.props.editorRequest = { ...request, id: 4 }; h.render(); await h.flush();
    const reopened = JSON.parse(h.node("workspace-file-editor").text).session;
    assert.notEqual(reopened.key, original.key); assert.equal(reopened.scope, original.scope); assert.equal(reopened.open.includes(original.key), false);
  } finally { h.unmount(); }
});

test("native run is unavailable for unsupported filenames and formatted previews", async () => {
  const loader = createTsModuleLoader();
  const { runnableWorkspaceFile } = loader.loadModule("src/components/workspace-editor/workspaceEditorRun.ts");
  assert.deepEqual(runnableWorkspaceFile("folder\\中文 script.PY"), { fileName: "中文 script.PY", command: 'python -- "中文 script.PY"', cwd: "folder" });
  assert.equal(runnableWorkspaceFile("folder/attack$(echo).py"), null);
  assert.equal(runnableWorkspaceFile('folder/quote".js'), null);
  assert.equal(runnableWorkspaceFile("main.swift"), null);
  const h = harness();
  try {
    await h.flush(); assert.equal(h.node("workspace-file-run"), undefined);
    assert.equal((await h.dispatch("workspace-file-run")).ok, false);
    h.props.previewOpen = true; h.props.previewRequest = { ...h.props.editorRequest, id: 2, path: "a.py" };
    h.render(); await h.flush(); assert.equal(h.node("workspace-file-run"), undefined);
  } finally { h.unmount(); }
});

test("native editor publishes new location requests without reloading or replacing the same file draft", async () => {
  const h = harness();
  try {
    h.props.editorRequest = { ...h.props.editorRequest, line: 2, column: 3, endLine: 4 }; h.render(); await h.flush();
    const first = h.node("workspace-file-editor");
    assert.equal(first.variant, "workspace-code-editor");
    const { labels, session, find, syntax, ...location } = JSON.parse(first.text);
    assert.equal(syntax.source, first.value);
    assert.equal(find.identity, session.key);
    assert.ok(session.open.includes(session.key));
    assert.deepEqual(location, { request: "1", line: 2, endLine: 4, column: 3 });
    assert.equal(labels.find, "workspaceEditor.find");
    await h.dispatch("workspace-file-editor", "Current draft");
    h.props.editorRequest = { ...h.props.editorRequest, id: 2, line: 1, column: 1 }; h.render();
    assert.equal(h.node("workspace-file-editor").value, "Current draft");
    assert.equal(JSON.parse(h.node("workspace-file-editor").text).request, "2");
    assert.equal(h.calls.filter(([command]) => command.startsWith("fs_read")).length, 1);
    h.props.editorRequest = { ...h.props.editorRequest, id: 3, line: Infinity }; h.render();
    assert.equal(JSON.parse(h.node("workspace-file-editor").text).request, undefined);
  } finally { h.unmount(); }
});

test("HTML preview and source share the guarded draft/save flow on both Apple form factors", async () => {
  for (const compact of [true, false]) {
    const h = harness({ compact });
    h.files.set("output.html", '<!doctype html><head></head><button>Original</button>');
    h.props.previewOpen = true;
    h.props.previewRequest = { ...h.props.editorRequest, path: "output.html", id: 2 };
    h.render();
    await h.flush();
    assert.equal(h.node("workspace-file-rendered").kind, "HTMLPreview");
    assert.ok(h.node("workspace-file-rendered").text.includes("data-xgent-html-preview-bootstrap"));
    assert.equal(h.render().formFactor, compact ? "mobile" : "desktop");
    assert.equal((await h.dispatch("workspace-file-view-mode", "invalid")).ok, false);
    await h.dispatch("workspace-file-view-mode", "source");
    assert.equal(h.node("workspace-file-editor").value, h.files.get("output.html"));
    const draft = '<head></head><button onclick="this.textContent=\'Ready\'">Run</button>';
    await h.dispatch("workspace-file-editor", draft);
    await h.dispatch("workspace-file-view-mode", "preview");
    assert.ok(h.node("workspace-file-rendered").text.includes(draft.slice(13)));
    assert.ok(h.node("workspace-file-unsaved"));
    assert.equal(h.calls.filter(([command]) => command.startsWith("fs_read")).length, 1);
    await h.dispatch("workspace-file-save");
    assert.equal(h.files.get("output.html"), draft);
    assert.equal(h.calls.at(-1)[1].expected_content_hash, "initial");
    assert.equal(h.node("workspace-file-unsaved"), undefined);
    h.unmount();
  }
});

test("Markdown switches between actual Markdown and editable source without discarding unsaved changes", async () => {
  const h = harness(); h.files.set("notes.md", "# Notes\n\n| Task | Status |\n| --- | --- |\n| Report | Done |");
  h.props.previewOpen = true; h.props.previewRequest = { ...h.props.editorRequest, path: "notes.md", id: 2 };
  h.render();
  await h.flush();
  assert.equal(h.node("workspace-file-rendered").kind, "Markdown");
  await h.dispatch("workspace-file-view-mode", "source");
  h.render();
  await h.dispatch("workspace-file-editor", "# Edited");
  h.render();
  await h.dispatch("workspace-file-view-mode", "preview");
  assert.equal(h.node("workspace-file-rendered").text, "# Edited");
  await h.dispatch("workspace-file-close"); assert.equal(h.closed, 0);
  await h.dispatch("workspace-file-confirm-cancel");
  assert.equal(h.node("workspace-file-rendered").text, "# Edited"); h.unmount();
});

test("office previews use the backend MIME and bytes on macOS as well as iOS", async () => {
  for (const compact of [true, false]) for (const [path, mimeType] of [
    ["slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ["converted.ppt", "application/pdf"], ["legacy.doc", "text/html"],
  ]) {
    const data = Buffer.from(mimeType === "text/html" ? "<table><tr><td>Report</td></tr></table>" : "office data").toString("base64");
    const h = harness({ compact, read: (_command, args) => ({ ...readResult(args.path, "extracted text"), data, mimeType }) });
    h.props.previewOpen = true; h.props.previewRequest = { ...h.props.editorRequest, path, id: 2 };
    h.render();
    await h.flush();
    assert.equal(h.node("workspace-file-media").kind, mimeType === "text/html" ? "HTMLPreview" : "MediaPreview");
    assert.equal(h.node("workspace-file-media").value, data);
    assert.equal(h.node("workspace-file-media").language, mimeType);
    assert.equal(h.node("workspace-file-editor"), undefined); h.unmount();
  }
});

test("DOCX keeps a real document preview and routes source edits to the existing document writer", async () => {
  const h = harness({ compact: false, read: (_command, args) => ({ ...readResult(args.path, "Document"), data: Buffer.from("docx bytes").toString("base64") }) });
  h.props.previewOpen = true; h.props.previewRequest = { ...h.props.editorRequest, path: "report.docx", id: 2 };
  h.render();
  await h.flush();
  assert.equal(h.node("workspace-file-media").kind, "MediaPreview");
  await h.dispatch("workspace-file-view-mode", "source");
  h.render();
  await h.dispatch("workspace-file-editor", "Edited document"); h.render(); await h.dispatch("workspace-file-save");
  assert.equal(h.calls.find(([name]) => name === "fs_write_docx_text")[1].expected_content_hash, "initial");
  assert.equal(h.calls.at(-1)[0], "fs_read_workspace_image"); h.unmount();
});

test("native file switches retire reads and native actions from the preceding session", async () => {
  const wait = Promise.withResolvers();
  const h = harness({ read: (_command, args) => args.path === "a.txt" ? wait.promise : readResult(args.path, "Second") });
  assert.ok(h.node("workspace-file-loading"));
  const firstSurface = h.surface;
  h.props.editorRequest = { ...h.props.editorRequest, path: "b.txt", id: 2 };
  h.render(); await h.flush();
  wait.resolve(readResult("a.txt", "Obsolete"));
  await h.flush();
  assert.equal(h.node("workspace-file-editor").value, "Second");
  assert.equal(h.node("workspace-file-title").text, "b.txt");
  assert.equal((await h.dispatch("workspace-file-close", null, firstSurface)).ok, false);
  assert.equal(h.closed, 0);
  h.unmount();
});

test("equivalent request props and locale updates retain the draft without another read", async () => {
  const h = harness(); await h.flush();
  await h.dispatch("workspace-file-editor", "Unsaved"); h.render();
  h.props.editorRequest = { ...h.props.editorRequest }; h.changeLocale();
  await h.flush();
  assert.equal(h.node("workspace-file-editor").value, "Unsaved");
  assert.equal(h.calls.filter(([command]) => command.startsWith("fs_read")).length, 1);
  h.unmount();
});

test("save acknowledgements keep later typing dirty and carry the written version into the next save", async () => {
  const wait = Promise.withResolvers();
  const h = harness({ write: () => wait.promise }); await h.flush();
  await h.dispatch("workspace-file-editor", "Sent snapshot"); h.render();
  const saving = h.dispatch("workspace-file-save"); await Promise.resolve(); h.render();
  await h.dispatch("workspace-file-editor", "Later typing"); h.render();
  wait.resolve(writeResult("Sent snapshot")); await saving; h.render();
  assert.equal(h.node("workspace-file-editor").value, "Later typing");
  assert.ok(h.node("workspace-file-unsaved"));
  h.options.write = undefined;
  await h.dispatch("workspace-file-save"); h.render();
  assert.equal(h.calls.at(-1)[1].content, "Later typing");
  assert.equal(h.calls.at(-1)[1].expected_content_hash, "written");
  assert.equal(h.node("workspace-file-unsaved"), undefined);
  h.unmount();
});

test("save-and-close waits for edits and rejects discard or dismissal while a write is pending", async () => {
  const wait = Promise.withResolvers();
  const h = harness({ write: () => wait.promise }); await h.flush();
  await h.dispatch("workspace-file-editor", "Sent snapshot"); h.render();
  await h.dispatch("workspace-file-close"); h.render();
  assert.equal(h.node("workspace-file-confirm-cancel").destructive, false);
  const saving = h.dispatch("workspace-file-confirm-save"); await Promise.resolve(); h.render();
  for (const action of ["workspace-file-close", "workspace-file-confirm-discard", "workspace-file-confirm-cancel"]) {
    assert.equal((await h.dispatch(action)).ok, false);
  }
  await h.dispatch("workspace-file-editor", "New unsaved typing"); h.render();
  wait.resolve(writeResult("Sent snapshot")); await saving; h.render();
  assert.equal(h.closed, 0);
  assert.ok(h.node("workspace-file-confirmation"));
  await h.dispatch("workspace-file-confirm-discard");
  assert.equal(h.closed, 1);
  h.unmount();
});

test("save-and-reload completes its read after a successful write", async () => {
  const h = harness(); await h.flush();
  await h.dispatch("workspace-file-editor", "Saved before reload"); h.render();
  await h.dispatch("workspace-file-reload"); h.render();
  await h.dispatch("workspace-file-confirm-save"); await h.flush();
  assert.deepEqual(h.calls.map(([command]) => command), ["fs_read_editable_text", "fs_write_text", "fs_read_editable_text"]);
  assert.equal(h.node("workspace-file-editor").value, "Saved before reload");
  assert.equal(h.node("workspace-file-unsaved"), undefined);
  h.unmount();
});

test("DOCX saves refresh preview bytes and retain later edits with returned metadata", async () => {
  const wait = Promise.withResolvers();
  const h = harness({ write: () => wait.promise });
  h.props.editorOpen = false; h.props.previewOpen = true;
  h.props.previewRequest = { ...h.props.editorRequest, path: "report.docx", id: 2 };
  h.render(); await h.flush();
  await h.dispatch("workspace-file-editor", "Written document"); h.render();
  const saving = h.dispatch("workspace-file-save"); await Promise.resolve(); h.render();
  await h.dispatch("workspace-file-editor", "Continued document"); h.render();
  const response = writeResult("Written document"); delete response.totalLines;
  wait.resolve(response); await saving; h.render();
  assert.ok(h.calls.some(([name]) => name === "fs_write_docx_text"));
  assert.equal(h.calls.at(-1)[0], "fs_read_workspace_image");
  assert.equal(h.node("workspace-file-editor").value, "Continued document");
  assert.ok(h.node("workspace-file-unsaved"));
  h.unmount();
});

test("a delayed save-and-close cannot close a subsequently opened file", async () => {
  const wait = Promise.withResolvers();
  const h = harness({ write: () => wait.promise }); await h.flush();
  await h.dispatch("workspace-file-editor", "Saved in background"); h.render();
  await h.dispatch("workspace-file-close"); h.render();
  const saving = h.dispatch("workspace-file-confirm-save");
  await Promise.resolve(); h.render();
  assert.equal(h.calls.at(-1)[0], "fs_write_text", "The old session's write must actually be running");
  h.props.editorRequest = { ...h.props.editorRequest, path: "b.txt", id: 2 };
  h.render(); await h.flush();
  wait.resolve(writeResult("Saved in background")); await saving; h.render();
  assert.equal(h.node("workspace-file-editor").value, "Second");
  assert.equal(h.closed, 0);
  h.unmount();
});

test("write conflicts preserve the draft and prevent save-and-close", async () => {
  const h = harness({ write: async () => { throw { code: "stale_file" }; } }); await h.flush();
  await h.dispatch("workspace-file-editor", "Unsaved after conflict"); h.render();
  await h.dispatch("workspace-file-close"); h.render();
  await h.dispatch("workspace-file-confirm-save"); h.render();
  assert.equal(h.node("workspace-file-error").label, "workspaceEditor.conflictMessage");
  assert.equal(h.node("workspace-file-editor").value, "Unsaved after conflict");
  assert.equal(h.closed, 0);
  h.unmount();
});

test("switching files and request IDs restores each file's independent unsaved text", async () => {
  const h = harness(); await h.flush();
  const a = h.props.editorRequest;
  await h.dispatch("workspace-file-editor", "Draft A"); h.render();
  h.props.editorRequest = { ...a, id: 2, path: "b.txt" }; h.render(); await h.flush();
  await h.dispatch("workspace-file-editor", "Draft B"); h.render();
  h.props.editorRequest = { ...a, id: 3 }; h.render(); await h.flush();
  assert.equal(h.node("workspace-file-editor").value, "Draft A");
  assert.ok(h.node("workspace-file-unsaved"));
  h.props.editorRequest = { ...a, id: 4, path: "b.txt" }; h.render(); await h.flush();
  assert.equal(h.node("workspace-file-editor").value, "Draft B");
  assert.equal(h.calls.filter(([command]) => command.startsWith("fs_write")).length, 0);
  h.unmount();
});

test("draft identity isolates both project and workdir while preview and editor share the same file", async () => {
  const h = harness(); await h.flush();
  const a = h.props.editorRequest;
  await h.dispatch("workspace-file-editor", "Original workspace draft"); h.render();
  for (const differentScope of [{ projectPathKey: "/other" }, { workdir: "/other" }]) {
    h.props.editorRequest = { ...a, ...differentScope, id: h.props.editorRequest.id + 1 };
    h.render(); await h.flush();
    assert.equal(h.node("workspace-file-editor").value, "Original");
    assert.equal(h.node("workspace-file-unsaved"), undefined);
  }
  h.props.editorOpen = false; h.props.previewOpen = true;
  h.props.previewRequest = { ...a, id: 5 }; h.render(); await h.flush();
  assert.equal(h.node("workspace-file-editor").value, "Original workspace draft");
  h.unmount();
});

test("restored drafts retain the original write guard after an external file modification", async () => {
  const h = harness(); await h.flush();
  const a = h.props.editorRequest;
  await h.dispatch("workspace-file-editor", "Local draft"); h.render();
  h.props.editorRequest = { ...a, path: "b.txt", id: 2 }; h.render(); await h.flush();
  h.options.read = (_command, args) => ({ ...readResult(args.path, "External edit"), contentHash: "external", mtimeMs: 99 });
  h.props.editorRequest = { ...a, id: 3 }; h.render(); await h.flush();
  assert.equal(h.node("workspace-file-editor").value, "Local draft");
  assert.equal(h.node("workspace-file-error"), undefined);
  assert.equal(h.calls.filter(([command]) => command.startsWith("fs_read")).length, 2);
  h.options.write = async () => { throw { code: "stale_file" }; };
  await h.dispatch("workspace-file-save"); h.render();
  assert.equal(h.calls.at(-1)[1].expected_content_hash, "initial");
  assert.equal(h.calls.at(-1)[1].expected_mtime_ms, 10);
  assert.equal(h.node("workspace-file-error").label, "workspaceEditor.conflictMessage");
  assert.equal(h.node("workspace-file-editor").value, "Local draft");
  h.unmount();
});

test("explicit discard removes the cached draft for both closing and reloading", async () => {
  for (const action of ["workspace-file-close", "workspace-file-reload"]) {
    const h = harness(); await h.flush();
    await h.dispatch("workspace-file-editor", "Discard me"); h.render();
    await h.dispatch(action); h.render();
    await h.dispatch("workspace-file-confirm-discard"); await h.flush();
    h.props.editorOpen = false; h.render();
    h.props.editorOpen = true;
    h.props.editorRequest = { ...h.props.editorRequest, id: 2 }; h.render(); await h.flush();
    assert.equal(h.node("workspace-file-editor").value, "Original");
    assert.equal(h.node("workspace-file-unsaved"), undefined);
    assert.equal(h.closed, action.endsWith("close") ? 1 : 0);
    h.unmount();
  }
});

test("reopening a file waits for its background write then preserves later edits with the written guard", async () => {
  const wait = Promise.withResolvers();
  const h = harness({ write: () => wait.promise }); await h.flush();
  const a = h.props.editorRequest;
  await h.dispatch("workspace-file-editor", "Written snapshot"); h.render();
  const saving = h.dispatch("workspace-file-save"); await Promise.resolve(); h.render();
  await h.dispatch("workspace-file-editor", "Later draft"); h.render();
  h.props.editorRequest = { ...a, path: "b.txt", id: 2 }; h.render(); await h.flush();
  h.props.editorRequest = { ...a, id: 3 }; h.render(); await h.flush();
  assert.ok(h.node("workspace-file-loading"));
  assert.equal(h.calls.filter(([command, args]) => command.startsWith("fs_read") && args.path === "a.txt").length, 1);
  h.options.read = (_command, args) => ({ ...readResult(args.path, "Written snapshot"), mtimeMs: 11, contentHash: "written" });
  wait.resolve(writeResult("Written snapshot")); await saving; await h.flush();
  assert.equal(h.node("workspace-file-editor").value, "Later draft");
  assert.ok(h.node("workspace-file-unsaved"));
  assert.equal(h.node("workspace-file-error"), undefined);
  h.options.write = undefined;
  await h.dispatch("workspace-file-save"); h.render();
  assert.equal(h.calls.at(-1)[1].expected_content_hash, "written");
  assert.equal(h.calls.at(-1)[1].content, "Later draft");
  h.unmount();
});

test("typing back to the old baseline during a save remains a recoverable draft after switching", async () => {
  const wait = Promise.withResolvers();
  const h = harness({ write: () => wait.promise }); await h.flush();
  const a = h.props.editorRequest;
  await h.dispatch("workspace-file-editor", "Written snapshot"); h.render();
  const saving = h.dispatch("workspace-file-save"); await Promise.resolve(); h.render();
  await h.dispatch("workspace-file-editor", "Original"); h.render();
  h.props.editorRequest = { ...a, path: "b.txt", id: 2 }; h.render(); await h.flush();
  h.options.read = (_command, args) => ({ ...readResult(args.path, "Written snapshot"), mtimeMs: 11, contentHash: "written" });
  wait.resolve(writeResult("Written snapshot")); await saving;
  h.props.editorRequest = { ...a, id: 3 }; h.render(); await h.flush();
  assert.equal(h.node("workspace-file-editor").value, "Original");
  assert.ok(h.node("workspace-file-unsaved"));
  h.unmount();
});

test("cached tabs retain saved source across a failed refresh and explicit reload reads the current disk", async () => {
  const h = harness(); await h.flush();
  const a = h.props.editorRequest;
  await h.dispatch("workspace-file-editor", "Recoverable draft"); h.render();
  h.props.editorRequest = { ...a, path: "b.txt", id: 2 }; h.render(); await h.flush();
  h.options.read = async () => { throw new Error("Unavailable"); };
  h.props.editorRequest = { ...a, id: 3 }; h.render(); await h.flush();
  assert.equal(h.node("workspace-file-editor").value, "Recoverable draft");
  await h.dispatch("workspace-file-reload");
  assert.ok(h.node("workspace-file-confirmation"));
  await h.dispatch("workspace-file-confirm-save"); await h.flush();
  assert.equal(h.node("workspace-file-error").label, "Unavailable");
  assert.equal(h.files.get("a.txt"), "Recoverable draft");
  h.options.read = undefined;
  await h.dispatch(editorTab(h, "b.txt").children[0].action); await h.flush();
  await h.dispatch(editorTab(h, "a.txt").children[0].action); await h.flush();
  assert.equal(h.node("workspace-file-editor").value, "Recoverable draft");
  assert.equal(h.node("workspace-file-unsaved"), undefined);
  h.files.set("a.txt", "External contents");
  await h.dispatch("workspace-file-reload"); await h.flush();
  assert.equal(h.node("workspace-file-editor").value, "External contents");
  h.unmount();
});

function sheetData() {
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([["First", "Total"], ["Old baseline", 12]]), "Report");
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([["Other"]]), "Second");
  return Buffer.from(write(workbook, { type: "array", bookType: "xlsx" })).toString("base64");
}

async function openSpreadsheet(options = {}) {
  const disk = { data: sheetData(), contentHash: "initial", mtimeMs: 10 };
  const h = harness({ ...options, read: (_command, args) => args.path === "sheet.xlsx" || args.path === "sheet.xls"
    ? { ...readResult(args.path, ""), content: null, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ...disk }
    : readResult(args.path, "Second") });
  const saveBinary = async (_command, args) => {
    if (_command !== "fs_write_binary") return { path: args.path, mode: args.mode, kind: "file" };
    disk.data = args.content_base64; disk.contentHash = "written"; disk.mtimeMs = 11;
    return { path: args.path, ...disk, bytesWritten: Buffer.from(disk.data, "base64").length };
  };
  h.options.write = saveBinary;
  h.props.previewOpen = true; h.props.previewRequest = { ...h.props.editorRequest, id: 2, path: options.path ?? "sheet.xlsx" };
  h.render(); await h.flush();
  return { ...h, h, disk, saveBinary };
}
const cellEdit = (sheet, row, column, value) => JSON.stringify({ sheet, row, column, value });
const tableOf = h => JSON.parse(h.node("workspace-file-spreadsheet").value);

test("native XLSX editors on both Apple form factors save actual cells across worksheets", async () => {
  for (const compact of [true, false]) {
    const { h, disk } = await openSpreadsheet({ compact });
    assert.equal(h.node("workspace-file-spreadsheet").kind, "SpreadsheetGrid");
    assert.equal(h.node("workspace-file-save").disabled, true);
    await h.dispatch("workspace-file-spreadsheet", cellEdit("Report", 1, 0, "Edited")); h.render();
    await h.dispatch("workspace-file-sheets", "Second"); h.render();
    assert.equal(tableOf(h).rows[0].cells[0].value, "Other");
    await h.dispatch("workspace-file-spreadsheet", cellEdit("Second", 0, 0, "")); h.render();
    await h.dispatch("workspace-file-save"); h.render();
    const saved = read(Buffer.from(disk.data, "base64"), { type: "buffer" });
    assert.equal(saved.Sheets.Report.A2.v, "Edited"); assert.equal(saved.Sheets.Second.A1.v, "");
    const call = h.calls.find(([name]) => name === "fs_write_binary");
    assert.equal(call[1].expected_content_hash, "initial"); assert.equal(call[1].expected_mtime_ms, 10);
    assert.equal(h.node("workspace-file-unsaved"), undefined);
    assert.equal(h.node("workspace-file-save").disabled, true);
    assert.equal(h.node("workspace-file-media"), undefined); h.unmount();
  }
});

test("native spreadsheet edits use immediate drafts and dirty close guards before rendering", async () => {
  const { h } = await openSpreadsheet();
  await h.dispatch("workspace-file-spreadsheet", cellEdit("Report", 0, 0, "A"));
  await h.dispatch("workspace-file-spreadsheet", cellEdit("Report", 0, 0, "AB"));
  await h.dispatch("workspace-file-close");
  assert.equal(h.closed, 0); assert.ok(h.node("workspace-file-confirmation"));
  assert.equal(tableOf(h).rows[0].cells[0].value, "AB");
  await h.dispatch("workspace-file-confirm-discard"); assert.equal(h.closed, 1); h.unmount();
});

test("native XLS is read only and invalid or retired worksheet patches never become writes", async () => {
  const legacy = await openSpreadsheet({ path: "sheet.xls" });
  assert.equal(tableOf(legacy.h).editable, false);
  assert.equal(legacy.h.node("workspace-file-save"), undefined);
  assert.equal((await legacy.h.dispatch("workspace-file-spreadsheet", cellEdit("Report", 0, 0, "Changed"))).ok, false);
  legacy.h.unmount();
  const { h } = await openSpreadsheet();
  for (const value of ["{", cellEdit("Missing", 0, 0, "X"), cellEdit("Report", 3, 0, "X"), cellEdit("Report", 0, 3, "X")]) {
    assert.equal((await h.dispatch("workspace-file-spreadsheet", value)).ok, false);
  }
  await h.dispatch("workspace-file-sheets", "Second");
  assert.equal((await h.dispatch("workspace-file-spreadsheet", cellEdit("Report", 0, 0, "Retired"))).ok, false);
  assert.equal((await h.dispatch("workspace-file-spreadsheet", cellEdit("Second", 0, 0, "Too early"))).ok, false);
  assert.equal(h.calls.some(([name]) => name.startsWith("fs_write")), false); h.unmount();
});

test("spreadsheet save acknowledgements preserve later edits including a return to the old disk value", async () => {
  const { h, saveBinary, disk } = await openSpreadsheet();
  const wait = Promise.withResolvers();
  h.options.write = async (command, args) => { await wait.promise; return saveBinary(command, args); };
  await h.dispatch("workspace-file-spreadsheet", cellEdit("Report", 1, 0, "Sent")); h.render();
  const saving = h.dispatch("workspace-file-save"); await Promise.resolve(); h.render();
  await h.dispatch("workspace-file-spreadsheet", cellEdit("Report", 1, 0, "Old baseline")); h.render();
  await h.dispatch("workspace-file-sheets", "Second"); h.render();
  await h.dispatch("workspace-file-spreadsheet", cellEdit("Second", 0, 0, "Later sheet")); h.render();
  wait.resolve(); await saving; h.render();
  assert.ok(h.node("workspace-file-unsaved"));
  assert.equal(tableOf(h).rows[0].cells[0].value, "Later sheet");
  await h.dispatch("workspace-file-sheets", "Report"); h.render();
  assert.equal(tableOf(h).rows[1].cells[0].value, "Old baseline");
  h.options.write = saveBinary;
  await h.dispatch("workspace-file-save"); h.render();
  assert.equal(h.calls.at(-1)[1].expected_content_hash, "written");
  const saved = read(Buffer.from(disk.data, "base64"), { type: "buffer" });
  assert.equal(saved.Sheets.Report.A2.v, "Old baseline"); assert.equal(saved.Sheets.Second.A1.v, "Later sheet");
  assert.equal(h.node("workspace-file-unsaved"), undefined); h.unmount();
});

test("reopening native spreadsheets waits for a background save and restores later cells with the new guard", async () => {
  const { h, saveBinary } = await openSpreadsheet();
  const wait = Promise.withResolvers(); const first = h.props.previewRequest;
  h.options.write = async (command, args) => { await wait.promise; return saveBinary(command, args); };
  await h.dispatch("workspace-file-spreadsheet", cellEdit("Report", 0, 0, "Written")); h.render();
  const saving = h.dispatch("workspace-file-save"); await Promise.resolve(); h.render();
  await h.dispatch("workspace-file-spreadsheet", cellEdit("Report", 0, 0, "Later draft")); h.render();
  const oldSurface = h.surface;
  h.props.previewRequest = { ...first, id: 3, path: "b.txt" }; h.render(); await h.flush();
  assert.equal((await h.dispatch("workspace-file-spreadsheet", cellEdit("Report", 0, 0, "Retired"), oldSurface)).ok, false);
  h.props.previewRequest = { ...first, id: 4 }; h.render(); await h.flush();
  assert.ok(h.node("workspace-file-loading"));
  wait.resolve(); await saving; await h.flush();
  assert.equal(tableOf(h).rows[0].cells[0].value, "Later draft");
  assert.equal(h.node("workspace-file-error"), undefined); assert.ok(h.node("workspace-file-unsaved"));
  h.options.write = saveBinary; await h.dispatch("workspace-file-save"); h.render();
  assert.equal(h.calls.at(-1)[1].expected_content_hash, "written"); h.unmount();
});

test("external spreadsheet changes preserve unsaved cells and reject save-and-close with the original guard", async () => {
  const { h, disk } = await openSpreadsheet(); const first = h.props.previewRequest;
  await h.dispatch("workspace-file-spreadsheet", cellEdit("Report", 0, 0, "Local")); h.render();
  h.props.previewRequest = { ...first, path: "b.txt", id: 3 }; h.render(); await h.flush();
  disk.contentHash = "external"; disk.mtimeMs = 99;
  h.props.previewRequest = { ...first, id: 4 }; h.render(); await h.flush();
  assert.equal(tableOf(h).rows[0].cells[0].value, "Local");
  assert.equal(h.node("workspace-file-error").label, "workspaceEditor.conflictMessage");
  h.options.write = async () => { throw { code: "stale_file" }; };
  await h.dispatch("workspace-file-close"); h.render(); await h.dispatch("workspace-file-confirm-save"); h.render();
  assert.equal(h.calls.at(-1)[1].expected_content_hash, "initial"); assert.equal(h.closed, 0);
  assert.equal(tableOf(h).rows[0].cells[0].value, "Local");
  await h.dispatch("workspace-file-confirm-discard"); assert.equal(h.closed, 1); h.unmount();
});

test("maximum spreadsheet view uses a compact document instead of exceeding native node limits", async () => {
  const { h, disk } = await openSpreadsheet();
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, { A1: { t: "s", v: "First" }, CE251: { t: "s", v: "Outside" }, "!ref": "A1:CE251" }, "Large");
  disk.data = Buffer.from(write(workbook, { type: "array", bookType: "xlsx" })).toString("base64");
  await h.dispatch("workspace-file-reload"); await h.flush();
  assert.equal(tableOf(h).rows.length, 250); assert.equal(tableOf(h).rows[0].cells.length, 80);
  assert.equal(h.node("workspace-file-spreadsheet-limit").text, "workspaceFilePreview.truncated");
  const count = nodes => nodes.reduce((total, node) => total + 1 + count(node.children ?? []), 0);
  assert.ok(count(h.render().nodes) < 30); h.unmount();
});

async function openAnnotatedDocument(options = {}) {
  const format = options.format ?? "pdf";
  let bytes;
  if (format === "pdf") {
    const pdf = await PDFDocument.create(); pdf.addPage([400, 500]); pdf.addPage([600, 700]); bytes = await pdf.save();
  } else bytes = await presentationFixture(JSZip);
  const disk = { data: Buffer.from(bytes).toString("base64"), contentHash: "initial", mtimeMs: 10 };
  const path = `report.${format}`;
  const mimeType = options.mimeType ?? (format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  const h = harness({ compact: options.compact, presentation: options.presentation,
    read: (_command, args) => args.path === path
      ? { ...readResult(path, ""), content: null, mimeType, ...disk }
      : readResult(args.path, "Second") });
  const saveBinary = async (_command, args) => {
    disk.data = args.content_base64; disk.contentHash = "written"; disk.mtimeMs = 11;
    return { path: args.path, ...disk, bytesWritten: Buffer.from(disk.data, "base64").length };
  };
  h.options.write = saveBinary;
  h.props.previewOpen = true; h.props.previewRequest = { ...h.props.editorRequest, path, id: 2 };
  h.render(); await h.flush();
  return { h, disk, saveBinary };
}

test("native PPTX titles edit and save with version guards on both form factors", async () => {
  const fields = await readPresentationInBrowser(await presentationFixture(JSZip));
  for (const compact of [true, false]) {
    const { h, disk } = await openAnnotatedDocument({ format: "pptx", compact, presentation: {
      readPresentationText: async () => fields, writePresentationText: editPresentationInBrowser,
    } });
    try {
      await h.flush();
      await h.dispatch("workspace-file-view-mode", "presentation");
      const input = h.node(`workspace-file-pptx:${fields[0].id}`);
      assert.equal(input.value, fields[0].text);
      await h.dispatch(input.action, "Edited title"); h.render();
      assert.ok(h.node("workspace-file-unsaved"));
      assert.equal((await h.dispatch("workspace-file-save")).ok, true);
      assert.equal(h.node("workspace-file-error"), undefined);
      const written = h.calls.find(([command]) => command === "fs_write_binary")[1];
      assert.equal(written.expected_content_hash, "initial"); assert.equal(written.expected_mtime_ms, 10);
      assert.equal((await readPresentationInBrowser(Buffer.from(disk.data, "base64")))[0].text, "Edited title");
      assert.equal(h.node("workspace-file-unsaved"), undefined);
      await h.dispatch("workspace-file-view-mode", "preview"); h.render();
      assert.equal((await h.dispatch(input.action, "Retired input")).ok, false);
    } finally { h.unmount(); }
  }
});

test("native PPTX saves retain newer drafts and write failures preserve pending titles", async () => {
  const fields = await readPresentationInBrowser(await presentationFixture(JSZip));
  const { h, disk, saveBinary } = await openAnnotatedDocument({ format: "pptx", presentation: {
    readPresentationText: async () => fields, writePresentationText: editPresentationInBrowser,
  } });
  const started = Promise.withResolvers(), release = Promise.withResolvers();
  try {
    await h.flush(); await h.dispatch("workspace-file-view-mode", "presentation"); h.render();
    const action = h.node(`workspace-file-pptx:${fields[0].id}`).action;
    await h.dispatch(action, "First save"); h.render();
    h.options.write = async (command, args) => { started.resolve(); await release.promise; return saveBinary(command, args); };
    const saving = h.dispatch("workspace-file-save"); await started.promise; h.render();
    await h.dispatch(action, ""); h.render(); release.resolve(); await saving; h.render();
    assert.equal((await readPresentationInBrowser(Buffer.from(disk.data, "base64")))[0].text, "First save");
    assert.equal(h.node(`workspace-file-pptx:${fields[0].id}`).value, "");
    assert.ok(h.node("workspace-file-unsaved"));
    h.options.write = async () => { throw { code: "stale_file" }; };
    await h.dispatch("workspace-file-save"); h.render();
    assert.ok(h.node("workspace-file-error")); assert.ok(h.node("workspace-file-unsaved"));
    assert.equal(h.node(`workspace-file-pptx:${fields[0].id}`).value, "");
  } finally { release.resolve(); h.unmount(); }
});

async function openImage(options = {}) {
  const disk = new Map(["a.png", "b.png"].map(path => [path, { data: imageFixture().toString("base64"), contentHash: "initial", mtimeMs: 10 }]));
  const h = harness({ ...options, read: (_command, args) => disk.has(args.path)
    ? { ...disk.get(args.path), path: args.path, mimeType: options.mimeType ?? "image/png", sizeBytes: imageFixture().length, content: null }
    : readResult(args.path, "Second") });
  const saveBinary = async (_command, args) => {
    if (_command !== "fs_write_binary") return { path: args.path, mode: args.mode, kind: "file" };
    const next = { data: args.content_base64, contentHash: "written", mtimeMs: 11 };
    disk.set(args.path, next); return { ...next, path: args.path, bytesWritten: Buffer.from(next.data, "base64").length };
  };
  h.options.write = saveBinary;
  h.props.previewOpen = true; h.props.previewRequest = { ...h.props.editorRequest, id: 2, path: "a.png", imagePaths: ["a.png", "b.png"] };
  h.render(); await h.flush();
  return { h, disk, saveBinary };
}

test("native image views on both form factors save the latest angle through the real raster implementation", async () => {
  for (const compact of [true, false]) {
    const { h, disk } = await openImage({ compact });
    assert.equal(h.node("workspace-file-media").variant, "workspace-image-preview");
    assert.equal(h.node("workspace-file-image-previous").disabled, true);
    assert.equal(h.node("workspace-file-image-next").disabled, false);
    await h.dispatch("workspace-file-image-rotation", 90);
    const saved = await h.dispatch("workspace-file-image-save", 180);
    assert.equal(saved.ok, true);
    assert.deepEqual(pngPixels(Buffer.from(disk.get("a.png").data, "base64")).pixels, pngPixels(imageFixture()).pixels.toReversed());
    assert.equal(h.node("workspace-file-image-rotation").value, 180);
    assert.equal(h.node("workspace-file-media").current, 180);
    assert.equal(h.node("workspace-file-unsaved"), undefined);
    assert.equal(h.calls.at(-1)[1].expected_content_hash, "initial");
    assert.equal(!!h.node("workspace-file-open"), !compact); h.unmount();
  }
});

test("native image save preserves a later turn and the next save rotates only the remaining angle", async () => {
  const { h, disk, saveBinary } = await openImage(), wait = Promise.withResolvers();
  h.options.write = async (command, args) => { await wait.promise; return saveBinary(command, args); };
  await h.dispatch("workspace-file-image-rotation", 90); h.render();
  const saving = h.dispatch("workspace-file-image-save", 90); await Promise.resolve(); h.render();
  await h.dispatch("workspace-file-image-rotation", 180); h.render();
  wait.resolve(); await saving; h.render();
  assert.equal(h.node("workspace-file-error")?.label, undefined);
  assert.equal(h.node("workspace-file-image-rotation").value, 180);
  assert.equal(h.node("workspace-file-media").current, 90);
  assert.ok(h.node("workspace-file-unsaved"));
  h.options.write = saveBinary; await h.dispatch("workspace-file-image-save", 180); h.render();
  assert.equal(h.node("workspace-file-error")?.label, undefined);
  assert.equal(h.calls.filter(([command]) => command === "fs_write_binary").length, 2);
  assert.deepEqual(pngPixels(Buffer.from(disk.get("a.png").data, "base64")).pixels, pngPixels(imageFixture()).pixels.toReversed());
  assert.equal(h.calls.at(-1)[1].expected_content_hash, "written"); h.unmount();
});

test("native image navigation confirms unsaved changes and isolates file sessions and retired callbacks", async () => {
  const { h } = await openImage();
  await h.dispatch("workspace-file-image-rotation", 90);
  await h.dispatch("workspace-file-image-next"); h.render();
  assert.ok(h.node("workspace-file-confirmation"));
  await h.dispatch("workspace-file-confirm-cancel");
  assert.equal(h.node("workspace-file-title").text, "a.png");
  await h.dispatch("workspace-file-image-next"); h.render();
  const oldSurface = h.surface;
  await h.dispatch("workspace-file-confirm-discard"); h.render(); await h.flush();
  assert.equal(h.node("workspace-file-title").text, "b.png");
  assert.equal(h.node("workspace-file-image-rotation").value, 0);
  assert.equal((await h.dispatch("workspace-file-image-rotation", 180, oldSurface)).ok, false);
  await h.dispatch("workspace-file-image-previous"); h.render(); await h.flush();
  assert.equal(h.node("workspace-file-title").text, "a.png");
  assert.equal(h.node("workspace-file-image-rotation").value, 0); h.unmount();
});

test("native image save-before-switch writes the current angle and keeps file version guards", async () => {
  const { h, disk } = await openImage();
  await h.dispatch("workspace-file-image-rotation", 90);
  await h.dispatch("workspace-file-image-next"); h.render();
  await h.dispatch("workspace-file-confirm-save", 180); h.render(); await h.flush();
  assert.equal(h.node("workspace-file-title").text, "b.png");
  assert.deepEqual(pngPixels(Buffer.from(disk.get("a.png").data, "base64")).pixels, pngPixels(imageFixture()).pixels.toReversed());
  assert.equal(pngPixels(Buffer.from(disk.get("b.png").data, "base64")).height, 3); h.unmount();
});

test("native read-only or mismatched image MIME cannot write and conflicts preserve rotation drafts", async () => {
  const readonly = await openImage({ mimeType: "image/gif" });
  await readonly.h.dispatch("workspace-file-image-rotation", 90);
  assert.equal(readonly.h.node("workspace-file-image-save"), undefined);
  assert.equal(readonly.h.node("workspace-file-save"), undefined);
  assert.equal(readonly.h.node("workspace-file-unsaved"), undefined); readonly.h.unmount();
  const { h } = await openImage();
  h.options.write = async () => { throw { code: "stale_file" }; };
  await h.dispatch("workspace-file-image-rotation", 90);
  await h.dispatch("workspace-file-close"); h.render();
  await h.dispatch("workspace-file-confirm-save", 180); h.render();
  assert.equal(h.closed, 0); assert.equal(h.node("workspace-file-image-rotation").value, 180);
  assert.equal(h.node("workspace-file-error").label, "workspaceEditor.conflictMessage"); h.unmount();
});

test("native file menus route desktop open, chooser and reveal to the actual scoped FS command", async () => {
  const { h } = await openImage({ compact: false });
  for (const mode of ["open", "choose", "reveal"]) {
    await h.dispatch("workspace-file-open", mode);
    assert.deepEqual(h.calls.at(-1), ["fs_open_workspace_path", { workdir: "/project", path: "a.png", mode }]);
  }
  assert.equal((await h.dispatch("workspace-file-open", "app:unknown")).ok, false);
  h.unmount();
});

test("native desktop file menus discover actual handlers and reserve scans and launches before rendering", async () => {
  const scan = Promise.withResolvers(), opening = Promise.withResolvers();
  const id = "macos:file:///Applications/Editor%20中文.app/";
  const h = harness({ compact: false, applications: () => scan.promise, write: () => opening.promise });
  try {
    await h.flush();
    const first = h.dispatch("workspace-file-open", "$refresh");
    const duplicate = h.dispatch("workspace-file-open", "$refresh");
    await h.flush();
    assert.equal(h.calls.filter(([command]) => command === "fs_file_applications").length, 1);
    assert.ok(h.node("workspace-file-open").options.some(option => option.value === "$loading" && option.disabled));
    scan.resolve([{ id, label: "Editor 中文" }]); await Promise.all([first, duplicate]);
    // The existing handler must accept a freshly discovered ID before a publication/render.
    const launch = h.dispatch("workspace-file-open", `app:${id}`);
    const repeated = h.dispatch("workspace-file-open", `app:${id}`);
    await h.flush();
    assert.equal(h.calls.filter(([command]) => command === "fs_open_workspace_path").length, 1);
    assert.deepEqual(h.calls.at(-1)[1], { workdir: "/project", path: "a.txt", mode: `app:${id}` });
    assert.equal(h.node("workspace-file-open").disabled, true);
    opening.resolve({}); await Promise.all([launch, repeated]); await h.flush();
    assert.equal(h.node("workspace-file-open").disabled, false);
    assert.ok(h.node("workspace-file-open").options.some(option => option.value === `app:${id}` && option.label === "Editor 中文"));
  } finally { scan.resolve([]); opening.resolve({}); h.unmount(); }
});

test("native application discovery failures preserve known handlers and can be retried", async () => {
  const h = harness({ compact: false, applications: () => [{ id: "editor", label: "Editor" }] });
  try {
    await h.flush(); await h.dispatch("workspace-file-open", "$refresh"); h.render();
    h.options.applications = () => { throw new Error("Launch Services unavailable"); };
    await h.dispatch("workspace-file-open", "$refresh"); h.render();
    assert.match(h.node("workspace-file-error").label, /Launch Services unavailable/);
    assert.ok(h.node("workspace-file-open").options.some(option => option.value === "app:editor"));
    h.options.applications = () => [{ id: "replacement", label: "Replacement" }];
    await h.dispatch("workspace-file-open", "$refresh"); h.render();
    assert.equal((await h.dispatch("workspace-file-open", "app:editor")).ok, false);
    assert.ok(h.node("workspace-file-open").options.some(option => option.value === "app:replacement"));
  } finally { h.unmount(); }
});

test("retired native discovery cannot populate a new file and mobile omits desktop application operations", async () => {
  const scan = Promise.withResolvers();
  const h = harness({ compact: false, applications: () => scan.promise });
  try {
    await h.flush(); const oldSurface = h.surface;
    const query = h.dispatch("workspace-file-open", "$refresh"); await h.flush();
    h.props.editorRequest = { ...h.props.editorRequest, path: "b.txt", id: 2 }; h.render(); await h.flush();
    scan.resolve([{ id: "old", label: "Old" }]); await query; await h.flush();
    assert.equal(h.node("workspace-file-open").options.some(option => option.value === "app:old"), false);
    assert.equal((await h.dispatch("workspace-file-open", "open", oldSurface)).ok, false);
    assert.equal(h.calls.filter(([command]) => command === "fs_open_workspace_path").length, 0);
  } finally { scan.resolve([]); h.unmount(); }
  const mobile = harness({ compact: true });
  try {
    await mobile.flush(); assert.equal(mobile.node("workspace-file-open"), undefined);
    assert.equal((await mobile.dispatch("workspace-file-open", "$refresh")).ok, false);
    assert.equal(mobile.calls.filter(([command]) => command === "fs_file_applications").length, 0);
  } finally { mobile.unmount(); }
});
test("native Office previews omit annotation controls and reject synthetic annotation saves", async () => {
  const { h, disk } = await openAnnotatedDocument({ format: "pptx" });
  try {
    const original = disk.data;
    assert.deepEqual(h.node("workspace-file-view-mode").options.map(option => option.value), ["preview", "presentation"]);
    assert.equal(h.node("workspace-file-save").disabled, true);
    assert.equal((await h.dispatch("workspace-file-view-mode", "annotations")).ok, false);
    assert.equal((await h.dispatch("workspace-file-save", JSON.stringify({ text: "Unrequested note", page: 2 }))).ok, false);
    assert.equal(disk.data, original);
    assert.equal(h.calls.some(([command]) => command === "fs_write_binary"), false);
  } finally { h.unmount(); }
});

test("converted or unsupported document MIME types do not expose a writer for the original Office path", async () => {
  const { h } = await openAnnotatedDocument({ format: "pptx", mimeType: "application/pdf" });
  assert.equal(h.node("workspace-file-view-mode"), undefined);
  assert.equal(h.node("workspace-file-save"), undefined);
  assert.equal((await h.dispatch("workspace-file-save", JSON.stringify({ text: "Do not overwrite PPTX with PDF", page: 1 }))).ok, false);
  h.unmount();
});


test("native PDF previews omit standalone notes and synthetic note actions on both form factors", async () => {
  for (const compact of [true, false]) {
    const { h, disk } = await openAnnotatedDocument({ format: "pdf", compact });
    try {
      const original = disk.data;
      assert.equal(h.node("workspace-file-view-mode"), undefined);
      assert.equal(h.node("workspace-file-annotation-text"), undefined);
      assert.equal(h.node("workspace-file-save"), undefined);
      assert.equal((await h.dispatch("workspace-file-annotation-text", "Unused note")).ok, false);
      assert.equal(disk.data, original);
      assert.equal(h.calls.some(([command]) => command === "fs_write_binary"), false);
    } finally { h.unmount(); }
  }
});
