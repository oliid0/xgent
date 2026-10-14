import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Agent } from "@earendil-works/pi-agent-core";
import { createModels, createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { cloudTools } from "./tools.mjs";

export function validateAgent(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Cloud agent configuration is required");
  const allowed = ["prompt", "provider", "model", "maxTurns", "maxToolCalls", "maxOutputTokens", "timeoutSeconds"];
  if (Object.keys(raw).some(key => !allowed.includes(key))) throw new Error("Unknown cloud agent field; credentials must use Actions environment");
  if (typeof raw.prompt !== "string" || !raw.prompt.trim() || Buffer.byteLength(raw.prompt) > 128 * 1024) throw new Error("A bounded public task prompt is required");
  if (!["openai", "anthropic"].includes(raw.provider)) throw new Error("Cloud agent provider must be openai or anthropic");
  if (typeof raw.model !== "string" || !raw.model.trim() || raw.model.length > 256) throw new Error("An actual catalog model is required");
  const config = { ...raw };
  for (const [key, value, minimum, maximum] of [["maxTurns",16,1,128],["maxToolCalls",64,1,256],["maxOutputTokens",4096,128,16384],["timeoutSeconds",1800,30,3600]]) {
    const effective = raw[key] ?? value;
    if (!Number.isInteger(effective) || effective < minimum || effective > maximum) throw new Error(`Invalid ${key}`);
    config[key] = effective;
  }
  return config;
}

function failureStream(model, reason) {
  const stream = createAssistantMessageEventStream();
  const error = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: "error", errorMessage: reason,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  stream.push({ type: "error", reason: "error", error }); stream.end(error); return stream;
}

async function deliverables(root) {
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === ".xgent-agent" || entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) { if (files.length >= 1000) throw new Error("Deliverable inventory exceeds 1000 files");
        const info = await stat(file); if (info.size > 256 * 1024 * 1024) throw new Error("Deliverable exceeds inventory hashing limit");
        files.push({ path: path.relative(root, file).split(path.sep).join("/"), bytes: info.size, sha256: createHash("sha256").update(await readFile(file)).digest("hex") }); }
    }
  }
  await walk(root); return files;
}

