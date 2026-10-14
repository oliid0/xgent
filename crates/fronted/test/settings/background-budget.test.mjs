import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { createBackgroundExecutionBudget } = loader.loadModule("src/lib/automation/backgroundBudget.ts");
const { BackgroundBudgetDelegatesPending } = loader.loadModule("src/lib/automation/backgroundWaiting.ts");
const lease = { attempt: 1, generation: 1, token: "11111111-1111-4111-8111-111111111111" };
const snapshot = () => ({ version: 1, executionId: "execution", scope: "current_host_execution", modelRequests: { used: 0, limit: 2 }, toolCalls: { used: 0, limit: 3 }, durable: true, includesCompaction: true, includesDeviceDelegates: false, exhausted: false });
function fixture() {
  let state = snapshot();
  const calls = [];
  const port = {
    async readBackgroundBudget(id, captured) { calls.push({ read: true, id, captured }); return structuredClone(state); },
    async consumeBackgroundBudget(id, captured, kind) {
      calls.push({ id, captured, kind });
      if (state[kind].used === state[kind].limit) state.exhausted = true;
      if (!state.exhausted) state[kind].used++;
      return { admitted: !state.exhausted, budget: structuredClone(state) };
    },
  };
  return { port, calls, state: () => state };
}

test("restart retains the original absolute deadline; forged extensions, removals and additions stop effects",async()=>{
  for(const changed of [undefined,Date.now()+120_000]){
    const f=fixture();f.state().deadlineAt=Date.now()+60_000;
    const budget=await createBackgroundExecutionBudget("execution",lease,f.port);
    const original=budget.snapshot().deadlineAt;
    const restarted=await createBackgroundExecutionBudget("execution",{...lease,generation:2},f.port);
    assert.equal(restarted.snapshot().deadlineAt,original);
    const real=f.port.consumeBackgroundBudget;
    f.port.consumeBackgroundBudget=async(...args)=>{const receipt=await real(...args);receipt.budget.deadlineAt=changed;return receipt;};
    await assert.rejects(budget.consume("modelRequests"),/unconfirmed/);
    await assert.rejects(budget.consume("toolCalls"),/unconfirmed/);
    assert.equal(f.calls.filter(call=>call.kind).length,1);assert.equal(budget.snapshot().deadlineAt,original);
  }
  const f=fixture(),budget=await createBackgroundExecutionBudget("execution",lease,f.port);
  f.state().deadlineAt=Date.now()+60_000;
  await assert.rejects(budget.consume("modelRequests"),/unconfirmed/);
});

test("shared native parent/delegate admissions serialize and reject overspend across both categories", async () => {
  const f = fixture();
  const budget = await createBackgroundExecutionBudget("execution", lease, f.port);
  const result = await Promise.allSettled(Array.from({ length: 8 }, () => budget.consume("modelRequests")));
  assert.equal(result.filter(item => item.status === "fulfilled").length, 2);
  assert.equal(f.calls.filter(item => item.kind).length, 3);
  assert.equal(budget.snapshot().modelRequests.used, 2);
  assert.equal(budget.snapshot().exhausted, true);
  await assert.rejects(budget.consume("toolCalls"), /exhausted/);
  const received = budget.snapshot(); received.modelRequests.used = 0;
  assert.equal(budget.snapshot().modelRequests.used, 2);
});

test("restart and a replacement captured lease retain the saved lifetime usage instead of granting new slots", async () => {
  const f = fixture(); const original = { ...lease };
  const first = await createBackgroundExecutionBudget("execution", original, f.port);
  original.token = "changed";
  await first.consume("modelRequests");
  const second = await createBackgroundExecutionBudget("execution", { ...lease, attempt: 2, generation: 2 }, f.port);
  assert.equal(second.snapshot().modelRequests.used, 1);
  await second.consume("modelRequests");
  await assert.rejects(second.consume("modelRequests"), /exhausted/);
  assert.equal(f.calls[1].captured.token, lease.token);
  assert.equal(f.calls.at(-1).captured.attempt, 2);
});

test("lost admission ACK stops queued effects, never retries/refunds, and reread keeps the actually spent slot", async () => {
  const f = fixture(); const real = f.port.consumeBackgroundBudget;
  f.port.consumeBackgroundBudget = async (...args) => { await real(...args); throw new Error("ACK lost"); };
  const budget = await createBackgroundExecutionBudget("execution", lease, f.port);
  const results = await Promise.allSettled([budget.consume("modelRequests"), budget.consume("toolCalls"), budget.consume("modelRequests")]);
  assert.equal(results.filter(item => item.status === "rejected").length, 3);
  assert.ok(results.every(item => /unconfirmed/.test(item.reason.message)));
  assert.equal(f.calls.filter(item => item.kind).length, 1);
  assert.equal(f.state().modelRequests.used, 1);
  const restarted = await createBackgroundExecutionBudget("execution", lease, f.port);
  assert.equal(restarted.snapshot().modelRequests.used, 1);
});

