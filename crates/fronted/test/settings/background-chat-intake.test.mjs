import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const worker = (id, patch = {}) => {
  const now = Date.now();
  return { hostId: id, platform: "windows", architecture: "x64",
  executorReady: true, acceptsBackgroundTasks: true, workspaceAvailable: true, workdir: "/host",
  inputSnapshotVersion: 1, sourceContextVersion: 2, delegationVersion: 1,
  providers: [{ id: "provider", models: ["model"], providerType: "openai", name: "Provider" }],
  inventory: { version: 1, observedAt: now, validUntil: now + 60000, capabilities: [] },
  pending: 0, running: 0, ...patch };
};
const user = (id = "persisted-user") => ({ id, role: "user", content: "Make a report and arrange tomorrow", timestamp: 1 });
function setup(options = {}) {
  const calls = [], submissions = [], saved = new Map();
  const local = options.local === undefined ? worker("local") : options.local;
  const controller = new AbortController();
  const backend = {
    async getNativeDeviceIdentity() { calls.push(["identity"]); return { hostId: "11111111-1111-4111-8111-111111111111" }; },
    async getBackgroundSubmissionState(id) { calls.push(["state", id]); if (options.stateFails) throw new Error("Copied installation cannot recover ownership"); if (options.existing && !saved.has(id)) saved.set(id, { ...options.existing, requestId: id }); if (options.stopWhileReading && calls.filter(([name]) => name === "state").length === 1) controller.abort(); return saved.get(id) ?? null; },
    async listWorkerPeers() { calls.push(["catalog"]); if (options.catalogFails) throw new Error("Registry unavailable"); return { peers: options.peers ?? [] }; },
    async getLocalWorkerHostInfo() { calls.push(["local"]); return local; },
    async submitBackgroundTask(input, peer, parent, origin, isLocal) {
      calls.push(["submit", peer, isLocal]); submissions.push({ input, peer, parent, origin, isLocal });
      const hostId = isLocal ? local.hostId : peer;
      const task = { requestId: input.requestId, hostId, name: input.name, run: { state: "pending", success: false }, artifacts: [], outcomes: null };
      if (!options.noStage) saved.set(input.requestId, { requestId: input.requestId, sourceHostId: hostId, localExecution: isLocal, cancelRequested: false, name: input.name, result: options.uncertain ? null : task });
      if (options.onSubmit) await options.onSubmit(controller);
      if (options.uncertain || options.noStage) throw new Error("Transport result unknown");
      return options.wrongReply ? { ...task, hostId: "wrong-host" } : task;
    },
    async cancelBackgroundTask(id, peer) { calls.push(["cancel", id, peer]); const item = saved.get(id); item.cancelRequested = true; if (options.cancelOffline) throw new Error("Cancellation pending confirmation"); return item.result; },
  };
  const snapshotNative=async(command,args)=>{
    assert.equal(command,"fs_snapshot_binary");calls.push(["snapshot",args.workdir,args.path]);
    if(options.snapshotFails)throw new Error("Input path is unavailable on the initiating device");
    const bytes=Buffer.from(`Actual file bytes: ${args.path}`);
    return {contentBase64:bytes.toString("base64"),bytes:bytes.length,contentHash:createHash("sha256").update(bytes).digest("hex")};
  };
  const loader = createTsModuleLoader({ mocks: {
    "../providers/llm": {
      async completeAssistantMessage() {
        calls.push(["assessment"]);
        await options.onAssessment?.();
        if (options.assessmentFails) throw new Error("Assessment unavailable");
        return { stopReason: "stop", content: [{ type: "text", text: JSON.stringify(options.assessment ?? { version: 1, continuity: "persistent", branches: [{ id: "report", requirement: "Create the report", dependsOn: [], kind: "task", effort: "large", locality: "portable", requirements: { capabilities: [], platforms: [] } }] }) }] };
      },
      assistantMessageToText: message => message.content.map(block => block.text ?? "").join(""),
    },
    "@xgent/runtime": { isTauriRuntime: () => options.native !== false, getLanPcCommandHostConfig: () => options.globalHost ?? { enabled: false },
      async invokeNative(command,args){
        if(command==="fs_snapshot_binary")return snapshotNative(command,args);
        calls.push(["original-memory",command,args]);
        if(options.memoryFails) throw new Error("Original memory unavailable");
        if(command==="memory_index_overview") return options.memoryOverview??{user:[],global:[],project:[],recentDays:[],root:"/memory"};
        assert.equal(command,"memory_read");return options.memoryRecord;
      },
    },
    "./backend": { backend },
    "@tauri-apps/api/core": { invoke:snapshotNative },
    "../turns/runAgentConversationTurn": { async runAgentConversationTurn(params) { calls.push(["foreground", params]); } },
    "../turns/runTextConversationTurn": { async runTextConversationTurn() { calls.push(["text"]); } },
  } });
  const module = loader.loadModule("src/lib/automation/backgroundChatIntake.ts");
  const { createChatRuntimeHost } = loader.loadModule("src/pages/chat/runtime/ChatRuntimeHost.ts");
  const conversation = loader.loadModule("src/lib/chat/conversation/conversationState.ts");
  const message = user();
  let state = conversation.createConversationStateFromContext({ messages: [message], systemPrompt: "Actual soul and memory context" });
  const params = {
    backgroundIntake: { userMessage: message, ensureHistoryPersisted: async () => { calls.push(["history"]); await options.onHistory?.(); return options.historySaved !== false; }, receiptText: r => `${r.cancelRequested ? "cancellation saved" : r.accepted ? "host accepted" : "saved, acceptance unconfirmed"}: ${r.hostId} ${r.requestId}`, foregroundText: "Foreground only" },
    conversationId: "conversation", sessionId: "session", providerId: "openai", model: "model",
    selectedModel: { customProviderId: "provider", model: "model" }, effectiveWorkdir: "/local",
    runtime: { reasoning: "high" }, runtimeModel: { api: "openai-completions", provider: "openai", id: "model" },
    cancellation: { userStop: controller }, planModeEnabled: options.plan === true, transcriptStore: {},
    buildPreparedContext: () => options.context ?? conversation.buildRequestContext(state, { includeUploadedFilesMetadata: true }),
    getNextConversationState: () => state, applyConversationState(next) { state = next; calls.push(["apply"]); },
    updateToolStatus(text) { calls.push(["status", text]); }, resetLiveTranscript() { calls.push(["reset"]); },
    async persistConversationWithHistorySync(p) { calls.push(["receipt_persist"]); return options.receiptPersistFails ? null : p.state; },
    conversationEvents: { queueCheckpoint() { calls.push(["checkpoint"]); }, queueEvent(e) { calls.push(["event", e]); }, close() { calls.push(["close"]); } },
  };
  const run = () => createChatRuntimeHost().runTurn({ mode: "agent", params });
  const submit = (overrides = {}) => module.submitChatBackgroundTask({ context: { systemPrompt: "Actual context", messages: [message] }, userMessage: message,
    conversationId: "conversation", workdir: "/local", selectedModel: params.selectedModel, signal: controller.signal, ...overrides });
  return { calls, submissions, saved, controller, params, run, submit, module, get state() { return state; } };
}

