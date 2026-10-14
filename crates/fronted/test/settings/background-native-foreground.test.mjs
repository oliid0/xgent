import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const proposal = (patch = {}) => ({ version: 1, continuity: "foreground", branches: [{ id: "report", requirement: "Summarize attached input into a new file", dependsOn: [], kind: "task", effort: "small", locality: "portable", workspace: "inputs-only", requirements: { capabilities: [], platforms: [] }, ...patch }] });
function fixture(options = {}) {
  const calls = [], storage = new Map(), stop = new AbortController();
  const root = options.root ?? "/phone/workspace";
  const originalBytes = Buffer.from("Actual saved source: cafe\u0301, 中文\n");
  const source = { version: 1, workdir: "/original-phone", path: "/original-phone/source.txt", bytes: originalBytes.length, contentHash: digest(originalBytes) };
  storage.set(source.path, options.changedSource ? Buffer.from("changed") : originalBytes);
  let globalHost = { enabled: true, baseUrl: "http://original:28367", localWorkdir: root, remoteWorkdir: "/pc/project", remoteHomeDir: "/pc/home", remotePlatform: "linux" };
  const reachedRegistry = new Error("Actual Agent registry reached after native tool calls");
  let foreground, actualAgent, message, state;
  const loader = createTsModuleLoader({ mocks: {
    "@xgent/runtime": { isTauriRuntime: () => true, getLanPcCommandHostConfig: () => ({ ...globalHost }), invoke: () => assert.fail("Mutable global transport used") },
    "../providers/llm": { async completeAssistantMessage(input) {
      calls.push(["assessment", input]);
      if (options.onAssessment) await options.onAssessment(stop);
      globalHost = { ...globalHost, baseUrl: "http://later:28367", localWorkdir: "/wrong-root" };
      return { stopReason: "stop", content: [{ type: "text", text: JSON.stringify(options.assessment ?? proposal()) }] };
    }, assistantMessageToText: result => result.content.map(block => block.text).join("") },
    "./backend": { backend: {
      getBackgroundSubmissionState: async id => options.saved ? { requestId: id, sourceHostId: "original-owner", result: null, cancelRequested: false, name: "Saved" } : null,
      listWorkerPeers: async () => ({ peers: [] }), getLocalWorkerHostInfo: async () => null,
      submitBackgroundTask: async () => assert.fail("Small local task submitted to another executor"),
    } },
    "@tauri-apps/api/core": { async invoke(command, args) {
      calls.push([command, args]);
      if (command === "fs_list") {
        assert.equal(args.workdir, root); assert.equal(args.path, null); assert.equal(args.max_results, 1);
        if (options.rootFails) throw new Error("Workspace unavailable");
        if (options.abortAtRoot) stop.abort(new Error("Stop during workspace probe"));
        return options.rootReply ?? { path: null, targetKind: "dir", entries: [] };
      }
      if (command === "fs_snapshot_binary") {
        const bytes = storage.get(args.path);
        if (!bytes) throw new Error("File absent");
        return { bytes: bytes.length, contentHash: digest(bytes), contentBase64: bytes.toString("base64") };
      }
      if (command === "fs_path_status") {
        assert.equal(args.workdir, root);
        return { exists: storage.has(args.path), kind: options.existingKind ?? "file" };
      }
      if (command === "fs_create_binary") {
        assert.equal(args.workdir, root);
        if (storage.has(args.path)) throw new Error("create_new: already exists");
        const bytes = Buffer.from(args.content_base64, "base64");
        assert.equal(digest(bytes), args.expected_content_hash);
        storage.set(args.path, options.partialWrite ? bytes.subarray(0, 2) : bytes);
        if (options.abortAtWrite) stop.abort(new Error("Stop after input copy"));
        if (options.writeThrows || options.partialWrite) throw new Error("Lost write receipt");
        return { path: options.wrongWriteReply ? "wrong.txt" : args.path, bytesWritten: bytes.length, contentHash: digest(bytes) };
      }
      if (command === "fs_read_text") {
        assert.equal(args.workdir, root);
        return { text: storage.get(args.path).toString() };
      }
      if (command === "shell_run") { assert.equal(args.workdir, root); return { exitCode: 0 }; }
      assert.fail(`Unexpected native command ${command}`);
    } },
    "@tauri-apps/api/path": { homeDir: async () => "/native-home" },
    "@tauri-apps/api/event": { listen: async () => () => {} },
    "@tauri-apps/api/webview": { getCurrentWebview: () => ({}) },
    "@tauri-apps/plugin-opener": { openUrl: async () => {}, revealItemInDir: async () => {} },
    "../../../lib/chat/memory/extractionController": { memoryExtraction: { noteTurnBoundary() {} } },
    "../../../lib/runtimePlatform": { resolveRuntimePlatform: async () => "linux" },
    "../../../lib/tools/builtinRegistry": { async buildBuiltinToolRegistry(input) {
      calls.push(["registry", input.workdir]);
      const prepared = foreground.buildPreparedContext(state);
      const copies = prepared.messages.filter(m => m.role === "user").flatMap(m => typeof m.content === "string" ? [m.content] : m.content.filter(b => b.type === "text").map(b => b.text)).join("\n");
      assert.ok(copies.includes(root)); assert.equal(copies.includes("- /pc/project/input.txt"), false);
      const mappedMessage = foreground.buildPreparedContext(state, undefined, { includeUploadedFilesMetadata: true }).messages[0];
      const path = mappedMessage.xgentAttachments[0].relativePath;
      const read = await input.commandPort.invoke("fs_read_text", { workdir: input.workdir, path });
      assert.equal(read.text, originalBytes.toString());
      await input.commandPort.invoke("shell_run", { workdir: input.workdir, command: "task operation" });
      assert.equal(await input.commandPort.homeDir(), "/native-home");
      throw reachedRegistry;
    } },
    "../turns/runAgentConversationTurn": { async runAgentConversationTurn(params) {
      foreground = params; calls.push(["foreground"]);
      if (options.realAgent !== false) await actualAgent(params);
    } },
  } });
  const uploads = loader.loadModule("src/lib/chat/messages/uploadedFiles.ts");
  const file = { fileName: "input.txt", kind: "text", sizeBytes: source.bytes, relativePath: "input.txt", absolutePath: "/pc/project/input.txt", localSource: source, ...(options.file ?? {}) };
  message = uploads.createUserMessageWithUploads(options.text ?? "Summarize this attachment", [file], 1);
  if (options.image) message.content = [{ type: "text", text: message.content }, { type: "image", data: "AQID", mimeType: "image/png" }];
  const conversation = loader.loadModule("src/lib/chat/conversation/conversationState.ts");
  state = conversation.createConversationStateFromContext({ systemPrompt: "Original memory", messages: [message] });
  const params = { conversationId: "conversation", sessionId: "session", providerId: "openai", model: "model", selectedModel: { customProviderId: "provider", model: "model" },
    runtime: {}, runtimeModel: { api: "openai-completions", provider: "openai", id: "model" }, effectiveWorkdir: "/pc/project", conversationCwd: "/pc/project",
    lanPcCommandHostReady: true, commandHostSnapshot: { ...globalHost }, cancellation: { userStop: stop },
    conversationDebugLogger: { enabled: false }, getNextConversationState: () => state,
    backgroundIntake: { userMessage: message, ensureHistoryPersisted: async () => true, foregroundText: "Foreground", receiptText: () => "Saved owner", routingText: reason => reason },
    buildPreparedContext: (current, tools, opts) => ({ ...conversation.buildRequestContext(current, opts), ...(tools ? { tools } : {}) }),
    updateToolStatus: status => calls.push(["status", status]), applyConversationState: next => { state = next; }, resetLiveTranscript() {},
    persistConversationWithHistorySync: async () => state, conversationEvents: { queueCheckpoint() {}, queueEvent() {}, close() {} },
  };
  const helper = loader.loadModule("src/lib/automation/nativeForegroundExecution.ts");
  actualAgent = loader.loadModule("src/pages/chat/turns/runAgentConversationTurn.ts").runAgentConversationTurn;
  const host = loader.loadModule("src/pages/chat/runtime/ChatRuntimeHost.ts").createChatRuntimeHost();
  return { loader, calls, params, source, message, storage, originalBytes, stop, reachedRegistry, uploads,
    run: () => host.runTurn({ mode: "agent", params }),
    prepare: (assessment = proposal(), reason = "small-local") => helper.prepareNativeForegroundTurn(params, assessment, reason, params.buildPreparedContext(state, undefined, { includeUploadedFilesMetadata: true })),
    get foreground() { return foreground; }, get state() { return state; } };
}

