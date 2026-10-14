import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const phone = "11111111-1111-4111-8111-111111111111", a = "22222222-2222-4222-8222-222222222222", b = "33333333-3333-4333-8333-333333333333";
const source = (hostId = a, workdir = "/pc-a/project") => ({ version: 1, hostId, workdir });
const peer = id => ({ enabled: true, baseUrl: `http://pc-${id}:28367`, localWorkdir: "/phone/workspace", remoteWorkdir: `/pc-${id}/project` });
function fixture(options = {}) {
  let host;
  const calls = [];
  const loader = createTsModuleLoader({ mocks: {
    "@xgent/runtime": { isTauriRuntime: () => options.native !== false,
      getLanPcCommandHostConfig: () => host.getLanPcCommandHostConfig(),
      invoke: () => assert.fail("mutable global route used for saved file") },
    "@tauri-apps/api/core": { async invoke(command, args) {
      calls.push({ command, args });
      if (options.invoke) return options.invoke(command, args);
      if (command === "automation_device_identity") return { hostId: options.hostId ?? phone };
      if (command === "lan_pc_invoke" && args.command === "automation_background_host_info") return { hostId: args.base_url.includes("pc-a") ? a : b };
      return { path: "result.md", exists: true, kind: "file", content: "original bytes", contentHash: "hash", mtimeMs: 1, mimeType: "text/markdown", data: "" };
    } },
    "@tauri-apps/api/path": { homeDir: async () => "/phone" },
  } });
  host = loader.loadModule("src/runtime/lanPcCommandHost.ts");
  return { loader, host, calls, ...loader.loadModule("src/lib/tools/workspaceFileSource.ts"),
    ...loader.loadModule("src/lib/tools/toolCommandPort.ts"),
    ...loader.loadModule("src/lib/tools/previewExecution.ts"),
  };
}

test("captured source identifies the actual mapped PC and native mounted root without following a UI switch", async () => {
  const f = fixture(); f.host.configureLanPcCommandHost(peer("a"));
  const ready = f.captureToolCommandPort(); f.host.configureLanPcCommandHost(peer("b"));
  const port = await ready;
  assert.deepEqual(await port.resolveFileSource("/phone/workspace/docs"), source(a, "/pc-a/project/docs"));
  assert.deepEqual(await port.resolveFileSource("/phone/skills"), source(phone, "/phone/skills"));
  assert.deepEqual(f.calls.map(call => call.command), ["lan_pc_invoke", "automation_device_identity"]);
  assert.equal(f.calls[0].args.base_url, "http://pc-a:28367");
});

test("serialized file source rehydrates on a fresh app using its original peer UUID, never the selected PC", async () => {
  const original = fixture(); original.host.configureLanPcCommandHost(peer("a"));
  const port = await original.captureToolCommandPort();
  const saved = JSON.parse(JSON.stringify(await port.resolveFileSource("/phone/workspace")));
  const fresh = fixture(); fresh.host.configureLanPcCommandHost(peer("b"));
  const restored = fresh.restoreWorkspaceFilePort(saved);
  await restored.invoke("fs_read_workspace_image", { workdir: saved.workdir, path: "result.md" });
  await restored.invoke("fs_write_text", { workdir: saved.workdir, path: "result.md", content: "updated", expected_content_hash: "original" });
  assert.deepEqual(fresh.calls.map(call => call.command), ["automation_device_identity", "worker_peer_file_invoke", "automation_device_identity", "worker_peer_file_invoke"]);
  assert.ok(fresh.calls.filter(call => call.command === "worker_peer_file_invoke").every(call => call.args.peer_id === a && call.args.args.workdir === saved.workdir));
  assert.equal(fresh.calls.at(-1).args.args.expected_content_hash, "original");
  assert.equal(JSON.stringify(saved).includes("http"), false);
});

test("native historical source stays native with a selected PC but becomes peer-owned on a different installation", async () => {
  for (const hostId of [phone, b]) {
    const f = fixture({ hostId }); f.host.configureLanPcCommandHost(peer("a"));
    await f.restoreWorkspaceFilePort(source(phone, "/phone/workspace")).invoke("fs_read_editable_text", { workdir: "/phone/workspace", path: "result.md" });
    assert.equal(f.calls.at(-1).command, hostId === phone ? "fs_read_editable_text" : "worker_peer_file_invoke");
    if (hostId !== phone) assert.equal(f.calls.at(-1).args.peer_id, phone);
  }
});