test("default native Agent handoff durably accepts before any foreground model and publishes an honest persisted chat receipt", async () => {
  const f = setup(); await f.run();
  assert.equal(f.submissions[0].input.sourceContext.version, 2);
  assert.equal(f.submissions[0].input.sourceContext.originalRequest, user().content);
  assert.deepEqual(f.submissions[0].input.sourceContext.requestClock,{timestampMs:1,timeZone:null});
  assert.deepEqual(f.calls[0], ["history"]);
  assert.equal(f.submissions.length, 1); const { input, origin, isLocal } = f.submissions[0];
  assert.equal(isLocal, true); assert.equal(input.workdir, "/local"); assert.equal(input.reasoning, "high");
  assert.equal(input.intelligentSchedulingEnabled, undefined);
  assert.equal(input.sourceContext.systemPrompt, "Actual soul and memory context");
  assert.equal(input.sourceContext.messages[0].id, "persisted-user");
  assert.ok(input.prompt.startsWith("Make a report and arrange tomorrow"));
  assert.ok(input.prompt.includes("Execution requirement proposal"));
  assert.equal(origin.requestScope, input.sourceContext.requestScope);
  const { getHistoryMessageContentHash } = createTsModuleLoader().loadModule("src/lib/chat/conversation/conversationState.ts");
  assert.equal(origin.sourceMessageHash, getHistoryMessageContentHash(f.params.backgroundIntake.userMessage));
  assert.equal(f.calls.some(([name]) => name === "foreground"), false);
  const message = f.state.segments[0].messages.at(-1);
  assert.equal(message.id, `background-receipt:${input.requestId}`);
  assert.ok(message.content[0].text.startsWith("host accepted"));
  assert.deepEqual(message.xgentBackgroundTask, { requestId: input.requestId, hostId: "local", accepted: true, cancelRequested: false, routing: { reason: "persistent", requirements: { capabilities: [], platforms: ["windows", "macos", "linux"] } } });
  assert.equal(message.usage.totalTokens, 0); assert.equal(message.xgentBackgroundTask.task, undefined);
  assert.ok(f.calls.findIndex(([name]) => name === "receipt_persist") < f.calls.findIndex(([name]) => name === "checkpoint"));
});