test("actual intake and Agent use native FS/Shell/home with verified local bytes despite selected PC and no eligible background worker", async () => {
  const f = fixture(); const original = structuredClone(f.message);
  await assert.rejects(f.run(), error => error === f.reachedRegistry);
  assert.equal(f.foreground.effectiveWorkdir, "/phone/workspace");
  assert.equal(f.foreground.commandHostSnapshot.enabled, false);
  assert.equal(f.foreground.lanPcCommandHostReady, false);
  assert.equal(f.foreground.conversationCwd, "/pc/project");
  assert.deepEqual(f.params.commandHostSnapshot.baseUrl, "http://original:28367");
  assert.deepEqual(f.message, original);
  assert.equal(f.calls.some(([name]) => name === "lan_pc_invoke"), false);
  assert.equal(f.calls.filter(([name]) => name === "fs_create_binary").length, 1);
  const request = f.calls.find(([name]) => name === "assessment")[1];
  assert.deepEqual(JSON.parse(request.context.messages[1].content).selectedWorkspace, { device: "selected-peer", workdir: "/pc/project" });
});

test("execution remapping preserves images, IDs, timestamps, tools, raw user paths and history metadata", async () => {
  const f = fixture({ image: true, text: "The old path /pc/project/input.txt is task data" });
  const original = structuredClone(f.message), prepared = await f.prepare();
  const tools = [{ name: "Read" }];
  const context = prepared.buildPreparedContext(f.state, tools, { includeUploadedFilesMetadata: true });
  const message = context.messages[0];
  assert.equal(message.id, f.message.id); assert.equal(message.timestamp, 1);
  assert.deepEqual(message.content[1], original.content[1]);
  assert.ok(message.content[0].text.includes("The old path /pc/project/input.txt is task data"));
  assert.ok(message.content[0].text.includes("- /phone/workspace/uploads/local-turn-"));
  assert.deepEqual(context.tools, tools); assert.deepEqual(f.message, original);
  assert.equal(prepared.buildPreparedContext(f.state).messages[0].xgentAttachments, undefined);
});

