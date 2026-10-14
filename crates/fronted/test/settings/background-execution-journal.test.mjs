import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const lease = { attempt: 1, generation: 1, token: "11111111-1111-4111-8111-111111111111" };

const call = { id: "send-1", name: "SendMail", arguments: { recipient: "user@example.test" } };
const receipt = (overrides = {}) => ({ role: "toolResult", toolCallId: call.id, toolName: call.name,
  content: [{ type: "text", text: "Sent with receipt 42" }], timestamp: 100, isError: false, ...overrides });
const assistant = { role: "assistant", content: [{ type: "toolCall", ...call }], timestamp: 90 };

const cloudCall = { id: "original-cloud", name: "CloudTaskManager", arguments: { action: "start", runner: "ubuntu-latest", script: "actual work" } };
const cloudReceipt = (patch = {}) => ({ role: "toolResult", toolCallId: cloudCall.id, toolName: cloudCall.name,
  isError: false, timestamp: 101, content: [{ type: "text", text: "Actual native dispatch acknowledged" }],
  details: { kind: "cloud_task_manager", action: "start", taskId: "task-actual", owner: "original-owner", repository: "agent-temp", repositoryVisibility: "public" }, ...patch });

const childCall = { id: "original-child", name: "BackgroundTask", arguments: { action: "submit", name: "Website", prompt: "Create and verify website" } };
const childReceipt = (patch = {}) => ({ role: "toolResult", toolCallId: childCall.id, toolName: childCall.name, isError: true, timestamp: 101, content: [{ type: "text", text: "Acceptance is unknown" }], details: { outcomeUncertain: true }, ...patch });

test("uncertain original child tail suspends for native ownership without a second submit or failed receipt", async () => {
  let effects = 0;
  const f = fixture({ beginBackgroundOperation: async () => ({ status: "uncertain" }) }, { deferUnconfirmedChildStart: true });
  try {
    await assert.rejects(f.journal.execute(childCall, undefined, async () => { effects++; return childReceipt(); }), error => error.name === "BackgroundChildLaunchPending" && error.receipt.toolCallId === childCall.id);
    assert.equal(effects, 0); assert.deepEqual(f.saved, []); assert.equal(f.journal.signal.aborted, true);
  } finally { f.journal.dispose(); }
});

test("fresh child RPC failure executes once and suspends before freezing an operation receipt", async () => {
  const f = fixture({ beginBackgroundOperation: async () => ({ status: "execute" }) }, { deferUnconfirmedChildStart: true });
  let effects = 0;
  try {
    await assert.rejects(f.journal.execute(childCall, undefined, async () => { effects++; throw new Error("RPC response lost"); }), error => error.name === "BackgroundChildLaunchPending" && error.receipt.details.outcomeUncertain === true);
    assert.equal(effects, 1); assert.deepEqual(f.saved, []);
  } finally { f.journal.dispose(); }
});

test("settling a failed parallel group retains a late sibling receipt before returning parking authority", async () => {
  let release, entered = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const second = { ...childCall, id: "second-child" };
  const success = childReceipt({ toolCallId: second.id, isError: false, details: { accepted: true } });
  const f = fixture({ beginBackgroundOperation: async () => ({ status: "execute" }) }, { deferUnconfirmedChildStart: true });
  try {
    const first = f.journal.execute(childCall, undefined, async () => { entered++; await gate; throw new Error("ACK lost"); });
    let completeSibling;
    const sibling = f.journal.execute(second, undefined, async () => { entered++; return new Promise(resolve => { completeSibling = resolve; }); });
    const group = Promise.allSettled([first, sibling]);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.equal(entered, 2);
    release();
    await assert.rejects(first, error => error.name === "BackgroundChildLaunchPending");
    let settled = false;
    const settling = f.journal.settle().then(() => { settled = true; });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.equal(settled, false); assert.equal(f.saved.length, 0);
    completeSibling(success);
    await settling; await group;
    assert.equal(f.saved.length, 1); assert.equal(f.saved[0].toolCallId, second.id);
    assert.throws(() => f.journal.throwIfFailed(), error => error.name === "BackgroundChildLaunchPending" && error.receipt.toolCallId === childCall.id);
    assert.equal(entered, 2);
  } finally { f.journal.dispose(); }
});

