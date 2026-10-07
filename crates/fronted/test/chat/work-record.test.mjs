import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const { workRecord, workDuration, groupWorkTools, workToolGroupLabel } = createTsModuleLoader().loadModule("src/pages/chat/transcript/workRecord.ts");
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
    tool("g", "Bash", undefined, ""), tool("h", "Bash", undefined, ""),
  ]);
  assert.deepEqual(groups.map(group => group.map(item => item.toolCall.id)), [["a", "b"], ["c"], ["d"], ["e"], ["f"], ["g"], ["h"]]);
});

const integrationTool = (id, provider, brief) => ({ toolCall: { id, name: `mcp_${provider}_action`, arguments: brief ? { brief } : {} },
  toolResult: { content: [], details: { serverId: provider, serverLabel: provider.toUpperCase(), tool: "lookup" } } });

test("integration grouping uses verified server identity and explicit command step, preserving unrelated calls", () => {
  const items = [integrationTool("a", "swift"), integrationTool("b", "swift"), integrationTool("c", "github"),
    integrationTool("d", "swift", "Inspect toolbar"),
    { toolCall: { id: "e", name: "Bash", arguments: { description: "Inspect toolbar", command: "read source" } } },
    { toolCall: { id: "f", name: "Bash", arguments: { description: "Inspect startup", command: "read source" } } },
    { toolCall: { id: "g", name: "mcp_swift_fake", arguments: {} } },
    { toolCall: { id: "h", name: "mcp_swift_fake", arguments: {} } }];
  const groups = groupWorkTools(items);
  assert.deepEqual(groups.map(group => group.map(item => item.toolCall.id)), [["a", "b"], ["c"], ["d", "e"], ["f"], ["g"], ["h"]]);
  const t = key => ({ "chat.work.integration": "{provider} integration", "chat.work.integrationCommands": "{provider} integration and commands" })[key];
  assert.equal(workToolGroupLabel(groups[0], t), "SWIFT integration");
  assert.equal(workToolGroupLabel(groups[2], t), "SWIFT integration and commands");
  assert.equal(workToolGroupLabel(groups[3], t), "Inspect startup");
  assert.equal(workToolGroupLabel(groups[4], t), undefined);
});

test("native work disclosure shares grouping, keeps each result, status and narrative/round boundaries", () => {
  const { roundNodes } = createTsModuleLoader({ mocks: { "@git-diff-view/file": {} } }).loadModule("src/presentation/nativeChatEvidence.ts");
  const a = integrationTool("a", "swift"), b = integrationTool("b", "swift");
  b.toolResult.isError = true;
  const labels = { thinking: "Thinking", search: "Search", arguments: "Args", result: "Result", integration: "{provider} integration" };
  const nodes = roundNodes([{ key: "r1", blocks: [{ kind: "tool", item: a }, { kind: "tool", item: b },
    { kind: "text", id: "update", text: "Continue with the next step" }, { kind: "tool", item: integrationTool("c", "swift") }] },
    { key: "r2", blocks: [{ kind: "tool", item: integrationTool("d", "swift") }] }], "reply", false, labels);
  assert.equal(nodes.length, 4);
  assert.equal(nodes[0].label, "SWIFT integration");
  assert.equal(nodes[0].status, "error");
  assert.equal(nodes[0].children.length, 2);
  assert.equal(nodes[0].children[0].label, "SWIFT \u00b7 lookup");
  assert.equal(nodes[1].kind, "Markdown");
  assert.ok(nodes[2].id.includes("r1:tool:c"));
  assert.ok(nodes[3].id.includes("r2:tool:d"));
  const running = roundNodes([{ key: "live", runningToolCallIds: ["b"], blocks: [{ kind: "tool", item: a }, { kind: "tool", item: b }] }], "reply", false, labels);
  assert.equal(running[0].status, "running");
});
