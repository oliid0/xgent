import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

// Exercise the adapter and real action/composer stores without an Apple SDK.
// Only React mounting and the native publication boundary are substituted.
function harness(overrides = {}) {
  const states = [];
  const cleanups = [];
  let cursor = 0;
  let mounted = false;
  const loader = createTsModuleLoader({ mocks: {
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
        return [states[index], (value) => { states[index] = value; }];
      },
      useRef(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = { current: initial };
        return states[index];
      },
      useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
      useEffect() {},
      useLayoutEffect(effect) { if (!mounted) cleanups.push(effect()); },
    },
    "../i18n": { useLocale: () => ({ t: (key) => key }) },
    "../lib/runtimePlatform": { isNativeMobileRuntime: () => false },
    "./NativeSurface": { NativeSurface: "NativeSurface" },
    "./nativeTheme": { createNativePresentationTheme: () => ({ marker: "theme" }) },
  } });
  const { NativeChatPage } = loader.loadModule("src/presentation/NativeChatPage.tsx");
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const { createLiveTranscriptStore } = loader.loadModule("src/lib/chat/conversation/liveTranscriptStore.ts");
  const registry = createPresentationActionRegistry();
  const props = {
    conversationId: "conversation",
    settings: { theme: "system", system: { executionMode: "text" }, customSettings: { appearance: { showThinking: true } } },
    composerRef: { current: null },
    sidebarStore: { subscribe: () => () => {}, getSnapshot: () => ({ conversations: [], hasMore: false }) },
    historyItems: [], liveTranscriptStore: createLiveTranscriptStore(),
    modelOptions: [{ value: "provider::model", providerName: "Provider", label: "Model" }],
    selectedValue: "provider::model", inputDisabled: false, inputPlaceholder: "Message",
    isSending: false, errorMessage: null, hasMoreHistory: false, pendingApprovals: [],
    projects: [], attachmentsEnabled: true, uploads: [], isUploading: false,
    onSend() {}, onStop() {}, onSelectModel() {}, onSelectConversation() {}, onSelectProject() {},
    onNewConversation() {}, onOpenSettings() {}, onOpenRemote() {}, onOpenBrowser() {},
    onOpenBrowserSettings() {}, onOpenGitReview() {}, onOpenBackgroundTasks() {}, onOpenFiles() {},
    onLoadEarlierHistory() {},
    onDecide: () => ({ ok: true }), onImportFiles: async () => {}, onCreateProject() {}, onOpenTerminal() {}, onChangeMode() {}, onRemoveUpload() {},
    ...overrides,
  };
  let request = 0;
  const render = () => {
    cursor = 0;
    const element = NativeChatPage(props);
    mounted = true;
    const surfaces = element.props.children.filter(Boolean);
    registry.register("chat", surfaces[0].props.handlers);
    for (const surface of surfaces.slice(1)) {
      registry.register(surface.props.document.mode === "sidebar" ? "sidebar" : "tools", surface.props.handlers);
    }
    return surfaces[0].props.document;
  };
  render();
  return {
    props, render,
    dispatch: (action, value = null, surface = "chat") =>
      registry.dispatch({ action, value, surface, requestId: String(++request) }),
    unmount: () => { for (const cleanup of cleanups) cleanup?.(); registry.remove("chat"); },
  };
}

test("native edits reach the shared composer used by send and conversation draft restoration", async () => {
  const sent = [];
  const h = harness({ onSend: () => sent.push(h.props.composerRef.current.getDraft().text) });
  assert.equal((await h.dispatch("send")).ok, false);
  assert.equal((await h.dispatch("draft", "Hello\r\nmodel")).ok, true);
  h.render();
  assert.equal((await h.dispatch("send")).ok, true);
  assert.deepEqual(sent, ["Hello\nmodel"]);
  h.props.onSelectConversation = () => h.props.composerRef.current.setText("Restored draft");
  h.props.sidebarStore.getSnapshot = () => ({ conversations: [{ id: "next", title: "Next" }] });
  h.render();
  assert.equal((await h.dispatch("conversation:next", null, "sidebar")).ok, true);
  assert.equal(h.props.composerRef.current.getDraft().text, "Restored draft");
  h.unmount();
  assert.equal(h.props.composerRef.current, null);
  assert.equal((await h.dispatch("send")).ok, false);
});

test("native Apple documents declare desktop shape and shared visual tokens", () => {
  const h = harness();
  const document = h.render();
  assert.equal(document.formFactor, "desktop");
  assert.deepEqual(document.theme, { marker: "theme" });
  h.unmount();
});

test("native toolbar exposes a functional more menu for shared Apple workflows", async () => {
  const opened = [];
  const h = harness({
    onOpenTerminal: () => opened.push("terminal"),
    onOpenBrowser: () => opened.push("browser"),
    onOpenBrowserSettings: () => opened.push("browser-settings"),
    onOpenGitReview: () => opened.push("git"),
    onOpenRemote: () => opened.push("ssh"),
    onOpenBackgroundTasks: () => opened.push("background"),
  });
  const document = h.render();
  const toolbar = document.nodes[0].children.find((node) => node.id === "toolbar");
  assert.ok(toolbar.children.some((node) => node.id === "tools" && node.icon === "ellipsis"));
  assert.equal((await h.dispatch("tools")).ok, true);
  h.render();
  for (const id of ["terminal", "browser", "browser-settings", "git", "ssh", "background"]) {
    assert.equal((await h.dispatch(`tool:${id}`, null, "tools")).ok, true);
    if (id !== "background") {
      await h.dispatch("tools");
      h.render();
    }
  }
  assert.deepEqual(opened, ["terminal", "browser", "browser-settings", "git", "ssh", "background"]);
  h.unmount();
});

