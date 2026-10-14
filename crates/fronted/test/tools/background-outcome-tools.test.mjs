import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const lease = { attempt: 1, generation: 2, token: "11111111-1111-4111-8111-111111111111" };
const branch = { id: "slides", title: "Slides", requirement: "Create actual slides", dependsOn: [], criteria: [{ kind: "artifact", path: "slides.pptx" }] };
const report = { verified: false, branches: [{ branch, state: "pending", evidence: null, reason: null }] };
function setup(options = {}) {
  const calls = [];
  const backend = {
    async recordBackgroundChildWait(...args){calls.push(["child-wait",...args]);if(options.denied)throw new Error("Actual child acknowledgement missing");return {...report,branches:[{...report.branches[0],state:"waiting",reason:"Actual child still running"}]};},
    async recordBackgroundCloudWait(...args){calls.push(["cloud-wait",...args]);if(options.denied)throw new Error("Cloud start receipt missing or belongs to another execution");return {...report,branches:[{...report.branches[0],state:"waiting",reason:"Actual Actions job still running"}]};},
    async readBackgroundOutcomes(...args) { calls.push(["read", ...args]); return options.report ?? report; },
    async readBackgroundEvidenceOptions(...args) { calls.push(["evidence", ...args]); return { artifacts: [{ id: "actual-snapshot", relativePath: "slides.pptx" }], receipts: [{ callId: "real-write", sequence: 12, toolName: "Write", state: "returned", isError: false }], nextCursor: 12 }; },
    async recordBackgroundOutcome(...args) { calls.push(["record", ...args]); if (options.denied) throw new Error("wrong artifact task or missing evidence"); return report; },
  };
  const api = createTsModuleLoader({ mocks: { "../automation/backend": { backend } } }).loadModule("src/lib/tools/backgroundOutcomeTools.ts");
  const tools = api.createBackgroundOutcomeTools("owned-task", lease);
  const run = (name, arguments_, signal) => tools.executeToolCall({ id: "call", name, arguments: arguments_ }, signal);
  return { run, calls, tools, api };
}

test("child join records original execution, branch, accepted call and captured lease without verifying criteria", async () => {
  const f = setup(); const args = { action: "wait", branch_id: "slides", reason: "Actual child still running", wait_for_child_call_id: "accepted-submit", executionId: "forged", lease: { token: "forged" } };
  const result = await f.run("RecordBackgroundOutcome", args);
  assert.equal(result.isError, false); assert.equal(result.details.result.verified, false);
  assert.equal(result.details.result.branches[0].state, "waiting");
  assert.deepEqual(f.calls, [["child-wait", "owned-task", "slides", "accepted-submit", "Actual child still running", lease]]);
  const denied = setup({ denied: true }); assert.equal((await denied.run("RecordBackgroundOutcome", args)).isError, true);
});

test("child joins reject mixed wait/evidence conditions, invented calls and excessive reasons before invoking native", async () => {
  for (const extra of [{ action: "verify" }, { wait_for_child_call_id: " " }, { wait_for_child_call_id: "x".repeat(257) }, { reason: " " }, { reason: "x".repeat(513) }, { wait_for_cloud_call_id: "cloud" }, { wait_for_tool: "Calendar" }, { wait_for_capabilities: false }, { artifact_ids: [] }, { call_ids: [] }, { answer: "done" }]) {
    const f = setup(); const response = await f.run("RecordBackgroundOutcome", { action: "wait", branch_id: "slides", reason: "Child pending", wait_for_child_call_id: "accepted", ...extra });
    assert.equal(response.isError, true); assert.equal(f.calls.length, 0);
  }
});

test("outcome tools use captured owner/lease and real evidence IDs without model-supplied authority", async () => {
  const f = setup();
  const result = await f.run("RecordBackgroundOutcome", { action: "verify", branch_id: "slides", artifact_ids: ["actual-snapshot"], executionId: "other", lease: { token: "forged" } });
  assert.equal(result.isError, false);
  assert.deepEqual(f.calls[0], ["record", "owned-task", "slides", { artifactIds: ["actual-snapshot"], callIds: [], answer: null }, null, lease]);
  assert.equal(f.tools.metadataByName.get("RecordBackgroundOutcome").isReadOnly, false);
  assert.equal(f.api.isBackgroundOutcomeStateCall({ name: "RecordBackgroundOutcome" }), true);
  assert.equal(f.api.isBackgroundOutcomeStateCall({ name: "Write" }), false);
});

test("native proof denial is a repairable task-state error and never fabricates verified success", async () => {
  const f = setup({ denied: true }); const result = await f.run("RecordBackgroundOutcome", { action: "verify", branch_id: "slides", artifact_ids: ["other-task-file"] });
  assert.equal(result.isError, true); assert.match(result.content[0].text, /missing evidence/);
  assert.equal(result.details.result.verified, undefined);
});