test("generated paste reference follows its execution copy while unrelated bracketed text remains", async () => {
  const f = fixture({ text: "[Pasted text 1: input.txt] [Pasted text 2: unrelated.txt]", file: { displayMode: "largePaste", displayLabel: "Pasted text 1", displayCharCount: 20 } });
  const prepared = await f.prepare(); const context = prepared.buildPreparedContext(f.state, undefined, { includeUploadedFilesMetadata: true });
  assert.ok(context.messages[0].content.includes("[Pasted text 1: uploads/local-turn-"));
  assert.ok(context.messages[0].content.includes("[Pasted text 2: unrelated.txt]"));
  assert.equal(context.messages[0].xgentAttachments[0].displayLabel, "Pasted text 1");
  assert.ok(f.message.content.includes("[Pasted text 1: input.txt]"));
});

test("actual prepared context remaps attachments before appended memory and skill updates without changing either injection", async () => {
  const f = fixture();
  const builder = f.loader.loadModule("src/pages/chat/runtime/conversationContextBuilders.ts");
  const memory = "Memory update retains /pc/project/input.txt as historical data";
  const skill = "Skill update [Pasted text 1: input.txt] is independent injected text";
  f.params.buildPreparedContext = (state, tools, opts) => builder.buildPreparedContext({ state, tools,
    soulPrompt: "Actual soul", skillsPrompt: "Actual skills", memoryPrompt: "Actual memory",
    memoryTurnUpdates: new Map([[f.message.id, memory]]), skillMentionUpdates: new Map([[f.message.id, skill]]), ...opts });
  const prepared = await f.prepare(); const context = prepared.buildPreparedContext(f.state);
  assert.ok(context.messages[0].content.includes("- /phone/workspace/uploads/local-turn-"));
  assert.ok(context.messages[0].content.endsWith(`${memory}\n\n${skill}`));
  assert.ok(context.systemPrompt.includes("Actual memory"));
  assert.ok(context.systemPrompt.includes('"source":"/pc/project/input.txt"'));
});

