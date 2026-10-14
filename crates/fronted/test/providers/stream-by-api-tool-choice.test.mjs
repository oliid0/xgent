import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function createUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function createSourceStream() {
  const assistant = {
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
    api: "openai-completions",
    provider: "openai",
    model: "gpt-5.6",
    usage: createUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
  };
  const events = [
    { type: "start", partial: { ...assistant, content: [] } },
    { type: "done", reason: "stop", message: assistant },
  ];
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
    async result() {
      return assistant;
    },
  };
}

function createOpenAICompletionsModel() {
  return {
    id: "gpt-5.6",
    name: "gpt-5.6",
    api: "openai-completions",
    provider: "openai",
    baseUrl: "https://relay.example.com/v1",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 272000,
    maxTokens: 128000,
  };
}

function createLoaderCapturingOptions(capturedOptions) {
  return createTsModuleLoader({
    mocks: {
      "@earendil-works/pi-ai/api/openai-completions": {
        stream(_model, _context, options) {
          capturedOptions.push(options);
          return createSourceStream();
        },
      },
    },
  });
}

async function streamOnce(context, toolChoice) {
  const capturedOptions = [];
  const loader = createLoaderCapturingOptions(capturedOptions);
  const { streamSimpleByApi } = loader.loadModule("src/lib/providers/runtime/streamByApi.ts");
  const stream = streamSimpleByApi(createOpenAICompletionsModel(), context, {
    apiKey: "test-key",
    toolChoice,
  });
  await stream.result();
  assert.equal(capturedOptions.length, 1);
  return capturedOptions[0];
}

const echoTool = {
  name: "echo",
  description: "Echo tool",
  parameters: { type: "object", properties: {} },
};

test("openai-completions: 无工具请求不下发 tool_choice（压缩摘要等 text-only 路径）", async () => {
  const options = await streamOnce(
    { messages: [{ role: "user", content: "compaction payload", timestamp: 1 }] },
    "none",
  );
  assert.equal(options.toolChoice, undefined);
});

test("openai-completions: 无工具请求即使 toolChoice=auto 也不下发", async () => {
  const options = await streamOnce(
    { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
    "auto",
  );
  assert.equal(options.toolChoice, undefined);
});

test("openai-completions: 带工具请求保留 tool_choice=none", async () => {
  const options = await streamOnce(
    {
      tools: [echoTool],
      messages: [{ role: "user", content: "hi", timestamp: 1 }],
    },
    "none",
  );
  assert.equal(options.toolChoice, "none");
});

test("openai-completions: 带工具请求 any 映射为 required", async () => {
  const options = await streamOnce(
    {
      tools: [echoTool],
      messages: [{ role: "user", content: "hi", timestamp: 1 }],
    },
    "any",
  );
  assert.equal(options.toolChoice, "required");
});

test("supported HTTP adapters retain the caller's actual fetch boundary", async () => {
  for (const api of ["openai-completions", "openai-responses", "anthropic-messages"]) {
    const captured = [];
    const loader = createTsModuleLoader({ mocks: {
      [`@earendil-works/pi-ai/api/${api}`]: { stream(_model, _context, options) {
        captured.push(options); return createSourceStream();
      } },
    } });
    const { streamSimpleByApi } = loader.loadModule("src/lib/providers/runtime/streamByApi.ts");
    const fetch = async () => new Response("provider");
    await streamSimpleByApi({ ...createOpenAICompletionsModel(), api }, { messages: [] }, {
      apiKey: "key", fetch, streamRetry: { disabled: true },
    }).result();
    assert.equal(captured.length, 1, api);
    assert.equal(captured[0].fetch, fetch, api);
  }
});

test("every supported provider refuses the initial model request before its SDK starts when shared budget is exhausted", async () => {
  for (const api of ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai", "deepseek-responses"]) {
    let starts = 0;
    const loader = createTsModuleLoader({ mocks: {
      [`@earendil-works/pi-ai/api/${api}`]: { stream() { starts++; return createSourceStream(); } },
    } });
    const { streamSimpleByApi } = loader.loadModule("src/lib/providers/runtime/streamByApi.ts");
    const result = await streamSimpleByApi({ ...createOpenAICompletionsModel(), api }, { messages: [] }, {
      apiKey: "key", beforeModelRequest() { throw new Error("Shared execution budget exhausted"); },
    }).result();
    assert.equal(result.stopReason, "error", api);
    assert.match(result.errorMessage, /Shared execution budget exhausted/, api);
    assert.equal(starts, 0, api);
  }
});

test("outer stream retry spends the shared admission budget and reports exhaustion rather than replaying the previous 429", async () => {
  let starts = 0;
  const loader = createTsModuleLoader({ mocks: {
    "@earendil-works/pi-ai/api/openai-completions": { stream() {
      starts++;
      const source = createSourceStream();
      return {
        async *[Symbol.asyncIterator]() {
          const assistant = await source.result();
          yield { type: "error", reason: "error", error: { ...assistant, content: [], stopReason: "error", errorMessage: "429 too many requests" } };
        },
      };
    } },
  } });
  const { ExecutionBudget } = loader.loadModule("src/lib/subagents/executionBudget.ts");
  const { streamSimpleByApi } = loader.loadModule("src/lib/providers/runtime/streamByApi.ts");
  const budget = new ExecutionBudget({ maxModelRequests: 1, maxToolCalls: 4 });
  const result = await streamSimpleByApi(createOpenAICompletionsModel(), { messages: [] }, {
    apiKey: "key", beforeModelRequest: () => budget.consume("modelRequests"),
  }).result();
  assert.equal(starts, 1);
  assert.equal(result.stopReason, "error");
  assert.match(result.errorMessage, /Shared execution budget exhausted/);
  assert.equal(budget.snapshot().modelRequests.used, 1);
});

test("async durable admission resolves before every SDK starts, preserves stream events and honors cancellation", async () => {
  for (const mode of ["accept", "refuse", "cancel"]) {
    let starts = 0, release;
    const gate = new Promise(resolve => { release = resolve; });
    const controller = new AbortController();
    const loader = createTsModuleLoader({ mocks: {
      "@earendil-works/pi-ai/api/openai-completions": { stream() { starts++; return createSourceStream(); } },
    } });
    const { streamSimpleByApi } = loader.loadModule("src/lib/providers/runtime/streamByApi.ts");
    const stream = streamSimpleByApi(createOpenAICompletionsModel(), { messages: [] }, {
      apiKey: "key", signal: controller.signal, streamRetry: { disabled: true },
      beforeModelRequest: async () => { await gate; if (mode === "refuse") throw new Error("durable budget refused"); },
    });
    await Promise.resolve(); assert.equal(starts, 0);
    if (mode === "cancel") controller.abort();
    release();
    const events = []; for await (const event of stream) events.push(event.type);
    const result = await stream.result();
    if (mode === "accept") { assert.equal(starts, 1); assert.deepEqual(events, ["start", "done"]); assert.equal(result.stopReason, "stop"); }
    else { assert.equal(starts, 0); assert.equal(result.stopReason, "error"); assert.deepEqual(events, ["error"]); }
  }
});
