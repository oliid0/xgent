import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function sidebarSnapshot(conversations = []) {
  return {
    conversations,
    byId: new Map(conversations.map((item) => [item.id, item])),
    workspaceHistory: new Map(),
    recentHistory: { limit: 80, hasMore: false, loading: false, loaded: true, error: null },
    hasMore: false,
    mutations: new Map(),
    mutationErrors: new Map(),
    runningConversationIds: new Set(),
  };
}

function assistantWork(transcript, id) {
  const message = transcript.children.find((node) => node.id === id);
  const work = message.children.find((node) => node.id === `${id}:work`);
  assert.equal(work?.kind, "Collapsible");
  return work.children;
}

// Exercise the adapter and real action/composer stores without an Apple SDK.
// Only React mounting and the native publication boundary are substituted.
function harness(overrides = {}, options = {}) {
  const mobile = options.mobile ?? false;
  const states = [];
  const cleanups = [];
  let cursor = 0;
  let mounted = false;
  const loader = createTsModuleLoader({ mocks: {
    ...(options.invoke ? { "@tauri-apps/api/core": { invoke: options.invoke } } : {}),
    react: {
      lazy: () => "NativeDesktopTrajectory",
      Suspense: "Suspense",
      useState(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
        return [states[index], (value) => {
          states[index] = typeof value === "function" ? value(states[index]) : value;
        }];
      },
      useRef(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = { current: initial };
        return states[index];
      },
      useMemo: (create) => create(),
      useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
      useEffect() {},
      useLayoutEffect(effect) { if (!mounted) cleanups.push(effect()); },
    },
    "../i18n": { useLocale: () => ({ t: (key) => key }) },
    "../lib/runtimePlatform": { isNativeMobileRuntime: () => mobile },
    "./NativeSurface": { NativeSurface: "NativeSurface" },
    "./nativeTheme": { createNativePresentationTheme: () => ({ marker: "theme" }) },
  } });
  const { NativeChatPage } = loader.loadModule("src/presentation/NativeChatPage.tsx");
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const { createLiveTranscriptStore } = loader.loadModule("src/lib/chat/conversation/liveTranscriptStore.ts");
  const registry = createPresentationActionRegistry();
  const props = {
    conversationId: "conversation",
    uploadWorkdir: "/project",
    settings: { theme: "system", system: { executionMode: "text" }, customSettings: { appearance: { showThinking: true } } },
    composerRef: { current: null },
    sidebarStore: { subscribe: () => () => {}, getSnapshot: () => sidebarSnapshot() },
    historyItems: [], liveTranscriptStore: createLiveTranscriptStore(),
    modelOptions: [{ value: "provider::model", providerId: "provider", providerName: "Provider", label: "Model" }],
    chatRuntimeControls: { thinkingEnabled: false, nativeWebSearchEnabled: false, planModeEnabled: false, reasoning: "low" },
    reasoningOptions: ["low", "high"], thinkingAlwaysOn: false, onChatRuntimeControlsChange() {},
    selectedValue: "provider::model",
    contextUsageTokensSource: { subscribe: () => () => {}, getContextUsageTokens: () => 45_000 },
    contextWindow: 100_000,
    inputDisabled: false, inputPlaceholder: "Message",
    isSending: false, errorMessage: null, hasMoreHistory: false, pendingApprovals: [],
    projects: [], attachmentsEnabled: true, uploads: [], isUploading: false,
    onSend() {}, onStop() {}, onSelectModel() {}, onSelectConversation() {}, onSelectProject() {},
    onConversationDeleted() {}, onConversationCwdChanged() {},
    queuedTurns: [], onRunQueuedTurnNow() {}, onMoveQueuedTurnUp() {}, onEditQueuedTurn() {}, onRemoveQueuedTurn() {},
    onNewConversation() {}, onOpenSettings() {}, onOpenRemote() {}, onOpenBrowser() {},
    onOpenSkillsHub() {}, onOpenMcpHub() {},
    onOpenBrowserSettings() {}, onOpenGitReview() {}, onOpenBackgroundTasks() {}, onOpenFiles() {},
    onOpenWorkspaceFile() {},
    onLoadEarlierHistory() {},
    onDecide: () => ({ ok: true }), onImportFiles: async () => {}, onCreateProject() {}, onOpenTerminal() {}, onChangeMode() {}, onRemoveUpload() {},
    ...overrides,
  };
  let request = 0;
  let lastSurfaces = [];
  const render = () => {
    cursor = 0;
    const element = NativeChatPage(props);
    mounted = true;
    const surfaces = element.props.children.filter(Boolean);
    lastSurfaces = surfaces;
    registry.register("chat", surfaces[0].props.handlers);
    for (const surface of surfaces.slice(1)) {
      const title = surface.props.document.title;
      registry.register(surface.props.document.mode === "sidebar" ? "sidebar"
        : title === "chat.conversationRename" || title === "chat.conversationDelete" ? "conversation-dialog" : "tools", surface.props.handlers);
    }
    return surfaces[0].props.document;
  };
  render();
  return {
    props, render,
    documents: () => lastSurfaces.map((surface) => surface.props.document),
    dispatch: (action, value = null, surface = "chat") =>
      registry.dispatch({ action, value, surface, requestId: String(++request) }),
    unmount: () => { for (const cleanup of cleanups) cleanup?.(); registry.remove("chat"); },
  };
}

