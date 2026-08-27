import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { ContextMenu } from "@astryxdesign/core/ContextMenu";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, Section, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
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
import { AlertTriangle, Check, Copy, FileText, RefreshCw, Square, Trash2 } from "../icons";

type BackgroundTasksPanelProps = {
  // Visibility contract from the workspace side panel: gates the per-second uptime
  // tick while the panel is hidden behind another tab.
  active?: boolean;
};

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
  const isCompact = useMediaQuery(
    "(max-width: 768px), (max-width: 1024px) and (pointer: coarse) and (hover: none)",
  );

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
    >
      <VStack height="100%" minHeight={0} gap={0}>
        <DialogHeader
          title={processDisplayName(process)}
          subtitle={`${log?.logPath ?? process.logPath}${
            log?.truncated ? ` ${t("projectTools.bgTaskLogTruncated")}` : ""
          }`}
          onOpenChange={(isOpen) => {
            if (!isOpen) onClose();
          }}
          endContent={
            <Button
              label={t("projectTools.bgTaskRefreshLog")}
              variant="ghost"
              size="sm"
              icon={<Icon icon={RefreshCw} size="sm" color="inherit" />}
              isDisabled={actionsDisabled}
              isLoading={loading}
              onClick={() => refresh(false)}
            />
          }
        />

        {error ? <Banner status="error" title={error} collapsible={false} /> : null}

        <StackItem size="fill">
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
            <VStack ref={logRef} role="log" height="100%" minHeight={0} padding={3}>
              {lines.length === 0 ? (
                <EmptyState
                  isCompact
                  icon={<Icon icon={FileText} size="lg" color="secondary" />}
                  title={
                    loading && !log ? t("projectTools.loading") : t("projectTools.bgTaskLogEmpty")
                  }
                />
              ) : (
                <CodeBlock
                  code={log?.content ?? ""}
                  language="plaintext"
                  title={processDisplayName(process)}
                  hasLineNumbers
                  hasLanguageLabel={false}
                  isWrapped
                  maxHeight={isCompact ? "calc(100dvh - 8rem)" : "60dvh"}
                  size="sm"
                  width="100%"
                  container="section"
                />
              )}
            </VStack>
          </ContextMenu>
        </StackItem>
      </VStack>
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
    <ListItem
      label={processDisplayName(process)}
      startContent={
        <StatusDot
          variant={process.running ? "success" : "neutral"}
          label={process.running ? t("projectTools.bgTaskRunning") : t("projectTools.bgTaskExited")}
          isPulsing={process.running}
        />
      }
      description={
        <VStack gap={1}>
          <HStack gap={1} vAlign="center" wrap="wrap">
            <Text type="supporting" color="secondary" hasTabularNumbers>
              PID {process.pid}
            </Text>
            <Text type="supporting" color="secondary" hasTabularNumbers>
              {process.running
                ? formatUptime(process.startedAt, now)
                : process.exitCode === null
                  ? t("projectTools.bgTaskExited")
                  : t("projectTools.bgTaskExitedWithCode").replace(
                      "{code}",
                      String(process.exitCode),
                    )}
            </Text>
            {process.isolated ? (
              <Token label={t("projectTools.bgTaskIsolated")} color="yellow" size="sm" />
            ) : null}
            {process.restored ? (
              <Token label={t("projectTools.bgTaskRestored")} color="blue" size="sm" />
            ) : null}
          </HStack>
          <Text type="code" color="secondary" maxLines={1}>
            {process.command}
          </Text>
          <Text type="supporting" color="secondary" maxLines={1}>
            {process.cwd}
          </Text>
          {error ? <Token label={error} color="red" size="sm" /> : null}
        </VStack>
      }
      endContent={
        <HStack gap={1} vAlign="center" wrap="wrap">
          {process.running ? (
            <Button
              label={
                pendingStop ? t("projectTools.bgTaskStopConfirm") : t("projectTools.bgTaskStop")
              }
              variant={pendingStop ? "destructive" : "ghost"}
              size="sm"
              icon={<Icon icon={pendingStop ? Check : Square} size="sm" color="inherit" />}
              isDisabled={actionsDisabled}
              isLoading={stopping}
              onClick={handleStop}
            />
          ) : (
            <>
              <Button
                label={t("projectTools.bgTaskRetry")}
                variant="ghost"
                size="sm"
                icon={<Icon icon={RefreshCw} size="sm" color="inherit" />}
                isDisabled={actionsDisabled}
                isLoading={retrying}
                onClick={handleRetry}
              />
              <Button
                label={t("projectTools.bgTaskClear")}
                variant="ghost"
                size="sm"
                icon={<Icon icon={Trash2} size="sm" color="inherit" />}
                isDisabled={actionsDisabled || retrying}
                onClick={handleClear}
              />
            </>
          )}
          <Button
            label={t("projectTools.bgTaskViewLog")}
            variant="ghost"
            size="sm"
            icon={<Icon icon={FileText} size="sm" color="inherit" />}
            isDisabled={actionsDisabled}
            onClick={() => onViewLog(process)}
          />
          <Button
            label={copied ? t("projectTools.bgTaskCopied") : t("projectTools.bgTaskCopy")}
            variant="ghost"
            size="sm"
            icon={<Icon icon={copied ? Check : Copy} size="sm" color="inherit" />}
            onClick={handleCopy}
          />
        </HStack>
      }
    />
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
    <VStack height="100%" minHeight={0} gap={0}>
      {actionsDisabled ? (
        <Banner
          status="warning"
          title={t("projectTools.bgTaskAgentOffline")}
          icon={<Icon icon={AlertTriangle} size="sm" color="inherit" />}
          collapsible={false}
        />
      ) : null}
      <Section variant="transparent" padding={2} dividers={["bottom"]}>
        <HStack width="100%" gap={2} vAlign="center">
          <StackItem size="fill">
            <Text type="label">{t("projectTools.backgroundTasksTitle")}</Text>
          </StackItem>
          {hasFinished ? (
            <Button
              label={t("projectTools.bgTaskClearFinished")}
              variant="ghost"
              size="sm"
              icon={<Icon icon={Trash2} size="sm" color="inherit" />}
              isDisabled={actionsDisabled}
              onClick={handleClearFinished}
            />
          ) : null}
        </HStack>
      </Section>
      <StackItem size="fill" isScrollable>
        {state.processes.length === 0 ? (
          <EmptyState
            isCompact
            icon={<Icon icon={FileText} size="lg" color="secondary" />}
            title={t("projectTools.bgTaskEmpty")}
          />
        ) : (
          <List density="compact" hasDividers header={t("projectTools.backgroundTasksTitle")}>
            {state.processes.map((process) => (
              <BackgroundTaskRow
                key={process.id}
                process={process}
                now={now}
                actionsDisabled={actionsDisabled}
                onViewLog={setLogProcess}
              />
            ))}
          </List>
        )}
      </StackItem>
      {liveLogProcess ? (
        <BackgroundTaskLogDialog
          process={liveLogProcess}
          actionsDisabled={actionsDisabled}
          onClose={handleCloseLog}
        />
      ) : null}
    </VStack>
  );
});
