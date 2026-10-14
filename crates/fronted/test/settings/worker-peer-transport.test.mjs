import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const lease = { attempt: 1, generation: 1, token: "11111111-1111-4111-8111-111111111111" };

test("cloud waiting/probes remain on the owning native worker when the UI switches PC; browser cannot bind or wake",async()=>{
  const f=setup({selectedHost:{enabled:true,baseUrl:"http://different-pc:8080"}});
  await f.backend.recordBackgroundCloudWait("original-execution","slides","actual-start","Actual job pending",lease);
  await f.backend.probeBackgroundCloudWait("original-execution","original-wait","actual-start");
  assert.deepEqual(f.nativeCalls,[{command:"automation_background_cloud_wait",args:{execution_id:"original-execution",branch_id:"slides",call_id:"actual-start",reason:"Actual job pending",lease}},{command:"automation_background_cloud_probe",args:{execution_id:"original-execution",wait_id:"original-wait",call_id:"actual-start"}}]);
  assert.equal(f.runtimeCalls.length,0);const browser=setup({native:false});
  await assert.rejects(browser.backend.recordBackgroundCloudWait("id","slides","call","Pending",lease),/native/);await assert.rejects(browser.backend.probeBackgroundCloudWait("id","wait","call"),/native/);assert.equal(browser.nativeCalls.length,0);
});

function setup({ owners = new Map(), native = true, selectedHost = { enabled: false }, submissionReply = async () => null, reply = async (_command, args) => ({ hostId: args?.peer_id }), runtimeReply = async () => ({ local: true }) } = {}) {
  const nativeCalls = []; const runtimeCalls = [];
  const loader = createTsModuleLoader({ mocks: {
    "@tauri-apps/api/core": { async invoke(command, args) {
      nativeCalls.push({ command, args });
      if (command === "worker_peer_resolve_request") return owners.get(args.request_id) ?? null;
      if (["automation_result_submission_current", "automation_result_submission_cancel", "automation_result_submission_state"].includes(command)) return submissionReply(command, args);
      return reply(command, args);
    } },
    "@xgent/runtime": { isTauriRuntime: () => native, getLanPcCommandHostConfig: () => selectedHost, listen: async () => () => {}, async invoke(command, args) { runtimeCalls.push({ command, args }); return runtimeReply(command, args); } },
  } });
  return { backend: loader.loadModule("src/lib/automation/backend.ts").backend, nativeCalls, runtimeCalls };
}

test("native child response commands capture their original input/lease and reject browser execution", async () => {
  const f = setup({ selectedHost: { enabled: true, baseUrl: "https://other-pc" } });
  const input = { requestId: "original-task", waitId: "actual-wait", resumeId: "same-response", response: "10:00" };
  const lease = { attempt: 1, generation: 2, token: "11111111-1111-4111-8111-111111111111" };
  const sending = f.backend.resumeBackgroundChild("parent", "call", input, "child-peer", lease);
  input.response = "Changed"; lease.generation = 9;
  await sending;
  await f.backend.readBackgroundChildResumeReceipt("parent", "call", { ...lease, generation: 2 });
  assert.deepEqual(f.nativeCalls, [
    { command: "automation_background_child_resume", args: { execution_id: "parent", call_id: "call", peer_id: "child-peer",
      input: { ...input, response: "10:00" }, lease: { ...lease, generation: 2 } } },
    { command: "automation_background_child_resume_receipt", args: { execution_id: "parent", call_id: "call", lease: { ...lease, generation: 2 } } },
  ]);
  assert.equal(f.runtimeCalls.length, 0);
  const browser = setup({ native: false });
  await assert.rejects(browser.backend.resumeBackgroundChild("parent", "call", input, "child-peer", lease), /native worker/);
  await assert.rejects(browser.backend.readBackgroundChildResumeReceipt("parent", "call", lease), /native worker/);
  assert.equal(browser.nativeCalls.length, 0);
});

