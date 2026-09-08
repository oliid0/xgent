export type PreviewDraft = {
  contentHash: string;
  mtimeMs: number;
  source: string;
  savedSource: string;
  annotation: string;
  annotationPage: number;
  cells: Record<string, Record<string, string>>;
};

// Keep only unsaved text/cell edits. File bytes, canvases and Office DOM never live here.
export const previewDrafts = new Map<string, PreviewDraft>();
export function previewDraftKey(request: { ownerId?: string; workdir: string; path: string }) {
  return JSON.stringify([request.ownerId ?? "", request.workdir, request.path]);
}
