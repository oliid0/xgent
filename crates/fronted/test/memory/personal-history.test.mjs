import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const user = text => ({ role: "user", content: text, timestamp: Date.now() });
const match = (i, overrides = {}) => ({ source: "message", role: "user", conversationId: `c${i}`, segmentIndex: 0,
  segmentId: `s${i}`, messageIndex: 0, messageId: `m${i}`, updatedAt: Date.now(), snippet: "[fake] highlighted ... preview", ...overrides });
const record = (i, overrides = {}) => ({ conversationId: `c${i}`, segmentIndex: 0, segmentId: `s${i}`, messageIndex: 0,
  messageId: `m${i}`, role: "user", text: `I walked in the evening on report ${i}`,
  timestamp: Date.now() - i * 86_400_000, contentHash: `actual-hash-${i}`, truncated: false, ...overrides });

function fixture(read) {
  const calls = [];
  const loader = createTsModuleLoader({ mocks: { "../api": { async memoryReadPersonalHistoryEvidence(args) {
    calls.push(args); return read ? read(args) : record(Number(args.conversationId.slice(1)));
  } } } });
  const { createPersonalHistoryEvidence } = loader.loadModule("src/lib/memory/extraction/personalHistory.ts");
  const { collectUserMemoryObservations } = loader.loadModule("src/lib/memory/extraction/context.ts");
  const { validateSubmittedPlan } = loader.loadModule("src/lib/memory/extraction/planTool.ts");
  const config = loader.loadModule("src/lib/memory/config.ts");
  const observations = collectUserMemoryObservations([user("I walked in the evening today")]);
  return { calls, observations, collector: createPersonalHistoryEvidence(observations), validateSubmittedPlan, config };
}

test("history hydration reads original scoped identities and timestamps, never snippets or updatedAt fallbacks", async () => {
  const original = record(1);
  const f = fixture(() => original);
  const added = await f.collector.hydrate([match(1)]);
  assert.equal(added.length, 1);
  assert.equal(added[0].text, original.text);
  assert.equal(added[0].timestamp, original.timestamp);
  assert.equal(added[0].history.messageId, "m1");
  assert.equal(added[0].history.contentHash, original.contentHash);
  assert.doesNotMatch(added[0].text, /fake|highlighted/);
});

test("assistant/summary/incomplete search hits cannot become personal observations", async () => {
  const f = fixture();
  assert.deepEqual(await f.collector.hydrate([match(1, { role: "assistant" }), match(2, { source: "segment" }),
    match(3, { messageId: null }), match(4, { messageIndex: -1 })]), []);
  assert.equal(f.calls.length, 0);
});

test("native identity/role mismatches and failures are omitted without guessing", async () => {
  for (const change of [{ role: "assistant" }, { conversationId: "other" }, { segmentId: "other" }, { messageId: "other" }, { messageIndex: 2 }]) {
    const f = fixture(() => record(1, change));
    assert.deepEqual(await f.collector.hydrate([match(1)]), []);
  }
  const failed = fixture(() => { throw new Error("original deleted"); });
  assert.deepEqual(await failed.collector.hydrate([match(1)]), []);
});

test("missing original timestamp stays undated even when search updatedAt says today", async () => {
  const f = fixture(() => record(1, { timestamp: null }));
  const [added] = await f.collector.hydrate([match(1)]);
  assert.equal(added.timestamp, null);
  assert.equal(added.localDate, null);
  assert.equal(added.inferenceEligible, false);
});

test("cached originals remain available to fallback/repeated searches without duplicate reads or observations", async () => {
  const original = record(1);
  const f = fixture(() => original);
  const first = await f.collector.hydrate([match(1), match(1)]);
  const second = await f.collector.hydrate([match(1)]);
  assert.equal(f.calls.length, 1);
  assert.equal(f.observations.length, 2);
  assert.equal(first.length, 1);
  assert.equal(second[0].id, first[0].id);
});

test("history reads have one bounded budget per extraction, including repeated failures", async () => {
  const f = fixture();
  await f.collector.hydrate(Array.from({ length: 40 }, (_, i) => match(i + 1)));
  assert.equal(f.calls.length, f.config.PERSONAL_HISTORY_OBSERVATION_LIMIT);
  assert.equal(f.observations.length, f.config.PERSONAL_HISTORY_OBSERVATION_LIMIT + 1);
  assert.equal((await f.collector.hydrate([match(1)])).length, 1);
  assert.equal(f.calls.length, f.config.PERSONAL_HISTORY_OBSERVATION_LIMIT);
});

test("current visible user text outranks injected attachment content for personal evidence", () => {
  const loader = createTsModuleLoader();
  const { collectUserMemoryObservations } = loader.loadModule("src/lib/memory/extraction/context.ts");
  const [observed] = collectUserMemoryObservations([{ ...user("Injected document says the person runs daily"), xgentDisplayContent: "Read this document" }]);
  assert.equal(observed.text, "Read this document");
});

