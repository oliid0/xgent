const CJK_CHARACTER =
  /[\u2e80-\u2fff\u3000-\u303f\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/u;

export const MESSAGE_ENVELOPE_TOKENS = 8;
export const CONTEXT_USAGE_WARN_RATIO = 0.5;
export const CONTEXT_USAGE_DANGER_RATIO = 0.8;

export function positiveTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

export function estimateTextTokenUnits(text: string): number {
  let cjkCharacters = 0;
  let otherCharacters = 0;
  for (const character of text) {
    if (CJK_CHARACTER.test(character)) cjkCharacters += 1;
    else otherCharacters += 1;
  }
  // Multiply once per character class so repeated fractional additions cannot
  // drift just above an integer boundary (for example 100 CJK characters
  // becoming 70.00000000000013 and therefore incorrectly rounding to 71).
  return cjkCharacters * 0.7 + otherCharacters * 0.25;
}

export function estimateTextTokens(text: string): number {
  const normalized = text.trim();
  return normalized === "" ? 0 : Math.ceil(estimateTextTokenUnits(normalized));
}

export function stringifiedTokenUnits(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? estimateTextTokenUnits(serialized) : 0;
  } catch {
    return 0;
  }
}

export function estimateContentBlockTokenUnits(value: unknown): number {
  if (typeof value === "string") return estimateTextTokenUnits(value);
  if (value === null || typeof value !== "object") return stringifiedTokenUnits(value);
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") return estimateTextTokenUnits(record.text);
  if (typeof record.content === "string") return estimateTextTokenUnits(record.content);
  if (record.type === "image" || record.type === "image_url") return 256;
  return stringifiedTokenUnits(value);
}

export function estimateContentTokenUnits(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((total, block) => total + estimateContentBlockTokenUnits(block), 0);
  }
  return estimateContentBlockTokenUnits(value);
}

export function contextUsageRatio(totalTokens: unknown, contextWindow: unknown): number {
  const total = positiveTokenCount(totalTokens) ?? 0;
  const window = positiveTokenCount(contextWindow) ?? 0;
  return window > 0 ? Math.max(0, total / window) : 0;
}

export function canManualCompact(ratio: number): boolean {
  return Number.isFinite(ratio) && ratio >= CONTEXT_USAGE_WARN_RATIO;
}

/**
 * Flatten transcript and live-round token anchors into chronological scan
 * items. Keeping this pure avoids coupling the context ring to a particular
 * conversation surface (main chat, workbench pane, or mobile compact view).
 */
export function buildContextUsageScanItems(
  transcriptItems: readonly unknown[],
  liveState?: unknown,
): unknown[] {
  const scanItems: unknown[] = [];
  for (const item of transcriptItems) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (positiveTokenCount(record.contextUsageTokens) !== undefined) {
      scanItems.push({ totalTokens: record.contextUsageTokens });
    }
    if (!Array.isArray(record.rounds)) continue;
    for (const round of record.rounds) {
      if (!round || typeof round !== "object") continue;
      const roundRecord = round as Record<string, unknown>;
      const meta = roundRecord.meta;
      if (meta && typeof meta === "object") scanItems.push(meta);
    }
  }
  if (liveState && typeof liveState === "object") {
    const rounds = (liveState as Record<string, unknown>).liveRounds;
    if (Array.isArray(rounds)) {
      for (const round of rounds) {
        if (!round || typeof round !== "object") continue;
        const meta = (round as Record<string, unknown>).meta;
        if (meta && typeof meta === "object") scanItems.push(meta);
      }
    }
  }
  return scanItems;
}

export function deriveContextUsageTokens(items: readonly unknown[]): number | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item === null || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const direct = positiveTokenCount(record.totalTokens);
    if (direct !== undefined) return direct;
    const usage = record.usage;
    if (usage !== null && typeof usage === "object") {
      const observed = positiveTokenCount((usage as Record<string, unknown>).totalTokens);
      if (observed !== undefined) return observed;
    }
    const legacyUsageField = ["live", "AgentContextUsage"].join("");
    const metadata = record.xgentContextUsage ?? record[legacyUsageField];
    if (metadata !== null && typeof metadata === "object") {
      const stamped = positiveTokenCount((metadata as Record<string, unknown>).totalTokens);
      if (stamped !== undefined) return stamped;
    }
  }
  return undefined;
}
