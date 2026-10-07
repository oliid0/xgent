import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const t = key => key;
const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));
const baseLoader = createTsModuleLoader();
const { normalizeSettings } = baseLoader.loadModule("src/lib/settings/index.ts");
const { blankDraft, draftFromServer, buildServerFromDraft } = baseLoader.loadModule("src/lib/mcpServerDraft.ts");
const { saveMcpServer, removeMcpServer } = baseLoader.loadModule("src/lib/mcpServerSettings.ts");
const server = (id = "docs") => ({ id, enabled: false, transport: "stdio", command: "node", cwd: "/project with spaces",
  args: ["/path with spaces/server.js", "--name=two words"], env: { TOKEN: "a=b", LANG: "zh_CN" }, timeoutMs: 43210 });

test("MCP drafts preserve full stdio and SSE parameters with the desktop parser", () => {
  const stdio = server();
  assert.deepEqual(buildServerFromDraft(draftFromServer(stdio), stdio, [], t), { ...stdio, url: "", messageUrl: undefined, headers: undefined });
  const sse = buildServerFromDraft({ ...draftFromServer(stdio), transport: "sse", url: "https://example.test/sse",
    messageUrl: "https://example.test/message", headersText: "Authorization=Bearer a=b\nX-Request=中文" }, stdio, [], t);
  assert.equal(sse.enabled, false); assert.equal(sse.cwd, undefined); assert.equal(sse.env, undefined);
  assert.equal(sse.messageUrl, "https://example.test/message");
  assert.deepEqual(sse.headers, { Authorization: "Bearer a=b", "X-Request": "中文" });
  assert.deepEqual(sse.args, []);
  assert.equal(buildServerFromDraft({ ...draftFromServer(sse), transport: "http" }, sse, [], t).messageUrl, undefined);
  assert.throws(() => buildServerFromDraft({ ...blankDraft([]), command: "node", envText: "INVALID" }, null, [], t), /invalidKeyValue/);
  assert.throws(() => buildServerFromDraft(draftFromServer(stdio), stdio, ["docs"], t), /duplicateName/);
});

test("MCP edits and deletion retain server identity, concurrent enable state and renamed policy", () => {
  const initial = normalizeSettings({ mcp: { servers: [server("other"), server()], selected: ["docs"], computerUseDriverId: "docs" }, system: { toolPolicies: { "server:docs": "deny", "group:mcp": "ask" } } });
  const reordered = normalizeSettings({ ...initial, mcp: { ...initial.mcp, servers: [{ ...server(), enabled: true }, server("other")] } });
  const next = saveMcpServer(reordered, { ...server(), id: "new name", command: "new-command" }, "docs", t);
  assert.equal(next.mcp.servers.find(item => item.id === "other").command, "node");
  assert.equal(next.mcp.servers.find(item => item.id === "new name").enabled, true);
  assert.equal(next.system.toolPolicies["server:new name"], "deny");
  assert.equal(next.system.toolPolicies["server:docs"], undefined);
  assert.deepEqual(next.mcp.selected, ["new name"]);
  assert.equal(next.mcp.computerUseDriverId, "new name");
  assert.throws(() => saveMcpServer(next, server("other"), "new name", t), /duplicateName/);
  assert.throws(() => saveMcpServer(removeMcpServer(initial, "docs"), server(), "docs", t), /noServers/);
  const removed = removeMcpServer(next, "new name");
  assert.deepEqual(removed.mcp.servers.map(item => item.id), ["other"]);
  assert.equal(removed.system.toolPolicies["server:new name"], undefined);
  assert.equal(removed.system.toolPolicies["group:mcp"], "ask");
  assert.equal(initial.mcp.servers[1].command, "node");
});

