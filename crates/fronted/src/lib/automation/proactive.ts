import type { CronTask, WorkerPeerList } from "./types";

export const HEALTH_UPDATE_METRICS = [
  "heart_rate",
  "blood_glucose",
  "oxygen_saturation",
  "weight",
  "body_temperature",
] as const;

export type ProactiveRuleConfig = {
  name: string;
  targetTaskId: string;
  sourceTaskId: string | null;
  eventKind: "run_succeeded" | "run_failed" | "health_updated" | "home_power_changed";
  healthMetric?: string | null;
  homeId?: string | null;
  backgroundHealthReads?: boolean;
  remoteExecution?: {
    peerId: string;
    providerId: string;
    model: string;
    workdir: string;
  } | null;
  cooldownMinutes: number;
  maxAgeMinutes: number;
  quietStart: number | null;
  quietEnd: number | null;
};

export type ProactiveRule = {
  id: string;
  config: ProactiveRuleConfig;
  enabled: boolean;
  lastQueuedAt: number | null;
  lastError: string | null;
};

export type ProactiveDelivery = {
  ruleId: string;
  eventSequence: number;
  sourceExecutionId: string;
  sourceTaskId: string;
  eventKind: ProactiveRuleConfig["eventKind"];
  state: "queued" | "deferred" | "suppressed" | "rejected" | "revoked";
  executionId: string | null;
  runState: string | null;
  runSuccess: boolean | null;
  reason: string;
  updatedAt: number;
  remoteRequestId?: string;
  remoteHostId?: string;
  deliveryError?: string;
};

export type ProactiveSnapshot = {
  executionPeers?: WorkerPeerList["peers"];
  healthEventMetrics?: string[];
  healthEventError?: string | null;
  homeEventHomes?: { id: string; name: string }[];
  homeEventError?: string | null;
  revision: number;
  hostId: string;
  hostTime: string;
  rules: ProactiveRule[];
  deliveries: ProactiveDelivery[];
  targets: CronTask[];
};

export type ProactiveOperation =
  | { op: "create"; config: ProactiveRuleConfig }
  | { op: "set_enabled"; id: string; enabled: boolean }
  | { op: "delete"; id: string };

/** Empty means no quiet hours. Reject partial or normalized invalid times. */
export function parseQuietTime(value: string): number | null {
  if (!value.trim()) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error("proactive.invalidTime");
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function validateProactiveConfig(config: ProactiveRuleConfig): void {
  if (!config.name.trim() || [...config.name].length > 120 || !config.targetTaskId)
    throw new Error("proactive.invalidRule");
  if (config.sourceTaskId === config.targetTaskId) throw new Error("proactive.invalidSource");
  for (const minutes of [config.cooldownMinutes, config.maxAgeMinutes]) {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080)
      throw new Error("proactive.invalidMinutes");
  }
  if (
    !["run_succeeded", "run_failed", "health_updated", "home_power_changed"].includes(
      config.eventKind,
    )
  )
    throw new Error("proactive.invalidRule");
  if (config.eventKind === "health_updated") {
    if (
      config.sourceTaskId !== null ||
      !HEALTH_UPDATE_METRICS.some((metric) => metric === config.healthMetric)
    )
      throw new Error("proactive.invalidHealthMetric");
  } else if (config.healthMetric != null) throw new Error("proactive.invalidRule");
  if (config.eventKind === "home_power_changed") {
    if (
      config.sourceTaskId !== null ||
      !config.homeId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(config.homeId)
    )
      throw new Error("proactive.invalidHome");
  } else if (config.homeId != null) throw new Error("proactive.invalidRule");
  const remote = config.remoteExecution;
  if (
    (config.backgroundHealthReads != null && typeof config.backgroundHealthReads !== "boolean") ||
    (config.backgroundHealthReads && (config.eventKind !== "health_updated" || remote == null))
  )
    throw new Error("proactive.invalidRule");
  if (
    remote != null &&
    (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(remote.peerId) ||
      !remote.providerId.trim() ||
      remote.providerId.length > 256 ||
      !remote.model.trim() ||
      remote.model.length > 512 ||
      !remote.workdir.trim() ||
      remote.workdir.length > 32768)
  )
    throw new Error("proactive.invalidExecutor");
  const times = [config.quietStart, config.quietEnd];
  if (
    times.some((time) => time !== null && (!Number.isInteger(time) || time < 0 || time >= 1440)) ||
    (config.quietStart === null) !== (config.quietEnd === null) ||
    (config.quietStart !== null && config.quietStart === config.quietEnd)
  )
    throw new Error("proactive.invalidTime");
}

export function eligibleProactiveTargets(tasks: CronTask[]) {
  return tasks.filter(
    (task) => task.type === "prompt" && task.enabled && task.remainingExecutions !== 0,
  );
}

/** Cached identities remain ownership, never current execution capability. */
export function eligibleProactivePeers(
  snapshot: ProactiveSnapshot | null,
  needsDeviceReads = false,
) {
  return (snapshot?.executionPeers ?? []).filter(
    (peer) =>
      peer.online &&
      peer.peerId === peer.host.hostId &&
      peer.peerId !== snapshot?.hostId &&
      ["macos", "windows", "linux"].includes(peer.host.platform) &&
      peer.host.executorReady &&
      peer.host.acceptsBackgroundTasks &&
      peer.host.workspaceAvailable &&
      peer.host.inputSnapshotVersion === 1 &&
      [1, 2].includes(peer.host.sourceContextVersion ?? 0) &&
      !!peer.host.workdir.trim() &&
      (!needsDeviceReads ||
        ([1, 2].includes(peer.host.sourceContextVersion ?? 0) &&
          peer.host.sourceRoutingVersion === 2 &&
          peer.host.deviceChannelVersion === 1 &&
          peer.host.deviceActionsVersion === 1)) &&
      peer.host.providers.some((provider) => provider.models.length > 0),
  );
}

/** A queued receipt is not success: display the actual joined execution state. */
export function proactiveDeliveryStatus(delivery: ProactiveDelivery): string {
  if (delivery.state !== "queued") return `proactive.state.${delivery.state}`;
  if (delivery.remoteRequestId && !delivery.runState) return "proactive.state.delivering";
  if (delivery.runState === "done")
    return delivery.runSuccess ? "proactive.state.done" : "proactive.state.failed";
  if (delivery.runState === "expired") return "proactive.state.expired";
  if (delivery.runState === "leased") return "proactive.state.running";
  if (delivery.runState === "pending") return "proactive.state.queued";
  if (delivery.runState === "waiting") return "proactive.state.waiting";
  return "proactive.state.unavailable";
}
