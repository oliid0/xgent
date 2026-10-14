import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function snapshot(bytes) {
  return { bytes: bytes.length, contentBase64: Buffer.from(bytes).toString("base64"), contentHash: createHash("sha256").update(bytes).digest("hex") };
}
function setup({ native = true, responses = {}, error, afterRead, inputVersion = 1 } = {}) {
  const nativeCalls = []; const submissions = [];
  const loader = createTsModuleLoader({ mocks: {
    "@tauri-apps/api/core": { async invoke(command, args) {
      nativeCalls.push({ command, args });
      if (error) throw error;
      afterRead?.();
      return responses[args.path] ?? snapshot(Buffer.from("document"));
    } },
    "@xgent/runtime": { isTauriRuntime: () => native, getLanPcCommandHostConfig: () => ({ enabled: true, localWorkdir: "/phone/files" }),
      async invoke() { assert.fail("Snapshot must not use global paired-PC fs transport"); } },
    "../automation/backend": { backend: {
      async resolveBackgroundPeer() { return null; },
      async getBackgroundHostInfo() { return { inputSnapshotVersion: inputVersion ?? undefined }; },
      async probeWorkerPeer(id) { return { hostId: id, acceptsBackgroundTasks: true, executorReady: true, workspaceAvailable: true, inputSnapshotVersion: inputVersion ?? undefined, workdir: "/mac/workspace",
        providers: [{ id: "mac-provider", models: ["model"] }] }; },
      async submitBackgroundTask(input, peerId) { submissions.push({ input, peerId }); return { requestId: input.requestId, inputs: (input.files ?? []).map(({ name, bytes, contentHash }) => ({ relativePath: `copies/${name}`, bytes, contentHash })) }; },
    } },
  } });
  const { snapshotBackgroundInputs } = loader.loadModule("src/lib/automation/backgroundInputs.ts");
  const { createBackgroundTaskTools } = loader.loadModule("src/lib/tools/backgroundTaskTools.ts");
  const bundle = createBackgroundTaskTools({ workdir: "/selected/pc/path", currentChatModel: { customProviderId: "p", model: "model" } });
  const submit = (files, signal, peerId = "mac") => bundle.executeToolCall({ id: "input-call", name: "BackgroundTask", arguments: {
    action: "submit", peer_id: peerId, name: "report", prompt: "Read the PDF and create a report", files,
  } }, signal);
  return { snapshotBackgroundInputs, submit, nativeCalls, submissions };
}

test("phone binary inputs go through local native fs and the chosen peer receives verified bytes", async () => {
  const bytes = Buffer.from([0, 255, 12, 128]);
  const fixture = setup({ responses: { "documents/spec.pdf": snapshot(bytes) } });
  const result = await fixture.submit([{ path: "documents/spec.pdf" }]);
  assert.equal(result.isError, false);
  assert.deepEqual(fixture.nativeCalls, [{ command: "fs_snapshot_binary", args: { workdir: "/phone/files", path: "documents/spec.pdf" } }]);
  assert.equal(fixture.submissions[0].peerId, "mac");
  assert.equal(fixture.submissions[0].input.workdir, "/mac/workspace");
  assert.deepEqual(fixture.submissions[0].input.files, [{ name: "spec.pdf", ...snapshot(bytes) }]);
  assert.equal(JSON.stringify(result.details).includes(bytes.toString("base64")), false);
});

test("selected-host file delegation also negotiates input support while empty file lists need no native fs", async () => {
  const oldHost = setup({ inputVersion: 0 });
  assert.equal((await oldHost.submit([{ path: "spec.pdf" }], undefined, null)).isError, true);
  assert.deepEqual(oldHost.nativeCalls, []);
  assert.deepEqual(oldHost.submissions, []);
  const newHost = setup();
  assert.equal((await newHost.submit([{ path: "spec.pdf" }], undefined, null)).isError, false);
  assert.equal(newHost.submissions[0].peerId, undefined);
  const browser = setup({ native: false });
  assert.equal((await browser.submit([])).isError, false);
  assert.deepEqual(browser.nativeCalls, []);
});

test("an older worker cannot silently accept a file task while ignoring its bytes", async () => {
  // Missing version and the explicit old protocol must both fail before reading.
  for (const version of [null, 0, 2]) {
    const legacy = setup({ inputVersion: version });
    assert.equal((await legacy.submit([{ path: "spec.pdf" }])).isError, true);
    assert.deepEqual(legacy.nativeCalls, []);
    assert.deepEqual(legacy.submissions, []);
  }
});

test("same-name sources require explicit distinct names and no task is sent on collision", async () => {
  const rejected = setup();
  assert.equal((await rejected.submit([{ path: "first/spec.pdf" }, { path: "second/SPEC.pdf" }])).isError, true);
  assert.deepEqual(rejected.submissions, []);
  const accepted = setup();
  assert.equal((await accepted.submit([{ path: "first/spec.pdf", name: "first.pdf" }, { path: "second/spec.pdf", name: "second.pdf" }])).isError, false);
  assert.deepEqual(accepted.submissions[0].input.files.map((file) => file.name), ["first.pdf", "second.pdf"]);
});

test("corrupt input bytes or metadata cannot submit a background task", async () => {
  for (const bad of [{ ...snapshot(Buffer.from("real")), contentHash: "fake" }, { ...snapshot(Buffer.from("real")), bytes: 3 },
    { contentBase64: "", contentHash: "fake", bytes: 8 * 1024 * 1024 + 1 }]) {
    const fixture = setup({ responses: { "spec.pdf": bad } });
    assert.equal((await fixture.submit([{ path: "spec.pdf" }])).isError, true);
    assert.deepEqual(fixture.submissions, []);
  }
});

test("portable filenames, count and browser limits fail before reading device files", async () => {
  for (const name of ["../escape", "x:y", "CON.txt", "LPT1", "a ", "a.", "bad\u0000name"]) {
    const fixture = setup();
    await assert.rejects(fixture.snapshotBackgroundInputs([{ path: "valid.pdf", name }], "/local"), /portable basenames/);
    assert.deepEqual(fixture.nativeCalls, []);
  }
  const tooMany = setup();
  await assert.rejects(tooMany.snapshotBackgroundInputs(Array.from({ length: 9 }, (_, i) => ({ path: `${i}.pdf` })), "/local"), /At most 8/);
  assert.deepEqual(tooMany.nativeCalls, []);
  const browser = setup({ native: false });
  assert.equal((await browser.submit([{ path: "valid.pdf" }])).isError, true);
  assert.deepEqual(browser.nativeCalls, []);
  assert.deepEqual(browser.submissions, []);
});

test("total input quota rejects collectively oversized files before task acceptance", async () => {
  const bytes = Buffer.alloc(4 * 1024 * 1024 + 1, 1);
  const fixture = setup({ responses: { "a.pdf": snapshot(bytes), "b.pdf": snapshot(bytes) } });
  await assert.rejects(fixture.snapshotBackgroundInputs([{ path: "a.pdf" }, { path: "b.pdf" }], "/local"), /8 MiB total/);
  assert.deepEqual(fixture.submissions, []);
});

test("native read failure and cancellation during a read accept no work", async () => {
  const missing = setup({ error: new Error("source deleted") });
  assert.equal((await missing.submit([{ path: "missing.pdf" }])).isError, true);
  assert.deepEqual(missing.submissions, []);
  const controller = new AbortController();
  const aborted = setup({ afterRead: () => controller.abort() });
  assert.equal((await aborted.submit([{ path: "spec.pdf" }], controller.signal)).isError, true);
  assert.deepEqual(aborted.submissions, []);
});
