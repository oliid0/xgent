import { bindPreviewExecution, type PreviewExecution } from "../../lib/tools/previewExecution";
import { readWorkspaceFileSource } from "../../lib/tools/workspaceFileSource";
import type { ImageRotationDraft } from "./workspaceImageOperations";
import type { PdfHighlight } from "./workspacePdfHighlights";
export type PreviewDraft = {
  contentHash: string;
  mtimeMs: number;
  source: string;
  savedSource: string;
  cells: Record<string, Record<string, string>>;
  texts?: Record<string, string>;
  rotation?: ImageRotationDraft;
  highlights?: PdfHighlight[];
};

// Keep only unsaved text/cell edits. File bytes, canvases and Office DOM never live here.
export const previewDrafts = new Map<string, PreviewDraft>();
export const previewPendingWrites = new Map<string, Promise<void>>();
export function previewDraftKey(
  request: PreviewExecution & { ownerId?: string; workdir: string; path: string },
) {
  const bound = bindPreviewExecution(request);
  const source = readWorkspaceFileSource(bound.commandPort?.fileSource);
  return JSON.stringify([
    request.ownerId ?? "",
    bound.executionKey,
    source?.workdir ?? request.workdir,
    request.path,
  ]);
}
