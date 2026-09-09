import type { AssistantUnitRow } from "./rowModel";

/** Keep the final answer and interactive questions outside the work disclosure. */
export function workRecord(units: readonly AssistantUnitRow[], showThinking: boolean) {
  const visible = units.filter(
    ({ unit }) => showThinking || unit.kind !== "block" || unit.block.kind !== "thinking",
  );
  let lastWork = -1;
  visible.forEach(({ unit }, index) => {
    if (unit.kind === "block" && unit.block.kind !== "text") lastWork = index;
  });
  const work: AssistantUnitRow[] = [];
  const answer: AssistantUnitRow[] = [];
  visible.forEach((row, index) => {
    const block = row.unit.kind === "block" ? row.unit.block : null;
    const special =
      block?.kind === "tool" &&
      ["AskUserQuestion", "Image", "Agent"].includes(block.item.toolCall.name);
    if (index <= lastWork && block && !special) work.push(row);
    else answer.push(row);
  });
  return { work, answer };
}

export function workDuration(startedAt: number | undefined, endedAt: number) {
  if (!startedAt || endedAt < startedAt) return null;
  const seconds = Math.max(1, Math.round((endedAt - startedAt) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
