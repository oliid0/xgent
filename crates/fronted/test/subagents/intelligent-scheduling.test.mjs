import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createAgentToolCall, createSubagentHarness } from "./harness.mjs";

const loader = createTsModuleLoader();
const settings = loader.loadModule("src/lib/settings/index.ts");
const { intelligentSchedulingModels, intelligentSchedulingPrompt } = loader.loadModule("src/lib/subagents/intelligentScheduling.ts");
const plain = value => JSON.parse(JSON.stringify(value));
const providers = () => {
  const base = settings.getDefaultSettings().customProviders.find(p => p.type === "codex");
  const model = { ...settings.createProviderModelConfig("codex", "shared"), delegationSkills: ["coding"], delegationMaxConcurrency: 1 };
  return ["one", "two"].map(id => ({ ...base, id, apiKey: `key-${id}`, baseUrl: `https://${id}.example/v1`, models: [model], activeModels: [model.id] }));
};

test("old settings and malformed flags stay off; explicit selection survives persistence and provider normalization", () => {
  assert.equal(settings.getDefaultSettings().chatRuntimeControls.intelligentSchedulingEnabled, false);
  for (const value of [undefined, null, false, "true", 1]) {
    assert.equal(settings.normalizeChatRuntimeControls({ intelligentSchedulingEnabled: value }).intelligentSchedulingEnabled, false);
  }
  const saved = settings.normalizeSettings({ ...settings.getDefaultSettings(), chatRuntimeControls: { intelligentSchedulingEnabled: true } });
  assert.equal(settings.normalizeSettings(plain(saved)).chatRuntimeControls.intelligentSchedulingEnabled, true);
  assert.equal(settings.normalizeChatRuntimeControlsForProvider(saved.chatRuntimeControls, { providerId: "codex", modelId: "shared" }).intelligentSchedulingEnabled, true);
});

test("off has no cross-provider candidates; on uses actual configured skills and complete account identities", () => {
  const configured = providers();
  assert.deepEqual(plain(intelligentSchedulingModels(false, configured)), []);
  assert.deepEqual(plain(intelligentSchedulingModels("true", configured)), []);
  const models = intelligentSchedulingModels(true, configured);
  assert.deepEqual(Array.from(models, m => m.value), ["one::shared", "two::shared"]);
  assert.equal(models[1].runtime.apiKey, "key-two");
  assert.deepEqual(plain(models[1].skills), ["coding"]);
});

test("real Agent cannot switch accounts while off, retains legacy parent, and uses chosen account when on", async () => {
  const configured = providers();
  const off = await createSubagentHarness({ models: intelligentSchedulingModels(false, configured) });
  const denied = await off.bundle.executeToolCall(createAgentToolCall({ agents: [{ id: "foreign", prompt: "Inspect", model: "two::shared" }] }));
  assert.equal(denied.isError, true); assert.equal(off.runnerCalls.length, 0);
  const parent = await off.bundle.executeToolCall(createAgentToolCall({ agents: [{ id: "legacy", prompt: "Inspect" }] }));
  assert.equal(parent.isError, false); assert.equal(off.runnerCalls[0].runtime.apiKey, "test-key");
  const on = await createSubagentHarness({ models: intelligentSchedulingModels(true, configured) });
  const result = await on.bundle.executeToolCall(createAgentToolCall({ agents: [{ id: "coder", prompt: "Inspect", required_skills: ["coding"], model: "two::shared" }] }));
  assert.equal(result.isError, false); assert.equal(on.runnerCalls[0].runtime.apiKey, "key-two");
});

test("coordinator instructions require direct simple work, complete dependencies, verified outputs and real capabilities", () => {
  assert.equal(intelligentSchedulingPrompt(false, ["Agent", "AgentRoster"]), "");
  const prompt = intelligentSchedulingPrompt(true, ["Agent", "AgentRoster"]);
  for (const part of ["weather lookup", "small webpage", "acceptance criteria", "dependencies", "AgentRoster", "provider::model", "Dependent steps wait", "inspect and integrate", "not a media generator", "uncertain external effects"]) assert.ok(prompt.includes(part), part);
  const restricted = intelligentSchedulingPrompt(true, ["Read"]);
  assert.ok(restricted.includes("no model delegate tools"));
  assert.ok(!restricted.includes("call AgentRoster for"));
});
