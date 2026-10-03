import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const settle = () => new Promise((resolve) => setImmediate(resolve));
const status = (patch = {}) => ({ enabled: true, installed: true, target: "macos-aarch64", version: "test",
  permissionsRequired: true, permissions: { accessibility: false, screenCapture: false }, ...patch });
const probe = () => ({ installed: true, path: "/usr/local/bin/cua-driver", version: "1", mcpCommand: "cua-driver",
  mcpArgs: ["mcp"], error: null });

function harness(context, backend, confirm = async () => true, tools = async () => ({ tools: [{ name: "observe" }] })) {
  const states = [];
  const effects = new Map();
  const pending = [];
  const calls = [];
  const confirmations = [];
  const events = new Map();
  const focusEvents = new Map();
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = { addEventListener: (event, callback) => focusEvents.set(event, callback), removeEventListener: (event) => focusEvents.delete(event) };
  globalThis.document = { visibilityState: "visible", addEventListener: (event, callback) => focusEvents.set(event, callback), removeEventListener: (event) => focusEvents.delete(event) };
  let cursor = 0;
  let unlistened = 0;
  let surface;
  let request = 0;
  const loader = createTsModuleLoader({ mocks: {
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
        return [states[index], (next) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
      },
      useEffect(effect, dependencies) {
        const index = cursor++;
        const previous = effects.get(index);
        if (previous?.dependencies.every((value, index) => Object.is(value, dependencies[index]))) return;
        const current = { dependencies };
        effects.set(index, current);
        pending.push(() => { previous?.cleanup?.(); current.cleanup = effect(); });
      },
    },
    "@xgent/runtime": {
      isBrowserRuntime: () => false,
      invoke: async (command, args) => { calls.push({ command, args }); return command === "app_runtime_platform" ? { platform: "macos" } : backend(command, args); },
      listen: async (event, callback) => { events.set(event, callback); return () => { unlistened++; events.delete(event); }; },
    },
    "../../components/astryx/useConfirmDialog": { useConfirmDialog: () => ({ dialog: null, confirm: async (options) => { confirmations.push(options); return confirm(options); } }) },
    "../../i18n": { useLocale: () => ({ t: (key) => key }) },
    "../../lib/tools/mcpTools": { createMcpTools: tools },
    "../../presentation/NativeSurface": { NativeSurface: "NativeSurface" },
    "../../presentation/nativeTheme": { createNativePresentationTheme: () => undefined },
    "../../runtime/applePresentation": { isApplePresentationRuntime: () => true },
    "../../lib/runtimePlatform": { isNativeMobileRuntime: () => false },
  } });
  const { ComputerUseSection } = loader.loadModule("src/pages/settings/ComputerUseSection.tsx");
  const { getDefaultSettings } = loader.loadModule("src/lib/settings/index.ts");
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const registry = createPresentationActionRegistry();
  let settings = getDefaultSettings();
  const render = () => {
    cursor = 0;
    const result = ComputerUseSection({ settings, setSettings: (update) => { settings = update(settings); }, onBack() {}, nativeSettingsSurfaceId: "settings-test" });
    surface = result.props.children[0];
    registry.register("computer", surface.props.handlers);
    for (const effect of pending.splice(0)) effect();
    return surface.props.document;
  };
  const flatten = (nodes) => nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
  const node = (id) => flatten(surface.props.document.nodes).find((item) => item.id === id);
  const send = (action, value = null) => registry.dispatch({ surface: "computer", action, value, requestId: String(++request) });
  const dispatch = async (action, value = null) => { const result = await send(action, value); render(); return result; };
  const dispose = () => { registry.remove("computer"); for (const effect of effects.values()) { effect.cleanup?.(); effect.cleanup = undefined; } };
  context.after(() => {
    dispose();
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  });
  return { render, node, send, dispatch, dispose, calls, confirmations,
    get settings() { return settings; }, get unlistened() { return unlistened; },
    setDriver(value) { settings = { ...settings, mcp: { ...settings.mcp, computerUseDriverId: value } }; render(); },
    addServer(value) { settings = { ...settings, mcp: { ...settings.mcp, servers: [...settings.mcp.servers, value] } }; },
    focus() { focusEvents.get("focus")?.(); },
    emit(event, payload) { events.get(event)?.({ payload }); },
  };
}

test("native computer-use settings expose actual OS permission states and failed requests remain retryable", async (context) => {
  let current = status();
  let failure = false;
  const h = harness(context, (command, args) => {
    if (command === "cua_status") return current;
    if (command === "cua_request_permission") {
      if (failure) throw new Error("Permission prompt unavailable");
      assert.deepEqual(args, { permission: "accessibility" });
      current = status({ permissions: { accessibility: true, screenCapture: false } });
      return current;
    }
    if (command === "cua_set_enabled") { current = { ...current, enabled: args.enabled }; return current; }
    throw new Error(`Unexpected command ${command}`);
  });
  h.render();
  assert.equal(h.node("computer-use-enabled").disabled, true);
  await settle(); h.render();
  assert.equal(h.node("computer-use-permission:accessibility:status").status, "pending");
  assert.equal(h.node("computer-use-permission-hint").text, "settings.cua.permissions");
  assert.equal((await h.dispatch("computer-use-permission:accessibility:request", "other")).ok, false);
  failure = true;
  assert.equal((await h.dispatch("computer-use-permission:accessibility:request")).ok, false);
  assert.equal(h.node("computer-use-error").label, "Permission prompt unavailable");
  assert.equal(h.node("computer-use-permission:accessibility:request").disabled, false);
  failure = false;
  assert.equal((await h.dispatch("computer-use-permission:accessibility:request")).ok, true);
  assert.equal(h.node("computer-use-permission:accessibility:status").status, "completed");
  assert.equal(h.node("computer-use-permission:accessibility:request").disabled, true);
  assert.equal(h.node("computer-use-permission:screenCapture:status").status, "pending");
  current = status({ permissionsRequired: false, permissions: { accessibility: true, screenCapture: true } });
  h.focus(); await settle(); h.render();
  assert.equal(h.node("computer-use-permission:screenCapture:status").status, "completed");
  assert.equal(h.node("computer-use-permission-hint"), undefined);
  await h.dispatch("computer-use-enabled", false);
  assert.equal(h.node("computer-use-enabled").value, false);
});

