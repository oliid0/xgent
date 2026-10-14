import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const peer = (id) => ({
  enabled: true, baseUrl: `http://${id}:28367`, localWorkdir: "/phone/workspace",
  remoteWorkdir: `/workers/${id}`, remoteHomeDir: `/home/${id}`, remotePlatform: "linux",
});
const native = { enabled: false, baseUrl: "" };
function fixture(handle = () => ({ ok: true }), nativeRuntime = true, extraMocks = {}) {
  const calls = [], listeners = [];
  let host;
  const loader = createTsModuleLoader({ mocks: {
    "@xgent/runtime": {
      isTauriRuntime: () => nativeRuntime,
      getLanPcCommandHostConfig: () => host.getLanPcCommandHostConfig(),
      invoke: () => assert.fail("mutable global tool transport used"),
    },
    "@tauri-apps/api/core": { invoke(command, args) {
      const call = { command: command === "lan_pc_invoke" ? args.command : command,
        args: command === "lan_pc_invoke" ? args.args : args,
        endpoint: command === "lan_pc_invoke" ? args.base_url : null };
      calls.push(call);
      return Promise.resolve(handle(call));
    } },
    "@tauri-apps/api/event": { listen: async (event, handler) => {
      const listener = { event, handler, disposed: false };
      listeners.push(listener);
      return () => { listener.disposed = true; };
    } },
    "@tauri-apps/api/path": { homeDir: async () => "/phone" },
    "@tauri-apps/api/webview": { getCurrentWebview: () => ({}) },
    "@tauri-apps/plugin-opener": { openUrl: async () => {}, revealItemInDir: async () => {} },
    ...extraMocks,
  } });
  host = loader.loadModule("src/runtime/lanPcCommandHost.ts");
  const { createTauriRuntime } = loader.loadModule("src/runtime/tauri.ts");
  return { loader, host, calls, listeners,
    port: (config) => {
      const router = host.captureLanPcCommandRouter(config);
      return { ...createTauriRuntime(router), registerMcpServerRoute: router.registerMcpServerRoute };
    } };
}

for (const { initial, ready } of [{ initial: native, ready: false }, { initial: peer("a"), ready: true }, { initial: peer("a"), ready: false }]) {
  test(`actual foreground Agent tools retain ${ready ? "original PC" : initial.enabled ? "native device despite unready PC" : "native device"} across durable preflight`, async () => {
    const reachedRegistry = new Error("Registry boundary reached after actual owned tool invocation");
    const f = fixture(() => ({ ok: true }), true, {
      "../../../lib/automation/backgroundChatContext": { captureBackgroundChatContext: async () => "" },
      "../../../lib/automation/backgroundChatIntake": { async runDurableChatTurn() {
        await Promise.resolve();
        f.host.configureLanPcCommandHost(peer("b"));
        return false;
      } },
      "../../../lib/chat/memory/extractionController": { memoryExtraction: { noteTurnBoundary() {} } },
      "../../../lib/tools/builtinRegistry": { async buildBuiltinToolRegistry(options) {
        await options.commandPort.invoke("fs_read_text", { workdir: options.workdir, path: "source.txt" });
        assert.equal(await options.commandPort.homeDir(), ready ? "/home/a" : "/phone");
        throw reachedRegistry;
      } },
      "../../../lib/runtimePlatform": { resolveRuntimePlatform: async () => "linux" },
    });
    f.host.configureLanPcCommandHost(initial);
    const { createChatRuntimeHost } = f.loader.loadModule("src/pages/chat/runtime/ChatRuntimeHost.ts");
    const params = { lanPcCommandHostReady: ready, effectiveWorkdir: "/phone/workspace/docs",
      cancellation: { userStop: new AbortController() },
      conversationId: "turn-owner", conversationDebugLogger: { enabled: false },
      getNextConversationState: () => ({ meta: { taskList: null } }) };
    await assert.rejects(createChatRuntimeHost().runTurn({ mode: "agent", params }), error => error === reachedRegistry);
    assert.deepEqual(f.calls.map(call => [call.endpoint, call.args.workdir]),
      [[ready ? "http://a:28367" : null, ready ? "/workers/a/docs" : "/phone/workspace/docs"]]);
    assert.equal(f.host.getLanPcCommandHostConfig().baseUrl, "http://b:28367");
    assert.equal(params.commandHostSnapshot, undefined);
  });
}

