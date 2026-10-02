import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function harness(mobile = false) {
  const writes = [];
  const loader = createTsModuleLoader({ mocks: {
    "@xgent/runtime": {
      isTauriRuntime: () => true,
      invoke: async (command, args) => {
        assert.equal(command, "settings_save_system");
        writes.push(structuredClone(args.payload));
      },
    },
    "../runtimePlatform": { isNativeMobileRuntime: () => mobile },
    "../backup": { markBackupDirty: async () => {} },
  } });
  const { createNativeToolPermissions } = loader.loadModule("src/presentation/nativeToolPermissions.ts");
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const { getDefaultSettings, updateSystem } = loader.loadModule("src/lib/settings/index.ts");
  const { persistSettings } = loader.loadModule("src/lib/settings/storage.ts");
  const catalog = loader.loadModule("src/lib/tools/builtinToolCatalog.ts");
  const { t } = loader.loadModule("src/i18n/config.ts");
  let settings = updateSystem(getDefaultSettings(), {
    toolPolicies: { "personal:clipboard": "deny", "personal:contacts": "ask", Bash: "ask", ExtraTool: "deny" },
  });
  let controls;
  let request = 0;
  const registry = createPresentationActionRegistry();
  const flatten = (nodes) => nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
  const render = () => {
    controls = createNativeToolPermissions({ settings, setSettings: (update) => settings = update(settings) }, mobile, (key) => t(key, "zh-CN"));
    registry.register("tool-permissions", controls.handlers);
  };
  render();
  return {
    ...catalog,
    writes,
    settings: () => settings,
    nodes: () => flatten(controls.nodes),
    node: (id) => flatten(controls.nodes).find((node) => node.id === id),
    async dispatch(action, value = null) {
      const result = await registry.dispatch({ surface: "tool-permissions", action, value, requestId: String(++request) });
      render();
      return result;
    },
    persist: (previous) => persistSettings(previous, settings),
  };
}

test("native tool policies cover the desktop catalog, real safety modes, and category actions without changing personal grants", async () => {
  const h = harness();
  const initial = h.settings();
  const selectors = h.nodes().filter((node) => node.id.startsWith("policy:") && node.kind === "Selector");
  assert.deepEqual(selectors.map((node) => node.id).sort(), h.BUILTIN_TOOL_CATALOG.map((tool) => `policy:${tool.toolName}`).sort());
  assert.equal(new Set(h.nodes().map((node) => node.id)).size, h.nodes().length);
  assert.deepEqual(h.node("command-safety-mode").options.map((option) => option.value), ["auto", "ask", "sandbox", "sandboxOffline"]);
  assert.equal((await h.dispatch("command-safety-mode", "unrestricted")).ok, false);
  assert.equal((await h.dispatch("policy:Bash", "run")).ok, false);
  assert.equal(h.settings(), initial);
  for (const mode of ["ask", "sandbox", "sandboxOffline", "auto"]) {
    assert.equal((await h.dispatch("command-safety-mode", mode)).ok, true);
    assert.equal(h.settings().system.commandSafetyMode, mode);
  }
  for (const category of h.BUILTIN_TOOL_CATEGORIES) {
    const tools = h.BUILTIN_TOOL_CATALOG.filter((tool) => tool.categoryId === category.id);
    for (const policy of ["deny", "ask", "allow"]) {
      const previous = { ...h.settings().system.toolPolicies };
      assert.equal((await h.dispatch(`category:${category.id}:${policy}`)).ok, true);
      for (const tool of tools) assert.equal(h.settings().system.toolPolicies[tool.toolName], policy);
      for (const [name, value] of Object.entries(previous)) {
        if (!tools.some((tool) => tool.toolName === name)) assert.equal(h.settings().system.toolPolicies[name], value);
      }
    }
  }
  await h.persist(initial);
  assert.deepEqual(h.writes[0].toolPolicies, h.settings().system.toolPolicies);
  const beforeReset = h.settings();
  assert.equal((await h.dispatch("tool-policy-reset")).ok, true);
  assert.deepEqual(h.settings().system.toolPolicies, { "personal:clipboard": "deny", "personal:contacts": "ask" });
  assert.equal(h.node("tool-policy-reset"), undefined);
  assert.equal((await h.dispatch("tool-policy-reset")).ok, false, "removed controls retire their handlers");
  assert.equal(h.node("policy:Bash").value, "allow");
  await h.persist(beforeReset);
  assert.deepEqual(h.writes[1].toolPolicies, h.settings().system.toolPolicies);
});

test("native mobile bulk policies exclude unsupported process controls and retain localized descriptions", async () => {
  const h = harness(true);
  assert.equal(h.node("command-safety-mode"), undefined);
  assert.equal(h.node("policy:ManagedProcess"), undefined);
  assert.equal(h.node("policy:ReadTerminal"), undefined);
  assert.equal((await h.dispatch("command-safety-mode", "sandbox")).ok, false);
  assert.equal((await h.dispatch("category:process:deny")).ok, true);
  assert.equal(h.settings().system.toolPolicies.Bash, "deny");
  assert.equal(h.settings().system.toolPolicies.ManagedProcess, undefined);
  assert.equal(h.settings().system.toolPolicies.ReadTerminal, undefined);
  assert.equal(h.settings().system.toolPolicies["personal:clipboard"], "deny");
  for (const selector of h.nodes().filter((node) => node.id.startsWith("policy:") && node.kind === "Selector")) {
    assert.ok(!selector.label.startsWith("settings."));
    const description = h.node(`${selector.id}:description`);
    assert.ok(description.text && !description.text.startsWith("settings."));
    assert.deepEqual(selector.options.map((option) => option.value), ["allow", "ask", "deny"]);
  }
});
