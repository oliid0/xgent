// Shared wiring for the LL-style workspace feature panel. Tool bodies consume
// one memoized value per project scope instead of depending on a dock shell.

import { createContext, useContext } from "react";
import type { GitClient } from "../../lib/git/types";
import type {
  WorkspaceFileTreeState,
  WorkspaceFileTreeStatePatch,
  SshHostConfig,
} from "../../lib/settings";
import type { TerminalClient, TerminalSession, TerminalSnapshot } from "../../lib/terminal/types";
import type { WorkspaceActivityClient } from "../../lib/workspace-activity/types";
import type { GitCommitContextPayload, GitFileContextPayload } from "./git-review";

export type WorkspaceToolsClients = {
  terminal: TerminalClient;
  git?: GitClient | null;
  workspaceActivity?: WorkspaceActivityClient | null;
};

export type WorkspaceToolsCapabilities = {
  projectReady: boolean;
  terminalReady: boolean;
  disabledMessage?: string;
  terminalDisabledMessage?: string;
  gitWriteEnabled: boolean;
  gitDisabledMessage?: string;
};

export type WorkspaceFileTreeContext = {
  state: WorkspaceFileTreeState;
  initialized: boolean;
  onInitializedChange: (initialized: boolean) => void;
  onStateChange: (patch: WorkspaceFileTreeStatePatch) => void;
  onInsertFileMention?: (path: string, kind: "file" | "dir") => void;
  onOpenFile?: (path: string, imagePaths?: string[]) => void;
  onRevealInFileTree: (path: string) => void;
};

// One-shot focus request from the chat layer (reply-footer changed-files
// card): switch GitReview to the changes view and select `path`'s diff.
// Consumers must call onFocusRequestHandled(nonce) after applying so the
// request never replays on a later panel remount.
export type GitReviewFocusRequest = {
  /** Empty string = just open the changes view without picking a file. */
  path: string;
  nonce: number;
};

export type WorkspaceGitContext = {
  onInsertCodeReviewSkill?: () => void;
  onInsertCommitMention?: (commit: GitCommitContextPayload) => void;
  onInsertGitFileMention?: (file: GitFileContextPayload) => void;
  focusRequest?: GitReviewFocusRequest | null;
  onFocusRequestHandled?: (nonce: number) => void;
};

export type WorkspaceSshContext = {
  hosts: SshHostConfig[];
  associatedHostIds: string[];
  sessions: TerminalSession[];
  onOpenSession?: (session: TerminalSession, kind?: "bash" | "sftp") => void;
  onAssociatedHostIdsChange?: (hostIds: string[]) => void;
  onSessionSnapshot: (snapshot: TerminalSnapshot) => void;
  onSessionClosed: (sessionId: string) => void;
  onSessionsReconcile: (sessions: TerminalSession[]) => void;
};

export type WorkspaceToolsContextValue = {
  projectPathKey: string;
  cwd: string;
  theme: "light" | "dark";
  clients: WorkspaceToolsClients;
  capabilities: WorkspaceToolsCapabilities;
  fileTree: WorkspaceFileTreeContext;
  git: WorkspaceGitContext;
  ssh: WorkspaceSshContext;
  openExternal: (url: string) => void;
};

export const WorkspaceToolsContext = createContext<WorkspaceToolsContextValue | null>(null);

export function useWorkspaceToolsContext(): WorkspaceToolsContextValue {
  const value = useContext(WorkspaceToolsContext);
  if (!value) {
    throw new Error("useWorkspaceToolsContext must be used inside WorkspaceToolsContext.Provider");
  }
  return value;
}
