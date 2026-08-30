// Native Astryx context menu for the workspace file tree.
//
// Shared by every frontend runtime; only relative, npm-package, or
// @xagent/runtime imports are allowed here.

import { ContextMenu, type ContextMenuOption } from "@astryxdesign/core/ContextMenu";
import { useToast } from "@astryxdesign/core/Toast";
import { type ReactNode, useCallback } from "react";
import { useLocale } from "../../../i18n";
import { writeClipboardText } from "../../../lib/system/clipboardText";
import {
  Copy,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  FilePenLine,
  Folder,
  FolderOpen,
  Plus,
  RefreshCw,
  Trash2,
} from "../../icons";
import {
  isWorkspaceEditablePreviewPath,
  isWorkspacePreviewPath,
} from "../../workspace-editor/workspaceImagePreview";
import { FILE_TREE_HAS_OS_INTEGRATION, type FileTreeKind } from "./model";

export type FileTreeContextMenuProps = {
  children: ReactNode;
  path: string;
  kind: FileTreeKind;
  canMutate: boolean;
  canOpenFile: boolean;
  canInsertMention: boolean;
  showHidden: boolean;
  onClose: () => void;
  onOpenFile: (path: string) => void;
  onOpenExternal: (path: string) => void;
  onOpenContainingDirectory: (path: string) => void;
  onStartAction: (action: "file" | "folder" | "rename", path: string) => void;
  onDelete: (path: string) => void;
  onInsertMention: (path: string) => void;
  onRefresh: (path: string, kind: FileTreeKind) => void;
  onToggleHidden: () => void;
  onActionError: (message: string) => void;
};

export function FileTreeContextMenu(props: FileTreeContextMenuProps) {
  const {
    children,
    path,
    kind,
    canMutate,
    canOpenFile,
    canInsertMention,
    showHidden,
    onClose,
    onOpenFile,
    onOpenExternal,
    onOpenContainingDirectory,
    onStartAction,
    onDelete,
    onInsertMention,
    onRefresh,
    onToggleHidden,
    onActionError,
  } = props;
  const { t } = useLocale();
  const showToast = useToast();
  const hasPathAction = Boolean(path);

  const handleCopy = useCallback(async () => {
    if (!path) return;
    const copied = await writeClipboardText(path);
    if (!copied) {
      onActionError(t("projectTools.fileTree.copyFailed"));
      return;
    }
    showToast({
      body: t("projectTools.fileTree.copiedPath"),
      type: "info",
      isAutoHide: true,
      uniqueID: "file-tree-copy-path",
      collisionBehavior: "overwrite",
    });
  }, [onActionError, path, showToast, t]);

  const items: ContextMenuOption[] = [
    ...(kind === "file"
      ? [
          {
            label: t(
              isWorkspacePreviewPath(path)
                ? "projectTools.fileTree.previewFile"
                : "projectTools.fileTree.openFile",
            ),
            icon: isWorkspacePreviewPath(path) ? <Eye /> : <FilePenLine />,
            isDisabled: !canOpenFile,
            onClick: () => onOpenFile(path),
          },
          ...(FILE_TREE_HAS_OS_INTEGRATION && !isWorkspaceEditablePreviewPath(path)
            ? [
                {
                  label: t("projectTools.fileTree.openExternal"),
                  icon: <ExternalLink />,
                  isDisabled: !hasPathAction,
                  onClick: () => onOpenExternal(path),
                },
              ]
            : []),
          { type: "divider" } as const,
        ]
      : []),
    {
      label: t("projectTools.fileTree.newFile"),
      icon: <Plus />,
      isDisabled: !canMutate,
      onClick: () => onStartAction("file", path),
    },
    {
      label: t("projectTools.fileTree.newFolder"),
      icon: <Folder />,
      isDisabled: !canMutate,
      onClick: () => onStartAction("folder", path),
    },
    {
      label: t("projectTools.fileTree.rename"),
      icon: <Edit3 />,
      isDisabled: !canMutate || !hasPathAction,
      onClick: () => onStartAction("rename", path),
    },
    {
      label: t("projectTools.fileTree.delete"),
      icon: <Trash2 />,
      variant: "destructive",
      isDisabled: !canMutate || !hasPathAction,
      onClick: () => onDelete(path),
    },
    { type: "divider" },
    {
      label: t(
        showHidden
          ? "projectTools.fileTree.hideHiddenFiles"
          : "projectTools.fileTree.showHiddenFiles",
      ),
      icon: showHidden ? <EyeOff /> : <Eye />,
      onClick: onToggleHidden,
    },
    {
      label: t("projectTools.fileTree.copyPath"),
      icon: <Copy />,
      isDisabled: !hasPathAction,
      onClick: () => {
        void handleCopy();
      },
    },
    ...(FILE_TREE_HAS_OS_INTEGRATION
      ? [
          {
            label: t("projectTools.fileTree.openContainingDirectory"),
            icon: <FolderOpen />,
            isDisabled: !hasPathAction,
            onClick: () => onOpenContainingDirectory(path),
          },
        ]
      : []),
    {
      label: t("projectTools.fileTree.insertReference"),
      icon: <FilePenLine />,
      isDisabled: !hasPathAction || !canInsertMention,
      onClick: () => onInsertMention(path),
    },
    { type: "divider" },
    {
      label: t("projectTools.fileTree.refresh"),
      icon: <RefreshCw />,
      onClick: () => onRefresh(path, kind),
    },
  ];

  return (
    <ContextMenu
      items={items}
      label={t("projectTools.fileTree.copyPath")}
      menuWidth="var(--xagent-file-tree-context-menu-width)"
      size="sm"
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      {children}
    </ContextMenu>
  );
}
