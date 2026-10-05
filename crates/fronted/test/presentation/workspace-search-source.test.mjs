import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function harness({ mobile = false, history = async () => [], files = async () => ({ paths: [] }), workdir = "/work" } = {}) {
  const calls = [], errors = [];
  const loader = createTsModuleLoader({ mocks: {
    "../chat/history/chatHistory": { searchChatHistory: (...args) => { calls.push(["history", ...args]); return history(...args); } },
    "../tools/fsBackend": { invokeFs: (...args) => { calls.push(["files", ...args]); return files(...args); } },
  } });
  const { createWorkspaceSearchSource } = loader.loadModule("src/lib/search/workspaceSearchSource.ts");
  const props = { open: true, conversations: Array.from({ length: 7 }, (_, n) => ({ id: `c${n}`, title: n ? `Chat ${n}` : "" })), workdir,
    onOpenChange: value => calls.push(["open", value]),
    onSelectConversation: id => calls.push(["chat", id]), onOpenFile: path => calls.push(["file", path]),
    onOpenSettings: section => calls.push(["settings", section]), onNewConversation: () => calls.push(["new"]),
    onCreateProject: () => calls.push(["folder"]),
  };
  const search = createWorkspaceSearchSource(props, mobile, key => key, message => errors.push(message));
  return { ...search, calls, errors, props };
}

test("shared palette starts with recent chats and real settings/actions, respecting mobile routes", async () => {
  for (const mobile of [false, true]) {
    const h = harness({ mobile });
    const items = h.source.bootstrap();
    assert.equal(items.filter(item => item.icon === "chat").length, 5);
    assert.equal(items[0].label, "tray.untitledConversation");
    for (const section of ["system", "providers", "backup", "toolPermissions", "soul", "memory", "access", "hooks", "cron", "ssh", "about"]) {
      const item = items.find(item => item.id.startsWith(`settings:${section}:`));
      assert.ok(item); item.select();
      assert.deepEqual(h.calls.at(-1), ["settings", section]);
    }
    assert.equal(items.some(item => item.id.startsWith("settings:shortcuts:")), !mobile);
    assert.equal(items.some(item => item.id.startsWith("settings:mobileExecution:")), mobile);
    items.find(item => item.id === "new").select();
    items.find(item => item.id === "folder").select();
    assert.deepEqual(h.calls.slice(-2), [["new"], ["folder"]]);
    assert.equal(h.currentResults(), items);
  }
});

test("shared palette searches message contents and literal workspace paths through the existing backends", async () => {
  const h = harness({ history: async () => [{ conversationId: "old", title: "Archived chat", snippet: "See [report]" }], files: async () => ({ paths: ["/work/report[final].md"] }) });
  const items = await h.source.search(" report[final] ");
  assert.deepEqual(h.calls[0], ["history", "report[final]", 20]);
  assert.deepEqual(h.calls[1], ["files", "fs_glob", { workdir: "/work", pattern: "**/*report[[]final[]]*", max_results: 20 }]);
  assert.equal(items[0].description, "See report");
  items[0].select(); items[1].select();
  assert.deepEqual(h.calls.slice(-2), [["chat", "old"], ["file", "/work/report[final].md"]]);
  assert.equal(items[1].auxiliaryData.group, "search.files");
});

test("one failed backend keeps successful results and searchable settings usable", async () => {
  const h = harness({ history: async () => { throw Error("offline"); }, files: async () => ({ paths: ["/work/settings.txt"] }) });
  const items = await h.source.search("settings");
  assert.equal(items[0].icon, "file");
  assert.ok(items.some(item => item.icon === "settings"));
  assert.equal(h.errors.at(-1), "chat.history.searchFailed");
  const noFiles = harness({ workdir: "", history: async () => [{ conversationId: "a", title: "", snippet: "" }] });
  assert.equal((await noFiles.source.search("a"))[0].icon, "chat");
  assert.equal(noFiles.calls.some(call => call[0] === "files"), false);
});

test("canceled or superseded queries cannot replace current results or publish late errors", async () => {
  let finish;
  const h = harness({ history: query => query === "old" ? new Promise((_, reject) => { finish = reject; }) : Promise.resolve([{ conversationId: "new", title: "New result", snippet: "" }]) });
  const old = h.source.search("old");
  const current = await h.source.search("new");
  finish(Error("old failure"));
  assert.deepEqual(Array.from(await old), []);
  assert.equal(h.currentResults(), current);
  assert.equal(h.errors.at(-1), "");
  const canceled = h.source.search("old"); h.source.cancel(); finish(Error("retired"));
  assert.deepEqual(Array.from(await canceled), []);
  assert.equal(h.currentResults(), current);
  assert.equal(h.errors.at(-1), "");
});
