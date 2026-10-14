import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function entry(slug, description, overrides = {}) {
  return { slug, description, headline: "", scope: "global", memoryType: "user",
    updatedAt: 100, unreviewed: false, confidence: "high", ...overrides };
}

function setup(entries = {}, read) {
  const calls = [], indexes = [];
  const overview = { user: [], project: [], global: [], recentDays: [], root: "/memory", ...entries };
  const api = {
    async memoryIndexOverview(workdir) { indexes.push(workdir); return overview; },
    async memoryRead(args) {
      calls.push(args);
      if (read) return read(args);
      const e = [...overview.user, ...overview.global, ...overview.project].find(
        e => e.slug === args.slug && e.scope === args.scope);
      return { ...e, body: `Actual saved preference for ${e.description}`, totalLines: 1,
        window: { offset: 0, length: 1, truncated: false },
        meta: { unreviewed: e.unreviewed, confidence: e.confidence, source: { actor: "extractor", conversationId: "original-conversation" },
          createdAt: 10, updatedAt: e.updatedAt, archived: false } };
    },
  };
  const loader = createTsModuleLoader({ mocks: { "./api": api, "../api": api } });
  const injection = loader.loadModule("src/lib/memory/prompts/injection.ts");
  const recall = loader.loadModule("src/lib/memory/scheduledRecall.ts");
  const config = loader.loadModule("src/lib/memory/config.ts");
  return { calls, indexes, overview, config, ...injection, ...recall };
}

test("scheduled recall uses actual scoped personal reads, confidence and timestamp; excludes daily/code/reference", async () => {
  const f = setup({ user: [entry("exercise", "Evening exercise", { unreviewed: true, confidence: "low" }), entry("music", "Jazz albums")],
    project: [entry("quiet", "Exercise reminder feedback", { scope: "project", memoryType: "feedback" }),
      entry("code", "Exercise tracking source code", { scope: "project", memoryType: "project" })],
    global: [entry("docs", "Exercise API reference", { memoryType: "reference" })],
    recentDays: [entry("daily-2026-10-12", "Exercise yesterday", { memoryType: "daily" })] });
  const text = await f.buildMemoryOverviewSection("/original", { prompt: "Remind me about evening exercise" });
  assert.deepEqual(f.indexes, ["/original"]);
  assert.deepEqual(f.calls.map(x => [x.slug, x.scope, x.workdir, x.length]),
    [["exercise", "global", "/original", 16], ["quiet", "project", "/original", 16]]);
  const related = text.split("## Related personal memory")[1];
  assert.match(related, /Actual saved preference for Evening exercise/);
  assert.match(related, /"confidence":"low","unreviewed":true,"updatedAt":100/);
  assert.match(related, /original-conversation/);
  assert.doesNotMatch(related, /Jazz albums|source code|API reference|yesterday/);
  assert.match(related, /not current sensor readings, permissions or proof of a learned routine/);
});

test("foreground index-only callers retain original context and do not auto-read entries", async () => {
  const f = setup({ user: [entry("exercise", "Evening exercise")] });
  const text = await f.buildMemoryOverviewSection("/code");
  assert.equal(text, f.formatMemoryOverview(f.overview, "/code"));
  assert.deepEqual(f.calls, []);
});

test("empty stores and punctuation-only requests perform no automatic reads", async () => {
  const empty = setup();
  assert.equal(await empty.buildMemoryOverviewSection("/p", { prompt: "exercise" }), "");
  assert.deepEqual(empty.calls, []);
  const personal = setup({ user: [entry("exercise", "exercise")] });
  const text = await personal.buildMemoryOverviewSection("/p", { prompt: "?!" });
  assert.doesNotMatch(text, /Related personal memory/);
  assert.deepEqual(personal.calls, []);
});

test("CJK and non-Latin task words match real descriptions; unrelated prompts read nothing", async () => {
  const f = setup({ user: [entry("fitness", "每天晚上健身"), entry("cafe", "Préférence café"), entry("russian", "вечерняя прогулка")] });
  assert.match(await f.buildScheduledMemoryRecall(f.overview, "/p", { prompt: "提醒我健身" }), /fitness/);
  assert.match(await f.buildScheduledMemoryRecall(f.overview, "/p", { prompt: "CAFÉ" }), /cafe/);
  assert.match(await f.buildScheduledMemoryRecall(f.overview, "/p", { prompt: "ПРОГУЛКА" }), /russian/);
  const before = f.calls.length;
  assert.equal(await f.buildScheduledMemoryRecall(f.overview, "/p", { prompt: "compile apk" }), "");
  assert.equal(f.calls.length, before);
});

test("deduplicates scoped identity, bounds actual reads/excerpts and preserves Unicode", async () => {
  const items = Array.from({ length: 12 }, (_, i) => entry(`fitness-${i}`, "fitness", { updatedAt: i }));
  const f = setup({ user: [...items, items[0]], global: [items[0]] }, async args => ({
    ...items.find(e => e.slug === args.slug), body: "🏃".repeat(1000),
    window: { offset: 0, length: 16, truncated: false },
    meta: { unreviewed: true, confidence: "medium", updatedAt: 200, archived: false, source: { actor: "extractor", note: "🏃".repeat(1000) } },
  }));
  const text = await f.buildScheduledMemoryRecall(f.overview, "/p", { prompt: "fitness" });
  assert.equal(f.calls.length, f.config.SCHEDULED_RECALL_ENTRY_LIMIT);
  assert.equal(new Set(f.calls.map(e => e.slug)).size, f.calls.length);
  assert.ok(text.length <= f.config.SCHEDULED_RECALL_PROMPT_CHARS);
  for (const line of text.split("\n").filter(line => line.startsWith("{"))) {
    const e = JSON.parse(line);
    assert.equal(Array.from(e.excerpt).length, f.config.SCHEDULED_RECALL_EXCERPT_CHARS);
    assert.equal(e.truncated, true);
    assert.equal(e.updatedAt, 200);
    assert.equal(Array.from(e.sourceExcerpt).length, f.config.SCHEDULED_RECALL_SOURCE_CHARS);
    assert.equal(e.sourceTruncated, true);
  }
});

test("disappeared, archived or changed identities are disclosed, never filled with guessed bodies", async () => {
  for (const change of ["failed", "archived", "slug", "scope", "memoryType"]) {
    const e = entry("fitness", "fitness");
    const f = setup({ user: [e] }, async () => {
      if (change === "failed") throw new Error("missing");
      return { ...e, ...(change === "archived" ? {} : { [change]: "different" }),
        body: "must not inject this", meta: { archived: change === "archived" } };
    });
    const text = await f.buildMemoryOverviewSection("/p", { prompt: "fitness" });
    assert.match(text, /# Memory Index/);
    assert.match(text, /could not be read in their original scope/);
    assert.doesNotMatch(text, /must not inject/);
  }
});

test("cancellation before recall or during a read stops further work and is not treated as unavailable memory", async () => {
  const controller = new AbortController();
  const f = setup({ user: [entry("fitness", "fitness"), entry("other", "fitness")] }, async () => {
    controller.abort(new Error("user stopped"));
    throw new Error("read failed");
  });
  await assert.rejects(f.buildMemoryOverviewSection("/p", { prompt: "fitness", signal: controller.signal }), /user stopped/);
  assert.equal(f.calls.length, 1);
  await assert.rejects(f.buildMemoryOverviewSection("/p", { prompt: "fitness", signal: controller.signal }), /user stopped/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.indexes.length, 1);
});