function harness(componentName, options = {}) {
  const hooks = createReactHookHarness(); let closes = 0, saves = [], settings = normalizeSettings({ mcp: { servers: [server()] } });
  const mocks = {
    react: { ...hooks.react, memo: component => component },
    "../../i18n": { useLocale: () => ({ t }) },
    "../../lib/runtimePlatform": { isNativeMobileRuntime: () => options.mobile ?? false },
    "../../runtime/applePresentation": { isApplePresentationRuntime: () => true },
    "../../presentation/NativeSurface": { NativeSurface: "NativeSurface" },
    "../../presentation/nativeTheme": { createNativePresentationTheme: () => undefined },
    "../../components/icons": {},
    "../../components/hub/ToolPolicyToggle": {},
    "../../components/astryx/ConfirmActionPopover": {},
    "../settings/SettingsModalShell": {},
    "../../lib/skills": { scanExternalMcpServers: options.scan ?? (async () => []), scanMcpConfigContent: options.scanFile ?? (async () => null) },
  };
  for (const name of ["Banner", "Button", "Dialog", "EmptyState", "FormLayout", "Icon", "IconButton", "Layout", "List", "Selector", "Switch", "Text", "TextArea", "TextInput", "Token", "CheckboxInput", "FileInput", "Grid", "Spinner", "StatusDot", "TabList"]) mocks[`@astryxdesign/core/${name}`] = {};
  const loader = createTsModuleLoader({ mocks });
  const component = loader.loadModule(`src/pages/mcp-hub/${componentName === "McpServerEditModal" ? "McpServersForm" : componentName}.tsx`)[componentName];
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  const props = componentName === "McpServerEditModal" ? { mode: "edit", initialServer: server(), existingServers: [server()],
    allowStdio: options.allowStdio ?? true, nativeSettings: settings, onClose: () => closes++, onSave: value => { if (options.save) options.save(value); saves.push(value); } }
    : { settings, setSettings: update => { settings = update(settings); props.settings = settings; }, allowStdio: options.allowStdio ?? true };
  const render = () => {
    const surface = hooks.render(() => component(props));
    validatePresentationDocument({ ...surface.props.document, version: 1, surface: "mcp-test", revision: 1 }, surface.props.handlers);
    return surface.props;
  };
  const action = (id, value = null, published = render()) => {
    const handler = published.handlers.get(id); assert.ok(handler, id); assert.ok(handler.enabled, id); assert.ok(handler.accepts(value), id);
    return handler.run(handler.normalize ? handler.normalize(value) : value);
  };
  render(); return { render, action, props, settings: () => settings, nodes: () => flatten(render().document.nodes),
    saves: () => saves, closes: () => closes, unmount: () => hooks.unmount(), replay: () => hooks.replayEffects() };
}

test("native MCP editor exposes all fields and saves final input before another render", () => {
  const h = harness("McpServerEditModal"); const published = h.render();
  assert.equal(published.document.formFactor, "desktop");
  for (const id of ["id", "timeoutMs", "command", "cwd", "argsText", "envText"]) assert.ok(h.nodes().some(node => node.id === `mcp-editor-${id}`));
  h.action("mcp-editor-argsText", "/second path/server.js\n--name=final text", published);
  h.action("mcp-editor-envText", "TOKEN=changed=secret", published);
  h.action("mcp-editor-timeoutMs", "120001", published);
  h.action("mcp-editor-save", null, published); h.action("mcp-editor-save", null, published);
  assert.equal(h.saves().length, 1); assert.equal(h.closes(), 1);
  assert.deepEqual(h.saves()[0].args, ["/second path/server.js", "--name=final text"]);
  assert.deepEqual(h.saves()[0].env, { TOKEN: "changed=secret" }); assert.equal(h.saves()[0].timeoutMs, 120001);
  h.unmount();
});

test("native MCP editor retains invalid drafts, catches failed persistence and restricts mobile stdio", () => {
  let fail = true; const h = harness("McpServerEditModal", { save: () => { if (fail) throw Error("persist failed"); } });
  h.action("mcp-editor-envText", "missing separator"); h.action("mcp-editor-save");
  assert.match(h.nodes().find(node => node.id === "mcp-editor-error").label, /invalidKeyValue/);
  h.action("mcp-editor-envText", "TOKEN=value"); h.action("mcp-editor-save");
  assert.equal(h.nodes().find(node => node.id === "mcp-editor-error").label, "persist failed"); assert.equal(h.closes(), 0);
  fail = false; h.action("mcp-editor-save"); assert.equal(h.saves().length, 1); h.unmount();
  const mobile = harness("McpServerEditModal", { mobile: true, allowStdio: false });
  assert.equal(mobile.render().document.formFactor, "mobile");
  assert.ok(!mobile.nodes().find(node => node.id === "mcp-editor-transport").options.some(option => option.value === "stdio"));
  mobile.action("mcp-editor-save"); assert.equal(mobile.saves().length, 0);
  mobile.action("mcp-editor-transport", "sse"); mobile.action("mcp-editor-url", "https://test/sse");
  mobile.action("mcp-editor-messageUrl", "https://test/message"); mobile.action("mcp-editor-headersText", "Authorization=Bearer secret");
  mobile.action("mcp-editor-save"); assert.equal(mobile.saves()[0].messageUrl, "https://test/message");
  mobile.unmount();
});

