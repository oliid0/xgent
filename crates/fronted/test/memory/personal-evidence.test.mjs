import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { collectUserMemoryObservations } = loader.loadModule("src/lib/memory/extraction/context.ts");
const { validateSubmittedPlan, planToApplyBatchArgs } = loader.loadModule("src/lib/memory/extraction/planTool.ts");
const { MEMORY_BODY_LIMIT_BYTES } = loader.loadModule("src/lib/memory/config.ts");
const now = Date.parse("2026-10-12T23:00:00Z");
const user = (text, timestamp) => ({ role: "user", content: text, timestamp });
const messages = [
  user("I exercised in the evening Monday", Date.parse("2026-10-05T22:00:00Z")),
  { role: "assistant", content: [{ type: "text", text: "You always exercise at 6 PM" }], timestamp: 100 },
  user("I exercised in the evening Tuesday", Date.parse("2026-10-06T22:00:00Z")),
  user("I exercised in the evening Wednesday", Date.parse("2026-10-07T22:00:00Z")),
];
const observations = collectUserMemoryObservations(messages, now, "America/Los_Angeles");
const ctx = { hasWorkdir: true, rejectedSlugs: new Set(), alreadyWrittenSlugs: new Set(), userObservations: observations };
const pattern = {
  action: "write", slug: "evening-exercise", scope: "global", type: "user", description: "Possible evening exercise pattern",
  body: "May prefer evening exercise, based on recent reports; this is not a confirmed routine.",
  evidence_basis: "inferred", confidence: "high", source_quote: "I exercised in the evening Monday",
  observations: observations.map(o => ({ id: o.id, quote: o.text })), reasoning: "Repeated reports",
};

test("observation window uses real user text/date/time zone, excluding assistant/tool text and older turns", () => {
  assert.equal(observations.length, 3);
  assert.deepEqual(observations.map(o => o.localDate), ["2026-10-05", "2026-10-06", "2026-10-07"]);
  assert.ok(observations.every(o => o.timeZone === "America/Los_Angeles"));
  const f = collectUserMemoryObservations([
    user("old", 1), ...messages, user("latest", now),
    { role: "toolResult", content: [{ type: "text", text: "fabricated habit" }], timestamp: now },
  ], now, "UTC");
  assert.equal(f.length, 4);
  assert.ok(!f.some(o => o.text.includes("old") || o.text.includes("always") || o.text.includes("fabricated")));
});

test("invalid/future timestamps remain explicitly undated instead of manufacturing observation dates", () => {
  const f = collectUserMemoryObservations([user("unknown", NaN), user("future", now + 1)], now, "UTC");
  assert.ok(f.every(o => o.timestamp === null && o.localDate === null));
});

test("stale reports retain their actual date but cannot establish a current inferred pattern", () => {
  const stale = collectUserMemoryObservations(messages, now + 90 * 86_400_000, "America/Los_Angeles");
  assert.equal(stale[0].localDate, "2026-10-05");
  assert.ok(stale.every(o => !o.inferenceEligible));
  assert.equal(validateSubmittedPlan({ items: [pattern] }, { ...ctx, userObservations: stale }).accepted.length, 0);
});

test("explicit personal evidence must quote actual user text; assistant assertions and invented quotes cannot persist", () => {
  const explicit = { ...pattern, evidence_basis: "explicit", observations: undefined };
  const accepted = validateSubmittedPlan({ items: [explicit] }, ctx);
  assert.equal(accepted.accepted.length, 1);
  assert.match(accepted.accepted[0].body, /"basis":"explicit"/);
  assert.equal(accepted.accepted[0].evidence.confidence, "high");
  for (const quote of ["You always exercise at 6 PM", "I swim every day", ""]) {
    const result = validateSubmittedPlan({ items: [{ ...explicit, source_quote: quote }] }, ctx);
    assert.equal(result.accepted.length, 0);
    assert.equal(result.rejected[0].code, "invalid-personal-evidence");
  }
});

