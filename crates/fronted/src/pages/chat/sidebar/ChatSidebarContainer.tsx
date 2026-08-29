// Container between the sidebar store and the GUI sidebar view. Owns every
// rendering subscription to the store (so sidebar commits never re-render
// ChatPage), the conversation-rename UI state, the delete flow, and the
// error-code → i18n mapping for every frontend target.

import { Button as AstryxButton } from "@astryxdesign/core/Button";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChatHistorySidebar } from "../../../components/chat/ChatHistorySidebar";
import type { WorkspaceToolTarget } from "../../../components/project-tools/workspaceToolsModel";
import { useLocale } from "../../../i18n";
import type { AppUpdateController } from "../../../lib/appUpdates";
import {
  type ChatHistorySearchMatch,
  searchChatHistory,
} from "../../../lib/chat/history/chatHistory";
import { normalizeConversationTitle } from "../../../lib/chat/page/chatPageHelpers";
import type { WorkspaceProject, WorkspaceProjectGroup } from "../../../lib/settings";
import {
  selectConversations,
  selectListState,
  selectProjectActivityInputs,
  selectRunningConversationIds,
  sidebarShallowEqual,
} from "../../../lib/sidebar/selectors";
import type { SidebarSnapshot, SidebarStore } from "../../../lib/sidebar/store";
import type { SidebarConversation } from "../../../lib/sidebar/types";
import { useSidebarSelector } from "../../../lib/sidebar/useSidebarSelector";
import { sortWorkspaceProjectsByActivity } from "../../../lib/workspaceProjects";

type ChatSidebarContainerProps = {
  store: SidebarStore;
  currentConversationId: string;
  isOpen: boolean;
  desktopWidth?: number;
  fontScale?: number;
  activeView: "chat" | "skills-hub" | "mcp-hub";
  showProjects: boolean;
  // Merged (settings ∪ history workdirs) but unsorted — the container sorts
  // with the store's activity/running inputs.
  projects: WorkspaceProject[];
  workspaceProjectGroups: WorkspaceProjectGroup[];
  activeProjectId?: string;
  missingProjectPathKeys: ReadonlySet<string>;
  projectRenamingId: string | null;
  projectRenameDraft: string;
  projectsCollapsed: boolean;
  recentCollapsed: boolean;
  onProjectsCollapsedChange: (collapsed: boolean) => void;
  onRecentCollapsedChange: (collapsed: boolean) => void;
  onCreateProject?: () => void;
  onCreateWorkspaceGroup: (name: string) => void;
  onRenameWorkspaceGroup: (groupId: string, name: string) => void;
  onDeleteWorkspaceGroup: (groupId: string) => void;
  onMoveProjectToGroup: (projectPath: string, groupId: string | null) => void;
  onToggleWorkspaceGroupCollapsed: (groupId: string) => void;
  onSelectProject: (project: WorkspaceProject) => void;
  onOpenWorkspaceSettings?: (project: WorkspaceProject) => void;
  onNewConversationForProject: (project: WorkspaceProject) => void;
  onBrowseProjectInFileTree?: (project: WorkspaceProject) => void;
  onBrowseProjectInSystemFileManager?: (project: WorkspaceProject) => void;
  onStartRenamingProject: (project: WorkspaceProject) => void;
  onProjectRenameDraftChange: (value: string) => void;
  onCommitProjectRename: () => void;
  onCancelProjectRename: () => void;
  onSetProjectPinned: (project: WorkspaceProject, isPinned: boolean) => void;
  onRemoveProject: (project: WorkspaceProject) => void;
  onArchiveProject: (project: WorkspaceProject) => void;
  onUnarchiveProject: (project: WorkspaceProject) => void;
  archivedProjectPathKeys?: ReadonlySet<string>;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  onOpenConversationInSplit?: (id: string) => void;
  // Invoked after the store confirmed a deletion; ChatPage cleans artifacts
  // and replaces the current conversation when needed.
  onConversationDeleted: (id: string) => void;
  onConversationCwdChanged: (id: string, cwd: string) => void;
  onCloseSidebar: () => void;
  onOpenSettings: () => void;
  onCreateSoul: () => void;
  appUpdate?: AppUpdateController;
  onOpenSkillsHub: () => void;
  onOpenMcpHub: () => void;
  mobileExperience?: boolean;
  desktopPanelMode?: boolean;
  workspaceToolsAvailable?: boolean;
  fileTreeAvailable?: boolean;
  onOpenWorkspaceTool?: (target: WorkspaceToolTarget, shell?: string) => void;
};

function selectMutations(snapshot: SidebarSnapshot) {
  return snapshot.mutations;
}

function selectMutationErrors(snapshot: SidebarSnapshot) {
  return snapshot.mutationErrors;
}

