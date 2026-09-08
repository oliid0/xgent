import type { ToolTraceItem } from "./messages/uiMessages";

export const OPEN_TOOL_ACTIVITY = "xgent:open-tool-activity";
const selections = new Map<string, ToolTraceItem>();
const listeners = new Set<() => void>();

export function requestToolActivity(item: ToolTraceItem) {
  window.dispatchEvent(new CustomEvent(OPEN_TOOL_ACTIVITY, { detail: item }));
}

export const toolActivitySelection = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get(conversationId: string) {
    return selections.get(conversationId) ?? null;
  },
  select(conversationId: string, item: ToolTraceItem | null) {
    selections.delete(conversationId);
    if (item) selections.set(conversationId, item);
    while (selections.size > 12) selections.delete(selections.keys().next().value!);
    for (const listener of listeners) listener();
  },
};

export function toolStepLabel(item: ToolTraceItem, fallback: string) {
  const args = item.toolCall.arguments ?? {};
  for (const key of ["brief", "description", "title"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 240);
  }
  const target = args.path ?? args.file_path ?? args.app ?? args.url;
  return typeof target === "string" && target.trim() ? `${fallback} · ${target}` : fallback;
}
