import { ContextMenu } from "@astryxdesign/core/ContextMenu";
import { Dialog } from "@astryxdesign/core/Dialog";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { Inline as AstryxInline, View as AstryxView } from "@xagent/ui/components/ui/view";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "../../i18n";
import {
  clearManagedProcesses,
  readManagedProcessLog,
  retryManagedProcess,
  stopManagedProcess,
  useManagedProcesses,
} from "../../lib/managed-process/store";
import type { ManagedProcessLog, ManagedProcessRecord } from "../../lib/managed-process/types";
import { cn } from "../../lib/shared/utils";
import {
  AlertTriangle,
  Check,
  Copy,
  FileText,
  Loader2,
  RefreshCw,
  Square,
  Trash2,
  X,
} from "../icons";
import { Button } from "../ui/button";

type BackgroundTasksPanelProps = {
  // Visibility contract from the workspace side panel: gates the per-second uptime
  // tick while the panel is hidden behind another tab.
  active?: boolean;
};

const ROW_ACTION_CLASS =
  "h-6 gap-1 rounded-md px-1.5 text-[calc(11px*var(--zone-font-scale,1))] text-muted-foreground hover:text-foreground";

function formatUptime(startedAt: number, now: number) {
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  return days > 0 ? `${days}d ${clock}` : clock;
}

function processDisplayName(process: ManagedProcessRecord) {
  return process.label.trim() || process.command;
}

function processCopyText(process: ManagedProcessRecord) {
  return [
    `pid=${process.pid}`,
    `command=${process.command}`,
    `cwd=${process.cwd}`,
    `log=${process.logPath}`,
  ].join("\n");
}

