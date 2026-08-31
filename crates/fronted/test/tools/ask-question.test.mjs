import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function createQuestionCall(id) {
  return {
    type: "toolCall",
    id,
    name: "AskUserQuestion",
    arguments: {
      questions: [
        {
          id: "style",
          header: "风格",
          prompt: "官网要使用哪种视觉风格？",
          options: [
            { label: "简洁", recommended: true },
            { label: "活泼" },
          ],
        },
      ],
    },
  };
}

test("AskUserQuestion pauses until the matching conversation submits an answer", async () => {
  const loader = createTsModuleLoader();
  const ask = loader.loadModule("src/lib/tools/askUserQuestionTools.ts");
  const bundle = ask.createAskUserQuestionTools({ conversationId: "conversation-1" });
  const pending = bundle.executeToolCall(createQuestionCall("ask-answer"));

  await Promise.resolve();
  assert.deepEqual(
    ask.answerAskUserQuestion(
      "ask-answer",
      [{ questionId: "style", selectedLabel: "活泼" }],
      { conversationId: "conversation-1" },
    ),
    { ok: true },
  );

  const result = await pending;
  assert.equal(result.isError, false);
  assert.equal(result.details.kind, "ask_user_question");
  assert.equal(result.details.answers[0].selectedLabel, "活泼");
  assert.match(result.content[0].text, /Their selections are final .* proceed accordingly/);
});

test("AskUserQuestion rejects an answer from another conversation without settling", async () => {
  const loader = createTsModuleLoader();
  const ask = loader.loadModule("src/lib/tools/askUserQuestionTools.ts");
  const bundle = ask.createAskUserQuestionTools({ conversationId: "conversation-2" });
  const pending = bundle.executeToolCall(createQuestionCall("ask-scope"));

  await Promise.resolve();
  const rejected = ask.answerAskUserQuestion(
    "ask-scope",
    [{ questionId: "style", selectedLabel: "简洁" }],
    { conversationId: "conversation-other" },
  );
  assert.equal(rejected.ok, false);

  assert.equal(
    ask.answerAskUserQuestion(
      "ask-scope",
      [{ questionId: "style", selectedLabel: "简洁" }],
      { conversationId: "conversation-2" },
    ).ok,
    true,
  );
  assert.equal((await pending).details.answers[0].selectedLabel, "简洁");
});

test("AskUserQuestion timeout chooses the recommended option and continues", async () => {
  const loader = createTsModuleLoader();
  const ask = loader.loadModule("src/lib/tools/askUserQuestionTools.ts");
  const bundle = ask.createAskUserQuestionTools({ conversationId: "conversation-3", timeoutMs: 5 });

  const result = await bundle.executeToolCall(createQuestionCall("ask-timeout"));
  assert.equal(result.isError, false);
  assert.equal(result.details.timedOut, true);
  assert.equal(result.details.answers[0].selectedLabel, "简洁");
});

test("AskUserQuestion abort releases the pending execution as cancelled", async () => {
  const loader = createTsModuleLoader();
  const ask = loader.loadModule("src/lib/tools/askUserQuestionTools.ts");
  const bundle = ask.createAskUserQuestionTools({ conversationId: "conversation-4" });
  const controller = new AbortController();
  const pending = bundle.executeToolCall(createQuestionCall("ask-abort"), controller.signal);

  await Promise.resolve();
  controller.abort();
  const result = await pending;
  assert.equal(result.isError, true);
  assert.equal(result.details.cancelled, true);
  assert.equal(
    result.content[0].text,
    "The user stopped the turn without answering. Do not assume any selection.",
  );
});

test("AskUserQuestion accepts different option counts for independent questions like xx", () => {
  const loader = createTsModuleLoader();
  const askModel = loader.loadModule("src/lib/chat/askUserQuestion.ts");
  const questions = askModel.parseAskUserQuestionItems([
    {
      prompt: "Choose a platform",
      options: [{ label: "Web" }, { label: "Desktop" }],
    },
    {
      prompt: "Choose a tone",
      options: [{ label: "Quiet" }, { label: "Bold" }, { label: "Playful" }],
    },
  ]);
  assert.deepEqual(questions.map((question) => question.options.length), [2, 3]);
});

test("AskUserQuestion validation feedback matches xx exactly", () => {
  const loader = createTsModuleLoader();
  const askModel = loader.loadModule("src/lib/chat/askUserQuestion.ts");
  assert.throws(
    () =>
      askModel.parseAskUserQuestionItems([
        { prompt: "One", options: [{ label: "A" }, { label: "B" }] },
        { prompt: "Two", options: [{ label: "A" }, { label: "B" }] },
        { prompt: "Three", options: [{ label: "A" }, { label: "B" }] },
        { prompt: "Four", options: [{ label: "A" }, { label: "B" }] },
        { prompt: "Five", options: [{ label: "A" }, { label: "B" }] },
      ]),
    /supports at most 4 questions per call; got 5\./,
  );
});
