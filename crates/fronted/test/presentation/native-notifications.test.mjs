import assert from "node:assert/strict";
import test from "node:test";
import { Children, createElement, isValidElement } from "react";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function clock() {
  let now = 0, sequence = 0;
  const jobs = new Map();
  return { now: () => now,
    set(run, delay) { const id = ++sequence; jobs.set(id, { run, due: now + delay }); return id; },
    clear(id) { jobs.delete(id); },
    advance(by) { now += by; for (const [id, job] of [...jobs]) if (job.due <= now && jobs.delete(id)) job.run(); },
    get pending() { return jobs.size; },
  };
}
function setup() {
  const loader = createTsModuleLoader();
  const { createAppNotificationStore } = loader.loadModule("src/components/astryx/appNotifications.ts");
  const { createNotificationLifetime } = loader.loadModule("src/components/astryx/notificationLifetime.ts");
  let id = 0;
  return { store: createAppNotificationStore(() => `toast-${++id}`), createNotificationLifetime };
}

test("native notification store matches Astryx overwrite/ignore and notifies dismiss exactly once", () => {
  const { store } = setup(), hidden = [], changed = [];
  const unsubscribe = store.subscribe(() => changed.push(store.getSnapshot().length));
  const first = store.show({ body: "First", uniqueID: "operation", onHide: reason => hidden.push(`old:${reason}`) });
  const ignored = store.show({ body: "Ignored", uniqueID: "operation", collisionBehavior: "ignore" });
  ignored(); assert.equal(store.getSnapshot()[0].options.body, "First");
  const replaced = store.show({ body: "Latest", uniqueID: "operation", onHide: reason => hidden.push(reason) });
  first(); assert.equal(store.getSnapshot()[0].options.body, "Latest"); assert.deepEqual(hidden, []);
  replaced(); replaced(); assert.deepEqual(hidden, ["manual"]);
  assert.deepEqual(changed, [1, 1, 0]); unsubscribe();
  store.show({ body: "After unsubscribing" }); assert.equal(changed.length, 3);
});

test("notification dismissal retires state before reentrant callbacks and preserves snapshot identity", () => {
  const { store } = setup(); const initial = store.getSnapshot(); assert.equal(store.getSnapshot(), initial);
  const dismiss = store.show({ body: "Current", onHide: () => { dismiss(); store.show({ body: "Next" }); } });
  dismiss(); assert.deepEqual(store.getSnapshot().map(item => item.options.body), ["Next"]);
});

test("notification lifetime pauses remaining time, expires once and ignores retired callbacks", () => {
  const { createNotificationLifetime } = setup(), timer = clock(); let expires = 0;
  const lifetime = createNotificationLifetime(5000, () => expires++, timer);
  timer.advance(2000); lifetime.pause(true); lifetime.pause(true);
  timer.advance(10000); assert.equal(expires, 0);
  lifetime.pause(false); timer.advance(2999); assert.equal(expires, 0);
  timer.advance(1); assert.equal(expires, 1); lifetime.pause(false); timer.advance(10000); assert.equal(expires, 1);
  const retired = createNotificationLifetime(1000, () => expires++, timer); retired.retire(); timer.advance(1000);
  assert.equal(expires, 1); assert.equal(timer.pending, 0);
});

function nativeHarness(options = {}) {
  const { store, createNotificationLifetime } = setup(), hooks = createReactHookHarness(), timer = clock();
  const loader = createTsModuleLoader({ mocks: {
    react: { ...hooks.react, Children, isValidElement, useSyncExternalStore: (_subscribe, read) => read() },
    "../components/astryx/appNotifications": { appNotifications: store },
    "../components/astryx/notificationLifetime": { createNotificationLifetime: (duration, expire) => createNotificationLifetime(duration, expire, timer) },
    "../i18n": { useLocale: () => ({ t: key => key }) },
    "./nativeTheme": { createNativePresentationTheme: () => undefined },
    "./NativeSurface": { NativeSurface: "NativeSurface" },
    "../runtime/applePresentation": { isApplePresentationRuntime: () => options.apple !== false },
  } });
  const { NativeNotificationViewport } = loader.loadModule("src/presentation/NativeNotificationViewport.tsx");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const registry = createPresentationActionRegistry(); let request = 0;
  const viewport = () => NativeNotificationViewport({ settings: { theme: "dark" }, nativeMobile: true });
  const render = () => {
    const component = viewport()?.props.children.at(-1); if (!component) return null;
    const surface = hooks.render(() => component.type(component.props)).props;
    validatePresentationDocument({ ...surface.document, surface: component.key, version: 1, revision: 1 }, surface.handlers);
    registry.register("toast", surface.handlers); return surface;
  };
  return { store, timer, viewport, render, unmount: () => hooks.unmount(),
    send: (action, value = null) => registry.dispatch({ surface: "toast", action: `notification:${action}`, value, requestId: String(++request) }) };
}

test("native notification documents preserve text/theme, pause for reading and auto-dismiss actual state", async () => {
  const h = nativeHarness(), hidden = [];
  h.store.show({ body: createElement("VStack", null, createElement("Text", null, "Saved"), createElement("Text", null, "Workspace backup is ready")), onHide: reason => hidden.push(reason) });
  const surface = h.render(); assert.equal(surface.document.mode, "toast"); assert.equal(surface.document.appearance, "dark");
  assert.equal(surface.document.nodes[0].text, "Saved\nWorkspace backup is ready");
  h.timer.advance(1000); await h.send("reading", true); h.timer.advance(10000);
  assert.equal(h.store.getSnapshot().length, 1);
  await h.send("reading", false); h.timer.advance(4000);
  assert.deepEqual(hidden, ["auto"]); assert.equal(h.store.getSnapshot().length, 0); h.unmount();
});