// Portal modal following the mirrored confirm-dialog shell: bottom sheet on
// small (touch) viewports, centered card from `sm:` up.
function BackgroundTaskLogDialog(props: {
  process: ManagedProcessRecord;
  actionsDisabled: boolean;
  onClose: () => void;
}) {
  const { process, actionsDisabled, onClose } = props;
  const { t } = useLocale();
  const logRef = useRef<HTMLDivElement | null>(null);
  const [log, setLog] = useState<ManagedProcessLog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const isCompact = useMediaQuery("(max-width: 640px)");

  const refresh = useCallback(
    (silent = false) => {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      readManagedProcessLog(process.id)
        .then(setLog)
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => {
          if (!silent) setLoading(false);
        });
    },
    [process.id],
  );

  const lines = useMemo(() => {
    if (!log?.content.trim()) return [];
    const split = log.content.split("\n");
    // Logs conventionally end with a newline; drop the phantom empty tail
    // line so the line count matches what a pager would show.
    if (split.length > 0 && split[split.length - 1] === "") split.pop();
    return split;
  }, [log?.content]);

  useEffect(() => {
    refresh(false);
  }, [refresh]);

  useEffect(() => {
    if (!process.running) return;
    const timer = window.setInterval(() => refresh(true), 1000);
    return () => window.clearInterval(timer);
  }, [process.running, refresh]);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard
      .writeText(text)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const handleCopySelection = useCallback(() => {
    const text = window.getSelection()?.toString() ?? "";
    if (text) copyToClipboard(text);
  }, [copyToClipboard]);

  const handleSelectAll = useCallback(() => {
    const node = logRef.current;
    const selection = window.getSelection();
    if (!node || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  const handleCopyAll = useCallback(() => {
    if (log?.content) copyToClipboard(log.content);
  }, [copyToClipboard, log?.content]);

  return (
    <Dialog
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      aria-label={processDisplayName(process)}
      purpose="info"
      variant={isCompact ? "fullscreen" : "standard"}
      width="min(42rem, calc(100dvw - var(--spacing-8)))"
      maxHeight={isCompact ? "100dvh" : "80dvh"}
      padding={0}
      className="flex flex-col overflow-hidden"
    >
      <AstryxView
        layout="flex"
        direction="horizontal"
        className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-3"
      >
        <AstryxView layout="block" direction="horizontal" className="min-w-0 flex-1">
          <AstryxView
            layout="block"
            direction="horizontal"
            className="truncate text-sm font-medium text-foreground"
          >
            {processDisplayName(process)}
          </AstryxView>
          <AstryxView
            layout="block"
            direction="horizontal"
            className="mt-0.5 truncate text-[calc(11px*var(--zone-font-scale,1))] text-muted-foreground"
            title={log?.logPath ?? process.logPath}
          >
            {log?.logPath ?? process.logPath}
            {log?.truncated ? ` ${t("projectTools.bgTaskLogTruncated")}` : ""}
          </AstryxView>
        </AstryxView>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={actionsDisabled || loading}
          className="h-8 shrink-0 gap-1.5 rounded-lg px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => refresh(false)}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {t("projectTools.bgTaskRefreshLog")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
          title={t("projectTools.close")}
          aria-label={t("projectTools.close")}
        >
          <X className="h-4 w-4" />
        </Button>
      </AstryxView>

      {error ? (
        <AstryxView
          layout="block"
          direction="horizontal"
          className="shrink-0 border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-xs text-destructive"
        >
          {error}
        </AstryxView>
      ) : null}

      {/* select-text overrides the desktop app's global user-select:none;
            right-click opens the custom copy menu below. Line numbers are
            counter pseudo-content, so selections copy without them. */}
      <ContextMenu
        label={t("projectTools.bgTaskViewLog")}
        size="sm"
        items={[
          {
            label: t("projectTools.bgTaskLogCopy"),
            isDisabled: !hasSelection,
            onClick: handleCopySelection,
          },
          {
            label: t("projectTools.bgTaskLogSelectAll"),
            isDisabled: lines.length === 0,
            onClick: handleSelectAll,
          },
          {
            label: t("projectTools.bgTaskLogCopyAll"),
            isDisabled: lines.length === 0,
            onClick: handleCopyAll,
          },
        ]}
        onOpenChange={(isOpen) => {
          if (!isOpen) return;
          const selection = window.getSelection();
          setHasSelection(
            Boolean(selection && !selection.isCollapsed && selection.toString().length > 0),
          );
        }}
      >
        <AstryxView
          layout="block"
          direction="horizontal"
          ref={logRef}
          role="log"
          className="min-h-0 flex-1 select-text overflow-auto overscroll-contain px-3 py-3 font-mono text-[calc(11px*var(--zone-font-scale,1))] leading-4 text-muted-foreground [counter-reset:log-line]"
        >
          {lines.length === 0 ? (
            <AstryxView layout="block" direction="horizontal" className="select-none font-sans">
              {loading && !log ? t("projectTools.loading") : t("projectTools.bgTaskLogEmpty")}
            </AstryxView>
          ) : (
            lines.map((line, index) => (
              <AstryxView
                layout="grid"
                direction="horizontal"
                // Static tail render, replaced wholesale on refresh.
                // biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity
                key={index}
                className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-2 [counter-increment:log-line]"
              >
                <AstryxInline
                  aria-hidden="true"
                  className="select-none text-right text-muted-foreground/40 before:content-[counter(log-line)]"
                />
                <AstryxInline className="whitespace-pre-wrap break-all">{line}</AstryxInline>
              </AstryxView>
            ))
          )}
        </AstryxView>
      </ContextMenu>
    </Dialog>
  );
}

function BackgroundTaskRow(props: {
  process: ManagedProcessRecord;
  now: number;
  actionsDisabled: boolean;
  onViewLog: (process: ManagedProcessRecord) => void;
}) {
  const { process, now, actionsDisabled, onViewLog } = props;
  const { t } = useLocale();
  const [pendingStop, setPendingStop] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingStop) return;
    const timer = window.setTimeout(() => setPendingStop(false), 3000);
    return () => window.clearTimeout(timer);
  }, [pendingStop]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const runAction = useCallback(async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleStop = useCallback(() => {
    if (!pendingStop) {
      setPendingStop(true);
      return;
    }
    setPendingStop(false);
    setStopping(true);
    void runAction(() => stopManagedProcess(process.id)).finally(() => setStopping(false));
  }, [pendingStop, process.id, runAction]);

  const handleCopy = useCallback(() => {
    void runAction(async () => {
      await navigator.clipboard.writeText(processCopyText(process));
      setCopied(true);
    });
  }, [process, runAction]);

  const handleClear = useCallback(() => {
    void runAction(() => clearManagedProcesses(process.id));
  }, [process.id, runAction]);

  const handleRetry = useCallback(() => {
    setRetrying(true);
    void runAction(() => retryManagedProcess(process)).finally(() => setRetrying(false));
  }, [process, runAction]);

  return (
    <AstryxView
      layout="flex"
      direction="vertical"
      className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-background/60 px-2.5 py-2"
    >
      <AstryxView layout="flex" direction="horizontal" className="flex min-w-0 items-center gap-2">
        <AstryxInline
          aria-hidden="true"
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            process.running ? "bg-emerald-500" : "bg-muted-foreground/50",
          )}
        />
        <AstryxInline className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {processDisplayName(process)}
        </AstryxInline>
        {process.isolated ? (
          <AstryxInline className="shrink-0 rounded bg-amber-500/15 px-1 py-px text-[calc(10px*var(--zone-font-scale,1))] text-amber-600 dark:text-amber-400">
            {t("projectTools.bgTaskIsolated")}
          </AstryxInline>
        ) : null}
        {process.restored ? (
          <AstryxInline className="shrink-0 rounded bg-sky-500/15 px-1 py-px text-[calc(10px*var(--zone-font-scale,1))] text-sky-600 dark:text-sky-400">
            {t("projectTools.bgTaskRestored")}
          </AstryxInline>
        ) : null}
      </AstryxView>
      <AstryxView
        layout="flex"
        direction="horizontal"
        className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[calc(11px*var(--zone-font-scale,1))] text-muted-foreground"
      >
        <AstryxInline className="shrink-0">PID {process.pid}</AstryxInline>
        {process.running ? (
          <AstryxInline className="shrink-0 tabular-nums">
            {formatUptime(process.startedAt, now)}
          </AstryxInline>
        ) : (
          <AstryxInline className="shrink-0">
            {process.exitCode === null
              ? t("projectTools.bgTaskExited")
              : t("projectTools.bgTaskExitedWithCode").replace("{code}", String(process.exitCode))}
          </AstryxInline>
        )}
        <AstryxInline className="min-w-0 truncate" title={process.command}>
          {process.command}
        </AstryxInline>
      </AstryxView>
      <AstryxView
        layout="block"
        direction="horizontal"
        className="min-w-0 truncate text-[calc(10px*var(--zone-font-scale,1))] text-muted-foreground/70"
        title={process.cwd}
      >
        {process.cwd}
      </AstryxView>
      <AstryxView
        layout="flex"
        direction="horizontal"
        className="flex flex-wrap items-center gap-1"
      >
        {process.running ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={actionsDisabled || stopping}
            className={cn(
              ROW_ACTION_CLASS,
              pendingStop && "bg-destructive/10 text-destructive hover:text-destructive",
            )}
            onClick={handleStop}
          >
            {stopping ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : pendingStop ? (
              <Check className="h-3 w-3" />
            ) : (
              <Square className="h-3 w-3" />
            )}
            {pendingStop ? t("projectTools.bgTaskStopConfirm") : t("projectTools.bgTaskStop")}
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={actionsDisabled || retrying}
              className={ROW_ACTION_CLASS}
              onClick={handleRetry}
            >
              <RefreshCw className={cn("h-3 w-3", retrying && "animate-spin")} />
              {t("projectTools.bgTaskRetry")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={actionsDisabled || retrying}
              className={ROW_ACTION_CLASS}
              onClick={handleClear}
            >
              <Trash2 className="h-3 w-3" />
              {t("projectTools.bgTaskClear")}
            </Button>
          </>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={actionsDisabled}
          className={ROW_ACTION_CLASS}
          onClick={() => onViewLog(process)}
        >
          <FileText className="h-3 w-3" />
          {t("projectTools.bgTaskViewLog")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={ROW_ACTION_CLASS}
          onClick={handleCopy}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? t("projectTools.bgTaskCopied") : t("projectTools.bgTaskCopy")}
        </Button>
      </AstryxView>
      {error ? (
        <AstryxView
          layout="block"
          direction="horizontal"
          className="text-[calc(11px*var(--zone-font-scale,1))] text-destructive"
        >
          {error}
        </AstryxView>
      ) : null}
    </AstryxView>
  );
}

export const BackgroundTasksPanel = memo(function BackgroundTasksPanel(
  props: BackgroundTasksPanelProps,
) {
  const { active = true } = props;
  const { t } = useLocale();
  const state = useManagedProcesses();
  const [now, setNow] = useState(() => Date.now());
  const [logProcess, setLogProcess] = useState<ManagedProcessRecord | null>(null);
  const liveLogProcess = logProcess
    ? (state.processes.find((process) => process.id === logProcess.id) ?? logProcess)
    : null;
  const hasRunning = state.processes.some((process) => process.running);
  const hasFinished = state.processes.some((process) => !process.running);
  const actionsDisabled = !state.agentOnline;

  useEffect(() => {
    if (!active || !hasRunning) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    setNow(Date.now());
    return () => window.clearInterval(timer);
  }, [active, hasRunning]);

  const handleCloseLog = useCallback(() => {
    setLogProcess(null);
  }, []);

  const handleClearFinished = useCallback(() => {
    void clearManagedProcesses().catch(() => {
      // Row-level actions surface their own errors; a bulk clear failure
      // leaves the list unchanged, which is already visible.
    });
  }, []);

  return (
    <AstryxView layout="flex" direction="vertical" className="flex h-full min-h-0 flex-col">
      {actionsDisabled ? (
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-[calc(11px*var(--zone-font-scale,1))] text-muted-foreground"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          <AstryxInline className="min-w-0 flex-1">
            {t("projectTools.bgTaskAgentOffline")}
          </AstryxInline>
        </AstryxView>
      ) : null}
      {/* Fixed-height header with the clear button always mounted: its
          appearance only fades opacity, so the list below never shifts. */}
      <AstryxView
        layout="flex"
        direction="horizontal"
        className="flex h-9 shrink-0 items-center gap-2 px-3"
      >
        <AstryxInline className="min-w-0 flex-1 truncate text-[calc(11px*var(--zone-font-scale,1))] text-muted-foreground">
          {t("projectTools.backgroundTasksTitle")}
        </AstryxInline>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={actionsDisabled || !hasFinished}
          aria-hidden={!hasFinished}
          className={cn(
            ROW_ACTION_CLASS,
            "transition-opacity duration-150 motion-reduce:transition-none",
            hasFinished ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          onClick={handleClearFinished}
        >
          <Trash2 className="h-3 w-3" />
          {t("projectTools.bgTaskClearFinished")}
        </Button>
      </AstryxView>
      <AstryxView
        layout="flex"
        direction="vertical"
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3 pt-1"
      >
        {state.processes.length === 0 ? (
          <AstryxView
            layout="flex"
            direction="horizontal"
            className="flex flex-1 items-center justify-center text-xs text-muted-foreground"
          >
            {t("projectTools.bgTaskEmpty")}
          </AstryxView>
        ) : (
          state.processes.map((process) => (
            <BackgroundTaskRow
              key={process.id}
              process={process}
              now={now}
              actionsDisabled={actionsDisabled}
              onViewLog={setLogProcess}
            />
          ))
        )}
      </AstryxView>
      {liveLogProcess ? (
        <BackgroundTaskLogDialog
          process={liveLogProcess}
          actionsDisabled={actionsDisabled}
          onClose={handleCloseLog}
        />
      ) : null}
    </AstryxView>
  );
});
