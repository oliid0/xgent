import type { NativeWorkspaceEditorTab } from "./useNativeWorkspaceEditorTabs";

export type NativeWorkspaceEditorSessions = { scope: string; open: string[]; revision: number };

export function nativeWorkspaceEditorSessions(
  scope: string,
  tabs: NativeWorkspaceEditorTab[],
  revision: number,
): NativeWorkspaceEditorSessions {
  return { scope, open: tabs.map((tab) => JSON.stringify([tab.key, tab.session])), revision };
}
