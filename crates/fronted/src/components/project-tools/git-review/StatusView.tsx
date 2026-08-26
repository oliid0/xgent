// GitReview status view: staged/unstaged change lists, the commit bar, the
// working-tree/branch diff pane and the change context menus.
//
// Shared by every frontend runtime; only relative or @xagent/runtime imports
// are allowed here.

import { ContextMenu, type ContextMenuOption } from "@astryxdesign/core/ContextMenu";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Button as AstryxButton } from "@xagent/ui/components/ui/button";
import { Inline as AstryxInline, View as AstryxView } from "@xagent/ui/components/ui/view";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "../../../i18n";
import type { GitStatusEntry } from "../../../lib/git/types";
import { cn } from "../../../lib/shared/utils";
import { getFileTypeIcon } from "../../chat/fileTypeIcons";
import {
  BrushCleaning,
  ChevronRight,
  ExternalLink,
  Eye,
  FilePenLine,
  FolderTree,
  GitCommitHorizontal,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Trash2,
} from "../../icons";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { useWorkspaceToolsContext } from "../WorkspaceToolsContext";
import { DiffReviewCard } from "./DiffView";
import {
  basename,
  type ChangeListSection,
  canStageEntry,
  canUnstageEntry,
  type DiffViewKind,
  GIT_REVIEW_SPLIT_GRID_CLASS,
  type GitDiscardConfirmState,
  type GitReviewStackedPane,
  isDeletedStatusEntry,
  parentPath,
  revealTargetForEntry,
  statusLabel,
  statusTone,
} from "./model";
import { GitDiscardConfirmModal } from "./Toolbar";
import type { GitReviewData } from "./useGitReviewData";
import { GIT_REVIEW_TRANSIENT_SCROLLBAR_CLASS, useOverlayScrollbar } from "./useOverlayScrollbar";

const INITIAL_CHANGE_ENTRY_RENDER_COUNT = 160;
const CHANGE_ENTRY_RENDER_BATCH_SIZE = 160;

