import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const { restoreBackgroundContext } = createTsModuleLoader().loadModule("src/lib/automation/backgroundResume.ts");
const prompt = "Create the report and arrange tomorrow";
const user = { role: "user", content: prompt, timestamp: 1 };
const call = { type: "toolCall", id: "send-42", name: "SendMail", arguments: { to: "owner@example.test" } };
const assistant = { role: "assistant", content: [call], stopReason: "toolUse", timestamp: 2 };
const receipt = { role: "toolResult", toolCallId: call.id, toolName: call.name, content: [{ type: "text", text: "Sent receipt 42" }], isError: false, timestamp: 3 };
const snapshot = (messages = [user, assistant]) => ({ revision: 12, context: { systemPrompt: "Accepted policy", messages }, lastCompaction: null });

test("restoration retains original evidence, returns only missing tail calls and uses current tools", () => {
  const other = { ...call, id: "read-43", name: "Read" };
  const source = snapshot([user, { ...assistant, content: [call, other] }, receipt]);
  const before = JSON.stringify(source), tools = [{ name: "Read" }];
  const restored = restoreBackgroundContext(source, prompt, tools);
  assert.equal(restored.revision, 12);
  assert.deepEqual(restored.pendingCalls, [other]);
  assert.equal(restored.context.tools, tools);
  assert.equal(restored.context.systemPrompt, "Accepted policy");
  assert.equal(JSON.stringify(source), before);
  assert.equal(restored.conclusion, undefined);
});

test("restoration rejects orphan/duplicate/mismatched receipts and unfinished older turns", () => {
  for (const messages of [[user, receipt], [user, assistant, { ...receipt, toolName: "Other" }],
    [user, assistant, receipt, receipt], [user, { ...assistant, content: [call, call] }],
    [user, assistant, user], [user, assistant, { ...assistant, content: [] }],
    [user, assistant, receipt, assistant], [user, { ...assistant, stopReason: "aborted" }]]) {
    assert.throws(() => restoreBackgroundContext(snapshot(messages), prompt, []), /Invalid|Incomplete/);
  }
});

test("saved uncertain receipts and lost accepted request cannot resume", () => {
  assert.throws(() => restoreBackgroundContext(snapshot([user, assistant, { ...receipt, details: { outcomeUncertain: true } }]), prompt, []), /Uncertain/);
  assert.throws(() => restoreBackgroundContext(snapshot([{ ...user, content: "different goal" }]), prompt, []), /exact accepted request/);
});

test("only a stopped real assistant can supply a saved conclusion", () => {
  const complete = { role: "assistant", api: "openai-completions", stopReason: "stop", timestamp: 4, content: [{ type: "text", text: "Report path and recorded calendar receipt" }] };
  assert.deepEqual(restoreBackgroundContext(snapshot([user, complete]), prompt, []).conclusion, complete);
  for (const overrides of [{ stopReason: "error" }, { stopReason: "length" }, { api: "xgent-compaction" }, { content: [] }])
    assert.throws(() => restoreBackgroundContext(snapshot([user, { ...complete, ...overrides }]), prompt, []), /continuation boundary/);
});

test("fresh and archived recovery revisions reject contradictory or malformed snapshots", () => {
  assert.equal(restoreBackgroundContext({ revision: 0, context: null, lastCompaction: null }, prompt, []).context, undefined);
  for (const source of [null, { ...snapshot(), revision: -1 }, { ...snapshot(), revision: 0 }, { ...snapshot(), revision: 1.5 }, { ...snapshot(), revision: Number.MAX_SAFE_INTEGER + 1 }, { ...snapshot(), lastCompaction: { api: "xgent-compaction" } }])
    assert.throws(() => restoreBackgroundContext(source, prompt, []), /Invalid/);
  const summary = { role: "assistant", api: "xgent-compaction", promptVersion: "summary-v3", compactionStats: {}, content: [{ type: "text", text: "Unfinished report" }] };
  assert.deepEqual(restoreBackgroundContext({ ...snapshot(), lastCompaction: summary }, prompt, []).lastCompaction, summary);
});