const scanFixture = () => ({ tool: "codex", configPath: "/Users/test/.codex/config.toml", exists: true, errors: ["malformed entry"], servers: [
  { ...server("new-stdio"), origin: "user", url: "", headers: {} },
  { ...server("network"), transport: "http", command: "", args: [], env: {}, url: "https://test/mcp", headers: { Authorization: "Bearer secret" }, origin: "project" },
] });

test("native MCP import selects real scan results, preserves parameters, and prevents duplicate imports", async () => {
  let calls = 0; const h = harness("McpImportView", { scan: async () => { calls++; return [scanFixture()]; } });
  await settle(); h.render();
  assert.ok(h.nodes().some(node => node.id === "mcp-import-unparsable"));
  h.action("mcp-import-select-all", true); h.action("mcp-import-save");
  assert.equal(h.settings().mcp.servers.length, 3);
  const network = h.settings().mcp.servers.find(item => item.id === "network"); assert.deepEqual(network.headers, { Authorization: "Bearer secret" });
  const stdio = h.settings().mcp.servers.find(item => item.id === "new-stdio"); assert.deepEqual(stdio.args, server().args);
  assert.equal(stdio.cwd, "/project with spaces"); assert.equal(stdio.timeoutMs, 43210);
  assert.equal(h.render().handlers.get("mcp-import-save").enabled, false); assert.equal(calls, 1); h.unmount();
});

test("failed MCP scans wait for explicit retry; obsolete results and replayed effects cannot publish", async () => {
  let calls = 0; const pending = deferred();
  const h = harness("McpImportView", { scan: async () => { calls++; if (calls === 1) throw Error("scan failed"); return pending.promise; } });
  await settle(); h.render(); h.render(); assert.equal(calls, 1);
  assert.equal(h.nodes().find(node => node.id === "mcp-import-scan-error").text, "scan failed");
  const published = h.render(); const retry = h.action("mcp-import-rescan", null, published);
  h.action("mcp-import-rescan", null, published); assert.equal(calls, 2);
  h.unmount(); pending.resolve([scanFixture()]); await retry;
  assert.equal(h.nodes().some(node => node.id === "mcp-import-path"), false);
});

test("MCP import on mobile disables stdio selection and imports only network connections", async () => {
  const h = harness("McpImportView", { mobile: true, allowStdio: false, scan: async () => [scanFixture()] });
  await settle(); h.render();
  assert.equal(h.render().handlers.has("mcp-import:codex:new-stdio:selected"), false);
  h.action("mcp-import-select-all", true); h.action("mcp-import-save");
  assert.deepEqual(h.settings().mcp.servers.map(item => item.id), ["docs", "network"]); h.unmount();
});