export function GitReviewStatusView(props: {
  activeDiffView: DiffViewKind;
  collapsedSections: Record<ChangeListSection, boolean>;
  commitMessage: string;
  data: GitReviewData;
  onActiveDiffViewChange: (view: DiffViewKind) => void;
  onCommitMessageChange: (value: string) => void;
  onStackedPaneChange: (pane: GitReviewStackedPane, dir: "forward" | "back") => void;
  onToggleSection: (section: ChangeListSection) => void;
  panelRef: RefObject<HTMLDivElement | null>;
  stackedDir: "forward" | "back";
  stackedPane: GitReviewStackedPane;
  useSplitReviewLayout: boolean;
  writeDisabled: boolean;
}) {
  const {
    activeDiffView,
    collapsedSections,
    commitMessage,
    data,
    onActiveDiffViewChange,
    onCommitMessageChange,
    onStackedPaneChange,
    onToggleSection,
    stackedDir,
    stackedPane,
    useSplitReviewLayout,
    writeDisabled,
  } = props;
  const {
    branchDiff,
    branchError,
    busy,
    cwd,
    diffLoading,
    gitClient,
    loading,
    refresh,
    runOperation,
    selectPath,
    selectedPath,
    setError,
    state,
    worktreeDiff,
  } = data;
  const context = useWorkspaceToolsContext();
  const onRevealInFileTree = context.fileTree.onRevealInFileTree;
  const { t } = useLocale();

  const handleOverlayScroll = useOverlayScrollbar();
  const [discardConfirm, setDiscardConfirm] = useState<GitDiscardConfirmState | null>(null);
  const listPaneRef = useRef<HTMLElement | null>(null);
  const detailPaneRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (useSplitReviewLayout) return;
    const el = stackedPane === "list" ? listPaneRef.current : detailPaneRef.current;
    if (!el) return;
    const cls =
      stackedDir === "back" ? "git-review-pane-enter-back" : "git-review-pane-enter-forward";
    el.classList.remove("git-review-pane-enter-forward", "git-review-pane-enter-back");
    void el.offsetHeight;
    el.classList.add(cls);
  }, [stackedPane, useSplitReviewLayout, stackedDir]);

  const entries = state.entries;
  const stagedEntries = useMemo(() => entries.filter(canUnstageEntry), [entries]);
  const workingEntries = useMemo(() => entries.filter(canStageEntry), [entries]);
  const [visibleStagedEntryCount, setVisibleStagedEntryCount] = useState(
    INITIAL_CHANGE_ENTRY_RENDER_COUNT,
  );
  const [visibleWorkingEntryCount, setVisibleWorkingEntryCount] = useState(
    INITIAL_CHANGE_ENTRY_RENDER_COUNT,
  );
  useEffect(() => {
    setVisibleStagedEntryCount(INITIAL_CHANGE_ENTRY_RENDER_COUNT);
    setVisibleWorkingEntryCount(INITIAL_CHANGE_ENTRY_RENDER_COUNT);
  }, [state.repoRoot, state.head, stagedEntries.length, workingEntries.length]);
  const visibleStagedEntries = useMemo(
    () => stagedEntries.slice(0, visibleStagedEntryCount),
    [stagedEntries, visibleStagedEntryCount],
  );
  const visibleWorkingEntries = useMemo(
    () => workingEntries.slice(0, visibleWorkingEntryCount),
    [workingEntries, visibleWorkingEntryCount],
  );
  const hiddenStagedEntryCount = Math.max(0, stagedEntries.length - visibleStagedEntries.length);
  const hiddenWorkingEntryCount = Math.max(0, workingEntries.length - visibleWorkingEntries.length);
  const operationBusy = busy !== "";
  const hasStageableChanges = state.dirtyCounts.unstaged > 0 || state.dirtyCounts.untracked > 0;
  const hasStagedChanges = state.dirtyCounts.staged > 0;
  const hasDiscardableChanges = entries.length > 0;
  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.path === selectedPath) ?? null,
    [entries, selectedPath],
  );
  const selectEntry = useCallback(
    (entry: GitStatusEntry) => {
      selectPath(entry.path);
      if (!useSplitReviewLayout) {
        onStackedPaneChange("detail", "forward");
      }
    },
    [onStackedPaneChange, selectPath, useSplitReviewLayout],
  );

  const toggleChangeSection = useCallback(
    (section: ChangeListSection) => {
      onToggleSection(section);
    },
    [onToggleSection],
  );

  const viewEntryChanges = useCallback(
    (entry: GitStatusEntry) => {
      onActiveDiffViewChange("workingTree");
      selectEntry(entry);
    },
    [onActiveDiffViewChange, selectEntry],
  );

  const stageEntry = useCallback(
    (entry: GitStatusEntry) => {
      void runOperation("stage", () => gitClient!.stage(cwd, entry.path));
    },
    [cwd, gitClient, runOperation],
  );

  const unstageEntry = useCallback(
    (entry: GitStatusEntry) => {
      void runOperation("unstage", () => gitClient!.unstage(cwd, entry.path));
    },
    [cwd, gitClient, runOperation],
  );

  const discardEntry = useCallback((entry: GitStatusEntry) => {
    setDiscardConfirm({
      kind: "entry",
      path: entry.path,
      oldPath: entry.oldPath ?? null,
    });
  }, []);

  const addEntryToGitignore = useCallback(
    (entry: GitStatusEntry) => {
      void runOperation("add_to_gitignore", () => gitClient!.addToGitignore(cwd, entry.path));
    },
    [cwd, gitClient, runOperation],
  );

  const stageAllChanges = useCallback(() => {
    void runOperation("stage_all", () => gitClient!.stageAll(cwd));
  }, [cwd, gitClient, runOperation]);

  const unstageAllChanges = useCallback(() => {
    void runOperation("unstage_all", () => gitClient!.unstageAll(cwd));
  }, [cwd, gitClient, runOperation]);

  const discardAllChanges = useCallback(() => {
    setDiscardConfirm({ kind: "all" });
  }, []);

  const closeDiscardConfirm = useCallback(() => {
    if (busy === "discard" || busy === "discard_all") return;
    setDiscardConfirm(null);
  }, [busy]);

  const confirmDiscardChanges = useCallback(async () => {
    if (!discardConfirm) return;
    if (discardConfirm.kind === "all") {
      await runOperation("discard_all", () => gitClient!.discardAll(cwd), "discard_all");
    } else {
      const target = discardConfirm;
      await runOperation(
        "discard",
        () => gitClient!.discard(cwd, target.path, target.oldPath ?? undefined),
        "discard",
      );
    }
    setDiscardConfirm(null);
  }, [cwd, discardConfirm, gitClient, runOperation]);

  const revealEntryInFileTree = useCallback(
    (entry: GitStatusEntry) => {
      if (!onRevealInFileTree) return;
      onRevealInFileTree(revealTargetForEntry(entry));
    },
    [onRevealInFileTree],
  );

  const canOpenSystemFileLocation = typeof gitClient?.openSystemFileLocation === "function";

  const openEntrySystemFileLocation = useCallback(
    (entry: GitStatusEntry) => {
      setError("");
      void gitClient?.openSystemFileLocation?.(cwd, entry.path).catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
    },
    [cwd, gitClient, setError],
  );

  const renderChangeEntry = (entry: GitStatusEntry, section: ChangeListSection) => {
    const selected = entry.path === selectedPath;
    const TypeIcon = getFileTypeIcon(entry.path, "file");
    const fileName = basename(entry.path);
    const filePath = parentPath(entry.path);
    const deleted = isDeletedStatusEntry(entry);
    const entryMenuItems: ContextMenuOption[] = [
      {
        label: t("projectTools.gitReview.viewChanges"),
        icon: <Eye />,
        onClick: () => viewEntryChanges(entry),
      },
      section === "staged"
        ? {
            label: t("projectTools.gitReview.unstageChanges"),
            icon: <GitCommitHorizontal />,
            isDisabled: writeDisabled || busy !== "" || !canUnstageEntry(entry),
            onClick: () => unstageEntry(entry),
          }
        : {
            label: t("projectTools.gitReview.stageChanges"),
            icon: <FilePenLine />,
            isDisabled: writeDisabled || busy !== "" || !canStageEntry(entry),
            onClick: () => stageEntry(entry),
          },
      {
        label: t("projectTools.gitReview.discardChanges"),
        icon: <BrushCleaning />,
        variant: "destructive",
        isDisabled: writeDisabled || busy !== "",
        onClick: () => discardEntry(entry),
      },
      ...(section === "changes" && entry.untracked
        ? [
            {
              label: t("projectTools.gitReview.addToGitignore"),
              icon: <GitCommitHorizontal />,
              isDisabled: writeDisabled || busy !== "",
              onClick: () => addEntryToGitignore(entry),
            },
          ]
        : []),
      { type: "divider" },
      {
        label: t("projectTools.gitReview.revealInFileTree"),
        icon: <FolderTree />,
        isDisabled: !onRevealInFileTree,
        onClick: () => revealEntryInFileTree(entry),
      },
      ...(canOpenSystemFileLocation
        ? [
            {
              label: t("projectTools.gitReview.openSystemFileLocation"),
              icon: <ExternalLink />,
              onClick: () => openEntrySystemFileLocation(entry),
            },
          ]
        : []),
    ];
    return (
      <ContextMenu
        key={`${section}:${entry.kind}:${entry.oldPath ?? ""}:${entry.path}`}
        items={entryMenuItems}
        label={entry.path}
        menuWidth="var(--xagent-git-context-menu-width)"
        size="sm"
      >
        <AstryxView
          layout="block"
          direction="horizontal"
          className={cn(
            "select-none border-b border-l-2 border-border/60 border-l-transparent px-3 py-2 transition-colors hover:bg-muted/40",
            selected && "border-l-emerald-500 bg-emerald-500/10",
          )}
        >
          <AstryxButton
            type="button"
            className="flex w-full select-none items-start gap-2 rounded-sm bg-transparent p-0 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => selectEntry(entry)}
            title={entry.path}
          >
            <TypeIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <AstryxInline className="min-w-0 flex-1 select-none">
              <AstryxInline
                className={cn(
                  "block truncate text-xs font-medium text-foreground",
                  deleted && "line-through",
                )}
              >
                {fileName}
              </AstryxInline>
              <AstryxInline
                className={cn(
                  "block truncate text-[calc(11px*var(--zone-font-scale,1))] leading-4 text-muted-foreground",
                  deleted && "line-through",
                )}
              >
                {filePath}
              </AstryxInline>
            </AstryxInline>
            <AstryxInline
              className={cn(
                "mt-0.5 shrink-0 text-[calc(10px*var(--zone-font-scale,1))] font-semibold",
                statusTone(entry),
              )}
            >
              {statusLabel(entry)}
            </AstryxInline>
          </AstryxButton>
        </AstryxView>
      </ContextMenu>
    );
  };

  const renderChangeSection = (
    section: ChangeListSection,
    title: string,
    sectionEntries: GitStatusEntry[],
    visibleSectionEntries: GitStatusEntry[],
    hiddenCount: number,
    emptyLabel: string,
    onShowMore: () => void,
    collapsed: boolean,
    onToggle: () => void,
  ) => (
    <AstryxView
      as="section"
      className="relative border-b border-border/60 bg-background last:border-b-0"
    >
      <AstryxView
        layout="grid"
        direction="horizontal"
        className="sticky top-0 z-20 grid h-7 w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-border/60 bg-muted px-3"
      >
        <AstryxButton
          type="button"
          className="flex min-w-0 items-center gap-1.5 rounded-sm bg-transparent p-0 text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-expanded={!collapsed}
          onClick={onToggle}
        >
          <ChevronRight
            className={cn(
              "h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none",
              !collapsed && "rotate-90",
            )}
            aria-hidden="true"
          />
          <AstryxInline className="min-w-0 truncate text-[calc(11px*var(--zone-font-scale,1))] font-semibold text-muted-foreground">
            {title}
          </AstryxInline>
        </AstryxButton>
        <AstryxView
          as="span"
          layout="inline-flex"
          direction="horizontal"
          className="inline-flex h-4 min-w-6 shrink-0 items-center justify-center justify-self-end rounded bg-background/70 px-1.5 text-center text-[calc(10px*var(--zone-font-scale,1))] font-medium tabular-nums text-muted-foreground"
        >
          {sectionEntries.length}
        </AstryxView>
        <DropdownMenu
          button={{
            label: t("projectTools.gitReview.changesActions"),
            icon: <MoreHorizontal />,
            isIconOnly: true,
            variant: "ghost",
            size: "sm",
          }}
          items={[
            section === "changes"
              ? {
                  label: t("projectTools.gitReview.stageAllChanges"),
                  icon: <FilePenLine />,
                  isDisabled: writeDisabled || busy !== "" || !hasStageableChanges,
                  onClick: stageAllChanges,
                }
              : {
                  label: t("projectTools.gitReview.unstageAllChanges"),
                  icon: <GitCommitHorizontal />,
                  isDisabled: writeDisabled || busy !== "" || !hasStagedChanges,
                  onClick: unstageAllChanges,
                },
            {
              label: t("projectTools.gitReview.discardAllChanges"),
              icon: <Trash2 />,
              variant: "destructive",
              isDisabled: writeDisabled || busy !== "" || !hasDiscardableChanges,
              onClick: discardAllChanges,
            },
            {
              label: t("projectTools.gitReview.refreshChanges"),
              icon: <RefreshCw />,
              isDisabled: loading,
              onClick: () => {
                void refresh();
              },
            },
          ]}
          menuWidth="var(--xagent-git-context-menu-width)"
          placement="below"
          alignment="end"
          hasChevron={false}
        />
      </AstryxView>
      <AstryxView
        layout="grid"
        direction="horizontal"
        aria-hidden={collapsed}
        inert={collapsed}
        className={cn(
          "grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
          collapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
        )}
      >
        <AstryxView
          layout="block"
          direction="horizontal"
          className={cn(
            "min-h-0 overflow-hidden transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
            collapsed ? "-translate-y-1 opacity-0" : "translate-y-0 opacity-100",
          )}
        >
          {sectionEntries.length === 0 ? (
            <AstryxView
              layout="block"
              direction="horizontal"
              className="px-3 py-3 text-xs text-muted-foreground"
            >
              {emptyLabel}
            </AstryxView>
          ) : (
            <>
              {visibleSectionEntries.map((entry) => renderChangeEntry(entry, section))}
              {hiddenCount > 0 ? (
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="border-b border-border/60 px-3 py-2"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-full text-xs"
                    onClick={onShowMore}
                  >
                    {t("projectTools.gitReview.showMoreChanges").replace(
                      "{count}",
                      String(hiddenCount),
                    )}
                  </Button>
                </AstryxView>
              ) : null}
            </>
          )}
        </AstryxView>
      </AstryxView>
    </AstryxView>
  );

  return (
    <>
      <GitDiscardConfirmModal
        target={discardConfirm}
        loading={busy === "discard" || busy === "discard_all"}
        onClose={closeDiscardConfirm}
        onConfirm={confirmDiscardChanges}
      />
      <AstryxView
        layout="flex"
        direction="vertical"
        key="changes"
        className={cn(
          "git-review-tab-enter min-h-0 flex-1 gap-3 overflow-hidden p-3",
          useSplitReviewLayout ? `grid ${GIT_REVIEW_SPLIT_GRID_CLASS}` : "flex flex-col",
        )}
      >
        <AstryxView
          as="aside"
          ref={listPaneRef}
          className={cn(
            "min-h-0 flex-col overflow-hidden rounded-lg border border-border/70 bg-background",
            useSplitReviewLayout || stackedPane === "list" ? "flex" : "hidden",
            !useSplitReviewLayout && "flex-1",
          )}
        >
          <AstryxView
            layout="block"
            direction="horizontal"
            className={cn(
              GIT_REVIEW_TRANSIENT_SCROLLBAR_CLASS,
              "isolate min-h-0 flex-1 overflow-auto [overscroll-behavior:contain]",
            )}
            onScroll={handleOverlayScroll}
          >
            {entries.length === 0 ? (
              <AstryxView
                layout="block"
                direction="horizontal"
                className="px-3 py-6 text-xs text-muted-foreground"
              >
                {t("projectTools.gitReview.noLocalChanges")}
              </AstryxView>
            ) : (
              <>
                {renderChangeSection(
                  "staged",
                  t("projectTools.gitReview.stagedChangesTitle"),
                  stagedEntries,
                  visibleStagedEntries,
                  hiddenStagedEntryCount,
                  t("projectTools.gitReview.noStagedChanges"),
                  () =>
                    setVisibleStagedEntryCount(
                      (current) => current + CHANGE_ENTRY_RENDER_BATCH_SIZE,
                    ),
                  collapsedSections.staged,
                  () => toggleChangeSection("staged"),
                )}
                {renderChangeSection(
                  "changes",
                  t("projectTools.gitReview.changesTitle"),
                  workingEntries,
                  visibleWorkingEntries,
                  hiddenWorkingEntryCount,
                  t("projectTools.gitReview.noWorkingChanges"),
                  () =>
                    setVisibleWorkingEntryCount(
                      (current) => current + CHANGE_ENTRY_RENDER_BATCH_SIZE,
                    ),
                  collapsedSections.changes,
                  () => toggleChangeSection("changes"),
                )}
              </>
            )}
          </AstryxView>
        </AstryxView>
        <AstryxView
          as="main"
          ref={detailPaneRef}
          className={cn(
            "h-full min-h-0 flex-col overflow-hidden",
            useSplitReviewLayout || stackedPane === "detail" ? "flex" : "hidden",
            !useSplitReviewLayout && "flex-1",
          )}
        >
          <AstryxView
            layout="flex"
            direction="horizontal"
            className="mb-3 flex shrink-0 items-center gap-2"
          >
            <GitCommitHorizontal className="h-4 w-4 text-muted-foreground" />
            <Input
              value={commitMessage}
              onChange={(event) => onCommitMessageChange(event.target.value)}
              placeholder={t("projectTools.gitReview.commitMessagePlaceholder")}
              disabled={writeDisabled || operationBusy}
              className="h-8 text-[calc(11px*var(--zone-font-scale,1))] placeholder:text-[calc(11px*var(--zone-font-scale,1))] focus-visible:ring-1 focus-visible:ring-border/40"
            />
            <Button
              size="sm"
              disabled={writeDisabled || operationBusy || !commitMessage.trim()}
              onClick={() => {
                void runOperation(
                  "commit",
                  () => gitClient!.commit(cwd, commitMessage),
                  "commit",
                ).then((ok) => {
                  if (ok) onCommitMessageChange("");
                });
              }}
            >
              {busy === "commit" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                t("projectTools.gitReview.commit")
              )}
            </Button>
          </AstryxView>
          {selectedEntry ? (
            <AstryxView
              layout="flex"
              direction="vertical"
              className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden"
            >
              <AstryxView
                layout="flex"
                direction="horizontal"
                className="flex shrink-0 items-center gap-2 rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-xs"
              >
                <AstryxInline className="text-muted-foreground">
                  {t("projectTools.gitReview.selected")}
                </AstryxInline>
                <AstryxInline
                  className="min-w-0 flex-1 truncate font-medium"
                  title={selectedEntry.path}
                >
                  {selectedEntry.path}
                </AstryxInline>
              </AstryxView>
              <DiffReviewCard
                activeView={activeDiffView}
                branchDiff={branchDiff}
                branchError={branchError}
                diffLoading={diffLoading}
                onActiveViewChange={onActiveDiffViewChange}
                showStat={useSplitReviewLayout}
                worktreeDiff={worktreeDiff}
              />
            </AstryxView>
          ) : (
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-border/70 bg-muted/10 px-4 text-center text-xs text-muted-foreground"
            >
              {t("projectTools.gitReview.selectFileToViewDiff")}
            </AstryxView>
          )}
        </AstryxView>
      </AstryxView>
    </>
  );
}
