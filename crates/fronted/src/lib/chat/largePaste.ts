import type { MentionComposerLargePaste } from "../../components/chat/MentionComposer";
import { createUuid } from "../shared/id";
import { normalizeLogicalLineEndings } from "./messages/composerText";

export const largePasteRules = { minimumCharacters: 8_000, minimumLines: 200 } as const;

export function countLargePasteLines(text: string) {
  return text ? normalizeLogicalLineEndings(text).split("\n").length : 0;
}

export function isLargePasteText(text: string) {
  const value = normalizeLogicalLineEndings(text);
  return (
    value.length >= largePasteRules.minimumCharacters ||
    countLargePasteLines(value) >= largePasteRules.minimumLines
  );
}

export function makeLargePaste(
  text: string,
  index: number,
  id = `large-paste-${Date.now()}-${createUuid()}`,
): MentionComposerLargePaste {
  const value = normalizeLogicalLineEndings(text);
  return {
    id,
    label: `Pasted text ${index}`,
    text: value,
    charCount: value.length,
    lineCount: countLargePasteLines(value),
    preview: value.trim().replace(/\s+/g, " ").slice(0, 160),
  };
}
