import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function harness(apple = true) {
  const hooks = createReactHookHarness();
  const loader = createTsModuleLoader({ mocks: {
    react: hooks.react,
    "../i18n": { t: key => key },
    "../presentation/nativeTheme": { createNativePresentationTheme: () => undefined },
    "../presentation/NativeSurface": { NativeSurface: "NativeSurface" },
    "../runtime/applePresentation": { isApplePresentationRuntime: () => apple },
    "@astryxdesign/core/Banner": { Banner: "Banner" },
    "@astryxdesign/core/Button": { Button: "Button" },
    "@astryxdesign/core/Stack": { StackItem: "StackItem", VStack: "VStack" },
  } });
  const components = loader.loadModule("src/components/AppStartupSurface.tsx");
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  const registry = createPresentationActionRegistry(); let request = 0;
  const props = { settings: { locale: "en-US", theme: "dark" }, nativeMobile: true, failures: [] };
  return { components, props, render(name, patch = {}) {
    const view = hooks.render(() => components[name]({ ...props, ...patch }));
    if (view?.type === "NativeSurface") {
      validatePresentationDocument({ ...view.props.document, version: 1, revision: 1, surface: "startup" }, view.props.handlers);
      registry.register("startup", view.props.handlers);
    }
    return view;
  }, unmount: () => hooks.unmount(),
  send: () => registry.dispatch({ surface: "startup", action: "startup:reload", value: null, requestId: String(++request) }) };
}

test("Apple pending startup publishes an opaque native root without editable fallback settings", () => {
  for (const nativeMobile of [false, true]) {
    const h = harness(); const view = h.render("AppStartupSurface", { nativeMobile });
    assert.equal(view.type, "NativeSurface"); assert.equal(view.props.document.mode, "root");
    assert.equal(view.props.document.formFactor, nativeMobile ? "mobile" : "desktop");
    assert.equal(view.props.document.appearance, "dark"); assert.deepEqual(view.props.document.nodes, []); h.unmount();
  }
  const web = harness(false); assert.equal(web.render("AppStartupSurface"), null); web.unmount();
});

test("native startup failures and persistent service warnings expose real reload and retain diagnostic text", async () => {
  const previous = globalThis.window; let reloads = 0;
  globalThis.window = { location: { reload: () => reloads++ } };
  try {
    for (const name of ["AppStartupSurface", "MobileStartupWarning"]) {
      const h = harness(), view = h.render(name, { failures: ["History database unavailable", "Shell is still starting"] });
      const document = view.props.document;
      assert.equal(document.mode, name === "AppStartupSurface" ? "root" : "status");
      assert.equal(document.nodes[0].text, "History database unavailable · Shell is still starting");
      const before = reloads; await h.send(); assert.equal(reloads, before + 1);
      h.unmount(); await h.send(); assert.equal(reloads, before + 1);
    }
    const h = harness(); const view = h.render("AppStartupSurface", { settingsFailure: "Cannot read settings", startupFailure: "Core service failed" });
    assert.equal(view.props.document.nodes[0].label, "Cannot read settings"); assert.equal(view.props.document.nodes[0].text, "Core service failed"); h.unmount();
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});

test("startup warnings clear on recovery and Astryx receives identical diagnostic and action state", () => {
  const native = harness(); assert.equal(native.render("MobileStartupWarning", { failures: ["Unavailable"] }).type, "NativeSurface");
  assert.equal(native.render("MobileStartupWarning"), null); native.unmount();
  const web = harness(false), view = web.render("MobileStartupWarning", { failures: ["Unavailable", "Retrying"] });
  assert.equal(view.type, "Banner"); assert.equal(view.props.status, "warning");
  assert.equal(view.props.description, "Unavailable · Retrying"); assert.equal(view.props.endContent.type, "Button"); web.unmount();
});

test("Apple conversation state stays outside web layout wrappers while the other platforms preserve the same tree", () => {
  for (const apple of [true, false]) {
    const h = harness(apple), child = { type: "ChatPage", props: {} };
    const view = h.render("AppConversationSurface", { children: child, failures: ["Storage failed"] });
    if (apple) assert.equal(view.props.children[1], child);
    else { assert.equal(view.type, "VStack"); assert.equal(view.props.children[1].type, "StackItem"); assert.equal(view.props.children[1].props.children, child); }
    assert.equal(view.props.children[0].type, h.components.MobileStartupWarning); h.unmount();
  }
});

test("startup status documents reject lost controls, invalid modes and multiple discarded banners", () => {
  const h = harness(), view = h.render("MobileStartupWarning", { failures: ["Retrying"] });
  const loader = createTsModuleLoader(), { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  const document = { ...view.props.document, version: 1, revision: 1, surface: "startup" };
  for (const nodes of [[], [{ ...document.nodes[0], children: [] }], [...document.nodes, { id: "lost", kind: "Text" }]]) {
    assert.throws(() => validatePresentationDocument({ ...document, nodes }, view.props.handlers), /service status/);
  }
  assert.throws(() => validatePresentationDocument(document, new Map()), /Missing native action/); h.unmount();
});

test("boot failure recovery runs without React, acknowledges actual reload only once and retires stale actions", async () => {
  const loader = createTsModuleLoader(), { createNativeLaunchRecovery } = loader.loadModule("src/presentation/nativeLaunchRecovery.ts");
  const documents = [], results = []; let receive, reloads = 0, disposed = 0;
  const recovery = createNativeLaunchRecovery({ publish: async document => { documents.push(document); },
    subscribe: handler => { receive = handler; return () => disposed++; }, acknowledge: async result => { results.push(result); },
    nativeMobile: true, reload: () => reloads++ });
  await recovery.show(new Error("Unable to import the chat controller"));
  assert.equal(documents[0].nodes[0].text, "Unable to import the chat controller"); assert.equal(documents[0].formFactor, "mobile");
  const action = { surface: documents[0].surface, action: "launch:reload", requestId: "reload-1", value: null };
  receive(action); receive(action); await flush(); assert.equal(reloads, 1); assert.ok(results.every(result => result.ok));
  receive({ ...action, requestId: "invalid", value: true }); await flush(); assert.equal(results.at(-1).ok, false); assert.equal(reloads, 1);
  receive({ ...action, surface: "chat", requestId: "unrelated" }); await flush(); assert.equal(reloads, 1);
  await recovery.show("x".repeat(12000)); assert.equal(documents.at(-1).nodes[0].text.length, 8000);
  recovery.dispose(); recovery.dispose(); await flush(); assert.equal(disposed, 1); assert.equal(documents.at(-1).removed, true);
  const count = documents.length; receive({ ...action, requestId: "late" }); await recovery.show("Retired"); await flush();
  assert.equal(reloads, 1); assert.equal(documents.length, count);
});
