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

test("TodoWrite results restore progress, explicit clears remove it and errors do not replace it", () => {
  const todo = (id, todos, isError = false) => ({ kind: "tool", item: {
    toolCall: { id, name: "TodoWrite" },
    toolResult: { details: { kind: "todo_write", todos }, isError },
  } });
  const todos = [{ content: "Verify models", activeForm: "Verifying models", status: "in_progress" }];
  const first = todo("first", todos);
  assert.equal(render([{ blocks: [first] }]).props.snapshot.tasks[0].subject, "Verify models");
  assert.equal(render([{ blocks: [first, todo("error", [], true)] }]).props.snapshot.tasks.length, 1);
  assert.equal(render([{ blocks: [first, todo("clear", [])] }]).props.snapshot.tasks.length, 0);
});

test("an older persisted run cannot hide tasks from the current live turn", () => {
  const tasks = [{ id: "1", subject: "Current task", description: "", activeForm: "Working", status: "in_progress" }];
  const view = render([{ blocks: [{ kind: "tool", item: {
    toolCall: { id: "new", name: "TaskCreate" },
    toolResult: { details: { kind: "task_list", runId: "new", revision: 1, tasks } },
  } }] }], { runId: "old", revision: 9, tasks: [] });
  assert.equal(view.props.snapshot.runId, "new");
  assert.equal(view.props.snapshot.tasks.length, 1);
});