test("concurrent tasks preserve separate peers, paths and homes after UI switches", async () => {
  const f = fixture(), a = f.port(peer("a")), b = f.port(peer("b"));
  f.host.configureLanPcCommandHost(peer("c"));
  await Promise.all([a.invoke("fs_read_text", { workdir: "/phone/workspace/docs" }),
    b.invoke("shell_run", { cwd: "/phone/workspace/site" })]);
  assert.deepEqual(f.calls.map((c) => [c.endpoint, c.args.workdir ?? c.args.cwd]),
    [["http://a:28367", "/workers/a/docs"], ["http://b:28367", "/workers/b/site"]]);
  assert.deepEqual(await Promise.all([a.homeDir(), b.homeDir()]), ["/home/a", "/home/b"]);
  assert.equal(f.host.getLanPcCommandHostConfig().baseUrl, "http://c:28367");
});

test("captured native execution stays native when a peer is selected later", async () => {
  const f = fixture(), local = f.port(native);
  f.host.configureLanPcCommandHost(peer("a"));
  for (const command of ["fs_read_text", "shell_run", "mcp_list_tools"])
    await local.invoke(command, { workdir: "/phone/workspace", servers: [{ id: "docs" }] });
  assert.ok(f.calls.every((c) => c.endpoint === null));
  assert.equal(await local.homeDir(), "/phone");
});

test("configuration inputs and returned copies cannot mutate a captured router", () => {
  const f = fixture(), config = peer("a"), router = f.host.captureLanPcCommandRouter(config);
  config.baseUrl = "http://wrong";
  router.getLanPcCommandHostConfig().remoteWorkdir = "/wrong";
  assert.equal(router.getLanPcCommandHostConfig().baseUrl, "http://a:28367");
  assert.equal(router.prepareLanPcInvokeArgs({ cwd: "/phone/workspace" }).cwd, "/workers/a");
});

test("task port preserves native skill roots and phone capabilities", async () => {
  const f = fixture(), port = f.port(peer("a"));
  await port.invoke("fs_read_text", { workdir: "/phone/skills", path: "SKILL.md" });
  await port.invoke("plugin:mobile-assistant|status");
  assert.ok(f.calls.every((c) => c.endpoint === null));
});

test("same MCP server ID has independent transport ownership across tasks", async () => {
  const f = fixture((c) => c.command === "mcp_list_tools" ? [] : {});
  const a = f.port(peer("a")), b = f.port(peer("b"));
  await a.invoke("mcp_list_tools", { servers: [{ id: "docs", transport: "stdio" }] });
  await b.invoke("mcp_list_tools", { servers: [{ id: "docs", transport: "http" }] });
  f.host.configureLanPcCommandHost(peer("c"));
  await a.invoke("mcp_call_tool", { server_id: "docs" });
  await b.invoke("mcp_call_tool", { server_id: "docs" });
  assert.deepEqual(f.calls.slice(-2).map((c) => c.endpoint), ["http://a:28367", null]);
});

test("mixed MCP discovery keeps network local and maps stdio cwd to the owned peer", async () => {
  const f = fixture((c) => c.args.servers.map((s) => ({ serverId: s.id })));
  const result = await f.port(peer("a")).invoke("mcp_list_tools", { servers: [
    { id: "network", transport: "http" },
    { id: "stdio", transport: "stdio", cwd: "/phone/workspace/docs" },
  ] });
  assert.deepEqual(result.map((t) => t.serverId), ["network", "stdio"]);
  assert.deepEqual(f.calls.map((c) => c.endpoint), [null, "http://a:28367"]);
  assert.equal(f.calls[1].args.servers[0].cwd, "/workers/a/docs");
});

test("in-flight shell cancellation stays on the original peer", async () => {
  let finish;
  const f = fixture((c) => c.command === "shell_run" ? new Promise((r) => { finish = r; }) : {});
  const port = f.port(peer("a")), running = port.invoke("shell_run", { run_id: "shell-a" });
  f.host.configureLanPcCommandHost(peer("b"));
  await port.invoke("runtime_cancel", { run_id: "shell-a" });
  assert.equal(f.calls[1].endpoint, "http://a:28367");
  finish({});
  await running;
});

