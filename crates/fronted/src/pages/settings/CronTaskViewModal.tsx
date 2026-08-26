import { Button as AstryxButton } from "@xagent/ui/components/ui/button";
import {
  Heading as AstryxHeading,
  Inline as AstryxInline,
  Paragraph as AstryxParagraph,
  View as AstryxView,
} from "@xagent/ui/components/ui/view";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BrushCleaning,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Folder,
  Globe,
  Loader2,
  MessageSquare,
  Play,
  ScrollText,
  Terminal,
  Timer,
  X,
  XCircle,
} from "../../components/icons";
import { useLocale } from "../../i18n";
import {
  type CronRunRecord,
  type CronTask,
  type CronTaskType,
  clearCronRuns,
  DEFAULT_CRON_TIMEOUT_SECONDS,
  isManualCronRunFinished,
  listCronRuns,
  MANUAL_CRON_RUN_POLL_INTERVAL_MS,
  MANUAL_CRON_RUN_TIMEOUT_MS,
  runCronNow,
  useAutomation,
} from "../../lib/automation";
import { useCompactViewport } from "../../lib/responsive/compactViewport";
import { SettingsModalShell } from "./SettingsModalShell";
import { ConfirmActionPopover } from "./shared";

type CronTaskViewModalProps = {
  taskId: string;
  onClose: () => void;
};

const TYPE_CONFIG: Record<
  CronTaskType,
  {
    icon: typeof Terminal;
    label: string;
    accent: string;
    accentBg: string;
    accentBorder: string;
  }
> = {
  bash: {
    icon: Terminal,
    label: "settings.cronTypeBash",
    accent: "text-blue-600 dark:text-blue-400",
    accentBg: "bg-blue-500/10",
    accentBorder: "border-blue-500/20",
  },
  http: {
    icon: Globe,
    label: "settings.cronTypeHttp",
    accent: "text-emerald-600 dark:text-emerald-400",
    accentBg: "bg-emerald-500/10",
    accentBorder: "border-emerald-500/20",
  },
  prompt: {
    icon: MessageSquare,
    label: "settings.cronTypePrompt",
    accent: "text-violet-600 dark:text-violet-400",
    accentBg: "bg-violet-500/10",
    accentBorder: "border-violet-500/20",
  },
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function stringifyHeaders(headers?: Record<string, string>) {
  if (!headers || Object.keys(headers).length === 0) return "";
  return JSON.stringify(headers, null, 2);
}

function stringifyBody(body?: unknown) {
  if (body === undefined) return "";
  return JSON.stringify(body, null, 2);
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <AstryxView
      layout="block"
      direction="horizontal"
      className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70"
    >
      {children}
    </AstryxView>
  );
}

function EmptyConfig({ t }: { t: (key: string) => string }) {
  return (
    <AstryxView
      layout="block"
      direction="horizontal"
      className="rounded-xl border border-dashed border-border/50 bg-muted/10 py-6 text-center text-xs text-muted-foreground/60"
    >
      {t("settings.cronViewNoConfig")}
    </AstryxView>
  );
}

/* ─────────────────────── Left panel ─────────────────────── */

