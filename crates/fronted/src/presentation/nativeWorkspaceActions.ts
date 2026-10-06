import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_WORKSPACE_PROJECT_ID,
  type WorkspaceProject,
  type WorkspaceProjectGroup,
  workspaceProjectPathKey,
} from "../lib/settings";
import { presentationControls } from "./controls";
import type { PresentationNode } from "./types";

export type NativeWorkspaceActionsProps = {
  projects: WorkspaceProject[];
  workspaceProjectGroups?: WorkspaceProjectGroup[];
  archivedProjectPathKeys?: ReadonlySet<string>;
  runningProjectPathKeys?: ReadonlySet<string>;
  onCreateProject: () => void;
  onNavigate?: () => void;
  onCreateWorkspaceGroup?: (name: string) => void;
  onRenameWorkspaceGroup?: (id: string, name: string) => void;
  onDeleteWorkspaceGroup?: (id: string) => void;
  onMoveProjectToGroup?: (path: string, groupId: string | null) => void;
  onRenameProject?: (project: WorkspaceProject, name: string) => void;
  onSetProjectPinned?: (project: WorkspaceProject, pinned: boolean) => void;
  onArchiveProject?: (project: WorkspaceProject) => void;
  onUnarchiveProject?: (project: WorkspaceProject) => void;
  onRemoveProject?: (project: WorkspaceProject) => void;
  onOpenWorkspaceSettings?: (project: WorkspaceProject) => void;
  onNewConversationForProject?: (project: WorkspaceProject) => void;
  onBrowseProjectInFileTree?: (project: WorkspaceProject) => void;
  onBrowseProjectInSystemFileManager?: (project: WorkspaceProject) => void;
};

type Dialog = {
  generation: number;
  kind: "create-group" | "rename-group" | "rename-project" | "remove-project";
  id: string;
  name: string;
};

