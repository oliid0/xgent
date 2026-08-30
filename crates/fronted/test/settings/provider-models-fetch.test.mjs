import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader({
  mocks: {
    "@tauri-apps/api/core": {
      invoke(command, args) {
        if (command === "proxy_get_server_info") {
          return Promise.resolve({ baseUrl: "http://proxy.local:9999", token: "proxy-token" });
        }
        throw new Error(`unexpected invoke(${command})`);
      },
    },
  },
});
const providerUtils = loader.loadModule("src/pages/settings/providerUtils.ts");

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(JSON.stringify(payload)),
  };
}

function withFetchStub(responder, run) {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => {
    calls.push({ url: String(url), options });
    return Promise.resolve(responder(String(url), calls.length));
  };
  return Promise.resolve()
    .then(() => run(calls))
    .finally(() => {
      if (previousFetch === undefined) delete globalThis.fetch;
      else globalThis.fetch = previousFetch;
    });
}

test("buildProviderModelsUrl defaults to /v1/models and falls back to official endpoints", () => {
  assert.equal(
    providerUtils.buildProviderModelsUrl("gemini", "https://relay.example.com", "default"),
    "https://relay.example.com/v1/models",
  );
  assert.equal(
    providerUtils.buildProviderModelsUrl("gemini", "https://relay.example.com", "official"),
    "https://relay.example.com/v1beta/models",
  );
  assert.equal(
    providerUtils.buildProviderModelsUrl(
      "gemini",
      "https://generativelanguage.googleapis.com/v1beta",
      "default",
    ),
    "https://generativelanguage.googleapis.com/v1/models",
  );
  assert.equal(
    providerUtils.buildProviderModelsUrl("claude_code", "https://relay.example.com", "default"),
    "https://relay.example.com/v1/models",
  );
  assert.equal(
    providerUtils.buildProviderModelsUrl("claude_code", "https://relay.example.com", "official"),
    "https://relay.example.com/v1/models",
  );
  assert.equal(
    providerUtils.buildProviderModelsUrl("codex", "https://relay.example.com/v1", "default"),
    "https://relay.example.com/v1/models",
  );
  assert.equal(
    providerUtils.buildProviderModelsUrl(
      "codex",
      "https://relay.example.com/v1/models",
      "default",
    ),
    "https://relay.example.com/v1/models",
  );
});

test("normalizeProviderModelsBaseUrl derives discovery roots from complete inference URLs", () => {
  assert.equal(
    providerUtils.normalizeProviderModelsBaseUrl(
      "codex",
      "https://relay.example.com/custom/v1/responses?region=cn",
      true,
    ),
    "https://relay.example.com/custom/v1",
  );
  assert.equal(
    providerUtils.normalizeProviderModelsBaseUrl(
      "claude_code",
      "https://relay.example.com/anthropic/v1/messages",
      true,
    ),
    "https://relay.example.com/anthropic/v1",
  );
});

test("buildProviderModelsAttempts orders default before official with provider headers", () => {
  const gemini = providerUtils.buildProviderModelsAttempts(
    "gemini",
    "https://relay.example.com",
    "test-key",
  );
  assert.equal(gemini.length, 2);
  assert.deepEqual(
    gemini.map((attempt) => attempt.kind),
    ["default", "official"],
  );
  assert.equal(gemini[0].headers.Authorization, "Bearer test-key");
  assert.equal(gemini[0].headers["x-goog-api-key"], undefined);
  assert.equal(gemini[1].headers.Authorization, undefined);
  assert.equal(gemini[1].headers["x-goog-api-key"], "test-key");

  const claude = providerUtils.buildProviderModelsAttempts(
    "claude_code",
    "https://relay.example.com",
    "test-key",
  );
  assert.equal(claude.length, 2);
  assert.equal(claude[0].headers.Authorization, "Bearer test-key");
  assert.equal(claude[0].headers["x-api-key"], undefined);
  assert.equal(claude[0].headers["anthropic-version"], undefined);
  assert.equal(claude[1].headers.Authorization, undefined);
  assert.equal(claude[1].headers["x-api-key"], "test-key");
  assert.equal(claude[1].headers["anthropic-version"], "2023-06-01");

  const codex = providerUtils.buildProviderModelsAttempts(
    "codex",
    "https://relay.example.com",
    "test-key",
  );
  assert.equal(codex.length, 1);
  assert.equal(codex[0].headers["x-api-key"], undefined);
  assert.equal(codex[0].headers.Authorization, "Bearer test-key");

  const inferenceOnlyHeaders = [
    "x-app",
    "user-agent",
    "anthropic-beta",
    "anthropic-dangerous-direct-browser-access",
    "session_id",
    "conversation_id",
  ];
  for (const attempt of [...gemini, ...claude, ...codex]) {
    const headerNames = Object.keys(attempt.headers).map((name) => name.toLowerCase());
    assert.ok(!headerNames.some((name) => name.startsWith("x-stainless-")));
    for (const name of inferenceOnlyHeaders) assert.ok(!headerNames.includes(name), name);
  }
});

