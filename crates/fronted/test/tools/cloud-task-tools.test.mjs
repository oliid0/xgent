import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function harness(response, overrides = {}) {
  const calls = [];
  const loader = createTsModuleLoader({ mocks: {
    "@xgent/runtime": { invoke: async (command, args) => {
      calls.push({ command, args });
      if (response instanceof Error) throw response;
      return response;
    } },
  } });
  const { getDefaultSettings } = loader.loadModule("src/lib/settings/index.ts");
  const settings = { ...getDefaultSettings().access, githubOwner: " current-owner ", githubRepository: " new-public ", ...overrides };
  const { createCloudTaskTools } = loader.loadModule("src/lib/tools/cloudTaskTools.ts");
  const bundle = createCloudTaskTools(settings, "/workspace");
  return { calls, bundle, run: (args, signal) => bundle.executeToolCall({ id: "actual-start-call", name: "CloudTaskManager", arguments: args }, signal) };
}

const receipt = { taskId: "task-actual", owner: "current-owner", repository: "new-public", runner: "ubuntu-latest", repositoryUrl: "https://github.com/current-owner/new-public", repositoryVisibility: "public" };

test("explicit partial extraction returns actual imported file/source evidence without declaring the task complete", async () => {
  const extracted = { ...receipt, artifactId: 42, artifactName: "xgent-task-actual", localPath: "/workspace/archive.zip", sizeBytes: 10, runId: 12, runConclusion: "failure", outputDirectory: "/workspace/import", fileSource: { version: 1, hostId: "11111111-1111-4111-8111-111111111111", workdir: "/workspace" }, files: [{ path: "import/report.html", bytes: 5, contentHash: "a".repeat(64) }] };
  const h = harness(extracted), result = await h.run({ action: "extract_artifact", task_id: "task-actual", include_partial: true });
  assert.equal(result.isError, false); assert.equal(result.details.runConclusion, "failure"); assert.match(result.content[0].text, /does not verify task criteria/);
  assert.deepEqual(h.calls[0], { command: "cloud_task_extract_artifact", args: { locator: { owner: "current-owner", repository: "new-public", taskId: "task-actual" }, destinationDir: "/workspace", includePartial: true } });
  const invalid = await h.run({ action: "extract_artifact", task_id: "task-actual", include_partial: "true" }); assert.equal(invalid.isError, true); assert.equal(h.calls.length, 1);
});

test("cloud agent input uses the same native start lifecycle and cannot carry credential or competing script fields", async () => {
  const h = harness(receipt), agent = { prompt: "Build and verify report.html", provider: "openai", model: "actual-catalog-id", maxTurns: 12 };
  const result = await h.run({ action: "start", runner: "ubuntu-latest", agent });
  assert.equal(result.isError, false); assert.equal(h.calls[0].command, "cloud_task_start");
  assert.deepEqual(h.calls[0].args.input.agent, agent); assert.equal(h.calls[0].args.input.script, "");
  for (const extra of [{ script: "command" }, { agent: { ...agent, apiKey: "secret" } }, { agent: { ...agent, maxTurns: 0 } }]) {
    const invalid = await h.run({ action: "start", runner: "ubuntu-latest", agent, ...extra }); assert.equal(invalid.isError, true);
  }
  assert.equal(h.calls.length, 1);
});

test("cloud start sends configured namespace and actual public inputs, then exposes native visibility and receipt", async () => {
  const h = harness(receipt);
  const result = await h.run({ action: "start", runner: "ubuntu-latest", script: " write actual slides ", label: " slides ", files: [{ path: " source.txt ", content: "private source", encoding: "utf8" }] });
  assert.equal(result.isError, false);
  assert.deepEqual(h.calls, [{ command: "cloud_task_start", args: { input: { owner: "current-owner", repository: "new-public", runner: "ubuntu-latest", script: "write actual slides", label: "slides", files: [{ path: "source.txt", content: "private source", encoding: "utf8" }], retentionDays: 7 } } }]);
  assert.equal(result.details.repositoryVisibility, "public");
  assert.equal(result.details.taskId, receipt.taskId);
  assert.equal(result.toolCallId, "actual-start-call");
  assert.match(result.content[0].text, /repository visibility: public/);
  assert.match(result.content[0].text, /Job success alone does not verify/);
});