test("three actual distinct dates yield a low-confidence qualified candidate with provenance through the real batch conversion", () => {
  const result = validateSubmittedPlan({ items: [pattern, { action: "accept", slug: pattern.slug, scope: "global" }] }, ctx);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected[0].code, "inferred-awaiting-confirmation");
  const payload = planToApplyBatchArgs(result.accepted);
  assert.equal(payload.decisions[0].evidence.confidence, "low");
  assert.match(payload.decisions[0].body, /^Inferred personal pattern; not user-confirmed/);
  const saved = JSON.parse(payload.decisions[0].body.split("## Personal evidence\n")[1]);
  assert.equal(saved.basis, "inferred");
  assert.deepEqual(saved.observations.map(o => o.timestamp), observations.map(o => o.timestamp));
  assert.deepEqual(saved.observations.map(o => o.quote), observations.map(o => o.text));
});

test("one-day bursts, duplicate/unknown IDs, paraphrases, missing dates and missing source corroboration reject inference", () => {
  const badPlans = [
    { ...pattern, observations: pattern.observations.slice(0, 2) },
    { ...pattern, observations: [pattern.observations[0], pattern.observations[0], pattern.observations[2]] },
    { ...pattern, observations: [{ id: "invented", quote: "running" }, ...pattern.observations.slice(1)] },
    { ...pattern, observations: [{ ...pattern.observations[0], quote: "I always run" }, ...pattern.observations.slice(1)] },
    { ...pattern, observations: pattern.observations.map(o => ({ ...o, quote: "evening" })) },
  ];
  for (const item of badPlans) assert.equal(validateSubmittedPlan({ items: [item] }, ctx).accepted.length, 0);
  for (const overrides of [
    { userObservations: observations.map(o => ({ ...o, localDate: "2026-10-05" })) },
    { userObservations: observations.map(o => ({ ...o, localDate: null, timestamp: null })) },
    { allowInferredPersonal: false },
  ]) assert.equal(validateSubmittedPlan({ items: [pattern] }, { ...ctx, ...overrides }).accepted.length, 0);
});

test("known reviewed preferences resist inferred overwrite; actual explicit correction/update and delete still use existing paths", () => {
  const protectedCtx = { ...ctx, existingMemoryTypes: new Map([["auto:evening-exercise", "user"]]), protectedPersonalIds: new Set(["auto:evening-exercise"]) };
  const inferred = validateSubmittedPlan({ items: [{ ...pattern, action: "update", scope: undefined, type: undefined }] }, protectedCtx);
  assert.equal(inferred.accepted.length, 0);
  const correction = validateSubmittedPlan({ items: [{ ...pattern, action: "update", scope: undefined, type: undefined, evidence_basis: "explicit" }] }, protectedCtx);
  assert.equal(correction.accepted.length, 1);
  assert.equal(correction.accepted[0].mode, "merge");
  assert.equal(validateSubmittedPlan({ items: [{ action: "delete", slug: pattern.slug, scope: "global" }] }, protectedCtx).accepted.length, 1);
});

test("provenance cannot exceed existing native body limit; independent workspace and journal memories retain behavior", () => {
  const result = validateSubmittedPlan({ items: [
    { ...pattern, body: "x".repeat(MEMORY_BODY_LIMIT_BYTES) },
    { action: "write", slug: "project-design", scope: "project", type: "project", description: "Actual design decision", body: "Preserved workspace architecture" },
    { action: "append_daily", body: "- Actual activity" },
  ] }, ctx);
  assert.equal(result.rejected[0].code, "body-too-large");
  assert.equal(result.accepted.length, 2);
  assert.equal(result.accepted[0].body, "Preserved workspace architecture");
  assert.equal(result.accepted[1].body, "- Actual activity");
});