test("native edits reach the shared composer used by send and conversation draft restoration", async () => {
  const sent = [];
  const h = harness({ onSend: () => sent.push(h.props.composerRef.current.getDraft().text) });
  assert.equal((await h.dispatch("send")).ok, false);
  const edit = await h.dispatch("draft", "Hello\r\nmodel");
  assert.equal(edit.ok, true);
  assert.equal(edit.acceptedValue, "Hello\nmodel", "Swift receives the shared newline spelling");
  h.render();
  assert.equal((await h.dispatch("send")).ok, true);
  assert.deepEqual(sent, ["Hello\nmodel"]);
  h.props.composerRef.current.clear();
  assert.equal(h.render().nodes[0].children.find(node => node.id === "composer")
    .children.find(node => node.id === "draft").value, "");
  h.props.onSelectConversation = () => h.props.composerRef.current.setText("Restored draft");
  h.props.sidebarStore.getSnapshot = () => sidebarSnapshot([{ id: "next", title: "Next" }]);
  assert.equal((await h.dispatch("sidebar")).ok, true);
  h.render();
  assert.equal((await h.dispatch("conversation:next", null, "sidebar")).ok, true);
  assert.equal(h.props.composerRef.current.getDraft().text, "Restored draft");
  h.unmount();
  assert.equal(h.props.composerRef.current, null);
  assert.equal((await h.dispatch("send")).ok, false);
});

test("native mobile can queue a new draft while generation remains stoppable", async () => {
  let sends = 0;
  let stops = 0;
  const h = harness({ isSending: true, onSend: () => sends++, onStop: () => stops++ }, { mobile: true });
  assert.equal((await h.dispatch("send")).ok, false);
  assert.equal((await h.dispatch("draft", "Next instruction")).ok, true);
  const composer = h.render().nodes[0].children.find(node => node.id === "composer");
  const actions = composer.children.find(node => node.id === "composer-actions").children;
  assert.equal(actions.find(node => node.id === "send").label, "chat.queue.addToQueue");
  assert.ok(actions.some(node => node.id === "stop"));
  assert.equal((await h.dispatch("send")).ok, true);
  h.props.isUploading = true;
  h.render();
  assert.equal((await h.dispatch("send")).ok, false);
  assert.equal((await h.dispatch("stop")).ok, true);
  assert.equal(sends, 1);
  assert.equal(stops, 1);
  h.unmount();
});

test("native queued items route all operations and reject removed or previous-conversation actions", async () => {
  const calls = [];
  const h = harness({
    queuedTurns: [{ id: "a", previewText: "First", fileCount: 0 }, { id: "b", previewText: "", fileCount: 2 }],
    onRunQueuedTurnNow: id => calls.push(["run", id]),
    onMoveQueuedTurnUp: id => calls.push(["move", id]),
    onEditQueuedTurn: id => calls.push(["edit", id]),
    onRemoveQueuedTurn: id => calls.push(["remove", id]),
  }, { mobile: true });
  const queue = h.render().nodes[0].children.find(node => node.id === "composer")
    .children.find(node => node.id === "queued-turns");
  assert.equal(queue.children[0].maxHeight, 160);
  assert.equal(queue.children[0].children[1].children[0].children[0].text, "chat.queue.emptyMessage");
  assert.equal((await h.dispatch("queue:conversation:a:moveUp")).ok, false);
  for (const verb of ["moveUp", "edit", "runNow", "delete"]) {
    assert.equal((await h.dispatch(`queue:conversation:b:${verb}`)).ok, true);
  }
  assert.deepEqual(calls, [["move", "b"], ["edit", "b"], ["run", "b"], ["remove", "b"]]);
  h.props.queuedTurns = h.props.queuedTurns.slice(0, 1);
  h.render();
  assert.equal((await h.dispatch("queue:conversation:b:runNow")).ok, false);
  h.props.conversationId = "next";
  h.render();
  assert.equal((await h.dispatch("queue:conversation:a:delete")).ok, false);
  assert.equal((await h.dispatch("queue:next:a:delete")).ok, true);
  h.props.queuedTurns = [];
  assert.ok(!h.render().nodes[0].children.find(node => node.id === "composer")
    .children.some(node => node.id === "queued-turns"));
  h.unmount();
});

test("native queued edit and run wait for usable input while cleanup remains available", async () => {
  const calls = [];
  const h = harness({
    queuedTurns: [{ id: "a", previewText: "First", fileCount: 0 }],
    onRunQueuedTurnNow: () => calls.push("run"), onEditQueuedTurn: () => calls.push("edit"),
    onRemoveQueuedTurn: () => calls.push("remove"),
  });
  for (const state of [{ isUploading: true }, { isUploading: false, inputDisabled: true }]) {
    Object.assign(h.props, state);
    h.render();
    assert.equal((await h.dispatch("queue:conversation:a:edit")).ok, false);
    assert.equal((await h.dispatch("queue:conversation:a:runNow")).ok, false);
    assert.equal((await h.dispatch("queue:conversation:a:delete")).ok, true);
  }
  Object.assign(h.props, { inputDisabled: false, modelOptions: [] });
  h.render();
  assert.equal((await h.dispatch("queue:conversation:a:runNow")).ok, false);
  assert.equal((await h.dispatch("queue:conversation:a:edit")).ok, true);
  assert.deepEqual(calls, ["remove", "remove", "edit"]);
  h.unmount();
});

