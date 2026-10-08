import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const base = createTsModuleLoader();
const registry = base.loadModule("src/lib/mcpRegistry/index.ts");
const { getDefaultSettings } = base.loadModule("src/lib/settings/index.ts");
const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const card = (id = "docs") => ({ id, sourceId: id, source: "official", name: id, displayName: `Server ${id}`,
  description: "Documentation server", verified: true, remote: true, tags: ["docs"], transportHints: ["sse"],
  detailUrl: "https://example.test/docs", homepageUrl: "https://example.test/docs", repositoryUrl: "https://example.test/repository" });

function harness(resolve, initial = {}) {
  const hooks = createReactHookHarness(); const installed = [], opened = []; let closed = 0;
  const loader = createTsModuleLoader({ mocks: {
    react: hooks.react, "@xgent/runtime": { openUrl: async url => { opened.push(url); } },
    "../i18n": { useLocale: () => ({ t: key => key }) },
    "../lib/mcpRegistry": { ...registry, resolveMcpRegistryInstallDraft: resolve },
    "./NativeSurface": { NativeSurface: "NativeSurface" },
    "./nativeTheme": { createNativePresentationTheme: () => undefined },
  } });
  const { NativeMcpRegistryPreview } = loader.loadModule("src/presentation/NativeMcpRegistryPreview.tsx");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  const props = { card: card(), settings: getDefaultSettings(), compact: true, allowStdio: false,
    installed: false, installing: false, installBusy: false, installError: "", close: () => closed++,
    install: async card => { installed.push(card); }, ...initial };
  const render = () => {
    const surface = hooks.render(() => NativeMcpRegistryPreview(props)).props;
    validatePresentationDocument({ ...surface.document, version: 1, revision: 1, surface: "preview" }, surface.handlers);
    return surface;
  };
  return { props, hooks, render, installed, opened, closed: () => closed,
    nodes: () => flatten(render().document.nodes), action: (id, value = null) => render().handlers.get(id).run(value) };
}

test("native MCP details are a dismissible sheet with shared metadata, protected keys and real install/external actions", async () => {
  const pending = deferred(); const h = harness(() => pending.promise);
  assert.equal(h.render().document.mode, "sheet");
  assert.equal(h.render().document.formFactor, "mobile");
  assert.equal(h.render().document.dismissAction, "close");
  assert.equal(h.nodes().find(node => node.id === "mcp-preview-install").disabled, true);
  const detail = { ...card(), installDraft: { status: "needs_config", commandPreview: "Connect over SSE", warnings: ["Requires account"],
    requiredConfig: [{ name: "TOKEN", label: "API token", target: "header", required: true, secret: true, description: "Your account token" }],
    server: { id: "docs", enabled: true, transport: "sse", url: "https://example.test/sse", messageUrl: "https://example.test/message", timeoutMs: 43210,
      headers: { Authorization: "secret-value" }, env: { TOKEN: "another-secret" }, args: [] } } };
  pending.resolve(detail); await settle();
  const nodes = h.nodes();
  const preview = h.render().document.nodes[0];
  assert.equal(preview.children.find(node => node.kind === "Heading").maxLines, 2);
  const footer = preview.children.find(node => node.variant === "extension-preview-footer");
  assert.ok(footer.children.some(node => node.id === "mcp-preview-install"));
  assert.ok(!flatten([preview.children.find(node => node.variant === "extension-preview-body")]).some(node => node.id === "mcp-preview-install"));
  assert.ok(nodes.find(node => node.id === "mcp-registry-preview:details").children.some(node => node.id === "mcp-preview:headers"));
  assert.equal(nodes.find(node => node.id === "mcp-preview:message-url:value").text, "https://example.test/message");
  assert.equal(nodes.find(node => node.id === "mcp-preview:timeout:value").text, "43210 ms");
  assert.equal(nodes.find(node => node.id === "mcp-preview:headers:value").text, "Authorization");
  assert.equal(nodes.find(node => node.id === "mcp-preview:env:value").text, "TOKEN");
  assert.ok(!JSON.stringify(nodes).includes("secret-value"));
  assert.ok(!JSON.stringify(nodes).includes("another-secret"));
  assert.equal(nodes.find(node => node.id === "mcp-preview-config:header:TOKEN:name").icon, "key");
  assert.equal(nodes.find(node => node.id === "mcp-preview-install").label, "mcpHub.storeConfigure");
  assert.equal(nodes.find(node => node.id === "mcp-preview-install").disabled, false);
  assert.deepEqual(nodes.filter(node => node.id.startsWith("mcp-preview-link:")).map(node => node.id), ["mcp-preview-link:detail", "mcp-preview-link:repository"]);
  await h.action("mcp-preview-link:detail"); await h.action("mcp-preview-install");
  assert.deepEqual(h.opened, ["https://example.test/docs"]); assert.deepEqual(h.installed, [detail]);
  h.props.installed = true; assert.equal(h.nodes().find(node => node.id === "mcp-preview-install").disabled, true);
  h.action("close"); assert.equal(h.closed(), 1); h.hooks.unmount();
});

test("retired MCP detail responses cannot replace another card or repaint after close", async () => {
  const old = deferred(), current = deferred(); const a = card("a"), b = card("b");
  const h = harness(card => card.id === "a" ? old.promise : current.promise, { card: a });
  h.render(); h.props.card = b; h.render();
  old.resolve({ ...a, description: "stale details" }); await settle();
  assert.equal(h.render().document.title, b.displayName);
  assert.equal(h.nodes().find(node => node.id === "mcp-preview-description").text, b.description);
  h.hooks.unmount(); current.resolve({ ...b, description: "closed details" }); await settle();
  assert.equal(h.nodes().find(node => node.id === "mcp-preview-description").text, b.description);
});

test("network-only MCP preview uses the shared host choice and desktop preview retains stdio", async () => {
  const loaded = { ...card(), installDraft: { status: "ready", commandPreview: "node server.js", requiredConfig: [], warnings: [], server: { id: "docs", enabled: true, transport: "stdio", command: "node", args: ["server.js"] } },
    networkDraft: { status: "ready", commandPreview: "https://example.test/mcp", requiredConfig: [], warnings: [], server: { id: "docs", enabled: true, transport: "http", url: "https://example.test/mcp", args: [] } } };
  for (const allowStdio of [false, true]) {
    const h = harness(async () => loaded, { card: loaded, allowStdio, compact: !allowStdio });
    h.render(); await settle();
    assert.equal(h.nodes().find(node => node.id === "mcp-preview:transport:value").text, allowStdio ? "stdio" : "http");
    await h.action("mcp-preview-install");
    assert.equal(h.installed[0].installDraft.server.transport, allowStdio ? "stdio" : "http");
    assert.equal(h.render().document.formFactor, allowStdio ? "desktop" : "mobile"); h.hooks.unmount();
  }
});

test("MCP preview retains original card on detail failure and displays retryable install failure", async () => {
  const h = harness(async () => { throw new Error("Registry offline"); });
  h.render(); await settle();
  assert.equal(h.nodes().find(node => node.id === "mcp-preview-error").text, "Registry offline");
  assert.equal(h.nodes().find(node => node.id === "mcp-preview-install").disabled, false);
  h.props.installBusy = true;
  assert.equal(h.nodes().find(node => node.id === "mcp-preview-install").disabled, true);
  h.props.installBusy = false; h.props.installError = "Configuration required";
  assert.equal(h.nodes().find(node => node.id === "mcp-preview-install-error").label, "Configuration required");
  h.hooks.unmount();
});
