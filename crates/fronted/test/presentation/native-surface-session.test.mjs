import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

test("settings routes reuse one native sheet and remove it only when the session closes", async () => {
  const published = [];
  let cleanups = [];
  let states = [];
  let cursor = 0;
  const loader = createTsModuleLoader({ mocks: {
    react: {
      useId: () => "local",
      useState(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
        return [states[index], () => {}];
      },
      useRef: (value) => ({ current: value }),
      useLayoutEffect(effect) { cleanups.push(effect()); },
    },
    "../runtime/applePresentation": {
      publishApplePresentation: async (document) => { published.push(document); },
      subscribeApplePresentation: () => () => {},
      acknowledgeApplePresentation: async () => {},
    },
  } });
  const { NativeSurface, removeNativeSurfaceSession, retainNativeSurfaceSession } =
    loader.loadModule("src/presentation/NativeSurface.tsx");
  const mount = (title) => {
    cleanups = [];
    states = [];
    cursor = 0;
    NativeSurface({ sessionSurface: "settings:test", document: {
      mode: "sheet", title, appearance: "system", nodes: [],
    }, handlers: new Map(), onError: (error) => { throw error; } });
    return () => { for (const cleanup of cleanups) cleanup?.(); };
  };
  const leaveHome = mount("Settings");
  leaveHome();
  const leaveSkills = mount("Skills");
  await Promise.resolve();
  assert.deepEqual(published.map(({ surface, revision, title }) => [surface, revision, title]), [
    ["settings:test", 1, "Settings"],
    ["settings:test", 2, "Skills"],
  ]);
  removeNativeSurfaceSession("settings:test", (error) => { throw error; });
  retainNativeSurfaceSession("settings:test");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(published.length, 2, "StrictMode effect replay keeps the sheet mounted");
  leaveSkills();
  removeNativeSurfaceSession("settings:test", (error) => { throw error; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(published.at(-1).removed, true);
  assert.equal(published.at(-1).revision, 3);
});

test("reopening a native tool gets a new surface instead of a stale revision", async () => {
  const published = [];
  let cleanups = [];
  let states = [];
  let cursor = 0;
  const loader = createTsModuleLoader({ mocks: {
    react: {
      useId: () => "same-react-position",
      useState(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
        return [states[index], () => {}];
      },
      useRef: (value) => ({ current: value }),
      useLayoutEffect(effect) { cleanups.push(effect()); },
    },
    "../runtime/applePresentation": {
      publishApplePresentation: async (document) => { published.push(document); },
      subscribeApplePresentation: () => () => {},
      acknowledgeApplePresentation: async () => {},
    },
  } });
  const { NativeSurface } = loader.loadModule("src/presentation/NativeSurface.tsx");
  const mount = () => {
    cleanups = [];
    states = [];
    cursor = 0;
    NativeSurface({ document: {
      mode: "root", title: "Files", appearance: "system", nodes: [],
    }, handlers: new Map(), onError: (error) => { throw error; } });
    return () => { for (const cleanup of cleanups) cleanup?.(); };
  };
  const close = mount();
  close();
  mount();
  await Promise.resolve();
  const roots = published.filter((document) => !document.removed);
  assert.equal(roots.length, 2);
  assert.notEqual(roots[0].surface, roots[1].surface);
});

test("a model detail surface coexists with its retained settings parent and retires independently", async () => {
  const parent = createReactHookHarness(), detail = createReactHookHarness();
  let active = parent, listener;
  const published = [], acknowledgements = [];
  const react = Object.fromEntries(Object.keys(parent.react).map(key => [key, (...args) => active.react[key](...args)]));
  react.useLayoutEffect = (...args) => active.react.useEffect(...args);
  const loader = createTsModuleLoader({ mocks: { react,
    "../runtime/applePresentation": {
      publishApplePresentation: async document => { published.push(document); },
      subscribeApplePresentation: callback => { listener = callback; return () => {}; },
      acknowledgeApplePresentation: async result => { acknowledgements.push(result); },
    },
  } });
  const { NativeSurface, removeNativeSurfaceSession } = loader.loadModule("src/presentation/NativeSurface.tsx");
  const child = { type: "model-detail", props: {} };
  const props = { sessionSurface: "settings:parent", document: { mode: "sheet", title: "Provider", appearance: "light", nodes: [] },
    handlers: new Map(), onError(error) { throw error; }, children: child };
  let saves = 0;
  const detailProps = { document: { mode: "sheet", title: "Model", appearance: "light", nodes: [
    { id: "save", kind: "Button", label: "Save", action: "save" },
  ] }, handlers: new Map([["save", { enabled: true, accepts: value => value === null, run: () => { saves++; } }]]), onError: props.onError };
  try {
    assert.equal(parent.render(() => NativeSurface(props)), child);
    active = detail;
    assert.equal(detail.render(() => NativeSurface(detailProps)), null);
    await new Promise(resolve => setTimeout(resolve, 0));
    const sheets = published.filter(document => document.mode === "sheet");
    assert.equal(sheets.length, 2);
    assert.equal(sheets[0].surface, "settings:parent");
    assert.notEqual(sheets[1].surface, sheets[0].surface);
    listener({ surface: sheets[1].surface, action: "save", value: null, requestId: "live-save" });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(saves, 1);
    detail.unmount();
    active = parent; props.children = null;
    assert.equal(parent.render(() => NativeSurface(props)), null);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(published.filter(document => document.removed).length, 1);
    assert.equal(published.find(document => document.removed).surface, sheets[1].surface);
    listener({ surface: sheets[1].surface, action: "save", value: null, requestId: "retired-save" });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(saves, 1);
    assert.equal(acknowledgements.at(-1).ok, false);
  } finally {
    detail.unmount(); parent.unmount();
    removeNativeSurfaceSession("settings:parent", props.onError);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
});
