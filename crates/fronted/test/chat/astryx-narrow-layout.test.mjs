import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { annotationBrowser } from "../helpers/document-annotation-browser.mjs";
import { imageBrowserCompletion } from "../helpers/image-browser-completion.mjs";

const vendor = {};
vendor["@astryxdesign/core/theme"] = await import("@astryxdesign/core/theme");
vendor["@astryxdesign/theme-neutral"] = await import("@astryxdesign/theme-neutral");
for (const module of ["AlertDialog", "Badge", "Banner", "BottomSheet", "Button", "ButtonGroup", "CheckboxInput", "Code", "CodeBlock", "Collapsible", "ComplexSelector", "Dialog", "Divider", "DropdownMenu", "EmptyState", "FormLayout", "Grid", "Icon", "IconButton", "InputGroup", "Layout", "List", "MobileNav", "MoreMenu", "NumberInput", "Popover", "Section", "Selector", "SideNav", "Spinner", "Stack", "StatusDot", "Switch", "TabList", "Text", "TextArea", "TextInput", "TimeInput", "ToggleButton", "Token", "Toolbar", "TreeList"]) {
  vendor[`@astryxdesign/core/${module}`] = await import(`@astryxdesign/core/${module}`);
}
const icon = () => React.createElement("svg", { width: 16, height: 16, "aria-hidden": true });
// Resolve the same Iconify glyphs used by the production icon module without
// invoking its build-time import plugin. Built-in Astryx icons stay untouched.
const iconSources = {};
const iconCollections = new Map();
const iconModule = readFileSync(new URL("../../src/components/icons.tsx", import.meta.url), "utf8");
for (const [, specifier, collection, name] of iconModule.matchAll(/from "(~icons\/([^/]+)\/([^\"]+))"/g)) {
  if (!iconCollections.has(collection)) iconCollections.set(collection, JSON.parse(readFileSync(new URL(`../../node_modules/@iconify-json/${collection}/icons.json`, import.meta.url), "utf8")));
  const source = iconCollections.get(collection);
  let resolved = name;
  const seen = new Set();
  while (source.aliases?.[resolved]) {
    assert.ok(!seen.has(resolved), `Cyclic glyph alias ${specifier}`);
    seen.add(resolved);
    const alias = source.aliases[resolved];
    assert.ok(!alias.rotate && !alias.hFlip && !alias.vFlip, `Transformed glyph alias needs an explicit SVG fixture: ${specifier}`);
    resolved = alias.parent;
  }
  const glyph = source.icons[resolved];
  assert.ok(glyph, `Missing production glyph ${specifier}`);
  iconSources[specifier] = { __esModule: true, default: props => React.createElement("svg", { ...props, viewBox: `0 0 ${glyph.width ?? source.width ?? 24} ${glyph.height ?? source.height ?? 24}`, dangerouslySetInnerHTML: { __html: glyph.body } }) };
}
const icons = createTsModuleLoader({ mocks: { ...vendor, ...iconSources, react: React, "react/jsx-runtime": jsx } }).loadModule("src/components/icons.tsx");
const { translations } = createTsModuleLoader().loadModule("src/i18n/config.ts");
const Locale = React.createContext("en-US");
function useLocale() {
  const locale = React.useContext(Locale);
  return { locale, t: key => translations[locale][key] ?? key };
}
const mocks = {
  ...vendor, react: React, "react/jsx-runtime": jsx,
  "../../i18n": { useLocale },
  "../../lib/soul": {}, "@tanstack/react-virtual": {},
  "../AppUpdateButton": {}, "../MacOsTitleBarSpacer": {}, "./ExecutionModeMenu": {},
  "../workspace-tools/SidebarActionMenu": {},
  "../icons": icons,
  "../../components/astryx/ConfirmActionPopover": {},
};
const loader = createTsModuleLoader({ mocks });
const { xgentCompactTheme } = loader.loadModule("src/theme/xgentTheme.ts");
const { Theme, generateThemeCSS } = vendor["@astryxdesign/core/theme"];
const { ChatSidebarSurface, ProjectRow, HistoryRow } = loader.loadModule("src/components/chat/ChatHistorySidebar.tsx");
const { SettingsRow, SettingsRowGroup, SettingsNavigationRow } = loader.loadModule("src/pages/settings/shared.tsx");
const { mobileSettingsStatus } = loader.loadModule("src/pages/settings/mobileSettingsStatus.ts");
const settings = loader.loadModule("src/lib/settings/index.ts").getDefaultSettings();
const { MobileSystemSettingsForm } = createTsModuleLoader({ mocks: {
  ...vendor, react: React, "react/jsx-runtime": jsx,
  "../../components/icons": icons, "../../i18n": { useLocale, SUPPORTED_LOCALES: ["system", "zh-CN", "en-US"] },
  "../../lib/tray/trayPrefs": {}, "../../lib/terminal/tauriTerminalClient": {},
  "../../presentation/NativeMobileSystemSettings": {}, "../../runtime/applePresentation": {},
} }).loadModule("src/pages/settings/SystemSettingsForm.tsx");
const { CompactBackupSyncForm } = createTsModuleLoader({ mocks: {
  ...vendor, react: React, "react/jsx-runtime": jsx,
  "../../components/icons": icons, "../../i18n": { useLocale },
} }).loadModule("src/pages/settings/CompactBackupSyncForm.tsx");
const accessLoader = createTsModuleLoader({ mocks: {
  ...vendor, react: React, "react/jsx-runtime": jsx,
  "../../components/icons": icons, "../../i18n": { useLocale },
  "@xgent/runtime": { isBrowserRuntime: () => false },
  "../../lib/browser/browserSessionController": {},
  "../../lib/system/clipboardText": {},
} });
const { AccessSection } = accessLoader.loadModule("src/pages/settings/AccessSection.tsx");
const { CompactAccessSettingsForm } = accessLoader.loadModule("src/pages/settings/CompactAccessSettingsForm.tsx");
const { ProviderSettingsRow } = loader.loadModule("src/pages/settings/ProviderSettingsRow.tsx");
const { ProvidersSection } = createTsModuleLoader({ mocks: {
  ...vendor, react: React, "react/jsx-runtime": jsx,
  "../../components/icons": icons, "../../i18n": { useLocale },
  "@astryxdesign/core/hooks": { useMediaQuery: () => true },
  "../../lib/providers/usageQuery": {
    useProviderUsage: () => ({ getState: () => ({ loading: false, result: { data: [], error: "A quota diagnostic https://example.com/" + "long-quota-path/".repeat(4) } }), refresh: async () => {} }),
  },
  "./CodexOAuthAccounts": {}, "./ModelFailoverSection": {}, "./RetryErrorSection": {},
} }).loadModule("src/pages/settings/ProvidersSection.tsx");