test("wrong execution, malformed counts/flags, changing limits and forged successful admission fail before effects", async () => {
  for (const patch of [{ executionId: "other" }, { durable: false }, { includesDeviceDelegates: true }, { includesCompaction: false }, { modelRequests: { used: 3, limit: 2 } }, { toolCalls: { used: 0, limit: 0 } }]) {
    const f = fixture(); f.port.readBackgroundBudget = async () => ({ ...snapshot(), ...patch });
    await assert.rejects(createBackgroundExecutionBudget("execution", lease, f.port), /missing or inconsistent/);
    assert.equal(f.calls.length, 0);
  }
  for (const alter of [receipt => { receipt.budget.modelRequests.limit = 10; }, receipt => { receipt.budget.modelRequests.used = 0; }, receipt => { receipt.budget.toolCalls.used = 1; }, receipt => { receipt.budget.exhausted = true; }]) {
    const f = fixture(); const real = f.port.consumeBackgroundBudget;
    f.port.consumeBackgroundBudget = async (...args) => { const receipt = await real(...args); alter(receipt); return receipt; };
    const budget = await createBackgroundExecutionBudget("execution", lease, f.port);
    await assert.rejects(budget.consume("modelRequests"), /unconfirmed/);
    await assert.rejects(budget.consume("toolCalls"), /unconfirmed/);
    assert.equal(f.calls.filter(item => item.kind).length, 1);
  }
});

test("device reservations reduce available slots and remain visible after a replacement execution lease", async () => {
  let state = { ...snapshot(), modelRequests: { used: 0, reserved: 1, limit: 2 }, toolCalls: { used: 0, reserved: 2, limit: 3 }, includesDeviceDelegates: true };
  const port = {
    async readBackgroundBudget() { return structuredClone(state); },
    async consumeBackgroundBudget(_id, _lease, kind) {
      if (state[kind].used + state[kind].reserved >= state[kind].limit) state.exhausted = true;
      if (!state.exhausted) state[kind].used++;
      return { admitted: !state.exhausted, budget: structuredClone(state) };
    },
  };
  const first = await createBackgroundExecutionBudget("execution", lease, port);
  await first.consume("modelRequests");
  const restarted = await createBackgroundExecutionBudget("execution", { ...lease, generation: 2 }, port);
  assert.equal(restarted.snapshot().modelRequests.reserved, 1);
  await assert.rejects(restarted.consume("modelRequests"), /exhausted/);
  assert.equal(state.modelRequests.used, 1);
  await assert.rejects(restarted.consume("toolCalls"), /exhausted/);
});

test("a child reservation committed during a tool is observed on the next admission; disappearing grants block effects", async () => {
  const f = fixture();
  const budget = await createBackgroundExecutionBudget("execution", lease, f.port);
  await budget.consume("toolCalls");
  f.state().modelRequests.reserved = 1; f.state().toolCalls.reserved = 1; f.state().includesDeviceDelegates = true;
  await budget.consume("modelRequests");
  assert.equal(budget.snapshot().modelRequests.reserved, 1);
  const real = f.port.consumeBackgroundBudget;
  f.port.consumeBackgroundBudget = async (...args) => {
    const receipt = await real(...args);
    delete receipt.budget.modelRequests.reserved; delete receipt.budget.toolCalls.reserved;
    receipt.budget.includesDeviceDelegates = false; return receipt;
  };
  await assert.rejects(budget.consume("toolCalls"), /unconfirmed/);
  assert.equal(budget.snapshot().toolCalls.reserved, 1);
});

test("native terminal settlement releases unused slots to parent integration while committed child usage stays charged", async () => {
  let state = { ...snapshot(), modelRequests: { used: 0, reserved: 1, limit: 2 }, toolCalls: { used: 0, reserved: 2, limit: 3 }, includesDeviceDelegates: true };
  const port = { async readBackgroundBudget() { return structuredClone(state); }, async consumeBackgroundBudget(_id, _lease, kind) {
    state[kind].used++; return { admitted: true, budget: structuredClone(state) };
  } };
  const budget = await createBackgroundExecutionBudget("execution", lease, port);
  state = { ...state, settledDelegations: 1, modelRequests: { ...state.modelRequests, reserved: 0 }, toolCalls: { ...state.toolCalls, reserved: 1 } };
  await budget.consume("modelRequests"); assert.equal(budget.snapshot().settledDelegations, 1);
  assert.equal(budget.snapshot().toolCalls.reserved, 1); assert.equal(budget.snapshot().includesDeviceDelegates, true);
  const recovered = await createBackgroundExecutionBudget("execution", lease, port);
  await recovered.consume("toolCalls"); assert.equal(recovered.snapshot().settledDelegations, 1);
});

