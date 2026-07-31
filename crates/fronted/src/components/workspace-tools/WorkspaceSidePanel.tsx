import { openUrl } from "@xagent/runtime";
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import type { GitCommitContextPayload, GitFileContextPayload } from "../project-tools/git-review";
import { FileTreePanel } from "../project-tools/file-tree";
import { GitReviewPanel } from "../project-tools/git-review";
import {
  type GitReviewFocusRequest,
  WorkspaceToolsContext,
  type WorkspaceToolsContextValue,
} from "../project-tools/WorkspaceToolsContext";
import { SshConnectionPanel } from "../project-tools/SshConnectionPanel";
import { XTermViewport } from "../project-tools/XTermViewport";
import { expandedPathsForFileTreePath, type WorkspaceToolTarget } from "../project-tools/workspaceToolsModel";
import { useWorkspaceToolSessions } from "../project-tools/useWorkspaceToolSessions";
import { Button } from "../ui/button";
import { FolderTree, GitBranch, Key, Plus, Terminal } from "../icons";
import { useLocale } from "../../i18n";
import type { GitClient } from "../../lib/git/types";
import type {
  AppSettings,
  WorkspaceFileTreeState,
  WorkspaceFileTreeStatePatch,
  WorkspaceToolsProjectState,
  SshHostConfig,
} from "../../lib/settings";
import type { TerminalClient, TerminalSession, TerminalShellOption } from "../../lib/terminal/types";
import type { WorkspaceActivityClient } from "../../lib/workspace-activity/types";
import { BackgroundServicesPanel } from "./BackgroundServicesPanel";

type WorkspaceSidePanelProps = {
  target: WorkspaceToolTarget;
  shell?: string;
  requestNonce: number;
  fontScale?: number;
  projectPathKey: string;
  cwd: string;
  sessions: TerminalSession[];
  sessionsLoaded: boolean;
  theme: "light" | "dark";
  disabledMessage?: string;
  projectState: WorkspaceToolsProjectState;
  fileTreeState: WorkspaceFileTreeState;
  sshHosts: SshHostConfig[];
  associatedSshHostIds: string[];
  client: TerminalClient;
  gitClient?: GitClient | null;
  workspaceActivityClient?: WorkspaceActivityClient | null;
  settings: AppSettings;
  setSettings: (updater: (current: AppSettings) => AppSettings) => void;
  onProjectStateChange: (updater: (current: WorkspaceToolsProjectState) => WorkspaceToolsProjectState) => void;
  onFileTreeStateChange: (patch: WorkspaceFileTreeStatePatch) => void;
  onSshProjectHostIdsChange: (hostIds: string[]) => void;
  onOpenSshSession: (session: TerminalSession, kind?: "bash" | "sftp") => void;
  onSessionsChange: (sessions: TerminalSession[]) => void;
  onInsertFileMention?: (path: string, kind: "file" | "dir") => void;
  onOpenFile?: (path: string, imagePaths?: string[]) => void;
  onInsertCodeReviewSkill?: () => void;
  onInsertCommitMention?: (commit: GitCommitContextPayload) => void;
  onInsertGitFileMention?: (file: GitFileContextPayload) => void;
  gitReviewFocusRequest?: GitReviewFocusRequest | null;
  onGitReviewFocusRequestHandled?: (nonce: number) => void;
  onShellOptionsChange?: (options: TerminalShellOption[]) => void;
};

