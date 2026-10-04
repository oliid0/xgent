import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

function harness(context) {
  const hooks = createReactHookHarness();
  const loader = createTsModuleLoader({ mocks: { react: hooks.react } });
  const { useNativeWorkspaceActions } = loader.loadModule("src/presentation/nativeWorkspaceActions.ts");
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const calls = [];
  const projects = [{ id: "default-project", name: "Default", path: "/default" },
    { id: "p", name: "Workspace", path: "/project" }];
  const groups = [{ id: "g", name: "Group", projectPaths: [] }];
  const props = { projects, workspaceProjectGroups: groups, archivedProjectPathKeys: new Set(),
    runningProjectPathKeys: new Set(),
    onCreateProject: () => calls.push(["create-project"]),
    onCreateWorkspaceGroup: name => calls.push(["create-group", name]),
    onRenameWorkspaceGroup: (id, name) => calls.push(["rename-group", id, name]),
    onDeleteWorkspaceGroup: id => calls.push(["delete-group", id]),
    onMoveProjectToGroup: (path, id) => calls.push(["move", path, id]),
    onRenameProject: (item, name) => calls.push(["rename-project", item.id, name]),
    onSetProjectPinned: (item, pinned) => calls.push(["pin", item.id, pinned]),
    onArchiveProject: item => calls.push(["archive", item.id]),
    onUnarchiveProject: item => calls.push(["unarchive", item.id]),
    onRemoveProject: item => calls.push(["remove", item.id]),
    onOpenWorkspaceSettings: item => calls.push(["settings", item.id]),
    onNewConversationForProject: item => calls.push(["new-chat", item.id]),
    onBrowseProjectInFileTree: item => calls.push(["tree", item.id]),
    onBrowseProjectInSystemFileManager: item => calls.push(["finder", item.id]),
  };
  const registry = createPresentationActionRegistry();
  let controls, menus, request = 0;
  const render = () => {
    controls = hooks.render(() => useNativeWorkspaceActions(props, key => key));
    menus = [...props.projects.map(controls.projectMenu), ...props.workspaceProjectGroups.map(controls.groupMenu), controls.workspaceMenu];
    registry.register("sidebar", controls.handlers);
    if (controls.dialog) registry.register("dialog", controls.dialog.handlers);
    else registry.remove("dialog");
  };
  render();
  context.after(() => hooks.unmount());
  const nodes = items => items.flatMap(node => [node, ...nodes(node.children ?? [])]);
  return { props, calls, render, hooks,
    node: id => nodes([...menus, ...(controls.dialog?.nodes ?? [])]).find(node => node.id === id),
    handler: id => controls.handlers.get(id),
    dialogHandler: id => controls.dialog?.handlers.get(id),
    dispatch: async (action, value = null, surface = "sidebar") => {
      const result = await registry.dispatch({ surface, action, value, requestId: String(++request) });
      render(); return result;
    },
  };
}

test("workspace menus invoke shared project handlers and preserve default, running and archive constraints", async context => {
  const h = harness(context);
  for (const [action, expected] of [["pin", ["pin", "p", true]], ["settings", ["settings", "p"]],
    ["new-chat", ["new-chat", "p"]], ["browse-tree", ["tree", "p"]], ["browse-system", ["finder", "p"]],
    ["archive", ["archive", "p"]], ["group:g", ["move", "/project", "g"]], ["ungrouped", ["move", "/project", null]]]) {
    assert.equal((await h.dispatch(`project-actions:p:${action}`)).ok, true);
    assert.deepEqual(h.calls.at(-1), expected);
  }
  assert.equal(h.node("project-actions:default-project:rename"), undefined);
  assert.equal(h.node("project-actions:default-project:remove"), undefined);
  h.props.projects[1].isPinned = true; h.render();
  await h.dispatch("project-actions:p:pin");
  assert.deepEqual(h.calls.at(-1), ["pin", "p", false]);
  h.props.runningProjectPathKeys.add("/project"); h.render();
  assert.equal((await h.dispatch("project-actions:p:remove")).ok, false);
  h.props.archivedProjectPathKeys.add("/project"); h.render();
  assert.equal(h.node("project-actions:p:pin"), undefined);
  assert.equal(h.node("project-actions:p:archive"), undefined);
  assert.equal(h.node("project-actions:default-project:archive"), undefined, "the only active workspace cannot be archived");
  await h.dispatch("project-actions:p:unarchive");
  assert.deepEqual(h.calls.at(-1), ["unarchive", "p"]);
});