test("native sidebar routes skills, MCP, files, workspaces, recents, new chat and settings", async () => {
  const opened = [];
  const selected = [];
  const modes = [];
  const h = harness({
    projects: [{ id: "project", name: "Workspace" }],
    sidebarStore: {
      subscribe: () => () => {},
      getSnapshot: () => ({
        conversations: [{ id: "recent", title: "Recent chat" }],
        hasMore: false,
      }),
    },
    onOpenSettings: (section) => opened.push(section ?? "settings"),
    onOpenFiles: () => opened.push("files"),
    onCreateProject: () => opened.push("new-workspace"),
    onNewConversation: () => opened.push("new-chat"),
    onSelectProject: (project) => selected.push(project.id),
    onSelectConversation: (id) => selected.push(id),
    onChangeMode: (mode) => modes.push(mode),
  });
  for (const action of ["skills", "mcp", "files", "create-project", "new-chat", "settings"]) {
    assert.equal((await h.dispatch(action, null, "sidebar")).ok, true);
  }
  assert.equal((await h.dispatch("project:project", null, "sidebar")).ok, true);
  assert.equal((await h.dispatch("conversation:recent", null, "sidebar")).ok, true);
  assert.equal((await h.dispatch("sidebar-execution-mode", "tools", "sidebar")).ok, true);
  assert.deepEqual(opened, ["skills", "mcp", "files", "new-workspace", "new-chat", "settings"]);
  assert.deepEqual(selected, ["project", "recent"]);
  assert.deepEqual(modes, ["tools"]);
  h.unmount();
});

test("composer activity strip keeps tool preview left and todo progress right", () => {
  const h = harness({
    isSending: true,
    taskList: {
      runId: "run",
      revision: 2,
      tasks: [
        { id: "one", subject: "Inspect", description: "Inspect files", activeForm: "Inspecting", status: "completed" },
        { id: "two", subject: "Implement", description: "Implement fix", activeForm: "Implementing", status: "in_progress" },
      ],
    },
  });
  h.props.liveTranscriptStore.setToolStatus("Editing files");
  const document = h.render();
  const chat = document.nodes.find((node) => node.id === "chat");
  const composer = chat.children.find((node) => node.id === "composer");
  const strip = composer.children.find((node) => node.id === "activity-strip");
  assert.deepEqual(strip.children.map((node) => node.kind), ["ActivityPreview", "Spacer", "TaskProgress"]);
  const progress = strip.children.at(-1);
  assert.equal(progress.text, "1/2");
  assert.equal(progress.children[1].label, "Implement");
  assert.equal(progress.children[1].status, "running");
  h.unmount();
});

test("native controls enforce busy, model and attachment constraints at dispatch", async () => {
  let picked = 0;
  const selected = [];
  const h = harness({ onImportFiles: async () => { picked++; }, onSelectModel: (value) => selected.push(value) });
  await h.dispatch("draft", "Ready");
  h.props.inputDisabled = true;
  h.render();
  for (const [action, value] of [["draft", "Blocked"], ["send", null], ["attach", null]]) {
    assert.equal((await h.dispatch(action, value)).ok, false);
  }
  h.props.inputDisabled = false;
  h.props.attachmentsEnabled = false;
  h.render();
  assert.equal((await h.dispatch("attach")).ok, false);
  assert.equal((await h.dispatch("model", "unknown")).ok, false);
  assert.equal((await h.dispatch("model", "provider::model")).ok, true);
  assert.deepEqual(selected, [{ customProviderId: "provider", model: "model" }]);
  h.props.modelOptions = [];
  h.render();
  assert.equal((await h.dispatch("send")).ok, false);
  h.props.attachmentsEnabled = true;
  h.render();
  assert.equal((await h.dispatch("attach", "[]")).ok, true);
  assert.equal(picked, 1);
  h.unmount();
});

test("native documents consume live output and report tool approval failures", async () => {
  const decisions = [];
  let stopped = false;
  const h = harness({
    isSending: true, onStop: () => { stopped = true; },
    pendingApprovals: [{ toolCallId: "call", toolName: "Write", summary: "Write a file", deadlineAt: Date.now() + 60_000 }],
    onDecide: (id, decision) => { decisions.push([id, decision]); return { ok: false, message: "Request expired" }; },
  });
  h.props.liveTranscriptStore.appendDraftAssistantText("Streaming response");
  h.props.liveTranscriptStore.setToolStatus("Reading files");
  const document = h.render();
  const transcript = document.nodes[0].children.find((node) => node.id === "transcript");
  const liveMessage = transcript.children.find((node) => node.id === "live:assistant");
  assert.deepEqual(liveMessage.children.map((node) => node.text ?? node.label), [
    "Streaming response",
    "Reading files",
  ]);
  const result = await h.dispatch("approval:call:approve");
  assert.equal(result.ok, false);
  assert.match(result.error, /Request expired/);
  assert.deepEqual(decisions, [["call", "approve"]]);
  assert.equal((await h.dispatch("stop")).ok, true);
  assert.equal(stopped, true);
  h.unmount();
});
