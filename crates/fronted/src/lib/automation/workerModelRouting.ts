import type { WorkerHostInfo, WorkerRequirements } from "./types";

export type WorkerModelSelection = {
  providerId?: string;
  model?: string;
  current?: { customProviderId: string; model: string };
};

export function selectWorkerModelBinding(
  host: WorkerHostInfo,
  selection: WorkerModelSelection = {},
  requirements?: WorkerRequirements,
  now = Date.now(),
) {
  const skills = requirements?.modelSkills ?? [];
  if (
    skills.length &&
    (host.modelRoutingVersion !== 1 ||
      !Number.isSafeInteger(host.observedAt) ||
      host.observedAt < 0 ||
      host.observedAt > now + 60_000 ||
      now - host.observedAt > 60_000)
  )
    throw new Error("Worker model specialty protocol unavailable or observation expired");
  const candidates = host.providers.flatMap((provider) => {
    if (selection.providerId && provider.id !== selection.providerId) return [];
    return provider.models.flatMap((model) => {
      if (selection.model && model !== selection.model) return [];
      const profiles = provider.modelProfiles?.filter((profile) => profile.model === model) ?? [];
      const profile = profiles[0];
      if (
        skills.length &&
        (profiles.length !== 1 ||
          !profile ||
          !Array.isArray(profile.skills) ||
          profile.skills.length > 16 ||
          profile.skills.some(
            (skill) => typeof skill !== "string" || !/^[a-z][a-z0-9_-]{0,47}$/.test(skill),
          ) ||
          new Set(profile.skills).size !== profile.skills.length ||
          ![profile.backgroundPending, profile.backgroundRunning, profile.backgroundWaiting].every(
            (count) => Number.isSafeInteger(count) && count >= 0,
          ) ||
          !skills.every((skill) => profile.skills.includes(skill)))
      )
        return [];
      return [{ providerId: provider.id, model, profile }];
    });
  });
  if (skills.length)
    candidates.sort((a, b) => {
      const load = (candidate: (typeof candidates)[number]) =>
        candidate.profile!.backgroundPending + 2 * candidate.profile!.backgroundRunning;
      return (
        load(a) - load(b) ||
        `${a.providerId}::${a.model}`.localeCompare(`${b.providerId}::${b.model}`)
      );
    });
  const current = selection.current;
  const selected =
    skills.length || selection.model
      ? candidates[0]
      : (candidates.find(
          (c) => c.providerId === current?.customProviderId && c.model === current?.model,
        ) ??
        candidates.find((c) => c.model === current?.model) ??
        candidates[0]);
  if (!selected)
    throw new Error(
      "No advertised active provider/model satisfies the task's model selection and declared specialties",
    );
  return { providerId: selected.providerId, model: selected.model };
}
