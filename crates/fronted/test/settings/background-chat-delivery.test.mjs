import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
function start(t, changes = {}) {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const calls = [], acknowledgments = [];
  const { startBackgroundInboxReceiver } = createTsModuleLoader().loadModule("src/lib/automation/backgroundInboxReceiver.ts");
  const ports = {
    async listBackgroundInbox() { calls.push("list"); return { items: [], nextCursor: null }; },
    async syncBackgroundInbox() { calls.push("sync"); },
    async acknowledgeBackgroundInbox(id) { acknowledgments.push(id); },
    show() { assert.fail("No unread notices in fixture"); },
    async projectBackgroundChatResults(cursor) { calls.push(["project", cursor]); return { changed: 1, nextCursor: cursor === 0 ? 80 : cursor === 80 ? 60 : null }; },
    ...changes,
  };
  const receiver = startBackgroundInboxReceiver(ports);
  t.after(() => receiver.stop());
  return { calls, acknowledgments, receiver };
}

test("original chat pages rotate independently of read notices and offline source sync, without result ACK", async t => {
  const f = start(t, { async syncBackgroundInbox() { f.calls.push("sync"); throw new Error("Original worker offline"); } });
  await flush();
  assert.deepEqual(f.calls.filter(Array.isArray), [["project", 0], ["project", 80]]);
  assert.ok(f.calls.indexOf("sync") > f.calls.findIndex(Array.isArray));
  t.mock.timers.tick(30000); await flush();
  assert.deepEqual(f.calls.filter(Array.isArray).slice(2), [["project", 60], ["project", 0]]);
  assert.deepEqual(f.acknowledgments, []);
});

test("foreground work defers chat changes while result receipt continues; idle delivers retained pages", async t => {
  let busy = true;
  const f = start(t, { shouldDeferNotices: () => busy });
  await flush(); assert.equal(f.calls.filter(Array.isArray).length, 0); assert.ok(f.calls.includes("sync"));
  busy = false; f.receiver.attentionChanged(); await flush();
  assert.deepEqual(f.calls.filter(Array.isArray), [["project", 0], ["project", 80]]);
  assert.deepEqual(f.acknowledgments, []);
});

test("failed or malformed delivery pages retry the same cursor without blocking inbox synchronization", async t => {
  const cursors = []; let attempt = 0;
  const f = start(t, { async projectBackgroundChatResults(cursor) {
    cursors.push(cursor); attempt++;
    if (attempt === 1) throw new Error("History disk unavailable");
    if (attempt === 2) return { changed: 1, nextCursor: -1 };
    return { changed: 0, nextCursor: null };
  } });
  await flush(); assert.deepEqual(cursors, [0, 0]); assert.ok(f.calls.includes("sync"));
  t.mock.timers.tick(30000); await flush(); assert.deepEqual(cursors, [0, 0, 0, 0]);
  assert.deepEqual(f.acknowledgments, []);
});

test("hidden foreground work still defers original chat writes when visible notices are allowed", async t => {
  const f = start(t, { shouldDeferNotices: () => false, shouldDeferChatDelivery: () => true });
  await flush(); assert.equal(f.calls.filter(Array.isArray).length, 0); assert.ok(f.calls.includes("sync"));
  assert.deepEqual(f.acknowledgments, []);
});

test("stop during a slow projection cannot advance delivery or start network/notice work", async t => {
  let finish; const calls = [];
  const f = start(t, { projectBackgroundChatResults(cursor) { calls.push(cursor); return new Promise(resolve => { finish = resolve; }); } });
  await flush(); f.receiver.stop(); finish({ changed: 1, nextCursor: 80 }); await flush();
  assert.deepEqual(calls, [0]); assert.equal(f.calls.includes("sync"), false);
  assert.deepEqual(f.acknowledgments, []);
});
