import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const lease = { attempt: 1, generation: 1, token: "11111111-1111-4111-8111-111111111111" };

const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function setup(t, overrides = {}) {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: 100_000 });
  const listeners = new Map();
  const completions = [];
  const released = [];
  const executed = [];
  const queue = ["a", "b", "c"].map((executionId) => ({ executionId, taskId: executionId, lease: { ...lease }, leaseExpiresAt: 200_000 }));
  const loader = createTsModuleLoader({ mocks: { "@xgent/runtime": {
    async listen(event, callback) { listeners.set(event, callback); return () => listeners.delete(event); },
  } } });
  const { startPromptRunHost } = loader.loadModule("src/lib/automation/promptRunHost.ts");
  const stop = startPromptRunHost({
    async claimPromptRuns(limit) { return queue.splice(0, limit); },
    async releasePromptRun(id) { released.push(id); },
    async completePromptRun(input) { completions.push(input); return { status: "completed" }; },
    execute(request, signal) { const done = deferred(); executed.push({ request, signal, done }); return done.promise; },
    ...overrides,
  });
  t.after(stop);
  const { BackgroundTaskWaiting, BackgroundBudgetDelegatesPending, BackgroundCloudLaunchPending, BackgroundChildLaunchPending } = loader.loadModule("src/lib/automation/backgroundWaiting.ts");
  return { stop, listeners, completions, released, executed, queue, BackgroundTaskWaiting, BackgroundBudgetDelegatesPending, BackgroundCloudLaunchPending, BackgroundChildLaunchPending };
}

const cloudFailure = () => ({ role: "toolResult", toolName: "CloudTaskManager", toolCallId: "cloud-original", isError: true, timestamp: 10,
  content: [{ type: "text", text: "Dispatch response was lost" }], details: { outcomeUncertain: true } });

test("unknown cloud start parks through original native authority without an error receipt or terminal completion", async t => {
  const parks = [], receipts = [];
  const host = setup(t, { async parkUnconfirmedCloudStart(...args) { parks.push(structuredClone(args)); return true; }, async completeBackgroundOperation(...args) { receipts.push(args); } });
  await flush(); const source = cloudFailure(), error = new host.BackgroundCloudLaunchPending(source); source.toolCallId = "other";
  host.executed[0].done.reject(error); await flush();
  assert.deepEqual(parks, [["a", "cloud-original", lease]]); assert.equal(receipts.length, 0); assert.equal(host.completions.length, 0);
  assert.equal(host.executed[2].request.executionId, "c");
});

test("cloud parking ACK loss retries only identical bookkeeping and blocks terminal delivery or replay", async t => {
  const parks = [], receipts = [];
  const host = setup(t, { async parkUnconfirmedCloudStart(...args) { parks.push(structuredClone(args)); if (parks.length < 3) throw new Error("parking ACK lost"); return true; }, async completeBackgroundOperation(...args) { receipts.push(args); } });
  await flush(); host.executed[0].done.reject(new host.BackgroundCloudLaunchPending(cloudFailure())); await flush();
  assert.equal(host.executed.length, 2);
  for (let i = 0; i < 2; i++) { t.mock.timers.tick(1000); await flush(); }
  assert.equal(parks.length, 3); assert.deepEqual(parks[0], parks[2]); assert.equal(receipts.length, 0); assert.equal(host.completions.length, 0);
  assert.equal(host.executed.filter(item => item.request.executionId === "a").length, 1);
});

const childFailure = () => ({ role: "toolResult", toolCallId: "child-original", toolName: "BackgroundTask", isError: true, timestamp: 100000, content: [{ type: "text", text: "Original device acceptance ACK lost" }], details: { outcomeUncertain: true } });

