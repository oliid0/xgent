export type TrajectoryStatus = "complete" | "error" | "aborted";

export type TrajectoryUsage = {
  totalTokens?: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
};

export type TrajectorySection = {
  sectionId: string;
  slot: string;
  content: string;
};

export type TrajectorySectionRefs = Record<string, string>;

export type TrajectoryEvent = {
  k: string;
  at: number;
  [key: string]: unknown;
};
