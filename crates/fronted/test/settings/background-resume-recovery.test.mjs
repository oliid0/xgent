import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const peerId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const waitId = "33333333-3333-4333-8333-333333333333";
const childExecution = "44444444-4444-4444-8444-444444444444";
const executionId = "55555555-5555-4555-8555-555555555555";
const call = { id: "original-response", name: "BackgroundTask", arguments: {
  action: "resume", request_id: requestId, peer_id: peerId, wait_id: waitId,
  response: "Original request specifies tomorrow at 10:00.",
} };
const lease = { attempt: 1, generation: 1, token: peerId };

function setup({ status = "execute", reply, recovery, saveFails = false, nativeChild = false, returnedReceipt } = {}) {
  let sends = 0, reads = 0;
  const saved = [], inputs = [];
  let module;
  const backend = {
    async resolveBackgroundPeer() { return null; },
    async beginBackgroundOperation() { return { status, result: returnedReceipt }; },
    async saveBackgroundCheckpoint(_id, revision) { return revision; },
    async resumeBackgroundTask(input, peer) {
      sends++; inputs.push([structuredClone(input), peer]);
      throw new Error("Receiver committed the response but RPC ACK was lost");
    },
    async readBackgroundResumeReceipt(input, peer) {
      reads++; inputs.push([structuredClone(input), peer]);
      const actual = { version: 1, hostId: peerId, executionId: childExecution,
        acceptedAt: 100, input: { ...input } };
      return reply ? reply(actual) : actual;
    },
    async resumeBackgroundChild(scope, id, input, peer, authority) {
      assert.equal(scope, executionId); assert.equal(id, call.id); assert.deepEqual(authority, lease);
      sends++; inputs.push([structuredClone(input), peer]);
      throw new Error("Native reservation exists; original response ACK is pending");
    },
    async readBackgroundChildResumeReceipt(scope, id, authority) {
      assert.equal(scope, executionId); assert.equal(id, call.id); assert.deepEqual(authority, lease);
      const input = { requestId, waitId, resumeId: module.backgroundRequestId(call.id, executionId), response: call.arguments.response };
      return backend.readBackgroundResumeReceipt(input, peerId);
    },
    async completeBackgroundOperation(_id, _call, receipt) {
      if (saveFails) throw new Error("Parent receipt persistence failed");
      saved.push(structuredClone(receipt));
    },
  };
  const loader = createTsModuleLoader({ mocks: {
    "../automation/backend": { backend }, "./backend": { backend },
    "@xgent/runtime": { isTauriRuntime: () => true, getLanPcCommandHostConfig: () => ({ enabled: false }) },
  } });
  module = loader.loadModule("src/lib/tools/backgroundTaskTools.ts");
  const tools = module.createBackgroundTaskTools({ workdir: "/pinned/workspace", requestScope: executionId,
    ...(nativeChild ? { backgroundLease: lease, backgroundContext: { rootRequestId: requestId, requestId, hostIds: [executionId] } } : {}),
  });
  const context = { systemPrompt: "Original task", messages: [] };
  const parent = new AbortController();
  const journal = loader.loadModule("src/lib/automation/backgroundExecutionJournal.ts")
    .createBackgroundExecutionJournal(executionId, context, parent.signal, {
      lease, recoverBackgroundResume: recovery ?? tools.recoverToolCall, deferUnconfirmedChildStart: nativeChild,
    });
  return { journal, tools, saved, inputs, parent, module,
    counts: () => ({ sends, reads }), run: c => journal.execute(c ?? call, undefined, () => tools.executeToolCall(c ?? call)),
  };
}