test("content/time changes or removed originals are discarded during revalidation; current evidence survives", async () => {
  for (const change of [{ contentHash: "changed" }, { timestamp: 1 }, { text: "changed" }, { truncated: true }, null]) {
    const original = record(1);
    const f = fixture(args => {
      if (!args.expectedContentHash) return original;
      assert.equal(args.expectedContentHash, original.contentHash);
      if (change === null) throw new Error("deleted");
      return { ...original, ...change };
    });
    await f.collector.hydrate([match(1)]);
    assert.equal(await f.collector.revalidate(), 1);
    assert.equal(f.observations.length, 1);
    assert.equal(f.observations[0].text, "I walked in the evening today");
  }
});

test("abort after an original read stops hydration before retaining it", async () => {
  const controller = new AbortController();
  const f = fixture(() => { controller.abort(new Error("stopped")); return record(1); });
  await assert.rejects(f.collector.hydrate([match(1), match(2)], controller.signal), /stopped/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.observations.length, 1);
});

function engineFixture({ invalidateAfterSubmit = false } = {}) {
  const calls = [], batches = [], receipts = [];
  const originals = [record(1), record(2)];
  let returned = false;
  const loader = createTsModuleLoader({ mocks: {
    "@/lib/memory/api": {
      async memoryList() { return { entries: [] }; }, async memoryRecentRejections() { return { entries: [] }; },
      async memoryTodayLocalDate() { return "2026-10-13"; },
      async memoryApplyBatch(args) { batches.push(args); return { created: args.decisions?.map(d => d.slug) ?? [], updated: [], deleted: [], warnings: [] }; },
    },
    "../api": { async memoryReadPersonalHistoryEvidence(args) {
      calls.push(args);
      if (returned && invalidateAfterSubmit) throw new Error("user deleted original source");
      return originals.find(r => r.conversationId === args.conversationId);
    } },
    "../../tools/memoryTools": { createMemoryTools: () => ({ tools: [], async executeToolCall(call) {
      return { role: "toolResult", toolName: call.name, toolCallId: call.id, content: [{ type: "text", text: "Untrusted highlighted previews" }],
        details: { historyMatches: [match(1), match(2)] }, isError: false, timestamp: Date.now() };
    } }) },
    "../page/chatPageHelpers": { isAbortLikeError: () => false },
    "../runner/agentRunner": { async runAssistantWithTools(params) {
      const current = JSON.parse(params.context.messages[0].content.match(/<user-observations>\n([\s\S]*?)\n<\/user-observations>/)[1]);
      const search = await params.executeToolCall({ id: "search", name: "MemoryManager", arguments: { action: "search", query: "evening walk", include_history: true } }, params.signal);
      receipts.push(search);
      const added = JSON.parse(search.content.at(-1).text.split("\n")[1]);
      const call = { type: "toolCall", id: "submit", name: "SubmitMemoryPlan", arguments: { status: "updated", items: [{ action: "write", slug: "walking-pattern", scope: "global", type: "user", description: "Possible walking preference", body: "Possible evening walking preference, still unconfirmed.", evidence_basis: "inferred", confidence: "high", source_quote: current[0].text,
        observations: [...current, ...added].map(o => ({ id: o.id, quote: o.text })) }] } };
      const receipt = await params.executeToolCall(call, params.signal);
      receipts.push(receipt);
      returned = true;
      return { emittedMessages: [search, { role: "assistant", content: [call], timestamp: Date.now() }, receipt] };
    } },
  } });
  const { runMemoryExtraction } = loader.loadModule("src/lib/chat/memory/extractionEngine.ts");
  return { calls, batches, receipts, run: () => runMemoryExtraction({ primary: { providerId: "openai", model: "original-model", runtime: { baseUrl: "original-provider" } },
    sessionId: "original-session", conversationId: "current", workdir: "/original", alreadyWrittenSlugs: [], messages: [user("I walked in the evening today")] }) };
}

test("real extractor joins current and original historical observations and persists cross-session provenance as low confidence", async () => {
  const f = engineFixture();
  const result = await f.run();
  assert.equal(result.ok, true);
  assert.equal(result.acceptedCount, 1);
  assert.equal(f.calls.length, 6);
  assert.equal(f.batches.length, 1);
  assert.equal(f.batches[0].decisions[0].evidence.confidence, "low");
  const evidence = JSON.parse(f.batches[0].decisions[0].body.split("## Personal evidence\n")[1]);
  assert.equal(evidence.observations.filter(o => o.history).length, 2);
  assert.equal(evidence.observations.find(o => o.history)?.history.conversationId, "c1");
});

test("source deletion after SubmitMemoryPlan but before persistence removes the candidate rather than writing stale learning", async () => {
  const f = engineFixture({ invalidateAfterSubmit: true });
  const result = await f.run();
  assert.equal(result.ok, true);
  assert.equal(result.acceptedCount, 0);
  assert.equal(result.rejectedCount, 1);
  assert.equal(f.batches.length, 0);
});