test("reserved child acceptance parks the original parent and frees capacity without failure or another submission", async t => {
  const parks = [], receipts = [];
  const host = setup(t, { async parkUnconfirmedChildStart(...args) { parks.push(structuredClone(args)); return true; }, async completeBackgroundOperation(...args) { receipts.push(args); } });
  await flush(); host.executed[0].done.reject(new host.BackgroundChildLaunchPending(childFailure())); await flush();
  assert.deepEqual(parks, [["a", "child-original", lease]]); assert.equal(receipts.length, 0); assert.equal(host.completions.length, 0);
  assert.equal(host.executed[2].request.executionId, "c"); assert.equal(host.executed.filter(e => e.request.executionId === "a").length, 1);
});

test("lost child parking ACK retries identical native bookkeeping and never re-executes the model", async t => {
  const parks = [], receipts = [];
  const host = setup(t, { async parkUnconfirmedChildStart(...args) { parks.push(structuredClone(args)); if (parks.length < 3) throw new Error("parking response lost"); return true; }, async completeBackgroundOperation(...args) { receipts.push(args); } });
  await flush(); host.executed[0].done.reject(new host.BackgroundChildLaunchPending(childFailure())); await flush();
  for (let i = 0; i < 2; i++) { t.mock.timers.tick(1000); await flush(); }
  assert.equal(parks.length, 3); assert.deepEqual(parks[0], parks[2]); assert.equal(receipts.length, 0); assert.equal(host.completions.length, 0);
  assert.equal(host.executed.filter(e => e.request.executionId === "a").length, 1);
});

test("only native reservation absence permits the original child error receipt and ordinary terminal failure", async t => {
  const parks = [], receipts = [], source = childFailure();
  const host = setup(t, { async parkUnconfirmedChildStart(...args) { parks.push(args); return false; }, async completeBackgroundOperation(...args) { receipts.push(structuredClone(args)); if (receipts.length === 1) throw new Error("receipt ACK lost"); } });
  await flush(); host.executed[0].done.reject(new host.BackgroundChildLaunchPending(source)); await flush();
  t.mock.timers.tick(1000); await flush();
  assert.equal(parks.length, 1); assert.deepEqual(receipts[0], ["a", "child-original", source, lease]); assert.deepEqual(receipts[0], receipts[1]);
  assert.equal(host.completions[0].success, false);
});

test("forged child suspension names and expiry cannot acquire native parking authority", async t => {
  const parks = [];
  const host = setup(t, { async parkUnconfirmedChildStart(...args) { parks.push(args); return true; } });
  await flush(); const fake = new Error("Unrelated failure"); fake.name = "BackgroundChildLaunchPending";
  host.executed[0].done.reject(fake); await flush(); assert.equal(host.completions[0].success, false);
  host.listeners.get("automation:prompt-expired")({ payload: { executionId: "b" } });
  host.executed[1].done.reject(new host.BackgroundChildLaunchPending(childFailure())); await flush();
  assert.equal(parks.length, 0); assert.equal(host.completions.length, 1);
});

test("only native no-reservation decision persists the original failed receipt; lost receipt delivery never re-parks", async t => {
  const parks = [], receipts = [], source = cloudFailure();
  const host = setup(t, { async parkUnconfirmedCloudStart(...args) { parks.push(args); return false; }, async completeBackgroundOperation(...args) { receipts.push(structuredClone(args)); if (receipts.length === 1) throw new Error("failure receipt ACK lost"); } });
  await flush(); host.executed[0].done.reject(new host.BackgroundCloudLaunchPending(source)); await flush();
  assert.equal(parks.length, 1); assert.equal(host.completions.length, 0);
  t.mock.timers.tick(1000); await flush();
  assert.equal(parks.length, 1); assert.equal(receipts.length, 2); assert.deepEqual(receipts[0], ["a", source.toolCallId, source, lease]); assert.deepEqual(receipts[0], receipts[1]);
  assert.equal(host.completions[0].success, false); assert.match(host.completions[0].output, /Dispatch response was lost/);
});

test("missing or malformed native cloud parking response never invents success or closes the intent", async t => {
  let count = 0;
  const host = setup(t, { async parkUnconfirmedCloudStart() { count++; return "true"; }, async completeBackgroundOperation() { assert.fail("No receipt may be invented"); } });
  await flush(); host.executed[0].done.reject(new host.BackgroundCloudLaunchPending(cloudFailure())); await flush();
  assert.equal(host.completions.length, 0); t.mock.timers.tick(1000); await flush(); assert.equal(count, 2);
});