test("multiple child failures preserve all intents and settle without inventing receipts or retrying effects", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ beginBackgroundOperation: async () => ({ status: "execute" }) }, { deferUnconfirmedChildStart: true });
  let effects = 0;
  try {
    const runs = [childCall, { ...childCall, id: "second-child" }].map(call => f.journal.execute(call, undefined, async () => { effects++; await gate; throw new Error("Both peers lost ACK"); }));
    const completed = Promise.allSettled(runs);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.equal(effects, 2); release();
    await f.journal.settle();
    assert.ok((await completed).every(result => result.status === "rejected"));
    assert.deepEqual(f.saved, []);
    await assert.rejects(f.journal.execute(childCall, undefined, async () => { effects++; }), error => error.name === "BackgroundChildLaunchPending" && error.receipt.details.outcomeUncertain === true);
    assert.equal(effects, 2);
  } finally { f.journal.dispose(); }
});

test("frozen child error is retained for native reconciliation; actual accepted receipt continues without effects", async () => {
  for (const isError of [true, false]) {
    const native = childReceipt({ isError }); let effects = 0;
    const f = fixture({ beginBackgroundOperation: async () => ({ status: "returned", result: native }) }, { deferUnconfirmedChildStart: true });
    try {
      const run = f.journal.execute(childCall, undefined, async () => { effects++; return native; });
      if (isError) await assert.rejects(run, error => error.name === "BackgroundChildLaunchPending" && JSON.stringify(error.receipt) === JSON.stringify(native));
      else assert.equal(await run, native);
      assert.equal(effects, 0); assert.deepEqual(f.saved, []);
    } finally { f.journal.dispose(); }
  }
});

test("off and non-submit operations keep their original unknown/failure behavior", async () => {
  for (const [operation, enabled] of [[childCall, false], [{ ...childCall, arguments: { action: "cancel" } }, true]]) {
    const f = fixture({ beginBackgroundOperation: async () => ({ status: "uncertain" }) }, { deferUnconfirmedChildStart: enabled });
    try { await assert.rejects(f.journal.execute(operation, undefined, async () => assert.fail("Must not replay")), /external outcome is unknown/); assert.deepEqual(f.saved, []); }
    finally { f.journal.dispose(); }
  }
});

test("frozen uncertain cloud start parks through native ownership without replacing its receipt or replaying effects", async () => {
  const failed = cloudReceipt({ isError: true, details: { outcomeUncertain: true } });
  let effects = 0, observations = 0;
  const f = fixture({ beginBackgroundOperation: async () => ({ status: "returned", result: failed }) }, {
    deferUnconfirmedCloudStart: true, recoverCloudStart: async () => { observations++; return null; },
  });
  try {
    let pending;
    await assert.rejects(f.journal.execute(cloudCall, undefined, async () => { effects++; return cloudReceipt(); }), error => {
      pending = error; return error.name === "BackgroundCloudLaunchPending";
    });
    assert.deepEqual(pending.receipt, failed);
    assert.equal(effects, 0); assert.equal(observations, 0); assert.deepEqual(f.saved, []);
    assert.equal(f.journal.signal.aborted, true);
  } finally { f.journal.dispose(); }
});

test("unmarked frozen cloud errors and read receipts cannot obtain cloud suspension authority", async () => {
  for (const operation of [cloudCall, { ...cloudCall, arguments: { action: "status" } }]) {
    const failed = cloudReceipt({ isError: true, details: operation.arguments.action === "start" ? {} : { outcomeUncertain: true } });
    const f = fixture({ beginBackgroundOperation: async () => ({ status: "returned", result: failed }) }, { deferUnconfirmedCloudStart: true });
    try {
      await assert.rejects(f.journal.execute(operation, undefined, async () => { throw new Error("must not replay"); }), /failed write receipt/);
      assert.deepEqual(f.saved, []);
    } finally { f.journal.dispose(); }
  }
});

test("cached additive native run receipt continues the original call without replay or rewriting the frozen journal", async () => {
  const observed = cloudReceipt();
  observed.details.observedRunId = 42; observed.details.reconcilesFailedReceipt = true;
  let effects = 0;
  const f = fixture({ beginBackgroundOperation: async () => ({ status: "returned", result: observed }) }, { deferUnconfirmedCloudStart: true });
  try {
    f.journal.noteMessage({ role: "assistant", stopReason: "toolUse", timestamp: 90, content: [{ type: "toolCall", ...cloudCall }] });
    const actual = await f.journal.execute(cloudCall, undefined, async () => { effects++; return cloudReceipt(); });
    assert.equal(actual, observed); f.journal.noteMessage(actual); await f.journal.flush();
    assert.equal(effects, 0); assert.deepEqual(f.saved, []);
    assert.equal(f.snapshots.at(-1).messages.at(-1).details.observedRunId, 42);
    assert.equal(f.snapshots.at(-1).messages.at(-1).toolCallId, cloudCall.id);
    assert.equal(f.journal.signal.aborted, false);
  } finally { f.journal.dispose(); }
});