test("resume acceptance reads use the explicit original peer and a copied input, independent of selected PC", async () => {
  const f = setup({ selectedHost: { enabled: true, baseUrl: "https://other-pc" } });
  const input = { requestId: "original-task", waitId: "actual-wait", resumeId: "same-response", response: "10:00" };
  const reading = f.backend.readBackgroundResumeReceipt(input, "original-peer");
  input.response = "Changed after invocation";
  await reading;
  assert.deepEqual(f.nativeCalls, [{ command: "worker_peer_invoke", args: {
    peer_id: "original-peer", command: "automation_background_resume_receipt", args: {
      request_id: "original-task", input: { requestId: "original-task", waitId: "actual-wait", resumeId: "same-response", response: "10:00" },
    },
  } }]);
  assert.equal(f.runtimeCalls.length, 0);
});

test("cloud start/reconciliation use original native worker commands without selected PC or browser authority", async () => {
  const lease = { attempt: 1, generation: 2, token: "11111111-1111-4111-8111-111111111111" };
  const f = setup({ selectedHost: { enabled: true, baseUrl: "https://other-pc" } });
  await f.backend.startBackgroundCloudTask("original", "actual-call", lease);
  await f.backend.reconcileBackgroundCloudStart("original", "actual-call", lease);
  assert.deepEqual(f.nativeCalls, [
    { command: "automation_background_cloud_start", args: { execution_id: "original", call_id: "actual-call", lease } },
    { command: "automation_background_cloud_reconcile", args: { execution_id: "original", call_id: "actual-call", lease } },
  ]);
  assert.equal(f.runtimeCalls.length, 0);
  const browser = setup({ native: false });
  await assert.rejects(browser.backend.startBackgroundCloudTask("original", "actual", lease), /native/);
  await assert.rejects(browser.backend.reconcileBackgroundCloudStart("original", "actual", lease), /native/);
  assert.equal(browser.nativeCalls.length, 0);
});

test("cloud parking stays on original native worker and carries only the captured call/lease", async () => {
  const authority = { attempt: 1, generation: 2, token: "original" };
  const f = setup({ selectedHost: { enabled: true, baseUrl: "https://other-pc" } });
  await f.backend.parkUnconfirmedCloudStart("original", "call", authority);
  assert.deepEqual(f.nativeCalls, [{ command: "automation_background_cloud_park", args: { execution_id: "original", call_id: "call", lease: authority } }]);
  assert.equal(f.runtimeCalls.length, 0); await assert.rejects(setup({ native: false }).backend.parkUnconfirmedCloudStart("original", "call", authority), /native/);
});

test("interrupted cloud collector stays native without caller authority or selected peer", async () => {
  const f = setup({ selectedHost: { enabled: true, baseUrl: "https://other-pc" } });
  await f.backend.recoverInterruptedCloudLaunches();
  assert.deepEqual(f.nativeCalls, [{ command: "automation_background_cloud_recover_interrupted", args: undefined }]);
  assert.equal(f.runtimeCalls.length, 0);
  const browser = setup({ native: false });
  await assert.rejects(browser.backend.recoverInterruptedCloudLaunches(), /native/);
  assert.equal(browser.nativeCalls.length, 0);
});

test("cloud cancellation collector stays on original native worker without caller run ids or selected peer", async () => {
  const f = setup({ selectedHost: { enabled: true, baseUrl: "https://other-pc" } });
  await f.backend.reconcileCloudCancellations();
  assert.deepEqual(f.nativeCalls, [{ command: "automation_background_cloud_reconcile_cancellations", args: undefined }]);
  assert.equal(f.runtimeCalls.length, 0);
  const browser = setup({ native: false });
  await assert.rejects(browser.backend.reconcileCloudCancellations(), /native worker/);
  assert.equal(browser.nativeCalls.length, 0);
});

test("original-device handoff recovery stays on this installation and never uses a mutable selected PC", async () => {
  const f = setup({ selectedHost: { enabled: true, baseUrl: "http://changed-pc:3317" }, reply: async (command, args) => {
    assert.equal(command, "automation_result_device_branches"); assert.deepEqual(args, { entry_id: "original-entry" });
    return { version: 1, requestId: "original-request", branches: [] };
  } });
  assert.equal((await f.backend.getReceivedDeviceBranches("original-entry")).requestId, "original-request");
  assert.equal(f.nativeCalls.length, 1); assert.equal(f.runtimeCalls.length, 0);
  await assert.rejects(setup({ native: false }).backend.getReceivedDeviceBranches("original-entry"), /native installation/);
});

