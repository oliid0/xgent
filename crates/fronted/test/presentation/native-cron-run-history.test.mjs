import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const records = () => [
  { id: "success", taskId: "one", state: "done", success: true, startedAt: 10, durationMs: 50, exitCode: 0, output: "done" },
  { id: "failed", taskId: "one", state: "expired", success: false, startedAt: 20, durationMs: 1000, output: "timeout" },
  { id: "pending", taskId: "one", state: "pending", success: false, startedAt: 30, durationMs: 0, output: "" },
];
function harness(context, list = async () => records(), clear = async () => undefined) {
  const hooks = createReactHookHarness();
  const timers = new Map(); let nextTimer = 0;
  const previousWindow = globalThis.window;
  globalThis.window = { setInterval(callback) { timers.set(++nextTimer, callback); return nextTimer; }, clearInterval(id) { timers.delete(id); } };
  const loader = createTsModuleLoader({ mocks: { react: hooks.react,
    "../../lib/automation": { listCronRuns: list, clearCronRuns: clear } } });
  const { useCronRunHistory } = loader.loadModule("src/pages/settings/useCronRunHistory.ts");
  let task = "one", enabled = true;
  const render = () => hooks.render(() => useCronRunHistory(task, enabled));
  context.after(() => { hooks.unmount(); if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
  render();
  return { render, unmount: () => hooks.unmount(), timers,
    select(id) { task = id; return render(); }, disable() { enabled = false; return render(); } };
}

test("shared cron history preserves records on failed polling, allows retry and cleans up subscriptions", async context => {
  let fail = false, calls = 0;
  const h = harness(context, async () => { calls++; if (fail) throw new Error("history unavailable"); return records(); });
  await tick(); let state = h.render();
  assert.equal(state.successCount, 1); assert.equal(state.failCount, 1); assert.equal(state.runningCount, 1);
  assert.equal(state.clearableCount, 2); assert.equal(h.timers.size, 1);
  fail = true; await assert.rejects(state.refresh(), /history unavailable/); state = h.render();
  assert.equal(state.logs.length, 3); assert.equal(state.loadError, "history unavailable");
  fail = false; await state.refresh(); state = h.render(); assert.equal(state.loadError, "");
  h.disable(); assert.equal(h.timers.size, 0); const before = calls; await state.refresh(); assert.equal(calls, before);
});

test("cron log clear keeps running records and an older polling response cannot restore deleted records", async context => {
  const pending = deferred(); let listCount = 0, clearCount = 0;
  const h = harness(context, () => ++listCount === 1 ? Promise.resolve(records()) : pending.promise, async () => { clearCount++; });
  await tick(); const state = h.render();
  const reading = state.refresh();
  await state.refresh(); assert.equal(listCount, 2);
  await state.clear(); assert.equal(clearCount, 1);
  pending.resolve(records()); await reading;
  assert.deepEqual(h.render().logs.map(record => record.id), ["pending"]);
  assert.equal(h.render().clearableCount, 0);
});

test("cron history errors and async operations retire when selecting another task", async context => {
  const pending = deferred(); let calls = 0;
  const h = harness(context, id => ++calls === 1 ? Promise.resolve(records()) : id === "two"
    ? Promise.resolve([{ ...records()[0], id: "two-result", taskId: "two" }]) : pending.promise,
    async () => { throw new Error("cannot clear"); });
  await tick(); let state = h.render();
  await assert.rejects(state.clear(), /cannot clear/); state = h.render(); assert.equal(state.clearError, "cannot clear");
  const reading = state.refresh(); h.select("two"); await tick();
  pending.reject(new Error("retired read")); await reading;
  state = h.render(); assert.deepEqual(state.logs.map(record => record.id), ["two-result"]);
  assert.equal(state.loadError, ""); assert.equal(state.clearError, "");
  h.unmount(); assert.equal(h.timers.size, 0);
});

test("native cron details distinguish pending runs, expose full metadata and guard destructive confirmation", async () => {
  const loader = createTsModuleLoader();
  const { presentationControls } = loader.loadModule("src/presentation/controls.ts");
  const { nativeCronRunNodes } = loader.loadModule("src/presentation/nativeCronRunNodes.ts");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  let active = true, approved = false, clears = 0, expanded = null;
  const history = { logs: records(), successCount: 1, failCount: 1, runningCount: 1, clearableCount: 2,
    loading: false, isClearing: false, loadError: "", clearError: "", refresh: async () => {}, clear: async () => { clears++; } };
  const task = { id: "one", name: "Task", description: "Details", enabled: false, type: "prompt", cron: "0 * * * *",
    workdir: "/workspace", timeoutSeconds: 450, remainingExecutions: 2, selectedModel: { customProviderId: "provider", model: "model" }, reasoning: "high", prompt: "生成报告" };
  const render = () => {
    const controls = presentationControls();
    const nodes = nativeCronRunNodes({ controls, task, history, t: key => key, compact: false, tab: "details", setTab() {},
      expanded, setExpanded: id => { expanded = id; }, running: false, runError: null, run: async () => {},
      confirm: async () => approved, current: () => active });
    validatePresentationDocument({ version: 1, surface: "cron", revision: 1, mode: "sheet", nodes }, controls.handlers);
    return { nodes, handlers: controls.handlers };
  };
  const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);
  const result = render(), nodes = flatten(result.nodes);
  assert.equal(nodes.find(node => node.id === "cron-run:pending").status, "running");
  assert.match(nodes.find(node => node.id === "pending:expand").text, /cronViewLogRunning/);
  assert.equal(nodes.find(node => node.id === "cron-detail:workdir").text, "/workspace");
  assert.equal(nodes.find(node => node.id === "cron-detail:timeout").text, "450");
  assert.equal(nodes.find(node => node.id === "cron-detail:model").text, "model");
  assert.equal(nodes.find(node => node.id === "cron-detail:reasoning").text, "high");
  await result.handlers.get("clear-logs").run(null); assert.equal(clears, 0);
  approved = true; active = false; await result.handlers.get("clear-logs").run(null); assert.equal(clears, 0);
  active = true; await result.handlers.get("clear-logs").run(null); assert.equal(clears, 1);
  result.handlers.get("failed:expand").run(null);
  assert.equal(flatten(render().nodes).find(node => node.id === "failed:output").kind, "CodeBlock");
});
