import type { WorkerHostInfo, WorkerPeerList, WorkerRequirements } from "./types";
import { selectWorkerModelBinding, type WorkerModelSelection } from "./workerModelRouting";

export const WORKER_CAPABILITIES = [
  "git",
  "node",
  "python",
  "java",
  "javac",
  "xcode",
  "swift",
  "android-sdk",
] as const;
const platforms = ["windows", "macos", "linux"];

export function normalizeWorkerRequirements(value: unknown): WorkerRequirements {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Task requirements must be an object");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["capabilities", "platforms", "modelSkills"].includes(key)))
    throw new Error("Unknown task requirement field");
  const bounded = (value: unknown, allowed: readonly string[]) => {
    if (value === undefined) return [];
    if (
      !Array.isArray(value) ||
      value.length > allowed.length ||
      value.some((id) => typeof id !== "string" || !allowed.includes(id))
    )
      throw new Error("Unsupported or unbounded task capability/platform");
    return [...new Set(value as string[])].sort();
  };
  const modelSkills =
    input.modelSkills === undefined ? [] : normalizeModelSkills(input.modelSkills);
  const result = {
    capabilities: bounded(input.capabilities, WORKER_CAPABILITIES),
    platforms: bounded(input.platforms, platforms),
    ...(modelSkills.length ? { modelSkills } : {}),
  };
  if (!result.capabilities.length && !result.platforms.length && !result.modelSkills?.length)
    throw new Error("Name at least one required capability or platform");
  return result;
}

function normalizeModelSkills(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 16 ||
    value.some((skill) => typeof skill !== "string" || !/^[a-z][a-z0-9_-]{0,47}$/.test(skill))
  )
    throw new Error("Model specialties must be at most 16 configured skill identifiers");
  return [...new Set(value as string[])].sort();
}

export function workerRequirementFailure(
  host: WorkerHostInfo,
  requirements: WorkerRequirements,
  now = Date.now(),
): string | null {
  if (requirements.platforms.length && !requirements.platforms.includes(host.platform))
    return "Required platform unavailable";
  if (requirements.modelSkills?.length) {
    try {
      selectWorkerModelBinding(host, {}, requirements, now);
    } catch (error) {
      return String(error);
    }
    if (!requirements.capabilities.length && !requirements.platforms.length) return null;
  }
  // Inventory v1 also establishes that this receiver persists/enforces requirements.
  const inventory = host.inventory;
  if (!inventory || inventory.version !== 1) return "Observed requirement protocol unavailable";
  if (
    !Number.isSafeInteger(inventory.observedAt) ||
    !Number.isSafeInteger(inventory.validUntil) ||
    inventory.observedAt < 0 ||
    inventory.observedAt > now + 60_000 ||
    inventory.validUntil <= inventory.observedAt ||
    inventory.validUntil - inventory.observedAt > 60_000 ||
    now > inventory.validUntil
  )
    return "Toolchain observation expired or clock evidence invalid";
  if (
    !Array.isArray(inventory.capabilities) ||
    inventory.capabilities.length > WORKER_CAPABILITIES.length ||
    new Set(inventory.capabilities.map((item) => item.id)).size !== inventory.capabilities.length
  )
    return "Invalid capability inventory";
  if (
    inventory.capabilities.some(
      (item) =>
        !WORKER_CAPABILITIES.includes(item.id as (typeof WORKER_CAPABILITIES)[number]) ||
        !["available", "unavailable", "unknown"].includes(item.state) ||
        !["version-command", "sdk-layout", "policy"].includes(item.evidence) ||
        typeof item.detail !== "string" ||
        new TextEncoder().encode(item.detail).length > 2048,
    )
  )
    return "Invalid capability evidence";
  for (const id of requirements.capabilities)
    if (!inventory.capabilities.some((item) => item.id === id && item.state === "available"))
      return `Missing observed capability: ${id}`;
  return null;
}