test("provider model fetch identity changes when system proxy routing changes", () => {
  const direct = providerUtils.buildProviderModelsFetchKey(
    " https://relay.example.com/v1 ",
    " test-key ",
    false,
  );
  const proxied = providerUtils.buildProviderModelsFetchKey(
    "https://relay.example.com/v1",
    "test-key",
    true,
  );

  assert.equal(direct, "https://relay.example.com/v1||test-key||direct||api-key||||base||||");
  assert.equal(proxied, "https://relay.example.com/v1||test-key||proxy||api-key||||base||||");
  assert.notEqual(direct, proxied);
});

test("pickProviderModelsFailure prefers informative errors over missing-endpoint noise", () => {
  assert.deepEqual(
    providerUtils.pickProviderModelsFailure([
      { status: 401, message: "invalid api key" },
      { status: 404, message: "not found" },
    ]),
    { status: 401, message: "invalid api key" },
  );
  assert.deepEqual(
    providerUtils.pickProviderModelsFailure([
      { status: 404, message: "not found" },
      { status: 400, message: "api key invalid" },
    ]),
    { status: 400, message: "api key invalid" },
  );
  assert.deepEqual(
    providerUtils.pickProviderModelsFailure([
      { status: 404, message: "first" },
      { status: 404, message: "second" },
    ]),
    { status: 404, message: "second" },
  );
  assert.equal(providerUtils.pickProviderModelsFailure([]), null);
});

test("fetchModelsFromApi falls back to the official gemini endpoint on 404", async () => {
  await withFetchStub(
    (url) =>
      url.includes("/v1/models")
        ? jsonResponse(404, { error: "not found" })
        : jsonResponse(200, { models: [{ name: "models/gemini-2.5-pro" }] }),
    async (calls) => {
      const models = await providerUtils.fetchModelsFromApi(
        "gemini",
        "https://relay.example.com",
        "test-key",
      );
      assert.equal(calls.length, 2);
      assert.ok(calls[0].url.endsWith("/proxy/gemini/v1/models"));
      assert.ok(calls[1].url.endsWith("/proxy/gemini/v1beta/models"));
      assert.deepEqual(
        models.map((model) => model.id),
        ["gemini-2.5-pro"],
      );
    },
  );
});

test("fetchModelsFromApi returns the default /v1/models result without falling back", async () => {
  await withFetchStub(
    () => jsonResponse(200, { data: [{ id: "gpt-5" }] }),
    async (calls) => {
      const models = await providerUtils.fetchModelsFromApi(
        "codex",
        "https://relay.example.com",
        "test-key",
      );
      assert.equal(calls.length, 1);
      assert.ok(calls[0].url.endsWith("/proxy/codex/v1/models"));
      assert.deepEqual(
        models.map((model) => model.id),
        ["gpt-5"],
      );
    },
  );
});

test("fetchModelsFromApi falls back to official when the default list is empty", async () => {
  await withFetchStub(
    (url) =>
      url.includes("/v1/models")
        ? jsonResponse(200, { data: [] })
        : jsonResponse(200, { models: [{ name: "models/gemini-2.5-flash" }] }),
    async (calls) => {
      const models = await providerUtils.fetchModelsFromApi(
        "gemini",
        "https://relay.example.com",
        "test-key",
      );
      assert.equal(calls.length, 2);
      assert.deepEqual(
        models.map((model) => model.id),
        ["gemini-2.5-flash"],
      );
    },
  );
});

test("fetchModelsFromApi surfaces the informative failure when every attempt fails", async () => {
  await withFetchStub(
    (url) =>
      url.includes("/v1/models")
        ? jsonResponse(401, { error: "invalid api key" })
        : jsonResponse(404, { error: "not found" }),
    async (calls) => {
      await assert.rejects(
        providerUtils.fetchModelsFromApi("gemini", "https://relay.example.com", "test-key"),
        /invalid api key/,
      );
      assert.equal(calls.length, 2);
    },
  );
});

test("fetchModelsFromApi retries claude_code with official anthropic headers", async () => {
  await withFetchStub(
    (_url, callIndex) =>
      callIndex === 1
        ? jsonResponse(401, { error: "authorization header rejected" })
        : jsonResponse(200, { data: [{ id: "claude-opus-4-8" }] }),
    async (calls) => {
      const models = await providerUtils.fetchModelsFromApi(
        "claude_code",
        "https://relay.example.com",
        "test-key",
      );
      assert.equal(calls.length, 2);
      assert.equal(calls[0].options.headers.Authorization, "Bearer test-key");
      assert.equal(calls[1].options.headers.Authorization, undefined);
      assert.equal(calls[1].options.headers["x-api-key"], "test-key");
      assert.deepEqual(
        models.map((model) => model.id),
        ["claude-opus-4-8"],
      );
    },
  );
});