test("errors persist, close callbacks run once, and replaced/unmounted expiry never dismisses a newer notification", async () => {
  const h = nativeHarness(), hidden = [];
  h.store.show({ body: "Could not copy path", type: "error", onHide: reason => hidden.push(reason) }); h.render();
  h.timer.advance(60000); assert.equal(h.store.getSnapshot().length, 1);
  await h.send("dismiss"); await h.send("dismiss"); assert.deepEqual(hidden, ["manual"]); h.unmount();
  const next = nativeHarness(); next.store.show({ body: "Old", uniqueID: "copy" }); next.render();
  next.timer.advance(4000); next.store.show({ body: "New", uniqueID: "copy" }); next.render();
  next.timer.advance(1000); assert.equal(next.store.getSnapshot()[0].options.body, "New");
  next.unmount(); next.timer.advance(10000); assert.equal(next.store.getSnapshot().length, 1);
});

test("native viewport limits visible notifications while queued messages and browser presentation remain intact", () => {
  const h = nativeHarness(); for (let index = 0; index < 7; index++) h.store.show({ body: `Message ${index}`, type: "error" });
  assert.deepEqual(h.viewport().props.children.map(item => item.props.entry.options.body), ["Message 3", "Message 4", "Message 5", "Message 6"]);
  assert.equal(h.store.getSnapshot().length, 7); h.unmount();
  const web = nativeHarness({ apple: false }); web.store.show({ body: "Unused native state" }); assert.equal(web.viewport(), null); web.unmount();
});

test("notification protocol rejects lost content and missing or misplaced read handlers", () => {
  const h = nativeHarness(); h.store.show({ body: "Ready" }); const surface = h.render();
  const loader = createTsModuleLoader(), { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  const document = { ...surface.document, version: 1, surface: "toast", revision: 1 };
  for (const invalid of [
    { ...document, readingAction: undefined },
    { ...document, mode: "sheet" },
    { ...document, nodes: [...document.nodes, { id: "lost", kind: "Text", text: "Must not disappear" }] },
    { ...document, nodes: [{ ...document.nodes[0], children: [] }] },
  ]) assert.throws(() => validatePresentationDocument(invalid, surface.handlers), /notification/);
  const handlers = new Map(surface.handlers); handlers.delete("notification:reading");
  assert.throws(() => validatePresentationDocument(document, handlers), /notification/); h.unmount();
});

test("chat notifications survive ordinary rerenders, use the latest callback and replay safely", () => {
  const { store } = setup(), hooks = createReactHookHarness(), dismissed = [];
  const loader = createTsModuleLoader({ mocks: {
    react: { ...hooks.react, memo: component => component },
    "../astryx/useAppToast": { useAppToast: () => store.show },
  } });
  const { NotifyToast } = loader.loadModule("src/components/chat/NotifyToast.tsx");
  const item = { id: "chat-error", type: "error", message: "Provider authentication failed" };
  let props = { items: [item], onDismiss: id => dismissed.push(`old:${id}`) };
  const render = () => hooks.render(() => NotifyToast(props));
  render(); const firstID = store.getSnapshot()[0].id;
  props = { items: [item], onDismiss: id => dismissed.push(`current:${id}`) }; render();
  assert.equal(store.getSnapshot()[0].id, firstID); assert.deepEqual(dismissed, []);
  hooks.replayEffects(); assert.equal(store.getSnapshot().length, 1); assert.deepEqual(dismissed, []);
  store.dismiss(store.getSnapshot()[0].id); assert.deepEqual(dismissed, ["current:chat-error"]);
  props = { ...props, items: [{ ...item, id: "second" }] }; render();
  hooks.unmount(); assert.equal(store.getSnapshot().length, 0); assert.deepEqual(dismissed, ["current:chat-error"]);
});

test("the notification adapter sends the same options to native state or Astryx and preserves dismissal", () => {
  for (const apple of [true, false]) {
    const { store } = setup(), hooks = createReactHookHarness(), web = [], hidden = [];
    const webShow = options => { web.push(options); return () => options.onHide?.("manual"); };
    const loader = createTsModuleLoader({ mocks: {
      react: hooks.react,
      "@astryxdesign/core/Toast": { useToast: () => webShow },
      "../../runtime/applePresentation": { isApplePresentationRuntime: () => apple },
      "./appNotifications": { appNotifications: store },
    } });
    const { useAppToast } = loader.loadModule("src/components/astryx/useAppToast.ts");
    const show = hooks.render(useAppToast), options = { body: "Copied path", type: "info", autoHideDuration: 4200, uniqueID: "copy", onHide: reason => hidden.push(reason) };
    const dismiss = show(options); assert.equal(hooks.render(useAppToast), show);
    assert.equal(apple ? store.getSnapshot()[0].options : web[0], options);
    assert.equal(web.length, apple ? 0 : 1); dismiss(); assert.deepEqual(hidden, ["manual"]); hooks.unmount();
  }
});
