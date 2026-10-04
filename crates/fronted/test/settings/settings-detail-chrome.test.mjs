import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

function harness() {
  const hooks = createReactHookHarness();
  const settings = createTsModuleLoader().loadModule("src/lib/settings/index.ts").getDefaultSettings();
  const mocks = {
    react: hooks.react,
    "../i18n": { useLocale: () => ({ t: key => key }) },
    "../lib/responsive/compactViewport": { useCompactViewport: () => true },
    "../lib/useMobileBackNavigation": { useMobileBackNavigation: () => ({ current: null }) },
    "./settings/SettingsModalShell": { SettingsDetailLayerProvider: "SettingsDetailLayerProvider" },
    "./settings/shared": { SettingsRow: "SettingsRow", SettingsRowGroup: "SettingsRowGroup" },
    "./settings/SettingsDetailHeader": { SettingsDetailHeader: "SettingsDetailHeader" },
  };
  for (const name of ["AboutSection", "AccessSection", "BackupSyncSection", "ComputerUseSection",
    "GlobalShortcutsSection", "MobileAssistantSection", "MobileExecutionSection", "OtherSettingsSection",
    "ProjectRootsSection", "ProviderSettingsSection", "SoulSection", "SttSettingsSection",
    "SystemSettingsForm", "ToolPermissionsSection"]) mocks[`./settings/${name}`] = { [name]: name };
  mocks["./settings/memory/MemoryPanel"] = { MemoryPanel: "MemoryPanel" };
  for (const [module, names] of Object.entries({
    Layout: ["HStack", "Layout", "LayoutContent", "LayoutHeader", "LayoutPanel", "StackItem", "VStack"],
    Icon: ["Icon"], IconButton: ["IconButton"], EmptyState: ["EmptyState"], List: ["List", "ListItem"],
    Section: ["Section"], Selector: ["Selector"], StatusDot: ["StatusDot"], Text: ["Heading", "Text"], TextInput: ["TextInput"],
  })) mocks[`@astryxdesign/core/${module}`] = Object.fromEntries(names.map(name => [name, name]));
  const { SettingsPage } = createTsModuleLoader({ mocks }).loadModule("src/pages/SettingsPage.tsx");
  const props = { settings, setSettings() {}, saveState: { status: "saved" }, onBack() {}, nativeMobile: true, appUpdate: {} };
  const render = () => hooks.render(() => SettingsPage(props));
  function walk(type, node) {
    if (Array.isArray(node)) return node.map(child => walk(type, child)).find(Boolean);
    if (node?.type === type || node?.type?.name === type) return node;
    if (!node?.props) return;
    for (const key of ["children", "header", "content", "titleEndContent", "startContent", "endContent"] ) {
      const result = walk(type, node.props[key]); if (result) return result;
    }
  }
  return { props, render, find: type => walk(type, render()) };
}

test("compact settings hide successful saves and preserve actual error feedback on index and detail", () => {
  const h = harness();
  let status = h.find("SaveStatus");
  assert.equal(status.type(status.props), null);
  h.props.saveState = { status: "error", message: "Disk is read-only" };
  status = h.find("SaveStatus");
  const feedback = status.type(status.props);
  assert.equal(feedback.props.role, "status");
  assert.equal(feedback.props["aria-live"], "assertive");
  assert.equal(feedback.props.children[1].props.children, "Disk is read-only");
  h.props.initialSection = "toolPermissions";
  const header = h.find("SettingsDetailHeader");
  assert.equal(header.props.title, "settings.navToolPermissions");
  assert.equal(header.props.endContent, undefined);
  assert.equal(header.props.startContent.props.size, "lg");
  header.props.startContent.props.onClick();
  assert.equal(h.find("SettingsDetailHeader"), undefined);
  assert.ok(h.find("SettingsRowGroup"));
});