function engineFixture(submit, entries = [], failPrimary = false) {
  const runs = [], batches = [], receipts = [];
  const engineLoader = createTsModuleLoader({ mocks: {
    "@/lib/memory/api": {
      async memoryList() { return { entries }; },
      async memoryRecentRejections() { return { entries: [] }; },
      async memoryTodayLocalDate() { return "2026-10-12"; },
      async memoryApplyBatch(args) { batches.push(args); return { created: args.decisions?.map(d => d.slug) ?? [], updated: [], deleted: [], warnings: [] }; },
    },
    "../../tools/memoryTools": { createMemoryTools: () => ({ tools: [], executeToolCall: async () => { throw new Error("unexpected memory tool"); } }) },
    "../page/chatPageHelpers": { isAbortLikeError: () => false },
    "../runner/agentRunner": { async runAssistantWithTools(params) {
      runs.push(params);
      if (failPrimary && runs.length === 1) throw new Error("original primary failed");
      const evidence = JSON.parse(params.context.messages[0].content.match(/<user-observations>\n([\s\S]*?)\n<\/user-observations>/)[1]);
      const item = submit(evidence);
      const call = { type: "toolCall", id: "submit", name: "SubmitMemoryPlan", arguments: { status: "updated", items: [item] } };
      const receipt = await params.executeToolCall(call, params.signal);
      receipts.push(receipt);
      return { emittedMessages: [{ role: "assistant", content: [call], timestamp: now }, receipt] };
    } },
  } });
  const { runMemoryExtraction } = engineLoader.loadModule("src/lib/chat/memory/extractionEngine.ts");
  const run = (overrides = {}) => runMemoryExtraction({ primary: { providerId: "openai", model: "original-model", runtime: { baseUrl: "original-provider", apiKey: "fixture" } },
    sessionId: "original-session", conversationId: "original-conversation", workdir: "/original-code-workspace",
    messages: messages.map((message, index) => ({ ...message, timestamp: Date.now() - (9 - index) * 86_400_000 })),
    alreadyWrittenSlugs: [], ...overrides });
  return { run, runs, batches, receipts };
}

test("actual extractor retains original provider/workspace and persists corroborated candidate once through memory_apply_batch", async () => {
  const f = engineFixture(obs => ({ ...pattern, observations: obs.map(o => ({ id: o.id, quote: o.text })) }));
  const result = await f.run();
  assert.equal(result.ok, true);
  assert.equal(result.acceptedCount, 1);
  assert.equal(f.runs.length, 1);
  assert.equal(f.runs[0].model, "original-model");
  assert.equal(f.runs[0].runtime.baseUrl, "original-provider");
  assert.equal(f.runs[0].workdir, "/original-code-workspace");
  assert.equal(f.batches.length, 1);
  assert.equal(f.batches[0].conversationId, "original-conversation");
  assert.equal(f.batches[0].decisions[0].evidence.confidence, "low");
  assert.ok(f.batches[0].decisions[0].body.includes('"basis":"inferred"'));
});

test("actual extractor rejects an assistant-only personal assertion without invoking persistence", async () => {
  const f = engineFixture(() => ({ ...pattern, evidence_basis: "explicit", source_quote: "You always exercise at 6 PM" }));
  const result = await f.run();
  assert.equal(result.ok, true);
  assert.equal(result.acceptedCount, 0);
  assert.equal(result.rejectedCount, 1);
  assert.equal(f.batches.length, 0);
});

test("memory provenance names the actual fallback model after original primary failure", async () => {
  const f = engineFixture(() => ({ ...pattern, evidence_basis: "explicit" }), [], true);
  const fallback = { providerId: "anthropic", model: "actual-fallback-model", runtime: { baseUrl: "actual-fallback-provider", apiKey: "fixture" } };
  const result = await f.run({ fallback });
  assert.equal(result.ok, true);
  assert.equal(f.runs.length, 2);
  assert.equal(f.runs[0].model, "original-model");
  assert.equal(f.runs[1].model, fallback.model);
  assert.equal(f.batches.length, 1);
  assert.equal(f.batches[0].model, fallback.model);
  assert.equal(f.batches[0].conversationId, "original-conversation");
});
