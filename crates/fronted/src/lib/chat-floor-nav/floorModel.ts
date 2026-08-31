export type FloorEntry = {
  rowKey: string;

  messageId: string;

  preview: string;

  responsePreview: string | null;
};

export type FloorSourceItem = {
  kind: string;
  key: string;
  text?: string;
  messageRef?: { messageId: string };
  rounds?: readonly {
    blocks: readonly {
      kind: string;
      text?: string;
    }[];
  }[];
};

const PREVIEW_MAX_CHARS = 48;
const RESPONSE_PREVIEW_MAX_CHARS = 180;

function buildTruncatedPreview(text: string, maxChars: number): string | null {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  const chars = Array.from(collapsed);
  return chars.length > maxChars ? `${chars.slice(0, maxChars).join("")}…` : collapsed;
}

export function buildFloorPreview(text: string): string {
  return buildTruncatedPreview(text, PREVIEW_MAX_CHARS) ?? "…";
}

function buildFloorResponsePreview(item: FloorSourceItem): string | null {
  const text = (item.rounds ?? [])
    .flatMap((round) => round.blocks)
    .filter((block) => block.kind === "text")
    .map((block) => block.text ?? "")
    .join(" ");
  return buildTruncatedPreview(text, RESPONSE_PREVIEW_MAX_CHARS);
}

export function buildFloorEntries(items: readonly FloorSourceItem[]): FloorEntry[] {
  const entries: FloorEntry[] = [];
  let pendingEntryIndex = -1;
  for (const item of items) {
    if (item.kind === "user") {
      entries.push({
        rowKey: item.key,
        messageId: item.messageRef?.messageId ?? item.key,
        preview: buildFloorPreview(item.text ?? ""),
        responsePreview: null,
      });
      pendingEntryIndex = entries.length - 1;
      continue;
    }
    if (item.kind !== "assistant" || pendingEntryIndex < 0) continue;
    const responsePreview = buildFloorResponsePreview(item);
    if (responsePreview) {
      entries[pendingEntryIndex] = {
        ...entries[pendingEntryIndex],
        responsePreview,
      };
    }
    pendingEntryIndex = -1;
  }
  return entries;
}

export function sampleFloorEntries(
  floors: FloorEntry[],
  maxMarkers: number,
  mustKeepRowKeys: ReadonlySet<string>,
): FloorEntry[] {
  if (maxMarkers <= 0) return [];
  if (floors.length <= maxMarkers) return floors;
  const picked = new Set<number>();
  const lastIndex = floors.length - 1;
  for (let i = 0; i < maxMarkers; i++) {
    picked.add(Math.round((i * lastIndex) / (maxMarkers - 1 || 1)));
  }
  return floors.filter((floor, index) => picked.has(index) || mustKeepRowKeys.has(floor.rowKey));
}

export function resolveNearestSampledRowKey(
  floors: FloorEntry[],
  sampled: FloorEntry[],
  activeRowKey: string | null,
): string | null {
  if (!activeRowKey || sampled.length === 0) return null;
  if (sampled.some((floor) => floor.rowKey === activeRowKey)) return activeRowKey;
  const activeIndex = floors.findIndex((floor) => floor.rowKey === activeRowKey);
  if (activeIndex === -1) return null;
  let nearest: string | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const marker of sampled) {
    const markerIndex = floors.findIndex((floor) => floor.rowKey === marker.rowKey);
    if (markerIndex === -1) continue;
    const distance = Math.abs(markerIndex - activeIndex);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = marker.rowKey;
    }
  }
  return nearest;
}