test("peer task operations use the native client registry without the mutable global command host", async () => {
  const { backend, nativeCalls, runtimeCalls } = setup();
  await backend.submitBackgroundTask({ requestId: "request", workdir: "/host" }, "mac");
  await backend.getBackgroundTask("request", "mac");
  await backend.cancelBackgroundTask("request", "windows");
  await backend.listBackgroundTasks(20, "windows");
  await backend.listBackgroundOperations("request", 10, 5, "mac");
  await backend.readBackgroundArtifact("request", "artifact", "mac");
  assert.equal(runtimeCalls.length, 0);
  assert.equal(nativeCalls[0].command, "automation_result_submission_submit");
  assert.deepEqual(nativeCalls[0].args, { input: { requestId: "request", workdir: "/host" }, origin: null, peer_id: "mac", base_url: null });
  const peers = nativeCalls.filter(c => c.command === "worker_peer_invoke");
  assert.deepEqual(peers.map((c) => c.args.peer_id), ["mac", "windows", "windows", "mac", "mac"]);
  assert.equal(peers[3].args.args.cursor, 10); assert.equal(peers[3].args.args.limit, 5);
});

test("native root intake captures selected endpoint and actual origin before delegating transport to native persistence", async () => {
  const f = setup({ selectedHost: { enabled: true, baseUrl: "http://original-pc:8080" } });
  const input = { requestId: "original", files: [{ contentBase64: "Ynl0ZXM=" }] }, origin = { requestScope: "actual-conversation" };
  await f.backend.submitBackgroundTask(input, undefined, undefined, origin);
  assert.deepEqual(f.nativeCalls, [{ command: "automation_result_submission_submit", args: { input, origin, peer_id: null, base_url: "http://original-pc:8080" } }]);
  assert.deepEqual(f.runtimeCalls, []);
});

test("owned submission recovery failure cannot fall through to mutable hosts or resend a task", async () => {
  const f = setup({ submissionReply: async () => { throw new Error("Original acceptance uncertain"); } });
  await assert.rejects(f.backend.getBackgroundTask("original"), /uncertain/);
  await assert.rejects(f.backend.cancelBackgroundTask("original"), /uncertain/);
  assert.deepEqual(f.nativeCalls.map(c => c.command), ["automation_result_submission_current", "automation_result_submission_cancel"]);
  assert.deepEqual(f.runtimeCalls, []);
  const accepted = { hostId: "original-pc", requestId: "original", run: { state: "pending" } };
  const actual = setup({ submissionReply: async () => accepted });
  assert.equal(await actual.backend.getBackgroundTask("original"), accepted);
  assert.deepEqual(actual.runtimeCalls, []);
});

test("browser legacy submissions retain existing transport without native deferred authority", async () => {
  const f = setup({ native: false }); const input = { requestId: "legacy" };
  await f.backend.submitBackgroundTask(input);
  assert.deepEqual(f.nativeCalls, []);
  assert.deepEqual(f.runtimeCalls, [{ command: "automation_background_submit", args: { input } }]);
});

test("explicitly routed local intake cannot be sent to the selected global PC", async () => {
  const f = setup({ selectedHost: { enabled: true, baseUrl: "http://selected-other-pc:8080" } });
  await f.backend.submitBackgroundTask({ requestId: "local" }, undefined, undefined, undefined, true);
  assert.equal(f.nativeCalls[0].command, "automation_result_submission_submit"); assert.equal(f.nativeCalls[0].args.base_url, null); assert.equal(f.runtimeCalls.length, 0);
});

