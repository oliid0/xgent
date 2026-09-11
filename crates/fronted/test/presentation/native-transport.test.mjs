import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
const { createPresentationDocumentChannel } = loader.loadModule("src/presentation/documentChannel.ts");
const event = (requestId, action = "send", value = null, surface = "chat") => ({ surface, action, requestId, value });
const handler = (run, enabled = true) => new Map([["send", { enabled, accepts: (value) => value === null, run }]]);
const document = (revision, overrides = {}) => ({
  version: 1, surface: "chat", revision, mode: "root", title: "Chat", appearance: "system", nodes: [], ...overrides,
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test("native actions cannot execute disabled, removed, foreign or malformed handlers", async () => {
  const registry = createPresentationActionRegistry();
  let executions = 0;
  registry.register("chat", handler(() => { executions++; }, false));
  assert.equal((await registry.dispatch(event("disabled"))).ok, false);
  registry.register("chat", handler(() => { executions++; }));
  assert.equal((await registry.dispatch(event("bad-value", "send", "text"))).ok, false);
  assert.equal((await registry.dispatch(event("foreign", "send", null, "settings"))).ok, false);
  const closing = registry.dispatch(event("unmount"));
  registry.remove("chat");
  assert.equal((await closing).ok, false);
  assert.equal(executions, 0);
});

test("pending native actions stay deduplicated while more than 256 other requests settle", async () => {
  const registry = createPresentationActionRegistry();
  const work = deferred();
  let executions = 0;
  registry.register("chat", handler(() => { executions++; return work.promise; }));
  const pending = registry.dispatch(event("pending"));
  await Promise.resolve();
  registry.register("chat", handler(() => undefined));
  for (let index = 0; index < 300; index++) await registry.dispatch(event(`other-${index}`));
  assert.equal(registry.dispatch(event("pending")), pending);
  assert.equal((await registry.dispatch(event("pending", "send", "different"))).ok, false);
  work.resolve();
  assert.equal((await pending).ok, true);
  assert.equal(registry.dispatch(event("pending")), pending);
  assert.equal(executions, 1);
});

test("native handler failures return an error acknowledgement and registry snapshots are immutable", async () => {
  const registry = createPresentationActionRegistry();
  const handlers = handler(() => { throw new Error("Save failed"); });
  registry.register("chat", handlers);
  handlers.clear();
  assert.deepEqual(await registry.dispatch(event("error")), {
    surface: "chat", requestId: "error", ok: false, error: "Save failed",
  });
});

test("streaming snapshots coalesce behind one native invocation and removal arrives last", async () => {
  const deliveries = [];
  const work = deferred();
  const channel = createPresentationDocumentChannel(async (snapshot) => {
    deliveries.push(snapshot);
    if (deliveries.length === 1) await work.promise;
  });
  const first = channel.publish(document(1));
  const intermediate = channel.publish(document(2));
  const removal = channel.publish(document(3, { removed: true }));
  assert.equal(deliveries.length, 1);
  work.resolve();
  await Promise.all([first, intermediate, removal]);
  assert.deepEqual(deliveries.map((item) => item.revision), [1, 3]);
  assert.equal(deliveries[1].removed, true);
});

test("failed publication rejects its callers while a newer snapshot can still be delivered", async () => {
  const work = deferred();
  const deliveries = [];
  const channel = createPresentationDocumentChannel(async (snapshot) => {
    deliveries.push(snapshot);
    if (snapshot.revision === 1) await work.promise;
  });
  const failure = assert.rejects(channel.publish(document(1)), /Connection lost/);
  const source = document(2, { nodes: [{ id: "message", kind: "Text", text: "Original" }] });
  const next = channel.publish(source);
  source.nodes[0].text = "Mutated";
  work.reject(new Error("Connection lost"));
  await Promise.all([failure, next]);
  assert.equal(deliveries[1].nodes[0].text, "Original");
  await assert.rejects(channel.publish(document(2)), /revisions/);
  await assert.rejects(channel.publish(document(3, { surface: "settings" })), /revisions/);
});
