import type { ConfirmDialogOptions } from "../components/astryx/useConfirmDialog";
import type { CronTask } from "../lib/automation";
import type { useCronRunHistory } from "../pages/settings/useCronRunHistory";
import type { presentationControls } from "./controls";
import { nativeCronTaskDetails } from "./nativeCronTaskDetails";
import type { PresentationNode } from "./types";

export function nativeCronRunNodes(options: {
  controls: ReturnType<typeof presentationControls>;
  task: CronTask;
  history: ReturnType<typeof useCronRunHistory>;
  t: (key: string) => string;
  compact: boolean;
  tab: "details" | "logs";
  setTab: (tab: "details" | "logs") => void;
  expanded: string | null;
  setExpanded: (id: string | null) => void;
  running: boolean;
  runError: string | null;
  run: () => Promise<void>;
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
  current: () => boolean;
}): PresentationNode[] {
  const { controls: c, task, history, t, compact, expanded, setExpanded } = options;
  const details: PresentationNode[] = [
    ...nativeCronTaskDetails(task, t),
    {
      ...c.action("run", t("settings.cronViewRunNow"), options.run, !options.running),
      icon: "play",
      prominent: true,
    },
    ...(options.running
      ? [{ id: "running", kind: "Progress" as const, label: t("settings.cronViewRunningNow") }]
      : []),
    ...(options.runError
      ? [
          {
            id: "error",
            kind: "Banner" as const,
            label: options.runError,
            status: "error" as const,
          },
        ]
      : []),
  ];
  const logs: PresentationNode[] = [
    {
      id: "log-counts",
      kind: "HStack",
      wrap: true,
      children: [
        {
          id: "log-success-count",
          kind: "Badge",
          label: `${t("settings.cronViewLogSuccess")} ${history.successCount}`,
          status: "completed",
        },
        {
          id: "log-failure-count",
          kind: "Badge",
          label: `${t("settings.cronViewLogFailed")} ${history.failCount}`,
          status: "error",
        },
        {
          id: "log-running-count",
          kind: "Badge",
          label: `${t("settings.cronViewLogRunning")} ${history.runningCount}`,
          status: "running",
        },
      ],
    },
    c.action(
      "refresh-logs",
      t("presentation.retry"),
      history.refresh,
      !history.loading && !history.isClearing,
    ),
    {
      ...c.action(
        "clear-logs",
        t("settings.cronViewClearLogs"),
        async () => {
          const approved = await options.confirm({
            title: t("settings.cronViewClearLogsConfirm"),
            description: `${t("settings.cronViewClearLogsConfirmDescBefore")} ${task.name}${t("settings.cronViewClearLogsConfirmDescAfter")}`,
            confirmLabel: t("settings.cronViewClearLogs"),
            cancelLabel: t("settings.cancel"),
            tone: "destructive",
          });
          if (!approved || !options.current()) return;
          await history.clear();
          if (options.current()) setExpanded(null);
        },
        history.clearableCount > 0 && !history.isClearing,
      ),
      destructive: true,
      icon: "trash",
    },
    ...(history.loading && !history.logs.length
      ? [{ id: "logs-loading", kind: "Progress" as const, label: t("app.loading") }]
      : []),
    ...(history.loadError
      ? [
          {
            id: "logs-error",
            kind: "Banner" as const,
            label: t("settings.cronViewLogsLoadFailed"),
            text: history.loadError,
            status: "error" as const,
          },
        ]
      : []),
    ...(history.clearError
      ? [
          {
            id: "logs-clear-error",
            kind: "Banner" as const,
            label: t("settings.cronViewClearLogsFailed"),
            text: history.clearError,
            status: "error" as const,
          },
        ]
      : []),
    ...(!history.logs.length && !history.loading && !history.loadError
      ? [
          {
            id: "logs-empty",
            kind: "EmptyState" as const,
            label: t("settings.cronViewLogsEmpty"),
            text: t("settings.cronViewLogsEmptyHint"),
            icon: "clock",
          },
        ]
      : []),
    ...history.logs.map((run): PresentationNode => {
      const running = run.state === "pending" || run.state === "leased";
      const status = running
        ? "running"
        : run.state === "done" && run.success
          ? "completed"
          : "error";
      const label = t(
        running
          ? "settings.cronViewLogRunning"
          : run.state === "expired"
            ? "settings.cronViewLogExpired"
            : run.success
              ? "settings.cronViewLogSuccess"
              : "settings.cronViewLogFailed",
      );
      const open = expanded === run.id;
      const duration =
        run.durationMs < 1000 ? `${run.durationMs}ms` : `${(run.durationMs / 1000).toFixed(1)}s`;
      return {
        id: `cron-run:${run.id}`,
        kind: "VStack",
        variant: "cron-run-row",
        status,
        children: [
          {
            ...c.action(`${run.id}:expand`, new Date(run.startedAt).toLocaleString(), () =>
              setExpanded(open ? null : run.id),
            ),
            selected: open,
            text: `${label} · ${duration}${run.exitCode === undefined ? "" : ` · ${t("settings.cronViewLogExit")} ${run.exitCode}`}`,
          },
          ...(open
            ? [
                {
                  id: `${run.id}:output`,
                  kind: "CodeBlock" as const,
                  label: t("settings.cronViewLogOutput"),
                  text: run.output,
                  language: "text",
                },
              ]
            : []),
        ],
      };
    }),
  ];
  return [
    ...(compact
      ? [
          c.select(
            "cron-view-tab",
            t("settings.cronView"),
            options.tab,
            [
              { value: "details", label: t("settings.cronViewConfig") },
              { value: "logs", label: t("settings.cronViewLogs") },
            ],
            (value) => options.setTab(value as "details" | "logs"),
          ),
        ]
      : []),
    {
      id: "cron-view-layout",
      kind: "VStack",
      variant: "cron-detail-layout",
      children: [
        ...(!compact || options.tab === "details"
          ? [c.group("cron-view-details", t("settings.cronViewConfig"), details)]
          : []),
        ...(!compact || options.tab === "logs"
          ? [c.group("cron-view-logs", t("settings.cronViewLogs"), logs)]
          : []),
      ],
    },
  ];
}
