import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const hostId = "11111111-1111-4111-8111-111111111111";
const request = { title: "Exercise", calendarId: "observed-list", dueMs: 2000000000000, recurrence: "daily" };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function receipt(input, overrides = {}) {
  return { input, destination: { kind: input.kind, id: "observed-list", sourceId: "actual-native-account", source: "Work" },
    state: "succeeded", result: { id: "saved-id", presented: false, detail: "Saved to device" }, error: null, startedAt: 2, finishedAt: 3, ...overrides };
}
function fixture(reply, identity) {
  const calls = [];
  const loader = createTsModuleLoader({ mocks: {
    "@tauri-apps/api/core": { async invoke(command, args) { calls.push({ command, args });
      if (command === "automation_device_identity") return identity ? await identity() : { hostId };
      return reply(command, args); } },
    "@xgent/runtime": { invoke() { assert.fail("A phone connector write/recovery must not use the mutable selected desktop transport"); } },
  } });
  return { calls, loader, api: loader.loadModule("src/lib/connectors/durableMobileWrites.ts") };
}

test("assistant write identity and immutable input survive reload and a lost frontend receipt", async () => {
  let accepted;
  const first = fixture((command, args) => { assert.equal(command, "automation_mobile_connector_execute"); accepted = args.input; throw new Error("Frontend ACK lost after native persistence"); });
  await assert.rejects(first.api.executeDurableMobileWrite("reminder", request, "conversation/actual-call"), /ACK lost/);
  const recovered = fixture((command, args) => { assert.equal(command, "automation_mobile_connector_execute"); assert.deepEqual(args.input, accepted); return receipt(accepted); });
  const result = await recovered.api.executeDurableMobileWrite("reminder", request, "conversation/actual-call");
  assert.equal(result.id, "saved-id"); assert.equal(result.operationId, accepted.operationId); assert.equal(result.deviceHostId, hostId);
  assert.match(result.operationId, /^[a-f0-9]{64}$/);
  assert.deepEqual(recovered.calls.map(c => c.command), ["automation_device_identity", "automation_mobile_connector_execute"]);
});

test("device and stable call scope determine operation identity; changed arguments retain the same immutable operation", async () => {
  const f = fixture((_, args) => receipt(args.input));
  await f.api.executeDurableMobileWrite("reminder", request, "conversation/call");
  const original = f.calls.at(-1).args.input;
  await f.api.executeDurableMobileWrite("reminder", { ...request, title: "Changed after submission" }, "conversation/call");
  assert.equal(f.calls.at(-1).args.input.operationId, original.operationId);
  await f.api.executeDurableMobileWrite("reminder", request, "other-conversation/call");
  assert.notEqual(f.calls.at(-1).args.input.operationId, original.operationId);
  const other = fixture((_, args) => receipt(args.input), async () => ({ hostId: "22222222-2222-4222-8222-222222222222" }));
  await other.api.executeDurableMobileWrite("reminder", request, "conversation/call");
  assert.notEqual(other.calls.at(-1).args.input.operationId, original.operationId);
});

test("request bytes are captured before identity IPC can finish or the page draft changes", async () => {
  const pending = deferred(), mutable = structuredClone(request);
  const f = fixture((_, args) => receipt(args.input), () => pending.promise);
  const write = f.api.executeDurableMobileWrite("reminder", mutable, "captured-draft");
  mutable.title = "Replacement"; mutable.calendarId = "another-list";
  pending.resolve({ hostId }); await write;
  assert.deepEqual(f.calls.at(-1).args.input.request, request);
});

test("unknown or already running native effects stay unresolved without an automatic write retry", async () => {
  for (const state of ["running", "unknown"]) {
    const f = fixture((_, args) => receipt(args.input, { state, result: null, finishedAt: null, error: "Native outcome not confirmed" }));
    await assert.rejects(f.api.executeDurableMobileWrite("reminder", request, "actual-call"), /will not be replayed/);
    assert.equal(f.calls.filter(c => c.command === "automation_mobile_connector_execute").length, 1);
  }
});

test("wrong device/operation/request/destination and composer receipts cannot claim success", async () => {
  for (const mutate of [
    r => { r.input = { ...r.input, deviceHostId: "another-host" }; },
    r => { r.input = { ...r.input, operationId: "b".repeat(64) }; },
    r => { r.input = { ...r.input, request: { ...request, calendarId: "another-list" } }; },
    r => { r.destination.sourceId = ""; },
    r => { r.destination.kind = "calendar_event"; },
    r => { r.result.presented = true; },
    r => { r.result.id = null; },
    r => { r.finishedAt = null; },
  ]) {
    const f = fixture((_, args) => { const r = receipt(args.input); mutate(r); return r; });
    await assert.rejects(f.api.executeDurableMobileWrite("reminder", request, "actual-call"));
  }
});

test("read-only recovery inspects saved/unknown state without performing a system write", async () => {
  for (const exists of [false, true]) {
    const f = fixture((command, args) => { assert.equal(command, "automation_mobile_connector_read"); return exists ? receipt(args.input, { state: "unknown", result: null, finishedAt: null, error: "App restarted" }) : null; });
    const record = await f.api.readDurableMobileWrite("reminder", request, "actual-call");
    assert.equal(record?.state ?? null, exists ? "unknown" : null);
    assert.equal(f.calls.some(c => c.command === "automation_mobile_connector_execute"), false);
  }
});

test("invalid scopes/oversized inputs fail before native invocation and unknown identity cannot start a write", async () => {
  const f = fixture(() => assert.fail("No effect expected"));
  for (const scope of ["", " ", "x".repeat(4097)]) await assert.rejects(f.api.executeDurableMobileWrite("reminder", request, scope));
  await assert.rejects(f.api.executeDurableMobileWrite("reminder", { ...request, notes: "x".repeat(33000) }, "actual-call"));
  assert.equal(f.calls.length, 0);
  const missing = fixture(() => assert.fail("No effect expected"), async () => ({ hostId: "unknown" }));
  await assert.rejects(missing.api.executeDurableMobileWrite("reminder", request, "actual-call"), /identity/);
  assert.equal(missing.calls.length, 1);
});

test("public calendar/reminder helpers use durable native execution when a stable scope is supplied", async () => {
  const f = fixture((command, args) => { assert.equal(command, "automation_mobile_connector_execute"); return receipt(args.input); });
  const api = f.loader.loadModule("src/lib/mobileAssistant.ts");
  await api.createMobileCalendarEvent({ title: "Meeting", startMs: 1, endMs: 2 }, "event-call");
  assert.equal(f.calls.at(-1).args.input.kind, "calendar_event"); assert.equal(f.calls.at(-1).args.input.request.allDay, false);
  await api.createMobileReminder(request, "reminder-call"); assert.equal(f.calls.at(-1).args.input.kind, "reminder");
});