test("native MCP driver checks use shared tool discovery and ignore late results from another selected driver", async (context) => {
  let failure = true;
  let release;
  let delay = false;
  const h = harness(context, () => status(), async () => true, ({ servers, loadFailureMode }) => {
    assert.equal(loadFailureMode, "throw");
    assert.equal(servers[0].id, "one");
    if (failure) throw new Error("Driver offline");
    if (delay) return new Promise((resolve) => { release = () => resolve({ tools: [{ name: "old_tool" }] }); });
    return { tools: [{ name: "observe" }] };
  });
  h.addServer({ id: "one", description: "One", enabled: true, transport: "stdio", command: "one", args: [], url: "", timeoutMs: 1000 });
  h.addServer({ id: "two", description: "Two", enabled: false, transport: "stdio", command: "two", args: [], url: "", timeoutMs: 1000 });
  h.render(); await settle(); h.render();
  await h.dispatch("computer-use-backend", "one");
  assert.equal((await h.dispatch("computer-use-check-driver")).ok, false);
  assert.equal(h.node("computer-use-error").label, "Driver offline");
  failure = false;
  await h.dispatch("computer-use-check-driver");
  assert.equal(h.node("computer-use-driver-result").text, "observe");
  delay = true;
  const old = h.send("computer-use-check-driver"); await settle(); h.render();
  h.setDriver("two");
  assert.equal(h.node("computer-use-busy"), undefined);
  assert.equal(h.node("computer-use-driver-disabled").label, "settings.cua.driverDisabled");
  assert.equal(h.node("computer-use-check-driver").disabled, true);
  release(); await old; h.render();
  assert.equal(h.node("computer-use-driver-result"), undefined);
  h.setDriver("one");
  assert.equal(h.node("computer-use-busy"), undefined);
  assert.equal(h.node("computer-use-check-driver").disabled, false);
});

test("external driver install previews the backend command, honors cancellation and saves only a successful probe", async (context) => {
  let approval = false;
  let installed = false;
  let failure = false;
  const h = harness(context, (command) => {
    if (command === "cua_status") return status();
    if (command === "cua_driver_install_command") return { display: "verified driver command", sourceUrl: "https://example.test/driver" };
    if (command === "cua_driver_install") {
      installed = true;
      if (failure) return { ...probe(), error: "Driver probe failed" };
      return probe();
    }
    throw new Error(`Unexpected command ${command}`);
  }, async () => approval);
  h.render(); await settle(); h.render();
  const before = JSON.stringify(h.settings.mcp);
  await h.dispatch("computer-use-install-driver");
  assert.equal(installed, false);
  assert.match(h.confirmations[0].detail, /verified driver command\nhttps:\/\/example.test\/driver/);
  assert.equal(JSON.stringify(h.settings.mcp), before);
  approval = true; failure = true;
  assert.equal((await h.dispatch("computer-use-install-driver")).ok, false);
  assert.equal(JSON.stringify(h.settings.mcp), before);
  assert.equal(h.node("computer-use-error").label, "Driver probe failed");
  failure = false;
  assert.equal((await h.dispatch("computer-use-install-driver")).ok, true);
  assert.equal(h.settings.mcp.computerUseDriverId, "cua-driver");
  assert.equal(h.settings.mcp.servers.find((item) => item.id === "cua-driver").command, "cua-driver");
  assert.equal(h.unlistened, 2);
});

test("leaving computer-use settings during confirmation or installation retires listeners and cannot replace shared configuration", async (context) => {
  let approve;
  let install;
  let phase = "confirm";
  const h = harness(context, (command) => {
    if (command === "cua_status") return status();
    if (command === "cua_driver_install_command") return { display: "command", sourceUrl: "https://example.test" };
    if (command === "cua_driver_install") return new Promise((resolve) => { install = () => resolve(probe()); });
    throw new Error(`Unexpected command ${command}`);
  }, () => phase === "confirm" ? new Promise((resolve) => { approve = () => resolve(true); }) : Promise.resolve(true));
  h.render(); await settle(); h.render();
  const before = JSON.stringify(h.settings.mcp);
  const pendingConfirm = h.send("computer-use-install-driver"); await settle(); h.render();
  assert.equal(h.node("computer-use-install-driver").disabled, true);
  h.setDriver("different");
  approve(); await pendingConfirm;
  assert.ok(!h.calls.some(({ command }) => command === "cua_driver_install"));
  h.setDriver(undefined); phase = "install";
  const pendingInstall = h.send("computer-use-install-driver"); await settle(); h.render();
  h.emit("cua_driver_install_progress", { stream: "stdout", line: "downloading" }); h.render();
  assert.equal(h.node("computer-use-install-progress").text, "downloading");
  h.dispose();
  assert.equal(h.unlistened, 1);
  install(); await pendingInstall;
  assert.equal(JSON.stringify(h.settings.mcp), before);
});
