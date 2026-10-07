import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

test("browser chrome consumes expansion once, restores fullscreen and retires its keyboard handler", () => {
  const hooks = createReactHookHarness(), keys = new Map(), shortcuts = [], changes = [];
  const previousWindow = globalThis.window;
  globalThis.window = { addEventListener: (key, callback) => keys.set(key, callback),
    removeEventListener: (key, callback) => { if (keys.get(key) === callback) keys.delete(key); } };
  const state = { panelOpen: true, panelOpenSource: "user", panelExpandRequest: 5, busySessionIds: [] };
  const mocks = {
    react: { ...hooks.react, useSyncExternalStore: (_subscribe, snapshot) => snapshot() },
    "react-dom": { createPortal: value => value },
    "../../../i18n": { useLocale: () => ({ t: key => key }) },
    "../../../components/icons": {},
    "../../../lib/responsive/compactViewport": { useCompactViewport: () => false },
    "../../../lib/runtimePlatform": { isNativeMobileRuntime: () => false },
    "../../../lib/browser/browserSessionController": {
      browserSessionController: { subscribe: () => () => {}, getSnapshot: () => state,
        initialize: async () => {}, handleShortcut: key => shortcuts.push(key) },
    },
  };
  for (const name of ["Badge", "Banner", "Button", "DropdownMenu", "EmptyState", "Icon", "IconButton",
    "Layout", "Spinner", "TabList", "Text", "TextInput", "Toolbar"]) mocks[`@astryxdesign/core/${name}`] = {};
  try {
    const { BrowserPanel } = createTsModuleLoader({ mocks }).loadModule("src/pages/chat/browser/BrowserPanel.tsx");
    const props = { presentation: "side", embedded: true, onPresentationChange: next => {
      changes.push(next); props.presentation = next;
    } };
    const render = () => hooks.render(() => BrowserPanel(props));
    render(); assert.deepEqual(changes, []);
    let prevented = 0;
    keys.get("keydown")({ key: "F11", preventDefault: () => prevented++ });
    keys.get("keydown")({ key: "F12", preventDefault: () => prevented++ });
    assert.deepEqual(shortcuts, ["F11", "F12"]); assert.equal(prevented, 2);
    state.panelExpandRequest = 6; render(); render(); hooks.replayEffects();
    assert.deepEqual(changes, ["fullscreen"]);
    state.panelExpandRequest = 8; render(); assert.equal(changes.length, 1);
    state.panelExpandRequest = 9; render(); assert.deepEqual(changes, ["fullscreen", "side"]);
    state.panelOpen = false; state.panelExpandRequest = 10; assert.equal(render(), null);
    assert.equal(keys.size, 0);
    state.panelOpen = true; render(); assert.equal(changes.length, 2);
  } finally {
    hooks.unmount(); assert.equal(keys.size, 0);
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});

test("page actions use actual viewing-device clipboard/opener and surface failures", async () => {
  const calls = []; let copies = true;
  const { canOpenBrowserPage, runBrowserPageAction } = createTsModuleLoader({ mocks: {
    "@xgent/runtime": { openUrl: async url => calls.push(["open", url]) },
    "../system/clipboardText": { writeClipboardText: async url => { calls.push(["copy", url]); return copies; } },
  } }).loadModule("src/lib/browser/browserPageActions.ts");
  for (const url of [undefined, "", "about:blank", "file:///workspace/private", "javascript:alert(1)", "invalid"]) {
    assert.equal(canOpenBrowserPage(url), false);
    await assert.rejects(runBrowserPageAction("open_external", url));
  }
  assert.deepEqual(calls, []);
  await runBrowserPageAction("copy_address", "https://example.test/page");
  await runBrowserPageAction("open_external", "http://localhost:3000");
  assert.deepEqual(calls, [["copy", "https://example.test/page"], ["open", "http://localhost:3000"]]);
  copies = false;
  await assert.rejects(runBrowserPageAction("copy_address", "https://example.test"), /copy/);
});