test("source and admitted arguments are immutable across identity lookup", async () => {
  const wait = Promise.withResolvers();
  const f = fixture({ invoke: (command) => command === "automation_device_identity" ? wait.promise : {} });
  const input = source(phone, "/phone/workspace"), port = f.restoreWorkspaceFilePort(input);
  input.hostId = b; input.workdir = "/wrong";
  assert.equal(Reflect.set(port.fileSource, "hostId", b), false);
  assert.equal(Reflect.set(port, "fileSource", source(b)), false);
  const args = { workdir: "/phone/workspace", path: "result.md", expected_content_hash: "original" };
  const reading = port.invoke("fs_write_text", args);
  args.workdir = "/wrong"; args.path = "wrong.md";
  wait.resolve({ hostId: phone }); await reading;
  assert.deepEqual(f.calls.at(-1).args, { workdir: "/phone/workspace", path: "result.md", expected_content_hash: "original" });
});

test("unknown, relative, malformed and browser sources cannot acquire another device's file capability", async () => {
  const f = fixture();
  for (const value of [null, {}, [], source("Same Mac"), source(a, "relative"), source(a, "/bad\0root"), { ...source(), version: 2 }]) {
    assert.equal(f.readWorkspaceFileSource(value), null);
    assert.throws(() => f.restoreWorkspaceFilePort(value), /could not be verified/);
  }
  assert.deepEqual(f.readWorkspaceFileSource({ ...source(), baseUrl: "http://secret", token: "secret" }), source());
  const port = f.restoreWorkspaceFilePort(source());
  await assert.rejects(port.invoke("shell_run", { workdir: source().workdir }), /does not belong/);
  await assert.rejects(port.invoke("fs_write_text", { workdir: "/other" }), /does not belong/);
  assert.equal(f.calls.length, 0);
  const browser = fixture({ native: false });
  await assert.rejects(browser.restoreWorkspaceFilePort(source()).invoke("fs_path_status", { workdir: source().workdir }), /native app/);
});

test("offline or revoked peer and unknown write outcome fail once without replay or cross-device fallback", async () => {
  for (const error of ["original peer offline", "pairing revoked", "write outcome uncertain"]) {
    const f = fixture({ invoke: (command) => {
      if (command === "automation_device_identity") return { hostId: phone };
      throw new Error(error);
    } });
    f.host.configureLanPcCommandHost(peer("b"));
    await assert.rejects(f.restoreWorkspaceFilePort(source()).invoke("fs_write_text", { workdir: source().workdir, path: "result.md", content: "edit" }), new RegExp(error));
    assert.equal(f.calls.length, 2); assert.equal(f.calls[1].args.peer_id, a);
  }
});

test("restored same-source previews retain draft identity across port recreation and different sources stay isolated", () => {
  const f = fixture();
  const request = { workdir: source().workdir, path: "result.md", ownerId: "chat", fileSource: source() };
  assert.equal(f.bindPreviewExecution({ ...request }).executionKey, f.bindPreviewExecution({ ...request }).executionKey);
  assert.notEqual(f.bindPreviewExecution({ ...request }).executionKey, f.bindPreviewExecution({ ...request, fileSource: source(b) }).executionKey);
});

test("native file bridge registers on both platforms and only dispatches verified workspace commands once", () => {
  const f = fixture(), rust = readFileSync(new URL("../../src-tauri/src/services/worker_peers.rs", import.meta.url), "utf8");
  const method = rust.slice(rust.indexOf("pub async fn invoke_file("), rust.indexOf("pub async fn forget("));
  const allowed = [...method.matchAll(/"(fs_[a-z_]+)"/g)].map(match => match[1]);
  assert.deepEqual(allowed.sort(), [...f.WORKSPACE_FILE_COMMANDS].sort());
  assert.match(method, /Self::probe_entry\(&stored, &clients\)/);
  assert.match(method, /current\.endpoints\(\).*known\.session_id == endpoint\.session_id/s);
  assert.equal((method.match(/client\.invoke\(/g) ?? []).length, 1);
  const registration = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");
  assert.equal((registration.match(/commands::lan_pc::worker_peer_file_invoke,/g) ?? []).length, 2);
  assert.equal((registration.match(/commands::submission::automation_device_identity,/g) ?? []).length, 2);
  const identity = readFileSync(new URL("../../src-tauri/src/commands/automation/submission.rs", import.meta.url), "utf8");
  assert.match(identity, /pub async fn automation_device_identity[\s\S]*store\.background_worker_identity\(\)/);
});
