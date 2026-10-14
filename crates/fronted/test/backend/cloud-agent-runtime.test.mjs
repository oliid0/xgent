import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { runCloudAgent, validateAgent } from "../../src-tauri/src/services/cloud_agent/runner.mjs";
import { cloudTools, commandEnvironment } from "../../src-tauri/src/services/cloud_agent/tools.mjs";

const config = { prompt: "Create and inspect an actual report.html deliverable", provider: "openai", model: "fixture" };
const env = { XGENT_AGENT_PROVIDER: "openai", XGENT_AGENT_API_KEY: "private-test-key", PATH: process.env.PATH };
const model = { id: "fixture", provider: "openai", api: "openai-responses", maxTokens: 8192, contextWindow: 128000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
function modelsFor(responses) {
  const requests = [];
  return { requests, getModel: () => model, streamSimple(selected, context, options) {
    requests.push({ selected, context, options });
    const response = responses.shift(); assert.ok(response, "unexpected model replay/request");
    const message = { role: "assistant", provider: model.provider, api: model.api, model: model.id, timestamp: Date.now(),
      usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, ...response };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "start", partial: message });
    if (message.stopReason === "error") stream.push({ type: "error", reason: "error", error: message });
    else stream.push({ type: "done", reason: message.stopReason, message });
    stream.end(message); return stream;
  } };
}
const call = (id, name, args) => ({ type: "toolCall", id, name, arguments: args });
const tools = content => ({ stopReason: "toolUse", content });
const finish = text => ({ stopReason: "stop", content: [{ type: "text", text }] });
async function fixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), "xgent-cloud-agent-"));
  try { await run({ workspace: path.join(root, "workspace"), output: path.join(root, "output"), env, root }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test("real Agent SDK completes a multi-turn file/write/read plan and records actual hashed deliverables", async () => fixture(async options => {
  const models = modelsFor([
    tools([call("write", "WriteTaskFile", { storage: "output", path: "report.html", content: "<h1>Actual report</h1>" })]),
    tools([call("read", "ReadTaskFile", { storage: "output", path: "report.html" })]),
    finish("Created and inspected report.html"),
  ]);
  const result = await runCloudAgent(config, { ...options, models });
  assert.equal(result.state, "completed"); assert.equal(result.turns, 3); assert.equal(result.toolCalls, 2);
  assert.equal(result.runtime, undefined, "ordinary task execution has no application lockfile identity gate");
  assert.equal(await readFile(path.join(options.output, "report.html"), "utf8"), "<h1>Actual report</h1>");
  assert.equal(result.files[0].path, "report.html"); assert.equal(result.files[0].sha256.length, 64);
  const checkpoint = JSON.parse(await readFile(path.join(options.output, ".xgent-agent/checkpoint.json"), "utf8"));
  assert.equal(checkpoint.state, "completed"); assert.equal(checkpoint.messages.filter(m => m.role === "toolResult").length, 2);
  assert.equal(checkpoint.runtime, undefined);
  assert.ok(models.requests[1].context.messages.some(m => m.role === "toolResult" && m.content[0].text === "File written"));
  assert.equal(models.requests[0].options.apiKey, env.XGENT_AGENT_API_KEY); assert.equal(models.requests[0].options.maxTokens, 4096);
  await assert.rejects(runCloudAgent(config, { ...options, models }), /EEXIST/); assert.equal(models.requests.length, 3);
}));

test("turn/tool budgets preserve partial files and fail instead of claiming completion", async () => {
  await fixture(async options => {
    const models = modelsFor([tools([call("write", "WriteTaskFile", { storage: "output", path: "partial.txt", content: "partial" })])]);
    const result = await runCloudAgent({ ...config, maxTurns: 1 }, { ...options, models });
    assert.equal(result.state, "failed"); assert.match(result.reason, /Turn limit/); assert.equal(result.files.length, 1); assert.equal(models.requests.length, 1);
  });
  await fixture(async options => {
    const models = modelsFor([tools([call("one", "WriteTaskFile", { storage: "output", path: "one.txt", content: "one" }), call("two", "WriteTaskFile", { storage: "output", path: "two.txt", content: "two" })])]);
    const result = await runCloudAgent({ ...config, maxToolCalls: 1 }, { ...options, models });
    assert.equal(result.state, "failed"); assert.equal(result.toolCalls, 1); assert.deepEqual(result.files.map(f => f.path), ["one.txt"]);
    assert.equal(models.requests.length, 1);
  });
});

test("provider failures are retained in receipts, secret values are redacted and no model retry occurs", async () => fixture(async options => {
  const models = modelsFor([{ stopReason: "error", errorMessage: `Failure ${env.XGENT_AGENT_API_KEY}`, content: [] }]);
  const result = await runCloudAgent(config, { ...options, models });
  assert.equal(result.state, "failed"); assert.match(result.reason, /\[redacted\]/); assert.equal(models.requests.length, 1);
  const receipt = await readFile(path.join(options.output, ".xgent-agent/checkpoint.json"), "utf8");
  assert.equal(receipt.includes(env.XGENT_AGENT_API_KEY), false);
}));

test("cancelled task, credentials for a different provider and unknown models cannot begin model work", async () => fixture(async options => {
  const models = modelsFor([]), controller = new AbortController(); controller.abort();
  await assert.rejects(runCloudAgent(config, { ...options, env: { ...env, XGENT_AGENT_PROVIDER: "anthropic" }, models }), /must match/);
  await assert.rejects(runCloudAgent(config, { ...options, models: { getModel: () => undefined } }), /catalog/);
  await assert.rejects(runCloudAgent(config, { ...options, models, signal: controller.signal }), /Cancelled/);
  assert.equal(models.requests.length, 0);
}));

test("validation rejects credentials, impossible budgets and oversized prompts", () => {
  for (const raw of [{ ...config, apiKey: "key" }, { ...config, maxTurns: 0 }, { ...config, maxToolCalls: 1.5 }, { ...config, timeoutSeconds: 3601 }, { ...config, provider: "other" }, { ...config, prompt: "x".repeat(131073) }]) assert.throws(() => validateAgent(raw));
});

test("file tools reject traversal, receipt overwrites and symlinks; child environment excludes all credentials", async () => fixture(async options => {
  const tools = await cloudTools(options.workspace, options.output, env, String);
  const writer = tools.find(t => t.name === "WriteTaskFile"), reader = tools.find(t => t.name === "ReadTaskFile");
  for (const name of ["../escaped", ".xgent-agent/result.json"]) await assert.rejects(writer.execute("id", { storage: "output", path: name, content: "x" }));
  const outside = path.join(options.root, "outside.txt"); await writeFile(outside, "outside");
  try { await symlink(outside, path.join(options.output, "link")); await assert.rejects(reader.execute("id", { storage: "output", path: "link" }), /symlinks/); }
  catch (error) { if (error.code !== "EPERM") throw error; } // Windows may deny unprivileged symlink creation.
  assert.deepEqual(commandEnvironment({ PATH: "path", HOME: "home", XGENT_AGENT_API_KEY: "key", GITHUB_TOKEN: "github", OPENAI_API_KEY: "other", XGENT_CLOUD_SECRET_ENV: "block", NODE_OPTIONS: "injection" }), { PATH: "path", HOME: "home" });
}));