test("workspace dialogs submit edits and require confirmation before removing project history", async context => {
  const h = harness(context);
  await h.dispatch("workspace-create-group");
  assert.equal(h.node("workspace-dialog-confirm").disabled, true);
  await h.dispatch("workspace-dialog-name", " New group ", "dialog");
  await h.dispatch("workspace-dialog-confirm", null, "dialog");
  assert.deepEqual(h.calls.at(-1), ["create-group", "New group"]);
  await h.dispatch("group-actions:g:rename");
  await h.dispatch("workspace-dialog-name", " Renamed group ", "dialog");
  await h.dispatch("workspace-dialog-confirm", null, "dialog");
  assert.deepEqual(h.calls.at(-1), ["rename-group", "g", "Renamed group"]);
  await h.dispatch("group-actions:g:delete");
  assert.deepEqual(h.calls.at(-1), ["delete-group", "g"]);
  await h.dispatch("project-actions:p:rename");
  await h.dispatch("workspace-dialog-name", " Renamed workspace ", "dialog");
  await h.dispatch("workspace-dialog-confirm", null, "dialog");
  assert.deepEqual(h.calls.at(-1), ["rename-project", "p", "Renamed workspace"]);
  await h.dispatch("project-actions:p:remove");
  assert.ok(h.node("workspace-dialog-description").text.includes("chat.workspaceRemoveDescription"));
  assert.equal(h.calls.some(call => call[0] === "remove"), false);
  h.props.runningProjectPathKeys.add("/project"); h.render();
  assert.equal((await h.dispatch("workspace-dialog-confirm", null, "dialog")).ok, false);
  h.props.runningProjectPathKeys.clear(); h.render();
  await h.dispatch("workspace-dialog-cancel", null, "dialog");
  assert.equal(h.calls.some(call => call[0] === "remove"), false);
  await h.dispatch("project-actions:p:remove");
  await h.dispatch("workspace-dialog-confirm", null, "dialog");
  assert.deepEqual(h.calls.at(-1), ["remove", "p"]);
});

test("removed targets and unmounted workspace menus cannot mutate old projects or groups", async context => {
  const h = harness(context);
  const oldPin = h.handler("project-actions:p:pin"), oldMove = h.handler("project-actions:p:group:g");
  await h.dispatch("project-actions:p:rename");
  h.props.projects = [h.props.projects[0]]; h.props.workspaceProjectGroups = []; h.render();
  oldPin.run(null); oldMove.run(null);
  assert.deepEqual(h.calls, []);
  assert.equal((await h.dispatch("workspace-dialog-confirm", null, "dialog")).ok, false);
  const oldCreate = h.handler("workspace-create-project");
  h.hooks.unmount(); oldCreate.run(null);
  assert.deepEqual(h.calls, []);
});

test("workspace name confirmation reads immediate input and retired dialog actions cannot affect a replacement", async context => {
  const h = harness(context);
  await h.dispatch("project-actions:p:rename");
  const input = h.dialogHandler("workspace-dialog-name");
  const confirm = h.dialogHandler("workspace-dialog-confirm");
  const cancel = h.dialogHandler("workspace-dialog-cancel");
  input.run(" Immediate name ");
  confirm.run(null);
  confirm.run(null);
  assert.deepEqual(h.calls, [["rename-project", "p", "Immediate name"]], "confirm before a render uses the latest name once");
  h.render();
  await h.dispatch("group-actions:g:rename");
  input.run("wrong target"); cancel.run(null); confirm.run(null);
  h.render();
  assert.equal(h.node("workspace-dialog-name").value, "Group", "retired controls cannot edit or dismiss the new group dialog");
  h.dialogHandler("workspace-dialog-name").run(" Latest group ");
  h.dialogHandler("workspace-dialog-confirm").run(null);
  assert.deepEqual(h.calls.at(-1), ["rename-group", "g", "Latest group"]);
});
