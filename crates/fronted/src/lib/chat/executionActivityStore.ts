export type ExecutionActivity = {
  id: string;
  toolCallId?: string;
  kind: "shell" | "cua" | "browser";
  title: string;
  text: string;
  imageUrl?: string;
  previewError?: string;
  app?: string;
  status: "running" | "complete" | "error" | "stopped";
  sessionId?: string;
  outputCursor?: number;
  updatedAt: number;
};

export type ShellActivityResponse = {
  session_id: string;
  cursor: number;
  output: { text: string }[];
  status: string;
  has_more?: boolean;
};

// Tool waits and the viewer have independent cursors. Merge byte ranges once,
// so overlapping responses cannot duplicate output or roll the terminal back.
export function recordShellActivity(conversationId: string, response: ShellActivityResponse) {
  const previous = executionActivityStore
    .getSnapshot(conversationId)
    .find((item) => item.sessionId === response.session_id);
  if (!previous || response.cursor < (previous.outputCursor ?? 0)) return;
  const bytes = new TextEncoder().encode(response.output.map((item) => item.text).join(""));
  const unseen = Math.min(bytes.length, response.cursor - (previous.outputCursor ?? 0));
  const text = previous.text + new TextDecoder().decode(bytes.subarray(bytes.length - unseen));
  executionActivityStore.record(conversationId, {
    ...previous,
    text,
    outputCursor: response.cursor,
    status:
      response.status === "running"
        ? "running"
        : response.status === "completed"
          ? "complete"
          : response.status === "cancelled"
            ? "stopped"
            : "error",
  });
}

const EMPTY: readonly ExecutionActivity[] = [];
const conversations = new Map<string, readonly ExecutionActivity[]>();
const listeners = new Set<() => void>();
let notification: ReturnType<typeof setTimeout> | undefined;

// Retain a small replay window independently of transient transcript rounds.
// Inactive conversations have no timers, capture loops or mounted viewers.
export const executionActivityStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(conversationId: string) {
    return conversations.get(conversationId) ?? EMPTY;
  },
  record(conversationId: string | undefined, activity: Omit<ExecutionActivity, "updatedAt">) {
    if (!conversationId) return;
    const previous = conversations.get(conversationId) ?? EMPTY;
    const next = previous.filter((item) => item.id !== activity.id);
    next.push({ ...activity, text: activity.text.slice(-65_536), updatedAt: Date.now() });
    // Screenshots dominate memory. Keep only the latest three and cap each at
    // 2 MiB; older actions retain their semantic observation and timestamps.
    let images = 0;
    const bounded = next
      .slice(-24)
      .reverse()
      .map((item) => {
        if (!item.imageUrl) return item;
        images += 1;
        return images > 3 || item.imageUrl.length > 2 * 1024 * 1024
          ? { ...item, imageUrl: undefined }
          : item;
      })
      .reverse();
    conversations.delete(conversationId);
    conversations.set(conversationId, bounded);
    while (conversations.size > 12) conversations.delete(conversations.keys().next().value!);
    // Command output can arrive in bursts. Notify at most ten times a second.
    notification ??= setTimeout(() => {
      notification = undefined;
      for (const listener of listeners) listener();
    }, 100);
  },
};

export function activityObservation(content: readonly unknown[]) {
  let text = "";
  let imageUrl: string | undefined;
  for (const value of content) {
    if (!value || typeof value !== "object") continue;
    const item = value as Record<string, unknown>;
    if (item.type === "text" && typeof item.text === "string") text += `${item.text}\n`;
    if (
      item.type === "image" &&
      typeof item.data === "string" &&
      typeof item.mimeType === "string" &&
      /^image\/(png|jpeg|webp)$/.test(item.mimeType)
    ) {
      imageUrl = `data:${item.mimeType};base64,${item.data}`;
    }
  }
  return { text: text.trim(), imageUrl };
}
