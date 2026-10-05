import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const { createNativeSidebarUpdate } = createTsModuleLoader().loadModule("src/presentation/nativeSidebarUpdate.ts");
const t = key => ({ "appUpdate.updateTo": "Update to {version}", "appUpdate.failedRetry": "Failed: {message}" })[key] ?? key;
const defaults = () => ({ showUpdateButton: true, installed: false, installing: false, restarting: false,
  status: "available", result: { version: "1.2.3" }, installAndRestart: async () => undefined, restart: async () => undefined });

test("native sidebar update matches conditional visibility, version, retry, installing and restart states", () => {
  let controller;
  const options = { readController: () => controller, request: { mounted: true, busy: false }, setBusy() {} };
  assert.equal(createNativeSidebarUpdate(options, t).node, undefined);
  controller = { ...defaults(), showUpdateButton: false };
  assert.equal(createNativeSidebarUpdate(options, t).handlers.size, 0);
  controller.showUpdateButton = true;
  assert.equal(createNativeSidebarUpdate(options, t).node.label, "Update to 1.2.3");
  controller.status = "error"; controller.message = "offline";
  assert.equal(createNativeSidebarUpdate(options, t).node.label, "Failed: offline");
  controller.installing = true;
  const installing = createNativeSidebarUpdate(options, t);
  assert.equal(installing.node.status, "running"); assert.equal(installing.node.disabled, true);
  assert.equal(installing.node.accessibilityValue, "settings.aboutInstalling");
  controller.installing = false; controller.installed = true; controller.status = "installed";
  const installed = createNativeSidebarUpdate(options, t);
  assert.equal(installed.node.icon, "arrow.clockwise"); assert.equal(installed.node.label, "appUpdate.restartToComplete");
  controller.restarting = true;
  assert.equal(createNativeSidebarUpdate(options, t).node.accessibilityValue, "settings.aboutRestarting");
});

test("native sidebar update uses the actual shared install/restart callbacks and prevents duplicate or stale requests", async () => {
  let finish, installations = 0, restarts = 0, controller = defaults();
  const request = { mounted: true, busy: false }, busy = [];
  controller.installAndRestart = async () => { installations++; await new Promise(resolve => { finish = resolve; }); };
  controller.restart = async () => { restarts++; };
  const options = { readController: () => controller, request, setBusy: value => busy.push(value) };
  const install = createNativeSidebarUpdate(options, t);
  const first = install.handlers.get(install.node.action).run(null);
  await assert.rejects(install.handlers.get(install.node.action).run(null));
  assert.equal(installations, 1); assert.equal(createNativeSidebarUpdate(options, t).node.disabled, true);
  finish(); await first; assert.deepEqual(busy, [true, false]);
  controller = { ...controller, installed: true, status: "installed" };
  await assert.rejects(install.handlers.get(install.node.action).run(null));
  const restart = createNativeSidebarUpdate(options, t);
  await restart.handlers.get(restart.node.action).run(null); assert.equal(restarts, 1);
  request.mounted = false;
  await assert.rejects(restart.handlers.get(restart.node.action).run(null)); assert.equal(restarts, 1);
});

test("failed shared updates release the button for retry and retired completion cannot update an unmounted view", async () => {
  let fail = true, finish, controller = defaults();
  const request = { mounted: true, busy: false }, busy = [];
  controller.installAndRestart = async () => { if (fail) throw new Error("offline"); await new Promise(resolve => { finish = resolve; }); };
  const options = { readController: () => controller, request, setBusy: value => busy.push(value) };
  let content = createNativeSidebarUpdate(options, t);
  await assert.rejects(content.handlers.get(content.node.action).run(null), /offline/);
  assert.equal(request.busy, false); assert.deepEqual(busy, [true, false]);
  fail = false; content = createNativeSidebarUpdate(options, t);
  const pending = content.handlers.get(content.node.action).run(null);
  request.mounted = false; finish(); await pending;
  assert.deepEqual(busy, [true, false, true]);
});
