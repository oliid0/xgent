import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { createSidebarStore } = loader.loadModule("src/lib/sidebar/store.ts");
const { createNativeConversationActions, mutateNativeConversation } = loader.loadModule("src/presentation/nativeConversationActions.ts");
const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
const t = key => key;

function fixture() {
  let item = { id: "chat", title: "Chat", providerId: "provider", model: "model", createdAt: 1, updatedAt: 1 };
  const calls = [];
  const failures = new Set();
  const backend = {
    listConversations: async () => ({ items: [item], totalCount: 1 }),
    listWorkdirs: async () => [],
    subscribeEvents: () => () => {},
    renameConversation: async (id, title) => { calls.push(["rename", id, title]); if (failures.has("rename")) throw Error("offline"); return item = { ...item, title, updatedAt: 2 }; },
    setConversationPinned: async (id, isPinned) => { calls.push(["pin", id, isPinned]); return item = { ...item, isPinned, updatedAt: 3 }; },
    setConversationCwd: async (id, cwd) => { calls.push(["move", id, cwd]); if (failures.has("move")) throw Error("offline"); return item = { ...item, cwd, updatedAt: 4 }; },
    deleteConversation: async id => { calls.push(["delete", id]); if (failures.has("delete")) throw Error("offline"); },
  };
  const store = createSidebarStore(backend);
  store.upsertLocal(item);
  const registry = createPresentationActionRegistry();
  const moved = [], renamed = [], deleted = [];
  let request = 0;
  function menu() {
    const actions = createNativeConversationActions({ item: store.peek("chat"), store,
      projects: [{ id: "project", name: "Project", path: "/project" }], currentId: "chat",
      onRename: item => renamed.push(item.title), onDelete: id => deleted.push(id), onMoved: (...args) => moved.push(args) }, t);
    registry.register("sidebar", actions.handlers);
    return actions.menu;
  }
  menu();
  return { store, menu, calls, failures, moved, renamed, deleted,
    dispatch: action => registry.dispatch({ surface: "sidebar", action: `conversation-actions:chat:${action}`, value: null, requestId: String(++request) }) };
}

test("native sidebar pin/move use the real store; destructive actions only request confirmation", async () => {
  const h = fixture();
  assert.equal((await h.dispatch("pin")).ok, true);
  assert.equal(h.store.peek("chat").isPinned, true);
  h.menu();
  assert.equal((await h.dispatch("rename")).ok, true);
  assert.equal((await h.dispatch("delete")).ok, true);
  assert.deepEqual(h.renamed, ["Chat"]);
  assert.deepEqual(h.deleted, ["chat"]);
  assert.equal(h.calls.some(call => call[0] === "delete" || call[0] === "rename"), false);
  assert.equal((await h.dispatch("move:project")).ok, true);
  assert.equal(h.store.peek("chat").cwd, "/project");
  assert.deepEqual(h.moved, [["chat", "/project"]]);
  assert.equal(h.menu().children.some(node => node.id.endsWith(":move")), false);
});

test("running state disables destructive actions and rechecks stale native pin/move requests", async () => {
  const h = fixture();
  h.store.applyRunningPatch({ conversationId: "chat", running: true });
  // Menu was created while idle; backend state changed before the click.
  assert.match((await h.dispatch("move:project")).error, /moveBlockedRunning/);
  h.menu();
  assert.equal((await h.dispatch("rename")).ok, false);
  assert.equal((await h.dispatch("delete")).ok, false);
  assert.equal((await h.dispatch("pin")).ok, true, "Running chats may still be pinned on every client");
  assert.equal(h.calls.filter(call => call[0] === "move").length, 0);
});

test("failed native moves/deletes roll back and never send a successful runtime callback", async () => {
  const h = fixture();
  h.failures.add("move");
  assert.match((await h.dispatch("move:project")).error, /moveFailed/);
  assert.equal(h.store.peek("chat").cwd, undefined);
  assert.deepEqual(h.moved, []);
  h.failures.add("delete");
  await assert.rejects(mutateNativeConversation(h.store, "chat", "delete", () => h.store.remove("chat"), t), /deleteFailed/);
  assert.equal(h.store.peek("chat").title, "Chat");
  await mutateNativeConversation(h.store, "chat", "rename", () => h.store.rename("chat", "New title"), t);
  assert.equal(h.store.peek("chat").title, "New title");
});

test("pending and removed conversations cannot mutate through a captured native action", async () => {
  const h = fixture();
  h.store.upsertLocal({ ...h.store.peek("chat"), isPending: true });
  assert.equal((await h.dispatch("pin")).ok, false);
  h.store.removeLocal("chat");
  await assert.rejects(mutateNativeConversation(h.store, "chat", "delete", () => h.store.remove("chat"), t), /deleteFailed/);
  assert.deepEqual(h.calls, []);
});
