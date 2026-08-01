import { openUrl } from "@xagent/runtime";
import { useCallback, useMemo } from "react";
import { FolderTree } from "../../../components/icons";
import { FileTreePanel } from "../../../components/project-tools/file-tree";
import {
  WorkspaceToolsContext,
  type WorkspaceToolsContextValue,
} from "../../../components/project-tools/WorkspaceToolsContext";
import { expandedPathsForFileTreePath } from "../../../components/project-tools/workspaceToolsModel";
import { useLocale } from "../../../i18n";
import type { WorkspaceFileTreeState, WorkspaceFileTreeStatePatch } from "../../../lib/settings";
import type { TerminalClient } from "../../../lib/terminal/types";
import type { WorkspaceActivityClient } from "../../../lib/workspace-activity/types";
import { MobileFullscreenPanel, MobilePanelHeader } from "./MobilePanelScaffold";

type MobileFilesPanelProps = {
  open: boolean;
  projectPathKey: string;
  cwd: string;
  theme: "light" | "dark";
  fileTreeState: WorkspaceFileTreeState;
  terminalClient: TerminalClient;
  workspaceActivityClient?: WorkspaceActivityClient | null;
  onFileTreeStateChange: (patch: WorkspaceFileTreeStatePatch) => void;
  onInsertFileMention?: (path: string, kind: "file" | "dir") => void;
  onOpenFile?: (path: string, imagePaths?: string[]) => void;
  onClose: () => void;
};

function normalizeTreePath(path: string) {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

/**
 * Touch-first shell around the shared file-tree data/UI layer.
 *
 * The desktop WorkspaceToolsPanel owns terminal, SSH, Git, process and resize
 * lifecycles. Mobile only needs the file workspace here, so it provides the
 * same narrow tool context without mounting any desktop-only lifecycle.
 */
export function MobileFilesPanel(props: MobileFilesPanelProps) {
  const {
    open,
    projectPathKey,
    cwd,
    theme,
    fileTreeState,
    terminalClient,
    workspaceActivityClient = null,
    onFileTreeStateChange,
    onInsertFileMention,
    onOpenFile,
    onClose,
  } = props;
  const { t } = useLocale();
  const projectReady = Boolean(projectPathKey.trim() && cwd.trim());

  const revealPath = useCallback(
    (path: string) => {
      if (!projectReady) return;
      const selectedPath = normalizeTreePath(path);
      onFileTreeStateChange({
        query: "",
        selectedPath,
        expandedPaths: Array.from(
          new Set([...fileTreeState.expandedPaths, ...expandedPathsForFileTreePath(selectedPath)]),
        ),
        bumpRevision: true,
      });
    },
    [fileTreeState.expandedPaths, onFileTreeStateChange, projectReady],
  );

  const context = useMemo<WorkspaceToolsContextValue>(
    () => ({
      projectPathKey,
      cwd,
      theme,
      clients: {
        terminal: terminalClient,
        workspaceActivity: workspaceActivityClient,
      },
      capabilities: {
        projectReady,
        terminalReady: false,
        terminalDisabledMessage:
          "Desktop terminal lifecycle is not mounted in the mobile file view.",
        gitWriteEnabled: false,
      },
      fileTree: {
        state: fileTreeState,
        initialized: projectReady,
        onInitializedChange: () => undefined,
        onStateChange: onFileTreeStateChange,
        onInsertFileMention,
        onOpenFile,
        onRevealInFileTree: revealPath,
      },
      git: {},
      ssh: {
        hosts: [],
        associatedHostIds: [],
        sessions: [],
        onSessionSnapshot: () => undefined,
        onSessionClosed: () => undefined,
        onSessionsReconcile: () => undefined,
      },
      openExternal: (url: string) => {
        void openUrl(url);
      },
    }),
    [
      cwd,
      fileTreeState,
      onFileTreeStateChange,
      onInsertFileMention,
      onOpenFile,
      projectPathKey,
      projectReady,
      revealPath,
      terminalClient,
      theme,
      workspaceActivityClient,
    ],
  );

  if (!open) return null;

  return (
    <WorkspaceToolsContext.Provider value={context}>
      <MobileFullscreenPanel open label={t("sidebar.myFiles")}>
        <MobilePanelHeader
          title={t("sidebar.myFiles")}
          subtitle={cwd || undefined}
          backLabel={t("chat.cancel")}
          onBack={onClose}
          leading={
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-foreground">
              <FolderTree className="h-4 w-4" />
            </span>
          }
        />

        <div className="min-h-0 flex-1 pb-[env(safe-area-inset-bottom,0px)]">
          <FileTreePanel active touchActions />
        </div>
      </MobileFullscreenPanel>
    </WorkspaceToolsContext.Provider>
  );
}