test("network MCP cancellation stays native despite another task using stdio", async () => {
  let finish;
  const f = fixture((c) => c.command === "mcp_list_tools" ? [] : c.command === "mcp_call_tool"
    ? new Promise((r) => { finish = r; }) : {});
  const port = f.port(peer("a"));
  await port.invoke("mcp_list_tools", { servers: [{ id: "docs", transport: "http" }] });
  const running = port.invoke("mcp_call_tool", { server_id: "docs", run_id: "network-run" });
  f.host.configureLanPcCommandHost(peer("b"));
  f.host.registerMcpServerRoute({ id: "docs", transport: "stdio" });
  await port.invoke("mcp_cancel_tool", { run_id: "network-run" });
  assert.equal(f.calls.at(-1).endpoint, null);
  finish({});
  await running;
});

for (const failure of ["transport disconnected after acceptance", "session permission revoked"]) {
  test(`uncertain execution retains cancellation ownership without replay: ${failure}`, async () => {
    const f = fixture((c) => {
      if (c.command === "shell_run") throw new Error(failure);
      return {};
    }), port = f.port(peer("a"));
    await assert.rejects(port.invoke("shell_run", { run_id: "uncertain" }), new RegExp(failure));
    f.host.configureLanPcCommandHost(peer("b"));
    await port.invoke("runtime_cancel", { run_id: "uncertain" });
    assert.deepEqual(f.calls.map((c) => [c.command, c.endpoint]),
      [["shell_run", "http://a:28367"], ["runtime_cancel", "http://a:28367"]]);
  });
}

test("event subscriptions and disposal retain the original subscription identity", async () => {
  const f = fixture((c) => c.command === "lan_pc_subscribe" ? { subscriptionId: "a-sub", peerId: "pc-a" } : {});
  const seen = [], port = f.port(peer("a"));
  const stop = await port.listen("managed-process:changed", (e) => seen.push(e.payload));
  f.host.configureLanPcCommandHost(peer("b"));
  f.listeners[0].handler({ payload: { subscriptionId: "b-sub", payload: "wrong" } });
  f.listeners[0].handler({ payload: { subscriptionId: f.calls[0].args.relay_id, payload: "owned" } });
  stop();
  assert.deepEqual(seen, ["owned"]);
  assert.equal(f.calls[0].args.base_url, "http://a:28367");
  assert.equal(f.calls.at(-1).args.subscription_id, "a-sub");
  assert.equal(f.listeners[0].disposed, true);
});

test("real FS, Shell and MCP tool factories use their injected task port", async () => {
  const f = fixture((c) => {
    if (c.command === "fs_read_text") return { kind: "text", path: c.args.path,
      content: "1\tdata\n", truncated: false, startLine: 1, numLines: 1, totalLines: 1,
      isPartialView: false, mtimeMs: 10, contentHash: "hash", fileId: "5:77" };
    if (c.command === "shell_run") return { exit_code: 0, shell: "pwsh", platform: "windows",
      profile: "windows-pwsh", shell_family: "powershell", stdout: "ready\n", stderr: "",
      stdout_truncated: false, stderr_truncated: false, timed_out: false, cancelled: false,
      effective_timeout_ms: 1000, duration_ms: 12 };
    if (c.command === "mcp_list_tools") return [{ serverId: "docs", serverLabel: "Docs",
      name: "search", description: "Search docs", inputSchema: { type: "object" } }];
    if (c.command === "mcp_call_tool") return { content: [{ type: "text", text: "found" }] };
    assert.fail(`unexpected command ${c.command}`);
  });
  const commandPort = f.port(peer("a")), workdir = "/phone/workspace";
  const { createFsTools } = f.loader.loadModule("src/lib/tools/fsTools.ts");
  const { createFileToolState } = f.loader.loadModule("src/lib/tools/fileToolState.ts");
  const fs = createFsTools({ workdir, commandPort, fileState: createFileToolState(), skillsRootEnabled: false });
  const { createShellTools } = f.loader.loadModule("src/lib/tools/shellTools.ts");
  const shell = createShellTools({ workdir, commandPort, providerId: "codex",
    runtimePlatform: "windows", resumableShellEnabled: false });
  const { createMcpTools } = f.loader.loadModule("src/lib/tools/mcpTools.ts");
  const mcp = await createMcpTools({ commandPort, servers: [{ id: "docs", enabled: true,
    transport: "stdio", command: "mock-mcp-server", args: [], env: {} }] });
  f.host.configureLanPcCommandHost(peer("b"));
  for (const [bundle, name, arguments_] of [[fs, "Read", { path: "a.txt" }],
    [shell, "Bash", { command: "echo ready", timeout_ms: 1000 }], [mcp, mcp.tools[0].name, {}]]) {
    const result = await bundle.executeToolCall({ type: "toolCall", id: name, name, arguments: arguments_ });
    assert.equal(result.isError, false, JSON.stringify(result));
  }
  assert.ok(f.calls.every((c) => c.endpoint === "http://a:28367"));
  assert.equal(f.calls.find((c) => c.command === "fs_read_text").args.workdir, "/workers/a");
});

