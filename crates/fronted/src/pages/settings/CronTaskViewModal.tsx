import { Banner } from "@astryxdesign/core/Banner";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { IconButton } from "@astryxdesign/core/IconButton";
import { ListItem } from "@astryxdesign/core/List";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Stack as AstryxStack } from "@astryxdesign/core/Stack";
import { Heading as AstryxHeadingCore, Text as AstryxText } from "@astryxdesign/core/Text";
import { useEffect, useRef, useState } from "react";
import { useConfirmDialog } from "../../components/astryx/useConfirmDialog";
import {
  BrushCleaning,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Play,
  RefreshCw,
  X,
} from "../../components/icons";
import { useLocale } from "../../i18n";
import {
  type CronTask,
  DEFAULT_CRON_TIMEOUT_SECONDS,
  isManualCronRunFinished,
  listCronRuns,
  MANUAL_CRON_RUN_POLL_INTERVAL_MS,
  MANUAL_CRON_RUN_TIMEOUT_MS,
  runCronNow,
  useAutomation,
} from "../../lib/automation";
import { useCompactViewport } from "../../lib/responsive/compactViewport";
import { isNativeMobileRuntime } from "../../lib/runtimePlatform";
import type { AppSettings } from "../../lib/settings";
import { presentationControls } from "../../presentation/controls";
import { cronRunDisplay } from "../../presentation/cronDisplay";
import { NativeSettingsContent } from "../../presentation/NativeSettingsContent";
import { NativeSurface } from "../../presentation/NativeSurface";
import { nativeCronRunNodes } from "../../presentation/nativeCronRunNodes";
import { nativeCronTaskDetails } from "../../presentation/nativeCronTaskDetails";
import type { NativeSettingsContentSink } from "../../presentation/nativeOtherContent";
import { createNativePresentationTheme } from "../../presentation/nativeTheme";
import type { PresentationNode } from "../../presentation/types";
import { isApplePresentationRuntime } from "../../runtime/applePresentation";
import { SettingsDetailHeader } from "./SettingsDetailHeader";
import { SettingsModalShell } from "./SettingsModalShell";
import { ConfirmActionPopover } from "./shared";
import { useCronRunHistory } from "./useCronRunHistory";

type CronTaskViewModalProps = {
  settings?: AppSettings;
  taskId: string;
  nativeSettingsSurfaceId?: string;
  nativeOtherSink?: NativeSettingsContentSink;
  nativePresentationMode?: "root" | "sheet";
  onClose: () => void;
};

/** Static task fields use the same presentation values as the native view. */
function CronDetailField({ node }: { node: PresentationNode }) {
  if (node.variant === "cron-detail-value") {
    return (
      <AstryxStack direction="horizontal" className="cron-detail-field">
        <AstryxText as="span" type="inherit" className="cron-detail-field-label">
          {node.label}
        </AstryxText>
        <AstryxText as="span" type="inherit" className="cron-detail-field-value">
          {node.text}
        </AstryxText>
      </AstryxStack>
    );
  }
  if (node.kind === "CodeBlock") {
    return (
      <AstryxStack direction="vertical" className="cron-detail-code">
        {node.label ? (
          <AstryxText as="span" type="inherit" className="cron-detail-field-label">
            {node.label}
          </AstryxText>
        ) : null}
        <pre>{node.text}</pre>
      </AstryxStack>
    );
  }
  if (node.kind === "Banner")
    return (
      <Banner status="error" collapsible={false} title={node.label}>
        {node.text}
      </Banner>
    );
  if (node.children) {
    return (
      <AstryxStack direction="vertical" className="cron-detail-section">
        {node.label ? <AstryxHeadingCore level={3}>{node.label}</AstryxHeadingCore> : null}
        <AstryxStack direction="vertical" className="cron-detail-fields">
          {node.children.map((child) => (
            <CronDetailField key={child.id} node={child} />
          ))}
        </AstryxStack>
      </AstryxStack>
    );
  }
  return (
    <AstryxText as="p" type="inherit">
      {node.text}
    </AstryxText>
  );
}