test("inbox reception, reading and ACK stay on this native device even with a selected remote desktop", async () => {
  const f = setup({ runtimeReply: async () => { throw new Error("Wrong mutable host"); } });
  await f.backend.syncBackgroundInbox(); await f.backend.listBackgroundInbox(12, 4, true);
  await f.backend.readBackgroundInbox("entry", 16384); await f.backend.acknowledgeBackgroundInbox("entry");
  await f.backend.readReceivedBackgroundArtifact("entry", "artifact");
  await f.backend.getReceivedBackgroundTask("entry"); await f.backend.getReceivedResponseState("entry"); await f.backend.resumeReceivedBackgroundTask("entry", "Actual input");
  assert.equal(f.runtimeCalls.length, 0);
  assert.deepEqual(f.nativeCalls.map((call) => call.command), ["automation_result_sync", "automation_result_list", "automation_result_read", "automation_result_ack", "automation_result_artifact", "automation_result_current", "automation_result_response_state", "automation_result_resume"]);
  assert.deepEqual(f.nativeCalls[1].args, { cursor: 12, limit: 4, unread_only: true });
  assert.deepEqual(f.nativeCalls[2].args, { entry_id: "entry", offset: 16384 });
  assert.deepEqual(f.nativeCalls[4].args, { entry_id: "entry", artifact_id: "artifact" });
  assert.deepEqual(f.nativeCalls[7].args, { entry_id: "entry", response: "Actual input" });
  const browser = setup({ native: false }); await assert.rejects(browser.backend.syncBackgroundInbox(), /native app/);
  await assert.rejects(browser.backend.readBackgroundInbox("entry"), /native device/); assert.equal(browser.nativeCalls.length, 0);
  await assert.rejects(browser.backend.readReceivedBackgroundArtifact("entry", "artifact"), /native device/); assert.equal(browser.nativeCalls.length, 0);
  await assert.rejects(browser.backend.resumeReceivedBackgroundTask("entry", "Actual input"), /native device/); await assert.rejects(browser.backend.getReceivedBackgroundTask("entry"), /native device/); assert.equal(browser.nativeCalls.length, 0);
});

test("all fenced worker commands retain their captured lease on this installation", async () => {
  const f = setup();
  await f.backend.loadBackgroundExecutionSettings("execution", lease);
  await f.backend.saveBackgroundCheckpoint("execution", 1, {}, lease);
  await f.backend.beginBackgroundOperation("execution", "call", "SendMail", {}, lease);
  await f.backend.completeBackgroundOperation("execution", "call", {}, lease);
  await f.backend.compactBackgroundContext("execution", 1, {}, {}, lease);
  await f.backend.listBackgroundCompactions("execution", 0, lease);
  await f.backend.readBackgroundContextArchive("execution", 1, 0, lease);
  await f.backend.publishBackgroundArtifact("execution", "report.docx", undefined, lease);
  await f.backend.releasePromptRun("execution", lease);
  await f.backend.completePromptRun({ executionId: "execution", lease, success: true, durationMs: 1, output: "verified" });
  assert.equal(f.nativeCalls.length, 10);
  assert.equal(f.runtimeCalls.length, 0);
  for (const { args } of f.nativeCalls) assert.deepEqual((args.input ?? args).lease, lease);
  await f.backend.releasePromptRun("ordinary-cron");
  await f.backend.completePromptRun({ executionId: "ordinary-cron", success: true, durationMs: 1, output: "done" });
  assert.deepEqual(f.runtimeCalls.map((call) => call.command), ["automation_release_prompt_run", "automation_complete_prompt_run"]);
});

test("parent lease goes to the local peer validator outside accepted task input", async () => {
  const f = setup(); const input = { requestId: "child", delegation: { parentRequestId: "parent" } };
  await f.backend.submitBackgroundTask(input, "mac", lease);
  assert.equal(f.nativeCalls[0].command, "worker_peer_invoke");
  assert.deepEqual(f.nativeCalls[0].args.args.parent_lease, lease);
  assert.deepEqual(f.nativeCalls[0].args.args.input, input);
  assert.equal(JSON.stringify(input).includes(lease.token), false);
});

test("a receipt survives frontend reload and is queried on its original peer after global selection changes", async () => {
  const owners = new Map([["accepted", "old-mac"]]);
  let fixture = setup({ owners });
  await fixture.backend.getBackgroundTask("accepted");
  assert.equal(fixture.nativeCalls.at(-1).args.peer_id, "old-mac");
  fixture = setup({ owners, runtimeReply: async () => { throw new Error("new desktop must not receive this request"); } });
  await fixture.backend.readBackgroundArtifact("accepted", "report");
  assert.equal(fixture.nativeCalls.at(-1).args.peer_id, "old-mac");
  assert.equal(fixture.runtimeCalls.length, 0);
});

