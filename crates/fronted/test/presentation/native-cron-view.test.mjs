import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function harness(context, run) {
  const hooks = createReactHookHarness();
  const types = createTsModuleLoader().loadModule("src/lib/automation/types.ts");
  const timers = new Map(); let timerId = 0; let listState = "pending", surface;
  const previousWindow = globalThis.window;
  globalThis.window = { setInterval(callback, period) { timers.set(++timerId, { callback, period }); return timerId; },
    clearInterval: id => timers.delete(id), setTimeout: () => ++timerId, clearTimeout() {} };
  const calls = [];
  const translate = key => key;
  const tasks = ["one", "two"].map(id => ({ id, name: id, description: "Desc", cron: "0 * * * *", enabled: true,
    type: "bash", script: `echo ${id}`, workdir: `/${id}`, timeoutSeconds: 450 }));
  const loader = createTsModuleLoader({ mocks: {
    react: hooks.react,
    "../../i18n": { useLocale: () => ({ t: translate }) },
    "../../lib/automation": { ...types, useAutomation: () => ({ cron: { tasks } }), clearCronRuns: async () => {},
      listCronRuns: async taskId => [{ id: "run-one", taskId, state: listState, success: listState === "done", startedAt: 1001, durationMs: 100, output: "output" }],
      runCronNow: async taskId => { calls.push(taskId); return run ? run(taskId) : { startedAt: 1000 }; } },
    "../../components/astryx/useConfirmDialog": { useConfirmDialog: () => ({ dialog: null, confirm: async () => true }) },
    "../../lib/responsive/compactViewport": { useCompactViewport: () => true },
    "../../lib/runtimePlatform": { isNativeMobileRuntime: () => true },
    "../../presentation/NativeSurface": { NativeSurface: "NativeSurface" },
    "../../runtime/applePresentation": { isApplePresentationRuntime: () => true },
    "./SettingsModalShell": { SettingsModalShell: "SettingsModalShell" },
  } });
  const { CronTaskViewModal } = loader.loadModule("src/pages/settings/CronTaskViewModal.tsx");
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  const registry = createPresentationActionRegistry(); let requestId = 0;
  const props = { taskId: "one", onClose() {}, nativeSettingsSurfaceId: "shared-settings" };
  const render = () => {
    const result = hooks.render(() => CronTaskViewModal(props));
    surface = result.props.children[0].props;
    validatePresentationDocument({ version: 1, surface: "cron", revision: 1, ...surface.document }, surface.handlers);
    registry.register("cron", surface.handlers); return surface;
  };
  const send = (action, value = null) => registry.dispatch({ surface: "cron", action, value, requestId: String(++requestId) });
  const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);
  context.after(() => { hooks.unmount(); registry.remove("cron"); if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
  return { render, send, calls, props, timers, unmount: () => hooks.unmount(),
    node: id => flatten(surface.document.nodes).find(node => node.id === id),
    finishRun() { listState = "done"; }, async poll(period) { for (const timer of [...timers.values()]) if (timer.period === period) timer.callback(); await tick(); render(); } };
}

test("native cron view shares task metadata, mobile tabs and manual run completion tracking", async context => {
  const h = harness(context); h.render(); await tick(); h.render();
  assert.equal(h.node("cron-detail:workdir").text, "/one");
  assert.equal(h.node("cron-detail:timeout").text, "450");
  assert.equal(h.node("cron-detail:script").language, "bash");
  assert.equal(h.node("cron-view-logs"), undefined);
  await h.send("cron-view-tab", "logs"); h.render();
  assert.equal(h.node("cron-run:run-one").status, "running");
  assert.equal(h.node("clear-logs").disabled, true);
  await h.send("cron-view-tab", "details"); h.render();
  await h.send("run"); h.render(); await tick(); h.render();
  assert.deepEqual(h.calls, ["one"]); assert.equal(h.node("run").disabled, true);
  h.finishRun(); await h.poll(1000);
  assert.equal(h.node("run").disabled, false);
  await h.poll(5000); await h.send("cron-view-tab", "logs"); h.render();
  assert.equal(h.node("cron-run:run-one").status, "completed");
  h.unmount(); assert.equal(h.timers.size, 0);
});

test("native cron view ignores a late run response after changing task and blocks rapid duplicate dispatch", async context => {
  const pending = deferred(); const h = harness(context, () => pending.promise);
  h.render(); await tick(); h.render();
  const running = h.send("run"); await h.send("run"); assert.equal(h.calls.length, 1);
  h.props.taskId = "two"; h.render(); await tick(); h.render();
  pending.resolve({ startedAt: 1000 }); await running; h.render();
  assert.equal(h.node("cron-detail:workdir").text, "/two");
  assert.equal(h.node("run").disabled, false);
  assert.equal([...h.timers.values()].filter(timer => timer.period === 1000).length, 0);
});
