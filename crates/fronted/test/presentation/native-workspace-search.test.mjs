import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function harness({ mobile = false, history = async () => [], files = async () => ({ paths: [] }) } = {}) {
  let cursor = 0;
  const slots = [], effects = [], calls = [];
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  function effect(run, deps) {
    const index = cursor++, previous = slots[index];
    if (!previous || !equal(deps, previous.deps)) {
      effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: run() }; });
    }
  }
  const t = key => key;
  const loader = createTsModuleLoader({ mocks: {
    react: {
      useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = typeof value === "function" ? value() : value;
        return [slots[index], next => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; },
      useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
      useMemo(create, deps) { const index = cursor++; if (!slots[index] || !equal(deps, slots[index].deps)) slots[index] = { deps, value: create() }; return slots[index].value; },
      useEffect: effect,
    },
    "../i18n": { useLocale: () => ({ t }) },
    "../lib/runtimePlatform": { isNativeMobileRuntime: () => mobile },
    "../chat/history/chatHistory": { searchChatHistory: history },
    "../tools/fsBackend": { invokeFs: files },
    "./NativeSurface": { NativeSurface: "NativeSurface" },
    "./nativeTheme": { createNativePresentationTheme: () => ({}) },
  } });
  const { NativeWorkspaceSearchPalette } = loader.loadModule("src/presentation/NativeWorkspaceSearchPalette.tsx");
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  const registry = createPresentationActionRegistry();
  const props = { open: true, workdir: "/work", conversations: [{ id: "recent", title: "Recent", updatedAt: 5 }], settings: { theme: "system" },
    onOpenChange: value => { props.open = value; calls.push(["open", value]); },
    onSelectConversation: id => calls.push(["chat", id]), onOpenFile: path => calls.push(["file", path]),
    onOpenSettings: section => calls.push(["settings", section]), onNewConversation: () => calls.push(["new"]), onCreateProject: () => calls.push(["folder"]),
  };
  let request = 0, revision = 0;
  const render = () => {
    cursor = 0;
    const { document, handlers } = NativeWorkspaceSearchPalette(props).props;
    validatePresentationDocument({ ...document, version: 1, surface: "search", revision: ++revision }, handlers);
    registry.register("search", handlers);
    effects.splice(0).forEach(run => run());
    return document;
  };
  const find = (document, id) => {
    const visit = nodes => { for (const node of nodes) { if (node.id === id) return node; const found = visit(node.children ?? []); if (found) return found; } };
    return visit(document.nodes);
  };
  return { props, calls, render, find,
    dispatch: (action, value = null) => registry.dispatch({ action, value, surface: "search", requestId: String(++request) }),
    wait: async () => { await new Promise(resolve => setTimeout(resolve, 230)); return render(); },
    unmount: () => { for (const slot of slots) slot?.cleanup?.(); registry.remove("search"); },
  };
}

test("native search uses full settings/actions and closes before selecting the shared result", async () => {
  for (const mobile of [false, true]) {
    const h = harness({ mobile });
    try {
      h.render(); const doc = h.render();
      assert.equal(doc.formFactor, mobile ? "mobile" : "desktop");
      assert.equal(doc.nodes[0].variant, "workspace-search-palette");
      const row = h.find(doc, "workspace-search-result:0");
      assert.equal(row.label, "Recent");
      assert.equal((await h.dispatch(row.action)).ok, true);
      assert.deepEqual(h.calls, [["open", false], ["chat", "recent"]]);
    } finally { h.unmount(); }
  }
});

test("native search disables old results immediately and rejects actions from retired queries and workspaces", async () => {
  const h = harness({ history: async query => [{ conversationId: query, title: query, snippet: "Message contents" }], files: async () => ({ paths: ["/work/report.md"] }) });
  try {
    h.render(); let doc = h.render();
    const old = h.find(doc, "workspace-search-result:0");
    assert.equal((await h.dispatch(h.find(doc, "workspace-search-query").action, "report")).ok, true);
    doc = h.render();
    assert.equal(h.find(doc, "workspace-search-result:0").disabled, true);
    assert.equal((await h.dispatch(old.action)).ok, false);
    doc = await h.wait();
    const chat = h.find(doc, "workspace-search-result:0"), file = h.find(doc, "workspace-search-result:1");
    assert.equal(chat.text, "Message contents"); assert.equal(file.label, "/work/report.md");
    h.props.workdir = "/another"; doc = h.render();
    assert.equal((await h.dispatch(file.action)).ok, false);
    doc = await h.wait();
    assert.equal((await h.dispatch(h.find(doc, "workspace-search-result:0").action)).ok, true);
    assert.deepEqual(h.calls, [["open", false], ["chat", "report"]]);
  } finally { h.unmount(); }
});

test("native search reports partial failure, retries through the real source and blocks old actions during retry", async () => {
  let offline = true;
  const h = harness({ history: async () => { if (offline) throw Error("offline"); return [{ conversationId: "found", title: "Found", snippet: "" }]; } });
  try {
    h.render(); let doc = h.render();
    await h.dispatch(h.find(doc, "workspace-search-query").action, "settings"); h.render(); doc = await h.wait();
    assert.equal(h.find(doc, "workspace-search-error").text, "chat.history.searchFailed");
    const before = h.find(doc, "workspace-search-result:0");
    offline = false; await h.dispatch(h.find(doc, "workspace-search-retry").action); doc = h.render();
    assert.equal(h.find(doc, "workspace-search-result:0").disabled, true);
    assert.equal((await h.dispatch(before.action)).ok, false);
    doc = await h.wait(); assert.equal(h.find(doc, "workspace-search-error"), undefined);
    assert.equal(h.find(doc, "workspace-search-result:0").label, "Found");
  } finally { h.unmount(); }
});

test("unmount cancels a pending native search without late navigation or publication", async () => {
  let finish;
  const h = harness({ history: () => new Promise(resolve => { finish = resolve; }) });
  h.render(); let doc = h.render();
  await h.dispatch(h.find(doc, "workspace-search-query").action, "late"); h.render();
  await new Promise(resolve => setTimeout(resolve, 200)); h.unmount();
  finish([{ conversationId: "retired", title: "Old", snippet: "" }]);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(h.calls, []);
});
