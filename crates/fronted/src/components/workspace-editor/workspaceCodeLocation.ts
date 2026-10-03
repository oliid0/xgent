import type { WorkspaceCodeEditorOpenRequest } from "./WorkspaceCodeEditorOverlay";

/** The two editor implementations share the same one-based UTF-16 location request. */
export function workspaceCodeLocation(request: WorkspaceCodeEditorOpenRequest) {
  const valid = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value > 0;
  if (!valid(request.line)) return null;
  return {
    request: String(request.id),
    line: request.line,
    ...(valid(request.endLine) ? { endLine: request.endLine } : {}),
    ...(valid(request.column) ? { column: request.column } : {}),
  };
}
