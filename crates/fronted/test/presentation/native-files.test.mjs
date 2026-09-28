import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

function harness(options = {}) {
  let hooks = createReactHookHarness();
  const calls = [];
  const mutations = [], patches = [];
  let refreshes = 0;
  const data = {
    nodes: { "": { path: "", name: "project", kind: "dir", children: [], loaded: true } },
    search: { results: [
      { path: "nested/report.md", kind: "file", hidden: false },
      { path: "nested/reports", kind: "dir", hidden: false },
    ] },
    loadChildren: async () => {}, refreshVisible() { refreshes++; },
    async createEntry(kind, directory, name) {
      calls.push(["create", kind, directory, name]);
      return options.create ? options.create(kind, directory, name) : `${directory}/${name}`;
    },
    async renameEntry(path, name) {
      calls.push(["rename", path, name]);
      return options.rename ? options.rename(path, name) : `nested/${name}`;
    },
    async deleteEntry(path) { calls.push(["delete", path]); if (options.delete) await options.delete(path); },
  };
  const loader = createTsModuleLoader({ mocks: {
    react: Object.fromEntries(Object.keys(hooks.react).map(key => [key, (...args) => hooks.react[key](...args)])),
    "@astryxdesign/core/Banner": {}, "@astryxdesign/core/Layout": {},
    "../../../components/hub/HubChrome": {}, "../../../components/icons": {},
    "../../../components/project-tools/file-tree": {},
    "../../../components/project-tools/WorkspaceToolsContext": {},
    "../../../components/project-tools/file-tree/useFileTreeData": { useFileTreeData: ({ cwd }) => ({
      ...data,
      ...Object.fromEntries(["createEntry", "renameEntry", "deleteEntry"].map(command => [command, (...args) => {
        mutations.push({ command, workdir: cwd, args });
        return data[command](...args);
      }])),
    }) },
    "../../../i18n": { useLocale: () => ({ t: (key) => key }) },
    "../../../lib/runtimePlatform": { isNativeMobileRuntime: () => true },
    "../../../presentation/NativeSurface": { NativeSurface: "NativeSurface" },
    "../../../presentation/nativeTheme": { createNativePresentationTheme: () => ({}) },
    "../../../runtime/applePresentation": { isApplePresentationRuntime: () => true },
    "./MobilePanelScaffold": {},
    "@tauri-apps/api/core": { async invoke(command, args) {
      assert.equal(command, "fs_import_file");
      calls.push([command, args]);
      if (options.import) return options.import(args);
      return { path: [args.directory, args.file_name].filter(Boolean).join("/") };
    } },
  } });
  const props = {
    open: true, projectPathKey: "/project", cwd: "/project", settings: { theme: "light" },
    fileTreeState: { selectedPath: "", expandedPaths: [""], query: "report", showHidden: false },
    onFileTreeStateChange(patch) { patches.push(patch); Object.assign(props.fileTreeState, patch); },
    onOpenFile(path) { calls.push(["open", path]); }, onClose() {},
  };
  const { MobileFilesPanel } = loader.loadModule("src/pages/chat/mobile/MobileFilesPanel.tsx");
  const NativeFiles = hooks.render(() => MobileFilesPanel(props)).type;
  hooks.unmount();
  hooks = createReactHookHarness();
  const render = () => hooks.render(() => NativeFiles(props)).props;
  const dispatch = async (action, value = null) => {
    const handler = render().handlers.get(action);
    assert.ok(handler?.enabled, `${action} must be available`);
    assert.ok(handler.accepts(value));
    await handler.run(value);
  };
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const registry = createPresentationActionRegistry();
  let request = 0;
  const dispatchNative = (action, value) => {
    const surface = render();
    registry.register(surface.document.surface, surface.handlers);
    return registry.dispatch({ surface: surface.document.surface, action, value, requestId: String(++request) });
  };
  return { data, props, calls, mutations, patches, dispatch, render, dispatchNative,
    unmount: () => hooks.unmount(), replayEffects: () => hooks.replayEffects(),
    get refreshes() { return refreshes; } };
}

test("native Files renames and deletes a search result without loading its parent tree", async () => {
  const h = harness();
  await h.dispatch("file-search:file:nested/report.md");
  await h.dispatch("files-rename");
  await h.dispatch("files-name", "updated.md");
  await h.dispatch("files-save-action");
  assert.deepEqual(h.calls.at(-1), ["rename", "nested/report.md", "updated.md"]);
  await h.dispatch("file-search:file:nested/report.md");
  await h.dispatch("files-delete");
  await h.dispatch("files-confirm-delete");
  assert.deepEqual(h.calls.at(-1), ["delete", "nested/report.md"]);
});

