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
import { annotationBrowser } from "../helpers/document-annotation-browser.mjs";
import { imageBrowserCompletion } from "../helpers/image-browser-completion.mjs";

const vendor = {};
vendor["@astryxdesign/core/theme"] = await import("@astryxdesign/core/theme");
vendor["@astryxdesign/theme-neutral"] = await import("@astryxdesign/theme-neutral");
for (const module of ["AlertDialog", "Badge", "Banner", "BottomSheet", "Button", "ButtonGroup", "Code", "CodeBlock", "Collapsible", "ComplexSelector", "Dialog", "Divider", "EmptyState", "FormLayout", "Grid", "Icon", "IconButton", "InputGroup", "Layout", "List", "MobileNav", "MoreMenu", "Section", "Selector", "SideNav", "Spinner", "Stack", "StatusDot", "Switch", "Text", "TextInput", "TimeInput", "Token", "TreeList"]) {
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
const { ProjectRow, HistoryRow } = loader.loadModule("src/components/chat/ChatHistorySidebar.tsx");
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
  for (const locale of ["en-US", "zh-CN"]) {
    sections.push(React.createElement(Locale.Provider, { value: locale }, React.createElement("section", {
      className: "fixture-settings-index", style: { width: 320, height: 900 }, "data-locale": locale,
    }, React.createElement(SettingsPage, { settings, setSettings: noop, saveState: { status: "saved" }, onBack: noop, nativeMobile: true, appUpdate: { result: { currentVersion: "1.0.0" } } }))));
  }
  for (const locale of ["en-US", "zh-CN"]) for (const width of [240, 320, 390, 768]) for (const scale of [1, 1.5]) {
    const t = key => translations[locale][key] ?? key;
    const project = { id: "long", name: "Workspace with a very long multilingual title 工作空间文件夹", path: "/long" };
    const customizedSettings = { ...settings, locale: "en-US", customSettings: { ...settings.customSettings,
      interfaceFontFamily: "Example Custom Interface Font",
      appearance: { ...settings.customSettings.appearance, customized: true },
    } };
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
  const html = `<!doctype html><html data-theme="light" data-astryx-theme="${xgentCompactTheme.name}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${reset}\n${vendorCss}\n@layer reset {${themeCss.prose}}\n@layer astryx-theme {${themeCss.component}}\n${css}
  :root { --spacing-1:4px; --spacing-2:8px; --size-element-sm:32px; --size-element-md:40px; --size-element-lg:44px; }
  body { margin:0; } .fixture, .fixture-settings-index, .fixture-system-details, .fixture-backup-details, .fixture-permissions-details, .fixture-memory-details { margin:16px; border:1px solid black; }
  #result { display:none; } .fixture .settings-control-row { font-size:inherit; }
  .workspace-project-row, .chat-history-row { display:grid; min-width:0; grid-template-columns:minmax(0,1fr) auto; }
  @layer utilities { .opacity-0 {opacity:0;} .max-w-16 {max-width:64px;} }
  .workspace-project-row .astryx-more-menu { flex-shrink:0; }
  .fixture * { box-sizing:border-box; } .fixture .astryx-text { font-size:inherit; }
  .fixture-system-details .astryx-text[data-type="body"] { font-size:calc(var(--text-body-size) * var(--zone-font-scale)); }
  .fixture-system-details .astryx-text[data-type="supporting"] { font-size:calc(var(--text-supporting-size) * var(--zone-font-scale)); }
  </style>${renderToStaticMarkup(React.createElement(Theme, { theme: xgentCompactTheme, mode: "light" }, ...sections))}<pre id="result"></pre><script>
  addEventListener('error', event => { document.getElementById('result').textContent=JSON.stringify({failures:[{scriptError:event.message}],evidence:[],detailEvidence:[]}); });
  addEventListener('load', () => { requestAnimationFrame(() => {
    const failures = []; const evidence = []; const detailEvidence = []; const backupEvidence = []; const permissionsEvidence = []; const memoryEvidence = []; const nativeTimeEvidence = [];
    for (const section of document.querySelectorAll('.fixture-native-memory-time')) {
      const input = section.querySelector('input[type="time"]');
      if (!input) failures.push({width:section.dataset.width,missingNativeTime:true});
      const opener = section.querySelector('.astryx-time-input button');
      if (input && opener && opener.getBoundingClientRect().right > input.getBoundingClientRect().left + 1) failures.push({width:section.dataset.width,nativeTimeOverlap:true});
      const visibleValue = input?.nextElementSibling;
      if (visibleValue && visibleValue.scrollWidth > visibleValue.clientWidth + 1) failures.push({width:section.dataset.width,scale:section.dataset.scale,nativeTimeClipped:true});
      for (const control of section.querySelectorAll('input[type="time"],button')) {
        const box = control.getBoundingClientRect(), bounds = section.getBoundingClientRect();
        if (box.width < 44 || box.height < 44 || box.left < bounds.left - 1 || box.right > bounds.right + 1) failures.push({width:section.dataset.width,nativeTimeBounds:{height:box.height,width:box.width,left:box.left,right:box.right},bounds:{left:bounds.left,right:bounds.right},tag:control.tagName});
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
        if (box.width < 44 || box.height < 44) failures.push({width:section.dataset.width,memorySmallControl:element.getAttribute('aria-label') ?? element.textContent,height:box.height,widthPx:box.width});
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
        if (box.width < 44 || box.height < 44) failures.push({width:section.dataset.width,permissionsSmallTarget:button.textContent,height:box.height,widthPx:box.width});
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
        if (box.width < 44 || box.height < 44) failures.push({width:section.dataset.width,smallBackupTarget:button.getAttribute('aria-label') ?? button.textContent,widthPx:box.width,heightPx:box.height});
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
        if (box.width < 44 || box.height < 44) failures.push({width:section.dataset.width,smallSwitchTarget:{width:box.width,height:box.height,maxWidth:getComputedStyle(control).maxWidth,parentWidth:control.parentElement.getBoundingClientRect().width,parent:control.parentElement.parentElement.className}});
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
      if (getComputedStyle(label).whiteSpace === 'nowrap') failures.push({width:section.dataset.width,titleClipped:true});
      for (const sidebarRow of section.querySelectorAll('.workspace-project-row, .chat-history-row')) {
      const buttons = [...sidebarRow.querySelectorAll('button')];
      if (buttons.length < 3) failures.push({width:section.dataset.width,missingControls:buttons.length});
      for (const button of buttons) {
        const box=button.getBoundingClientRect();
        if (box.width < 44 || box.height < 44) failures.push({width:section.dataset.width,smallTouchControl:button.getAttribute('aria-label'),widthPx:box.width,heightPx:box.height});
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
    document.getElementById('result').textContent = JSON.stringify({failures,evidence,detailEvidence,backupEvidence,permissionsEvidence,memoryEvidence,nativeTimeEvidence,viewport:{width:document.documentElement.clientWidth,narrow:matchMedia('(max-width:600px)').matches,touch:matchMedia('(pointer:coarse)').matches}});
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
    const screenshotSelectors = { layout: '.fixture-settings-index[data-locale="en-US"]', detail: '.fixture-system-details[data-locale="en-US"][data-width="320"][data-scale="1"]', backup: '.fixture-backup-details[data-locale="en-US"][data-width="320"][data-scale="1"]', permissions: '.fixture-permissions-details[data-locale="en-US"][data-width="320"][data-scale="1"] .astryx-section', memory: '.fixture-memory-details[data-locale="en-US"][data-width="320"][data-scale="1"]' };
    assert.ok(screenshotSelectors[screenshotKind], "Use a known source-component screenshot target");
    const viewportResults = [];
    for (const width of [240, 320, 390, 768]) {
      const viewportDirectory = path.join(directory, String(width));
      await mkdir(viewportDirectory);
      const result = JSON.parse(await imageBrowserCompletion(annotationBrowser, pathToFileURL(file).href, viewportDirectory, {
        viewport: { width, height: 844, mobile: width <= 390 },
        ...(evidenceDirectory && width === 390 ? { screenshotPath: path.join(evidenceDirectory, `astryx-${screenshotKind}.png`), screenshotSelector: screenshotSelectors[screenshotKind] } : {}),
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
