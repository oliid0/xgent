import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const { workRecord, workDuration } = createTsModuleLoader().loadModule("src/pages/chat/transcript/workRecord.ts");
const block = (key, kind, name) => ({ key, unit: { kind: "block", block: { kind, item: { toolCall: { name } } } } });

test("one work disclosure hides reasoning by default and keeps final answer and questions visible", () => {
  const rows = [block("intro", "text"), block("thought", "thinking"), block("command", "tool", "Bash"), block("question", "tool", "AskUserQuestion"), block("answer", "text"), { key: "footer", unit: { kind: "footer" } }];
  const hidden = workRecord(rows, false);
  assert.deepEqual(hidden.work.map(row => row.key), ["intro", "command"]);
  assert.deepEqual(hidden.answer.map(row => row.key), ["question", "answer", "footer"]);
  assert.deepEqual(workRecord(rows, true).work.map(row => row.key), ["intro", "thought", "command"]);
  assert.deepEqual(workRecord([block("answer", "text")], false).work, []);
  assert.equal(workDuration(undefined, 2000), null);
  assert.equal(workDuration(1000, 66000), "1m 5s");
});