test("native focus is explicit and transcript scroll identity follows the conversation", () => {
  const h = harness();
  const input = () => h.render().nodes[0].children.find(node => node.id === "composer")
    .children.find(node => node.id === "draft");
  assert.equal(input().focusRequest, 0);
  h.props.composerRef.current.setText("Restored");
  assert.equal(input().focusRequest, 0);
  h.props.composerRef.current.focus();
  assert.equal(input().focusRequest, 1);
  assert.equal(input().focusRequest, 1);
  const transcript = () => h.render().nodes[0].children.find(node => node.id === "transcript");
  assert.equal(transcript().value, "conversation");
  h.props.conversationId = "another-conversation";
  assert.equal(transcript().value, "another-conversation");
  h.unmount();
});

test("native attachment menu keeps runtime controls usable without attachment support", async () => {
  const patches = [];
  let plugins = 0;
  let imports = 0;
  const h = harness({
    attachmentsEnabled: false,
    onOpenSkillsHub: () => { plugins += 1; },
    onImportFiles: async () => { imports += 1; },
    onChatRuntimeControlsChange: (patch) => patches.push(JSON.parse(JSON.stringify(patch))),
  }, { mobile: true });
  const composer = h.render().nodes[0].children.find((node) => node.id === "composer");
  const footer = composer.children.find((node) => node.id === "composer-actions");
  const attach = footer.children.find((node) => node.id === "attach");
  const model = footer.children.find((node) => node.id === "model");
  assert.equal(attach.disabled, false);
  assert.equal(attach.options.every((option) => option.disabled), true);
  assert.equal(model.options[0].group, "provider");
  assert.equal(model.options[0].groupLabel, "Provider");
  assert.equal((await h.dispatch("attach-plugins")).ok, true);
  assert.equal(plugins, 1);
  assert.equal((await h.dispatch("runtime-web-search", true)).ok, true);
  assert.deepEqual(patches, [{ nativeWebSearchEnabled: true }]);
  assert.equal((await h.dispatch("attach:conversation:0", "[]")).ok, false);
  assert.equal(imports, 0);
  h.props.inputDisabled = true;
  h.render();
  assert.equal((await h.dispatch("runtime-web-search", false)).ok, false);
  assert.equal((await h.dispatch("attach-plugins")).ok, false);
  h.unmount();
});

test("native skill menu inserts rich references into the sent draft and rejects removed or disabled choices", async () => {
  const skill = { name: "review", description: "Review changes", skillFile: "/skills/review/SKILL.md", baseDir: "/skills/review" };
  const sent = [];
  let managed = 0;
  const h = harness({ enabledSkills: [skill], onOpenSkillsHub: () => managed++,
    onSend: () => sent.push(h.props.composerRef.current.getDraft()) }, { mobile: true });
  await h.dispatch("draft", "Check this ");
  assert.equal((await h.dispatch("mention-skill:review")).ok, true);
  h.render();
  assert.equal((await h.dispatch("send")).ok, true);
  assert.deepEqual(sent[0].skillMentions, [skill]);
  assert.ok(sent[0].text.startsWith("Check this "));
  assert.equal((await h.dispatch("manage-skills")).ok, true);
  assert.equal(managed, 1);
  h.props.inputDisabled = true;
  h.render();
  assert.equal((await h.dispatch("mention-skill:review")).ok, false);
  h.props.inputDisabled = false;
  h.props.enabledSkills = [];
  h.render();
  assert.equal((await h.dispatch("mention-skill:review")).ok, false);
  h.unmount();
});

test("native attachment selection cannot import into a conversation opened after the picker", async () => {
  const imported = [];
  const h = harness({ onImportFiles: async (files) => imported.push(files.map((file) => file.name)) }, { mobile: true });
  const payload = JSON.stringify([{ fileName: "note.txt", mimeType: "text/plain", contentBase64: "aGk=" }]);
  h.props.conversationId = "next-conversation";
  h.render();
  assert.equal((await h.dispatch("attach:conversation:0", payload)).ok, false);
  assert.deepEqual(imported, []);
  assert.equal((await h.dispatch("attach:next-conversation:1", payload)).ok, true);
  assert.deepEqual(imported, [["note.txt"]]);
  h.unmount();
});

test("native attachment ownership changes with workspace and never reuses a returned target", async () => {
  const imported = [];
  const h = harness({ onImportFiles: async files => imported.push(files.map(file => file.name)) }, { mobile: true });
  const payload = JSON.stringify([{ fileName: "note.txt", mimeType: "text/plain", contentBase64: "aGk=" }]);
  h.props.uploadWorkdir = "/another-project"; h.render();
  assert.equal((await h.dispatch("attach:conversation:0", payload)).ok, false);
  assert.equal((await h.dispatch("attach:conversation:1", payload)).ok, true);
  h.props.uploadWorkdir = "/project"; h.render();
  assert.equal((await h.dispatch("attach:conversation:0", payload)).ok, false);
  assert.equal((await h.dispatch("attach:conversation:1", payload)).ok, false);
  assert.equal((await h.dispatch("attach:conversation:2", payload)).ok, true);
  assert.deepEqual(imported, [["note.txt"], ["note.txt"]]);
  h.unmount();
});

