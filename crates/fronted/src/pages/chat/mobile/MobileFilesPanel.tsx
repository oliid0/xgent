import { StackItem } from "@astryxdesign/core/Layout";
import { openUrl } from "@xgent/runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HubHeader } from "../../../components/hub/HubChrome";
import { FolderTree } from "../../../components/icons";
import { FileTreePanel } from "../../../components/project-tools/file-tree";
import {
  addExpandedPaths,
  basename,
  dirname,
  type FileTreeNode,
  ROOT_PATH,
  remapExpandedPathsForRename,
  removeExpandedPath,
  removeExpandedSubtree,
} from "../../../components/project-tools/file-tree/model";
import { useFileTreeData } from "../../../components/project-tools/file-tree/useFileTreeData";
import {
  WorkspaceToolsContext,
  type WorkspaceToolsContextValue,
} from "../../../components/project-tools/WorkspaceToolsContext";
import { expandedPathsForFileTreePath } from "../../../components/project-tools/workspaceToolsModel";
import { isWorkspaceImagePath } from "../../../components/workspace-editor/workspaceImagePreview";
import { useLocale } from "../../../i18n";
import { isNativeMobileRuntime } from "../../../lib/runtimePlatform";
import type {
  AppSettings,
  WorkspaceFileTreeState,
  WorkspaceFileTreeStatePatch,
} from "../../../lib/settings";
import type { TerminalClient } from "../../../lib/terminal/types";
import type { WorkspaceActivityClient } from "../../../lib/workspace-activity/types";
import { NativeSurface } from "../../../presentation/NativeSurface";
import { createNativePresentationTheme } from "../../../presentation/nativeTheme";
import type {
  PresentationHandler,
  PresentationNode,
  PresentationValue,
} from "../../../presentation/types";
import { isApplePresentationRuntime } from "../../../runtime/applePresentation";
import { MobileFullscreenPanel } from "./MobilePanelScaffold";

type MobileFilesPanelProps = {
  open: boolean;
  projectPathKey: string;
  cwd: string;
  theme: "light" | "dark";
  settings: AppSettings;
  fileTreeState: WorkspaceFileTreeState;
  terminalClient: TerminalClient;
  workspaceActivityClient?: WorkspaceActivityClient | null;
  onFileTreeStateChange: (patch: WorkspaceFileTreeStatePatch) => void;
  onInsertFileMention?: (path: string, kind: "file" | "dir") => void;
  onOpenFile?: (path: string, imagePaths?: string[]) => void;
  onClose: () => void;
};

type PendingAction = "file" | "folder" | "rename" | null;

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
    settings,
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

  if (isApplePresentationRuntime()) {
    return (
      <NativeMobileFilesPanel
        open={open}
        projectPathKey={projectPathKey}
        cwd={cwd}
        settings={settings}
        fileTreeState={fileTreeState}
        workspaceActivityClient={workspaceActivityClient}
        onFileTreeStateChange={onFileTreeStateChange}
        onInsertFileMention={onInsertFileMention}
        onOpenFile={onOpenFile}
        onClose={onClose}
      />
    );
  }

  return (
    <WorkspaceToolsContext.Provider value={context}>
      <MobileFullscreenPanel open label={t("sidebar.myFiles")}>
        <HubHeader
          icon={<FolderTree className="h-5 w-5" />}
          title={t("sidebar.myFiles")}
          subtitle={cwd || undefined}
          sidebarOpen
          onOpenSidebar={() => undefined}
          onClose={onClose}
          closeLabel={t("chat.cancel")}
        />

        <StackItem size="fill" className="mobile-panel-safe-content">
          <FileTreePanel active touchActions />
        </StackItem>
      </MobileFullscreenPanel>
    </WorkspaceToolsContext.Provider>
  );
}

type NativeMobileFilesPanelProps = Pick<
  MobileFilesPanelProps,
  | "open"
  | "projectPathKey"
  | "cwd"
  | "settings"
  | "fileTreeState"
  | "workspaceActivityClient"
  | "onFileTreeStateChange"
  | "onInsertFileMention"
  | "onOpenFile"
  | "onClose"
>;

