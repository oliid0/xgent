import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);
function harness({ mobile = true, reset = async () => ({ deleted: 1 }), scan } = {}) {
  const previousWindow = globalThis.window;
  globalThis.window = { ...previousWindow, setTimeout, clearTimeout };
  let currentHooks = createReactHookHarness(), modalHooks, modalMounted = false;
  const rootHooks = currentHooks;
  const calls = [];
  const locale = { useLocale: () => ({ t: key => key }) };
  const loader = createTsModuleLoader({ mocks: {
    react: Object.fromEntries(Object.keys(rootHooks.react).map(name => [name, (...args) => currentHooks.react[name](...args)])),
    "../../i18n": locale,
    "../../lib/runtimePlatform": { isNativeMobileRuntime: () => mobile },
    "../../presentation/NativeSurface": { NativeSurface: "NativeSurface" },
    "../../presentation/nativeTheme": { createNativePresentationTheme: () => undefined },
    "../../runtime/applePresentation": { isApplePresentationRuntime: () => true },
    "@xgent/runtime": { isBrowserRuntime: () => false, invoke: async (command, args) => { calls.push([command, args]); return reset(args); } },
    "../../lib/ssh/scan": { scanSshImportCandidates: async hosts => scan ? scan(hosts) : ({ sshDirPath: "/home/test/.ssh", keyFiles: [], candidates: [] }) },
    "./SettingsModalShell": { SettingsModalShell: "SettingsModalShell" },
    "./shared": { ConfirmActionPopover: "ConfirmActionPopover", ConfirmDeletePopover: "ConfirmDeletePopover" },
  } });
  const { normalizeSettings } = loader.loadModule("src/lib/settings");
  const host = normalizeSettings({ ssh: { hosts: [{ id: "one", name: "Remote", host: "server.test", port: 2222, username: "user", authType: "password", passwordConfigured: true }] } }).ssh.hosts[0];
  const props = { settings: normalizeSettings({ theme: "dark", ssh: { hosts: [host] } }), nativeSettingsSurfaceId: "settings:test",
    setSettings: update => { props.settings = update(props.settings); }, onBack: () => calls.push(["back"]) };
  const { SshSettingsSection } = loader.loadModule("src/pages/settings/SshSettingsSection.tsx");
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  const registry = createPresentationActionRegistry();
  let surfaces = [], requestId = 0;
  function render() {
    currentHooks = rootHooks;
    let element = rootHooks.render(() => SshSettingsSection(props));
    if (typeof element.type === "function") {
      if (!modalMounted) { modalHooks = createReactHookHarness(); modalMounted = true; }
      currentHooks = modalHooks; element = modalHooks.render(() => element.type(element.props));
    } else if (modalMounted) { modalHooks.unmount(); modalMounted = false; }
    surfaces = element.props.document ? [element.props] : element.props.children.filter(Boolean).map(child => child.props);
    registry.remove("reset"); registry.remove("delete");
    for (const surface of surfaces) {
      const name = surface.document.mode === "alert" ? surface.document.nodes.some(node => node.id === "known-host-reset-description") ? "reset" : "delete" : "ssh";
      validatePresentationDocument({ ...surface.document, version: 1, surface: name, revision: 1 }, surface.handlers);
      registry.register(name, surface.handlers);
    }
    return surfaces[0].document;
  }
  render();
  return { props, calls, host, render,
    nodes: () => flatten(surfaces[0].document.nodes),
    node: id => flatten(surfaces[0].document.nodes).find(node => node.id === id),
    alert: () => surfaces.find(surface => surface.document.mode === "alert")?.document,
    dispatch: (action, value = null, surface = "ssh") => registry.dispatch({ surface, action, value, requestId: String(++requestId) }),
    unmount: () => { rootHooks.unmount(); modalHooks?.unmount(); for (const surface of ["ssh", "reset", "delete"]) registry.remove(surface);
      if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    },
  };
}

test("native SSH retains platform shape, authentication status and explicit known-host reset confirmation", async () => {
  for (const mobile of [false, true]) {
    const h = harness({ mobile });
    try {
      assert.equal(h.render().formFactor, mobile ? "mobile" : "desktop");
      assert.equal(h.node("one:auth").label, "settings.sshAuthPassword");
      await h.dispatch("one:reset-known-host"); h.render();
      assert.equal(h.calls.length, 0);
      const confirm = h.alert().nodes.find(node => node.id === "confirm");
      const result = await h.dispatch(confirm.action, null, "reset");
      assert.equal(result.ok, true, result.error); h.render();
      assert.deepEqual(h.calls[0], ["settings_reset_ssh_known_host", { host: "server.test", port: 2222 }]);
      assert.equal(h.node("one:known-host-status").status, "completed");
    } finally { h.unmount(); }
  }
});

