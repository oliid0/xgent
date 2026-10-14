import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const item = (id, overrides = {}) => ({ id, sequence: Number(id) || 1, sourceHostId: "host", requestId: "request", name: "Actual report", state: "done", success: true, preview: "Retained result", artifactCount: 0, receivedAt: 1, readAt: null, ...overrides });
function setup(t, options = {}) {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { startBackgroundInboxReceiver } = createTsModuleLoader().loadModule("src/lib/automation/backgroundInboxReceiver.ts");
  let entries = options.items ?? [item("1")]; const notices = [], calls = [], acks = [];
  const ports = {
    async listBackgroundInbox(cursor, limit, unread) { calls.push(["list", cursor, limit, unread]); return { items: entries.slice(0, limit), nextCursor: null }; },
    async syncBackgroundInbox() { calls.push(["sync"]); if (options.sync) await options.sync; if (options.offline) throw new Error("Offline original host"); return { inspected: 1, received: 1, unresolved: 0 }; },
    async acknowledgeBackgroundInbox(id) { acks.push(id); if (options.ackFails) throw new Error("Disk write failed"); entries = entries.filter((entry) => entry.id !== id); },
    show(value, acknowledge) { const notice = { value, acknowledge, dismissed: 0 }; notices.push(notice); return () => { notice.dismissed++; acknowledge(); }; },
    isVisible: () => options.visible !== false,
    shouldDeferNotices: () => options.deferred === true,
  };
  return { start: () => startBackgroundInboxReceiver(ports), notices, calls, acks, setEntries: (next) => { entries = next; } };
}

test("foreground work defers cards while immutable result synchronization continues without ACK", async t => {
  const options = { deferred: true };
  const f = setup(t, options), receiver = f.start(); t.after(() => receiver.stop());
  await flush();
  assert.equal(f.notices.length, 0);
  assert.equal(f.calls.filter(([call]) => call === "sync").length, 1);
  assert.deepEqual(f.acks, []);
  options.deferred = false; receiver.attentionChanged(); await flush();
  assert.equal(f.notices.length, 1);
  assert.deepEqual(f.acks, []);
});

test("starting work withdraws shown cards without marking read; idle resumes the original retained result", async t => {
  const options = { deferred: false };
  const f = setup(t, options), receiver = f.start(); t.after(() => receiver.stop());
  await flush(); assert.equal(f.notices.length, 1);
  options.deferred = true; receiver.attentionChanged(); await flush();
  assert.equal(f.notices[0].dismissed, 1);
  f.notices[0].acknowledge(); assert.deepEqual(f.acks, []);
  options.deferred = false; receiver.attentionChanged(); await flush();
  assert.equal(f.notices.length, 2);
  assert.equal(f.notices[1].value.id, "1");
  f.notices[1].acknowledge(); await flush(); assert.deepEqual(f.acks, ["1"]);
});

test("stop while deferred never acknowledges or creates a late notice after slow synchronization", async t => {
  let finish;
  const options = { deferred: true, sync: new Promise(resolve => { finish = resolve; }) };
  const f = setup(t, options), receiver = f.start(); await flush();
  receiver.stop(); options.deferred = false; finish(); await flush();
  assert.equal(f.notices.length, 0); assert.deepEqual(f.acks, []);
});

test("cached results appear before slow/offline sync and receiving does not acknowledge them", async (t) => {
  let finish; const f = setup(t, { sync: new Promise((resolve) => { finish = resolve; }), offline: true });
  const receiver = f.start(); t.after(() => receiver.stop()); await flush();
  assert.equal(f.notices.length, 1); assert.deepEqual(f.calls.slice(0, 2), [["list", 0, 4, true], ["sync"]]); assert.deepEqual(f.acks, []);
  finish(); await flush(); assert.equal(f.notices.length, 1); assert.deepEqual(f.acks, []);
});

