import assert from "node:assert/strict";
import { File } from "node:buffer";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function harness(options = {}) {
  const state = [], effects = [], calls = [], patches = [];
  let cursor = 0, dirty = false, clicks = 0;
  const same = (a, b) => a?.length === b?.length && a.every((item, index) => Object.is(item, b[index]));
  const loader = createTsModuleLoader({ mocks: {
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [state[index], value => {
          const next = typeof value === "function" ? value(state[index]) : value;
          if (!Object.is(next, state[index])) { state[index] = next; dirty = true; }
        }];
      },
      useRef(current) { const index = cursor++; return state[index] ??= { current }; },
      useMemo: create => create(), useCallback: callback => callback,
      useEffect(effect, deps) {
        const index = cursor++;
        if (!same(state[index]?.deps, deps)) effects.push(() => {
          state[index]?.cleanup?.();
          state[index] = { deps, effect, cleanup: effect() };
        });
      },
    },
    "@astryxdesign/core/Banner": { Banner: "Banner" },
    "@astryxdesign/core/Layout": { StackItem: "StackItem" },
    "../../../components/hub/HubChrome": { HubHeader: "HubHeader" },
    "../../../components/icons": { FolderTree: "FolderTree" },
    "../../../components/project-tools/file-tree": { FileTreePanel: "FileTreePanel" },
    "../../../components/project-tools/WorkspaceToolsContext": { WorkspaceToolsContext: { Provider: "Provider" } },
    "../../../components/project-tools/file-tree/useFileTreeData": {},
    "../../../i18n": { useLocale: () => ({ t: key => key }) },
    "../../../lib/runtimePlatform": { isNativeMobileRuntime: () => true },
    "../../../presentation/NativeSurface": {},
    "../../../presentation/nativeTheme": {},
    "../../../runtime/applePresentation": { isApplePresentationRuntime: () => false },
    "./MobilePanelScaffold": { MobileFullscreenPanel: "MobileFullscreenPanel" },
    "@tauri-apps/api/core": { async invoke(command, args) {
      assert.equal(command, "fs_import_file");
      calls.push(args);
      if (options.import) return options.import(args);
      return { path: [args.directory, args.file_name].filter(Boolean).join("/") };
    } },
  } });
  const { MobileFilesPanel } = loader.loadModule("src/pages/chat/mobile/MobileFilesPanel.tsx");
  const props = {
    open: true, projectPathKey: "/a", cwd: "/a", settings: {}, theme: "light",
    fileTreeState: { selectedPath: "", expandedPaths: [""], query: "", showHidden: false },
    onFileTreeStateChange: patch => patches.push(patch), onClose() {},
  };
  function find(node, type) {
    if (Array.isArray(node)) return node.map(item => find(item, type)).find(Boolean);
    if (node?.type === type) return node.props;
    return find(node?.props?.children ?? [], type);
  }
  const listeners = new Set();
  const input = { value: "", click() { clicks++; if (options.clickError) throw options.clickError; },
    addEventListener(event, callback) { assert.equal(event, "cancel"); listeners.add(callback); },
    removeEventListener(event, callback) { assert.equal(event, "cancel"); listeners.delete(callback); },
  };
  const render = () => {
    let tree;
    do {
      dirty = false; cursor = 0;
      tree = MobileFilesPanel(props);
      const picker = find(tree, "input");
      if (picker) picker.ref.current = input;
      for (const effect of effects.splice(0)) effect();
    } while (dirty);
    return { picker: find(tree, "input"), files: find(tree, "FileTreePanel"), error: find(tree, "Banner") };
  };
  const select = (files, picker = render().picker) => picker.onChange({ currentTarget: { files, value: "selected" } });
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); return render(); };
  return { props, calls, patches, render, select, settle, options,
    cancel() { for (const callback of listeners) callback(); },
    get clicks() { return clicks; },
    unmount() { for (const entry of state) entry?.cleanup?.(); },
    probeEffects() {
      for (const entry of state) {
        if (!entry?.effect) continue;
        entry.cleanup?.();
        entry.cleanup = entry.effect();
      }
    },
  };
}

const file = (name = "original.heic") => new File(["original bytes"], name, { type: "image/heic" });
function withWindow(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: { btoa } });
  t.after(() => previous ? Object.defineProperty(globalThis, "window", previous) : delete globalThis.window);
}

