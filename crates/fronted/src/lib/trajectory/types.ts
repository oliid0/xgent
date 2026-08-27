export type TrajectoryStatus = "complete" | "error" | "aborted";

export type TrajectoryUsage = {
  totalTokens?: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
};

export const TRAJECTORY_SECTION_SLOTS = [
  "base",
  "agent",
  "skills",
  "memory",
  "toolsSuffix",
  "toolCatalog",
  "runtime",
] as const;

export type TrajectorySectionSlot = (typeof TRAJECTORY_SECTION_SLOTS)[number];

export const TRAJECTORY_PROMPT_SECTION_SLOTS = [
  "base",
  "agent",
  "skills",
  "memory",
  "runtime",
  "toolsSuffix",
] as const satisfies readonly TrajectorySectionSlot[];

export type TrajectorySection = {
  sectionId: string;
  slot: TrajectorySectionSlot;
  content: string;
};

/** Fixed wire order; new slots may only be appended for persisted compatibility. */
export type TrajectorySectionRefs = readonly (string | null)[];

export type TrajectoryEvent = {
  k: string;
  at: number;
  [key: string]: unknown;
};