test("native MCP config picker passes actual JSON to the Rust scanner, rejects oversized files and ignores retired reads", async () => {
  const calls = []; const h = harness("McpImportView", { scanFile: async (name, content) => {
    calls.push({ name, content }); return { ...scanFixture(), tool: "local-file", configPath: name };
  } });
  await settle(); h.render();
  assert.equal(h.nodes().find(node => node.id === "mcp-import-file").variant, "mcp-config");
  const payload = JSON.stringify([{ fileName: "my-config.json", contentBase64: Buffer.from('{"mcpServers":{}}').toString("base64"), mimeType: "application/json" }]);
  await h.action("mcp-import-file", payload);
  assert.deepEqual(calls, [{ name: "my-config.json", content: '{"mcpServers":{}}' }]);
  assert.equal(h.nodes().find(node => node.id === "mcp-import-source").value, "local-file");
  const oversized = JSON.stringify([{ fileName: "big.json", contentBase64: Buffer.alloc(16 * 1024 * 1024 + 1).toString("base64") }]);
  await h.action("mcp-import-file", oversized);
  assert.match(h.nodes().find(node => node.id === "mcp-import-file-error").text, /16 MiB/);
  assert.equal(calls.length, 1); h.unmount();
  const pending = deferred(); const retired = harness("McpImportView", { scanFile: () => pending.promise });
  await settle(); retired.render(); const reading = retired.action("mcp-import-file", payload);
  retired.unmount(); pending.resolve({ ...scanFixture(), tool: "local-file" }); await reading;
  assert.equal(retired.nodes().some(node => node.id === "mcp-import-source"), false);
});

test("native MCP hub keeps desktop import and group/server policy actions while mobile uses its compact route", async () => {
  for (const mobile of [false, true]) {
    const hooks = createReactHookHarness();
    let settings = normalizeSettings({ mcp: { servers: [server()] }, system: { toolPolicies: { "group:mcp": "ask" } } });
    const mocks = {
      react: hooks.react,
      "../../../i18n": { useLocale: () => ({ t }) },
      "../../../lib/runtimePlatform": { isNativeMobileRuntime: () => mobile },
      "../../../runtime/applePresentation": { isApplePresentationRuntime: () => true },
      "../../../presentation/NativeSurface": { NativeSurface: "NativeSurface" },
      "../../../presentation/NativeMcpRegistryPreview": { NativeMcpRegistryPreview: "NativeMcpRegistryPreview" },
      "../../../presentation/nativeTheme": { createNativePresentationTheme: () => undefined },
      "../../../components/astryx/useConfirmDialog": { useConfirmDialog: () => ({ confirm: async () => true, dialog: null }) },
      "../../../components/icons": {}, "./MobileHubChrome": {},
      "../../mcp-hub/McpRegistryBrowser": {},
      "../../mcp-hub/McpServersForm": { McpServerEditModal: "McpServerEditModal" },
      "../../mcp-hub/McpImportView": { McpImportView: "McpImportView" },
    };
    for (const name of ["Badge", "Button", "ClickableCard", "EmptyState", "IconButton", "Layout", "Switch", "Text", "Token"]) mocks[`@astryxdesign/core/${name}`] = {};
    const loader = createTsModuleLoader({ mocks });
    const { MobileMcpPage } = loader.loadModule("src/pages/chat/mobile/MobileMcpPage.tsx");
    const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
    const props = { settings, allowStdio: !mobile, onOpenSidebar() {}, setSettings: update => { settings = update(settings); props.settings = settings; } };
    const surface = tree => {
      if (tree?.type === "NativeSurface") return tree.props;
      for (const child of [tree?.props?.children].flat()) { const result = child && surface(child); if (result) return result; }
    };
    const render = () => hooks.render(() => MobileMcpPage(props));
    const action = (id, value = null) => { const result = surface(render()); return result.handlers.get(id).run(value); };
    const root = surface(render()); validatePresentationDocument({ ...root.document, version: 1, surface: "hub", revision: 1 }, root.handlers);
    assert.equal(root.document.formFactor, mobile ? "mobile" : "desktop");
    const tabs = flatten(root.document.nodes).find(node => node.id === "mcp-view");
    assert.equal(tabs.options.some(option => option.value === "import"), !mobile);
    action("mcp-group-policy", "deny"); action("mcp-server:docs:policy", "allow");
    assert.equal(settings.system.toolPolicies["group:mcp"], "deny"); assert.equal(settings.system.toolPolicies["server:docs"], "allow");
    action("mcp-server:docs:enabled", true); assert.equal(settings.mcp.servers[0].enabled, true);
    action("mcp-server:docs:edit"); const editor = render();
    assert.equal(editor.type, "McpServerEditModal"); assert.equal(editor.props.nativeSettings, settings); editor.props.onClose();
    if (!mobile) { action("mcp-view", "import"); const imported = render(); assert.equal(imported.type, "McpImportView"); imported.props.onChangeView("installed"); }
    await action("mcp-server:docs:delete"); assert.equal(settings.mcp.servers.length, 0);
    assert.equal(settings.system.toolPolicies["server:docs"], undefined); hooks.unmount();
  }
});

