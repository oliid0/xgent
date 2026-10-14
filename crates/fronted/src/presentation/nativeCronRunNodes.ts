import type { ConfirmDialogOptions } from "../components/astryx/useConfirmDialog";
import type { CronTask } from "../lib/automation";
import type { useCronRunHistory } from "../pages/settings/useCronRunHistory";
import type { presentationControls } from "./controls";
import { cronRunDisplay } from "./cronDisplay";
import { nativeCronTaskDetails } from "./nativeCronTaskDetails";
import type { PresentationNode } from "./types";

export function nativeCronRunNodes(options: {
  controls: ReturnType<typeof presentationControls>;
  task: CronTask;
  history: ReturnType<typeof useCronRunHistory>;
  t: (key: string) => string;
  locale?: string;
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
    {
      id: "task-status",
      kind: "Badge",
      label: t(task.enabled ? "settings.cronViewStatusEnabled" : "settings.cronViewStatusDisabled"),
    },
    {
      ...c.action("run", t("settings.cronViewRunNow"), options.run, !options.running),
      icon: "play",
      kind: "IconButton",
      size: "large",
    },
    ...(options.running
      ? [{ id: "running", kind: "Progress" as const, label: t("settings.cronViewRunningNow") }]
      : []),
    ...(options.runError
      ? [
          {
            id: "error",
            kind: "Banner" as const,
            label: t("settings.cronViewRunNowFailed"),
            text: options.runError,
            status: "error" as const,
          },
        ]
      : []),
    ...nativeCronTaskDetails(task, t),
  ];
  const logs: PresentationNode[] = [
    ...(history.logs.length
      ? [
          {
            id: "log-counts",
            kind: "Text" as const,
            text: `${t("settings.cronViewLogSuccess")} ${history.successCount} / ${t("settings.cronViewLogFailed")} ${history.failCount} / ${t("settings.cronViewLogRunning")} ${history.runningCount}`,
            secondary: true,
          },
        ]
      : []),
    {
      ...c.action(
        "refresh-logs",
        t("presentation.retry"),
        history.refresh,
        !history.loading && !history.isClearing,
      ),
      kind: "IconButton",
      icon: "arrow.clockwise",
      size: "large",
    },
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
      kind: "IconButton",
      size: "large",
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
            icon: "clock",
          },
        ]
      : []),
    ...(history.logs.length
      ? [
          {
            id: "cron-history-list",
            kind: "VStack" as const,
            variant: "cron-run-list",
            children: history.logs.map((run): PresentationNode => {
              const display = cronRunDisplay(run, t, options.locale);
              const open = expanded === run.id;
              return {
                id: "cron-run:" + run.id,
                kind: "VStack",
                variant: "cron-run-row",
                status: display.status,
                children: [
                  {
                    ...c.action(run.id + ":expand", display.date, () =>
                      setExpanded(open ? null : run.id),
                    ),
                    selected: open,
                    text: display.time,
                    value: display.label,
                  },
                  ...(open
                    ? [
                        {
                          id: run.id + ":metadata",
                          kind: "Text" as const,
                          text: display.metadata,
                          secondary: true,
                        },
                        ...(run.output
                          ? [
                              {
                                id: run.id + ":output",
                                kind: "CodeBlock" as const,
                                label: t(
                                  task.type === "prompt"
                                    ? "settings.cronViewLogConclusion"
                                    : "settings.cronViewLogOutput",
                                ),
                                text: run.output,
                                language: "text",
                              },
                            ]
                          : []),
                      ]
                    : []),
                ],
              };
            }),
          },
        ]
      : []),
  ];
  return [
    ...(compact
      ? [
          {
            ...c.select(
              "cron-view-tab",
              t("settings.cronView"),
              options.tab,
              [
                { value: "details", label: t("settings.cronViewConfig") },
                { value: "logs", label: t("settings.cronViewRunHistory") },
              ],
              (value) => options.setTab(value as "details" | "logs"),
            ),
            kind: "SegmentedControl" as const,
            variant: "cron-view-tabs",
          },
        ]
      : []),
    {
      id: "cron-view-layout",
      kind: "VStack",
      variant: "cron-detail-layout",
      children: [
        ...(!compact || options.tab === "details"
          ? [{ ...c.group("cron-view-details", "", details), variant: "cron-detail-section" }]
          : []),
        ...(!compact || options.tab === "logs"
          ? [
              {
                ...c.group("cron-view-logs", t("settings.cronViewRunHistory"), logs),
                variant: "task-review",
              },
            ]
          : []),
      ],
    },
  ];
}
