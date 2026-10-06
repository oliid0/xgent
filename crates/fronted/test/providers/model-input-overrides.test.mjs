import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("saved per-model token limits reach model lookup and runtime construction for every provider", () => {
  const loader = createTsModuleLoader();
  const { getDefaultSettings, normalizeCustomProvider, updateCustomProviders, findProviderModelConfig } = loader.loadModule("src/lib/settings/index.ts");
  const { createModelFromConfig } = loader.loadModule("src/lib/providers/runtime/modelFactory.ts");
  const { createModelEditDraft, applyModelEdit } = loader.loadModule("src/pages/settings/providerModelSettings.ts");
  const { createProviderRuntimeConfig } = loader.loadModule("src/lib/providers/runtime/providerRuntimeConfig.ts");
  for (const [type, id] of [["codex", "gpt-4o"], ["gemini", "gemini-2.5-flash"], ["xai", "grok-alias"],
    ["deepseek", "deepseek-chat"], ["claude_code", "claude-sonnet-4-6"], ["claude_code", "claude-sonnet-4-5[1m]"],
    ["claude_code", "custom-alias"]]) {
    const original = normalizeCustomProvider({ id: "relay", type, name: "Relay", baseUrl: "https://relay.example/v1", models: [{ id }], activeModels: [id] });
    const draft = { ...createModelEditDraft(original.models[0]), contextWindow: "32000", maxOutputToken: "8000" };
    const saved = applyModelEdit(updateCustomProviders(getDefaultSettings(), [original]), "relay", draft);
    const provider = normalizeCustomProvider(JSON.parse(JSON.stringify(saved.customProviders[0])));
    const config = findProviderModelConfig(provider, id);
    assert.equal(config.contextWindow, 32000, `${type}/${id} lookup respects the saved override`);
    assert.equal(config.maxOutputToken, 8000);
    assert.equal(config.limitsSource, "user");
    assert.deepEqual(createProviderRuntimeConfig(provider, id).modelConfig, config);
    for (const baseUrl of [provider.baseUrl, "https://api.anthropic.com", "http://127.0.0.1:8888/v1"]) {
      const model = createModelFromConfig(type, id, baseUrl, type === "codex" ? "openai-responses" : undefined, config, baseUrl);
      assert.equal(model.contextWindow, 32000, `${type}/${id} runtime respects the saved override at ${baseUrl}`);
      assert.equal(model.maxTokens, 8000);
    }
  }
});

test("saved image capability overrides reach real model construction and the attachment payload", async () => {
  const calls = [];
  const loader = createTsModuleLoader({ mocks: { "@tauri-apps/api/core": { invoke: async (command, args) => {
    calls.push({ command, args }); return { mimeType: "image/png", data: "aW1hZ2U=", sizeBytes: 5 };
  } } } });
  const { normalizeCustomProvider } = loader.loadModule("src/lib/settings/index.ts");
  const { createModelFromConfig } = loader.loadModule("src/lib/providers/runtime/modelFactory.ts");
  const { createUserMessageWithUploads } = loader.loadModule("src/lib/chat/messages/uploadedFiles.ts");
  const adapter = loader.loadModule("src/lib/providers/nativeResponsesAttachments.ts").__nativeResponsesAttachmentsTest;
  const message = createUserMessageWithUploads("Inspect this", [{ relativePath: "uploads/image.png", absolutePath: "/workspace/uploads/image.png",
    fileName: "image.png", kind: "image", sizeBytes: 5 }]);
  for (const type of ["codex", "claude_code"]) for (const input of [["text", "image"], ["text"]]) {
    const provider = normalizeCustomProvider({ id: "relay", type, name: "Relay", models: [{ id: "custom-alias", inputModalities: input }], activeModels: ["custom-alias"] });
    const model = createModelFromConfig(type, "custom-alias", "https://relay.example/v1", "openai-completions", provider.models[0]);
    assert.deepEqual(model.input, input);
    const before = calls.length;
    const apply = type === "codex" ? adapter.applyNativeAttachmentsToOpenAICompletionsPayload : adapter.applyNativeAttachmentsToAnthropicPayload;
    const result = await apply({ payload: { messages: [{ role: "user", content: message.content }] },
      context: { messages: [message] }, model, workdir: "/workspace" });
    if (input.includes("image")) {
      assert.equal(calls.length, before + 1);
      assert.equal(result.messages[0].content.at(-1).type, type === "codex" ? "image_url" : "image");
    } else {
      assert.equal(calls.length, before);
      assert.equal(result.messages[0].content, message.content, "Text-only endpoints retain the existing file fallback");
    }
  }
});

