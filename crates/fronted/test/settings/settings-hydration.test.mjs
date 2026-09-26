import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const { startSettingsHydration } = createTsModuleLoader().loadModule("src/lib/settings/hydration.ts");
const { createSettingsReloader } = createTsModuleLoader().loadModule("src/lib/settings/hydration.ts");

test("opening settings cannot overwrite a provider key, language or theme edited during reload", async () => {
  for (const edit of [{ apiKey: "new-key" }, { locale: "zh-CN" }, { theme: "dark" }]) {
    const pending = Promise.withResolvers();
    const reload = createSettingsReloader();
    let revision = 0;
    let settings = { apiKey: "old-key", locale: "en-US", theme: "system" };
    const oldSettings = settings;
    const reading = reload({ load: () => pending.promise, revision: () => revision,
      apply: value => { settings = value; } });
    settings = { ...settings, ...edit };
    revision++;
    pending.resolve(oldSettings);
    await reading;
    assert.deepEqual(settings, { ...oldSettings, ...edit });
  }
});

test("only the newest settings reload can apply data or report a read failure", async () => {
  const reload = createSettingsReloader();
  const pending = Promise.withResolvers();
  let settings;
  const apply = value => { settings = value; };
  const oldRead = reload({ load: () => pending.promise, revision: () => 0, apply });
  await reload({ load: async () => "new settings", revision: () => 0, apply });
  pending.reject(new Error("obsolete read failed"));
  await oldRead;
  assert.equal(settings, "new settings");
  await assert.rejects(reload({ load: async () => { throw new Error("database unavailable"); },
    revision: () => 0, apply }), /database unavailable/);
});

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

test("mobile settings retry a transient native read before exposing the application", async () => {
  const settings = { customProviders: [{ id: "configured-provider" }] };
  const events = [];
  let reads = 0;
  startSettingsHydration({
    load: async () => {
      if (++reads === 1) throw new Error("native database is opening");
      return settings;
    },
    retryCount: 1,
    retryDelayMs: 0,
    onLoaded: (value) => events.push(["loaded", value]),
    onError: (error) => events.push(["error", error]),
    onSettled: () => events.push(["settled"]),
  });
  await sleep(20);
  assert.equal(reads, 2);
  assert.deepEqual(events, [["loaded", settings], ["settled"]]);
});