test("native chat exposes downloaded cloud artifacts as working file actions", async () => {
  const calls = [];
  const h = harness({}, { mobile: true, invoke: async (command, args) => {
    calls.push({ command, args });
  } });
  h.props.historyItems = [{
    kind: "assistant", key: "answer", segmentIndex: 0, timestamp: 1,
    isFromCompactedSegment: false,
    rounds: [{ round: 1, key: "r1", blocks: [{
      kind: "tool", item: {
        toolCall: { id: "download-1", name: "CloudTaskManager", arguments: {} },
        toolResult: {
          role: "toolResult", toolCallId: "download-1", toolName: "CloudTaskManager",
          content: [{ type: "text", text: "Downloaded report.pptx" }],
          details: { action: "download_artifact", taskId: "task-1", artifactId: 3,
            artifactName: "report.pptx", localPath: "/mobile/workspace/report.pptx", sizeBytes: 42 },
          isError: false, timestamp: 1,
        },
      },
    }] }],
  }];
  const transcript = h.render().nodes[0].children.find((node) => node.id === "transcript");
  const attachment = transcript.children.find((node) => node.id === "answer").children.find(
    (node) => node.id === "answer:cloud-artifact:task-1:3",
  );
  assert.equal(attachment.kind, "Button");
  assert.equal(attachment.label, "report.pptx");
  assert.equal((await h.dispatch(attachment.action)).ok, true);
  assert.deepEqual(calls, [{
    command: "cloud_task_open_artifact",
    args: { localPath: "/mobile/workspace/report.pptx" },
  }]);
  h.unmount();
});

test("native iPhone opens More as a sheet menu and keeps compact sidebar routes", async () => {
  const opened = [];
  const h = harness(
    {
      projects: [{ id: "project", name: "Workspace" }],
      trajectoryAvailable: true,
      onOpenTerminal: () => opened.push("terminal"),
      onOpenFiles: () => opened.push("library"),
      onOpenSettings: (section) => opened.push(section ?? "settings"),
      onOpenSkillsHub: () => opened.push("skills"),
      onOpenMcpHub: () => opened.push("mcp"),
      onOpenBackgroundTasks: () => opened.push("scheduled"),
      onOpenRemote: () => opened.push("remote"),
      onNewConversation: () => opened.push("new-chat"),
    },
    { mobile: true },
  );
  const document = h.render();
  assert.equal(document.formFactor, "mobile");
  const toolbar = document.nodes[0].children.find((node) => node.id === "toolbar");
  const tools = toolbar.children.find((node) => node.id === "tools");
  assert.equal(tools.kind, "IconButton");
  assert.equal(toolbar.children.find((node) => node.id === "sidebar").variant, "secondary");
  assert.equal(tools.variant, "secondary");
  assert.equal((await h.dispatch("tools")).ok, true);
  h.render();
  const toolsPage = h.documents().find((item) => item.mode === "sheet" && item.title === "chat.mobileMenu.title");
  assert.ok(toolsPage);
  assert.deepEqual(
    toolsPage.nodes[0].children.map((node) => node.id),
    [
      "tool:terminal",
      "tool:shell",
      "tool:browser",
      "tool:browser-settings",
      "tool:git",
      "tool:ssh",
      "tool:background",
    ],
  );
  assert.equal((await h.dispatch("tool:terminal", null, "tools")).ok, true);
  assert.equal((await h.dispatch("sidebar")).ok, true);
  h.render();
  let sidebar = h.documents().find((item) => item.mode === "sidebar");
  const layout = sidebar.nodes[0];
  const list = layout.children.find((node) => node.id === "sidebar-list");
  assert.deepEqual(
    list.children.slice(0, 6).map((node) => node.id),
    ["files", "skills", "scheduled", "remote", "mcp", "create-project"],
  );
  assert.equal(list.children.some((node) => node.id === "trajectory"), false);
  assert.equal(layout.children.some((node) => node.id === "sidebar-title"), true);
  assert.equal(layout.children.some((node) => node.id === "sidebar-search"), false);
  assert.equal((await h.dispatch("sidebar-search-toggle", null, "sidebar")).ok, true);
  h.render();
  sidebar = h.documents().find((item) => item.mode === "sidebar");
  assert.ok(sidebar.nodes[0].children.some((node) => node.id === "sidebar-search"));
  assert.ok(
    sidebar.nodes[0].children
      .find((node) => node.id === "sidebar-list")
      .children.some((node) => node.id === "project:project"),
  );
  assert.equal((await h.dispatch("project:project", null, "sidebar")).ok, true);
  h.render();
  sidebar = h.documents().find((item) => item.mode === "sidebar");
  assert.equal(
    sidebar.nodes[0].children
      .find((node) => node.id === "sidebar-list")
      .children.some((node) => node.id === "project:project"), true,
  );
  h.render();
  for (const action of ["files", "skills", "scheduled", "remote", "mcp", "new-chat", "settings"]) {
    assert.equal((await h.dispatch(action, null, "sidebar")).ok, true);
  }
  assert.deepEqual(opened, [
    "terminal",
    "library",
    "skills",
    "scheduled",
    "remote",
    "mcp",
    "new-chat",
    "settings",
  ]);
  h.unmount();
});

