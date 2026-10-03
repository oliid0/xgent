import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flatten = (nodes) => nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);
const httpHook = () => ({ id: "hook-one", name: "通知", description: "事件通知", event: "tool_execution_end",
  enabled: false, type: "http", requests: [{ id: "request-one", method: "POST", url: "https://example.test/hook",
    headers: { Authorization: "Bearer stored" }, body: { message: "hello" } }] });

function harness(kind, initialData, save = async () => undefined, validate = async () => undefined) {
  const hooks = createReactHookHarness();
  const types = createTsModuleLoader().loadModule("src/lib/automation/types.ts");
  const saves = []; let closed = 0; let surface; let requestId = 0;
  const loader = createTsModuleLoader({ mocks: {
    react: hooks.react,
    "../../i18n": { useLocale: () => ({ t: key => key }) },
    "../../lib/automation": { ...types, validateCronExpression: validate },
    "../lib/automation": types,
    "../../presentation/NativeSurface": { NativeSurface: "NativeSurface" },
    "../../presentation/nativeTheme": { createNativePresentationTheme: () => undefined },
    "../../runtime/applePresentation": { isApplePresentationRuntime: () => true },
    "../../lib/runtimePlatform": { isNativeMobileRuntime: () => true },
    "./SettingsModalShell": { SettingsModalShell: "SettingsModalShell" },
    "./modelPicker": { ModelPicker: "ModelPicker" },
  } });
  const component = loader.loadModule(`src/pages/settings/${kind}.tsx`)[kind];
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  const registry = createPresentationActionRegistry();
  const props = { mode: "edit", initialData, modelOptions: [{ value: "provider::model", label: "model" }],
    workspaceOptions: [{ path: "/project", name: "Project" }], executionMode: "agent",
    onSave: async value => { saves.push(value); await save(value); }, onClose: () => closed++ };
  function render() {
    surface = hooks.render(() => component(props));
    validatePresentationDocument({ version: 1, surface: "automation", revision: 1, ...surface.props.document }, surface.props.handlers);
    registry.register("automation", surface.props.handlers);
    return surface.props.document;
  }
  const send = (action, value = null) => registry.dispatch({ surface: "automation", action, value, requestId: String(++requestId) });
  const action = async (id, value = null) => { const result = await send(id, value); render(); return result; };
  render();
  return { render, send, action, saves, node: id => flatten(surface.props.document.nodes).find(item => item.id === id),
    nodes: () => flatten(surface.props.document.nodes), closed: () => closed, props,
    unmount: () => { hooks.unmount(); registry.remove("automation"); } };
}

test("native hook HTTP rows preserve stored values, validate edits and match body support of the shared editor", async () => {
  let fail = true;
  const h = harness("HookModal", httpHook(), async () => { if (fail) throw new Error("backend unavailable"); });
  assert.equal(h.node("hook-requests"), undefined);
  assert.equal(h.node("hook-http:request-one:url").value, "https://example.test/hook");
  assert.equal(h.node("hook-http:request-one:headers"), undefined);
  await h.action("hook-http:request-one:expand");
  assert.match(h.node("hook-http:request-one:headers").value, /Bearer stored/);
  await h.action("hook-http:request-one:headers", "{broken}");
  await h.action("hook-save");
  assert.equal(h.saves.length, 0);
  assert.equal(h.node("hook-form-error").label, "settings.cronHttpHeadersInvalid");
  await h.action("hook-http:request-one:headers", '{"X-Count":2}');
  await h.action("hook-http:request-one:method", "GET");
  assert.equal(h.node("hook-http:request-one:body"), undefined);
  await h.action("hook-http:request-one:method", "POST");
  assert.equal(h.node("hook-http:request-one:body").value, "");
  await h.action("hook-http:request-one:body", '{"message":"新内容"}');
  await h.action("hook-save");
  assert.equal(h.closed(), 0);
  assert.equal(h.node("hook-form-error").label, "backend unavailable");
  assert.equal(h.saves[0].enabled, false);
  assert.equal(h.saves[0].event, "tool_execution_end");
  assert.deepEqual(h.saves[0].requests[0].headers, { "X-Count": "2" });
  assert.deepEqual(h.saves[0].requests[0].body, { message: "新内容" });
  fail = false; await h.action("hook-save"); assert.equal(h.closed(), 1);
  h.unmount();
});

