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

function statsForToolCall(
  toolCall: ToolBlockItem["toolCall"],
  beforeContent?: string,
  afterContent?: string,
): FileChangeStats | undefined {
  const cached = statsByToolCall.get(toolCall);
  if (cached !== undefined) return cached ?? undefined;
  const content = toolCall.arguments?.content;
  const completeAfter =
    toolCall.name === "Edit"
      ? afterContent
      : typeof content === "string" &&
          readStreamPreviewMeta(toolCall.arguments)?.fields.content?.truncated !== true
        ? content
        : undefined;
  const stats =
    beforeContent !== undefined && completeAfter !== undefined
      ? (deriveFileChangeStats({
          name: "Edit",
          arguments: { old_string: beforeContent, new_string: completeAfter },
        }) ?? null)
      : (deriveFileChangeStats(toolCall) ?? null);
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
  const fullSnapshotKeys = new Set<string>();

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
      const firstMutation = !entry.lastToolCallId;

      if (toolCall.name === "Delete") {
        fullSnapshotKeys.delete(key);
        entry.deleted = true;
        entry.beforeText = undefined;
        entry.afterText = "";
        entry.beforeTextAvailable = false;
        entry.afterTextAvailable = true;
      } else {
        const stats = statsForToolCall(
          toolCall,
          typeof details.beforeContent === "string" ? details.beforeContent : undefined,
          typeof details.afterContent === "string" ? details.afterContent : undefined,
        );
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
          const beforeContent =
            typeof details.beforeContent === "string" ? details.beforeContent : undefined;
          if (firstMutation || !fullSnapshotKeys.has(key) || entry.afterText !== beforeContent) {
            entry.beforeText = details.existedBefore === true ? beforeContent : "";
            entry.beforeTextAvailable =
              details.existedBefore !== true || beforeContent !== undefined;
          }
          entry.afterText = complete && content.length <= 200_000 ? content : undefined;
          entry.afterTextAvailable = entry.afterText !== undefined;
          fullSnapshotKeys.add(key);
        } else {
          const beforeContent =
            typeof details.beforeContent === "string" ? details.beforeContent : undefined;
          const afterContent =
            typeof details.afterContent === "string" ? details.afterContent : undefined;
          const oldText = args.old_string;
          const newText = args.new_string;
          const oldComplete =
            typeof oldText === "string" && previewMeta?.fields.old_string?.truncated !== true;
          const newComplete =
            typeof newText === "string" && previewMeta?.fields.new_string?.truncated !== true;
          const fullSnapshot = beforeContent !== undefined && afterContent !== undefined;
          if (
            firstMutation ||
            !fullSnapshot ||
            !fullSnapshotKeys.has(key) ||
            entry.afterText !== beforeContent
          ) {
            entry.beforeText = fullSnapshot ? beforeContent : oldComplete ? oldText : undefined;
            entry.beforeTextAvailable = entry.beforeText !== undefined;
          }
          entry.afterText = fullSnapshot ? afterContent : newComplete ? newText : undefined;
          entry.afterTextAvailable = entry.afterText !== undefined;
          if (fullSnapshot) fullSnapshotKeys.add(key);
          else fullSnapshotKeys.delete(key);
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
