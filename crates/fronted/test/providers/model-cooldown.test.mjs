import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const { ModelCooldownRegistry, retryAfterDeadline } = loader.loadModule("src/lib/providers/runtime/modelCooldown.ts");
const { SubagentModelPool } = loader.loadModule("src/lib/subagents/modelRouting.ts");
const response = (status, value) => new Response("upstream", {
  status, headers: value === undefined ? {} : { "Retry-After": value },
});
const candidate = (account, skills = ["coding"]) => ({
  value: `${account}::shared`, providerId: "codex", providerName: account,
  model: "shared", skills, maxConcurrency: 1,
  runtime: { providerConfigId: account, apiKey: `secret-${account}`, baseUrl: "https://example.test" },
});
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

test("Retry-After respects integer seconds, HTTP dates, zero and rejects invalid numbers", () => {
  const now = Date.parse("Fri, 09 Oct 2026 12:00:00 GMT");
  assert.equal(retryAfterDeadline(" 120 ", now), now + 120_000);
  assert.equal(retryAfterDeadline("Fri, 09 Oct 2026 12:02:00 GMT", now), now + 120_000);
  assert.equal(retryAfterDeadline("Thu, 08 Oct 2026 12:00:00 GMT", now), now);
  assert.equal(retryAfterDeadline("0", now), now);
  for (const value of [null, "", "-1", "1.5", "1e3", "NaN", "Infinity", "123oops"])
    assert.equal(retryAfterDeadline(value, now), undefined, value);
  assert.equal(retryAfterDeadline("999999999999999999999", now), 8_640_000_000_000_000);
});

test("only actual throttling/service HTTP statuses create exact-model cooldown evidence", () => {
  let now = 1000;
  const registry = new ModelCooldownRegistry(() => now);
  for (const status of [200, 400, 401, 403, 404, 500]) registry.observe("a::m", response(status, "120"));
  assert.equal(registry.snapshot("a::m"), undefined);
  registry.observe("a::m", response(429, "120"));
  assert.deepEqual(registry.snapshot("a::m"), { observedAt: 1000, retryAt: 121000, httpStatus: 429 });
  assert.equal(registry.snapshot("b::m"), undefined);
  assert.equal(registry.snapshot("a::other"), undefined);
  now = 121000;
  assert.equal(registry.snapshot("a::m"), undefined);
  registry.observe("a::m", response(503, "bad"));
  assert.equal(registry.remainingMs("a::m"), 60000);
  registry.observe("a::other", response(529));
  assert.equal(registry.remainingMs("a::other"), 60000);
});

test("concurrent success or shorter cooldown cannot erase a still-active longer delay", () => {
  let now = 1000;
  const registry = new ModelCooldownRegistry(() => now);
  registry.observe("a::m", response(429, "120"));
  now += 5000;
  registry.observe("a::m", response(200));
  registry.observe("a::m", response(429, "1"));
  assert.equal(registry.snapshot("a::m").retryAt, 121000);
  registry.observe("a::m", response(429, "180"));
  assert.equal(registry.snapshot("a::m").retryAt, 186000);
});

test("capture preserves response identity and unread body, arguments, cancellation and transport errors", async () => {
  const registry = new ModelCooldownRegistry(() => 1000);
  const actual = response(429, "2");
  const controller = new AbortController();
  const input = new Request("https://relay.test/v1", { method: "POST", body: "private" });
  const init = { signal: controller.signal };
  const fetch = registry.captureFetch("a::m", async (sent, options) => {
    assert.equal(sent, input); assert.equal(options, init); return actual;
  });
  assert.equal(await fetch(input, init), actual);
  assert.equal(actual.bodyUsed, false);
  assert.equal(await actual.text(), "upstream");
  assert.equal(registry.remainingMs("a::m"), 2000);
  const error = new Error("offline 429 text is not a response");
  await assert.rejects(registry.captureFetch("b::m", async () => { throw error; })(input, init), e => e === error);
  assert.equal(registry.snapshot("b::m"), undefined);
});

test("new skills-based work selects another idle eligible account and roster exposes no credentials", async () => {
  const registry = new ModelCooldownRegistry(() => 1000);
  const pool = new SubagentModelPool(registry);
  const models = [candidate("limited"), candidate("idle"), candidate("wrong-skill", ["research"])];
  registry.observe(models[0].value, response(429, "120"));
  const chosen = await pool.run(pool.eligible(models, undefined, ["coding"]), async binding => binding.value);
  assert.equal(chosen, models[1].value);
  const snapshot = pool.snapshot(models);
  assert.equal(snapshot[0].availability, "cooling_down");
  assert.equal(snapshot[0].cooldown.retryAt, 121000);
  assert.equal(snapshot[1].availability, "configured_unprobed");
  assert.ok(!JSON.stringify(snapshot).includes("secret-"));
  assert.ok(!JSON.stringify(snapshot).includes("Retry-After"));
});