test("lost response ACK reads the exact native acceptance and continues without resending or claiming child completion", async () => {
  const f = setup();
  try {
    const result = await f.run();
    assert.equal(result.isError, false); assert.equal(result.details.reconciledResume, true);
    assert.equal(result.details.result.result.status, "response_accepted");
    assert.equal(result.details.result.result.receipt.executionId, childExecution);
    assert.deepEqual(f.counts(), { sends: 1, reads: 1 });
    assert.deepEqual(f.inputs[0], f.inputs[1]);
    assert.equal(f.saved.length, 1); assert.deepEqual(f.saved[0], result);
    assert.equal(f.journal.signal.aborted, false); f.journal.throwIfFailed();
    const replay = await f.run(); assert.deepEqual(replay, result);
    assert.deepEqual(f.counts(), { sends: 1, reads: 1 });
    assert.equal(result.details.result.result.receipt.input.resumeId,
      f.module.backgroundRequestId(call.id, executionId));
    assert.equal("success" in result.details.result.result.receipt, false);
    assert.equal("outcomes" in result.details.result.result.receipt, false);
  } finally { f.journal.dispose(); }
});

test("an original intent without a local receipt can be settled only by receiver evidence, with zero resume calls", async () => {
  const f = setup({ status: "uncertain" });
  try {
    const result = await f.run(); assert.equal(result.isError, false);
    assert.deepEqual(f.counts(), { sends: 0, reads: 1 });
    assert.equal(f.saved.length, 1); assert.equal(f.journal.signal.aborted, false);
  } finally { f.journal.dispose(); }
});

test("an accepted worker uses the native reserved response and native receipt route rather than sending from the WebView", async () => {
  const f = setup({ nativeChild: true });
  try {
    const result = await f.run(); assert.equal(result.isError, false);
    assert.deepEqual(f.counts(), { sends: 1, reads: 1 });
    assert.deepEqual(f.inputs[0], f.inputs[1]); assert.equal(f.saved.length, 1);
  } finally { f.journal.dispose(); }
});

test("an unconfirmed reserved response parks its original model tail before writing a failure; an actual native wake delivers the ACK without another send", async () => {
  const f = setup({ nativeChild: true, reply: () => null });
  try {
    await assert.rejects(f.run(), error => error.name === "BackgroundChildLaunchPending" && error.receipt.details.outcomeUncertain === true);
    assert.deepEqual(f.counts(), { sends: 1, reads: 1 }); assert.equal(f.saved.length, 0);
  } finally { f.journal.dispose(); }
  // Native begin reads a real confirmed row after the parked execution wakes.
  // SQLite/view/group joining is exercised in the backend persistence suite;
  // this controlled port verifies the actual journal's resumed behavior.
  const actual = setup({ nativeChild: true, status: "uncertain" }); let receipt;
  try { receipt = await actual.run(); } finally { actual.journal.dispose(); }
  const resumed = setup({ nativeChild: true, status: "returned", returnedReceipt: receipt });
  try {
    assert.deepEqual(await resumed.run(), receipt);
    assert.deepEqual(resumed.counts(), { sends: 0, reads: 0 }); assert.equal(resumed.saved.length, 0);
    assert.equal(resumed.journal.signal.aborted, false);
  } finally { resumed.journal.dispose(); }
});

test("unavailable native response evidence retains parking authority rather than converting the original intent to terminal failure", async () => {
  const f = setup({ nativeChild: true, status: "uncertain", reply: () => { throw new Error("Native receipt read unavailable"); } });
  try {
    await assert.rejects(f.run(), error => error.name === "BackgroundChildLaunchPending" && error.receipt.details.outcomeUncertain === true);
    assert.deepEqual(f.counts(), { sends: 0, reads: 1 }); assert.equal(f.saved.length, 0);
  } finally { f.journal.dispose(); }
});

