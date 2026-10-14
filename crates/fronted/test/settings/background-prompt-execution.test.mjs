import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const lease = { attempt: 1, generation: 1, token: "11111111-1111-4111-8111-111111111111" };

function setup({ memoryFails = false, checkpointFails = false, inputsFail = false, inputs = [], provider = {}, toolResult, toolArguments = {}, cloudRecoveryFails = false, verifiedProvider, verificationFailsAt, intentDenied = false, malformedSnapshot = false, modelConfig, summaryFails = false, restore, restoreFails = false, restoredReceipt, uncertainIntent = false, emitToolTurn = true, outcomeReports, mcpFailure = false, recordOutcome = false, nativeOutcome, outcomeDenied = false, sourceContext = null, sourceFails = false, schedulingSnapshot = {}, runTools, invokeTool, runSignal, modelRequestLimit = 128, budgetDeferral } = {}) {
  const memoryWorkdirs = [];
  const memoryRequests = [];
  const runs = [];
  const checkpoints = [];
  const operations = [];
  const preparations = [];
  const nativeToolCalls = [];
  const registries = [];
  const verifications = [];
  const toolInvocations = [];
  const compactions = [], summaries = [], contextOverrides = [];
  const budget = { version: 1, executionId: "execution", scope: "current_host_execution", modelRequests: { used: 0, limit: modelRequestLimit }, toolCalls: { used: 0, limit: 256 }, durable: true, includesCompaction: true, includesDeviceDelegates: false, exhausted: false };
  const defaultOutcome = { verified: true, branches: [{ branch: { id: "report", title: "Report", requirement: "create report", dependsOn: [], criteria: [{ kind: "answer" }] }, state: "verified", evidence: { artifactIds: [], callIds: [], answer: null }, reason: null }] };
  let outcomeRead = 0;
  let outcomeState = nativeOutcome;
  const summary = { role: "assistant", api: "openai-completions", provider: "openai", model: "model", stopReason: "stop", timestamp: 50,
    usage: { input: 1000, output: 300, cacheRead: 0, cacheWrite: 0, totalTokens: 1300, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    content: [{ type: "text", text: `<summary><task>Create the requested report</task><state>The source was read in /accepted/workspace. Existing receipts remain in native storage. No report file has yet been created or verified. Preserve the original goal, account restrictions, workspace scope, and all unfinished work. Do not repeat completed writes. Inspect the archived evidence if exact source content is needed.</state><artifacts>- [file] /accepted/workspace/report.docx | planned | needs generation and verification</artifacts><next_steps>Create and verify the real report, publish it, then finish only when the original goal is satisfied.</next_steps></summary>` }] };
  const llm = { assistantMessageToText: (message) => message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n"),
    async completeAssistantMessage(params) { summaries.push(params); if (summaryFails) throw new Error("summary service unavailable"); return summary; } };
  const loader = createTsModuleLoader({ mocks: {
    "@tauri-apps/api/core": { async invoke(command, args) {
      if (command === "shell_run") {
        nativeToolCalls.push({ command, args });
        return { exit_code: 0, stdout: "owned workspace" };
      }
      assert.deepEqual((args.input ?? args).lease, lease, `Missing captured authority: ${command}`);
      if (command === "automation_background_budget") return { ...structuredClone(budget), executionId: args.execution_id };
      if (command === "automation_background_budget_consume") {
        if (budgetDeferral) {
          budget.includesDeviceDelegates = true;
          budget.modelRequests.reserved = budget.modelRequests.limit - budget.modelRequests.used;
          budget.toolCalls.reserved = 1;
          return { admitted: false, budget: { ...structuredClone(budget), executionId: args.execution_id }, deferred: { ...budgetDeferral, kind: args.kind } };
        }
        if(budget[args.kind].used >= budget[args.kind].limit) budget.exhausted = true;
        if(!budget.exhausted) budget[args.kind].used++;
        return { admitted: !budget.exhausted, budget: { ...structuredClone(budget), executionId: args.execution_id } };
      }
      if (command === "automation_background_cloud_reconcile") {
        operations.push({ phase: "native-cloud-reconcile", args });
        if (cloudRecoveryFails) throw new Error("Actual GET unavailable");
        return null;
      }
      if (command === "automation_background_cloud_start") {
        operations.push({ phase: "native-cloud-start", args });
        return { role: "toolResult", toolCallId: args.call_id, toolName: "CloudTaskManager", isError: false, timestamp: 100,
          content: [{ type: "text", text: "Actual native receipt" }], details: { kind: "cloud_task_manager", action: "start", taskId: "actual-task", owner: "original-owner", repository: "agent-temp" } };
      }
      if (command === "automation_background_source_context") {
        assert.equal(args.execution_id, "e");
        if (sourceFails) throw new Error("Accepted source conversation could not be read");
        return sourceContext;
      }
      if (command === "automation_background_outcomes") return outcomeState ?? outcomeReports?.[Math.min(outcomeRead++, outcomeReports.length - 1)] ?? defaultOutcome;
      if (command === "automation_background_record_outcome") {
        operations.push({ phase: "outcome", input: args.input });
        if (outcomeDenied) throw new Error("no matching evidence for this branch");
        outcomeState = { ...defaultOutcome, branches: [{ ...defaultOutcome.branches[0], evidence: args.input.evidence }] };
        return outcomeState;
      }
      if (command === "automation_background_execution_settings") {
        verifications.push(args.execution_id);
        if (verificationFailsAt === verifications.length) throw new Error("accepted account or connector permissions changed");
        if (malformedSnapshot) return {};
        return { providerId: "p", model: "model", providers: [{ ...settings.customProviders[0], ...verifiedProvider }],
          system: { ...settings.system, workdir: "/accepted/workspace" }, mcp: settings.mcp, access: settings.access, ...schedulingSnapshot };
      }
      if (command === "automation_background_prepare_inputs") {
        preparations.push(args.execution_id);
        if (inputsFail) throw new Error("accepted input copy changed");
        return inputs;
      }
      if (command === "automation_background_restore_checkpoint") {
        if (restoreFails) throw new Error("unknown operation needs reconciliation");
        return restore ?? { revision: 0, context: null, lastCompaction: null };
      }
      if (command === "automation_background_begin_operation") {
        if (intentDenied) throw new Error("native configuration binding rejected before intent");
        operations.push({ phase: "intent", input: args.input });
        if (uncertainIntent) return { status: "uncertain" };
        if (restoredReceipt) return { status: "returned", result: restoredReceipt };
        return { status: "execute" };
      }
      if (command === "automation_background_complete_operation") {
        operations.push({ phase: "receipt", input: args.input }); return;
      }
      if (command === "automation_background_compact_context") {
        compactions.push(args.input); return args.input.sourceRevision + 1;
      }
      assert.equal(command, "automation_background_save_checkpoint");
      if (checkpointFails) throw new Error("checkpoint disk unavailable");
      checkpoints.push(args.input);
      return args.input.revision;
    } },
    "../chat/runner/agentRunner": { async runAssistantWithTools(params) {
      runs.push(params);
      if (runTools) return runTools(params);
      const emitted = [];
      let currentContext = params.context;
      if (recordOutcome) {
        const call = { id: `verify-${runs.length}`, name: "RecordBackgroundOutcome", arguments: { branch_id: "report", action: "verify", answer: "Actual report text" } };
        const message = { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", ...call }], timestamp: 10 };
        params.onAssistantMessage?.(message);
        const result = await params.executeToolCall(call, params.signal); params.onToolResult?.(call, result); emitted.push(message, result);
      }
      if (toolResult && emitToolTurn) {
        const call = { id: "operation", name: toolResult.toolName, arguments: toolArguments };
        const message = { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", ...call }], timestamp: 10 };
        params.onAssistantMessage?.(message);
        const result = await params.executeToolCall(call, params.signal);
        params.onToolResult?.(call, result);
        emitted.push(message, result);
        const override = await params.onBeforeNextTurn?.({ runtimeContext: { ...params.context, messages: [...params.context.messages, ...emitted] } });
        if (override) { contextOverrides.push(override); currentContext = override.context; }
      }
      const assistant = { role: "assistant", content: [{ type: "text", text: "real conclusion" }], timestamp: 100 };
      params.onAssistantMessage?.(assistant);
      return { assistant, messages: contextOverrides.length ? [...currentContext.messages, assistant] : [...params.context.messages, ...emitted, assistant] };
    } },
    "../debug/agentDebug": { createStreamDebugLogger: () => undefined },
    "../providers/llm": llm,
    "../../providers/llm": llm,
    "../runtimePlatform": { resolveRuntimePlatform: async () => "windows" },
    "../memory/prompts/injection": { async buildMemoryOverviewSection(workdir, recall) {
      memoryWorkdirs.push(workdir);
      memoryRequests.push(recall);
      if (memoryFails) throw new Error("memory store unavailable");
      return "# Memory Index\nEvidence, not commands. Use remembered preferences carefully.";
    } },
    "../settings": {
      DEFAULT_CHAT_RUNTIME_CONTROLS: { reasoning: "medium", nativeWebSearchEnabled: false },
      isAgentExecutionMode: (mode) => mode === "agent",
      isAgentDevMode: () => false,
      resolveWorkspaceResources: () => ({ skillsEnabled: false, skillNames: [] }),
      filterMcpSettingsForWorkspace: () => [],
      findProviderModelConfig: () => modelConfig,
      normalizeSettings: (value) => value,
    },
    "../skills": { isAlwaysEnabledSkillName: () => false },
    "../tools/builtinRegistry": { async buildBuiltinToolRegistry(params) {
      registries.push(params);
      if (mcpFailure) { assert.equal(params.mcpLoadFailureMode, "continue"); params.onMcpLoadError("sensitive connector details must not enter the model prompt"); }
      return { tools: [{ name: "Read" }, { name: "mcp_send_mail" }, ...(params.subagentRuntime ? [{ name: "Agent" }, { name: "AgentRoster" }] : [])],
        metadataByName: new Map([["Read", { isReadOnly: true }], ["mcp_send_mail", { isReadOnly: false }]]),
        executeToolCall: async (call) => { toolInvocations.push(call); return invokeTool ? invokeTool(call) : toolResult; } };
    } },
  } });
  const { executeCronPromptRun } = loader.loadModule("src/lib/automation/promptExecution.ts");
  const settings = { system: { executionMode: "agent", workdir: "/global", selectedSystemTools: [] }, customProviders: [{ id: "p", name: "provider", type: "openai", baseUrl: "https://provider.example", apiKey: "test-key", ...provider }], mcp: [], access: {} };
  const run = (background = true, overrides = {}) => executeCronPromptRun(settings, {
    executionId: "e", taskId: background ? "e" : "cron-id", taskName: "report", prompt: "create report",
    lease: background ? lease : undefined,
    providerId: "p", model: "model", workdir: "/accepted/workspace", reasoning: "high",
    ...overrides,
  }, runSignal ?? new AbortController().signal);
  return { run, memoryWorkdirs, memoryRequests, runs, checkpoints, operations, preparations, registries, verifications, toolInvocations, compactions, summaries, contextOverrides, nativeToolCalls,
    selectPeer: () => loader.loadModule("src/runtime/lanPcCommandHost.ts").configureLanPcCommandHost({
      enabled: true, baseUrl: "http://other-pc:28367", localWorkdir: "/accepted/workspace", remoteWorkdir: "/other/project",
    }) };
}

function followupContext() {
  return {version:1,taskId:"cron-id",storeId:"original-goals",revision:3,observedAt:100,hasMoreGoals:false,
    goals:[{id:"launch",status:"active",activeWork:true,
      planPreview:{title:"Product launch",description:"Actual requested work",category:"career",parentId:null,
        steps:[{id:"docs",title:"Read original sources",done:true},{id:"ppt",title:"Create real report",done:false}],totalSteps:2,completedSteps:1},
      work:[{requestId:"original-request",name:"Report",executionId:"original-run",sourceHostId:"original-peer",state:"waiting",success:null,outputPreview:"Needs actual access"}],scheduledRuns:[],artifactHints:[]}]};
}

test("explicit goal follow-up reaches the actual scheduled model turn with original input, workspace memory and no duplicate parent authority",async()=>{
  const f=setup();f.selectPeer();await f.run(false,{goalContext:followupContext()});
  assert.deepEqual(f.memoryWorkdirs,["/accepted/workspace"]);
  assert.equal(f.runs[0].context.messages.at(-1).content,"create report");
  assert.match(f.runs[0].context.systemPrompt,/Native linked goal observations/);
  assert.match(f.runs[0].context.systemPrompt,/Memory Index/);
  assert.match(f.runs[0].context.systemPrompt, /"done":true/);
  assert.match(f.runs[0].context.systemPrompt,/activeWork is true/);
  assert.match(f.runs[0].context.systemPrompt,/do not launch duplicate work/);
  assert.equal(f.registries[0].backgroundTaskContext,undefined);assert.equal(f.registries[0].subagentRuntime,undefined);
  assert.equal(f.checkpoints.length,0);assert.equal(f.nativeToolCalls.length,0);
  const ordinary=setup();await ordinary.run(false);
  assert.deepEqual(ordinary.memoryWorkdirs,["/accepted/workspace"]);assert.doesNotMatch(ordinary.runs[0].context.systemPrompt,/Native linked goal observations/);
});

test("goal planning keeps real available work when a connector or memory overview fails without fabricating context",async()=>{
  const f=setup({memoryFails:true,mcpFailure:true});await f.run(false,{goalContext:followupContext()});
  assert.equal(f.runs.length,1);assert.equal(f.registries[0].mcpLoadFailureMode,"continue");
  assert.match(f.runs[0].context.systemPrompt,/could not be loaded.*Do not invent remembered preferences/);
  assert.match(f.runs[0].context.systemPrompt,/configured MCP connectors could not load/);
  assert.doesNotMatch(f.runs[0].context.systemPrompt,/sensitive connector details/);
});

test("unsupported/oversized goal context cannot reach a model and delegated backgrounds do not inherit a schedule's goal store",async()=>{
  for(const change of [{version:9},{goals:[]},{revision:Number.MAX_SAFE_INTEGER+1},{storeId:""}]){
    const f=setup();await assert.rejects(f.run(false,{goalContext:{...followupContext(),...change}}),/linked goal context/);assert.equal(f.runs.length,0);
  }
  const f=setup();await f.run(true,{goalContext:followupContext()});assert.doesNotMatch(f.runs[0].context.systemPrompt,/Native linked goal observations/);
});

test("repeated native continuations replace stale policy/outcome snapshots without changing retained messages", async () => {
  const original = { role: "user", content: "create report", timestamp: 1 };
  const evidence = { role: "user", content: "Actual earlier source: keep the original account and completed writes.", timestamp: 2 };
  let saved = { revision: 40, context: { systemPrompt: "OBSOLETE_POLICY\n" + "Durable requested outcomes at this continuation: STALE_BRANCH\n".repeat(80), messages: [original, evidence] }, lastCompaction: null };
  const prompts = [];
  for (let wake = 0; wake < 3; wake++) {
    const f = setup({ restore: saved }); await f.run();
    const current = f.runs[0].context;
    prompts.push(current.systemPrompt);
    assert.doesNotMatch(current.systemPrompt, /OBSOLETE_POLICY|STALE_BRANCH/);
    assert.equal(current.systemPrompt.split("Durable requested outcomes at this continuation").length - 1, 1);
    assert.deepEqual(current.messages, [original, evidence]);
    assert.equal(f.toolInvocations.length, 0);
    saved = { revision: f.checkpoints.at(-1).revision, context: { systemPrompt: current.systemPrompt, messages: [original, evidence] }, lastCompaction: null };
  }
  assert.equal(prompts[0], prompts[1]); assert.equal(prompts[1], prompts[2]);
});

test("lost or inconsistent current outcome state stops before a new coordinating model turn", async () => {
  const valid = { verified: true, branches: [{ branch: { id: "report", title: "Report", requirement: "create report", dependsOn: [], criteria: [{ kind: "answer" }] }, state: "verified", evidence: null, reason: null }] };
  for (const invalid of [{ verified: false, branches: valid.branches }, { ...valid, branches: [{ ...valid.branches[0], branch: { ...valid.branches[0].branch, dependsOn: ["missing"] } }] }]) {
    const f = setup({ outcomeReports: [valid, invalid] });
    await assert.rejects(f.run(), /inconsistent/);
    assert.equal(f.runs.length, 0); assert.equal(f.toolInvocations.length, 0);
    assert.equal(f.operations.length, 0); assert.ok(f.checkpoints.length > 0);
  }
});

test("main-model follow-up refreshes native outcome progress after the actual state tool receipt", async () => {
  const pending = { verified: false, branches: [{ branch: { id: "report", title: "Report", requirement: "create report", dependsOn: [], criteria: [{ kind: "answer" }] }, state: "pending", evidence: null, reason: null }] };
  let refreshed;
  const f = setup({ nativeOutcome: pending, runTools: async params => {
    assert.match(params.context.systemPrompt, /"dependencyReadyBranchIds":\["report"\]/);
    const call = { id: "verify-report", name: "RecordBackgroundOutcome", arguments: { branch_id: "report", action: "verify", answer: "Actual report answer" } };
    const assistant = { role: "assistant", stopReason: "toolUse", timestamp: 10, content: [{ type: "toolCall", ...call }] };
    params.onAssistantMessage(assistant);
    const receipt = await params.executeToolCall(call, params.signal); params.onToolResult(call, receipt);
    const runtimeContext = { ...params.context, messages: [...params.context.messages, assistant, receipt] };
    const override = await params.onBeforeNextTurn({ runtimeContext });
    assert.ok(override); refreshed = override.context;
    assert.match(refreshed.systemPrompt, /"dependencyReadyBranchIds":\[\]/); assert.match(refreshed.systemPrompt, /"verified":true/);
    assert.equal(refreshed.systemPrompt.split("Durable requested outcomes at this continuation").length - 1, 1);
    assert.deepEqual(refreshed.messages, runtimeContext.messages); assert.deepEqual(override.emittedMessages, []);
    const final = { role: "assistant", content: [{ type: "text", text: "real conclusion" }], timestamp: 100 };
    params.onAssistantMessage(final); return { assistant: final, messages: [...refreshed.messages, final] };
  } });
  assert.equal(await f.run(), "real conclusion\n\nReport:\nActual report answer");
  assert.deepEqual(f.operations.map(entry => entry.phase), ["intent", "outcome", "receipt"]);
  assert.equal(f.toolInvocations.length, 0); // The state receipt never repeats an external action.
  assert.equal(f.checkpoints.at(-1).context.systemPrompt, refreshed.systemPrompt);
});

test("actual execution host waits for in-flight sibling bookkeeping before propagating child parking", async () => {
  const calls = ["first-child", "second-child"].map(id => ({ type: "toolCall", id, name: "BackgroundTask", arguments: { action: "submit", name: id, prompt: "Create actual deliverable" } }));
  const controls = new Map();
  const f = setup({
    async runTools(params) {
      params.onAssistantMessage({ role: "assistant", stopReason: "toolUse", content: calls, timestamp: 100 });
      await Promise.all(calls.map(call => params.executeToolCall(call, params.signal)));
      assert.fail("unknown acceptance must not start another model round");
    },
    invokeTool(call) { return new Promise((resolve, reject) => controls.set(call.id, { resolve, reject })); },
  });
  let finished = false;
  const result = f.run(true, { backgroundContext: { rootRequestId: "root", requestId: "parent", hostIds: ["current"] } }).then(() => { finished = true; return null; }, error => { finished = true; return error; });
  for (let i = 0; i < 100 && controls.size < 2; i++) await Promise.resolve();
  assert.equal(controls.size, 2);
  controls.get(calls[0].id).reject(new Error("first device lost acceptance response"));
  for (let i = 0; i < 30; i++) await Promise.resolve();
  assert.equal(finished, false);
  controls.get(calls[1].id).resolve({ role: "toolResult", toolCallId: calls[1].id, toolName: "BackgroundTask", isError: false, timestamp: 101, content: [{ type: "text", text: "Second device accepted" }], details: {} });
  assert.equal((await result).name, "BackgroundChildLaunchPending");
  assert.equal(f.runs.length, 1); assert.equal(f.toolInvocations.length, 2);
  assert.deepEqual(f.operations.filter(op => op.phase === "receipt").map(op => op.input.callId), [calls[1].id]);
});

test("accepted goal association reaches the independent model context without completing the goal or granting permissions",async()=>{
  const f=setup(),goalBinding={goalId:"launch",storeId:"original-store",revision:4};
  await f.run(true,{backgroundContext:{rootRequestId:"root",requestId:"original",hostIds:["worker"],goalBinding}});
  assert.deepEqual(f.registries[0].backgroundTaskContext.goalBinding,goalBinding);
  assert.match(f.runs[0].context.systemPrompt,/"goalId":"launch"/);assert.match(f.runs[0].context.systemPrompt,/GoalManager to read its actual saved plan and current revision/);assert.match(f.runs[0].context.systemPrompt,/adds no permissions/);
  assert.ok(!f.operations.some(operation=>operation.input?.operation?.op==="set_status"));
  const ordinary=setup();await ordinary.run(false);assert.ok(!ordinary.runs[0].context.systemPrompt.includes("associated with the saved goal"));
});

test("accepted background tools execute on the receiving device despite its selected peer", async () => {
  const f = setup();
  f.selectPeer();
  await f.run();
  const port = f.registries[0].commandPort;
  assert.ok(port);
  const result = await port.invoke("shell_run", { workdir: "/accepted/workspace", command: "pwd" });
  assert.equal(result.stdout, "owned workspace");
  assert.deepEqual(f.nativeToolCalls, [{ command: "shell_run", args: { workdir: "/accepted/workspace", command: "pwd" } }]);
});

test("background scheduling uses only the host-verified roster, preserves primary account and rechecks before delegate tools", async () => {
  const delegate = { id: "code-account", name: "Code", type: "codex", baseUrl: "https://coder.example/v1", apiKey: "host-key", requestFormat: "openai-completions",
    activeModels: ["code-model"], models: [{ id: "code-model", name: "Coder", delegationSkills: ["coding"], delegationMaxConcurrency: 1 }] };
  const role = { id: "code-role", name: "Coder", description: "Code", prompt: "Inspect and deliver", enabled: true, modelValue: "code-account::code-model", requiredSkills: ["coding"] };
  const f = setup({ schedulingSnapshot: { intelligentSchedulingEnabled: true, delegationProviders: [delegate], system: { executionMode: "agent", workdir: "/accepted/workspace", subagentTemplates: [role] } } });
  await f.run();
  const runtime = f.registries[0].subagentRuntime;
  assert.ok(runtime);
  assert.equal(runtime.persistBatchReceipts, true);
  assert.equal(f.runs[0].subagentScheduler, runtime.scheduler);
  assert.equal(runtime.scheduler.executionBudget.snapshot().modelRequests.limit, 128);
  assert.equal(runtime.scheduler.executionBudget.snapshot().toolCalls.limit, 256);
  assert.equal(runtime.scheduler.executionBudget.snapshot().durable, true);
  assert.equal(runtime.scheduler.executionBudget.snapshot().includesCompaction, true);
  await runtime.scheduler.executionBudget.consume("modelRequests");
  assert.equal(runtime.scheduler.executionBudget.snapshot().modelRequests.used, 1);
  assert.equal(runtime.runtime.providerConfigId, "p");
  assert.equal(runtime.store.conversationId, "background:e");
  assert.equal(runtime.models.length, 1);
  assert.equal(runtime.models[0].value, "code-account::code-model");
  assert.equal(runtime.models[0].runtime.apiKey, "host-key");
  assert.equal(runtime.models[0].maxConcurrency, 1);
  assert.equal(runtime.templates[0].modelValue, role.modelValue);
  assert.equal(runtime.templates[0].persistInstructions, true);
  assert.ok(f.runs[0].context.systemPrompt.includes("Intelligent scheduling is enabled"));
  assert.ok(f.runs[0].context.systemPrompt.includes("AgentRoster"));
  const before = f.verifications.length;
  await f.registries[0].beforeSubagentToolCall();
  assert.equal(f.verifications.length, before + 1);
  const off = setup(); await off.run();
  assert.equal(off.registries[0].subagentRuntime, undefined);
  assert.equal(off.runs[0].subagentScheduler, undefined);
  assert.ok(!off.runs[0].context.systemPrompt.includes("Intelligent scheduling is enabled"));
});

test("missing accepted delegate roster fails before any model call", async () => {
  const f = setup({ schedulingSnapshot: { intelligentSchedulingEnabled: true } });
  await assert.rejects(f.run(), /missing its verified delegate providers/);
  assert.equal(f.runs.length, 0); assert.equal(f.registries.length, 0);
});

test("actual background runner preserves uncertain child submission for native parking before a terminal receipt", async () => {
  const failed = { role: "toolResult", toolCallId: "operation", toolName: "BackgroundTask", isError: true, timestamp: 11, content: [{ type: "text", text: "Child acceptance ACK lost" }], details: { outcomeUncertain: true } };
  const f = setup({ toolResult: failed, toolArguments: { action: "submit", name: "Website", prompt: "Create usable files" } });
  const backgroundContext = { rootRequestId: "root", requestId: "parent", hostIds: ["current"] };
  await assert.rejects(f.run(true, { backgroundContext }), error => error.name === "BackgroundChildLaunchPending" && error.receipt.toolName === "BackgroundTask");
  assert.equal(f.toolInvocations.length, 1); assert.deepEqual(f.operations.map(entry => entry.phase), ["intent"]);
});

test("accepted cloud failure propagates a recoverable native parking request without freezing a failed receipt or losing the model tail", async () => {
  for (const cloudRecoveryFails of [false, true]) {
    const failure = { role: "toolResult", toolCallId: "operation", toolName: "CloudTaskManager", isError: true, timestamp: 11,
      content: [{ type: "text", text: "Original dispatch response was lost" }] };
    const args = { action: "start", runner: "ubuntu-latest", script: "actual work" };
    const f = setup({ toolResult: failure, toolArguments: args, cloudRecoveryFails }); f.selectPeer();
    await assert.rejects(f.run(), error => {
      assert.equal(error.name, "BackgroundCloudLaunchPending");
      assert.equal(error.receipt.toolCallId, "operation"); assert.equal(error.receipt.details.outcomeUncertain, true);
      assert.match(error.receipt.content[0].text, /Original dispatch/); return true;
    });
    assert.equal(f.runs.length, 1); assert.equal(f.operations.filter(op => op.phase === "receipt").length, 0);
    assert.deepEqual(f.operations.find(op => op.phase === "native-cloud-reconcile").args, { execution_id: "e", call_id: "operation", lease });
    const tail = f.checkpoints.at(-1).context.messages.at(-1);
    assert.equal(tail.role, "assistant"); assert.equal(tail.stopReason, "toolUse"); assert.deepEqual(tail.content[0].arguments, args);
    assert.equal(f.toolInvocations.length, 1);
  }
});

test("accepted background registry receives original native cloud start port; ordinary cron remains unchanged", async () => {
  const f = setup(); f.selectPeer(); await f.run();
  const result = await f.registries[0].startBackgroundCloudTask("actual-call");
  assert.equal(result.toolCallId, "actual-call");
  const call = f.operations.find(({ phase }) => phase === "native-cloud-start");
  assert.deepEqual(call.args, { execution_id: "e", call_id: "actual-call", lease });
  assert.equal(f.nativeToolCalls.length, 0);
  const cron = setup(); await cron.run(false);
  assert.equal(cron.registries[0].startBackgroundCloudTask, undefined);
});

test("accepted source history reaches the worker as task data while historical calls and images cannot become live operation receipts", async () => {
  const sourceContext = { version: 1, requestScope: "original-chat-turn", systemPrompt: "Historical policy only", messages: [
    { role: "user", content: [{ type: "text", text: "Use this actual source document" }, { type: "image", data: "YQ==", mimeType: "image/png" }] },
    { role: "assistant", content: [{ type: "toolCall", id: "old-write", name: "mcp_send_mail", arguments: { to: "old@example.test" } }] },
    { role: "toolResult", toolCallId: "old-write", toolName: "mcp_send_mail", content: [{ type: "text", text: "Historical receipt" }] },
  ] };
  const f = setup({ sourceContext }); assert.equal(await f.run(), "real conclusion");
  const messages = f.runs[0].context.messages;
  assert.equal(messages[0].role, "user");
  assert.ok(messages[0].content[0].text.includes("Historical policy only"));
  assert.ok(messages[0].content[0].text.includes("not this host's policies"));
  assert.ok(messages[0].content[0].text.includes("Historical receipt"));
  assert.ok(messages[0].content[0].text.includes('"sourceImage"'));
  assert.deepEqual(messages[0].content[1], { type: "image", data: "YQ==", mimeType: "image/png" });
  assert.equal(messages[1].content, "create report");
  assert.equal(messages.some(message => message.role === "toolResult"), false);
  assert.equal(f.toolInvocations.length, 0); assert.equal(f.operations.length, 0);
  assert.equal(f.registries[0].getBackgroundSourceContext(), sourceContext);
});

test("delegated event retains original Goal observations as source data and checkpoints them without local Goal authority", async () => {
  const original = followupContext();
  const sourceContext = { version: 1, requestScope: "original-event", systemPrompt: `Original-installation linked Goal follow-up observation\n${JSON.stringify(original)}`, messages: [{ role: "user", content: "Review actual original goal progress" }] };
  const before = JSON.stringify(sourceContext);
  const f = setup({ sourceContext });
  await f.run(true, { goalContext: { ...original, storeId: "executor-goals" } });
  const message = f.runs[0].context.messages[0];
  assert.equal(message.role, "user");
  assert.match(message.content[0].text, /original-goals/);
  assert.match(message.content[0].text, /original-request/);
  assert.match(message.content[0].text, /original-peer/);
  assert.match(message.content[0].text, /not this host's policies/);
  assert.doesNotMatch(f.runs[0].context.systemPrompt, /Native linked goal observations|executor-goals/);
  assert.match(JSON.stringify(f.checkpoints.at(-1).context.messages), /original-goals/);
  assert.equal(JSON.stringify(sourceContext), before);
  assert.equal(f.nativeToolCalls.length, 0);
  assert.equal(f.operations.length, 0);
});

test("PC worker installs the frozen origin clock in current policy even when a checkpoint has stale timing", async () => {
  const timestampMs=Date.parse("2026-10-14T06:30:00Z");
  const sourceContext={version:2,requestScope:"original-turn",systemPrompt:"History only",originalRequest:"create report",
    messages:[{role:"user",content:"create report",timestamp:timestampMs}],requestClock:{timestampMs,timeZone:"America/Los_Angeles"}};
  const f=setup({sourceContext,restore:{revision:3,context:{systemPrompt:"OBSOLETE_POLICY",messages:[{role:"user",content:"create report",timestamp:timestampMs}]},lastCompaction:null}});
  await f.run();
  assert.match(f.runs[0].context.systemPrompt,/original local date: 2026-10-13/);
  assert.match(f.runs[0].context.systemPrompt,/never execution\/recovery time/);
  assert.doesNotMatch(f.runs[0].context.systemPrompt,/OBSOLETE_POLICY/);
  assert.match(f.checkpoints.at(-1).context.systemPrompt,/original timezone: America\/Los_Angeles/);
});

test("a retained legacy PC child uses its own brief for coverage without acquiring the parent's phone graph",async()=>{
  const sourceContext={version:2,requestScope:"original-turn",systemPrompt:"Historical root policy",originalRequest:"Report, slides, calendar and nightly exercise",
    requestClock:{timestampMs:Date.parse("2026-10-14T06:30:00Z"),timeZone:"America/Los_Angeles"},
    messages:[{role:"user",content:"Root document references"}],routing:{version:1,initiatingHostId:"11111111-1111-4111-8111-111111111111",
      branches:[{id:"phone",requirement:"Schedule on original phone",dependsOn:[],locality:"initiating-device"}]}};
  const before=JSON.stringify(sourceContext),f=setup({sourceContext});
  await f.run(true,{backgroundContext:{rootRequestId:"root",requestId:"child",hostIds:["parent-pc","child-pc"]}});
  const effective=f.registries[0].getBackgroundSourceContext();
  assert.equal(effective.originalRequest,"create report");assert.equal(effective.routing,undefined);
  assert.equal(effective.requestScope,"delegated-task/child");assert.deepEqual(effective.requestClock,sourceContext.requestClock);
  assert.match(f.runs[0].context.systemPrompt,/Plan and verify the exact accepted brief only/);
  assert.match(f.runs[0].context.systemPrompt,/Original-device grants do not transfer/);
  assert.match(f.runs[0].context.messages[0].content[0].text,/Report, slides, calendar and nightly exercise/);
  assert.equal(JSON.stringify(sourceContext),before);
});

test("legacy private model children without a source clock cannot invent one from child acceptance or recovery time",async()=>{
  const f=setup();await f.run(true,{backgroundContext:{rootRequestId:"root",requestId:"model-child",hostIds:["same-pc"]}});
  assert.match(f.runs[0].context.systemPrompt,/original request clock was not retained/);
  assert.match(f.runs[0].context.systemPrompt,/later child acceptance time/);
  assert.match(f.runs[0].context.systemPrompt,/missing origin date\/timezone/);
  assert.equal(f.registries[0].getBackgroundSourceContext(),undefined);
});

test("worker keeps a thrown read as failed evidence and continues to an actually readable input", async () => {
  const f=setup({invokeTool:call=>{
    if(call.arguments.path==="missing.txt")throw new Error("Input does not exist at this path");
    return {role:"toolResult",toolCallId:call.id,toolName:call.name,isError:false,timestamp:20,content:[{type:"text",text:"Actual accepted document"}]};
  },runTools:async params=>{
    const emitted=[];
    for(const [id,path] of [["read-missing","missing.txt"],["read-accepted","accepted.txt"]]) {
      const call={id,name:"Read",arguments:{path}};
      const assistant={role:"assistant",stopReason:"toolUse",content:[{type:"toolCall",...call}],timestamp:10};
      params.onAssistantMessage(assistant);
      const result=await params.executeToolCall(call,params.signal);params.onToolResult(call,result);emitted.push(assistant,result);
      assert.equal(result.isError,path==="missing.txt");assert.equal(params.signal.aborted,false);
      await params.onBeforeNextTurn({runtimeContext:{...params.context,messages:[...params.context.messages,...emitted]}});
    }
    const assistant={role:"assistant",content:[{type:"text",text:"Read the actual accepted input"}],timestamp:100};
    params.onAssistantMessage(assistant);return {assistant,messages:[...params.context.messages,...emitted,assistant]};
  }});
  assert.equal(await f.run(),"Read the actual accepted input");
  assert.deepEqual(f.toolInvocations.map(call=>call.arguments.path),["missing.txt","accepted.txt"]);
  const receipts=f.operations.filter(operation=>operation.phase==="receipt").map(operation=>operation.input.result);
  assert.equal(receipts.length,2);assert.equal(receipts[0].isError,true);assert.equal(receipts[1].isError,false);
  assert.match(f.checkpoints.at(-1).context.messages.find(message=>message.role==="toolResult"&&message.toolCallId==="read-missing").content[0].text,/Input does not exist/);
});

test("missing or invalid accepted source history stops before registry, checkpoints, tools and model without fabricating a shortened request", async () => {
  for (const options of [{ sourceFails: true }, { sourceContext: { version: 1, requestScope: "original", systemPrompt: "", messages: [{ role: "assistant", content: [{ type: "toolCall", id: "pending", name: "mcp_send_mail" }] }] } }]) {
    const f = setup(options); await assert.rejects(f.run(), /source conversation|unfinished tool calls/i);
    assert.equal(f.runs.length, 0); assert.equal(f.registries.length, 0); assert.equal(f.checkpoints.length, 0); assert.equal(f.operations.length, 0);
  }
});

test("background executor installs the acknowledged compacted context and persists its actual final messages", async () => {
  const f = setup({ modelConfig: { contextWindow: 32000, maxOutputToken: 4096 }, toolResult: {
    role: "toolResult", toolName: "Read", toolCallId: "operation", isError: false, timestamp: 20,
    content: [{ type: "text", text: "evidence ".repeat(13000) }],
  } });
  assert.equal(await f.run(), "real conclusion");
  assert.equal(f.compactions.length, 1);
  assert.ok(f.summaries.length > 1, "all large tool evidence is summarized before the one checkpoint commit");
  assert.ok(f.summaries.slice(1).every(params => JSON.parse(params.context.messages[0].content).previous_summary));
  assert.equal(f.operations.length, 2);
  assert.equal(f.compactions[0].sourceRevision, 5);
  assert.equal(f.checkpoints.find((checkpoint) => checkpoint.revision === 5).context.messages.at(-1).toolCallId, "operation");
  const replacement = f.compactions[0].context;
  assert.equal(replacement.messages[0].content, "create report");
  assert.match(replacement.systemPrompt, /No report file has yet been created/);
  assert.deepEqual(f.contextOverrides[0].emittedMessages, []);
  assert.deepEqual(f.contextOverrides[0].context.messages, replacement.messages);
  const final = f.checkpoints.at(-1);
  assert.equal(final.context.systemPrompt, replacement.systemPrompt);
  assert.equal(final.context.messages[0].content, "create report");
  assert.equal(final.context.messages.at(-1).content[0].text, "real conclusion");
  assert.equal(final.revision, f.compactions[0].sourceRevision + 3);
});

test("background summarization failure keeps completed receipts and does not continue the model loop", async () => {
  const f = setup({ summaryFails: true, modelConfig: { contextWindow: 32000, maxOutputToken: 4096 }, toolResult: {
    role: "toolResult", toolName: "Read", toolCallId: "operation", isError: false, timestamp: 20,
    content: [{ type: "text", text: "evidence ".repeat(13000) }],
  } });
  await assert.rejects(f.run(), /summary service unavailable/);
  assert.equal(f.compactions.length, 0); assert.equal(f.contextOverrides.length, 0);
  assert.equal(f.operations.at(-1).phase, "receipt");
  assert.equal(f.checkpoints.at(-1).context.messages.at(-1).toolCallId, "operation");
});

test("background model uses the native verified provider rather than a stale settings load", async () => {
  const fixture = setup({ provider: { authMode: "oauth-managed", oauthAccountId: "stale-account" },
    verifiedProvider: { oauthAccountId: "accepted-account", baseUrl: "https://accepted.example" } });
  await fixture.run();
  assert.equal(fixture.runs[0].runtime.oauthAccountId, "accepted-account");
  assert.equal(fixture.runs[0].runtime.baseUrl, "https://accepted.example");
  assert.deepEqual(fixture.verifications, ["e", "e"]);
});

test("revoked acceptance or malformed native snapshot stops before registry, inputs and model", async () => {
  for (const option of [{ verificationFailsAt: 1 }, { malformedSnapshot: true }]) {
    const fixture = setup(option);
    await assert.rejects(fixture.run(), /permissions changed|does not match/);
    assert.deepEqual(fixture.registries, []);
    assert.deepEqual(fixture.preparations, []);
    assert.deepEqual(fixture.runs, []);
  }
});

test("configuration changed during preparation stops before the first model call", async () => {
  const fixture = setup({ verificationFailsAt: 2 });
  await assert.rejects(fixture.run(), /permissions changed/);
  assert.equal(fixture.checkpoints.length, 2);
  assert.deepEqual(fixture.runs, []);
  assert.deepEqual(fixture.toolInvocations, []);
});

test("native configuration denial prevents tool execution and does not invent an operation receipt", async () => {
  const fixture = setup({ intentDenied: true, toolResult: { role: "toolResult", toolName: "mcp_send_mail", toolCallId: "operation",
    content: [{ type: "text", text: "sent" }], isError: false, timestamp: 20 } });
  await assert.rejects(fixture.run(), /configuration binding rejected/);
  assert.deepEqual(fixture.toolInvocations, []);
  assert.deepEqual(fixture.operations, []);
  assert.equal(fixture.runs[0].signal.aborted, true);
});

test("permission changes after a completed tool stop the next model turn while retaining its receipt", async () => {
  const fixture = setup({ verificationFailsAt: 3, toolResult: { role: "toolResult", toolName: "mcp_send_mail", toolCallId: "operation",
    content: [{ type: "text", text: "sent" }], isError: false, timestamp: 20 } });
  await assert.rejects(fixture.run(), /permissions changed/);
  assert.equal(fixture.toolInvocations.length, 1);
  assert.deepEqual(fixture.operations.map((entry) => entry.phase), ["intent", "receipt"]);
});

test("only background queue context enables peer handoff, preserving legacy execution without resetting ancestry", async () => {
  const fixture = setup();
  const context = { rootRequestId: "root", requestId: "task", hostIds: ["first", "current"] };
  await fixture.run(true, { backgroundContext: context });
  assert.equal(fixture.registries[0].backgroundTaskDelegation, true);
  assert.deepEqual(fixture.registries[0].backgroundTaskContext, context);
  assert.deepEqual(fixture.registries[0].backgroundTaskLease, lease);
  assert.equal(typeof fixture.registries[0].readOfficeArtifactImage,"function");
  await fixture.run(true);
  assert.equal(fixture.registries[1].backgroundTaskDelegation, false);
  await fixture.run(false, { backgroundContext: context });
  assert.equal(fixture.registries[2].backgroundTaskDelegation, false);
});

test("background execution uses pinned workspace memory and offers real artifact publication", async () => {
  const fixture = setup();
  assert.equal(await fixture.run(), "real conclusion");
  assert.deepEqual(fixture.memoryWorkdirs, ["/accepted/workspace"]);
  assert.match(fixture.runs[0].context.systemPrompt, /Memory Index/);
  assert.equal(fixture.runs[0].runtime.reasoning, "high");
  assert.equal(fixture.runs[0].sessionId, "e");
  assert.ok(fixture.runs[0].tools.some((tool) => tool.name === "PublishBackgroundArtifact"));
  assert.ok(!fixture.runs[0].tools.some((tool) => tool.name === "BackgroundTask"));
  assert.equal(fixture.checkpoints[0].revision, 1);
  assert.equal(fixture.checkpoints.at(-1).context.messages.at(-1).content[0].text, "real conclusion");
  assert.equal(JSON.stringify(fixture.runs[0].context).includes(lease.token), false);
  assert.equal(JSON.stringify(fixture.runs[0].tools).includes(lease.token), false);
});

test("ordinary cron keeps its existing scope and cannot publish another task's artifacts", async () => {
  const fixture = setup();
  await fixture.run(false);
  assert.equal(fixture.registries[0].readOfficeArtifactImage, undefined);
  assert.equal(fixture.registries[0].imageGeneration, undefined);
  assert.deepEqual(fixture.memoryWorkdirs, ["/accepted/workspace"]);
  assert.equal(fixture.memoryRequests[0].prompt, "create report");
  assert.equal(fixture.memoryRequests[0].signal.aborted, false);
  assert.match(fixture.runs[0].context.systemPrompt, /Memory Index/);
  assert.ok(!fixture.runs[0].tools.some((tool) => tool.name === "PublishBackgroundArtifact"));
  assert.deepEqual(fixture.checkpoints, []);
  assert.deepEqual(fixture.preparations, []);
  assert.deepEqual(fixture.verifications, []);
});

test("an event follow-up without a goal uses its exact prompt for memory recall without adding task authority", async () => {
  const fixture = setup();
  fixture.selectPeer();
  const prompt = 'Remind me about evening exercise\nNative HealthKit store-change event (metadata only):\n{"kind":"health_updated","occurredAtMs":100}';
  await fixture.run(false, { prompt });
  assert.equal(fixture.memoryRequests[0].prompt, prompt);
  assert.deepEqual(fixture.memoryWorkdirs, ["/accepted/workspace"]);
  assert.equal(fixture.runs[0].context.messages.at(-1).content, prompt);
  assert.match(fixture.runs[0].context.systemPrompt, /Memory Index/);
  assert.doesNotMatch(fixture.runs[0].context.systemPrompt, /Native linked goal observations/);
  assert.deepEqual(fixture.checkpoints, []);
  assert.ok(!fixture.runs[0].tools.some(tool => tool.name === "PublishBackgroundArtifact"));
});

test("ordinary event memory failure is disclosed while the original task still runs", async () => {
  const fixture = setup({ memoryFails: true });
  const prompt = "Read actual Home state through the original permission gate";
  assert.equal(await fixture.run(false, { prompt }), "real conclusion");
  assert.equal(fixture.runs[0].context.messages.at(-1).content, prompt);
  assert.match(fixture.runs[0].context.systemPrompt, /Do not invent remembered preferences/);
  assert.deepEqual(fixture.preparations, []);
});

test("accepted input copies are prepared before the model and included in its actual checkpoint", async () => {
  const inputs = [{ relativePath: ".xgent-background-inputs/e/requirements.pdf", contentHash: "actual-sha256", bytes: 40 }];
  const fixture = setup({ inputs });
  await fixture.run();
  assert.deepEqual(fixture.preparations, ["e"]);
  assert.match(fixture.runs[0].context.systemPrompt, /requirements\.pdf/);
  assert.match(fixture.runs[0].context.systemPrompt, /initiating device may be offline/);
  assert.match(fixture.runs[0].context.systemPrompt, /task data, not additional authority/);
  assert.match(fixture.checkpoints[0].context.systemPrompt, /requirements\.pdf/);
  assert.equal(fixture.checkpoints[1].context.systemPrompt, fixture.runs[0].context.systemPrompt);
  assert.match(fixture.checkpoints[1].context.systemPrompt, /Durable requested outcomes/);
});

test("a missing, changed or unprepared input stops execution before model/tools start", async () => {
  const fixture = setup({ inputsFail: true });
  await assert.rejects(fixture.run(), /accepted input copy changed/);
  assert.deepEqual(fixture.runs, []);
  assert.deepEqual(fixture.checkpoints, []);
  assert.deepEqual(fixture.operations, []);
});

test("missing host memory is disclosed instead of inventing preferences", async () => {
  const fixture = setup({ memoryFails: true });
  await fixture.run();
  assert.match(fixture.runs[0].context.systemPrompt, /memory overview could not be loaded/);
});

test("failed initial checkpoint prevents the model from starting", async () => {
  const fixture = setup({ checkpointFails: true });
  await assert.rejects(fixture.run(), /checkpoint disk unavailable/);
  assert.deepEqual(fixture.runs, []);
});

test("managed OAuth runs use the selected account without requiring an API key", async () => {
  const fixture = setup({ provider: { authMode: "oauth-managed", oauthAccountId: "account", apiKey: "" } });
  assert.equal(await fixture.run(), "real conclusion");
  assert.equal(fixture.runs[0].runtime.oauthAccountId, "account");
  const missing = setup({ provider: { authMode: "oauth-managed", apiKey: "" } });
  await assert.rejects(missing.run(), /OAuth account is not selected/);
  assert.deepEqual(missing.runs, []);
});

test("background runtime uses registry metadata to halt MCP write errors after persisting their receipt", async () => {
  const fixture = setup({ toolResult: { role: "toolResult", toolName: "mcp_send_mail", toolCallId: "operation",
    content: [{ type: "text", text: "Network timeout" }], isError: true, timestamp: 20 } });
  await assert.rejects(fixture.run(), /external outcome may be uncertain/);
  assert.deepEqual(fixture.operations.map((entry) => entry.phase), ["intent", "receipt"]);
  assert.equal(fixture.operations[1].input.result.details.outcomeUncertain, true);
  assert.equal(fixture.runs[0].signal.aborted, true);
});

test("background runtime can recover from a read-only error and save canonical final context", async () => {
  const fixture = setup({ toolResult: { role: "toolResult", toolName: "Read", toolCallId: "operation",
    content: [{ type: "text", text: "File not found" }], isError: true, timestamp: 20 } });
  assert.equal(await fixture.run(), "real conclusion");
  assert.equal(fixture.operations[1].input.result.details, undefined);
  assert.equal(fixture.checkpoints.at(-1).context.messages.length, 4);
  assert.equal(fixture.runs[0].signal.aborted, false);
});

const recoveredUser = { role: "user", content: "create report", timestamp: 1 };
const recoveredCall = { type: "toolCall", id: "saved-mail", name: "mcp_send_mail", arguments: {} };
const recoveredAssistant = { role: "assistant", content: [recoveredCall], stopReason: "toolUse", timestamp: 2 };
const recoveredResult = { role: "toolResult", toolCallId: recoveredCall.id, toolName: recoveredCall.name,
  content: [{ type: "text", text: "already sent receipt 42" }], isError: false, timestamp: 3 };
const recovered = (messages = [recoveredUser, recoveredAssistant]) => ({ revision: 40,
  context: { systemPrompt: "Accepted policy and earlier evidence", messages }, lastCompaction: null });

test("restart restores a native returned receipt before pi continuation without repeating the external write", async () => {
  const f = setup({ restore: recovered(), restoredReceipt: recoveredResult });
  assert.equal(await f.run(), "real conclusion");
  assert.deepEqual(f.toolInvocations, []);
  assert.deepEqual(f.operations.map((entry) => entry.phase), ["intent"]);
  assert.equal(f.operations[0].input.callId, "saved-mail");
  assert.equal(f.checkpoints[0].revision, 41);
  assert.equal(f.runs[0].context.messages.at(-1).toolCallId, "saved-mail");
  assert.match(f.runs[0].context.systemPrompt, /^You are running a scheduled Auto Prompt task in Xgent/);
  assert.doesNotMatch(f.runs[0].context.systemPrompt, /Accepted policy and earlier evidence/);
  assert.equal(f.checkpoints.at(-1).revision, 46);
});

test("restart starts a persisted tail call with no intent once and saves its receipt before the model", async () => {
  const f = setup({ restore: recovered(), toolResult: recoveredResult, emitToolTurn: false });
  assert.equal(await f.run(), "real conclusion");
  assert.equal(f.toolInvocations.length, 1);
  assert.equal(f.toolInvocations[0].id, "saved-mail");
  assert.equal(f.operations[1].phase, "receipt");
  assert.equal(f.operations[1].input.callId, "saved-mail");
  assert.equal(f.runs[0].context.messages.at(-1).toolCallId, "saved-mail");
});

test("unknown persisted outcomes stop recovery before fresh model or tool calls", async () => {
  for (const option of [{ restoreFails: true }, { restore: recovered(), uncertainIntent: true }]) {
    const f = setup(option);
    await assert.rejects(f.run(), /unknown|external outcome is unknown/);
    assert.deepEqual(f.runs, []);
    assert.deepEqual(f.toolInvocations, []);
  }
});

test("restart after the final checkpoint returns the saved conclusion without another model request", async () => {
  const final = { role: "assistant", api: "openai-completions", stopReason: "stop", timestamp: 4, content: [{ type: "text", text: "persisted conclusion" }] };
  const f = setup({ restore: recovered([recoveredUser, final]) });
  assert.equal(await f.run(), "persisted conclusion");
  assert.deepEqual(f.runs, []); assert.deepEqual(f.toolInvocations, []);
  assert.equal(f.checkpoints[0].revision, 41);
});

const pendingReport = { verified: false, branches: [{ branch: { id: "report", title: "Report", requirement: "Actual text report", dependsOn: [], criteria: [{ kind: "answer" }] }, state: "pending", evidence: null, reason: null }] };

const compoundProgressState = () => ({ verified:false, branches:["documents","plan","slides","site","calendar","reminder"].map(id=>({
  branch:{id,title:id,requirement:`Deliver ${id}`,dependsOn:[],criteria:[{kind:"answer"}]},state:"pending",evidence:null,reason:null,
})) });
function finishProgressTurn(params,text="retained progress") {
  const assistant={role:"assistant",stopReason:"stop",content:[{type:"text",text}],timestamp:100};
  params.onAssistantMessage?.(assistant);
  return {assistant,messages:[...params.context.messages,assistant]};
}

test("compound document/plan/slides workflow parks dependency descendants, resumes retained work and joins phone completion", async () => {
  const state = compoundProgressState();
  state.branches = state.branches.filter(item => item.branch.id !== "site");
  state.branches.find(item => item.branch.id === "plan").branch.dependsOn = ["documents"];
  state.branches.find(item => item.branch.id === "slides").branch.dependsOn = ["plan"];
  for (const id of ["documents", "calendar"]) {
    const item = state.branches.find(item => item.branch.id === id);
    item.state = "waiting"; item.reason = id === "documents" ? "Original PC child is running" : "Original phone is offline";
  }
  const first = setup({ nativeOutcome: state, emitToolTurn: false, runTools: async params => {
    const reminder = state.branches.find(item => item.branch.id === "reminder");
    reminder.state = "verified"; reminder.evidence = { artifactIds: [], callIds: ["retained-reminder-receipt"], answer: null };
    return finishProgressTurn(params, "Recurring reminder retained; waiting for original child and phone.");
  }});
  await assert.rejects(first.run(), error => error.name === "BackgroundTaskWaiting" && /prerequisite/.test(error.reason));
  assert.equal(first.runs.length, 1);
  assert.equal(state.branches.find(item => item.branch.id === "slides").state, "pending");
  const saved = first.checkpoints.at(-1);
  assert.equal(saved.context.messages.at(-1).stopReason, "stop");
  const documents = state.branches.find(item => item.branch.id === "documents");
  documents.state = "verified"; documents.evidence = { artifactIds: ["original-documents-snapshot"], callIds: [], answer: null };
  let turns = 0;
  const second = setup({ nativeOutcome: state, emitToolTurn: false, restore: { revision: saved.revision, context: saved.context, lastCompaction: null }, runTools: async params => {
    const id = ["plan", "slides"][turns++], item = state.branches.find(item => item.branch.id === id);
    assert.ok(params.context.messages.some(message => message.role === "assistant" && message.content?.[0]?.text?.includes("Recurring reminder retained")));
    item.state = "verified"; item.evidence = { artifactIds: [`retained-${id}-file`], callIds: [], answer: null };
    return finishProgressTurn(params, `${id} retained; original phone still waiting.`);
  }});
  await assert.rejects(second.run(), error => error.name === "BackgroundTaskWaiting" && /calendar/.test(error.reason));
  assert.equal(turns, 2); assert.equal(second.toolInvocations.length, 0);
  assert.deepEqual(state.branches.find(item => item.branch.id === "reminder").evidence.callIds, ["retained-reminder-receipt"]);
  const calendar = state.branches.find(item => item.branch.id === "calendar");
  calendar.state = "verified"; calendar.evidence = { artifactIds: [], callIds: ["original-phone-calendar-receipt"], answer: null };
  state.verified = true;
  const last = second.checkpoints.at(-1);
  const joined = setup({ nativeOutcome: state, restore: { revision: last.revision, context: last.context, conclusion: last.context.messages.at(-1), lastCompaction: null } });
  await joined.run();
  assert.equal(joined.runs.length, 0); assert.equal(joined.toolInvocations.length, 0);
  assert.ok(state.branches.every(item => item.state === "verified"));
  // Host/child/model/connector outcomes are fixtures, not real device or media acceptance.
});

test("native compound branch progress continues beyond three conclusions on the same model/task/checkpoint",async()=>{
  const state=compoundProgressState();let turns=0;
  const f=setup({nativeOutcome:state,emitToolTurn:false,runTools:async params=>{
    const completed=state.branches[turns++];completed.state="verified";completed.evidence={artifactIds:[],callIds:[],answer:`Actual native ${completed.branch.id} result`};
    state.verified=state.branches.every(branch=>branch.state==="verified");
    const next=await params.onBeforeNextTurn?.({runtimeContext:params.context});
    return finishProgressTurn({...params,context:next?.context??params.context});
  }});
  const result=await f.run();
  assert.equal(f.runs.length,6);assert.equal(turns,6);
  for(const params of f.runs){assert.equal(params.sessionId,"e");assert.equal(params.providerId,"openai");assert.equal(params.model,"model");}
  assert.equal(f.registries.length,1);
  assert.equal(f.checkpoints.at(-1).context.messages.filter(message=>message.role==="assistant").length,6);
  assert.equal(f.runs.at(-1).context.messages.filter(message=>message.role==="user"&&message.content==="create report").length,1);
  for(const branch of state.branches)assert.ok(result.includes(branch.evidence.answer));
});

test("old verified branches and revised evidence/prose cannot manufacture progress or evade three stalled conclusions",async()=>{
  const state=compoundProgressState();state.branches[0].state="verified";
  let turns=0;
  const f=setup({nativeOutcome:state,emitToolTurn:false,runTools:async params=>{
    turns++;state.branches[0].evidence={artifactIds:[],callIds:[],answer:`Revised existing answer ${turns}`};
    state.branches[1].reason=`Changed pending explanation ${turns}`;
    return finishProgressTurn(params,`New wording ${turns}`);
  }});
  await assert.rejects(f.run(),/three conclusions without new verified branch progress/);
  assert.equal(turns,3);assert.equal(f.runs.length,3);
  assert.equal(f.checkpoints.at(-1).context.messages.at(-1).content[0].text,"New wording 3");
});

test("a new verified branch resets consecutive stalls but regression/reverification does not grant another reset",async()=>{
  const state=compoundProgressState();let turns=0;
  const f=setup({nativeOutcome:state,emitToolTurn:false,runTools:async params=>{
    turns++;
    if(turns===3||turns===5){state.branches[0].state="verified";state.branches[0].evidence={artifactIds:[],callIds:[],answer:"Actual observed result"};}
    if(turns===4)state.branches[0].state="pending";
    return finishProgressTurn(params);
  }});
  await assert.rejects(f.run(),/three conclusions without new verified branch progress/);
  assert.equal(turns,6);
});

test("configuration rejection still stops a progressing compound task before the next model turn",async()=>{
  const state=compoundProgressState();let turns=0;
  const f=setup({nativeOutcome:state,emitToolTurn:false,verificationFailsAt:6,runTools:async params=>{
    state.branches[turns++].state="verified";
    return finishProgressTurn(params);
  }});
  await assert.rejects(f.run(),/accepted account or connector permissions changed/);
  assert.equal(f.verifications.length,6);assert.equal(turns,f.runs.length);assert.ok(turns>0&&turns<6);
});

test("a native delegate reservation refusal survives SDK error serialization and suspends the original task",async()=>{
  const id="22222222-2222-4222-8222-222222222222";let effects=0;
  const f=setup({budgetDeferral:{id},emitToolTurn:false,
    schedulingSnapshot:{intelligentSchedulingEnabled:true,delegationProviders:[]},runTools:async params=>{
      try { await params.subagentScheduler.executionBudget.consume("modelRequests"); }
      catch { throw new Error("SDK serialized the admission failure"); }
      effects++;return finishProgressTurn(params);
    }});
  await assert.rejects(f.run(),error=>error.name==="BackgroundBudgetDelegatesPending" && error.deferral.id===id);
  assert.equal(effects,0);assert.equal(f.runs.length,1);assert.equal(f.runs[0].subagentScheduler.executionBudget.snapshot().exhausted,false);
});

test("native shared lifetime budget still stops an advancing compound task before the next admitted model effect",async()=>{
  const state=compoundProgressState();let admittedTurns=0;
  const f=setup({nativeOutcome:state,emitToolTurn:false,modelRequestLimit:4,
    schedulingSnapshot:{intelligentSchedulingEnabled:true,delegationProviders:[]},runTools:async params=>{
      await params.subagentScheduler.executionBudget.consume("modelRequests");
      state.branches[admittedTurns++].state="verified";
      return finishProgressTurn(params);
    }});
  await assert.rejects(f.run(),/Shared execution budget exhausted/);
  assert.equal(admittedTurns,4);assert.equal(f.runs.length,5);
  assert.equal(state.branches.filter(branch=>branch.state==="verified").length,4);
  const budget=f.runs.at(-1).subagentScheduler.executionBudget.snapshot();
  assert.equal(budget.modelRequests.used,4);assert.equal(budget.modelRequests.limit,4);assert.equal(budget.exhausted,true);
});

test("abort after real compound progress prevents another model request and retains the last checkpoint",async()=>{
  const state=compoundProgressState(),controller=new AbortController();let turns=0;
  const f=setup({nativeOutcome:state,emitToolTurn:false,runSignal:controller.signal,runTools:async params=>{
    state.branches[turns++].state="verified";
    if(turns===4)controller.abort(new Error("User stopped the original task"));
    return finishProgressTurn(params);
  }});
  await assert.rejects(f.run(),/User stopped the original task/);
  assert.equal(turns,4);assert.equal(f.runs.length,4);
  assert.equal(state.branches.filter(branch=>branch.state==="verified").length,4);
  const saved=f.checkpoints.at(-1).context.messages;
  assert.equal(saved.filter(message=>message.role==="assistant").length,3);
  assert.equal(saved.at(-1).role,"user");
  assert.match(saved.at(-1).content,/Native outcome checks/);
});

test("a conclusion without branch evidence triggers bounded continuation and cannot return success", async () => {
  const f = setup({ nativeOutcome: pendingReport });
  await assert.rejects(f.run(), /requirements remain unfinished.*Report/);
  assert.equal(f.runs.length, 3);
  assert.ok(f.runs[1].context.messages.some((message) => message.role === "user" && /Native outcome checks/.test(message.content)));
  assert.equal(f.checkpoints.at(-1).context.messages.at(-1).content[0].text, "real conclusion");
});

test("a real text outcome is persisted before success and its complete deliverable reaches the conclusion", async () => {
  const f = setup({ nativeOutcome: pendingReport, recordOutcome: true });
  assert.equal(await f.run(), "real conclusion\n\nReport:\nActual report text");
  assert.deepEqual(f.operations.map((entry) => entry.phase), ["intent", "outcome", "receipt"]);
  assert.equal(f.operations[1].input.executionId, "e");
  assert.equal(f.operations[1].input.evidence.answer, "Actual report text");
});

test("task-state proof denial permits correction while never treating an external write error as recoverable", async () => {
  const f = setup({ nativeOutcome: pendingReport, recordOutcome: true, outcomeDenied: true });
  await assert.rejects(f.run(), /requirements remain unfinished/);
  assert.equal(f.runs.length, 3);
  assert.ok(f.operations.filter((entry) => entry.phase === "receipt").every((entry) => entry.input.result.isError && !entry.input.result.details?.outcomeUncertain));
});

test("unavailable MCP capability is disclosed while independent tools remain executable", async () => {
  const f = setup({ mcpFailure: true }); await f.run();
  assert.equal(f.registries[0].mcpLoadFailureMode, "continue");
  assert.match(f.runs[0].context.systemPrompt, /configured MCP connectors could not load/);
  assert.doesNotMatch(f.runs[0].context.systemPrompt, /sensitive connector details/);
  const ordinary = setup(); await ordinary.run(false); assert.equal(ordinary.registries[0].mcpLoadFailureMode, "throw");
});

test("waiting branches retain their reason and completed work without spending repeated finish attempts", async () => {
  const state = { verified: false, branches: [{ ...pendingReport.branches[0], state: "waiting", reason: "calendar permission missing" }] };
  const f = setup({ nativeOutcome: state });
  await assert.rejects(f.run(), (error) => error.name === "BackgroundTaskWaiting" && /calendar permission missing/.test(error.message) && error.conclusion === "real conclusion");
  assert.equal(f.runs.length, 1);
});
