// GitReview toolbar: panel header (branch summary, remote actions, counters,
// mode/pane switchers) plus the modal dialogs and the operation toast shared
// by the status and history views.
//
// Shared by every frontend runtime; only relative or @xagent/runtime imports
// are allowed here.

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { useLocale } from "../../../i18n";
import type { GitBranch as GitBranchInfo, GitWorktreeInfo } from "../../../lib/git/types";
import { gitDiscoveredRepositoryLabel, selectedGitRepositoryLabel } from "../../../lib/git/types";
import { cn } from "../../../lib/shared/utils";
import {
  Check,
  ChevronDown,
  Cloud,
  Download,
  Eye,
  Folder,
  GitBranch,
  History,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
} from "../../icons";
import { Button } from "../../ui/button";
import { AdaptiveDialog } from "../../ui/adaptive-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
import { Input } from "../../ui/input";
import { useWorkspaceToolsContext } from "../WorkspaceToolsContext";
import {
  type GitBranchFromCommitState,
  type GitBranchSwitchConflictState,
  type GitDiscardConfirmState,
  type GitOperationNotice,
  type GitRemoteSetupAction,
  type GitReviewStackedPane,
  remoteSetupDescriptionKey,
  remoteSetupSubmitKey,
} from "./model";
import type { GitReviewData } from "./useGitReviewData";
import { View as AstryxView, Inline as AstryxInline } from "@xagent/ui/components/ui/view";
import { Button as AstryxButton } from "@xagent/ui/components/ui/button";

const GIT_REVIEW_STACKED_PANE_BUTTON_CLASS =
  "inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function GitRemoteSetupModal(props: {
  open: boolean;
  action: GitRemoteSetupAction;
  workdir: string;
  branch: string;
  remoteUrl: string;
  loading: boolean;
  error: string;
  onRemoteUrlChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const {
    open,
    action,
    workdir,
    branch,
    remoteUrl,
    loading,
    error,
    onRemoteUrlChange,
    onClose,
    onSubmit,
  } = props;
  const { t } = useLocale();
  if (!open) return null;

  return (
    <AdaptiveDialog
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen && !loading) onClose();
      }}
      title={t("projectTools.gitReview.remoteSetupTitle")}
      subtitle={t(remoteSetupDescriptionKey(action))}
      purpose="form"
      width="var(--xagent-dialog-width-sm)"
      touchPresentation="bottom-sheet"
      bottomSheetHeight="tall"
      footer={
        <HStack gap={2} hAlign="end" wrap="wrap">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            {t("chat.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={loading || !remoteUrl.trim()}
            onClick={onSubmit}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : action === "push" ? (
              <Upload className="h-3.5 w-3.5" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {t(remoteSetupSubmitKey(action))}
          </Button>
        </HStack>
      }
    >
      <AstryxView
        as="form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <AstryxView layout="block" direction="horizontal" className="space-y-4">
          <AstryxView
            layout="grid"
            direction="horizontal"
            className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2"
          >
            <AstryxView
              layout="block"
              direction="horizontal"
              className="truncate rounded-lg border border-border/70 bg-muted/35 px-3 py-2"
              title={branch}
            >
              {branch}
            </AstryxView>
            <AstryxView
              layout="block"
              direction="horizontal"
              className="truncate rounded-lg border border-border/70 bg-muted/35 px-3 py-2"
              title={workdir}
            >
              {workdir}
            </AstryxView>
          </AstryxView>
          <Input
            label={t("projectTools.gitReview.remoteUrl")}
            value={remoteUrl}
            onChange={(event) => onRemoteUrlChange(event.target.value)}
            placeholder={t("projectTools.gitReview.remoteUrlPlaceholder")}
            autoFocus
            disabled={loading}
          />
          {error ? (
            <AstryxView
              layout="block"
              direction="horizontal"
              className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {error}
            </AstryxView>
          ) : null}
        </AstryxView>
      </AstryxView>
    </AdaptiveDialog>
  );
}

export function GitDiscardConfirmModal(props: {
  target: GitDiscardConfirmState | null;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { target, loading, onClose, onConfirm } = props;
  const { t } = useLocale();
  if (!target) return null;

  const isAll = target.kind === "all";
  const title = isAll
    ? t("projectTools.gitReview.discardAllChanges")
    : t("projectTools.gitReview.discardChanges");
  const description = isAll
    ? t("projectTools.gitReview.discardAllConfirm")
    : t("projectTools.gitReview.discardConfirm").replace("{path}", target.path);

  return (
    <AlertDialog
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen && !loading) onClose();
      }}
      title={title}
      description={description}
      actionLabel={title}
      cancelLabel={t("chat.cancel")}
      actionVariant="destructive"
      isActionLoading={loading}
      onAction={onConfirm}
    />
  );
}