/** Menus and confirmations only; mutations stay in ChatPage's existing authoritative handlers. */
export function useNativeWorkspaceActions(
  props: NativeWorkspaceActionsProps,
  t: (key: string) => string,
) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const scope = useRef({
    props,
    active: true,
    dialog: null as Dialog | null,
    generation: 0,
  }).current;
  scope.props = props;
  useEffect(() => {
    scope.active = true;
    return () => {
      scope.active = false;
      scope.dialog = null;
    };
  }, [scope]);
  const c = presentationControls();
  const dc = presentationControls();
  const project = (id: string) =>
    scope.active ? scope.props.projects.find((item) => item.id === id) : undefined;
  const group = (id: string) =>
    scope.active ? scope.props.workspaceProjectGroups?.find((item) => item.id === id) : undefined;
  const open = (kind: Dialog["kind"], id = "", name = "") => {
    if (scope.active) {
      const next = { kind, id, name, generation: ++scope.generation };
      scope.dialog = next;
      setDialog(next);
    }
  };
  const menu = (id: string, label: string, children: PresentationNode[]): PresentationNode => ({
    id,
    kind: "Menu",
    label,
    icon: "ellipsis",
    variant: "compact",
    children,
  });
  const workspaceMenu = menu("workspace-actions", t("chat.workspaceGroupMore"), [
    c.action("workspace-create-project", t("chat.workspaceCreate"), () => {
      if (!scope.active) return;
      scope.props.onCreateProject();
      scope.props.onNavigate?.();
    }),
  ]);
  const createGroup: PresentationNode | undefined = props.onCreateWorkspaceGroup
    ? {
        ...c.action("workspace-create-group", t("chat.workspaceGroupCreate"), () =>
          open("create-group"),
        ),
        kind: "IconButton",
        icon: "folder.badge.plus",
        variant: "ghost",
      }
    : undefined;

  function projectMenu(item: WorkspaceProject) {
    const prefix = `project-actions:${item.id}`;
    const pathKey = workspaceProjectPathKey(item.path);
    const archived = props.archivedProjectPathKeys?.has(pathKey) ?? false;
    const isDefault = item.id === DEFAULT_WORKSPACE_PROJECT_ID;
    const children: PresentationNode[] = [];
    const action = (
      suffix: string,
      key: string,
      run: (item: WorkspaceProject, current: NativeWorkspaceActionsProps) => void,
      available = true,
    ) =>
      c.action(
        `${prefix}:${suffix}`,
        t(key),
        async () => {
          const current = project(item.id);
          if (current) {
            await run(current, scope.props);
            if (["new-chat", "settings"].includes(suffix)) scope.props.onNavigate?.();
          }
        },
        available,
      );
    if (props.onNewConversationForProject)
      children.push(
        action(
          "new-chat",
          "chat.workspaceNewConversation",
          (current, p) => p.onNewConversationForProject?.(current),
          !archived,
        ),
      );
    if (props.onOpenWorkspaceSettings)
      children.push(
        action("settings", "chat.workspaceSettings", (current, p) =>
          p.onOpenWorkspaceSettings?.(current),
        ),
      );
    if (props.onSetProjectPinned && !archived)
      children.push(
        action("pin", item.isPinned ? "chat.workspaceUnpin" : "chat.workspacePin", (current, p) =>
          p.onSetProjectPinned?.(current, !current.isPinned),
        ),
      );
    if (props.onRenameProject && !isDefault)
      children.push(
        action("rename", "chat.workspaceRename", (current) =>
          open("rename-project", current.id, current.name),
        ),
      );
    if (props.onMoveProjectToGroup && props.workspaceProjectGroups?.length)
      children.push(
        menu(`${prefix}:move`, t("chat.workspaceMoveToGroup"), [
          action("ungrouped", "chat.workspaceUngrouped", (current, p) =>
            p.onMoveProjectToGroup?.(current.path, null),
          ),
          ...props.workspaceProjectGroups.map((target) =>
            c.action(`${prefix}:group:${target.id}`, target.name, () => {
              const current = project(item.id);
              if (current && group(target.id))
                scope.props.onMoveProjectToGroup?.(current.path, target.id);
            }),
          ),
        ]),
      );
    const activeCount = props.projects.filter(
      (p) => !props.archivedProjectPathKeys?.has(workspaceProjectPathKey(p.path)),
    ).length;
    if (archived && props.onUnarchiveProject)
      children.push(
        action("unarchive", "chat.workspaceUnarchive", (current, p) =>
          p.onUnarchiveProject?.(current),
        ),
      );
    else if (props.onArchiveProject && activeCount > 1)
      children.push(
        action("archive", "chat.workspaceArchive", (current, p) => p.onArchiveProject?.(current)),
      );
    if (props.onRemoveProject && !isDefault)
      children.push({
        ...action(
          "remove",
          "chat.workspaceRemove",
          (current) => open("remove-project", current.id, current.name),
          !props.runningProjectPathKeys?.has(pathKey),
        ),
        destructive: true,
      });
    return menu(prefix, `${t("chat.workspaceMore")}: ${item.name}`, children);
  }

  function groupMenu(item: WorkspaceProjectGroup) {
    return menu(`group-actions:${item.id}`, `${t("chat.workspaceGroupMore")}: ${item.name}`, [
      ...(props.onRenameWorkspaceGroup
        ? [
            c.action(`group-actions:${item.id}:rename`, t("chat.workspaceGroupRename"), () => {
              const current = group(item.id);
              if (current) open("rename-group", current.id, current.name);
            }),
          ]
        : []),
      ...(props.onDeleteWorkspaceGroup
        ? [
            {
              ...c.action(`group-actions:${item.id}:delete`, t("chat.workspaceGroupDelete"), () => {
                const current = group(item.id);
                if (current) scope.props.onDeleteWorkspaceGroup?.(current.id);
              }),
              destructive: true,
            },
          ]
        : []),
    ]);
  }

  const title = dialog
    ? t(
        {
          "create-group": "chat.workspaceGroupCreate",
          "rename-group": "chat.workspaceGroupRename",
          "rename-project": "chat.workspaceRename",
          "remove-project": "chat.workspaceRemove",
        }[dialog.kind],
      )
    : "";
  const target =
    !dialog || dialog.kind === "create-group"
      ? true
      : dialog.kind.endsWith("project")
        ? project(dialog.id)
        : group(dialog.id);
  const dialogNodes: PresentationNode[] = [];
  if (dialog && !target && scope.dialog?.generation === dialog.generation) scope.dialog = null;
  if (dialog && target) {
    const currentDialog = () =>
      scope.active && scope.dialog?.generation === dialog.generation ? scope.dialog : null;
    const close = () => {
      if (!currentDialog()) return;
      scope.dialog = null;
      setDialog(null);
    };
    const destructive = dialog.kind === "remove-project";
    const removing = dialog.kind === "remove-project";
    if (destructive)
      dialogNodes.push({
        id: "workspace-dialog-description",
        kind: "Text",
        text: removing
          ? `${t("chat.workspaceRemoveConfirm").replace("{name}", dialog.name)}\n${t("chat.workspaceRemoveDescription")}`
          : dialog.name,
      });
    else
      dialogNodes.push(
        dc.input(
          "workspace-dialog-name",
          t(dialog.kind === "rename-project" ? "chat.workspaceRename" : "chat.workspaceGroupName"),
          dialog.name,
          (name) => {
            const current = currentDialog();
            if (!current) return;
            const next = { ...current, name };
            scope.dialog = next;
            setDialog(next);
          },
        ),
      );
    dialogNodes.push({
      ...dc.action(
        "workspace-dialog-confirm",
        t(destructive ? "settings.delete" : "settings.save"),
        () => {
          const current = currentDialog();
          if (!current) return;
          const p = scope.props;
          const currentProject = project(current.id),
            currentGroup = group(current.id);
          const name = current.name.trim();
          if (!removing && !name) return;
          if (
            removing &&
            (!currentProject ||
              currentProject.id === DEFAULT_WORKSPACE_PROJECT_ID ||
              p.runningProjectPathKeys?.has(workspaceProjectPathKey(currentProject.path)))
          )
            return;
          close();
          if (current.kind === "create-group") p.onCreateWorkspaceGroup?.(name);
          if (current.kind === "rename-group" && currentGroup)
            p.onRenameWorkspaceGroup?.(currentGroup.id, name);
          if (
            current.kind === "rename-project" &&
            currentProject &&
            name &&
            currentProject.id !== DEFAULT_WORKSPACE_PROJECT_ID
          )
            p.onRenameProject?.(currentProject, name);
          if (
            removing &&
            currentProject &&
            currentProject.id !== DEFAULT_WORKSPACE_PROJECT_ID &&
            !p.runningProjectPathKeys?.has(workspaceProjectPathKey(currentProject.path))
          )
            p.onRemoveProject?.(currentProject);
        },
        (destructive || !!dialog.name.trim()) &&
          (!removing ||
            !props.runningProjectPathKeys?.has(
              workspaceProjectPathKey((target as WorkspaceProject).path),
            )),
      ),
      destructive,
    });
    dialogNodes.push(dc.action("workspace-dialog-cancel", t("settings.cancel"), close));
  }
  return {
    projectMenu,
    groupMenu,
    workspaceMenu,
    createGroup,
    handlers: c.handlers,
    dialog: dialog && target ? { title, nodes: dialogNodes, handlers: dc.handlers } : null,
  };
}
