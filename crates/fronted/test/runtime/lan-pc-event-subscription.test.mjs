import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture(t, subscribe) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [], received = [];
  let relay, unlistened = 0;
  const emit = (id, payload, closed = false) => relay({ payload: { subscriptionId: id, payload, closed } });
  const port = {
    async listen(_, handler) { relay = handler; return () => unlistened++; },
    async invoke(command, args) {
      calls.push({ command, args });
      if (command === "lan_pc_subscribe") {
        return subscribe ? subscribe(args, emit) : { subscriptionId: `remote-${calls.length}`, peerId: args.peer_id ?? "original-pc" };
      }
    },
  };
  const { listenLanPcEvent } = createTsModuleLoader().loadModule("src/runtime/lanPcEventSubscription.ts");
  return { calls, received, emit, unlistened: () => unlistened,
    start: (peerId) => listenLanPcEvent(port, "http://original-lan:28367", "terminal:stream", e => received.push(e.payload), peerId) };
}

test("first subscription honors the task's captured physical peer identity", async t => {
  const f = fixture(t);
  const stop = await f.start("captured-before-repairing-address");
  assert.equal(f.calls[0].args.peer_id, "captured-before-repairing-address");
  stop();
});

test("events arriving before subscribe ACK are delivered, foreign subscriptions are ignored", async t => {
  const f = fixture(t, (args, emit) => {
    emit("foreign", "wrong"); emit(args.relay_id, "first");
    return { subscriptionId: "remote", peerId: "original-pc" };
  });
  const stop = await f.start();
  assert.deepEqual(f.received, ["first"]);
  stop(); stop(); await flush();
  assert.equal(f.unlistened(), 1);
  assert.deepEqual(f.calls.at(-1), { command: "lan_pc_unsubscribe", args: { subscription_id: "remote" } });
});

test("EOF reselects endpoints only on the captured peer and suppresses old connection events", async t => {
  const f = fixture(t); const stop = await f.start();
  const original = f.calls[0].args.relay_id;
  f.emit(original, null, true); f.emit(original, "stale");
  t.mock.timers.tick(999); await flush();
  assert.equal(f.calls.filter(c => c.command === "lan_pc_subscribe").length, 1);
  t.mock.timers.tick(1); await flush();
  const retry = f.calls.findLast(c => c.command === "lan_pc_subscribe");
  assert.equal(retry.args.peer_id, "original-pc");
  assert.equal(retry.args.base_url, "http://original-lan:28367");
  assert.notEqual(retry.args.relay_id, original);
  f.emit(original, "late"); f.emit(retry.args.relay_id, "resumed");
  assert.deepEqual(f.received, ["resumed"]);
  assert.ok(f.calls.every(c => c.command !== "lan_pc_invoke"));
  stop();
});

test("EOF before registration ACK cleans up its real remote ID and reconnects once", async t => {
  const f = fixture(t, (args, emit) => {
    emit(args.relay_id, null, true);
    return { subscriptionId: "ended-before-ack", peerId: "original-pc" };
  });
  const stop = await f.start();
  assert.equal(f.calls.at(-1).args.subscription_id, "ended-before-ack");
  t.mock.timers.tick(1000); await flush();
  assert.equal(f.calls.filter(c => c.command === "lan_pc_subscribe").length, 2);
  stop(); t.mock.timers.tick(60000); await flush();
  assert.equal(f.calls.filter(c => c.command === "lan_pc_subscribe").length, 2);
});

test("unlisten during reconnect releases a late accepted subscription without delivering events", async t => {
  let finish, number = 0;
  const f = fixture(t, () => ++number === 1
    ? { subscriptionId: "first", peerId: "original-pc" }
    : new Promise(resolve => { finish = resolve; }));
  const stop = await f.start();
  f.emit(f.calls[0].args.relay_id, null, true);
  t.mock.timers.tick(1000); await flush();
  const retry = f.calls.findLast(c => c.command === "lan_pc_subscribe");
  stop(); f.emit(retry.args.relay_id, "late");
  finish({ subscriptionId: "late-accepted", peerId: "original-pc" }); await flush();
  assert.deepEqual(f.received, []);
  assert.equal(f.calls.at(-1).args.subscription_id, "late-accepted");
  t.mock.timers.tick(120000); await flush(); assert.equal(number, 2);
});

test("unlisten cancels backoff; EOF duplicates cannot schedule multiple reconnects", async t => {
  const f = fixture(t); const stop = await f.start();
  const id = f.calls[0].args.relay_id;
  f.emit(id, null, true); f.emit(id, null, true); stop();
  t.mock.timers.tick(120000); await flush();
  assert.equal(f.calls.filter(c => c.command === "lan_pc_subscribe").length, 1);
  assert.equal(f.calls.filter(c => c.command === "lan_pc_unsubscribe").length, 1);
});

test("initial failure removes the local listener and returns the real error", async t => {
  const f = fixture(t, () => { throw new Error("permission denied"); });
  await assert.rejects(f.start(), /permission denied/);
  assert.equal(f.unlistened(), 1);
  t.mock.timers.tick(60000); await flush(); assert.equal(f.calls.length, 1);
});

test("failed reconnects back off and never re-resolve ownership from the old address", async t => {
  let number = 0;
  const f = fixture(t, () => {
    if (++number === 1) return { subscriptionId: "first", peerId: "original-pc" };
    throw new Error("original computer offline");
  });
  const stop = await f.start();
  f.emit(f.calls[0].args.relay_id, null, true);
  t.mock.timers.tick(1000); await flush(); assert.equal(number, 2);
  t.mock.timers.tick(1999); await flush(); assert.equal(number, 2);
  t.mock.timers.tick(1); await flush(); assert.equal(number, 3);
  for (const call of f.calls.filter(c => c.command === "lan_pc_subscribe").slice(1)) {
    assert.equal(call.args.peer_id, "original-pc");
  }
  stop();
});

test("a mismatched reconnect receipt is released and cannot change the captured owner", async t => {
  let number = 0;
  const f = fixture(t, () => ++number === 1
    ? { subscriptionId: "first", peerId: "original-pc" }
    : { subscriptionId: `foreign-${number}`, peerId: "replacement-pc" });
  const stop = await f.start();
  f.emit(f.calls[0].args.relay_id, null, true);
  t.mock.timers.tick(1000); await flush();
  assert.equal(f.calls.at(-1).args.subscription_id, "foreign-2");
  t.mock.timers.tick(2000); await flush();
  assert.equal(number, 3);
  for (const call of f.calls.filter(c => c.command === "lan_pc_subscribe").slice(1)) {
    assert.equal(call.args.peer_id, "original-pc");
  }
  stop();
});
