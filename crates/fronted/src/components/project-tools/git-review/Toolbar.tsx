import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Grid as AstryxGrid } from "@astryxdesign/core/Grid";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Stack as AstryxStack } from "@astryxdesign/core/Stack";
import { Text as AstryxText, Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { ToggleButton, ToggleButtonGroup } from "@astryxdesign/core/ToggleButton";

// GitReview toolbar: panel header (branch summary, remote actions, counters,
// mode/pane switchers) plus the modal dialogs and the operation toast shared
// by the status and history views.
//
// Shared by every frontend runtime; only relative or @xgent/runtime imports
// are allowed here.

import { Button } from "@astryxdesign/core/Button";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { TextInput as Input } from "@astryxdesign/core/TextInput";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "../../../i18n";
import type { GitBranch as GitBranchInfo, GitWorktreeInfo } from "../../../lib/git/types";
import { gitDiscoveredRepositoryLabel, selectedGitRepositoryLabel } from "../../../lib/git/types";
import { cn } from "../../../lib/shared/utils";
import { AdaptiveDialog } from "../../astryx/AdaptiveDialog";
import {
  Check,
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
      width="var(--xgent-dialog-width-sm)"
      touchPresentation="bottom-sheet"
      bottomSheetHeight="tall"
      footer={
        <HStack gap={2} hAlign="end" wrap="wrap">
          <Button
            label={t("chat.cancel")}
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            isDisabled={loading}
          >
            {t("chat.cancel")}
          </Button>
          <Button
            variant="primary"
            label={t(remoteSetupSubmitKey(action))}
            type="button"
            size="sm"
            isDisabled={loading || !remoteUrl.trim()}
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
      <AstryxStack
        direction="vertical"
        as="form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <AstryxStack direction="vertical" className="space-y-4">
          <AstryxGrid className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <AstryxStack
              direction="vertical"
              className="truncate rounded-lg border border-border/70 bg-muted/35 px-3 py-2"
              aria-label={branch}
            >
              {branch}
            </AstryxStack>
            <AstryxStack
              direction="vertical"
              className="truncate rounded-lg border border-border/70 bg-muted/35 px-3 py-2"
              aria-label={workdir}
            >
              {workdir}
            </AstryxStack>
          </AstryxGrid>
          <Input
            isLabelHidden
            label={t("projectTools.gitReview.remoteUrl")}
            value={remoteUrl}
            onChange={(nextValue) => onRemoteUrlChange(nextValue)}
            placeholder={t("projectTools.gitReview.remoteUrlPlaceholder")}
            hasAutoFocus
            isDisabled={loading}
          />
          {error ? (
            <AstryxStack
              direction="vertical"
              className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {error}
            </AstryxStack>
          ) : null}
        </AstryxStack>
      </AstryxStack>
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
      width="var(--xgent-dialog-width-sm)"
      touchPresentation="bottom-sheet"
      bottomSheetHeight="tall"
      footer={
        <HStack gap={2} hAlign="end" wrap="wrap">
          <Button
            label={t("chat.cancel")}
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            isDisabled={loading}
          >
            {t("chat.cancel")}
          </Button>
          <Button
            variant="primary"
            label={t("projectTools.gitReview.createBranch")}
            type="button"
            size="sm"
            isDisabled={loading || !branchName.trim()}
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
      <AstryxStack
        direction="vertical"
        as="form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <AstryxStack direction="vertical" className="space-y-4">
          <AstryxStack
            direction="vertical"
            className="rounded-lg border border-border/70 bg-muted/35 px-3 py-2 text-xs"
          >
            <AstryxStack
              direction="vertical"
              className="font-mono text-[calc(11px*var(--zone-font-scale,1))] text-muted-foreground"
            >
              {target.shortSha}
            </AstryxStack>
            <AstryxStack
              direction="vertical"
              className="mt-1 truncate font-medium"
              aria-label={target.subject}
            >
              {target.subject || target.commitSha}
            </AstryxStack>
          </AstryxStack>
          <Input
            isLabelHidden
            label={t("projectTools.gitReview.branchName")}
            value={branchName}
            onChange={(nextValue) => onBranchNameChange(nextValue)}
            placeholder={t("projectTools.gitReview.branchNamePlaceholder")}
            hasAutoFocus
            isDisabled={loading}
          />
          {error ? (
            <AstryxStack
              direction="vertical"
              className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {error}
            </AstryxStack>
          ) : null}
        </AstryxStack>
      </AstryxStack>
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
      width="var(--xgent-dialog-width-md)"
      maxHeight="var(--xgent-dialog-height-lg)"
      touchPresentation="bottom-sheet"
      bottomSheetHeight="tall"
    >
      <AstryxStack direction="vertical" className="space-y-4">
        <AstryxStack direction="vertical" as="section" className="rounded-xl border p-3">
          <AstryxStack direction="vertical" className="mb-3 text-xs font-semibold">
            {t("projectTools.gitReview.createWorktree")}
          </AstryxStack>
          <AstryxGrid className="grid gap-2 sm:grid-cols-2">
            <Input
              label={t("projectTools.gitReview.worktreeBranch")}
              isLabelHidden
              value={branch}
              onChange={(nextValue) => {
                const value = nextValue;
                setBranch(value);
                if (!directoryName) setDirectoryName(value.replace(/[\\/\s]+/g, "-"));
              }}
              placeholder={t("projectTools.gitReview.worktreeBranch")}
            />
            <Input
              label={t("projectTools.gitReview.worktreeDirectory")}
              isLabelHidden
              value={directoryName}
              onChange={(nextValue) => setDirectoryName(nextValue)}
              placeholder={t("projectTools.gitReview.worktreeDirectory")}
            />
            <Input
              label={t("projectTools.gitReview.worktreeStartPoint")}
              isLabelHidden
              value={startPoint}
              onChange={(nextValue) => setStartPoint(nextValue)}
              placeholder={t("projectTools.gitReview.worktreeStartPoint")}
            />
            <Input
              label={t("projectTools.gitReview.worktreeParent")}
              isLabelHidden
              value={parentDirectory}
              onChange={(nextValue) => setParentDirectory(nextValue)}
              placeholder={t("projectTools.gitReview.worktreeParent")}
            />
          </AstryxGrid>
          <Button
            variant="ghost"
            label={t("projectTools.gitReview.createWorktree")}
            type="button"
            size="sm"
            className="mt-3 w-full"
            isDisabled={busy || !branch.trim() || !directoryName.trim()}
            onClick={() => void create()}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Folder className="h-3.5 w-3.5" />
            )}
            {t("projectTools.gitReview.createWorktree")}
          </Button>
        </AstryxStack>
        <AstryxStack direction="vertical" as="section" className="space-y-2">
          {worktrees.length === 0 ? (
            <AstryxStack
              direction="vertical"
              className="rounded-xl border border-dashed px-3 py-6 text-center text-xs text-muted-foreground"
            >
              {t("projectTools.gitReview.noWorktrees")}
            </AstryxStack>
          ) : (
            worktrees.map((worktree) => (
              <AstryxStack
                direction="vertical"
                key={worktree.path}
                className="rounded-xl border px-3 py-2.5"
              >
                <AstryxStack direction="horizontal" className="flex items-start gap-2">
                  <Folder className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
                  <AstryxStack direction="vertical" className="min-w-0 flex-1">
                    <AstryxStack direction="vertical" className="truncate text-xs font-semibold">
                      {worktree.branch || t("projectTools.gitReview.unresolved")}
                    </AstryxStack>
                    <AstryxStack
                      direction="vertical"
                      className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground"
                      aria-label={worktree.path}
                    >
                      {worktree.path}
                    </AstryxStack>
                  </AstryxStack>
                  <Button
                    label={t("chat.remove")}
                    type="button"
                    variant="ghost"
                    size="md"
                    className="h-8 w-8 text-destructive"
                    isDisabled={busy}
                    onClick={() => setRemovingPath(worktree.path)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </AstryxStack>
                {removingPath === worktree.path ? (
                  <AstryxStack
                    direction="vertical"
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
                    <AstryxStack direction="horizontal" className="mt-2 flex justify-end gap-2">
                      <Button
                        label={t("chat.cancel")}
                        type="button"
                        variant="ghost"
                        size="sm"
                        isDisabled={busy}
                        onClick={() => setRemovingPath("")}
                      >
                        {t("chat.cancel")}
                      </Button>
                      <Button
                        label={t("settings.delete")}
                        type="button"
                        variant="destructive"
                        size="sm"
                        isDisabled={busy}
                        onClick={() => void remove(worktree)}
                      >
                        {t("settings.delete")}
                      </Button>
                    </AstryxStack>
                  </AstryxStack>
                ) : null}
              </AstryxStack>
            ))
          )}
        </AstryxStack>
        {error ? (
          <AstryxStack
            direction="vertical"
            className="rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </AstryxStack>
        ) : null}
      </AstryxStack>
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
      <AstryxStack
        direction="horizontal"
        className="flex min-w-0 flex-1 items-center px-2 text-[calc(12px*var(--zone-font-scale,1))] font-medium text-muted-foreground"
      >
        <AstryxText as="span" type="inherit" className="min-w-0 truncate">
          {title}
        </AstryxText>
      </AstryxStack>
    );
  }

  const localBranches = branches.filter((branch) => branch.kind === "local");
  const remoteBranches = branches.filter((branch) => branch.kind === "remote");

  const branchItem = (branch: GitBranchInfo, isCurrent: boolean, labelText: string) => ({
    id: `${branch.kind}:${branch.fullName}`,
    label: labelText,
    description: branch.fullName === labelText ? undefined : branch.fullName,
    icon: isCurrent ? <Check className="h-3.5 w-3.5" /> : <GitBranch className="h-3.5 w-3.5" />,
    isDisabled: operationBusy || isCurrent || writeDisabled,
    onClick: () => void switchBranch(branch.fullName, branch.kind),
  });

  return (
    <>
      <GitWorktreeModal
        data={data}
        open={worktreeModalOpen}
        onClose={() => setWorktreeModalOpen(false)}
      />
      <DropdownMenu
        isMenuOpen={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) void loadBranches();
        }}
        alignment="start"
        menuWidth="calc(var(--spacing-10) * 7)"
        button={{
          label: t("projectTools.gitReview.switchBranch"),
          children: title,
          variant: "ghost",
          isDisabled: operationBusy,
          className:
            "flex min-w-0 flex-1 items-center px-2 text-[calc(12px*var(--zone-font-scale,1))] font-medium",
        }}
        items={
          branchesLoading
            ? [
                {
                  label: t("common.loading"),
                  icon: <Loader2 className="h-4 w-4 animate-spin" />,
                  isDisabled: true,
                },
              ]
            : branchesError
              ? [{ label: branchesError, isDisabled: true }]
              : [
                  ...(localBranches.length > 0
                    ? [
                        {
                          type: "section" as const,
                          title: t("git.branchSelector.localBranches"),
                          items: localBranches.map((branch) =>
                            branchItem(branch, branch.current, branch.name),
                          ),
                        },
                      ]
                    : []),
                  ...(remoteBranches.length > 0
                    ? [
                        {
                          type: "section" as const,
                          title: t("git.branchSelector.remoteBranches"),
                          items: remoteBranches
                            .slice(0, GIT_REVIEW_REMOTE_BRANCH_DISPLAY_LIMIT)
                            .map((branch) =>
                              branchItem(
                                branch,
                                branch.current ||
                                  (state.upstream !== "" && branch.fullName === state.upstream),
                                branch.fullName,
                              ),
                            ),
                        },
                      ]
                    : []),
                  { type: "divider" as const },
                  {
                    label: t("projectTools.gitReview.manageWorktrees"),
                    icon: <Folder className="h-3.5 w-3.5" />,
                    isDisabled: operationBusy || writeDisabled,
                    onClick: () => setWorktreeModalOpen(true),
                  },
                ]
        }
      />
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
    <ToggleButtonGroup
      label={`${repositoryLabel} / ${branchLabel}`}
      type="single"
      value={value}
      onChange={(nextValue) => {
        if (nextValue === "repository" || nextValue === "branch") onChange(nextValue);
      }}
      size="sm"
    >
      {items.map((item) => {
        return (
          <ToggleButton
            key={item.key}
            value={item.key}
            label={item.label}
            tooltip={item.label}
            icon={<item.Icon className={cn("h-4 w-4", item.activeTone)} />}
            isIconOnly
          />
        );
      })}
    </ToggleButtonGroup>
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
    <AstryxStack direction="vertical" className="shrink-0 border-b border-border px-3 py-3">
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
      <AstryxStack direction="horizontal" className="flex items-center gap-2">
        {showRepositoryScope ? (
          <GitReviewScopeDial
            value={effectiveScope}
            onChange={setScope}
            repositoryLabel={t("projectTools.gitReview.repositoryPicker")}
            branchLabel={t("projectTools.gitReview.switchBranch")}
          />
        ) : (
          <AstryxStack
            direction="horizontal"
            className="flex h-7 w-7 shrink-0 items-center justify-center"
            aria-label={t("projectTools.gitReview.switchBranch")}
          >
            <GitBranch className="h-[18px] w-[18px] text-emerald-600 dark:text-emerald-300" />
          </AstryxStack>
        )}
        <AstryxStack
          direction="horizontal"
          className="flex h-7 min-w-0 flex-1 items-stretch overflow-hidden rounded-md border border-border bg-muted/25"
        >
          {effectiveScope === "repository" ? (
            <DropdownMenu
              alignment="start"
              menuWidth="calc(var(--spacing-10) * 7)"
              button={{
                label: t("projectTools.gitReview.repositoryPicker"),
                children:
                  selectedGitRepositoryLabel(repositories, selectedRepoRoot) ||
                  state.repoRoot ||
                  t("projectTools.gitReview.noRepository"),
                variant: "ghost",
                isDisabled: operationBusy,
                className:
                  "flex min-w-0 flex-1 items-center px-2 text-[calc(12px*var(--zone-font-scale,1))] font-medium",
              }}
              items={repositories.map((repo) => {
                const value = repo.isWorkspaceRoot ? "" : repo.root;
                const selected = value === selectedRepoRoot;
                return {
                  id: repo.root,
                  label: gitDiscoveredRepositoryLabel(repo),
                  description: repo.root,
                  icon: selected ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Folder className="h-3.5 w-3.5" />
                  ),
                  isDisabled: operationBusy || selected,
                  onClick: () => selectRepository(value),
                };
              })}
            />
          ) : (
            <GitReviewBranchMenu data={data} writeDisabled={writeDisabled} />
          )}
        </AstryxStack>
        <Button
          label={t("projectTools.gitReview.addAiReview")}
          size="sm"
          variant="ghost"
          isDisabled={!onInsertCodeReviewSkill || state.status !== "ready"}
          className="h-7 w-7 px-0"
          tooltip={t(
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
          label={t("projectTools.gitReview.refresh")}
          size="sm"
          variant="ghost"
          isDisabled={loading || historyLoading || operationBusy}
          className="h-7 w-7 px-0"
          tooltip={t("projectTools.gitReview.refresh")}
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
          label={t("projectTools.gitReview.fetch")}
          size="sm"
          variant="ghost"
          isDisabled={writeDisabled || operationBusy}
          tooltip={t("projectTools.gitReview.fetch")}
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
          label={t("projectTools.gitReview.pull")}
          size="sm"
          variant="ghost"
          isDisabled={writeDisabled || operationBusy}
          tooltip={t("projectTools.gitReview.pull")}
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
          label={t("projectTools.gitReview.push")}
          size="sm"
          variant="ghost"
          isDisabled={writeDisabled || operationBusy}
          tooltip={t("projectTools.gitReview.push")}
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
      </AstryxStack>
      {state.status === "ready" ? (
        <AstryxStack
          direction="vertical"
          className="mt-1.5 overflow-hidden rounded-xl border border-white/20 bg-white/50 shadow-sm backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.03]"
        >
          <AstryxStack
            direction="horizontal"
            className="flex items-center gap-1.5 border-b border-black/[0.04] px-3 py-2 dark:border-white/[0.06]"
          >
            <AstryxText
              as="span"
              type="inherit"
              className="shrink-0 rounded bg-muted/70 px-1.5 py-0.5 text-[calc(10px*var(--zone-font-scale,1))] font-medium leading-none text-muted-foreground"
            >
              {t("projectTools.gitReview.labelBase")}
            </AstryxText>
            <Cloud className="h-3 w-3 shrink-0 text-muted-foreground/60" />
            <AstryxText
              as="span"
              type="inherit"
              className="min-w-0 truncate font-mono text-[calc(11px*var(--zone-font-scale,1))] text-foreground/75"
              aria-label={
                branchDiff?.baseRef || state.upstream || t("projectTools.gitReview.unresolved")
              }
            >
              {branchDiff?.baseRef || state.upstream || t("projectTools.gitReview.unresolved")}
            </AstryxText>
          </AstryxStack>
          <AstryxGrid className="grid grid-cols-5">
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
              <AstryxStack
                direction="vertical"
                key={item.label}
                className={cn(
                  "flex flex-col items-center gap-0.5 py-2",
                  index > 0 && "border-l border-black/[0.04] dark:border-white/[0.06]",
                )}
              >
                <AstryxText
                  as="span"
                  type="inherit"
                  className={cn(
                    "text-sm font-semibold tabular-nums leading-none",
                    item.count > 0 ? item.tone : "text-muted-foreground/40",
                  )}
                >
                  {item.count}
                </AstryxText>
                <AstryxText
                  as="span"
                  type="inherit"
                  className="text-[calc(9px*var(--zone-font-scale,1))] leading-none text-muted-foreground/60"
                >
                  {item.label}
                </AstryxText>
              </AstryxStack>
            ))}
          </AstryxGrid>
        </AstryxStack>
      ) : null}
      <AstryxStack direction="horizontal" className="mt-3 flex items-center gap-2">
        <ToggleButtonGroup
          label={`${t("projectTools.gitReview.localChangesView")} / ${t("projectTools.gitReview.commitHistoryView")}`}
          type="single"
          value={reviewMode}
          onChange={(nextValue) => {
            if (nextValue === "changes" || nextValue === "history") setReviewMode(nextValue);
          }}
          size="sm"
        >
          <ToggleButton
            value="changes"
            label={t("projectTools.gitReview.localChangesView")}
            icon={<GitBranch className="h-3.5 w-3.5" />}
          >
            {t("projectTools.gitReview.localChangesView")}
          </ToggleButton>
          <ToggleButton
            value="history"
            label={t("projectTools.gitReview.commitHistoryView")}
            icon={<History className="h-3.5 w-3.5" />}
          >
            {t("projectTools.gitReview.commitHistoryView")}
          </ToggleButton>
        </ToggleButtonGroup>
        {!useSplitReviewLayout ? (
          <AstryxStack direction="horizontal" className="ml-auto shrink-0">
            <ToggleButtonGroup
              label={`${t("projectTools.gitReview.listPane")} / ${t("projectTools.gitReview.detailPane")}`}
              type="single"
              value={stackedPane}
              onChange={(nextValue) => {
                if (nextValue === "list") onStackedPaneChange("list", "back");
                if (nextValue === "detail") onStackedPaneChange("detail", "forward");
              }}
              size="sm"
            >
              <ToggleButton
                value="list"
                label={t("projectTools.gitReview.listPane")}
                tooltip={t("projectTools.gitReview.listPane")}
                icon={
                  reviewMode === "changes" ? (
                    <GitBranch className="h-3.5 w-3.5" />
                  ) : (
                    <History className="h-3.5 w-3.5" />
                  )
                }
                isIconOnly
              />
              <ToggleButton
                value="detail"
                label={t("projectTools.gitReview.detailPane")}
                tooltip={t("projectTools.gitReview.detailPane")}
                icon={<Eye className="h-3.5 w-3.5" />}
                isIconOnly
              />
            </ToggleButtonGroup>
          </AstryxStack>
        ) : null}
      </AstryxStack>
      {!canWrite && disabledMessage ? (
        <AstryxStack
          direction="vertical"
          className="mt-2 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground"
        >
          {disabledMessage}
        </AstryxStack>
      ) : null}
      {visibleError ? (
        <AstryxStack direction="vertical" className="mt-2 text-xs text-destructive">
          {visibleError}
        </AstryxStack>
      ) : null}
    </AstryxStack>
  );
}
