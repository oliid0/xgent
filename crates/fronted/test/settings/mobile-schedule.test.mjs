import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const status = { available: true, permissionAliases: { calendar: "events", reminders: "tasks" } };
const calendar = { id: "observed-list", title: "Work", source: "device-account", isDefault: true };
const future = { day: "2099-10-09", time: "20:00" };
const tick = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(options = {}) {
  const hooks = createReactHookHarness(), calls = [];
  let calendarReads = 0;
  const actual = createTsModuleLoader().loadModule("src/lib/mobileAssistant.ts");
  const mocks = { ...actual,
    async mobileAssistantStatus() { calls.push("status"); return status; },
    async checkMobileAssistantPermissions() { return { events: options.permission ?? "granted", tasks: options.permission ?? "granted" }; },
    async requestMobileAssistantPermission(alias, signal) { calls.push(["permission", alias, signal]); return options.authorization?.promise ?? { [alias]: "granted" }; },
    async listMobileCalendars(kind) { calls.push(["calendars", kind]); calendarReads++; return calendarReads > 1 && options.revoked ? { calendars: [], truncated: false } : options.calendars ?? { calendars: [calendar], truncated: false }; },
    async listMobileCalendarEvents(range) { calls.push(["events", range]); return options.read?.promise ?? [{ id: "event-id", title: "Meeting", startMs: Date.now() + 10000, calendar: "Work" }]; },
    async listMobileReminders(request) { calls.push(["reminders", request]); return [{ id: "reminder-id", title: "Exercise", dueMs: null, list: "Work" }]; },
    async createMobileCalendarEvent(request, scope) { calls.push(["write-event", request, scope]); if (options.failure) throw new Error(options.failure); return options.write?.promise ?? options.receipt ?? { id: "created-id", presented: false, detail: "Saved" }; },
    async createMobileReminder(request, scope) { calls.push(["write-reminder", request, scope]); return options.write?.promise ?? { id: "created-reminder", presented: false, detail: "Saved" }; },
  };
  const loader = createTsModuleLoader({ mocks: { react: hooks.react, "../mobileAssistant": mocks } });
  const { useMobileSchedule } = loader.loadModule("src/lib/connectors/useMobileSchedule.ts");
  const render = (enabled = true) => hooks.render(() => useMobileSchedule(enabled));
  const draft = () => { const view = render(); view.setTitle("Exercise"); view.setDay(future.day); view.setTime(future.time); return render(); };
  render(); return { hooks, calls, render, draft };
}

test("schedule reads real destinations and bounded records only after explicit interaction", async () => {
  const f = fixture(); assert.deepEqual(f.calls, []); await f.render().load();
  const view = f.render(); assert.equal(view.calendarId, calendar.id); assert.equal(view.records[0].id, "event-id");
  assert.equal(f.calls.find(c => c[0] === "events")[1].limit, 50);
  view.setKind("reminder"); assert.equal(f.render().calendars, null); assert.equal(f.render().calendarId, "");
  await f.render().load(); assert.equal(f.render().records[0].id, "reminder-id");
  assert.deepEqual(f.calls.find(c => c[0] === "reminders")[1], { incompleteOnly: true, limit: 50 }); f.hooks.unmount();
});

test("calendar ambiguity, truncation and denial never guess a destination or perform a write", async () => {
  for (const options of [{ calendars: { calendars: [calendar], truncated: true } }, { calendars: { calendars: [{ ...calendar, isDefault: false }], truncated: false } }, { permission: "denied" }]) {
    const f = fixture(options); await f.render().load(); assert.equal(f.render().calendarId, ""); assert.equal(f.draft().canSave, false);
    await f.render().save(); assert.equal(f.calls.some(c => Array.isArray(c) && c[0].startsWith("write-")), false); f.hooks.unmount();
  }
});

test("schedule save captures a draft, revalidates authority, returns real receipt and prevents duplicate clicks", async () => {
  const pending = deferred(), f = fixture({ write: pending }); await f.render().load();
  const view = f.draft(), first = view.save(), second = view.save(); await tick();
  f.render().setTitle("Changed after acceptance");
  const write = f.calls.find(c => c[0] === "write-event"); assert.equal(write[1].title, "Exercise"); assert.equal(write[1].calendarId, calendar.id);
  assert.equal(write[1].endMs - write[1].startMs, 30 * 60000); assert.equal(f.calls.filter(c => c[0] === "write-event").length, 1);
  pending.resolve({ id: "actual-id", presented: false, detail: "Saved to Work" }); await Promise.all([first, second]);
  assert.equal(f.render().receipt.id, "actual-id"); f.render().setTitle("Exercise"); assert.equal(f.render().canSave, false);
  await f.render().save(); assert.equal(f.calls.filter(c => c[0] === "write-event").length, 1); f.hooks.unmount();
});

