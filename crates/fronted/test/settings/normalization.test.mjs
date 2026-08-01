import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const settings = loader.loadModule("src/lib/settings/index.ts");

test("default settings keep external access and mobile sandboxes closed", () => {
  const value = settings.getDefaultSettings();
  assert.equal(value.system.executionMode, "tools");
  assert.equal(value.access.webUiEnabled, false);
  assert.equal(value.access.webUiScope, "lan");
  assert.equal(value.access.webUiPort, 28_367);
  assert.equal(value.access.cloudExecutionEnabled, false);
  assert.equal(value.access.githubRepository, "agent-temp");
  assert.equal(value.access.androidProotEnabled, false);
  assert.equal(value.access.iosAShellEnabled, false);
  assert.equal(value.system.terminalShell, "auto");
});

test("access settings clamp ports and cloud artifact retention", () => {
  const value = settings.normalizeAccessSettings({
    webUiEnabled: true,
    webUiScope: "loopback",
    webUiPort: 99_999,
    allowTerminal: true,
    cloudExecutionEnabled: true,
    githubOwner: " user ",
    githubRepository: " tasks ",
    cloudArtifactRetentionDays: 400,
    androidProotEnabled: true,
    iosAShellEnabled: true,
  });
  assert.deepEqual(value, {
    webUiEnabled: true,
    webUiScope: "loopback",
    webUiPort: 65_535,
    lanControlUrl: "",
    preferLanPcExecution: false,
    allowTerminal: true,
    allowBrowserAutomation: false,
    allowSsh: false,
    allowGit: false,
    allowFileWrite: false,
    cloudExecutionEnabled: true,
    githubOwner: "user",
    githubRepository: "tasks",
    cloudArtifactRetentionDays: 90,
    androidProotEnabled: true,
    iosAShellEnabled: true,
  });
});

test("custom provider routing strips endpoint suffixes and filters inactive models", () => {
  const provider = settings.normalizeCustomProvider({
    id: " openai-main ",
    name: " OpenAI ",
    type: "codex",
    baseUrl: "https://api.example.com/v1/responses/",
    apiKey: " secret ",
    models: ["gpt-a", "gpt-b"],
    activeModels: ["gpt-a", "missing"],
  });
  assert.equal(provider.id, "openai-main");
  assert.equal(provider.baseUrl, "https://api.example.com/v1");
  assert.equal(provider.requestFormat, "openai-responses");
  assert.equal(provider.apiKey, "secret");
  assert.equal(provider.apiKeyConfigured, true);
  assert.deepEqual(provider.activeModels, ["gpt-a"]);
});

test("MCP normalization preserves HTTP headers and bounds timeout defaults", () => {
  const mcp = settings.normalizeMcpSettings({
    servers: [
      {
        id: " github ",
        enabled: true,
        transport: "http",
        url: " https://example.test/mcp ",
        headers: { Authorization: "Bearer token" },
        timeoutMs: -1,
      },
    ],
    selected: ["github", "missing"],
  });
  assert.equal(mcp.servers[0].id, "github");
  assert.equal(mcp.servers[0].url, "https://example.test/mcp");
  assert.equal(mcp.servers[0].timeoutMs, 60_000);
  assert.deepEqual(mcp.servers[0].headers, { Authorization: "Bearer token" });
  assert.deepEqual(mcp.selected, ["github"]);
});

test("system proxy normalization keeps configured state without inventing secrets", () => {
  const proxy = settings.normalizeSystemProxyConfig({
    enabled: true,
    type: "socks5",
    host: " 127.0.0.1 ",
    port: "1080",
    username: " user ",
    passwordConfigured: true,
  });
  assert.deepEqual(proxy, {
    enabled: true,
    type: "socks5",
    host: "127.0.0.1",
    port: 1080,
    username: "user",
    password: "",
    passwordConfigured: true,
  });
});

test("workspace path keys normalize Windows aliases and POSIX trailing separators", () => {
  assert.equal(settings.workspaceProjectPathKey("C:\\Work\\Repo\\"), "c:/work/repo");
  assert.equal(settings.workspaceProjectPathKey("c:/work/repo"), "c:/work/repo");
  assert.equal(settings.workspaceProjectPathKey("/work/repo/"), "/work/repo");
});

test("agent templates allow only one enabled template", () => {
  const templates = settings.normalizeAgentPromptTemplates([
    { id: "a", name: "A", prompt: "one", enabled: true },
    { id: "b", name: "B", prompt: "two", enabled: true },
  ]);
  assert.equal(templates[0].enabled, true);
  assert.equal(templates[1].enabled, false);
});

test("selected model JSON rejects incomplete and invalid values", () => {
  const value = { customProviderId: "p", model: "m" };
  assert.deepEqual(settings.parseSelectedModelJson(settings.serializeSelectedModelJson(value)), value);
  assert.equal(settings.parseSelectedModelJson("{"), undefined);
  assert.equal(settings.normalizeSelectedModel({ model: "m" }), undefined);
});
