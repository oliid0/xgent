// Aggregates one assistant reply's Write/Edit/Delete tool trace into the
// reply-footer changed-files card: per-file +N/-N line stats plus a deleted
// flag, deduped by path across every round of the reply. Only settled,
// successful tool results count — a failed or still-streaming operation
// changed nothing yet.
import { deriveFileChangeStats, type FileChangeStats } from "./fileChangeStats";
import { readStreamPreviewMeta } from "./toolPreview";
import type { UiRound } from "./uiMessages";

type ToolBlockItem = Extract<UiRound["blocks"][number], { kind: "tool" }>["item"];

export type ChangedFileEntry = {
  /** Tool-reported path (relative to the conversation workdir when possible). */
  path: string;
  added: number;
  removed: number;
  /** The file's final state within this reply is "deleted". */
  deleted: boolean;
  /** Tool call id of the last operation touching the file — stable render key. */
  lastToolCallId: string;
  /** Exact tool-level edit snapshots, when the settled trace retained complete fields. */
  beforeText?: string;
  afterText?: string;
  beforeTextAvailable: boolean;
  afterTextAvailable: boolean;
};

export type ChangedFilesSummary = {
  files: ChangedFileEntry[];
  totalAdded: number;
  totalRemoved: number;
};

const FILE_CHANGE_TOOL_NAMES = new Set(["Write", "Edit", "Delete"]);

// The card re-aggregates on every streaming delta of a live reply, but the
// tool calls it counts are settled (identity-stable) objects — memoize the
// per-call diff so the 200k-char Edit diff never reruns per delta.
const statsByToolCall = new WeakMap<object, FileChangeStats | null>();

function statsForToolCall(toolCall: ToolBlockItem["toolCall"]): FileChangeStats | undefined {
  const cached = statsByToolCall.get(toolCall);
  if (cached !== undefined) return cached ?? undefined;
  const stats = deriveFileChangeStats(toolCall) ?? null;
  statsByToolCall.set(toolCall, stats);
  return stats ?? undefined;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toolResultDetails(item: ToolBlockItem): Record<string, unknown> {
  const details = item.toolResult?.details;
  return details && typeof details === "object" && !Array.isArray(details)
    ? (details as Record<string, unknown>)
    : {};
}

function resolveEntryPath(item: ToolBlockItem, details: Record<string, unknown>): string {
  return (
    readString(details.displayPath) ||
    readString(details.relativePath) ||
    readString(details.path) ||
    readString(item.toolCall.arguments?.path)
  );
}

// Dedup key: same file edited twice must merge even when one op reported a
// backslash path and the other a forward-slash one.
function normalizePathKey(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

export function collectChangedFiles(
  rounds: readonly Pick<UiRound, "blocks">[],
): ChangedFilesSummary | null {
  const byKey = new Map<string, ChangedFileEntry>();

  for (const round of rounds) {
    for (const block of round.blocks) {
      if (block.kind !== "tool") continue;
      const item = block.item;
      const { toolCall, toolResult } = item;
      if (!FILE_CHANGE_TOOL_NAMES.has(toolCall.name)) continue;
      if (!toolResult || toolResult.isError) continue;

      const details = toolResultDetails(item);
      const path = resolveEntryPath(item, details);
      if (!path) continue;

      const key = normalizePathKey(path);
      const entry = byKey.get(key) ?? {
        path,
        added: 0,
        removed: 0,
        deleted: false,
        lastToolCallId: "",
        beforeTextAvailable: false,
        afterTextAvailable: false,
      };

      if (toolCall.name === "Delete") {
        entry.deleted = true;
        entry.beforeText = undefined;
        entry.afterText = "";
        entry.beforeTextAvailable = false;
        entry.afterTextAvailable = true;
      } else {
        const stats = statsForToolCall(toolCall);
        entry.added += stats?.added ?? 0;
        entry.removed += stats?.removed ?? 0;
        // A Write after a Delete re-creates the file.
        entry.deleted = false;

        const args = toolCall.arguments ?? {};
        const previewMeta = readStreamPreviewMeta(args);
        if (toolCall.name === "Write") {
          const content = args.content;
          const complete =
            typeof content === "string" && previewMeta?.fields.content?.truncated !== true;
          entry.beforeText = "";
          entry.afterText = complete ? content : undefined;
          entry.beforeTextAvailable = true;
          entry.afterTextAvailable = complete;
        } else {
          const oldText = args.old_string;
          const newText = args.new_string;
          const oldComplete =
            typeof oldText === "string" && previewMeta?.fields.old_string?.truncated !== true;
          const newComplete =
            typeof newText === "string" && previewMeta?.fields.new_string?.truncated !== true;
          entry.beforeText = oldComplete ? oldText : undefined;
          entry.afterText = newComplete ? newText : undefined;
          entry.beforeTextAvailable = oldComplete;
          entry.afterTextAvailable = newComplete;
        }
      }

      entry.path = path;
      entry.lastToolCallId = toolCall.id || entry.lastToolCallId;
      byKey.set(key, entry);
    }
  }

  if (byKey.size === 0) return null;

  const files = Array.from(byKey.values());
  let totalAdded = 0;
  let totalRemoved = 0;
  for (const file of files) {
    totalAdded += file.added;
    totalRemoved += file.removed;
  }
  return { files, totalAdded, totalRemoved };
}
