import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";

const call = (id = "ask") => ({ type: "toolCall", id, name: "AskUserQuestion", arguments: { questions: [
  { id: "style", header: "风格", prompt: "选择风格", options: [{ label: "简洁" }, { label: "活泼", description: "使用更丰富的颜色", recommended: true }] },
  { id: "format", header: "格式", prompt: "选择文档格式", options: [{ label: "Word" }, { label: "PDF" }] },
] } });
const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children ?? [])]);

function fixture() {
  const hooks = createReactHookHarness();
  const loader = createTsModuleLoader({ mocks: { react: hooks.react } });
  const ask = loader.loadModule("src/lib/tools/askUserQuestionTools.ts");
  const { useNativeAskUserQuestions } = loader.loadModule("src/presentation/nativeAskUserQuestions.ts");
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const { createNativeChatTranscript } = loader.loadModule("src/presentation/nativeChatTranscript.ts");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  const registry = createPresentationActionRegistry(); let view; let requestId = 0;
  const props = { conversationId: "conversation", items: [] };
  const render = () => {
    view = hooks.render(() => useNativeAskUserQuestions(props.conversationId, props.items, key => key));
    const nodes = [...view.nodes.values()];
    validatePresentationDocument({ version: 1, surface: "chat", revision: 1, mode: "root", title: "Questions", nodes }, view.handlers);
    registry.register("chat", view.handlers);
    return view;
  };
  const send = (id, value = null) => registry.dispatch({ surface: "chat", action: id, value, requestId: String(++requestId) });
  return { props, ask, render, send, createNativeChatTranscript,
    node: id => flatten([...view.nodes.values()]).find(node => node.id === id),
    run: async (id, value = null) => { const outcome = await send(id, value); render(); return outcome; },
    close: () => { hooks.unmount(); registry.remove("chat"); },
  };
}

test("native question card resumes the actual shared tool with every option and custom answer", async () => {
  const f = fixture(), toolCall = call();
  const pending = f.ask.createAskUserQuestionTools({ conversationId: "conversation" }).executeToolCall(toolCall);
  f.props.items = [{ toolCall, running: true, round: 1 }]; f.render();
  const prefix = "question:conversation:ask";
  assert.equal(f.node(`${prefix}:submit`).disabled, true);
  assert.equal(f.node(`${prefix}:option:0:0`).label, "活泼");
  assert.equal(f.node(`${prefix}:option:0:0`).text, "使用更丰富的颜色");
  await f.run(`${prefix}:option:0:0`);
  await f.run(`${prefix}:next`);
  await f.run(`${prefix}:custom:1`, "  生成 Markdown 和 PDF  ");
  assert.equal(f.node(`${prefix}:submit`).disabled, false);
  const first = f.send(`${prefix}:submit`), second = f.send(`${prefix}:submit`);
  assert.equal((await first).ok, true); assert.equal((await second).ok, false);
  const result = await pending;
  assert.deepEqual(result.details.answers.map(answer => [answer.questionId, answer.selectedLabel, answer.custom === true]), [
    ["style", "活泼", false], ["format", "生成 Markdown 和 PDF", true],
  ]);
  f.props.items = [{ toolCall, toolResult: result, running: false, round: 1 }]; f.render();
  assert.equal(f.node(`${prefix}:status`).text, "chat.askUser.answered");
  assert.equal(f.node(`${prefix}:submit`), undefined);
  assert.equal(f.node(`${prefix}:custom-answer`).text, "生成 Markdown 和 PDF");
  f.close();
});

test("question cards stay outside the work disclosure in the shared main and side transcript", async () => {
  const f = fixture(), toolCall = call();
  const pending = f.ask.createAskUserQuestionTools({ conversationId: "conversation" }).executeToolCall(toolCall);
  f.props.items = [{ toolCall, running: true, round: 1 }]; const questions = f.render();
  const round = { round: 1, key: "r1", blocks: [
    { kind: "tool", item: { toolCall } },
    { kind: "tool", item: { toolCall: { id: "read", name: "Read", arguments: { path: "a.md" } } } },
  ], runningToolCallIds: ["ask", "read"] };
  const live = { isSettled: false, liveRounds: [round] };
  const messages = f.createNativeChatTranscript([], live, true, key => key, id => id, () => {}, questions.nodes);
  const answer = messages.find(node => node.id === "live:assistant");
  assert.equal(answer.children.find(node => node.variant === "question-card").id, "question:conversation:ask");
  assert.ok(!flatten(answer.children.find(node => node.id === "live:work").children).some(node => node.variant === "question-card"));
  f.ask.cancelPendingAskUserQuestionsForConversation("conversation"); await pending; f.close();
});

