import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function harness(initialProxy = {}) {
  const states = [];
  const effects = new Map();
  const pendingEffects = [];
  const writes = [];
  let cursor = 0;
  let failWrite = false;
  const loader = createTsModuleLoader({ mocks: {
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = initial;
        return [states[index], (next) => states[index] = typeof next === "function" ? next(states[index]) : next];
      },
      useEffect(effect, dependencies) {
        const index = cursor++;
        if (effects.get(index)?.every((value, i) => Object.is(value, dependencies[i]))) return;
        effects.set(index, dependencies);
        pendingEffects.push(effect);
      },
    },
    "@xgent/runtime": {
      isTauriRuntime: () => true,
      invoke: async (command, args) => {
        assert.equal(command, "settings_save_system");
        if (failWrite) throw new Error("Proxy settings could not be saved");
        writes.push(structuredClone(args.payload));
      },
    },
    "../runtimePlatform": { isNativeMobileRuntime: () => false },
    "../backup": { markBackupDirty: async () => {} },
  } });
  const { useNativeDesktopProxy } = loader.loadModule("src/presentation/nativeDesktopProxy.ts");
  const { getDefaultSettings, updateSystem } = loader.loadModule("src/lib/settings/index.ts");
  const { persistSettings } = loader.loadModule("src/lib/settings/storage.ts");
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const defaults = getDefaultSettings();
  let settings = updateSystem(defaults, { systemProxy: { ...defaults.system.systemProxy, ...initialProxy } });
  const registry = createPresentationActionRegistry();
  let controls;
  let request = 0;
  let enabled = true;
  const render = () => {
    cursor = 0;
    controls = useNativeDesktopProxy({ settings, setSettings: (update) => settings = update(settings) }, enabled, (key) => key);
    registry.register("native-proxy", controls.handlers);
    for (const effect of pendingEffects.splice(0)) effect();
  };
  render();
  return {
    writes,
    settings: () => settings,
    node: (id) => controls.nodes.flatMap((group) => group.children).find((node) => node.id === id),
    async dispatch(action, value = null) {
      const result = await registry.dispatch({ surface: "native-proxy", action, value, requestId: String(++request) });
      render();
      return result;
    },
    persist: (previous) => persistSettings(previous, settings),
    setEnabled(value) { enabled = value; render(); render(); },
    setWriteFailure() { failWrite = true; },
  };
}

test("native proxy validates drafts and persists real HTTP/SOCKS5 settings through the shared backend boundary", async () => {
  const h = harness();
  const initial = h.settings();
  assert.equal(h.node("proxy-enabled").disabled, true);
  assert.equal((await h.dispatch("proxy-enabled", true)).ok, false);
  assert.equal((await h.dispatch("proxy-type", "https")).ok, false);
  assert.equal((await h.dispatch("proxy-host", "http://127.0.0.1")).ok, true);
  for (const port of ["", "abc", "0", "65536", "1.5"]) {
    await h.dispatch("proxy-port", port);
    assert.equal(h.node("proxy-save").disabled, true);
    assert.equal((await h.dispatch("proxy-save")).ok, false);
  }
  assert.equal(h.node("proxy-validation").status, "error");
  assert.equal(h.settings(), initial, "invalid edits never replace active shared settings");
  await h.persist(initial);
  assert.equal(h.writes.length, 0);
  await h.dispatch("proxy-host", " ::1 ");
  await h.dispatch("proxy-port", " 65535 ");
  await h.dispatch("proxy-type", "socks5");
  await h.dispatch("proxy-username", " user ");
  await h.dispatch("proxy-password", " token ");
  assert.equal(h.node("proxy-password").secure, true);
  assert.equal((await h.dispatch("proxy-enabled", true)).ok, true);
  assert.deepEqual(h.settings().system.systemProxy, {
    enabled: true, type: "socks5", host: "::1", port: 65535,
    username: "user", password: " token ", passwordConfigured: true,
  });
  assert.equal(h.node("proxy-save").disabled, true, "successful application consumes the draft");
  await h.persist(initial);
  assert.deepEqual(h.writes[0].systemProxy, h.settings().system.systemProxy);
  const active = h.settings();
  await h.dispatch("proxy-port", "bad port");
  assert.equal(h.settings(), active);
  assert.equal((await h.dispatch("proxy-enabled", false)).ok, true, "an invalid draft cannot prevent disabling the active proxy");
  assert.equal(h.settings().system.systemProxy.enabled, false);
  assert.equal(h.settings().system.systemProxy.port, 65535);
});

test("native proxy preserves saved credentials and only the explicit clear action removes them", async () => {
  for (const password of ["stored-credential", ""]) {
    const h = harness({ enabled: true, host: "127.0.0.1", port: 7890, password, passwordConfigured: true });
    const initial = h.settings();
    if (!password) assert.equal(h.node("proxy-password-status").text, "settings.systemProxyPasswordConfigured");
    await h.dispatch("proxy-host", "localhost");
    await h.dispatch("proxy-password", "");
    assert.equal((await h.dispatch("proxy-save")).ok, true);
    assert.equal(h.settings().system.systemProxy.password, password);
    assert.equal(h.settings().system.systemProxy.passwordConfigured, true);
    await h.persist(initial);
    assert.equal(h.writes[0].systemProxy.password, password);
    const saved = h.settings();
    assert.equal((await h.dispatch("proxy-password-clear")).ok, true);
    assert.equal(h.settings().system.systemProxy.password, "");
    assert.equal(h.settings().system.systemProxy.passwordConfigured, false);
    assert.equal(h.node("proxy-password-clear"), undefined);
    await h.persist(saved);
    assert.equal(h.writes[1].systemProxy.passwordConfigured, false);
  }
});

test("native proxy rejects retired actions, discards transient credentials off route, and preserves backend save failures", async () => {
  const h = harness({ host: "127.0.0.1", port: 7890 });
  const initial = h.settings();
  await h.dispatch("proxy-password", "transient-credential");
  h.setEnabled(false);
  assert.equal(h.node("proxy-password"), undefined);
  assert.equal((await h.dispatch("proxy-save")).ok, false);
  h.setEnabled(true);
  assert.equal(h.node("proxy-password").value, "");
  assert.equal(h.node("proxy-save").disabled, true);
  await h.dispatch("proxy-host", "localhost");
  assert.equal((await h.dispatch("proxy-save")).ok, true);
  h.setWriteFailure();
  await assert.rejects(h.persist(initial), /Proxy settings could not be saved/);
});
