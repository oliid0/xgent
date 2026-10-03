import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("desktop appearance changes persist through shared reducers, reject invalid controls and update native theme", async () => {
  const loader = createTsModuleLoader();
  const { getDefaultSettings } = loader.loadModule("src/lib/settings/index.ts");
  const { normalizeAppearance } = loader.loadModule("src/lib/settings/appearance.ts");
  const { createNativeDesktopAppearance } = loader.loadModule("src/presentation/nativeDesktopAppearance.ts");
  const { createNativePresentationTheme } = loader.loadModule("src/presentation/nativeTheme.ts");
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const registry = createPresentationActionRegistry();
  let settings = getDefaultSettings();
  let controls;
  let request = 0;
  const render = () => {
    controls = createNativeDesktopAppearance({ settings, setSettings: update => settings = update(settings) }, key => key);
    registry.register("appearance", controls.handlers);
  };
  const dispatch = async (action, value = null) => {
    const result = await registry.dispatch({ surface: "appearance", action, value, requestId: String(++request) });
    render();
    return result;
  };
  render();
  assert.equal(controls.nodes[0].children.find(node => node.id === "thinking").text, "settings.ui.showThinkingDesc");
  assert.equal(controls.nodes[0].children.find(node => node.id === "appearance-customized").text, "settings.ui.customizeDesc");
  assert.equal(controls.nodes[0].children.some(node => node.kind === "ColorInput"), false);
  await dispatch("appearance-preset", "matcha");
  await dispatch("appearance-customized", true);
  assert.equal(controls.nodes[0].children.filter(node => node.kind === "ColorInput").length, 4);
  assert.equal(controls.nodes[0].children.find(node => node.id === "appearance-color:accentLight").accessibilityHint, "settings.ui.colorFormat");
  const before = structuredClone(settings);
  assert.equal((await dispatch("appearance-color:accentLight", "red")).ok, false);
  assert.equal((await dispatch("appearance-radius", "999")).ok, false);
  assert.equal((await dispatch("font-scale:chat", "5")).ok, false);
  assert.equal((await dispatch("close-window-behavior", "unknown")).ok, false);
  assert.deepEqual(settings, before);
  for (const [key, value] of [["accentLight", "#ABCDEF"], ["accentDark", "#123456"], ["sidebarLight", "#DDDDEE"], ["sidebarDark", "#151515"]]) {
    assert.equal((await dispatch(`appearance-color:${key}`, value)).ok, true);
    assert.equal(settings.customSettings.appearance[key], value.toLowerCase());
  }
  await dispatch("thinking", true);
  await dispatch("appearance-radius", "24");
  await dispatch("font-scale:sidebar", "0.9");
  await dispatch("font-scale:chat", "1.2");
  await dispatch("font-scale:workspaceTools", "1.1");
  await dispatch("close-window-behavior", "exit");
  const theme = createNativePresentationTheme(settings, false, "chat");
  assert.equal(theme.fontScale, 1.2);
  assert.equal(theme.light.accent, "#abcdef");
  assert.equal(theme.dark.accent, "#123456");
  assert.equal(settings.customSettings.appearance.radius, 24);
  assert.equal(settings.customSettings.appearance.showThinking, true);
  assert.equal(settings.closeWindowBehavior, "exit");
  await dispatch("appearance-reset");
  assert.deepEqual(settings.customSettings.appearance, { ...normalizeAppearance({}), preset: "matcha" });
  assert.deepEqual(settings.customSettings.fontScale, { sidebar: 0.9, chat: 1.2, workspaceTools: 1.1 });
  assert.equal(controls.nodes[0].children.some(node => node.kind === "ColorInput"), false);
  assert.equal((await dispatch("appearance-color:accentLight", "#eeeeee")).ok, false, "retired controls cannot change a preset");
});

test("custom accents override inherited preset input tokens in both compact and desktop themes", () => {
  const loader = createTsModuleLoader();
  const { getDefaultSettings } = loader.loadModule("src/lib/settings/index.ts");
  const { createAppearanceTheme } = loader.loadModule("src/theme/appearanceTheme.ts");
  const { createNativePresentationTheme } = loader.loadModule("src/presentation/nativeTheme.ts");
  for (const preset of ["current", "stone", "matcha"]) {
    for (const compact of [true, false]) {
      const settings = getDefaultSettings();
      Object.assign(settings.customSettings.appearance, {
        preset, customized: true, accentLight: "#abcdef", accentDark: "#123456",
        sidebarLight: "#ddeeff", sidebarDark: "#151515",
      });
      const theme = createAppearanceTheme(settings.customSettings.appearance, compact);
      assert.deepEqual(theme.__inputTokens["--color-accent"], ["#abcdef", "#123456"]);
      const native = createNativePresentationTheme(settings, compact);
      assert.equal(native.light.accent, "#abcdef");
      assert.equal(native.dark.accent, "#123456");
      assert.equal(native.light.background, "#ddeeff");
      assert.equal(native.dark.background, "#151515");
    }
  }
});
