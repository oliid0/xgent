import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function harness() {
  const states = [];
  const calls = [];
  let cursor = 0;
  const data = {
    nodes: { "": { path: "", name: "project", kind: "dir", children: [], loaded: true } },
    search: { results: [
      { path: "nested/report.md", kind: "file", hidden: false },
      { path: "nested/reports", kind: "dir", hidden: false },
    ] },
    loadChildren: async () => {}, refreshVisible() {},
    async createEntry(kind, directory, name) { calls.push(["create", kind, directory, name]); return `${directory}/${name}`; },
    async renameEntry(path, name) { calls.push(["rename", path, name]); return `nested/${name}`; },
    async deleteEntry(path) { calls.push(["delete", path]); },
  };
  const loader = createTsModuleLoader({ mocks: {
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = initial;
        return [states[index], (value) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
      },
      useRef(current) {
        const index = cursor++;
        return states[index] ??= { current };
      },
      useMemo: (create) => create(), useCallback: (callback) => callback, useEffect() {},
    },
    "@astryxdesign/core/Banner": {}, "@astryxdesign/core/Layout": {},
    "../../../components/hub/HubChrome": {}, "../../../components/icons": {},
    "../../../components/project-tools/file-tree": {},
    "../../../components/project-tools/WorkspaceToolsContext": {},
    "../../../components/project-tools/file-tree/useFileTreeData": { useFileTreeData: () => data },
    "../../../i18n": { useLocale: () => ({ t: (key) => key }) },
    "../../../lib/runtimePlatform": { isNativeMobileRuntime: () => true },
    "../../../presentation/NativeSurface": { NativeSurface: "NativeSurface" },
    "../../../presentation/nativeTheme": { createNativePresentationTheme: () => ({}) },
    "../../../runtime/applePresentation": { isApplePresentationRuntime: () => true },
    "./MobilePanelScaffold": {},
    "@tauri-apps/api/core": { async invoke(command, args) {
      assert.equal(command, "fs_import_file");
      calls.push([command, args]);
      return { path: [args.directory, args.file_name].filter(Boolean).join("/") };
    } },
  } });
  const props = {
    open: true, projectPathKey: "/project", cwd: "/project", settings: { theme: "light" },
    fileTreeState: { selectedPath: "", expandedPaths: [""], query: "report", showHidden: false },
    onFileTreeStateChange(patch) { Object.assign(props.fileTreeState, patch); },
    onOpenFile(path) { calls.push(["open", path]); }, onClose() {},
  };
  const { MobileFilesPanel } = loader.loadModule("src/pages/chat/mobile/MobileFilesPanel.tsx");
  const NativeFiles = MobileFilesPanel(props).type;
  states.length = 0;
  const render = () => { cursor = 0; return NativeFiles(props).props; };
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
  return { data, props, calls, dispatch, render, dispatchNative };
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