test("chat intake freezes the persisted message clock before async routing; model metadata need not contain it",async()=>{
  const f=setup();
  const timestampMs=Date.parse("2026-10-14T06:30:00Z");
  const message={...user(),timestamp:timestampMs,xgentTimeZone:"America/Los_Angeles"};
  await f.submit({userMessage:message,assess:async()=>{
    message.timestamp=Date.parse("2026-10-16T06:30:00Z");message.xgentTimeZone="Asia/Tokyo";
    return {assessment:{version:1,continuity:"persistent",branches:[{id:"report",requirement:"Create report",dependsOn:[],kind:"task",effort:"large",locality:"portable",requirements:{capabilities:[],platforms:[]}}]},mobile:{native:false,execution:null,observedAt:Date.now()}};
  }});
  assert.deepEqual(f.submissions[0].input.sourceContext.requestClock,{timestampMs,timeZone:"America/Los_Angeles"});
});

test("old strict source receivers cannot receive new root metadata, while already accepted work retains its owner", async () => {
  const old = setup({ local: worker("local", { sourceContextVersion: 1 }),
    peers: [{ peerId: "old-pc", online: true, host: worker("old-pc", { sourceContextVersion: 1 }) }] });
  assert.equal(await old.submit(), null);
  assert.equal(old.submissions.length, 0);
  const saved = setup({ local: worker("local", { sourceContextVersion: 1 }),
    existing: { sourceHostId: "original", result: null, localExecution: false, name: "Saved", cancelRequested: false } });
  const actual = await saved.submit();
  assert.equal(actual.hostId, "original");
  assert.equal(saved.calls.some(([name]) => name === "catalog" || name === "submit"), false);
});

test("remote durable intake carries actual bounded originating memory once; local and recovered tasks do not recapture it",async()=>{
  const entry={slug:"schedule",scope:"global",memoryType:"feedback",description:"Arrange tomorrow report",headline:"Calendar",updatedAt:100,unreviewed:true,confidence:"medium"};
  const options={local:null,peers:[{peerId:"pc",online:true,host:worker("pc")}],memoryOverview:{user:[entry],global:[],project:[],recentDays:[],root:"/phone-memory"},memoryRecord:{...entry,body:"Use my work calendar for tomorrow",window:{offset:0,length:1,truncated:false},meta:{archived:false,confidence:"medium",unreviewed:true,updatedAt:100,source:{source_quote:"Use my work calendar",conversationId:"phone-history"}}}};
  const f=setup(options);await f.submit();
  const frozen=f.submissions[0].input.sourceContext;
  assert.match(frozen.systemPrompt,/Use my work calendar for tomorrow/);assert.match(frozen.systemPrompt,/"confidence":"medium","unreviewed":true/);
  assert.equal(f.calls.filter(call=>call[0]==="original-memory").length,2);
  options.memoryRecord.body="Changed later preference";await f.submit();
  assert.equal(f.submissions.length,1);assert.equal(f.calls.filter(call=>call[0]==="original-memory").length,2);assert.doesNotMatch(frozen.systemPrompt,/Changed later preference/);
  const local=setup();await local.submit();assert.equal(local.calls.some(call=>call[0]==="original-memory"),false);
});