export function GitBranchFromCommitModal(props: {
  target: GitBranchFromCommitState | null;
  branchName: string;
  loading: boolean;
  error: string;
  onBranchNameChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const { target, branchName, loading, error, onBranchNameChange, onClose, onSubmit } = props;
  const { t } = useLocale();
  if (!target) return null;

  return (
    <AdaptiveDialog
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen && !loading) onClose();
      }}
      title={t("projectTools.gitReview.createBranchFromCommitTitle")}
      subtitle={t("projectTools.gitReview.createBranchFromCommitDescription")
        .replace("{sha}", target.shortSha)
        .replace("{subject}", target.subject || target.shortSha)}
      purpose="form"
      width="var(--xagent-dialog-width-sm)"
      touchPresentation="bottom-sheet"
      bottomSheetHeight="tall"
      footer={
        <HStack gap={2} hAlign="end" wrap="wrap">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            {t("chat.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={loading || !branchName.trim()}
            onClick={onSubmit}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <GitBranch className="h-3.5 w-3.5" />
            )}
            {t("projectTools.gitReview.createBranch")}
          </Button>
        </HStack>
      }
    >
      <AstryxView
        as="form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <AstryxView layout="block" direction="horizontal" className="space-y-4">
          <AstryxView
            layout="block"
            direction="horizontal"
            className="rounded-lg border border-border/70 bg-muted/35 px-3 py-2 text-xs"
          >
            <AstryxView
              layout="block"
              direction="horizontal"
              className="font-mono text-[calc(11px*var(--zone-font-scale,1))] text-muted-foreground"
            >
              {target.shortSha}
            </AstryxView>
            <AstryxView
              layout="block"
              direction="horizontal"
              className="mt-1 truncate font-medium"
              title={target.subject}
            >
              {target.subject || target.commitSha}
            </AstryxView>
          </AstryxView>
          <Input
            label={t("projectTools.gitReview.branchName")}
            value={branchName}
            onChange={(event) => onBranchNameChange(event.target.value)}
            placeholder={t("projectTools.gitReview.branchNamePlaceholder")}
            autoFocus
            disabled={loading}
          />
          {error ? (
            <AstryxView
              layout="block"
              direction="horizontal"
              className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {error}
            </AstryxView>
          ) : null}
        </AstryxView>
      </AstryxView>
    </AdaptiveDialog>
  );
}

export function GitOperationNoticeToast({
  notice,
  onDismiss,
}: {
  notice: GitOperationNotice | null;
  onDismiss: () => void;
}) {
  const showToast = useToast();

  useEffect(() => {
    if (!notice) return;
    showToast({
      body: (
        <VStack gap={1}>
          <Text type="body">{notice.title}</Text>
          {notice.message ? (
            <Text type="supporting" color="secondary">
              {notice.message}
            </Text>
          ) : null}
        </VStack>
      ),
      type: notice.kind === "success" ? "info" : "error",
      isAutoHide: true,
      autoHideDuration: notice.kind === "success" ? 4200 : 7000,
      uniqueID: "git-review-operation",
      collisionBehavior: "overwrite",
      onHide: onDismiss,
    });
  }, [notice, onDismiss, showToast]);

  return null;
}

const GIT_REVIEW_REMOTE_BRANCH_DISPLAY_LIMIT = 40;

// A checkout aborted by uncommitted local changes offers stash-and-switch
// instead of surfacing the raw git error.
export function GitBranchSwitchConflictModal(props: {
  conflict: GitBranchSwitchConflictState | null;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { conflict, loading, onClose, onConfirm } = props;
  const { t } = useLocale();
  if (!conflict) return null;

  return (
    <AlertDialog
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen && !loading) onClose();
      }}
      title={t("projectTools.gitReview.switchBranchConflictTitle")}
      description={t("projectTools.gitReview.switchBranchConflictDescription").replace(
        "{branch}",
        conflict.branch,
      )}
      actionLabel={t("projectTools.gitReview.stashAndSwitch")}
      cancelLabel={t("chat.cancel")}
      actionVariant="primary"
      isActionLoading={loading}
      onAction={onConfirm}
    />
  );
}