/** SwiftUI rendering for the same file-tree state and Rust filesystem commands. */
function NativeMobileFilesPanel(props: NativeMobileFilesPanelProps) {
  const { t } = useLocale();
  const [query, setQuery] = useState(props.fileTreeState.query);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [pendingTargetPath, setPendingTargetPath] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const projectReady = Boolean(props.projectPathKey.trim() && props.cwd.trim());
  const expandedPaths = props.fileTreeState.expandedPaths;
  const expandedSet = useMemo(() => new Set(expandedPaths), [expandedPaths]);
  const { nodes, loadChildren, refreshVisible, createEntry, renameEntry, deleteEntry, search } =
    useFileTreeData({
      projectPathKey: props.projectPathKey,
      cwd: props.cwd,
      active: props.open,
      initialized: projectReady,
      workspaceActivityClient: props.workspaceActivityClient ?? null,
      expandedPaths,
      query,
      showHidden: props.fileTreeState.showHidden,
    });

  useEffect(() => {
    setQuery((current) =>
      current === props.fileTreeState.query ? current : props.fileTreeState.query,
    );
  }, [props.fileTreeState.query]);
  useEffect(() => {
    if (!projectReady || query === props.fileTreeState.query) return undefined;
    const timer = window.setTimeout(() => props.onFileTreeStateChange({ query }), 180);
    return () => window.clearTimeout(timer);
  }, [projectReady, props.fileTreeState.query, props.onFileTreeStateChange, query]);
  useEffect(() => {
    setPendingAction(null);
    setPendingTargetPath(null);
    setDraftName("");
    setDeleteTarget(null);
    setActionError(null);
  }, [props.projectPathKey]);

  const selectedNode = nodes[props.fileTreeState.selectedPath] ?? nodes[ROOT_PATH];
  const selectedPath = selectedNode?.path ?? ROOT_PATH;
  const emitExpanded = (next: string[]) => props.onFileTreeStateChange({ expandedPaths: next });
  const selectPath = (path: string) => props.onFileTreeStateChange({ selectedPath: path });
  const toggleDirectory = (path: string) => {
    if (expandedSet.has(path)) {
      emitExpanded(removeExpandedPath(expandedPaths, path));
      return;
    }
    emitExpanded(addExpandedPaths(expandedPaths, [path]));
    void loadChildren(path);
  };
  const siblingImages = (path: string) => {
    if (!isWorkspaceImagePath(path)) return [];
    const siblings =
      nodes[dirname(path)]?.children.filter(
        (item) => nodes[item]?.kind === "file" && isWorkspaceImagePath(item),
      ) ?? [];
    return siblings.includes(path) ? siblings : [path];
  };
  const openFile = (path: string) => props.onOpenFile?.(path, siblingImages(path));
  const startAction = (action: Exclude<PendingAction, null>) => {
    if (!projectReady || busyAction) return;
    if (action === "rename" && !selectedPath) return;
    setPendingAction(action);
    setPendingTargetPath(selectedPath);
    setDraftName(action === "rename" ? basename(selectedPath) : "");
    setDeleteTarget(null);
    setActionError(null);
  };
  const finishAction = async () => {
    if (!pendingAction || busyAction) return;
    const name = draftName.trim();
    if (!name) {
      setActionError(t("projectTools.fileTree.nameRequired"));
      return;
    }
    setBusyAction(true);
    setActionError(null);
    try {
      const targetPath = pendingTargetPath ?? selectedPath;
      const targetNode = nodes[targetPath] ?? nodes[ROOT_PATH];
      const targetDir = targetNode?.kind === "dir" ? targetNode.path : dirname(targetPath);
      if (pendingAction === "file") {
        const next = await createEntry("file", targetDir, name);
        emitExpanded(addExpandedPaths(expandedPaths, [targetDir]));
        selectPath(next);
      } else if (pendingAction === "folder") {
        const next = await createEntry("dir", targetDir, name);
        emitExpanded(addExpandedPaths(expandedPaths, [targetDir, next]));
        selectPath(next);
      } else if (targetPath) {
        const next = await renameEntry(targetPath, name);
        emitExpanded(remapExpandedPathsForRename(expandedPaths, targetPath, next));
        selectPath(next);
      }
      setPendingAction(null);
      setPendingTargetPath(null);
      setDraftName("");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(false);
    }
  };
  const confirmDelete = async () => {
    if (!deleteTarget || busyAction) return;
    setBusyAction(true);
    setActionError(null);
    try {
      await deleteEntry(deleteTarget);
      emitExpanded(removeExpandedSubtree(expandedPaths, deleteTarget));
      selectPath(dirname(deleteTarget));
      setDeleteTarget(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(false);
    }
  };

  const handlers = new Map<string, PresentationHandler>();
  const bind = (
    id: string,
    run: (value: PresentationValue) => unknown,
    accepts: (value: PresentationValue) => boolean,
    enabled = true,
  ) => {
    handlers.set(id, { run, accepts, enabled });
    return id;
  };
  const button = (
    id: string,
    label: string,
    icon: string,
    run: () => unknown,
    enabled = true,
    destructive = false,
  ): PresentationNode => ({
    id,
    kind: "Button",
    label,
    icon,
    disabled: !enabled,
    destructive,
    action: bind(id, run, (value) => value === null, enabled),
  });
  const fileRow = (node: FileTreeNode, depth: number): PresentationNode => ({
    id: `file-row:${node.path || "root"}`,
    kind: "TreeRow",
    label: node.name,
    text: node.path || props.cwd,
    icon: node.kind === "file" ? "doc" : expandedSet.has(node.path) ? "folder.fill" : "folder",
    selected: node.path === selectedPath,
    secondary: node.hidden,
    padding: 4,
    indent: depth * 14,
    action: bind(
      `file-row:${node.path || "root"}`,
      () => {
        selectPath(node.path);
        if (node.kind === "dir") toggleDirectory(node.path);
        else openFile(node.path);
      },
      (value) => value === null,
    ),
  });
  const treeRows: PresentationNode[] = [];
  const visited = new Set<string>();
  const appendTree = (path: string, depth: number) => {
    const node = nodes[path];
    if (!node || visited.has(path)) return;
    visited.add(path);
    if (props.fileTreeState.showHidden || !node.hidden) treeRows.push(fileRow(node, depth));
    if (node.kind === "dir" && expandedSet.has(path)) {
      for (const child of node.children) appendTree(child, depth + 1);
      if (node.loading) {
        treeRows.push({
          id: `file-loading:${path || "root"}`,
          kind: "StatusDot",
          label: t("projectTools.loading"),
          status: "running",
          padding: 8 + (depth + 1) * 14,
        });
      } else if (node.error) {
        treeRows.push({
          id: `file-error:${path || "root"}`,
          kind: "Banner",
          label: node.error,
          status: "error",
        });
      }
    }
  };
  appendTree(ROOT_PATH, 0);
  const resultRows: PresentationNode[] = search.results.map((entry) => ({
    id: `file-search:${entry.kind}:${entry.path}`,
    kind: "TreeRow",
    label: entry.path,
    icon: entry.kind === "dir" ? "folder" : "doc",
    action: bind(
      `file-search:${entry.kind}:${entry.path}`,
      () => {
        selectPath(entry.path);
        if (entry.kind === "file") openFile(entry.path);
        else {
          emitExpanded(addExpandedPaths(expandedPaths, expandedPathsForFileTreePath(entry.path)));
          void loadChildren(entry.path);
        }
      },
      (value) => value === null,
    ),
  }));
  const actionPlaceholder =
    pendingAction === "file"
      ? t("projectTools.fileTree.newFilePlaceholder")
      : pendingAction === "folder"
        ? t("projectTools.fileTree.newFolderPlaceholder")
        : t("projectTools.fileTree.renamePlaceholder");

  const nodesForDocument: PresentationNode[] = [
    {
      id: "files-layout",
      kind: "BrowserLayout",
      fill: true,
      children: [
        {
          id: "files-header",
          kind: "HStack",
          padding: 12,
          children: [
            { id: "files-title", kind: "Heading", text: t("sidebar.myFiles") },
            { id: "files-space", kind: "Spacer" },
            button(
              "files-refresh",
              t("projectTools.fileTree.refresh"),
              "arrow.clockwise",
              refreshVisible,
              projectReady,
            ),
            button("files-close", t("chat.cancel"), "xmark", props.onClose),
          ],
        },
        {
          id: "files-location",
          kind: "Text",
          text: props.cwd || t("projectTools.fileTreeDescription"),
          secondary: true,
          padding: 12,
        },
        {
          id: "files-search-row",
          kind: "HStack",
          padding: 8,
          children: [
            {
              id: "files-search",
              kind: "TextInput",
              label: t("projectTools.fileTree.searchPlaceholder"),
              value: query,
              fill: true,
              action: bind(
                "files-search",
                (value) => setQuery(value as string),
                (value) => typeof value === "string",
              ),
            },
            {
              id: "files-hidden",
              kind: "Switch",
              label: t("projectTools.fileTree.showHiddenFiles"),
              value: props.fileTreeState.showHidden,
              action: bind(
                "files-hidden",
                (value) => props.onFileTreeStateChange({ showHidden: value as boolean }),
                (value) => typeof value === "boolean",
              ),
            },
          ],
        },
        {
          id: "files-actions",
          kind: "HStack",
          padding: 8,
          children: [
            button(
              "files-new-file",
              t("projectTools.fileTree.newFile"),
              "doc.badge.plus",
              () => startAction("file"),
              projectReady && !busyAction,
            ),
            button(
              "files-new-folder",
              t("projectTools.fileTree.newFolder"),
              "folder.badge.plus",
              () => startAction("folder"),
              projectReady && !busyAction,
            ),
            button(
              "files-rename",
              t("projectTools.fileTree.rename"),
              "pencil",
              () => startAction("rename"),
              !!selectedPath && !busyAction,
            ),
            button(
              "files-delete",
              t("projectTools.fileTree.delete"),
              "trash",
              () => setDeleteTarget(selectedPath),
              !!selectedPath && !busyAction,
              true,
            ),
          ],
        },
        ...(pendingAction
          ? [
              {
                id: "files-pending-action",
                kind: "HStack" as const,
                padding: 8,
                children: [
                  {
                    id: "files-name",
                    kind: "TextInput" as const,
                    label: actionPlaceholder,
                    value: draftName,
                    fill: true,
                    action: bind(
                      "files-name",
                      (value) => setDraftName(value as string),
                      (value) => typeof value === "string",
                    ),
                  },
                  button(
                    "files-save-action",
                    t("settings.save"),
                    "checkmark",
                    finishAction,
                    !busyAction,
                  ),
                  button("files-cancel-action", t("settings.cancel"), "xmark", () => {
                    setPendingAction(null);
                    setPendingTargetPath(null);
                    setActionError(null);
                  }),
                ],
              },
            ]
          : []),
        ...(deleteTarget
          ? [
              {
                id: "files-delete-confirmation",
                kind: "Banner" as const,
                label: t("projectTools.fileTree.deleteConfirm").replace("{path}", deleteTarget),
                text: t("projectTools.fileTree.deleteConfirmDescription"),
                status: "error" as const,
                children: [
                  button(
                    "files-confirm-delete",
                    t("projectTools.fileTree.delete"),
                    "trash",
                    confirmDelete,
                    !busyAction,
                    true,
                  ),
                  button("files-cancel-delete", t("settings.cancel"), "xmark", () =>
                    setDeleteTarget(null),
                  ),
                ],
              },
            ]
          : []),
        ...(actionError
          ? [
              {
                id: "files-action-error",
                kind: "Banner" as const,
                label: actionError,
                status: "error" as const,
              },
            ]
          : []),
        ...(query.trim()
          ? search.loading
            ? [
                {
                  id: "files-searching",
                  kind: "StatusDot" as const,
                  label: t("projectTools.fileTree.searching"),
                  status: "running" as const,
                },
              ]
            : search.error
              ? [
                  {
                    id: "files-search-error",
                    kind: "Banner" as const,
                    label: search.error,
                    status: "error" as const,
                  },
                ]
              : resultRows.length
                ? [
                    {
                      id: "files-search-results",
                      kind: "ScrollView" as const,
                      fill: true,
                      children: resultRows,
                    },
                  ]
                : [
                    {
                      id: "files-no-results",
                      kind: "EmptyState" as const,
                      icon: "magnifyingglass",
                      label: t("projectTools.fileTree.noMatches"),
                    },
                  ]
          : projectReady
            ? [{ id: "files-tree", kind: "ScrollView" as const, fill: true, children: treeRows }]
            : [
                {
                  id: "files-unavailable",
                  kind: "EmptyState" as const,
                  icon: "folder",
                  label: t("projectTools.newFileTree"),
                  text: t("projectTools.fileTreeDescription"),
                },
              ]),
        ...(search.truncated && query.trim()
          ? [
              {
                id: "files-results-truncated",
                kind: "Text" as const,
                text: t("projectTools.fileTree.resultsTruncated"),
                secondary: true,
                padding: 8,
              },
            ]
          : []),
        ...(selectedPath
          ? [
              {
                id: "files-selection-actions",
                kind: "HStack" as const,
                padding: 8,
                children: [
                  ...(selectedNode?.kind === "file"
                    ? [
                        button(
                          "files-open",
                          t("projectTools.fileTree.openFile"),
                          "doc.text.magnifyingglass",
                          () => openFile(selectedPath),
                        ),
                      ]
                    : []),
                  ...(props.onInsertFileMention
                    ? [
                        button(
                          "files-mention",
                          t("projectTools.fileTree.insertReference"),
                          "at",
                          () =>
                            props.onInsertFileMention?.(selectedPath, selectedNode?.kind ?? "file"),
                        ),
                      ]
                    : []),
                ],
              },
            ]
          : []),
      ],
    },
  ];

  return (
    <NativeSurface
      document={{
        mode: "root",
        title: t("sidebar.myFiles"),
        appearance: props.settings.theme,
        formFactor: isNativeMobileRuntime() ? "mobile" : "desktop",
        theme: createNativePresentationTheme(
          props.settings,
          isNativeMobileRuntime(),
          "workspaceTools",
        ),
        nodes: nodesForDocument,
        dismissAction: "files-close",
      }}
      handlers={handlers}
      onError={(error) => setActionError(error instanceof Error ? error.message : String(error))}
    />
  );
}
