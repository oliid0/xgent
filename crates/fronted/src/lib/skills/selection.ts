import { isAlwaysEnabledSkillName } from "./index";

export function selectSkills(
  current: readonly string[],
  names: readonly string[],
  enabled: boolean,
): string[] {
  const next = new Set(current);
  for (const name of names) {
    if (isAlwaysEnabledSkillName(name)) continue;
    if (enabled) next.add(name);
    else next.delete(name);
  }
  return [...next];
}

export type SkillSelectionUndo = {
  selected: string[];
  names: string[];
  enabled: boolean;
  count: number;
};

/** Undo only this batch's changed names; retain other edits made since it ran. */
export function undoSkillSelection(current: readonly string[], undo: SkillSelectionUndo): string[] {
  const before = new Set(undo.selected);
  const next = new Set(current);
  for (const name of undo.names) {
    if (isAlwaysEnabledSkillName(name) || next.has(name) !== undo.enabled) continue;
    if (before.has(name)) next.add(name);
    else next.delete(name);
  }
  return [...next];
}