export function ChatSidebarContainer(props: ChatSidebarContainerProps) {
  const { store, projects, onConversationDeleted, onConversationCwdChanged } = props;
  const { t } = useLocale();

  const items = useSidebarSelector(store, selectConversations);
  const listState = useSidebarSelector(store, selectListState, sidebarShallowEqual);
  const scopeKey = useSidebarSelector(store, (snapshot) => snapshot.scopeKey);
  const runningConversationIds = useSidebarSelector(store, selectRunningConversationIds);
  const busyConversationIds = useSidebarSelector(store, selectMutations);
  const mutationErrors = useSidebarSelector(store, selectMutationErrors);
  const projectActivityInputs = useSidebarSelector(
    store,
    selectProjectActivityInputs,
    sidebarShallowEqual,
  );

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ChatHistorySearchMatch[]>([]);
  const [searchStatus, setSearchStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setSearchStatus("idle");
      return;
    }
    let active = true;
    setSearchStatus("loading");
    const timer = window.setTimeout(() => {
      void searchChatHistory(query)
        .then((matches) => {
          if (!active) return;
          setSearchResults(matches);
          setSearchStatus("ready");
        })
        .catch(() => {
          if (!active) return;
          setSearchResults([]);
          setSearchStatus("error");
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

  const sortedProjects = useMemo(
    () =>
      sortWorkspaceProjectsByActivity(projects, {
        projectActivityUpdatedAts: projectActivityInputs.workdirActivity,
        runningProjectPathKeys: projectActivityInputs.runningWorkdirPathKeys,
      }),
    [projectActivityInputs.runningWorkdirPathKeys, projectActivityInputs.workdirActivity, projects],
  );

  const handleStartRenaming = useCallback(
    (item: SidebarConversation) => {
      store.clearMutationError(item.id);
      setRenamingId(item.id);
      setRenameDraft(item.title);
    },
    [store],
  );

  const handleCommitRename = () => {
    const id = renamingId;
    setRenamingId(null);
    setRenameDraft("");
    if (!id) {
      return;
    }
    const title = normalizeConversationTitle(renameDraft);
    const current = store.peek(id);
    if (!title || !current || title === current.title) {
      return;
    }
    void store.rename(id, title);
  };

  const handleCancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameDraft("");
  }, []);

  const handleSetPinned = useCallback(
    (id: string, isPinned: boolean) => {
      store.clearMutationError(id);
      void store.setPinned(id, isPinned);
    },
    [store],
  );

  const handleMoveToWorkspace = useCallback(
    (id: string, cwd: string) => {
      store.clearMutationError(id);
      void store.setCwd(id, cwd).then((moved) => {
        if (moved) onConversationCwdChanged(id, cwd);
      });
    },
    [onConversationCwdChanged, store],
  );

  const handleMoveConversationsToWorkspace = useCallback(
    async (ids: readonly string[], cwd: string) => {
      const results = await Promise.all(
        ids.map(async (id) => {
          store.clearMutationError(id);
          const moved = await store.setCwd(id, cwd);
          if (moved) onConversationCwdChanged(id, cwd);
          return { id, moved };
        }),
      );
      return results.filter((result) => !result.moved).map((result) => result.id);
    },
    [onConversationCwdChanged, store],
  );

  const handleDeleteConversation = useCallback(
    (id: string) => {
      store.clearMutationError(id);
      void store.remove(id).then((removed) => {
        if (removed) {
          onConversationDeleted(id);
        }
      });
    },
    [onConversationDeleted, store],
  );

  const handleDeleteConversations = useCallback(
    async (ids: readonly string[]) => {
      const results = await Promise.all(
        ids.map(async (id) => {
          store.clearMutationError(id);
          const removed = await store.remove(id);
          if (removed) onConversationDeleted(id);
          return { id, removed };
        }),
      );
      return results.filter((result) => !result.removed).map((result) => result.id);
    },
    [onConversationDeleted, store],
  );

  const handleLoadMore = useCallback(() => {
    void store.loadMore();
  }, [store]);

  // A per-row mutation error is more actionable (and dismissable) than the
  // list error, so it takes the banner slot when both exist.
  const firstMutationError = mutationErrors.entries().next();
  let errorMessage: string | null = null;
  let errorDetail: string | null = null;
  let handleDismissError: (() => void) | undefined;
  if (!firstMutationError.done) {
    const [errorConversationId, errorCode] = firstMutationError.value;
    errorMessage = t(`chat.history.${errorCode}`);
    handleDismissError = () => store.clearMutationError(errorConversationId);
  } else if (listState.error) {
    errorMessage = t(`chat.history.${listState.error}`);
    errorDetail = listState.errorDetail;
  }

  return (
    <Fragment>
      <AstryxButton
        variant="ghost"
        label={t("sidebar.closeSidebar")}
        type="button"
        aria-label={t("sidebar.closeSidebar")}
        onClick={props.onCloseSidebar}
        className={
          props.isOpen
            ? "fixed inset-0 z-40 bg-black/25 opacity-100 backdrop-blur-[1px] transition-opacity duration-200 md:hidden"
            : "pointer-events-none fixed inset-0 z-40 bg-black/25 opacity-0 transition-opacity duration-200 md:hidden"
        }
      />
      <ChatHistorySidebar
        items={items}
        currentConversationId={props.currentConversationId}
        runningConversationIds={runningConversationIds}
        busyConversationIds={busyConversationIds}
        listStatus={listState.status}
        scopeKey={scopeKey}
        totalItems={listState.totalCount}
        hasMore={listState.hasMore}
        isLoadingMore={listState.isLoadingMore}
        errorMessage={errorMessage}
        errorDetail={errorDetail}
        onDismissError={handleDismissError}
        searchQuery={searchQuery}
        searchResults={searchResults}
        searchStatus={searchStatus}
        onSearchQueryChange={setSearchQuery}
        renamingId={renamingId}
        renameDraft={renameDraft}
        isOpen={props.isOpen}
        desktopWidth={props.desktopWidth}
        fontScale={props.fontScale}
        activeView={props.activeView}
        showProjects={props.showProjects}
        projects={sortedProjects}
        workspaceProjectGroups={props.workspaceProjectGroups}
        activeProjectId={props.activeProjectId}
        missingProjectPathKeys={props.missingProjectPathKeys}
        runningProjectPathKeys={projectActivityInputs.runningWorkdirPathKeys}
        projectRenamingId={props.projectRenamingId}
        projectRenameDraft={props.projectRenameDraft}
        projectsCollapsed={props.projectsCollapsed}
        recentCollapsed={props.recentCollapsed}
        onProjectsCollapsedChange={props.onProjectsCollapsedChange}
        onRecentCollapsedChange={props.onRecentCollapsedChange}
        onCreateProject={props.onCreateProject}
        onCreateWorkspaceGroup={props.onCreateWorkspaceGroup}
        onRenameWorkspaceGroup={props.onRenameWorkspaceGroup}
        onDeleteWorkspaceGroup={props.onDeleteWorkspaceGroup}
        onMoveProjectToGroup={props.onMoveProjectToGroup}
        onToggleWorkspaceGroupCollapsed={props.onToggleWorkspaceGroupCollapsed}
        onSelectProject={props.onSelectProject}
        onOpenWorkspaceSettings={props.onOpenWorkspaceSettings}
        onNewConversationForProject={props.onNewConversationForProject}
        onBrowseProjectInFileTree={props.onBrowseProjectInFileTree}
        onBrowseProjectInSystemFileManager={props.onBrowseProjectInSystemFileManager}
        onStartRenamingProject={props.onStartRenamingProject}
        onProjectRenameDraftChange={props.onProjectRenameDraftChange}
        onCommitProjectRename={props.onCommitProjectRename}
        onCancelProjectRename={props.onCancelProjectRename}
        onSetProjectPinned={props.onSetProjectPinned}
        onRemoveProject={props.onRemoveProject}
        onArchiveProject={props.onArchiveProject}
        onUnarchiveProject={props.onUnarchiveProject}
        archivedProjectPathKeys={props.archivedProjectPathKeys}
        onNewConversation={props.onNewConversation}
        onSelectConversation={props.onSelectConversation}
        onOpenConversationInSplit={props.onOpenConversationInSplit}
        onStartRenaming={handleStartRenaming}
        onRenameDraftChange={setRenameDraft}
        onCommitRename={handleCommitRename}
        onCancelRename={handleCancelRename}
        onSetPinned={handleSetPinned}
        onMoveToWorkspace={handleMoveToWorkspace}
        onMoveConversationsToWorkspace={handleMoveConversationsToWorkspace}
        onDeleteConversation={handleDeleteConversation}
        onDeleteConversations={handleDeleteConversations}
        onLoadMore={handleLoadMore}
        onCloseSidebar={props.onCloseSidebar}
        onOpenSettings={props.onOpenSettings}
        onCreateSoul={props.onCreateSoul}
        appUpdate={props.appUpdate}
        onOpenSkillsHub={props.onOpenSkillsHub}
        onOpenMcpHub={props.onOpenMcpHub}
        mobileExperience={props.mobileExperience}
        desktopPanelMode={props.desktopPanelMode}
        workspaceToolsAvailable={props.workspaceToolsAvailable}
        fileTreeAvailable={props.fileTreeAvailable}
        onOpenWorkspaceTool={props.onOpenWorkspaceTool}
      />
    </Fragment>
  );
}
