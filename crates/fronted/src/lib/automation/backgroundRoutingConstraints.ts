import type { TaskRoutingAssessment } from "./taskRoutingAssessment";
import type { BackgroundSourceRouting, BackgroundTaskPlan } from "./types";

const closed = (value: object, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
export function validateBackgroundSourceRouting(
  value: unknown,
): asserts value is BackgroundSourceRouting {
  const routing = value as BackgroundSourceRouting;
  if (
    !routing ||
    typeof routing !== "object" ||
    Array.isArray(routing) ||
    !closed(routing, ["version", "initiatingHostId", "branches"]) ||
    ![1, 2].includes(routing.version) ||
    typeof routing.initiatingHostId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      routing.initiatingHostId,
    ) ||
    !Array.isArray(routing.branches) ||
    !routing.branches.length ||
    routing.branches.length > 16 ||
    new TextEncoder().encode(JSON.stringify(routing)).length > 64 * 1024
  )
    throw new Error("Invalid immutable source routing");
  const ids = new Set<string>();
  for (const branch of routing.branches) {
    if (
      !branch ||
      typeof branch !== "object" ||
      !closed(branch, ["id", "requirement", "dependsOn", "locality", "observation"]) ||
      typeof branch.id !== "string" ||
      !/^[a-z0-9_-]{1,64}$/.test(branch.id) ||
      ids.has(branch.id) ||
      typeof branch.requirement !== "string" ||
      !branch.requirement.trim() ||
      new TextEncoder().encode(branch.requirement).length > 2048 ||
      !["portable", "initiating-device"].includes(branch.locality) ||
      !Array.isArray(branch.dependsOn) ||
      branch.dependsOn.length > 15 ||
      branch.dependsOn.some((id) => typeof id !== "string") ||
      new Set(branch.dependsOn).size !== branch.dependsOn.length
    )
      throw new Error("Invalid immutable source branch");
    if (branch.observation !== undefined) {
      const observation = branch.observation;
      if (
        routing.version !== 2 ||
        branch.locality !== "initiating-device" ||
        !observation ||
        typeof observation !== "object" ||
        Array.isArray(observation) ||
        !closed(observation, ["kind", "metric", "startMs", "endMs", "limit"]) ||
        observation.kind !== "health_samples" ||
        ![
          "heart_rate",
          "blood_glucose",
          "oxygen_saturation",
          "weight",
          "body_temperature",
        ].includes(observation.metric) ||
        !Number.isSafeInteger(observation.startMs) ||
        !Number.isSafeInteger(observation.endMs) ||
        observation.startMs <= 0 ||
        observation.endMs <= observation.startMs ||
        observation.endMs > 8_640_000_000_000_000 ||
        observation.endMs - observation.startMs > 7 * 24 * 60 * 60 * 1000 ||
        !Number.isSafeInteger(observation.limit) ||
        observation.limit < 1 ||
        observation.limit > 200
      )
        throw new Error("Invalid original health observation contract");
    }
    ids.add(branch.id);
  }
  const graph = new Map(routing.branches.map((b) => [b.id, b.dependsOn])),
    active = new Set<string>(),
    done = new Set<string>();
  const visit = (id: string) => {
    if (!ids.has(id) || active.has(id)) throw new Error("Invalid immutable source dependencies");
    if (done.has(id)) return;
    active.add(id);
    for (const dependency of graph.get(id) ?? []) visit(dependency);
    active.delete(id);
    done.add(id);
  };
  for (const id of ids) visit(id);
}

export function captureBackgroundSourceRouting(
  assessment: TaskRoutingAssessment,
  initiatingHostId: string,
): BackgroundSourceRouting {
  const routing = JSON.parse(
    JSON.stringify({
      version: 1,
      initiatingHostId,
      branches: assessment.branches.map(({ id, requirement, dependsOn, locality }) => ({
        id,
        requirement,
        dependsOn,
        locality,
      })),
    }),
  );
  validateBackgroundSourceRouting(routing);
  return routing;
}

/** Plan repair may choose evidence, but cannot move the original phone's authority. */
export function validateBackgroundRoutingPlan(
  plan: BackgroundTaskPlan,
  routing: BackgroundSourceRouting,
  executingHostId: string,
) {
  validateBackgroundSourceRouting(routing);
  if (!executingHostId) throw new Error("Missing actual execution device identity");
  for (const original of routing.branches) {
    const branch = plan.branches.find((b) => b.id === original.id);
    if (
      !branch ||
      branch.requirement !== original.requirement ||
      JSON.stringify([...branch.dependsOn].sort()) !==
        JSON.stringify([...original.dependsOn].sort())
    )
      throw new Error(
        `Preserve original branch ${original.id}, exact requirement and dependencies`,
      );
    if (
      original.locality === "initiating-device" &&
      executingHostId !== routing.initiatingHostId &&
      (!branch.criteria.length || branch.criteria.some((c) => c.kind !== "unavailable"))
    )
      throw new Error(
        `Branch ${original.id} requires initiating device ${routing.initiatingHostId}; keep unavailable until actual device-bound execution is supported. A different host/account or historical receipt is not completion.`,
      );
  }
}