function LeftPanel({
  task,
  t,
  cfg,
  isRunningNow,
  runNowError,
  onRunNow,
  onClose,
}: {
  task: CronTask;
  t: (key: string) => string;
  cfg: (typeof TYPE_CONFIG)[CronTaskType];
  isRunningNow: boolean;
  runNowError: string | null;
  onRunNow: () => void;
  onClose: () => void;
}) {
  const TypeIcon = cfg.icon;
  const script = task.script?.trim() ?? "";
  const scriptLineCount = script.split(/\r?\n/).filter((line) => line.trim()).length;

  return (
    <>
      {/* ── Fixed hero header ── */}
      <AstryxView
        layout="block"
        direction="horizontal"
        className="relative shrink-0 overflow-hidden"
      >
        <AstryxView
          layout="block"
          direction="horizontal"
          className={`absolute inset-0 ${cfg.accentBg} opacity-40`}
        />
        <AstryxView
          layout="block"
          direction="horizontal"
          className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br from-white/10 to-transparent blur-2xl"
        />

        <AstryxView layout="block" direction="horizontal" className="relative px-5 pb-4 pt-5">
          {/* Type badge + run-now button on the hero's top row, kept out of
              the meta/content area so pill wrapping never moves the button */}
          <AstryxView
            layout="flex"
            direction="horizontal"
            className="flex items-center justify-between gap-2"
          >
            <AstryxView
              layout="block"
              direction="horizontal"
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${cfg.accent} ${cfg.accentBg} ${cfg.accentBorder}`}
            >
              <TypeIcon className="h-3 w-3" />
              {t(cfg.label)}
            </AstryxView>
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="flex shrink-0 items-center gap-1.5"
            >
              <AstryxButton
                type="button"
                onClick={onRunNow}
                disabled={isRunningNow}
                title={
                  isRunningNow ? t("settings.cronViewRunningNow") : t("settings.cronViewRunNow")
                }
                aria-label={
                  isRunningNow ? t("settings.cronViewRunningNow") : t("settings.cronViewRunNow")
                }
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors ${cfg.accent} ${cfg.accentBg} ${cfg.accentBorder} hover:brightness-110 disabled:cursor-wait disabled:opacity-60`}
              >
                {isRunningNow ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
              </AstryxButton>
              {/* Desktop keeps the close button in the logs header. The compact
                  mobile layout places this copy beside run-now and hides the
                  logs-header copy. */}
              <AstryxButton
                type="button"
                onClick={onClose}
                title={t("settings.cronViewClose")}
                aria-label={t("settings.cronViewClose")}
                className="settings-cron-view-hero-close hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              >
                <X size={14} />
              </AstryxButton>
            </AstryxView>
          </AstryxView>

          {/* Name */}
          <AstryxHeading
            level={2}
            className="mt-3 text-base font-bold leading-tight text-foreground"
          >
            {task.name}
          </AstryxHeading>

          {/* Description */}
          <AstryxParagraph className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {task.description || t("settings.cronViewNoDesc")}
          </AstryxParagraph>

          {/* Meta pills */}
          <AstryxView
            layout="flex"
            direction="horizontal"
            className="mt-3 flex flex-wrap items-center gap-2"
          >
            <AstryxView
              layout="inline-flex"
              direction="horizontal"
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-600 dark:text-amber-400"
            >
              <Clock3 className="h-3 w-3" />
              <AstryxInline className="font-mono">{task.cron}</AstryxInline>
            </AstryxView>
            <AstryxView
              layout="block"
              direction="horizontal"
              className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium ${
                task.enabled
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <AstryxInline
                className={`h-1.5 w-1.5 rounded-full ${task.enabled ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
              />
              {task.enabled
                ? t("settings.cronViewStatusEnabled")
                : t("settings.cronViewStatusDisabled")}
            </AstryxView>
            <AstryxView
              layout="block"
              direction="horizontal"
              className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium ${
                task.remainingExecutions === 0
                  ? "bg-red-500/10 text-red-600 dark:text-red-400"
                  : task.remainingExecutions == null
                    ? "bg-muted text-muted-foreground"
                    : "bg-sky-500/10 text-sky-600 dark:text-sky-400"
              }`}
              title={
                task.remainingExecutions == null
                  ? t("settings.cronRemainingExecutionsUnlimited")
                  : `${task.remainingExecutions} ${t("settings.cronRemainingExecutionsUnit")}`
              }
            >
              <AstryxInline className="tabular-nums">
                {task.remainingExecutions == null ? "∞" : task.remainingExecutions}
              </AstryxInline>
              {task.remainingExecutions == null ? null : (
                <AstryxInline>{t("settings.cronRemainingExecutionsUnitShort")}</AstryxInline>
              )}
            </AstryxView>
            <AstryxView
              layout="inline-flex"
              direction="horizontal"
              className="inline-flex items-center gap-1 rounded-lg bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground"
              title={t("settings.cronTimeoutSeconds")}
            >
              <Timer className="h-3 w-3" />
              <AstryxInline className="tabular-nums">
                {task.timeoutSeconds ?? DEFAULT_CRON_TIMEOUT_SECONDS}
                {t("settings.cronTimeoutSecondsUnitShort")}
              </AstryxInline>
            </AstryxView>
            {task.workdir ? (
              <AstryxView
                layout="inline-flex"
                direction="horizontal"
                className="inline-flex max-w-56 items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground"
                title={task.workdir}
              >
                <Folder className="h-3 w-3 shrink-0" />
                <AstryxInline className="truncate">{task.workdir}</AstryxInline>
              </AstryxView>
            ) : null}
          </AstryxView>

          {runNowError ? (
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="mt-3 flex items-start gap-1.5 rounded-lg border border-red-500/20 bg-red-500/[0.04] px-2.5 py-2 text-[11px] leading-relaxed text-red-700 dark:text-red-300"
            >
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <AstryxInline className="min-w-0 break-all">
                {t("settings.cronViewRunNowFailed")}: {runNowError}
              </AstryxInline>
            </AstryxView>
          ) : null}

          {task.lastError ? (
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="mt-3 flex items-start gap-1.5 rounded-lg border border-red-500/20 bg-red-500/[0.04] px-2.5 py-2 text-[11px] leading-relaxed text-red-700 dark:text-red-300"
            >
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <AstryxInline className="min-w-0 break-all">{task.lastError}</AstryxInline>
            </AstryxView>
          ) : null}
        </AstryxView>
      </AstryxView>

      {/* ── Scrollable config ── */}
      <AstryxView
        layout="block"
        direction="horizontal"
        className="min-h-0 flex-1 overflow-y-auto border-t border-border/30 px-5 py-4"
      >
        <AstryxView layout="block" direction="horizontal" className="space-y-2.5">
          <SectionLabel>{t("settings.cronViewConfig")}</SectionLabel>

          {/* Bash */}
          {task.type === "bash" ? (
            script ? (
              <AstryxView
                layout="block"
                direction="horizontal"
                className="overflow-hidden rounded-xl border border-border/60 bg-muted/30"
              >
                <AstryxView
                  layout="flex"
                  direction="horizontal"
                  className="flex items-center gap-1.5 border-b border-border/30 px-3 py-2"
                >
                  <Terminal className="h-3 w-3 text-muted-foreground/60" />
                  <AstryxInline className="text-[11px] font-medium text-muted-foreground/60">
                    {scriptLineCount} {t("settings.cronCommandsCount")}
                  </AstryxInline>
                </AstryxView>
                <pre className="whitespace-pre-wrap break-all px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground/80">
                  {script}
                </pre>
              </AstryxView>
            ) : (
              <EmptyConfig t={t} />
            )
          ) : null}

          {/* HTTP */}
          {task.type === "http" ? (
            (task.requests ?? []).length > 0 ? (
              <AstryxView layout="block" direction="horizontal" className="space-y-2.5">
                {(task.requests ?? []).map((req, i) => {
                  const headersText = stringifyHeaders(req.headers);
                  const bodyText = stringifyBody(req.body);
                  const hasHeaders = headersText.trim().length > 0;
                  const hasBody = bodyText.trim().length > 0;
                  return (
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      key={req.id}
                      className="overflow-hidden rounded-xl border border-border/60 bg-muted/30"
                    >
                      <AstryxView
                        layout="flex"
                        direction="horizontal"
                        className="flex items-center gap-2 border-b border-border/30 px-3 py-2.5"
                      >
                        <AstryxView
                          as="span"
                          layout="flex"
                          direction="horizontal"
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-[10px] font-bold text-emerald-600 dark:text-emerald-400"
                        >
                          {i + 1}
                        </AstryxView>
                        <AstryxInline className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                          {req.method}
                        </AstryxInline>
                        <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/80">
                          {req.url || "—"}
                        </code>
                      </AstryxView>
                      {hasHeaders || hasBody ? (
                        <AstryxView
                          layout="block"
                          direction="horizontal"
                          className="space-y-px bg-border/10"
                        >
                          {hasHeaders ? (
                            <AstryxView
                              layout="block"
                              direction="horizontal"
                              className="bg-background/60 p-2.5"
                            >
                              <AstryxView
                                layout="block"
                                direction="horizontal"
                                className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60"
                              >
                                {t("settings.cronViewHttpHeaders")}
                              </AstryxView>
                              <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-foreground/70">
                                {headersText}
                              </pre>
                            </AstryxView>
                          ) : null}
                          {hasBody ? (
                            <AstryxView
                              layout="block"
                              direction="horizontal"
                              className="bg-background/60 p-2.5"
                            >
                              <AstryxView
                                layout="block"
                                direction="horizontal"
                                className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60"
                              >
                                {t("settings.cronViewHttpBody")}
                              </AstryxView>
                              <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-foreground/70">
                                {bodyText}
                              </pre>
                            </AstryxView>
                          ) : null}
                        </AstryxView>
                      ) : null}
                    </AstryxView>
                  );
                })}
              </AstryxView>
            ) : (
              <EmptyConfig t={t} />
            )
          ) : null}

          {/* Prompt */}
          {task.type === "prompt" ? (
            <AstryxView layout="block" direction="horizontal" className="space-y-2.5">
              {task.selectedModel ? (
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="overflow-hidden rounded-xl border border-border/60 bg-muted/30"
                >
                  <AstryxView
                    layout="flex"
                    direction="horizontal"
                    className="flex items-center gap-1.5 border-b border-border/30 px-3 py-2"
                  >
                    <MessageSquare className="h-3 w-3 text-muted-foreground/60" />
                    <AstryxInline className="text-[11px] font-medium text-muted-foreground/60">
                      {t("settings.cronPromptModelLabel")}
                    </AstryxInline>
                  </AstryxView>
                  <AstryxView layout="block" direction="horizontal" className="px-3.5 py-3">
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="text-xs font-medium text-foreground/85"
                    >
                      {task.selectedModel.model}
                    </AstryxView>
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="mt-1 text-[11px] text-muted-foreground/70"
                    >
                      {task.selectedModel.customProviderId}
                    </AstryxView>
                  </AstryxView>
                </AstryxView>
              ) : null}

              {task.prompt?.trim() ? (
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="overflow-hidden rounded-xl border border-border/60 bg-muted/30"
                >
                  <AstryxView
                    layout="flex"
                    direction="horizontal"
                    className="flex items-center gap-1.5 border-b border-border/30 px-3 py-2"
                  >
                    <MessageSquare className="h-3 w-3 text-muted-foreground/60" />
                    <AstryxInline className="text-[11px] font-medium text-muted-foreground/60">
                      {t("settings.cronPromptLabel")}
                    </AstryxInline>
                  </AstryxView>
                  <AstryxView layout="block" direction="horizontal" className="px-3.5 py-3">
                    <AstryxParagraph className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/80">
                      {task.prompt}
                    </AstryxParagraph>
                  </AstryxView>
                </AstryxView>
              ) : (
                <EmptyConfig t={t} />
              )}
            </AstryxView>
          ) : null}
        </AstryxView>
      </AstryxView>
    </>
  );
}

/* ─────────────────────── Right panel ─────────────────────── */

function RightPanel({
  task,
  t,
  onClose,
  hideClose = false,
}: {
  task: CronTask;
  t: (key: string) => string;
  onClose: () => void;
  hideClose?: boolean;
}) {
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [logs, setLogs] = useState<CronRunRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadLogs() {
      try {
        const nextLogs = await listCronRuns(task.id, 100);
        if (!cancelled) {
          setLoadError(null);
          setLogs(Array.isArray(nextLogs) ? nextLogs : []);
        }
      } catch (error) {
        // Keep the last successfully loaded list; a failed fetch must not
        // masquerade as "no logs".
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      }
    }

    void loadLogs();
    const timer = window.setInterval(() => {
      void loadLogs();
    }, 5_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [task.id]);

  const runningCount = logs.filter(
    (log) => log.state === "pending" || log.state === "leased",
  ).length;
  const successCount = logs.filter((log) => log.state === "done" && log.success).length;
  const failCount = logs.filter(
    (log) => (log.state === "done" || log.state === "expired") && !log.success,
  ).length;
  const clearableCount = successCount + failCount;

  async function handleClearLogs() {
    if (clearableCount === 0 || isClearing) {
      return;
    }

    try {
      setIsClearing(true);
      setClearError(null);
      await clearCronRuns(task.id);
      setExpandedLogId(null);
      setLogs((current) =>
        current.filter((log) => log.state === "pending" || log.state === "leased"),
      );
    } catch {
      setClearError(t("settings.cronViewClearLogsFailed"));
    } finally {
      setIsClearing(false);
    }
  }

  return (
    <>
      {/* ── Fixed header ── */}
      <AstryxView
        layout="flex"
        direction="horizontal"
        className="settings-cron-logs-header flex shrink-0 items-center gap-2 border-b border-border/30 px-5 py-3.5"
      >
        <ScrollText className="h-4 w-4 text-muted-foreground/50" />
        <AstryxInline className="text-sm font-semibold text-foreground">
          {t("settings.cronViewLogs")}
        </AstryxInline>
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="ml-auto flex items-center gap-2"
        >
          <ConfirmActionPopover
            title={t("settings.cronViewClearLogsConfirm")}
            description={
              <>
                {t("settings.cronViewClearLogsConfirmDescBefore")}{" "}
                <AstryxInline className="font-medium text-foreground">{task.name}</AstryxInline>
                {t("settings.cronViewClearLogsConfirmDescAfter")}
              </>
            }
            confirmLabel={t("settings.cronViewClearLogs")}
            onConfirm={() => {
              void handleClearLogs();
            }}
          >
            {(open) => (
              <AstryxButton
                type="button"
                onClick={open}
                disabled={clearableCount === 0 || isClearing}
                title={
                  isClearing ? t("settings.cronViewClearingLogs") : t("settings.cronViewClearLogs")
                }
                aria-label={
                  isClearing ? t("settings.cronViewClearingLogs") : t("settings.cronViewClearLogs")
                }
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <BrushCleaning className="h-3.5 w-3.5" />
              </AstryxButton>
            )}
          </ConfirmActionPopover>
          {logs.length > 0 ? (
            <AstryxView
              as="span"
              layout="inline-flex"
              direction="horizontal"
              className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-emerald-600 dark:text-emerald-400"
            >
              <CheckCircle2 className="h-2.5 w-2.5" />
              {successCount}
            </AstryxView>
          ) : null}
          {logs.length > 0 && failCount > 0 ? (
            <AstryxView
              as="span"
              layout="inline-flex"
              direction="horizontal"
              className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-red-600 dark:text-red-400"
            >
              <XCircle className="h-2.5 w-2.5" />
              {failCount}
            </AstryxView>
          ) : null}
          {runningCount > 0 ? (
            <AstryxView
              as="span"
              layout="inline-flex"
              direction="horizontal"
              className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-sky-600 dark:text-sky-400"
            >
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              {runningCount}
            </AstryxView>
          ) : null}
        </AstryxView>
        {!hideClose ? (
          <AstryxButton
            type="button"
            onClick={onClose}
            title={t("settings.cronViewClose")}
            aria-label={t("settings.cronViewClose")}
            className="settings-cron-logs-close flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <X size={14} />
          </AstryxButton>
        ) : null}
      </AstryxView>

      {/* ── Scrollable log list ── */}
      <AstryxView
        layout="block"
        direction="horizontal"
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
      >
        {loadError ? (
          <AstryxView
            layout="flex"
            direction="horizontal"
            className="mb-3 flex items-start gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300"
          >
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <AstryxInline className="min-w-0 break-all">
              {t("settings.cronViewLogsLoadFailed")}: {loadError}
            </AstryxInline>
          </AstryxView>
        ) : null}
        {clearError ? (
          <AstryxView
            layout="block"
            direction="horizontal"
            className="mb-3 rounded-lg border border-red-500/20 bg-red-500/[0.03] px-3 py-2 text-[11px] text-red-700 dark:text-red-300"
          >
            {clearError}
          </AstryxView>
        ) : null}
        {logs.length > 0 ? (
          <AstryxView layout="block" direction="horizontal" className="space-y-2">
            {logs.map((log) => {
              const isExpanded = expandedLogId === log.id;
              const isExpired = log.state === "expired";
              const isRunning = log.state === "pending" || log.state === "leased";

              return (
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  key={log.id}
                  className={`overflow-hidden rounded-xl border transition-colors ${
                    isRunning
                      ? "border-sky-500/20 bg-sky-500/[0.03]"
                      : log.success
                        ? "border-border/50 bg-muted/20"
                        : "border-red-500/20 bg-red-500/[0.03]"
                  }`}
                >
                  {/* Summary — fixed-width columns for vertical alignment */}
                  <AstryxButton
                    type="button"
                    onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                    className="settings-log-row flex w-full items-center gap-2 px-3 py-2.5 text-left"
                  >
                    {/* Status icon */}
                    {isRunning ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-500" />
                    ) : log.success ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                    )}
                    {/* Timestamp — fixed width */}
                    <AstryxInline className="w-[130px] shrink-0 font-mono text-[11px] text-foreground/70">
                      {formatTimestamp(log.startedAt)}
                    </AstryxInline>
                    {/* Status tag — fixed width for alignment */}
                    <AstryxInline
                      className={`w-[36px] shrink-0 text-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
                        isRunning
                          ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                          : log.success
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "bg-red-500/10 text-red-600 dark:text-red-400"
                      }`}
                    >
                      {isRunning
                        ? t("settings.cronViewLogRunning")
                        : log.success
                          ? t("settings.cronViewLogSuccess")
                          : isExpired
                            ? t("settings.cronViewLogExpired")
                            : t("settings.cronViewLogFailed")}
                    </AstryxInline>
                    {/* Duration — right-aligned fixed width */}
                    <AstryxInline className="ml-auto w-[48px] shrink-0 text-right text-[11px] tabular-nums text-muted-foreground/50">
                      {isRunning ? "—" : formatDuration(log.durationMs)}
                    </AstryxInline>
                    {/* Chevron */}
                    <ChevronDown
                      className={`h-3 w-3 shrink-0 text-muted-foreground/40 transition-transform ${
                        isExpanded ? "rotate-0" : "-rotate-90"
                      }`}
                    />
                  </AstryxButton>

                  {/* Detail */}
                  {isExpanded ? (
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="space-y-2 border-t border-border/30 bg-muted/10 px-3 py-2.5"
                    >
                      <AstryxView
                        layout="flex"
                        direction="horizontal"
                        className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]"
                      >
                        <AstryxInline className="text-muted-foreground/60">
                          {t("settings.cronViewLogDuration")}:{" "}
                          <AstryxInline className="font-medium text-foreground/70">
                            {formatDuration(log.durationMs)}
                          </AstryxInline>
                        </AstryxInline>
                        {log.exitCode !== undefined && log.exitCode !== null ? (
                          <AstryxInline className="text-muted-foreground/60">
                            {t("settings.cronViewLogExit")}:{" "}
                            <AstryxInline
                              className={`font-mono font-medium ${
                                log.exitCode === 0
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-red-600 dark:text-red-400"
                              }`}
                            >
                              {log.exitCode}
                            </AstryxInline>
                          </AstryxInline>
                        ) : null}
                      </AstryxView>
                      {log.output ? (
                        <AstryxView layout="block" direction="horizontal" className="space-y-1">
                          <AstryxView
                            layout="block"
                            direction="horizontal"
                            className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50"
                          >
                            {task.type === "prompt"
                              ? t("settings.cronViewLogConclusion")
                              : t("settings.cronViewLogOutput")}
                          </AstryxView>
                          <pre
                            className={`whitespace-pre-wrap break-all rounded-lg border px-2.5 py-2 font-mono text-[11px] leading-relaxed ${
                              log.success
                                ? "border-border/40 bg-background/60 text-foreground/70"
                                : "border-red-500/15 bg-red-500/[0.03] text-red-700 dark:text-red-300"
                            }`}
                          >
                            {log.output}
                          </pre>
                        </AstryxView>
                      ) : null}
                    </AstryxView>
                  ) : null}
                </AstryxView>
              );
            })}
          </AstryxView>
        ) : (
          <AstryxView
            layout="flex"
            direction="vertical"
            className="flex h-full flex-col items-center justify-center text-center"
          >
            <ScrollText className="h-8 w-8 text-muted-foreground/15" />
            <AstryxParagraph className="mt-3 text-xs font-medium text-muted-foreground/50">
              {t("settings.cronViewLogsEmpty")}
            </AstryxParagraph>
            <AstryxParagraph className="mt-0.5 text-[11px] text-muted-foreground/35">
              {t("settings.cronViewLogsEmptyHint")}
            </AstryxParagraph>
          </AstryxView>
        )}
      </AstryxView>
    </>
  );
}