test("a mutated generated instruction cannot be replaced by guesses or erase user content", async () => {
  const f = fixture(); f.message.content = f.message.content.replace("Use Read", "User-edited Read");
  await assert.rejects(f.prepare(), /could not be mapped/);
});

test("current-project, missing/unknown workspace, persistent, large and uncertain work never use directory mapping as project identity", async () => {
  const f = fixture();
  for (const assessment of [proposal({ workspace: "current-project" }), proposal({ workspace: undefined }), proposal({ workspace: "unknown" }), { ...proposal(), continuity: "persistent" }, proposal({ effort: "large" }), null])
    assert.equal(await f.prepare(assessment), null);
  assert.equal(f.calls.length, 0);
});

test("large local-capable inputs-only foreground work uses verified native bytes and retains transfer limits", async () => {
  const f = fixture({ assessment: proposal({ effort: "large" }) });
  await assert.rejects(f.run(), error => error === f.reachedRegistry);
  assert.equal(f.foreground.effectiveWorkdir, "/phone/workspace");
  assert.equal(f.foreground.commandHostSnapshot.enabled, false);
  assert.equal(f.calls.some(([name]) => name === "lan_pc_invoke"), false);
  const oversized = fixture({ file: { sizeBytes: 8 * 1024 * 1024 + 1, localSource: { ...f.source, bytes: 8 * 1024 * 1024 + 1 } } });
  await assert.rejects(oversized.prepare(proposal({ effort: "large" }), "local-capable"), /invalid local source provenance/);
  assert.equal(oversized.calls.length, 0);
});

test("mixed device-local work with SDK/platform requirements cannot bypass feasibility checks", async () => {
  const f = fixture();
  assert.equal(await f.prepare(proposal({ locality: "initiating-device", requirements: { capabilities: ["xcode"], platforms: ["macos"] } }), "device-local"), null);
  assert.equal(f.calls.length, 0);
});

test("short initiating-device connector work with inputs-only scope receives native execution", async () => {
  const f = fixture({ assessment: proposal({ locality: "initiating-device" }), realAgent: false });
  await f.run(); assert.equal(f.foreground.commandHostSnapshot.enabled, false);
});

test("legacy files without local provenance retain their original executor and report unobserved local evidence", async () => {
  const f = fixture({ file: { localSource: undefined }, realAgent: false });
  delete f.message.xgentAttachments[0].localSource;
  await f.run(); assert.equal(f.foreground.commandHostSnapshot.enabled, true);
  assert.ok(f.calls.some(call => call[0] === "status" && call[1] === "local-unobserved"));
  assert.equal(f.calls.some(([name]) => name === "fs_create_binary"), false);
});