test("native sidebar keeps root folders visible and nests grouped workspaces and conversations", async () => {
  const toggled = [];
  const projectA = { id: "a", name: "Fort Mason", path: "/fort-mason" };
  const projectB = { id: "b", name: "Flight Journal", path: "/flight-journal" };
  const group = { id: "travel", name: "Travel", projectPaths: [projectA.path], collapsed: false };
  const h = harness({
    projects: [projectA, projectB],
    workspaceProjectGroups: [group],
    onToggleWorkspaceGroupCollapsed: (id) => {
      toggled.push(id);
      group.collapsed = !group.collapsed;
    },
    sidebarStore: {
      subscribe: () => () => {},
      getSnapshot: () => sidebarSnapshot([
        { id: "work-a", title: "Map the venue", cwd: projectA.path },
        { id: "work-b", title: "Integrate flight data", cwd: projectB.path },
        { id: "chat", title: "Recent chat" },
      ]),
      loadWorkspaceHistory() {},
    },
  }, { mobile: true });
  assert.equal((await h.dispatch("sidebar")).ok, true);
  const rows = () => h.render().nodes[0] && h.documents()
    .find((item) => item.mode === "sidebar").nodes[0].children
    .find((node) => node.id === "sidebar-list").children;
  let nodes = rows();
  assert.ok(nodes.find((node) => node.id === "group:travel"));
  assert.equal(nodes.find((node) => node.id === "project:a").indent, 18);
  assert.equal(nodes.find((node) => node.id === "project:b").indent ?? 0, 0);
  assert.ok(nodes.find((node) => node.id === "conversation:chat"));
  assert.equal((await h.dispatch("project:a", null, "sidebar")).ok, true);
  nodes = rows();
  assert.equal(nodes.find((node) => node.id === "workspace-conversation:work-a").indent, 54);
  assert.equal(nodes.find((node) => node.id === "workspace-conversation:work-a").variant, "sidebar-conversation-row");
  assert.equal(nodes.find((node) => node.id === "workspace-conversation:work-a").icon, undefined);
  assert.equal((await h.dispatch("group:travel", null, "sidebar")).ok, true);
  nodes = rows();
  assert.deepEqual(toggled, ["travel"]);
  assert.equal(nodes.some((node) => node.id === "project:a"), false);
  assert.ok(nodes.find((node) => node.id === "project:b"));
  h.unmount();
});

test("native work stays visible while running and folds only after completion", () => {
  const h = harness({}, { mobile: true });
  const item = {
    toolCall: { id: "inspect-1", name: "Read", arguments: { path: "src/App.tsx" } },
    toolResult: { role: "toolResult", toolCallId: "inspect-1", toolName: "Read",
      content: [{ type: "text", text: "file contents" }], isError: false, timestamp: 5000 },
  };
  h.props.liveTranscriptStore.updateLiveRounds(() => [{
    round: 1, key: "live-round", blocks: [{ kind: "tool", item }],
    runningToolCallIds: ["inspect-1"], thinkingOpen: false,
  }]);
  let transcript = h.render().nodes[0].children.find((node) => node.id === "transcript");
  let liveWork = transcript.children.find((node) => node.id === "live:assistant").children[0];
  assert.equal(liveWork.kind, "Section");
  assert.equal(liveWork.id, "live:work");
  assert.equal(liveWork.children[0].kind, "ToolCall");
  assert.equal(liveWork.children[0].variant, "timeline");
  assert.equal(liveWork.children[0].status, "running");
  h.props.liveTranscriptStore.settle();
  h.props.historyItems = [
    { kind: "user", key: "prompt", segmentIndex: 0, timestamp: 1000,
      text: "Inspect", attachments: [], isFromCompactedSegment: false },
    { kind: "assistant", key: "answer", segmentIndex: 0, timestamp: 5000,
      rounds: [{ round: 1, key: "r1", blocks: [{ kind: "tool", item },
        { kind: "text", id: "reply", text: "Done" }] }], isFromCompactedSegment: false },
  ];
  transcript = h.render().nodes[0].children.find((node) => node.id === "transcript");
  const answer = transcript.children.find((node) => node.id === "answer");
  assert.equal(answer.children[0].kind, "Collapsible");
  assert.equal(answer.children[0].variant, "work");
  assert.equal(answer.children[0].children[0].kind, "ToolCall");
  assert.equal(answer.children[0].children[0].variant, "timeline");
  assert.equal(answer.children[1].kind, "Markdown");
  h.unmount();
});

test("native iPhone exposes execution mode and live context usage in the chat chrome", async () => {
  const selectedModes = [];
  const h = harness({ onChangeMode: (mode) => selectedModes.push(mode) }, { mobile: true });
  const chat = h.render().nodes[0];
  const toolbar = chat.children.find((node) => node.id === "toolbar");
  const mode = toolbar.children.find((node) => node.id === "execution-mode");
  assert.equal(mode.kind, "Selector");
  assert.equal(mode.value, "text");
  assert.equal((await h.dispatch("execution-mode", "tools")).ok, true);
  assert.deepEqual(selectedModes, ["tools"]);
  const composer = chat.children.find((node) => node.id === "composer");
  const actions = composer.children.find((node) => node.id === "composer-actions");
  const usage = actions.children.find((node) => node.id === "context-usage");
  assert.equal(usage.kind, "ProgressBar");
  assert.equal(usage.current, 45_000);
  assert.equal(usage.total, 100_000);
  h.unmount();
});

