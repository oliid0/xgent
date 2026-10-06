import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function loader(access) {
  const mocks = {
    react: { useMemo: make => make() },
    "../../i18n": { useLocale: () => ({ t: key => key }) },
    "./shared": { SettingsRow: "SettingsRow", SettingsRowGroup: "SettingsRowGroup" },
    "./useMobileAssistantAccess": { useMobileAssistantAccess: () => access },
  };
  for (const [module, names] of Object.entries({
    Banner: ["Banner"], IconButton: ["IconButton"], Layout: ["HStack", "StackItem", "VStack"],
    List: ["List", "ListItem"], Section: ["Section"], Selector: ["Selector"], Spinner: ["Spinner"],
    StatusDot: ["StatusDot"], Text: ["Heading", "Text"], Switch: ["Switch"],
  })) mocks[`@astryxdesign/core/${module}`] = Object.fromEntries(names.map(name => [name, name]));
  return createTsModuleLoader({ mocks });
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree?.props) return [];
  if (tree.type?.name === "PermissionStateBadge") return nodes(tree.type(tree.props));
  return [tree, ...["children", "endContent", "startContent"].flatMap(key => nodes(tree.props[key]))];
}

test("mobile permission and platform service state has visible text in addition to color and accessible labels", () => {
  const l = loader({ status: { permissionAliases: { microphone: "record", camera: "camera" }, cloudSyncAvailable: true },
    permissions: { microphone: "granted", camera: "denied" }, busy: "", error: "", refresh() {}, request() {},
  });
  const { MobileAssistantSection } = l.loadModule("src/pages/settings/MobileAssistantSection.tsx");
  const settings = l.loadModule("src/lib/settings/index.ts").getDefaultSettings();
  const rendered = nodes(MobileAssistantSection({ settings, setSettings() {} }));
  const visibleText = rendered.filter(node => node.type === "Text").map(node => node.props.children);
  for (const state of ["granted", "denied", "available", "unavailable"]) {
    assert.ok(visibleText.includes(`settings.mobileAssistant.${state}`), `${state} is actually visible`);
  }
  const microphone = rendered.find(node => node.type === "ListItem" && node.props.label === "settings.mobileAssistant.microphone");
  assert.equal(microphone.props.isDisabled, true, "granted permission cannot prompt again");
});

test("voice recognition state remains visible and a failed discovery does not keep claiming to check", () => {
  for (const [status, error, label] of [
    [undefined, "", "speechChecking"], [undefined, "Native service failed", "speechUnavailable"],
    [{ voiceInputAvailable: true, detail: "Unrelated HealthKit capability overview" }, "", "speechAvailable"],
    [{ voiceInputAvailable: false }, "", "speechUnavailable"],
  ]) {
    const l = loader({ status, permissions: {}, busy: "", error, refresh() {} });
    const { MobileVoiceSettingsSection } = l.loadModule("src/pages/settings/MobileVoiceSettingsSection.tsx");
    const settings = l.loadModule("src/lib/settings/index.ts").getDefaultSettings();
    const rendered = nodes(MobileVoiceSettingsSection({ settings, setSettings() {}, onOpenPermissions() {} }));
    assert.ok(rendered.some(node => node.type === "SettingsRow" && node.props.label === `settings.native.${label}`));
    assert.equal(rendered.find(node => node.type === "Switch").props.label, "settings.navVoice");
    assert.ok(!rendered.some(node => node.props.children === status?.detail && status?.detail));
    if (error) assert.ok(rendered.some(node => node.type === "Banner" && node.props.title === error));
  }
});
