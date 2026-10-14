import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { runCompaction } = loader.loadModule("src/lib/chat/compaction/engine.ts");
const { summarizeConversation } = loader.loadModule("src/lib/chat/compaction/summarizer.ts");
const { takeCompactionChunk } = loader.loadModule("src/lib/chat/compaction/chunks.ts");
const { estimateCompactionPayloadTokens } = loader.loadModule("src/lib/chat/compaction/payload.ts");
const { buildVerificationSignals } = loader.loadModule("src/lib/chat/compaction/validate.ts");
const { createConversationStateFromContext } = loader.loadModule("src/lib/chat/conversation/conversationState.ts");
const runtime = { baseUrl: "https://accepted.example.test", apiKey: "accepted-key", modelConfig: { contextWindow: 10_000, maxOutputToken: 2000 } };
const budget = 6750;
const response = text => ({ role: "assistant", api: "anthropic-messages", provider: "anthropic", model: "original-model", stopReason: "stop", content: [{ type: "text", text }], timestamp: 99, usage: { input: 200, output: 100, totalTokens: 300, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
const xml = (payload, markers = []) => `<summary><task>Continue the original request</task><constraints>Never repeat confirmed writes. Preserve coding and chat requirements.</constraints><state>${markers.join(" ")} ${"Verified observations remain separate from unfinished work. ".repeat(8)}</state><artifacts>- [log] conversation | observed | ${buildVerificationSignals(payload).join(" ") || "actual conversation"}</artifacts><open_loops>Remaining work needs actual outcomes; do not claim completion.</open_loops><next_steps>Continue pending work using the original tools and permissions.</next_steps></summary>`;
const request = payload => ({ providerId: "anthropic", model: "original-model", runtime, payload });
const envelope = messages => ({ compaction_reason: { trigger: "test", context_tokens: 100_000, threshold: 7500 }, system_prompt: "Original coding/chat policy", previous_summary: null, active_segment_messages: messages });
const user = (content, index = 0) => ({ role: "user", content, timestamp: index, index });

test("oversized history reaches the summarizer in order including the middle, then commits once", async () => {
  const messages = Array.from({ length: 30 }, (_, i) => user(`record-${i}: ${"evidence ".repeat(600)}`, i));
  messages[14].content += " MIDDLE-DECISION: preserve src/code.ts and do not resend the calendar write.";
  const state = createConversationStateFromContext({ systemPrompt: "Original coding policy", messages });
  const before = JSON.stringify(state), calls = [];
  const result = await runCompaction({ state, intent: "protection", contextTokens: 100_000, threshold: 7500, providerId: "anthropic", model: "original-model", runtime,
    complete: async params => {
      const payload = JSON.parse(params.context.messages[0].content); calls.push(payload);
      assert.equal(params.model, "original-model"); assert.equal(params.providerId, "anthropic");
      assert.deepEqual(params.runtime, runtime); assert.equal(params.context.tools, undefined);
      assert.ok(estimateCompactionPayloadTokens(payload) <= budget);
      if (calls.length > 1) assert.ok(payload.previous_summary, "each chunk carries the cumulative checkpoint");
      const seen = JSON.stringify(payload).includes("MIDDLE-DECISION") ? ["MIDDLE-DECISION"] : [];
      return response(xml(payload, seen));
    } });
  assert.ok(calls.length > 2);
  assert.deepEqual(calls.flatMap(p => p.active_segment_messages.map(m => m.index)), messages.map(m => m.index));
  assert.ok(calls.every(p => !p.compaction_reason.omitted_message_count));
  assert.match(result.checkpointMessage.content[0].text, /MIDDLE-DECISION/);
  assert.equal(result.state.segments.length, 2); assert.equal(JSON.stringify(state), before);
  assert.equal(result.state.segments[0].messages.length, messages.length);
  assert.deepEqual(result.checkpointMessage.compactionStats.summarizer, { inputTokens: 200 * calls.length, outputTokens: 100 * calls.length });
});

test("a single very long user message retains all text and Unicode through ordered fragments", () => {
  const text = `Start ${"一段🙂包含所有上下文的内容 ".repeat(3200)} END-DECISION`;
  let pending = [user(text)], all = [], chunks = 0;
  while (pending.length) {
    const next = takeCompactionChunk(envelope([]), pending, budget);
    assert.ok(estimateCompactionPayloadTokens(next.payload) <= budget);
    all.push(...next.payload.active_segment_messages); pending = next.remaining;
    assert.ok(++chunks < 16);
  }
  assert.ok(chunks > 1); assert.equal(all.map(m => m.content).join(""), text);
  assert.ok(all.every(m => m.role === "user" && m.index === 0));
  assert.equal(all.at(-1).fragment.continued, false);
  assert.ok(all.every(m => !/[\uD800-\uDBFF]$/.test(m.content)));
});

test("large actual tool arguments, result text and details are evidence fragments, never tool calls", async () => {
  const args = `{"document":"${"abc ".repeat(11000)}"}`, details = "original receipt ".repeat(3000), text = "actual evidence ".repeat(4000);
  const messages = [{ role: "assistant", index: 0, timestamp: 1, stopReason: "toolUse", text: "Writing src/code.ts", toolCalls: [`Write ${args}`] },
    { role: "toolResult", index: 1, timestamp: 2, toolName: "Write", toolCallId: "original-call", isError: false, content: text, details }];
  const calls = [];
  await summarizeConversation({ ...request(envelope(messages)), complete: async params => {
    assert.equal(params.context.tools, undefined);
    const p = JSON.parse(params.context.messages[0].content); calls.push(p);
    return response(xml(p));
  } });
  const pieces = calls.flatMap(p => p.active_segment_messages);
  assert.equal(pieces.filter(m => m.index === 0).flatMap(m => m.toolCalls ?? []).join(""), `Write ${args}`);
  assert.equal(pieces.filter(m => m.index === 1).map(m => m.content).join(""), text);
  assert.equal(pieces.filter(m => m.index === 1).map(m => m.details ?? "").join(""), details);
  assert.ok(pieces.filter(m => m.index === 1).every(m => m.toolCallId === "original-call" && !m.isError));
});

test("repeated compaction carries the prior decision forward and preserves coding evidence", async () => {
  let state = createConversationStateFromContext({ systemPrompt: "Original coding policy", messages: [user("Preserve src/code.ts. Never resend the mail."), user("first task")] });
  const first = await runCompaction({ state, intent: "protection", contextTokens: 1000, threshold: 700, providerId: "anthropic", model: "original-model", runtime,
    complete: async params => response(xml(JSON.parse(params.context.messages[0].content), ["ORIGINAL-DECISION: preserve src/code.ts; never resend mail"])) });
  state = createConversationStateFromContext({ systemPrompt: "Original coding policy", messages: [...state.segments[0].messages, first.checkpointMessage,
    ...Array.from({ length: 20 }, (_, i) => user(`new-${i} ${"new evidence ".repeat(550)}`, 20 + i))] });
  const originalSegments = JSON.stringify(state.segments);
  let count = 0;
  const second = await runCompaction({ state, intent: "protection", contextTokens: 50_000, threshold: 7500, providerId: "anthropic", model: "original-model", runtime,
    complete: async params => {
      count++; const payload = JSON.parse(params.context.messages[0].content);
      assert.match(payload.previous_summary.content, /ORIGINAL-DECISION/);
      assert.match(params.context.systemPrompt, /exact paths, function names, edits, test\/command results/);
      return response(xml(payload, ["ORIGINAL-DECISION: preserve src/code.ts; never resend mail"]));
    } });
  assert.ok(count > 1); assert.match(second.checkpointMessage.content[0].text, /ORIGINAL-DECISION/);
  assert.equal(JSON.stringify(state.segments), originalSegments);
  assert.equal(second.state.segments.length, 3);
});

test("cancellation after a successful partial response never installs a partial checkpoint", async () => {
  const controller = new AbortController(), state = createConversationStateFromContext({ messages: [user("data ".repeat(24000))] }), before = JSON.stringify(state);
  let calls = 0;
  await assert.rejects(runCompaction({ state, intent: "protection", contextTokens: 50_000, threshold: 7500, ...request(envelope([])), signal: controller.signal,
    complete: async params => { calls++; controller.abort(); return response(xml(JSON.parse(params.context.messages[0].content))); } }), /abort/i);
  assert.equal(calls, 1); assert.equal(JSON.stringify(state), before);
});

test("a budget refusal on a later chunk leaves source history and completed original writes untouched", async () => {
  const state = createConversationStateFromContext({ messages: Array.from({ length: 20 }, (_, i) => user(`data-${i} ${"evidence ".repeat(800)}`, i)) }), before = JSON.stringify(state);
  let calls = 0;
  await assert.rejects(runCompaction({ state, intent: "protection", contextTokens: 50_000, threshold: 7500, ...request(envelope([])),
    complete: async params => { if (++calls === 2) throw new Error("Shared execution budget exhausted"); return response(xml(JSON.parse(params.context.messages[0].content))); } }), /budget exhausted/);
  assert.equal(calls, 2); assert.equal(JSON.stringify(state), before);
});

test("an oversized prior checkpoint or an excessive chain rejects rather than silently discarding records", async () => {
  const prior = { ...envelope([user("next")]), previous_summary: { id: "old", content: "old decision ".repeat(20000), summaryMeta: {} } };
  let calls = 0;
  await assert.rejects(summarizeConversation({ ...request(prior), complete: async () => { calls++; return response(""); } }), /original history retained/);
  assert.equal(calls, 0);
  const payload = envelope(Array.from({ length: 40 }, (_, i) => user(`record-${i} ${"evidence ".repeat(1400)}`, i)));
  await assert.rejects(summarizeConversation({ ...request(payload), complete: async params => { calls++; return response(xml(JSON.parse(params.context.messages[0].content))); } }), /too many summary chunks/);
  assert.equal(calls, 16); assert.equal(payload.active_segment_messages.length, 40);
});

test("xchat checkpoint keeps conversation facts without fabricating coding actions", async () => {
  const payload = envelope([user("我之前说过周五不安排会议，请继续安排下周日程。")]);
  const result = await summarizeConversation({ ...request(payload), complete: async params => {
    assert.match(params.context.systemPrompt, /xchat conversation without code/);
    assert.match(params.context.systemPrompt, /do not invent files, edits or tests/);
    assert.match(params.context.systemPrompt, /free-text summary content in Chinese/);
    return response(xml(payload, ["周五不安排会议；下周日程尚未完成。"]));
  } });
  assert.match(result.summaryText, /周五不安排会议/);
  assert.doesNotMatch(result.summaryText, /\[file\]|modified|passed/);
});

test("usage includes the invalid response and actual repair, not just the final request", async () => {
  const payload = envelope([user("Keep the original coding task src/code.ts")]);
  let calls = 0;
  const result = await summarizeConversation({ ...request(payload), complete: async params => {
    return response(++calls === 1 ? "invalid format" : xml(JSON.parse(params.context.messages[0].content)));
  } });
  assert.equal(calls, 2); assert.deepEqual(result.summarizerUsage, { inputTokens: 400, outputTokens: 200 });
});
