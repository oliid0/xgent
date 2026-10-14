import type { BackgroundGoalBinding, WorkerHostInfo } from "./types";

export type GoalExecutor = { peerId: string | null; label: string; host: WorkerHostInfo };
export type GoalExecutors = { storeId: string; targets: GoalExecutor[] };
export type GoalLaunchInput = {
  requestId: string;
  goal: BackgroundGoalBinding;
  peerId: string | null;
  providerId: string;
  model: string;
  workdir: string;
  intelligentSchedulingEnabled: boolean;
};
export type GoalLaunchReceipt = {
  requestId: string;
  sourceHostId: string;
  accepted: boolean;
  cancelRequested: boolean;
  lastError: string | null;
  snapshot: GoalSnapshot;
};

export function readBackgroundGoalBinding(value: unknown): BackgroundGoalBinding {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("goals.invalidConfig");
  const binding = value as Record<string, unknown>,
    identity = /^[a-zA-Z0-9_-]{1,80}$/;
  if (
    Object.keys(binding).some((key) => !["goalId", "storeId", "revision"].includes(key)) ||
    typeof binding.goalId !== "string" ||
    !identity.test(binding.goalId) ||
    typeof binding.storeId !== "string" ||
    !identity.test(binding.storeId) ||
    typeof binding.revision !== "number" ||
    !Number.isSafeInteger(binding.revision) ||
    binding.revision < 0
  )
    throw new Error("goals.invalidConfig");
  return { goalId: binding.goalId, storeId: binding.storeId, revision: binding.revision };
}

export const GOAL_CATEGORIES = [
  "health",
  "relationships",
  "finance",
  "career",
  "interests",
  "productivity",
  "custom",
] as const;
export type GoalCategory = (typeof GOAL_CATEGORIES)[number];
export type GoalStatus = "active" | "paused" | "completed";
export type GoalStep = { id: string; title: string; done: boolean };
export type GoalConfig = {
  title: string;
  description: string;
  category: GoalCategory;
  parentId: string | null;
  steps: GoalStep[];
};
export type GoalTask = {
  id: string;
  name: string;
  enabled: boolean;
  exists: boolean;
  cron: string | null;
  followUp?: boolean;
  followUpBlocked?: string;
  followUpEligible?: boolean;
};
export type GoalWork = {
  requestId: string;
  name: string;
  state: string | null;
  success: boolean | null;
  exists: boolean;
};
export type GoalArtifact = {
  id: string;
  relativePath: string;
  contentHash: string;
  bytes: number;
  requestId: string;
  taskName: string;
  at: number;
};
export type GoalArtifactsPage = {
  goalId: string;
  storeId: string;
  items: GoalArtifact[];
  nextCursor: GoalActivityCursor | null;
};
export type GoalRecord = {
  id: string;
  config: GoalConfig;
  status: GoalStatus;
  createdAt: number;
  updatedAt: number;
  tasks: GoalTask[];
  backgroundTasks?: GoalWork[];
  artifactCount?: number;
  launchBlocked?: boolean;
};
export type GoalSnapshot = {
  revision: number;
  storeId: string;
  goals: GoalRecord[];
  targets: GoalTask[];
  backgroundTargets?: GoalWork[];
  launchVersion?: number;
  controlVersion?: number;
};
export type GoalOperation =
  | { op: "create" | "update"; id: string; config: GoalConfig }
  | { op: "set_status"; id: string; status: GoalStatus }
  | { op: "set_step"; id: string; step_id: string; done: boolean }
  | { op: "link_task"; id: string; task_id: string; follow_up?: boolean }
  | { op: "unlink_task"; id: string; task_id: string }
  | { op: "link_work" | "unlink_work"; id: string; request_id: string }
  | { op: "delete"; id: string };
export type GoalApplyInput = {
  revision: number;
  requestId: string;
  operation: GoalOperation;
  storeId?: string;
};
export type GoalActivityCursor = { at: number; id: string };
export type GoalActivity = {
  id: string;
  kind: string;
  label: string;
  at: number;
  state: string | null;
  success: boolean | null;
  output: string | null;
};
export type GoalActivityPage = {
  goalId: string;
  items: GoalActivity[];
  nextCursor: GoalActivityCursor | null;
};

export function validateGoalConfig(config: GoalConfig) {
  const identity = (id: string) => typeof id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(id);
  if (
    !config ||
    typeof config.title !== "string" ||
    !config.title.trim() ||
    Array.from(config.title.trim()).length > 160 ||
    typeof config.description !== "string" ||
    Array.from(config.description).length > 8000 ||
    !GOAL_CATEGORIES.includes(config.category) ||
    (config.parentId !== null && !identity(config.parentId)) ||
    !Array.isArray(config.steps) ||
    config.steps.length > 40 ||
    new Set(config.steps.map((step) => step?.id)).size !== config.steps.length ||
    config.steps.some(
      (step) =>
        !step ||
        !identity(step.id) ||
        typeof step.title !== "string" ||
        !step.title.trim() ||
        Array.from(step.title.trim()).length > 160 ||
        typeof step.done !== "boolean",
    )
  )
    throw new Error("goals.invalidConfig");
}
