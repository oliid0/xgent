import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function harness() {
  const hooks = createReactHookHarness(), calls = [], errors = [], options = {};
  const translate = key => key;
  const loader = createTsModuleLoader({ mocks: {
    react: hooks.react,
    "@astryxdesign/core/DropdownMenu": { DropdownMenu: "DropdownMenu" },
    "../../i18n": { useLocale: () => ({ t: translate }) },
    "../../lib/tools/fsBackend": { invokeFs: async (command, args) => {
      calls.push([command, args]); return options.invoke ? options.invoke(command, args) : [];
    } },
  } });
  const { OpenWithMenu } = loader.loadModule("src/components/workspace-editor/OpenWithMenu.tsx");
  const props = { workdir: "/project", path: "a.png", onError: error => errors.push(error) };
  const render = () => hooks.render(() => OpenWithMenu(props));
  render();
  return { options, calls, errors, props, render, unmount: hooks.unmount,
    async flush() { await new Promise(setImmediate); return render(); } };
}

test("open-with prevents duplicate scans and opens, retaining the correct command and localized labels", async () => {
  const h = harness(), scan = Promise.withResolvers(), opening = Promise.withResolvers();
  try {
    h.options.invoke = command => command === "fs_file_applications" ? scan.promise : opening.promise;
    const menu = h.render(); assert.equal(menu.props.button.label, "workspaceFiles.openWith");
    menu.props.onOpenChange(true); menu.props.onOpenChange(true);
    assert.equal(h.calls.length, 1);
    scan.resolve([{ id: "editor", label: "Image Editor" }]); await h.flush();
    const application = h.render().props.items.find(item => item.id === "editor");
    application.onClick(); application.onClick();
    assert.equal(h.calls.filter(([command]) => command === "fs_open_workspace_path").length, 1);
    assert.deepEqual(h.calls.at(-1), ["fs_open_workspace_path", { workdir: "/project", path: "a.png", mode: "app:editor" }]);
    // A scan which starts during an open cannot strand the open's busy state.
    h.render().props.onOpenChange(true); scan.resolve([]); await h.flush();
    opening.resolve({}); await h.flush();
    assert.equal(h.render().props.button.isDisabled, false);
  } finally { scan.resolve([]); opening.resolve({}); h.unmount(); }
});

test("retired open-with callbacks cannot launch a new file and late failures cannot replace the current error", async () => {
  const h = harness(), wait = Promise.withResolvers();
  try {
    h.options.invoke = () => wait.promise;
    const old = h.render(); old.props.items.find(item => item.label === "workspaceFiles.defaultApp").onClick();
    h.props.path = "b.png"; h.render();
    old.props.items.find(item => item.label === "workspaceFiles.chooseApp").onClick(); old.props.onOpenChange(true);
    assert.equal(h.calls.length, 1);
    wait.reject(new Error("Retired failure")); await h.flush();
    assert.deepEqual(h.errors, [""]);
    assert.equal(h.render().props.button.isDisabled, false);
  } finally { h.unmount(); }
});

test("open-with preserves ordered Unicode application IDs and last good results across invalid refreshes", async () => {
  const h = harness();
  try {
    const id = "macos:file:///Applications/绘图%20Editor.app/";
    h.options.invoke = () => [{ id, label: "绘图 Editor" }, { id, label: "Duplicate" }, { id: "other", label: "Other" }];
    h.render().props.onOpenChange(true); await h.flush();
    assert.deepEqual(h.render().props.items.filter(item => item.id).map(item => item.id), [id, "other"]);
    h.options.invoke = () => [{ id: "bad\0id", label: "Invalid" }];
    h.render().props.items.find(item => item.label === "workspaceFiles.refreshApplications").onClick(); await h.flush();
    assert.deepEqual(h.render().props.items.filter(item => item.id).map(item => item.id), [id, "other"]);
    assert.match(h.errors.at(-1), /Invalid application list/);
    h.options.invoke = () => [];
    h.render().props.items.find(item => item.label === "workspaceFiles.refreshApplications").onClick(); await h.flush();
    assert.equal(h.render().props.items.filter(item => item.id).length, 0);
  } finally { h.unmount(); }
});

test("returning to the same file does not revive its old callbacks or application scan", async () => {
  const h = harness(), scan = Promise.withResolvers();
  try {
    h.options.invoke = () => scan.promise;
    const retired = h.render(); retired.props.onOpenChange(true);
    h.props.path = "b.png"; h.render();
    h.props.path = "a.png"; h.render();
    retired.props.onOpenChange(true);
    retired.props.items.find(item => item.label === "workspaceFiles.defaultApp").onClick();
    assert.equal(h.calls.length, 1);
    scan.resolve([{ id: "retired", label: "Retired" }]); await h.flush();
    assert.equal(h.render().props.items.some(item => item.id === "retired"), false);
    h.options.invoke = () => [{ id: "current", label: "Current" }];
    h.render().props.onOpenChange(true); await h.flush();
    assert.ok(h.render().props.items.some(item => item.id === "current"));
  } finally { scan.resolve([]); h.unmount(); }
});

test("application validation keeps opaque case-sensitive identities and rejects partial malformed lists", () => {
  const { workspaceFileApplications } = createTsModuleLoader().loadModule("src/components/workspace-editor/useWorkspaceFileApplications.ts");
  assert.deepEqual(workspaceFileApplications([{ id: "macos:file:///Editor.app/", label: "编辑器" },
    { id: "macos:file:///editor.app/", label: "Other" }]).map(item => item.id),
    ["macos:file:///Editor.app/", "macos:file:///editor.app/"]);
  for (const value of [null, {}, [null], [{ id: "", label: "Editor" }], [{ id: "valid", label: "Editor" }, { id: "invalid", label: " " }]]) {
    assert.throws(() => workspaceFileApplications(value), /Invalid application list/);
  }
});