test("native SSH never resets a replaced endpoint with an old confirmation", async () => {
  const h = harness();
  try {
    await h.dispatch("one:reset-known-host"); h.render();
    const old = h.alert().nodes.find(node => node.id === "confirm");
    h.props.settings = { ...h.props.settings, ssh: { ...h.props.settings.ssh, hosts: [{ ...h.host, host: "other.test" }] } };
    h.render();
    assert.equal((await h.dispatch(old.action, null, "reset")).ok, false);
    assert.equal(h.calls.length, 0);
  } finally { h.unmount(); }
});

test("SSH reset reserves duplicate operations and discards completion after an endpoint changes", async () => {
  let finish;
  const h = harness({ reset: () => new Promise(resolve => { finish = resolve; }) });
  try {
    await h.dispatch("one:reset-known-host"); h.render();
    const confirm = h.alert().nodes.find(node => node.id === "confirm");
    const pending = h.dispatch(confirm.action, null, "reset");
    await Promise.resolve();
    assert.equal((await h.dispatch(confirm.action, null, "reset")).ok, false);
    assert.equal(h.calls.length, 1);
    h.props.settings = { ...h.props.settings, ssh: { ...h.props.settings.ssh, hosts: [{ ...h.host, host: "new.test" }] } };
    h.render(); finish({ deleted: 1 }); await pending; h.render();
    assert.equal(h.node("one:known-host-status"), undefined);
  } finally { h.unmount(); }
});

test("native SSH edit preserves stored credential hints and folds advanced proxy fields", async () => {
  const h = harness();
  try {
    await h.dispatch("one:edit"); const document = h.render();
    assert.equal(document.appearance, "dark"); assert.equal(document.formFactor, "mobile");
    assert.ok(h.node("back")); assert.ok(h.node("password-configured"));
    assert.equal(h.node("proxy"), undefined);
    await h.dispatch("ssh-advanced", true); h.render(); assert.ok(h.node("proxy-port"));
    await h.dispatch("auth", "keyboardInteractive"); h.render();
    assert.ok(h.node("interactive-auth-hint")); assert.equal(h.node("password"), undefined);
  } finally { h.unmount(); }
});

test("native SSH scan import retains candidate selection, duplicate constraints and persisted hosts", async () => {
  const h = harness({ scan: async () => ({ sshDirPath: "/home/test/.ssh", keyFiles: ["id_ed25519"], candidates: [
    { ...h.host, id: "new", name: "New host", host: "new.test", duplicate: false, source: "config" },
    { ...h.host, id: "duplicate", duplicate: true, source: "known_hosts" },
  ] }) });
  try {
    await h.dispatch("add"); h.render(); await h.dispatch("ssh-import-open", true); h.render();
    await new Promise(resolve => setTimeout(resolve, 0)); h.render();
    assert.ok(h.node("ssh-import-candidate:duplicate"));
    assert.equal(h.node("ssh-import-candidate:duplicate").disabled, true);
    assert.equal((await h.dispatch("ssh-import-candidate:duplicate", true)).ok, false);
    assert.equal((await h.dispatch("ssh-import-confirm")).ok, true); h.render();
    assert.equal(h.props.settings.ssh.hosts.length, 2);
    assert.equal(h.props.settings.ssh.hosts[1].host, "new.test");
  } finally { h.unmount(); }
});

test("native SSH key import uses a single file, preserves its name and rejects a prior modal's picker", async () => {
  const h = harness();
  try {
    await h.dispatch("add"); h.render(); await h.dispatch("auth", "privateKey"); h.render();
    const picker = h.node("key-import");
    const payload = JSON.stringify([{ fileName: "id_ed25519.pem", contentBase64: Buffer.from("test private key contents").toString("base64"), mimeType: "text/plain" }]);
    assert.equal((await h.dispatch(picker.action, payload)).ok, true); h.render();
    assert.equal(h.node("private-key").value, "test private key contents"); assert.equal(h.node("key-path").value, "id_ed25519.pem");
    await h.dispatch("close"); h.render(); await h.dispatch("add"); h.render(); await h.dispatch("auth", "privateKey"); h.render();
    assert.notEqual(h.node("key-import").action, picker.action);
    assert.equal((await h.dispatch(picker.action, payload)).ok, false);
  } finally { h.unmount(); }
});
