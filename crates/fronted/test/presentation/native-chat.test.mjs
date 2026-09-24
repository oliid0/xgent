import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

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
    settings: { theme: "system", system: { executionMode: "text" }, customSettings: { appearance: { showThinking: true } } },
    composerRef: { current: null },
    sidebarStore: { subscribe: () => () => {}, getSnapshot: () => ({ conversations: [], hasMore: false }) },
    historyItems: [], liveTranscriptStore: createLiveTranscriptStore(),
    modelOptions: [{ value: "provider::model", providerName: "Provider", label: "Model" }],
    selectedValue: "provider::model",
    contextUsageTokensSource: { subscribe: () => () => {}, getContextUsageTokens: () => 45_000 },
    contextWindow: 100_000,
    inputDisabled: false, inputPlaceholder: "Message",
    isSending: false, errorMessage: null, hasMoreHistory: false, pendingApprovals: [],
    projects: [], attachmentsEnabled: true, uploads: [], isUploading: false,
    onSend() {}, onStop() {}, onSelectModel() {}, onSelectConversation() {}, onSelectProject() {},
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
      registry.register(surface.props.document.mode === "sidebar" ? "sidebar" : "tools", surface.props.handlers);
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
  assert.equal((await h.dispatch("draft", "Hello\r\nmodel")).ok, true);
  h.render();
  assert.equal((await h.dispatch("send")).ok, true);
  assert.deepEqual(sent, ["Hello\nmodel"]);
  h.props.onSelectConversation = () => h.props.composerRef.current.setText("Restored draft");
  h.props.sidebarStore.getSnapshot = () => ({ conversations: [{ id: "next", title: "Next" }] });
  assert.equal((await h.dispatch("sidebar")).ok, true);
  h.render();
  assert.equal((await h.dispatch("conversation:next", null, "sidebar")).ok, true);
  assert.equal(h.props.composerRef.current.getDraft().text, "Restored draft");
  h.unmount();
  assert.equal(h.props.composerRef.current, null);
  assert.equal((await h.dispatch("send")).ok, false);
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

test("native iPhone opens More as a full-page tool list and keeps compact sidebar routes", async () => {
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
  const toolsPage = h.documents().find((item) => item.mode === "root" && item.title === "chat.mobileMenu.title");
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
    ["files", "sidebar-projects-toggle", "skills", "scheduled", "remote", "mcp"],
  );
  assert.equal(list.children.some((node) => node.id === "trajectory"), false);
  assert.equal(layout.children.some((node) => node.id === "sidebar-title"), true);
  assert.equal(layout.children.some((node) => node.id === "sidebar-search"), false);
  assert.equal((await h.dispatch("sidebar-search-toggle", null, "sidebar")).ok, true);
  h.render();
  sidebar = h.documents().find((item) => item.mode === "sidebar");
  assert.ok(sidebar.nodes[0].children.some((node) => node.id === "sidebar-search"));
  assert.equal((await h.dispatch("sidebar-projects-toggle", null, "sidebar")).ok, true);
  h.render();
  sidebar = h.documents().find((item) => item.mode === "sidebar");
  assert.ok(
    sidebar.nodes[0].children
      .find((node) => node.id === "sidebar-list")
      .children.some((node) => node.id === "project:project"),
  );
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
  const tool = transcript.children.find((node) => node.id === "answer").children[0];
  assert.equal(tool.kind, "ToolCall");
  assert.equal(tool.children.find((node) => node.language === "text").text, "File edited successfully");
  const diff = tool.children.find((node) => node.language === "diff");
  assert.match(diff.text, /-old line/);
  assert.match(diff.text, /\+new line/);
  assert.match(diff.text, / unchanged/);
  assert.doesNotMatch(diff.text, /[-+] unchanged/);
  const fileAction = transcript.children.find((node) => node.id === "answer").children.find(
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
  const tool = transcript.children.find((node) => node.id === "rewrite").children[0];
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
  const tools = transcript.children.find((node) => node.id === "edit-preview").children
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
  const tool = transcript.children.find((node) => node.id === "exact-edit").children[0];
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
      getSnapshot: () => ({
        conversations: [{ id: "recent", title: "Recent chat" }],
        hasMore: false,
      }),
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