test("waiting parks the original execution with retained output and releases a slot without terminal completion", async (t) => {
  const parked = [];
  const host = setup(t, { async waitBackgroundTask(input) { parked.push(structuredClone(input)); return { waitId: "occurrence" }; } });
  await flush();
  host.executed[0].done.reject(new host.BackgroundTaskWaiting("Actual report retained", "Need tomorrow's time", ["Read", "Calendar"]));
  await flush();
  assert.equal(host.completions.length, 0); assert.equal(parked.length, 1);
  assert.deepEqual(parked[0], { executionId: "a", lease, durationMs: 0, output: "Actual report retained", knownTools: ["Read", "Calendar"] });
  assert.equal(host.executed[2].request.executionId, "c");
});

test("confirmed delegate budget refusal parks with its immutable native cause and retries only the original wait", async (t) => {
  const parked = [], id = "22222222-2222-4222-8222-222222222222";
  const host = setup(t, { async waitBackgroundTask(input) { parked.push(structuredClone(input)); if (parked.length === 1) throw new Error("Wait ACK lost"); return null; } });
  await flush(); host.executed[0].done.reject(new host.BackgroundBudgetDelegatesPending({ id, kind: "modelRequests" })); await flush();
  assert.equal(parked[0].budgetDeferralId, id); assert.deepEqual(parked[0].lease, lease); assert.equal(host.completions.length, 0);
  t.mock.timers.tick(1000); await flush(); assert.deepEqual(parked[1], parked[0]);
  assert.equal(host.executed.filter(entry => entry.request.executionId === "a").length, 1);
});

test("a lost waiting ACK retries only the identical suspension, never execution or terminal failure", async (t) => {
  const parked = [];
  const host = setup(t, { async waitBackgroundTask(input) { parked.push(structuredClone(input)); if (parked.length < 3) throw new Error("waiting ACK lost"); return null; } });
  await flush();
  host.executed[0].done.reject(new host.BackgroundTaskWaiting("Saved files", "Calendar is unavailable", ["Read"]));
  await flush();
  assert.equal(host.executed.length, 2);
  for (let i = 0; i < 2; i++) { t.mock.timers.tick(1_000); await flush(); }
  assert.equal(parked.length, 3); assert.deepEqual(parked[0], parked[2]);
  assert.equal(host.completions.length, 0); assert.equal(host.executed.filter((item) => item.request.executionId === "a").length, 1);
});

test("a forged error name is not a durable waiting request", async (t) => {
  const parked = [];
  const host = setup(t, { async waitBackgroundTask(input) { parked.push(input); } });
  await flush(); const forged = new Error("External write failed"); forged.name = "BackgroundTaskWaiting";
  host.executed[0].done.reject(forged); await flush();
  assert.equal(parked.length, 0); assert.equal(host.completions[0].success, false);
});

test("expiry before suspension suppresses a late waiting transition", async (t) => {
  const parked = [];
  const host = setup(t, { async waitBackgroundTask(input) { parked.push(input); } });
  await flush(); host.listeners.get("automation:prompt-expired")({ payload: { executionId: "a" } });
  host.executed[0].done.reject(new host.BackgroundTaskWaiting("Retained", "Input needed")); await flush();
  assert.equal(parked.length, 0); assert.equal(host.completions.length, 0);
});

test("background host bounds execution and continues queued work after completion", async (t) => {
  const host = setup(t);
  await flush();
  assert.deepEqual(host.executed.map((item) => item.request.executionId), ["a", "b"]);
  t.mock.timers.tick(5_000);
  await flush();
  assert.equal(host.executed.length, 2);
  host.executed[0].done.resolve("saved real deliverable");
  await flush();
  assert.equal(host.completions[0].output, "saved real deliverable");
  assert.equal(host.completions[0].success, true);
  assert.equal(host.executed[2].request.executionId, "c");
});

