import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const settle = () => new Promise((resolve) => setImmediate(resolve));
const event = (phase, accelerator) => JSON.stringify({ phase, ...(accelerator === undefined ? {} : { accelerator }) });

function harness(context, invoke = async () => []) {
  const states = [];
  const effects = new Map();
  const pending = [];
  const calls = [];
  const storage = new Map();
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  } };
  context.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
  let cursor = 0;
  let enabled = true;
  let controls;
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
    "@xgent/runtime": { invoke: async (command, args) => {
      assert.equal(command, "app_set_global_shortcuts");
      calls.push(args.bindings);
      return invoke(args.bindings);
    } },
  } });
  const { useNativeGlobalShortcuts, normalizeRecordedShortcut } = loader.loadModule("src/presentation/nativeGlobalShortcuts.ts");
  const { readGlobalShortcutBindings } = loader.loadModule("src/lib/shortcuts/globalShortcuts.ts");
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const registry = createPresentationActionRegistry();
  const render = () => {
    cursor = 0;
    controls = useNativeGlobalShortcuts(enabled, (key) => key);
    registry.register("shortcuts", controls.handlers);
    for (const effect of pending.splice(0)) effect();
    return controls;
  };
  const flatten = (nodes) => nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
  const node = (id) => flatten(controls.nodes).find((item) => item.id === id);
  const send = (action, value = null) => registry.dispatch({ surface: "shortcuts", action, value, requestId: String(++request) });
  const dispatch = async (action, value = null) => { const result = await send(action, value); render(); return result; };
  const deactivate = () => { enabled = false; render(); registry.remove("shortcuts"); };
  context.after(() => { for (const effect of effects.values()) effect.cleanup?.(); });
  return { render, node, send, dispatch, calls, storage, deactivate, normalizeRecordedShortcut, readGlobalShortcutBindings,
    set enabled(value) { enabled = value; },
  };
}

test("native shortcut recording suspends shared hotkeys and confirms the current key before the next render", async (context) => {
  const h = harness(context);
  h.render(); await settle(); h.render();
  assert.equal((await h.dispatch("shortcut:summon:record")).ok, true);
  assert.deepEqual(h.calls.at(-1), []);
  assert.equal(h.node("shortcut:summon:capture").kind, "ShortcutRecorder");
  assert.equal(h.node("shortcut:toggle:record").disabled, true);
  assert.equal((await h.send("shortcut:summon:capture", event("capture", "Super+Shift+KeyJ"))).ok, true);
  // Return carries the native draft atomically; a prior React value is irrelevant.
  assert.equal((await h.dispatch("shortcut:summon:capture", event("confirm", "Shift+Super+KeyJ"))).ok, true);
  assert.deepEqual(h.calls.at(-1), [{ action: "summon", accelerator: "Shift+Super+KeyJ" }]);
  assert.deepEqual(h.readGlobalShortcutBindings().summon, { accelerator: "Shift+Super+KeyJ", enabled: true });
  assert.equal(h.node("shortcut:summon:capture"), undefined);
  assert.equal(h.node("shortcut:summon:record").text, "Shift+Super+KeyJ");
  assert.equal(h.node("shortcut-status").status, "completed");
  assert.equal((await h.dispatch("shortcut:summon:enabled", false)).ok, true);
  assert.deepEqual(h.calls.at(-1), []);
  assert.equal((await h.dispatch("shortcut:summon:clear")).ok, true);
  assert.equal(h.readGlobalShortcutBindings().summon, undefined);
  await h.dispatch("shortcut-restore");
  assert.equal(h.readGlobalShortcutBindings().summon.accelerator, "Ctrl+KeyK");
  assert.equal(h.readGlobalShortcutBindings().summon.enabled, false);
});

