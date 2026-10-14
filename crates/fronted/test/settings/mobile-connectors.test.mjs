import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const status = { available: true, backend: "ios-native", healthAvailable: true,
  permissionAliases: { calendar: "calendar", contacts: "device-contacts", reminders: "reminders", health: "health" } };
const tick = async () => { for (let i=0; i<12; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function fixture(options = {}) {
  const hooks = createReactHookHarness(), calls = [];
  const actual = createTsModuleLoader().loadModule("src/lib/mobileAssistant.ts");
  const loader = createTsModuleLoader({ mocks: { react: hooks.react, "../mobileAssistant": {
    ...actual, async mobileAssistantStatus() { calls.push("status"); return status; },
    async checkMobileAssistantPermissions() { calls.push("permission"); return { "device-contacts": options.permission ?? "granted" }; },
    async requestMobileAssistantPermission(alias, signal) { calls.push(["request", alias, signal]); return { [alias]: "granted" }; },
    async listMobileContacts(query, limit) { calls.push(["read", query, limit]); if (options.failure) throw new Error(options.failure); return options.pending?.promise ?? { contacts: [{ id: "device-id", name: "Alice", phones: ["123"], emails: ["alice@example.test"] }], accessLimited: true, truncated: false }; },
  } } });
  const { useMobileContacts } = loader.loadModule("src/lib/connectors/useMobileContacts.ts");
  const render = (enabled = true) => hooks.render(() => useMobileContacts(enabled));
  render(); return { hooks, calls, render };
}

test("connector catalog preserves OS grant, assistant policy and HealthKit ambiguity separately", () => {
  const { mobileConnectorCatalog, MOBILE_CONNECTORS } = createTsModuleLoader().loadModule("src/lib/connectors/mobileConnectorCatalog.ts");
  const entries = mobileConnectorCatalog(status, { contacts: "granted", calendar: "denied", health: "requested" }, { "personal:contacts": "deny" });
  assert.deepEqual(MOBILE_CONNECTORS.map(c => c.id), ["calendar", "contacts", "reminders", "health", "home"]);
  assert.equal(entries.find(c => c.id === "contacts").state, "blocked");
  assert.equal(entries.find(c => c.id === "health").state, "requested");
  assert.equal(entries.find(c => c.id === "calendar").state, "denied");
  assert.ok(entries.every(c => c.locality === "initiating-device" && c.actions.length));
  assert.ok(mobileConnectorCatalog(undefined, {}).every(c => c.state === "unknown"));
});

test("contact UI search uses actual discovered authority, captures input and rejects duplicate presses", async () => {
  const pending = deferred(), f = fixture({ pending, permission: "prompt" });
  f.render().setQuery(" Alice "); const view = f.render();
  const first = view.search(); const second = view.search(); await tick();
  f.render().setQuery("Bob");
  assert.equal(f.render().busy, true); assert.equal(f.calls.filter(c => Array.isArray(c) && c[0] === "read").length, 1);
  assert.deepEqual(f.calls.find(c => Array.isArray(c) && c[0] === "read"), ["read", "Alice", 25]);
  assert.equal(f.calls.find(c => Array.isArray(c) && c[0] === "request")[1], "device-contacts");
  pending.resolve({ contacts: [], truncated: false, accessLimited: true }); await Promise.all([first, second]);
  assert.deepEqual(f.render().data, { contacts: [], truncated: false, accessLimited: true }); assert.equal(f.render().busy, false);
  f.hooks.unmount();
});

test("retired contact searches cannot repopulate a reopened page or request hidden-device data", async () => {
  const pending = deferred(), f = fixture({ pending });
  const running = f.render().search(); await tick(); f.render(false); f.render(true);
  pending.resolve({ contacts: [{ id: "old", name: "Old", phones: [], emails: [] }], truncated: false, accessLimited: false }); await running;
  assert.equal(f.render().data, null); assert.equal(f.render().busy, false);
  const count = f.calls.length; await f.render(false).search(); assert.equal(f.calls.length, count);
  f.hooks.unmount();
});

test("denied, failed and malformed contact results remain errors and do not report an empty successful list", async () => {
  for (const options of [{ permission: "denied" }, { failure: "Native contact read failed" }, { pending: { promise: Promise.resolve({ contacts: "invalid" }) } }]) {
    const f = fixture(options); await f.render().search(); assert.equal(f.render().data, null); assert.ok(f.render().error); assert.equal(f.render().busy, false);
    if (options.permission === "denied") assert.equal(f.calls.some(c => Array.isArray(c) && c[0] === "read"), false);
    f.hooks.unmount();
  }
});

test("contacts and actual recurring writes are wired through native commands, permissions and platform adapters", () => {
  const source = relative => readFileSync(new URL(`../../../../${relative}`, import.meta.url), "utf8");
  for (const file of ["crates/mobile-assistant/src/lib.rs", "crates/mobile-assistant/build.rs", "crates/mobile-assistant/permissions/default.toml"])
    assert.match(source(file), /list[_-]contacts/);
  assert.match(source("crates/fronted/src-tauri/Info.ios.plist"), /NSContactsUsageDescription/);
  assert.match(source("crates/mobile-assistant/android/src/main/AndroidManifest.xml"), /android.permission.READ_CONTACTS/);
  assert.match(source("crates/mobile-assistant/ios/Sources/ContactsAccess.swift"), /status == \.limited/);
  assert.match(source("crates/mobile-assistant/ios/Sources/MobileAssistantPlugin.swift"), /reminder\.addRecurrenceRule\(EKRecurrenceRule/);
  assert.match(source("crates/mobile-assistant/ios/Sources/MobileAssistantPlugin.swift"), /reminder\.addAlarm\(EKAlarm/);
  const android = source("crates/mobile-assistant/android/src/main/java/com/ohi/xgent/mobileassistant/CalendarWrites.kt");
  assert.match(android, /applyBatch\(CalendarContract.AUTHORITY, operations\)/);
  assert.match(android, /withValueBackReference\(CalendarContract.Reminders.EVENT_ID, 0\)/);
  assert.match(android, /"FREQ=DAILY"/); assert.match(android, /CalendarContract.Events.DURATION/);
  assert.equal(android.includes("ACTION_INSERT"), false);
});
