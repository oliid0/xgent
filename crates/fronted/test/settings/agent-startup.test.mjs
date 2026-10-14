import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

const status = (revision = 0, registered = false) => ({ revision, registered, supported: true, reason: null, backgroundLaunch: false, workerReady: true, observedAtMs: 1700000000000 });
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function fixture(options = {}) {
  const hooks = createReactHookHarness(), calls = [], listeners = [];
  let stopped = 0, active = true, reads = 0;
  const loader = createTsModuleLoader({ mocks: { react: hooks.react,
    "@tauri-apps/api/core": { invoke: async (command, args) => {
      calls.push({ command, args });
      if (command === "app_agent_startup_status") return options.read?.(++reads) ?? status();
      if (options.failure) throw new Error(options.failure);
      return options.write?.(args.enabled) ?? status(1, args.enabled);
    } },
    "@tauri-apps/api/event": { listen: async (name, callback) => { listeners.push({ name, callback }); return () => stopped++; } },
    "@xgent/runtime": { invoke: () => { throw new Error("OS startup must never route to a selected PC"); } },
  } });
  const { useAgentStartup } = loader.loadModule("src/lib/automation/useAgentStartup.ts");
  return { calls, listeners, hooks, render: () => hooks.render(() => useAgentStartup(active)), setActive(value) { active = value; }, get stopped() { return stopped; } };
}

test("startup settings read actual local OS state without auto-enabling or using the selected peer", async () => {
  const f = fixture();
  try { f.render(); await tick(); const ui = f.render(); assert.equal(ui.data.registered, false); assert.equal(ui.busy, false);
    assert.deepEqual(f.calls.map(c => c.command), ["app_agent_startup_status"]); assert.equal(f.listeners[0].name, "app:agent-startup-changed");
  } finally { f.hooks.unmount(); }
});

test("confirmed registration updates state; duplicate clicks cannot send competing OS writes", async () => {
  const pending = deferred(), f = fixture({ write: () => pending.promise });
  try { f.render(); await tick(); const ui = f.render(); const first = ui.setRegistered(true);
    assert.equal(await ui.setRegistered(false), false); assert.deepEqual(f.calls.at(-1), { command: "app_agent_startup_set", args: { enabled: true } });
    pending.resolve(status(1, true)); assert.equal(await first, true); assert.equal(f.render().data.registered, true);
    assert.equal(f.calls.filter(c => c.command === "app_agent_startup_set").length, 1);
  } finally { f.hooks.unmount(); }
});

test("a lost mutation reply observes registration without a retry or invented rollback", async () => {
  const f = fixture({ failure: "OS write reply lost", read: count => status(count === 1 ? 0 : 1, count !== 1) });
  try { f.render(); await tick(); const ui = f.render(); assert.equal(await ui.setRegistered(true), false);
    const next = f.render(); assert.equal(next.data.registered, true); assert.equal(next.error, "OS write reply lost");
    assert.equal(f.calls.filter(c => c.command === "app_agent_startup_set").length, 1);
  } finally { f.hooks.unmount(); }
});

test("newer native event cannot be overwritten by a slower status read", async () => {
  const pending = deferred(), f = fixture({ read: () => pending.promise });
  try { f.render(); await tick(); f.listeners[0].callback({ payload: status(2, true) }); pending.resolve(status(0)); await tick();
    assert.equal(f.render().data.revision, 2); assert.equal(f.render().data.registered, true);
  } finally { f.hooks.unmount(); }
});

test("inactive/mobile settings perform no startup IPC and discard old page replies", async () => {
  const pending = deferred(), f = fixture({ read: () => pending.promise });
  f.setActive(false); f.render(); await tick(); assert.equal(f.calls.length, 0);
  f.setActive(true); f.render(); await tick(); f.setActive(false); f.render();
  pending.resolve(status(3, true)); await tick(); assert.equal(f.render().data, null); assert.equal(f.render().busy, false);
  assert.equal(await f.render().setRegistered(true), false); f.hooks.unmount(); await tick(); assert.equal(f.stopped, 1);
});

test("effect replay fences first read and unlistens the superseded subscription", async () => {
  const first = deferred(), second = deferred(), f = fixture({ read: count => count === 1 ? first.promise : second.promise });
  try { f.render(); await tick(); f.hooks.replayEffects(); await tick(); second.resolve(status(1, true)); await tick();
    first.resolve(status(0)); await tick(); assert.equal(f.render().data.registered, true); assert.equal(f.stopped, 1);
  } finally { f.hooks.unmount(); }
});

test("native lifecycle wiring preserves explicit foreground launch and restricts registration ownership", () => {
  const read = name => readFileSync(new URL(`../../src-tauri/src/${name}`, import.meta.url), "utf8");
  const lib = read("lib.rs"), app = read("commands/app/app.rs"), startup = read("services/agent_startup.rs"), bridge = read("services/local_access.rs");
  assert.match(lib, /if !services::agent_startup::is_background_launch\(&argv\)/);
  assert.ok(lib.indexOf("state.request_show()") < lib.indexOf("// Tray, shortcuts"));
  assert.ok(app.indexOf("ready_state.painted.store(true") < app.indexOf("if !startup_state.should_show()"));
  assert.ok(app.indexOf("if !startup_state.should_show()") < app.indexOf("failed to show frontend-ready window"));
  assert.match(app, /window.label\(\) != "main"/);
  assert.match(bridge, /matches!\(command, "app_agent_startup_status" \| "app_agent_startup_set"\)/);
  assert.match(startup, /observed.registered != Some\(enabled\)/);
  assert.match(lib, /Optional login registration unavailable; existing chat\/worker remain usable/);
  const caps = JSON.parse(readFileSync(new URL("../../src-tauri/capabilities/default.json", import.meta.url), "utf8"));
  assert.equal(caps.permissions.some(p => typeof p === "string" && p.startsWith("autostart:")), false, "generic plugin commands must not bypass local setting ownership");
});
