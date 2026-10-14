import type { CompletePromptRunInput } from "./types";

export const PROMPT_RUN_RECONCILE_INTERVAL_MS = 5_000;

export function createCompletePromptRunInput(
  executionId: string,
  success: boolean,
  durationMs: number,
  output: string,
): CompletePromptRunInput {
  return { executionId, success, durationMs, output };
}