test("unconfirmed native cloud start defers an actual error without closing its original intent", async () => {
  const f = fixture({ beginBackgroundOperation: async () => ({ status: "execute" }) }, { deferUnconfirmedCloudStart: true, recoverCloudStart: async () => null });
  try {
    let pending;
    await assert.rejects(f.journal.execute(cloudCall, undefined, async () => { throw new Error("Dispatch acknowledgement lost"); }), error => { pending = error; return error.name === "BackgroundCloudLaunchPending"; });
    assert.equal(pending.receipt.toolCallId, cloudCall.id); assert.equal(pending.receipt.isError, true); assert.equal(pending.receipt.details.outcomeUncertain, true);
    assert.equal(f.saved.length, 0); assert.equal(f.journal.signal.aborted, true);
    assert.throws(() => f.journal.throwIfFailed(), error => error === pending);
  } finally { f.journal.dispose(); }
});

test("cloud deferral never catches unrelated write or cloud read errors, or delays actual recovered ACK", async () => {
  for (const operation of [call, { ...cloudCall, arguments: { action: "status", task_id: "actual" } }]) {
    const readOnly = operation.arguments.action === "status";
    const f = fixture({ beginBackgroundOperation: async () => ({ status: "execute" }) }, { deferUnconfirmedCloudStart: true, isReadOnly: () => readOnly });
    try {
      if (readOnly) assert.equal((await f.journal.execute(operation, undefined, async () => cloudReceipt({ isError: true }))).isError, true);
      else await assert.rejects(f.journal.execute(operation, undefined, async () => { throw new Error("Write response lost"); }), error => error.name !== "BackgroundCloudLaunchPending");
    }
    finally { assert.equal(f.saved.length, 1); f.journal.dispose(); }
  }
  const actual = cloudReceipt();
  const f = fixture({ beginBackgroundOperation: async () => ({ status: "execute" }) }, { deferUnconfirmedCloudStart: true, recoverCloudStart: async () => actual });
  try { assert.equal(await f.journal.execute(cloudCall, undefined, async () => { throw new Error("Lost response"); }), actual); assert.deepEqual(f.saved, [actual]); } finally { f.journal.dispose(); }
});

test("lost cloud start IPC acknowledgement recovers exact native receipt before recording a write error", async () => {
  let effects = 0, observations = 0;
  const native = cloudReceipt();
  const f = fixture({ beginBackgroundOperation: async () => ({ status: "execute" }) }, {
    recoverCloudStart: async (id) => { observations++; assert.equal(id, cloudCall.id); return native; },
  });
  try {
    const result = await f.journal.execute(cloudCall, undefined, async () => { effects++; throw new Error("IPC response lost after native persistence"); });
    assert.equal(result, native);
    assert.equal(effects, 1); assert.equal(observations, 1);
    assert.deepEqual(f.saved, [native]);
    assert.equal(f.journal.signal.aborted, false);
    assert.equal(await f.journal.execute(cloudCall, undefined, async () => { effects++; return native; }), native);
    assert.equal(effects, 1); assert.equal(observations, 1);
  } finally { f.journal.dispose(); }
});

test("unconfirmed original cloud intent uses recovery GET and never calls its execute callback", async () => {
  let effects = 0;
  const native = cloudReceipt();
  const f = fixture({ beginBackgroundOperation: async () => ({ status: "uncertain" }) }, { recoverCloudStart: async () => native });
  try {
    assert.equal(await f.journal.execute(cloudCall, undefined, async () => { effects++; return native; }), native);
    assert.equal(effects, 0); assert.deepEqual(f.saved, [native]);
  } finally { f.journal.dispose(); }
});

test("invisible run or GET failure cannot authorize another cloud dispatch or fabricate a receipt", async () => {
  for (const recoverCloudStart of [async () => null, async () => { throw new Error("GitHub GET unavailable"); }]) {
    let effects = 0;
    const f = fixture({ beginBackgroundOperation: async () => ({ status: "uncertain" }) }, { recoverCloudStart });
    try {
      await assert.rejects(f.journal.execute(cloudCall, undefined, async () => { effects++; return cloudReceipt(); }), /unknown|reconciled/);
      assert.equal(effects, 0); assert.equal(f.saved.length, 0); assert.equal(f.journal.signal.aborted, true);
    } finally { f.journal.dispose(); }
  }
});

