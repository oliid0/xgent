import { invokeNative as invoke, listenNative as listen } from "@xgent/runtime";
import { createAutomationBackend } from "../lib/automation/backend";
import { startBackgroundWaitReconciler } from "../lib/automation/backgroundWaitReconciler";
import { executeCronPromptRun } from "../lib/automation/promptExecution";
import { startPromptRunHost } from "../lib/automation/promptRunHost";
import { loadPersistedSettings } from "../lib/settings/storage";
import { startLocalAccessHostBridge } from "./localAccessHostBridge";

/** Native-owned desktop execution context; no React root or chat lifecycle. */
export function startAgentWorker(
  instanceId = (globalThis as typeof globalThis & { __XGENT_WORKER_INSTANCE__?: string })
    .__XGENT_WORKER_INSTANCE__,
) {
  // Native injects a different immutable owner into each actual window.
  // Capture once: a late callback must never fetch a replacement's identity.
  const invokeWorker: typeof invoke = (command, args) =>
    invoke(command, { ...args, worker_instance_id: instanceId });
  const backend = createAutomationBackend({ invoke: invokeWorker, listen });
  let stopped = false;
  let connectingBridge = false;
  let startingExecution = false;
  let stopBridge: (() => void) | undefined;
  let stopPrompts: (() => void) | undefined;
  let stopWaits: (() => void) | undefined;
  let releaseKeepalive: (() => void) | undefined;
  // Request a Web Lock where supported to reduce background discard risk.
  if (typeof navigator !== "undefined" && navigator.locks) {
    const lifetime = new Promise<void>((resolve) => {
      releaseKeepalive = resolve;
    });
    void navigator.locks.request("xgent-agent-worker", () => lifetime).catch(console.warn);
  }

  async function connectBridge() {
    if (stopped || stopBridge || connectingBridge) return;
    connectingBridge = true;
    try {
      const stop = await startLocalAccessHostBridge();
      if (stopped) stop();
      else stopBridge = stop;
    } catch (error) {
      console.warn("Local access bridge unavailable; worker will reconnect", error);
    } finally {
      connectingBridge = false;
    }
  }

  async function reconcileExecution() {
    if (stopped || startingExecution) return;
    startingExecution = true;
    try {
      // Native startup recovery authorizes this heartbeat. Its rejection must
      // never start an unrecovered queue or block the independent RPC bridge.
      await invokeWorker("automation_background_host_heartbeat", { running: true });
      if (stopped) {
        await invokeWorker("automation_background_host_heartbeat", { running: false });
        return;
      }
      if (!stopPrompts) {
        stopPrompts = startPromptRunHost({
          ...backend,
          execute: async (request, signal) => {
            const settings = await loadPersistedSettings();
            signal.throwIfAborted();
            return executeCronPromptRun(settings, request, signal);
          },
        });
      }
      stopWaits ??= startBackgroundWaitReconciler();
    } catch (error) {
      if (String(error).includes("Background worker instance was superseded")) {
        stop();
        return;
      }
      // A later heartbeat transport failure does not abort actual running
      // work. Native readiness expires; existing leases still fence writes.
      if (!stopWaits) {
        stopPrompts?.();
        stopPrompts = undefined;
        await invokeWorker("automation_background_host_heartbeat", { running: false }).catch(
          console.warn,
        );
      }
      console.warn("Background executor unavailable; worker will reconcile", error);
    } finally {
      startingExecution = false;
    }
  }

  const retryTimer = setInterval(() => {
    void connectBridge();
    void reconcileExecution();
  }, 5_000);
  void connectBridge();
  void reconcileExecution();
  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(retryTimer);
    releaseKeepalive?.();
    stopBridge?.();
    stopPrompts?.();
    stopWaits?.();
    void invokeWorker("automation_background_host_heartbeat", { running: false }).catch(
      console.warn,
    );
  }
  return stop;
}
