// Workspace navigation file tree: Astryx TreeList over the useFileTreeData
// layer, reading its wiring from the workspace-tools context.
//
// Shared by every frontend runtime; only relative, npm-package, or
// @xgent/runtime imports are allowed here.

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Code } from "@astryxdesign/core/Code";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Section } from "@astryxdesign/core/Section";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TreeList, type TreeListItemData } from "@astryxdesign/core/TreeList";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocale } from "../../../i18n";
import {
  finishWorkspacePathDrag,
  writeWorkspacePathDragPayload,
} from "../../../lib/chat/workspacePathDrag";
import type { WorkspaceFileTreeStatePatch } from "../../../lib/settings";
import { useConfirmDialog } from "../../astryx/useConfirmDialog";
import { getFileTypeIcon } from "../../chat/fileTypeIcons";
import { Check, FolderOpen, RefreshCw, Trash2, X } from "../../icons";
import { isWorkspaceImagePath } from "../../workspace-editor/workspaceImagePreview";
import { useWorkspaceToolsContext } from "../WorkspaceToolsContext";
import { FileTreeContextMenu } from "./ContextMenu";
import {
  addExpandedPaths,
  ancestorDirsOfPath,
  basename,
  dirname,
  type FileTreeKind,
  ROOT_PATH,
  remapExpandedPathsForRename,
  removeExpandedPath,
  removeExpandedSubtree,
} from "./model";
import { useFileTreeActionScope } from "./useFileTreeActionScope";
import { useFileTreeData } from "./useFileTreeData";

const FILE_TREE_QUERY_SYNC_DEBOUNCE_MS = 180;

type PendingAction = "file" | "folder" | "rename" | null;

type ContextMenuState = {
  path: string;
};

