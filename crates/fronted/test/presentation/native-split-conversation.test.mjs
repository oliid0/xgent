import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(options = {}) {
  const hooks = createReactHookHarness();
  const calls = [];
  const t = key => key;
  const names = ["Banner", "Button", "Center", "Heading", "Icon", "IconButton", "Spinner", "TextArea", "Toolbar"];
  const loader = createTsModuleLoader({ mocks: {
    ...Object.fromEntries(names.map(name => [`@astryxdesign/core/${name}`, { [name]: name }])),
    "@astryxdesign/core/Stack": { HStack: "HStack", VStack: "VStack" },
    react: { ...hooks.react, useSyncExternalStore: (_subscribe, snapshot) => snapshot() },
    "../../../components/icons": { X: "X" },
    "../../../components/chat/ToolApprovalBar": { ToolApprovalBar: "ToolApprovalBar" },
    "../../../i18n": { useLocale: () => ({ t }) }, "../i18n": { useLocale: () => ({ t }) },
    "../../../runtime/applePresentation": { isApplePresentationRuntime: () => options.native !== false },
    "../transcript/ChatTranscript": { ChatTranscript: "ChatTranscript" },
    "./NativeSurface": { NativeSurface: "NativeSurface" },
    "./nativeTheme": { createNativePresentationTheme: () => undefined },
  } });
  const { SplitConversationPane } = loader.loadModule("src/pages/chat/components/SplitConversationPane.tsx");
  const { createLiveTranscriptStore } = loader.loadModule("src/lib/chat/conversation/liveTranscriptStore.ts");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  const props = { settings: { theme: "dark", customSettings: { appearance: { showThinking: true } } },
    width: "100%", conversationId: "side", record: null, loading: false, error: null,
    liveTranscriptStore: createLiveTranscriptStore(), isRunning: false, isAgentMode: false, showUsage: false,
    onClose: () => calls.push(["close"]), onActivate: () => calls.push(["activate"]),
    onRetry: () => calls.push(["retry"]), onStop: () => calls.push(["stop"]),
    onOpenWorkspaceFile: path => calls.push(["file", path]),
    onSend: async text => { calls.push(["send", text]); return options.send ? options.send(text) : true; },
    ...options.props };
  const render = () => {
    const element = hooks.render(() => SplitConversationPane(props));
    if (options.native === false) return element;
    const surface = element.type(element.props).props;
    validatePresentationDocument({ ...surface.document, version: 1, surface: "side", revision: 1 }, surface.handlers);
    return surface;
  };
  const action = (id, value = null) => {
    const handler = render().handlers.get(id);
    assert.ok(handler?.enabled, id); assert.ok(handler.accepts(value), id);
    return handler.run(value);
  };
  const approval = loader.loadModule("src/lib/tools/toolApproval.ts");
  return { props, calls, render, action, approval, unmount: () => {
    hooks.unmount(); approval.cancelPendingToolApprovalsForConversation("side");
    approval.cancelPendingToolApprovalsForConversation(props.conversationId);
  } };
}
function find(nodes, id) {
  for (const node of nodes) { if (node.id === id) return node; const match = find(node.children ?? [], id); if (match) return match; }
}

test("native side conversation shares real draft/send/stop/retry/activate and close handlers", async () => {
  const h = harness();
  assert.equal(h.render().document.mode, "panel");
  assert.equal(find(h.render().document.nodes, "side-send").disabled, true);
  h.action("side-draft", "手机和桌面的真实消息");
  await h.action("side-send");
  assert.deepEqual(h.calls, [["send", "手机和桌面的真实消息"]]);
  assert.equal(find(h.render().document.nodes, "side-draft").value, "");
  h.props.isRunning = true;
  h.action("side-stop");
  h.props.isRunning = false;
  h.props.error = "History unavailable";
  h.action("side-retry");
  h.props.error = null;
  h.props.record = { title: "Side", state: { transcript: { items: [] } } };
  h.action("side-activate");
  assert.deepEqual(h.calls.slice(1), [["stop"], ["retry"], ["activate"]]);
  h.unmount();
});

test("native submit locks synchronously and preserves a newer draft after a rejected send", async () => {
  const pending = deferred(), h = harness({ send: () => pending.promise });
  h.action("side-draft", "First");
  const send = h.render().handlers.get("side-send").run;
  const first = send(null), duplicate = send(null);
  assert.equal(h.calls.filter(([type]) => type === "send").length, 1);
  assert.equal(find(h.render().document.nodes, "side-send").disabled, true);
  h.action("side-draft", "Next draft");
  pending.resolve(false);
  await Promise.all([first, duplicate]);
  assert.equal(find(h.render().document.nodes, "side-draft").value, "Next draft");
  assert.match(find(h.render().document.nodes, "side-send-error").label, /not sent/);
  h.unmount();
});

