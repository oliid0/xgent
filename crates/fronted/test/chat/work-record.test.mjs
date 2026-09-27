import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const { workRecord, workDuration, groupWorkTools } = createTsModuleLoader().loadModule("src/pages/chat/transcript/workRecord.ts");
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

test("consecutive file operations group only within the same tool, target and step", () => {
  const tool = (id, name, path, brief = "Fix parsing") => ({ toolCall: { id, name, arguments: { path, brief } } });
  const groups = groupWorkTools([
    tool("a", "Edit", "a.ts"), tool("b", "Edit", "a.ts"),
    tool("c", "Read", "a.ts"), tool("d", "Edit", "a.ts"),
    tool("e", "Edit", "a.ts", "Update logging"), tool("f", "Edit", "b.ts"),
    tool("g", "Bash", undefined), tool("h", "Bash", undefined),
  ]);
  assert.deepEqual(groups.map(group => group.map(item => item.toolCall.id)), [["a", "b"], ["c"], ["d"], ["e"], ["f"], ["g"], ["h"]]);
});