function GitWorktreeModal(props: { data: GitReviewData; open: boolean; onClose: () => void }) {
  const { data, open, onClose } = props;
  const { cwd, gitClient, state } = data;
  const { t } = useLocale();
  const [worktrees, setWorktrees] = useState<GitWorktreeInfo[]>([]);
  const [branch, setBranch] = useState("");
  const [directoryName, setDirectoryName] = useState("");
  const [startPoint, setStartPoint] = useState("");
  const [parentDirectory, setParentDirectory] = useState("");
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [force, setForce] = useState(false);
  const [removingPath, setRemovingPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    if (!gitClient || !cwd.trim()) return;
    const response = await gitClient.branches(cwd);
    setWorktrees(response.worktrees);
  }, [cwd, gitClient]);

  useEffect(() => {
    if (!open) return;
    setError("");
    setRemovingPath("");
    void reload().catch((cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [open, reload]);

  if (!open) return null;

  const create = async () => {
    if (!gitClient || !branch.trim() || !directoryName.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await gitClient.createWorktree(cwd, {
        branch: branch.trim(),
        directoryName: directoryName.trim(),
        startPoint: startPoint.trim() || undefined,
        parentDirectory: parentDirectory.trim() || undefined,
      });
      if (!result.ok) throw new Error(result.message || result.stderr);
      setBranch("");
      setDirectoryName("");
      setStartPoint("");
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (worktree: GitWorktreeInfo) => {
    if (!gitClient || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await gitClient.removeWorktree(cwd, worktree.path, {
        force,
        deleteBranch,
      });
      if (!result.ok) throw new Error(result.message || result.stderr);
      setRemovingPath("");
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdaptiveDialog
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen && !busy) onClose();
      }}
      title={t("projectTools.gitReview.worktrees")}
      subtitle={state.repoRoot}
      purpose="form"
      width="var(--xagent-dialog-width-md)"
      maxHeight="var(--xagent-dialog-height-lg)"
      touchPresentation="bottom-sheet"
      bottomSheetHeight="tall"
    >
      <AstryxView layout="block" direction="horizontal" className="space-y-4">
        <AstryxView as="section" className="rounded-xl border p-3">
          <AstryxView layout="block" direction="horizontal" className="mb-3 text-xs font-semibold">
            {t("projectTools.gitReview.createWorktree")}
          </AstryxView>
          <AstryxView layout="grid" direction="horizontal" className="grid gap-2 sm:grid-cols-2">
            <Input
              value={branch}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setBranch(value);
                if (!directoryName) setDirectoryName(value.replace(/[\\/\s]+/g, "-"));
              }}
              placeholder={t("projectTools.gitReview.worktreeBranch")}
            />
            <Input
              value={directoryName}
              onChange={(event) => setDirectoryName(event.currentTarget.value)}
              placeholder={t("projectTools.gitReview.worktreeDirectory")}
            />
            <Input
              value={startPoint}
              onChange={(event) => setStartPoint(event.currentTarget.value)}
              placeholder={t("projectTools.gitReview.worktreeStartPoint")}
            />
            <Input
              value={parentDirectory}
              onChange={(event) => setParentDirectory(event.currentTarget.value)}
              placeholder={t("projectTools.gitReview.worktreeParent")}
            />
          </AstryxView>
          <Button
            type="button"
            size="sm"
            className="mt-3 w-full"
            disabled={busy || !branch.trim() || !directoryName.trim()}
            onClick={() => void create()}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Folder className="h-3.5 w-3.5" />
            )}
            {t("projectTools.gitReview.createWorktree")}
          </Button>
        </AstryxView>
        <AstryxView as="section" className="space-y-2">
          {worktrees.length === 0 ? (
            <AstryxView
              layout="block"
              direction="horizontal"
              className="rounded-xl border border-dashed px-3 py-6 text-center text-xs text-muted-foreground"
            >
              {t("projectTools.gitReview.noWorktrees")}
            </AstryxView>
          ) : (
            worktrees.map((worktree) => (
              <AstryxView
                layout="block"
                direction="horizontal"
                key={worktree.path}
                className="rounded-xl border px-3 py-2.5"
              >
                <AstryxView layout="flex" direction="horizontal" className="flex items-start gap-2">
                  <Folder className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
                  <AstryxView layout="block" direction="horizontal" className="min-w-0 flex-1">
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="truncate text-xs font-semibold"
                    >
                      {worktree.branch || t("projectTools.gitReview.unresolved")}
                    </AstryxView>
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground"
                      title={worktree.path}
                    >
                      {worktree.path}
                    </AstryxView>
                  </AstryxView>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    disabled={busy}
                    onClick={() => setRemovingPath(worktree.path)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </AstryxView>
                {removingPath === worktree.path ? (
                  <AstryxView
                    layout="block"
                    direction="horizontal"
                    className="mt-2 rounded-lg bg-muted/50 p-2 text-xs"
                  >
                    <CheckboxInput
                      label={t("projectTools.gitReview.deleteWorktreeBranch")}
                      value={deleteBranch}
                      onChange={setDeleteBranch}
                      size="sm"
                    />
                    <CheckboxInput
                      label={t("projectTools.gitReview.forceRemoveWorktree")}
                      value={force}
                      onChange={setForce}
                      size="sm"
                    />
                    <AstryxView
                      layout="flex"
                      direction="horizontal"
                      className="mt-2 flex justify-end gap-2"
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => setRemovingPath("")}
                      >
                        {t("chat.cancel")}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={busy}
                        onClick={() => void remove(worktree)}
                      >
                        {t("settings.delete")}
                      </Button>
                    </AstryxView>
                  </AstryxView>
                ) : null}
              </AstryxView>
            ))
          )}
        </AstryxView>
        {error ? (
          <AstryxView
            layout="block"
            direction="horizontal"
            className="rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </AstryxView>
        ) : null}
      </AstryxView>
    </AdaptiveDialog>
  );
}