// Open the real private editor through its public list handler, then render it
// with React and the installed Astryx components. Open panels/model fields with
// their real handlers so this fixture does not need a copy of editor state.
function providerEditorForPanel(panel) {
  let hooks = createReactHookHarness();
  let capturing = true;
  let editorLocale;
  const editorReact = { ...React, ...Object.fromEntries(Object.keys(hooks.react).map(key => [key,
    (...args) => capturing ? hooks.react[key](...args) : React[key](...args),
  ])) };
  const { ProvidersSection: Section } = createTsModuleLoader({ mocks: {
    ...vendor, react: editorReact, "react/jsx-runtime": jsx,
    "../../components/icons": icons,
    "../../i18n": { useLocale: () => capturing ? editorLocale ?? { t: key => key } : useLocale() },
    "@astryxdesign/core/hooks": { useMediaQuery: () => true },
    "../../lib/providers/usageQuery": { useProviderUsage: () => ({ getState: () => ({ loading: false }), refresh: noop }) },
    "./CodexOAuthAccounts": {}, "./ModelFailoverSection": {}, "./RetryErrorSection": {},
  } }).loadModule("src/pages/settings/ProvidersSection.tsx");
  const provider = { id: "fixture", type: "claude_code", name: "Example provider", baseUrl: "https://example.com/v1", apiKey: "fixture-key", models: [], activeModels: [] };
  const props = { settings: { ...settings, customProviders: [provider] }, setSettings() {}, thirdPartyImportEnabled: false };
  const visit = value => Array.isArray(value) ? value.flatMap(visit) : value?.label && typeof value.onClick === "function" ? [{ type: "menuitem", props: value }] : !value?.type || !value.props ? [] : [value, ...Object.values(value.props).flatMap(visit)];
  let tree = hooks.render(() => Section(props));
  visit(tree).find(node => node.type.name === "ProviderList").props.onEdit(provider);
  tree = hooks.render(() => Section(props));
  const editor = visit(tree).find(node => node.type.name === "ProviderEditor").type;
  hooks.unmount(); capturing = false;
  return function ProviderEditorFixture(props) {
    editorLocale = useLocale();
    hooks = createReactHookHarness(); capturing = true;
    try {
      let result = hooks.render(() => editor(props));
      if (panel === "model") {
        const edit = visit(result).find(node => node.props.label === editorLocale.t("settings.modelSettings"));
        assert.ok(edit, "The actual per-model settings action must exist");
        edit.props.onClick();
      } else {
        visit(result).find(node => node.props.role === "tablist").props.onChange(panel);
      }
      result = hooks.render(() => editor(props));
      if (panel === "model") assert.ok(visit(result).some(node => node.props.label === editorLocale.t("settings.contextWindow")), "Model parameters must open through their public action");
      return result;
    } finally { hooks.unmount(); capturing = false; }
  };
}
const { ToolPermissionsSection } = createTsModuleLoader({ mocks: {
  ...vendor, react: React, "react/jsx-runtime": jsx,
  "../../components/icons": icons, "../../i18n": { useLocale },
  "../../lib/runtimePlatform": { isNativeMobileRuntime: () => true },
} }).loadModule("src/pages/settings/ToolPermissionsSection.tsx");
const { ModelPicker } = createTsModuleLoader({ mocks: {
  ...vendor, react: React, "react/jsx-runtime": jsx,
  "../../components/icons": icons, "../../i18n": { useLocale },
} }).loadModule("src/pages/settings/modelPicker.tsx");
const modelValues = createTsModuleLoader().loadModule("src/lib/providers/runtime/modelValue.ts");
const { MemorySettingsDrawer } = createTsModuleLoader({ mocks: {
  ...vendor, react: React, "react/jsx-runtime": jsx,
  "../../../components/icons": icons,
  "./platform": { ...modelValues, ModelPicker, ChevronLeft: icons.ChevronLeft, canRunOrganizerLocally: true, pokeMemoryOrganizer() {} },
  "./OrganizerHistoryModal": { OrganizerHistoryModal() { throw new Error("The settings fixture must not mount organizer history"); } },
  "../../../lib/memory/api": {}, "../../../presentation/NativeSurface": {}, "../../../presentation/nativeTheme": {},
  "../../../runtime/applePresentation": { isApplePresentationRuntime: () => false },
  "../../../lib/runtimePlatform": { isNativeMobileRuntime: () => true },
} }).loadModule("src/pages/settings/memory/MemorySettingsDrawer.tsx");
const pageMocks = {
  ...vendor, react: React, "react/jsx-runtime": jsx,
  "../components/icons": icons, "../i18n": { useLocale },
  "../lib/responsive/compactViewport": { useCompactViewport: () => true },
  "../lib/useMobileBackNavigation": { useMobileBackNavigation() {} },
  "./settings/SettingsModalShell": { SettingsDetailLayerProvider: ({ children }) => children },
};
for (const name of ["AboutSection", "AccessSection", "BackupSyncSection", "ComputerUseSection", "GlobalShortcutsSection", "MobileAssistantSection", "MobileExecutionSection", "MobileVoiceSettingsSection", "OtherSettingsSection", "ProjectRootsSection", "ProviderSettingsSection", "SoulSection", "SttSettingsSection", "SystemSettingsForm", "ToolPermissionsSection"])
  pageMocks[`./settings/${name}`] = { [name]: () => { throw new Error(`The index must not mount ${name}`); } };
pageMocks["./settings/memory/MemoryPanel"] = { MemoryPanel: () => { throw new Error("The index must not mount memory details"); } };
const { SettingsPage } = createTsModuleLoader({ mocks: pageMocks }).loadModule("src/pages/SettingsPage.tsx");
const { Switch } = vendor["@astryxdesign/core/Switch"];
const noop = () => {};
const backupData = {
  form: { url: "https://dav.example.com/very-long-backup-directory/", username: "A multilingual account name 用户名", password: "", passwordTouched: false, remoteDir: "xgent", profile: "default", autoSync: true },
  syncView: { hasPassword: true, lastSyncAt: Date.UTC(2026, 9, 5, 16), lastError: "Could not connect to https://example.com/" + "long-diagnostic-path/".repeat(8) },
  operation: null, busy: null, syncBusy: null, dirty: false, configured: true, locked: false, localAvailable: false, preset: "custom", status: null, syncStatus: null,
  patchForm: noop, reload: noop, handlePresetChange: noop, handleAutoSyncChange: noop, handleSaveSync: noop, handleTestSync: noop, handleUpload: noop, handleDownload: noop, handleExport: noop, handleImport: noop,
};
const fileTreeNodes = { "": { path: "", name: "Workspace", kind: "dir", loaded: true, children: [] } };
const { FileTreePanel } = createTsModuleLoader({ mocks: {
  ...vendor, react: React, "react/jsx-runtime": jsx,
  "../../../i18n": { useLocale },
  "../../../lib/chat/workspacePathDrag": { finishWorkspacePathDrag: noop, writeWorkspacePathDragPayload: () => true },
  "../../chat/fileTypeIcons": { getFileTypeIcon: () => icon },
  "../../icons": icons,
  "../WorkspaceToolsContext": { useWorkspaceToolsContext: () => ({ projectPathKey: "/project", cwd: "/project", clients: {},
    fileTree: { initialized: true, state: { expandedPaths: [""], selectedPath: "", query: "", showHidden: false, revision: 0 }, onStateChange: noop },
  }) },
  "./ContextMenu": { FileTreeContextMenu: ({ children }) => children },
  "./useFileTreeData": { useFileTreeData: () => ({ nodes: fileTreeNodes,
    loadChildren: noop, refreshVisible: noop, ensureDirsLoaded: noop,
    createEntry: noop, renameEntry: noop, deleteEntry: noop, openWorkspacePath: noop,
    search: { results: [], loading: false, error: null },
  }) },
} }).loadModule("src/components/project-tools/file-tree/index.tsx");

