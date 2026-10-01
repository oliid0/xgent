import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function elements(node) {
  if (!node || typeof node !== "object") return [];
  return [node, ...[node.props?.children].flat(2).flatMap(elements)];
}
function harness(options = {}) {
  const hooks = createReactHookHarness(), copies = [], launches = [];
  let stateUpdates = 0;
  class Component {
    constructor(props) { this.props = props; }
    setState(next) { this.state = { ...this.state, ...next }; }
  }
  const loader = createTsModuleLoader({ mocks: {
    react: { ...hooks.react, Component, useState(initial) {
      const [value, set] = hooks.react.useState(initial);
      return [value, next => { stateUpdates++; set(next); }];
    } },
    "../i18n": { useLocale: () => ({ t: key => key }) },
    "../presentation/NativeSurface": { NativeSurface: "NativeSurface" },
    "../lib/runtimePlatform": { isNativeMobileRuntime: () => options.mobile !== false },
    "../runtime/applePresentation": { isApplePresentationRuntime: () => options.native !== false },
    "../lib/system/launchScreen": { finishLaunch: value => launches.push(value) },
    "../lib/system/clipboardText": { writeClipboardText: async text => {
      copies.push(text); return options.copy ? options.copy(text) : true;
    } },
    ...Object.fromEntries(["Banner", "Button", "Center", "Text"].map(name => [`@astryxdesign/core/${name}`, { [name]: name }])),
    "@astryxdesign/core/Layout": { VStack: "VStack" },
  } });
  const { AppErrorFallback } = loader.loadModule("src/components/AppErrorFallback.tsx");
  const { AppErrorBoundary } = loader.loadModule("src/components/AppErrorBoundary.tsx");
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  const registry = createPresentationActionRegistry();
  const error = new Error("Unable to render provider settings"), stack = "\n at ProviderSettings\n at App";
  let closed = 0, request = 0, root;
  const render = () => {
    root = hooks.render(() => AppErrorFallback({ error, componentStack: stack, mode: options.mode,
      appearance: "dark", nativeMobile: options.mobile, onClose: options.close ? () => closed++ : undefined }));
    if (options.native !== false) {
      validatePresentationDocument({ ...root.props.document, version: 1, surface: "error", revision: 1 }, root.props.handlers);
      registry.register("error", root.props.handlers);
    }
    return root;
  };
  const send = async action => {
    if (options.native !== false) return registry.dispatch({ surface: "error", action: `error:${action}`, value: null, requestId: String(++request) });
    const key = { reload: "app.errorBoundaryReload", copy: "app.errorBoundaryCopy", details: "app.errorBoundaryDetails", close: "settings.close" }[action];
    const button = elements(root).find(node => node.type === "Button" && node.props.label === key);
    assert.ok(button); return button.props.onClick();
  };
  const messages = () => options.native !== false ? root.props.document.nodes[0].children.map(node => node.text).filter(Boolean)
    : elements(root).filter(node => node.type === "Text").map(node => node.props.children);
  return { render, send, messages, copies, launches, error, stack, AppErrorBoundary, unmount: () => hooks.unmount(), get closed() { return closed; }, get stateUpdates() { return stateUpdates; } };
}

test("Apple errors publish native root/sheet recovery with real details and no DOM fallback", async () => {
  for (const mobile of [true, false]) for (const mode of ["root", "sheet"]) {
    const h = harness({ mobile, mode, close: mode === "sheet" }); const root = h.render();
    assert.equal(root.type, "NativeSurface"); assert.equal(root.props.document.mode, mode);
    assert.equal(root.props.document.formFactor, mobile ? "mobile" : "desktop");
    assert.equal(root.props.document.appearance, "dark");
    assert.equal(root.props.document.dismissAction, mode === "sheet" ? "error:close" : undefined);
    assert.ok(!root.props.document.nodes[0].children.some(node => node.kind === "CodeBlock"));
    await h.send("details"); const open = h.render();
    assert.equal(open.props.document.nodes[0].children.find(node => node.kind === "CodeBlock").text, `${h.error.stack}\n${h.stack}`);
    await h.send("details"); assert.ok(!h.render().props.document.nodes[0].children.some(node => node.kind === "CodeBlock"));
    h.unmount();
  }
});

test("all frontends copy full diagnostics and truthfully recover from false results and exceptions", async () => {
  for (const native of [true, false]) {
    const results = [false, new Error("clipboard denied"), true];
    const h = harness({ native, copy: async () => { const result = results.shift(); if (result instanceof Error) throw result; return result; } });
    h.render();
    for (const expected of ["app.errorBoundaryCopyFailed", "app.errorBoundaryCopyFailed", "app.errorBoundaryCopied"]) {
      await h.send("copy"); await new Promise(resolve => setImmediate(resolve)); h.render();
      assert.ok(h.messages().includes(expected));
    }
    assert.deepEqual(h.copies, Array(3).fill(`${h.error.stack}\n${h.stack}`)); h.unmount();
  }
});

test("duplicate copy requests are locked before rendering and late completions cannot change a retired page", async () => {
  for (const retire of ["close", "unmount"]) {
    const answer = deferred(), h = harness({ close: true, mode: "sheet", copy: () => answer.promise }); h.render();
    const pending = h.send("copy"); await Promise.resolve(); await Promise.resolve();
    await h.send("copy"); assert.equal(h.copies.length, 1);
    assert.equal(h.render().props.handlers.get("error:copy").enabled, false);
    if (retire === "close") { await h.send("close"); await h.send("close"); assert.equal(h.closed, 1); }
    else h.unmount();
    const updates = h.stateUpdates;
    answer.resolve(true); await pending;
    assert.equal(h.stateUpdates, updates, "no state updates after closing/unmounting recovery");
    assert.ok(!h.messages().includes("app.errorBoundaryCopied"));
    if (retire === "close") { await h.send("copy"); assert.equal(h.copies.length, 1); h.unmount(); }
  }
});

test("reload invokes actual location reload on every frontend and close retires native recovery", async () => {
  const previous = globalThis.window; let reloads = 0;
  globalThis.window = { location: { reload: () => reloads++ } };
  try {
    for (const native of [true, false]) {
      const h = harness({ native, close: true }); h.render(); await h.send("reload");
      await h.send("close"); await h.send("reload"); h.unmount();
    }
    assert.equal(reloads, 2);
  } finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
});

test("error boundary preserves healthy children and recovery options and releases launch screen on failure", () => {
  const h = harness(); const close = () => {}, children = { healthy: true };
  const boundary = new h.AppErrorBoundary({ children, mode: "sheet", onClose: close, appearance: "dark", nativeMobile: true });
  assert.equal(boundary.render(), children);
  boundary.setState(h.AppErrorBoundary.getDerivedStateFromError(h.error));
  const previous = console.error; console.error = () => {};
  try { boundary.componentDidCatch(h.error, { componentStack: h.stack }); } finally { console.error = previous; }
  const recovery = boundary.render();
  assert.equal(recovery.props.error, h.error); assert.equal(recovery.props.componentStack, h.stack);
  assert.equal(recovery.props.mode, "sheet"); assert.equal(recovery.props.onClose, close);
  assert.equal(recovery.props.appearance, "dark"); assert.equal(recovery.props.nativeMobile, true);
  assert.deepEqual(h.launches, [false]); h.unmount();
});