test("enabled scheduling reaches accepted input on a capable worker and is not silently sent to an older peer", async () => {
  const local = worker("local", { intelligentSchedulingVersion: 1 });
  const enabled = setup({ local }); enabled.params.intelligentSchedulingEnabled = true;
  await enabled.run();
  assert.equal(enabled.submissions.length, 1);
  assert.equal(enabled.submissions[0].input.intelligentSchedulingEnabled, true);
  const old = worker("old");
  const current = worker("current", { intelligentSchedulingVersion: 1 });
  const remote = setup({ local: null, peers: [
    { peerId: "old", host: old, online: true }, { peerId: "current", host: current, online: true },
  ] });
  await remote.submit({ intelligentSchedulingEnabled: true });
  assert.equal(remote.submissions.length, 1);
  assert.equal(remote.submissions[0].peer, "current");
  const unsupported = setup({ local: null, peers: [{ peerId: "old", host: old, online: true }] });
  assert.equal(await unsupported.submit({ intelligentSchedulingEnabled: true }), null);
  assert.equal(unsupported.submissions.length, 0);
});

test("already accepted work retains its original submission when later scheduling selection changes", async () => {
  const f = setup({ local: worker("local", { intelligentSchedulingVersion: 1 }) });
  await f.submit({ intelligentSchedulingEnabled: true });
  await f.submit({ intelligentSchedulingEnabled: false });
  assert.equal(f.submissions.length, 1);
  assert.equal(f.submissions[0].input.intelligentSchedulingEnabled, true);
});

test("turn intake pins legacy attachment source before history persistence switches the selected PC", async () => {
  const host = { enabled: true, baseUrl: "http://original:28367", localWorkdir: "/original-phone", remoteWorkdir: "/original-pc" };
  const f = setup({ globalHost: host, onHistory: () => { Object.assign(host, { baseUrl: "http://other:28367", localWorkdir: "/other-phone" }); } });
  f.params.lanPcCommandHostReady = true;
  f.params.backgroundIntake.userMessage = { ...user(), xgentAttachments: [{ fileName: "report.txt", kind: "text", sizeBytes: 1, relativePath: "report.txt" }] };
  await f.run();
  assert.deepEqual(f.calls.find(([name]) => name === "snapshot"), ["snapshot", "/original-phone", "report.txt"]);
  assert.equal(f.submissions.length, 1);
  assert.equal(f.params.commandHostSnapshot, undefined);
});

test("direct submission captures attachment fallback before asynchronous assessment changes the PC", async () => {
  const host = { enabled: true, baseUrl: "http://original:28367", localWorkdir: "/original-phone" };
  const f = setup({ globalHost: host });
  const message = { ...user(), xgentAttachments: [{ fileName: "report.txt", kind: "text", sizeBytes: 1, relativePath: "report.txt" }] };
  await f.submit({ userMessage: message, assess: async () => {
    host.localWorkdir = "/other-phone";
    return { assessment: { version: 1, continuity: "persistent", branches: [{ id: "report", requirement: "Create report", dependsOn: [], kind: "task", effort: "large", locality: "portable", requirements: { capabilities: [], platforms: [] } }] }, mobile: { native: false, execution: null, observedAt: Date.now() } };
  } });
  assert.deepEqual(f.calls.find(([name]) => name === "snapshot"), ["snapshot", "/original-phone", "report.txt"]);
});

test("foreground continuation receives the turn snapshot when model assessment changes the selected PC", async () => {
  const host = { enabled: true, baseUrl: "http://original:28367", localWorkdir: "/phone", remoteWorkdir: "/original-pc" };
  const f = setup({ globalHost: host, onAssessment: () => { host.baseUrl = "http://other:28367"; }, assessment: { version: 1, continuity: "foreground", branches: [{ id: "reply", requirement: "Explain", dependsOn: [], kind: "interactive", effort: "small", locality: "portable", requirements: { capabilities: [], platforms: [] } }] } });
  f.params.lanPcCommandHostReady = true;
  await f.run();
  assert.equal(f.calls.find(([name]) => name === "foreground")[1].commandHostSnapshot.baseUrl, "http://original:28367");
  assert.equal(f.submissions.length, 0);
  assert.equal(host.baseUrl, "http://other:28367");
});

