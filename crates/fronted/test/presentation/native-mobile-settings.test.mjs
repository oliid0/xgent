import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader({ mocks: {
  react: { useState: () => [null, () => {}] },
  "../i18n": {
    SUPPORTED_LOCALES: ["system", "zh-CN", "en-US"],
    useLocale: () => ({ t: (key) => key }),
  },
  "./NativeSurface": { NativeSurface: "NativeSurface" },
} });
const { NativeMobileSystemSettings } = loader.loadModule("src/presentation/NativeMobileSystemSettings.tsx");
const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");

test("native system controls update shared settings and reject unsupported values", async () => {
  let settings = { locale: "system", theme: "dark", system: { executionMode: "tools" } };
  let closed = false;
  const render = (saveState) => NativeMobileSystemSettings({
    settings, setSettings: (update) => { settings = update(settings); },
    onBack: () => { closed = true; }, saveState,
  });
  const registry = createPresentationActionRegistry();
  registry.register("settings", render().props.handlers);
  let requestId = 0;
  const dispatch = (action, value) => registry.dispatch({ surface: "settings", action, value, requestId: String(++requestId) });
  for (const [action, value] of [["locale", "xx-XX"], ["execution-mode", "sandbox"], ["locale", null]]) {
    assert.equal((await dispatch(action, value)).ok, false);
  }
  assert.equal((await dispatch("locale", "zh-CN")).ok, true);
  assert.equal((await dispatch("execution-mode", "text")).ok, true);
  assert.equal(settings.locale, "zh-CN");
  assert.equal(settings.system.executionMode, "text");
  assert.equal(settings.theme, "dark", "desktop theme preference is preserved");
  const document = render({ status: "error", message: "Disk full" }).props.document;
  assert.equal(document.appearance, "system");
  assert.match(document.nodes.find((node) => node.id === "save-status").text, /Disk full/);
  assert.equal(document.nodes.find((node) => node.id === "locale").value, "zh-CN");
  assert.equal(document.nodes.find((node) => node.id === "execution-mode").value, "text");
  assert.equal((await dispatch(document.dismissAction, null)).ok, true);
  assert.equal(closed, true);
});
