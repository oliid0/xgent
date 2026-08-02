import { openUrl } from "@xagent/runtime";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "../../i18n";
import type { GitClient } from "../../lib/git/types";
import type {
  AppSettings,
  SshHostConfig,
  WorkspaceFileTreeState,
  WorkspaceFileTreeStatePatch,
  WorkspaceToolsProjectState,
} from "../../lib/settings";
import type { SkillSummary } from "../../lib/skills";
import type {
  TerminalClient,
  TerminalSession,
  TerminalShellOption,
} from "../../lib/terminal/types";
import type { WorkspaceActivityClient } from "../../lib/workspace-activity/types";
import { McpHubPage } from "../../pages/mcp-hub/McpHubPage";
import { SkillsHubPage } from "../../pages/skills-hub/SkillsHubPage";
import { Cable, FolderTree, GitBranch, Key, SkillIcon, Terminal } from "../icons";
import { FileTreePanel } from "../project-tools/file-tree";
import type { GitCommitContextPayload, GitFileContextPayload } from "../project-tools/git-review";
import { GitReviewPanel } from "../project-tools/git-review";
import { SshConnectionPanel } from "../project-tools/SshConnectionPanel";
import { useWorkspaceToolSessions } from "../project-tools/useWorkspaceToolSessions";
import {
  type GitReviewFocusRequest,
  WorkspaceToolsContext,
  type WorkspaceToolsContextValue,
} from "../project-tools/WorkspaceToolsContext";
import {
  expandedPathsForFileTreePath,
  type WorkspacePanelTarget,
} from "../project-tools/workspaceToolsModel";
import { XTermViewport } from "../project-tools/XTermViewport";
import { Button } from "../ui/button";
import { BackgroundServicesPanel } from "./BackgroundServicesPanel";

type WorkspaceSidePanelProps = {
  target: WorkspacePanelTarget;
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
  onProjectStateChange: (
    updater: (current: WorkspaceToolsProjectState) => WorkspaceToolsProjectState,
  ) => void;
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
  initialSkills?: SkillSummary[];
  initialSkillsRootDir?: string;
  isAgentMode: boolean;
};

function normalizeTreePath(path: string) {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

export function WorkspaceSidePanel(props: WorkspaceSidePanelProps) {
  const { t } = useLocale();
  const [fileTreeInitialized, setFileTreeInitialized] = useState(true);
  const projectReady = Boolean(
    props.projectPathKey.trim() && props.cwd.trim() && !props.disabledMessage,
  );
  const terminalReady = projectReady;
  const sessions = useWorkspaceToolSessions({
    client: props.client,
    cwd: props.cwd,
    externalSessions: props.sessions,
    externalSessionsLoaded: props.sessionsLoaded,
    isOpen: props.target !== "skills" && props.target !== "mcp",
    projectPathKey: props.projectPathKey,
    projectState: props.projectState,
    terminalReady,
    onProjectStateChange: props.onProjectStateChange,
    onSessionsChange: props.onSessionsChange,
  });
  const activeLocalSession =
    sessions.localSessions.find((session) => session.id === sessions.activeSession?.id) ??
    sessions.localSessions.at(-1) ??
    null;
  const handledTerminalLaunchRef = useRef<number | null>(null);

  useEffect(() => {
    props.onShellOptionsChange?.(sessions.shellOptions);
  }, [props.onShellOptionsChange, sessions.shellOptions]);

  useEffect(() => {
    if (props.target !== "terminal") return;
    if (!terminalReady || !props.sessionsLoaded) return;
    if (handledTerminalLaunchRef.current === props.requestNonce) return;

    handledTerminalLaunchRef.current = props.requestNonce;
    if (sessions.localSessions.length > 0) {
      const session = activeLocalSession;
      if (session) sessions.activateTerminalSession(session);
      return;
    }
    void sessions.createTerminal(props.shell);
  }, [
    props.requestNonce,
    props.sessionsLoaded,
    props.shell,
    props.target,
    activeLocalSession,
    sessions.activateTerminalSession,
    sessions.createTerminal,
    sessions.localSessions,
    terminalReady,
  ]);

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

  let title = t("sidebar.terminal");
  let Icon = Terminal;
  switch (props.target) {
    case "fileTree":
      title = t("sidebar.myFiles");
      Icon = FolderTree;
      break;
    case "gitReview":
      title = t("sidebar.gitReview");
      Icon = GitBranch;
      break;
    case "sshConnection":
      title = t("sidebar.sshConnection");
      Icon = Key;
      break;
    case "backgroundTasks":
      title = t("sidebar.backgroundTasks");
      break;
    case "skills":
      title = "Skills";
      Icon = SkillIcon;
      break;
    case "mcp":
      title = "MCP";
      Icon = Cable;
      break;
  }

  return (
    <WorkspaceToolsContext.Provider value={context}>
      <aside
        data-workspace-side-panel
        data-workspace-tool={props.target}
        className="zone-font-scale workspace-side-panel relative flex h-full w-[min(38vw,420px)] min-w-[340px] shrink-0 flex-col overflow-hidden border-r border-border/55 bg-[hsl(var(--sidebar-bg))]"
        style={{ "--zone-font-scale": props.fontScale ?? 1 } as CSSProperties}
      >
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/55 px-3">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
        </header>

        {props.target === "skills" ? (
          <div className="min-h-0 flex-1">
            <SkillsHubPage
              settings={props.settings}
              setSettings={props.setSettings}
              initialSkills={props.initialSkills}
              initialRootDir={props.initialSkillsRootDir}
              isAgentMode={props.isAgentMode}
              sidebarOpen
              onOpenSidebar={() => undefined}
              embedded
            />
          </div>
        ) : props.target === "mcp" ? (
          <div className="min-h-0 flex-1">
            <McpHubPage
              settings={props.settings}
              setSettings={props.setSettings}
              isAgentMode={props.isAgentMode}
              sidebarOpen
              onOpenSidebar={() => undefined}
              allowStdio
              embedded
            />
          </div>
        ) : !projectReady && props.target !== "backgroundTasks" ? (
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
            {activeLocalSession ? (
              <div className="relative min-h-0 flex-1">
                <XTermViewport
                  client={props.client}
                  session={activeLocalSession}
                  theme={props.theme}
                  isActive
                  initialSnapshot={
                    sessions.initialTerminalSnapshotsRef.current.get(activeLocalSession.id) ??
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
