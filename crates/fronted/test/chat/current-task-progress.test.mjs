import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader({ mocks: {
  react: {
    useCallback: (callback) => callback,
    useMemo: (factory) => factory(),
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  },
  "../../../components/chat/TaskProgressBar": { TaskProgressBar: "TaskProgressBar" },
} });
const { CurrentTaskProgress } = loader.loadModule("src/pages/chat/components/CurrentTaskProgress.tsx");

function render(rounds, persistedState) {
  return CurrentTaskProgress({
    historyItems: [],
    liveTranscriptStore: {
      subscribe: () => () => {},
      getSnapshot: () => ({ liveRounds: rounds }),
    },
    isConversationRunning: true,
    persistedState,
  });
}

test("ordinary browser tool calls never become task progress or completed todos", () => {
  for (const toolResult of [undefined, { content: [], isError: false }, { content: [], isError: true }]) {
    const view = render([{ blocks: [{ kind: "tool", item: {
      toolCall: { id: "browser", name: "browser_use", arguments: { url: "https://example.test" } },
      toolResult,
    } }] }]);
    assert.equal(view.type, "TaskProgressBar");
    assert.equal(view.props.snapshot, null);
  }
});

test("real task updates retain their subject and pending/completed state", () => {
  const tasks = [{ id: "1", subject: "Review changes", description: "", activeForm: "Reviewing changes", status: "in_progress" }];
  const details = { kind: "task_list", runId: "run", revision: 2, tasks };
  const view = render([{ blocks: [{ kind: "tool", item: {
    toolCall: { id: "task", name: "TaskUpdate", arguments: {} },
    toolResult: { details },
  } }] }], { runId: "run", revision: 1, tasks: [{ ...tasks[0], status: "pending" }] });
  assert.equal(view.props.snapshot.tasks[0].subject, "Review changes");
  assert.equal(view.props.snapshot.tasks[0].status, "in_progress");
  assert.equal(view.props.snapshot.revision, 2);
});