test("native MCP store opens a separate live preview and shares install state with its card", async () => {
  const hooks = createReactHookHarness(); const previousWindow = globalThis.window;
  globalThis.window = { setTimeout, clearTimeout };
  const registry = baseLoader.loadModule("src/lib/mcpRegistry/index.ts");
  const card = { id: "store-docs", sourceId: "docs", source: "official", name: "docs", displayName: "Docs",
    description: "Remote docs", verified: true, remote: true, tags: [], transportHints: ["http"],
    installDraft: { status: "ready", requiredConfig: [], warnings: [], commandPreview: "https://example.test/mcp",
      server: { id: "remote-docs", enabled: true, transport: "http", url: "https://example.test/mcp", args: [] } } };
  let settings = normalizeSettings({});
  const mocks = {
    react: hooks.react,
    "../../../i18n": { useLocale: () => ({ t }) },
    "../../../lib/runtimePlatform": { isNativeMobileRuntime: () => true },
    "../../../runtime/applePresentation": { isApplePresentationRuntime: () => true },
    "../../../lib/mcpRegistry": { ...registry, searchMcpRegistry: async () => ({ items: [card] }) },
    "../../../presentation/NativeSurface": { NativeSurface: "NativeSurface" },
    "../../../presentation/NativeMcpRegistryPreview": { NativeMcpRegistryPreview: "NativeMcpRegistryPreview" },
    "../../../presentation/nativeTheme": { createNativePresentationTheme: () => undefined },
    "../../../components/astryx/useConfirmDialog": { useConfirmDialog: () => ({ confirm: async () => true, dialog: null }) },
    "../../../components/icons": {}, "./MobileHubChrome": {}, "../../mcp-hub/McpRegistryBrowser": {},
    "../../mcp-hub/McpServersForm": {}, "../../mcp-hub/McpImportView": {},
  };
  for (const name of ["Badge", "Button", "ClickableCard", "EmptyState", "IconButton", "Layout", "Switch", "Text", "Token"]) mocks[`@astryxdesign/core/${name}`] = {};
  const loader = createTsModuleLoader({ mocks });
  const { MobileMcpPage } = loader.loadModule("src/pages/chat/mobile/MobileMcpPage.tsx");
  const props = { settings, allowStdio: false, onOpenSidebar() {}, setSettings: update => { settings = update(settings); props.settings = settings; } };
  const render = () => hooks.render(() => MobileMcpPage(props));
  function find(tree, type) {
    if (tree?.type === type) return tree.props;
    for (const child of [tree?.props?.children].flat()) { const result = child && find(child, type); if (result) return result; }
  }
  try {
    find(render(), "NativeSurface").handlers.get("mcp-view").run("store"); render();
    await new Promise(resolve => setTimeout(resolve, 10)); await settle();
    let root = find(render(), "NativeSurface");
    assert.equal(flatten(root.document.nodes).find(node => node.id === "mcp-store:store-docs:preview").kind, "NavigationRow");
    root.handlers.get("mcp-store:store-docs:preview").run(null);
    let preview = find(render(), "NativeMcpRegistryPreview");
    assert.equal(preview.card.id, card.id); assert.equal(preview.installed, false);
    assert.equal(find(render(), "NativeSurface").document.mode, "root");
    await preview.install(card); preview = find(render(), "NativeMcpRegistryPreview");
    assert.equal(preview.installed, true); assert.equal(settings.mcp.servers[0].url, "https://example.test/mcp");
    preview.close(); assert.equal(find(render(), "NativeMcpRegistryPreview"), undefined);
    root = find(render(), "NativeSurface"); assert.equal(root.document.mode, "root");
    assert.equal(flatten(root.document.nodes).find(node => node.id === "mcp-store:store-docs:install").disabled, true);
  } finally { hooks.unmount(); if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; }
});