test("completion retries keep the execution's original lease after claim objects change", async (t) => {
  const request = { executionId: "owned", taskId: "owned", lease: { ...lease }, leaseExpiresAt: 200_000 };
  let claimed = false;
  const delivered = [];
  const host = setup(t, {
    async claimPromptRuns() { if (claimed) return []; claimed = true; return [request]; },
    async completePromptRun(input) { delivered.push(structuredClone(input)); if (delivered.length === 1) throw new Error("ACK lost"); return { status: "completed" }; },
  });
  await flush();
  request.lease.generation++;
  request.lease.attempt++;
  request.lease.token = "22222222-2222-4222-8222-222222222222";
  assert.deepEqual(host.executed[0].request.lease, lease);
  host.executed[0].done.resolve("verified output");
  await flush(); t.mock.timers.tick(1_000); await flush();
  assert.equal(delivered.length, 2);
  assert.deepEqual(delivered[0], delivered[1]);
  assert.deepEqual(delivered[0].lease, lease);
  assert.equal(host.executed.length, 1);
});

test("background claims without native authority perform no work or invented completion", async (t) => {
  let claimed = false;
  const host = setup(t, { async claimPromptRuns() {
    if (claimed) return []; claimed = true;
    return [{ executionId: "legacy", taskId: "legacy", leaseExpiresAt: 200_000 }];
  } });
  await flush();
  assert.equal(host.executed.length, 0);
  assert.equal(host.completions.length, 0);
});

test("result delivery survives more than three failures without replaying execution", async (t) => {
  let attempts = 0;
  const outputs = [];
  const host = setup(t, { async completePromptRun(input) {
    outputs.push(input.output);
    if (++attempts <= 5) throw new Error("database temporarily unavailable");
    return { status: "completed" };
  } });
  await flush();
  host.executed[0].done.resolve("result to retain");
  await flush();
  for (let i = 0; i < 5; i++) { t.mock.timers.tick(1_000); await flush(); }
  assert.equal(attempts, 6);
  assert.deepEqual(outputs, Array(6).fill("result to retain"));
  assert.equal(host.executed.filter((item) => item.request.executionId === "a").length, 1);
  t.mock.timers.tick(1_000);
  await flush();
  assert.equal(host.executed[2].request.executionId, "c");
});

test("cancel/expiry aborts execution and cannot be overwritten by a late success", async (t) => {
  const host = setup(t);
  await flush();
  host.listeners.get("automation:prompt-expired")({ payload: { executionId: "a" } });
  assert.equal(host.executed[0].signal.aborted, true);
  host.executed[0].done.resolve("late success must not replace cancellation");
  await flush();
  assert.equal(host.completions.length, 0);
});

test("host shutdown releases newly claimed work that never started", async (t) => {
  const claim = deferred();
  const host = setup(t, { claimPromptRuns: () => claim.promise });
  host.stop();
  claim.resolve([{ executionId: "never-started", leaseExpiresAt: 200_000 }]);
  await flush();
  assert.deepEqual(host.released, ["never-started"]);
  assert.equal(host.executed.length, 0);
});

test("periodic reconciliation recovers a lost pending event", async (t) => {
  let polls = 0;
  const host = setup(t, { async claimPromptRuns() {
    return ++polls === 1 ? [] : [{ executionId: "missed-event", leaseExpiresAt: 200_000 }];
  } });
  await flush();
  assert.equal(host.executed.length, 0);
  t.mock.timers.tick(1_000);
  await flush();
  assert.equal(host.executed[0].request.executionId, "missed-event");
});

test("empty output and execution failures are durable failures, not fake success", async (t) => {
  const host = setup(t, { async execute(request) {
    if (request.executionId === "a") return "   ";
    throw new Error("required connector unavailable");
  } });
  await flush();
  assert.equal(host.completions.length, 3);
  assert.equal(host.completions.every((input) => !input.success), true);
  assert.match(host.completions[0].output, /empty conclusion/);
  assert.match(host.completions[1].output, /connector unavailable/);
});
