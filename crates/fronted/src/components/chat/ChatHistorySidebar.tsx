import { BottomSheet } from "@astryxdesign/core/BottomSheet";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type CSSProperties, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import iconSimpleUrl from "../../../src-tauri/icons/icon-simple.png";
import { useLocale } from "../../i18n";
import type { AppUpdateController } from "../../lib/appUpdates";
import {
  DEFAULT_WORKSPACE_PROJECT_ID,
  type WorkspaceProject,
  type WorkspaceProjectGroup,
  workspaceProjectPathKey,
} from "../../lib/settings";
import { cn } from "../../lib/shared/utils";
import type {
  SidebarConversation,
  SidebarListStatus,
  SidebarMutationKind,
} from "../../lib/sidebar/types";
import { useSoul } from "../../lib/soul";
import type { SoulDocument } from "../../lib/soul/model";
import { AppUpdateButton } from "../AppUpdateButton";
import {
  Archive,
  ArchiveRestore,
  Blend,
  Cable,
  Check,
  ChevronRight,
  CirclePlus,
  Cpu,
  Edit3,
  FolderClosed,
  FolderOpen,
  FolderTree,
  GitBranch,
  Key,
  Loader2,
  MoreHorizontal,
  PanelLeftClose,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Sparkles,
  Terminal,
  Trash2,
  X,
} from "../icons";
import { isMacOsTauri, MacOsTitleBarSpacer } from "../MacOsTitleBarSpacer";
import type { WorkspaceToolTarget } from "../project-tools/workspaceToolsModel";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { View as AstryxView, Inline as AstryxInline } from "@xagent/ui/components/ui/view";
import { Button as AstryxButton } from "@xagent/ui/components/ui/button";
import { Paragraph as AstryxParagraph } from "@xagent/ui/components/ui/view";

type ChatHistorySidebarProps = {
  items: readonly SidebarConversation[];
  currentConversationId: string;
  runningConversationIds: ReadonlySet<string>;
  // Rows with an in-flight mutation: only that row's controls are disabled.
  busyConversationIds: ReadonlyMap<string, SidebarMutationKind>;
  listStatus: SidebarListStatus;
  // Identity of the current list scope (workspace/text mode). A change
  // remounts the list content with a soft enter transition and resets scroll.
  scopeKey?: string;
  totalItems: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  // Localized error text (list or per-row mutation); rendered as a banner
  // above the rows, never replacing them.
  errorMessage: string | null;
  errorDetail?: string | null;
  onDismissError?: () => void;
  searchQuery: string;
  searchResults: readonly {
    conversationId: string;
    title: string;
    cwd?: string;
    snippet: string;
    role?: string;
    updatedAt: number;
  }[];
  searchStatus: "idle" | "loading" | "ready" | "error";
  onSearchQueryChange: (query: string) => void;
  renamingId: string | null;
  renameDraft: string;
  isOpen: boolean;
  desktopWidth?: number;
  fontScale?: number;
  activeView?: "chat" | "skills-hub" | "mcp-hub";
  showProjects?: boolean;
  // Pre-sorted by the container (activity/running/pinned) — rendered as-is.
  projects?: WorkspaceProject[];
  workspaceProjectGroups?: WorkspaceProjectGroup[];
  activeProjectId?: string;
  missingProjectPathKeys?: ReadonlySet<string>;
  runningProjectPathKeys?: ReadonlySet<string>;
  projectRenamingId?: string | null;
  projectRenameDraft?: string;
  projectsCollapsed?: boolean;
  recentCollapsed?: boolean;
  onProjectsCollapsedChange?: (collapsed: boolean) => void;
  onRecentCollapsedChange?: (collapsed: boolean) => void;
  onCreateProject?: () => void;
  onCreateWorkspaceGroup?: (name: string) => void;
  onRenameWorkspaceGroup?: (groupId: string, name: string) => void;
  onDeleteWorkspaceGroup?: (groupId: string) => void;
  onMoveProjectToGroup?: (projectPath: string, groupId: string | null) => void;
  onToggleWorkspaceGroupCollapsed?: (groupId: string) => void;
  onSelectProject?: (project: WorkspaceProject) => void;
  onNewConversationForProject?: (project: WorkspaceProject) => void;
  onBrowseProjectInFileTree?: (project: WorkspaceProject) => void;
  onBrowseProjectInSystemFileManager?: (project: WorkspaceProject) => void;
  onStartRenamingProject?: (project: WorkspaceProject) => void;
  onProjectRenameDraftChange?: (value: string) => void;
  onCommitProjectRename?: () => void;
  onCancelProjectRename?: () => void;
  onSetProjectPinned?: (project: WorkspaceProject, isPinned: boolean) => void;
  onRemoveProject?: (project: WorkspaceProject) => void;
  onArchiveProject?: (project: WorkspaceProject) => void;
  onUnarchiveProject?: (project: WorkspaceProject) => void;
  // Path keys of archived workspaces; those rows render disabled in a
  // collapsed group at the end of the list.
  archivedProjectPathKeys?: ReadonlySet<string>;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  onStartRenaming: (item: SidebarConversation) => void;
  onRenameDraftChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onSetPinned: (id: string, isPinned: boolean) => void;
  onMoveToWorkspace: (id: string, cwd: string) => void;
  onMoveConversationsToWorkspace: (
    ids: readonly string[],
    cwd: string,
  ) => Promise<readonly string[]>;
  onDeleteConversation: (id: string) => void;
  onDeleteConversations: (ids: readonly string[]) => Promise<readonly string[]>;
  onLoadMore: () => void;
  onCloseSidebar: () => void;
  onOpenSettings: () => void;
  onCreateSoul: () => void;
  appUpdate?: AppUpdateController;
  onOpenSkillsHub?: () => void;
  onOpenMcpHub?: () => void;
  mobileExperience?: boolean;
  desktopPanelMode?: boolean;
  workspaceToolsAvailable?: boolean;
  fileTreeAvailable?: boolean;
  onOpenWorkspaceTool?: (target: WorkspaceToolTarget, shell?: string) => void;
};

const HISTORY_ROW_ESTIMATED_HEIGHT = 30;
const HISTORY_ROW_GAP = 2;
const HISTORY_ROW_OVERSCAN_COUNT = 8;
const HISTORY_LOAD_MORE_THRESHOLD = 12;
const PROJECT_ICON_BUTTON_CLASS =
  "h-7 w-7 rounded-lg !bg-transparent text-muted-foreground transition-colors hover:!bg-transparent hover:!text-foreground active:!bg-transparent focus-visible:!bg-transparent data-[state=open]:!bg-transparent data-[state=open]:text-foreground data-[popup-open]:!bg-transparent data-[popup-open]:text-foreground";
const SIDEBAR_SECTION_ROWS_TRANSITION_CLASS =
  "transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none";
const SIDEBAR_PROJECT_MIN_BODY_HEIGHT = 96;
const SIDEBAR_RECENT_MIN_BODY_HEIGHT = 160;
const PROJECT_LIST_COLLAPSED_MAX = 30;
const EMPTY_PROJECT_PATH_KEYS = new Set<string>();
const HISTORY_LOADING_SKELETON_ROWS = [
  { title: "w-36", meta: "w-20" },
  { title: "w-44", meta: "w-24" },
  { title: "w-32", meta: "w-16" },
  { title: "w-40", meta: "w-28" },
  { title: "w-28", meta: "w-20" },
] as const;

type SoulPresetPickerProps = {
  presets: SoulDocument[];
  activeId: string;
  saving: boolean;
  mobile?: boolean;
  onSelect: (presetId: string) => void;
  onCreate: () => void;
};

function SoulPresetPicker(props: SoulPresetPickerProps) {
  const { t } = useLocale();
  return (
    <>
      <AstryxView
        layout="block"
        direction="horizontal"
        className={cn(
          "font-semibold uppercase tracking-[0.08em] text-muted-foreground/70",
          props.mobile ? "px-1 pb-3 text-[11px]" : "px-2 pb-1 pt-0.5 text-[10px]",
        )}
      >
        {t("sidebar.soulPresets")}
      </AstryxView>
      <AstryxView
        layout="block"
        direction="horizontal"
        className={cn("overflow-y-auto", props.mobile ? "space-y-1" : "max-h-36 space-y-0.5")}
      >
        {props.presets.map((preset) => {
          const active = preset.id === props.activeId;
          return (
            <AstryxButton
              key={preset.id}
              type="button"
              role={props.mobile ? "menuitem" : undefined}
              onClick={() => props.onSelect(preset.id)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors active:bg-muted",
                props.mobile
                  ? "h-12 text-[15px]"
                  : "h-8 text-[calc(13px*var(--zone-font-scale,1))]",
                active ? "bg-muted text-foreground" : "text-foreground/75 hover:bg-muted",
              )}
            >
              <AstryxView
                as="span"
                layout="flex"
                direction="horizontal"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-foreground"
              >
                {active ? <Check className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
              </AstryxView>
              <AstryxInline className="min-w-0 flex-1 truncate">
                {preset.metadata.name || "XGent"}
              </AstryxInline>
            </AstryxButton>
          );
        })}
      </AstryxView>
      <AstryxButton
        type="button"
        role={props.mobile ? "menuitem" : undefined}
        onClick={props.onCreate}
        disabled={props.saving}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg px-2 text-left text-foreground/85 transition-colors hover:bg-muted disabled:opacity-45",
          props.mobile ? "mt-2 h-12 text-[15px]" : "h-8 text-[calc(13px*var(--zone-font-scale,1))]",
        )}
      >
        <Plus className="h-4 w-4 text-muted-foreground" />
        <AstryxInline>{t("sidebar.addSoul")}</AstryxInline>
      </AstryxButton>
    </>
  );
}

function clampSidebarSectionHeight(height: number, minHeight: number, maxHeight: number) {
  return Math.round(Math.min(Math.max(height, minHeight), Math.max(minHeight, maxHeight)));
}

function useStableEvent<Args extends unknown[], Return>(
  handler: (...args: Args) => Return,
): (...args: Args) => Return {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  return useCallback((...args: Args) => handlerRef.current(...args), []);
}