test("mobile handoff chooses an authenticated advertised desktop model while busy local workers yield to an idle peer", async () => {
  for (const local of [null, worker("local", { running: 2 })]) {
    const f = setup({ local, peers: [{ peerId: "peer", online: true, host: worker("peer", { providers: [{ id: "remote-provider", models: ["remote-model"] }] }) }] });
    await f.run(); const sent = f.submissions[0];
    assert.equal(sent.peer, "peer"); assert.equal(sent.isLocal, false); assert.equal(sent.input.workdir, "/host");
    assert.equal(sent.input.providerId, "remote-provider"); assert.equal(sent.input.model, "remote-model");
    assert.equal(f.calls.some(([name]) => name === "foreground"), false);
  }
});

test("browser, plan mode and no eligible executor retain real foreground execution without saving a phantom task", async () => {
  for (const options of [{ native: false }, { plan: true }, { local: null }, { local: worker("local", { sourceContextVersion: 0 }) }, { local: worker("local", { executorReady: false }) }]) {
    const f = setup(options); await f.run();
    assert.equal(f.submissions.length, 0); assert.ok(f.calls.some(([name]) => name === "foreground"));
    assert.equal(f.calls.some(([name]) => name === "receipt_persist"), false);
  }
});

test("optional peer registry failure does not prevent valid native local admission", async () => {
  const f = setup({ catalogFails: true }); await f.run(); assert.equal(f.submissions[0].isLocal, true);
});

test("failed initial history and copied ownership stop before discovery, snapshots or execution", async () => {
  for (const options of [{ historySaved: false }, { stateFails: true }]) {
    const f = setup(options); await assert.rejects(f.run(), /history|installation/);
    assert.equal(f.calls.some(([name]) => ["catalog", "snapshot", "submit", "foreground"].includes(name)), false);
  }
});

test("uncertain submission is displayed as locally saved, never accepted or replayed on a foreground executor", async () => {
  const f = setup({ uncertain: true }); await f.run();
  assert.equal(f.submissions.length, 1); const message = f.state.segments[0].messages.at(-1);
  assert.ok(message.content[0].text.includes("saved, acceptance unconfirmed"));
  assert.equal(message.xgentBackgroundTask.accepted, false);
  assert.equal(f.calls.some(([name]) => name === "foreground"), false);
});

test("saved ownership is recovered before discovery or re-reading changed files and preserves cancellation", async () => {
  for (const cancelRequested of [false, true]) {
    const f = setup({ existing: { sourceHostId: "original-offline", result: null, localExecution: false, name: "Saved", cancelRequested } });
    await f.run(); assert.equal(f.submissions.length, 0);
    assert.equal(f.calls.some(([name]) => ["catalog", "local", "snapshot", "foreground"].includes(name)), false);
    const message = f.state.segments[0].messages.at(-1);
    assert.equal(message.xgentBackgroundTask.hostId, "original-offline"); assert.equal(message.xgentBackgroundTask.cancelRequested, cancelRequested);
  }
});

test("stable persisted user identity deduplicates handoff while a different user message receives a separate request", async () => {
  const f = setup(); const a = await f.submit(); const repeat = await f.submit();
  assert.equal(a.requestId, repeat.requestId); assert.equal(f.submissions.length, 1);
  const next = user("different-user"); const b = await f.submit({ userMessage: next, context: { messages: [next] } });
  assert.notEqual(a.requestId, b.requestId); assert.equal(f.submissions.length, 2);
  await assert.rejects(f.submit({ userMessage: { ...next, id: "" } }), /persisted.*identity/);
});