test("native hook requests add, remove, report empty lists and cannot double-save or close a retired route", async () => {
  const pending = deferred();
  const h = harness("HookModal", httpHook(), () => pending.promise);
  await h.action("hook-http:request-one:remove");
  assert.ok(h.node("hook-http:empty"));
  await h.action("hook-save"); assert.equal(h.node("hook-form-error").label, "settings.cronHttpRequestRequired");
  await h.action("hook-http:add");
  const row = h.nodes().find(node => node.variant === "http-request-editor");
  await h.action(`${row.id}:url`, "https://two.test/hook");
  const old = h.render();
  const first = h.send("hook-save");
  // Dispatch a second request before any React document update.
  const second = h.send("hook-save");
  await second; assert.equal(h.saves.length, 1);
  h.render(); assert.equal(h.node("hook-save").disabled, true); assert.equal(h.node(`${row.id}:url`).disabled, true);
  h.unmount(); pending.resolve(); await first;
  assert.equal(h.closed(), 0); assert.equal(old.dismissAction, "close");
});

test("native command hooks accept the shared optional default timeout and preserve lifecycle and activation", async () => {
  const h = harness("HookModal", { ...httpHook(), type: "command", script: "echo one\necho two", requests: undefined, timeoutMs: undefined });
  assert.equal(h.node("hook-timeout").value, "");
  assert.equal(h.node("hook-script").language, "bash");
  await h.action("hook-timeout", "0"); await h.action("hook-save");
  assert.equal(h.node("hook-form-error").label, "settings.hooksTimeoutInvalid");
  await h.action("hook-timeout", ""); await h.action("hook-save");
  assert.equal(h.saves[0].timeoutMs, undefined); assert.equal(h.saves[0].enabled, false);
  assert.equal(h.saves[0].script, "echo one\necho two"); h.unmount();
});

test("native cron workspace choices and bounded timeout persist through the shared validator", async () => {
  const h = harness("CronTaskModal", { id: "cron-one", name: "Task", description: "", type: "bash", cron: "0 * * * *",
    enabled: true, script: "echo ok", workdir: "/removed", timeoutSeconds: 300 });
  assert.equal(h.node("workdir").value, "/removed");
  assert.equal(h.node("timeout").kind, "NumberInput");
  assert.equal(h.node("timeout").maximum, 600);
  await h.action("workdir-mode", "/project"); assert.equal(h.node("workdir"), undefined);
  await h.action("timeout", 450); await h.action("save");
  assert.equal(h.saves[0].workdir, "/project"); assert.equal(h.saves[0].timeoutSeconds, 450);
  assert.equal("enabled" in h.saves[0], false);
  h.unmount();
});

test("leaving native cron during asynchronous schedule validation never dispatches a task", async () => {
  const pending = deferred();
  const h = harness("CronTaskModal", { id: "cron-one", name: "Task", type: "bash", description: "", cron: "0 * * * *",
    enabled: true, script: "echo ok" }, undefined, () => pending.promise);
  const saving = h.send("save"); h.unmount(); pending.resolve(); await saving;
  assert.equal(h.saves.length, 0); assert.equal(h.closed(), 0);
});

test("native cron uses clearable integer execution counts and the same bounded integer timeout as Astryx", async () => {
  const h = harness("CronTaskModal", { id: "cron-one", name: "Task", type: "bash", description: "", cron: "0 * * * *", enabled: true, script: "echo ok", timeoutSeconds: 300 });
  assert.equal(h.node("remaining").kind, "NumberInput");
  assert.equal(h.node("remaining").value, null);
  assert.equal(h.node("remaining").clearable, true);
  assert.equal(h.node("remaining").integerOnly, true);
  assert.equal(h.node("remaining").maximum, undefined);
  assert.equal(h.node("timeout").integerOnly, true);
  assert.equal((await h.action("remaining", 1.5)).ok, false);
  assert.equal((await h.action("timeout", 12.5)).ok, false);
  await h.action("remaining", 10000000);
  await h.action("save");
  assert.equal(h.saves[0].remainingExecutions, 10000000);
  await h.action("remaining", null);
  await h.action("save");
  assert.equal(h.saves[1].remainingExecutions, undefined);
  h.unmount();
});
