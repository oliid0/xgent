import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createAgentToolCall, createSubagentHarness, sleep } from "./harness.mjs";

const loader = createTsModuleLoader();
const { SubagentModelPool, configuredSubagentModels } = loader.loadModule("src/lib/subagents/modelRouting.ts");
const settings = loader.loadModule("src/lib/settings/index.ts");
const candidate = (provider, model = "shared-model", skills = ["coding"]) => ({
  value: `${provider}::${model}`, providerId: "codex", providerName: provider,
  model, skills, maxConcurrency: 1,
  runtime: { providerConfigId: provider, baseUrl: `https://${provider}.example/v1`,
    isFullUrl: false, apiKey: `credential-${provider}`, requestFormat: "openai-completions" },
});

test("persistent model queue observations retain exact native host/account/model and never imply quota or private occupancy",async()=>{
  const {readPersistentModelWorkload}=loader.loadModule("src/lib/subagents/modelRouting.ts");
  const models=[candidate("one"),candidate("two")],host={hostId:"original",observedAt:1000,modelRoutingVersion:1,providers:[
    {id:"one",models:["shared-model"],modelProfiles:[{model:"shared-model",backgroundPending:2,backgroundRunning:1,backgroundWaiting:3}]},
    {id:"two",models:["shared-model"],modelProfiles:[{model:"shared-model",backgroundPending:0,backgroundRunning:0,backgroundWaiting:0}]},
  ]};
  const snapshot=await readPersistentModelWorkload(async()=>host,"original",models,()=>1000);
  assert.deepEqual(Array.from(snapshot.models,row=>[row.value,row.backgroundPending,row.backgroundRunning,row.backgroundWaiting]),[["one::shared-model",2,1,3],["two::shared-model",0,0,0]]);
  assert.equal(snapshot.scope,"native_background_queue");assert.ok(!JSON.stringify(snapshot).includes("credential"));assert.equal(snapshot.omittedModels,0);
  for(const unavailable of [null,{...host,hostId:"other"},{...host,observedAt:0},{...host,observedAt:121002},{...host,modelRoutingVersion:0}])await assert.rejects(readPersistentModelWorkload(async()=>unavailable,"original",models,()=>61001));
  const bad=structuredClone(host);bad.providers[0].modelProfiles[0].backgroundPending=-1;await assert.rejects(readPersistentModelWorkload(async()=>bad,"original",models,()=>1000));
});

test("AgentRoster exposes actual persistent queues separately and treats failed observations as unknown without hiding retained agents",async()=>{
  const f=await createSubagentHarness({models:[candidate("one")],readPersistentModels:async()=>({hostId:"original",observedAt:1000,scope:"native_background_queue",models:[{value:"one::shared-model",backgroundPending:1,backgroundRunning:0,backgroundWaiting:1}],omittedModels:0,unobservedModels:0})});
  const reply=await f.bundle.executeToolCall({id:"roster",name:"AgentRoster",arguments:{}});
  assert.equal(reply.isError,false);assert.equal(reply.details.persistentExecution.status,"observed");assert.equal(reply.details.models[0].activeRuns,0);assert.equal(reply.details.persistentExecution.models[0].backgroundPending,1);
  const failed=await createSubagentHarness({readPersistentModels:async()=>{throw new Error("credential-private");}});
  const unknown=await failed.bundle.executeToolCall({id:"roster",name:"AgentRoster",arguments:{}});assert.equal(unknown.isError,false);assert.equal(unknown.details.persistentExecution.status,"unavailable");assert.ok(!JSON.stringify(unknown).includes("credential-private"));
});

test("configured candidates retain exact account/model and omit inactive or uncredentialed bindings", () => {
  const base = settings.getDefaultSettings().customProviders.find((p) => p.type === "codex");
  const model = settings.createProviderModelConfig("codex", "shared-model");
  const providers = ["one", "two", "disabled", "unauthenticated"].map((id) => ({
    ...base, id, name: "Same display name", apiKey: id === "unauthenticated" ? "" : `key-${id}`,
    activeModels: id === "disabled" ? [] : [model.id],
    models: [{ ...model, delegationSkills: ["coding"], delegationMaxConcurrency: 1 }],
  }));
  const models = configuredSubagentModels(providers);
  assert.deepEqual(Array.from(models, (p) => p.value), ["one::shared-model", "two::shared-model"]);
  assert.equal(models[1].runtime.apiKey, "key-two");
  const pool = new SubagentModelPool();
  assert.ok(!JSON.stringify(pool.snapshot(models)).includes("key-two"));
  assert.equal(pool.snapshot(models)[0].availability, "configured_unprobed");
});