test("missing, unreadable or mismatched subordinate receipt cannot authorize a replay or freeze success", async () => {
  const agentCall = { ...call, name: "Agent", arguments: { agents: [{ id: "coder", prompt: "Inspect" }] } };
  for (const recoverSubagentBatch of [async () => null, async () => { throw new Error("SQLite unavailable"); }, async () => ({ ...receipt(), toolName: "Agent", toolCallId: "other-call" })]) {
    const f = fixture({ beginBackgroundOperation: async () => ({ status: "uncertain" }) }, { recoverSubagentBatch });
    let effects = 0;
    try {
      await assert.rejects(f.journal.execute(agentCall, undefined, async () => { effects++; return receipt(); }), /unknown|reconciled/);
      assert.equal(effects, 0); assert.deepEqual(f.saved, []); assert.equal(f.journal.signal.aborted, true);
    } finally { f.journal.dispose(); }
  }
});

test("failed cloud tool response can use actual positive native recovery; no terminal artifact proof is invented", async () => {
  const native = cloudReceipt();
  const f = fixture({ beginBackgroundOperation: async () => ({ status: "execute" }) }, { recoverCloudStart: async () => native });
  try {
    const result = await f.journal.execute(cloudCall, undefined, async () => cloudReceipt({ isError: true, details: {}, content: [{ type: "text", text: "response unavailable" }] }));
    assert.equal(result, native); assert.equal(result.details.verified, undefined); assert.deepEqual(f.saved, [native]);
  } finally { f.journal.dispose(); }
});

test("mismatched/failed/non-start native recovery cannot close an original cloud intent", async () => {
  for (const native of [cloudReceipt({ toolCallId: "other" }), cloudReceipt({ isError: true }), cloudReceipt({ details: { kind: "cloud_task_manager", action: "status" } })]) {
    const f = fixture({ beginBackgroundOperation: async () => ({ status: "uncertain" }) }, { recoverCloudStart: async () => native });
    try {
      await assert.rejects(f.journal.execute(cloudCall, undefined, async () => { throw new Error("must not replay"); }), /mismatched/);
      assert.equal(f.saved.length, 0);
    } finally { f.journal.dispose(); }
  }
});

test("cloud recovery hook is never used for unrelated writes or cloud read calls", async () => {
  let observations = 0;
  for (const original of [call, { ...cloudCall, arguments: { action: "status", task_id: "actual" } }]) {
    const f = fixture({ beginBackgroundOperation: async () => ({ status: "uncertain" }) }, { recoverCloudStart: async () => { observations++; return cloudReceipt(); } });
    try {
      await assert.rejects(f.journal.execute(original, undefined, async () => { throw new Error("must not replay"); }), /unknown/);
    } finally { f.journal.dispose(); }
  }
  assert.equal(observations, 0);
});

test("checkpoints, intent, late receipt and compaction retain the original captured attempt", async () => {
  const claimedLease = { ...lease };
  const authorities = [];
  const f = fixture({
    async saveBackgroundCheckpoint(_id, revision, _context, authority) { authorities.push(authority); return revision; },
    async beginBackgroundOperation(_id, _call, _name, _args, authority) { authorities.push(authority); return { status: "execute" }; },
    async completeBackgroundOperation(_id, _call, _receipt, authority) { authorities.push(authority); },
    async compactBackgroundContext(_id, revision, _context, _summary, authority) { authorities.push(authority); return revision + 1; },
  }, { lease: claimedLease });
  try {
    claimedLease.generation++;
    claimedLease.attempt++;
    claimedLease.token = "22222222-2222-4222-8222-222222222222";
    await f.journal.execute(call, undefined, async () => receipt());
    await f.journal.compactContext({ systemPrompt: "summary", messages: [{ role: "user", content: "Send a report", timestamp: 1 }] }, { api: "xgent-compaction" });
    await f.journal.execute({ ...call, id: "late" }, undefined, async () => {
      f.controller.abort(); return receipt({ toolCallId: "late" });
    });
    assert.equal(authorities.length, 6);
    assert.ok(authorities.every((authority) => Object.isFrozen(authority)));
    for (const authority of authorities) assert.deepEqual(authority, lease);
  } finally { f.journal.dispose(); }
});

function fixture(overrides = {}, options = {}) {
  const events = [];
  const snapshots = [];
  const saved = [];
  const controller = new AbortController();
  const loader = createTsModuleLoader({ mocks: {
    "./backend": { backend: {
      async saveBackgroundCheckpoint(id, revision, context) {
        events.push(`checkpoint:${revision}`); snapshots.push(context); return revision;
      },
      async beginBackgroundOperation(id, callId, name, args) {
        events.push("intent"); assert.equal(id, "execution"); assert.equal(callId, call.id);
        assert.equal(name, call.name); assert.deepEqual(args, call.arguments); return { status: "execute" };
      },
      async completeBackgroundOperation(id, callId, result) { events.push("receipt"); saved.push(result); },
      ...overrides,
    } },
  } });
  const api = loader.loadModule("src/lib/automation/backgroundExecutionJournal.ts");
  const journal = api.createBackgroundExecutionJournal("execution", {
    systemPrompt: "Pinned instructions", messages: [{ role: "user", content: "Send a report", timestamp: 1 }],
  }, controller.signal, { lease, ...options });
  return { ...api, journal, events, snapshots, saved, controller };
}

