import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function fixture(service) {
  const hooks = createReactHookHarness();
  const loader = createTsModuleLoader({ mocks: {
    react: hooks.react,
    "../../lib/stt/desktopSttSettingsService": { desktopSttSettingsService: service },
  } });
  const { useSttConnectionTest } = loader.loadModule("src/pages/settings/useSttConnectionTest.ts");
  const { getDefaultSettings, normalizeSettings } = loader.loadModule("src/lib/settings/index.ts");
  let settings = getDefaultSettings();
  const render = () => hooks.render(() => useSttConnectionTest(settings.stt, key => key));
  return { render, hooks, edit(patch) {
    settings = normalizeSettings({ ...settings, stt: { ...settings.stt, ...patch } });
    return render();
  } };
}

test("voice tests save the current provider, prevent duplicate probes and retain real failure feedback for retry", async () => {
  const pending = deferred(); const calls = []; let fail = false;
  const f = fixture({
    update: async configuration => { calls.push(["update", configuration.provider]); await pending.promise; },
    test: async provider => { calls.push(["test", provider]); if (fail) throw new Error("ASR unreachable"); return { result: "connected_no_speech" }; },
  });
  const view = f.render();
  const running = view.testConnection(); await view.testConnection();
  assert.equal(calls.length, 1); assert.equal(f.render().testing, true);
  pending.resolve(); await running;
  assert.equal(f.render().testResult.message, "settings.stt.test.connected_no_speech");
  assert.equal(f.render().testing, false);
  fail = true; await f.render().testConnection();
  assert.equal(f.render().testResult.ok, false);
  assert.equal(f.render().testResult.message, "ASR unreachable");
  fail = false; await f.render().testConnection(); assert.equal(f.render().testResult.ok, true);
  f.hooks.unmount();
});

test("provider and credential edits retire connection responses, including before the backend probe starts", async () => {
  const update = deferred(); let probes = 0;
  const f = fixture({ update: () => update.promise, test: async () => { probes++; return { result: "connected" }; } });
  const running = f.render().testConnection();
  f.edit({ provider: "tencent_cloud" }); update.resolve(); await running;
  assert.equal(probes, 0); assert.equal(f.render().testResult, null);
  const response = deferred();
  const g = fixture({ update: async () => {}, test: () => response.promise });
  const probing = g.render().testConnection(); await Promise.resolve();
  g.render().clearFeedback();
  response.resolve({ result: "authentication_failed", message: "stale credentials" }); await probing;
  assert.equal(g.render().testResult, null); assert.equal(g.render().testing, false);
  f.hooks.unmount(); g.hooks.unmount();
});

test("a closed or replayed settings lifecycle cannot publish an old response or unlock a newer test", async () => {
  const old = deferred(), fresh = deferred(); let requests = 0;
  const f = fixture({ update: async () => {}, test: () => ++requests === 1 ? old.promise : fresh.promise });
  const first = f.render().testConnection(); await Promise.resolve();
  f.hooks.replayEffects(); const second = f.render().testConnection(); await Promise.resolve();
  old.reject(new Error("old route failure")); await first;
  assert.equal(f.render().testing, true); assert.equal(f.render().testResult, null);
  fresh.resolve({ result: "connected", message: "current connection" }); await second;
  assert.equal(f.render().testResult.message, "current connection");
  const after = deferred();
  const closed = fixture({ update: () => after.promise, test: async () => { throw new Error("must not probe after close"); } });
  const last = closed.render().testConnection(); closed.hooks.unmount(); after.resolve(); await last;
  f.hooks.unmount();
});