test("history and current attachments with identical basenames are copied from real bytes with unique input names and source mapping", async () => {
  const attachment = path => ({ fileName: "产品.docx", kind: "word", sizeBytes: 10, relativePath: path, absolutePath: path });
  const previous = { ...user("prior"), xgentAttachments: [attachment("/local/prior/产品.docx")] };
  const current = { ...user(), xgentAttachments: [attachment("/local/current/产品.docx")] };
  const f = setup(); await f.submit({ userMessage: current, context: { messages: [previous, current] } });
  const { input } = f.submissions[0]; assert.equal(input.files.length, 2);
  assert.notEqual(input.files[0].name, input.files[1].name); assert.ok(input.files.every(file => file.name.endsWith(".docx")));
  assert.ok(input.files.every(file => Buffer.from(file.contentBase64, "base64").toString().startsWith("Actual file bytes")));
  assert.equal(f.calls.filter(([name]) => name === "snapshot").length, 2);
  assert.ok(input.prompt.includes("Source paths belong to the initiating device"));
  assert.ok(input.prompt.includes("/local/prior/产品.docx")); assert.equal(input.sourceContext.messages.length, 2);
});

test("default chat handoff uses persisted local attachment provenance after the global selected PC changes", async () => {
  const path = "/original-phone/uploads/source.txt", bytes = Buffer.from(`Actual file bytes: ${path}`);
  const attachment = { fileName: "source.txt", kind: "text", sizeBytes: bytes.length,
    relativePath: "uploads/remote/source.txt", absolutePath: "C:\\old-pc\\uploads\\source.txt",
    localSource: { version: 1, workdir: "/original-phone", path, bytes: bytes.length, contentHash: createHash("sha256").update(bytes).digest("hex") } };
  const message = { ...user(), xgentAttachments: [attachment] };
  const f = setup({ globalHost: { enabled: true, localWorkdir: "/different-phone-root" } });
  await f.submit({ userMessage: message, context: { messages: [message] } });
  assert.deepEqual(f.calls.find(([name]) => name === "snapshot"), ["snapshot", "/original-phone", path]);
  assert.equal(f.submissions[0].input.files.length, 1);
  assert.equal(Buffer.from(f.submissions[0].input.files[0].contentBase64, "base64").toString(), bytes.toString());
  assert.ok(f.submissions[0].input.prompt.includes("C:\\\\old-pc"));
});

test("invalid or changed imported attachment provenance cannot create a task or silently read its remote path", async () => {
  const path = "/phone/source.txt", bytes = Buffer.from(`Actual file bytes: ${path}`);
  for (const localSource of [null, {}, { version: 1, workdir: "/phone", path, bytes: bytes.length,
    contentHash: createHash("sha256").update(Buffer.alloc(bytes.length, 1)).digest("hex") }]) {
    const f = setup(); const message = { ...user(), xgentAttachments: [{ fileName: "source.txt", kind: "text", sizeBytes: bytes.length,
      relativePath: "remote.txt", absolutePath: "C:\\remote.txt", localSource }] };
    await assert.rejects(f.submit({ userMessage: message, context: { messages: [message] } }), /invalid local source|changed since attachment import/);
    assert.equal(f.submissions.length, 0);
    assert.equal(f.calls.some(call => call[0] === "snapshot" && call[2] === "C:\\remote.txt"), false);
    assert.equal(f.calls.some(([name]) => name === "foreground"), false);
  }
});

test("conflicting source copies for the same chat attachment cannot silently replace earlier input", async () => {
  const path = "/phone/source.txt", bytes = Buffer.from(`Actual file bytes: ${path}`);
  const base = { fileName: "source.txt", kind: "text", sizeBytes: bytes.length, relativePath: "remote.txt",
    localSource: { version: 1, workdir: "/phone", path, bytes: bytes.length, contentHash: createHash("sha256").update(bytes).digest("hex") } };
  const previous = { ...user("prior"), xgentAttachments: [base] };
  const current = { ...user(), xgentAttachments: [{ ...base, localSource: { ...base.localSource, workdir: "/other-phone" } }] };
  const f = setup(); await assert.rejects(f.submit({ userMessage: current, context: { messages: [previous, current] } }), /Conflicting attachment source/);
  assert.equal(f.calls.some(([name]) => name === "snapshot"), false); assert.equal(f.submissions.length, 0);
});