test("restart recovers only the original local planning intent and never replays a phone SDK effect",async()=>{
  const operation={id:"device-planning",name:"OriginalDeviceTask",arguments:{action:"propose",branch_id:"calendar"}};
  const actual={role:"toolResult",toolCallId:operation.id,toolName:operation.name,isError:false,timestamp:2,content:[{type:"text",text:'{"queued":true,"effectCompleted":false}'}],details:{kind:"original_device_planning"}};
  let effects=0,observations=0;
  const f=fixture({beginBackgroundOperation:async()=>({status:"uncertain"}),async planOriginalDevice(id,callId,authority){observations++;assert.equal(id,"execution");assert.equal(callId,operation.id);assert.deepEqual(authority,lease);return actual;}});
  try{assert.equal(await f.journal.execute(operation,undefined,async()=>{effects++;}),actual);assert.equal(effects,0);assert.equal(observations,1);assert.equal(f.saved.length,0);}
  finally{f.journal.dispose();}
});

test("missing readonly evidence or explicit uncertain effects cannot be replaced by a positive report flag", async () => {
  const operation = { ...call, name: "Agent" };
  for (const mode of ["missing", "unknown", "explicit"]) {
    const f = fixture({ async beginBackgroundOperation() { return { status: "execute" }; } }, {
      verifySubagentBatchReadOnly: async () => { if (mode === "missing") throw new Error("store unavailable"); return mode === "explicit"; },
    });
    try {
      const result = receipt({ toolName: "Agent", isError: true, details: { readOnlyTools: true, ...(mode === "explicit" ? { outcomeUncertain: true } : {}) } });
      await assert.rejects(f.journal.execute(operation, undefined, async () => result), /write error/);
      assert.equal(f.saved[0].details.outcomeUncertain, true); assert.equal(f.journal.signal.aborted, true);
    } finally { f.journal.dispose(); }
  }
});

test("checkpoint and intent are durable before tool execution, receipt precedes the next action", async () => {
  const f = fixture();
  try {
    f.journal.noteMessage(assistant);
    const result = await f.journal.execute(call, undefined, async () => { f.events.push("external"); return receipt(); });
    f.journal.noteMessage(result);
    await f.journal.flush();
    assert.deepEqual(f.events, ["checkpoint:1", "checkpoint:2", "intent", "external", "receipt", "checkpoint:3"]);
    assert.equal(f.snapshots[1].messages[1].content[0].id, call.id);
    assert.deepEqual(f.saved, [receipt()]);
    assert.equal(f.snapshots.at(-1).messages.at(-1).toolCallId, call.id);
  } finally { f.journal.dispose(); }
});

test("concurrent repeats of an identical tool call perform the external operation once", async () => {
  const f = fixture(); let count = 0;
  try {
    const execute = async () => { count++; return receipt(); };
    const results = await Promise.all([f.journal.execute(call, undefined, execute), f.journal.execute(call, undefined, execute)]);
    assert.equal(count, 1); assert.deepEqual(results, [receipt(), receipt()]);
    assert.equal(f.events.filter((event) => event === "intent").length, 1);
    assert.equal(f.saved.length, 1);
    await assert.rejects(f.journal.execute({ ...call, arguments: { recipient: "another" } }, undefined, execute), /reused for different arguments/);
    assert.equal(count, 1);
  } finally { f.journal.dispose(); }
});

test("a persisted returned receipt is reused without re-executing an external write", async () => {
  const f = fixture({ async beginBackgroundOperation() { return { status: "returned", result: receipt() }; } });
  try {
    assert.deepEqual(await f.journal.execute(call, undefined, () => { throw new Error("must not execute"); }), receipt());
    assert.deepEqual(f.saved, []);
  } finally { f.journal.dispose(); }
});

test("an intent without a receipt blocks execution and all subsequent actions", async () => {
  const f = fixture({ async beginBackgroundOperation() { return { status: "uncertain" }; } });
  let executed = false;
  try {
    await assert.rejects(f.journal.execute(call, undefined, async () => { executed = true; return receipt(); }), /external outcome is unknown/);
    assert.equal(executed, false); assert.equal(f.journal.signal.aborted, true);
    await assert.rejects(f.journal.execute({ ...call, id: "next" }, undefined, async () => receipt()), /external outcome is unknown/);
    assert.equal(f.controller.signal.aborted, false, "host signal remains available to persist the failed conclusion");
  } finally { f.journal.dispose(); }
});