test("unbound legacy tasks retain local/selected-desktop transport and worker-only commands stay native", async () => {
  const { backend, nativeCalls, runtimeCalls } = setup();
  await backend.getBackgroundTask("legacy");
  assert.equal(runtimeCalls[0].command, "automation_background_get");
  assert.deepEqual(nativeCalls.map(c => c.command), ["automation_result_submission_current", "worker_peer_resolve_request"]);
  await backend.listWorkerPeers(); await backend.probeWorkerPeer("mac");
  assert.deepEqual(nativeCalls.slice(2).map((c) => c.command), ["worker_peer_list", "worker_peer_probe"]);
  assert.equal(runtimeCalls.length, 1);
});

test("input materialization remains on this worker while selected-host discovery follows the selected transport", async () => {
  const fixture = setup();
  await fixture.backend.prepareBackgroundInputs("execution", lease);
  assert.deepEqual(fixture.nativeCalls, [{ command: "automation_background_prepare_inputs", args: { execution_id: "execution", lease } }]);
  assert.deepEqual(fixture.runtimeCalls, []);
  await fixture.backend.getBackgroundHostInfo();
  assert.deepEqual(fixture.runtimeCalls, [{ command: "automation_background_host_info", args: undefined }]);
});

test("browser cannot select peers or discover the host's saved credentials through a LAN relay", async () => {
  const { backend, nativeCalls, runtimeCalls } = setup({ native: false });
  await assert.rejects(backend.getBackgroundTask("request", "mac"), /native app/);
  await assert.rejects(backend.listWorkerPeers(), /native app/);
  assert.equal(nativeCalls.length, 0); assert.equal(runtimeCalls.length, 0);
  assert.equal(await backend.resolveBackgroundPeer("request"), null);
});

test("independent peer requests run concurrently and uncertain submissions are not retried", async () => {
  let releaseMac;
  const fixture = setup({ reply: async (_command, args) => {
    if (args.peer_id === "mac") return new Promise((resolve) => { releaseMac = resolve; });
    if (args.peer_id === "broken") throw new Error("reply lost");
    return { hostId: args.peer_id };
  } });
  const mac = fixture.backend.getBackgroundTask("one", "mac");
  assert.deepEqual(await fixture.backend.getBackgroundTask("two", "windows"), { hostId: "windows" });
  releaseMac({ hostId: "mac" }); await mac;
  await assert.rejects(fixture.backend.submitBackgroundTask({ requestId: "three" }, "broken"), /reply lost/);
  assert.equal(fixture.nativeCalls.filter((c) => c.args.peer_id === "broken").length, 1);
});

test("an unavailable persisted owner never falls back to a different execution host", async () => {
  const fixture = setup({ owners: new Map([["receipt", "offline"]]), reply: async () => { throw new Error("worker is offline"); } });
  await assert.rejects(fixture.backend.getBackgroundTask("receipt"), /worker is offline/);
  assert.equal(fixture.runtimeCalls.length, 0);
  assert.equal(fixture.nativeCalls.at(-1).args.peer_id, "offline");
});

test("removing a worker or one endpoint uses local protected credentials and is unavailable to browsers", async () => {
  const f = setup({ selectedHost: { enabled: true, baseUrl: "http://different-pc:8080" } });
  await f.backend.forgetWorkerEndpoint("original-pc", "http://100.70.1.2:28367");
  await f.backend.forgetWorkerPeer("original-pc");
  assert.deepEqual(f.nativeCalls, [
    { command: "worker_peer_forget", args: { peer_id: "original-pc", base_url: "http://100.70.1.2:28367" } },
    { command: "worker_peer_forget", args: { peer_id: "original-pc" } },
  ]);
  assert.equal(f.runtimeCalls.length, 0);
  const browser = setup({ native: false });
  await assert.rejects(browser.backend.forgetWorkerEndpoint("original-pc", "http://100.70.1.2:28367"), /native app/);
  await assert.rejects(browser.backend.forgetWorkerPeer("original-pc"), /native app/);
  assert.equal(browser.nativeCalls.length, 0); assert.equal(browser.runtimeCalls.length, 0);
});

