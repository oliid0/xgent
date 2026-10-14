import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
test.beforeEach(t => {
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  });
});
function setup({ browser = false, mobile = true, delayed = false } = {}) {
  const hooks = createReactHookHarness(), calls = [], hosts = [], executions = [], captures = [];
  const branchHosts = [], branchExecutions = [], branchRetries = [], branchRevokes=[]; let branchStops = 0;
  let release, stops = 0;
  const mocks = {
    react: hooks.react,
    "@xgent/runtime": { isTauriRuntime: () => !browser, isBrowserRuntime: () => browser },
    "@tauri-apps/api/core": { async invoke(command, args) {
      calls.push({ command, args });
      if (command === "automation_claim_prompt_runs") return [];
      if (command === "automation_complete_prompt_run") return { status: "completed" };
      if (command === "automation_result_device_branches") return { branches: [] };
      assert.fail(`Unexpected invocation ${command}`);
    } },
    "@tauri-apps/api/event": { listen: async () => () => {} },
    "@tauri-apps/api/path": { homeDir: async () => "/phone" },
    "@tauri-apps/api/webview": { getCurrentWebview: () => ({}) },
    "@tauri-apps/plugin-opener": { openUrl: async () => {}, revealItemInDir: async () => {} },
    "../../lib/runtimePlatform": { isNativeMobileRuntime: () => mobile },
    "../../lib/automation/promptRunHost": { startPromptRunHost(ports) {
      hosts.push(ports); return () => { stops++; };
    } },
    "../../lib/automation/promptExecution": { async executeCronPromptRun(settings, request, signal) {
      executions.push({ settings, request, signal }); return "actual local result";
    } },
    "../../lib/automation/mobileBranchWorker": { startMobileBranchWorker(ports) {
      branchHosts.push(ports); return { refresh: async () => {}, retryEntry:entry=>branchRetries.push(entry), stopEntry:entry=>branchRevokes.push(entry), stop: () => { branchStops++; } };
    } },
    "../../lib/automation/mobileBranchExecution": { async executeMobileDeviceBranch(getSettings, entry, branch, signal) {
      branchExecutions.push({ settings: getSettings(), entry, branch, signal });
    } },
  };
  if (delayed) mocks["../../lib/tools/toolCommandPort"] = { captureToolCommandPort(config) {
    captures.push(config); return new Promise((resolve) => { release = resolve; });
  } };
  const loader = createTsModuleLoader({ mocks });
  const { CronPromptRunner } = loader.loadModule("src/components/cron/CronPromptRunner.tsx");
  const host = loader.loadModule("src/runtime/lanPcCommandHost.ts");
  return { hooks, calls, hosts, executions, captures,
    branchHosts, branchExecutions, branchRetries, branchRevokes, branchStops: () => branchStops,
    render: (settings = { source: "phone" }) => hooks.render(() => CronPromptRunner({ settings })),
    selectPeer: () => host.configureLanPcCommandHost({ enabled: true, baseUrl: "http://pc:28367",
      localWorkdir: "/phone/workspace", remoteWorkdir: "/pc/workspace" }),
    release: (port) => release(port), stops: () => stops };
}

test("paired phone claims and completes its own native queue without claiming the PC queue", async () => {
  const f = setup();
  f.selectPeer(); f.render(); await flush();
  try {
    assert.equal(f.hosts.length, 1);
    const ports = f.hosts[0];
    await ports.claimPromptRuns(1);
    f.selectPeer();
    const input = { executionId: "phone-run", output: "actual result", success: true };
    await ports.completePromptRun(input);
    assert.deepEqual(f.calls, [
      { command: "automation_claim_prompt_runs", args: { limit: 1 } },
      { command: "automation_complete_prompt_run", args: { input } },
    ]);
  } finally { f.hooks.unmount(); }
  assert.equal(f.stops(), 1);
});

test("mobile prompt execution reads current local settings without starting another queue host", async () => {
  const f = setup();
  f.render({ source: "first" }); await flush();
  try {
    const settings = { source: "current" }, request = { executionId: "phone-run" };
    const signal = new AbortController().signal;
    f.render(settings);
    assert.equal(await f.hosts[0].execute(request, signal), "actual local result");
    assert.deepEqual(f.executions, [{ settings, request, signal }]);
    assert.equal(f.hosts.length, 1);
  } finally { f.hooks.unmount(); }
});

test("late native adapter resolution after unmount cannot start a retired mobile executor", async () => {
  const f = setup({ delayed: true });
  f.render(); f.hooks.unmount();
  assert.deepEqual(f.captures, [{ enabled: false, baseUrl: "" }]);
  f.release({ invoke: async () => assert.fail("retired execution"), listen: async () => () => {} });
  await flush();
  assert.equal(f.hosts.length, 0);
  assert.equal(f.calls.length, 0);
});

test("React effect replay starts one live mobile executor and disposes it once", async () => {
  const f = setup();
  f.render(); f.hooks.replayEffects(); await flush();
  assert.equal(f.hosts.length, 1);
  f.hooks.unmount();
  assert.equal(f.stops(), 1);
});

test("browser and desktop presentation do not acquire a mobile native execution port", async () => {
  for (const options of [{ browser: true }, { mobile: false }]) {
    const f = setup({ ...options, delayed: true });
    f.render(); await flush(); f.hooks.unmount();
    assert.equal(f.captures.length, 0);
    assert.equal(f.hosts.length, 0);
  }
});

test("mobile task branch owner uses current local settings and original native entry after selected PC changes", async () => {
  const f=setup();f.render({source:"first"});await flush();
  try {
    assert.equal(f.branchHosts.length,1);f.selectPeer();
    await f.branchHosts[0].getReceivedDeviceBranches("original-entry");
    assert.deepEqual(f.calls,[{command:"automation_result_device_branches",args:{entry_id:"original-entry"}}]);
    const settings={source:"current"},signal=new AbortController().signal;f.render(settings);
    await f.branchHosts[0].execute("original-entry","calendar",signal);
    assert.deepEqual(f.branchExecutions,[{settings,entry:"original-entry",branch:"calendar",signal}]);
    assert.equal(f.branchHosts.length,1);
  } finally { f.hooks.unmount(); }
  assert.equal(f.branchStops(),1);assert.equal(f.stops(),1);
});

test("failed DOM listener registration releases both mobile owners once instead of leaking a poller", async () => {
  globalThis.window.addEventListener=()=>{throw new Error("Listener registration failed");};
  const f=setup();f.render();await flush();
  assert.equal(f.stops(),1);assert.equal(f.branchStops(),1);
  f.hooks.unmount();assert.equal(f.stops(),1);assert.equal(f.branchStops(),1);
});

test("native-accepted local recovery reaches the existing phone owner and its listener retires with the app",async()=>{
  const listeners=new Map();globalThis.window.addEventListener=(name,handler)=>listeners.set(name,handler);
  globalThis.window.removeEventListener=(name,handler)=>{assert.equal(listeners.get(name),handler);listeners.delete(name);};
  const f=setup();f.render();await flush();
  const handler=listeners.get("xgent:mobile-branch-recovery");assert.ok(handler);
  handler({detail:"original-entry"});handler({detail:{entry:"other"}});
  const revoke=listeners.get("xgent:mobile-branch-revocation");assert.ok(revoke);
  revoke({detail:"original-entry"});revoke({detail:{entry:"other"}});
  assert.deepEqual(f.branchRevokes,["original-entry"]);
  assert.deepEqual(f.branchRetries,["original-entry"]);f.hooks.unmount();assert.equal(listeners.size,0);
});