export function CronTaskDetails({
  task,
  t,
  isRunningNow,
  runNowError,
  onRunNow,
  onClose,
  showTitle = true,
}: {
  task: CronTask;
  t: (key: string) => string;
  isRunningNow: boolean;
  runNowError: string | null;
  onRunNow: () => void;
  onClose: () => void;
  showTitle?: boolean;
}) {
  return (
    <>
      <AstryxStack direction="vertical" className="cron-detail-header">
        <AstryxStack direction="horizontal" className="cron-detail-heading">
          <AstryxText as="span" type="inherit" className="cron-task-status">
            {t(task.enabled ? "settings.cronViewStatusEnabled" : "settings.cronViewStatusDisabled")}
          </AstryxText>
          <AstryxStack direction="horizontal" className="cron-detail-actions">
            <IconButton
              variant="ghost"
              size="lg"
              label={isRunningNow ? t("settings.cronViewRunningNow") : t("settings.cronViewRunNow")}
              icon={
                isRunningNow ? (
                  <Loader2 className="cron-running-icon" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )
              }
              onClick={onRunNow}
              isDisabled={isRunningNow}
            />
            {showTitle ? (
              <IconButton
                variant="ghost"
                size="lg"
                label={t("settings.cronViewClose")}
                icon={<X />}
                onClick={onClose}
              />
            ) : null}
          </AstryxStack>
        </AstryxStack>
        {showTitle ? <AstryxHeadingCore level={2}>{task.name}</AstryxHeadingCore> : null}
        {runNowError ? (
          <Banner status="error" collapsible={false} title={t("settings.cronViewRunNowFailed")}>
            {runNowError}
          </Banner>
        ) : null}
      </AstryxStack>
      <AstryxStack direction="vertical" className="cron-detail-scroll">
        {nativeCronTaskDetails(task, t).map((node) => (
          <CronDetailField key={node.id} node={node} />
        ))}
      </AstryxStack>
    </>
  );
}