export function FileTreePanel(props: {
  active: boolean;
  touchActions?: boolean;
  onImportFiles?: (directory: string) => void;
  importBusy?: boolean;
  importRevision?: number;
}) {
  const {
    active,
    touchActions = false,
    onImportFiles,
    importBusy = false,
    importRevision = 0,
  } = props;
  const context = useWorkspaceToolsContext();
  const { projectPathKey, cwd, fileTree } = context;
  const syncState = fileTree.state;
  const initialized = fileTree.initialized;
  const { t } = useLocale();

  const [query, setQuery] = useState(syncState.query);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [pendingTargetPath, setPendingTargetPath] = useState<string | null>(null);
  const [pendingDirectory, setPendingDirectory] = useState(ROOT_PATH);
  const [draftName, setDraftName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const {
    busy: busyAction,
    revision: actionRevision,
    isActive,
    begin: beginAction,
    isCurrent: isCurrentAction,
    finish: finishScopedAction,
  } = useFileTreeActionScope(projectPathKey, cwd, active && initialized);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [revealTarget, setRevealTarget] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const {
    confirm: requestConfirmDialog,
    cancel: cancelConfirmDialog,
    dialog: confirmDialog,
  } = useConfirmDialog();

  const {
    nodes,
    loadChildren,
    refreshVisible,
    ensureDirsLoaded,
    createEntry,
    renameEntry,
    deleteEntry,
    openWorkspacePath,
    search,
  } = useFileTreeData({
    projectPathKey,
    cwd,
    active,
    initialized,
    workspaceActivityClient: context.clients.workspaceActivity ?? null,
    expandedPaths: syncState.expandedPaths,
    query,
    showHidden: syncState.showHidden,
  });

  const nodesRef = useRef(nodes);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const onStateChangeRef = useRef(fileTree.onStateChange);
  useEffect(() => {
    onStateChangeRef.current = fileTree.onStateChange;
  }, [fileTree.onStateChange]);
  const emitState = useCallback((patch: WorkspaceFileTreeStatePatch) => {
    onStateChangeRef.current(patch);
  }, []);

  // Expansion state has one source of truth: the persisted settings state.
  // `expandedRef` is updated both when a patch is emitted and when the
  // persisted state round-trips, so local toggles and sync operate on the
  // same value even mid-async-flow (no stale-closure overwrites).
  const expandedPaths = syncState.expandedPaths;
  const expandedSet = useMemo(() => new Set(expandedPaths), [expandedPaths]);
  const expandedRef = useRef(expandedPaths);
  useEffect(() => {
    expandedRef.current = expandedPaths;
  }, [expandedPaths]);

  const setExpanded = useCallback(
    (next: string[]) => {
      if (next === expandedRef.current) return;
      expandedRef.current = next;
      emitState({ expandedPaths: next });
    },
    [emitState],
  );

  const selectedNode = nodes[syncState.selectedPath] ?? nodes[ROOT_PATH];
  const selectedPath = selectedNode?.path ?? ROOT_PATH;
  const canMutate = initialized && Boolean(projectPathKey && cwd);
  const lastImportRevisionRef = useRef(importRevision);
  useEffect(() => {
    if (lastImportRevisionRef.current === importRevision) return;
    lastImportRevisionRef.current = importRevision;
    refreshVisible();
  }, [importRevision, refreshVisible]);

  const selectPath = useCallback(
    (path: string) => {
      emitState({ selectedPath: path });
    },
    [emitState],
  );

  const toggleDirectory = useCallback(
    (path: string) => {
      if (expandedRef.current.includes(path)) {
        setExpanded(removeExpandedPath(expandedRef.current, path));
      } else {
        setExpanded(addExpandedPaths(expandedRef.current, [path]));
        void loadChildren(path);
      }
    },
    [loadChildren, setExpanded],
  );

  // Local query <-> persisted query (both directions, debounced outbound).
  useEffect(() => {
    setQuery((current) => (current === syncState.query ? current : syncState.query));
  }, [syncState.query]);
  useEffect(() => {
    if (!initialized || !projectPathKey || query === syncState.query) return;
    const timer = window.setTimeout(() => {
      emitState({ query });
    }, FILE_TREE_QUERY_SYNC_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [emitState, initialized, projectPathKey, query, syncState.query]);

  // Transient UI state never leaks across project switches.
  useEffect(() => {
    cancelConfirmDialog();
    setContextMenu(null);
    setPendingAction(null);
    setPendingTargetPath(null);
    setDraftName("");
    setActionError(null);
    setRevealTarget(null);
  }, [actionRevision, cancelConfirmDialog]);

  // Reveal: expand + load the ancestor chain, then scroll the row into view.
  // The expansion merge reads `expandedRef` *after* the awaits so manual
  // expands that happened while loading are preserved (the old panel captured
  // a pre-await snapshot and overwrote them).
  const revealPath = useCallback(
    async (path: string, kind: FileTreeKind) => {
      const dirs =
        kind === "dir" && path ? [...ancestorDirsOfPath(path), path] : ancestorDirsOfPath(path);
      await ensureDirsLoaded(dirs);
      if (!isActive()) return;
      setExpanded(addExpandedPaths(expandedRef.current, dirs));
      selectPath(path);
      setRevealTarget(path);
    },
    [ensureDirsLoaded, isActive, selectPath, setExpanded],
  );

  // External reveal requests arrive as a bump of the persisted revision
  // nonce (state.revision) with selectedPath/expandedPaths already patched
  // by WorkspaceToolsPanel.revealPathInFileTree.
  const lastRevisionRef = useRef(syncState.revision);
  useEffect(() => {
    const previous = lastRevisionRef.current;
    lastRevisionRef.current = syncState.revision;
    if (!initialized || !projectPathKey || previous === syncState.revision) return;
    const target = syncState.selectedPath;
    const kind = nodesRef.current[target]?.kind ?? "file";
    void revealPath(target, kind);
  }, [initialized, projectPathKey, revealPath, syncState.revision, syncState.selectedPath]);

  useEffect(() => {
    if (!revealTarget) return;
    const frame = window.requestAnimationFrame(() => {
      const item = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>("[data-tree-id]") ?? [],
      ).find((element) => element.dataset.treeId === revealTarget);
      if (!item) return;
      item.scrollIntoView({ block: "center", inline: "nearest" });
      setRevealTarget(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expandedPaths, nodes, revealTarget]);

  const getSiblingImagePaths = useCallback((targetPath: string) => {
    if (!isWorkspaceImagePath(targetPath)) return [];
    const currentNodes = nodesRef.current;
    const parentNode = currentNodes[dirname(targetPath)];
    const siblingPaths =
      parentNode?.children.filter((childPath) => {
        const child = currentNodes[childPath];
        return child?.kind === "file" && isWorkspaceImagePath(childPath);
      }) ?? [];
    return siblingPaths.includes(targetPath) ? siblingPaths : [targetPath];
  }, []);

  const onOpenFileRef = useRef(fileTree.onOpenFile);
  useEffect(() => {
    onOpenFileRef.current = fileTree.onOpenFile;
  }, [fileTree.onOpenFile]);
  const handleOpenFile = useCallback(
    (path: string) => {
      onOpenFileRef.current?.(path, getSiblingImagePaths(path));
    },
    [getSiblingImagePaths],
  );

  const onInsertFileMentionRef = useRef(fileTree.onInsertFileMention);
  useEffect(() => {
    onInsertFileMentionRef.current = fileTree.onInsertFileMention;
  }, [fileTree.onInsertFileMention]);
  const handleInsertMention = useCallback((path: string) => {
    const node = nodesRef.current[path];
    if (!path || !node) return;
    onInsertFileMentionRef.current?.(path, node.kind);
  }, []);

  const openContextMenu = useCallback(
    (event: ReactMouseEvent, path: string) => {
      event.preventDefault();
      const targetPath = nodesRef.current[path] ? path : ROOT_PATH;
      selectPath(targetPath);
      setContextMenu({
        path: targetPath,
      });
    },
    [selectPath],
  );

  const openContextMenuFromTree = useCallback(
    (event: ReactMouseEvent) => {
      let item = (event.target as HTMLElement).closest<HTMLElement>("[data-tree-id]");
      let path = item?.dataset.treeId;
      while (item && (path === undefined || nodesRef.current[path] === undefined)) {
        item = item.parentElement?.closest<HTMLElement>("[data-tree-id]") ?? null;
        path = item?.dataset.treeId;
      }
      openContextMenu(event, path ?? selectedPath ?? ROOT_PATH);
    },
    [openContextMenu, selectedPath],
  );

  const syncTreeChevronToggle = useCallback(
    (event: ReactMouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest("[data-tree-toggle]")) return;
      const item = target.closest<HTMLElement>("[data-tree-id]");
      const path = item?.dataset.treeId;
      if (path === undefined || nodesRef.current[path]?.kind !== "dir") return;
      // TreeList keeps a private expansion override after its toggle runs.
      // Prevent that second owner: row clicks, reveal and persisted expansion
      // must all render the same shared state through item.isExpanded.
      event.stopPropagation();
      toggleDirectory(path);
    },
    [toggleDirectory],
  );

  const syncTreeKeyboardToggle = useCallback(
    (event: ReactKeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const item = (event.target as HTMLElement).closest<HTMLElement>("[data-tree-id]");
      if (!item) return;
      const path = item?.dataset.treeId;
      if (path === undefined || nodesRef.current[path]?.kind !== "dir") return;
      const expanded = item.getAttribute("aria-expanded");
      // Own expansion, while leaving focus-only arrows to TreeList. Allowing
      // its private toggle here would override later row/reveal updates.
      if (
        (event.key === "ArrowLeft" && expanded === "true") ||
        (event.key === "ArrowRight" && expanded === "false")
      ) {
        event.preventDefault();
        event.stopPropagation();
        const next =
          event.key === "ArrowRight"
            ? addExpandedPaths(expandedRef.current, [path])
            : removeExpandedPath(expandedRef.current, path);
        setExpanded(next);
        if (event.key === "ArrowRight") void loadChildren(path);
      }
    },
    [loadChildren, setExpanded],
  );

  const startAction = useCallback(
    (action: Exclude<PendingAction, null>, targetPath: string) => {
      if (!isActive() || busyAction) return;
      const currentNodes = nodesRef.current;
      const targetNode = currentNodes[targetPath] ?? currentNodes[ROOT_PATH];
      const normalizedTargetPath = targetNode?.path ?? ROOT_PATH;
      if (action === "rename" && !normalizedTargetPath) return;
      selectPath(normalizedTargetPath);
      setPendingTargetPath(normalizedTargetPath);
      setPendingDirectory(
        targetNode?.kind === "dir" ? normalizedTargetPath : dirname(normalizedTargetPath),
      );
      setPendingAction(action);
      setActionError(null);
      setDraftName(action === "rename" ? basename(normalizedTargetPath) : "");
    },
    [busyAction, isActive, selectPath],
  );

  const finishAction = useCallback(async () => {
    if (!pendingAction || busyAction || !isActive()) return;
    const name = draftName.trim();
    if (!name) {
      setActionError(t("projectTools.fileTree.nameRequired"));
      return;
    }
    const owner = beginAction();
    if (!owner) return;
    setActionError(null);
    try {
      const targetPath = pendingTargetPath ?? selectedPath;
      const targetDir = pendingDirectory;
      if (pendingAction === "file") {
        const nextPath = await createEntry("file", targetDir, name);
        if (!isCurrentAction(owner)) return;
        setExpanded(addExpandedPaths(expandedRef.current, [targetDir]));
        selectPath(nextPath);
      } else if (pendingAction === "folder") {
        const nextPath = await createEntry("dir", targetDir, name);
        if (!isCurrentAction(owner)) return;
        setExpanded(addExpandedPaths(expandedRef.current, [targetDir, nextPath]));
        selectPath(nextPath);
      } else if (pendingAction === "rename" && targetPath) {
        const nextPath = await renameEntry(targetPath, name);
        if (!isCurrentAction(owner)) return;
        setExpanded(remapExpandedPathsForRename(expandedRef.current, targetPath, nextPath));
        selectPath(nextPath);
      }
      setPendingAction(null);
      setPendingTargetPath(null);
      setDraftName("");
    } catch (error) {
      if (isCurrentAction(owner))
        setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      finishScopedAction(owner);
    }
  }, [
    busyAction,
    beginAction,
    createEntry,
    draftName,
    pendingAction,
    pendingDirectory,
    pendingTargetPath,
    renameEntry,
    selectPath,
    selectedPath,
    setExpanded,
    isActive,
    isCurrentAction,
    finishScopedAction,
    t,
  ]);

  const deletePath = useCallback(
    async (targetPath: string) => {
      if (!targetPath || busyAction) return;
      const owner = beginAction();
      if (!owner) return;
      try {
        const confirmed = await requestConfirmDialog({
          title: t("projectTools.fileTree.deleteConfirm").replace("{path}", targetPath),
          subtitle: t("projectTools.fileTree.deleteConfirmDescription"),
          description: (
            <VStack gap={2}>
              <HStack gap={2} vAlign="center">
                <Trash2 />
                <Text type="label">{basename(targetPath)}</Text>
              </HStack>
              <Code>{targetPath}</Code>
            </VStack>
          ),
          confirmLabel: t("projectTools.fileTree.delete"),
          cancelLabel: t("settings.cancel"),
          closeLabel: t("projectTools.fileTree.deleteConfirmClose"),
          tone: "destructive",
        });
        if (!confirmed || !isCurrentAction(owner)) return;
        setActionError(null);
        await deleteEntry(targetPath);
        if (!isCurrentAction(owner)) return;
        setExpanded(removeExpandedSubtree(expandedRef.current, targetPath));
        selectPath(dirname(targetPath));
      } catch (error) {
        if (isCurrentAction(owner))
          setActionError(error instanceof Error ? error.message : String(error));
      } finally {
        finishScopedAction(owner);
      }
    },
    [
      busyAction,
      beginAction,
      deleteEntry,
      requestConfirmDialog,
      selectPath,
      setExpanded,
      isCurrentAction,
      finishScopedAction,
      t,
    ],
  );

  const handleOpenExternal = useCallback(
    (path: string) => {
      setActionError(null);
      void openWorkspacePath(path, "choose").catch((error: unknown) => {
        if (isActive()) setActionError(error instanceof Error ? error.message : String(error));
      });
    },
    [isActive, openWorkspacePath],
  );

  const handleOpenContainingDirectory = useCallback(
    (path: string) => {
      setActionError(null);
      void openWorkspacePath(path, "reveal").catch((error: unknown) => {
        if (isActive()) setActionError(error instanceof Error ? error.message : String(error));
      });
    },
    [isActive, openWorkspacePath],
  );

  const handleMenuRefresh = useCallback(
    (path: string, kind: FileTreeKind) => {
      void loadChildren(kind === "dir" ? path : dirname(path), { force: true });
    },
    [loadChildren],
  );

  const actionPlaceholder = useMemo(() => {
    if (pendingAction === "file") return t("projectTools.fileTree.newFilePlaceholder");
    if (pendingAction === "folder") return t("projectTools.fileTree.newFolderPlaceholder");
    if (pendingAction === "rename") return t("projectTools.fileTree.renamePlaceholder");
    return "";
  }, [pendingAction, t]);

  const treeItems = useMemo<TreeListItemData[]>(() => {
    const visited = new Set<string>();

    const buildItem = (path: string): TreeListItemData | null => {
      const node = nodes[path];
      if (!node || visited.has(path)) return null;
      visited.add(path);
      const TypeIcon = getFileTypeIcon(node.path, node.kind, {
        expanded: expandedSet.has(node.path),
      });
      const loadedChildren = node.children
        .map(buildItem)
        .filter((item): item is TreeListItemData => item !== null);
      let children: TreeListItemData[] | undefined;
      if (node.kind === "dir") {
        if (loadedChildren.length > 0) {
          children = loadedChildren;
        } else if (!node.loaded || node.loading || node.error) {
          children = [
            {
              id: `${node.path}\u0000state`,
              label: node.error ?? t("projectTools.loading"),
              startContent: node.loading ? (
                <Spinner size="sm" label={t("projectTools.loading")} />
              ) : undefined,
              isDisabled: true,
            },
          ];
        }
      }

      return {
        id: node.path,
        label: (
          // biome-ignore lint/a11y/noStaticElementInteractions: The enclosing tree control owns keyboard interaction; its context menu offers the same insert-reference action.
          <span
            draggable={!touchActions && node.path !== ROOT_PATH}
            onDragStart={(event) => {
              if (
                touchActions ||
                !writeWorkspacePathDragPayload(event.dataTransfer, {
                  projectPathKey,
                  cwd,
                  relativePath: node.path,
                  entryKind: node.kind,
                  label: node.name,
                })
              )
                event.preventDefault();
            }}
            onDragEnd={finishWorkspacePathDrag}
          >
            {node.name}
          </span>
        ),
        description: node.error,
        startContent: <TypeIcon />,
        endContent: node.loading ? (
          <Spinner size="sm" label={t("projectTools.loading")} />
        ) : undefined,
        children,
        isExpanded: expandedSet.has(node.path),
        isSelected: selectedPath === node.path,
        onClick: () => {
          selectPath(node.path);
          if (node.kind === "dir") {
            toggleDirectory(node.path);
            return;
          }
          handleOpenFile(node.path);
        },
      };
    };

    const root = buildItem(ROOT_PATH);
    return root ? [root] : [];
  }, [
    cwd,
    expandedSet,
    handleOpenFile,
    nodes,
    projectPathKey,
    selectPath,
    selectedPath,
    t,
    toggleDirectory,
    touchActions,
  ]);

  if (!initialized) {
    return (
      <VStack height="100%" hAlign="center" vAlign="center">
        <EmptyState
          isCompact
          icon={<FolderOpen />}
          title={t("projectTools.newFileTree")}
          description={t("projectTools.fileTreeDescription")}
          actions={
            <Button
              label={t("projectTools.newFileTree")}
              variant="primary"
              size="sm"
              onClick={() => {
                fileTree.onInitializedChange(true);
                void loadChildren(ROOT_PATH, { force: true });
              }}
            />
          }
        />
      </VStack>
    );
  }

  const contextNode =
    nodes[contextMenu?.path ?? selectedPath] ?? nodes[selectedPath] ?? nodes[ROOT_PATH];

  return (
    <VStack ref={panelRef} height="100%" gap={0} className="workspace-file-tree-panel">
      <Section variant="transparent" padding={2} dividers={["bottom"]}>
        <HStack gap={2} vAlign="center">
          <StackItem size="fill">
            <TextInput
              label={t("projectTools.fileTree.searchPlaceholder")}
              isLabelHidden
              value={query}
              onChange={setQuery}
              placeholder={t("projectTools.fileTree.searchPlaceholder")}
              startIcon="search"
              hasClear
              size="sm"
              width="100%"
            />
          </StackItem>
          <IconButton
            label={t("projectTools.fileTree.refresh")}
            tooltip={t("projectTools.fileTree.refresh")}
            icon={<RefreshCw />}
            variant="ghost"
            size="sm"
            onClick={() => refreshVisible()}
          />
        </HStack>
      </Section>

      {touchActions ? (
        <Section variant="transparent" padding={1.5} dividers={["bottom"]}>
          <Grid
            columns={{ minWidth: 128, max: 4 }}
            gap={1}
            width="100%"
            className="workspace-file-tree-actions"
          >
            <Button
              label={t("projectTools.fileTree.newFile")}
              variant="ghost"
              size="sm"
              width="100%"
              isDisabled={!canMutate || busyAction}
              onClick={() => startAction("file", selectedPath)}
            />
            <Button
              label={t("projectTools.fileTree.newFolder")}
              variant="ghost"
              size="sm"
              width="100%"
              isDisabled={!canMutate || busyAction}
              onClick={() => startAction("folder", selectedPath)}
            />
            <Button
              label={t("projectTools.fileTree.rename")}
              variant="ghost"
              size="sm"
              width="100%"
              isDisabled={!canMutate || !selectedPath || busyAction}
              onClick={() => startAction("rename", selectedPath)}
            />
            <Button
              label={t("projectTools.fileTree.delete")}
              variant="destructive"
              size="sm"
              width="100%"
              isDisabled={!canMutate || !selectedPath || busyAction}
              onClick={() => void deletePath(selectedPath)}
            />
          </Grid>
          {onImportFiles ? (
            <Button
              label={t("projectTools.fileTree.importFile")}
              variant="ghost"
              size="sm"
              width="100%"
              isDisabled={!canMutate || busyAction || importBusy}
              onClick={() =>
                onImportFiles(selectedNode?.kind === "dir" ? selectedPath : dirname(selectedPath))
              }
            />
          ) : null}
        </Section>
      ) : null}

      {pendingAction ? (
        <Section variant="muted" padding={2} dividers={["bottom"]}>
          <HStack gap={2} vAlign="center">
            <StackItem size="fill">
              <TextInput
                label={actionPlaceholder}
                isLabelHidden
                hasAutoFocus
                isDisabled={busyAction}
                value={draftName}
                onChange={setDraftName}
                onEnter={() => void finishAction()}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    if (busyAction) return;
                    event.preventDefault();
                    setPendingAction(null);
                    setPendingTargetPath(null);
                    setActionError(null);
                  }
                }}
                placeholder={actionPlaceholder}
                size="sm"
                width="100%"
              />
            </StackItem>
            <IconButton
              label={t("settings.save")}
              variant="ghost"
              size="sm"
              icon={<Check />}
              isLoading={busyAction}
              isDisabled={busyAction}
              onClick={() => void finishAction()}
            />
            <IconButton
              label={t("settings.cancel")}
              variant="ghost"
              size="sm"
              icon={<X />}
              isDisabled={busyAction}
              onClick={() => {
                setPendingAction(null);
                setPendingTargetPath(null);
              }}
            />
          </HStack>
        </Section>
      ) : null}

      {actionError ? (
        <Section variant="transparent" padding={2} dividers={["bottom"]}>
          <Banner status="error" title={actionError} />
        </Section>
      ) : null}

      {query.trim() ? (
        <Section
          variant="transparent"
          padding={2}
          dividers={["bottom"]}
          style={{ maxHeight: "var(--xgent-file-tree-search-results-height)", overflowY: "auto" }}
        >
          {search.loading ? (
            <HStack gap={2} vAlign="center">
              <Spinner size="sm" label={t("projectTools.fileTree.searching")} />
              <Text type="supporting" color="secondary">
                {t("projectTools.fileTree.searching")}
              </Text>
            </HStack>
          ) : search.error ? (
            <Banner status="error" title={search.error} />
          ) : search.results.length === 0 ? (
            <EmptyState
              isCompact
              title={t("projectTools.fileTree.noMatches")}
              actions={
                <Button
                  label={t("projectTools.fileTree.searchPlaceholder")}
                  variant="ghost"
                  size="sm"
                  onClick={() => setQuery("")}
                />
              }
            />
          ) : (
            <List density="compact" hasDividers={false}>
              {search.results.map((entry) => {
                const TypeIcon = getFileTypeIcon(entry.path, entry.kind);
                return (
                  <ListItem
                    key={`${entry.kind}:${entry.path}`}
                    label={entry.path}
                    startContent={<TypeIcon />}
                    onClick={() => {
                      if (touchActions && entry.kind === "file") {
                        handleOpenFile(entry.path);
                        return;
                      }
                      void revealPath(entry.path, entry.kind);
                    }}
                  />
                );
              })}
            </List>
          )}
          {search.truncated ? (
            <Text type="supporting" color="secondary" display="block">
              {t("projectTools.fileTree.resultsTruncated")}
            </Text>
          ) : null}
        </Section>
      ) : null}

      <StackItem size="fill" isScrollable>
        <FileTreeContextMenu
          path={contextNode?.path ?? ROOT_PATH}
          kind={contextNode?.kind ?? "dir"}
          canMutate={canMutate && !busyAction}
          canOpenFile={Boolean(fileTree.onOpenFile)}
          canInsertMention={Boolean(fileTree.onInsertFileMention)}
          showHidden={syncState.showHidden}
          onClose={() => setContextMenu(null)}
          onOpenFile={handleOpenFile}
          onOpenExternal={handleOpenExternal}
          onOpenContainingDirectory={handleOpenContainingDirectory}
          onStartAction={startAction}
          onDelete={(path) => void deletePath(path)}
          onInsertMention={handleInsertMention}
          onRefresh={handleMenuRefresh}
          onToggleHidden={() => emitState({ showHidden: !syncState.showHidden })}
          onActionError={setActionError}
        >
          <Section
            variant="transparent"
            padding={2}
            minHeight="100%"
            onContextMenu={openContextMenuFromTree}
            onClickCapture={syncTreeChevronToggle}
            onKeyDownCapture={syncTreeKeyboardToggle}
          >
            <TreeList
              key={`${projectPathKey}:${syncState.revision}`}
              items={treeItems}
              density={touchActions ? "balanced" : "compact"}
              variant="lineGuides"
            />
          </Section>
        </FileTreeContextMenu>
      </StackItem>

      {confirmDialog}
    </VStack>
  );
}
