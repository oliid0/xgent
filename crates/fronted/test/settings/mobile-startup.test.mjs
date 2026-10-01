import assert from "node:assert/strict";
import test from "node:test";

import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function loadStartupModule(resolveInvoke) {
  const calls = [];
  const loader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          calls.push({ command, args });
          return resolveInvoke(command, args);
        },
      },
    },
  });
  return {
    calls,
    module: loader.loadModule("src/lib/mobileStartup.ts"),
  };
}

test("mobile startup status uses the native readiness command", async () => {
  const expected = { phase: "degraded", failures: ["memory unavailable"], coreReady: true };
  const { calls, module } = loadStartupModule(() => expected);

  assert.deepEqual(await module.readMobileStartupStatus(), expected);
  assert.deepEqual(calls, [{ command: "app_mobile_startup_status", args: undefined }]);
});

test("mobile startup status rejects malformed native responses", async () => {
  const { module } = loadStartupModule(() => ({ phase: "complete", failures: [] }));

  await assert.rejects(
    () => module.readMobileStartupStatus(),
    /invalid mobile startup status/,
  );
});

test("mobile startup status requires an explicit core service result", async () => {
  const { module } = loadStartupModule(() => ({ phase: "ready", failures: [] }));

  await assert.rejects(
    () => module.readMobileStartupStatus(),
    /invalid mobile startup status/,
  );
});

test("completed degraded startup still releases independent mobile functions", () => {
  const { module } = loadStartupModule(() => undefined);
  assert.equal(module.mobileStartupFinished({ phase: "starting", failures: [], coreReady: false }), false);
  assert.equal(module.mobileStartupFinished({ phase: "ready", failures: [], coreReady: true }), true);
  assert.equal(module.mobileStartupFinished({
    phase: "degraded", failures: ["chat history database unavailable"], coreReady: false,
  }), true);
});

test("native startup rejects non-text failure details before they reach either UI", async () => {
  for (const failures of [[null], [42], [{}]]) {
    const { module } = loadStartupModule(() => ({ phase: "degraded", failures, coreReady: false }));
    await assert.rejects(module.readMobileStartupStatus(), /invalid mobile startup status/);
  }
});

function startupClock() {
  let now = 0, id = 0;
  const timers = new Map();
  return { now: () => now, set: (run, delay) => { timers.set(++id, { run, due: now + delay }); return id; },
    clear: id => timers.delete(id), advance(by) { now += by; for (const [id, timer] of [...timers]) if (timer.due <= now && timers.delete(id)) timer.run(); },
    get pending() { return timers.size; } };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test("mobile startup recovers from slow initialization and persistent IPC failure without reload", async () => {
  for (const failing of [false, true]) {
    const { module } = loadStartupModule(), clock = startupClock(), values = [];
    let recovered = false, reads = 0;
    const ready = { phase: "ready", failures: [], coreReady: true };
    const dispose = module.startMobileStartupPolling(status => values.push(status), { clock, read: async () => {
      reads++; if (recovered) return ready;
      if (failing) throw new Error("Native connection is unavailable");
      return { phase: "starting", failures: [], coreReady: false };
    } });
    await flush(); assert.equal(values.length, 0); clock.advance(30000); await flush();
    assert.equal(values.length, 1); assert.equal(values[0].phase, "degraded"); assert.equal(values[0].coreReady, false);
    clock.advance(1000); await flush(); assert.equal(values.length, 1);
    recovered = true; clock.advance(1000); await flush(); assert.equal(values.at(-1), ready);
    const total = reads; clock.advance(10000); await flush(); assert.equal(reads, total); assert.equal(clock.pending, 0); dispose();
  }
});

test("retired startup polling ignores late reads/errors and clears scheduled retries", async () => {
  const { module } = loadStartupModule();
  for (const fails of [false, true]) {
    const clock = startupClock(), values = []; let resolve, reject;
    const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
    const dispose = module.startMobileStartupPolling(value => values.push(value), { clock, read: () => pending });
    dispose(); if (fails) reject(new Error("Late failure")); else resolve({ phase: "ready", failures: [], coreReady: true });
    await flush(); assert.deepEqual(values, []); assert.equal(clock.pending, 0);
  }
  const clock = startupClock(); let reads = 0;
  const dispose = module.startMobileStartupPolling(() => {}, { clock, read: async () => { reads++; return { phase: "starting", failures: [], coreReady: false }; } });
  await flush(); assert.equal(clock.pending, 1); dispose(); clock.advance(10000); await flush();
  assert.equal(reads, 1); assert.equal(clock.pending, 0);
});
