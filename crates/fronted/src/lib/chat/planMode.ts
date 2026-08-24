export const EXIT_PLAN_MODE_TOOL_NAME = "ExitPlanMode";

export type ExitPlanModeResultDetails = {
  kind: "exit_plan_mode";
  plan: string;
};

export type PlanDecisionAnswer =
  | { decision: "approve" }
  | { decision: "reject"; feedback?: string };

export function sanitizePlanMarkdown(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n?/g, "\n").trim().slice(0, 120_000);
}

export function resolvePlanDecisionAnswer(value: unknown): PlanDecisionAnswer | null {
  if (typeof value === "string") {
    const decision = value.trim().toLowerCase();
    if (decision === "approve") return { decision: "approve" };
    if (decision === "reject") return { decision: "reject" };
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const decision = typeof record.decision === "string" ? record.decision.trim().toLowerCase() : "";
  if (decision === "approve") return { decision: "approve" };
  if (decision !== "reject") return null;
  const feedback = typeof record.feedback === "string" ? record.feedback.trim() : "";
  return feedback ? { decision: "reject", feedback } : { decision: "reject" };
}