test("native chat and activity preserve file edit evidence from tool results", async () => {
  const opened = [];
  const h = harness({ onOpenWorkspaceFile: (path) => opened.push(path) }, { mobile: true });
  h.props.historyItems = [{
    kind: "assistant", key: "answer", segmentIndex: 0, timestamp: 1,
    isFromCompactedSegment: false,
    rounds: [{ round: 1, key: "r1", blocks: [{
      kind: "tool", item: {
        toolCall: { id: "edit-1", name: "Edit", arguments: { path: "report.md" } },
        toolResult: {
          role: "toolResult", toolCallId: "edit-1", toolName: "Edit",
          content: [{ type: "text", text: "File edited successfully" }],
          details: {
            kind: "edit", path: "report.md",
            oldPreview: "unchanged\nold line\ncontext",
            newPreview: "unchanged\nnew line\ncontext",
          },
          isError: false, timestamp: 1,
        },
      },
    }] }],
  }];
  const transcript = h.render().nodes[0].children.find((node) => node.id === "transcript");
  const tool = assistantWork(transcript, "answer")[0];
  assert.equal(tool.kind, "ToolCall");
  const argumentsNode = tool.children.find((node) => node.id.endsWith(":arguments"));
  assert.equal(argumentsNode.label, "chat.toolDetails.arguments");
  assert.deepEqual(JSON.parse(argumentsNode.text), { path: "report.md" });
  assert.equal(tool.children.find((node) => node.id.endsWith(":result")).label, "chat.toolDetails.result");
  assert.equal(tool.children.find((node) => node.language === "text").text, "File edited successfully");
  const diff = tool.children.find((node) => node.language === "diff");
  assert.match(diff.text, /-old line/);
  assert.match(diff.text, /\+new line/);
  assert.match(diff.text, / unchanged/);
  assert.doesNotMatch(diff.text, /[-+] unchanged/);
  const fileAction = assistantWork(transcript, "answer").find(
    (node) => node.id === "answer:changed-file:edit-1",
  );
  assert.equal(fileAction.label, "report.md");
  assert.equal((await h.dispatch(fileAction.action)).ok, true);
  assert.deepEqual(opened, ["report.md"]);
  assert.equal((await h.dispatch("activity-preview")).ok, true);
  h.render();
  const activity = h.documents().find((document) => document.title === "chat.activity.title");
  assert.equal(activity.nodes[0].children.find((node) => node.language === "diff").text, diff.text);
  h.unmount();
});

test("native chat and activity show a Write overwrite diff when its preimage is available", async () => {
  const h = harness({}, { mobile: true });
  h.props.historyItems = [{
    kind: "assistant", key: "rewrite", segmentIndex: 0, timestamp: 1,
    isFromCompactedSegment: false,
    rounds: [{ round: 1, key: "r1", blocks: [{
      kind: "tool", item: {
        toolCall: { id: "write-1", name: "Write", arguments: { path: "notes.md", content: "same\nnew\n" } },
        toolResult: {
          role: "toolResult", toolCallId: "write-1", toolName: "Write",
          content: [{ type: "text", text: "File updated successfully" }],
          details: {
            kind: "write", path: "notes.md", existedBefore: true,
            beforeContent: "same\nold\n", preview: "same\nnew\n",
          },
          isError: false, timestamp: 1,
        },
      },
    }] }],
  }];
  const transcript = h.render().nodes[0].children.find((node) => node.id === "transcript");
  const tool = assistantWork(transcript, "rewrite")[0];
  const diff = tool.children.find((node) => node.language === "diff");
  assert.match(diff.text, /-old/);
  assert.match(diff.text, /\+new/);
  assert.doesNotMatch(diff.text, /[-+]same/);
  assert.equal((await h.dispatch("activity-preview")).ok, true);
  h.render();
  const activity = h.documents().find((document) => document.title === "chat.activity.title");
  assert.equal(activity.nodes[0].children.find((node) => node.language === "diff").text, diff.text);
  h.unmount();
});

test("native chat does not turn truncated or fuzzy Edit previews into a file diff", async () => {
  const h = harness({}, { mobile: true });
  h.props.historyItems = [{
    kind: "assistant", key: "edit-preview", segmentIndex: 0, timestamp: 1,
    isFromCompactedSegment: false,
    rounds: [{ round: 1, key: "r1", blocks: [
      ...["truncated", "fuzzy"].map((variant) => ({
        kind: "tool", item: {
          toolCall: {
            id: variant, name: "Edit",
            arguments: variant === "truncated"
              ? {
                path: "notes.md", old_string: "old...", new_string: "new...",
                __xgent_stream_preview: { fields: {
                  old_string: { truncated: true }, new_string: { truncated: true },
                } },
              }
              : { path: "notes.md", old_string: "old", new_string: "new" },
          },
          toolResult: {
            role: "toolResult", toolCallId: variant, toolName: "Edit",
            content: [{ type: "text", text: "File edited" }],
            details: {
              kind: "edit", path: "notes.md", oldPreview: "old", newPreview: "new",
              matchStrategy: variant === "fuzzy" ? "indentation" : "exact", replacements: 1,
            },
            isError: false, timestamp: 1,
          },
        },
      })),
    ] }],
  }];
  const transcript = h.render().nodes[0].children.find((node) => node.id === "transcript");
  const tools = assistantWork(transcript, "edit-preview")
    .filter((node) => node.kind === "ToolCall");
  for (const tool of tools) {
    assert.equal(tool.children.some((node) => node.language === "diff"), false);
    assert.equal(tool.children.find((node) => node.id.endsWith(":edit-preview")).text, "old\n→\nnew");
  }
  assert.equal((await h.dispatch("activity-preview")).ok, true);
  h.render();
  const activity = h.documents().find((document) => document.title === "chat.activity.title");
  for (const item of activity.nodes) {
    assert.equal(item.children.some((node) => node.language === "diff"), false);
  }
  h.unmount();
});

