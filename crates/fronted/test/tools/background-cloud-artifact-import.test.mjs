import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const lease = { attempt: 1, generation: 2, token: "11111111-1111-4111-8111-111111111111" };
const call = { id: "import-cloud", name: "ImportBackgroundCloudArtifact", arguments: { cloud_call_id: "original-start", entry_path: "reports/result.pptx", path: "report.pptx" } };
const receipt = () => ({ role: "toolResult", toolCallId: call.id, toolName: call.name, isError: false, timestamp: 101,
  content: [{ type: "text", text: '{"artifact":{"id":"parent-artifact","relativePath":"report.pptx"}}' }], details: { kind: "background_artifact", result: { artifact: { id: "parent-artifact", relativePath: "report.pptx" } } } });
function fixture(invoke) {
  const calls = [];
  const api = createTsModuleLoader({ mocks: { "../automation/backend": { backend: {
    async importBackgroundCloudArtifact(...args) { calls.push(args); return invoke(...args); },
  } } } }).loadModule("src/lib/tools/backgroundTaskTools.ts");
  return { calls, tools: api.createBackgroundArtifactTools("original-parent", lease) };
}

test("cloud import uses captured parent/lease/start and returns the committed receipt after late cancellation", async () => {
  const controller = new AbortController(), saved = receipt();
  const f = fixture(() => { controller.abort(); return saved; });
  assert.equal(await f.tools.executeToolCall(call, controller.signal), saved);
  assert.deepEqual(f.calls, [["original-parent", call.id, "original-start", lease]]);
  const schema = f.tools.tools.find(tool => tool.name === call.name).parameters;
  assert.equal(schema.additionalProperties, false); assert.equal(schema.properties.entry_path.maxLength, 1024);
  assert.equal(f.tools.metadataByName.get(call.name).isReadOnly, false);
  assert.match(f.tools.tools.find(tool => tool.name === call.name).description, /actual successful run/);
});

test("arbitrary cloud URLs, owner overrides, statuses, bytes and malformed identifiers never reach native import", async () => {
  for (const args of [null, [], {}, { ...call.arguments, owner: "other" }, { ...call.arguments, url: "https://replacement.example/file" },
    { ...call.arguments, contentBase64: "invented" }, { ...call.arguments, success: true }, { ...call.arguments, cloud_call_id: "" },
    { ...call.arguments, cloud_call_id: "x".repeat(257) }, { ...call.arguments, entry_path: 10 }, { ...call.arguments, entry_path: "" },
    { ...call.arguments, entry_path: "x".repeat(1025) }, { ...call.arguments, path: false }]) {
    const f = fixture(receipt); assert.equal((await f.tools.executeToolCall({ ...call, arguments: args })).isError, true); assert.equal(f.calls.length, 0);
  }
});

test("cancellation, quota refusal and mismatched receipts cannot be promoted to delivered files", async () => {
  const controller = new AbortController(); controller.abort(); const cancelled = fixture(receipt);
  assert.equal((await cancelled.tools.executeToolCall(call, controller.signal)).isError, true); assert.equal(cancelled.calls.length, 0);
  const rejected = fixture(() => { throw new Error("Artifact quota exceeded"); });
  const result = await rejected.tools.executeToolCall(call); assert.equal(result.isError, true); assert.match(result.content[0].text, /quota/);
  for (const patch of [{ toolCallId: "other" }, { toolName: "Other" }, { role: "assistant" }])
    assert.equal((await fixture(() => ({ ...receipt(), ...patch })).tools.executeToolCall(call)).isError, true);
  const failed = { ...receipt(), isError: true }; assert.equal(await fixture(() => failed).tools.executeToolCall(call), failed);
});

test("native cloud import bypasses selected-PC transport and never sends owner/path/status fields from the model", async () => {
  const calls = [], saved = receipt();
  const api = createTsModuleLoader({ mocks: { "@xgent/runtime": {
    invokeNative: (command, args) => { calls.push({ command, args }); return Promise.resolve(saved); },
    invoke: () => { throw new Error("Wrong selected transport"); }, isTauriRuntime: () => true,
  } } }).loadModule("src/lib/automation/backend.ts");
  assert.equal(await api.backend.importBackgroundCloudArtifact("parent", call.id, "start", lease), saved);
  assert.deepEqual(calls, [{ command: "automation_background_cloud_import_artifact", args: { execution_id: "parent", call_id: call.id, cloud_call_id: "start", lease } }]);
});

test("a lost cloud import ACK reuses its exact local receipt after reopening the journal without another download", async () => {
  let committed, imports = 0;
  const backend = {
    saveBackgroundCheckpoint: async (_, revision) => revision,
    beginBackgroundOperation: async () => committed ? { status: "returned", result: committed } : { status: "execute" },
    completeBackgroundOperation: async () => { throw new Error("ACK transport unavailable"); },
    importBackgroundCloudArtifact: async () => { imports++; committed = receipt(); return committed; },
  };
  const loader = createTsModuleLoader({ mocks: { "../automation/backend": { backend }, "./backend": { backend } } });
  const tools = loader.loadModule("src/lib/tools/backgroundTaskTools.ts").createBackgroundArtifactTools("parent", lease);
  const api = loader.loadModule("src/lib/automation/backgroundExecutionJournal.ts");
  const make = () => api.createBackgroundExecutionJournal("parent", { systemPrompt: "Original request", messages: [{ role: "user", content: "Deliver slides", timestamp: 1 }] }, new AbortController().signal, { lease, isTaskStateOnly: () => true });
  const first = make(); try { await assert.rejects(first.execute(call, undefined, () => tools.executeToolCall(call)), /receipt could not be confirmed/); } finally { first.dispose(); }
  const reopened = make(); try { assert.equal(await reopened.execute(call, undefined, () => assert.fail("No second import")), committed); assert.equal(imports, 1); } finally { reopened.dispose(); }
});