test("native Files ignores late import results and stops the batch after its workspace changes", async t => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: { btoa } });
  t.after(() => previousWindow ? Object.defineProperty(globalThis, "window", previousWindow) : delete globalThis.window);
  let release;
  const h = harness({ import: () => new Promise(resolve => { release = resolve; }) });
  const payload = JSON.stringify(["first.txt", "second.txt"].map(fileName => ({ fileName,
    mimeType: "text/plain", contentBase64: "aGk=" })));
  const pending = h.dispatch("files-import:0", payload);
  await new Promise(resolve => setImmediate(resolve));
  h.props.cwd = "/b"; h.props.projectPathKey = "/b"; h.render();
  release({ path: "first.txt" });
  await pending;
  assert.equal(h.calls.filter(([command]) => command === "fs_import_file").length, 1);
  assert.equal(h.props.fileTreeState.selectedPath, "");
  assert.equal(h.refreshes, 0);
});

test("native Files creates inside the selected search directory and freezes its target", async () => {
  const h = harness();
  await h.dispatch("file-search:dir:nested/reports");
  await h.dispatch("files-new-file");
  // Search refresh and selection changes must not redirect an already-open form.
  h.data.search.results = [];
  h.props.fileTreeState.selectedPath = "";
  await h.dispatch("files-name", "notes.md");
  await h.dispatch("files-save-action");
  assert.deepEqual(h.calls.at(-1), ["create", "file", "nested/reports", "notes.md"]);
});

test("native Files uses a selected search file's parent for a new folder", async () => {
  const h = harness();
  await h.dispatch("file-search:file:nested/report.md");
  await h.dispatch("files-new-folder");
  await h.dispatch("files-name", "attachments");
  await h.dispatch("files-save-action");
  assert.deepEqual(h.calls.at(-1), ["create", "dir", "nested", "attachments"]);
});

test("native Files selections cannot move to another directory or workspace after the picker opens", async t => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: { btoa } });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  });
  const h = harness();
  const find = nodes => {
    for (const node of nodes) {
      if (node.id === "files-import") return node;
      const match = find(node.children ?? []);
      if (match) return match;
    }
  };
  const action = () => find(h.render().document.nodes).action;
  const initial = action();
  const payload = JSON.stringify([{ fileName: "note.txt", mimeType: "text/plain", contentBase64: "aGk=" }]);
  await h.dispatch("file-search:dir:nested/reports");
  const selectedDirectory = action();
  assert.equal((await h.dispatchNative(initial, payload)).ok, false);
  assert.equal((await h.dispatchNative(selectedDirectory, payload)).ok, true);
  let writes = h.calls.filter(([command]) => command === "fs_import_file");
  assert.equal(writes[0][1].workdir, "/project");
  assert.equal(writes[0][1].directory, "nested/reports");
  assert.equal(writes[0][1].file_name, "note.txt");
  assert.equal(writes[0][1].content_base64, "aGk=");
  h.props.cwd = "/new-project"; h.props.projectPathKey = "/new-project";
  const newProject = action();
  assert.equal((await h.dispatchNative(selectedDirectory, payload)).ok, false);
  assert.equal((await h.dispatchNative(newProject, payload)).ok, true);
  writes = h.calls.filter(([command]) => command === "fs_import_file");
  assert.equal(writes.length, 2);
  assert.equal(writes[1][1].workdir, "/new-project");
  h.props.cwd = "/project"; h.props.projectPathKey = "/project";
  action();
  assert.equal((await h.dispatchNative(initial, payload)).ok, false);
  assert.equal((await h.dispatchNative(selectedDirectory, payload)).ok, false);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("native file mutations keep late successes and errors out of another workdir", async () => {
  for (const action of ["file", "folder", "rename", "delete"]) {
    for (const fail of [false, true]) {
      const result = deferred();
      const h = harness({ create: () => result.promise, rename: () => result.promise, delete: () => result.promise });
      await h.dispatch("file-search:file:nested/report.md");
      await h.dispatch(action === "file" ? "files-new-file" : action === "folder" ? "files-new-folder" : `files-${action}`);
      if (action !== "delete") await h.dispatch("files-name", "changed.swift");
      const pending = h.dispatch(action === "delete" ? "files-confirm-delete" : "files-save-action");
      assert.equal(h.mutations[0].workdir, "/project");
      // cwd can change even when the project key stays the same.
      h.props.cwd = "/other";
      h.props.fileTreeState.selectedPath = "current.swift";
      h.render();
      h.patches.length = 0;
      if (fail) result.reject(new Error("obsolete failure")); else result.resolve("nested/changed.swift");
      await pending;
      const view = h.render();
      assert.equal(h.patches.length, 0, action);
      assert.equal(view.handlers.has("files-save-action"), false);
      assert.equal(view.handlers.has("files-confirm-delete"), false);
      assert.equal(JSON.stringify(view.document).includes("obsolete failure"), false);
      assert.equal(view.handlers.get("files-new-file").enabled, true);
    }
  }
});

