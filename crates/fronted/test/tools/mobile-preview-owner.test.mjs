import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const peer = id => ({ enabled: true, baseUrl: `http://${id}:28367`,
  localWorkdir: "/phone/workspace", remoteWorkdir: `/workers/${id}` });
const native = { enabled: false, baseUrl: "" };
function harness(handle = () => ({ path: "report.md", exists: true, kind: "file" })) {
  const calls = [];
  let host;
  const loader = createTsModuleLoader({ mocks: {
    "@xgent/runtime": { isTauriRuntime: () => true, getLanPcCommandHostConfig: () => host.getLanPcCommandHostConfig(),
      invoke: () => assert.fail("mutable UI route used") },
    "@tauri-apps/api/core": { invoke(command, args) {
      const call = { command: command === "lan_pc_invoke" ? args.command : command,
        args: command === "lan_pc_invoke" ? args.args : args,
        endpoint: command === "lan_pc_invoke" ? args.base_url : null };
      calls.push(call);
      return Promise.resolve(handle(call));
    } },
    "@tauri-apps/api/path": { homeDir: async () => "/phone" },
  } });
  host = loader.loadModule("src/runtime/lanPcCommandHost.ts");
  const { createTauriRuntime } = loader.loadModule("src/runtime/tauri.ts");
  const execution = loader.loadModule("src/lib/tools/previewExecution.ts");
  return { calls, host, loader, ...execution,
    port: config => createTauriRuntime(host.captureLanPcCommandRouter(config)),
    ...loader.loadModule("src/lib/tools/mobilePreviewTools.ts"),
    ...loader.loadModule("src/components/workspace-editor/previewDrafts.ts"),
  };
}
const request = { ownerId: "chat-a", workdir: "/phone/workspace", path: "report.md" };
const toolCall = { id: "preview", name: "PreviewFile", arguments: { path: "report.md" } };

test("PreviewFile persists authenticated host identity and mapped workspace through the actual captured adapter", async () => {
  const restore = eventWindow();
  try {
    const hostId = "22222222-2222-4222-8222-222222222222";
    const f = harness(call => call.command === "automation_background_host_info" ? { hostId } : { path: "report.md", exists: true, kind: "file" });
    f.host.configureLanPcCommandHost(peer("a"));
    const { captureToolCommandPort } = f.loader.loadModule("src/lib/tools/toolCommandPort.ts");
    const commandPort = await captureToolCommandPort();
    f.host.configureLanPcCommandHost(peer("b"));
    let received;
    f.subscribeMobilePreviewRequests(value => { received = value; return true; });
    const result = await f.createMobilePreviewTools({ workdir: request.workdir, conversationId: "chat-a", commandPort }).executeToolCall(toolCall);
    assert.equal(result.isError, false);
    const saved = JSON.parse(JSON.stringify(result.details));
    assert.deepEqual(saved.fileSource, { version: 1, hostId, workdir: "/workers/a" });
    assert.deepEqual(received.fileSource, saved.fileSource);
    assert.ok(f.calls.every(call => call.endpoint === "http://a:28367"));
    assert.equal(saved.commandPort, undefined); assert.equal(JSON.stringify(saved).includes("http://"), false);
  } finally { restore(); }
});

test("cancel during source identity observation cannot publish the late preview", async () => {
  const restore = eventWindow(), wait = Promise.withResolvers();
  try {
    const f = harness(), controller = new AbortController();
    let published = 0; f.subscribeMobilePreviewRequests(() => { published++; return true; });
    const port = { ...f.port(native), resolveFileSource: () => wait.promise };
    const running = f.createMobilePreviewTools({ workdir: request.workdir, conversationId: "chat-a", commandPort: port }).executeToolCall(toolCall, controller.signal);
    await new Promise(setImmediate); controller.abort();
    wait.resolve({ version: 1, hostId: "11111111-1111-4111-8111-111111111111", workdir: request.workdir });
    assert.equal((await running).isError, true); assert.equal(published, 0);
  } finally { restore(); }
});
function eventWindow() {
  const previous = globalThis.window;
  globalThis.window = new EventTarget();
  return () => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; };
}

test("manual preview captures its peer before lazy native import; reads and guarded writes retain that peer", async () => {
  const f = harness();
  f.host.configureLanPcCommandHost(peer("a"));
  const bound = f.bindPreviewExecution(request);
  f.host.configureLanPcCommandHost(peer("b"));
  await f.invokePreviewFs(bound, "fs_read_workspace_image", { workdir: request.workdir, path: request.path });
  await f.invokePreviewFs(bound, "fs_write_text", { workdir: request.workdir, path: request.path,
    content: "edited", expected_content_hash: "original" });
  assert.deepEqual(f.calls.map(call => [call.endpoint, call.args.workdir]),
    [["http://a:28367", "/workers/a"], ["http://a:28367", "/workers/a"]]);
  assert.equal(f.calls[1].args.expected_content_hash, "original");
  assert.equal(f.bindPreviewExecution(request).commandPort, bound.commandPort);
});

