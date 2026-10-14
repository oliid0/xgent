import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const prompt = "Create report.docx and slides, arrange tomorrow, and remind me to exercise. Never resend mail.";
const xml = `<summary>
<task>${prompt}</task>
<constraints>Use the accepted account. Do not resend completed writes.</constraints>
<state>The documents were read. Mail receipt 42 is recorded. The report, slides, calendar and reminder are not yet verified. Preserve the original requirements, distinguish recorded outcomes from guesses, and inspect original context if details are needed.</state>
<artifacts>- [file] report.docx | planned | still needs creation and verification</artifacts>
<open_loops>Calendar and exercise reminder still need real receipts.</open_loops>
<next_steps>Generate the files, inspect their content, then arrange the calendar and durable reminder. Do not finish while any independent branch is incomplete.</next_steps>
</summary>`;
const usage = (input = 0) => ({ input, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: input + 10,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
const assistant = (content, input = 0) => ({ role: "assistant", content, timestamp: 2,
  api: "anthropic-messages", provider: "anthropic", model: "pinned-model", stopReason: "stop", usage: usage(input) });
const call = { type: "toolCall", id: "mail-1", name: "SendMail", arguments: { recipient: "user@example.test" } };
const receipt = { role: "toolResult", toolCallId: call.id, toolName: call.name, timestamp: 3, isError: false,
  content: [{ type: "text", text: "Sent, receipt 42" }] };
const runtime = { apiKey: "accepted-key", baseUrl: "https://accepted.example.test", modelConfig: { contextWindow: 8000, maxOutputToken: 1000 } };
function largeContext(messages) {
  return { systemPrompt: "Pinned policy", tools: [{ name: "SendMail", description: "Send mail", parameters: { type: "object", properties: {} } }],
    messages: messages ?? [{ role: "user", content: prompt, timestamp: 1 },
      assistant([{ type: "text", text: "Old document evidence ".repeat(500) }]),
      assistant([call], 7000), receipt] };
}
function setup(overrides = {}) {
  const calls = [], saved = [], events = [], controller = new AbortController();
  const llm = {
    assistantMessageToText: (message) => message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n"),
    async completeAssistantMessage(params) {
      await params.beforeModelRequest?.();
      events.push("summary"); calls.push(params);
      return overrides.complete ? overrides.complete(params, calls.length) : assistant([{ type: "text", text: xml }]);
    },
  };
  const loader = createTsModuleLoader({ mocks: { "../providers/llm": llm, "../../providers/llm": llm } });
  const { createBackgroundCompactor } = loader.loadModule("src/lib/automation/backgroundCompaction.ts");
  const compactor = createBackgroundCompactor({ request: { prompt, model: "pinned-model", startedAt: 1 },
    baseSystemPrompt: "Pinned policy", providerId: "anthropic", runtime, signal: controller.signal,
    async verifyConfiguration() { events.push("verify"); return overrides.verify?.(events.filter((e) => e === "verify").length); },
    async persist(context, checkpoint) { events.push("persist"); await overrides.persist?.(context, checkpoint); saved.push({ context, checkpoint }); },
    ...overrides.options,
  });
  return { compactor, calls, saved, events, controller };
}

test("rebuilding current policy retains only the real compaction checkpoint and its parsed file ledger", async () => {
  const f = setup(); await f.compactor.compactIfNeeded(largeContext());
  const checkpoint = f.saved[0].checkpoint;
  const api = createTsModuleLoader().loadModule("src/lib/automation/backgroundCompaction.ts");
  const rebuilt = api.rebuildBackgroundSystemPrompt("Current accepted policy; current outcomes only", { prompt, startedAt: 1 }, checkpoint);
  assert.match(rebuilt, /Current accepted policy/); assert.match(rebuilt, /Mail receipt 42 is recorded/);
  assert.match(rebuilt, /report.docx/); assert.match(rebuilt, /Previous Conversation Summary/);
  assert.doesNotMatch(rebuilt, /Pinned policy/);
  assert.equal(rebuilt.split("Previous Conversation Summary").length - 1, 1);
  assert.equal(api.rebuildBackgroundSystemPrompt("fresh", { prompt, startedAt: 1 }), "fresh");
  assert.deepEqual(checkpoint, f.saved[0].checkpoint);
});

test("compaction uses the captured execution admission hook and cannot persist a summary when refused", async () => {
  let admissions = 0;
  const f = setup({ options: { beforeModelRequest: async () => { admissions++; throw new Error("Shared execution budget exhausted"); } } });
  await assert.rejects(f.compactor.compactIfNeeded(largeContext()), /budget exhausted/);
  assert.equal(admissions, 1); assert.equal(f.calls.length, 0); assert.equal(f.saved.length, 0);
});

test("real compaction preserves exact requirements and a complete recent write receipt after persistence", async () => {
  let acknowledge;
  const f = setup({ persist: () => new Promise((resolve) => { acknowledge = resolve; }) });
  const source = largeContext(), before = JSON.stringify(source);
  let returned = false;
  const pending = f.compactor.compactIfNeeded(source).then((value) => { returned = true; return value; });
  while (!acknowledge) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(returned, false); assert.equal(f.saved.length, 0);
  assert.deepEqual(f.events, ["verify", "summary", "verify", "persist"]);
  acknowledge(); const next = await pending;
  assert.equal(next.messages[0].content, prompt);
  assert.equal(next.messages[1].content[0].id, call.id);
  assert.equal(next.messages[2].toolCallId, call.id);
  assert.equal(next.messages[2].content[0].text, "Sent, receipt 42");
  assert.equal(next.messages.at(-1).role, "user");
  assert.match(next.systemPrompt, /Calendar and exercise reminder/);
  assert.equal(JSON.stringify(source), before);
  assert.ok(JSON.stringify(next).length < before.length);
  assert.equal(f.saved[0].checkpoint.api, "xgent-compaction");
  assert.equal(f.saved[0].checkpoint.promptVersion, "summary-v4");
  assert.equal(f.calls[0].providerId, "anthropic");
  assert.equal(f.calls[0].model, "pinned-model");
  assert.deepEqual(f.calls[0].runtime, runtime);
  assert.equal(f.calls[0].context.tools, undefined, "summarizer cannot execute tools");
});

test("a second cut extends the previous checkpoint without accumulating old system summaries", async () => {
  const f = setup();
  const first = await f.compactor.compactIfNeeded(largeContext());
  const second = await f.compactor.compactIfNeeded({ ...first, messages: [...first.messages,
    assistant([{ type: "text", text: "New document evidence ".repeat(500) }]), assistant([call], 7000), receipt] });
  assert.equal(f.saved.length, 2);
  const payload = JSON.parse(f.calls[1].context.messages[0].content);
  assert.ok(payload.previous_summary);
  assert.match(JSON.stringify(payload.previous_summary), /Calendar and exercise reminder/);
  assert.equal(payload.system_prompt, "Pinned policy");
  assert.equal(second.messages[0].content, prompt);
  assert.equal(second.systemPrompt.split("## Task").length, first.systemPrompt.split("## Task").length);
});

test("a new worker extends the persisted cumulative checkpoint after restart", async () => {
  const firstWorker = setup();
  const first = await firstWorker.compactor.compactIfNeeded(largeContext());
  const restarted = setup({ options: { previousCheckpoint: firstWorker.saved[0].checkpoint } });
  await restarted.compactor.compactIfNeeded({ ...first, messages: [...first.messages,
    assistant([{ type: "text", text: "New evidence after restart ".repeat(500) }], 7000)] });
  const payload = JSON.parse(restarted.calls[0].context.messages[0].content);
  assert.match(JSON.stringify(payload.previous_summary), /Mail receipt 42|Calendar and exercise reminder/);
  assert.equal(restarted.saved[0].context.messages[0].content, prompt);
});

test("invalid summaries never replace a checkpoint, even after the actual repair request", async () => {
  const f = setup({ complete: () => assistant([{ type: "text", text: "Everything done" }]) });
  await assert.rejects(f.compactor.compactIfNeeded(largeContext()), /validation failed/);
  assert.equal(f.calls.length, 2); assert.equal(f.saved.length, 0);
  assert.equal(f.events.filter((e) => e === "verify").length, 2);
});

test("configuration is checked for repair retries and again before atomic replacement", async () => {
  for (const rejectAt of [2, 3]) {
    const f = setup({ complete: (_, count) => assistant([{ type: "text", text: count === 1 ? "bad summary" : xml }]),
      verify(count) { if (count === rejectAt) throw new Error("configuration revoked"); } });
    await assert.rejects(f.compactor.compactIfNeeded(largeContext()), /configuration revoked/);
    assert.equal(f.calls.length, rejectAt - 1); assert.equal(f.saved.length, 0);
  }
});

test("a rejected archive commit retains source context and is never returned as usable compression", async () => {
  const f = setup({ persist() { throw new Error("disk full"); } });
  const source = largeContext(), before = JSON.stringify(source);
  await assert.rejects(f.compactor.compactIfNeeded(source), /disk full/);
  assert.equal(JSON.stringify(source), before); assert.equal(f.saved.length, 0);
});

test("all tool boundaries are checked, including older unfinished, duplicate and mismatched receipts", async () => {
  const user = { role: "user", content: prompt, timestamp: 1 }, large = assistant([{ type: "text", text: "evidence ".repeat(9000) }]);
  for (const messages of [
    [user, large, assistant([call])],
    [user, large, assistant([call]), { ...receipt, toolName: "OtherTool" }],
    [user, large, assistant([call]), receipt, receipt],
    [user, large, assistant([call, call]), receipt],
    [user, large, assistant([call]), assistant([{ type: "text", text: "next turn" }])],
    [user, large, receipt, assistant([call]), receipt],
  ]) {
    const f = setup();
    await assert.rejects(f.compactor.compactIfNeeded(largeContext(messages)), /tool call|tool receipt/);
    assert.equal(f.calls.length, 0); assert.equal(f.saved.length, 0);
  }
});

test("oversized recent evidence drops the whole paired turn and historic usage does not block fitting", async () => {
  const f = setup(), source = largeContext();
  source.messages[2].usage = usage(200000);
  source.messages[3] = { ...receipt, content: [{ type: "text", text: "evidence ".repeat(10000) }] };
  const next = await f.compactor.compactIfNeeded(source);
  assert.equal(next.messages.length, 2);
  assert.equal(next.messages[0].content, prompt);
  assert.ok(!next.messages.some((message) => message.role === "toolResult"));
  assert.equal(f.saved.length, 1);
});

test("small contexts and aborted requests spend no model call and fixed oversized goals fail explicitly", async () => {
  const small = setup();
  assert.equal(await small.compactor.compactIfNeeded({ systemPrompt: "policy", messages: [{ role: "user", content: prompt, timestamp: 1 }] }), null);
  assert.equal(small.calls.length, 0);
  small.controller.abort();
  await assert.rejects(small.compactor.compactIfNeeded(largeContext()), /abort/i);
  const hugePrompt = prompt + " fixed requirement ".repeat(6000);
  const huge = setup({ options: { request: { prompt: hugePrompt, model: "pinned-model", startedAt: 1 } } });
  await assert.rejects(huge.compactor.compactIfNeeded(largeContext()), /checkpoint and request exceed the summary budget/);
  assert.equal(huge.calls.length, 0);
  assert.equal(huge.saved.length, 0);
});