test("native Files reserves mutations synchronously and preserves newer expansion choices", async () => {
  const result = deferred();
  const h = harness({ create: () => result.promise });
  await h.dispatch("file-search:dir:nested/reports");
  await h.dispatch("files-new-folder");
  await h.dispatch("files-name", "new");
  const save = h.render().handlers.get("files-save-action");
  const first = save.run(null), duplicate = save.run(null);
  await duplicate;
  assert.equal(h.mutations.length, 1);
  assert.equal(h.render().handlers.get("files-name").enabled, false);
  assert.equal(h.render().handlers.get("files-cancel-action").enabled, false);
  h.props.fileTreeState.expandedPaths = ["manual"];
  h.render();
  result.resolve("nested/reports/new");
  await first;
  assert.deepEqual(h.props.fileTreeState.expandedPaths, ["manual", "nested/reports", "nested/reports/new"]);
  assert.equal(h.props.fileTreeState.selectedPath, "nested/reports/new");
});

test("obsolete native mutations cannot release a newer action or its form", async () => {
  const old = deferred(), next = deferred();
  let started = 0;
  const h = harness({ create: () => ++started === 1 ? old.promise : next.promise });
  await h.dispatch("files-new-file"); await h.dispatch("files-name", "old.swift");
  const oldSave = h.dispatch("files-save-action");
  h.props.cwd = "/next"; h.render();
  await h.dispatch("files-new-file"); await h.dispatch("files-name", "next.swift");
  const nextSave = h.dispatch("files-save-action");
  old.reject(new Error("old workspace")); await oldSave;
  assert.equal(h.render().handlers.get("files-save-action").enabled, false);
  assert.equal(h.render().handlers.get("files-new-file").enabled, false);
  assert.equal(JSON.stringify(h.render().document).includes("old workspace"), false);
  next.resolve("next.swift"); await nextSave;
  assert.equal(h.props.fileTreeState.selectedPath, "next.swift");
  assert.equal(h.render().handlers.get("files-new-file").enabled, true);
  assert.deepEqual(h.mutations.map(mutation => mutation.workdir), ["/project", "/next"]);
});

test("native Files rejects old callbacks after unmount or leaving and returning to a workspace", async () => {
  for (const leave of ["unmount", "return"]) {
    const result = deferred();
    const h = harness({ create: () => result.promise });
    h.render(); h.replayEffects();
    await h.dispatch("files-new-file"); await h.dispatch("files-name", "old.swift");
    const pending = h.dispatch("files-save-action");
    if (leave === "unmount") h.unmount();
    else {
      h.props.cwd = "/other"; h.render();
      h.props.cwd = "/project"; h.render();
    }
    h.patches.length = 0;
    result.resolve("old.swift"); await pending;
    assert.equal(h.patches.length, 0, leave);
    assert.equal(h.props.fileTreeState.selectedPath, "");
  }
});

test("a late native import cannot unlock a newer workspace mutation", async t => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: { btoa } });
  t.after(() => previousWindow ? Object.defineProperty(globalThis, "window", previousWindow) : delete globalThis.window);
  const old = deferred(), next = deferred();
  const h = harness({ import: () => old.promise, create: () => next.promise });
  const payload = JSON.stringify([{ fileName: "old.txt", mimeType: "text/plain", contentBase64: "aGk=" }]);
  const pending = h.dispatch("files-import:0", payload);
  await new Promise(resolve => setImmediate(resolve));
  h.props.cwd = "/next"; h.render();
  await h.dispatch("files-new-file"); await h.dispatch("files-name", "next.swift");
  const save = h.dispatch("files-save-action");
  old.resolve({ path: "old.txt" }); await pending;
  assert.equal(h.render().handlers.get("files-save-action").enabled, false);
  assert.equal(h.refreshes, 0);
  next.resolve("next.swift"); await save;
  assert.equal(h.props.fileTreeState.selectedPath, "next.swift");
});
