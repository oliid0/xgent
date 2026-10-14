import { resolveRuntimePlatform } from "../runtimePlatform";
import {
  filterMcpSettingsForWorkspace,
  normalizeSettings,
  resolveWorkspaceResources,
} from "../settings";
import { loadPersistedSettings } from "../settings/storage";
import { buildBuiltinToolRegistry } from "../tools/builtinRegistry";
import { createFileToolState } from "../tools/fileToolState";
import { backend } from "./backend";
import type { BackgroundWaitingTask } from "./types";

/** Inspect the real configured tool inventory; no model call or tool action. */
export async function discoverWaitingTools(task: BackgroundWaitingTask): Promise<string[]> {
  const snapshot = await backend.loadWaitingExecutionSettings(
    task.executionId,
    task.waiting.waitId,
  );
  if (
    !snapshot?.providerId ||
    !snapshot.system?.workdir ||
    snapshot.providers?.length !== 1 ||
    snapshot.providers[0].id !== snapshot.providerId ||
    !snapshot.mcp ||
    !snapshot.access
  )
    throw new Error("Waiting configuration is missing or inconsistent");
  const settings = normalizeSettings({
    ...(await loadPersistedSettings()),
    system: snapshot.system,
    customProviders: snapshot.providers,
    mcp: snapshot.mcp,
    access: snapshot.access,
  });
  const resources = resolveWorkspaceResources(settings, snapshot.system.workdir);
  const registry = await buildBuiltinToolRegistry({
    workdir: snapshot.system.workdir,
    providerId: snapshot.providers[0].type,
    runtimePlatform: await resolveRuntimePlatform(),
    fileState: createFileToolState(),
    skillsEnabled: false,
    runtimeScope: "cron_auto_prompt",
    selectedSystemToolIds: snapshot.system.selectedSystemTools,
    cloudExecution: snapshot.access,
    getMcpSettings: () => filterMcpSettingsForWorkspace(snapshot.mcp, resources),
    mcpLoadFailureMode: "continue",
  });
  return registry.tools.map((tool) => tool.name);
}

type WaitPorts = {
  reconcileCloudCancellations?: () => Promise<number>;
  recoverInterruptedCloudLaunches?: () => Promise<number>;
  dueBackgroundWaits: () => Promise<BackgroundWaitingTask[]>;
  deferBackgroundWait: (id: string, waitId: string) => Promise<void>;
  wakeReadyBackgroundTask: (id: string, waitId: string, tools: string[]) => Promise<boolean>;
  discoverTools: (task: BackgroundWaitingTask) => Promise<string[]>;
  probeBackgroundCloudWait: (id: string, waitId: string, callId: string) => Promise<boolean>;
};

/** Persistent native backoff gates this loop across WebView/app restarts. */
export function startBackgroundWaitReconciler(
  ports: WaitPorts = { ...backend, discoverTools: discoverWaitingTools },
) {
  let stopped = false,
    probing = false;
  const reconcile = async () => {
    if (stopped || probing) return;
    probing = true;
    try {
      try {
        await ports.reconcileCloudCancellations?.();
      } catch {
        console.warn("Original cloud cancellation remains pending; native backoff is retained");
      }
      if (stopped) return;
      try {
        await ports.recoverInterruptedCloudLaunches?.();
      } catch {
        console.warn("Interrupted cloud launch remains unresolved; native backoff is retained");
      }
      if (stopped) return;
      const tasks = await ports.dueBackgroundWaits();
      for (const task of tasks.slice(0, 4)) {
        if (stopped) return;
        try {
          // Native CAS rejects cancellation or a changed waiting occurrence.
          await ports.deferBackgroundWait(task.executionId, task.waiting.waitId);
          if (stopped) return;
          const cloudCalls = task.waiting.cloudCallIds ?? [];
          if (
            cloudCalls.length > 4 ||
            new Set(cloudCalls).size !== cloudCalls.length ||
            cloudCalls.some((id) => !id || id.length > 256)
          )
            throw new Error("Unbounded or invalid native cloud wait receipts");
          let resumed = false;
          for (const callId of cloudCalls) {
            if (stopped) return;
            try {
              resumed = await ports.probeBackgroundCloudWait(
                task.executionId,
                task.waiting.waitId,
                callId,
              );
              if (resumed) break;
            } catch {
              console.warn(
                "Acknowledged cloud job remains waiting; native backoff and receipts were retained",
              );
            }
          }
          if (stopped) return;
          if (
            resumed ||
            (!task.waiting.automaticTools.length && !task.waiting.retryOnInventoryChange)
          )
            continue;
          const tools = await ports.discoverTools(task);
          if (stopped) return;
          if (
            task.waiting.automaticTools.some((tool) => tools.includes(tool)) ||
            (task.waiting.retryOnInventoryChange &&
              tools.some((tool) => !task.waiting.knownTools.includes(tool)))
          )
            await ports.wakeReadyBackgroundTask(task.executionId, task.waiting.waitId, tools);
        } catch {
          // Changed credentials/permissions cannot become automatic authority.
          // The saved reason/evidence remains queryable; other tasks continue.
          console.warn(
            "Background wait remains unresolved; retained native state will be rechecked after backoff",
          );
        }
      }
    } catch {
      console.warn("Background wait discovery unavailable; reconciliation will retry");
    } finally {
      probing = false;
    }
  };
  const timer = setInterval(() => void reconcile(), 30_000);
  void reconcile();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
