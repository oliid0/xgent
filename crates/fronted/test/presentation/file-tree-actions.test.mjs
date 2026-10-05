import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

const windowContexts = new WeakSet();
function harness(t, options = {}) {
  if (!windowContexts.has(t)) {
    windowContexts.add(t);
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, writable: true,
      value: { setTimeout, clearTimeout, requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout } });
    t.after(() => previousWindow ? Object.defineProperty(globalThis, "window", previousWindow) : delete globalThis.window);
  }
  const hooks = createReactHookHarness(), calls = [], patches = [];
  const state = { selectedPath: "nested/report.swift", expandedPaths: ["", "nested"], query: "", showHidden: false, revision: 0 };
  const context = { projectPathKey: "/project", cwd: "/project", clients: {},
    fileTree: { initialized: true, state, onStateChange(patch) { patches.push(patch); Object.assign(state, patch); } } };
  const props = { active: true, touchActions: true };
  const nodes = {
    "": { path: "", name: "project", kind: "dir", loaded: true, children: ["nested"] },
    nested: { path: "nested", name: "nested", kind: "dir", loaded: true, children: ["nested/report.swift"] },
    "nested/report.swift": { path: "nested/report.swift", name: "report.swift", kind: "file", children: [] },
  };
  const mocks = {
    react: hooks.react,
    "../../../i18n": { useLocale: () => ({ t: key => key }) },
    "../../../lib/chat/workspacePathDrag": { finishWorkspacePathDrag() {}, writeWorkspacePathDragPayload: () => true },
    "../../chat/fileTypeIcons": { getFileTypeIcon: () => "FileIcon" },
    "../../icons": Object.fromEntries(["Check", "FolderOpen", "RefreshCw", "Trash2", "X"].map(name => [name, name])),
    "../WorkspaceToolsContext": { useWorkspaceToolsContext: () => context },
    "./ContextMenu": { FileTreeContextMenu: "ContextMenu" },
    "../../presentation/NativeSurface": {},
    "../../runtime/applePresentation": { isApplePresentationRuntime: () => false },
    "./useFileTreeData": { useFileTreeData: ({ cwd }) => {
      const mutate = (command, args, fallback) => {
        calls.push({ command, workdir: cwd, args });
        return options.mutate ? options.mutate(command, args, cwd) : Promise.resolve(fallback);
      };
      return { nodes, search: { results: [], loading: false, error: null },
        loadChildren: async () => {}, refreshVisible() {},
        ensureDirsLoaded: dirs => options.reveal ? options.reveal(dirs) : Promise.resolve(),
        createEntry: (kind, directory, name) => mutate("create", [kind, directory, name], [directory, name].filter(Boolean).join("/")),
        renameEntry: (path, name) => mutate("rename", [path, name], `nested/${name}`),
        deleteEntry: path => mutate("delete", [path]), openWorkspacePath: async () => {},
      };
    } },
  };
  for (const names of [["Banner"], ["Button"], ["Code"], ["EmptyState"], ["Grid"], ["IconButton"],
    ["HStack", "StackItem", "VStack"], ["List", "ListItem"], ["Section"], ["Spinner"], ["Text"], ["TextInput"], ["TreeList"], ["AlertDialog"]]) {
    mocks[`@astryxdesign/core/${names[0] === "HStack" ? "Layout" : names[0]}`] = Object.fromEntries(names.map(name => [name, name]));
  }
  const { FileTreePanel } = createTsModuleLoader({ mocks }).loadModule("src/components/project-tools/file-tree/index.tsx");
  const render = () => hooks.render(() => FileTreePanel(props));
  function find(type, predicate = () => true, node = render()) {
    if (Array.isArray(node)) return node.map(item => find(type, predicate, item)).find(Boolean);
    if ((node?.type === type || node?.type?.name === type) && predicate(node.props)) return node;
    return find(type, predicate, node?.props?.children ?? []);
  }
  const button = label => {
    const found = find("Button", value => value.label === label) ?? find("IconButton", value => value.label === label);
    assert.ok(found, `${label} button is rendered`);
    return found.props;
  };
  const edit = name => {
    const input = find("TextInput", value => value.hasAutoFocus);
    assert.ok(input, "file name input is rendered"); input.props.onChange(name);
  };
  return { context, props, state, nodes, calls, patches, render, find, button, edit,
    replayEffects: () => hooks.replayEffects(), unmount: () => hooks.unmount(),
    async settle() { await new Promise(resolve => setImmediate(resolve)); return render(); } };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("directory row and chevron toggles use the latest state before React rerenders", t => {
  const h = harness(t);
  const row = h.find("TreeList").props.items[0].children.find(item => item.id === "nested");
  row.onClick();
  assert.deepEqual(h.state.expandedPaths, [""]);
  row.onClick();
  assert.deepEqual(h.state.expandedPaths, ["", "nested"]);
  const tree = h.find("Section", props => !!props.onClickCapture);
  const item = { dataset: { treeId: "nested" } };
  const target = { closest: selector => selector === "[data-tree-toggle]" ? {} : item };
  let stopped = 0;
  tree.props.onClickCapture({ target, stopPropagation() { stopped++; } });
  assert.deepEqual(h.state.expandedPaths, [""]);
  tree.props.onClickCapture({ target, stopPropagation() { stopped++; } });
  assert.deepEqual(h.state.expandedPaths, ["", "nested"]);
  assert.equal(stopped, 2, "TreeList's private override must never shadow row/reveal expansion");
});

