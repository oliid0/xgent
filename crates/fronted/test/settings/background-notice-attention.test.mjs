import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const flush = async () => { for (let i = 0; i < 120; i++) await Promise.resolve(); };

test("actual receiver component applies live deferral to shared native notices without restarting or acknowledging data", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const previousDocument = globalThis.document, previousWindow = globalThis.window;
  const events = new Map();
  const eventTarget = { addEventListener(name, callback) { events.set(name, callback); }, removeEventListener(name) { events.delete(name); } };
  globalThis.document = { visibilityState: "visible", ...eventTarget };
  globalThis.window = eventTarget;
  const hooks = createReactHookHarness(), calls = [], acknowledgments = [];
  t.after(() => {
    hooks.unmount();
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  });
  const { createAppNotificationStore } = createTsModuleLoader().loadModule("src/components/astryx/appNotifications.ts");
  let next = 0;
  const notifications = createAppNotificationStore(() => `notice-${++next}`);
  const item = { id: "entry", sequence: 1, sourceHostId: "original", requestId: "original", name: "Actual task",
    state: "done", success: true, preview: "Actual saved result", artifactCount: 1, receivedAt: 1, readAt: null };
  let acknowledged = false;
  const backend = {
    async listBackgroundInbox() { return { items: acknowledged ? [] : [item], nextCursor: null }; },
    async syncBackgroundInbox() { calls.push("sync"); return {}; },
    async notifyBackgroundInbox(id) { calls.push(["notify", id]); return "accepted"; },
    async acknowledgeBackgroundInbox(id) { acknowledgments.push(id); acknowledged = true; },
  };
  const translate = key => key;
  const loader = createTsModuleLoader({ mocks: {
    react: hooks.react,
    "@xgent/runtime": { isBrowserRuntime: () => false },
    "../../lib/automation/backend": { backend },
    "../../lib/runtimePlatform": { isNativeMobileRuntime: () => true },
    "../../i18n": { useLocale: () => ({ t: translate }) },
    "../astryx/useAppToast": { useAppToast: () => notifications.show },
  } });
  const { BackgroundInboxReceiver } = loader.loadModule("src/components/cron/BackgroundInboxReceiver.tsx");
  const render = deferred => hooks.render(() => BackgroundInboxReceiver({ deferNotices: deferred }));
  render(true); await flush();
  assert.ok(calls.includes("sync")); assert.equal(notifications.getSnapshot().length, 0);
  assert.equal(calls.some(call => Array.isArray(call)), false);
  render(false); await flush();
  assert.equal(notifications.getSnapshot().length, 1);
  assert.match(notifications.getSnapshot()[0].options.body, /Actual saved result/);
  assert.doesNotMatch(notifications.getSnapshot()[0].options.body, /backgroundInbox\.retained/);
  render(true); await flush();
  assert.equal(notifications.getSnapshot().length, 0);
  assert.deepEqual(acknowledgments, []); // Real native dismiss reports "manual"; receiver retirement still guards ACK.
  render(false); await flush();
  assert.equal(notifications.getSnapshot().length, 1);
  notifications.dismiss(notifications.getSnapshot()[0].id); await flush();
  assert.deepEqual(acknowledgments, ["entry"]);
  hooks.unmount(); assert.equal(events.size, 0);
});

test("deferral is wired from actual run/approval/modal state independently of original running-count semantics", () => {
  const read = file => readFileSync(new URL(`../../src/${file}`, import.meta.url), "utf8");
  const page = read("pages/ChatPage.tsx"), app = read("App.tsx"), receiver = read("components/cron/BackgroundInboxReceiver.tsx");
  assert.match(page, /onRunningConversationCountChange\?\.\(runningConversationIds\.size\)/);
  assert.match(page, /isSending\s*\|\|\s*runningConversationIds\.size > 0\s*\|\|\s*pendingToolApprovals\.length > 0\s*\|\|\s*confirmDialog !== null/);
  assert.match(app, /onNotificationDeferralChange=\{setDeferBackgroundNotices\}/);
  assert.match(app, /BackgroundInboxReceiver deferNotices=\{deferBackgroundNotices\}/);
  assert.match(receiver, /shouldDeferNotices: \(\) => deferredRef\.current && document\.visibilityState !== "hidden"/);
});
