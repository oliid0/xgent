import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function fixture() {
  const mocks = {}, calls = [];
  for (const [module, names] of Object.entries({ Banner: ["Banner"], Button: ["Button"], Layout: ["Section", "VStack"], Switch: ["Switch"], Text: ["Heading", "Text"] }))
    mocks[`@astryxdesign/core/${module}`] = Object.fromEntries(names.map(name => [name, name]));
  const loader = createTsModuleLoader({ mocks: { ...mocks, "../../i18n": { useLocale: () => ({ t: key => key }) },
    "../../lib/automation/useAgentStartup": { useAgentStartup: () => undefined }, "react-dom": { flushSync: fn => fn() },
  } });
  const { AgentStartupContent } = loader.loadModule("src/pages/settings/AgentStartupSection.tsx");
  const { agentStartupNodes } = loader.loadModule("src/presentation/agentStartupNodes.ts");
  const { presentationControls } = loader.loadModule("src/presentation/controls.ts");
  const startup = { data: null, busy: false, error: null, async refresh() { calls.push("refresh"); }, async setRegistered(enabled) { calls.push(enabled); } };
  const flatten = x => !x ? [] : Array.isArray(x) ? x.flatMap(flatten) : [x, ...flatten(x.props?.children)];
  return { startup, calls, render: () => flatten(AgentStartupContent({ startup })), native() { const c = presentationControls(); return { nodes: agentStartupNodes(c, startup, k => k), handlers: c.handlers }; } };
}

test("shared settings show actual registration/readiness, wire OS actions and keep unknown state distinct", async () => {
  const f = fixture();
  assert.equal(f.render().some(n => n.type === "Switch"), false);
  assert.ok(f.render().some(n => n.props?.children === "agentStartup.notRead"));
  await f.render().find(n => n.type === "Button").props.onClick(); assert.deepEqual(f.calls, ["refresh"]);
  f.startup.data = { supported: true, registered: false, reason: null, workerReady: false, backgroundLaunch: true, observedAtMs: 100 };
  await f.render().find(n => n.type === "Switch").props.onChange(true); assert.equal(f.calls.at(-1), true);
  assert.ok(f.render().some(n => n.props?.children === "agentStartup.notReady"));
  f.startup.busy = true; assert.equal(f.render().find(n => n.type === "Switch").props.isDisabled, true);
  f.startup.busy = false; f.startup.error = "Registry access denied";
  assert.ok(f.render().some(n => n.type === "Banner" && n.props.title === "Registry access denied"));
  f.startup.data = { ...f.startup.data, supported: false, registered: null, reason: "release_required" };
  assert.equal(f.render().some(n => n.type === "Switch"), false);
  assert.ok(f.render().some(n => n.props?.children === "agentStartup.release_required"));
});

test("native controls invoke the same real startup port, block busy mutations and show unsupported diagnostics", async () => {
  const f = fixture(); f.startup.data = { supported: true, registered: true, reason: null, workerReady: true, backgroundLaunch: false, observedAtMs: 100 };
  let ui = f.native(); const toggle = ui.handlers.get("agent-startup-enabled"); assert.equal(toggle.accepts(false), true); await toggle.run(false); assert.deepEqual(f.calls, [false]);
  f.startup.busy = true; ui = f.native(); assert.equal(ui.handlers.get("agent-startup-enabled").enabled, false); assert.equal(ui.handlers.get("agent-startup-refresh").enabled, false);
  f.startup.busy = false; f.startup.data = { ...f.startup.data, supported: false, registered: null, reason: "plugin_unavailable" };
  ui = f.native(); assert.equal(ui.handlers.has("agent-startup-enabled"), false);
  assert.match(JSON.stringify(ui.nodes), /agentStartup.plugin_unavailable/);
});
