import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const nativeStatus = { voiceInputAvailable: true, permissionAliases: { microphone: "record-and-speech" } };

function fixture(overrides = {}) {
  const hooks = createReactHookHarness(), calls = [];
  const view = new EventTarget(), page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const originalWindow = globalThis.window, originalDocument = globalThis.document;
  globalThis.window = view; globalThis.document = page;
  const real = createTsModuleLoader().loadModule("src/lib/mobileAssistant.ts");
  const service = {
    ...real,
    mobileAssistantStatus: async () => nativeStatus,
    checkMobileAssistantPermissions: async () => ({ "record-and-speech": "prompt" }),
    requestMobileAssistantPermission: async (alias, signal) => { calls.push({ alias, signal }); return { [alias]: "granted" }; },
    openMobileSystemSettings: async () => { calls.push("system-settings"); },
    ...overrides,
  };
  const { useMobileAssistantAccess } = createTsModuleLoader({ mocks: {
    react: hooks.react, "../../lib/mobileAssistant": service,
  } }).loadModule("src/pages/settings/useMobileAssistantAccess.ts");
  const render = () => hooks.render(() => useMobileAssistantAccess("Unavailable"));
  render();
  return { hooks, calls, service, view, page, render,
    restore() { hooks.unmount(); globalThis.window = originalWindow; globalThis.document = originalDocument; },
  };
}

test("mobile permission rows use discovered aliases and reject concurrent presses before a rerender", async () => {
  const pending = deferred(), calls = [];
  const f = fixture({ requestMobileAssistantPermission: (alias, signal) => { calls.push({ alias, signal }); return pending.promise; } });
  try {
    await tick(); const current = f.render();
    assert.equal(current.permissions.microphone, "prompt");
    const request = current.request("microphone");
    await current.request("microphone");
    await current.request("camera");
    assert.equal(calls.length, 1); assert.equal(calls[0].alias, "record-and-speech");
    assert.equal(f.render().busy, "microphone");
    pending.resolve({ "record-and-speech": "granted" }); await request;
    assert.equal(f.render().permissions.microphone, "granted");
    await f.render().request("microphone");
    assert.equal(calls.length, 1, "already granted permission does not prompt again");
  } finally { f.restore(); }
});

test("denied permission opens OS settings and a focus refresh waits for the outstanding operation", async () => {
  const opened = deferred(); let checks = 0;
  const f = fixture({
    checkMobileAssistantPermissions: async () => ({ "record-and-speech": ++checks === 1 ? "denied" : "granted" }),
    openMobileSystemSettings: () => opened.promise,
  });
  try {
    await tick(); const current = f.render();
    assert.equal(current.permissions.microphone, "denied");
    const request = current.request("microphone");
    f.view.dispatchEvent(new Event("focus"));
    f.page.dispatchEvent(new Event("visibilitychange"));
    assert.equal(checks, 1);
    opened.resolve(); await request; await tick();
    assert.equal(checks, 2, "resume events coalesce into one permission recheck");
    assert.equal(f.render().permissions.microphone, "granted");
    assert.equal(f.calls.length, 0, "denied permissions are not requested again");
  } finally { f.restore(); }
});

test("permission errors allow retry and unsupported capabilities never request a guessed alias", async () => {
  let attempts = 0;
  const f = fixture({ requestMobileAssistantPermission: async () => {
    if (++attempts === 1) throw new Error("Native authorization failed");
    return { "record-and-speech": "granted" };
  } });
  try {
    await tick(); await f.render().request("camera");
    assert.equal(attempts, 0); assert.equal(f.render().error, "Unavailable");
    await f.render().request("microphone");
    assert.equal(f.render().error, "Native authorization failed"); assert.equal(f.render().busy, "");
    await f.render().request("microphone");
    assert.equal(f.render().error, ""); assert.equal(f.render().permissions.microphone, "granted");
  } finally { f.restore(); }
});

test("retired permission requests are aborted and cannot overwrite a remounted page", async () => {
  const pending = deferred(); let signal;
  const f = fixture({ requestMobileAssistantPermission: (_alias, value) => { signal = value; return pending.promise; } });
  try {
    await tick(); const request = f.render().request("microphone");
    f.hooks.replayEffects(); await tick();
    assert.equal(signal.aborted, true);
    pending.resolve({ "record-and-speech": "granted" }); await request;
    assert.equal(f.render().permissions.microphone, "prompt"); assert.equal(f.render().busy, "");
  } finally { f.restore(); }
});

test("retired status discovery cannot replace the latest page and failure remains retryable", async () => {
  const pending = deferred(); let discoveries = 0;
  const f = fixture({ mobileAssistantStatus: () => ++discoveries === 1 ? pending.promise : Promise.resolve(nativeStatus) });
  try {
    f.hooks.replayEffects(); await tick();
    pending.resolve({ ...nativeStatus, voiceInputAvailable: false }); await tick();
    assert.equal(f.render().status.voiceInputAvailable, true);
  } finally { f.restore(); }
  let fail = true;
  const retry = fixture({ mobileAssistantStatus: async () => { if (fail) throw new Error("offline"); return nativeStatus; } });
  try {
    await tick(); assert.equal(retry.render().error, "offline"); assert.equal(retry.render().busy, "");
    fail = false; await retry.render().refresh();
    assert.equal(retry.render().status.voiceInputAvailable, true); assert.equal(retry.render().error, "");
  } finally { retry.restore(); }
});
