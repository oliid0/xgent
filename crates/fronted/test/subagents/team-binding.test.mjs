import assert from "node:assert/strict";
import test from "node:test";
import { createAgentToolCall, createSubagentHarness } from "./harness.mjs";

const candidate = (id, skills = ["coding"]) => ({ value: `${id}::shared-model`, providerId: "codex", providerName: "Same name", model: "shared-model", skills, maxConcurrency: 1, runtime: { providerConfigId: id, baseUrl: `https://${id}.example/v1`, apiKey: `key-${id}`, isFullUrl: false, requestFormat: "openai-completions" } });
const role = { id: "code-role", name: "Coder", description: "Implementation", prompt: "Inspect repository and deliver verified code", persistInstructions: true, modelValue: "two::shared-model", requiredSkills: ["coding"] };

test("actual Agent uses template role instructions, exact account default and required capabilities", async () => {
  const h = await createSubagentHarness({ templates: [role], models: [candidate("one"), candidate("two")] });
  const roster = await h.bundle.executeToolCall({ type: "toolCall", id: "roster", name: "AgentRoster", arguments: {} });
  assert.equal(roster.details.templates[0].modelValue, "two::shared-model");
  assert.deepEqual(Array.from(roster.details.templates[0].requiredSkills), ["coding"]);
  assert.ok(!JSON.stringify(roster).includes("key-two"));
  const result = await h.bundle.executeToolCall(createAgentToolCall({ agents: [{ id: "coder", template: role.id, prompt: "Implement feature" }] }));
  assert.equal(result.isError, false); assert.equal(h.runnerCalls[0].runtime.apiKey, "key-two");
  assert.equal(h.store.getIdentity("coder").identityPrompt, role.prompt);
});

test("explicit account override keeps role skill requirements and rejects the entire mismatched batch before effects", async () => {
  const h = await createSubagentHarness({ templates: [role], models: [candidate("one"), candidate("two"), candidate("unskilled", [])] });
  const good = await h.bundle.executeToolCall(createAgentToolCall({ agents: [{ id: "override", template: role.id, prompt: "Implement", model: "one::shared-model" }] }));
  assert.equal(good.isError, false); assert.equal(h.runnerCalls[0].runtime.providerConfigId, "one");
  const bad = await h.bundle.executeToolCall(createAgentToolCall({ agents: [{ id: "valid", template: role.id, prompt: "Implement" }, { id: "bad", template: role.id, prompt: "Implement", model: "unskilled::shared-model", required_skills: [] }] }, "bad-batch"));
  assert.equal(bad.isError, true); assert.equal(h.runnerCalls.length, 1); assert.equal(h.store.getIdentity("valid"), undefined);
});

test("edited template default does not switch a resumed subordinate's stored account/context", async () => {
  const models = [candidate("one"), candidate("two")];
  const h = await createSubagentHarness({ templates: [role], models });
  await h.bundle.executeToolCall(createAgentToolCall({ agents: [{ id: "coder", template: role.id, prompt: "Inspect" }] }));
  const fresh = await createSubagentHarness({ templates: [{ ...role, prompt: "Changed role", modelValue: "one::shared-model" }], models, storeIpc: h.storeIpc });
  const result = await fresh.bundle.executeToolCall(createAgentToolCall({ agents: [{ id: "coder", prompt: "Continue" }] }, "resume"));
  assert.equal(result.isError, false); assert.equal(fresh.runnerCalls[0].runtime.providerConfigId, "two");
  assert.ok(fresh.runnerCalls[0].context.systemPrompt.includes(role.prompt));
  assert.ok(!fresh.runnerCalls[0].context.systemPrompt.includes("Changed role"));
});

test("missing default account cannot silently switch even when another account has the same model name", async () => {
  const h = await createSubagentHarness({ templates: [role], models: [candidate("one")] });
  const result = await h.bundle.executeToolCall(createAgentToolCall({ agents: [{ id: "coder", template: role.id, prompt: "Implement" }] }));
  assert.equal(result.isError, true); assert.equal(h.runnerCalls.length, 0); assert.equal(h.storeIpc.upsertIdentityCount, 0);
});
