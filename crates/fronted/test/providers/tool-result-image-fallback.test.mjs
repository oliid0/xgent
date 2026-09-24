import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const toolResult = {
  role: "toolResult",
  toolCallId: "browser-1",
  toolName: "browser_use",
  content: [
    { type: "text", text: "Opened https://example.com" },
    { type: "image", mimeType: "image/png", data: "aW1hZ2U=" },
  ],
  timestamp: 1,
};

test("text-only model gets a notice while history and image-capable requests retain screenshots", () => {
  const loader = createTsModuleLoader();
  const { omitToolResultImagesForTextOnlyModel } = loader.loadModule(
    "src/lib/providers/runtime/toolResultImageFallback.ts",
  );
  const context = { messages: [toolResult] };
  const textModel = { id: "text-model", input: ["text"] };
  const adapted = omitToolResultImagesForTextOnlyModel(context, textModel);

  assert.notEqual(adapted, context);
  assert.equal(adapted.messages[0].content.length, 2);
  assert.equal(adapted.messages[0].content[0].text, "Opened https://example.com");
  assert.match(adapted.messages[0].content[1].text, /1 tool-result image omitted: image\/png/);
  assert.equal(toolResult.content[1].type, "image");
  assert.equal(omitToolResultImagesForTextOnlyModel(adapted, textModel), adapted);
  assert.equal(
    omitToolResultImagesForTextOnlyModel(context, { id: "vision-model", input: ["text", "image"] }),
    context,
  );
});

test("OpenAI stream receives adapted tool results without changing the caller's context", async () => {
  let requestContext;
  const loader = createTsModuleLoader({
    mocks: {
      "@earendil-works/pi-ai/api/openai-completions": {
        stream(_model, context) {
          requestContext = context;
          const assistant = {
            role: "assistant",
            content: [{ type: "text", text: "done" }],
            api: "openai-completions",
            provider: "openai",
            model: "text-model",
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "stop",
            timestamp: Date.now(),
          };
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: "start", partial: { ...assistant, content: [] } };
              yield { type: "done", reason: "stop", message: assistant };
            },
            async result() {
              return assistant;
            },
          };
        },
      },
    },
  });
  const { streamSimpleByApi } = loader.loadModule("src/lib/providers/runtime/streamByApi.ts");
  const context = { messages: [toolResult] };
  await streamSimpleByApi(
    {
      id: "text-model",
      api: "openai-completions",
      provider: "openai",
      baseUrl: "https://example.com/v1",
      input: ["text"],
      maxTokens: 1024,
    },
    context,
    {},
  ).result();

  assert.ok(requestContext);
  assert.equal(requestContext.messages[0].content.some((block) => block.type === "image"), false);
  assert.equal(context.messages[0].content[1].type, "image");
});
