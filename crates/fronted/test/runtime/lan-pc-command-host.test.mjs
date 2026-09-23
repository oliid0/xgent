import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

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
  assert.equal(calls[3].command, "plugin:mobile-assistant|status");
  assert.equal(host.getLanPcCommandHostConfig().remotePlatform, "windows");
});
