import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const messageUtils = loader.loadModule("src/lib/providers/runtime/messageUtils.ts");

const citation = "\uE200cite\uE202source-1\uE20212-18\uE201";

test("provider citation markers are removed from final assistant messages", () => {
  const message = {
    role: "assistant",
    content: [{ type: "text", text: `Before ${citation} after` }],
  };

  const sanitized = messageUtils.sanitizeAssistantMessage(message);

  assert.equal(sanitized.content[0].text, "Before  after");
});

test("stream reconciliation holds citation fragments and preserves visible deltas", () => {
  const reconciler = messageUtils.createStreamingTextReconciler();

  assert.equal(reconciler.appendDelta("0", "Answer \uE200ci"), "Answer ");
  assert.equal(reconciler.appendDelta("0", "te\uE202source-1"), "");
  assert.equal(reconciler.appendDelta("0", "\uE201 done"), " done");
  assert.equal(
    reconciler.reconcileFinalText("0", "Answer \uE200cite\uE202source-1\uE201 done!"),
    "!",
  );
});