test("decreased reservations without a new settlement or regressing settlement count stop all further effects", async () => {
  for (const initial of [0, 1]) {
    const f = fixture(); f.state().includesDeviceDelegates = true; f.state().modelRequests.reserved = 1; f.state().toolCalls.reserved = 1;
    f.state().settledDelegations = initial;
    const budget = await createBackgroundExecutionBudget("execution", lease, f.port);
    const actual = f.port.consumeBackgroundBudget;
    f.port.consumeBackgroundBudget = async (...args) => { const receipt = await actual(...args); receipt.budget.modelRequests.reserved = 0; receipt.budget.toolCalls.reserved = 0; receipt.budget.settledDelegations = 0; return receipt; };
    await assert.rejects(budget.consume("modelRequests"), /unconfirmed/); await assert.rejects(budget.consume("toolCalls"), /unconfirmed/);
    assert.equal(f.calls.filter(call => call.kind).length, 1); assert.equal(budget.snapshot().modelRequests.reserved, 1);
  }
});

test("malformed settlement markers and explicit null reservations cannot authorize a native model admission", async () => {
  for (const marker of [-1, 1.5, "1", null]) {
    const f = fixture(); f.state().settledDelegations = marker;
    await assert.rejects(createBackgroundExecutionBudget("execution", lease, f.port), /inconsistent/);
    assert.equal(f.calls.some(call => call.kind), false);
  }
  const f = fixture(); f.state().modelRequests.reserved = null;
  await assert.rejects(createBackgroundExecutionBudget("execution", lease, f.port), /inconsistent/);
});

test("confirmed reservation refusal stops SDK work without exhausting or resetting the original ledger; a new lease can spend actually released slots", async () => {
  const f = fixture(), id = "22222222-2222-4222-8222-222222222222";
  Object.assign(f.state(), { includesDeviceDelegates: true, modelRequests: { used: 0, reserved: 2, limit: 2 }, toolCalls: { used: 0, reserved: 3, limit: 3 } });
  f.port.consumeBackgroundBudget = async (_execution, _lease, kind) => ({ admitted: false, budget: structuredClone(f.state()), deferred: { id, kind } });
  const budget = await createBackgroundExecutionBudget("execution", lease, f.port);
  await assert.rejects(budget.consume("modelRequests"), error => error instanceof BackgroundBudgetDelegatesPending && error.deferral.id === id);
  assert.equal(budget.snapshot().exhausted, false); assert.equal(budget.snapshot().modelRequests.used, 0);
  const captured = budget.delegatesDeferral(); captured.id = "changed";
  assert.equal(budget.delegatesDeferral().id, id);
  await assert.rejects(budget.consume("toolCalls"), BackgroundBudgetDelegatesPending);
  Object.assign(f.state(), { settledDelegations: 1, modelRequests: { used: 0, reserved: 0, limit: 2 }, toolCalls: { used: 0, reserved: 0, limit: 3 } });
  f.port.consumeBackgroundBudget = async (_execution, _lease, kind) => { f.state()[kind].used++; return { admitted: true, budget: structuredClone(f.state()) }; };
  const resumed = await createBackgroundExecutionBudget("execution", { ...lease, generation: 2 }, f.port);
  await resumed.consume("modelRequests"); assert.equal(resumed.snapshot().modelRequests.used, 1);
  assert.equal(resumed.snapshot().modelRequests.limit, 2); assert.equal(resumed.delegatesDeferral(), undefined);
});

test("malformed or contradictory delegate deferrals cannot park an original task", async () => {
  for (const patch of [{ id: "invented" }, { kind: "toolCalls" }, { extra: true }, null]) {
    const f = fixture(); Object.assign(f.state(), { includesDeviceDelegates: true, modelRequests: { used: 0, reserved: 2, limit: 2 }, toolCalls: { used: 0, reserved: 3, limit: 3 } });
    f.port.consumeBackgroundBudget = async () => ({ admitted: false, budget: structuredClone(f.state()), deferred: patch === null ? null : { id: "22222222-2222-4222-8222-222222222222", kind: "modelRequests", ...patch } });
    const budget = await createBackgroundExecutionBudget("execution", lease, f.port);
    await assert.rejects(budget.consume("modelRequests"), /unconfirmed/); assert.equal(budget.delegatesDeferral(), undefined);
  }
});
