import { useEffect, useState } from "react";
import { FolderOpen, Loader2, X } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import {
  cancelGitClone,
  dismissGitClone,
  listGitCloneTasks,
} from "../../../lib/git/tauriGitClient";
import type { GitCloneTask } from "../../../lib/git/types";

export function WorkspaceCloneTaskOverlay(props: { onOpenWorkspace: (path: string) => void }) {
  const { onOpenWorkspace } = props;
  const { t } = useLocale();
  const [tasks, setTasks] = useState<GitCloneTask[]>([]);

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try {
        const next = await listGitCloneTasks();
        if (!disposed) setTasks(next);
      } catch {
        // The desktop bridge may be unavailable while the WebView is reloading.
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 650);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  if (tasks.length === 0) return null;

  return (
    <div
      data-edge-swipe-ignore
      className="fixed bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] left-3 right-3 z-[95] space-y-2 md:left-auto md:right-4 md:w-[380px]"
    >
      {tasks.map((task) => {
        const running = task.status === "running" || task.status === "cancelling";
        const completed = task.status === "completed";
        return (
          <div
            key={task.id}
            className="rounded-2xl border bg-background/95 p-3 shadow-2xl backdrop-blur"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                {running ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FolderOpen className="h-4 w-4" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{task.repositoryName}</div>
                <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  {task.error || task.detail}
                </div>
              </div>
              {!running ? (
                <button
                  type="button"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
                  aria-label={t("chat.clone.dismiss")}
                  onClick={() => {
                    void dismissGitClone(task.id).then(setTasks);
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            {running ? (
              <div className="mt-3">
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-300"
                    style={{ width: `${task.progress ?? 8}%` }}
                  />
                </div>
                <button
                  type="button"
                  disabled={task.status === "cancelling"}
                  className="mt-2 text-xs font-medium text-destructive disabled:opacity-50"
                  onClick={() =>
                    void cancelGitClone(task.id).then((next) =>
                      setTasks((prev) => prev.map((item) => (item.id === next.id ? next : item))),
                    )
                  }
                >
                  {task.status === "cancelling"
                    ? t("chat.clone.cancelling")
                    : t("chat.clone.cancel")}
                </button>
              </div>
            ) : completed ? (
              <button
                type="button"
                className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-primary text-xs font-semibold text-primary-foreground"
                onClick={() => onOpenWorkspace(task.targetPath)}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                {t("chat.clone.open")}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
