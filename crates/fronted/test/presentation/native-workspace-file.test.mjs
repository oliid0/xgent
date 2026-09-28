import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function harness(options = {}) {
  const calls = [];
  const files = new Map([["a.txt", "Original"], ["b.txt", "Second"], ["report.docx", "Document"]]);
  let frame;
  const parent = { state: [], cursor: 0 };
  let sequence = 0;
  let request = 0;
  let closed = 0;
  let translate = key => key;
  const same = (a, b) => a?.length === b?.length && a.every((item, index) => Object.is(item, b[index]));
  const loader = createTsModuleLoader({ mocks: {
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
    "../lib/runtimePlatform": { isNativeMobileRuntime: () => true },
    "./NativeSurface": { NativeSurface: "NativeSurface" },
    "./nativeTheme": { createNativePresentationTheme: () => undefined },
    "../lib/tools/fsBackend": {
      isFsBackendError: error => typeof error?.code === "string",
      invokeFs: async (command, args) => {
        calls.push([command, { ...args }]);
        if (command.startsWith("fs_read")) {
          if (options.read) return options.read(command, args);
          return readResult(args.path, files.get(args.path) ?? "");
        }
        if (options.write) return options.write(command, args);
        files.set(args.path, args.content);
        return writeResult(args.content);
      },
    },
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
    parent.cursor = 0;
    const element = NativeWorkspaceFilePage(props);
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
    return visit(render().nodes).find(item => item.id === id);
  };
  render();
  return { props, options, calls, files, render, node, dispatch, unmount,
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

test("DOCX saves use returned metadata and retain edits without reloading the document", async () => {
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
  assert.equal(h.calls.at(-1)[0], "fs_write_docx_text");
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
  assert.equal(h.node("workspace-file-error").label, "workspaceEditor.conflictMessage");
  h.options.write = async () => { throw { code: "stale_file" }; };
  await h.dispatch("workspace-file-save"); h.render();
  assert.equal(h.calls.at(-1)[1].expected_content_hash, "initial");
  assert.equal(h.calls.at(-1)[1].expected_mtime_ms, 10);
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

test("a failed reopen does not erase a draft and matching disk contents clear it", async () => {
  const h = harness(); await h.flush();
  const a = h.props.editorRequest;
  await h.dispatch("workspace-file-editor", "Recoverable draft"); h.render();
  h.props.editorRequest = { ...a, path: "b.txt", id: 2 }; h.render(); await h.flush();
  h.options.read = async () => { throw new Error("Unavailable"); };
  h.props.editorRequest = { ...a, id: 3 }; h.render(); await h.flush();
  assert.equal(h.node("workspace-file-error").label, "Unavailable");
  h.options.read = undefined;
  h.props.editorRequest = { ...a, id: 4 }; h.render(); await h.flush();
  assert.equal(h.node("workspace-file-editor").value, "Recoverable draft");
  h.files.set("a.txt", "Recoverable draft");
  h.props.editorRequest = { ...a, id: 5 }; h.render(); await h.flush();
  assert.equal(h.node("workspace-file-unsaved"), undefined);
  h.unmount();
});
