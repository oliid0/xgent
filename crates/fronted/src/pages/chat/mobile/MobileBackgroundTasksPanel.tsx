import { StackItem } from "@astryxdesign/core/Layout";
import { useEffect, useState } from "react";
import { Clock3 } from "../../../components/icons";
import { BackgroundServicesPanel } from "../../../components/workspace-tools/BackgroundServicesPanel";
import { useLocale } from "../../../i18n";
import {
  clearManagedProcesses,
  readManagedProcessLog,
  retryManagedProcess,
  stopManagedProcess,
  useManagedProcesses,
} from "../../../lib/managed-process/store";
import type { ManagedProcessRecord } from "../../../lib/managed-process/types";
import { isNativeMobileRuntime } from "../../../lib/runtimePlatform";
import type { AppSettings } from "../../../lib/settings";
import { writeClipboardText } from "../../../lib/system/clipboardText";
import { presentationControls } from "../../../presentation/controls";
import { NativeSurface } from "../../../presentation/NativeSurface";
import { createNativePresentationTheme } from "../../../presentation/nativeTheme";
import type { PresentationNode } from "../../../presentation/types";
import { isApplePresentationRuntime } from "../../../runtime/applePresentation";
import { CronSection } from "../../settings/CronSection";
import { HooksSection } from "../../settings/HooksSection";
import { MobileFullscreenPanel, MobilePanelHeader } from "./MobilePanelScaffold";

type MobileBackgroundTasksPanelProps = {
  open: boolean;
  settings: AppSettings;
  setSettings: (updater: (previous: AppSettings) => AppSettings) => void;
  managedProcessesAvailable: boolean;
  onClose: () => void;
};

