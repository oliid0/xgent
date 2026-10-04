import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { setNativeSettingsChrome, withNativeSettingsChrome } = loader.loadModule("src/presentation/nativeSettingsChrome.ts");
const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");

test("desktop settings subpages keep navigation and actions on the same sheet", async () => {
  const calls = [];
  const action = (name) => ({ enabled: true, accepts: (value) => value === null, run: () => calls.push(name) });
  const sidebar = { id: "settings-sidebar", kind: "VStack", children: [
    { id: "settings-navigation", kind: "List", children: [{ id: "desktop-nav:memory", kind: "NavigationRow", label: "Memory", action: "memory" }] },
    { id: "settings-close", kind: "IconButton", label: "Close", icon: "xmark", action: "settings-close" },
  ] };
  setNativeSettingsChrome("settings:test", { sidebar,
    saveStatus: { id: "save-status", kind: "Text", text: "Saved" },
    handlers: new Map([["memory", action("memory")], ["settings-close", action("dismiss")]]),
  });
  const document = { mode: "sheet", formFactor: "desktop", title: "Provider options", appearance: "system",
    dismissAction: "close", nodes: [
      { id: "back", kind: "Button", label: "Back", action: "close" },
      { id: "options", kind: "SettingsGroup", children: [{ id: "temperature", kind: "NumberInput", label: "Temperature", value: 0.7, minimum: 0, maximum: 2, step: 0.1, action: "temperature" }] },
    ],
  };
  const sectionHandlers = new Map([["close", action("back")], ["temperature", {
    enabled: true, accepts: (value) => typeof value === "number", run: (value) => calls.push(value),
  }]]);
  const prepared = withNativeSettingsChrome("settings:test", document, sectionHandlers);
  validatePresentationDocument({ ...prepared.document, version: 1, surface: "settings:test", revision: 1 }, prepared.handlers);
  assert.equal(prepared.document.dismissAction, "settings-close");
  assert.equal(prepared.document.nodes[0].kind, "SettingsLayout");
  assert.equal(prepared.document.nodes[0].children[0].children[0].children[0].label, "Memory");
  assert.deepEqual(prepared.document.nodes[0].children[1].children.map((node) => node.id), ["settings-detail-title", "save-status", "back", "options"]);
  const registry = createPresentationActionRegistry();
  registry.register("settings:test", prepared.handlers);
  for (const [index, [action, value]] of [["memory", null], ["temperature", 1.2], ["close", null], ["settings-close", null]].entries()) {
    assert.equal((await registry.dispatch({ surface: "settings:test", action, value, requestId: String(index) })).ok, true);
  }
  assert.deepEqual(calls, ["memory", 1.2, "back", "dismiss"]);
  const busy = withNativeSettingsChrome("settings:test", { ...document, dismissAction: undefined }, sectionHandlers);
  assert.equal(busy.document.dismissAction, undefined);
  assert.equal(busy.handlers.get("settings-close").enabled, false);
  assert.equal(busy.document.nodes[0].children[0].children[1].disabled, true);

  for (const unchanged of [
    { ...document, formFactor: "mobile" },
    { ...document, mode: "alert" },
    { ...document, nodes: [{ id: "existing", kind: "SettingsLayout", children: [] }] },
  ]) assert.equal(withNativeSettingsChrome("settings:test", unchanged, sectionHandlers).document, unchanged);
  setNativeSettingsChrome("settings:test");
  assert.equal(withNativeSettingsChrome("settings:test", document, sectionHandlers).document, document);
});

test("provider detail closes through its actual scoped shell action", async () => {
  const { presentationControls } = loader.loadModule("src/presentation/controls.ts");
  const c = presentationControls(JSON.stringify(["provider", "example", "codex", "api-key"]));
  let closed = 0;
  const close = { ...c.action("settings-close", "Close", () => closed++), kind: "IconButton", icon: "xmark" };
  const surface = "settings:scoped-provider";
  setNativeSettingsChrome(surface, {
    sidebar: { id: "settings-sidebar", kind: "VStack", children: [close] },
    saveStatus: { id: "save-status", kind: "Text", text: "Saved", secondary: true },
    handlers: c.handlers,
  });
  try {
    const prepared = withNativeSettingsChrome(surface, {
      mode: "sheet", formFactor: "desktop", title: "Provider request settings", appearance: "system",
      dismissAction: "back", nodes: [],
    }, new Map());
    validatePresentationDocument({ ...prepared.document, version: 1, surface, revision: 1 }, prepared.handlers);
    assert.equal(prepared.document.dismissAction, close.action);
    const registry = createPresentationActionRegistry();
    registry.register(surface, prepared.handlers);
    assert.equal((await registry.dispatch({ surface, action: prepared.document.dismissAction, value: null, requestId: "close" })).ok, true);
    assert.equal(closed, 1);
  } finally { setNativeSettingsChrome(surface); }
});