test("managed OAuth requires its actual account rather than treating a stale API key as proof", () => {
  const base = settings.getDefaultSettings().customProviders.find((p) => p.type === "codex");
  const model = settings.createProviderModelConfig("codex", "shared-model");
  const provider = { ...base, authMode: "oauth-managed", apiKey: "", oauthAccountId: "account-1",
    activeModels: [model.id], models: [model] };
  assert.equal(configuredSubagentModels([provider]).length, 1);
  assert.equal(configuredSubagentModels([{ ...provider, oauthAccountId: "" }]).length, 0);
});

test("capability tags and concurrency survive settings normalization without name inference", () => {
  const model = settings.normalizeProviderModelConfig({ id: "opus5", delegationSkills:
    ["coding", "coding", "../bad", 42, "research"], delegationMaxConcurrency: 99 }, "codex");
  assert.deepEqual(Array.from(model.delegationSkills), ["coding", "research"]);
  assert.equal(model.delegationMaxConcurrency, 8);
  assert.equal(settings.normalizeProviderModelConfig({ id: "opus5" }, "codex").delegationSkills, undefined);
});

test("pool selects an idle eligible binding; counts and cancellation release exactly once", async () => {
  const pool = new SubagentModelPool();
  const models = [candidate("one"), candidate("two")];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = pool.run(models, async (binding) => { assert.equal(binding.value, models[0].value); await gate; });
  const second = await pool.run(models, async (binding) => binding.value);
  assert.equal(second, models[1].value);
  const abort = new AbortController();
  const waiting = pool.run([models[0]], async () => assert.fail("cancelled queue must not run"), abort.signal);
  abort.abort();
  await assert.rejects(waiting);
  assert.equal(pool.snapshot(models)[0].activeRuns, 1);
  release(); await first;
  assert.equal(pool.snapshot(models)[0].activeRuns, 0);
  await assert.rejects(pool.run(models, async () => { throw new Error("upstream failed"); }));
  assert.deepEqual(Array.from(pool.snapshot(models), (p) => p.activeRuns), [0, 0]);
});

test("an occupied model wakes a waiting delegate without replaying the first delegate", async () => {
  const pool = new SubagentModelPool();
  const models = [candidate("one")];
  const events = [];
  let release;
  const first = pool.run(models, async () => { events.push("first"); await new Promise((resolve) => { release = resolve; }); });
  const second = pool.run(models, async () => { events.push("second"); });
  await sleep(1); assert.deepEqual(events, ["first"]);
  release(); await Promise.all([first, second]);
  assert.deepEqual(events, ["first", "second"]);
});

test("real Agent execution uses the selected provider endpoint, credentials and model", async () => {
  const models = [candidate("one"), candidate("two")];
  const h = await createSubagentHarness({ models });
  const result = await h.bundle.executeToolCall(createAgentToolCall({
    agents: [{ id: "coder", prompt: "Inspect code", model: "two::shared-model" }],
  }));
  assert.equal(result.isError, false);
  assert.equal(h.runnerCalls[0].runtime.apiKey, "credential-two");
  assert.equal(h.runnerCalls[0].runtime.baseUrl, models[1].runtime.baseUrl);
  assert.equal(h.runnerCalls[0].model, "shared-model");
  assert.equal(result.details.agents[0].providerConfigId, "two");
  assert.equal(h.store.getLatestRun("coder").providerConfigId, "two");
});

test("implicit single-model delegation preserves the captured parent reasoning and runtime controls", async () => {
  const h = await createSubagentHarness({ providerConfigId: "parent", models: [candidate("parent", "gpt-5")] });
  const result = await h.bundle.executeToolCall(createAgentToolCall({ agents: [{ id: "legacy", prompt: "Inspect" }] }));
  assert.equal(result.isError, false);
  assert.equal(h.runnerCalls[0].runtime.reasoning, "medium");
  assert.equal(h.runnerCalls[0].runtime.apiKey, "test-key");
  assert.equal(h.runnerCalls[0].model, "gpt-5");
});