test("waiting preserves missing access separately from completion evidence", async () => {
  const f = setup(); assert.equal((await f.run("RecordBackgroundOutcome", { action: "wait", branch_id: "slides", reason: "Required native connector is offline" })).isError, false);
  assert.deepEqual(f.calls[0].slice(2, 5), ["slides", null, "Required native connector is offline"]);
  assert.equal((await f.run("RecordBackgroundOutcome", { action: "wait", branch_id: "slides", reason: "offline", answer: "done" })).isError, true);
  assert.equal(f.calls.length, 1);
});

test("cloud waits capture original owner/lease and use a retained start call, never model-supplied locator or job success",async()=>{
  const f=setup();const result=await f.run("RecordBackgroundOutcome",{action:"wait",branch_id:"slides",reason:"Wait for actual PPT generation",wait_for_cloud_call_id:"actual-start-call",executionId:"other",lease:{token:"forged"},task_id:"invented-task",repository:"invented-repo"});
  assert.equal(result.isError,false);assert.equal(result.details.result.verified,false);assert.equal(result.details.result.branches[0].state,"waiting");
  assert.deepEqual(f.calls,[["cloud-wait","owned-task","slides","actual-start-call","Wait for actual PPT generation",lease]]);
  const denied=setup({denied:true});assert.equal((await denied.run("RecordBackgroundOutcome",{action:"wait",branch_id:"slides",reason:"Await result",wait_for_cloud_call_id:"foreign-start"})).isError,true);
});

test("cloud waiting cannot combine discovery, proof or cancellation with a state mutation",async()=>{
  for(const patch of [{wait_for_cloud_call_id:""},{wait_for_cloud_call_id:42},{reason:"r".repeat(513)},{wait_for_tool:"CloudTaskManager"},{wait_for_capabilities:false},{answer:"done"},{artifact_ids:[]},{call_ids:[]},{action:"verify"}]) {
    const f=setup();const response=await f.run("RecordBackgroundOutcome",{action:"wait",branch_id:"slides",reason:"Pending",wait_for_cloud_call_id:"real-call",...patch});assert.equal(response.isError,true);assert.equal(f.calls.length,0);
  }
  const f=setup(),abort=new AbortController();abort.abort();assert.equal((await f.run("RecordBackgroundOutcome",{action:"wait",branch_id:"slides",reason:"Pending",wait_for_cloud_call_id:"real-call"},abort.signal)).isError,true);assert.equal(f.calls.length,0);
});

test("automatic waits carry an explicit exact tool or capability-discovery condition without granting permissions", async () => {
  const f = setup();
  await f.run("RecordBackgroundOutcome", { action: "wait", branch_id: "slides", reason: "Tool discovery is temporarily offline", wait_for_tool: "Calendar", wait_for_capabilities: true });
  assert.deepEqual(f.calls[0].slice(-3), [lease, "Calendar", true]);
  assert.equal((await f.run("RecordBackgroundOutcome", { action: "verify", branch_id: "slides", wait_for_capabilities: true })).isError, true);
  assert.equal((await f.run("RecordBackgroundOutcome", { action: "wait", branch_id: "slides", reason: "offline", wait_for_capabilities: "grant" })).isError, true);
  assert.equal(f.calls.length, 1);
});

test("read returns actual paginated IDs and bounded branch answers with an omission marker", async () => {
  const value = { ...report, branches: [{ ...report.branches[0], evidence: { artifactIds: [], callIds: [], answer: "text".repeat(3000) } }] };
  const f = setup({ report: value }); const result = await f.run("ReadBackgroundOutcomes", { branch_id: "slides", receipt_cursor: 8 });
  assert.equal(result.isError, false); const body = result.details.result;
  assert.equal(body.receipts[0].callId, "real-write"); assert.equal(body.nextCursor, 12);
  assert.equal(body.branches[0].evidence.answer.length, 4096); assert.equal(body.branches[0].evidence.answerExcerpt, true);
  assert.deepEqual(f.calls[1], ["evidence", "owned-task", 8, lease]);
  assert.equal(f.tools.metadataByName.get("ReadBackgroundOutcomes").isReadOnly, true);
});

test("invalid evidence, cursors and cancelled work do not call native state mutations", async () => {
  for (const args of [{ branch_id: "slides", action: "verify", call_ids: [1] }, { branch_id: "slides", action: "wait", reason: "" }, { branch_id: "slides", action: "verify", answer: 42 }]) {
    const f = setup(); assert.equal((await f.run("RecordBackgroundOutcome", args)).isError, true); assert.equal(f.calls.length, 0);
  }
  const cancelled = setup(); const controller = new AbortController(); controller.abort();
  assert.equal((await cancelled.run("RecordBackgroundOutcome", { action: "verify", branch_id: "slides" }, controller.signal)).isError, true); assert.equal(cancelled.calls.length, 0);
});
