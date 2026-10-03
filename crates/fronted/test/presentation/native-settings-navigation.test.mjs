import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

const allNodes = (nodes) => nodes.flatMap(node => [node, ...allNodes(node.children ?? [])]);

test("external native settings destinations reset provider details and retain nested sidebar selection", () => {
  const hooks = createReactHookHarness();
  const noControls = () => ({ nodes: [], handlers: new Map() });
  const locale = { SUPPORTED_LOCALES: ["system", "zh-CN", "en-US"], useLocale: () => ({ t: key => key }) };
  const sections = Object.fromEntries([
    "CronSection", "SshSettingsSection", "ComputerUseSection", "GlobalShortcutsSection", "HooksSection",
    "SoulSection", "BackupSyncSection", "NativeProviderRuntimeSettings", "NativeProviderModelSettings",
    "MobileEnvironmentBrowser", "ProjectRootsSection",
  ].map(name => [`../pages/settings/${name}`, { [name]: name }]));
  const loader = createTsModuleLoader({ mocks: {
    ...sections,
    react: hooks.react,
    "../i18n": locale,
    "../../i18n": locale,
    "../pages/settings/memory/MemoryPanel": { MemoryPanel: "MemoryPanel" },
    "./NativeSurface": {
      NativeSurface: "NativeSurface", retainNativeSurfaceSession() {}, removeNativeSurfaceSession() {},
    },
    "./nativeTheme": { createNativePresentationTheme: () => ({ fixture: true }) },
    "./nativeDesktopSystem": { useNativeDesktopSystem: noControls },
    "./nativeDesktopProxy": { useNativeDesktopProxy: noControls },
    "./nativeFontSettings": { useNativeFontSettings: noControls },
    "./nativeAccessSettings": { useNativeAccessSettings: noControls },
    "../pages/settings/useCodexOAuthAccounts": {
      useCodexOAuthAccounts: () => ({ status: { accounts: [] }, loaded: true, locked: false }),
    },
  } });
  const { NativeSettingsPage } = loader.loadModule("src/presentation/NativeSettingsPage.tsx");
  const { getDefaultSettings } = loader.loadModule("src/lib/settings/index.ts");
  const { withNativeSettingsChrome } = loader.loadModule("src/presentation/nativeSettingsChrome.ts");
  const props = { settings: getDefaultSettings(), initialSection: "providers", nativeMobile: false,
    setSettings(update) { props.settings = update(props.settings); },
    saveState: { status: "saved" }, onBack() {}, appUpdate: {},
  };
  const render = () => hooks.render(() => NativeSettingsPage(props));
  try {
    let result = render();
    result.props.handlers.get("add-provider").run(null);
    result = render();
    assert.ok(allNodes(result.props.document.nodes).some(node => node.id === "provider-name"));
    props.initialSection = "soul";
    result = render();
    assert.equal(result.type, "SoulSection");
    props.initialSection = "providers";
    result = render();
    assert.ok(!allNodes(result.props.document.nodes).some(node => node.id === "provider-name"));
    props.initialSection = "usage";
    result = render();
    assert.equal(result.type, "NativeProviderRuntimeSettings");
    props.initialSection = "hooks";
    result = render();
    assert.equal(result.type, "HooksSection");
    const wrapped = withNativeSettingsChrome(result.props.nativeSettingsSurfaceId,
      { mode: "sheet", formFactor: "desktop", title: "Hooks", appearance: "system", nodes: [], dismissAction: "back" },
      new Map());
    assert.equal(allNodes(wrapped.document.nodes).find(node => node.id === "desktop-nav:other").selected, true);
    props.nativeMobile = true;
    props.initialSection = "system";
    result = render();
    assert.ok(result.props.document.nodes.some(node => node.id === "mobile-theme"));
  } finally { hooks.unmount(); }
});
