import type { TaskProgressSnapshot } from "../lib/chat/taskProgress";
import type { PresentationNode } from "./types";

export function createNativeTaskProgress(
  taskProgress: TaskProgressSnapshot | null,
  running: boolean,
  t: (key: string) => string,
): PresentationNode | undefined {
  return taskProgress?.tasks.length
    ? {
        id: `task-progress:${taskProgress.runId}`,
        kind: "TaskProgress",
        label:
          taskProgress.tasks.find((task) => task.status === "in_progress")?.activeForm ||
          taskProgress.tasks.find((task) => task.status === "in_progress")?.subject ||
          (taskProgress.tasks.every((task) => task.status === "completed")
            ? t("chat.tasks.completed")
            : t("chat.tasks.ready")),
        accessibilityLabel: t("chat.tasks.todo"),
        text: `${taskProgress.tasks.filter((task) => task.status === "completed").length}/${taskProgress.tasks.length}`,
        current: taskProgress.tasks.filter((task) => task.status === "completed").length,
        total: taskProgress.tasks.length,
        status: taskProgress.tasks.every((task) => task.status === "completed")
          ? "completed"
          : running
            ? "running"
            : "paused",
        children: taskProgress.tasks.map((task) => ({
          id: `task-progress:${taskProgress.runId}:${task.id}`,
          kind: "TaskStep",
          label: task.subject,
          text: task.status === "in_progress" ? task.activeForm : task.description,
          status: task.status === "in_progress" ? (running ? "running" : "paused") : task.status,
          accessibilityValue: t(
            task.status === "completed"
              ? "chat.tasks.completed"
              : task.status === "in_progress"
                ? "chat.mobileActivity.working"
                : "chat.tasks.todo",
          ),
        })),
      }
    : undefined;
}