test("native chat and activity show the exact full-file diff for a fuzzy multi Edit", async () => {
  const h = harness({}, { mobile: true });
  h.props.historyItems = [{
    kind: "assistant", key: "exact-edit", segmentIndex: 0, timestamp: 1,
    isFromCompactedSegment: false,
    rounds: [{ round: 1, key: "r1", blocks: [{
      kind: "tool", item: {
        toolCall: { id: "edit-1", name: "Edit", arguments: {
          path: "notes.md", old_string: "old", new_string: "new", replace_all: true,
        } },
        toolResult: {
          role: "toolResult", toolCallId: "edit-1", toolName: "Edit",
          content: [{ type: "text", text: "Edited twice" }],
          details: {
            kind: "edit", path: "notes.md", oldPreview: "old", newPreview: "new",
            matchStrategy: "indentation", replaceAll: true, replacements: 2,
            beforeContent: "same\nold\nold\n", afterContent: "same\nnew\nnew\n",
          },
          isError: false, timestamp: 1,
        },
      },
    }] }],
  }];
  const transcript = h.render().nodes[0].children.find((node) => node.id === "transcript");
  const tool = assistantWork(transcript, "exact-edit")[0];
  const diff = tool.children.find((node) => node.language === "diff");
  assert.match(diff.text, /-old/);
  assert.match(diff.text, /\+new/);
  assert.doesNotMatch(diff.text, /[-+]same/);
  assert.equal((await h.dispatch("activity-preview")).ok, true);
  h.render();
  const activity = h.documents().find((document) => document.title === "chat.activity.title");
  assert.equal(activity.nodes[0].children.find((node) => node.language === "diff").text, diff.text);
  h.unmount();
});

test("native chat keeps a shell-created PreviewFile output openable after the tool finishes", async () => {
  const opened = [];
  const h = harness({ onOpenWorkspaceFile: (path) => opened.push(path) }, { mobile: true });
  h.props.historyItems = [{
    kind: "assistant", key: "shell-output", segmentIndex: 0, timestamp: 1,
    isFromCompactedSegment: false,
    rounds: [{ round: 1, key: "r1", blocks: [{
      kind: "tool", item: {
        toolCall: { id: "preview-1", name: "PreviewFile", arguments: { path: "slides.pptx" } },
        toolResult: {
          role: "toolResult", toolCallId: "preview-1", toolName: "PreviewFile",
          content: [{ type: "text", text: "Opened slides.pptx" }],
          details: { kind: "mobile_file_preview", path: "slides.pptx" },
          isError: false, timestamp: 1,
        },
      },
    }] }],
  }];
  const transcript = h.render().nodes[0].children.find((node) => node.id === "transcript");
  const result = transcript.children.find((node) => node.id === "shell-output");
  const fileAction = result.children.find((node) => node.id === "shell-output:previewed-file:preview-1");
  assert.equal(fileAction.label, "slides.pptx");
  assert.equal((await h.dispatch(fileAction.action)).ok, true);
  assert.deepEqual(opened, ["slides.pptx"]);
  h.unmount();
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
      getSnapshot: () => sidebarSnapshot([{ id: "recent", title: "Recent chat" }]),
    },
    onOpenSettings: (section) => opened.push(section ?? "settings"),
    onOpenSkillsHub: () => opened.push("skills"),
    onOpenMcpHub: () => opened.push("mcp"),
    onOpenFiles: () => opened.push("files"),
    onCreateProject: () => opened.push("new-workspace"),
    onNewConversation: () => opened.push("new-chat"),
    onSelectProject: (project) => selected.push(project.id),
    onSelectConversation: (id) => selected.push(id),
    onChangeMode: (mode) => modes.push(mode),
  });
  assert.equal((await h.dispatch("sidebar")).ok, true);
  h.render();
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

test("native sidebar keeps workspace conversations nested above ordinary recent chats", async () => {
  const selected = [];
  const work = { id: "work", title: "Agent work", cwd: "/project", updatedAt: 2 };
  const chat = { id: "chat", title: "Simple chat", updatedAt: 1 };
  const snapshot = sidebarSnapshot([work, chat]);
  snapshot.workspaceHistory.set("/project", {
    cwd: "/project", limit: 10, totalCount: 1, hasMore: false,
    loading: false, loaded: true, error: null,
  });
  const h = harness({
    projects: [{ id: "project", name: "Workspace", path: "/project" }],
    sidebarStore: { subscribe: () => () => {}, getSnapshot: () => snapshot },
    onSelectProject: (project) => selected.push(project.id),
    onSelectConversation: (id) => selected.push(id),
  }, { mobile: true });
  assert.equal((await h.dispatch("sidebar")).ok, true);
  h.render();
  assert.equal((await h.dispatch("project:project", null, "sidebar")).ok, true);
  h.render();
  const list = h.documents().find((item) => item.mode === "sidebar")
    .nodes[0].children.find((node) => node.id === "sidebar-list").children;
  assert.ok(list.some((node) => node.id === "workspace-conversation:work" && node.indent === 36));
  assert.ok(list.some((node) => node.id === "conversation:chat" && node.variant === "sidebar-conversation-row"));
  assert.ok(!list.some((node) => node.id === "conversation:work"));
  assert.equal((await h.dispatch("workspace-conversation:work", null, "sidebar")).ok, true);
  assert.deepEqual(selected, ["project", "work"]);
  h.unmount();
});

