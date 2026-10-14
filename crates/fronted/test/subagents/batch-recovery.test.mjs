import assert from "node:assert/strict";
import test from "node:test";
import { createAgentToolCall, createAssistant, createSubagentHarness } from "./harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
const plain = value => JSON.parse(JSON.stringify(value));

async function completed(mode = "readonly") {
  const h = await createSubagentHarness({ persistBatchReceipts: true, providerConfigId: "original" });
  const call = createAgentToolCall({ agents: [{ id: "reviewer", prompt: " Inspect actual inputs ", mode,
    ...(mode === "worktree" ? { apply_policy: "auto" } : {}) }, { id: "writer", prompt: "Report independent findings" }] });
  const result = await h.bundle.executeToolCall(call);
  const fresh = h.storeModule.createSubagentConversationStore({ conversationId: h.store.conversationId, ipc: h.storeIpc });
  return { h, call, result, fresh };
}

test("fresh store recovers exact settled readonly/worktree batch without starting models or worktree operations", async () => {
  for (const mode of ["readonly", "worktree"]) {
    const { h, call, result, fresh } = await completed(mode);
    assert.equal(result.isError, false);
    const before = h.runnerCalls.length;
    const worktreeCounts = [h.worktreeIpc.creates.length, h.worktreeIpc.applies.length, h.worktreeIpc.cleanups.length];
    if (mode === "worktree") assert.equal(h.worktreeIpc.applies.length, 1);
    const recovered = await fresh.recoverBatchReceipt(call);
    assert.deepEqual(plain(recovered), plain(result));
    assert.equal(h.runnerCalls.length, before);
    assert.deepEqual([h.worktreeIpc.creates.length, h.worktreeIpc.applies.length, h.worktreeIpc.cleanups.length], worktreeCounts);
    const other = h.storeModule.createSubagentConversationStore({ conversationId: "another-owner", ipc: h.storeIpc });
    assert.equal(await other.recoverBatchReceipt(call), null);
    assert.equal(await fresh.recoverBatchReceipt({ ...call, id: "different-call" }), null);
    assert.equal(await fresh.recoverBatchReceipt({ ...call, arguments: { ...call.arguments, concurrency: 1 } }), null);
    assert.equal(await fresh.recoverBatchReceipt({ ...call, arguments: { agents: [{ id: "reviewer", prompt: "Different request" }] } }), null);
  }
});

test("full terminal proof is required; partial, missing, wrong account and forged report records never become success", async () => {
  for (const mutation of ["running", "missing", "account", "report"]) {
    const { h, call, result, fresh } = await completed();
    const id = result.details.agents[1].runId;
    const record = h.storeIpc.runs.get(id);
    if (mutation === "running") record.run.status = "running";
    if (mutation === "missing") h.storeIpc.runs.delete(id);
    if (mutation === "account") record.run.providerConfigId = "different";
    if (mutation === "report") {
      const first = h.storeIpc.runs.get(result.details.agents[0].runId);
      const payload = JSON.parse(first.run.batchReceiptJson);
      payload.receipt.details.agents[1].runId = payload.receipt.details.agents[0].runId;
      first.run.batchReceiptJson = JSON.stringify(payload);
    }
    await assert.rejects(fresh.recoverBatchReceipt(call), /does not match its completed runs/);
    assert.equal(h.runnerCalls.length, 2);
  }
});

test("ordinary Agent batches preserve the legacy save path and have no new recovery receipt", async () => {
  const h = await createSubagentHarness();
  const call = createAgentToolCall({ agents: [{ id: "legacy", prompt: "Inspect" }] });
  assert.equal((await h.bundle.executeToolCall(call)).isError, false);
  assert.equal(h.bundle.recoverToolCall, undefined);
  assert.equal(await h.store.recoverBatchReceipt(call), null);
  assert.ok([...h.storeIpc.runs.values()].every(record => record.run.batchReceiptJson === undefined));
});

async function mixed({ strict = true, firstFails = false, persist = true } = {}) {
  const h = await createSubagentHarness({ persistBatchReceipts: persist, providerConfigId: "original", forceReadonly: strict,
    runner: async (params, index) => {
      if ((index === 1) === firstFails) throw new Error("model quota temporarily unavailable");
      const assistant = createAssistant("actual independent findings");
      return { assistant, messages: [assistant], emittedMessages: [assistant] };
    },
  });
  const call = createAgentToolCall({ agents: [{ id: "research", prompt: "Read documents", mode: "readonly" }, { id: "review", prompt: "Review requirements", mode: "readonly" }] });
  const result = await h.bundle.executeToolCall(call);
  const fresh = h.storeModule.createSubagentConversationStore({ conversationId: h.store.conversationId, ipc: h.storeIpc });
  return { h, call, result, fresh };
}

