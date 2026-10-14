import { isBrowserRuntime } from "@xgent/runtime";
import { useEffect, useRef } from "react";
import { createAutomationBackend } from "../../lib/automation/backend";
import {
  MOBILE_BRANCH_RECOVERY_EVENT,
  MOBILE_BRANCH_REVOCATION_EVENT,
} from "../../lib/automation/mobileBranchEvents";
import { executeMobileDeviceBranch } from "../../lib/automation/mobileBranchExecution";
import { startMobileBranchWorker } from "../../lib/automation/mobileBranchWorker";
import { executeCronPromptRun } from "../../lib/automation/promptExecution";
import { startPromptRunHost } from "../../lib/automation/promptRunHost";
import { isNativeMobileRuntime } from "../../lib/runtimePlatform";
import type { AppSettings } from "../../lib/settings";
import { captureToolCommandPort } from "../../lib/tools/toolCommandPort";

/** Mobile-local prompt execution; desktop ownership belongs to agent-worker. */
export function CronPromptRunner({ settings }: { settings: AppSettings }) {
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  useEffect(() => {
    if (isBrowserRuntime() || !isNativeMobileRuntime()) return;
    let stopped = false;
    let stopHost: (() => void) | undefined;
    let stopBranches: (() => void) | undefined;
    const dispose = () => {
      const prompts = stopHost;
      const branches = stopBranches;
      stopHost = undefined;
      stopBranches = undefined;
      prompts?.();
      branches?.();
    };
    void captureToolCommandPort({ enabled: false, baseUrl: "" })
      .then((port) => {
        if (stopped) return;
        if (!port) throw new Error("Mobile prompt execution requires the native runtime");
        stopHost = startPromptRunHost({
          ...createAutomationBackend(port),
          execute: (request, signal) => executeCronPromptRun(settingsRef.current, request, signal),
        });
        const branches = startMobileBranchWorker({
          ...createAutomationBackend(port),
          isVisible: () => document.visibilityState !== "hidden",
          execute: (entry, branch, signal) =>
            executeMobileDeviceBranch(() => settingsRef.current, entry, branch, signal),
        });
        const refresh = () => {
          void branches.refresh();
        };
        const listeners: (() => void)[] = [];
        // Retain cleanup BEFORE registering DOM listeners. Startup failure
        // must release both owners, including a worker already polling.
        stopBranches = () => {
          branches.stop();
          for (const remove of listeners) remove();
        };
        window.addEventListener("online", refresh);
        listeners.push(() => window.removeEventListener("online", refresh));
        window.addEventListener("focus", refresh);
        listeners.push(() => window.removeEventListener("focus", refresh));
        const recover = (event: Event) => {
          const entry = (event as CustomEvent<unknown>).detail;
          if (typeof entry === "string") branches.retryEntry(entry);
        };
        window.addEventListener(MOBILE_BRANCH_RECOVERY_EVENT, recover);
        listeners.push(() => window.removeEventListener(MOBILE_BRANCH_RECOVERY_EVENT, recover));
        const revoke = (event: Event) => {
          const entry = (event as CustomEvent<unknown>).detail;
          if (typeof entry === "string") branches.stopEntry(entry);
        };
        window.addEventListener(MOBILE_BRANCH_REVOCATION_EVENT, revoke);
        listeners.push(() => window.removeEventListener(MOBILE_BRANCH_REVOCATION_EVENT, revoke));
        document.addEventListener("visibilitychange", refresh);
        listeners.push(() => document.removeEventListener("visibilitychange", refresh));
      })
      .catch((error) => {
        dispose();
        console.warn("Mobile prompt executor unavailable", error);
      });
    return () => {
      stopped = true;
      dispose();
    };
  }, []);
  return null;
}