/* ─────────────────────── Modal shell ─────────────────────── */

export function CronTaskViewModal({ taskId, onClose }: CronTaskViewModalProps) {
  const { t } = useLocale();
  const compactViewport = useCompactViewport();
  // Live subscription: enable/disable toggles, executor decrements and
  // scheduler errors show up while the modal is open.
  const { cron } = useAutomation();
  const task = cron.tasks.find((item) => item.id === taskId);
  const [isRunningNow, setIsRunningNow] = useState(false);
  const [manualRunStartedAt, setManualRunStartedAt] = useState<number | null>(null);
  const [runNowError, setRunNowError] = useState<string | null>(null);
  const [compactTab, setCompactTab] = useState<"details" | "logs">("details");
  const runNowLockRef = useRef(false);
  // Manual runs are watched for at least the legacy six-minute window, and
  // longer when the task timeout exceeds it (plus scheduler/completion slack).
  const manualRunWatchTimeoutMs = Math.max(
    MANUAL_CRON_RUN_TIMEOUT_MS,
    ((task?.timeoutSeconds ?? DEFAULT_CRON_TIMEOUT_SECONDS) + 60) * 1_000,
  );

  useEffect(() => {
    if (!task) {
      onClose();
    }
  }, [task, onClose]);

  useEffect(() => {
    if (manualRunStartedAt == null) return;
    const startedAt = manualRunStartedAt;

    let cancelled = false;
    let requestInFlight = false;

    async function reconcileManualRun() {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const runs = await listCronRuns(taskId, 500);
        if (!cancelled && isManualCronRunFinished(runs, startedAt)) {
          cancelled = true;
          runNowLockRef.current = false;
          setManualRunStartedAt(null);
          setIsRunningNow(false);
        }
      } catch {
        return;
      } finally {
        requestInFlight = false;
      }
    }

    void reconcileManualRun();
    const pollTimer = window.setInterval(
      () => void reconcileManualRun(),
      MANUAL_CRON_RUN_POLL_INTERVAL_MS,
    );
    const timeoutTimer = window.setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      runNowLockRef.current = false;
      setManualRunStartedAt(null);
      setIsRunningNow(false);
      setRunNowError(t("settings.cronViewRunNowTimeout"));
    }, manualRunWatchTimeoutMs);

    return () => {
      cancelled = true;
      window.clearInterval(pollTimer);
      window.clearTimeout(timeoutTimer);
    };
  }, [manualRunStartedAt, taskId, manualRunWatchTimeoutMs, t]);

  if (!task) {
    return null;
  }
  const cfg = TYPE_CONFIG[task.type];

  async function handleRunNow(selectedTaskId: string) {
    if (runNowLockRef.current) return;
    runNowLockRef.current = true;
    try {
      setIsRunningNow(true);
      setRunNowError(null);
      const response = await runCronNow(selectedTaskId);
      setManualRunStartedAt(response.startedAt);
    } catch (error) {
      runNowLockRef.current = false;
      setIsRunningNow(false);
      setRunNowError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <SettingsModalShell
      onClose={onClose}
      ariaLabel={task.name}
      panelClassName="h-[80vh] max-w-4xl max-sm:h-full"
    >
      <AstryxView
        layout="flex"
        direction={compactViewport ? "vertical" : "horizontal"}
        className="settings-cron-view-panel flex h-full min-h-0 w-full overflow-hidden"
      >
        {compactViewport ? (
          <AstryxView
            as="header"
            className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-3 pt-[env(safe-area-inset-top,0px)]"
          >
            <AstryxButton
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
              aria-label={t("settings.cronViewClose")}
            >
              <X className="h-4 w-4" />
            </AstryxButton>
            <AstryxView
              layout="grid"
              direction="horizontal"
              className="grid min-w-0 flex-1 grid-cols-2 rounded-lg bg-muted p-0.5"
            >
              <AstryxButton
                type="button"
                onClick={() => setCompactTab("details")}
                className={`h-8 rounded-md text-xs font-medium transition-colors ${
                  compactTab === "details"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground"
                }`}
              >
                {t("settings.cronViewConfig")}
              </AstryxButton>
              <AstryxButton
                type="button"
                onClick={() => setCompactTab("logs")}
                className={`h-8 rounded-md text-xs font-medium transition-colors ${
                  compactTab === "logs"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground"
                }`}
              >
                {t("settings.cronViewLogs")}
              </AstryxButton>
            </AstryxView>
          </AstryxView>
        ) : null}
        {/* ── Left: task detail ── */}
        {!compactViewport || compactTab === "details" ? (
          <AstryxView
            layout="flex"
            direction="vertical"
            className="settings-cron-view-left flex w-[380px] shrink-0 flex-col border-r border-border/40 bg-background max-sm:min-h-0 max-sm:w-full max-sm:flex-1 max-sm:border-r-0"
          >
            <LeftPanel
              task={task}
              t={t}
              cfg={cfg}
              isRunningNow={isRunningNow}
              runNowError={runNowError}
              onRunNow={() => {
                void handleRunNow(task.id);
              }}
              onClose={onClose}
            />
          </AstryxView>
        ) : null}

        {/* ── Right: logs ── */}
        {!compactViewport || compactTab === "logs" ? (
          <AstryxView
            layout="flex"
            direction="vertical"
            className="settings-cron-view-right flex min-w-0 flex-1 flex-col bg-background"
          >
            <RightPanel task={task} t={t} onClose={onClose} hideClose={compactViewport} />
          </AstryxView>
        ) : null}
      </AstryxView>
    </SettingsModalShell>
  );
}
