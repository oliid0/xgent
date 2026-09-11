import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function harness() {
  const requests = [];
  const statusRequests = [];
  const loader = createTsModuleLoader({ mocks: {
    "@tauri-apps/api/core": { async invoke(command, args) {
      requests.push({ command, args });
      if (command === "plugin:mobile-execution|status") {
        const pending = Promise.withResolvers();
        statusRequests.push(pending);
        return pending.promise;
      }
      if (command === "plugin:mobile-execution|install") return { installed: true };
      if (command === "mcp_list_tools") return [{ serverId: "remote", serverLabel: "Remote", name: "lookup", description: "Lookup", inputSchema: { type: "object" } }];
      if (command === "mcp_call_tool") return { content: [{ type: "text", text: "remote result" }], isError: false, details: {} };
      if (command === "fs_list") return { entries: [{ kind: "file", path: "notes.txt" }], offset: 0, total: 1, hasMore: false };
      throw new Error(`Unexpected IPC: ${command}`);
    } },
    "@tauri-apps/api/path": { homeDir: async () => "/sandbox" },
  } });
  const mobile = loader.loadModule("src/lib/mobileExecution.ts");
  const { buildBuiltinToolRegistry } = loader.loadModule("src/lib/tools/builtinRegistry.ts");
  const { createFileToolState } = loader.loadModule("src/lib/tools/fileToolState.ts");
  const build = (overrides = {}) => buildBuiltinToolRegistry({
    workdir: "/sandbox/workspace", providerId: "codex", runtimePlatform: "ios",
    nativeMobileRuntime: true, fileState: createFileToolState(), skillsEnabled: true,
    runtimeScope: "chat", selectedSystemToolIds: [],
    getMcpSettings: () => ({ selected: ["remote"], servers: [{ id: "remote", enabled: true, transport: "http", url: "https://mcp.example.test" }] }),
    ...overrides,
  });
  return { requests, statusRequests, loader, mobile, build };
}

const ready = { available: true, installed: true, capabilities: { shell: true } };

test("a pending Shell probe does not block native file and network MCP tool execution", async () => {
  const h = harness();
  const pendingStatus = h.mobile.mobileExecutionStatus();
  const registry = await h.build();
  const names = registry.tools.map((tool) => tool.name);
  for (const name of ["Read", "Write", "Edit", "List", "SkillsManager", "McpManager", "browser_use", "MobilePersonalData", "MobilePersonalActions", "MobileEnvironment"]) {
    assert.ok(names.includes(name), name);
  }
  assert.ok(!names.includes("Bash"));
  assert.ok(!names.includes("ManagedProcess"));
  const list = await registry.executeToolCall({ id: "files", name: "List", arguments: { path: "." } });
  assert.equal(list.isError, false);
  assert.match(list.content[0].text, /notes.txt/);
  const remote = await registry.executeToolCall({ id: "lookup", name: "mcp_remote_lookup", arguments: {} });
  assert.equal(remote.isError, false);
  assert.equal(remote.content[0].text, "remote result");
  assert.ok(!h.requests.some(({ command }) => command.startsWith("shell_")));
  h.statusRequests[0].resolve({ ...ready, installed: false });
  await pendingStatus;
  const { buildToolsSuffix } = h.loader.loadModule("src/lib/chat/runner/toolExecutionPrompt.ts");
  assert.match(buildToolsSuffix("/sandbox/workspace", names, "ios"), /Do not require its installation/);
});

test("verified Shell is added on the next turn and failures revoke only Shell", async () => {
  const h = harness();
  const first = h.mobile.mobileExecutionStatus();
  h.statusRequests[0].resolve(ready);
  await first;
  assert.ok((await h.build()).hasTool("Bash"));
  const failed = h.mobile.mobileExecutionStatus();
  h.statusRequests[1].reject(new Error("native status unavailable"));
  await assert.rejects(failed, /unavailable/);
  const next = await h.build();
  assert.equal(next.hasTool("Bash"), false);
  assert.equal(next.hasTool("Write"), true);
  assert.equal((await h.build({ nativeMobileRuntime: false })).hasTool("Bash"), true);
  assert.equal((await h.build({ lanPcCommandHostReady: true })).hasTool("Bash"), true);
});

test("out-of-order status results and pre-install probes cannot revive stale Shell capability", async () => {
  const h = harness();
  const old = h.mobile.mobileExecutionStatus();
  const current = h.mobile.mobileExecutionStatus();
  h.statusRequests[1].resolve({ ...ready, installed: false });
  await current;
  h.statusRequests[0].resolve(ready);
  await old;
  assert.equal(h.mobile.isMobileShellAvailable(), false);
  const beforeInstall = h.mobile.mobileExecutionStatus();
  await h.mobile.installMobileEnvironment();
  h.statusRequests[2].resolve(ready);
  await beforeInstall;
  assert.equal(h.mobile.isMobileShellAvailable(), false);
});
