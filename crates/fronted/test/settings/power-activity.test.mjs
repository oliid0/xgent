import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function setup({ mobile = false, rejected = false } = {}) {
  const calls = [];
  const loader = createTsModuleLoader({ mocks: {
    "@xgent/runtime": { invoke() { throw new Error("Selected peer must not receive a local power scope"); }, async invokeNative(command, args) { calls.push({ command, args }); if (rejected && command === "system_begin_power_activity") throw new Error("OS refused lock"); } },
    "../runtimePlatform": { isNativeMobileRuntime: () => mobile }, "../shared/id": { createUuid: () => "scope-uuid" },
  } });
  return { calls, withPowerActivity: loader.loadModule("src/lib/system/powerActivity.ts").withPowerActivity };
}
test("model work holds only the current native installation and releases its scope after success", async () => {
  const f = setup();
  assert.equal(await f.withPowerActivity("model", "actual work", async () => { assert.equal(f.calls.length, 1); return "actual result"; }), "actual result");
  assert.deepEqual(f.calls.map(c => c.command), ["system_begin_power_activity", "system_end_power_activity"]);
  assert.equal(f.calls[0].args.activityId, f.calls[1].args.activityId); assert.equal(f.calls[0].args.ttlMs, 900000);
});
test("task errors release local scope and OS lock refusal cannot fake or prevent a task result", async () => {
  const f = setup();
  await assert.rejects(f.withPowerActivity("model", "work", async () => { throw new Error("actual task failure"); }), /actual task failure/);
  assert.equal(f.calls.at(-1).command, "system_end_power_activity");
  const denied = setup({ rejected: true });
  assert.equal(await denied.withPowerActivity("model", "work", async () => "actual task result"), "actual task result");
  assert.equal(denied.calls.at(-1).command, "system_end_power_activity");
});
test("native mobile performs original work without unregistered desktop power IPC", async () => {
  const f = setup({ mobile: true }); assert.equal(await f.withPowerActivity("model", "work", async () => 7), 7); assert.equal(f.calls.length, 0);
});
