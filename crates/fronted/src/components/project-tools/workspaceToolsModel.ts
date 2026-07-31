import { type WorkspaceToolKind, workspaceProjectPathKey } from "../../lib/settings";
import type { TerminalSession } from "../../lib/terminal/types";

export const DEFAULT_TERMINAL_COLS = 80;
export const DEFAULT_TERMINAL_ROWS = 24;

export type WorkspaceToolTarget = WorkspaceToolKind | "terminal" | "backgroundTasks";

export type WorkspaceNavigationTarget = "conversations" | "skills" | "mcp" | WorkspaceToolTarget;

export type WorkspaceToolLaunchRequest = {
  nonce: number;
  target: WorkspaceToolTarget;
  shell?: string;
};

export function sortSessions(sessions: TerminalSession[]) {
  return [...sessions].sort((left, right) => left.createdAt - right.createdAt);
}

export function areSessionsEqual(
  left: readonly TerminalSession[],
  right: readonly TerminalSession[],
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function terminalSessionBelongsToProject(session: TerminalSession, projectPathKey: string) {
  const wantedProjectKey = workspaceProjectPathKey(projectPathKey);
  if (!wantedProjectKey) return false;
  const sessionProjectKey = workspaceProjectPathKey(session.projectPathKey || session.cwd);
  return sessionProjectKey === wantedProjectKey;
}

export function expandedPathsForFileTreePath(path: string) {
  const normalized = path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  const parts = normalized.split("/").filter(Boolean);
  const directories = parts.slice(0, -1);
  return ["", ...directories.map((_, index) => parts.slice(0, index + 1).join("/"))];
}

export function workspaceToolsNeighborTabId(tabOrder: readonly string[], tabId: string) {
  const index = tabOrder.indexOf(tabId);
  if (index < 0) return undefined;
  return tabOrder[index + 1] ?? tabOrder[index - 1];
}