test("lost intent acknowledgement stops before the external action", async () => {
  const f = fixture({ async beginBackgroundOperation() { throw new Error("IPC acknowledgement lost"); } });
  try {
    await assert.rejects(f.journal.execute(call, undefined, () => { throw new Error("external executed"); }), /intent could not be confirmed/);
    assert.deepEqual(f.saved, []); assert.equal(f.journal.signal.aborted, true);
  } finally { f.journal.dispose(); }
});

test("checkpoint rejection or revision mismatch prevents even creating an operation intent", async () => {
  for (const saveBackgroundCheckpoint of [async () => { throw new Error("disk full"); }, async () => 4]) {
    const f = fixture({ saveBackgroundCheckpoint });
    try {
      await assert.rejects(f.journal.execute(call, undefined, async () => receipt()), /disk full|acknowledgement/);
      assert.ok(!f.events.includes("intent"));
    } finally { f.journal.dispose(); }
  }
});

test("receipt save failure stops later actions without repeating the successful write", async () => {
  const f = fixture({ async completeBackgroundOperation() { throw new Error("disk full"); } }); let count = 0;
  try {
    await assert.rejects(f.journal.execute(call, undefined, async () => { count++; return receipt(); }), /returned but its receipt could not be confirmed/);
    await assert.rejects(f.journal.execute(call, undefined, async () => { count++; return receipt(); }), /Do not replay/);
    assert.equal(count, 1);
  } finally { f.journal.dispose(); }
});

test("cancellation during an external action still saves its late receipt", async () => {
  const f = fixture();
  try {
    const result = await f.journal.execute(call, f.journal.signal, async () => { f.controller.abort(); return receipt(); });
    assert.deepEqual(result, receipt()); assert.deepEqual(f.saved, [receipt()]);
    await assert.rejects(f.journal.flush(), /abort/i);
  } finally { f.journal.dispose(); }
});

test("a thrown tool records an uncertain error and stops rather than claiming rollback", async () => {
  const f = fixture();
  try {
    await assert.rejects(f.journal.execute(call, undefined, async () => { throw new Error("connection lost after send"); }), /does not prove that external effects were rolled back/);
    assert.equal(f.saved[0].isError, true); assert.equal(f.saved[0].details.outcomeUncertain, true);
    assert.match(f.saved[0].content[0].text, /connection lost after send/);
  } finally { f.journal.dispose(); }
});

test("mismatched tool receipts are never committed as evidence for another operation", async () => {
  const f = fixture();
  try {
    await assert.rejects(f.journal.execute(call, undefined, async () => receipt({ toolCallId: "other" })), /invalid operation receipt/);
    assert.deepEqual(f.saved, []);
  } finally { f.journal.dispose(); }
});

test("large receipts preserve a verifiable digest and explicit omission while fitting the native quota", () => {
  const f = fixture();
  try {
    const full = receipt({ content: [{ type: "text", text: "文".repeat(100_000) }, { type: "image", data: "a".repeat(200_000), mimeType: "image/png" }], details: { large: "b".repeat(100_000) } });
    const reduced = f.backgroundReceipt(full);
    assert.equal(reduced.details.receiptHash, createHash("sha256").update(JSON.stringify(full)).digest("hex"));
    assert.equal(reduced.details.receiptTruncated, true);
    assert.match(reduced.content[0].text, /do not replay external writes/);
    assert.ok(Buffer.byteLength(JSON.stringify(reduced)) < 256 * 1024);
    assert.deepEqual(f.backgroundReceipt(receipt()), receipt());
    const uncertain = f.backgroundReceipt({ ...full, isError: true, details: { ...full.details, outcomeUncertain: true } });
    assert.equal(uncertain.details.outcomeUncertain, true, "the native completion guard must see uncertainty even if large details were omitted");
  } finally { f.journal.dispose(); }
});

test("oversized context halts before another tool rather than silently dropping requirements", async () => {
  const f = fixture();
  try {
    await f.journal.flush();
    f.journal.noteMessage({ role: "assistant", content: [{ type: "text", text: "x".repeat(4 * 1024 * 1024) }], timestamp: 2 });
    await assert.rejects(f.journal.execute(call, undefined, async () => receipt()), /context exceeded 4 MiB/);
    assert.ok(!f.events.includes("intent"));
  } finally { f.journal.dispose(); }
});

