import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const elements = value => {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(elements);
  return [value, ...elements(value.props?.children), ...elements(value.props?.endContent)];
};

test("Astryx and native policy handlers preserve rapid consecutive edits and personal grants from the same document", async () => {
  const loader = createTsModuleLoader({ mocks: {
    "../../i18n": { useLocale: () => ({ t: key => key }) },
    "../../lib/runtimePlatform": { isNativeMobileRuntime: () => false },
    "./shared": { SettingsRow: "SettingsRow", SettingsRowGroup: "SettingsRowGroup" },
  } });
  const { ToolPermissionsSection } = loader.loadModule("src/pages/settings/ToolPermissionsSection.tsx");
  const { createNativeToolPermissions } = loader.loadModule("src/presentation/nativeToolPermissions.ts");
  const { getDefaultSettings, updateSystem } = loader.loadModule("src/lib/settings/index.ts");
  for (const native of [false, true]) {
    let settings = updateSystem(getDefaultSettings(), { toolPolicies: {
      "personal:clipboard": "ask", Read: "deny", ExternalTool: "ask",
    } });
    const props = { settings, setSettings: update => settings = update(settings) };
    if (native) {
      const document = createNativeToolPermissions(props, false, key => key);
      document.handlers.get("policy:Bash").run("deny");
      document.handlers.get("policy:Write").run("ask");
    } else {
      const tree = elements(ToolPermissionsSection(props));
      const control = name => tree.find(item => item.props?.label === name && item.props?.options?.length === 3);
      // Both handlers still reference the same old document; settings are current.
      control("Bash").props.onChange("deny");
      control("Write").props.onChange("ask");
    }
    assert.equal(settings.system.toolPolicies.Bash, "deny");
    assert.equal(settings.system.toolPolicies.Write, "ask");
    assert.equal(settings.system.toolPolicies.Read, "deny");
    assert.equal(settings.system.toolPolicies.ExternalTool, "ask");
    assert.equal(settings.system.toolPolicies["personal:clipboard"], "ask");
  }
});
