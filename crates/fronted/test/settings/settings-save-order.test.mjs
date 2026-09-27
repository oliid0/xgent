import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function harness(invoke, mobile = true) {
  const loader = createTsModuleLoader({ mocks: {
    "@xgent/runtime": { isTauriRuntime: () => true, invoke },
    "../runtimePlatform": { isNativeMobileRuntime: () => mobile },
    "../backup": { markBackupDirty: async () => {} },
  } });
  return {
    ...loader.loadModule("src/lib/settings/storage.ts"),
    defaults: loader.loadModule("src/lib/settings/index.ts").getDefaultSettings(),
  };
}

test("a failed settings batch waits for its remaining writes before the next save", async () => {
  const firstWrite = Promise.withResolvers();
  const calls = [];
  let storedWorkdir = "";
  const h = harness(async (command, args) => {
    calls.push(command);
    if (command === "settings_save_providers") throw new Error("provider write failed");
    if (command === "settings_save_system") {
      if (args.payload.workdir === "/first") await firstWrite.promise;
      storedWorkdir = args.payload.workdir;
    }
  });
  const first = { ...h.defaults, customProviders: [], system: { ...h.defaults.system, workdir: "/first" } };
  const second = { ...first, system: { ...first.system, workdir: "/second" } };
  let firstError;
  const queue = h.persistSettings(h.defaults, first)
    .catch((error) => { firstError = error; })
    .then(() => h.persistSettings(first, second));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.filter((name) => name === "settings_save_system").length, 1);
  assert.equal(firstError, undefined, "the queue stays occupied until every write settles");
  firstWrite.resolve();
  await queue;
  assert.match(firstError.message, /provider write failed/);
  assert.equal(storedWorkdir, "/second");
});

test("local storage failure also drains native writes before rejecting the batch", async () => {
  const previousStorage = globalThis.localStorage;
  const nativeWrite = Promise.withResolvers();
  globalThis.localStorage = { setItem() { throw new Error("local storage full"); } };
  try {
    const h = harness(() => nativeWrite.promise);
    let settled = false;
    const saving = h.persistSettings(h.defaults, {
      ...h.defaults,
      theme: h.defaults.theme === "dark" ? "light" : "dark",
      system: { ...h.defaults.system, workdir: "/next" },
    }).catch((error) => { settled = true; return error; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    nativeWrite.resolve();
    assert.match((await saving).message, /local storage full/);
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
});

test("desktop STT save returns authoritative readiness and clears one-shot secret flags", async () => {
  const calls = [];
  const h = harness(async (command, args) => {
    calls.push({ command, args });
    return {
      ...args.payload,
      providers: { ...args.payload.providers, aliyun_dashscope: {
        ...args.payload.providers.aliyun_dashscope,
        apiKey: "",
        configured: true,
        clearSecrets: undefined,
      } },
    };
  }, false);
  const next = { ...h.defaults, stt: {
    ...h.defaults.stt, enabled: true,
    providers: { ...h.defaults.stt.providers, aliyun_dashscope: {
      ...h.defaults.stt.providers.aliyun_dashscope, apiKey: "test-key", configured: false,
    } },
  } };
  const result = await h.persistSettings(h.defaults, next);
  assert.equal(calls[0].command, "settings_save_stt");
  assert.equal(calls[0].args.payload.allowIncomplete, true);
  assert.equal(result.stt.providers.aliyun_dashscope.configured, true);
  assert.equal(result.stt.providers.aliyun_dashscope.apiKey, "");
  assert.equal(result.stt.providers.aliyun_dashscope.clearSecrets, undefined);
});