test("native shortcut conflicts and malformed bridge events never persist a draft", async (context) => {
  const h = harness(context);
  h.render(); await settle(); h.render();
  await h.dispatch("shortcut:summon:record");
  const original = JSON.stringify(h.readGlobalShortcutBindings());
  for (const value of [null, true, "{", "[]", event("capture", "Super"), event("capture", "Ctrl+Ctrl+KeyJ"),
    event("capture", "KeyInjected"), event("capture", "F25"), event("capture", "Ctrl++KeyJ"),
    JSON.stringify({ phase: "cancel", accelerator: "KeyJ" }), JSON.stringify({ phase: "capture", accelerator: "KeyJ", command: "x" })]) {
    assert.equal((await h.dispatch("shortcut:summon:capture", value)).ok, false);
  }
  assert.equal((await h.dispatch("shortcut:summon:capture", event("confirm", ""))).ok, false);
  assert.equal(h.node("shortcut-status").label, "settings.shortcutNeedMainKey");
  assert.equal((await h.dispatch("shortcut:summon:capture", event("confirm", "Ctrl+Shift+KeyS"))).ok, false);
  assert.equal(h.node("shortcut-status").label, "settings.shortcutConflict");
  await h.dispatch("shortcut:summon:capture", event("systemConflict"));
  assert.equal(h.node("shortcut-status").label, "settings.shortcutSystemConflict");
  assert.equal(JSON.stringify(h.readGlobalShortcutBindings()), original);
  assert.equal(h.normalizeRecordedShortcut("Alt+Super+Ctrl+Shift+KeyJ"), "Ctrl+Shift+Alt+Super+KeyJ");
  for (const key of ["F24", "Numpad9", "NumpadEqual", "ArrowUp", "Space", "Tab", "Backspace", "Delete"])
    assert.equal(h.normalizeRecordedShortcut(`Ctrl+${key}`), `Ctrl+${key}`);
  assert.equal((await h.dispatch("shortcut:summon:capture", event("cancel"))).ok, true);
  assert.equal(JSON.stringify(h.readGlobalShortcutBindings()), original);
  assert.equal(h.node("shortcut:summon:capture"), undefined);
});

test("leaving native settings during slow unregister restores hotkeys in order and retires old capture handlers", async (context) => {
  let release;
  let pause = false;
  const h = harness(context, () => pause ? new Promise((resolve) => { release = () => resolve([]); }) : []);
  h.render(); await settle(); h.render();
  await h.dispatch("shortcut:summon:enabled", true);
  pause = true;
  const starting = h.send("shortcut:summon:record");
  await settle(); h.render();
  assert.equal(h.node("shortcut:summon:capture").disabled, true);
  h.deactivate();
  pause = false;
  release(); await starting; await settle();
  assert.deepEqual(h.calls.at(-1), [{ action: "summon", accelerator: "Ctrl+KeyK" }]);
  assert.equal((await h.send("shortcut:summon:capture", event("confirm", "Super+KeyJ"))).ok, false);
  assert.equal(h.readGlobalShortcutBindings().summon.accelerator, "Ctrl+KeyK");
  h.enabled = true; h.render(); await settle(); h.render();
  assert.equal(h.node("shortcut:summon:capture"), undefined);
  assert.equal(h.node("shortcut-busy"), undefined);
});

test("native registration and suspension failures remain failures with visible retryable status", async (context) => {
  let failure = false;
  const h = harness(context, () => failure ? Promise.reject(new Error("OS registration failed")) : []);
  h.render(); await settle(); h.render();
  failure = true;
  const failedStart = await h.dispatch("shortcut:summon:record");
  assert.equal(failedStart.ok, false);
  assert.match(h.node("shortcut-status").label, /OS registration failed/);
  assert.equal(h.node("shortcut:summon:capture"), undefined);
  assert.equal(h.node("shortcut:summon:record").disabled, false);
  failure = false;
  await h.dispatch("shortcut:summon:record");
  failure = true;
  const failedSave = await h.dispatch("shortcut:summon:capture", event("confirm", "Super+KeyJ"));
  assert.equal(failedSave.ok, false);
  assert.equal(h.node("shortcut-status").status, "error");
  assert.equal(h.readGlobalShortcutBindings().summon.accelerator, "Super+KeyJ");
  failure = false;
  assert.equal((await h.dispatch("shortcut:summon:enabled", true)).ok, true);
  assert.equal(h.node("shortcut-status").status, "completed");
});
