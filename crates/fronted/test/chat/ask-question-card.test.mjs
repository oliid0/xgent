import assert from "node:assert/strict";
import test from "node:test";
import { createReactHookHarness } from "../helpers/react-hook-harness.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const walk = node => Array.isArray(node) ? node.flatMap(walk)
  : node?.props ? [node, ...walk(node.props.children)] : [];
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(context) {
  const hooks = createReactHookHarness();
  const previousWindow = globalThis.window;
  globalThis.window = { setInterval, clearInterval };
  context.after(() => { hooks.unmount(); globalThis.window = previousWindow; });
  const loader = createTsModuleLoader({ mocks: {
    react: hooks.react,
    "../../i18n": { useLocale: () => ({ t: key => key }) },
  } });
  const ask = loader.loadModule("src/lib/tools/askUserQuestionTools.ts");
  const { AskUserQuestionCard } = loader.loadModule("src/components/chat/AskUserQuestionCard.tsx");
  const questions = loader.loadModule("src/lib/chat/askUserQuestion.ts").parseAskUserQuestionItems([
    { id: "style", prompt: "Choose a style", options: [{ label: "Quiet" }, { label: "Bold" }] },
    { id: "format", prompt: "Choose a format", options: [{ label: "Word" }, { label: "PDF" }] },
  ]);
  const pending = ask.createAskUserQuestionTools({ conversationId: "conversation" }).executeToolCall({
    id: "ask", name: "AskUserQuestion", arguments: { questions },
  });
  context.after(async () => { ask.cancelPendingAskUserQuestionsForConversation("conversation"); await pending; });
  let submissions = 0, cancellations = 0;
  const props = { questions, interactive: true, deadlineAt: ask.getAskUserQuestionDeadlineAt("ask"),
    onSubmit: async answers => { submissions++; return ask.answerAskUserQuestion("ask", answers, { conversationId: "conversation" }); },
    onCancel: async () => { cancellations++; return ask.cancelAskUserQuestion("ask", { conversationId: "conversation" }); },
  };
  let tree;
  const render = () => { tree = hooks.render(() => AskUserQuestionCard(props)); };
  const find = label => walk(tree).find(node => node.props.label === label)?.props;
  const text = () => walk(tree).map(node => node.props.children).filter(value => typeof value === "string");
  const error = () => walk(tree).find(node => node.props.status === "error")?.props.title;
  render();
  return { ask, hooks, props, pending, render, find, text, error,
    counts: () => ({ submissions, cancellations }) };
}

test("Astryx question arrows preserve answers and free text submits through the actual shared tool", async context => {
  const f = fixture(context);
  assert.equal(f.find("chat.askUser.previous").isDisabled, true);
  assert.equal(f.find("chat.askUser.submit").isDisabled, true);
  assert.ok(f.find("chat.askUser.other"));
  f.find("Choose a style").onChange("option:Bold"); f.render();
  f.find("chat.askUser.next").onClick(); f.render();
  assert.equal(f.find("chat.askUser.next").isDisabled, true);
  f.find("chat.askUser.other").onChange("x".repeat(2100)); f.render();
  assert.equal(f.find("chat.askUser.other").value.length, 2000);
  f.find("chat.askUser.other").onChange("Markdown"); f.render();
  f.find("chat.askUser.previous").onClick(); f.render();
  assert.equal(f.find("Choose a style").value, "option:Bold");
  f.find("chat.askUser.next").onClick(); f.render();
  assert.equal(f.find("chat.askUser.other").value, "Markdown");
  const submit = f.find("chat.askUser.submit").onClick;
  submit(); submit(); await tick(); f.render();
  assert.deepEqual(f.counts(), { submissions: 1, cancellations: 0 });
  assert.deepEqual((await f.pending).details.answers.map(answer => [answer.selectedLabel, answer.custom === true]), [["Bold", false], ["Markdown", true]]);
  assert.equal(f.find("chat.askUser.submit"), undefined);
  assert.ok(f.text().includes("chat.askUser.answered"));
});

for (const control of ["skip", "close"]) {
  test(`Astryx question ${control} cancels its tool once without fabricating selections`, async context => {
    const f = fixture(context);
    const dismiss = f.find(`chat.askUser.${control}`).onClick;
    dismiss(); dismiss(); await tick(); f.render();
    const result = await f.pending;
    assert.deepEqual(f.counts(), { submissions: 0, cancellations: 1 });
    assert.equal(result.details.cancelled, true);
    assert.deepEqual(result.details.answers, []);
    assert.equal(f.find("chat.askUser.close"), undefined);
    assert.equal(f.find("chat.askUser.skip"), undefined);
    assert.ok(f.text().includes("chat.askUser.cancelled"));
    dismiss(); await tick();
    assert.equal(f.counts().cancellations, 1);
  });
}

test("Astryx question dismissal failures remain retryable and retired cards cannot cancel", async context => {
  const f = fixture(context);
  f.props.onCancel = async () => ({ ok: false, message: "Question belongs to a different conversation." });
  f.render(); f.find("chat.askUser.close").onClick(); await tick(); f.render();
  assert.equal(f.error(), "Question belongs to a different conversation.");
  assert.equal(f.ask.hasPendingAskUserQuestion("ask"), true);
  assert.equal(f.find("chat.askUser.skip").isDisabled, false);
  const dismiss = f.find("chat.askUser.close").onClick;
  f.hooks.unmount(); dismiss(); await tick();
  assert.equal(f.ask.hasPendingAskUserQuestion("ask"), true);
});

test("Astryx retired answer fields and expired controls cannot change or settle a pending card", async context => {
  const f = fixture(context);
  const oldField = f.find("chat.askUser.other").onChange;
  f.find("chat.askUser.next").onClick(); f.render();
  oldField("Must not leak into another question"); f.render();
  f.find("chat.askUser.previous").onClick(); f.render();
  assert.equal(f.find("chat.askUser.other").value, "");
  const oldDismiss = f.find("chat.askUser.close").onClick;
  f.props.deadlineAt = Date.now() - 1; f.render();
  oldDismiss(); await tick();
  assert.deepEqual(f.counts(), { submissions: 0, cancellations: 0 });
  assert.equal(f.ask.hasPendingAskUserQuestion("ask"), true);
});
