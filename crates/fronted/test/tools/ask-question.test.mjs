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
      "conversation-1",
    ),
    { ok: true },
  );

  const result = await pending;
  assert.equal(result.isError, false);
  assert.equal(result.details.kind, "ask_user_question");
  assert.equal(result.details.answers[0].selectedLabel, "活泼");
  assert.match(result.content[0].text, /Treat these selections as authoritative/);
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
    "conversation-other",
  );
  assert.equal(rejected.ok, false);

  assert.equal(
    ask.answerAskUserQuestion(
      "ask-scope",
      [{ questionId: "style", selectedLabel: "简洁" }],
      "conversation-2",
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
});
