import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function harness(nativeMobile) {
  const mocks = {
    "../../i18n": { useLocale: () => ({ t: (key) => key }) },
    "../../lib/runtimePlatform": { isNativeMobileRuntime: () => nativeMobile },
    "../../components/icons": { Shield: "Shield" },
    "./shared": { SettingsRow: "SettingsRow", SettingsRowGroup: "SettingsRowGroup" },
  };
  for (const [module, names] of Object.entries({
    Button: ["Button"], ButtonGroup: ["ButtonGroup"], CodeBlock: ["Code"], Grid: ["Grid"],
    Icon: ["Icon"], Layout: ["HStack", "StackItem", "VStack"], List: ["List", "ListItem"],
    Section: ["Section"], Selector: ["Selector"], Text: ["Heading", "Text"],
  })) mocks[`@astryxdesign/core/${module}`] = Object.fromEntries(names.map((name) => [name, name]));
  const loader = createTsModuleLoader({ mocks });
  const { ToolPermissionsSection } = loader.loadModule("src/pages/settings/ToolPermissionsSection.tsx");
  let settings = { system: { toolPolicies: { Write: "deny", ManagedProcess: "ask" }, commandSafetyMode: "sandbox" } };
  const render = () => {
    const nodes = [];
    function visit(value) {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (!value || typeof value !== "object" || !value.props) return;
      nodes.push(value);
      visit(value.props.children);
      visit(value.props.endContent);
    }
    visit(ToolPermissionsSection({ settings, setSettings: (update) => { settings = update(settings); } }));
    return nodes;
  };
  return { render, settings: () => settings };
}

test("mobile permissions omit desktop controls while policy edits preserve hidden preferences", () => {
  const h = harness(true);
  let nodes = h.render();
  const labels = nodes.map((node) => node.props.label);
  assert.equal(labels.includes("settings.commandSafety.title"), false);
  assert.equal(labels.includes("ManagedProcess"), false);
  assert.equal(labels.includes("ReadTerminal"), false);
  const write = nodes.find((node) => node.type === "Selector" && node.props.label === "Write");
  assert.equal(write.props.value, "deny");
  write.props.onChange("ask");
  nodes = h.render();
  assert.equal(nodes.find((node) => node.type === "Selector" && node.props.label === write.props.label).props.value, "ask");
  assert.equal(h.settings().system.toolPolicies.ManagedProcess, "ask");
  assert.equal(h.settings().system.commandSafetyMode, "sandbox");
});

test("desktop permissions retain supported command safety and terminal policies", () => {
  const nodes = harness(false).render();
  const safety = nodes.find((node) => node.type === "Selector" && node.props.label === "settings.commandSafety.title");
  assert.deepEqual(safety.props.options.map((option) => option.value), ["auto", "ask", "sandbox", "sandboxOffline"]);
  assert.ok(nodes.some((node) => node.props.label === "ReadTerminal"));
});