test("mixed terminal batch keeps the exact failed/completed reports, including a failed first member, across a fresh store", async () => {
  for (const firstFails of [false, true]) {
    const { h, call, result, fresh } = await mixed({ firstFails });
    assert.equal(result.isError, true);
    assert.equal(result.details.agents.filter(agent => agent.status === "completed").length, 1);
    assert.equal(result.details.agents.filter(agent => agent.status === "failed").length, 1);
    assert.equal(result.details.agents.every(agent => agent.readOnlyTools === true), true);
    assert.deepEqual(plain(await fresh.recoverBatchReceipt(call)), plain(result));
    assert.equal(await fresh.verifyReadOnlyBatchReceipt(call, result), true);
    assert.equal(h.runnerCalls.length, 2);
    assert.equal(h.worktreeIpc.applies.length, 0);
    const forged = structuredClone(result); forged.isError = false;
    assert.equal(await fresh.verifyReadOnlyBatchReceipt(call, forged), false);
    h.storeIpc.runs.get(result.details.agents[1].runId).run.error = "another error";
    await assert.rejects(fresh.recoverBatchReceipt(call), /terminal failures/);
  }
});

test("readonly mode carrying write-capable MCP tools cannot attest safe effects or become safe through forged report metadata", async () => {
  const { h, call, result, fresh } = await mixed({ strict: false });
  assert.ok(h.runnerCalls[0].tools.some(tool => tool.name === "mcp_docs_search"));
  assert.equal(result.details.agents.every(agent => agent.readOnlyTools === false), true);
  assert.deepEqual(plain(await fresh.recoverBatchReceipt(call)), plain(result));
  assert.equal(await fresh.verifyReadOnlyBatchReceipt(call, result), false);
  const forged = structuredClone(result); forged.details.agents.forEach(agent => { agent.readOnlyTools = true; });
  assert.equal(await fresh.verifyReadOnlyBatchReceipt(call, forged), false);
});

test("actual strict readonly failure reaches the parent journal on live/uncertain/returned paths without replay or invented success", async () => {
  const { h, call, result, fresh } = await mixed();
  for (const status of ["execute", "uncertain", "returned"]) {
    const saved = []; let effects = 0;
    const loader = createTsModuleLoader({ mocks: { "./backend": { backend: {
      async saveBackgroundCheckpoint(_id, revision) { return revision; },
      async beginBackgroundOperation() { return { status, ...(status === "returned" ? { result } : {}) }; },
      async completeBackgroundOperation(_id, _call, receipt) { saved.push(plain(receipt)); },
    } } } });
    const { createBackgroundExecutionJournal } = loader.loadModule("src/lib/automation/backgroundExecutionJournal.ts");
    const journal = createBackgroundExecutionJournal("execution", { systemPrompt: "Accepted", messages: [] }, new AbortController().signal, {
      lease: { attempt: 1, generation: 1, token: "11111111-1111-4111-8111-111111111111" },
      recoverSubagentBatch: c => fresh.recoverBatchReceipt(c),
      verifySubagentBatchReadOnly: (c, receipt) => fresh.verifyReadOnlyBatchReceipt(c, receipt),
    });
    try {
      const received = await journal.execute(call, undefined, async () => { effects++; return result; });
      assert.equal(received.isError, true);
      assert.equal(received.details.outcomeUncertain, undefined);
      assert.equal(journal.signal.aborted, false);
      assert.equal(effects, status === "execute" ? 1 : 0);
      assert.deepEqual(saved, status === "returned" ? [] : [plain(result)]);
      assert.equal(h.runnerCalls.length, 2);
    } finally { journal.dispose(); }
  }
});

test("write-capable proof retains actual failure receipt and halts subsequent actions", async () => {
  for (const status of ["execute", "uncertain", "returned"]) {
    const { h, call, result, fresh } = await mixed({ strict: false });
    const saved = []; let effects = 0;
    const loader = createTsModuleLoader({ mocks: { "./backend": { backend: {
      async saveBackgroundCheckpoint(_id, revision) { return revision; },
      async beginBackgroundOperation() { return { status, ...(status === "returned" ? { result } : {}) }; },
      async completeBackgroundOperation(_id, _call, receipt) { saved.push(plain(receipt)); },
    } } } });
    const { createBackgroundExecutionJournal } = loader.loadModule("src/lib/automation/backgroundExecutionJournal.ts");
    const journal = createBackgroundExecutionJournal("execution", { systemPrompt: "Accepted", messages: [] }, new AbortController().signal, {
      lease: { attempt: 1, generation: 1, token: "11111111-1111-4111-8111-111111111111" },
      recoverSubagentBatch: c => fresh.recoverBatchReceipt(c),
      verifySubagentBatchReadOnly: (c, receipt) => fresh.verifyReadOnlyBatchReceipt(c, receipt),
    });
    try {
      await assert.rejects(journal.execute(call, undefined, async () => { effects++; return result; }), /external|write error|write receipt/);
      assert.equal(journal.signal.aborted, true);
      await assert.rejects(journal.execute(call, undefined, async () => { effects++; return result; }));
      assert.equal(effects, status === "execute" ? 1 : 0);
      if (status !== "returned") {
        assert.equal(saved[0].isError, true); assert.equal(saved[0].details.outcomeUncertain, true);
        assert.deepEqual(saved[0].details.agents, plain(result.details.agents));
      }
      assert.equal(h.runnerCalls.length, 2);
    } finally { journal.dispose(); }
  }
});