test("actual Astryx rows keep long titles, settings labels and file actions within narrow bounds", {
  skip: annotationBrowser ? false : "A Chromium browser is required for layout evidence",
}, async () => {
  const css = readFileSync(new URL("../../src/index.css", import.meta.url), "utf8").replace(/^@import .*;$/gm, "");
  const vendorCss = readFileSync(new URL("../../node_modules/@astryxdesign/core/dist/astryx.css", import.meta.url), "utf8");
  const reset = readFileSync(new URL(import.meta.resolve("@astryxdesign/core/reset.css")), "utf8");
  const themeCss = generateThemeCSS(xgentCompactTheme);
  const sections = [];
  const providerEditors = Object.fromEntries(["general", "model", "request", "usage"].map(panel => [panel, providerEditorForPanel(panel)]));
  for (const locale of ["en-US", "zh-CN"]) {
    sections.push(React.createElement(Locale.Provider, { value: locale }, React.createElement("section", {
      className: "fixture-settings-index", style: { width: 320, height: 900 }, "data-locale": locale,
    }, React.createElement(SettingsPage, { settings, setSettings: noop, saveState: { status: "saved" }, onBack: noop, nativeMobile: true, appUpdate: { result: { currentVersion: "1.0.0" } } }))));
  }
  for (const locale of ["en-US", "zh-CN"]) for (const width of [240, 320, 390, 768]) for (const scale of [1, 1.5]) {
    const t = key => translations[locale][key] ?? key;
    for (const providerType of ["claude_code", "codex"]) for (const panel of ["general", "model", "request", "usage"]) {
      sections.push(React.createElement(Locale.Provider, { value: locale }, React.createElement("section", {
        className: "fixture-provider-editor settings-page settings-page-compact",
        style: { width, height: 844, "--text-body-size": `${17 * scale}px`, "--text-label-size": `${17 * scale}px`, "--text-supporting-size": `${17 / 1.18 * scale}px` },
        "data-width": width, "data-scale": scale, "data-locale": locale, "data-panel": panel, "data-provider": providerType,
      }, React.createElement(providerEditors[panel], {
        providerType, initialData: {
          id: "fixture", type: providerType, name: "A provider with a long multilingual name 用户供应商", baseUrl: "https://example.com/" + "long-endpoint/".repeat(5), apiKey: "fixture-key",
          models: [{ id: "a-model-with-a-long-name-" + "long-model/".repeat(8), contextWindow: 200000, maxOutputToken: 8192 }], activeModels: [],
          customHeaders: [{ key: "X-Custom-Header", value: "fixture-value" }],
        }, onSave: noop, onClose: noop,
      }))));
    }
    sections.push(React.createElement(Locale.Provider, { value: locale }, React.createElement("section", {
      className: "fixture-provider-controller settings-page settings-page-compact",
      style: { width, height: 844, "--text-body-size": `${17 * scale}px`, "--text-label-size": `${17 * scale}px`, "--text-supporting-size": `${17 / 1.18 * scale}px` },
      "data-width": width, "data-scale": scale, "data-locale": locale,
    }, React.createElement(ProvidersSection, {
      settings: { ...settings, customProviders: [0, 1].map(index => ({ id: `provider-${index}`, type: "claude_code", name: `Provider ${index} with a very long multilingual name 用户自定义供应商`, baseUrl: "https://example.com/" + "long-provider-endpoint/".repeat(5), apiKey: "", models: [], activeModels: ["one", "two", "three"], useSystemProxy: true, usageQuery: { enabled: true } })) },
      setSettings: noop, nativeMobile: true, thirdPartyImportEnabled: true,
    }))));
    sections.push(React.createElement(Locale.Provider, { value: locale }, React.createElement("section", {
      className: "fixture-provider-details settings-page settings-page-compact",
      style: { width, padding: 16, "--text-body-size": `${17 * scale}px`, "--text-label-size": `${17 * scale}px`, "--text-supporting-size": `${17 / 1.18 * scale}px` },
      "data-width": width, "data-scale": scale, "data-locale": locale,
    }, React.createElement(vendor["@astryxdesign/core/List"].List, { className: "settings-provider-list", density: "compact", hasDividers: true }, React.createElement(ProviderSettingsRow, {
      id: "long-provider", name: "A provider with a very long multilingual name 用户自定义供应商",
      icon: React.createElement(vendor["@astryxdesign/core/Icon"].Icon, { className: "settings-provider-brand", icon: icons.ClaudeIcon, size: "sm" }),
      description: React.createElement(React.Fragment, null,
        React.createElement("span", null, "https://example.com/" + "long-provider-endpoint/".repeat(5) + " · 3 " + t("settings.activeModels")),
        React.createElement("span", null, "An actual quota service error with a long diagnostic https://example.com/" + "long-quota-diagnostic/".repeat(3)),
        React.createElement("span", { className: "settings-provider-proxy" }, React.createElement(vendor["@astryxdesign/core/Icon"].Icon, { icon: icons.Waypoints, size: "sm" }), t("settings.providerUseSystemProxy"))),
      reorder: React.createElement(vendor["@astryxdesign/core/IconButton"].IconButton, { label: t("settings.reorderProvider"), size: "lg", variant: "ghost", icon: React.createElement(vendor["@astryxdesign/core/Icon"].Icon, { icon: icons.GripVertical, size: "sm" }), onClick: noop }),
      actions: React.createElement(vendor["@astryxdesign/core/MoreMenu"].MoreMenu, { label: t("settings.providerMore"), size: "lg", items: ["settings.usage.refresh", "settings.edit", "settings.delete"].map(key => ({ id: key, label: t(key), onClick: noop })) }),
      isSelected: false, onEdit: noop,
    })))));
    const project = { id: "long", name: "Workspace with a very long multilingual title 工作空间文件夹", path: "/long" };
    const customizedSettings = { ...settings, locale: "en-US", customSettings: { ...settings.customSettings,
      interfaceFontFamily: "Example Custom Interface Font",
      appearance: { ...settings.customSettings.appearance, customized: true },
    } };
    for (const mobile of [false, true]) {
      sections.push(React.createElement(Locale.Provider, { value: locale }, React.createElement("section", {
        className: "fixture-access-details settings-page settings-page-compact",
        style: { width, padding: 16, "--text-body-size": `${17 * scale}px`, "--text-label-size": `${17 * scale}px`, "--text-supporting-size": `${17 / 1.18 * scale}px` },
        "data-width": width, "data-scale": scale, "data-locale": locale, "data-mobile": String(mobile),
      }, React.createElement("div", { "data-settings-section": "access" }, React.createElement(CompactAccessSettingsForm, {
        access: { ...settings.access, webUiEnabled: true, cloudExecutionEnabled: true, githubOwner: "A multilingual account name 用户名", githubRepository: "A task repository with a long name 任务仓库", lanControlUrl: "http://192.168.1.2:28367/", preferLanPcExecution: true },
        nativeMobile: mobile, browser: false,
        localStatus: { enabled: true, running: true, bindAddress: "0.0.0.0", port: 28367, urls: ["http://192.168.1.2:28367/"], pairingCode: "123456", pairedDevices: 1, devices: [{ deviceId: "phone", label: "An already paired device with a very long multilingual name 用户设备", lastSeenAt: Date.UTC(2026, 9, 5, 16) }] },
        vaultStatus: { githubTokenConfigured: true, githubUsername: "A multilingual account name 用户名" }, lanPcStatus: { paired: true, baseUrl: "http://192.168.1.2:28367/" },
        lanPairingCode: "123456", lanDeviceName: "A multilingual phone name 用户设备", githubToken: "", busyAction: "", endpoint: "http://192.168.1.2:28367/", localStatusLabel: t("settings.accessRunning"), localStatusPhase: "running",
        actionError: "Could not connect to https://example.com/" + "long-diagnostic-path/".repeat(8),
        setLanPairingCode: noop, setLanDeviceName: noop, setGithubToken: noop, patchAccess: noop, setCapabilityBlocked: noop, normalizeAddress: noop,
        actions: Object.fromEntries(["saveToken", "removeToken", "pair", "disconnect", "refreshLan", "openComputer", "refreshLocal", "rotatePairingCode", "revokeDevice"].map(name => [name, async () => {}])),
        copyEndpoint: React.createElement(vendor["@astryxdesign/core/IconButton"].IconButton, { label: t("workspaceEditor.context.copy"), icon: React.createElement(icons.Copy), size: "lg", onClick: noop }),
      })))));
    }
    sections.push(React.createElement(Locale.Provider, { value: locale }, React.createElement("section", {
      className: "fixture-access-controller settings-page settings-page-compact",
      style: { width, padding: 16, "--text-body-size": `${17 * scale}px`, "--text-label-size": `${17 * scale}px`, "--text-supporting-size": `${17 / 1.18 * scale}px` },
      "data-width": width, "data-scale": scale, "data-locale": locale, "data-mobile": "true",
    }, React.createElement("div", { "data-settings-section": "access" }, React.createElement(AccessSection, {
      settings: { ...settings, access: { ...settings.access, githubOwner: "account", lanControlUrl: "http://192.168.1.2:28367/" } },
      setSettings: noop, nativeMobile: true, compact: true,
    })))));
    sections.push(React.createElement(Locale.Provider, { value: locale }, React.createElement("section", {
      className: "fixture-system-details settings-page settings-page-compact",
      style: { width, "--zone-font-scale": scale }, "data-width": width, "data-scale": scale, "data-locale": locale,
    }, React.createElement("div", { "data-settings-section": "system" }, React.createElement(MobileSystemSettingsForm, { settings: customizedSettings, setSettings: noop })))));
    sections.push(React.createElement(Locale.Provider, { value: locale }, React.createElement("section", {
      className: "fixture-native-memory-time compact-memory-settings-form settings-page settings-page-compact",
      style: { width, padding: 16, "--text-body-size": `${17 * scale}px`, "--text-label-size": `${17 * scale}px`, "--text-supporting-size": `${17 / 1.18 * scale}px` },
      "data-width": width, "data-scale": scale, "data-locale": locale,
    }, React.createElement("div", { "data-settings-section": "memory-time" }, React.createElement(SettingsRowGroup, { title: t("settings.memoryOrganizerTitle") }, React.createElement(SettingsRow, { label: t("settings.memoryOrganizerTime"), icon: React.createElement(icons.Clock3) }, React.createElement(vendor["@astryxdesign/core/TimeInput"].TimeInput, { label: t("settings.memoryOrganizerTime"), isLabelHidden: true, value: "03:00", nativePicker: "always", hourFormat: "24h", size: "lg", width: "100%", onChange: noop })))))));
    sections.push(React.createElement(Locale.Provider, { value: locale }, React.createElement("section", {
      className: "fixture-memory-details settings-page settings-page-compact",
      style: { width, height: 844, "--zone-font-scale": scale, "--text-body-size": `${17 * scale}px`, "--text-label-size": `${17 * scale}px`, "--text-supporting-size": `${17 / 1.18 * scale}px` },
      "data-width": width, "data-scale": scale, "data-locale": locale,
    }, React.createElement(MemorySettingsDrawer, {
      settings: { ...settings, memory: { ...settings.memory, organizerModel: { customProviderId: "fixture", model: "long-model" }, summaryModel: { customProviderId: "fixture", model: "long-model" }, organizerEnabled: true, organizerSchedule: { ...settings.memory.organizerSchedule, frequency: "weekly", weekday: 4 }, organizerNextRunAt: Date.UTC(2026, 9, 6, 16) } },
      modelOptions: [{ value: "fixture::long-model", label: "A selected multilingual model with a very long provider and model name 用户模型", providerName: "Fixture provider" }],
      compact: true, saving: false, error: "A diagnostic message with a very long URL https://example.com/" + "long-path/".repeat(12), notice: null, t, setSettings: noop, onClose: noop, onRequestWipe: noop,
    }))));
    sections.push(React.createElement(Locale.Provider, { value: locale }, React.createElement("section", {
      className: "fixture-permissions-details settings-page settings-page-compact",
      style: { width, "--text-body-size": `${17 * scale}px`, "--text-label-size": `${17 * scale}px`, "--text-supporting-size": `${17 / 1.18 * scale}px` },
      "data-width": width, "data-scale": scale, "data-locale": locale,
    }, React.createElement("div", { "data-settings-section": "toolPermissions" }, React.createElement(ToolPermissionsSection, { settings: { ...settings, system: { ...settings.system, toolPolicies: { Read: "deny" } } }, setSettings: noop, compact: true })))));
    sections.push(React.createElement(Locale.Provider, { value: locale }, React.createElement("section", {
      className: "fixture-backup-details settings-page settings-page-compact",
      style: { width, "--text-body-size": `${17 * scale}px`, "--text-label-size": `${17 * scale}px`, "--text-supporting-size": `${17 / 1.18 * scale}px` },
      "data-width": width, "data-scale": scale, "data-locale": locale,
    }, React.createElement("div", { "data-settings-section": "backup" }, React.createElement(CompactBackupSyncForm, { data: { ...backupData, localAvailable: width === 768 } })))));
    sections.push(React.createElement(Locale.Provider, { value: locale }, React.createElement("section", { className: "fixture settings-page settings-page-compact", style: { width, fontSize: `${16 * scale}px`, "--zone-font-scale": scale }, "data-width": width, "data-scale": scale, "data-locale": locale },
      React.createElement(ProjectRow, { project, isActive: true, isMissing: false, isRunning: true,
        isRenaming: false, isPendingRemove: false, expanded: true, onToggleExpanded: noop,
        onSelectProject: noop, onStartRenamingProject: noop, onProjectRenameDraftChange: noop,
        onCommitProjectRename: noop, onCancelProjectRename: noop, onSetProjectPinned: noop,
        onRemoveProject: noop, workspaceProjectGroups: [], currentGroupId: null, isArchived: false,
        canArchive: false, onArchiveProject: noop, onUnarchiveProject: noop, onSetPendingRemove: noop,
        renameDraft: "", touchActions: true }),
      React.createElement(HistoryRow, { item: { id: "running", title: "A running conversation with a long title 正在运行的对话", cwd: "/long" }, isActive: true, isRunning: true, isBusy: false,
        isDeleteDisabled: false, isRenaming: false, isPendingDelete: false, renameDraft: "", selectionMode: false, isSelected: false,
        onSelectConversation: noop, onStartRenaming: noop, onRenameDraftChange: noop, onCommitRename: noop, onCancelRename: noop,
        onSetPinned: noop, projects: [], onMoveToWorkspace: noop, onToggleSelection: noop, onEnterSelection: noop,
        onDeleteConversation: noop, onSetPendingDelete: noop, touchActions: true }),
      React.createElement("ul", {}, ["system", "providers", "toolPermissions", "voice", "access"].map(id => React.createElement(SettingsNavigationRow, {
        key: id, label: t(id === "access" ? "settings.navAccess" : id === "voice" ? "settings.navVoice" : id === "toolPermissions" ? "settings.navToolPermissions" : id === "system" ? "settings.navSystem" : "settings.navProviders"),
        icon: React.createElement(icons[{ system: "Settings", providers: "Cpu", toolPermissions: "Shield", voice: "Mic", access: "Cloud" }[id]]), status: mobileSettingsStatus(id, settings, t), chevron: React.createElement(icons.ChevronRight), onClick: noop,
      }))),
      React.createElement("div", { "data-settings-section": "system" },
        React.createElement("ul", {}, React.createElement(SettingsRow, {
          label: "Automatically display detailed progress 自动显示工作过程",
          description: "Keep the full description readable when the display is narrow.",
        }, React.createElement(Switch, { label: "Show progress", isLabelHidden: true, value: true, onChange: noop })))),
      React.createElement(FileTreePanel, { active: true, touchActions: true }))));
  }
  for (const width of [240, 320, 390, 768]) {
    sections.push(React.createElement("section", { className: "fixture-desktop-sidebar", style: { width }, "data-width": width },
      React.createElement(HistoryRow, {
        item: { id: "desktop-chat", title: "A very long conversation title that stays on one line when selected and hovered", updatedAt: 1, isPinned: false },
        isActive: true, isRunning: true, isBusy: false, isDeleteDisabled: false,
        isRenaming: false, isPendingDelete: false, renameDraft: "", projects: [],
        selectionMode: false, isSelected: false, onToggleSelection: noop, onEnterSelection: noop,
        onSetPendingDelete: noop, onMoveToWorkspace: noop,
        touchActions: false, projectActionStyle: false, hidePinAction: false,
        onSelectConversation: noop, onSetPinned: noop, onStartRenaming: noop, onDeleteConversation: noop,
      })));
    sections.push(React.createElement("section", { className: "fixture-sidebar-reveal", style: { width, height: 800, position: "relative", overflow: "hidden" }, "data-width": width },
      React.createElement(ChatSidebarSurface, { mobileExperience: true, isOpen: true, onClose: noop, mobileHeader: "Xgent", desktopWidth: 320, fontScale: 1 }, "Navigation"),
      React.createElement("div", { className: "chat-workspace-main", "data-mobile-chat-workspace": "true", "data-mobile-sidebar-open": "true", style: { width: "100%", height: "100%" } }, "Chat")));
  }
  sections.push(React.createElement(vendor["@astryxdesign/core/Dialog"].Dialog, {
    isOpen: true, isInline: true, onOpenChange: noop, className: "fixture-settings-resize",
    width: "var(--xgent-settings-dialog-width)", maxHeight: "var(--xgent-settings-dialog-height)",
    style: { height: "var(--xgent-settings-dialog-height)" },
  }, "Settings"));
  const html = `<!doctype html><html data-theme="light" data-astryx-theme="${xgentCompactTheme.name}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${reset}\n${vendorCss}\n@layer reset {${themeCss.prose}}\n@layer astryx-theme {${themeCss.component}}\n${css}
  :root { --spacing-1:4px; --spacing-2:8px; --size-element-sm:32px; --size-element-md:40px; --size-element-lg:44px; }
  body { margin:0; } .fixture, .fixture-settings-index, .fixture-system-details, .fixture-backup-details, .fixture-permissions-details, .fixture-memory-details { margin:16px; border:1px solid black; }
  #result { display:none; } .fixture .settings-control-row { font-size:inherit; }
  .workspace-project-row, .chat-history-row { display:grid; min-width:0; grid-template-columns:minmax(0,1fr) auto; }
  @layer utilities { .opacity-0 {opacity:0;} .chat-history-row:hover .sidebar-row-actions, .chat-history-row:focus-within .sidebar-row-actions {opacity:1;} .max-w-16 {max-width:64px;} }
  .workspace-project-row .astryx-more-menu { flex-shrink:0; }
  .fixture * { box-sizing:border-box; } .fixture .astryx-text { font-size:inherit; }
  .fixture-system-details .astryx-text[data-type="body"] { font-size:calc(var(--text-body-size) * var(--zone-font-scale)); }
  .fixture-system-details .astryx-text[data-type="supporting"] { font-size:calc(var(--text-supporting-size) * var(--zone-font-scale)); }
  </style>${renderToStaticMarkup(React.createElement(Theme, { theme: xgentCompactTheme, mode: "light" }, ...sections))}<pre id="result"></pre><script>
  addEventListener('error', event => { document.getElementById('result').textContent=JSON.stringify({failures:[{scriptError:event.message}],evidence:[],detailEvidence:[]}); });
  addEventListener('load', () => { requestAnimationFrame(() => {
    const failures = []; const evidence = []; const detailEvidence = []; const backupEvidence = []; const permissionsEvidence = []; const memoryEvidence = []; const nativeTimeEvidence = []; const accessEvidence = []; const providerEvidence = [];
    // This fixture contains hundreds of full-height panels. Chromium's float
    // coordinates lose 1/64 px precision beyond 262,144 px even when computed
    // height is exactly 44 px. Keep the same target threshold within 1/32 px.
    const smallTouchTarget = box => box.width + 1/32 < 44 || box.height + 1/32 < 44;
    const touchTarget = control => {
      // Installed Astryx inputs focus on wrapper clicks; Selector delegates
      // its trigger clicks from the whole surface. Other buttons stay separate.
      const wrapper = control.matches('input:not([type="checkbox"]), button[role="combobox"]')
        ? control.closest('.astryx-text-input, .astryx-number-input, .astryx-selector') : null;
      return (wrapper ?? control).getBoundingClientRect();
    };
    for (const section of document.querySelectorAll('.fixture-provider-editor')) {
      const bounds = section.getBoundingClientRect();
      const panel = section.querySelector('[role="tabpanel"]');
      const footer = section.querySelector('.settings-provider-editor-footer');
      const footerButtons = [...footer.querySelectorAll('button')].map(button => button.getBoundingClientRect());
      if (footerButtons.length !== 2 || footerButtons.reduce((sum, box) => sum + box.width, 0) < bounds.width - 64 || Math.abs(footerButtons[0].width - footerButtons[1].width) > 1) failures.push({width:section.dataset.width,scale:section.dataset.scale,panel:section.dataset.panel,compressedEditorFooter:footerButtons.map(box => box.width)});
      if (panel.getBoundingClientRect().bottom > footer.getBoundingClientRect().top + 1) failures.push({width:section.dataset.width,panel:section.dataset.panel,coveredEditorContent:true});
      const controls = [...section.querySelectorAll('button, input:not([type="hidden"]), textarea, [role="switch"]')];
      for (const control of controls) {
        const box = control.getBoundingClientRect();
        if (box.width <= 1 || box.height <= 1) continue;
        const label = control.getAttribute('aria-label') || control.textContent;
        // Astryx focuses TextInput/NumberInput from clicks anywhere on their
        // wrapper; Selector also opens from its wrapper's onTriggerClick.
        // Measure that actual delegated target, retaining each independent
        // button's own target (including clear/status/step controls).
        const target = touchTarget(control);
        if (smallTouchTarget(target)) failures.push({locale:section.dataset.locale,width:section.dataset.width,scale:section.dataset.scale,panel:section.dataset.panel,smallEditorControl:label,box:{width:target.width,height:target.height,top:target.top,bottom:target.bottom},computed:{height:getComputedStyle(control).height,minHeight:getComputedStyle(control).minHeight,transform:getComputedStyle(control).transform}});
        if (!control.closest('.astryx-tab-strip') && (box.left < bounds.left - 1 || box.right > bounds.right + 1)) failures.push({locale:section.dataset.locale,provider:section.dataset.provider,width:section.dataset.width,scale:section.dataset.scale,panel:section.dataset.panel,editorControlOverflow:label,type:control.type,role:control.getAttribute('role'),box:{left:box.left,right:box.right},bounds:{left:bounds.left,right:bounds.right}});
      }
      for (const text of panel.querySelectorAll('.astryx-text')) {
        const box = text.getBoundingClientRect();
        if (box.width > 1 && (box.left < bounds.left - 1 || box.right > bounds.right + 1 || (text.scrollWidth > text.clientWidth + 1 && !text.classList.contains("settings-provider-model-label")))) failures.push({locale:section.dataset.locale,width:section.dataset.width,scale:section.dataset.scale,panel:section.dataset.panel,clippedEditorText:text.textContent});
      }
      if (panel.getBoundingClientRect().bottom > bounds.bottom + 1 || section.scrollWidth > section.clientWidth + 1) failures.push({width:section.dataset.width,scale:section.dataset.scale,panel:section.dataset.panel,editorSurfaceOverflow:true});
      if (section.dataset.panel === 'model') {
        const limits = panel.querySelectorAll('input[inputmode="numeric"]');
        const costs = panel.querySelectorAll('input[inputmode="decimal"]');
        if (limits.length !== 2 || costs.length !== 4) failures.push({width:section.dataset.width,missingModelParameters:{limits:limits.length,costs:costs.length}});
        panel.scrollTop = panel.scrollHeight;
        const last = costs[costs.length - 1]?.closest('.astryx-field') ?? costs[costs.length - 1];
        const lastBounds = last?.getBoundingClientRect(), port = panel.getBoundingClientRect();
        if (!lastBounds || lastBounds.top < port.top - 1 || lastBounds.bottom > port.bottom + 1) failures.push({width:section.dataset.width,scale:section.dataset.scale,unreachableModelParameters:true});
        panel.scrollTop = 0;
      }
      providerEvidence.push({locale:section.dataset.locale,width:section.dataset.width,scale:section.dataset.scale,editor:true,panel:section.dataset.panel,controls:controls.length});
    }
    for (const section of document.querySelectorAll('.fixture-provider-details')) {
      const bounds = section.getBoundingClientRect();
      const row = section.querySelector('.settings-provider-row');
      for (const element of section.querySelectorAll('.settings-provider-name, .settings-provider-name .astryx-text, .settings-provider-description, .settings-provider-description .astryx-text, button')) {
        const box = element.getBoundingClientRect();
        if (box.width <= 0 || box.left < bounds.left - 1 || box.right > bounds.right + 1) failures.push({width:section.dataset.width,scale:section.dataset.scale,providerOverflow:element.className,text:element.textContent});
      }
      const buttons = [...section.querySelectorAll('button')];
      if (buttons.length !== 3) failures.push({width:section.dataset.width,missingProviderControls:buttons.length});
      for (const button of buttons) {
        const box = button.getBoundingClientRect();
        if (smallTouchTarget(box)) failures.push({width:section.dataset.width,providerSmallControl:button.getAttribute('aria-label') ?? button.textContent,widthPx:box.width,height:box.height});
      }
      for (let i = 0; i < buttons.length; i++) for (let j = i + 1; j < buttons.length; j++) {
        const a = buttons[i].getBoundingClientRect(), b = buttons[j].getBoundingClientRect();
        if (a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1) failures.push({width:section.dataset.width,providerOverlappingControls:true});
      }
      const name = section.querySelector('.settings-provider-name .astryx-text');
      if (name.getBoundingClientRect().height > parseFloat(getComputedStyle(name).lineHeight) + 1) failures.push({width:section.dataset.width,providerNameWrapped:true});
      const grip = buttons.find(button => button.getAttribute('aria-label') === '${translations["en-US"]["settings.reorderProvider"]}');
      const firstAction = buttons.find(button => button.getAttribute('aria-label') === '${translations["en-US"]["settings.providerMore"]}');
      if (section.dataset.locale === 'en-US' && (!grip || !firstAction || grip.getBoundingClientRect().right > name.getBoundingClientRect().left || firstAction.getBoundingClientRect().left < name.getBoundingClientRect().right)) failures.push({width:section.dataset.width,providerOrderingNotLeading:true});
      providerEvidence.push({locale:section.dataset.locale,width:section.dataset.width,scale:section.dataset.scale,controls:buttons.length,columns:getComputedStyle(row).gridTemplateColumns,height:row.getBoundingClientRect().height});
    }
    for (const section of document.querySelectorAll('.fixture-provider-controller')) {
      const bounds = section.getBoundingClientRect();
      for (const element of section.querySelectorAll('.settings-provider-name, .settings-provider-description, .settings-provider-actions, .settings-provider-list, .astryx-tab-list, button')) {
        const box = element.getBoundingClientRect();
        // Tabs outside the horizontal scrollport are intentionally scrollable.
        if (element.closest('.astryx-tab-list') && element !== section.querySelector('.astryx-tab-list')) continue;
        if (box.width <= 0 || box.left < bounds.left - 1 || box.right > bounds.right + 1) failures.push({width:section.dataset.width,scale:section.dataset.scale,providerControllerOverflow:element.className,text:element.textContent});
        if (element.tagName === 'BUTTON' && smallTouchTarget(box)) failures.push({width:section.dataset.width,providerControllerSmallTarget:element.getAttribute('aria-label') ?? element.textContent,widthPx:box.width,height:box.height});
      }
      const rows = section.querySelectorAll('[data-provider-reorder-id]');
      if (rows.length !== 2) failures.push({width:section.dataset.width,missingProviderRows:rows.length});
      if (getComputedStyle(section.querySelector('.settings-provider-list')).backgroundColor !== 'rgb(255, 255, 255)') failures.push({width:section.dataset.width,missingProviderCard:true});
      const tabList = section.querySelector('.astryx-tab-list');
      const scroll = tabList?.querySelector('[role="tablist"]') ?? tabList;
      if (!scroll || (+section.dataset.width <= 390 && scroll.scrollWidth <= scroll.clientWidth) || !['auto', 'scroll'].includes(getComputedStyle(scroll).overflowX)) failures.push({width:section.dataset.width,missingProviderTabScroll:true});
      const advanced = section.querySelector('.settings-provider-tabs-toolbar .astryx-icon-button');
      if (advanced && tabList.getBoundingClientRect().right > advanced.getBoundingClientRect().left + 1) failures.push({width:section.dataset.width,overlappingProviderTabs:true});
      for (const tab of section.querySelectorAll('[role="tab"]')) {
        const box = tab.getBoundingClientRect();
        if (smallTouchTarget(box)) failures.push({width:section.dataset.width,smallProviderTab:tab.textContent,widthPx:box.width,height:box.height});
      }
      const glyphs = section.querySelectorAll('.settings-provider-brand[fill]:not([fill="none"]), .settings-provider-brand [fill]:not([fill="none"])');
      if (glyphs.length < 3) failures.push({width:section.dataset.width,missingProviderBrandGlyphs:true});
      for (const path of glyphs) {
        if (getComputedStyle(path).fill !== getComputedStyle(path).color) failures.push({width:section.dataset.width,coloredProviderGlyph:true});
      }
      providerEvidence.push({locale:section.dataset.locale,width:section.dataset.width,scale:section.dataset.scale,controller:true,rows:rows.length});
    }
    for (const section of document.querySelectorAll('.fixture-access-details, .fixture-access-controller')) {
      const bounds = section.getBoundingClientRect();
      const visible = element => {
        const box = element.getBoundingClientRect(), style = getComputedStyle(element);
        return box.width > 0 && box.height > 0 && !(box.width <= 1 && box.height <= 1 && (style.clip !== 'auto' || style.clipPath !== 'none'));
      };
      const texts = [...section.querySelectorAll('.astryx-text, label, .astryx-field-label')].filter(visible);
      for (const element of [...texts, ...section.querySelectorAll('input, button, .astryx-selector')]) {
        const box = element.getBoundingClientRect();
        if (!visible(element)) continue;
        if (box.left < bounds.left - 1 || box.right > bounds.right + 1 || (texts.includes(element) && element.scrollWidth > element.clientWidth + 1)) failures.push({width:section.dataset.width,scale:section.dataset.scale,mobile:section.dataset.mobile,accessOverflow:element.className,text:element.textContent});
      }
      for (const element of section.querySelectorAll('button, input:not([type="hidden"])')) {
        const box = touchTarget(element);
        if (!visible(element)) continue;
        if (smallTouchTarget(box)) failures.push({width:section.dataset.width,mobile:section.dataset.mobile,accessSmallControl:element.getAttribute('aria-label') ?? element.textContent,height:box.height,widthPx:box.width});
      }
      for (const child of section.querySelectorAll('.settings-row-group .astryx-list > *')) {
        if (child.tagName !== 'LI') failures.push({width:section.dataset.width,invalidAccessListChild:child.tagName});
      }
      const status = [...section.querySelectorAll('.settings-status-label')];
      if (status.length !== 2) failures.push({width:section.dataset.width,missingAccessStatus:status.length});
      const groups = section.querySelectorAll('.settings-row-group').length;
      if (groups !== (section.dataset.mobile === 'true' ? 3 : 5)) failures.push({width:section.dataset.width,missingAccessGroups:groups});
      if (section.dataset.mobile === 'true') {
        const code = section.querySelector('input[autocomplete="one-time-code"]');
        if (!code || code.inputMode !== 'numeric' || code.maxLength !== 6) failures.push({width:section.dataset.width,missingPairingInputHints:true});
      }
      accessEvidence.push({locale:section.dataset.locale,width:section.dataset.width,scale:section.dataset.scale,mobile:section.dataset.mobile,controller:section.classList.contains('fixture-access-controller'),groups,status:status.map(element => element.textContent),controls:section.querySelectorAll('button, input').length});
    }
    for (const section of document.querySelectorAll('.fixture-native-memory-time')) {
      const input = section.querySelector('input[type="time"]');
      if (!input) failures.push({width:section.dataset.width,missingNativeTime:true});
      const opener = section.querySelector('.astryx-time-input button');
      if (input && opener && opener.getBoundingClientRect().right > input.getBoundingClientRect().left + 1) failures.push({width:section.dataset.width,nativeTimeOverlap:true});
      const visibleValue = input?.nextElementSibling;
      if (visibleValue && visibleValue.scrollWidth > visibleValue.clientWidth + 1) failures.push({width:section.dataset.width,scale:section.dataset.scale,nativeTimeClipped:true});
      for (const control of section.querySelectorAll('input[type="time"],button')) {
        const box = control.getBoundingClientRect(), bounds = section.getBoundingClientRect();
        if (smallTouchTarget(box) || box.left < bounds.left - 1 || box.right > bounds.right + 1) failures.push({width:section.dataset.width,nativeTimeBounds:{height:box.height,width:box.width,left:box.left,right:box.right},bounds:{left:bounds.left,right:bounds.right},tag:control.tagName});
      }
      nativeTimeEvidence.push({locale:section.dataset.locale,width:section.dataset.width,scale:section.dataset.scale,native:!!input});
    }
    for (const section of document.querySelectorAll('.fixture-memory-details')) {
      const bounds = section.getBoundingClientRect();
      for (const element of section.querySelectorAll('.astryx-text, .astryx-complex-selector, .astryx-selector, input, .settings-control-row, button')) {
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        if (box.left < bounds.left - 1 || box.right > bounds.right + 1 || element.scrollWidth > element.clientWidth + 1) failures.push({width:section.dataset.width,scale:section.dataset.scale,memoryOverflow:element.className,text:element.textContent});
      }
      for (const element of section.querySelectorAll('button, input:not([type="hidden"])')) {
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        if (smallTouchTarget(box)) failures.push({width:section.dataset.width,memorySmallControl:element.getAttribute('aria-label') ?? element.textContent,height:box.height,widthPx:box.width});
      }
      for (const label of section.querySelectorAll('.compact-memory-model-row .astryx-complex-selector > button > span')) {
        if (getComputedStyle(label).whiteSpace === 'nowrap' || label.scrollWidth > label.clientWidth + 1) failures.push({width:section.dataset.width,clippedMemoryModel:true});
      }
      const content = section.querySelector('[data-settings-section="memory-organizer"]');
      const scroll = content.parentElement;
      const header = section.querySelector('.settings-detail-header');
      const heading = header.querySelector('h2').getBoundingClientRect();
      const headerBounds = header.getBoundingClientRect();
      if (Math.abs((heading.left + heading.right) / 2 - (headerBounds.left + headerBounds.right) / 2) > 1) failures.push({width:section.dataset.width,scale:section.dataset.scale,memoryTitleNotCentered:true,heading:{left:heading.left,right:heading.right},header:{left:headerBounds.left,right:headerBounds.right},columns:getComputedStyle(header.querySelector('.astryx-dialog-header')).gridTemplateColumns});
      const top = header.getBoundingClientRect().top;
      scroll.scrollTop = scroll.scrollHeight;
      const wipe = section.querySelector('.compact-memory-settings-form > section:last-child button').getBoundingClientRect();
      const scrollBounds = scroll.getBoundingClientRect();
      if (scroll.scrollTop <= 0 || wipe.bottom > scrollBounds.bottom + 1 || header.getBoundingClientRect().top !== top) failures.push({width:section.dataset.width,memoryScrollUnreachable:true});
      memoryEvidence.push({locale:section.dataset.locale,width:section.dataset.width,scale:section.dataset.scale,scrollTop:scroll.scrollTop,values:section.querySelectorAll('[data-control-layout="value"]').length});
      scroll.scrollTop = 0;
    }
    for (const section of document.querySelectorAll('.fixture-permissions-details')) {
      const bounds = section.getBoundingClientRect();
      const controls = [...section.querySelectorAll('button')];
      const rows = [...section.querySelectorAll('.settings-tool-policy-row')];
      if (!rows.length) failures.push({permissionsMissing:true});
      for (const element of section.querySelectorAll('button, .astryx-text, .astryx-code, .settings-tool-policy-row')) {
        const box = element.getBoundingClientRect();
        if (box.left < bounds.left - 1 || box.right > bounds.right + 1 || element.scrollWidth > element.clientWidth + 1) failures.push({width:section.dataset.width,scale:section.dataset.scale,permissionsOverflow:element.className,text:element.textContent});
      }
      for (const button of controls) {
        const box = button.getBoundingClientRect();
        if (smallTouchTarget(box)) failures.push({width:section.dataset.width,permissionsSmallTarget:button.textContent,height:box.height,widthPx:box.width});
      }
      permissionsEvidence.push({locale:section.dataset.locale,width:section.dataset.width,scale:section.dataset.scale,rows:rows.length,controls:controls.length});
    }
    for (const section of document.querySelectorAll('.fixture-settings-index')) {
      const bounds=section.getBoundingClientRect();
      const rows=[...section.querySelectorAll('.settings-navigation-row')];
      if (rows.length !== 12) failures.push({locale:section.dataset.locale,missingSettings:rows.length});
      for (const element of section.querySelectorAll('.settings-navigation-row, .settings-navigation-row svg, .settings-navigation-row .astryx-text, .settings-index-close')) {
        const box=element.getBoundingClientRect();
        if (box.width <= 0 || box.left < bounds.left - 1 || box.right > bounds.right + 1) failures.push({locale:section.dataset.locale,indexOverflow:element.className.baseVal ?? element.className});
      }
      if (!rows.every(row=>row.querySelector('svg :is(path,line,circle,rect,polygon)'))) failures.push({locale:section.dataset.locale,missingSettingsIcon:true});
      if (section.querySelectorAll('.settings-navigation-status').length !== 6) failures.push({locale:section.dataset.locale,missingSettingsStatus:true});
      const scrollport=section.querySelector('.astryx-layout-content');
      if (!scrollport || getComputedStyle(scrollport).overflowY !== 'auto') failures.push({locale:section.dataset.locale,missingIndexScroll:true});
      else {
        scrollport.scrollTop=scrollport.scrollHeight;
        const last=rows.at(-1).getBoundingClientRect(), port=scrollport.getBoundingClientRect();
        const close=section.querySelector('.settings-index-close').getBoundingClientRect();
        if (last.bottom > port.bottom + 1 || last.top < port.top - 1) failures.push({locale:section.dataset.locale,unreachableLastSetting:true});
        if (close.top < bounds.top - 1 || close.bottom > bounds.bottom + 1) failures.push({locale:section.dataset.locale,unreachableIndexClose:true});
        scrollport.scrollTop=0;
      }
    }
    for (const section of document.querySelectorAll('.fixture-backup-details')) {
      const bounds=section.getBoundingClientRect();
      for (const element of section.querySelectorAll('.astryx-field, .astryx-text, .astryx-selector, input, .astryx-banner, .astryx-button, .astryx-icon-button')) {
        const box=element.getBoundingClientRect();
        if (box.width <= 0 || box.left < bounds.left - 1 || box.right > bounds.right + 1) failures.push({locale:section.dataset.locale,width:section.dataset.width,scale:section.dataset.scale,backupOverflow:element.className,box:{left:box.left,right:box.right},bounds:{left:bounds.left,right:bounds.right}});
      }
      const actions=[...section.querySelectorAll('[data-backup-action]')];
      if (actions.length !== 4) failures.push({width:section.dataset.width,missingBackupActions:actions.length});
      for (const button of section.querySelectorAll('.astryx-button, .astryx-icon-button')) {
        const box=button.getBoundingClientRect();
        if (smallTouchTarget(box)) failures.push({width:section.dataset.width,smallBackupTarget:button.getAttribute('aria-label') ?? button.textContent,widthPx:box.width,heightPx:box.height});
      }
      const secret=section.querySelector('input[type=password]').getBoundingClientRect();
      const peek=section.querySelector('.astryx-input-group button').getBoundingClientRect();
      if (secret.right > peek.left + 1) failures.push({width:section.dataset.width,overlappingPasswordReveal:true});
      for (let i=0;i<actions.length;i++) for(let j=i+1;j<actions.length;j++) {
        const a=actions[i].getBoundingClientRect(), b=actions[j].getBoundingClientRect();
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) failures.push({width:section.dataset.width,overlappingBackupActions:true});
      }
      const columns=getComputedStyle(section.querySelector('.compact-backup-actions')).gridTemplateColumns.split(' ').length;
      if (+section.dataset.width <= 320 && columns !== 1) failures.push({width:section.dataset.width,compressedBackupColumns:columns});
      if (+section.dataset.width === 390 && columns !== 2) failures.push({width:section.dataset.width,missingAdaptiveBackupColumns:columns});
      backupEvidence.push({locale:section.dataset.locale,width:section.dataset.width,scale:section.dataset.scale,actions:actions.length,columns,height:bounds.height});
    }
    for (const section of document.querySelectorAll('.fixture-system-details')) {
      const bounds=section.getBoundingClientRect();
      const values=[...section.querySelectorAll('[data-control-layout="value"]')];
      if (values.length !== 10) failures.push({width:section.dataset.width,missingDetailValues:values.length});
      for (const child of section.querySelectorAll('.settings-row-group .astryx-list > *')) {
        if (child.tagName !== 'LI') failures.push({width:section.dataset.width,invalidListChild:child.tagName});
      }
      for (const element of section.querySelectorAll('.settings-control-row, .astryx-selector, .astryx-text, input')) {
        const box=element.getBoundingClientRect();
        if (box.width <= 0 || box.left < bounds.left - 1 || box.right > bounds.right + 1) failures.push({locale:section.dataset.locale,width:section.dataset.width,scale:section.dataset.scale,detailOverflow:element.className,box:{left:box.left,right:box.right},bounds:{left:bounds.left,right:bounds.right}});
      }
      for (const row of values) {
        const content=row.children[row.children.length-2].getBoundingClientRect();
        const selector=row.querySelector('.astryx-selector').getBoundingClientRect();
        if (content.right > selector.left + 1) failures.push({width:section.dataset.width,scale:section.dataset.scale,overlappingValue:true});
        if (Math.abs((content.top+content.bottom)/2-(selector.top+selector.bottom)/2)>1) failures.push({width:section.dataset.width,scale:section.dataset.scale,stackedValue:true});
        if (selector.height < 44) failures.push({width:section.dataset.width,smallValueTarget:selector.height});
      for (const value of row.querySelectorAll('.astryx-selector .astryx-text')) {
          if (value.scrollWidth > value.clientWidth+1) failures.push({width:section.dataset.width,scale:section.dataset.scale,clippedValue:value.textContent});
        }
        if (row.querySelector('.astryx-selector > button').getBoundingClientRect().height < 44) failures.push({width:section.dataset.width,smallValueButton:true});
      }
      for (const control of section.querySelectorAll('[role="switch"]')) {
        const box=control.getBoundingClientRect();
        if (smallTouchTarget(box)) failures.push({width:section.dataset.width,smallSwitchTarget:{width:box.width,height:box.height,maxWidth:getComputedStyle(control).maxWidth,parentWidth:control.parentElement.getBoundingClientRect().width,parent:control.parentElement.parentElement.className}});
      }
      detailEvidence.push({locale:section.dataset.locale,width:section.dataset.width,scale:section.dataset.scale,values:values.length,height:bounds.height});
    }
    for (const section of document.querySelectorAll('.fixture')) {
      const bounds = section.getBoundingClientRect();
      const elements = [...section.querySelectorAll('.workspace-project-title, .sidebar-history-title, .workspace-disclosure-control, .astryx-more-menu, .settings-control-row, .settings-navigation-row, .settings-navigation-row .astryx-text, .workspace-file-tree-actions .astryx-button')];
      for (const element of elements) {
        const box = element.getBoundingClientRect();
        if (box.width <= 0 || box.left < bounds.left - 1 || box.right > bounds.right + 1) failures.push({width:section.dataset.width,scale:section.dataset.scale,class:element.className,box:{left:box.left,right:box.right},bounds:{left:bounds.left,right:bounds.right}});
      }
      const title = section.querySelector('.workspace-project-title');
      if (title.scrollWidth > title.clientWidth + 1) failures.push({width:section.dataset.width,titleOverflow:true});
      const label = section.querySelector('.workspace-project-title .astryx-side-nav-item > span');
      if (getComputedStyle(label).whiteSpace !== 'nowrap' || label.getBoundingClientRect().height > parseFloat(getComputedStyle(label).lineHeight) + 1) failures.push({width:section.dataset.width,titleWrapped:true});
      for (const sidebarRow of section.querySelectorAll('.workspace-project-row, .chat-history-row')) {
      const buttons = [...sidebarRow.querySelectorAll('button')];
      if (buttons.length < 3) failures.push({width:section.dataset.width,missingControls:buttons.length});
      for (const button of buttons) {
        const box=button.getBoundingClientRect();
        if (smallTouchTarget(box)) failures.push({width:section.dataset.width,smallTouchControl:button.getAttribute('aria-label'),widthPx:box.width,heightPx:box.height});
      }
      for (let index=1; index<buttons.length; index++) {
        const a=buttons[index-1].getBoundingClientRect(), b=buttons[index].getBoundingClientRect();
        if (a.right > b.left + 1) failures.push({width:section.dataset.width,overlappingButtons:index});
      }
      const actions=sidebarRow.querySelector('.sidebar-row-actions');
      const actionButtons=sidebarRow.querySelector('.sidebar-row-action-buttons');
      if (getComputedStyle(actions).opacity !== '1' || getComputedStyle(actionButtons).opacity !== '1') failures.push({width:section.dataset.width,hiddenTouchActions:true});
      if (!sidebarRow.querySelector('[role=img]')) failures.push({width:section.dataset.width,missingRunningIndicator:true});
      }
      const row = section.querySelector('.settings-control-row');
      const control = row.querySelector('[role=switch]').getBoundingClientRect();
      if (control.right > row.getBoundingClientRect().right + 1) failures.push({width:section.dataset.width,switchOverflow:true});
      const grid = section.querySelector('.workspace-file-tree-actions');
      evidence.push({locale:section.dataset.locale,width:section.dataset.width,scale:section.dataset.scale,columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,titleHeight:title.getBoundingClientRect().height,statuses:[...section.querySelectorAll('.settings-navigation-status')].map(element=>element.textContent)});
    }
    document.getElementById('result').textContent = JSON.stringify({failures,evidence,detailEvidence,backupEvidence,permissionsEvidence,memoryEvidence,nativeTimeEvidence,accessEvidence,providerEvidence,viewport:{width:document.documentElement.clientWidth,narrow:matchMedia('(max-width:600px)').matches,touch:matchMedia('(pointer:coarse)').matches}});
  }); });</script>`;
  const temporaryRoot = path.resolve(tmpdir());
  const directory = await mkdtemp(path.join(temporaryRoot, "xgent-astryx-layout-test-"));
  try {
    const file = path.join(directory, "fixture.html");
    await writeFile(file, html);
    const evidenceDirectory = process.env.XGENT_LAYOUT_EVIDENCE_DIR;
    if (evidenceDirectory) {
      await mkdir(evidenceDirectory, { recursive: true });
      await writeFile(path.join(evidenceDirectory, "astryx-layout.html"), html);
    }
    const screenshotKind = process.env.XGENT_LAYOUT_SCREENSHOT ?? (process.env.XGENT_LAYOUT_DETAIL ? "detail" : "layout");
    const screenshotSelectors = { providerEditor: '.fixture-provider-editor[data-locale="en-US"][data-width="320"][data-scale="1"][data-panel="general"]', providerRequest: '.fixture-provider-editor[data-locale="en-US"][data-width="320"][data-scale="1"][data-panel="request"]', providerUsage: '.fixture-provider-editor[data-locale="en-US"][data-width="320"][data-scale="1"][data-panel="usage"]', layout: '.fixture-settings-index[data-locale="en-US"]', detail: '.fixture-system-details[data-locale="en-US"][data-width="320"][data-scale="1"]', backup: '.fixture-backup-details[data-locale="en-US"][data-width="320"][data-scale="1"]', permissions: '.fixture-permissions-details[data-locale="en-US"][data-width="320"][data-scale="1"] .astryx-section', memory: '.fixture-memory-details[data-locale="en-US"][data-width="320"][data-scale="1"]', access: '.fixture-access-details[data-mobile="true"][data-locale="en-US"][data-width="320"][data-scale="1"]', providers: '.fixture-provider-controller[data-locale="en-US"][data-width="320"][data-scale="1"]' };
    assert.ok(screenshotSelectors[screenshotKind], "Use a known source-component screenshot target");
    const viewportResults = [];
    for (const width of [240, 320, 390, 768]) {
      const viewportDirectory = path.join(directory, String(width));
      await mkdir(viewportDirectory);
      const result = JSON.parse(await imageBrowserCompletion(annotationBrowser, pathToFileURL(file).href, viewportDirectory, {
        viewport: { width, height: 844, mobile: width <= 390 },
        interact: async send => {
          await send("DOM.enable"); await send("CSS.enable");
          const root = (await send("DOM.getDocument")).root.nodeId;
          const rows = (await send("DOM.querySelectorAll", { nodeId: root, selector: ".fixture-desktop-sidebar .chat-history-row" })).nodeIds;
          const measure = async () => {
            const response = await send("Runtime.evaluate", { returnByValue: true, expression: `JSON.stringify([...document.querySelectorAll('.fixture-desktop-sidebar .chat-history-row')].map(row => {
              const label=row.querySelector('.astryx-side-nav-item > span'); const box=label.getBoundingClientRect();
              return {width:box.width,height:box.height,rowHeight:row.getBoundingClientRect().height,status:!!row.querySelector('[role=img]'),nowrap:getComputedStyle(label).whiteSpace,actions:getComputedStyle(row.querySelector('.sidebar-row-actions')).opacity};
            }))` });
            return JSON.parse(response.result.value);
          };
          const before = await measure(); assert.equal(before.length, 4);
          for (const nodeId of rows) await send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["hover"] });
          await new Promise(resolve => setTimeout(resolve, 200));
          const hovered = await measure();
          for (let index=0; index<before.length; index++) {
            assert.equal(hovered[index].width, before[index].width, "Hover must reserve title width");
            assert.equal(hovered[index].height, before[index].height, "Hover must not wrap titles");
            assert.equal(hovered[index].rowHeight, before[index].rowHeight);
            assert.equal(hovered[index].nowrap, "nowrap"); assert.equal(hovered[index].status, true);
            assert.equal(hovered[index].actions, "1", "Hover actions must be visible");
          }
          await send("Runtime.evaluate", { expression: `document.querySelector('.fixture-desktop-sidebar button').focus()` });
          for (const nodeId of rows) await send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] });
          const focused = await measure(); assert.equal(focused[0].width, before[0].width);
          const reveal = await send("Runtime.evaluate", { returnByValue: true, expression: `JSON.stringify([...document.querySelectorAll('.fixture-sidebar-reveal')].map(section => {
            const nav=section.querySelector('aside').getBoundingClientRect(), page=section.querySelector('.chat-workspace-main').getBoundingClientRect(), parent=section.getBoundingClientRect();
            return {drawer:nav.width,pageWidth:page.width,offset:page.left-parent.left,viewport:parent.width,modal:!!section.querySelector('dialog')};
          }))` });
          for (const geometry of JSON.parse(reveal.result.value)) {
            assert.ok(Math.abs(geometry.offset-geometry.drawer)<1, "Sidebar must push the page to its own edge");
            assert.equal(geometry.pageWidth, geometry.viewport, "Opening navigation must preserve page width");
            assert.equal(geometry.modal, false);
          }
          if (width === 768) {
            const measureSettings = async () => {
              const response = await send("Runtime.evaluate", { returnByValue: true, expression: `JSON.stringify((() => {
                const box=document.querySelector('.fixture-settings-resize').getBoundingClientRect();
                return {width:box.width,height:box.height,area:box.width*box.height/(innerWidth*innerHeight)};
              })())` }); return JSON.parse(response.result.value);
            };
            const beforeResize = await measureSettings();
            await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, mobile: false, deviceScaleFactor: 1 });
            const afterResize = await measureSettings();
            assert.ok(afterResize.width > beforeResize.width && afterResize.height > beforeResize.height);
            assert.ok(Math.abs(afterResize.area - 0.75) < 0.01, "Settings should occupy approximately 75% of the resized window");
            await send("Emulation.setDeviceMetricsOverride", { width, height: 844, mobile: false, deviceScaleFactor: 1 });
          }
        },
        ...(evidenceDirectory && width === 390 ? { screenshotPath: path.join(evidenceDirectory, `astryx-${screenshotKind}.png`), screenshotSelector: screenshotSelectors[screenshotKind], isolateScreenshot: true } : {}),
      }));
      viewportResults.push(result);
      if (evidenceDirectory) await writeFile(path.join(evidenceDirectory, "astryx-layout.json"), JSON.stringify({ viewportResults }, null, 2));
      assert.deepEqual(result.viewport, { width, narrow: width <= 600, touch: width <= 390 });
      assert.deepEqual(result.failures, [], `Viewport ${width}: ${JSON.stringify(result.failures)}`);
      for (const item of result.evidence) {
        if (+item.width <= 390) assert.ok(item.columns <= 2, "Narrow file actions must wrap instead of forcing four columns");
        assert.ok(item.titleHeight >= 32);
      }
    }
  } finally {
    const relative = path.relative(temporaryRoot, path.resolve(directory));
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Layout fixture escaped its temporary directory");
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
