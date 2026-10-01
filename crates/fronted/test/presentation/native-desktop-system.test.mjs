import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("native desktop shell discovery and tray settings use the real shared clients and survive stale responses", async (context) => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const storage = new Map();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  } });
  context.after(() => {
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else delete globalThis.localStorage;
  });
  const states = [];
  const effects = new Map();
  const pendingEffects = [];
  let cursor = 0;
  let backend;
  const calls = [];
  const loader = createTsModuleLoader({ mocks: {
    react: {
      useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot(); },
      useState(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
        return [states[index], (next) => states[index] = typeof next === "function" ? next(states[index]) : next];
      },
      useEffect(effect, dependencies) {
        const index = cursor++;
        const previous = effects.get(index);
        if (previous?.dependencies.every((value, index) => Object.is(value, dependencies[index]))) return;
        const current = { dependencies };
        effects.set(index, current);
        pendingEffects.push(() => { previous?.cleanup?.(); current.cleanup = effect(); });
      },
    },
    "@tauri-apps/api/core": { invoke: async (command) => {
      calls.push(command);
      assert.equal(command, "terminal_shell_options");
      return backend();
    } },
  } });
  const { useNativeDesktopSystem } = loader.loadModule("src/presentation/nativeDesktopSystem.ts");
  const { getDefaultSettings } = loader.loadModule("src/lib/settings/index.ts");
  const { readTrayPrefs, subscribeTrayPrefs } = loader.loadModule("src/lib/tray/trayPrefs.ts");
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const registry = createPresentationActionRegistry();
  let settings = getDefaultSettings();
  let enabled = false;
  let controls;
  let request = 0;
  const render = () => {
    cursor = 0;
    controls = useNativeDesktopSystem({ settings, setSettings: (update) => settings = update(settings) }, enabled, (key) => key);
    registry.register("desktop-system", controls.handlers);
    for (const effect of pendingEffects.splice(0)) effect();
  };
  const node = (id) => controls.nodes.flatMap((group) => group.children).find((entry) => entry.id === id);
  const dispatch = (action, value = null) => registry.dispatch({ surface: "desktop-system", action, value, requestId: String(++request) });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  render();
  assert.deepEqual(controls.nodes, [], "mobile and other routes never publish desktop controls");
  assert.equal(calls.length, 0);
  let resolveInitial;
  backend = () => new Promise((resolve) => { resolveInitial = resolve; });
  enabled = true;
  render();
  assert.equal(node("terminal-shell").disabled, true);
  assert.equal((await dispatch("terminal-shell", "bash")).ok, false);
  resolveInitial({ options: [{ id: "bash", label: "Bash", command: "/bin/bash" }], default_shell: "bash" });
  await settle();
  render();
  assert.deepEqual(node("terminal-shell").options.map((option) => option.label), ["settings.terminalShellAuto", "Bash"]);
  assert.equal((await dispatch("terminal-shell", "powershell")).ok, false);
  assert.equal((await dispatch("terminal-shell", "bash")).ok, true);
  assert.equal(settings.system.terminalShell, "bash");
  let notifications = 0;
  context.after(subscribeTrayPrefs(() => notifications++));
  assert.equal((await dispatch("tray-show-titles", false)).ok, true);
  assert.equal((await dispatch("tray-running-badge", true)).ok, true);
  assert.deepEqual(readTrayPrefs(), { showConversationTitles: false, showRunningBadge: true });
  assert.equal(notifications, 2, "the existing desktop chat subscription receives both changes");
  assert.deepEqual(JSON.parse(storage.get("xgent.trayPrefs.v1")), readTrayPrefs());
  render();
  assert.equal(node("tray-running-badge").value, true);

  backend = async () => { throw new Error("Shell service offline"); };
  assert.equal((await dispatch("desktop-shell-refresh")).ok, false, "a failed discovery remains an action failure");
  render();
  assert.equal(node("desktop-shell-status").label, "Shell service offline");
  assert.equal(node("terminal-shell").disabled, true);
  backend = async () => ({ options: [], default_shell: "" });
  assert.equal((await dispatch("desktop-shell-refresh")).ok, true);
  render();
  assert.equal(node("desktop-shell-status").label, "settings.terminalShellUnavailable");
  assert.equal(node("terminal-shell").disabled, true);

  let resolveOld;
  backend = () => new Promise((resolve) => { resolveOld = resolve; });
  const oldRefresh = dispatch("desktop-shell-refresh");
  await settle();
  enabled = false;
  render();
  assert.deepEqual(controls.nodes, []);
  backend = async () => ({ options: [{ id: "bash", label: "Bash", command: "/bin/bash" }], default_shell: "bash" });
  enabled = true;
  render();
  await settle();
  render();
  resolveOld({ options: [], default_shell: "" });
  await oldRefresh;
  render();
  assert.equal(node("terminal-shell").options[1].label, "Bash", "retired requests cannot replace the current discovery");
  enabled = false;
  render();
});
