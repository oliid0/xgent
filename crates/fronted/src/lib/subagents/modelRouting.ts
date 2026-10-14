import type { WorkerHostInfo } from "../automation/types";
import { type ModelCooldownRegistry, modelCooldowns } from "../providers/runtime/modelCooldown";
import { toModelValue } from "../providers/runtime/modelValue";
import { createProviderRuntimeConfig } from "../providers/runtime/providerRuntimeConfig";
import type { ProviderRuntimeConfig } from "../providers/runtime/types";
import type { CustomProvider, ProviderId } from "../settings";

export type SubagentModelBinding = {
  providerId: ProviderId;
  model: string;
  runtime: ProviderRuntimeConfig;
};

export type SubagentModelCandidate = SubagentModelBinding & {
  value: string;
  providerName: string;
  skills: string[];
  maxConcurrency: number;
};

/** Native queues include main/background work; they are not the private Agent
 * pool or upstream quota. Keep their original host and observation separate. */
export async function readPersistentModelWorkload(
  load: () => Promise<WorkerHostInfo | null>,
  expectedHost: string,
  candidates: readonly SubagentModelCandidate[],
  now: () => number = Date.now,
) {
  const host = await load(),
    observed = now();
  if (
    !host ||
    host.hostId !== expectedHost ||
    host.modelRoutingVersion !== 1 ||
    !Number.isSafeInteger(host.observedAt) ||
    host.observedAt < 0 ||
    host.observedAt > observed + 60_000 ||
    observed - host.observedAt > 60_000
  ) {
    throw new Error("Original native model queue observation is unavailable or expired");
  }
  const rows = [];
  for (const candidate of candidates) {
    const provider = host.providers.find(
      (provider) => provider.id === candidate.runtime.providerConfigId,
    );
    const profiles =
      provider?.modelProfiles?.filter((profile) => profile.model === candidate.model) ?? [];
    if (!provider?.models.includes(candidate.model) || profiles.length !== 1) continue;
    const profile = profiles[0];
    if (
      ![profile.backgroundPending, profile.backgroundRunning, profile.backgroundWaiting].every(
        (count) => Number.isSafeInteger(count) && count >= 0,
      )
    ) {
      throw new Error("Original native model queue counts are invalid");
    }
    rows.push({
      value: candidate.value,
      model: candidate.model,
      backgroundPending: profile.backgroundPending,
      backgroundRunning: profile.backgroundRunning,
      backgroundWaiting: profile.backgroundWaiting,
    });
  }
  return {
    hostId: host.hostId,
    observedAt: host.observedAt,
    scope: "native_background_queue" as const,
    models: rows.slice(0, 128),
    omittedModels: Math.max(0, rows.length - 128),
    unobservedModels: candidates.length - rows.length,
  };
}

/** Candidates are configured chat runtimes, never credentials for a media API. */
export function configuredSubagentModels(providers: readonly CustomProvider[]) {
  const candidates: SubagentModelCandidate[] = [];
  for (const provider of providers) {
    const authenticated =
      provider.authMode === "oauth-managed"
        ? provider.type === "codex" && provider.oauthAccountId?.trim()
        : provider.apiKey.trim() || provider.apiKeyConfigured === true;
    if (!authenticated || !provider.baseUrl.trim()) continue;
    for (const model of provider.models) {
      if (!provider.activeModels.includes(model.id)) continue;
      candidates.push({
        value: toModelValue(provider.id, model.id),
        providerName: provider.name,
        providerId: provider.type,
        model: model.id,
        runtime: createProviderRuntimeConfig(provider, model.id, undefined),
        skills: model.delegationSkills ?? [],
        maxConcurrency: model.delegationMaxConcurrency ?? 2,
      });
    }
  }
  return candidates;
}

type Waiter = () => void;

/** Local process occupancy shared by conversations; no live-provider claims. */
export class SubagentModelPool {
  private active = new Map<string, number>();
  private waiters = new Set<Waiter>();

  constructor(private readonly cooldowns: ModelCooldownRegistry = modelCooldowns) {}

  snapshot(candidates: readonly SubagentModelCandidate[]) {
    return candidates.map((candidate) => {
      const cooldown = this.cooldowns.snapshot(candidate.value);
      return {
        value: candidate.value,
        providerName: candidate.providerName,
        providerType: candidate.providerId,
        model: candidate.model,
        skills: [...candidate.skills],
        activeRuns: this.active.get(candidate.value) ?? 0,
        maxConcurrency: candidate.maxConcurrency,
        availability: cooldown ? ("cooling_down" as const) : ("configured_unprobed" as const),
        ...(cooldown ? { cooldown } : {}),
        executor: "chat_agent" as const,
      };
    });
  }

  eligible(candidates: readonly SubagentModelCandidate[], value?: string, skills: string[] = []) {
    return candidates.filter(
      (candidate) =>
        (!value || candidate.value === value) &&
        skills.every((skill) => candidate.skills.includes(skill)),
    );
  }

  async run<T>(
    candidates: readonly SubagentModelCandidate[],
    task: (binding: SubagentModelCandidate) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (!candidates.length) throw new Error("No configured model satisfies this delegation.");
    let selected: SubagentModelCandidate;
    for (;;) {
      signal?.throwIfAborted();
      const idle = candidates
        .filter(
          (candidate) =>
            !this.cooldowns.remainingMs(candidate.value) &&
            (this.active.get(candidate.value) ?? 0) < candidate.maxConcurrency,
        )
        .sort(
          (left, right) =>
            (this.active.get(left.value) ?? 0) / left.maxConcurrency -
            (this.active.get(right.value) ?? 0) / right.maxConcurrency,
        )[0];
      if (idle) {
        selected = idle;
        this.active.set(idle.value, (this.active.get(idle.value) ?? 0) + 1);
        break;
      }
      const delays = candidates
        .map((candidate) => this.cooldowns.remainingMs(candidate.value))
        .filter((delay) => delay > 0);
      await this.wait(signal, delays.length ? Math.min(...delays) : undefined);
    }
    try {
      // No retry on another model: the delegate may already have performed writes.
      return await task(selected);
    } finally {
      const active = (this.active.get(selected.value) ?? 1) - 1;
      if (active) this.active.set(selected.value, active);
      else this.active.delete(selected.value);
      for (const wake of [...this.waiters]) wake();
    }
  }

  private wait(signal?: AbortSignal, delay?: number) {
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        this.waiters.delete(wake);
        signal?.removeEventListener("abort", abort);
        if (timer !== undefined) clearTimeout(timer);
        unsubscribe();
      };
      const wake = () => {
        cleanup();
        resolve();
      };
      const abort = () => {
        cleanup();
        reject(signal?.reason ?? new Error("Cancelled"));
      };
      const unsubscribe = this.cooldowns.subscribe(wake);
      this.waiters.add(wake);
      // Long server delays are respected across bounded timer segments.
      if (delay !== undefined) timer = setTimeout(wake, Math.min(delay, 2_147_483_647));
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
}

export const subagentModelPool = new SubagentModelPool();