test("new registry resumes the actual original provider even after parent model selection changes", async () => {
  const models = [candidate("one"), candidate("two")];
  const first = await createSubagentHarness({ models });
  await first.bundle.executeToolCall(createAgentToolCall({
    agents: [{ id: "coder", prompt: "Inspect", model: "two::shared-model" }],
  }));
  const next = await createSubagentHarness({ models, storeIpc: first.storeIpc });
  const result = await next.bundle.executeToolCall(createAgentToolCall({ agents: [{ id: "coder", prompt: "Continue" }] }, "second"));
  assert.equal(result.isError, false);
  assert.equal(next.runnerCalls[0].runtime.providerConfigId, "two");
  assert.ok(next.storeIpc.loadRunIds.length > 0);
  const rejected = await next.bundle.executeToolCall(createAgentToolCall({
    agents: [{ id: "coder", prompt: "Continue", model: "one::shared-model" }],
  }, "third"));
  assert.equal(rejected.isError, true);
  assert.equal(next.runnerCalls.length, 1);
});

test("one unavailable binding rejects the full batch before any subagent or write starts", async () => {
  const h = await createSubagentHarness({ models: [candidate("one")] });
  const result = await h.bundle.executeToolCall(createAgentToolCall({ agents: [
    { id: "valid", prompt: "Inspect", model: "one::shared-model" },
    { id: "invalid", prompt: "Inspect", model: "shared-model" },
  ] }));
  assert.equal(result.isError, true);
  assert.equal(h.runnerCalls.length, 0);
  assert.equal(h.storeIpc.upsertIdentityCount, 0);
});

test("required skills must all be declared; unsupported media tasks do not run a chat delegate", async () => {
  const h = await createSubagentHarness({ models: [candidate("one"), candidate("two", "research-model", ["research", "documents"])] });
  const result = await h.bundle.executeToolCall(createAgentToolCall({ agents: [
    { id: "research", prompt: "Inspect documents", required_skills: ["research", "documents"] },
  ] }));
  assert.equal(result.isError, false);
  assert.equal(h.runnerCalls[0].model, "research-model");
  for (const skills of [["coding", "research"], ["video_generation"], [42]]) {
    const rejected = await h.bundle.executeToolCall(createAgentToolCall({ agents: [{ id: "bad", prompt: "Task", required_skills: skills }] }));
    assert.equal(rejected.isError, true);
  }
  assert.equal(h.runnerCalls.length, 1);
});

test("AgentRoster reports retained bindings and run results without exposing provider secrets", async () => {
  const h = await createSubagentHarness({ models: [candidate("one")] });
  await h.bundle.executeToolCall(createAgentToolCall({ agents: [{ id: "coder", prompt: "Inspect", model: "one::shared-model" }] }));
  const result = await h.bundle.executeToolCall({ type: "toolCall", id: "roster", name: "AgentRoster", arguments: {} });
  assert.equal(result.isError, false);
  assert.equal(result.details.agents[0].lastStatus, "completed");
  assert.equal(result.details.agents[0].providerConfigId, "one");
  assert.equal(result.details.models[0].activeRuns, 0);
  assert.ok(!JSON.stringify(result).includes("credential-one"));
  assert.equal(h.bundle.metadataByName.get("AgentRoster").isReadOnly, true);
});

test("real Agent routes a new matching-skills task away from observed throttling and retains resume binding", async () => {
  const models = [candidate("limited"), candidate("available")];
  const h = await createSubagentHarness({ models });
  const { modelCooldowns } = h.loader.loadModule("src/lib/providers/runtime/modelCooldown.ts");
  modelCooldowns.observe(models[0].value, new Response("limited", { status: 429, headers: { "Retry-After": "120" } }));
  const first = await h.bundle.executeToolCall(createAgentToolCall({ agents: [{ id: "coder", prompt: "Inspect", required_skills: ["coding"] }] }));
  assert.equal(first.isError, false);
  assert.equal(h.runnerCalls[0].runtime.providerConfigId, "available");
  const roster = await h.bundle.executeToolCall({ type: "toolCall", id: "roster", name: "AgentRoster", arguments: {} });
  assert.equal(roster.details.models[0].availability, "cooling_down");
  modelCooldowns.observe(models[1].value, new Response("limited", { status: 429, headers: { "Retry-After": "120" } }));
  const controller = new AbortController();
  const resumed = h.bundle.executeToolCall(createAgentToolCall({ agents: [{ id: "coder", prompt: "Continue" }] }, "resume"), controller.signal);
  await sleep(5); controller.abort();
  const stopped = await resumed;
  assert.equal(stopped.isError, true);
  assert.equal(h.runnerCalls.length, 1);
  assert.equal(stopped.details.agents[0].status, "cancelled");
});
