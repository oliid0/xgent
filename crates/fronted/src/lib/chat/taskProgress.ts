import type { TaskItem, TaskListResultDetails, TaskListState } from "../tools/builtinTypes";
import type { RenderTimelineItem } from "./conversation/conversationState";
import type { LiveRound, UiRound } from "./messages/uiMessages";

export type TaskProgressSnapshot = {
  runId: string;
  revision: number;
  tasks: TaskItem[];
};

const TASK_TOOL_NAMES = new Set(["TaskCreate", "TaskUpdate", "TaskList"]);

/** Task tools are summarized by CurrentTaskProgress and should not also show
 * as ordinary transcript tool cards. Mixed tool groups remain visible. */
export function isTaskToolBlock(block: {
  kind: string;
  item?: { toolCall?: { name?: string } };
  items?: Array<{ toolCall?: { name?: string } }>;
}) {
  if (block.kind === "tool") {
    return TASK_TOOL_NAMES.has(block.item?.toolCall?.name ?? "");
  }
  if (block.kind === "toolGroup" && block.items?.length) {
    return block.items.every((item) => TASK_TOOL_NAMES.has(item.toolCall?.name ?? ""));
  }
  return false;
}

function isTaskItem(value: unknown): value is TaskItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.subject === "string" &&
    typeof item.description === "string" &&
    typeof item.activeForm === "string" &&
    (item.status === "pending" || item.status === "in_progress" || item.status === "completed")
  );
}

function taskSnapshotFromDetails(value: unknown): TaskProgressSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const details = value as Partial<TaskListResultDetails>;
  if (
    details.kind !== "task_list" ||
    typeof details.runId !== "string" ||
    typeof details.revision !== "number" ||
    !Array.isArray(details.tasks) ||
    !details.tasks.every(isTaskItem)
  ) {
    return null;
  }
  return {
    runId: details.runId,
    revision: details.revision,
    tasks: details.tasks.map((task) => ({ ...task })),
  };
}

function taskSnapshotFromState(value?: TaskListState): TaskProgressSnapshot | null {
  if (!value || !Array.isArray(value.tasks) || !value.tasks.every(isTaskItem)) return null;
  return {
    runId: value.runId,
    revision: value.revision,
    tasks: value.tasks.map((task) => ({ ...task })),
  };
}

function snapshotsFromRounds(rounds: readonly UiRound[]) {
  const snapshots: TaskProgressSnapshot[] = [];
  for (const round of rounds) {
    for (const block of round.blocks) {
      if (block.kind !== "tool") continue;
      const snapshot = taskSnapshotFromDetails(block.item.toolResult?.details);
      if (snapshot) snapshots.push(snapshot);
    }
  }
  return snapshots;
}

export function selectLatestTaskProgress(
  historyItems: readonly RenderTimelineItem[],
  liveRounds: readonly LiveRound[],
  persistedState?: TaskListState,
): TaskProgressSnapshot | null {
  const candidates: TaskProgressSnapshot[] = [];
  for (const item of historyItems) {
    if (item.kind === "assistant") candidates.push(...snapshotsFromRounds(item.rounds));
  }
  candidates.push(...snapshotsFromRounds(liveRounds));
  const persisted = taskSnapshotFromState(persistedState);
  if (persisted) candidates.push(persisted);
  return candidates.reduce<TaskProgressSnapshot | null>((latest, candidate) => {
    if (!latest) return candidate;
    if (candidate.runId !== latest.runId) return candidate;
    return candidate.revision >= latest.revision ? candidate : latest;
  }, null);
}
