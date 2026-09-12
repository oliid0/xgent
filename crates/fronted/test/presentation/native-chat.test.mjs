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
      useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
      useEffect() {},
      useLayoutEffect(effect) { if (!mounted) cleanups.push(effect()); },
    },
    "../i18n": { useLocale: () => ({ t: (key) => key }) },
    "../lib/runtimePlatform": { isNativeMobileRuntime: () => false },
    "./NativeSurface": { NativeSurface: "NativeSurface" },
  } });
  const { NativeChatPage } = loader.loadModule("src/presentation/NativeChatPage.tsx");
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const { createLiveTranscriptStore } = loader.loadModule("src/lib/chat/conversation/liveTranscriptStore.ts");
  const registry = createPresentationActionRegistry();
  const props = {
    settings: { theme: "system", system: { executionMode: "text" }, customSettings: { appearance: { showThinking: true } } },
    composerRef: { current: null },
    sidebarStore: { subscribe: () => () => {}, getSnapshot: () => ({ conversations: [], hasMore: false }) },
    historyItems: [], liveTranscriptStore: createLiveTranscriptStore(),
    modelOptions: [{ value: "provider::model", providerName: "Provider", label: "Model" }],
    selectedValue: "provider::model", inputDisabled: false, inputPlaceholder: "Message",
    isSending: false, errorMessage: null, hasMoreHistory: false, pendingApprovals: [],
    projects: [], attachmentsEnabled: true, uploads: [], isUploading: false,
    onSend() {}, onStop() {}, onSelectModel() {}, onSelectConversation() {}, onSelectProject() {},
    onNewConversation() {}, onOpenSettings() {}, onOpenRemote() {}, onLoadEarlierHistory() {},
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
    if (surfaces[1]) registry.register("sidebar", surfaces[1].props.handlers);
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
  await h.dispatch("sidebar");
  h.render();
  assert.equal((await h.dispatch("conversation:next", null, "sidebar")).ok, true);
  assert.equal(h.props.composerRef.current.getDraft().text, "Restored draft");
  h.unmount();
  assert.equal(h.props.composerRef.current, null);
  assert.equal((await h.dispatch("send")).ok, false);
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
  assert.deepEqual(transcript.children.map((node) => node.text), ["Streaming response", "Reading files"]);
  const result = await h.dispatch("approval:call:approve");
  assert.equal(result.ok, false);
  assert.match(result.error, /Request expired/);
  assert.deepEqual(decisions, [["call", "approve"]]);
  assert.equal((await h.dispatch("stop")).ok, true);
  assert.equal(stopped, true);
  h.unmount();
});