test("native adapter import cannot change the already captured host", async () => {
  const f = fixture();
  f.host.configureLanPcCommandHost(peer("a"));
  const { captureToolCommandPort } = f.loader.loadModule("src/lib/tools/toolCommandPort.ts");
  const pending = captureToolCommandPort();
  f.host.configureLanPcCommandHost(peer("b"));
  const port = await pending;
  await port.invoke("shell_run");
  assert.equal(f.calls[0].endpoint, "http://a:28367");
});

test("browser capture preserves the browser backend without importing native execution", async () => {
  const f = fixture(undefined, false);
  const { captureToolCommandPort } = f.loader.loadModule("src/lib/tools/toolCommandPort.ts");
  assert.equal(await captureToolCommandPort(peer("a")), undefined);
  assert.equal(f.calls.length, 0);
});

test("receiving PC executes admitted RPC and events locally despite its own selected peer", async () => {
  const f = fixture(() => "receiver receipt");
  f.host.configureLanPcCommandHost(peer("other-pc"));
  const { startLocalAccessHostBridge } = f.loader.loadModule("src/runtime/localAccessHostBridge.ts");
  const stop = await startLocalAccessHostBridge();
  f.listeners.find((l) => l.event === "local-access:rpc-request").handler({ payload: {
    requestId: "owned-request", command: "shell_run", args: { workdir: "/receiver/project" },
  } });
  f.listeners.find((l) => l.event === "local-access:event-subscribe").handler({ payload: {
    subscriptionId: "owned-event", event: "managed-process:changed",
  } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const forwarded = f.listeners.find((l) => l.event === "managed-process:changed");
  assert.ok(forwarded);
  forwarded.handler({ payload: { processId: "receiver-process" } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(f.calls.every((c) => c.endpoint === null));
  assert.deepEqual(f.calls.map((c) => c.command),
    ["shell_run", "local_access_rpc_respond", "local_access_event_publish"]);
  assert.equal(f.calls[1].args.result, "receiver receipt");
  assert.equal(f.calls[2].args.subscriptionId, "owned-event");
  stop();
  assert.ok(f.listeners.every((l) => l.disposed));
});

const call = (name, arguments_) => ({ type: "toolCall", id: name, name, arguments: arguments_ });
const sshHost = { id: "host-1", name: "Test", host: "ssh.example.test", port: 22,
  username: "deploy", authType: "privateKey", privateKeyPath: "/phone/key" };
const sshSession = { id: "ssh-1", projectPathKey: "/phone/workspace", cwd: "/phone/workspace",
  shell: "ssh", title: "SSH", kind: "ssh", running: true, createdAt: 1, updatedAt: 1,
  ssh: { hostId: "host-1", hostName: "Test", username: "deploy", host: "ssh.example.test",
    port: 22, authType: "privateKey", status: "connected", sftpEnabled: true } };
function sshBundle(f, commandPort) {
  return f.loader.loadModule("src/lib/tools/sshManagerTools.ts").createSSHManagerTools({
    commandPort, enabled: true, runtimeScope: "chat", workdir: "/phone/workspace",
    hosts: [sshHost], associatedHostIds: ["host-1"],
  });
}

test("SSH session discovery and execution share the task's selected peer", async () => {
  const f = fixture((c) => c.command === "terminal_list" ? { sessions: [sshSession] } : { stdout: "ok" });
  const bundle = sshBundle(f, f.port(peer("a")));
  f.host.configureLanPcCommandHost(peer("b"));
  const result = await bundle.executeToolCall(call("SSHManager", { action: "exec", host_id: "host-1", command: "pwd" }));
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.deepEqual(f.calls.map((c) => [c.command, c.endpoint]),
    [["terminal_list", "http://a:28367"], ["terminal_ssh_exec", "http://a:28367"]]);
  assert.equal(f.calls[0].args.project_path_key, "/workers/a");
});

test("new SSH session creation does not follow a peer switch during discovery", async () => {
  const f = fixture((c) => {
    if (c.command === "terminal_list") { f.host.configureLanPcCommandHost(peer("b")); return { sessions: [] }; }
    if (c.command === "terminal_create_ssh") return { session: sshSession };
    return {};
  });
  const result = await sshBundle(f, f.port(peer("a"))).executeToolCall(
    call("SSHManager", { action: "exec", host_id: "host-1", command: "pwd" }));
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.equal(f.calls.find((c) => c.command === "terminal_create_ssh").args.cwd, "/workers/a");
  assert.ok(f.calls.every((c) => c.endpoint === "http://a:28367"));
});

test("aborted SSH execution cancels on its original peer", async () => {
  let entered, finish;
  const started = new Promise((resolve) => { entered = resolve; });
  const f = fixture((c) => {
    if (c.command === "terminal_list") return { sessions: [sshSession] };
    if (c.command === "terminal_ssh_exec") { entered(); return new Promise((resolve) => { finish = resolve; }); }
    if (c.command === "runtime_cancel") return { cancelled: true };
    return {};
  });
  const controller = new AbortController();
  const running = sshBundle(f, f.port(peer("a"))).executeToolCall(
    call("SSHManager", { action: "exec", session_id: "ssh-1", command: "sleep 10" }), controller.signal);
  await started;
  f.host.configureLanPcCommandHost(peer("b"));
  controller.abort();
  const result = await running;
  assert.equal(result.isError, true);
  assert.equal(f.calls.find((c) => c.command === "runtime_cancel").endpoint, "http://a:28367");
  finish({});
});

test("late SFTP transfer receipt is cancelled on its original peer", async () => {
  let entered, finish;
  const started = new Promise((resolve) => { entered = resolve; });
  const f = fixture((c) => {
    if (c.command === "terminal_list") return { sessions: [sshSession] };
    if (c.command === "sftp_transfer") { entered(); return new Promise((resolve) => { finish = resolve; }); }
    return {};
  });
  const controller = new AbortController();
  const running = sshBundle(f, f.port(peer("a"))).executeToolCall(call("SSHManager", {
    action: "sftp_upload", session_id: "ssh-1", local_path: "report.txt", remote_path: "/tmp/report.txt",
  }), controller.signal);
  await started;
  f.host.configureLanPcCommandHost(peer("b"));
  controller.abort();
  assert.equal((await running).isError, true);
  finish({ transfer: { id: "owned-transfer" } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const cancel = f.calls.find((c) => c.command === "sftp_cancel_transfer");
  assert.equal(cancel.endpoint, "http://a:28367");
  assert.equal(cancel.args.transfer_id, "owned-transfer");
});

test("terminal project mapping stays on the task's peer", async () => {
  const f = fixture(() => ({ sessions: [], output: "", truncated: false }));
  const bundle = f.loader.loadModule("src/lib/tools/terminalTools.ts").createTerminalTools({
    commandPort: f.port(peer("a")), workdir: "/phone/workspace/docs",
  });
  f.host.configureLanPcCommandHost(peer("b"));
  assert.equal((await bundle.executeToolCall(call("ReadTerminal", {}))).isError, false);
  assert.equal(f.calls[0].endpoint, "http://a:28367");
  assert.equal(f.calls[0].args.project_path_key, "/workers/a/docs");
});

test("Cron task stores have independent revisions and never publish into the UI mirror", async () => {
  const states = new Map([["http://a:28367", { revision: 4, tasks: [] }], ["http://b:28367", { revision: 20, tasks: [] }]]);
  const f = fixture((c) => {
    const state = states.get(c.endpoint);
    if (c.command === "automation_snapshot") return { cron: structuredClone(state), hooks: { revision: 0, hooks: [] } };
    if (c.command === "automation_cron_apply") {
      assert.equal(c.args.input.baseRevision, state.revision);
      state.revision++;
      state.tasks.push({ ...c.args.input.ops[0].item, id: `task-${state.revision}` });
      return { status: "ok", cron: structuredClone(state) };
    }
    assert.fail(`unexpected command ${c.command}`);
  });
  const { createCronTools } = f.loader.loadModule("src/lib/tools/cronTools.ts");
  const a = createCronTools({ commandPort: f.port(peer("a")), workdir: "/workers/a" });
  const b = createCronTools({ commandPort: f.port(peer("b")), workdir: "/workers/b" });
  f.host.configureLanPcCommandHost(peer("c"));
  for (const bundle of [a, b, a]) {
    const result = await bundle.executeToolCall(call("CronTaskManager", { action: "create", name: "Run", type: "bash", cron: "0 20 * * *", script: "echo ready" }));
    assert.equal(result.isError, false, JSON.stringify(result));
  }
  assert.deepEqual(f.calls.filter((c) => c.command === "automation_cron_apply").map((c) => [c.endpoint, c.args.input.baseRevision]),
    [["http://a:28367", 4], ["http://b:28367", 20], ["http://a:28367", 5]]);
  assert.deepEqual(states.get("http://a:28367").tasks.map((task) => task.workdir), ["/workers/a", "/workers/a"]);
  assert.deepEqual(states.get("http://b:28367").tasks.map((task) => task.workdir), ["/workers/b"]);
  const ui = f.loader.loadModule("src/lib/automation/store.ts").getAutomationState();
  assert.equal(ui.ready, false);
  assert.deepEqual(ui.cron.tasks, []);
  assert.equal(f.listeners.length, 0);
});

test("Cron retries only confirmed revision conflicts on the same peer", async () => {
  let attempts = 0;
  const f = fixture((c) => {
    if (c.command === "automation_snapshot") return { cron: { revision: 1, tasks: [] }, hooks: { revision: 0, hooks: [] } };
    f.host.configureLanPcCommandHost(peer("b"));
    return ++attempts === 1 ? { status: "conflict", cron: { revision: 7, tasks: [] } }
      : { status: "ok", cron: { revision: 8, tasks: [{ id: "created", name: "Run", cron: "0 20 * * *", type: "bash", enabled: true }] } };
  });
  const bundle = f.loader.loadModule("src/lib/tools/cronTools.ts").createCronTools({ commandPort: f.port(peer("a")) });
  assert.equal((await bundle.executeToolCall(call("CronTaskManager", { action: "create", name: "Run", type: "bash", cron: "0 20 * * *", script: "echo ready" }))).isError, false);
  assert.deepEqual(f.calls.slice(1).map((c) => [c.endpoint, c.args.input.baseRevision]),
    [["http://a:28367", 1], ["http://a:28367", 7]]);
});

test("unknown Cron write outcome is not replayed or moved to another host", async () => {
  const f = fixture((c) => {
    if (c.command === "automation_snapshot") return { cron: { revision: 1, tasks: [] }, hooks: { revision: 0, hooks: [] } };
    f.host.configureLanPcCommandHost(peer("b"));
    throw new Error("write may have been accepted");
  });
  const bundle = f.loader.loadModule("src/lib/tools/cronTools.ts").createCronTools({ commandPort: f.port(peer("a")) });
  const result = await bundle.executeToolCall(call("CronTaskManager", { action: "delete", task_id: "owned-task" }));
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /write may have been accepted/);
  assert.equal(f.calls.filter((c) => c.command === "automation_cron_apply").length, 1);
  assert.ok(f.calls.every((c) => c.endpoint === "http://a:28367"));
});

test("malformed Cron receipts cannot trigger replay or claim deletion succeeded", async () => {
  for (const receipt of [{ status: "unknown", cron: { revision: 2, tasks: [] } },
    { status: "ok" }, { status: "ok", cron: { revision: -1, tasks: [] } }]) {
    const f = fixture((c) => c.command === "automation_snapshot"
      ? { cron: { revision: 1, tasks: [] }, hooks: { revision: 0, hooks: [] } } : receipt);
    const bundle = f.loader.loadModule("src/lib/tools/cronTools.ts").createCronTools({ commandPort: f.port(peer("a")) });
    const result = await bundle.executeToolCall(call("CronTaskManager", { action: "delete", task_id: "owned-task" }));
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /outcome is unconfirmed/);
    assert.equal(f.calls.filter((c) => c.command === "automation_cron_apply").length, 1);
  }
});

test("MCP management binds disabled stdio servers and keeps HTTP status native", async () => {
  const f = fixture(() => ({ state: "stopped", stopped: true }));
  const settings = { selected: [], servers: [
    { id: "stdio", enabled: false, transport: "stdio", command: "mock-mcp-server", args: [] },
    { id: "network", enabled: true, transport: "http", url: "https://example.test/mcp" },
  ] };
  const bundle = f.loader.loadModule("src/lib/tools/mcpManagerTools.ts").createMcpManagerTools({
    commandPort: f.port(peer("a")), workdir: "/phone/workspace", runtimeScope: "chat",
    getMcpSettings: () => settings,
  });
  f.host.configureLanPcCommandHost(peer("b"));
  for (const server_id of ["stdio", "network"]) {
    const result = await bundle.executeToolCall(call("McpManager", { action: "diagnose", server_id }));
    assert.equal(result.isError, false, JSON.stringify(result));
  }
  assert.deepEqual(f.calls.filter((c) => c.command === "mcp_runtime_status").map((c) => c.endpoint),
    ["http://a:28367", null]);
});

test("desktop worker heartbeat, claims and completion stay native when its UI selects a peer", async () => {
  let ports;
  const f = fixture(() => [], true, {
    "../lib/automation/promptRunHost": { startPromptRunHost(p) { ports = p; return () => {}; } },
    "../lib/automation/backgroundWaitReconciler": { startBackgroundWaitReconciler: () => () => {} },
    "./localAccessHostBridge": { startLocalAccessHostBridge: async () => () => {} },
  });
  f.host.configureLanPcCommandHost(peer("other-pc"));
  const stop = f.loader.loadModule("src/runtime/agentWorker.ts").startAgentWorker("native-owner");
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(ports);
    await ports.claimPromptRuns(1);
    await ports.completePromptRun({ executionId: "owned-run", output: "actual result", success: true });
    assert.ok(f.calls.every((c) => c.endpoint === null));
    assert.deepEqual(f.calls.map((c) => c.command),
      ["automation_background_host_heartbeat", "automation_claim_prompt_runs", "automation_complete_prompt_run"]);
    assert.ok(f.calls.every((c) => c.args.worker_instance_id === "native-owner"));
  } finally { stop(); }
});

test("MCP inline cwd resolves the task's home when no separate resolver is supplied", async () => {
  const calls = [];
  const f = fixture();
  const commandPort = { homeDir: async () => "/home/owned", async invoke(command, args) {
    calls.push({ command, args }); return { tools: [], initialized: true };
  } };
  const bundle = f.loader.loadModule("src/lib/tools/mcpManagerTools.ts").createMcpManagerTools({
    commandPort, workdir: "/workspace", runtimeScope: "chat",
    getMcpSettings: () => ({ selected: [], servers: [] }),
  });
  const result = await bundle.executeToolCall(call("McpManager", { action: "test", server: {
    id: "inline", transport: "stdio", command: "mock-mcp-server", cwd: "~/mcp", args: [],
  } }));
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.equal(calls[0].command, "mcp_test_server");
  assert.equal(calls[0].args.server.cwd, "/home/owned/mcp");
  assert.equal(f.calls.length, 0);
});

test("real builtin registry passes the task port and pinned workspace to Cron", async () => {
  const f = fixture((c) => c.command === "automation_snapshot"
    ? { cron: { revision: 4, tasks: [] }, hooks: { revision: 0, hooks: [] } }
    : { status: "ok", cron: { revision: 5, tasks: [{ ...c.args.input.ops[0].item, id: "created" }] } });
  const { createFileToolState } = f.loader.loadModule("src/lib/tools/fileToolState.ts");
  const { buildBuiltinToolRegistry } = f.loader.loadModule("src/lib/tools/builtinRegistry.ts");
  const registry = await buildBuiltinToolRegistry({
    commandPort: f.port(peer("a")), workdir: "/workers/a", providerId: "codex", runtimePlatform: "linux",
    fileState: createFileToolState(), skillsEnabled: false, runtimeScope: "chat",
    selectedSystemToolIds: [], getMcpSettings: () => ({ selected: [], servers: [] }),
  });
  f.host.configureLanPcCommandHost(peer("b"));
  const result = await registry.executeToolCall(call("CronTaskManager", {
    action: "create", name: "Run", type: "bash", cron: "0 20 * * *", script: "echo ready",
  }));
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.ok(f.calls.every((c) => c.endpoint === "http://a:28367"));
  assert.equal(f.calls.find((c) => c.command === "automation_cron_apply").args.input.ops[0].item.workdir, "/workers/a");
});
