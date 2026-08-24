import { Check, Loader2 } from "../icons";
import { useLocale } from "../../i18n";
import type { TaskProgressSnapshot } from "../../lib/chat/taskProgress";
import { cn } from "../../lib/shared/utils";

export function TaskProgressBar(props: {
  snapshot: TaskProgressSnapshot | null;
  isConversationRunning: boolean;
}) {
  const { t } = useLocale();
  const { snapshot, isConversationRunning } = props;
  if (!snapshot || snapshot.tasks.length === 0) return null;

  const completed = snapshot.tasks.filter((task) => task.status === "completed").length;
  const active = snapshot.tasks.find((task) => task.status === "in_progress");
  const percent = Math.round((completed / snapshot.tasks.length) * 100);
  const label = active?.activeForm || active?.subject || t("chat.tasks.ready");

  return (
    <div className="mx-auto w-full max-w-4xl px-3 pb-2 sm:px-5">
      <div className="rounded-xl border border-border/55 bg-background/90 px-3 py-2 shadow-sm backdrop-blur-xl">
        <div className="flex items-center gap-2 text-xs">
          {active && isConversationRunning ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-violet-500" />
          ) : (
            <Check
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                completed === snapshot.tasks.length ? "text-emerald-500" : "text-muted-foreground",
              )}
            />
          )}
          <span className="min-w-0 flex-1 truncate font-medium text-foreground/85">{label}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {completed}/{snapshot.tasks.length}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={t("chat.tasks.progress")}
          aria-valuemin={0}
          aria-valuemax={snapshot.tasks.length}
          aria-valuenow={completed}
          className="mt-2 h-1 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-violet-500 transition-[width] duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    </div>
  );
}