export type WorkerRoute = {
  peerId: string | null;
  host: WorkerHostInfo;
  local: boolean;
  model?: { providerId: string; model: string };
};
export function rankWorkerRoutes(
  catalog: WorkerPeerList,
  local: WorkerHostInfo | null,
  requirements: WorkerRequirements,
  options: {
    excludedHostIds?: readonly string[];
    preferLocal?: boolean;
    now?: number;
    requiresSourceContext?: boolean;
    requiresSourceRouting?: boolean;
    requiresBudgetDelegation?: boolean;
    modelSelection?: WorkerModelSelection;
  } = {},
) {
  const now = options.now ?? Date.now(),
    rejected: { hostId: string; reason: string }[] = [];
  const candidates: WorkerRoute[] = [];
  const hosts = [
    ...catalog.peers.map((peer) => ({
      peerId: peer.peerId,
      host: peer.host,
      local: false,
      online: peer.online,
    })),
    ...(local ? [{ peerId: null, host: local, local: true, online: true }] : []),
  ];
  const seen = new Set<string>();
  // The native local observation wins over an accidentally paired loopback entry.
  for (const candidate of hosts.filter((c) => c.local || c.host.hostId !== local?.hostId)) {
    const { host } = candidate;
    const reason = !candidate.online
      ? "Worker offline"
      : !candidate.local && host.hostId !== candidate.peerId
        ? "Peer identity mismatch"
        : seen.has(host.hostId)
          ? "Duplicate host identity"
          : options.excludedHostIds?.includes(host.hostId)
            ? "Worker is an ancestor/current execution host"
            : !host.executorReady || !host.acceptsBackgroundTasks
              ? "Worker not ready or unauthorized"
              : !host.workspaceAvailable || !host.workdir?.trim()
                ? "Workspace unavailable"
                : !Array.isArray(host.providers) || !host.providers.some((p) => p.models.length)
                  ? "No configured active model"
                  : !Number.isSafeInteger(host.pending) ||
                      host.pending < 0 ||
                      !Number.isSafeInteger(host.running) ||
                      host.running < 0
                    ? "Invalid queue evidence"
                    : host.inputSnapshotVersion !== 1
                      ? "Immutable input protocol unavailable"
                      : options.requiresSourceContext &&
                          ![1, 2].includes(host.sourceContextVersion ?? 0)
                        ? "Immutable source conversation protocol unavailable"
                        : options.requiresSourceRouting &&
                            (![1, 2].includes(host.sourceRoutingVersion ?? 0) ||
                              host.deviceChannelVersion !== 1 ||
                              host.deviceActionsVersion !== 1)
                          ? "Immutable device-bound branch protocol unavailable"
                          : options.requiresBudgetDelegation &&
                              (host.budgetDelegationVersion !== 1 ||
                                host.intelligentSchedulingVersion !== 1)
                            ? "Delegated lifetime budget protocol unavailable"
                            : workerRequirementFailure(host, requirements, now);
    if (reason) rejected.push({ hostId: host.hostId, reason });
    else {
      let model: WorkerRoute["model"];
      if (requirements.modelSkills?.length || options.modelSelection) {
        try {
          model = selectWorkerModelBinding(host, options.modelSelection, requirements, now);
        } catch (error) {
          rejected.push({ hostId: host.hostId, reason: String(error) });
          continue;
        }
      }
      seen.add(host.hostId);
      candidates.push({
        peerId: candidate.peerId,
        host,
        local: candidate.local,
        ...(model ? { model } : {}),
      });
    }
  }
  candidates.sort((a, b) => {
    const immediatelyAvailable = (route: WorkerRoute) =>
      route.host.running < 2 && route.host.pending === 0;
    const immediate = Number(immediatelyAvailable(b)) - Number(immediatelyAvailable(a));
    if (immediate) return immediate;
    if (options.preferLocal !== false && a.local !== b.local) return a.local ? -1 : 1;
    return (
      a.host.pending + 2 * a.host.running - (b.host.pending + 2 * b.host.running) ||
      (a.host.hostId < b.host.hostId ? -1 : a.host.hostId > b.host.hostId ? 1 : 0)
    );
  });
  return {
    selected: candidates[0] ?? null,
    candidates,
    rejected,
    registrationError: catalog.registrationError,
  };
}