function normalizeTreePath(path: string) {
  return path.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

export function WorkspaceSidePanel(props: WorkspaceSidePanelProps) {
  const { t } = useLocale();
  const [fileTreeInitialized, setFileTreeInitialized] = useState(true);
  const projectReady = Boolean(props.projectPathKey.trim() && props.cwd.trim() && !props.disabledMessage);
  const terminalReady = projectReady;
  const sessions = useWorkspaceToolSessions({
    client: props.client,
    cwd: props.cwd,
    externalSessions: props.sessions,
    externalSessionsLoaded: props.sessionsLoaded,
    isOpen: true,
    projectPathKey: props.projectPathKey,
    projectState: props.projectState,
    terminalReady,
    onProjectStateChange: props.onProjectStateChange,
    onSessionsChange: props.onSessionsChange,
  });

  useEffect(() => {
    props.onShellOptionsChange?.(sessions.shellOptions);
  }, [props.onShellOptionsChange, sessions.shellOptions]);

  useEffect(() => {
    if (props.target !== "terminal") return;
    sessions.createTerminal(props.shell);
  }, [props.requestNonce, props.shell, props.target, sessions.createTerminal]);

  const revealPath = useCallback(
    (path: string) => {
      if (!projectReady) return;
      const selectedPath = normalizeTreePath(path);
      props.onFileTreeStateChange({
        query: "",
        selectedPath,
        expandedPaths: Array.from(
          new Set([
            ...props.fileTreeState.expandedPaths,
            ...expandedPathsForFileTreePath(selectedPath),
          ]),
        ),
        bumpRevision: true,
      });
    },
    [projectReady, props.fileTreeState.expandedPaths, props.onFileTreeStateChange],
  );

  const context = useMemo<WorkspaceToolsContextValue>(
    () => ({
      projectPathKey: props.projectPathKey,
      cwd: props.cwd,
      theme: props.theme,
      clients: {
        terminal: props.client,
        git: props.gitClient,
        workspaceActivity: props.workspaceActivityClient,
      },
      capabilities: {
        projectReady,
        terminalReady,
        disabledMessage: props.disabledMessage,
        terminalDisabledMessage: props.disabledMessage,
        gitWriteEnabled: true,
      },
      fileTree: {
        state: props.fileTreeState,
        initialized: fileTreeInitialized,
        onInitializedChange: setFileTreeInitialized,
        onStateChange: props.onFileTreeStateChange,
        onInsertFileMention: props.onInsertFileMention,
        onOpenFile: props.onOpenFile,
        onRevealInFileTree: revealPath,
      },
      git: {
        onInsertCodeReviewSkill: props.onInsertCodeReviewSkill,
        onInsertCommitMention: props.onInsertCommitMention,
        onInsertGitFileMention: props.onInsertGitFileMention,
        focusRequest: props.gitReviewFocusRequest,
        onFocusRequestHandled: props.onGitReviewFocusRequestHandled,
      },
      ssh: {
        hosts: props.sshHosts,
        associatedHostIds: props.associatedSshHostIds,
        sessions: sessions.sshSessions,
        onOpenSession: props.onOpenSshSession,
        onAssociatedHostIdsChange: props.onSshProjectHostIdsChange,
        onSessionSnapshot: sessions.rememberTerminalSnapshot,
        onSessionClosed: sessions.forgetTerminalSession,
        onSessionsReconcile: sessions.reconcileSshSessions,
      },
      openExternal: (url: string) => void openUrl(url),
    }),
    [
      fileTreeInitialized,
      projectReady,
      props.associatedSshHostIds,
      props.client,
      props.cwd,
      props.disabledMessage,
      props.fileTreeState,
      props.gitClient,
      props.gitReviewFocusRequest,
      props.onFileTreeStateChange,
      props.onGitReviewFocusRequestHandled,
      props.onInsertCodeReviewSkill,
      props.onInsertCommitMention,
      props.onInsertFileMention,
      props.onInsertGitFileMention,
      props.onOpenFile,
      props.onOpenSshSession,
      props.onSshProjectHostIdsChange,
      props.projectPathKey,
      props.sshHosts,
      props.theme,
      props.workspaceActivityClient,
      revealPath,
      sessions.forgetTerminalSession,
      sessions.reconcileSshSessions,
      sessions.rememberTerminalSnapshot,
      sessions.sshSessions,
      terminalReady,
    ],
  );

  const title =
    props.target === "fileTree"
      ? t("sidebar.myFiles")
      : props.target === "gitReview"
        ? t("sidebar.gitReview")
        : props.target === "sshConnection"
          ? t("sidebar.sshConnection")
          : props.target === "backgroundTasks"
            ? t("sidebar.backgroundTasks")
            : t("sidebar.terminal");
  const Icon =
    props.target === "fileTree"
      ? FolderTree
      : props.target === "gitReview"
        ? GitBranch
        : props.target === "sshConnection"
          ? Key
          : props.target === "backgroundTasks"
            ? Terminal
            : Terminal;

  return (
    <WorkspaceToolsContext.Provider value={context}>
      <aside
        data-workspace-side-panel
        className="zone-font-scale relative flex h-full w-[min(38vw,420px)] min-w-[340px] shrink-0 flex-col overflow-hidden border-r border-border/55 bg-[hsl(var(--sidebar-bg))]"
        style={{ "--zone-font-scale": props.fontScale ?? 1 } as CSSProperties}
      >
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/55 px-3">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
        </header>

        {!projectReady && props.target !== "backgroundTasks" ? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {props.disabledMessage ?? t("projectTools.noProjectSelected")}
          </div>
        ) : props.target === "fileTree" ? (
          <div className="min-h-0 flex-1">
            <FileTreePanel active />
          </div>
        ) : props.target === "gitReview" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <GitReviewPanel active />
          </div>
        ) : props.target === "sshConnection" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <SshConnectionPanel
              active
              cwd={props.cwd}
              projectPathKey={props.projectPathKey}
              hosts={props.sshHosts}
              associatedHostIds={props.associatedSshHostIds}
              client={props.client}
              sessions={sessions.sshSessions}
              onSessionSnapshot={sessions.rememberTerminalSnapshot}
              onSessionClosed={sessions.forgetTerminalSession}
              onSshSessionsReconcile={sessions.reconcileSshSessions}
              onOpenSession={props.onOpenSshSession}
              onAssociatedHostIdsChange={props.onSshProjectHostIdsChange}
            />
          </div>
        ) : props.target === "backgroundTasks" ? (
          <div className="min-h-0 flex-1">
            <BackgroundServicesPanel settings={props.settings} setSettings={props.setSettings} />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col bg-zinc-950 text-zinc-100">
            <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-white/10 p-2">
              {sessions.localSessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => sessions.activateTerminalSession(session)}
                  className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs ${
                    sessions.activeSession?.id === session.id
                      ? "bg-white/12 text-white"
                      : "text-zinc-400 hover:bg-white/[0.07] hover:text-zinc-200"
                  }`}
                >
                  {session.title || t("projectTools.terminalTitle")}
                </button>
              ))}
              <button
                type="button"
                onClick={() => sessions.createTerminal()}
                disabled={sessions.creating}
                className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white disabled:opacity-40"
                title={t("projectTools.newTerminal")}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            {sessions.activeSession ? (
              <div className="relative min-h-0 flex-1">
                <XTermViewport
                  client={props.client}
                  session={sessions.activeSession}
                  theme={props.theme}
                  isActive
                  initialSnapshot={
                    sessions.initialTerminalSnapshotsRef.current.get(sessions.activeSession.id) ??
                    undefined
                  }
                  onError={(_sessionId, message) => sessions.setError(message)}
                  onInitialSnapshotConsumed={sessions.handleInitialTerminalSnapshotConsumed}
                />
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-5 text-center">
                <Terminal className="h-7 w-7 text-zinc-500" />
                <p className="text-xs text-zinc-400">{t("projectTools.terminalDescription")}</p>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => sessions.createTerminal(props.shell)}
                  disabled={sessions.creating}
                >
                  {t("projectTools.newTerminal")}
                </Button>
              </div>
            )}
          </div>
        )}
      </aside>
    </WorkspaceToolsContext.Provider>
  );
}