test("device action planning/execution/callback always stay native when selected PC changes", async () => {
  const f=setup({selectedHost:{enabled:true,baseUrl:"http://different-pc:8080"}});
  await f.backend.getMobileBranchContext("entry","calendar");
  await f.backend.listPendingMobileBranches(20);
  await f.backend.readMobileBranch("entry","calendar");
  await f.backend.prepareMobileBranch("entry","calendar",[]);
  await f.backend.executeMobileBranchAction("entry","calendar",0,{calendarId:"original"});
  await f.backend.completeMobileBranch("entry","calendar");
  await f.backend.inspectMobileBranches("entry");
  await f.backend.noteMobileBranchError("entry","calendar","Actual failure",{attempts:3,recovery:1});
  await f.backend.retryMobileBranchPlanning("entry","calendar",1);
  await f.backend.getMobileBranchAuthorization("entry","calendar");
  await f.backend.decideMobileBranchAuthorization("entry","calendar","exact-hash",3,false);
  const writeDecision=f.nativeCalls.at(-1);
  await f.backend.getMobileBranchReadAuthorization("entry","calendar");
  await f.backend.getMobileBranchReadChoices("entry","calendar","event");
  await f.backend.decideMobileBranchReadAuthorization("entry","calendar","context-hash",2,[{kind:"event",id:"actual-list",sourceId:"actual-account"}],true);
  await f.backend.readMobileBranchData("entry","calendar","list_calendar_events",{startMs:1,endMs:2,limit:3});
  assert.deepEqual(f.nativeCalls.map(call=>call.command),[
    "automation_mobile_branch_context","automation_mobile_branch_pending","automation_mobile_branch_read",
    "automation_mobile_branch_prepare","automation_mobile_branch_execute","automation_mobile_branch_complete",
    "automation_mobile_branch_inspect","automation_mobile_branch_error","automation_mobile_branch_retry",
    "automation_mobile_branch_authorization","automation_mobile_branch_decide",
    "automation_mobile_branch_read_authorization","automation_mobile_branch_read_choices",
    "automation_mobile_branch_read_decide","automation_mobile_branch_read_data",
  ]);
  assert.equal(f.runtimeCalls.length,0);
  assert.deepEqual(writeDecision.args,{entry_id:"entry",branch_id:"calendar",expected_hash:"exact-hash",expected_revision:3,approve:false});
  assert.deepEqual(f.nativeCalls.at(-2).args,{entry_id:"entry",branch_id:"calendar",expected_hash:"context-hash",expected_revision:2,selections:[{kind:"event",id:"actual-list",sourceId:"actual-account"}],approve:true});
  assert.deepEqual(f.nativeCalls.at(-1).args,{entry_id:"entry",branch_id:"calendar",action:"list_calendar_events",request:{startMs:1,endMs:2,limit:3}});
  const browser=setup({native:false});
  for(const attempt of [
    ()=>browser.backend.getMobileBranchContext("entry","calendar"),()=>browser.backend.listPendingMobileBranches(),
    ()=>browser.backend.readMobileBranch("entry","calendar"),()=>browser.backend.prepareMobileBranch("entry","calendar",[]),
    ()=>browser.backend.executeMobileBranchAction("entry","calendar",0,{}),()=>browser.backend.completeMobileBranch("entry","calendar"),
    ()=>browser.backend.inspectMobileBranches("entry"),()=>browser.backend.noteMobileBranchError("entry","calendar","failure",null),
    ()=>browser.backend.retryMobileBranchPlanning("entry","calendar",0),
    ()=>browser.backend.getMobileBranchAuthorization("entry","calendar"),
    ()=>browser.backend.decideMobileBranchAuthorization("entry","calendar","hash",0,true),
    ()=>browser.backend.getMobileBranchReadAuthorization("entry","calendar"),
    ()=>browser.backend.getMobileBranchReadChoices("entry","calendar","event"),
    ()=>browser.backend.decideMobileBranchReadAuthorization("entry","calendar","hash",0,[],false),
    ()=>browser.backend.readMobileBranchData("entry","calendar","list_reminders",{}),
  ]) await assert.rejects(attempt(),/native/);
  assert.equal(browser.nativeCalls.length,0);assert.equal(browser.runtimeCalls.length,0);
});