// Head title as a branch switcher: branches load lazily when the menu opens
// and switching runs through runOperation so status/history refresh and
// errors surface exactly like the other toolbar operations.
function GitReviewBranchMenu(props: { data: GitReviewData; writeDisabled: boolean }) {
  const { data, writeDisabled } = props;
  const { busy, cwd, gitClient, state, switchBranch } = data;
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState("");
  const [worktreeModalOpen, setWorktreeModalOpen] = useState(false);
  const requestIdRef = useRef(0);
  const operationBusy = busy !== "";

  const loadBranches = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!gitClient || !cwd.trim()) return;
    setBranchesLoading(true);
    setBranchesError("");
    try {
      const response = await gitClient.branches(cwd);
      if (requestIdRef.current !== requestId) return;
      setBranches(response.branches);
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      setBranchesError(err instanceof Error ? err.message : String(err));
      setBranches([]);
    } finally {
      if (requestIdRef.current === requestId) {
        setBranchesLoading(false);
      }
    }
  }, [cwd, gitClient]);

  const title = state.head || t("projectTools.gitReviewTitle");
  if (state.status !== "ready") {
    return (
      <AstryxView
        layout="flex"
        direction="horizontal"
        className="flex min-w-0 flex-1 items-center px-2 text-[calc(12px*var(--zone-font-scale,1))] font-medium text-muted-foreground"
      >
        <AstryxInline className="min-w-0 truncate">{title}</AstryxInline>
      </AstryxView>
    );
  }

  const localBranches = branches.filter((branch) => branch.kind === "local");
  const remoteBranches = branches.filter((branch) => branch.kind === "remote");

  const renderBranchRow = (branch: GitBranchInfo, isCurrent: boolean, labelText: string) => (
    <DropdownMenuItem
      key={`${branch.kind}:${branch.fullName}`}
      disabled={operationBusy}
      onSelect={() => {
        if (isCurrent || writeDisabled) return;
        void switchBranch(branch.fullName, branch.kind);
      }}
      className={cn("gap-2 text-xs", (isCurrent || writeDisabled) && "text-muted-foreground")}
      title={branch.fullName}
    >
      {isCurrent ? (
        <Check className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      <AstryxInline className="min-w-0 flex-1 truncate">{labelText}</AstryxInline>
    </DropdownMenuItem>
  );

  return (
    <>
      <GitWorktreeModal
        data={data}
        open={worktreeModalOpen}
        onClose={() => setWorktreeModalOpen(false)}
      />
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) void loadBranches();
        }}
      >
        <DropdownMenuTrigger
          disabled={operationBusy}
          className="flex min-w-0 flex-1 items-center gap-1.5 px-2 text-[calc(12px*var(--zone-font-scale,1))] font-medium outline-hidden transition-colors hover:bg-muted/70 focus-visible:bg-muted/70 disabled:pointer-events-none disabled:opacity-60"
          title={t("projectTools.gitReview.switchBranch")}
          aria-label={t("projectTools.gitReview.switchBranch")}
        >
          <AstryxInline className="min-w-0 flex-1 truncate text-left">{title}</AstryxInline>
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground opacity-70" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56 max-w-72">
          <DropdownMenuLabel className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("projectTools.gitReview.switchBranch")}
          </DropdownMenuLabel>
          {branchesLoading ? (
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="flex items-center justify-center px-2 py-3"
            >
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </AstryxView>
          ) : branchesError ? (
            <AstryxView
              layout="block"
              direction="horizontal"
              className="px-2 py-2 text-xs text-destructive"
            >
              {branchesError}
            </AstryxView>
          ) : (
            <>
              {localBranches.length > 0 ? (
                <DropdownMenuLabel className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground/70">
                  {t("git.branchSelector.localBranches")}
                </DropdownMenuLabel>
              ) : null}
              {localBranches.map((branch) => renderBranchRow(branch, branch.current, branch.name))}
              {remoteBranches.length > 0 ? (
                <DropdownMenuLabel className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground/70">
                  {t("git.branchSelector.remoteBranches")}
                </DropdownMenuLabel>
              ) : null}
              {remoteBranches.slice(0, GIT_REVIEW_REMOTE_BRANCH_DISPLAY_LIMIT).map((branch) => {
                const isCurrentUpstream =
                  branch.current || (state.upstream !== "" && branch.fullName === state.upstream);
                return renderBranchRow(branch, isCurrentUpstream, branch.fullName);
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={operationBusy || writeDisabled}
                className="gap-2 text-xs"
                onSelect={() => setWorktreeModalOpen(true)}
              >
                <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                {t("projectTools.gitReview.manageWorktrees")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

// Which selector the header's single dropdown edits: the repository (the
// container) or the branch (the item inside it).
type GitReviewScope = "repository" | "branch";

// Horizontal rolling scope rail above the selector dropdown: both scope
// icons share one row and the active one always rolls into the first
// (leftmost) slot — full-size and tinted — while the inactive one rolls in
// behind it, smaller and dimmed. Clicking the trailing icon swaps the slots
// with an odometer-style slide (the active icon passes above via z-index)
// and the dropdown below switches to that scope's selector, so whichever
// selector is active always gets the full header width.
function GitReviewScopeDial(props: {
  value: GitReviewScope;
  onChange: (value: GitReviewScope) => void;
  repositoryLabel: string;
  branchLabel: string;
}) {
  const { value, onChange, repositoryLabel, branchLabel } = props;
  const items = [
    {
      key: "repository" as const,
      label: repositoryLabel,
      Icon: Folder,
      activeTone: "text-sky-600 dark:text-sky-300",
    },
    {
      key: "branch" as const,
      label: branchLabel,
      Icon: GitBranch,
      activeTone: "text-emerald-600 dark:text-emerald-300",
    },
  ];
  return (
    <AstryxView layout="block" direction="horizontal" className="relative h-7 w-[52px] shrink-0">
      {items.map((item) => {
        const isActive = item.key === value;
        return (
          <AstryxButton
            key={item.key}
            type="button"
            aria-pressed={isActive}
            aria-label={item.label}
            title={item.label}
            onClick={() => {
              if (!isActive) onChange(item.key);
            }}
            className={cn(
              "group absolute top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center outline-hidden transition-[left] duration-200 ease-out motion-reduce:transition-none",
              isActive ? "left-3 z-10" : "left-10",
            )}
          >
            <item.Icon
              className={cn(
                "h-[18px] w-[18px] transition-all duration-200 ease-out motion-reduce:transition-none",
                isActive
                  ? cn("scale-100", item.activeTone)
                  : "scale-[0.7] text-muted-foreground/50 group-hover:text-muted-foreground group-focus-visible:text-muted-foreground",
              )}
            />
          </AstryxButton>
        );
      })}
    </AstryxView>
  );
}

export function GitReviewToolbar(props: {
  data: GitReviewData;
  stackedPane: GitReviewStackedPane;
  onStackedPaneChange: (pane: GitReviewStackedPane, dir: "forward" | "back") => void;
  useSplitReviewLayout: boolean;
  visibleError: string;
  writeDisabled: boolean;
}) {
  const {
    data,
    stackedPane,
    onStackedPaneChange,
    useSplitReviewLayout,
    visibleError,
    writeDisabled,
  } = props;
  const {
    branchDiff,
    busy,
    canWrite,
    cwd,
    disabledMessage,
    discoverRepositories,
    gitClient,
    historyLoading,
    loadHistory,
    loading,
    refresh,
    repositories,
    reviewMode,
    runOperation,
    selectRepository,
    selectedRepoRoot,
    setReviewMode,
    state,
  } = data;
  const { t } = useLocale();
  const { onInsertCodeReviewSkill } = useWorkspaceToolsContext().git;
  const operationBusy = busy !== "";
  // Which selector the dial exposes; branch is the everyday one, so it wins
  // the full-width dropdown by default.
  const [scope, setScope] = useState<GitReviewScope>("branch");
  // The repository scope only earns UI when discovery found more than one
  // repository to pick between; otherwise the dial collapses to a static
  // branch icon and the branch selector owns the header.
  const showRepositoryScope = repositories.length > 1;
  const effectiveScope: GitReviewScope = showRepositoryScope ? scope : "branch";

  return (
    <AstryxView
      layout="block"
      direction="horizontal"
      className="shrink-0 border-b border-border px-3 py-3"
    >
      <GitBranchSwitchConflictModal
        conflict={data.branchSwitchConflict}
        loading={busy === "switch_branch"}
        onClose={data.dismissBranchSwitchConflict}
        onConfirm={() => void data.stashAndSwitchBranch()}
      />
      {/* Single header line: horizontal scope rail (only when there are
          multiple repositories to pick between — with a single repository it
          collapses to a static branch icon), then the active scope's dropdown
          taking the remaining width, then the action buttons. */}
      <AstryxView layout="flex" direction="horizontal" className="flex items-center gap-2">
        {showRepositoryScope ? (
          <GitReviewScopeDial
            value={effectiveScope}
            onChange={setScope}
            repositoryLabel={t("projectTools.gitReview.repositoryPicker")}
            branchLabel={t("projectTools.gitReview.switchBranch")}
          />
        ) : (
          <AstryxView
            layout="flex"
            direction="horizontal"
            className="flex h-7 w-7 shrink-0 items-center justify-center"
            title={t("projectTools.gitReview.switchBranch")}
          >
            <GitBranch className="h-[18px] w-[18px] text-emerald-600 dark:text-emerald-300" />
          </AstryxView>
        )}
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="flex h-7 min-w-0 flex-1 items-stretch overflow-hidden rounded-md border border-border bg-muted/25"
        >
          {effectiveScope === "repository" ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={operationBusy}
                className="flex min-w-0 flex-1 items-center gap-1.5 px-2 text-[calc(12px*var(--zone-font-scale,1))] font-medium outline-hidden transition-colors hover:bg-muted/70 focus-visible:bg-muted/70 disabled:pointer-events-none disabled:opacity-60"
                title={t("projectTools.gitReview.repositoryPicker")}
                aria-label={t("projectTools.gitReview.repositoryPicker")}
              >
                <AstryxInline className="min-w-0 flex-1 truncate text-left">
                  {selectedGitRepositoryLabel(repositories, selectedRepoRoot) ||
                    state.repoRoot ||
                    t("projectTools.gitReview.noRepository")}
                </AstryxInline>
                <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground opacity-70" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-56 max-w-72">
                <DropdownMenuLabel className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("projectTools.gitReview.repositoryPicker")}
                </DropdownMenuLabel>
                {repositories.map((repo) => {
                  const value = repo.isWorkspaceRoot ? "" : repo.root;
                  const selected = value === selectedRepoRoot;
                  return (
                    <DropdownMenuItem
                      key={repo.root}
                      disabled={operationBusy}
                      onSelect={() => {
                        if (!selected) selectRepository(value);
                      }}
                      className="gap-2 text-xs"
                      title={repo.root}
                    >
                      {selected ? (
                        <Check className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <AstryxInline className="min-w-0 flex-1 truncate">
                        {gitDiscoveredRepositoryLabel(repo)}
                      </AstryxInline>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <GitReviewBranchMenu data={data} writeDisabled={writeDisabled} />
          )}
        </AstryxView>
        <Button
          size="sm"
          variant="ghost"
          disabled={!onInsertCodeReviewSkill || state.status !== "ready"}
          className="h-7 w-7 px-0"
          title={t(
            !onInsertCodeReviewSkill
              ? "projectTools.gitReview.aiReviewUnavailable"
              : state.status === "ready"
                ? "projectTools.gitReview.addAiReview"
                : "projectTools.gitReview.noRepository",
          )}
          aria-label={t("projectTools.gitReview.addAiReview")}
          onClick={onInsertCodeReviewSkill}
        >
          <Sparkles className="h-3.5 w-3.5 text-primary" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={loading || historyLoading || operationBusy}
          className="h-7 w-7 px-0"
          title={t("projectTools.gitReview.refresh")}
          aria-label={t("projectTools.gitReview.refresh")}
          onClick={() => {
            if (data.isBusy()) return;
            // Manual refresh also re-scans for repositories so ones created
            // mid-session (e.g. a fresh clone in a subdirectory) show up.
            void discoverRepositories();
            if (reviewMode === "history") {
              void loadHistory();
            } else {
              void refresh();
            }
          }}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", (loading || historyLoading) && "animate-spin")} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={writeDisabled || operationBusy}
          title={t("projectTools.gitReview.fetch")}
          aria-label={t("projectTools.gitReview.fetch")}
          className="h-7 w-7 px-0"
          onClick={() => void runOperation("fetch", () => gitClient!.fetch(cwd), "fetch")}
        >
          {busy === "fetch" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Cloud className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={writeDisabled || operationBusy}
          title={t("projectTools.gitReview.pull")}
          aria-label={t("projectTools.gitReview.pull")}
          className="h-7 w-7 px-0"
          onClick={() => void runOperation("pull", () => gitClient!.pull(cwd), "pull")}
        >
          {busy === "pull" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={writeDisabled || operationBusy}
          title={t("projectTools.gitReview.push")}
          aria-label={t("projectTools.gitReview.push")}
          className="h-7 w-7 px-0"
          onClick={() => void runOperation("push", () => gitClient!.push(cwd), "push")}
        >
          {busy === "push" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
        </Button>
      </AstryxView>
      {state.status === "ready" ? (
        <AstryxView
          layout="block"
          direction="horizontal"
          className="mt-1.5 overflow-hidden rounded-xl border border-white/20 bg-white/50 shadow-sm backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.03]"
        >
          <AstryxView
            layout="flex"
            direction="horizontal"
            className="flex items-center gap-1.5 border-b border-black/[0.04] px-3 py-2 dark:border-white/[0.06]"
          >
            <AstryxInline className="shrink-0 rounded bg-muted/70 px-1.5 py-0.5 text-[calc(10px*var(--zone-font-scale,1))] font-medium leading-none text-muted-foreground">
              {t("projectTools.gitReview.labelBase")}
            </AstryxInline>
            <Cloud className="h-3 w-3 shrink-0 text-muted-foreground/60" />
            <AstryxInline
              className="min-w-0 truncate font-mono text-[calc(11px*var(--zone-font-scale,1))] text-foreground/75"
              title={
                branchDiff?.baseRef || state.upstream || t("projectTools.gitReview.unresolved")
              }
            >
              {branchDiff?.baseRef || state.upstream || t("projectTools.gitReview.unresolved")}
            </AstryxInline>
          </AstryxView>
          <AstryxView layout="grid" direction="horizontal" className="grid grid-cols-5">
            {[
              {
                count: state.ahead,
                label: t("projectTools.gitReview.labelAhead"),
                tone: "text-sky-600 dark:text-sky-400",
              },
              {
                count: state.behind,
                label: t("projectTools.gitReview.labelBehind"),
                tone: "text-orange-600 dark:text-orange-400",
              },
              {
                count: state.dirtyCounts.staged,
                label: t("projectTools.gitReview.labelStaged"),
                tone: "text-emerald-600 dark:text-emerald-400",
              },
              {
                count: state.dirtyCounts.unstaged,
                label: t("projectTools.gitReview.labelUnstaged"),
                tone: "text-amber-600 dark:text-amber-400",
              },
              {
                count: state.dirtyCounts.untracked,
                label: t("projectTools.gitReview.labelUntracked"),
                tone: "text-violet-600 dark:text-violet-400",
              },
            ].map((item, index) => (
              <AstryxView
                layout="flex"
                direction="vertical"
                key={item.label}
                className={cn(
                  "flex flex-col items-center gap-0.5 py-2",
                  index > 0 && "border-l border-black/[0.04] dark:border-white/[0.06]",
                )}
              >
                <AstryxInline
                  className={cn(
                    "text-sm font-semibold tabular-nums leading-none",
                    item.count > 0 ? item.tone : "text-muted-foreground/40",
                  )}
                >
                  {item.count}
                </AstryxInline>
                <AstryxInline className="text-[calc(9px*var(--zone-font-scale,1))] leading-none text-muted-foreground/60">
                  {item.label}
                </AstryxInline>
              </AstryxView>
            ))}
          </AstryxView>
        </AstryxView>
      ) : null}
      <AstryxView layout="flex" direction="horizontal" className="mt-3 flex items-center gap-2">
        <AstryxView
          layout="inline-flex"
          direction="horizontal"
          className="inline-flex shrink-0 rounded-md border border-border bg-muted/25 p-0.5 text-xs"
        >
          <AstryxButton
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 font-medium text-muted-foreground transition-colors hover:text-foreground",
              reviewMode === "changes" && "bg-background text-foreground shadow-sm",
            )}
            onClick={() => setReviewMode("changes")}
          >
            <GitBranch className="h-3.5 w-3.5" />
            {t("projectTools.gitReview.localChangesView")}
          </AstryxButton>
          <AstryxButton
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 font-medium text-muted-foreground transition-colors hover:text-foreground",
              reviewMode === "history" && "bg-background text-foreground shadow-sm",
            )}
            onClick={() => setReviewMode("history")}
          >
            <History className="h-3.5 w-3.5" />
            {t("projectTools.gitReview.commitHistoryView")}
          </AstryxButton>
        </AstryxView>
        {!useSplitReviewLayout ? (
          <AstryxView
            layout="inline-flex"
            direction="horizontal"
            className="ml-auto inline-flex shrink-0 rounded-md border border-border bg-muted/25 p-0.5"
          >
            <AstryxButton
              type="button"
              aria-label={t("projectTools.gitReview.listPane")}
              aria-pressed={stackedPane === "list"}
              title={t("projectTools.gitReview.listPane")}
              className={cn(
                GIT_REVIEW_STACKED_PANE_BUTTON_CLASS,
                stackedPane === "list" && "bg-background text-foreground shadow-sm",
              )}
              onClick={() => onStackedPaneChange("list", "back")}
            >
              {reviewMode === "changes" ? (
                <GitBranch className="h-3.5 w-3.5" />
              ) : (
                <History className="h-3.5 w-3.5" />
              )}
            </AstryxButton>
            <AstryxButton
              type="button"
              aria-label={t("projectTools.gitReview.detailPane")}
              aria-pressed={stackedPane === "detail"}
              title={t("projectTools.gitReview.detailPane")}
              className={cn(
                GIT_REVIEW_STACKED_PANE_BUTTON_CLASS,
                stackedPane === "detail" && "bg-background text-foreground shadow-sm",
              )}
              onClick={() => onStackedPaneChange("detail", "forward")}
            >
              <Eye className="h-3.5 w-3.5" />
            </AstryxButton>
          </AstryxView>
        ) : null}
      </AstryxView>
      {!canWrite && disabledMessage ? (
        <AstryxView
          layout="block"
          direction="horizontal"
          className="mt-2 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground"
        >
          {disabledMessage}
        </AstryxView>
      ) : null}
      {visibleError ? (
        <AstryxView layout="block" direction="horizontal" className="mt-2 text-xs text-destructive">
          {visibleError}
        </AstryxView>
      ) : null}
    </AstryxView>
  );
}
