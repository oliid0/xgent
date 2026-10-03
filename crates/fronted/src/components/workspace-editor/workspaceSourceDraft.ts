export function parseWorkspaceSourceDraft(value: unknown): { content: string } | null {
  if (typeof value !== "string") return null;
  try {
    const draft = JSON.parse(value);
    return draft &&
      typeof draft === "object" &&
      draft.kind === "source" &&
      typeof draft.content === "string"
      ? { content: draft.content }
      : null;
  } catch {
    return null;
  }
}