test("large terminal report is restored through its actual immutable journal digest; mismatches cannot authorize recovery", async () => {
  for (const mismatch of [false, true]) {
    const { h, call, result, fresh } = await mixed({ persist: false });
    const full = { ...result, content: [{ type: "text", text: "Actual retained batch detail. ".repeat(8000) }] };
    await fresh.saveBatchReceipt(call, full);
    const loader = createTsModuleLoader({ mocks: { "./backend": { backend: {
      async saveBackgroundCheckpoint(_id, revision) { return revision; },
      async beginBackgroundOperation() { return { status: "returned", result: native }; },
    } } } });
    const { createBackgroundExecutionJournal, backgroundReceipt } = loader.loadModule("src/lib/automation/backgroundExecutionJournal.ts");
    const native = backgroundReceipt(full); assert.equal(native.details.receiptTruncated, true);
    if (mismatch) native.details.receiptHash = "invalid";
    const journal = createBackgroundExecutionJournal("execution", { systemPrompt: "Accepted", messages: [] }, new AbortController().signal, {
      lease: { attempt: 1, generation: 1, token: "11111111-1111-4111-8111-111111111111" },
      recoverSubagentBatch: c => fresh.recoverBatchReceipt(c),
      verifySubagentBatchReadOnly: (c, receipt) => fresh.verifyReadOnlyBatchReceipt(c, receipt),
    });
    try {
      const operation = journal.execute(call, undefined, async () => assert.fail("must not replay"));
      if (mismatch) await assert.rejects(operation, /frozen receipt digest/);
      else assert.deepEqual(plain(await operation), plain(full));
      assert.equal(h.runnerCalls.length, 2);
    } finally { journal.dispose(); }
  }
});

test("background subordinate IPC stays on the captured host when global UI invocation targets another device", async () => {
  const calls = [];
  const loader = createTsModuleLoader({ mocks: { "@xgent/runtime": { invoke() { throw new Error("Wrong global UI peer"); } } } });
  const { createTauriSubagentStoreIpc } = loader.loadModule("src/lib/subagents/ipc/store.ts");
  const ipc = createTauriSubagentStoreIpc(async (command, args) => {
    calls.push({ command, args: plain(args) });
    if (command === "subagent_run_load") return null;
    if (command === "subagent_run_list") return [];
  });
  assert.equal(await ipc.loadRun("original-run"), null);
  assert.deepEqual(plain(await ipc.listRuns({ parentConversationId: "background:original", parentToolCallId: "original-call" })), []);
  await ipc.saveRun({ run: { id: "original-run" }, segments: [] });
  assert.deepEqual(calls.map(c => c.command), ["subagent_run_load", "subagent_run_list", "subagent_run_save"]);
  assert.equal(calls[1].args.input.parentToolCallId, "original-call");
});

test("uncertain parent Agent intent uses real saved batch receipt and completes journal without replay", async () => {
  const { h, call, result, fresh } = await completed();
  const saved = []; let effects = 0;
  const loader = createTsModuleLoader({ mocks: { "./backend": { backend: {
    async saveBackgroundCheckpoint(executionId, revision) { return revision; },
    async beginBackgroundOperation() { return { status: "uncertain" }; },
    async completeBackgroundOperation(executionId, callId, receipt) { saved.push({ executionId, callId, receipt: plain(receipt) }); },
  } } } });
  const { createBackgroundExecutionJournal } = loader.loadModule("src/lib/automation/backgroundExecutionJournal.ts");
  const journal = createBackgroundExecutionJournal("execution", { systemPrompt: "Accepted", messages: [] }, new AbortController().signal, {
    lease: { attempt: 1, generation: 1, token: "11111111-1111-4111-8111-111111111111" },
    recoverSubagentBatch: c => fresh.recoverBatchReceipt(c),
  });
  try {
    const recovered = await journal.execute(call, undefined, async () => { effects++; return result; });
    assert.deepEqual(plain(recovered), plain(result));
    assert.deepEqual(saved, [{ executionId: "execution", callId: call.id, receipt: plain(result) }]);
    assert.equal(effects, 0); assert.equal(h.runnerCalls.length, 2);
  } finally { journal.dispose(); }
});