export function MobileBackgroundTasksPanel(props: MobileBackgroundTasksPanelProps) {
  const { t } = useLocale();
  const processState = useManagedProcesses();
  const [view, setView] = useState<"processes" | "hooks" | "schedules">(
    props.managedProcessesAvailable ? "processes" : "schedules",
  );
  const [logProcess, setLogProcess] = useState<ManagedProcessRecord | null>(null);
  const [logText, setLogText] = useState("");
  const [confirmStopId, setConfirmStopId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!props.managedProcessesAvailable && view === "processes") setView("schedules");
  }, [props.managedProcessesAvailable, view]);

  if (!props.open) return null;

  if (isApplePresentationRuntime()) {
    if (view === "hooks")
      return (
        <HooksSection
          settings={props.settings}
          setSettings={props.setSettings}
          onBack={() => setView(props.managedProcessesAvailable ? "processes" : "schedules")}
        />
      );
    if (view === "schedules")
      return (
        <CronSection
          settings={props.settings}
          setSettings={props.setSettings}
          onBack={() => setView(props.managedProcessesAvailable ? "processes" : "hooks")}
        />
      );

    const compact = isNativeMobileRuntime();
    const c = presentationControls();
    const run = async (operation: () => Promise<unknown>) => {
      setBusy(true);
      setError("");
      try {
        await operation();
      } finally {
        setBusy(false);
      }
    };
    c.handlers.set("close", {
      enabled: !busy,
      accepts: (value) => value === null,
      run: props.onClose,
    });
    const nodes: PresentationNode[] = [
      {
        ...c.select(
          "background-service-view",
          t("sidebar.backgroundTasks"),
          view,
          [
            ...(props.managedProcessesAvailable
              ? [{ value: "processes", label: t("sidebar.backgroundTasks") }]
              : []),
            { value: "hooks", label: t("settings.navHooks") },
            { value: "schedules", label: t("settings.navCron") },
          ],
          (value) => setView(value as "processes" | "hooks" | "schedules"),
        ),
        kind: "SegmentedControl",
      },
      ...(!processState.agentOnline
        ? [
            {
              id: "background-offline",
              kind: "Banner" as const,
              label: t("projectTools.bgTaskAgentOffline"),
              status: "paused" as const,
            },
          ]
        : []),
      ...(processState.processes.length
        ? processState.processes.map((process) =>
            c.group(`process:${process.id}`, process.label.trim() || process.command, [
              {
                id: `process:${process.id}:status`,
                kind: "StatusDot",
                label: process.running
                  ? t("projectTools.bgTaskRunning")
                  : process.exitCode === null
                    ? t("projectTools.bgTaskExited")
                    : t("projectTools.bgTaskExitedWithCode").replace(
                        "{code}",
                        String(process.exitCode),
                      ),
                status: process.running
                  ? "running"
                  : process.exitCode !== null && process.exitCode !== 0
                    ? "error"
                    : "completed",
              },
              {
                id: `process:${process.id}:command`,
                kind: "CodeBlock",
                language: "shell",
                text: `${process.command}\n${process.cwd}\nPID ${process.pid}`,
              },
              ...(process.running
                ? [
                    {
                      ...c.action(
                        `process:${process.id}:stop`,
                        confirmStopId === process.id
                          ? t("projectTools.bgTaskStopConfirm")
                          : t("projectTools.bgTaskStop"),
                        () => {
                          if (confirmStopId !== process.id) {
                            setConfirmStopId(process.id);
                            return;
                          }
                          setConfirmStopId(null);
                          return run(() => stopManagedProcess(process.id));
                        },
                        !busy && processState.agentOnline,
                      ),
                      destructive: confirmStopId === process.id,
                    },
                  ]
                : [
                    c.action(
                      `process:${process.id}:retry`,
                      t("projectTools.bgTaskRetry"),
                      () => run(() => retryManagedProcess(process)),
                      !busy && processState.agentOnline,
                    ),
                    c.action(
                      `process:${process.id}:clear`,
                      t("projectTools.bgTaskClear"),
                      () => run(() => clearManagedProcesses(process.id)),
                      !busy && processState.agentOnline,
                    ),
                  ]),
              c.action(
                `process:${process.id}:log`,
                t("projectTools.bgTaskViewLog"),
                () =>
                  run(async () => {
                    const log = await readManagedProcessLog(process.id);
                    setLogText(log.content);
                    setLogProcess(process);
                  }),
                !busy && processState.agentOnline,
              ),
              c.action(`process:${process.id}:copy`, t("projectTools.bgTaskCopy"), async () => {
                const copied = await writeClipboardText(
                  `pid=${process.pid}\ncommand=${process.command}\ncwd=${process.cwd}\nlog=${process.logPath}`,
                );
                if (!copied) throw new Error(t("git.branchSelector.copyFailed"));
              }),
            ]),
          )
        : [
            {
              id: "background-empty",
              kind: "EmptyState" as const,
              icon: "clock.arrow.circlepath",
              label: t("projectTools.bgTaskEmpty"),
            },
          ]),
      ...(processState.processes.some((process) => !process.running)
        ? [
            c.action(
              "background-clear-finished",
              t("projectTools.bgTaskClearFinished"),
              () => run(() => clearManagedProcesses()),
              !busy && processState.agentOnline,
            ),
          ]
        : []),
      ...(busy
        ? [{ id: "background-busy", kind: "Progress" as const, label: t("app.loading") }]
        : []),
      ...(error
        ? [
            {
              id: "background-error",
              kind: "Banner" as const,
              label: error,
              status: "error" as const,
            },
          ]
        : []),
    ];
    const logControls = presentationControls();
    logControls.handlers.set("close-log", {
      enabled: true,
      accepts: (value) => value === null,
      run: () => setLogProcess(null),
    });
    return (
      <>
        <NativeSurface
          document={{
            mode: "sheet",
            title: t("sidebar.backgroundTasks"),
            appearance: props.settings.theme,
            formFactor: compact ? "mobile" : "desktop",
            theme: createNativePresentationTheme(props.settings, compact, "workspaceTools"),
            nodes,
            dismissAction: busy ? undefined : "close",
          }}
          handlers={c.handlers}
          onError={(cause) => setError(cause instanceof Error ? cause.message : String(cause))}
        />
        {logProcess ? (
          <NativeSurface
            document={{
              mode: "sheet",
              title: logProcess.label.trim() || logProcess.command,
              appearance: props.settings.theme,
              formFactor: compact ? "mobile" : "desktop",
              theme: createNativePresentationTheme(props.settings, compact, "workspaceTools"),
              nodes: [
                logControls.action(
                  "background-log-refresh",
                  t("projectTools.bgTaskRefreshLog"),
                  async () => {
                    const log = await readManagedProcessLog(logProcess.id);
                    setLogText(log.content);
                  },
                ),
                logControls.action(
                  "background-log-copy",
                  t("projectTools.bgTaskLogCopyAll"),
                  async () => {
                    if (!(await writeClipboardText(logText)))
                      throw new Error(t("git.branchSelector.copyFailed"));
                  },
                  Boolean(logText),
                ),
                {
                  id: "background-log",
                  kind: "CodeBlock",
                  language: "text",
                  text: logText || t("projectTools.bgTaskLogEmpty"),
                  fill: true,
                },
              ],
              dismissAction: "close-log",
            }}
            handlers={logControls.handlers}
            onError={(cause) => setError(cause instanceof Error ? cause.message : String(cause))}
          />
        ) : null}
      </>
    );
  }

  return (
    <MobileFullscreenPanel open={props.open} keepMounted label={t("sidebar.backgroundTasks")}>
      <MobilePanelHeader
        title={t("sidebar.backgroundTasks")}
        backLabel={t("settings.close")}
        onBack={props.onClose}
        leading={<Clock3 className="h-4 w-4 text-muted-foreground" />}
      />
      <StackItem size="fill" className="mobile-panel-safe-content">
        <BackgroundServicesPanel
          settings={props.settings}
          setSettings={props.setSettings}
          managedProcessesAvailable={props.managedProcessesAvailable}
        />
      </StackItem>
    </MobileFullscreenPanel>
  );
}