test("a pinned task waits for its original model then starts once after expiry", async () => {
  let now = 1000;
  const registry = new ModelCooldownRegistry(() => now);
  const pool = new SubagentModelPool(registry);
  const models = [candidate("original"), candidate("other")];
  registry.observe(models[0].value, response(429, "1"));
  let calls = 0;
  const task = pool.run(pool.eligible(models, models[0].value), async binding => {
    calls++; assert.equal(binding.value, models[0].value); return "done";
  });
  await tick(); assert.equal(calls, 0);
  now = 2000;
  // Another observed model change wakes the same queue to re-evaluate expiry.
  registry.observe(models[1].value, response(429, "1"));
  assert.equal(await task, "done");
  assert.equal(calls, 1);
  assert.equal(pool.snapshot(models)[0].activeRuns, 0);
});

test("cooldown timer wakes unoccupied work without relying on an active delegate finishing", async () => {
  const until = Date.now() + 30;
  const registry = new ModelCooldownRegistry(() => Date.now() < until ? 1000 : 2000);
  const pool = new SubagentModelPool(registry);
  const model = candidate("original");
  registry.observe(model.value, response(429, "1"));
  let calls = 0;
  await pool.run([model], async () => { calls++; });
  assert.equal(calls, 1);
  assert.equal(pool.snapshot([model])[0].availability, "configured_unprobed");
});

test("cancelling cooldown wait releases timers/listeners and never starts or moves the job", async () => {
  const registry = new ModelCooldownRegistry(() => 1000);
  const pool = new SubagentModelPool(registry);
  const model = candidate("original");
  registry.observe(model.value, response(429, "999999999999999999999"));
  const controller = new AbortController();
  const waiting = pool.run([model], async () => assert.fail("cancelled job must not start"), controller.signal);
  controller.abort(new Error("user stopped"));
  await assert.rejects(waiting, /user stopped/);
  assert.equal(pool.snapshot([model])[0].activeRuns, 0);
});

test("an already-started task failure is returned unchanged without execution on another model", async () => {
  const registry = new ModelCooldownRegistry(() => 1000);
  const pool = new SubagentModelPool(registry);
  const models = [candidate("first"), candidate("second")];
  const effects = [];
  const error = new Error("write outcome unknown");
  await assert.rejects(pool.run(models, async binding => {
    effects.push(binding.value); registry.observe(binding.value, response(429, "120")); throw error;
  }), e => e === error);
  assert.deepEqual(effects, [models[0].value]);
  assert.deepEqual(Array.from(pool.snapshot(models), model => model.activeRuns), [0, 0]);
});

test("SDK millisecond retry delays take precedence, invalid values fall back to standard Retry-After", () => {
  const registry = new ModelCooldownRegistry(() => 1000);
  registry.observe("ms::m", new Response("limited", { status: 429, headers: {
    "retry-after-ms": "1500.5", "retry-after": "120",
  } }));
  assert.equal(registry.remainingMs("ms::m"), 1500.5);
  registry.observe("bad::m", new Response("limited", { status: 429, headers: {
    "retry-after-ms": "Infinity", "retry-after": "120",
  } }));
  assert.equal(registry.remainingMs("bad::m"), 120000);
});

test("installed Pi SDK rejects real HTTP 429 while production stream captures cooldown without another model run", async () => {
  const { stream } = await import("@earendil-works/pi-ai/api/openai-completions");
  let requests = 0;
  const server = createServer((request, response) => {
    requests++;
    request.resume();
    response.writeHead(429, { "content-type": "application/json", "retry-after": "120" });
    response.end(JSON.stringify({ error: { type: "rate_limit_error", message: "limited" } }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const registry = new ModelCooldownRegistry(() => 1000);
  try {
    const loader = createTsModuleLoader({ mocks: {
      "@earendil-works/pi-ai/api/openai-completions": { stream },
    } });
    const { streamSimpleByApi } = loader.loadModule("src/lib/providers/runtime/streamByApi.ts");
    const result = await streamSimpleByApi({
      id: "gpt-5", name: "gpt-5", api: "openai-completions", provider: "openai",
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`, reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 16000, maxTokens: 1024,
    }, { messages: [{ role: "user", content: "inspect", timestamp: 1 }] }, {
      apiKey: "loopback-test", streamRetry: { disabled: true },
      fetch: registry.captureFetch("account::gpt-5", globalThis.fetch),
    }).result();
    assert.equal(result.stopReason, "error");
    assert.equal(requests, 1);
    assert.equal(registry.remainingMs("account::gpt-5"), 120000);
    assert.equal(registry.snapshot("other::gpt-5"), undefined);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test("native proxy exposes only retry headers so WebViews can read the actual delay", () => {
  const source = readFileSync(new URL("../../src-tauri/src/services/proxy.rs", import.meta.url), "utf8");
  assert.match(source, /HeaderName::from_static\("access-control-expose-headers"\),\s*HeaderValue::from_static\("retry-after, retry-after-ms"\)/);
});

test("default pnpm test contract skips Cargo instead of silently running native builds", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.match(manifest.scripts.test, /--test-skip-pattern="Tauri backend cargo test suite passes"/);
});