test("changed or invalid local input blocks execution without remote reads or foreground duplication", async () => {
  for (const options of [{ changedSource: true }, { file: { localSource: null } }, { file: { sizeBytes: 1 } }]) {
    const f = fixture(options);
    await assert.rejects(f.run(), /changed|invalid local source|size disagrees/);
    assert.equal(f.calls.some(([name]) => ["foreground", "fs_create_binary", "lan_pc_invoke"].includes(name)), false);
  }
});

test("unavailable or malformed native workspace observation preserves original execution without claiming native feasibility", async () => {
  for (const options of [{ rootFails: true }, { rootReply: { path: null, targetKind: "file", entries: [] } }, { rootReply: {} }]) {
    const f = fixture({ ...options, realAgent: false }); await f.run();
    assert.equal(f.foreground.commandHostSnapshot.enabled, true);
    assert.equal(f.calls.some(([name]) => name === "fs_create_binary"), false);
  }
});

test("lost local copy receipt is reconciled using exact bytes without repeating a write", async () => {
  const f = fixture({ writeThrows: true, realAgent: false }); await f.run();
  assert.equal(f.foreground.commandHostSnapshot.enabled, false);
  assert.equal(f.calls.filter(([name]) => name === "fs_create_binary").length, 1);
  assert.equal(f.calls.filter(([name]) => name === "fs_snapshot_binary").length, 2);
});

test("repeated local preparation reuses only identical copies without overwriting changed input", async () => {
  const f = fixture(); await f.prepare(); const prepared = await f.prepare();
  assert.equal(prepared.commandHostSnapshot.enabled, false);
  const path = f.calls.find(([name]) => name === "fs_create_binary")[1].path;
  f.storage.set(path, Buffer.from("other bytes"));
  await assert.rejects(f.prepare(), /changed/);
  assert.equal(f.storage.get(path).toString(), "other bytes");
});

test("partial input write and inconsistent copy receipts cannot start tools", async () => {
  for (const options of [{ partialWrite: true }, { wrongWriteReply: true }]) {
    const f = fixture(options); await assert.rejects(f.run(), /changed|unconfirmed/);
    assert.equal(f.calls.some(([name]) => name === "foreground"), false);
    assert.equal(f.calls.filter(([name]) => name === "fs_create_binary").length, 1);
  }
});

test("copy reconciliation rejects symlinks and directories even when their cached bytes appear correct", async () => {
  for (const existingKind of ["symlink", "dir"]) {
    const f = fixture({ writeThrows: true, existingKind });
    await assert.rejects(f.run(), /not a regular file/);
    assert.equal(f.calls.some(([name]) => name === "foreground"), false);
    assert.equal(f.calls.filter(([name]) => name === "fs_create_binary").length, 1);
  }
});

test("explicit Stop during workspace probe or input copy prevents foreground tools", async () => {
  for (const options of [{ abortAtRoot: true }, { abortAtWrite: true }]) {
    const f = fixture(options); await assert.rejects(f.run(), /Stop/);
    assert.equal(f.calls.some(([name]) => name === "foreground"), false);
  }
});

test("saved original owner prevents assessment, native preparation and duplicate foreground execution", async () => {
  const f = fixture({ saved: true }); await f.run();
  assert.equal(f.calls.some(([name]) => ["assessment", "fs_list", "fs_create_binary", "foreground"].includes(name)), false);
});

test("Windows native output paths use the observed initiating workspace, retaining portable copy names", async () => {
  const f = fixture({ root: "C:\\phone\\workspace" });
  const prepared = await f.prepare(); const context = prepared.buildPreparedContext(f.state, undefined, { includeUploadedFilesMetadata: true });
  assert.ok(context.messages[0].xgentAttachments[0].absolutePath.startsWith("C:\\phone\\workspace\\uploads\\"));
  assert.ok(context.messages[0].xgentAttachments[0].relativePath.startsWith("uploads/local-turn-"));
});