test("keyboard collapse and expand persist while navigation arrows and leaf rows leave state intact", t => {
  const h = harness(t);
  const capture = h.find("Section", props => !!props.onKeyDownCapture).props.onKeyDownCapture;
  let expanded = "true", path = "nested";
  const item = { dataset: { get treeId() { return path; } }, getAttribute: () => expanded };
  let prevented = 0, stopped = 0;
  const event = key => ({ key, target: { closest: () => item },
    preventDefault() { prevented++; }, stopPropagation() { stopped++; } });
  capture(event("ArrowLeft"));
  assert.deepEqual(h.state.expandedPaths, [""]);
  expanded = "false";
  const patches = h.patches.length;
  capture(event("ArrowLeft"));
  assert.equal(h.patches.length, patches, "Left on a collapsed row moves focus only");
  capture(event("ArrowRight"));
  assert.deepEqual(h.state.expandedPaths, ["", "nested"]);
  path = "nested/report.swift";
  capture(event("ArrowLeft"));
  assert.deepEqual(h.state.expandedPaths, ["", "nested"]);
  path = "nested";
  capture({ ...event("ArrowLeft"), ctrlKey: true });
  assert.deepEqual(h.state.expandedPaths, ["", "nested"]);
  assert.equal(prevented, 2);
  assert.equal(stopped, 2, "Only expansion arrows are consumed; focus navigation stays with TreeList");
});

test("shared file forms preserve their directory and reserve duplicate submissions before rerender", async t => {
  const result = deferred(), h = harness(t, { mutate: () => result.promise });
  h.render(); h.replayEffects();
  h.button("projectTools.fileTree.newFile").onClick(); h.edit("new.swift");
  // A refreshed tree must not redirect the form to the root.
  delete h.nodes["nested/report.swift"]; delete h.nodes.nested;
  h.state.selectedPath = "";
  const save = h.button("settings.save").onClick;
  save(); save();
  assert.deepEqual(h.calls, [{ command: "create", workdir: "/project", args: ["file", "nested", "new.swift"] }]);
  assert.equal(h.button("settings.cancel").isDisabled, true);
  assert.equal(h.find("TextInput", value => value.hasAutoFocus).props.isDisabled, true);
  h.state.expandedPaths = ["manual"]; h.render();
  result.resolve("nested/new.swift"); await h.settle();
  assert.equal(h.state.selectedPath, "nested/new.swift");
  assert.deepEqual(h.state.expandedPaths, ["manual", "nested"]);
  assert.equal(h.find("TextInput", value => value.hasAutoFocus), undefined);
});

test("shared file mutation results cannot patch another workdir or release its newer busy state", async t => {
  const old = deferred(), next = deferred();
  const h = harness(t, { mutate: (_command, _args, cwd) => cwd === "/project" ? old.promise : next.promise });
  h.button("projectTools.fileTree.rename").onClick(); h.edit("old.swift");
  h.button("settings.save").onClick();
  h.context.cwd = "/other"; h.render();
  h.button("projectTools.fileTree.newFolder").onClick(); h.edit("current");
  h.button("settings.save").onClick(); h.patches.length = 0;
  old.reject(new Error("obsolete error")); await h.settle();
  assert.equal(h.patches.length, 0);
  assert.equal(h.button("settings.save").isDisabled, true);
  assert.equal(h.find("Banner"), undefined);
  next.resolve("nested/current"); await h.settle();
  assert.equal(h.state.selectedPath, "nested/current");
  assert.equal(h.button("projectTools.fileTree.newFile").isDisabled, false);
  assert.deepEqual(h.calls.map(call => call.workdir), ["/project", "/other"]);
});

test("shared delete confirmation is cancelled on a workdir change and old buttons cannot confirm a new dialog", async t => {
  const h = harness(t);
  h.button("projectTools.fileTree.delete").onClick();
  const oldDialog = h.find("ConfirmDialog"), oldConfirm = oldDialog.props.onConfirm;
  assert.equal(h.button("projectTools.fileTree.newFile").isDisabled, true);
  h.context.cwd = "/other"; await h.settle();
  assert.equal(h.find("ConfirmDialog"), undefined);
  oldConfirm(); await h.settle();
  assert.equal(h.calls.length, 0);
  h.button("projectTools.fileTree.delete").onClick();
  const nextDialog = h.find("ConfirmDialog");
  assert.notEqual(nextDialog.key, oldDialog.key);
  oldConfirm(); await h.settle();
  assert.ok(h.find("ConfirmDialog"));
  assert.equal(h.calls.length, 0);
  nextDialog.props.onConfirm(); await h.settle();
  assert.deepEqual(h.calls, [{ command: "delete", workdir: "/other", args: ["nested/report.swift"] }]);
  assert.equal(h.state.selectedPath, "nested");
});

test("shared deletion only applies its result while its panel and workspace remain current", async t => {
  for (const leave of ["inactive", "return", "unmount"]) {
    const result = deferred(), h = harness(t, { mutate: () => result.promise });
    h.button("projectTools.fileTree.delete").onClick();
    h.find("ConfirmDialog").props.onConfirm(); await h.settle();
    assert.equal(h.calls.length, 1);
    if (leave === "unmount") h.unmount();
    else if (leave === "inactive") { h.props.active = false; h.render(); }
    else { h.context.cwd = "/b"; h.render(); h.context.cwd = "/project"; h.render(); }
    h.patches.length = 0;
    result.resolve(); await h.settle();
    assert.equal(h.patches.length, 0, leave);
    assert.equal(h.state.selectedPath, "nested/report.swift");
  }
});

test("shared asynchronous reveal cannot select an old path after a workspace switch", async t => {
  const result = deferred(), h = harness(t, { reveal: () => result.promise });
  h.render();
  h.state.selectedPath = "nested/report.swift"; h.state.revision = 1; h.render();
  h.context.cwd = "/other"; h.render(); h.patches.length = 0;
  result.resolve(); await h.settle();
  assert.equal(h.patches.length, 0);
});
