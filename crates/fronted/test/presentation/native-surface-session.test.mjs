import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

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