test("inaccessible phone inputs and over-limit manifests never degrade to prompt-only handoff or foreground duplication", async () => {
  for (const options of [{ snapshotFails: true }, {}]) {
    const f = setup(options); const files = Array.from({ length: options.snapshotFails ? 1 : 9 }, (_, index) => ({ fileName: `file${index}.txt`, kind: "text", relativePath: `input/${index}.txt`, sizeBytes: 1 }));
    const message = { ...user(), xgentAttachments: files };
    await assert.rejects(f.submit({ userMessage: message }), /initiating device|At most 8/);
    assert.equal(f.submissions.length, 0); assert.equal(f.calls.some(([name]) => name === "foreground"), false);
  }
});

test("global selected PC does not redirect native local intake or phone attachment snapshots", async () => {
  const f = setup({ globalHost: { enabled: true, localWorkdir: "/actual-phone", remoteWorkdir: "/selected-pc" } });
  const message = { ...user(), xgentAttachments: [{ fileName: "input.txt", kind: "text", relativePath: "input.txt", sizeBytes: 1 }] };
  await f.submit({ userMessage: message });
  assert.equal(f.submissions[0].isLocal, true); assert.equal(f.calls.find(([name]) => name === "snapshot")[1], "/actual-phone");
});

test("invalid actual context and mismatched host receipts cannot publish a fake accepted task", async () => {
  const bad = setup(); await assert.rejects(bad.submit({ context: { messages: [{ role: "assistant", content: [{ type: "toolCall", id: "pending", name: "Write" }] }] } }), /unfinished tool calls/);
  assert.equal(bad.submissions.length, 0);
  const wrong = setup({ wrongReply: true }); await assert.rejects(wrong.run(), /original request or execution device/);
  assert.equal(wrong.calls.some(([name]) => ["receipt_persist", "foreground"].includes(name)), false);
});

test("explicit Stop during an uncertain handoff persists cancellation only at its original owner", async () => {
  const f = setup({ uncertain: true, onSubmit: controller => controller.abort(), cancelOffline: true }); await f.run();
  const request = f.submissions[0].input.requestId;
  assert.deepEqual(f.calls.find(([name]) => name === "cancel"), ["cancel", request, "local"]);
  assert.equal(f.state.segments[0].messages.at(-1).xgentBackgroundTask.cancelRequested, true);
  assert.equal(f.calls.some(([name]) => name === "foreground"), false);
});

test("Stop during saved-owner recovery cancels that owner without discovering or creating replacement work", async () => {
  const f = setup({ stopWhileReading: true, existing: { sourceHostId: "original", result: null, localExecution: false, name: "Saved", cancelRequested: false }, cancelOffline: true });
  await f.run();
  assert.deepEqual(f.calls.find(([name]) => name === "cancel"), ["cancel", f.state.segments[0].messages.at(-1).xgentBackgroundTask.requestId, "original"]);
  assert.equal(f.state.segments[0].messages.at(-1).xgentBackgroundTask.cancelRequested, true);
  assert.equal(f.calls.some(([name]) => ["catalog", "snapshot", "submit", "foreground"].includes(name)), false);
});

test("ordinary text turns do not enter durable Agent admission", async () => {
  const f = setup();
  const loader = createTsModuleLoader({ mocks: {
    "../../../lib/automation/backgroundChatIntake": { async runDurableChatTurn() { throw new Error("Text incorrectly entered durable intake"); } },
    "../turns/runTextConversationTurn": { async runTextConversationTurn() { f.calls.push(["text"]); } },
  } });
  await loader.loadModule("src/pages/chat/runtime/ChatRuntimeHost.ts").createChatRuntimeHost().runTurn({ mode: "text", params: {} });
  assert.deepEqual(f.calls, [["text"]]);
});

test("failed receipt history persistence retains the native task and cannot start another executor", async () => {
  const f = setup({ receiptPersistFails: true }); await assert.rejects(f.run(), /receipt could not be persisted/);
  assert.equal(f.saved.size, 1); assert.equal(f.submissions.length, 1);
  assert.equal(f.calls.some(([name]) => ["foreground", "checkpoint", "close"].includes(name)), false);
});