export function CronRunHistoryPanel({
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
  const { locale } = useLocale();
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const history = useCronRunHistory(task.id);
  async function handleClearLogs() {
    try {
      await history.clear();
      setExpandedLogId(null);
    } catch {
      // The shared history retains and displays the actual failure.
    }
  }
  return (
    <>
      <AstryxStack direction="vertical" className="cron-history-header">
        <AstryxStack direction="horizontal" className="cron-detail-heading">
          <AstryxHeadingCore level={3}>{t("settings.cronViewRunHistory")}</AstryxHeadingCore>
          <AstryxStack direction="horizontal" className="cron-detail-actions">
            <IconButton
              variant="ghost"
              size="lg"
              label={t("presentation.retry")}
              icon={<RefreshCw />}
              isDisabled={history.loading || history.isClearing}
              onClick={() => {
                void history.refresh().catch(() => undefined);
              }}
            />
            <ConfirmActionPopover
              title={t("settings.cronViewClearLogsConfirm")}
              description={
                t("settings.cronViewClearLogsConfirmDescBefore") +
                " " +
                task.name +
                t("settings.cronViewClearLogsConfirmDescAfter")
              }
              confirmLabel={t("settings.cronViewClearLogs")}
              onConfirm={() => {
                void handleClearLogs();
              }}
            >
              {(open) => (
                <IconButton
                  variant="ghost"
                  size="lg"
                  label={
                    history.isClearing
                      ? t("settings.cronViewClearingLogs")
                      : t("settings.cronViewClearLogs")
                  }
                  icon={<BrushCleaning />}
                  onClick={open}
                  isDisabled={history.clearableCount === 0 || history.isClearing}
                />
              )}
            </ConfirmActionPopover>
            {!hideClose ? (
              <IconButton
                variant="ghost"
                size="lg"
                label={t("settings.cronViewClose")}
                icon={<X />}
                onClick={onClose}
              />
            ) : null}
          </AstryxStack>
        </AstryxStack>
        {history.logs.length ? (
          <AstryxText as="span" type="inherit" className="cron-history-counts">
            {t("settings.cronViewLogSuccess") +
              " " +
              history.successCount +
              " / " +
              t("settings.cronViewLogFailed") +
              " " +
              history.failCount +
              " / " +
              t("settings.cronViewLogRunning") +
              " " +
              history.runningCount}
          </AstryxText>
        ) : null}
      </AstryxStack>
      <AstryxStack direction="vertical" className="cron-detail-scroll">
        {history.loadError ? (
          <Banner status="error" collapsible={false} title={t("settings.cronViewLogsLoadFailed")}>
            {history.loadError}
          </Banner>
        ) : null}
        {history.clearError ? (
          <Banner status="error" collapsible={false} title={t("settings.cronViewClearLogsFailed")}>
            {history.clearError}
          </Banner>
        ) : null}
        {history.loading && !history.logs.length ? <Spinner aria-label={t("app.loading")} /> : null}
        {!history.logs.length && !history.loading && !history.loadError ? (
          <EmptyState title={t("settings.cronViewLogsEmpty")} />
        ) : null}
        {history.logs.length ? (
          <AstryxStack direction="vertical" className="cron-history-list">
            {history.logs.map((run) => {
              const display = cronRunDisplay(run, t, locale);
              const open = expandedLogId === run.id;
              return (
                <AstryxStack direction="vertical" key={run.id} className="cron-history-entry">
                  <ListItem
                    label={display.date}
                    description={display.time}
                    onClick={() => setExpandedLogId(open ? null : run.id)}
                    endContent={
                      <AstryxStack direction="horizontal" className="cron-history-status">
                        <AstryxText
                          as="span"
                          type="inherit"
                          className={display.status === "error" ? "cron-status-error" : undefined}
                        >
                          {display.label}
                        </AstryxText>
                        {open ? (
                          <ChevronDown aria-hidden="true" />
                        ) : (
                          <ChevronRight aria-hidden="true" />
                        )}
                      </AstryxStack>
                    }
                  />
                  {open ? (
                    <AstryxStack direction="vertical" className="cron-history-output">
                      <AstryxText as="span" type="inherit" className="cron-history-counts">
                        {display.metadata}
                      </AstryxText>
                      {run.output ? (
                        <AstryxStack direction="vertical" className="cron-detail-code">
                          <AstryxText as="span" type="inherit" className="cron-detail-field-label">
                            {t(
                              task.type === "prompt"
                                ? "settings.cronViewLogConclusion"
                                : "settings.cronViewLogOutput",
                            )}
                          </AstryxText>
                          <pre>{run.output}</pre>
                        </AstryxStack>
                      ) : null}
                    </AstryxStack>
                  ) : null}
                </AstryxStack>
              );
            })}
          </AstryxStack>
        ) : null}
      </AstryxStack>
    </>
  );
}

export function CronTaskViewModal({
  settings,
  taskId,
  nativeSettingsSurfaceId,
  nativeOtherSink,
  nativePresentationMode,
  onClose,
}: CronTaskViewModalProps) {
  const { t, locale } = useLocale();
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
  const runNowScope = useRef({ active: true, taskId, revision: 0 }).current;
  if (runNowScope.taskId !== taskId) {
    runNowScope.taskId = taskId;
    runNowScope.revision++;
    runNowLockRef.current = false;
  }
  useEffect(() => {
    runNowScope.active = true;
    setIsRunningNow(false);
    setManualRunStartedAt(null);
    setRunNowError(null);
    return () => {
      runNowScope.active = false;
      runNowScope.revision++;
      runNowLockRef.current = false;
    };
  }, [taskId]);
  const nativeHistory = useCronRunHistory(taskId, isApplePresentationRuntime());
  const [nativeExpandedLog, setNativeExpandedLog] = useState<string | null>(null);
  const { confirm, dialog } = useConfirmDialog();
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

  async function handleRunNow(selectedTaskId: string) {
    if (runNowLockRef.current) return;
    if (!runNowScope.active || runNowScope.taskId !== selectedTaskId) return;
    const revision = runNowScope.revision;
    const current = () =>
      runNowScope.active &&
      runNowScope.taskId === selectedTaskId &&
      runNowScope.revision === revision;
    runNowLockRef.current = true;
    try {
      setIsRunningNow(true);
      setRunNowError(null);
      const response = await runCronNow(selectedTaskId);
      if (current()) setManualRunStartedAt(response.startedAt);
    } catch (error) {
      if (!current()) return;
      runNowLockRef.current = false;
      setIsRunningNow(false);
      setRunNowError(error instanceof Error ? error.message : String(error));
    }
  }

  if (isApplePresentationRuntime()) {
    const RootSurface = nativeOtherSink ? NativeSettingsContent : NativeSurface;
    const c = presentationControls();
    c.handlers.set("close", { enabled: true, accepts: (value) => value === null, run: onClose });
    const compact = isNativeMobileRuntime();
    const viewRevision = runNowScope.revision;
    const nodes = nativeCronRunNodes({
      controls: c,
      task,
      history: nativeHistory,
      t,
      locale,
      compact,
      tab: compactTab,
      setTab: setCompactTab,
      expanded: nativeExpandedLog,
      setExpanded: setNativeExpandedLog,
      running: isRunningNow,
      runError: runNowError,
      run: () => handleRunNow(task.id),
      confirm,
      current: () =>
        runNowScope.active &&
        runNowScope.taskId === task.id &&
        runNowScope.revision === viewRevision,
    });
    return (
      <>
        <RootSurface
          sink={nativeOtherSink}
          detail
          sessionSurface={nativeSettingsSurfaceId}
          document={{
            mode: nativePresentationMode ?? "sheet",
            title: task.name,
            appearance: settings?.theme ?? "system",
            formFactor: compact ? "mobile" : "desktop",
            ...(settings
              ? { theme: createNativePresentationTheme(settings, compact, "workspaceTools") }
              : {}),
            nodes,
            dismissAction: "close",
          }}
          handlers={c.handlers}
          onError={(error) => setRunNowError(String(error))}
        />
        {dialog}
      </>
    );
  }

  return (
    <SettingsModalShell
      onClose={onClose}
      ariaLabel={task.name}
      panelClassName="h-[80vh] max-w-4xl max-sm:h-full"
    >
      <AstryxStack
        direction={compactViewport ? "vertical" : "horizontal"}
        className="settings-cron-view-panel flex h-full min-h-0 w-full overflow-hidden"
      >
        {compactViewport ? (
          <AstryxStack direction="vertical" className="shrink-0">
            <SettingsDetailHeader
              title={task.name}
              startContent={
                <IconButton
                  variant="ghost"
                  label={t("settings.cronViewClose")}
                  tooltip={t("settings.cronViewClose")}
                  size="lg"
                  icon={<ChevronLeft />}
                  onClick={onClose}
                />
              }
            />
            <SegmentedControl
              className="settings-cron-view-tabs"
              label={t("settings.cronView")}
              value={compactTab}
              layout="fill"
              size="lg"
              onChange={(value) => setCompactTab(value as "details" | "logs")}
            >
              <SegmentedControlItem value="details" label={t("settings.cronViewConfig")} />
              <SegmentedControlItem value="logs" label={t("settings.cronViewRunHistory")} />
            </SegmentedControl>
          </AstryxStack>
        ) : null}
        {/* ── Left: task detail ── */}
        {!compactViewport || compactTab === "details" ? (
          <AstryxStack
            direction="vertical"
            className="settings-cron-view-left flex w-[380px] shrink-0 flex-col border-r border-border/40 bg-background max-sm:min-h-0 max-sm:w-full max-sm:flex-1 max-sm:border-r-0"
          >
            <CronTaskDetails
              task={task}
              t={t}
              showTitle={!compactViewport}
              isRunningNow={isRunningNow}
              runNowError={runNowError}
              onRunNow={() => {
                void handleRunNow(task.id);
              }}
              onClose={onClose}
            />
          </AstryxStack>
        ) : null}

        {/* ── Right: logs ── */}
        {!compactViewport || compactTab === "logs" ? (
          <AstryxStack
            direction="vertical"
            className="settings-cron-view-right flex min-w-0 flex-1 flex-col bg-background"
          >
            <CronRunHistoryPanel task={task} t={t} onClose={onClose} hideClose={compactViewport} />
          </AstryxStack>
        ) : null}
      </AstryxStack>
    </SettingsModalShell>
  );
}