test("native conversation dialogs persist rename/delete and update the active runtime only after success", async () => {
  for (const mobile of [true, false]) {
    const storeLoader = createTsModuleLoader();
    const { createSidebarStore } = storeLoader.loadModule("src/lib/sidebar/store.ts");
    let item = { id: "conversation", title: "Original", providerId: "p", model: "m", createdAt: 1, updatedAt: 1 };
    let deleteFails = false;
    const removed = [];
    const store = createSidebarStore({
      listConversations: async () => ({ items: [item], totalCount: 1 }), listWorkdirs: async () => [],
      subscribeEvents: () => () => {},
      renameConversation: async (_id, title) => item = { ...item, title, updatedAt: 2 },
      deleteConversation: async () => { if (deleteFails) throw Error("offline"); },
    });
    store.upsertLocal(item);
    const h = harness({ sidebarStore: store, onConversationDeleted: id => removed.push(id) }, { mobile });
    if (!h.documents().some(doc => doc.mode === "sidebar")) await h.dispatch("sidebar");
    h.render();
    const opened = await h.dispatch("conversation-actions:conversation:rename", null, "sidebar");
    assert.equal(opened.ok, true, `${opened.error}; mobile=${mobile}; documents=${h.documents().map(doc => doc.mode).join(",")}`);
    h.render();
    assert.ok(h.documents().some(doc => doc.title === "chat.conversationRename"), `rename dialog on mobile=${mobile}`);
    const edited = await h.dispatch("conversation-title", "   Updated   title   ", "conversation-dialog");
    assert.equal(edited.ok, true, edited.error);
    h.render();
    assert.equal((await h.dispatch("confirm", null, "conversation-dialog")).ok, true);
    assert.equal(store.peek("conversation").title, "Updated title");
    h.render();
    assert.equal(h.documents().some(doc => doc.title === "chat.conversationRename"), false);
    await h.dispatch("conversation-actions:conversation:delete", null, "sidebar");
    h.render();
    assert.equal(store.peek("conversation").title, "Updated title", "Opening confirmation must not delete");
    deleteFails = true;
    assert.equal((await h.dispatch("confirm", null, "conversation-dialog")).ok, false);
    h.render();
    assert.deepEqual(removed, []);
    assert.ok(store.peek("conversation"));
    assert.ok(h.documents().some(doc => doc.title === "chat.conversationDelete"), "Failure preserves retry/cancel");
    deleteFails = false;
    assert.equal((await h.dispatch("confirm", null, "conversation-dialog")).ok, true);
    assert.deepEqual(removed, ["conversation"]);
    assert.equal(store.peek("conversation"), undefined);
    h.unmount();
  }
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
  for (const [action, value] of [["draft", "Blocked"], ["send", null], ["attach:conversation:0", null]]) {
    assert.equal((await h.dispatch(action, value)).ok, false);
  }
  h.props.inputDisabled = false;
  h.props.attachmentsEnabled = false;
  h.render();
  assert.equal((await h.dispatch("attach:conversation:0")).ok, false);
  assert.equal((await h.dispatch("model", "unknown")).ok, false);
  assert.equal((await h.dispatch("model", "provider::model")).ok, true);
  assert.deepEqual(selected, [{ customProviderId: "provider", model: "model" }]);
  h.props.modelOptions = [];
  h.render();
  assert.equal((await h.dispatch("send")).ok, false);
  h.props.attachmentsEnabled = true;
  h.render();
  assert.equal((await h.dispatch("attach:conversation:0", "[]")).ok, true);
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

test("empty native model selection stays in the footer and opens provider settings without forcing setup", async () => {
  const opened = [];
  const h = harness({ modelOptions: [], selectedValue: undefined, onOpenSettings: (section) => opened.push(section) });
  const chat = h.render().nodes[0];
  const composer = chat.children.find((node) => node.id === "composer");
  const footer = composer.children.find((node) => node.id === "composer-actions");
  const model = footer.children.find((node) => node.id === "model");
  assert.equal(model.variant, "compact");
  assert.equal(model.disabled, true);
  assert.ok(model.label);
  assert.equal(composer.children.some((node) => node.id === "model"), false);
  assert.deepEqual(opened, []);
  assert.equal((await h.dispatch("draft", "Keep this draft")).ok, true);
  h.render();
  assert.equal((await h.dispatch("configure-provider")).ok, true);
  assert.deepEqual(opened, ["providers"]);
  assert.equal(h.props.composerRef.current.getDraft().text, "Keep this draft");
  assert.equal((await h.dispatch("send")).ok, false);
  h.unmount();
});