test("schedule operation scope survives reopen and changes with the captured destination/draft", async () => {
  const scopes = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const f = fixture(); await f.render().load(); f.draft();
    if (attempt === 2) f.render().setTitle("Changed draft");
    await f.render().save(); scopes.push(f.calls.find(c => c[0] === "write-event")[2]); f.hooks.unmount();
  }
  assert.equal(scopes[0], scopes[1]); assert.notEqual(scopes[0], scopes[2]);
  assert.match(scopes[0], /^settings-schedule\//);
});

test("daily reminders use a real observed reminder list and recurring due-time write", async () => {
  const f = fixture(); f.render().setKind("reminder"); await f.render().load();
  f.draft().setRecurrence("daily"); await f.render().save();
  const request = f.calls.find(c => c[0] === "write-reminder")[1];
  assert.equal(request.calendarId, calendar.id); assert.equal(request.title, "Exercise"); assert.equal(request.recurrence, "daily");
  assert.ok(Number.isSafeInteger(request.dueMs)); assert.equal(f.render().receipt.id, "created-reminder"); f.hooks.unmount();
});

test("revoked destinations and invalid dates are stopped before mutation", async () => {
  for (const options of [{ revoked: true }, { invalid: true }]) {
    const f = fixture(options); await f.render().load(); f.draft();
    if (options.invalid) f.render().setDay("2099-02-30");
    await f.render().save(); assert.ok(f.render().error); assert.equal(f.render().receipt, null);
    assert.equal(f.calls.some(c => Array.isArray(c) && c[0].startsWith("write-")), false); f.hooks.unmount();
  }
});

test("unknown writes or composer receipts remain visible errors and are not replayed", async () => {
  for (const options of [{ failure: "Provider response lost" }, { receipt: { presented: true, id: "draft", detail: "Opened" } }, { receipt: { presented: false, detail: "No ID" } }]) {
    const f = fixture(options); await f.render().load(); f.draft(); await f.render().save();
    assert.equal(f.render().receipt, null); assert.match(f.render().error, /may have occurred/); assert.equal(f.render().canSave, false);
    await f.render().load(); await f.render().save(); assert.equal(f.calls.filter(c => c[0] === "write-event").length, 1); f.hooks.unmount();
  }
});

test("retired page reads and authorization cannot update or write through a reopened page", async () => {
  const read = deferred(), f = fixture({ read }); const loading = f.render().load(); await tick();
  f.render(false); f.render(true); read.resolve([{ id: "old", title: "Old", startMs: 100 }]); await loading;
  assert.equal(f.render().records, null); assert.equal(f.render().busy, false); f.hooks.unmount();
  const authorization = deferred(), blocked = fixture({ permission: "prompt", authorization }); const pending = blocked.render().load(); await tick();
  blocked.render(false); authorization.resolve({ events: "granted" }); await pending;
  assert.equal(blocked.calls.some(c => c[0] === "calendars"), false); blocked.hooks.unmount();
});

test("native calendar discovery is registered and Android keeps account name/type and writable selection together", () => {
  const source = p => readFileSync(new URL(`../../../../${p}`, import.meta.url), "utf8");
  for (const p of ["crates/mobile-assistant/src/lib.rs", "crates/mobile-assistant/build.rs", "crates/mobile-assistant/permissions/default.toml"]) assert.match(source(p), /list[_-]calendars/);
  const swift = source("crates/mobile-assistant/ios/Sources/MobileAssistantPlugin.swift"); assert.match(swift, /canReadEvents\(entity\)/);
  assert.match(swift, /scopedCalendars\(args.calendarIds, type: entity\) \?\? eventStore.calendars\(for: entity\)/);
  assert.match(swift, /candidates.filter \{ args.writableOnly == false \|\| \$0.allowsContentModifications \}/);
  const kotlin = source("crates/mobile-assistant/android/src/main/java/com/ohi/xgent/mobileassistant/CalendarWrites.kt");
  assert.match(kotlin, /Calendars.ACCOUNT_NAME, CalendarContract.Calendars.ACCOUNT_TYPE/); assert.match(kotlin, /CAL_ACCESS_CONTRIBUTOR/); assert.match(kotlin, /choices.size <= 200/);
});

test("local date input rejects rollover, out-of-range time and daylight-saving gaps or overlaps", () => {
  const { localScheduleTime } = createTsModuleLoader().loadModule("src/lib/connectors/useMobileSchedule.ts");
  for (const [day, time] of [["2099-02-30", "20:00"], ["2099-01-01", "25:00"], ["2099-01-01", "20:60"], ["2099-1-1", "20:00"]]) assert.throws(() => localScheduleTime(day, time));
  const original = process.env.TZ;
  try { process.env.TZ = "America/Los_Angeles"; assert.throws(() => localScheduleTime("2026-03-08", "02:30")); assert.throws(() => localScheduleTime("2026-11-01", "01:30")); }
  finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});
