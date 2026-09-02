import assert from "node:assert/strict";
import test from "node:test";

// Runtime snapshots are the local-access projection of the shared chat state.

import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();

const {
  buildConversationRuntimeSnapshotEntries,
  conversationRuntimeSnapshotToLiveTranscript,
} = loader.loadModule("src/pages/chat/local-access/conversationRuntimeSnapshot.ts");
const { buildToolCallPreviewArguments } = loader.loadModule(
  "src/pages/chat/turns/toolCallPreview.ts",
);
const toolPreview = loader.loadModule("src/lib/chat/messages/toolPreview.ts");

test("local access runtime snapshot projects live rounds into chat entries", () => {
  const entries = buildConversationRuntimeSnapshotEntries({
    userMessage: {
      role: "user",
      id: "user-1",
      content: "Run the checks",
    },
    liveTranscript: {
      draftAssistantText: "",
      toolStatus: "Running shell",
      liveRounds: [
        {
          key: "round-1",
          round: 1,
          runningToolCallIds: [],
          thinkingOpen: false,
          blocks: [
            { kind: "thinking", text: "I will inspect the repo." },
            { kind: "text", text: "I found the issue." },
            {
              kind: "tool",
              item: {
                toolCall: {
                  type: "toolCall",
                  id: "tool-1",
                  name: "Shell",
                  arguments: { cmd: "pnpm test" },
                },
                toolResult: {
                  role: "toolResult",
                  toolCallId: "tool-1",
                  toolName: "Shell",
                  content: [{ type: "text", text: "ok" }],
                },
              },
            },
            { kind: "text", text: " Next step is ready." },
          ],
        },
      ],
    },
  });

  assert.deepEqual(
    entries.map((entry) => entry.kind),
    ["user", "thinking", "assistant", "tool_call", "tool_result", "assistant"],
  );
  assert.equal(entries[0].text, "Run the checks");
  assert.equal(entries[1].text, "I will inspect the repo.");
  assert.equal(entries[2].text, "I found the issue.");
  assert.equal(entries[3].toolCall.name, "Shell");
  assert.equal(entries[4].toolResult.toolCallId, "tool-1");
  assert.equal(entries[5].text, " Next step is ready.");
});

test("local access runtime snapshot carries the same tool preview shape as live events", () => {
  const content = "z".repeat(9000);
  const toolCall = {
    type: "toolCall",
    id: "tool-write",
    name: "Write",
    arguments: { path: "big.txt", content },
  };
  const entries = buildConversationRuntimeSnapshotEntries({
    userMessage: null,
    liveTranscript: {
      draftAssistantText: "",
      toolStatus: null,
      liveRounds: [
        {
          key: "round-1",
          round: 1,
          runningToolCallIds: ["tool-write"],
          thinkingOpen: false,
          blocks: [{ kind: "tool", item: { toolCall } }],
        },
      ],
    },
  });

  const entry = entries.find((candidate) => candidate.kind === "tool_call");
  assert.ok(entry, "expected a tool_call entry");
  assert.deepEqual(entry.toolCall.arguments, buildToolCallPreviewArguments(toolCall));
  assert.ok(entry.toolCall.arguments.content.length <= 4000);
  const metadata = entry.toolCall.arguments[toolPreview.LIVE_TOOL_PREVIEW_META_KEY];
  assert.equal(metadata.progress, content.length);
  assert.equal(metadata.fields.content.chars, content.length);
});

test("local access runtime snapshot falls back to draft assistant text", () => {
  const entries = buildConversationRuntimeSnapshotEntries({
    userMessage: {
      role: "user",
      id: "user-2",
      content: "Continue",
    },
    liveTranscript: {
      draftAssistantText: "streaming text",
      toolStatus: null,
      liveRounds: [],
    },
  });

  assert.deepEqual(
    entries.map((entry) => entry.kind),
    ["user", "assistant"],
  );
  assert.equal(entries[1].text, "streaming text");
});

test("paired runtime snapshots rebuild the normal live transcript and settle tool calls", () => {
  const running = conversationRuntimeSnapshotToLiveTranscript({
    state: "running",
    toolStatus: "Browsing",
    entries: [
      { kind: "user", id: "user-3", text: "Open the page" },
      { kind: "thinking", id: "thinking-3", round: 1, text: "Inspecting it." },
      {
        kind: "tool_call",
        id: "tool-3",
        round: 1,
        toolCall: {
          type: "toolCall",
          id: "tool-3",
          name: "browser_use",
          arguments: { action: "snapshot" },
        },
      },
    ],
  });
  assert.equal(running.toolStatus, "Browsing");
  assert.equal(running.isSettled, false);
  assert.deepEqual(running.liveRounds[0].runningToolCallIds, ["tool-3"]);
  assert.deepEqual(
    running.liveRounds[0].blocks.map((block) => block.kind),
    ["thinking", "tool"],
  );

  const completed = conversationRuntimeSnapshotToLiveTranscript({
    state: "completed",
    entries: [
      ...running.liveRounds[0].blocks.flatMap((block) => {
        if (block.kind !== "tool") return [];
        return [
          {
            kind: "tool_call",
            id: block.item.toolCall.id,
            round: 1,
            toolCall: block.item.toolCall,
          },
          {
            kind: "tool_result",
            id: "result-3",
            round: 1,
            toolResult: {
              role: "toolResult",
              toolCallId: "tool-3",
              toolName: "browser_use",
              content: [{ type: "text", text: "done" }],
              isError: false,
              timestamp: 1,
            },
          },
        ];
      }),
      { kind: "assistant", id: "assistant-3", round: 1, text: "Finished." },
    ],
  });
  assert.equal(completed.isSettled, true);
  assert.deepEqual(completed.liveRounds[0].runningToolCallIds, []);
  const toolBlock = completed.liveRounds[0].blocks.find((block) => block.kind === "tool");
  assert.equal(toolBlock.item.toolResult.content[0].text, "done");
});
