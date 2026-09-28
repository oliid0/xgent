import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const { createMobileBackNavigation, mobileBackNavigation, installMobileBackNavigation, MOBILE_BACK_EVENT } =
  createTsModuleLoader().loadModule("src/lib/mobileBackNavigation.ts");

const page = (modals = []) => ({ querySelectorAll: (selector) => selector === "dialog[open]" ? modals : [] });
function owner(options = {}) {
  return {
    isConnected: options.connected ?? true,
    contains: () => false,
    closest: (selector) => selector === "dialog" ? options.dialog ?? null : options.hidden ? {} : null,
  };
}
function dialog() {
  const result = Object.assign(new EventTarget(), {
    open: true,
    matches: () => true,
    contains: (element) => element.closest("dialog") === result,
    close() { this.open = false; },
  });
  return result;
}

test("Android Back leaves one visible destination and ignores hidden retained pages", () => {
  const navigation = createMobileBackNavigation();
  const calls = [];
  const sidebar = navigation.register({ run: () => calls.push("sidebar"), priority: 0 });
  const panel = navigation.register({ run: () => calls.push("terminal"), priority: 20, owner: () => owner() });
  navigation.register({ run: () => calls.push("hidden"), priority: 30, owner: () => owner({ hidden: true }) });
  navigation.register({ run: () => calls.push("removed"), priority: 40, owner: () => owner({ connected: false }) });
  assert.equal(navigation.dispatch(page()), true);
  assert.deepEqual(calls, ["terminal"]);
  panel();
  assert.equal(navigation.dispatch(page()), true);
  assert.deepEqual(calls, ["terminal", "sidebar"]);
  sidebar();
  assert.equal(navigation.dispatch(page()), false, "the native shell receives Back at the chat root");
});

test("settings Back steps out of the visible detail before closing its containing modal", () => {
  const navigation = createMobileBackNavigation();
  const sheet = dialog();
  const calls = [];
  navigation.register({ run: () => calls.push("chat"), priority: 100 });
  navigation.register({ run: () => calls.push("settings"), priority: 10, owner: () => owner({ dialog: sheet }) });
  const detail = navigation.register({ run: () => calls.push("provider"), priority: 30, owner: () => owner({ dialog: sheet }) });
  assert.equal(navigation.dispatch(page([sheet])), true);
  assert.deepEqual(calls, ["provider"]);
  detail();
  navigation.dispatch(page([sheet]));
  assert.deepEqual(calls, ["provider", "settings"]);
  sheet.open = false;
  navigation.dispatch(page());
  assert.deepEqual(calls, ["provider", "settings", "chat"]);
});

test("top modal owns cancel even when it refuses dismissal; lower pages never execute", () => {
  const navigation = createMobileBackNavigation();
  const lower = dialog();
  const top = dialog();
  let cancelled = 0;
  let underlying = 0;
  top.addEventListener("cancel", (event) => { cancelled++; event.preventDefault(); });
  navigation.register({ run: () => underlying++, priority: 30, owner: () => owner({ dialog: lower }) });
  navigation.dispatch(page([lower, top]));
  assert.equal(cancelled, 1);
  assert.equal(top.open, true);
  assert.equal(underlying, 0);
  const native = dialog();
  navigation.dispatch(page([native]));
  assert.equal(native.open, false);
});

test("nested settings layers win over their ancestors regardless of registration order", () => {
  const navigation = createMobileBackNavigation();
  const sheet = dialog();
  const child = owner({ dialog: sheet });
  const parent = owner({ dialog: sheet });
  parent.contains = (element) => element === child;
  const calls = [];
  navigation.register({ run: () => calls.push("child"), priority: 30, owner: () => child });
  navigation.register({ run: () => calls.push("parent"), priority: 30, owner: () => parent });
  navigation.dispatch(page([sheet]));
  assert.deepEqual(calls, ["child"]);
});

test("focused modal wins when opening order differs from DOM order", () => {
  const navigation = createMobileBackNavigation();
  const top = dialog();
  const lower = dialog();
  const cancelled = [];
  top.addEventListener("cancel", (event) => { event.preventDefault(); cancelled.push("top"); });
  lower.addEventListener("cancel", (event) => { event.preventDefault(); cancelled.push("lower"); });
  navigation.dispatch({ ...page([top, lower]), activeElement: { closest: () => top } });
  assert.deepEqual(cancelled, ["top"]);
});

test("open popovers close before a containing settings or tool page", () => {
  const navigation = createMobileBackNavigation();
  let closed = 0;
  let navigated = 0;
  navigation.register({ run: () => navigated++, priority: 20 });
  navigation.dispatch({ querySelectorAll: (selector) => selector === ":popover-open" ? [{ hidePopover: () => closed++ }] : [] });
  assert.equal(closed, 1);
  assert.equal(navigated, 0);
});

test("native back receipt is cancelled only when a live layer handles it and listeners clean up", () => {
  const target = new EventTarget();
  const stop = installMobileBackNavigation(target, page());
  const back = () => target.dispatchEvent(new Event(MOBILE_BACK_EVENT, { cancelable: true }));
  assert.equal(back(), true);
  let calls = 0;
  const remove = mobileBackNavigation.register({ run: () => calls++, priority: 0 });
  assert.equal(back(), false);
  assert.equal(calls, 1);
  remove();
  assert.equal(back(), true);
  stop();
  const remaining = mobileBackNavigation.register({ run: () => calls++, priority: 0 });
  assert.equal(back(), true);
  assert.equal(calls, 1);
  remaining();
});