test("no locally staged request after a transport error is an error rather than an invented durable receipt", async () => {
  const f = setup({ noStage: true }); await assert.rejects(f.run(), /unknown/);
  assert.equal(f.calls.some(([name]) => ["foreground", "receipt_persist"].includes(name)), false);
});

test("persistent mixed intake accepts the full source graph on a compatible executor and records the original phone", async () => {
  const p = { version: 1, continuity: "persistent", branches: [
    { id: "documents", requirement: "Process the documents and make PPT", dependsOn: [], kind: "task", effort: "large", locality: "portable", requirements: { capabilities: [], platforms: [] } },
    { id: "calendar", requirement: "Arrange tomorrow on the phone", dependsOn: [], kind: "task", effort: "small", locality: "initiating-device", requirements: { capabilities: [], platforms: [] } },
    { id: "exercise", requirement: "Remind every evening", dependsOn: [], kind: "task", effort: "small", locality: "initiating-device", requirements: { capabilities: [], platforms: [] } },
  ] };
  const f = setup({ local: null, assessment: p, peers: [{ peerId: "pc", online: true, host: worker("pc", { sourceRoutingVersion: 1, deviceChannelVersion: 1, deviceActionsVersion: 1 }) }] });
  await f.run();
  assert.equal(f.submissions.length, 1); assert.equal(f.calls.some(([name]) => name === "foreground"), false);
  const source = f.submissions[0].input.sourceContext;
  assert.equal(source.routing.initiatingHostId, "11111111-1111-4111-8111-111111111111");
  assert.deepEqual(source.routing.branches.map(b => b.id), ["documents", "calendar", "exercise"]);
  assert.equal(source.messages[0].content, user().content); assert.ok(f.submissions[0].input.prompt.includes("Remind every evening"));
});

test("actual native admission keeps interactive and phone-local work in the foreground despite idle peers", async () => {
  for (const locality of ["portable", "initiating-device", "unknown"]) {
    const f = setup({ assessment: { version: 1, continuity: "foreground", branches: [{ id: "local", requirement: "Short local work", dependsOn: [], kind: "interactive", effort: "small", locality, requirements: { capabilities: [], platforms: [] } }] }, peers: [{ peerId: "idle", online: true, host: worker("idle") }] });
    await f.run();
    assert.equal(f.submissions.length, 0); assert.equal(f.saved.size, 0);
    assert.ok(f.calls.some(([name]) => name === "assessment")); assert.ok(f.calls.some(([name]) => name === "foreground"));
  }
});

test("failed requirement proposal and a missing matching SDK do not admit arbitrary desktop work", async () => {
  for (const options of [{ assessmentFails: true }, { assessment: { version: 1, continuity: "persistent", branches: [{ id: "ipa", requirement: "Build the IPA", dependsOn: [], kind: "task", effort: "large", locality: "portable", requirements: { capabilities: ["xcode"], platforms: ["macos"] } }] } }]) {
    const f = setup(options); await f.run();
    assert.equal(f.submissions.length, 0); assert.ok(f.calls.some(([name]) => name === "foreground"));
  }
});

test("IPA requirements reach the native immutable input and only an actually observed Mac is eligible", async () => {
  // Observe at this test's admission, not at module load. A broad concurrent
  // suite can legitimately take longer than the production 60-second TTL.
  const now = Date.now();
  const f = setup({ assessment: { version: 1, continuity: "persistent", branches: [{ id: "ipa", requirement: "Build the IPA", dependsOn: [], kind: "task", effort: "large", locality: "portable", requirements: { capabilities: ["xcode"], platforms: ["macos"] } }] }, peers: [{ peerId: "mac", online: true, host: worker("mac", { platform: "macos", inventory: { version: 1, observedAt: now, validUntil: now + 60000, capabilities: [{ id: "xcode", state: "available", evidence: "version-command", detail: "Xcode 16" }] } }) }] });
  await f.run();
  assert.equal(f.submissions[0].peer, "mac");
  assert.deepEqual(f.submissions[0].input.requirements, { capabilities: ["xcode"], platforms: ["macos"] });
  assert.ok(f.submissions[0].input.prompt.includes("project dependencies"));
  assert.equal(f.state.segments[0].messages.at(-1).xgentBackgroundTask.routing.reason, "persistent");
});