test("mobile Files reserves the picker once and imports original bytes into its captured directory", async t => {
  withWindow(t);
  const h = harness();
  h.render().files.onImportFiles("chosen");
  h.render().files.onImportFiles("other");
  assert.equal(h.clicks, 1);
  assert.equal(h.render().files.importBusy, true);
  h.props.fileTreeState.selectedPath = "other";
  h.select([file()]);
  h.cancel(); // A second system event cannot release an active decode.
  h.select([file("duplicate.heic")]);
  await h.settle();
  assert.deepEqual(h.calls, [{ workdir: "/a", directory: "chosen", file_name: "original.heic",
    content_base64: Buffer.from("original bytes").toString("base64") }]);
  assert.equal(h.patches[0].selectedPath, "chosen/original.heic");
  assert.equal(h.render().files.importBusy, false);
});

test("mobile Files cancels a selection and recovers from picker startup failures", async t => {
  withWindow(t);
  const h = harness();
  h.render().files.onImportFiles("chosen");
  h.cancel();
  assert.equal(h.render().files.importBusy, false);
  assert.equal(h.calls.length, 0);
  h.options.clickError = new Error("Picker unavailable");
  h.render().files.onImportFiles("chosen");
  assert.equal(h.render().error.title, "Picker unavailable");
  assert.equal(h.render().files.importBusy, false);
  delete h.options.clickError;
  h.render().files.onImportFiles("chosen");
  h.select([file()]);
  await h.settle();
  assert.equal(h.calls.length, 1);
});

test("mobile Files remains usable after React replays mount effects", async t => {
  withWindow(t);
  const h = harness();
  const rendered = h.render();
  h.probeEffects();
  rendered.files.onImportFiles("chosen");
  h.select([file()], rendered.picker);
  await h.settle();
  assert.equal(h.calls.length, 1);
  assert.equal(h.patches[0].selectedPath, "chosen/original.heic");
});

test("an obsolete mobile Files picker cannot consume a new workspace selection or revive on return", async t => {
  withWindow(t);
  const h = harness();
  h.render().files.onImportFiles("old");
  const oldPicker = h.render().picker;
  const oldFiles = h.render().files;
  h.props.cwd = "/b"; h.props.projectPathKey = "/b";
  const currentFiles = h.render().files;
  oldFiles.onImportFiles("obsolete");
  assert.equal(h.clicks, 1);
  currentFiles.onImportFiles("new");
  h.select([file("stale.heic")], oldPicker);
  h.select([file("current.heic")]);
  await h.settle();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].workdir, "/b");
  assert.equal(h.calls[0].file_name, "current.heic");
  h.props.cwd = "/a"; h.props.projectPathKey = "/a";
  h.render();
  h.select([file("returned.heic")], oldPicker);
  await h.settle();
  assert.equal(h.calls.length, 1);
});

test("mobile Files abandons deferred reads after close and keeps a newer picker busy", async t => {
  withWindow(t);
  const h = harness();
  let release;
  const slow = { name: "slow.bin", size: 1, arrayBuffer: () => new Promise(resolve => { release = resolve; }) };
  h.render().files.onImportFiles("old");
  h.select([slow]);
  h.props.open = false; h.render();
  h.props.open = true; h.render().files.onImportFiles("new");
  release(new Uint8Array([1]).buffer);
  await h.settle();
  assert.equal(h.calls.length, 0);
  assert.equal(h.render().files.importBusy, true);
  h.select([file()]);
  await h.settle();
  assert.equal(h.calls[0].directory, "new");
});

test("late mobile Files backend results cannot refresh another workspace or continue the old batch", async t => {
  withWindow(t);
  let release;
  const h = harness({ import: () => new Promise(resolve => { release = resolve; }) });
  h.render().files.onImportFiles("old");
  h.select([file("first.heic"), file("second.heic")]);
  await h.settle();
  h.props.cwd = "/b"; h.props.projectPathKey = "/b"; h.render();
  release({ path: "old/first.heic" });
  await h.settle();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].workdir, "/a");
  assert.equal(h.patches.length, 0);
  assert.equal(h.render().files.importRevision, 0);
});

test("mobile Files shows partial success on limits and ignores results after unmount", async t => {
  withWindow(t);
  const h = harness();
  h.render().files.onImportFiles("chosen");
  h.select([file(), { name: "large.bin", size: 20 * 1024 * 1024 + 1 }]);
  await h.settle();
  assert.equal(h.calls.length, 1);
  assert.equal(h.patches[0].selectedPath, "chosen/original.heic");
  assert.ok(h.render().error);
  let release;
  const pending = harness({ import: () => new Promise(resolve => { release = resolve; }) });
  pending.render().files.onImportFiles("chosen");
  pending.select([file()]);
  await pending.settle();
  pending.unmount();
  release({ path: "chosen/original.heic" });
  await pending.settle();
  assert.equal(pending.patches.length, 0);
});
