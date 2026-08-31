import type { CompactionPayload, SerializedGenericCompactionMessage } from "./payload";

const MAX_SCANNED_CHARS = 4_000;

const CJK_DOMINANCE_THRESHOLD = 0.25;

const MIN_SCANNED_LETTERS = 8;

type ScriptCounts = {
  han: number;
  kana: number;
  hangul: number;
  latin: number;
};

function tallyScripts(text: string, counts: ScriptCounts) {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if ((code >= 0x3400 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff)) {
      counts.han += 1;
    } else if (code >= 0x3040 && code <= 0x30ff) {
      counts.kana += 1;
    } else if (
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0x1100 && code <= 0x11ff) ||
      (code >= 0x3130 && code <= 0x318f)
    ) {
      counts.hangul += 1;
    } else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
      counts.latin += 1;
    }
  }
}

function collectRecentUserTexts(payload: CompactionPayload): string[] {
  const texts: string[] = [];
  let scannedChars = 0;
  const push = (text: string | undefined) => {
    if (!text || scannedChars >= MAX_SCANNED_CHARS) return;
    const slice = text.slice(0, MAX_SCANNED_CHARS - scannedChars);
    scannedChars += slice.length;
    texts.push(slice);
  };

  push(payload.next_user_message);
  const messages = payload.active_segment_messages;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (scannedChars >= MAX_SCANNED_CHARS) break;
    const message = messages[index];
    if (message.role !== "user") continue;
    push((message as SerializedGenericCompactionMessage).content);
  }
  return texts;
}

export function detectCompactionSummaryLanguage(payload: CompactionPayload): string | undefined {
  const counts: ScriptCounts = { han: 0, kana: 0, hangul: 0, latin: 0 };
  for (const text of collectRecentUserTexts(payload)) {
    tallyScripts(text, counts);
  }

  const cjk = counts.han + counts.kana + counts.hangul;
  const letters = cjk + counts.latin;
  if (letters < MIN_SCANNED_LETTERS || cjk / letters < CJK_DOMINANCE_THRESHOLD) {
    return undefined;
  }

  if (counts.kana > 0 && counts.kana * 20 >= cjk) return "Japanese";
  if (counts.hangul * 2 >= cjk) return "Korean";
  return "Chinese";
}