const HistoryRow = memo(function HistoryRow(props: {
  item: SidebarConversation;
  isActive: boolean;
  isRunning: boolean;
  isBusy: boolean;
  isDeleteDisabled: boolean;
  isRenaming: boolean;
  isPendingDelete: boolean;
  renameDraft: string;
  onSelectConversation: (id: string) => void;
  onStartRenaming: (item: SidebarConversation) => void;
  onRenameDraftChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onSetPinned: (id: string, isPinned: boolean) => void;
  projects: readonly WorkspaceProject[];
  onMoveToWorkspace: (id: string, cwd: string) => void;
  selectionMode: boolean;
  isSelected: boolean;
  onToggleSelection: (id: string) => void;
  onEnterSelection: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onSetPendingDelete: (id: string | null) => void;
  touchActions?: boolean;
}) {
  const {
    item,
    isActive,
    isRunning,
    isBusy,
    isDeleteDisabled,
    isRenaming,
    isPendingDelete,
    renameDraft,
    onSelectConversation,
    onStartRenaming,
    onRenameDraftChange,
    onCommitRename,
    onCancelRename,
    onSetPinned,
    projects,
    onMoveToWorkspace,
    selectionMode,
    isSelected,
    onToggleSelection,
    onEnterSelection,
    onDeleteConversation,
    onSetPendingDelete,
    touchActions = false,
  } = props;
  const { t } = useLocale();

  const inputRef = useRef<HTMLInputElement | null>(null);
  // Enter/Escape mark the blur as handled so the following input blur does
  // not double-commit (symmetric with ProjectRow's guard).
  const skipNextBlurCommitRef = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const currentCwdKey = workspaceProjectPathKey(item.cwd ?? "");
  const moveTargets = projects.filter(
    (project) =>
      workspaceProjectPathKey(project.path) &&
      workspaceProjectPathKey(project.path) !== currentCwdKey,
  );

  const handleSelect = useCallback(() => {
    if (selectionMode) {
      if (isRunning || isBusy) return;
      onToggleSelection(item.id);
      return;
    }
    onSelectConversation(item.id);
  }, [isBusy, isRunning, item.id, onSelectConversation, onToggleSelection, selectionMode]);

  const handleStartRenaming = useCallback(() => {
    onStartRenaming(item);
  }, [item, onStartRenaming]);

  const handleRequestDelete = useCallback(() => {
    onSetPendingDelete(item.id);
  }, [item.id, onSetPendingDelete]);

  const handleTogglePinned = useCallback(() => {
    onSetPinned(item.id, item.isPinned !== true);
  }, [item.id, item.isPinned, onSetPinned]);

  const handleConfirmDelete = useCallback(() => {
    onSetPendingDelete(null);
    onDeleteConversation(item.id);
  }, [item.id, onDeleteConversation, onSetPendingDelete]);

  const handleCancelDelete = useCallback(() => {
    onSetPendingDelete(null);
  }, [onSetPendingDelete]);

  useEffect(() => {
    if (!isRenaming) return;
    skipNextBlurCommitRef.current = false;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isRenaming]);

  if (isPendingDelete) {
    return (
      <AstryxView
        layout="block"
        direction="horizontal"
        className="chat-history-row rounded-2xl border border-border/70 bg-background px-3 py-2.5 shadow-xs shadow-black/5"
      >
        <AstryxParagraph className="truncate text-sm leading-5 text-foreground/80">
          {t("chat.conversationDeleteConfirm").replace("{title}", item.title)}
        </AstryxParagraph>
        <AstryxParagraph className="mt-0.5 text-[calc(11px*var(--zone-font-scale,1))] leading-4 text-muted-foreground">
          {t("chat.conversationDeleteWarning")}
        </AstryxParagraph>
        <AstryxView layout="grid" direction="horizontal" className="mt-2 grid grid-cols-2 gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCancelDelete}
            className="h-7 rounded-xl border-border/60 text-xs font-normal text-muted-foreground hover:text-foreground"
          >
            {t("chat.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleConfirmDelete}
            disabled={isDeleteDisabled || isBusy}
            className="h-7 rounded-xl bg-destructive text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
          >
            {t("chat.delete")}
          </Button>
        </AstryxView>
      </AstryxView>
    );
  }

  return (
    <AstryxView
      layout="grid"
      direction="horizontal"
      className={cn(
        "chat-history-row group/item grid h-[30px] grid-cols-[minmax(0,1fr)_auto] items-center rounded-lg pl-1 transition-colors",
        isSelected
          ? "bg-primary/10 text-foreground ring-1 ring-inset ring-primary/20"
          : isActive
            ? "bg-foreground/[0.07] text-foreground hover:bg-foreground/[0.09]"
            : "text-foreground/85 hover:bg-foreground/[0.05] hover:text-foreground",
      )}
    >
      {isRenaming ? (
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="flex h-[30px] min-w-0 items-center px-2"
        >
          <Input
            ref={inputRef}
            value={renameDraft}
            onChange={(e) => onRenameDraftChange(e.currentTarget.value)}
            onBlur={() => {
              if (skipNextBlurCommitRef.current) {
                skipNextBlurCommitRef.current = false;
                return;
              }
              onCommitRename();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                skipNextBlurCommitRef.current = true;
                onCommitRename();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                skipNextBlurCommitRef.current = true;
                onCancelRename();
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="h-7 min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-[calc(14px*var(--zone-font-scale,1))] font-normal shadow-none outline-none focus-visible:border-0 focus-visible:bg-transparent"
            disabled={isRunning || isBusy}
          />
        </AstryxView>
      ) : (
        <AstryxButton
          type="button"
          onClick={handleSelect}
          onDoubleClick={(event) => {
            event.preventDefault();
            if (!isRunning && !isBusy) {
              handleStartRenaming();
            }
          }}
          className="flex h-[30px] min-w-0 items-center rounded-md px-2 text-left outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring"
          title={item.title}
        >
          {selectionMode ? (
            <AstryxView
              as="span"
              layout="flex"
              direction="horizontal"
              className={cn(
                "mr-1.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                isSelected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background",
              )}
              aria-hidden="true"
            >
              {isSelected ? <Check className="h-3 w-3" /> : null}
            </AstryxView>
          ) : null}
          <AstryxInline className="sidebar-project-name-fade min-w-0 flex-1 overflow-hidden whitespace-nowrap text-[calc(14px*var(--zone-font-scale,1))] font-normal leading-5">
            {item.title}
          </AstryxInline>
        </AstryxButton>
      )}
      {!isRenaming ? (
        <AstryxView
          layout="flex"
          direction="horizontal"
          className={cn(
            "relative flex items-center justify-end overflow-hidden transition-[max-width,opacity] duration-200 ease-out",
            isRunning
              ? "max-w-7 opacity-100 group-hover/item:max-w-16 group-focus-within/item:max-w-16"
              : "max-w-0 opacity-0 group-hover/item:max-w-16 group-hover/item:opacity-100 group-focus-within/item:max-w-16 group-focus-within/item:opacity-100",
            touchActions && "max-w-16 opacity-100",
            menuOpen && "max-w-16 opacity-100",
          )}
        >
          {isRunning ? (
            <AstryxView
              as="span"
              layout="flex"
              direction="horizontal"
              role="img"
              aria-label={t("chat.statusRunningReply")}
              title={t("chat.statusRunningReply")}
              className={cn(
                "pointer-events-none absolute right-1.5 flex h-4 w-4 items-center justify-center text-muted-foreground transition-opacity duration-200",
                "opacity-100 group-hover/item:opacity-0 group-focus-within/item:opacity-0",
                menuOpen && "opacity-0",
              )}
            >
              <Loader2 className="h-4 w-4 animate-spin" />
            </AstryxView>
          ) : null}
          <AstryxView
            layout="flex"
            direction="horizontal"
            className={cn(
              "flex items-center gap-0.5 transition-opacity duration-200",
              isRunning
                ? "opacity-0 group-hover/item:opacity-100 group-focus-within/item:opacity-100"
                : "opacity-100",
              menuOpen && "opacity-100",
            )}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={PROJECT_ICON_BUTTON_CLASS}
              title={item.isPinned ? t("chat.conversationUnpin") : t("chat.conversationPin")}
              aria-label={item.isPinned ? t("chat.conversationUnpin") : t("chat.conversationPin")}
              onClick={handleTogglePinned}
              disabled={item.isPending || isBusy}
            >
              {item.isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            </Button>
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={PROJECT_ICON_BUTTON_CLASS}
                    title={t("chat.conversationMore")}
                    aria-label={t("chat.conversationMore")}
                    onPointerDown={(e: React.PointerEvent<HTMLButtonElement>) =>
                      e.stopPropagation()
                    }
                    onClick={(e: React.MouseEvent<HTMLButtonElement>) => e.stopPropagation()}
                  />
                }
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side={touchActions ? "bottom" : "right"}
                align={touchActions ? "end" : "start"}
                sideOffset={touchActions ? 4 : 8}
                collisionPadding={12}
                className="sidebar-context-menu min-w-[10rem] rounded-xl border-border/60 bg-background/95 backdrop-blur-xl"
              >
                <DropdownMenuItem
                  disabled={isRunning || isBusy}
                  onSelect={handleStartRenaming}
                  className="gap-2"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  {t("chat.conversationRename")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={item.isPending || isRunning || isBusy}
                  onSelect={() => onEnterSelection(item.id)}
                  className="gap-2"
                >
                  <Check className="h-3.5 w-3.5" />
                  {t("chat.history.select")}
                </DropdownMenuItem>
                {moveTargets.length > 0 ? (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger
                      disabled={item.isPending || isRunning || isBusy}
                      className="gap-2"
                    >
                      <FolderTree className="h-3.5 w-3.5" />
                      <AstryxInline className="min-w-0 flex-1">
                        {t("chat.conversationMove")}
                      </AstryxInline>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent
                      side={touchActions ? "left" : "right"}
                      collisionPadding={12}
                      className="min-w-[12rem] max-w-[min(20rem,80vw)]"
                    >
                      {moveTargets.map((project) => (
                        <DropdownMenuItem
                          key={project.id}
                          onSelect={() => onMoveToWorkspace(item.id, project.path)}
                          className="gap-2"
                        >
                          <FolderClosed className="h-3.5 w-3.5 shrink-0" />
                          <AstryxInline className="min-w-0 truncate">{project.name}</AstryxInline>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ) : null}
                <DropdownMenuItem
                  disabled={isDeleteDisabled || isBusy}
                  onSelect={handleRequestDelete}
                  className="gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("chat.conversationDelete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </AstryxView>
        </AstryxView>
      ) : null}
    </AstryxView>
  );
});

const ProjectRow = memo(function ProjectRow(props: {
  project: WorkspaceProject;
  isActive: boolean;
  isMissing: boolean;
  isRunning: boolean;
  isRenaming: boolean;
  isPendingRemove: boolean;
  renameDraft: string;
  onSelectProject: (project: WorkspaceProject) => void;
  onBrowseProjectInFileTree?: (project: WorkspaceProject) => void;
  onBrowseProjectInSystemFileManager?: (project: WorkspaceProject) => void;
  onStartRenamingProject: (project: WorkspaceProject) => void;
  onProjectRenameDraftChange: (value: string) => void;
  onCommitProjectRename: () => void;
  onCancelProjectRename: () => void;
  onSetProjectPinned: (project: WorkspaceProject, isPinned: boolean) => void;
  onRemoveProject: (project: WorkspaceProject) => void;
  workspaceProjectGroups: readonly WorkspaceProjectGroup[];
  currentGroupId: string | null;
  onMoveProjectToGroup?: (projectPath: string, groupId: string | null) => void;
  // Archived rows render disabled: no selection (so no new conversations),
  // no pin — but rename/remove/browse stay available from the menu.
  isArchived: boolean;
  // Offered only while at least one other non-archived workspace remains.
  canArchive: boolean;
  onArchiveProject: (project: WorkspaceProject) => void;
  onUnarchiveProject: (project: WorkspaceProject) => void;
  onSetPendingRemove: (projectId: string | null) => void;
  touchActions?: boolean;
}) {
  const {
    project,
    isActive,
    isMissing,
    isRunning,
    isRenaming,
    isPendingRemove,
    renameDraft,
    onSelectProject,
    onBrowseProjectInFileTree,
    onBrowseProjectInSystemFileManager,
    onStartRenamingProject,
    onProjectRenameDraftChange,
    onCommitProjectRename,
    onCancelProjectRename,
    onSetProjectPinned,
    onRemoveProject,
    workspaceProjectGroups,
    currentGroupId,
    onMoveProjectToGroup,
    isArchived,
    canArchive,
    onArchiveProject,
    onUnarchiveProject,
    onSetPendingRemove,
    touchActions = false,
  } = props;
  const { t } = useLocale();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const skipNextBlurCommitRef = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const isDefaultProject = project.id === DEFAULT_WORKSPACE_PROJECT_ID;
  const isPinned = project.isPinned === true;
  const ProjectFolderIcon = isActive ? FolderOpen : FolderClosed;

  useEffect(() => {
    if (!isRenaming) return;
    skipNextBlurCommitRef.current = false;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isRenaming]);

  const handleRequestRemove = useCallback(() => {
    onSetPendingRemove(project.id);
  }, [onSetPendingRemove, project.id]);

  const handleConfirmRemove = useCallback(() => {
    onSetPendingRemove(null);
    onRemoveProject(project);
  }, [onRemoveProject, onSetPendingRemove, project]);

  const handleCancelRemove = useCallback(() => {
    onSetPendingRemove(null);
  }, [onSetPendingRemove]);

  const handleTogglePinned = useCallback(() => {
    onSetProjectPinned(project, !isPinned);
  }, [isPinned, onSetProjectPinned, project]);

  const handleBrowseInFileTree = useCallback(() => {
    onBrowseProjectInFileTree?.(project);
  }, [onBrowseProjectInFileTree, project]);

  const handleBrowseInSystemFileManager = useCallback(() => {
    onBrowseProjectInSystemFileManager?.(project);
  }, [onBrowseProjectInSystemFileManager, project]);

  const handleArchive = useCallback(() => {
    onArchiveProject(project);
  }, [onArchiveProject, project]);

  const handleUnarchive = useCallback(() => {
    onUnarchiveProject(project);
  }, [onUnarchiveProject, project]);

  if (isPendingRemove) {
    return (
      <AstryxView
        layout="block"
        direction="horizontal"
        className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-sm text-destructive shadow-xs shadow-black/5"
      >
        <AstryxParagraph className="truncate font-medium leading-5 text-destructive">
          {t("chat.workspaceRemoveConfirm").replace("{name}", project.name)}
        </AstryxParagraph>
        <AstryxParagraph className="mt-0.5 text-[calc(11px*var(--zone-font-scale,1))] leading-4 text-destructive/75">
          {isRunning ? t("chat.workspaceRemoveRunning") : t("chat.workspaceRemoveDescription")}
        </AstryxParagraph>
        <AstryxView layout="grid" direction="horizontal" className="mt-2 grid grid-cols-2 gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCancelRemove}
            className="h-7 rounded-xl border-border/60 bg-background text-xs font-normal text-muted-foreground hover:text-foreground"
          >
            {t("chat.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleConfirmRemove}
            disabled={isRunning}
            className="h-7 rounded-xl bg-destructive text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
          >
            {t("chat.remove")}
          </Button>
        </AstryxView>
      </AstryxView>
    );
  }

  return (
    <AstryxView
      layout="grid"
      direction="horizontal"
      ref={rowRef}
      className={cn(
        "group/project grid h-[30px] grid-cols-[minmax(0,1fr)_auto] items-center rounded-lg pl-1 transition-colors",
        isMissing
          ? "text-destructive hover:bg-destructive/10"
          : isArchived
            ? "text-muted-foreground/60 hover:bg-foreground/[0.03]"
            : isActive
              ? "bg-foreground/[0.07] text-foreground hover:bg-foreground/[0.09]"
              : "text-foreground/85 hover:bg-foreground/[0.05] hover:text-foreground",
      )}
    >
      {isRenaming ? (
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="flex h-[30px] min-w-0 items-center gap-3 rounded-md px-2 text-left"
        >
          <ProjectFolderIcon
            className={cn(
              "h-4 w-4 shrink-0 transition-colors",
              isMissing
                ? "text-destructive"
                : isArchived
                  ? "text-muted-foreground/40"
                  : isActive
                    ? "text-amber-500"
                    : "text-foreground/65",
            )}
          />
          <Input
            ref={inputRef}
            value={renameDraft}
            onChange={(e) => onProjectRenameDraftChange(e.currentTarget.value)}
            onBlur={() => {
              if (skipNextBlurCommitRef.current) {
                skipNextBlurCommitRef.current = false;
                return;
              }
              onCommitProjectRename();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                skipNextBlurCommitRef.current = true;
                onCommitProjectRename();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                skipNextBlurCommitRef.current = true;
                onCancelProjectRename();
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="h-7 min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-[calc(14px*var(--zone-font-scale,1))] font-normal shadow-none outline-none focus-visible:border-0 focus-visible:bg-transparent"
          />
        </AstryxView>
      ) : (
        <Tooltip
          anchorRef={rowRef}
          placement="end"
          alignment="center"
          delay={0}
          hasHoverIndication={false}
          content={
            <VStack gap={1} width={256}>
              <Text type="label" weight="semibold" maxLines={1}>
                {project.name}
              </Text>
              <Text type="supporting" color="secondary" wordBreak="break-all">
                {project.path}
              </Text>
            </VStack>
          }
        >
          <AstryxButton
            type="button"
            aria-disabled={isArchived || undefined}
            className={cn(
              "flex h-[30px] min-w-0 items-center gap-3 rounded-md px-2 text-left outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              isMissing
                ? "hover:text-destructive focus-visible:bg-destructive/10"
                : isArchived
                  ? "cursor-default"
                  : "hover:text-foreground focus-visible:bg-foreground/[0.06]",
            )}
            onClick={() => {
              // Archived workspaces cannot be selected, so no new
              // conversations can start in them.
              if (!isArchived) {
                onSelectProject(project);
              }
            }}
            onDoubleClick={(event) => {
              event.preventDefault();
              if (!isDefaultProject) {
                onStartRenamingProject(project);
              }
            }}
          >
            <ProjectFolderIcon
              className={cn(
                "h-4 w-4 shrink-0 transition-colors",
                isMissing
                  ? "text-destructive"
                  : isArchived
                    ? "text-muted-foreground/40"
                    : isActive
                      ? "text-amber-500"
                      : "text-foreground/65",
              )}
            />
            <AstryxInline
              className={cn(
                "sidebar-project-name-fade min-w-0 flex-1 overflow-hidden whitespace-nowrap text-[calc(14px*var(--zone-font-scale,1))] font-normal leading-5",
                isMissing ? "text-destructive" : undefined,
              )}
            >
              {project.name}
            </AstryxInline>
          </AstryxButton>
        </Tooltip>
      )}
      {!isRenaming ? (
        <AstryxView
          layout="flex"
          direction="horizontal"
          className={cn(
            "relative flex items-center justify-end overflow-hidden transition-[max-width,opacity] duration-200 ease-out",
            isMissing
              ? "max-w-8 opacity-100"
              : isRunning
                ? "max-w-7 opacity-100 group-hover/project:max-w-16 group-focus-within/project:max-w-16"
                : "max-w-0 opacity-0 group-hover/project:max-w-16 group-hover/project:opacity-100 group-focus-within/project:max-w-16 group-focus-within/project:opacity-100",
            touchActions && "max-w-16 opacity-100",
            menuOpen && "max-w-16 opacity-100",
          )}
        >
          {isRunning && !isMissing ? (
            <AstryxView
              as="span"
              layout="flex"
              direction="horizontal"
              role="img"
              aria-label={t("chat.statusRunningReply")}
              title={t("chat.statusRunningReply")}
              className={cn(
                "pointer-events-none absolute right-1.5 flex h-4 w-4 items-center justify-center text-muted-foreground transition-opacity duration-200",
                "opacity-100 group-hover/project:opacity-0 group-focus-within/project:opacity-0",
                menuOpen && "opacity-0",
              )}
            >
              <Loader2 className="h-4 w-4 animate-spin" />
            </AstryxView>
          ) : null}
          <AstryxView
            layout="flex"
            direction="horizontal"
            className={cn(
              "flex items-center gap-0.5 transition-opacity duration-200",
              isRunning && !isMissing
                ? "opacity-0 group-hover/project:opacity-100 group-focus-within/project:opacity-100"
                : "opacity-100",
              menuOpen && "opacity-100",
            )}
          >
            {isMissing && !isArchived ? (
              !isDefaultProject ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    PROJECT_ICON_BUTTON_CLASS,
                    "text-destructive hover:!bg-transparent hover:text-destructive",
                  )}
                  title={t("chat.workspaceRemove")}
                  aria-label={t("chat.workspaceRemove")}
                  onClick={handleRequestRemove}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              ) : null
            ) : (
              <>
                {!isArchived ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={PROJECT_ICON_BUTTON_CLASS}
                    title={isPinned ? t("chat.workspaceUnpin") : t("chat.workspacePin")}
                    aria-label={isPinned ? t("chat.workspaceUnpin") : t("chat.workspacePin")}
                    onClick={handleTogglePinned}
                  >
                    {isPinned ? (
                      <PinOff className="h-3.5 w-3.5" />
                    ) : (
                      <Pin className="h-3.5 w-3.5" />
                    )}
                  </Button>
                ) : null}
                <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={PROJECT_ICON_BUTTON_CLASS}
                        title={t("chat.workspaceMore")}
                        aria-label={t("chat.workspaceMore")}
                      />
                    }
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    side={touchActions ? "bottom" : "right"}
                    align={touchActions ? "end" : "start"}
                    sideOffset={touchActions ? 4 : 6}
                    collisionPadding={12}
                    className="sidebar-context-menu"
                  >
                    {!isDefaultProject ? (
                      <>
                        <DropdownMenuItem
                          onSelect={() => onStartRenamingProject(project)}
                          className="gap-2"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          {t("chat.workspaceRename")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={handleRequestRemove}
                          className="gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {t("chat.workspaceRemove")}
                        </DropdownMenuItem>
                      </>
                    ) : null}
                    {workspaceProjectGroups.length > 0 && onMoveProjectToGroup ? (
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger className="gap-2">
                          <FolderTree className="h-3.5 w-3.5" />
                          <AstryxInline className="min-w-0 flex-1">
                            {t("chat.workspaceMoveToGroup")}
                          </AstryxInline>
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent
                          side={touchActions ? "left" : "right"}
                          collisionPadding={12}
                          className="min-w-[12rem] max-w-[min(20rem,80vw)]"
                        >
                          <DropdownMenuItem
                            onSelect={() => onMoveProjectToGroup(project.path, null)}
                            className="gap-2"
                          >
                            <Check
                              className={cn(
                                "h-3.5 w-3.5",
                                currentGroupId === null ? "opacity-100" : "opacity-0",
                              )}
                            />
                            <AstryxInline>{t("chat.workspaceUngrouped")}</AstryxInline>
                          </DropdownMenuItem>
                          {workspaceProjectGroups.map((group) => (
                            <DropdownMenuItem
                              key={group.id}
                              onSelect={() => onMoveProjectToGroup(project.path, group.id)}
                              className="gap-2"
                            >
                              <Check
                                className={cn(
                                  "h-3.5 w-3.5",
                                  currentGroupId === group.id ? "opacity-100" : "opacity-0",
                                )}
                              />
                              <AstryxInline className="min-w-0 truncate">{group.name}</AstryxInline>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    ) : null}
                    {!isArchived && canArchive ? (
                      <DropdownMenuItem onSelect={handleArchive} className="gap-2">
                        <Archive className="h-3.5 w-3.5" />
                        {t("chat.workspaceArchive")}
                      </DropdownMenuItem>
                    ) : null}
                    {isArchived ? (
                      <DropdownMenuItem onSelect={handleUnarchive} className="gap-2">
                        <ArchiveRestore className="h-3.5 w-3.5" />
                        {t("chat.workspaceUnarchive")}
                      </DropdownMenuItem>
                    ) : null}
                    {onBrowseProjectInFileTree ? (
                      <DropdownMenuItem onSelect={handleBrowseInFileTree} className="gap-2">
                        <FolderTree className="h-3.5 w-3.5" />
                        {t("chat.workspaceBrowseInFileTree")}
                      </DropdownMenuItem>
                    ) : null}
                    {onBrowseProjectInSystemFileManager ? (
                      <DropdownMenuItem
                        onSelect={handleBrowseInSystemFileManager}
                        className="gap-2"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                        {t("chat.workspaceBrowseInSystemFileManager")}
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </AstryxView>
        </AstryxView>
      ) : null}
    </AstryxView>
  );
});

function HistoryListLoadingSkeleton() {
  const { t } = useLocale();

  return (
    <AstryxView
      layout="block"
      direction="horizontal"
      className="space-y-1.5 pt-1"
      role="status"
      aria-live="polite"
      aria-label={t("sidebar.readingHistory")}
    >
      <AstryxView
        layout="flex"
        direction="horizontal"
        className="flex items-center gap-2 px-2 pb-1 text-[calc(11px*var(--zone-font-scale,1))] font-medium text-muted-foreground/75"
      >
        <AstryxView
          as="span"
          layout="flex"
          direction="horizontal"
          className="relative flex h-2 w-2 shrink-0"
          aria-hidden="true"
        >
          <AstryxView
            as="span"
            layout="inline-flex"
            direction="horizontal"
            className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/35 opacity-75"
          />
          <AstryxView
            as="span"
            layout="inline-flex"
            direction="horizontal"
            className="relative inline-flex h-2 w-2 rounded-full bg-primary/70"
          />
        </AstryxView>
        <AstryxInline>{t("sidebar.readingHistory")}</AstryxInline>
      </AstryxView>
      {HISTORY_LOADING_SKELETON_ROWS.map((row) => (
        <AstryxView
          layout="block"
          direction="horizontal"
          key={`${row.title}-${row.meta}`}
          className="rounded-lg px-2 py-2.5"
        >
          <AstryxView layout="flex" direction="horizontal" className="flex items-start gap-2">
            <AstryxView
              layout="block"
              direction="horizontal"
              className="skills-skeleton-shimmer mt-1 h-3.5 w-3.5 shrink-0 rounded-md"
            />
            <AstryxView layout="block" direction="horizontal" className="min-w-0 flex-1 space-y-2">
              <AstryxView
                layout="block"
                direction="horizontal"
                className={cn("skills-skeleton-shimmer h-3.5 rounded", row.title)}
              />
              <AstryxView
                layout="block"
                direction="horizontal"
                className={cn("skills-skeleton-shimmer h-2.5 rounded", row.meta)}
              />
            </AstryxView>
          </AstryxView>
        </AstryxView>
      ))}
    </AstryxView>
  );
}

function SidebarStateCard(props: {
  title: string;
  description?: string;
  tone?: "default" | "error";
  onDismiss?: () => void;
  dismissLabel?: string;
}) {
  const { title, description, tone = "default", onDismiss, dismissLabel } = props;

  return (
    <AstryxView
      layout="block"
      direction="horizontal"
      className={cn(
        "rounded-2xl border px-3 py-3 text-sm",
        tone === "error"
          ? "border-destructive/20 bg-destructive/5 text-destructive"
          : "border-border/60 bg-background/70 text-muted-foreground",
      )}
    >
      <AstryxView
        layout="flex"
        direction="horizontal"
        className="flex items-start justify-between gap-2"
      >
        <AstryxView
          layout="block"
          direction="horizontal"
          className={cn(
            "min-w-0 font-medium",
            tone === "error" ? "text-destructive" : "text-foreground/85",
          )}
        >
          {title}
        </AstryxView>
        {onDismiss ? (
          <AstryxButton
            type="button"
            onClick={onDismiss}
            aria-label={dismissLabel}
            title={dismissLabel}
            className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors",
              tone === "error"
                ? "text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
                : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
            )}
          >
            <X className="h-3.5 w-3.5" />
          </AstryxButton>
        ) : null}
      </AstryxView>
      {description ? (
        <AstryxView layout="block" direction="horizontal" className="mt-1 text-xs leading-5">
          {description}
        </AstryxView>
      ) : null}
    </AstryxView>
  );
}

export const ChatHistorySidebar = memo(function ChatHistorySidebar(props: ChatHistorySidebarProps) {
  const {
    items,
    currentConversationId,
    runningConversationIds,
    busyConversationIds,
    listStatus,
    scopeKey = "",
    hasMore,
    isLoadingMore,
    errorMessage,
    errorDetail,
    onDismissError,
    searchQuery,
    searchResults,
    searchStatus,
    onSearchQueryChange,
    renamingId,
    renameDraft,
    isOpen,
    desktopWidth = 360,
    fontScale = 1,
    activeView = "chat",
    showProjects = false,
    projects = [],
    workspaceProjectGroups = [],
    activeProjectId,
    missingProjectPathKeys = EMPTY_PROJECT_PATH_KEYS,
    runningProjectPathKeys = EMPTY_PROJECT_PATH_KEYS,
    projectRenamingId = null,
    projectRenameDraft = "",
    projectsCollapsed = false,
    recentCollapsed = false,
    onProjectsCollapsedChange,
    onRecentCollapsedChange,
    onCreateProject,
    onCreateWorkspaceGroup,
    onRenameWorkspaceGroup,
    onDeleteWorkspaceGroup,
    onMoveProjectToGroup,
    onToggleWorkspaceGroupCollapsed,
    onSelectProject,
    onBrowseProjectInFileTree,
    onBrowseProjectInSystemFileManager,
    onStartRenamingProject,
    onProjectRenameDraftChange,
    onCommitProjectRename,
    onCancelProjectRename,
    onSetProjectPinned,
    onRemoveProject,
    onArchiveProject,
    onUnarchiveProject,
    archivedProjectPathKeys = EMPTY_PROJECT_PATH_KEYS,
    onNewConversation,
    onSelectConversation,
    onStartRenaming,
    onRenameDraftChange,
    onCommitRename,
    onCancelRename,
    onSetPinned,
    onMoveToWorkspace,
    onMoveConversationsToWorkspace,
    onDeleteConversation,
    onDeleteConversations,
    onLoadMore,
    onCloseSidebar,
    onOpenSettings,
    onCreateSoul,
    appUpdate,
    onOpenSkillsHub,
    onOpenMcpHub,
    mobileExperience = false,
    desktopPanelMode = false,
    workspaceToolsAvailable = false,
    fileTreeAvailable = workspaceToolsAvailable,
    onOpenWorkspaceTool,
  } = props;
  const { t } = useLocale();
  const soul = useSoul();
  const soulDocument = soul.document;

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [selectedConversationIds, setSelectedConversationIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false);
  const [batchMutationRunning, setBatchMutationRunning] = useState(false);
  const [pendingProjectRemoveId, setPendingProjectRemoveId] = useState<string | null>(null);
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [historySearchOpen, setHistorySearchOpen] = useState(false);
  const [creatingWorkspaceGroup, setCreatingWorkspaceGroup] = useState(false);
  const [workspaceGroupDraft, setWorkspaceGroupDraft] = useState("");
  const [renamingWorkspaceGroupId, setRenamingWorkspaceGroupId] = useState<string | null>(null);
  const [soulLauncherOpen, setSoulLauncherOpen] = useState(false);
  const soulLongPressTimerRef = useRef<number | null>(null);
  const soulLongPressStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const suppressSoulClickRef = useRef(false);
  const [projectSectionHeight, setProjectSectionHeight] = useState<number | null>(null);
  const [isProjectSectionResizing, setIsProjectSectionResizing] = useState(false);
  const [sidebarSectionMetrics, setSidebarSectionMetrics] = useState({
    containerHeight: 0,
    projectsHeaderHeight: 0,
    recentHeaderHeight: 0,
    handleHeight: 0,
    projectsContentHeight: 0,
  });
  const sidebarSectionsRef = useRef<HTMLDivElement | null>(null);
  const projectsHeaderRef = useRef<HTMLDivElement | null>(null);
  const recentHeaderRef = useRef<HTMLDivElement | null>(null);
  const sectionResizeHandleRef = useRef<HTMLButtonElement | null>(null);
  const projectsBodyRef = useRef<HTMLDivElement | null>(null);
  const sidebarSectionLayoutRef = useRef({
    projectsBodyHeight: 0,
    resizeMinHeight: 0,
    resizeMaxHeight: 0,
  });
  const projectSectionResizeFrameRef = useRef<number | null>(null);
  const projectSectionResizeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      if (soulLongPressTimerRef.current !== null) {
        window.clearTimeout(soulLongPressTimerRef.current);
        soulLongPressTimerRef.current = null;
      }
    },
    [],
  );
  useEffect(() => {
    if (isOpen) return;
    setSoulLauncherOpen(false);
    suppressSoulClickRef.current = false;
  }, [isOpen]);
  const handleSelectConversation = useStableEvent(onSelectConversation);
  const handleStartRenaming = useStableEvent(onStartRenaming);
  const handleRenameDraftChange = useStableEvent(onRenameDraftChange);
  const handleCommitRename = useStableEvent(onCommitRename);
  const handleCancelRename = useStableEvent(onCancelRename);
  const handleSetPinned = useStableEvent(onSetPinned);
  const handleMoveToWorkspace = useStableEvent(onMoveToWorkspace);
  const handleDeleteConversation = useStableEvent(onDeleteConversation);
  const toggleConversationSelection = useStableEvent((conversationId: string) => {
    setBatchDeleteConfirm(false);
    setSelectedConversationIds((current) => {
      const next = new Set(current);
      if (next.has(conversationId)) next.delete(conversationId);
      else next.add(conversationId);
      return next;
    });
  });
  const enterConversationSelection = useStableEvent((conversationId: string) => {
    setBatchDeleteConfirm(false);
    setHistorySearchOpen(false);
    onSearchQueryChange("");
    onRecentCollapsedChange?.(false);
    setSelectedConversationIds(new Set([conversationId]));
  });
  const leaveConversationSelection = useStableEvent(() => {
    setBatchDeleteConfirm(false);
    setSelectedConversationIds(new Set());
  });
  const selectionMode = selectedConversationIds.size > 0;

  useEffect(() => {
    if (selectedConversationIds.size === 0 || batchMutationRunning) return;
    const visibleIds = new Set(items.map((item) => item.id));
    const retained = new Set(
      Array.from(selectedConversationIds).filter((conversationId) =>
        visibleIds.has(conversationId),
      ),
    );
    if (retained.size !== selectedConversationIds.size) {
      setSelectedConversationIds(retained);
      setBatchDeleteConfirm(false);
    }
  }, [batchMutationRunning, items, selectedConversationIds]);
  const selectedConversationIdList = useMemo(
    () => Array.from(selectedConversationIds),
    [selectedConversationIds],
  );
  const runBatchMove = useStableEvent((cwd: string) => {
    if (selectedConversationIdList.length === 0 || batchMutationRunning) return;
    setBatchMutationRunning(true);
    setBatchDeleteConfirm(false);
    void onMoveConversationsToWorkspace(selectedConversationIdList, cwd)
      .then((failedIds) => setSelectedConversationIds(new Set(failedIds)))
      .finally(() => setBatchMutationRunning(false));
  });
  const runBatchDelete = useStableEvent(() => {
    if (selectedConversationIdList.length === 0 || batchMutationRunning) return;
    if (!batchDeleteConfirm) {
      setBatchDeleteConfirm(true);
      return;
    }
    setBatchMutationRunning(true);
    void onDeleteConversations(selectedConversationIdList)
      .then((failedIds) => {
        setSelectedConversationIds(new Set(failedIds));
        setBatchDeleteConfirm(false);
      })
      .finally(() => setBatchMutationRunning(false));
  });
  const handleSelectProject = useStableEvent((project: WorkspaceProject) => {
    onSelectProject?.(project);
  });
  const handleBrowseProjectInFileTree = useStableEvent((project: WorkspaceProject) => {
    onBrowseProjectInFileTree?.(project);
  });
  const handleBrowseProjectInSystemFileManager = useStableEvent((project: WorkspaceProject) => {
    onBrowseProjectInSystemFileManager?.(project);
  });
  const handleStartRenamingProject = useStableEvent((project: WorkspaceProject) => {
    onStartRenamingProject?.(project);
  });
  const handleProjectRenameDraftChange = useStableEvent((value: string) => {
    onProjectRenameDraftChange?.(value);
  });
  const handleCommitProjectRename = useStableEvent(() => {
    onCommitProjectRename?.();
  });
  const handleCancelProjectRename = useStableEvent(() => {
    onCancelProjectRename?.();
  });
  const handleSetProjectPinned = useStableEvent((project: WorkspaceProject, isPinned: boolean) => {
    onSetProjectPinned?.(project, isPinned);
  });
  const handleRemoveProject = useStableEvent((project: WorkspaceProject) => {
    onRemoveProject?.(project);
  });
  const handleArchiveProject = useStableEvent((project: WorkspaceProject) => {
    onArchiveProject?.(project);
  });
  const handleUnarchiveProject = useStableEvent((project: WorkspaceProject) => {
    onUnarchiveProject?.(project);
  });
  const handleMoveProjectToGroup = useStableEvent((projectPath: string, groupId: string | null) => {
    onMoveProjectToGroup?.(projectPath, groupId);
  });
  // Archived rows are split into their own collapsed group at the list end;
  // the render cap only applies to the active rows.
  const activeProjects = useMemo(
    () =>
      projects.filter(
        (project) => !archivedProjectPathKeys.has(workspaceProjectPathKey(project.path)),
      ),
    [archivedProjectPathKeys, projects],
  );
  const activeProjectGroupIds = useMemo(() => {
    const assignments = new Map<string, string>();
    for (const group of workspaceProjectGroups) {
      for (const path of group.projectPaths) {
        const key = workspaceProjectPathKey(path);
        if (key && !assignments.has(key)) assignments.set(key, group.id);
      }
    }
    return assignments;
  }, [workspaceProjectGroups]);
  const ungroupedActiveProjects = useMemo(
    () =>
      activeProjects.filter(
        (project) => !activeProjectGroupIds.has(workspaceProjectPathKey(project.path)),
      ),
    [activeProjectGroupIds, activeProjects],
  );
  const archivedProjects = useMemo(
    () =>
      projects.filter((project) =>
        archivedProjectPathKeys.has(workspaceProjectPathKey(project.path)),
      ),
    [archivedProjectPathKeys, projects],
  );
  // Projects arrive pre-sorted from the container; the view only caps the
  // rendered count until the user expands the list.
  const renderedProjects = useMemo(
    () =>
      showAllProjects
        ? ungroupedActiveProjects
        : ungroupedActiveProjects.slice(0, PROJECT_LIST_COLLAPSED_MAX),
    [showAllProjects, ungroupedActiveProjects],
  );
  // Archiving must always leave at least one active workspace behind.
  const canArchiveProjects = Boolean(onArchiveProject) && activeProjects.length > 1;
  const [archivedGroupOpen, setArchivedGroupOpen] = useState(false);
  const hiddenProjectCount = ungroupedActiveProjects.length - renderedProjects.length;
  const sidebarSectionLayout = useMemo(() => {
    const {
      containerHeight,
      projectsHeaderHeight,
      recentHeaderHeight,
      handleHeight,
      projectsContentHeight,
    } = sidebarSectionMetrics;
    const measured = containerHeight > 0;
    const available = Math.max(
      0,
      containerHeight - projectsHeaderHeight - recentHeaderHeight - handleHeight,
    );
    const projectMinBodyHeight = Math.min(SIDEBAR_PROJECT_MIN_BODY_HEIGHT, available);
    const recentMinBodyHeight = Math.min(
      SIDEBAR_RECENT_MIN_BODY_HEIGHT,
      Math.max(0, available - projectMinBodyHeight),
    );
    const resizeMaxHeight = Math.max(0, available - recentMinBodyHeight);
    const resizeMinHeight = Math.max(
      0,
      Math.min(projectsContentHeight, projectMinBodyHeight, resizeMaxHeight),
    );
    const defaultProjectsBodyHeight = clampSidebarSectionHeight(
      Math.min(projectsContentHeight, Math.floor(available / 2)),
      resizeMinHeight,
      resizeMaxHeight,
    );

    let projectsBodyHeight = 0;
    if (showProjects && !projectsCollapsed) {
      if (recentCollapsed) {
        projectsBodyHeight = available;
      } else if (projectSectionHeight !== null) {
        projectsBodyHeight = clampSidebarSectionHeight(
          projectSectionHeight,
          resizeMinHeight,
          resizeMaxHeight,
        );
      } else {
        projectsBodyHeight = defaultProjectsBodyHeight;
      }
    }
    const recentBodyHeight = recentCollapsed ? 0 : Math.max(0, available - projectsBodyHeight);

    const projectsBodyTrack =
      !showProjects || projectsCollapsed
        ? "0px"
        : measured
          ? `${projectsBodyHeight}px`
          : "min-content";
    const recentBodyTrack = recentCollapsed
      ? "0px"
      : measured
        ? `${recentBodyHeight}px`
        : "minmax(0, 1fr)";
    const gridTemplateRows = showProjects
      ? `auto ${projectsBodyTrack} auto auto ${recentBodyTrack}`
      : `auto ${recentBodyTrack}`;

    return { projectsBodyHeight, resizeMinHeight, resizeMaxHeight, gridTemplateRows };
  }, [
    projectSectionHeight,
    projectsCollapsed,
    recentCollapsed,
    showProjects,
    sidebarSectionMetrics,
  ]);
  const canResizeProjectSections =
    showProjects &&
    !projectsCollapsed &&
    !recentCollapsed &&
    sidebarSectionLayout.resizeMaxHeight > sidebarSectionLayout.resizeMinHeight;
  sidebarSectionLayoutRef.current = {
    projectsBodyHeight: sidebarSectionLayout.projectsBodyHeight,
    resizeMinHeight: sidebarSectionLayout.resizeMinHeight,
    resizeMaxHeight: sidebarSectionLayout.resizeMaxHeight,
  };
  const historyScrollRef = useRef<HTMLDivElement | null>(null);
  const getHistoryItemKey = useCallback((index: number) => items[index]?.id ?? index, [items]);
  const historyVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => historyScrollRef.current,
    estimateSize: () => HISTORY_ROW_ESTIMATED_HEIGHT + HISTORY_ROW_GAP,
    getItemKey: getHistoryItemKey,
    overscan: HISTORY_ROW_OVERSCAN_COUNT,
  });
  const virtualHistoryRows = historyVirtualizer.getVirtualItems();
  const lastVirtualHistoryIndex =
    virtualHistoryRows.length > 0 ? virtualHistoryRows[virtualHistoryRows.length - 1].index : -1;

  const isListLoading = listStatus === "loading" || listStatus === "initial";

  // Workspace switch: land the new scope at the top; the keyed content
  // wrapper below replays the soft enter transition at the same time.
  useEffect(() => {
    historyScrollRef.current?.scrollTo({ top: 0 });
  }, [scopeKey]);

  useEffect(() => {
    if (
      !hasMore ||
      isListLoading ||
      isLoadingMore ||
      recentCollapsed ||
      items.length === 0 ||
      lastVirtualHistoryIndex < items.length - HISTORY_LOAD_MORE_THRESHOLD
    ) {
      return;
    }
    onLoadMore();
  }, [
    hasMore,
    isListLoading,
    isLoadingMore,
    items.length,
    lastVirtualHistoryIndex,
    onLoadMore,
    recentCollapsed,
  ]);

  useEffect(() => {
    if (!pendingProjectRemoveId) {
      return;
    }
    if (!projects.some((project) => project.id === pendingProjectRemoveId)) {
      setPendingProjectRemoveId(null);
    }
  }, [pendingProjectRemoveId, projects]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run to (re)observe section refs when sections mount/unmount or toggle
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const container = sidebarSectionsRef.current;
    if (!container || typeof ResizeObserver === "undefined") {
      return;
    }

    let frameId = 0;
    const measure = () => {
      frameId = 0;
      setSidebarSectionMetrics((previous) => {
        const next = {
          containerHeight: container.clientHeight,
          projectsHeaderHeight: projectsHeaderRef.current?.offsetHeight ?? 0,
          recentHeaderHeight: recentHeaderRef.current?.offsetHeight ?? 0,
          handleHeight: sectionResizeHandleRef.current?.offsetHeight ?? 0,
          projectsContentHeight: projectsBodyRef.current?.offsetHeight ?? 0,
        };
        if (
          previous.containerHeight === next.containerHeight &&
          previous.projectsHeaderHeight === next.projectsHeaderHeight &&
          previous.recentHeaderHeight === next.recentHeaderHeight &&
          previous.handleHeight === next.handleHeight &&
          previous.projectsContentHeight === next.projectsContentHeight
        ) {
          return previous;
        }
        return next;
      });
    };
    const scheduleMeasure = () => {
      if (frameId !== 0) {
        return;
      }
      frameId = window.requestAnimationFrame(measure);
    };

    scheduleMeasure();
    window.addEventListener("resize", scheduleMeasure);
    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(container);
    const observedTargets = [
      projectsHeaderRef.current,
      recentHeaderRef.current,
      sectionResizeHandleRef.current,
      projectsBodyRef.current,
    ];
    for (const target of observedTargets) {
      if (target) {
        resizeObserver.observe(target);
      }
    }

    return () => {
      window.removeEventListener("resize", scheduleMeasure);
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
      resizeObserver.disconnect();
    };
  }, [isOpen, projectsCollapsed, recentCollapsed, showProjects]);

  useEffect(() => {
    return () => {
      projectSectionResizeCleanupRef.current?.();
      if (projectSectionResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(projectSectionResizeFrameRef.current);
      }
    };
  }, []);

  const handleProjectSectionResizeStart = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || !canResizeProjectSections) {
        return;
      }

      event.preventDefault();
      projectSectionResizeCleanupRef.current?.();

      const pointerId = event.pointerId;
      const resizeTarget = event.currentTarget;
      const startY = event.clientY;
      const layout = sidebarSectionLayoutRef.current;
      const startHeight = clampSidebarSectionHeight(
        layout.projectsBodyHeight,
        layout.resizeMinHeight,
        layout.resizeMaxHeight,
      );
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;

      setIsProjectSectionResizing(true);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      resizeTarget.setPointerCapture(pointerId);

      const scheduleProjectSectionHeight = (nextHeight: number) => {
        if (projectSectionResizeFrameRef.current !== null) {
          return;
        }
        projectSectionResizeFrameRef.current = window.requestAnimationFrame(() => {
          projectSectionResizeFrameRef.current = null;
          setProjectSectionHeight(nextHeight);
        });
      };

      const cleanupResize = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleUp);
        window.removeEventListener("blur", handleBlur);
        if (resizeTarget.hasPointerCapture(pointerId)) {
          resizeTarget.releasePointerCapture(pointerId);
        }
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        projectSectionResizeCleanupRef.current = null;
      };

      const finishResize = () => {
        cleanupResize();
        if (projectSectionResizeFrameRef.current !== null) {
          window.cancelAnimationFrame(projectSectionResizeFrameRef.current);
          projectSectionResizeFrameRef.current = null;
        }
        setIsProjectSectionResizing(false);
      };

      const handleMove = (moveEvent: globalThis.PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) {
          return;
        }
        moveEvent.preventDefault();
        const liveLayout = sidebarSectionLayoutRef.current;
        scheduleProjectSectionHeight(
          clampSidebarSectionHeight(
            startHeight + moveEvent.clientY - startY,
            liveLayout.resizeMinHeight,
            liveLayout.resizeMaxHeight,
          ),
        );
      };

      const handleUp = (upEvent: globalThis.PointerEvent) => {
        if (upEvent.pointerId !== pointerId) {
          return;
        }
        finishResize();
      };

      const handleBlur = () => {
        finishResize();
      };

      projectSectionResizeCleanupRef.current = cleanupResize;
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", handleUp);
      window.addEventListener("blur", handleBlur);
    },
    [canResizeProjectSections],
  );

  const renderActiveProjectRow = (project: WorkspaceProject) => {
    const pathKey = workspaceProjectPathKey(project.path);
    return (
      <ProjectRow
        key={project.id}
        project={project}
        isActive={activeProjectId === project.id}
        isMissing={missingProjectPathKeys.has(pathKey)}
        isRunning={runningProjectPathKeys.has(pathKey)}
        isRenaming={projectRenamingId === project.id}
        isPendingRemove={pendingProjectRemoveId === project.id}
        renameDraft={projectRenameDraft}
        onSelectProject={handleSelectProject}
        onBrowseProjectInFileTree={
          onBrowseProjectInFileTree ? handleBrowseProjectInFileTree : undefined
        }
        onBrowseProjectInSystemFileManager={
          onBrowseProjectInSystemFileManager ? handleBrowseProjectInSystemFileManager : undefined
        }
        onStartRenamingProject={handleStartRenamingProject}
        onProjectRenameDraftChange={handleProjectRenameDraftChange}
        onCommitProjectRename={handleCommitProjectRename}
        onCancelProjectRename={handleCancelProjectRename}
        onSetProjectPinned={handleSetProjectPinned}
        onRemoveProject={handleRemoveProject}
        workspaceProjectGroups={workspaceProjectGroups}
        currentGroupId={activeProjectGroupIds.get(pathKey) ?? null}
        onMoveProjectToGroup={onMoveProjectToGroup ? handleMoveProjectToGroup : undefined}
        isArchived={false}
        canArchive={canArchiveProjects}
        onArchiveProject={handleArchiveProject}
        onUnarchiveProject={handleUnarchiveProject}
        onSetPendingRemove={setPendingProjectRemoveId}
        touchActions={mobileExperience}
      />
    );
  };

  const renderHistoryRow = useCallback(
    (item: SidebarConversation) => (
      <HistoryRow
        key={item.id}
        item={item}
        isActive={currentConversationId === item.id}
        isRunning={runningConversationIds.has(item.id)}
        isBusy={busyConversationIds.has(item.id)}
        isDeleteDisabled={runningConversationIds.has(item.id)}
        isRenaming={renamingId === item.id}
        isPendingDelete={pendingDeleteId === item.id}
        renameDraft={renamingId === item.id ? renameDraft : ""}
        onSelectConversation={handleSelectConversation}
        onStartRenaming={handleStartRenaming}
        onRenameDraftChange={handleRenameDraftChange}
        onCommitRename={handleCommitRename}
        onCancelRename={handleCancelRename}
        onSetPinned={handleSetPinned}
        projects={activeProjects}
        onMoveToWorkspace={handleMoveToWorkspace}
        selectionMode={selectionMode}
        isSelected={selectedConversationIds.has(item.id)}
        onToggleSelection={toggleConversationSelection}
        onEnterSelection={enterConversationSelection}
        onDeleteConversation={handleDeleteConversation}
        onSetPendingDelete={setPendingDeleteId}
        touchActions={mobileExperience}
      />
    ),
    [
      busyConversationIds,
      currentConversationId,
      handleCancelRename,
      handleCommitRename,
      handleDeleteConversation,
      handleRenameDraftChange,
      handleSelectConversation,
      handleSetPinned,
      handleMoveToWorkspace,
      handleStartRenaming,
      enterConversationSelection,
      pendingDeleteId,
      renameDraft,
      renamingId,
      runningConversationIds,
      selectedConversationIds,
      selectionMode,
      activeProjects,
      toggleConversationSelection,
      mobileExperience,
    ],
  );

  return (
    <AstryxView
      as="aside"
      data-mobile-left-drawer
      aria-hidden={!isOpen}
      inert={!isOpen}
      className={cn(
        "chat-history-sidebar zone-font-scale fixed inset-y-0 left-0 z-50 flex h-full w-[min(90vw,360px)] shrink-0 flex-col overflow-hidden border-r border-border bg-body pb-[env(safe-area-inset-bottom,0px)] pl-[env(safe-area-inset-left,0px)] pt-[env(safe-area-inset-top,0px)] shadow-lg transition-[width,opacity,transform] duration-200 ease-out md:relative md:inset-auto md:z-auto md:p-0 md:shadow-none",
        isOpen
          ? desktopPanelMode
            ? "translate-x-0 opacity-100 md:w-[var(--xagent-chat-sidebar-width)]"
            : "translate-x-0 opacity-100 md:w-[272px]"
          : "pointer-events-none -translate-x-full opacity-0 md:w-0 md:translate-x-0",
      )}
      style={
        {
          "--zone-font-scale": fontScale,
          "--xagent-chat-sidebar-width": `${desktopWidth}px`,
        } as CSSProperties
      }
    >
      <AstryxView
        layout="flex"
        direction="vertical"
        className={cn(
          "chat-history-sidebar-inner flex min-h-0 w-full min-w-0 flex-1 flex-col",
          desktopPanelMode
            ? "md:w-[var(--xagent-chat-sidebar-width)] md:min-w-[var(--xagent-chat-sidebar-width)]"
            : "md:w-[272px] md:min-w-[272px]",
        )}
      >
        <MacOsTitleBarSpacer className={cn("bg-body", desktopPanelMode && "md:hidden")} />
        <AstryxView
          layout="block"
          direction="horizontal"
          className="chat-sidebar-header shrink-0 border-b border-border/50 px-2 pb-3 pt-3"
        >
          {desktopPanelMode ? (
            <AstryxView
              layout="block"
              direction="horizontal"
              className="hidden h-8 items-center px-2 text-base font-semibold md:flex"
            >
              {t("chat.recentConversation")}
            </AstryxView>
          ) : null}
          <AstryxView
            layout="flex"
            direction="horizontal"
            className={cn(
              "flex items-center justify-between gap-2",
              desktopPanelMode && "md:hidden",
            )}
          >
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="flex min-w-0 -translate-y-0.5 items-center gap-2"
            >
              <img
                src={iconSimpleUrl}
                alt=""
                aria-hidden="true"
                draggable={false}
                className="h-8 w-8 shrink-0 select-none rounded-xl object-contain"
              />
              <AstryxView layout="block" direction="horizontal" className="min-w-0">
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="truncate font-semibold tracking-tight"
                >
                  XAgent
                </AstryxView>
              </AstryxView>
            </AstryxView>

            {!isMacOsTauri() && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onCloseSidebar}
                title={t("sidebar.closeSidebar")}
                className="h-9 w-9 shrink-0 rounded-2xl text-muted-foreground hover:text-foreground"
              >
                <PanelLeftClose className="h-4 w-4" />
              </Button>
            )}
          </AstryxView>

          <AstryxView
            layout="flex"
            direction="vertical"
            className="chat-sidebar-primary-nav mt-3 flex flex-col gap-0.5"
          >
            <Button
              type="button"
              variant="ghost"
              onClick={onNewConversation}
              className={cn(
                "chat-history-new-conversation-button h-[30px] w-full justify-start gap-3 rounded-lg px-3 text-[calc(14px*var(--zone-font-scale,1))] font-normal leading-5 shadow-none transition-colors",
                activeView === "chat"
                  ? "text-foreground/90 hover:bg-foreground/[0.08] hover:text-foreground focus-visible:bg-foreground/[0.08]"
                  : "text-foreground/80 hover:bg-foreground/[0.08] hover:text-foreground focus-visible:bg-foreground/[0.08]",
              )}
            >
              <CirclePlus className="h-4 w-4 shrink-0 text-foreground/85" />
              <AstryxInline className="chat-history-new-conversation-label">
                {t("chat.newConversation")}
              </AstryxInline>
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenSkillsHub?.()}
              className={cn(
                "sidebar-hub-menu-item h-[30px] w-full justify-start gap-3 rounded-lg px-3 text-[calc(14px*var(--zone-font-scale,1))] font-normal leading-5 shadow-none transition-colors",
                desktopPanelMode && "md:hidden",
                activeView === "skills-hub"
                  ? "bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.08] hover:text-foreground focus-visible:bg-foreground/[0.08]"
                  : "text-foreground/80 hover:bg-foreground/[0.08] hover:text-foreground focus-visible:bg-foreground/[0.08]",
              )}
              title="Skills Hub"
            >
              <Blend
                className={cn(
                  "h-4 w-4 shrink-0",
                  activeView === "skills-hub" ? "text-amber-500" : "text-foreground/85",
                )}
              />
              <AstryxInline className="truncate">Skills</AstryxInline>
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenMcpHub?.()}
              className={cn(
                "sidebar-hub-menu-item h-[30px] w-full justify-start gap-3 rounded-lg px-3 text-[calc(14px*var(--zone-font-scale,1))] font-normal leading-5 shadow-none transition-colors",
                desktopPanelMode && "md:hidden",
                activeView === "mcp-hub"
                  ? "bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.08] hover:text-foreground focus-visible:bg-foreground/[0.08]"
                  : "text-foreground/80 hover:bg-foreground/[0.08] hover:text-foreground focus-visible:bg-foreground/[0.08]",
              )}
              title="MCP Hub"
            >
              <Cable
                className={cn(
                  "h-4 w-4 shrink-0",
                  activeView === "mcp-hub" ? "text-violet-500" : "text-foreground/85",
                )}
              />
              <AstryxInline className="truncate">MCP</AstryxInline>
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenWorkspaceTool?.("fileTree")}
              disabled={!fileTreeAvailable || !onOpenWorkspaceTool}
              className={cn(
                "sidebar-hub-menu-item h-[30px] w-full justify-start gap-3 rounded-lg px-3 text-[calc(14px*var(--zone-font-scale,1))] font-normal leading-5 text-foreground/80 shadow-none transition-colors hover:bg-foreground/[0.08] hover:text-foreground focus-visible:bg-foreground/[0.08]",
                desktopPanelMode && "md:hidden",
              )}
              title={t("sidebar.myFiles")}
            >
              <FolderTree className="h-4 w-4 shrink-0 text-sky-500" />
              <AstryxInline className="truncate">{t("sidebar.myFiles")}</AstryxInline>
            </Button>
          </AstryxView>
        </AstryxView>

        <AstryxView
          layout="grid"
          direction="horizontal"
          ref={sidebarSectionsRef}
          style={{ gridTemplateRows: sidebarSectionLayout.gridTemplateRows }}
          className={cn(
            "grid min-h-0 flex-1 content-start",
            isProjectSectionResizing ? undefined : SIDEBAR_SECTION_ROWS_TRANSITION_CLASS,
          )}
        >
          {showProjects ? (
            <>
              <AstryxView
                layout="flex"
                direction="horizontal"
                ref={projectsHeaderRef}
                className="group/workspace-header flex items-center justify-between px-2 pb-1 pt-2"
              >
                <AstryxButton
                  type="button"
                  aria-expanded={!projectsCollapsed}
                  className="group flex min-w-0 items-center gap-1 rounded-md px-3 py-1 text-xs font-semibold text-muted-foreground outline-hidden"
                  onClick={() => onProjectsCollapsedChange?.(!projectsCollapsed)}
                >
                  <AstryxInline>{t("chat.workspaceSection")}</AstryxInline>
                  <ChevronRight
                    aria-hidden="true"
                    className="h-3.5 w-3.5 shrink-0 opacity-60 transition-[opacity,transform] duration-300 ease-in-out md:opacity-0 md:group-hover:opacity-100"
                    style={{ transform: `rotate(${projectsCollapsed ? 0 : 90}deg)` }}
                  />
                </AstryxButton>
                <AstryxView layout="flex" direction="horizontal" className="flex items-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(
                      PROJECT_ICON_BUTTON_CLASS,
                      "pointer-events-auto opacity-100 transition-opacity hover:!bg-transparent md:pointer-events-none md:opacity-0 md:group-hover/workspace-header:pointer-events-auto md:group-hover/workspace-header:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100",
                    )}
                    title={t("chat.workspaceGroupCreate")}
                    aria-label={t("chat.workspaceGroupCreate")}
                    onClick={() => {
                      setCreatingWorkspaceGroup(true);
                      setWorkspaceGroupDraft("");
                    }}
                    disabled={!onCreateWorkspaceGroup}
                  >
                    <FolderTree className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(
                      PROJECT_ICON_BUTTON_CLASS,
                      "pointer-events-auto opacity-100 transition-opacity hover:!bg-transparent md:pointer-events-none md:opacity-0 md:group-hover/workspace-header:pointer-events-auto md:group-hover/workspace-header:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100",
                    )}
                    title={t("chat.workspaceCreate")}
                    aria-label={t("chat.workspaceCreate")}
                    onClick={() => onCreateProject?.()}
                    disabled={!onCreateProject}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </AstryxView>
              </AstryxView>
              <AstryxView
                layout="block"
                direction="horizontal"
                aria-hidden={projectsCollapsed}
                inert={projectsCollapsed}
                className={cn(
                  "min-h-0 overflow-y-auto overflow-x-hidden transition-opacity duration-300 ease-out motion-reduce:transition-none",
                  projectsCollapsed ? "opacity-0" : "opacity-100",
                )}
              >
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  ref={projectsBodyRef}
                  className="space-y-0.5 px-2 pb-0.5"
                >
                  {creatingWorkspaceGroup ? (
                    <AstryxView
                      layout="flex"
                      direction="horizontal"
                      className="flex h-8 items-center gap-1 px-1"
                    >
                      <Input
                        autoFocus
                        value={workspaceGroupDraft}
                        placeholder={t("chat.workspaceGroupName")}
                        onChange={(event) => setWorkspaceGroupDraft(event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && workspaceGroupDraft.trim()) {
                            onCreateWorkspaceGroup?.(workspaceGroupDraft);
                            setCreatingWorkspaceGroup(false);
                            setWorkspaceGroupDraft("");
                          } else if (event.key === "Escape") {
                            setCreatingWorkspaceGroup(false);
                            setWorkspaceGroupDraft("");
                          }
                        }}
                        className="h-7 min-w-0 flex-1 text-xs"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={!workspaceGroupDraft.trim()}
                        onClick={() => {
                          onCreateWorkspaceGroup?.(workspaceGroupDraft);
                          setCreatingWorkspaceGroup(false);
                          setWorkspaceGroupDraft("");
                        }}
                        className="h-7 w-7"
                        aria-label={t("chat.workspaceGroupSave")}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setCreatingWorkspaceGroup(false);
                          setWorkspaceGroupDraft("");
                        }}
                        className="h-7 w-7"
                        aria-label={t("chat.cancel")}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </AstryxView>
                  ) : null}
                  {workspaceProjectGroups.map((group) => {
                    const groupProjects = activeProjects.filter(
                      (project) =>
                        activeProjectGroupIds.get(workspaceProjectPathKey(project.path)) ===
                        group.id,
                    );
                    const isRenamingGroup = renamingWorkspaceGroupId === group.id;
                    return (
                      <AstryxView
                        layout="block"
                        direction="horizontal"
                        key={group.id}
                        className="pt-0.5"
                      >
                        <AstryxView
                          layout="flex"
                          direction="horizontal"
                          className="group/workspace-group flex h-7 items-center gap-1 rounded-md px-1"
                        >
                          {isRenamingGroup ? (
                            <AstryxView
                              layout="flex"
                              direction="horizontal"
                              className="flex min-w-0 flex-1 items-center gap-1"
                            >
                              <Input
                                autoFocus
                                value={workspaceGroupDraft}
                                onChange={(event) =>
                                  setWorkspaceGroupDraft(event.currentTarget.value)
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" && workspaceGroupDraft.trim()) {
                                    onRenameWorkspaceGroup?.(group.id, workspaceGroupDraft);
                                    setRenamingWorkspaceGroupId(null);
                                    setWorkspaceGroupDraft("");
                                  } else if (event.key === "Escape") {
                                    setRenamingWorkspaceGroupId(null);
                                    setWorkspaceGroupDraft("");
                                  }
                                }}
                                className="h-6 min-w-0 flex-1 text-xs"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                disabled={!workspaceGroupDraft.trim()}
                                onClick={() => {
                                  onRenameWorkspaceGroup?.(group.id, workspaceGroupDraft);
                                  setRenamingWorkspaceGroupId(null);
                                  setWorkspaceGroupDraft("");
                                }}
                                aria-label={t("chat.workspaceGroupSave")}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                            </AstryxView>
                          ) : (
                            <>
                              <AstryxButton
                                type="button"
                                onClick={() => onToggleWorkspaceGroupCollapsed?.(group.id)}
                                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 text-left text-[calc(11.5px*var(--zone-font-scale,1))] font-medium text-muted-foreground hover:text-foreground"
                              >
                                <ChevronRight
                                  className={cn(
                                    "h-3 w-3 shrink-0 transition-transform duration-200",
                                    !group.collapsed && "rotate-90",
                                  )}
                                />
                                <AstryxInline className="min-w-0 flex-1 truncate">
                                  {group.name}
                                </AstryxInline>
                                <AstryxInline className="shrink-0 text-[10px] text-muted-foreground/65">
                                  {groupProjects.length}
                                </AstryxInline>
                              </AstryxButton>
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  render={
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className={cn(
                                        PROJECT_ICON_BUTTON_CLASS,
                                        "opacity-100 md:opacity-0 md:group-hover/workspace-group:opacity-100",
                                      )}
                                      aria-label={t("chat.workspaceGroupMore")}
                                    />
                                  }
                                >
                                  <MoreHorizontal className="h-3.5 w-3.5" />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                  side="right"
                                  align="start"
                                  collisionPadding={12}
                                >
                                  <DropdownMenuItem
                                    className="gap-2"
                                    onSelect={() => {
                                      setRenamingWorkspaceGroupId(group.id);
                                      setWorkspaceGroupDraft(group.name);
                                    }}
                                  >
                                    <Edit3 className="h-3.5 w-3.5" />
                                    {t("chat.workspaceGroupRename")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
                                    onSelect={() => onDeleteWorkspaceGroup?.(group.id)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    {t("chat.workspaceGroupDelete")}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </>
                          )}
                        </AstryxView>
                        {!group.collapsed ? groupProjects.map(renderActiveProjectRow) : null}
                      </AstryxView>
                    );
                  })}
                  {workspaceProjectGroups.length > 0 && renderedProjects.length > 0 ? (
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="px-2 pt-1 text-[calc(10.5px*var(--zone-font-scale,1))] font-medium text-muted-foreground/70"
                    >
                      {t("chat.workspaceUngrouped")}
                    </AstryxView>
                  ) : null}
                  {renderedProjects.map(renderActiveProjectRow)}
                  {hiddenProjectCount > 0 || showAllProjects ? (
                    <AstryxButton
                      type="button"
                      onClick={() => setShowAllProjects((current) => !current)}
                      className="flex w-full items-center justify-center rounded-md px-2 py-1.5 text-[calc(11.5px*var(--zone-font-scale,1))] font-medium text-muted-foreground/80 transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {showAllProjects
                        ? t("chat.workspaceShowLess")
                        : t("chat.workspaceShowAll").replace(
                            "{count}",
                            String(ungroupedActiveProjects.length),
                          )}
                    </AstryxButton>
                  ) : null}
                  {archivedProjects.length > 0 ? (
                    <AstryxView layout="block" direction="horizontal" className="pt-0.5">
                      <AstryxButton
                        type="button"
                        onClick={() => setArchivedGroupOpen((current) => !current)}
                        className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-[calc(11.5px*var(--zone-font-scale,1))] font-medium text-muted-foreground/80 transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <ChevronRight
                          className={cn(
                            "h-3 w-3 shrink-0 transition-transform duration-200",
                            archivedGroupOpen && "rotate-90",
                          )}
                        />
                        {t("chat.workspaceArchivedGroup").replace(
                          "{count}",
                          String(archivedProjects.length),
                        )}
                      </AstryxButton>
                      {archivedGroupOpen
                        ? archivedProjects.map((project) => {
                            const pathKey = workspaceProjectPathKey(project.path);
                            return (
                              <ProjectRow
                                key={project.id}
                                project={project}
                                isActive={activeProjectId === project.id}
                                isMissing={missingProjectPathKeys.has(pathKey)}
                                isRunning={runningProjectPathKeys.has(pathKey)}
                                isRenaming={projectRenamingId === project.id}
                                isPendingRemove={pendingProjectRemoveId === project.id}
                                renameDraft={projectRenameDraft}
                                onSelectProject={handleSelectProject}
                                onBrowseProjectInFileTree={
                                  onBrowseProjectInFileTree
                                    ? handleBrowseProjectInFileTree
                                    : undefined
                                }
                                onBrowseProjectInSystemFileManager={
                                  onBrowseProjectInSystemFileManager
                                    ? handleBrowseProjectInSystemFileManager
                                    : undefined
                                }
                                onStartRenamingProject={handleStartRenamingProject}
                                onProjectRenameDraftChange={handleProjectRenameDraftChange}
                                onCommitProjectRename={handleCommitProjectRename}
                                onCancelProjectRename={handleCancelProjectRename}
                                onSetProjectPinned={handleSetProjectPinned}
                                onRemoveProject={handleRemoveProject}
                                workspaceProjectGroups={workspaceProjectGroups}
                                currentGroupId={activeProjectGroupIds.get(pathKey) ?? null}
                                onMoveProjectToGroup={
                                  onMoveProjectToGroup ? handleMoveProjectToGroup : undefined
                                }
                                isArchived
                                canArchive={false}
                                onArchiveProject={handleArchiveProject}
                                onUnarchiveProject={handleUnarchiveProject}
                                onSetPendingRemove={setPendingProjectRemoveId}
                                touchActions={mobileExperience}
                              />
                            );
                          })
                        : null}
                    </AstryxView>
                  ) : null}
                </AstryxView>
              </AstryxView>
              <AstryxButton
                ref={sectionResizeHandleRef}
                type="button"
                aria-label={t("chat.resizeSidebarSections")}
                title={t("chat.resizeSidebarSections")}
                disabled={!canResizeProjectSections}
                onPointerDown={handleProjectSectionResizeStart}
                className={cn(
                  "group items-center justify-center border-0 bg-transparent p-0 focus-visible:outline-none",
                  canResizeProjectSections
                    ? "hidden h-2 cursor-row-resize touch-none md:flex"
                    : "flex h-0 overflow-hidden",
                )}
              >
                <AstryxInline
                  aria-hidden="true"
                  className={cn(
                    "h-0.5 w-10 rounded-full bg-muted-foreground/25 opacity-70 shadow-sm transition-[width,background-color,opacity]",
                    "group-hover:w-16 group-hover:bg-primary/60 group-hover:opacity-100 group-focus-visible:w-16 group-focus-visible:bg-primary group-focus-visible:opacity-100",
                    isProjectSectionResizing && "w-20 bg-primary opacity-100",
                    !canResizeProjectSections && "hidden",
                  )}
                />
              </AstryxButton>
            </>
          ) : null}

          <AstryxView
            layout="grid"
            direction="horizontal"
            ref={recentHeaderRef}
            className={cn(
              "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2 pb-2",
              showProjects ? "border-t border-border/35 pt-0.5" : "pt-3",
            )}
          >
            <AstryxButton
              type="button"
              aria-expanded={!recentCollapsed}
              className="group flex min-w-0 items-center gap-1 rounded-md px-3 py-1 text-xs font-semibold text-muted-foreground outline-hidden"
              onClick={() => onRecentCollapsedChange?.(!recentCollapsed)}
            >
              <AstryxInline className="min-w-0 truncate">
                {t("chat.recentConversation")}
              </AstryxInline>
              <ChevronRight
                aria-hidden="true"
                className="h-3.5 w-3.5 shrink-0 opacity-60 transition-[opacity,transform] duration-300 ease-in-out md:opacity-0 md:group-hover:opacity-100"
                style={{ transform: `rotate(${recentCollapsed ? 0 : 90}deg)` }}
              />
            </AstryxButton>
            {selectionMode ? (
              <AstryxView
                layout="flex"
                direction="horizontal"
                className="flex min-w-0 items-center gap-0.5"
              >
                <AstryxInline className="mr-1 whitespace-nowrap text-[11px] text-muted-foreground">
                  {t("chat.history.selectedCount").replace(
                    "{count}",
                    String(selectedConversationIds.size),
                  )}
                </AstryxInline>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={PROJECT_ICON_BUTTON_CLASS}
                        title={t("chat.history.moveSelected")}
                        aria-label={t("chat.history.moveSelected")}
                        disabled={batchMutationRunning || activeProjects.length === 0}
                      />
                    }
                  >
                    {batchMutationRunning ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <FolderTree className="h-3.5 w-3.5" />
                    )}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    sideOffset={4}
                    collisionPadding={12}
                    className="sidebar-context-menu min-w-[12rem] rounded-xl border-border/60 bg-background/95 backdrop-blur-xl"
                  >
                    {activeProjects.map((project) => (
                      <DropdownMenuItem
                        key={project.id}
                        disabled={batchMutationRunning}
                        onSelect={() => runBatchMove(project.path)}
                        className="gap-2"
                      >
                        <FolderClosed className="h-3.5 w-3.5 shrink-0" />
                        <AstryxInline className="min-w-0 truncate">{project.name}</AstryxInline>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    PROJECT_ICON_BUTTON_CLASS,
                    batchDeleteConfirm && "text-destructive hover:text-destructive",
                  )}
                  title={
                    batchDeleteConfirm
                      ? t("chat.history.confirmDeleteSelected")
                      : t("chat.history.deleteSelected")
                  }
                  aria-label={
                    batchDeleteConfirm
                      ? t("chat.history.confirmDeleteSelected")
                      : t("chat.history.deleteSelected")
                  }
                  onClick={runBatchDelete}
                  disabled={batchMutationRunning}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={PROJECT_ICON_BUTTON_CLASS}
                  title={t("chat.history.cancelSelection")}
                  aria-label={t("chat.history.cancelSelection")}
                  onClick={leaveConversationSelection}
                  disabled={batchMutationRunning}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </AstryxView>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={PROJECT_ICON_BUTTON_CLASS}
                title={t("chat.history.search")}
                aria-label={t("chat.history.search")}
                onClick={() => {
                  setHistorySearchOpen((open) => {
                    if (open) onSearchQueryChange("");
                    return !open;
                  });
                }}
              >
                {searchStatus === "loading" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Search className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
          </AstryxView>

          <AstryxView
            layout="flex"
            direction="vertical"
            aria-hidden={recentCollapsed}
            inert={recentCollapsed}
            className={cn(
              "flex min-h-0 flex-col transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none",
              recentCollapsed
                ? "pointer-events-none -translate-y-2 opacity-0"
                : "translate-y-0 opacity-100",
            )}
          >
            {historySearchOpen ? (
              <AstryxView layout="block" direction="horizontal" className="shrink-0 px-2 pb-2">
                <AstryxView layout="block" direction="horizontal" className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    autoFocus
                    value={searchQuery}
                    onChange={(event) => onSearchQueryChange(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        onSearchQueryChange("");
                        setHistorySearchOpen(false);
                      }
                    }}
                    placeholder={t("chat.history.searchPlaceholder")}
                    aria-label={t("chat.history.search")}
                    className="h-8 pl-8 pr-8 text-xs"
                  />
                  {searchQuery ? (
                    <AstryxButton
                      type="button"
                      onClick={() => onSearchQueryChange("")}
                      className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={t("chat.history.searchClear")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </AstryxButton>
                  ) : null}
                </AstryxView>
              </AstryxView>
            ) : null}
            {errorMessage ? (
              <AstryxView layout="block" direction="horizontal" className="shrink-0 px-2 pb-2">
                <SidebarStateCard
                  title={errorMessage}
                  description={errorDetail ?? undefined}
                  tone="error"
                  onDismiss={onDismissError}
                  dismissLabel={t("chat.cancel")}
                />
              </AstryxView>
            ) : null}
            <AstryxView
              layout="block"
              direction="horizontal"
              ref={historyScrollRef}
              aria-busy={isListLoading || isLoadingMore}
              className="chat-history-list min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3"
            >
              {/* Render priority: skeleton (loading with zero rows) → rows
                  (with a syncing pill) → empty state only when ready without
                  error. The error banner above never replaces the rows. The
                  scope-keyed wrapper replays a soft enter transition when the
                  workspace scope changes. */}
              {searchQuery.trim() ? (
                <AstryxView layout="block" direction="horizontal" className="space-y-1 pt-1">
                  {searchStatus === "loading" ? (
                    <AstryxView
                      layout="flex"
                      direction="horizontal"
                      className="flex items-center gap-2 px-2 py-4 text-xs text-muted-foreground"
                    >
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t("chat.history.searching")}
                    </AstryxView>
                  ) : searchStatus === "error" ? (
                    <AstryxParagraph className="px-2 py-4 text-xs text-destructive">
                      {t("chat.history.searchFailed")}
                    </AstryxParagraph>
                  ) : searchStatus === "ready" && searchResults.length === 0 ? (
                    <AstryxParagraph className="px-2 py-4 text-center text-xs text-muted-foreground">
                      {t("chat.history.searchEmpty")}
                    </AstryxParagraph>
                  ) : (
                    searchResults.map((result, index) => (
                      <AstryxButton
                        key={`${result.conversationId}:${result.updatedAt}:${index}`}
                        type="button"
                        onClick={() => onSelectConversation(result.conversationId)}
                        className="w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <AstryxInline className="block truncate text-xs font-medium text-foreground/90">
                          {result.title || t("tray.untitledConversation")}
                        </AstryxInline>
                        <AstryxInline className="mt-0.5 line-clamp-2 block text-[11px] leading-4 text-muted-foreground">
                          {result.snippet.replaceAll("[", "").replaceAll("]", "")}
                        </AstryxInline>
                        {result.cwd ? (
                          <AstryxInline className="mt-0.5 block truncate text-[10px] text-muted-foreground/65">
                            {result.cwd}
                          </AstryxInline>
                        ) : null}
                      </AstryxButton>
                    ))
                  )}
                </AstryxView>
              ) : isListLoading && items.length === 0 ? (
                <HistoryListLoadingSkeleton />
              ) : (
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  key={scopeKey || "scope"}
                  className="chat-history-scope-enter"
                >
                  {listStatus === "syncing" ? (
                    <AstryxView
                      layout="flex"
                      direction="horizontal"
                      className="flex items-center gap-2 px-2 pb-1 pt-1 text-[calc(11px*var(--zone-font-scale,1))] font-medium text-muted-foreground/75"
                    >
                      <AstryxView
                        as="span"
                        layout="flex"
                        direction="horizontal"
                        className="relative flex h-2 w-2 shrink-0"
                        aria-hidden="true"
                      >
                        <AstryxView
                          as="span"
                          layout="inline-flex"
                          direction="horizontal"
                          className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/35 opacity-75"
                        />
                        <AstryxView
                          as="span"
                          layout="inline-flex"
                          direction="horizontal"
                          className="relative inline-flex h-2 w-2 rounded-full bg-primary/70"
                        />
                      </AstryxView>
                      <AstryxInline>{t("chat.history.syncing")}</AstryxInline>
                    </AstryxView>
                  ) : null}
                  {items.length === 0 ? (
                    listStatus === "ready" && !errorMessage ? (
                      <AstryxView
                        layout="flex"
                        direction="horizontal"
                        className="flex items-center justify-center px-4 py-8 text-center"
                      >
                        <AstryxParagraph className="text-xs font-medium text-muted-foreground/60">
                          {t("chat.emptyChatHistory")}
                        </AstryxParagraph>
                      </AstryxView>
                    ) : null
                  ) : (
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="relative"
                      style={{ height: historyVirtualizer.getTotalSize() }}
                    >
                      {virtualHistoryRows.map((virtualRow) => {
                        const item = items[virtualRow.index];
                        if (!item) return null;

                        return (
                          <AstryxView
                            layout="block"
                            direction="horizontal"
                            key={virtualRow.key}
                            data-index={virtualRow.index}
                            ref={historyVirtualizer.measureElement}
                            className="absolute inset-x-0 top-0 pb-0.5"
                            style={{ transform: `translateY(${virtualRow.start}px)` }}
                          >
                            {renderHistoryRow(item)}
                          </AstryxView>
                        );
                      })}
                    </AstryxView>
                  )}
                </AstryxView>
              )}
              {!searchQuery.trim() && items.length > 0 && (hasMore || isLoadingMore) ? (
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="px-2 pb-2 pt-1 text-center text-[calc(11px*var(--zone-font-scale,1))] leading-5 text-muted-foreground/70"
                >
                  {isLoadingMore
                    ? t("sidebar.loadingMoreHistory")
                    : t("sidebar.continueLoadingHistory")}
                </AstryxView>
              ) : null}
            </AstryxView>
          </AstryxView>
        </AstryxView>
        <AstryxView
          layout="block"
          direction="horizontal"
          className={cn(
            "shrink-0 border-t border-border bg-body px-2 py-1.5",
            desktopPanelMode && "md:hidden",
          )}
        >
          {soulLauncherOpen && !mobileExperience ? (
            <AstryxView
              layout="block"
              direction="horizontal"
              className="mb-1.5 space-y-0.5 rounded-xl border border-border bg-background p-1.5 shadow-sm"
            >
              <SoulPresetPicker
                presets={soul.presets}
                activeId={soul.activeId}
                saving={soul.saving}
                onSelect={(presetId) => {
                  void soul.select(presetId).catch(() => undefined);
                  setSoulLauncherOpen(false);
                }}
                onCreate={() => {
                  setSoulLauncherOpen(false);
                  onCreateSoul();
                }}
              />
              {!mobileExperience ? (
                <>
                  <AstryxView
                    layout="block"
                    direction="horizontal"
                    className="mx-1 my-1 border-t border-border/50"
                  />
                  <AstryxButton
                    type="button"
                    onClick={() => {
                      onOpenWorkspaceTool?.("terminal");
                      setSoulLauncherOpen(false);
                    }}
                    disabled={!workspaceToolsAvailable || !onOpenWorkspaceTool}
                    className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[calc(13px*var(--zone-font-scale,1))] text-foreground/85 transition-colors hover:bg-foreground/[0.07] disabled:opacity-45"
                  >
                    <Terminal className="h-4 w-4 text-muted-foreground" />
                    <AstryxInline className="min-w-0 flex-1">{t("sidebar.terminal")}</AstryxInline>
                  </AstryxButton>
                  {[
                    {
                      target: "gitReview" as const,
                      label: t("sidebar.gitReview"),
                      icon: <GitBranch className="h-4 w-4 text-muted-foreground" />,
                    },
                    {
                      target: "sshConnection" as const,
                      label: t("sidebar.sshConnection"),
                      icon: <Key className="h-4 w-4 text-muted-foreground" />,
                    },
                    {
                      target: "backgroundTasks" as const,
                      label: t("sidebar.backgroundTasks"),
                      icon: <Cpu className="h-4 w-4 text-muted-foreground" />,
                    },
                  ].map((item) => (
                    <AstryxButton
                      key={item.target}
                      type="button"
                      onClick={() => {
                        onOpenWorkspaceTool?.(item.target);
                        setSoulLauncherOpen(false);
                      }}
                      disabled={!workspaceToolsAvailable || !onOpenWorkspaceTool}
                      className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[calc(13px*var(--zone-font-scale,1))] text-foreground/85 transition-colors hover:bg-foreground/[0.07] disabled:opacity-45"
                    >
                      {item.icon}
                      <AstryxInline>{item.label}</AstryxInline>
                    </AstryxButton>
                  ))}
                  <AstryxView
                    layout="block"
                    direction="horizontal"
                    className="mx-1 my-1 border-t border-border/50"
                  />
                  <AstryxButton
                    type="button"
                    onClick={onOpenSettings}
                    className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[calc(13px*var(--zone-font-scale,1))] text-foreground/85 transition-colors hover:bg-foreground/[0.07]"
                  >
                    <Settings className="h-4 w-4 text-muted-foreground" />
                    <AstryxInline>{t("tooltip.settings")}</AstryxInline>
                  </AstryxButton>
                </>
              ) : null}
            </AstryxView>
          ) : null}
          <AstryxView
            layout="grid"
            direction="horizontal"
            className="mobile-chat-sidebar-footer grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2"
          >
            <Button
              type="button"
              variant="ghost"
              onPointerDown={(event) => {
                if (!mobileExperience) return;
                suppressSoulClickRef.current = false;
                soulLongPressStartRef.current = {
                  pointerId: event.pointerId,
                  x: event.clientX,
                  y: event.clientY,
                };
                soulLongPressTimerRef.current = window.setTimeout(() => {
                  soulLongPressTimerRef.current = null;
                  suppressSoulClickRef.current = true;
                  setSoulLauncherOpen(true);
                  navigator.vibrate?.(8);
                }, 520);
              }}
              onPointerUp={() => {
                if (soulLongPressTimerRef.current !== null) {
                  window.clearTimeout(soulLongPressTimerRef.current);
                  soulLongPressTimerRef.current = null;
                }
                soulLongPressStartRef.current = null;
              }}
              onPointerMove={(event) => {
                const start = soulLongPressStartRef.current;
                if (
                  start &&
                  start.pointerId === event.pointerId &&
                  Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10 &&
                  soulLongPressTimerRef.current !== null
                ) {
                  window.clearTimeout(soulLongPressTimerRef.current);
                  soulLongPressTimerRef.current = null;
                }
              }}
              onPointerCancel={() => {
                if (soulLongPressTimerRef.current !== null) {
                  window.clearTimeout(soulLongPressTimerRef.current);
                  soulLongPressTimerRef.current = null;
                }
                soulLongPressStartRef.current = null;
              }}
              onClick={() => {
                if (suppressSoulClickRef.current) {
                  suppressSoulClickRef.current = false;
                  return;
                }
                if (mobileExperience) {
                  onOpenSettings();
                  return;
                }
                setSoulLauncherOpen((open) => !open);
              }}
              aria-expanded={soulLauncherOpen}
              className="h-10 w-full min-w-0 justify-start gap-2.5 rounded-xl px-2 text-[calc(13px*var(--zone-font-scale,1))] font-normal text-foreground/85 shadow-none hover:bg-foreground/[0.08] hover:text-foreground"
              title={t("sidebar.soulMenu")}
            >
              <AstryxView
                as="span"
                layout="flex"
                direction="horizontal"
                className="relative flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-violet-500/25 via-sky-500/20 to-amber-500/25 ring-1 ring-border/70"
              >
                <Sparkles className="h-3.5 w-3.5 text-violet-500" />
              </AstryxView>
              <AstryxInline className="min-w-0 flex-1 text-left">
                <AstryxInline className="block truncate font-medium">
                  {soulDocument?.metadata.name.trim() || "XGent"}
                </AstryxInline>
                <AstryxInline className="block truncate text-[10px] leading-3 text-muted-foreground">
                  {t("sidebar.soul")}
                </AstryxInline>
              </AstryxInline>
              <ChevronRight
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                  soulLauncherOpen && "-rotate-90",
                )}
              />
            </Button>
            {appUpdate?.showUpdateButton ? (
              <AppUpdateButton appUpdate={appUpdate} iconOnly />
            ) : null}
          </AstryxView>
        </AstryxView>
      </AstryxView>
      <BottomSheet
        isOpen={mobileExperience && soulLauncherOpen}
        onOpenChange={(isOpen) => {
          suppressSoulClickRef.current = false;
          setSoulLauncherOpen(isOpen);
        }}
        label={t("sidebar.soulPresets")}
        purpose="info"
        height="hug"
      >
        <VStack gap={3} padding={4}>
          <Text type="label">{t("sidebar.soul")}</Text>
          <SoulPresetPicker
            mobile
            presets={soul.presets}
            activeId={soul.activeId}
            saving={soul.saving}
            onSelect={(presetId) => {
              suppressSoulClickRef.current = false;
              setSoulLauncherOpen(false);
              void soul.select(presetId).catch(() => undefined);
            }}
            onCreate={() => {
              suppressSoulClickRef.current = false;
              setSoulLauncherOpen(false);
              onCreateSoul();
            }}
          />
        </VStack>
      </BottomSheet>
    </AstryxView>
  );
});
