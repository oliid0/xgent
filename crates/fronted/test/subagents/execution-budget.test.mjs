import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createSubagentHarness } from "./harness.mjs";

const loader = createTsModuleLoader();
const { ExecutionBudget } = loader.loadModule("src/lib/subagents/executionBudget.ts");
const { createSubagentScheduler } = loader.loadModule("src/lib/subagents/scheduler.ts");
const { schedulingDeadlineSignal } = loader.loadModule("src/lib/subagents/schedulingBudget.ts");

test("absolute deadlines refuse both admissions without spending slots, and default ledgers retain their shape", () => {
  const budget=new ExecutionBudget({maxModelRequests:12,maxToolCalls:24,deadlineAt:Date.now()-1});
  assert.throws(()=>budget.consume("modelRequests"),/deadline/);
  assert.throws(()=>budget.consume("toolCalls"),/deadline/);
  assert.equal(budget.snapshot().modelRequests.used,0);assert.equal(budget.snapshot().toolCalls.used,0);
  assert.equal(budget.snapshot().exhausted,true);
  assert.ok(!Object.hasOwn(new ExecutionBudget({maxModelRequests:1,maxToolCalls:1}).snapshot(),"deadlineAt"));
  for(const deadlineAt of [null,0,-1,"1",NaN,Infinity,8_640_000_000_000_001])assert.throws(()=>new ExecutionBudget({maxModelRequests:1,maxToolCalls:1,deadlineAt}));
});

test("deadline signals cancel expired work, forward original stops and dispose active timers", async () => {
  const parent=new AbortController();assert.equal(schedulingDeadlineSignal(parent.signal).signal,parent.signal);
  const expired=schedulingDeadlineSignal(parent.signal,Date.now()-1);
  assert.equal(expired.signal.aborted,true);assert.match(expired.signal.reason.message,/deadline/);expired.dispose();
  const future=schedulingDeadlineSignal(parent.signal,Date.now()+60_000),reason=new Error("Stopped by user");
  parent.abort(reason);assert.equal(future.signal.reason,reason);future.dispose();future.dispose();
  const timed=schedulingDeadlineSignal(new AbortController().signal,Date.now()+10);
  await new Promise(resolve=>timed.signal.addEventListener("abort",resolve,{once:true}));
  assert.match(timed.signal.reason.message,/deadline/);timed.dispose();
});

test("shared parallel admissions have one immutable limit and cannot overspend the same request slot", async () => {
  const original = { maxModelRequests: 2, maxToolCalls: 3 };
  const budget = new ExecutionBudget(original);
  original.maxModelRequests = 1000;
  const results = await Promise.allSettled(Array.from({ length: 8 }, async () => budget.consume("modelRequests")));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 2);
  assert.equal(budget.snapshot().modelRequests.used, 2);
  assert.equal(budget.snapshot().modelRequests.limit, 2);
  assert.equal(budget.snapshot().exhausted, true);
  assert.throws(() => budget.consume("toolCalls"), /modelRequests 2\/2/);
});

test("tool exhaustion prevents later model calls, retains actual counts and reports honest host-only scope", () => {
  const scheduler = createSubagentScheduler({ executionBudget: { maxModelRequests: 3, maxToolCalls: 1 } });
  scheduler.executionBudget.consume("modelRequests");
  scheduler.executionBudget.consume("toolCalls");
  assert.throws(() => scheduler.executionBudget.consume("toolCalls"), /toolCalls 1\/1/);
  assert.throws(() => scheduler.executionBudget.consume("modelRequests"), /toolCalls 1\/1/);
  assert.equal(scheduler.executionBudget.snapshot().modelRequests.used, 1);
  assert.equal(scheduler.executionBudget.snapshot().toolCalls.used, 1);
  assert.equal(scheduler.executionBudget.snapshot().durable, false);
  assert.equal(scheduler.executionBudget.snapshot().includesCompaction, false);
  assert.equal(scheduler.executionBudget.snapshot().includesDeviceDelegates, false);
  assert.equal(createSubagentScheduler().executionBudget, undefined);
});

test("malformed or fractional execution budgets are rejected instead of granting unbounded authority", () => {
  for (const value of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, "2"])
    assert.throws(() => new ExecutionBudget({ maxModelRequests: value, maxToolCalls: 1 }));
});

test("real AgentRoster exposes the same execution budget without inventing persistent shared-device accounting", async () => {
  const h = await createSubagentHarness({ schedulerLimits: { executionBudget: { maxModelRequests: 4, maxToolCalls: 8 } } });
  h.scheduler.executionBudget.consume("modelRequests");
  const roster = await h.bundle.executeToolCall({ type: "toolCall", id: "roster", name: "AgentRoster", arguments: {} });
  assert.equal(roster.isError, false);
  assert.equal(roster.details.executionBudget.modelRequests.used, 1);
  assert.equal(roster.details.executionBudget.durable, false);
});