test("text-only Anthropic aliases keep visual files on the Read fallback and still send text documents", async () => {
  const calls = [];
  const loader = createTsModuleLoader({ mocks: { "@tauri-apps/api/core": { invoke: async (command, args) => {
    calls.push({ command, args }); return { mimeType: "text/plain", data: "Tm90ZXM=", sizeBytes: 5 };
  } } } });
  const { createModelFromConfig } = loader.loadModule("src/lib/providers/runtime/modelFactory.ts");
  const { createUserMessageWithUploads } = loader.loadModule("src/lib/chat/messages/uploadedFiles.ts");
  const { applyNativeAttachmentsToAnthropicPayload } = loader.loadModule("src/lib/providers/nativeResponsesAttachments.ts").__nativeResponsesAttachmentsTest;
  const files = ["image", "pdf", "text"].map(kind => ({ relativePath: `uploads/file.${kind}`, absolutePath: `/workspace/uploads/file.${kind}`,
    fileName: `file.${kind}`, kind, sizeBytes: 5 }));
  const message = createUserMessageWithUploads("Inspect these", files);
  const model = createModelFromConfig("claude_code", "alias", "https://relay.example/v1", undefined, { id: "alias", inputModalities: ["text"] });
  const result = await applyNativeAttachmentsToAnthropicPayload({ payload: { messages: [{ role: "user", content: message.content }] }, context: { messages: [message] }, model, workdir: "/workspace" });
  assert.deepEqual(calls.map(call => call.args.kind), ["text"]);
  assert.deepEqual(result.messages[0].content.filter(part => part.type !== "text"), [{ type: "document", source: { type: "text", media_type: "text/plain", data: "Notes" }, title: "file.text" }]);
  assert.match(result.messages[0].content[0].text, /uploads\/file.image/);
  assert.match(result.messages[0].content[0].text, /uploads\/file.pdf/);
});

test("custom and known Gemini and OpenAI model overrides preserve automatic defaults when removed", () => {
  const loader = createTsModuleLoader();
  const { normalizeCustomProvider } = loader.loadModule("src/lib/settings/index.ts");
  const { createModelFromConfig } = loader.loadModule("src/lib/providers/runtime/modelFactory.ts");
  const { withModelInputMode } = loader.loadModule("src/lib/models/modelInput.ts");
  assert.deepEqual(createModelFromConfig("claude_code", "custom", "https://relay.example/v1").input, ["text", "image"], "Automatic aliases retain their existing native image attachment behavior");
  for (const [type, id, format] of [["codex", "gpt-4o", "openai-completions"], ["codex", "custom", "openai-responses"],
    ["gemini", "gemini-2.5-flash", undefined], ["gemini", "custom", undefined], ["xai", "grok-alias", undefined],
    ["claude_code", "custom", undefined], ["claude_code", "claude-sonnet-4-6", undefined]]) {
    const provider = normalizeCustomProvider({ id: "relay", type, name: "Relay", models: [{ id, inputModalities: ["text"] }], activeModels: [id] });
    const model = provider.models[0], automatic = createModelFromConfig(type, id, "https://relay.example/v1", format);
    assert.deepEqual(createModelFromConfig(type, id, "https://relay.example/v1", format, model).input, ["text"]);
    assert.deepEqual(createModelFromConfig(type, id, "https://relay.example/v1", format, withModelInputMode(model, "text-image")).input, ["text", "image"]);
    assert.deepEqual(createModelFromConfig(type, id, "https://relay.example/v1", format, withModelInputMode(model, "auto")).input, automatic.input);
  }
  for (const type of ["deepseek"]) {
    assert.equal(normalizeCustomProvider({ id: "provider", type, name: "Provider", models: [{ id: "alias", inputModalities: ["text", "image"] }] }).models[0].inputModalities, undefined);
  }
});