test("absent or unavailable receiver evidence retains uncertainty and stops later actions", async () => {
  for (const status of ["execute", "uncertain"])
    for (const reply of [() => null, () => { throw new Error("Original device offline"); }]) {
      const f = setup({ status, reply });
      try {
        await assert.rejects(f.run());
        assert.equal(f.journal.signal.aborted, true);
        assert.deepEqual(f.counts(), { sends: status === "execute" ? 1 : 0, reads: 1 });
        if (status === "execute") {
          assert.equal(f.saved.length, 1);
          assert.equal(f.saved[0].isError, true); assert.equal(f.saved[0].details.outcomeUncertain, true);
        } else assert.equal(f.saved.length, 0);
        await assert.rejects(f.run());
        assert.deepEqual(f.counts(), { sends: status === "execute" ? 1 : 0, reads: 1 });
      } finally { f.journal.dispose(); }
    }
});

test("different owner, response, task, occurrence, ID, malformed metadata or injected input cannot replace the original effect", async () => {
  const patches = [
    value => ({ ...value, hostId: requestId }), value => ({ ...value, executionId: "invented" }),
    value => ({ ...value, version: 2 }), value => ({ ...value, acceptedAt: -1 }),
    value => ({ ...value, acceptedAt: Number.MAX_SAFE_INTEGER + 1 }),
    ...["requestId", "waitId", "resumeId", "response"].map(key => value => ({ ...value, input: { ...value.input, [key]: "different" } })),
    value => ({ ...value, input: { ...value.input, permissions: "granted" } }),
    value => ({ ...value, input: null }),
  ];
  for (const reply of patches) {
    const f = setup({ status: "uncertain", reply });
    try {
      await assert.rejects(f.run(), /could not be reconciled/);
      assert.equal(f.saved.length, 0); assert.deepEqual(f.counts(), { sends: 0, reads: 1 });
      assert.equal(f.journal.signal.aborted, true);
    } finally { f.journal.dispose(); }
  }
});

test("a forged hook flag is insufficient; journal independently binds the saved native input to its own execution scope", async () => {
  for (const change of [value => { value.toolCallId = "another-call"; },
    value => { value.details.result.result.receipt.input.resumeId = "wrong-scope"; },
    value => { value.details.outcomeUncertain = true; },
    value => { value.details.result.result.status = "completed"; }]) {
    let f;
    f = setup({ status: "uncertain", recovery: async c => {
      const result = await f.tools.recoverToolCall(c); change(result); return result;
    } });
    try {
      await assert.rejects(f.run(), /could not be reconciled/);
      assert.equal(f.saved.length, 0); assert.deepEqual(f.counts(), { sends: 0, reads: 1 });
    } finally { f.journal.dispose(); }
  }
});

test("unknown owner and unrelated tools/actions cannot use receipt discovery as automatic authority", async () => {
  for (const modified of [{ ...call, arguments: { ...call.arguments, peer_id: undefined } },
    { ...call, name: "SendMail" }, { ...call, arguments: { ...call.arguments, action: "submit" } },
    { ...call, arguments: { ...call.arguments, response: "x".repeat(32769) } }]) {
    const f = setup({ status: "uncertain" });
    try {
      await assert.rejects(f.run(modified));
      assert.deepEqual(f.counts(), { sends: 0, reads: 0 }); assert.equal(f.saved.length, 0);
    } finally { f.journal.dispose(); }
  }
});

test("parent cancellation while receipt is being read cannot start continuation; failed parent persistence also stops", async () => {
  let f;
  f = setup({ status: "uncertain", reply: value => { f.parent.abort(new Error("Original parent stopped")); return value; } });
  try {
    await assert.rejects(f.run()); assert.equal(f.saved.length, 0);
    assert.deepEqual(f.counts(), { sends: 0, reads: 1 });
  } finally { f.journal.dispose(); }
  const broken = setup({ status: "uncertain", saveFails: true });
  try {
    await assert.rejects(broken.run(), /persistence failed/);
    assert.equal(broken.journal.signal.aborted, true); assert.equal(broken.saved.length, 0);
    assert.deepEqual(broken.counts(), { sends: 0, reads: 1 });
  } finally { broken.journal.dispose(); }
});