test("fetchModelsFromApi follows Gemini page tokens and returns every model", async () => {
  await withFetchStub(
    (url) =>
      url.includes("/v1beta/models")
        ? jsonResponse(200, { models: [] })
        : url.includes("pageToken=page-2")
          ? jsonResponse(200, { models: [{ name: "models/gemini-2.5-flash" }] })
          : jsonResponse(200, {
              models: [{ name: "models/gemini-2.5-pro" }],
              nextPageToken: "page-2",
            }),
    async (calls) => {
      const models = await providerUtils.fetchModelsFromApi(
        "gemini",
        "https://relay.example.com",
        "test-key",
      );
      assert.equal(calls.length, 3);
      assert.match(calls[1].url, /pageToken=page-2/);
      assert.deepEqual(
        models.map((model) => model.id),
        ["gemini-2.5-pro", "gemini-2.5-flash"],
      );
    },
  );
});

test("fetchModelsFromApi merges successful Gemini v1 and v1beta catalogs", async () => {
  await withFetchStub(
    (url) =>
      url.includes("/v1beta/models")
        ? jsonResponse(200, { models: [{ name: "models/gemini-2.5-flash" }] })
        : jsonResponse(200, { models: [{ name: "models/gemini-2.5-pro" }] }),
    async (calls) => {
      const models = await providerUtils.fetchModelsFromApi(
        "gemini",
        "https://relay.example.com",
        "test-key",
      );
      assert.equal(calls.length, 2);
      assert.deepEqual(
        models.map((model) => model.id),
        ["gemini-2.5-pro", "gemini-2.5-flash"],
      );
    },
  );
});

test("fetchModelsFromApi follows Anthropic after_id pagination", async () => {
  await withFetchStub(
    (_url, callIndex) =>
      callIndex === 1
        ? jsonResponse(200, {
            data: [{ id: "claude-opus-4-8" }],
            has_more: true,
            last_id: "claude-opus-4-8",
          })
        : jsonResponse(200, { data: [{ id: "claude-sonnet-4-6" }], has_more: false }),
    async (calls) => {
      const models = await providerUtils.fetchModelsFromApi(
        "claude_code",
        "https://relay.example.com",
        "test-key",
      );
      assert.equal(calls.length, 2);
      assert.match(calls[1].url, /after_id=claude-opus-4-8/);
      assert.deepEqual(
        models.map((model) => model.id),
        ["claude-opus-4-8", "claude-sonnet-4-6"],
      );
    },
  );
});

test("fetchModelsFromApi accepts nested model-list response envelopes", async () => {
  await withFetchStub(
    () => jsonResponse(200, { result: { models: [{ id: "relay-model" }] } }),
    async () => {
      const models = await providerUtils.fetchModelsFromApi(
        "codex",
        "https://relay.example.com",
        "test-key",
      );
      assert.deepEqual(
        models.map((model) => model.id),
        ["relay-model"],
      );
    },
  );
});

test("fetchModelsFromApi derives model discovery from a complete inference URL", async () => {
  await withFetchStub(
    () => jsonResponse(200, { data: [{ id: "gpt-5" }] }),
    async (calls) => {
      await providerUtils.fetchModelsFromApi(
        "codex",
        "https://relay.example.com/custom/v1/responses?region=cn",
        "test-key",
        { isFullUrl: true },
      );
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, "http://proxy.local:9999/proxy/codex/custom/v1/models");
    },
  );
});

test("fetchModelsFromApi preserves an exact model-list URL through the proxy", async () => {
  await withFetchStub(
    () => jsonResponse(200, { data: [{ id: "relay-model" }] }),
    async (calls) => {
      await providerUtils.fetchModelsFromApi("codex", "https://relay.example.com/v1", "test-key", {
        modelsUrl: "https://models.example.com/catalog?channel=stable",
      });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, "http://proxy.local:9999/proxy/codex");
      assert.equal(
        calls[0].options.headers["x-xagent-upstream-url"],
        "https://models.example.com/catalog?channel=stable",
      );
    },
  );
});

test("provider-declared limits refresh automatic values but preserve user edits", () => {
  const [fetched] = providerUtils.normalizeFetchedModels(
    [
      {
        id: "relay-model",
        context_length: 128_000,
        top_provider: { max_completion_tokens: 16_000 },
      },
    ],
    "codex",
  );
  assert.deepEqual(
    {
      contextWindow: fetched.contextWindow,
      maxOutputToken: fetched.maxOutputToken,
      limitsSource: fetched.limitsSource,
    },
    { contextWindow: 128_000, maxOutputToken: 16_000, limitsSource: "provider" },
  );

  const refreshed = providerUtils.mergeFetchedModels(
    [fetched],
    [
      {
        id: "relay-model",
        contextWindow: 64_000,
        maxOutputToken: 8_000,
        limitsSource: "fallback",
      },
    ],
  );
  assert.equal(refreshed[0].contextWindow, 128_000);
  assert.equal(refreshed[0].limitsSource, "provider");

  const preserved = providerUtils.mergeFetchedModels(
    [fetched],
    [
      {
        id: "relay-model",
        contextWindow: 96_000,
        maxOutputToken: 12_000,
        limitsSource: "user",
      },
    ],
  );
  assert.equal(preserved[0].contextWindow, 96_000);
  assert.equal(preserved[0].maxOutputToken, 12_000);
  assert.equal(preserved[0].limitsSource, "user");
});
