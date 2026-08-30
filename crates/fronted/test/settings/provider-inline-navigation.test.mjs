import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const providersSource = await readFile(
  new URL("../../src/pages/settings/ProvidersSection.tsx", import.meta.url),
  "utf8",
);
const secretTextInputSource = await readFile(
  new URL("../../src/pages/settings/SecretTextInput.tsx", import.meta.url),
  "utf8",
);
const settingsPageSource = await readFile(
  new URL("../../src/pages/SettingsPage.tsx", import.meta.url),
  "utf8",
);
const nestedSettingsShellSource = await readFile(
  new URL("../../src/pages/settings/SettingsModalShell.tsx", import.meta.url),
  "utf8",
);
const hooksSource = await readFile(
  new URL("../../src/pages/settings/HooksSection.tsx", import.meta.url),
  "utf8",
);
const cronSource = await readFile(
  new URL("../../src/pages/settings/CronSection.tsx", import.meta.url),
  "utf8",
);
const sshSource = await readFile(
  new URL("../../src/pages/settings/SshSettingsSection.tsx", import.meta.url),
  "utf8",
);
const cherryImportSource = await readFile(
  new URL("../../src/pages/settings/CherryStudioImportModal.tsx", import.meta.url),
  "utf8",
);

test("provider editor and advanced settings drill into the existing settings content", () => {
  assert.match(providersSource, /type ProviderSettingsView = "list" \| "editor" \| "advanced"/);
  assert.match(providersSource, /view === "editor"[\s\S]*?<ProviderEditor/);
  assert.match(providersSource, /view === "advanced"[\s\S]*?<ProviderAdvancedSettingsPanel/);
  assert.doesNotMatch(
    providersSource.slice(
      providersSource.indexOf("function ProviderEditor"),
      providersSource.indexOf("function ProviderAdvancedSettingsPanel"),
    ),
    /<Dialog\b/,
  );
  assert.doesNotMatch(
    providersSource.slice(
      providersSource.indexOf("function ProviderAdvancedSettingsPanel"),
      providersSource.indexOf("function ccsImportIdentity"),
    ),
    /<Dialog\b/,
  );
});

test("provider API key uses the shared Astryx secret-field composition", () => {
  assert.match(providersSource, /<SecretTextInput\s+label=\{/);
  assert.match(secretTextInputSource, /<InputGroup[\s\S]*?<TextInput[\s\S]*?<IconButton/);
  assert.match(secretTextInputSource, /type=\{visible \? "text" : "password"\}/);
  assert.match(secretTextInputSource, /label=\{visibilityLabel\}/);
});

test("settings navigation is flat and hides removed project, skill, and MCP entries", () => {
  const navigationDefinitions = settingsPageSource.slice(
    settingsPageSource.indexOf("const NAV_ITEMS"),
    settingsPageSource.indexOf("function normalizeSettingsSection"),
  );
  assert.doesNotMatch(navigationDefinitions, /labelKey|settings\.group/);
  assert.doesNotMatch(navigationDefinitions, /id: "(?:projectRoots|skills|mcp)"/);
});

test("nested settings workflows render as content layers instead of nested dialogs", () => {
  assert.doesNotMatch(nestedSettingsShellSource, /<Dialog\b|\bDialog\s*[,}]/);
  assert.match(hooksSource, /if \(modalOpen\)[\s\S]*?<HookModal/);
  assert.match(cronSource, /if \(detail\.open\)[\s\S]*?<CronTaskModal/);
  assert.match(sshSource, /if \(modalOpen\)[\s\S]*?<SshHostModal/);
  assert.match(sshSource, /if \(importOpen\)[\s\S]*?<SshImportModal/);
});

test("third-party provider imports stay reachable when automatic discovery finds nothing", () => {
  assert.match(providersSource, /id: "cc-switch"[\s\S]*?isDisabled: ccsLoading \|\| thirdPartyImporting/);
  assert.match(providersSource, /id: "cherry-studio"[\s\S]*?isDisabled: cherryLoading \|\| cherryImporting/);
  assert.match(
    providersSource,
    /thirdPartyImportEnabled && cherryImportType\)[\s\S]*?cherryProviders \?\? \{/,
  );
  assert.match(cherryImportSource, /未发现可同步的 Cherry Studio 供应商/);
  assert.match(cherryImportSource, /label="选择数据目录"/);
  assert.doesNotMatch(cherryImportSource, /<Dialog\b|AdaptiveDialog/);
});

test("third-party import screens use responsive Astryx rows and native actions", () => {
  const ccsImportSource = providersSource.slice(
    providersSource.indexOf("function CcsProviderRow"),
    providersSource.indexOf("function ProviderList"),
  );
  assert.match(ccsImportSource, /const isCompact = useMediaQuery/);
  assert.match(ccsImportSource, /<ListItem[\s\S]*?interactiveRef={checkboxRef}/);
  assert.match(ccsImportSource, /<TabList/);
  assert.match(ccsImportSource, /<AstryxNativeButton/);
  assert.doesNotMatch(ccsImportSource, /<AstryxButton\b|<Button\b|Loader2/);

  assert.match(cherryImportSource, /const isCompact = useMediaQuery/);
  assert.match(cherryImportSource, /<ListItem[\s\S]*?interactiveRef={checkboxRef}/);
  assert.match(cherryImportSource, /<TabList/);
  assert.doesNotMatch(cherryImportSource, /AstryxView|className=/);
});

test("Cherry Studio import completes before background model discovery", () => {
  const importSource = providersSource.slice(
    providersSource.indexOf("function importCherryProviders"),
    providersSource.indexOf("function openAdd"),
  );
  assert.match(importSource, /Saving the provider configuration is the completion boundary/);
  assert.match(importSource, /setCherryImportType\(null\)/);
  assert.match(importSource, /setCherryImporting\(false\)/);
  assert.match(importSource, /void syncCherryModelsInBackground/);
});