test("explicit close acknowledges once, fills a bounded notice queue, and stop never acknowledges", async (t) => {
  const f = setup(t, { items: Array.from({ length: 7 }, (_, i) => item(String(i + 1))) }); const receiver = f.start(); await flush();
  assert.equal(f.notices.length, 4); f.notices[0].acknowledge(); f.notices[0].acknowledge(); await flush(); assert.deepEqual(f.acks, ["1"]);
  t.mock.timers.tick(30_000); await flush(); assert.equal(f.notices.length, 5);
  receiver.stop(); assert.deepEqual(f.acks, ["1"]); assert.equal(f.notices[1].dismissed, 1);
});

test("superseded waiting notice disappears without ACK and an older callback cannot mark the new result read", async (t) => {
  const f = setup(t, { items: [item("1", { state: "waiting", success: false })] }); const receiver = f.start(); t.after(() => receiver.stop()); await flush();
  f.setEntries([item("2")]); t.mock.timers.tick(30_000); await flush();
  assert.equal(f.notices[0].dismissed, 1); f.notices[0].acknowledge(); assert.deepEqual(f.acks, []);
  assert.equal(f.notices[1].value.id, "2");
});

test("failed ACK remains retryable and stopping does not acknowledge it", async (t) => {
  const f = setup(t, { ackFails: true }); const receiver = f.start(); await flush(); f.notices[0].acknowledge(); await flush();
  t.mock.timers.tick(30_000); await flush(); assert.equal(f.notices.length, 2); receiver.stop(); assert.deepEqual(f.acks, ["1"]);
});

test("a hidden view does not poll or show notices until it becomes visible", async (t) => {
  const options = { visible: false }; const f = setup(t, options); const receiver = f.start(); t.after(() => receiver.stop()); await flush();
  t.mock.timers.tick(30_000); await flush(); assert.deepEqual(f.calls, []); assert.equal(f.notices.length, 0);
  options.visible = true; receiver.refresh(); await flush(); assert.equal(f.notices.length, 1); assert.deepEqual(f.acks, []);
});

test("overlapping refreshes do not duplicate sync and shutdown suppresses late delivery", async (t) => {
  let release; const f = setup(t, { items: [], sync: new Promise((resolve) => { release = resolve; }) }); const receiver = f.start(); await flush();
  t.mock.timers.tick(60_000); receiver.refresh(); await flush(); assert.equal(f.calls.filter(([call]) => call === "sync").length, 1);
  receiver.stop(); f.setEntries([item("1")]); release(); await flush(); assert.equal(f.notices.length, 0);
});

const snapshotLoader = () => createTsModuleLoader({ mocks: { "./backend": { backend: {} } } }).loadModule("src/lib/automation/backgroundInboxSnapshot.ts");
test("snapshot reads actual consecutive Unicode chunks and verifies the full stored hash/source", async () => {
  const payload = { requestId: "request", hostId: "host", run: { output: "中文🙂".repeat(3000) }, artifacts: [] };
  const text = JSON.stringify(payload), bytes = Buffer.from(text), hash = createHash("sha256").update(bytes).digest("hex"), calls = [];
  const { readInboxSnapshot } = snapshotLoader();
  const actual = await readInboxSnapshot(item("1"), async (id, offset) => {
    calls.push(offset); let end = Math.min(offset + 16384, bytes.length); while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    return { entryId: id, offset, text: bytes.subarray(offset, end).toString(), totalBytes: bytes.length, snapshotHash: hash, nextOffset: end < bytes.length ? end : null };
  });
  assert.deepEqual(actual, payload); assert.ok(calls.length > 1);
});

test("truncated/corrupt/rebound/nonadvancing snapshots cannot supply displayed full results", async () => {
  const { readInboxSnapshot } = snapshotLoader(); const text = JSON.stringify({ requestId: "request", hostId: "host", run: {}, artifacts: [] });
  const valid = { entryId: "1", offset: 0, text, totalBytes: Buffer.byteLength(text), snapshotHash: createHash("sha256").update(text).digest("hex"), nextOffset: null };
  for (const change of [{ entryId: "other" }, { offset: 1 }, { nextOffset: 0 }, { snapshotHash: "0".repeat(64) }, { totalBytes: valid.totalBytes + 1 }]) await assert.rejects(readInboxSnapshot(item("1"), async () => ({ ...valid, ...change })));
  await assert.rejects(readInboxSnapshot(item("1", { sourceHostId: "other" }), async () => valid), /another task/);
});