export async function runCloudAgent(raw, { workspace, output, env = process.env, models, signal } = {}) {
  const config = validateAgent(raw);
  if (env.XGENT_AGENT_PROVIDER !== config.provider || !env.XGENT_AGENT_API_KEY?.trim()) throw new Error("Actions XGENT_AGENT_PROVIDER and XGENT_AGENT_API_KEY must match the requested cloud provider");
  if (!models) { models = createModels(); models.setProvider(config.provider === "anthropic" ? anthropicProvider() : openaiProvider()); }
  const model = models.getModel(config.provider, config.model);
  if (!model || model.provider !== config.provider) throw new Error("Requested cloud model is not in the installed provider catalog");
  if (!workspace || !output) throw new Error("Task workspace and output are required");
  const key = env.XGENT_AGENT_API_KEY;
  const scrub = value => String(value).split(key).join("[redacted]");
  const receipts = path.join(output, ".xgent-agent"); await mkdir(receipts, { recursive: true });
  // A repeat in the same workspace must not replay unknown shell/file effects.
  const claim = await open(path.join(receipts, "started"), "wx"); await claim.close();
  let turns = 0, toolCalls = 0, exhausted = "", timedOut = false;
  const snapshot = async (name, value) => { const file = path.join(receipts, name); await writeFile(`${file}.tmp`, scrub(JSON.stringify(value, null, 2))); await rename(`${file}.tmp`, file); };
  const tools = await cloudTools(workspace, output, env, scrub);
  const agent = new Agent({ initialState: { model, tools, thinkingLevel: "off", systemPrompt:
    "Complete the task autonomously within the given authority. Read provided workspace inputs; plan, act, inspect and correct failures. Use tools to create actual deliverables under output (../output from commands). Never treat a command start or a text promise as delivery. Do not invent connector effects: this runner cannot operate the sender's calendar, reminders, health or home. State remaining work explicitly. Never print or write credentials. Avoid background/detached commands; all child work must finish before your final report. Explain actual generated files and verification in your final response." },
    toolExecution: "sequential",
    getApiKey: provider => provider === config.provider ? key : undefined,
    streamFn: (selected, context, options) => {
      if (turns >= config.maxTurns || Buffer.byteLength(JSON.stringify(context)) > 512 * 1024) { exhausted = "Model request/context limit reached"; return failureStream(selected, exhausted); }
      turns++;
      return models.streamSimple(selected, context, { ...options, apiKey: key, maxTokens: Math.min(config.maxOutputTokens, model.maxTokens) });
    },
    beforeToolCall: () => {
      if (toolCalls >= config.maxToolCalls) { exhausted = "Tool call limit reached"; return { block: true, reason: exhausted, terminate: true }; }
      toolCalls++;
    },
    shouldStopAfterTurn: ({ message }) => {
      if (turns >= config.maxTurns && message.content?.some(c => c.type === "toolCall")) { exhausted = "Turn limit reached before a final response"; return true; }
      return !!exhausted;
    },
  });
  agent.subscribe(async event => {
    if (["message_end", "tool_execution_start", "tool_execution_end", "turn_end"].includes(event.type)) {
      await snapshot("checkpoint.json", { schemaVersion: 1, state: "running", turns, toolCalls, pendingToolCalls: [...agent.state.pendingToolCalls], messages: agent.state.messages, observedAtMs: Date.now() });
    }
  });
  const abort = () => agent.abort(); signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; agent.abort(); }, config.timeoutSeconds * 1000);
  const terminate = () => agent.abort(); process.on("SIGTERM", terminate); process.on("SIGINT", terminate);
  let result;
  try {
    if (signal?.aborted) throw new Error("Cancelled before first model request");
    await agent.prompt(config.prompt);
    const final = agent.state.messages.filter(m => m.role === "assistant").at(-1);
    const text = final?.content.filter(c => c.type === "text").map(c => c.text).join("\n") ?? "";
    const reason = timedOut ? "Cloud agent timed out" : signal?.aborted ? "Cloud agent cancelled" : exhausted || agent.state.errorMessage || (final?.stopReason !== "stop" || !text.trim() ? "No verified final model response" : "");
    result = { schemaVersion: 1, state: reason ? "failed" : "completed", reason: scrub(reason), provider: config.provider, model: config.model, turns, toolCalls, finalText: scrub(text), files: await deliverables(output), observedAtMs: Date.now() };
    await snapshot("result.json", result);
    await snapshot("checkpoint.json", { ...result, messages: agent.state.messages, pendingToolCalls: [...agent.state.pendingToolCalls] });
    return result;
  } catch (error) {
    await snapshot("result.json", { schemaVersion: 1, state: "failed", reason: scrub(error.message), turns, toolCalls, observedAtMs: Date.now() });
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); process.off("SIGTERM", terminate); process.off("SIGINT", terminate); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [file, workspace, output] = process.argv.slice(2);
    const result = await runCloudAgent(JSON.parse(await readFile(file, "utf8")), { workspace, output });
    console.log(`Xgent cloud agent ${result.state}; turns=${result.turns}; tools=${result.toolCalls}; files=${result.files.length}`);
    if (result.state !== "completed") process.exitCode = 1;
  } catch (error) {
    const output = process.argv[4];
    if (output) {
      try {
        const receipts = path.join(output, ".xgent-agent"); await mkdir(receipts, { recursive: true });
        const key = process.env.XGENT_AGENT_API_KEY;
        const reason = key ? String(error.message).split(key).join("[redacted]") : String(error.message);
        // Preserve any receipt already written by this or a prior attempt.
        await writeFile(path.join(receipts, "result.json"), JSON.stringify({ schemaVersion: 1, state: "failed", reason, observedAtMs: Date.now() }), { flag: "wx" });
      } catch { /* Original receipt/error wins if storage is unavailable. */ }
    }
    console.error("Xgent cloud agent failed; inspect task artifact execution receipts"); process.exitCode = 1;
  }
}
