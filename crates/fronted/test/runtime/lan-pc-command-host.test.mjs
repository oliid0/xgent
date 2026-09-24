import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("LAN delegation preserves an already remote working subdirectory", () => {
  const loader = createTsModuleLoader();
  const host = loader.loadModule("src/runtime/lanPcCommandHost.ts");
  for (const remoteWorkdir of ["C:\\workspace", "/home/owner/workspace"]) {
    host.configureLanPcCommandHost({
      enabled: true, baseUrl: "http://desktop:28367",
      localWorkdir: "/phone/workspace", remoteWorkdir,
    });
    const child = `${remoteWorkdir}${remoteWorkdir.includes("\\") ? "\\" : "/"}report`;
    assert.deepEqual(host.prepareLanPcInvokeArgs({ workdir: child, cwd: child }), {
      workdir: child, cwd: child,
    });
    const once = host.prepareLanPcInvokeArgs({ cwd: "/phone/workspace/report" });
    assert.equal(once.cwd, child);
    assert.deepEqual(host.prepareLanPcInvokeArgs(once), once);
    assert.equal(host.prepareLanPcInvokeArgs({ cwd: `${remoteWorkdir}-other` }).cwd, remoteWorkdir);
  }
});

test("paired mobile delegates shell commands to the desktop workspace but keeps phone tools local", async () => {
  const calls = [];
  const loader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          calls.push({ command, args });
          return { ok: true };
        },
      },
      "@tauri-apps/api/event": { listen: async () => () => {} },
      "@tauri-apps/api/path": { homeDir: async () => "/phone" },
      "@tauri-apps/api/webview": { getCurrentWebview: () => ({}) },
      "@tauri-apps/plugin-opener": { openUrl: async () => {}, revealItemInDir: async () => {} },
    },
  });
  const host = loader.loadModule("src/runtime/lanPcCommandHost.ts");
  const { tauriRuntime } = loader.loadModule("src/runtime/tauri.ts");
  host.configureLanPcCommandHost({
    enabled: true,
    baseUrl: "http://desktop:28367",
    localWorkdir: "/phone/workspace",
    remoteWorkdir: "C:\\Users\\owner\\workspace",
    remoteHomeDir: "C:\\Users\\owner",
    remotePlatform: "windows",
  });

  await tauriRuntime.invoke("shell_run", {
    workdir: "/phone/workspace",
    cwd: "/phone/workspace/report",
    command: "python -V",
  });
  await tauriRuntime.invoke("shell_session_wait", { session_id: "bash-1", cursor: 0 });
  await tauriRuntime.invoke("shell_cancel", { run_id: "run-1" });
  await tauriRuntime.invoke("shell_cancel", { run_id: "mobile-ssh-123" });
  await tauriRuntime.invoke("shell_cancel", { run_id: "ssh-tool-123" });
  await tauriRuntime.invoke("plugin:mobile-assistant|status");
  assert.deepEqual(calls.slice(0, 3).map((call) => call.command), [
    "lan_pc_invoke",
    "lan_pc_invoke",
    "lan_pc_invoke",
  ]);
  assert.equal(calls[0].args.command, "shell_run");
  assert.equal(calls[0].args.args.workdir, "C:\\Users\\owner\\workspace");
  assert.equal(calls[0].args.args.cwd, "C:\\Users\\owner\\workspace\\report");
  assert.equal(calls[1].args.command, "shell_session_wait");
  assert.equal(calls[2].args.command, "shell_cancel");
  assert.deepEqual(calls.slice(3).map((call) => call.command), [
    "shell_cancel",
    "shell_cancel",
    "plugin:mobile-assistant|status",
  ]);
  assert.equal(host.getLanPcCommandHostConfig().remotePlatform, "windows");
});

test("paired mobile keeps network MCP local and sends stdio calls and cancellation to the PC", async () => {
  const calls = [];
  let finishRemoteCall;
  const loader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          calls.push({ command, args });
          const actual = command === "lan_pc_invoke" ? args.command : command;
          const payload = command === "lan_pc_invoke" ? args.args : args;
          if (actual === "mcp_list_tools") {
            return payload.servers.map((server) => ({ serverId: server.id, name: "lookup" }));
          }
          if (actual === "mcp_call_tool" && command === "lan_pc_invoke") {
            return new Promise((resolve) => { finishRemoteCall = resolve; });
          }
          return { ok: true };
        },
      },
      "@tauri-apps/api/event": { listen: async () => () => {} },
      "@tauri-apps/api/path": { homeDir: async () => "/phone" },
      "@tauri-apps/api/webview": { getCurrentWebview: () => ({}) },
      "@tauri-apps/plugin-opener": { openUrl: async () => {}, revealItemInDir: async () => {} },
    },
  });
  const host = loader.loadModule("src/runtime/lanPcCommandHost.ts");
  const { tauriRuntime } = loader.loadModule("src/runtime/tauri.ts");
  host.configureLanPcCommandHost({
    enabled: true,
    baseUrl: "http://desktop:28367",
    remoteWorkdir: "C:\\workspace",
  });

  const tools = await tauriRuntime.invoke("mcp_list_tools", { servers: [
    { id: "web", transport: "http" },
    { id: "local", transport: "stdio" },
  ] });
  assert.deepEqual(tools.map((tool) => tool.serverId), ["web", "local"]);
  assert.deepEqual(calls.map((call) => call.command), ["mcp_list_tools", "lan_pc_invoke"]);
  assert.deepEqual(calls[0].args.servers.map((server) => server.id), ["web"]);
  assert.deepEqual(calls[1].args.args.servers.map((server) => server.id), ["local"]);

  calls.length = 0;
  await tauriRuntime.invoke("mcp_call_tool", { server_id: "web", run_id: "web-run" });
  const pending = tauriRuntime.invoke("mcp_call_tool", { server_id: "local", run_id: "local-run" });
  await tauriRuntime.invoke("mcp_cancel_tool", { run_id: "local-run" });
  finishRemoteCall({ ok: true });
  await pending;
  assert.deepEqual(calls.map((call) => call.command), [
    "mcp_call_tool", "lan_pc_invoke", "lan_pc_invoke",
  ]);
  assert.equal(calls[2].args.command, "mcp_cancel_tool");

  calls.length = 0;
  await tauriRuntime.invoke("mcp_test_server", { server: { id: "another", transport: "stdio" } });
  await tauriRuntime.invoke("mcp_runtime_status", { server_id: "another" });
  assert.deepEqual(calls.map((call) => call.command), ["lan_pc_invoke", "lan_pc_invoke"]);
});
