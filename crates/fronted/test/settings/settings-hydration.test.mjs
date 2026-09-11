import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const { startSettingsHydration } = createTsModuleLoader().loadModule("src/lib/settings/hydration.ts");

function createHarness() {
  const pending = Promise.withResolvers();
  const events = [];
  const cancel = startSettingsHydration({
    load: () => pending.promise,
    onLoaded: (value) => events.push(["loaded", value]),
    onError: (error) => events.push(["error", error]),
    onSlow: () => events.push(["slow"]),
    onSettled: () => events.push(["settled"]),
    slowAfterMs: 5,
  });
  return { pending, events, cancel };
}

test("slow mobile settings keep the original request and apply the late provider/workspace settings", async () => {
  const { pending, events } = createHarness();
  await sleep(20);
  assert.deepEqual(events, [["slow"]]);
  const settings = { customProviders: [{ id: "configured-provider" }], workdir: "/sandbox/workspace" };
  pending.resolve(settings);
  await sleep(0);
  assert.deepEqual(events, [["slow"], ["loaded", settings], ["settled"]]);
});

test("fast settings clear the slow-load notice timer", async () => {
  const { pending, events } = createHarness();
  pending.resolve({ theme: "system" });
  await sleep(20);
  assert.deepEqual(events, [["loaded", { theme: "system" }], ["settled"]]);
});

test("a real native read failure is reported once, including after the slow notice", async () => {
  const { pending, events } = createHarness();
  await sleep(20);
  const error = new Error("sandbox database unavailable");
  pending.reject(error);
  await sleep(0);
  assert.deepEqual(events, [["slow"], ["error", error], ["settled"]]);
});

test("unmounted settings consumers ignore late success and late failure", async () => {
  for (const outcome of ["resolve", "reject"]) {
    const { pending, events, cancel } = createHarness();
    cancel();
    pending[outcome](outcome === "resolve" ? {} : new Error("late failure"));
    await sleep(20);
    assert.deepEqual(events, []);
  }
});
