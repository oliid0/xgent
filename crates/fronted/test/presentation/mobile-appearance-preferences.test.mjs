import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("Android appearance exposes all font zones, commits custom names and preserves unrelated preferences", () => {
  const states = [];
  let cursor = 0;
  const loader = createTsModuleLoader({ mocks: {
    react: { useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], next => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
    } },
    "@astryxdesign/core/Layout": { VStack: "VStack" },
    "@astryxdesign/core/Selector": { Selector: "Selector" },
    "@astryxdesign/core/TextInput": { TextInput: "TextInput" },
    "../../i18n": { useLocale: () => ({ t: key => key }) },
    "./AppearanceSettingsSection": { AppearanceSettingsSection: "AppearanceSettingsSection" },
    "./shared": { SettingsRow: "SettingsRow", SettingsRowGroup: "SettingsRowGroup" },
  } });
  const { MobileAppearanceSettings } = loader.loadModule("src/pages/settings/MobileAppearanceSettings.tsx");
  const { getDefaultSettings } = loader.loadModule("src/lib/settings/index.ts");
  let settings = getDefaultSettings();
  let elements;
  function flatten(node) {
    if (Array.isArray(node)) return node.flatMap(flatten);
    if (!node || typeof node !== "object") return [];
    return [node, ...flatten(node.props?.children)];
  }
  function render() {
    cursor = 0;
    elements = flatten(MobileAppearanceSettings({ settings, setSettings: update => settings = update(settings) }));
  }
  const select = label => elements.find(node => node.type === "Selector" && node.props.label === label);
  const custom = () => elements.find(node => node.type === "TextInput");
  render();
  assert.ok(elements.some(node => node.type === "AppearanceSettingsSection"));
  for (const label of ["settings.interfaceFontFamily", "settings.chatFontFamily", "settings.codeFontFamily",
    "settings.fontSizeSidebar", "settings.fontSizeChat", "settings.fontSizeWorkspaceTools"]) {
    assert.ok(select(label), label);
  }
  select("settings.chatFontFamily").props.onChange("__custom__");
  render();
  custom().props.onChange("bad; url(secret)");
  render();
  custom().props.onBlur();
  render();
  assert.equal(settings.customSettings.chatFontFamily, "");
  assert.equal(custom().props.status.type, "error");
  custom().props.onChange("  苹方 简体 , SF Pro Text  ");
  render();
  custom().props.onEnter();
  render();
  assert.equal(settings.customSettings.chatFontFamily, "苹方 简体 , SF Pro Text");
  assert.equal(custom().props.status, undefined);
  select("settings.codeFontFamily").props.onChange("Menlo");
  select("settings.fontSizeChat").props.onChange("1.2");
  render();
  assert.equal(settings.customSettings.codeFontFamily, "Menlo");
  assert.equal(settings.customSettings.fontScale.chat, 1.2);
  assert.equal(settings.customSettings.fontScale.sidebar, 1);
  assert.equal(settings.customSettings.interfaceFontFamily, "");
  assert.equal(settings.theme, "system");
  select("settings.chatFontFamily").props.onChange("__default__");
  render();
  assert.equal(settings.customSettings.chatFontFamily, "");
  assert.equal(custom(), undefined);
});