test("canonical runner checkpoints replace callback copies and retain updated system instructions", async () => {
  const f = fixture();
  try {
    f.journal.noteMessage(assistant);
    await f.journal.checkpointContext({ systemPrompt: "Runner instructions and tool policy", messages: [
      { role: "user", content: "Original requirements", timestamp: 1 }, assistant, receipt(),
    ] });
    await f.journal.checkpointMessages([{ role: "user", content: "Original requirements", timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "Canonical final result" }], timestamp: 2 }]);
    const saved = f.snapshots.at(-1);
    assert.equal(saved.systemPrompt, "Runner instructions and tool policy");
    assert.equal(saved.messages.length, 2);
    assert.equal(saved.messages[1].content[0].text, "Canonical final result");
    assert.deepEqual(f.events, ["checkpoint:1", "checkpoint:2", "checkpoint:3", "checkpoint:4"]);
  } finally { f.journal.dispose(); }
});

test("returned write errors are persisted as uncertain and stop automatic retry", async () => {
  const f = fixture();
  try {
    await assert.rejects(f.journal.execute(call, undefined, async () => receipt({ isError: true,
      content: [{ type: "text", text: "Network timeout after request" }] })), /external outcome may be uncertain/);
    assert.equal(f.saved[0].details.outcomeUncertain, true);
    assert.match(f.saved[0].content[0].text, /Network timeout/);
    assert.equal(f.journal.signal.aborted, true);
    assert.equal(f.controller.signal.aborted, false);
  } finally { f.journal.dispose(); }
});

test("read-only error receipts remain available to the model for recovery", async () => {
  const f = fixture({}, { isReadOnly: () => true });
  try {
    const result = await f.journal.execute(call, undefined, async () => receipt({ isError: true }));
    assert.equal(result.isError, true);
    assert.equal(result.details, undefined);
    assert.equal(f.journal.signal.aborted, false);
    assert.equal(f.saved.length, 1);
  } finally { f.journal.dispose(); }
});

test("a thrown host-classified read saves failure evidence and permits a different observation without replay", async () => {
  const f=fixture({beginBackgroundOperation:async()=>({status:"execute"})}, {isReadOnly:operation=>operation.name==="Read"});
  const missing={id:"read-missing",name:"Read",arguments:{path:"missing.txt"}};
  let reads=0;
  try {
    const failure=await f.journal.execute(missing,undefined,async()=>{reads++;throw new Error("Original input path is unavailable");});
    assert.equal(failure.isError,true);assert.equal(failure.details.outcomeUncertain,false);
    assert.match(failure.content[0].text,/Original input path is unavailable/);
    assert.equal(f.journal.signal.aborted,false);assert.deepEqual(f.saved,[failure]);
    assert.equal(await f.journal.execute(missing,undefined,async()=>assert.fail("Do not replay the original read")),failure);
    const observed={...missing,id:"read-accepted",arguments:{path:"accepted-input.txt"}};
    const actual=receipt({toolCallId:observed.id,toolName:observed.name,content:[{type:"text",text:"Actual accepted document"}]});
    assert.equal(await f.journal.execute(observed,undefined,async()=>{reads++;return actual;}),actual);
    assert.equal(reads,2);assert.deepEqual(f.saved,[failure,actual]);f.journal.throwIfFailed();
  } finally {f.journal.dispose();}
});

test("read exception recovery still requires durable receipts and honors cancellation",async()=>{
  const operation={id:"read",name:"Read",arguments:{path:"input.txt"}};
  const unavailable=fixture({beginBackgroundOperation:async()=>({status:"execute"}),completeBackgroundOperation:async()=>{throw new Error("Receipt disk unavailable");}},{isReadOnly:()=>true});
  try {
    await assert.rejects(unavailable.journal.execute(operation,undefined,async()=>{throw new Error("Read failed");}),/receipt could not be confirmed/);
    await assert.rejects(unavailable.journal.execute({...operation,id:"second"},undefined,async()=>assert.fail("No more observations")),/receipt could not be confirmed/);
  } finally {unavailable.journal.dispose();}
  for(const [parent,mode] of [[false,"throw"],[true,"throw"],[true,"undefined"],[true,"returned"]]) {
    const f=fixture({beginBackgroundOperation:async()=>({status:"execute"})}, {isReadOnly:()=>true});const cancellation=new AbortController();
    try {
      await assert.rejects(f.journal.execute(operation,cancellation.signal,async()=>{
        (parent?f.controller:cancellation).abort(new Error("Explicit stop"));
        if(mode==="returned")return receipt({toolCallId:operation.id,toolName:operation.name,isError:true});
        if(mode==="undefined")throw undefined;
        throw new Error("Read interrupted");
      }),/Explicit stop/);
      assert.equal(f.saved.length,1);assert.equal(f.saved[0].isError,true);
    } finally {f.journal.dispose();}
  }
});

