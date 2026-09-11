import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("desktop context-menu prevention captures early without suppressing application handlers", () => {
  const { installWebviewNavigationGuard } = createTsModuleLoader().loadModule(
    "src/lib/system/webviewNavigationGuard.ts",
  );
  const registered = new Map();
  const removed = [];
  const uninstall = installWebviewNavigationGuard({ isMac: false }, {
    addEventListener: (type, listener, options) => registered.set(type, { listener, options }),
    removeEventListener: (type, listener, options) => removed.push({ type, listener, options }),
  });
  const guard = registered.get("contextmenu");
  assert.equal(guard.options.capture, true);
  const event = new Event("contextmenu", { cancelable: true, bubbles: true });
  guard.listener(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.cancelBubble, false);
  uninstall();
  assert.deepEqual(removed.find(({ type }) => type === "contextmenu"), {
    type: "contextmenu", ...guard,
  });
});