test("task preview validates and renders on its native port while a different PC is selected", async () => {
  const restore = eventWindow(), wait = Promise.withResolvers();
  try {
    const f = harness(call => call.command === "fs_path_status" ? wait.promise : { data: "local" });
    f.host.configureLanPcCommandHost(peer("a"));
    const port = f.port(native);
    const tools = f.createMobilePreviewTools({ workdir: request.workdir, conversationId: request.ownerId, commandPort: port });
    let received;
    const unsubscribe = f.subscribeMobilePreviewRequests(value => { received = value; return value.ownerId === "chat-a"; });
    const result = tools.executeToolCall(toolCall);
    await new Promise(setImmediate);
    f.host.configureLanPcCommandHost(peer("b"));
    wait.resolve({ path: "report.md", exists: true, kind: "file" });
    const done = await result;
    assert.equal(done.isError, false);
    assert.equal(received.commandPort, port);
    await f.invokePreviewFs(received, "fs_read_workspace_image", { workdir: received.workdir, path: received.path });
    assert.deepEqual(f.calls.map(call => call.endpoint), [null, null]);
    assert.equal(done.details.commandPort, undefined);
    assert.equal(done.details.accept, undefined);
    assert.equal(done.details.ownerId, "chat-a");
    unsubscribe();
    assert.equal((await tools.executeToolCall(toolCall)).isError, true);
  } finally { restore(); }
});

test("preview needs a matching mounted conversation, and an abort after validation never publishes", async () => {
  const restore = eventWindow();
  try {
    const wait = Promise.withResolvers(), f = harness(() => wait.promise);
    const tools = f.createMobilePreviewTools({ workdir: request.workdir, conversationId: "chat-a", commandPort: f.port(native) });
    let offered = 0;
    f.subscribeMobilePreviewRequests(value => { offered++; return value.ownerId === "chat-b"; });
    wait.resolve({ path: "report.md", exists: true, kind: "file" });
    assert.equal((await tools.executeToolCall(toolCall)).isError, true);
    assert.equal(offered, 1);
    const controller = new AbortController(); controller.abort();
    assert.equal((await tools.executeToolCall(toolCall, controller.signal)).isError, true);
    assert.equal(offered, 1);
    assert.equal((await f.createMobilePreviewTools({ workdir: request.workdir }).executeToolCall(toolCall)).isError, true);
    const aborted = new AbortController(), delayed = Promise.withResolvers();
    const g = harness(() => delayed.promise);
    const running = g.createMobilePreviewTools({ workdir: request.workdir, conversationId: "chat-a", commandPort: g.port(native) })
      .executeToolCall(toolCall, aborted.signal);
    await new Promise(setImmediate); aborted.abort();
    delayed.resolve({ path: "report.md", exists: true, kind: "file" });
    assert.equal((await running).isError, true); assert.equal(offered, 1);
  } finally { restore(); }
});

test("same path drafts and pending writes are isolated by conversation and execution port", () => {
  const f = harness(), a = { ...request, commandPort: f.port(peer("a")) }, b = { ...request, commandPort: f.port(peer("b")) };
  const ka = f.previewDraftKey(a), kb = f.previewDraftKey(b);
  assert.notEqual(ka, kb);
  assert.equal(f.previewDraftKey({ ...f.bindPreviewExecution(a), commandPort: b.commandPort }), kb);
  assert.equal(f.previewDraftKey({ ...a }), ka);
  assert.notEqual(f.previewDraftKey({ ...a, ownerId: "chat-b" }), ka);
  f.previewDrafts.set(ka, { source: "A draft" }); f.previewPendingWrites.set(ka, Promise.resolve());
  assert.equal(f.previewDrafts.has(kb), false); assert.equal(f.previewPendingWrites.has(kb), false);
});

test("an unavailable original peer fails without retrying on the newly selected device", async () => {
  const f = harness(() => { throw new Error("original peer offline"); });
  f.host.configureLanPcCommandHost(peer("a"));
  const bound = f.bindPreviewExecution({ ...request });
  f.host.configureLanPcCommandHost(peer("b"));
  await assert.rejects(f.invokePreviewFs(bound, "fs_read_workspace_image", { workdir: bound.workdir, path: bound.path }), /original peer offline/);
  assert.deepEqual(f.calls.map(call => call.endpoint), ["http://a:28367"]);
});