test("rejected private or unmanaged repository is an actual error, with no success receipt or resubmission", async () => {
  for (const message of ["repository is private; choose an unused task repository name", "repository is not Xgent-managed", "GitHub HTTP 403: Resource not accessible by personal access token"]) {
    const h = harness(new Error(message));
    const result = await h.run({ action: "start", runner: "ubuntu-latest", script: "run" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, new RegExp(message));
    assert.deepEqual(Object.keys(result.details), []);
    assert.equal(h.calls.length, 1);
  }
});

test("model cannot redirect new public inputs outside configured repository", async () => {
  const h = harness(receipt);
  const result = await h.run({ action: "start", runner: "ubuntu-latest", script: "run", owner: "other", repository: "public" });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Settings/);
  assert.equal(h.calls.length, 0);
});

for (const [action, command] of [["status", "cloud_task_status"], ["wait", "cloud_task_wait"], ["failure_log", "cloud_task_failure_log"], ["download_artifact", "cloud_task_download_artifact"]]) {
  test(`${action} preserves actual legacy receipt namespace after settings change`, async () => {
    const h = harness({ taskId: "legacy-task", state: "queued" });
    await h.run({ action, task_id: " legacy-task ", owner: " original-owner ", repository: " agent-temp ", max_wait_seconds: 900 });
    assert.equal(h.calls[0].command, command);
    assert.deepEqual(h.calls[0].args.locator, { owner: "original-owner", repository: "agent-temp", taskId: "legacy-task" });
    if (action === "wait") assert.equal(h.calls[0].args.maxWaitSeconds, 55);
    if (action === "download_artifact") assert.equal(h.calls[0].args.destinationDir, "/workspace");
    assert.equal(h.calls.length, 1);
  });
}

test("legacy start responses do not fabricate public visibility; default task namespace remains compatible", async () => {
  const { repositoryVisibility: _, ...legacy } = receipt;
  const h = harness(legacy, { githubOwner: "", githubRepository: " " });
  const result = await h.run({ action: "start", runner: "windows-latest", script: "run" });
  assert.equal(result.isError, false);
  assert.equal(result.details.repositoryVisibility, undefined);
  assert.doesNotMatch(result.content[0].text, /repository visibility/);
  assert.equal(h.calls[0].args.input.repository, "agent-temp");
});

test("cancelled, invalid action and empty explicit legacy namespace never invoke native cloud commands", async () => {
  const h = harness(receipt);
  for (const args of [{ action: "unknown", task_id: "task" }, { action: "status", task_id: "task", repository: " " }, { action: "status", task_id: "task", owner: " " }]) {
    assert.equal((await h.run(args)).isError, true);
  }
  assert.equal((await h.run({ action: "start", runner: "ubuntu-latest", script: "run" }, AbortSignal.abort())).isError, true);
  assert.equal(h.calls.length, 0);
});

test("terminal job failure remains an error and never verifies deliverables or starts another task", async () => {
  const h = harness({ taskId: "task", state: "completed", conclusion: "failure", runId: 11 });
  const result = await h.run({ action: "status", task_id: "task" });
  assert.equal(result.isError, true);
  assert.equal(result.details.conclusion, "failure");
  assert.equal(result.details.verified, undefined);
  assert.equal(h.calls.length, 1);
});

test("background cloud tool returns exact native canonical receipt without another start invoke", async () => {
  const loader = createTsModuleLoader({ mocks: { "@xgent/runtime": { invoke: async () => { throw new Error("must not use generic cloud_start"); } } } });
  const { createCloudTaskTools } = loader.loadModule("src/lib/tools/cloudTaskTools.ts");
  const { getDefaultSettings } = loader.loadModule("src/lib/settings/index.ts");
  const native = { role: "toolResult", toolCallId: "owned-call", toolName: "CloudTaskManager", isError: false, timestamp: 44, content: [{ type: "text", text: "Native actual acknowledgement" }], details: { kind: "cloud_task_manager", action: "start", ...receipt } };
  const ids = [];
  const bundle = createCloudTaskTools(getDefaultSettings().access, "/workspace", async (id) => { ids.push(id); return native; });
  const result = await bundle.executeToolCall({ id: "owned-call", name: "CloudTaskManager", arguments: { action: "start", runner: "ubuntu-latest", script: "actual work" } });
  assert.equal(result, native);
  assert.deepEqual(ids, ["owned-call"]);
  const invalid = await bundle.executeToolCall({ id: "wrong-call", name: "CloudTaskManager", arguments: { action: "start", runner: "ubuntu-latest", script: " " } });
  assert.equal(invalid.isError, true);
  assert.deepEqual(ids, ["owned-call"]);
});
