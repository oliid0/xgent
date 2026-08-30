import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const settings = loader.loadModule("src/lib/settings/index.ts");
const modelSelection = loader.loadModule("src/pages/chat/runtime/modelSelection.ts");
const providerRuntimeConfig = loader.loadModule(
  "src/lib/providers/runtime/providerRuntimeConfig.ts",
);
const chatProviderRuntimeConfig = loader.loadModule(
  "src/pages/chat/runtime/providerRuntimeConfig.ts",
);

function provider(overrides = {}) {
  const id = overrides.id ?? "provider-1";
  const type = overrides.type ?? "codex";
  const models = overrides.models ?? ["gpt-5"];
  const activeModels = overrides.activeModels ?? models;
  return {
    id,
    name: id,
    type,
    baseUrl: overrides.baseUrl ?? "https://api.example.com/v1",
    apiKey: "key",
    models,
    activeModels,
    requestFormat: type === "codex" ? "openai-responses" : undefined,
  };
}

function appSettings(customProviders, selectedModel, overrides = {}) {
  return settings.normalizeSettings({ customProviders, selectedModel, ...overrides });
}

test("chat model selection resolves an enabled selected model", () => {
  const app = appSettings(
    [provider({ id: "openai-main", models: ["gpt-5", "gpt-5-mini"] })],
    { customProviderId: "openai-main", model: "gpt-5" },
  );

  const resolved = modelSelection.resolveEffectiveChatModelSelection({ settings: app });

  assert.equal(resolved.provider.id, "openai-main");
  assert.equal(resolved.providerId, "codex");
  assert.equal(resolved.model, "gpt-5");
  assert.deepEqual(resolved.selectedModel, {
    customProviderId: "openai-main",
    model: "gpt-5",
  });
});

test("conversation selection wins over the global default", () => {
  const app = appSettings(
    [
      provider({ id: "openai-main", models: ["gpt-5"] }),
      provider({ id: "anthropic-main", type: "claude_code", models: ["claude-fable-5"] }),
    ],
    { customProviderId: "openai-main", model: "gpt-5" },
  );

  const resolved = modelSelection.resolveEffectiveChatModelSelection({
    settings: app,
    conversationSelectedModel: { customProviderId: "anthropic-main", model: "claude-fable-5" },
  });

  assert.equal(resolved.provider.id, "anthropic-main");
  assert.equal(resolved.providerId, "claude_code");
});

test("invalid provider and disabled model selections are rejected", () => {
  const app = appSettings(
    [provider({ id: "openai-main", models: ["gpt-5", "gpt-5-mini"], activeModels: ["gpt-5"] })],
    { customProviderId: "openai-main", model: "gpt-5" },
  );

  assert.throws(
    () =>
      modelSelection.resolveEffectiveChatModelSelection({
        settings: app,
        conversationSelectedModel: { customProviderId: "missing", model: "gpt-5" },
      }),
    /供应商不存在/,
  );
  assert.throws(
    () =>
      modelSelection.resolveEffectiveChatModelSelection({
        settings: app,
        conversationSelectedModel: { customProviderId: "openai-main", model: "gpt-5-mini" },
      }),
    /模型尚未启用/,
  );
});

test("resolveActiveModelSelection prefers the conversation selection", () => {
  const app = appSettings([provider({ id: "openai-main" })], {
    customProviderId: "openai-main",
    model: "gpt-5",
  });
  const conversationSelection = { customProviderId: "other", model: "m" };

  assert.equal(
    modelSelection.resolveActiveModelSelection(app, conversationSelection),
    conversationSelection,
  );
  assert.deepEqual(modelSelection.resolveActiveModelSelection(app, undefined), app.selectedModel);
});

test("history persistence prefers the latest runtime selection", () => {
  const turnSelectedModel = { customProviderId: "openai-main", model: "gpt-5" };
  const runtimeSelectedModel = {
    customProviderId: "anthropic-main",
    model: "claude-fable-5",
  };

  assert.equal(
    modelSelection.resolvePersistedConversationModelSelection({
      runtimeSelectedModel,
      turnSelectedModel,
    }),
    runtimeSelectedModel,
  );
  assert.equal(
    modelSelection.resolvePersistedConversationModelSelection({ turnSelectedModel }),
    turnSelectedModel,
  );
});

test("selected model json round-trips and rejects malformed payloads", () => {
  assert.equal(
    settings.serializeSelectedModelJson({ customProviderId: "p1", model: "m1" }),
    '{"customProviderId":"p1","model":"m1"}',
  );
  assert.deepEqual(settings.parseSelectedModelJson('{"customProviderId":"p1","model":"m1"}'), {
    customProviderId: "p1",
    model: "m1",
  });
  assert.equal(settings.parseSelectedModelJson("not-json"), undefined);
  assert.equal(settings.parseSelectedModelJson('{"model":"m1"}'), undefined);
});

test("provider runtime preserves managed OAuth and complete request policy", () => {
  const oauthProvider = settings.normalizeCustomProvider({
    id: "openai-oauth",
    name: "OpenAI OAuth",
    type: "codex",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    authMode: "oauth-managed",
    oauthAccountId: "oauth-account-1",
    models: ["gpt-5"],
    activeModels: ["gpt-5"],
    requestFormat: "openai-responses",
    promptCacheHintMode: "openai-key",
    retryPolicy: { mode: "custom", maxRetries: 4 },
  });

  const runtime = providerRuntimeConfig.createProviderRuntimeConfig(
    oauthProvider,
    "gpt-5",
    undefined,
  );

  assert.equal(runtime.authMode, "oauth-managed");
  assert.equal(runtime.oauthAccountId, "oauth-account-1");
  assert.equal(runtime.promptCacheHintMode, "openai-key");
  assert.deepEqual(runtime.retryPolicy, { mode: "custom", maxRetries: 4 });
});

test("managed OAuth providers remain eligible failover targets", () => {
  const primaryProvider = provider({ id: "openai-primary", models: ["gpt-5"] });
  const oauthFallback = {
    ...provider({ id: "openai-oauth", models: ["gpt-5"], apiKey: "" }),
    apiKey: "",
    authMode: "oauth-managed",
    oauthAccountId: "oauth-account-1",
  };
  const app = appSettings(
    [primaryProvider, oauthFallback],
    { customProviderId: "openai-primary", model: "gpt-5" },
    {
      modelFailover: {
        codex: {
          enabled: true,
          queue: ["openai-oauth"],
          maxSwitches: 2,
          failureThreshold: 2,
          cooldownSeconds: 30,
        },
      },
    },
  );
  const primary = modelSelection.resolveEffectiveChatModelSelection({ settings: app });

  const plan = chatProviderRuntimeConfig.buildModelFailoverPlan(app, primary);

  assert.equal(plan?.fallbacks.length, 1);
  assert.equal(plan?.fallbacks[0].runtime.authMode, "oauth-managed");
  assert.equal(plan?.fallbacks[0].runtime.oauthAccountId, "oauth-account-1");
});