test("failed send restores the draft; closing or switching retires obsolete results", async () => {
  const rejected = harness({ send: async () => { throw new Error("Network down"); } });
  rejected.action("side-draft", "Retry me");
  await rejected.action("side-send");
  assert.equal(find(rejected.render().document.nodes, "side-draft").value, "Retry me");
  assert.equal(find(rejected.render().document.nodes, "side-send-error").label, "Network down");
  rejected.unmount();
  for (const retire of ["close", "switch", "unmount"]) {
    const pending = deferred(), h = harness({ send: () => pending.promise });
    h.action("side-draft", "Old draft");
    const sending = h.action("side-send");
    if (retire === "close") h.action("side-close");
    else if (retire === "switch") { h.props.conversationId = "other"; h.render(); h.action("side-draft", "Other draft"); }
    else h.unmount();
    pending.resolve(false); await sending;
    if (retire === "switch") {
      assert.equal(find(h.render().document.nodes, "side-draft").value, "Other draft");
      assert.equal(find(h.render().document.nodes, "side-send-error"), undefined);
    }
    if (retire !== "unmount") h.unmount();
  }
});

test("native side history folds only completed work and renders live tool evidence expanded", () => {
  const round = { key: "round", blocks: [
    { kind: "text", id: "before", text: "I am checking the file." },
    { kind: "tool", item: { toolCall: { id: "call", name: "Read", arguments: { path: "report.md" } },
      toolResult: { content: [{ type: "text", text: "Actual file content" }], isError: false } } },
    { kind: "text", id: "after", text: "The report is ready." },
  ] };
  const h = harness({ props: { record: { title: "Report", state: { transcript: { items: [
    { kind: "user", key: "user", text: "Check", attachments: [], timestamp: 1000 },
    { kind: "assistant", key: "assistant", rounds: [round], timestamp: 65000 },
  ] } } } } });
  const completed = find(h.render().document.nodes, "assistant:work");
  assert.equal(completed.kind, "Collapsible");
  const transcript = h.render().document.nodes;
  assert.equal(find(transcript, "assistant:round:tool:call:result").text, "Actual file content");
  h.props.liveTranscriptStore.replace({ isSettled: false, draftAssistantText: "", toolStatus: "Reading",
    liveRounds: [{ ...round, runningToolCallIds: ["call"] }], retryAttempts: [] });
  const nodes = h.render().document.nodes;
  assert.equal(find(nodes, "live:work").kind, "Section");
  assert.equal(find(nodes, "live:round:tool:call").status, "running");
  h.unmount();
});

test("loading disables native submit without losing the draft", () => {
  const h = harness(); h.action("side-draft", "Wait for history");
  h.props.loading = true;
  assert.equal(find(h.render().document.nodes, "side-send").disabled, true);
  assert.equal(find(h.render().document.nodes, "side-draft").value, "Wait for history");
  h.unmount();
});

test("native side work exposes actual tasks and settles only its own approval requests", async t => {
  const h = harness({ props: { isRunning: true, record: { title: "Work", state: {
    transcript: { items: [] }, meta: { taskList: { runId: "work", revision: 2, tasks: [
      { id: "done", subject: "Read", activeForm: "Reading", description: "Read the file", status: "completed" },
      { id: "next", subject: "Write", activeForm: "Writing", description: "Write the result", status: "in_progress" },
    ] } },
  } } } });
  t.after(() => { h.approval.cancelPendingToolApprovalsForConversation("main"); h.unmount(); });
  const side = h.approval.requestToolApproval({ conversationId: "side", toolCallId: "side-call",
    toolName: "Shell", summary: "Run the selected command" });
  const main = h.approval.requestToolApproval({ conversationId: "main", toolCallId: "main-call",
    toolName: "Shell", summary: "Main command" });
  const nodes = h.render().document.nodes;
  assert.equal(find(nodes, "task-progress:work").current, 1);
  assert.equal(find(nodes, "task-progress:work").total, 2);
  assert.equal(find(nodes, "task-progress:work:next").status, "running");
  assert.equal(find(nodes, "side-approval:main-call"), undefined);
  assert.equal(find(nodes, "side-approval:side-call:summary").text, "Run the selected command");
  h.action("side-approval:side-call:approve_session");
  assert.deepEqual(await side, { kind: "decided", decision: "approve_session" });
  assert.equal(h.approval.isSessionApproved("side", "Shell"), true);
  assert.equal(h.approval.getPendingToolApprovalsSnapshot("main").length, 1);
  h.approval.cancelPendingToolApprovalsForConversation("main"); await main;
  assert.equal(find(h.render().document.nodes, "side-approval:side-call"), undefined);
});

test("native approval controls captured before closing cannot grant a later request", async t => {
  const h = harness(); t.after(h.unmount);
  const pending = h.approval.requestToolApproval({ conversationId: "side", toolCallId: "pending",
    toolName: "Browser", summary: "Operate the app" });
  const decision = h.render().handlers.get("side-approval:pending:approve").run;
  h.action("side-close");
  assert.throws(() => decision(null), /toolApproval.failed/);
  assert.equal(h.approval.getPendingToolApprovalsSnapshot("side").length, 1);
  h.approval.cancelPendingToolApprovalsForConversation("side"); await pending;
});

test("Astryx side work receives the same conversation-scoped approval store", async t => {
  const h = harness({ native: false }); t.after(h.unmount);
  const pending = h.approval.requestToolApproval({ conversationId: "side", toolCallId: "desktop-call",
    toolName: "Shell", summary: "Run" });
  const tree = h.render();
  const bar = tree.props.children.find(item => item?.type === "ToolApprovalBar");
  assert.equal(bar.props.pending[0].toolCallId, "desktop-call");
  assert.equal((await bar.props.onDecide("desktop-call", "deny")).ok, true);
  assert.deepEqual(await pending, { kind: "decided", decision: "deny" });
});
