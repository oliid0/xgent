export type ChatLayoutPreferences = {
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
};

type LayoutStorage = Pick<Storage, "getItem" | "setItem">;

const STORAGE_KEY = "xgent.chat-layout.v1";

export const DEFAULT_CHAT_LAYOUT_PREFERENCES: ChatLayoutPreferences = {
  leftSidebarOpen: false,
  rightSidebarOpen: false,
};

function browserStorage(): LayoutStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readChatLayoutPreferences(
  storage: LayoutStorage | undefined = browserStorage(),
): ChatLayoutPreferences {
  if (!storage) return DEFAULT_CHAT_LAYOUT_PREFERENCES;
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object") return DEFAULT_CHAT_LAYOUT_PREFERENCES;
    const record = parsed as Record<string, unknown>;
    return {
      leftSidebarOpen:
        typeof record.leftSidebarOpen === "boolean"
          ? record.leftSidebarOpen
          : DEFAULT_CHAT_LAYOUT_PREFERENCES.leftSidebarOpen,
      rightSidebarOpen:
        typeof record.rightSidebarOpen === "boolean"
          ? record.rightSidebarOpen
          : DEFAULT_CHAT_LAYOUT_PREFERENCES.rightSidebarOpen,
    };
  } catch {
    return DEFAULT_CHAT_LAYOUT_PREFERENCES;
  }
}

export function saveChatLayoutPreferences(
  patch: Partial<ChatLayoutPreferences>,
  storage: LayoutStorage | undefined = browserStorage(),
) {
  if (!storage) return;
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...readChatLayoutPreferences(storage), ...patch }),
    );
  } catch {}
}