test("cached failed write receipts cannot bypass the uncertain-outcome stop", async () => {
  const f = fixture({ async beginBackgroundOperation() { return { status: "returned", result: receipt({ isError: true }) }; } });
  try {
    await assert.rejects(f.journal.execute(call, undefined, () => { throw new Error("must not replay"); }), /failed write receipt/);
    assert.equal(f.journal.signal.aborted, true);
    assert.deepEqual(f.saved, []);
  } finally { f.journal.dispose(); }
});

test("compaction waits for the acknowledged source and preserves completed operation caching", async () => {
  let acknowledge;
  const f = fixture({ async compactBackgroundContext(id, sourceRevision, context, summary) {
    assert.equal(id, "execution"); assert.equal(sourceRevision, 3);
    assert.equal(context.systemPrompt, "New summary and policy");
    assert.equal(summary.api, "xgent-compaction");
    f.events.push("compact:4"); return new Promise((resolve) => { acknowledge = resolve; });
  } });
  let count = 0;
  try {
    f.journal.noteMessage(assistant);
    const result = await f.journal.execute(call, undefined, async () => { count++; return receipt(); });
    f.journal.noteMessage(result);
    const next = { systemPrompt: "New summary and policy", messages: [{ role: "user", content: "Send a report", timestamp: 1 }] };
    let returned = false;
    const pending = f.journal.compactContext(next, { api: "xgent-compaction" }).then(() => { returned = true; });
    while (!acknowledge) await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(returned, false); assert.equal(f.snapshots.length, 3);
    acknowledge(4); await pending;
    assert.deepEqual(await f.journal.execute(call, undefined, async () => { count++; return receipt(); }), receipt());
    assert.equal(count, 1, "compression must not forget an already executed write");
    f.journal.noteMessage({ role: "assistant", content: [{ type: "text", text: "Continue" }], timestamp: 4 });
    await f.journal.flush();
    assert.equal(f.events.at(-1), "checkpoint:5");
    assert.equal(f.snapshots.at(-1).systemPrompt, next.systemPrompt);
    assert.equal(f.snapshots.at(-1).messages.length, 2);
  } finally { f.journal.dispose(); }
});

test("archive failure or wrong acknowledgement aborts before another operation", async () => {
  for (const compactBackgroundContext of [async () => { throw new Error("archive disk full"); }, async () => 100]) {
    const f = fixture({ compactBackgroundContext });
    try {
      await assert.rejects(f.journal.compactContext({ systemPrompt: "summary", messages: [] }, {}), /disk full|acknowledgement/);
      assert.equal(f.journal.signal.aborted, true);
      await assert.rejects(f.journal.execute(call, undefined, async () => receipt()), /disk full|acknowledgement/);
      assert.equal(f.snapshots.length, 1); assert.ok(!f.events.includes("intent"));
    } finally { f.journal.dispose(); }
  }
});

test("cancellation after archive commit prevents adopting and executing from the replacement", async () => {
  const f = fixture({ async compactBackgroundContext() { f.controller.abort(); return 2; } });
  try {
    await assert.rejects(f.journal.compactContext({ systemPrompt: "summary", messages: [] }, {}), /abort/i);
    await assert.rejects(f.journal.flush(), /abort/i);
    assert.equal(f.snapshots.length, 1); assert.ok(!f.events.includes("intent"));
  } finally { f.journal.dispose(); }
});

test("messages, checkpoint replacements and new actions cannot race an archive transaction", async () => {
  for (const action of ["message", "checkpoint", "operation", "compaction"]) {
    let acknowledge;
    const f = fixture({ compactBackgroundContext: () => new Promise((resolve) => { acknowledge = resolve; }) });
    try {
      const pending = f.journal.compactContext({ systemPrompt: "summary", messages: [] }, {});
      const stopped = assert.rejects(pending, /compaction|replacing/);
      while (!acknowledge) await new Promise((resolve) => setTimeout(resolve, 1));
      if (action === "message") f.journal.noteMessage(assistant);
      if (action === "checkpoint") await assert.rejects(f.journal.checkpointContext({ systemPrompt: "other", messages: [] }), /compaction/);
      if (action === "operation") await assert.rejects(f.journal.execute(call, undefined, async () => receipt()), /compaction/);
      if (action === "compaction") await assert.rejects(f.journal.compactContext({ systemPrompt: "other", messages: [] }, {}), /compaction/);
      acknowledge(2); await stopped;
      assert.equal(f.snapshots.length, 1); assert.ok(!f.events.includes("intent"));
    } finally { f.journal.dispose(); }
  }
});
