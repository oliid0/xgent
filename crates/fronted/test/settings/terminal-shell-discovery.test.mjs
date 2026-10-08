import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const settle = () => new Promise(resolve => setImmediate(resolve));
const walk = node => Array.isArray(node) ? node.flatMap(walk)
  : node?.props ? [node, ...walk(node.props.children)] : [];

for (const native of [false, true]) {
  test(`${native ? "native" : "Astryx"} system settings retain failed shell discovery and recover without losing preferences`, async context => {
    const hooks = createReactHookHarness();
    context.after(() => hooks.unmount());
    const requests = [];
    const loader = createTsModuleLoader({ mocks: {
      react: { ...hooks.react, useSyncExternalStore: (_subscribe, snapshot) => snapshot() },
      "@tauri-apps/api/core": { invoke: command => {
        assert.equal(command, "terminal_shell_options");
        return new Promise((resolve, reject) => requests.push({ resolve, reject }));
      } },
      "../../i18n": { SUPPORTED_LOCALES: ["system", "en-US"], useLocale: () => ({ t: key => key }) },
      "../../lib/runtimePlatform": { inferRuntimePlatform: () => "windows", isNativeMobileRuntime: () => false },
      "../../runtime/applePresentation": { isApplePresentationRuntime: () => false },
      "../../presentation/NativeMobileSystemSettings": { NativeMobileSystemSettings: "NativeMobileSystemSettings" },
    } });
    let settings = loader.loadModule("src/lib/settings/index.ts").getDefaultSettings();
    settings.system.terminalShell = "powershell";
    const props = { settings, setSettings: update => { settings = update(settings); props.settings = settings; } };
    const renderNative = loader.loadModule("src/presentation/nativeDesktopSystem.ts").useNativeDesktopSystem;
    const renderWeb = loader.loadModule("src/pages/settings/SystemSettingsForm.tsx").SystemSettingsForm;
    let tree;
    function render() {
      tree = hooks.render(() => {
        if (native) return renderNative(props, true, key => key);
        const element = renderWeb(props);
        return element.type(element.props);
      });
    }
    const nodes = () => native ? tree.nodes.flatMap(group => group.children) : walk(tree);
    const selector = () => native ? nodes().find(node => node.id === "terminal-shell")
      : nodes().find(node => node.props.label === "settings.terminalShell" && Array.isArray(node.props.options)).props;
    const disabled = () => native ? selector().disabled : selector().isDisabled;
    const status = () => native ? nodes().find(node => node.id === "desktop-shell-status")?.label
      : nodes().find(node => node.props.label === "settings.terminalShell" && typeof node.props.description === "string")?.props.description;
    function retry() {
      if (native) return tree.handlers.get("desktop-shell-refresh").run(null);
      return nodes().find(node => node.props.label === "settings.mobileRefresh").props.onClick();
    }

    render();
    assert.equal(requests.length, 1);
    assert.equal(disabled(), true);
    assert.equal(status(), "settings.loading");
    requests.shift().reject(new Error("Shell service offline"));
    await settle(); render();
    assert.equal(status(), "Shell service offline");
    assert.equal(disabled(), true);
    assert.equal(settings.system.terminalShell, "powershell");

    const empty = retry(); render();
    assert.equal(disabled(), true);
    requests.shift().resolve({ options: [], default_shell: "" });
    await empty; await settle(); render();
    assert.equal(status(), "settings.terminalShellUnavailable");
    assert.equal(disabled(), true);

    const restored = retry();
    requests.shift().resolve({ options: [
      { id: "powershell", label: "PowerShell", command: "pwsh.exe" },
      { id: "cmd", label: "Command Prompt", command: "cmd.exe" },
    ] });
    await restored; await settle(); render();
    assert.equal(disabled(), false);
    assert.equal(selector().value, "powershell");
    assert.deepEqual(selector().options.map(option => option.value), ["auto", "powershell", "cmd"]);
    if (native) tree.handlers.get("terminal-shell").run("cmd");
    else selector().onChange("cmd");
    assert.equal(settings.system.terminalShell, "cmd");

    const retired = retry();
    hooks.unmount();
    requests.shift().reject(new Error("Retired discovery"));
    await retired; await settle();
    assert.equal(settings.system.terminalShell, "cmd");
  });
}
