import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const flush = async () => { for (let i = 0; i < 180; i++) await Promise.resolve(); };
function setup(t, { count = 25, visible = false, sync, post, attention = { deferred: false } } = {}) {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { startBackgroundInboxReceiver } = createTsModuleLoader().loadModule("src/lib/automation/backgroundInboxReceiver.ts");
  const entries = Array.from({ length: count }, (_, i) => ({ id: `${i + 1}`, sequence: i + 1 }));
  const posted = [], shown = [], acks = [], calls = [], accepted = new Set();
  const ports = {
    isVisible: () => visible,
    shouldDeferNotices: () => attention.deferred,
    async listBackgroundInbox(cursor, limit, unread) {
      assert.equal(unread, true); const remaining = entries.filter((entry) => entry.sequence > cursor);
      const items = remaining.slice(0, limit);
      return { items, nextCursor: remaining.length > limit ? items.at(-1).sequence : null };
    },
    async syncBackgroundInbox() { calls.push("sync"); await sync; return {}; },
    async notifyBackgroundInbox(id) {
      posted.push(id); const result = post ? await post(id) : "accepted";
      if (result === "accepted") accepted.add(id);
      return result;
    },
    async acknowledgeBackgroundInbox(id) { acks.push(id); },
    show(entry) { shown.push(entry.id); return () => {}; },
  };
  return { start: () => startBackgroundInboxReceiver(ports), posted, shown, acks, calls, accepted };
}

test("visible busy conversation holds system notices while receiving results and resumes all pages without read ACK", async t => {
  const attention = { deferred: true }, f = setup(t, { visible: true, attention });
  const receiver = f.start(); t.after(() => receiver.stop()); await flush();
  assert.deepEqual(f.posted, []); assert.deepEqual(f.shown, []);
  assert.ok(f.calls.includes("sync")); assert.deepEqual(f.acks, []);
  attention.deferred = false; receiver.attentionChanged(); await flush();
  t.mock.timers.tick(30_000); await flush();
  assert.equal(f.accepted.size, 25); assert.deepEqual(f.acks, []);
});

test("work starting during an OS submission stops later notices without claiming the in-flight request was undone", async t => {
  let complete, first = true;
  const attention = { deferred: false };
  const f = setup(t, { count: 3, visible: true, attention, post: async () => {
    if (first) { first = false; await new Promise(resolve => { complete = resolve; }); }
    return "accepted";
  } });
  const receiver = f.start(); t.after(() => receiver.stop()); await flush();
  assert.deepEqual(f.posted, ["1"]);
  attention.deferred = true; receiver.attentionChanged(); complete(); await flush();
  assert.deepEqual(f.posted, ["1"]); assert.equal(f.accepted.has("1"), true);
  assert.deepEqual(f.acks, []);
  attention.deferred = false; receiver.attentionChanged(); await flush();
  assert.equal(f.accepted.size, 3); assert.deepEqual(f.acks, []);
});

test("hidden mobile receiver submits system notices for all queued pages without showing cards or marking read", async (t) => {
  const f = setup(t); const receiver = f.start(); t.after(() => receiver.stop()); await flush();
  assert.equal(f.accepted.size, 25); assert.equal(f.posted.length, 25);
  assert.deepEqual(f.shown, []); assert.deepEqual(f.acks, []); assert.deepEqual(f.calls, ["sync"]);
});

test("cached system notices precede slow PC sync and later receipts are not starved by four persistent cards", async (t) => {
  let release; const f = setup(t, { visible: true, sync: new Promise((resolve) => { release = resolve; }) });
  const receiver = f.start(); t.after(() => receiver.stop()); await flush();
  assert.equal(f.accepted.size, 20); assert.deepEqual(f.shown, ["1", "2", "3", "4"]);
  receiver.refresh(); await flush(); assert.equal(f.calls.length, 1);
  release(); await flush(); assert.equal(f.accepted.size, 25); assert.deepEqual(f.acks, []);
});

test("denied authorization retains results for a later explicit permission grant without an ACK", async (t) => {
  let granted = false; const f = setup(t, { count: 2, post: async () => granted ? "accepted" : "blocked" });
  const receiver = f.start(); t.after(() => receiver.stop()); await flush();
  assert.equal(f.accepted.size, 0); assert.deepEqual(f.acks, []);
  granted = true; receiver.refresh(); await flush(); assert.deepEqual([...f.accepted], ["1", "2"]);
});

test("failed or superseded notices cannot fabricate acceptance or read receipts; transient failures retry", async (t) => {
  let failed = true; const f = setup(t, { count: 3, post: async (id) => {
    if (id === "1" && failed) throw new Error("OS IPC failed");
    return id === "2" ? "obsolete" : "accepted";
  } });
  const receiver = f.start(); t.after(() => receiver.stop()); await flush();
  assert.deepEqual([...f.accepted], ["3"]); failed = false;
  t.mock.timers.tick(30_000); await flush(); assert.deepEqual([...f.accepted].sort(), ["1", "3"]);
  assert.deepEqual(f.acks, []);
});

test("shutdown during OS IPC does not submit later entries or start a late synchronization", async (t) => {
  let release; const f = setup(t, { post: () => new Promise((resolve) => { release = resolve; }) });
  const receiver = f.start(); await flush(); assert.deepEqual(f.posted, ["1"]);
  receiver.stop(); release("accepted"); await flush(); assert.deepEqual(f.posted, ["1"]);
  assert.deepEqual(f.calls, []); assert.deepEqual(f.acks, []);
});

test("system notification command uses the original native device even when a different PC is selected", async () => {
  for (const [native, mobile] of [[true, true], [true, false], [false, true]]) {
    const nativeCalls = [], remoteCalls = [];
    const { backend } = createTsModuleLoader({ mocks: {
      "@tauri-apps/api/core": { async invoke(command, args) { nativeCalls.push({ command, args }); return "accepted"; } },
      "@xgent/runtime": { isTauriRuntime: () => native, getLanPcCommandHostConfig: () => ({ enabled: true, baseUrl: "http://different-pc:8080" }), invoke: async (...args) => { remoteCalls.push(args); }, listen: async () => () => {} },
      "../runtimePlatform": { isNativeMobileRuntime: () => mobile },
    } }).loadModule("src/lib/automation/backend.ts");
    assert.equal(await backend.notifyBackgroundInbox("original-entry"), native && mobile ? "accepted" : "unavailable");
    assert.deepEqual(nativeCalls, native && mobile ? [{ command: "automation_result_notify", args: { entry_id: "original-entry" } }] : []);
    assert.deepEqual(remoteCalls, []);
  }
});
