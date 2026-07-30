import { openUrl } from "@xagent/runtime";
import { useCallback, useMemo } from "react";
import { FileTreePanel } from "../../../components/project-tools/file-tree";
import {
  RightDockToolContext,
  type RightDockToolContextValue,
} from "../../../components/project-tools/RightDockContext";
import { expandedPathsForFileTreePath } from "../../../components/project-tools/rightDockModel";
import { FolderTree, X } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import type {
  RightDockFileTreeState,
  RightDockFileTreeStatePatch,
} from "../../../lib/settings";
import type { TerminalClient } from "../../../lib/terminal/types";
import type { WorkspaceActivityClient } from "../../../lib/workspace-activity/types";

type MobileFilesPanelProps = {
  open: boolean;
  projectPathKey: string;
  cwd: string;
  theme: "light" | "dark";
  fileTreeState: RightDockFileTreeState;
  terminalClient: TerminalClient;
  workspaceActivityClient?: WorkspaceActivityClient | null;
  onFileTreeStateChange: (patch: RightDockFileTreeStatePatch) => void;
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
 * The desktop RightDockPanel owns terminal, SSH, Git, process and resize
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
          new Set([
            ...fileTreeState.expandedPaths,
            ...expandedPathsForFileTreePath(selectedPath),
          ]),
        ),
        bumpRevision: true,
      });
    },
    [fileTreeState.expandedPaths, onFileTreeStateChange, projectReady],
  );

  const context = useMemo<RightDockToolContextValue>(
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
        terminalDisabledMessage: "Desktop terminal lifecycle is not mounted in the mobile file view.",
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
    <RightDockToolContext.Provider value={context}>
      <section
        data-edge-swipe-ignore
        aria-label={t("sidebar.myFiles")}
        className="absolute inset-0 z-50 flex min-h-0 flex-col bg-background"
      >
        <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border/50 bg-background/85 px-3 backdrop-blur-2xl backdrop-saturate-150">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-500/10 text-sky-500">
            <FolderTree className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[16px] font-semibold tracking-tight">
              {t("sidebar.myFiles")}
            </h2>
            {cwd ? (
              <p className="truncate text-[11px] text-muted-foreground">{cwd}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-foreground/[0.08] active:text-foreground"
            aria-label={t("chat.cancel")}
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 pb-[env(safe-area-inset-bottom,0px)]">
          <FileTreePanel active touchActions />
        </div>
      </section>
    </RightDockToolContext.Provider>
  );
}
