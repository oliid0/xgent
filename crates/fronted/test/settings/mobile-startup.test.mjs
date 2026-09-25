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