test("wrong-conversation submissions report the actual backend rejection and preserve a retryable form", async () => {
  const f = fixture(), toolCall = call();
  const pending = f.ask.createAskUserQuestionTools({ conversationId: "another" }).executeToolCall(toolCall);
  f.props.items = [{ toolCall, running: true, round: 1 }]; f.render();
  const prefix = "question:conversation:ask";
  await f.run(`${prefix}:option:0:0`); await f.run(`${prefix}:next`); await f.run(`${prefix}:option:1:0`);
  assert.equal((await f.run(`${prefix}:submit`)).ok, false);
  assert.match(f.node(`${prefix}:error`).label, /different conversation/);
  assert.equal(f.ask.hasPendingAskUserQuestion("ask"), true);
  f.ask.cancelPendingAskUserQuestionsForConversation("another"); await pending; f.close();
});

test("retired conversations, cancelled tools and custom length limits cannot submit stale choices", async () => {
  const f = fixture(), toolCall = call();
  const pending = f.ask.createAskUserQuestionTools({ conversationId: "conversation" }).executeToolCall(toolCall);
  f.props.items = [{ toolCall, running: true, round: 1 }]; const old = f.render();
  const prefix = "question:conversation:ask";
  await f.run(`${prefix}:custom:0`, "x".repeat(2100));
  assert.equal(f.node(`${prefix}:custom:0`).value.length, 2000);
  f.props.conversationId = "new-conversation"; f.props.items = []; f.render();
  assert.throws(() => old.handlers.get(`${prefix}:option:0:0`).run(null), /submitFailed/);
  f.ask.cancelPendingAskUserQuestionsForConversation("conversation"); const result = await pending;
  f.props.conversationId = "conversation"; f.props.items = [{ toolCall, toolResult: result, running: false, round: 1 }]; f.render();
  assert.equal(f.node(`${prefix}:status`).text, "chat.askUser.cancelled");
  assert.equal(f.node(`${prefix}:option:0:0`).disabled, true);
  f.close();
});

for (const action of ["skip", "close"]) {
  test(`native question ${action} settles only its card and rejects stale controls`, async () => {
    const f = fixture(), toolCall = call();
    const pending = f.ask.createAskUserQuestionTools({ conversationId: "conversation" }).executeToolCall(toolCall);
    const other = f.ask.createAskUserQuestionTools({ conversationId: "conversation" }).executeToolCall(call("other"));
    f.props.items = [{ toolCall, running: true, round: 1 }]; const old = f.render();
    const prefix = "question:conversation:ask";
    assert.equal(f.node(`${prefix}:custom:0`).disabled, false);
    assert.equal(f.node(`${prefix}:previous`).disabled, true);
    await f.run(`${prefix}:custom:0`, "Draft retained across navigation");
    await f.run(`${prefix}:next`);
    assert.equal(f.node(`${prefix}:next`).disabled, true);
    assert.equal(f.node(`${prefix}:counter`).text, "2/2");
    await f.run(`${prefix}:previous`);
    assert.equal(f.node(`${prefix}:custom:0`).value, "Draft retained across navigation");
    assert.equal((await f.run(`${prefix}:${action}`)).ok, true);
    const result = await pending;
    assert.equal(result.details.cancelled, true);
    assert.deepEqual(result.details.answers, []);
    assert.equal(f.node(`${prefix}:status`).text, "chat.askUser.cancelled");
    assert.equal(f.node(`${prefix}:close`), undefined);
    assert.equal(f.node(`${prefix}:skip`), undefined);
    assert.equal(f.ask.hasPendingAskUserQuestion("other"), true);
    assert.throws(() => old.handlers.get(`${prefix}:close`).run(null), /submitFailed/);
    f.ask.cancelPendingAskUserQuestionsForConversation("conversation"); await other; f.close();
  });
}

test("native questions show the actual timeout fallback and never reactivate an expired pending document", async () => {
  const f = fixture(), toolCall = call();
  const pending = f.ask.createAskUserQuestionTools({ conversationId: "conversation", timeoutMs: 25 }).executeToolCall(toolCall);
  f.props.items = [{ toolCall, running: true, round: 1 }]; const old = f.render();
  const result = await pending;
  assert.throws(() => old.handlers.get("question:conversation:ask:option:0:0").run(null), /submitFailed/);
  f.props.items = [{ toolCall, toolResult: result, running: false, round: 1 }]; f.render();
  assert.equal(f.node("question:conversation:ask:status").text, "chat.askUser.timedOut");
  assert.equal(f.node("question:conversation:ask:option:0:0").selected, true);
  f.close();
});
