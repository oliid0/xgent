import { openUrl } from "@xgent/runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canStageEntry,
  canUnstageEntry,
  commitMessageText,
  defaultBranchNameForCommit,
  type GitOperationNoticeAction,
  gitFileContextPayload,
  gitHubCommitUrl,
  remoteSetupDescriptionKey,
  remoteSetupSubmitKey,
  revealTargetForEntry,
} from "../components/project-tools/git-review/model";
import { useGitReviewData } from "../components/project-tools/git-review/useGitReviewData";
import {
  type WorkspaceGitContext,
  WorkspaceToolsContext,
  type WorkspaceToolsContextValue,
} from "../components/project-tools/WorkspaceToolsContext";
import { useLocale } from "../i18n";
import { computeGitGraph } from "../lib/git/gitGraph";
import type { GitBranch, GitClient, GitOperationResponse, GitWorktreeInfo } from "../lib/git/types";
import { gitDiscoveredRepositoryLabel } from "../lib/git/types";
import type {
  AppSettings,
  WorkspaceFileTreeState,
  WorkspaceFileTreeStatePatch,
} from "../lib/settings";
import { writeClipboardText } from "../lib/system/clipboardText";
import type { TerminalClient } from "../lib/terminal/types";
import type { WorkspaceActivityClient } from "../lib/workspace-activity/types";
import { presentationControls } from "./controls";
import { NativeSurface } from "./NativeSurface";
import { createNativePresentationTheme } from "./nativeTheme";
import { createNativeWorkspacePanel } from "./nativeWorkspacePanel";
import type { PresentationNode } from "./types";

type Props = {
  open: boolean;
  workdir: string;
  projectPathKey: string;
  settings: AppSettings;
  client: GitClient;
  terminalClient: TerminalClient;
  workspaceActivityClient: WorkspaceActivityClient | null;
  fileTreeState: WorkspaceFileTreeState;
  onFileTreeStateChange: (patch: WorkspaceFileTreeStatePatch) => void;
  onRevealFile: (path: string) => void;
  git: WorkspaceGitContext;
  onClose: () => void;
};

/** macOS shares the complete desktop Git controller; only presentation differs. */
export function NativeDesktopGitPanel(props: Props) {
  const context = useMemo<WorkspaceToolsContextValue>(
    () => ({
      projectPathKey: props.projectPathKey,
      cwd: props.workdir,
      theme: props.settings.theme === "dark" ? "dark" : "light",
      clients: {
        git: props.client,
        terminal: props.terminalClient,
        workspaceActivity: props.workspaceActivityClient,
      },
      capabilities: {
        projectReady: !!props.workdir.trim(),
        terminalReady: true,
        gitWriteEnabled: true,
      },
      fileTree: {
        state: props.fileTreeState,
        initialized: true,
        onInitializedChange: () => undefined,
        onStateChange: props.onFileTreeStateChange,
        onRevealInFileTree: props.onRevealFile,
      },
      git: props.git,
      ssh: {
        hosts: [],
        associatedHostIds: [],
        sessions: [],
        onSessionSnapshot: () => undefined,
        onSessionClosed: () => undefined,
        onSessionsReconcile: () => undefined,
      },
      openExternal: (url) => {
        void openUrl(url);
      },
    }),
    [
      props.projectPathKey,
      props.workdir,
      props.settings.theme,
      props.client,
      props.terminalClient,
      props.workspaceActivityClient,
      props.fileTreeState,
      props.onFileTreeStateChange,
      props.onRevealFile,
      props.git,
    ],
  );
  if (!props.open) return null;
  return (
    <WorkspaceToolsContext.Provider value={context}>
      <NativeDesktopGitBody
        key={props.workdir}
        settings={props.settings}
        onClose={props.onClose}
        context={context}
      />
    </WorkspaceToolsContext.Provider>
  );
}

export function NativeDesktopGitBody(props: {
  settings: AppSettings;
  onClose: () => void;
  context: WorkspaceToolsContextValue;
}) {
  const { t } = useLocale();
  const data = useGitReviewData({ active: true });
  const { cwd, gitClient: client, state } = data;
  const [draft, setDraftState] = useState({
    message: "",
    branch: "",
    directory: "",
    startPoint: "",
    parent: "",
    force: false,
    deleteBranch: false,
  });
  const draftRef = useRef(draft);
  const edit = useCallback((patch: Partial<typeof draft>) => {
    draftRef.current = { ...draftRef.current, ...patch };
    setDraftState(draftRef.current);
  }, []);
  const [diffMode, setDiffMode] = useState("workingTree");
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [worktrees, setWorktrees] = useState<GitWorktreeInfo[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [branchFromCommit, setBranchFromCommit] = useState("");
  const [confirm, setConfirm] = useState<{
    kind: "discard" | "discardAll" | "worktree";
    path: string;
    oldPath?: string | null;
  } | null>(null);
  const scope = useRef({
    cwd,
    revision: 0,
    active: true,
    branchRequest: 0,
    submitting: false,
  }).current;
  if (scope.cwd !== cwd) {
    scope.cwd = cwd;
    scope.revision++;
    scope.branchRequest++;
  }
  const revision = scope.revision;
  const current = () => scope.active && scope.cwd === cwd && scope.revision === revision;
  useEffect(() => {
    scope.active = true;
    return () => {
      scope.active = false;
      scope.revision++;
      scope.branchRequest++;
    };
  }, [scope]);
  useEffect(() => {
    edit({
      message: "",
      branch: "",
      directory: "",
      startPoint: "",
      parent: "",
      force: false,
      deleteBranch: false,
    });
    setBranches([]);
    setWorktrees([]);
    setToolsOpen(false);
    setBranchFromCommit("");
    setConfirm(null);
  }, [cwd, edit]);
  const locked = data.isBusy() || !!data.disabledMessage;
  const writable =
    data.canWrite && !locked && state.status === "ready" && state.workdir === cwd && !!client;
  const c = presentationControls();
  // Every published action retires when its repository or panel closes.
  const action = (
    id: string,
    key: string,
    run: () => unknown,
    enabled = true,
    destructive = false,
  ): PresentationNode => ({
    ...c.action(id, t(key), () => (current() ? run() : undefined), enabled && current()),
    destructive,
  });
  const input = (
    id: string,
    key: string,
    value: string,
    patch: (value: string) => Partial<typeof draft>,
  ) =>
    c.input(
      id,
      t(key),
      value,
      (next) => {
        if (current() && !data.isBusy()) edit(patch(next));
      },
      false,
      !locked,
    );
  const operation = async (
    name: string,
    task: () => Promise<GitOperationResponse>,
    notice?: GitOperationNoticeAction,
  ) => {
    if (!current() || !client || !data.canWrite || data.isBusy()) return false;
    return data.runOperation(name, task, notice);
  };
  const reloadBranches = async () => {
    if (!current() || !client || !cwd.trim()) return;
    const request = ++scope.branchRequest;
    setBranchesLoading(true);
    try {
      const result = await client.branches(cwd);
      if (!current() || scope.branchRequest !== request) return;
      setBranches(result.branches);
      setWorktrees(result.worktrees);
    } catch (error) {
      if (current() && scope.branchRequest === request) data.setError(String(error));
    } finally {
      if (current() && scope.branchRequest === request) setBranchesLoading(false);
    }
  };
  const commit = async () => {
    const message = draftRef.current.message.trim();
    if (!message || !writable || !state.dirtyCounts.staged || scope.submitting) return;
    scope.submitting = true;
    try {
      if (await operation("commit", () => client!.commit(cwd, message), "commit")) {
        if (current() && draftRef.current.message.trim() === message) edit({ message: "" });
      }
    } finally {
      scope.submitting = false;
    }
  };
  const toolbar: PresentationNode[] = [
    ...(data.repositories.length > 1
      ? [
          c.select(
            "git-repository",
            t("projectTools.gitReview.repositoryPicker"),
            data.selectedRepoRoot,
            data.repositories.map((repo) => ({
              value: repo.isWorkspaceRoot ? "" : repo.root,
              label: gitDiscoveredRepositoryLabel(repo),
            })),
            (root) => {
              if (current() && !data.isBusy() && root !== data.selectedRepoRoot) {
                scope.revision++;
                scope.branchRequest++;
                data.selectRepository(root);
              }
            },
            !locked,
          ),
        ]
      : []),
    {
      id: "git-header",
      kind: "HStack",
      children: [
        {
          id: "git-head",
          kind: "Heading",
          text: state.head || t("projectTools.gitReviewTitle"),
          fill: true,
          icon: "arrow.triangle.branch",
        },
        action(
          "git-refresh",
          "projectTools.gitReview.refresh",
          async () => {
            if (data.isBusy()) return;
            await data.discoverRepositories();
            if (!current()) return;
            return data.reviewMode === "history" ? data.loadHistory() : data.refresh();
          },
          !locked,
        ),
        action(
          "git-ai-review",
          "projectTools.gitReview.addAiReview",
          () => props.context.git.onInsertCodeReviewSkill?.(),
          state.status === "ready" && !!props.context.git.onInsertCodeReviewSkill,
        ),
        action("git-close", "chat.mobileTerminal.close", () => {
          scope.active = false;
          scope.revision++;
          scope.branchRequest++;
          props.onClose();
        }),
      ],
    },
    {
      id: "git-controls",
      kind: "HStack",
      children: [
        {
          ...action(
            "git-branches",
            "projectTools.gitReview.switchBranch",
            async () => {
              setToolsOpen(!toolsOpen);
              if (!toolsOpen) await reloadBranches();
            },
            !locked,
          ),
          icon: "arrow.triangle.branch",
        },
        ...(["fetch", "pull", "push"] as const).map((name) =>
          action(
            `git-${name}`,
            `projectTools.gitReview.${name}`,
            () => operation(name, () => client![name](cwd), name),
            writable,
          ),
        ),
      ],
    },
    {
      id: "git-summary",
      kind: "Text",
      secondary: true,
      size: "small",
      text: `${data.branchDiff?.baseRef || state.upstream || t("projectTools.gitReview.unresolved")} · ↑${state.ahead} ↓${state.behind} · ${t("projectTools.gitReview.labelStaged")} ${state.dirtyCounts.staged} · ${t("projectTools.gitReview.labelUnstaged")} ${state.dirtyCounts.unstaged} · ${t("projectTools.gitReview.labelUntracked")} ${state.dirtyCounts.untracked}`,
    },
    {
      ...c.select(
        "git-view",
        t("chat.mobileGit.title"),
        data.reviewMode,
        [
          { value: "changes", label: t("projectTools.gitReview.localChangesView") },
          { value: "history", label: t("projectTools.gitReview.commitHistoryView") },
        ],
        (value) => {
          if (current() && !data.isBusy()) data.setReviewMode(value as "changes" | "history");
        },
        !locked,
      ),
      kind: "SegmentedControl",
    },
    c.toggle(
      "git-diff-visible",
      t(data.diffVisible ? "projectTools.gitReview.hideDiff" : "projectTools.gitReview.showDiff"),
      data.diffVisible,
      (value) => {
        if (current()) data.setDiffVisible(value);
      },
    ),
  ];
  const banners: PresentationNode[] = [];
  for (const [id, text] of [
    ["error", data.error],
    ["branch-error", data.branchError],
    ["history-error", data.historyError],
    ["disabled", data.disabledMessage],
  ] as const) {
    if (text) banners.push({ id: `git-${id}`, kind: "Banner", label: text, status: "error" });
  }
  if (data.operationNotice)
    banners.push({
      id: "git-notice",
      kind: "Banner",
      label: data.operationNotice.title,
      text: data.operationNotice.message,
      status: data.operationNotice.kind === "success" ? "completed" : "error",
      children: [action("git-notice-dismiss", "chat.close", data.dismissOperationNotice)],
    });
  if (data.loading || data.historyLoading || data.busy)
    banners.push({ id: "git-busy", kind: "Progress", label: t("chat.mobileTerminal.running") });
  const changes: PresentationNode[] = [];
  if (state.status === "not_repo")
    changes.push({
      id: "git-no-repository",
      kind: "EmptyState",
      label: t("git.branchSelector.initRepositoryTitle"),
      text: t("git.branchSelector.initRepositoryDescription"),
      children: [
        action(
          "git-init",
          "git.branchSelector.initRepository",
          () => operation("init", () => client!.init(cwd)),
          data.canWrite && !locked && !!client,
        ),
      ],
    });
  else
    for (const section of ["staged", "working"] as const) {
      const entries = state.entries.filter(section === "staged" ? canUnstageEntry : canStageEntry);
      changes.push({
        id: `git-${section}`,
        kind: "Section",
        label: t(
          section === "staged"
            ? "projectTools.gitReview.stagedChangesTitle"
            : "projectTools.gitReview.changesTitle",
        ),
        children: [
          {
            id: `git-${section}-actions`,
            kind: "HStack",
            children: [
              section === "staged"
                ? action(
                    "git-unstage-all",
                    "projectTools.gitReview.unstageAllChanges",
                    () => operation("unstage_all", () => client!.unstageAll(cwd)),
                    writable && entries.length > 0,
                  )
                : action(
                    "git-stage-all",
                    "projectTools.gitReview.stageAllChanges",
                    () => operation("stage_all", () => client!.stageAll(cwd)),
                    writable && entries.length > 0,
                  ),
              ...(section === "working"
                ? [
                    action(
                      "git-discard-all",
                      "projectTools.gitReview.discardAllChanges",
                      () => setConfirm({ kind: "discardAll", path: "" }),
                      writable && state.entries.length > 0,
                      true,
                    ),
                  ]
                : []),
            ],
          },
          ...(entries.length
            ? entries.map((entry) => ({
                id: `git-${section}:${entry.path}`,
                kind: "VStack" as const,
                children: [
                  {
                    ...action(
                      `git-${section}:${entry.path}:select`,
                      "projectTools.gitReview.viewChanges",
                      () => {
                        setDiffMode("workingTree");
                        data.selectPath(entry.path);
                      },
                    ),
                    kind: "NavigationRow" as const,
                    label: entry.path,
                    text: `${entry.indexStatus}${entry.worktreeStatus}`,
                    selected: entry.path === data.selectedPath,
                    icon: "doc.text",
                  },
                  {
                    id: `git-${section}:${entry.path}:menu`,
                    kind: "Menu" as const,
                    variant: "compact",
                    label: t("projectTools.gitReview.viewChanges"),
                    icon: "ellipsis",
                    children: [
                      section === "staged"
                        ? action(
                            `git-${section}:${entry.path}:unstage`,
                            "projectTools.gitReview.unstageChanges",
                            () => operation("unstage", () => client!.unstage(cwd, entry.path)),
                            writable,
                          )
                        : action(
                            `git-${section}:${entry.path}:stage`,
                            "projectTools.gitReview.stageChanges",
                            () => operation("stage", () => client!.stage(cwd, entry.path)),
                            writable,
                          ),
                      action(
                        `git-${section}:${entry.path}:discard`,
                        "projectTools.gitReview.discardChanges",
                        () =>
                          setConfirm({ kind: "discard", path: entry.path, oldPath: entry.oldPath }),
                        writable,
                        true,
                      ),
                      ...(entry.untracked
                        ? [
                            action(
                              `git-${section}:${entry.path}:ignore`,
                              "projectTools.gitReview.addToGitignore",
                              () =>
                                operation("add_to_gitignore", () =>
                                  client!.addToGitignore(cwd, entry.path),
                                ),
                              writable,
                            ),
                          ]
                        : []),
                      action(
                        `git-${section}:${entry.path}:reveal`,
                        "projectTools.gitReview.revealInFileTree",
                        () =>
                          props.context.fileTree.onRevealInFileTree(revealTargetForEntry(entry)),
                      ),
                      ...(client?.openSystemFileLocation
                        ? [
                            action(
                              `git-${section}:${entry.path}:finder`,
                              "projectTools.gitReview.openSystemFileLocation",
                              () => client.openSystemFileLocation!(cwd, entry.path),
                            ),
                          ]
                        : []),
                    ],
                  },
                ],
              }))
            : [
                {
                  id: `git-${section}-empty`,
                  kind: "Text" as const,
                  secondary: true,
                  text: t(
                    section === "staged"
                      ? "projectTools.gitReview.noStagedChanges"
                      : "projectTools.gitReview.noWorkingChanges",
                  ),
                },
              ]),
        ],
      });
    }
  const { rows: graph } = computeGitGraph(data.historyCommits, {
    currentRef: state.head,
    remoteRef: data.historyGraphState.historyRemoteRef,
    baseRef: data.historyGraphState.historyBaseRef,
    remoteName: state.remoteName,
    showRemoteChangeMarkers: true,
    ahead: data.historyGraphState.historyAhead,
    behind: data.historyGraphState.historyBehind,
    mergeBase: data.historyGraphState.mergeBase,
  });
  const graphBySha = new Map(graph.map((row) => [row.sha, row]));
  const history: PresentationNode[] = data.historyCommits.map((entry) => ({
    id: `git-commit:${entry.sha}`,
    kind: "Section",
    value: JSON.stringify(graphBySha.get(entry.sha)),
    label: entry.subject,
    children: [
      {
        ...action(
          `git-commit:${entry.sha}:select`,
          "projectTools.gitReview.expandCommitFiles",
          () => data.selectCommitRow(entry),
        ),
        label: `${entry.shortSha} · ${entry.authorName} · ${entry.authorDate}`,
        text: entry.refs.join(" · "),
        kind: "NavigationRow",
        selected: data.selectedCommitSha === entry.sha,
        icon: "point.topleft.down.to.point.bottomright.curvepath",
      },
      {
        id: `git-commit:${entry.sha}:menu`,
        kind: "Menu",
        variant: "compact",
        label: t("projectTools.gitReview.viewCommit"),
        icon: "ellipsis",
        children: [
          action(`git-commit:${entry.sha}:diff`, "projectTools.gitReview.openChange", () =>
            data.openCommitDiffData(entry),
          ),
          action(
            `git-commit:${entry.sha}:compare`,
            "projectTools.gitReview.compareWithRemote",
            () => data.compareCommitWithRemote(entry),
            !!client,
          ),
          action(
            `git-commit:${entry.sha}:branch`,
            "projectTools.gitReview.createBranch",
            () => {
              setBranchFromCommit(entry.sha);
              edit({ branch: defaultBranchNameForCommit(entry) });
            },
            writable,
          ),
          action(
            `git-commit:${entry.sha}:github`,
            "projectTools.gitReview.openOnGithub",
            () => openUrl(gitHubCommitUrl(state.remoteUrl, entry.sha)),
            !!gitHubCommitUrl(state.remoteUrl, entry.sha),
          ),
          action(`git-commit:${entry.sha}:copy`, "projectTools.gitReview.copyCommitHash", () =>
            writeClipboardText(entry.sha),
          ),
          action(
            `git-commit:${entry.sha}:message`,
            "projectTools.gitReview.copyCommitMessage",
            async () => {
              const details = await data.loadCommitDetails(entry.sha);
              if (current()) await writeClipboardText(commitMessageText(details) || entry.subject);
            },
          ),
          action(
            `git-commit:${entry.sha}:context`,
            "projectTools.gitReview.addToContext",
            async () => {
              const details = await data.loadCommitDetails(entry.sha);
              if (current())
                props.context.git.onInsertCommitMention?.({
                  ...details,
                  githubUrl: gitHubCommitUrl(details.remoteUrl || state.remoteUrl, details.sha),
                });
            },
            !!props.context.git.onInsertCommitMention,
          ),
        ],
      },
      ...(data.expandedCommitShas.has(entry.sha)
        ? entry.files.map((file) => ({
            id: `git-commit:${entry.sha}:file:${file.path}`,
            kind: "HStack" as const,
            children: [
              {
                ...action(
                  `git-commit:${entry.sha}:file:${file.path}:diff`,
                  "projectTools.gitReview.viewCommitFileDiff",
                  () => data.selectCommitFileData(entry, file),
                ),
                label: file.path,
                icon: "doc.text",
                fill: true,
              },
              action(
                `git-commit:${entry.sha}:file:${file.path}:context`,
                "projectTools.gitReview.addToContext",
                () =>
                  props.context.git.onInsertGitFileMention?.(
                    gitFileContextPayload(entry, file, state),
                  ),
                !!props.context.git.onInsertGitFileMention,
              ),
            ],
          }))
        : []),
    ],
  }));
  for (let index = 0; index < graph.length; index++) {
    const row = graph[index];
    if (row.kind === "commit") continue;
    const following = graph.slice(index + 1).find((next) => next.kind === "commit");
    const marker: PresentationNode = {
      id: `git-history-marker:${row.sha}`,
      kind: "Section",
      value: JSON.stringify(row),
      label: t(
        row.kind === "incoming-changes"
          ? "projectTools.gitReview.incomingChanges"
          : "projectTools.gitReview.outgoingChanges",
      ),
      children: [
        {
          id: `git-history-marker:${row.sha}:ref`,
          kind: "Text",
          secondary: true,
          text:
            row.kind === "incoming-changes" ? data.historyGraphState.historyRemoteRef : state.head,
        },
      ],
    };
    const position = following
      ? history.findIndex((node) => node.id === `git-commit:${following.sha}`)
      : -1;
    if (position < 0) history.push(marker);
    else history.splice(position, 0, marker);
  }
  if (!history.length)
    history.push({
      id: "git-history-empty",
      kind: "EmptyState",
      label: t("projectTools.gitReview.noCommitHistory"),
    });
  if (data.historyHasMore || data.historyLoadMoreError)
    history.push(
      action(
        "git-load-more",
        data.historyLoadMoreError
          ? "projectTools.gitReview.loadMoreCommitsFailed"
          : "projectTools.gitReview.loadMoreCommits",
        () => data.loadHistory({ append: true }),
        !data.historyLoadingMore && !locked,
      ),
    );
  if (data.historyLoadingMore)
    history.push({
      id: "git-loading-more",
      kind: "Progress",
      label: t("projectTools.gitReview.loadingMoreCommits"),
    });
  const diff =
    data.reviewMode === "history"
      ? data.commitDiff
      : diffMode === "branch"
        ? data.branchDiff
        : data.worktreeDiff;
  const detail: PresentationNode[] = [
    ...(data.reviewMode === "changes"
      ? [
          c.select(
            "git-diff-mode",
            t("projectTools.gitReview.viewChanges"),
            diffMode,
            [
              { value: "workingTree", label: t("projectTools.gitReview.workingTree") },
              { value: "branch", label: t("projectTools.gitReview.branchDiff") },
            ],
            (value) => {
              if (current()) setDiffMode(value);
            },
          ),
        ]
      : []),
    {
      id: "git-diff-title",
      kind: "Text",
      text: data.reviewMode === "history" ? data.historyDiffSubtitle : data.selectedPath,
    },
    ...(data.diffLoading || data.commitDiffLoading
      ? [{ id: "git-diff-loading", kind: "Progress" as const }]
      : []),
    ...(diff
      ? [
          {
            id: "git-diff-stat",
            kind: "CodeBlock" as const,
            language: "plaintext",
            text: diff.stat,
          },
          {
            id: "git-diff-patch",
            kind: "CodeBlock" as const,
            language: "diff",
            text: diff.patch || t("projectTools.gitReview.noDiff"),
          },
          ...(diff.binaryFiles.length
            ? [
                {
                  id: "git-diff-binary",
                  kind: "Text" as const,
                  text: `${t("projectTools.gitReview.statBinary")}: ${diff.binaryFiles.join(", ")}`,
                },
              ]
            : []),
          ...(diff.truncated
            ? [
                {
                  id: "git-diff-truncated",
                  kind: "Banner" as const,
                  label: t("projectTools.gitReview.diffOutputTruncated"),
                },
              ]
            : []),
        ]
      : [
          {
            id: "git-diff-empty",
            kind: "EmptyState" as const,
            label: t(
              data.reviewMode === "history"
                ? "projectTools.gitReview.selectCommitFileToViewDiff"
                : "projectTools.gitReview.selectFileToViewDiff",
            ),
          },
        ]),
  ];
  const overlays: PresentationNode[] = [];
  if (toolsOpen)
    overlays.push(
      c.group("git-branch-tools", t("projectTools.gitReview.switchBranch"), [
        ...(branchesLoading ? [{ id: "git-branches-loading", kind: "Progress" as const }] : []),
        action(
          "git-branches-refresh",
          "projectTools.gitReview.refresh",
          reloadBranches,
          !branchesLoading && !locked,
        ),
        ...branches.map((branch) => ({
          ...action(
            `git-branch:${branch.kind}:${branch.fullName}`,
            "projectTools.gitReview.switchBranch",
            async () => {
              if (await data.switchBranch(branch.fullName, branch.kind)) {
                if (current()) await reloadBranches();
              }
            },
            writable && !branch.current,
          ),
          label: branch.name,
          text: branch.upstream || branch.fullName,
          selected: branch.current,
          kind: "NavigationRow" as const,
        })),
        {
          id: "git-worktree-tools",
          kind: "Section",
          label: t("projectTools.gitReview.worktrees"),
          children: [
            input(
              "git-worktree-branch",
              "projectTools.gitReview.worktreeBranch",
              draft.branch,
              (branch) => ({ branch }),
            ),
            input(
              "git-worktree-directory",
              "projectTools.gitReview.worktreeDirectory",
              draft.directory,
              (directory) => ({ directory }),
            ),
            input(
              "git-worktree-start",
              "projectTools.gitReview.worktreeStartPoint",
              draft.startPoint,
              (startPoint) => ({ startPoint }),
            ),
            input(
              "git-worktree-parent",
              "projectTools.gitReview.worktreeParent",
              draft.parent,
              (parent) => ({ parent }),
            ),
            action(
              "git-worktree-create",
              "projectTools.gitReview.createWorktree",
              async () => {
                const next = draftRef.current;
                if (!next.branch.trim() || !next.directory.trim()) return;
                if (
                  await operation("create_worktree", () =>
                    client!.createWorktree(cwd, {
                      branch: next.branch.trim(),
                      directoryName: next.directory.trim(),
                      startPoint: next.startPoint.trim() || undefined,
                      parentDirectory: next.parent.trim() || undefined,
                    }),
                  )
                ) {
                  if (current()) {
                    edit({ branch: "", directory: "", startPoint: "" });
                    await reloadBranches();
                  }
                }
              },
              writable && !!draft.branch.trim() && !!draft.directory.trim(),
            ),
            ...worktrees.map((tree) => ({
              id: `git-worktree:${tree.path}`,
              kind: "HStack" as const,
              children: [
                {
                  id: `git-worktree:${tree.path}:label`,
                  kind: "Text" as const,
                  text: `${tree.branch} · ${tree.path}`,
                  fill: true,
                },
                action(
                  `git-worktree:${tree.path}:remove`,
                  "chat.remove",
                  () => setConfirm({ kind: "worktree", path: tree.path }),
                  writable,
                  true,
                ),
              ],
            })),
          ],
        },
      ]),
    );
  if (confirm)
    overlays.push(
      c.group(
        "git-confirm",
        t(
          confirm.kind === "worktree"
            ? "chat.remove"
            : confirm.kind === "discardAll"
              ? "projectTools.gitReview.discardAllChanges"
              : "projectTools.gitReview.discardChanges",
        ),
        [
          {
            id: "git-confirm-description",
            kind: "Text",
            text:
              confirm.kind === "worktree"
                ? confirm.path
                : t(
                    confirm.kind === "discardAll"
                      ? "projectTools.gitReview.discardAllConfirm"
                      : "projectTools.gitReview.discardConfirm",
                  ).replace("{path}", confirm.path),
          },
          ...(confirm.kind === "worktree"
            ? [
                c.toggle(
                  "git-worktree-force",
                  t("projectTools.gitReview.forceRemoveWorktree"),
                  draft.force,
                  (value) => {
                    if (current() && !data.isBusy()) edit({ force: value });
                  },
                  !locked,
                ),
                c.toggle(
                  "git-worktree-delete-branch",
                  t("projectTools.gitReview.deleteWorktreeBranch"),
                  draft.deleteBranch,
                  (value) => {
                    if (current() && !data.isBusy()) edit({ deleteBranch: value });
                  },
                  !locked,
                ),
              ]
            : []),
          action("git-confirm-cancel", "chat.cancel", () => setConfirm(null), !locked),
          action(
            "git-confirm-submit",
            "settings.confirm",
            async () => {
              const target = confirm;
              const ok =
                target.kind === "discardAll"
                  ? await operation("discard_all", () => client!.discardAll(cwd), "discard_all")
                  : target.kind === "discard"
                    ? await operation(
                        "discard",
                        () => client!.discard(cwd, target.path, target.oldPath),
                        "discard",
                      )
                    : await operation("remove_worktree", () =>
                        client!.removeWorktree(cwd, target.path, {
                          force: draftRef.current.force,
                          deleteBranch: draftRef.current.deleteBranch,
                        }),
                      );
              if (ok && current()) {
                setConfirm(null);
                if (target.kind === "worktree") await reloadBranches();
              }
            },
            writable,
            true,
          ),
        ],
      ),
    );
  if (branchFromCommit)
    overlays.push(
      c.group("git-create-branch", t("projectTools.gitReview.createBranchFromCommitTitle"), [
        input("git-branch-name", "projectTools.gitReview.branchName", draft.branch, (branch) => ({
          branch,
        })),
        action("git-branch-cancel", "chat.cancel", () => setBranchFromCommit(""), !locked),
        action(
          "git-branch-create",
          "projectTools.gitReview.createBranch",
          async () => {
            const branch = draftRef.current.branch.trim();
            if (!branch) return;
            if (
              await operation(
                "create_branch",
                () => client!.createBranch(cwd, branch, branchFromCommit),
                "create_branch",
              )
            ) {
              if (current()) {
                setBranchFromCommit("");
                edit({ branch: "" });
              }
            }
          },
          writable && !!draft.branch.trim(),
        ),
      ]),
    );
  if (data.branchSwitchConflict)
    overlays.push(
      c.group("git-branch-conflict", t("projectTools.gitReview.switchBranchConflictTitle"), [
        {
          id: "git-branch-conflict-description",
          kind: "Text",
          text: t("projectTools.gitReview.switchBranchConflictDescription").replace(
            "{branch}",
            data.branchSwitchConflict.branch,
          ),
        },
        action(
          "git-branch-conflict-cancel",
          "chat.cancel",
          data.dismissBranchSwitchConflict,
          !locked,
        ),
        action(
          "git-branch-conflict-stash",
          "projectTools.gitReview.stashAndSwitch",
          data.stashAndSwitchBranch,
          writable,
        ),
      ]),
    );
  if (data.remoteSetupOpen)
    overlays.push(
      c.group("git-remote-setup", t("projectTools.gitReview.remoteSetupTitle"), [
        {
          id: "git-remote-description",
          kind: "Text",
          text: t(remoteSetupDescriptionKey(data.remoteSetupAction)),
        },
        c.input(
          "git-remote-url",
          t("projectTools.gitReview.remoteUrl"),
          data.remoteSetupUrl,
          (value) => {
            if (current() && !data.isBusy()) data.setRemoteSetupUrl(value);
          },
          false,
          !locked,
        ),
        ...(data.remoteSetupError
          ? [
              {
                id: "git-remote-error",
                kind: "Banner" as const,
                label: data.remoteSetupError,
                status: "error" as const,
              },
            ]
          : []),
        action("git-remote-cancel", "chat.cancel", data.closeRemoteSetup, !locked),
        action(
          "git-remote-save",
          remoteSetupSubmitKey(data.remoteSetupAction),
          data.saveRemoteAndContinue,
          writable && !!data.remoteSetupUrl.trim(),
        ),
      ]),
    );
  return (
    <NativeSurface
      document={{
        ...createNativeWorkspacePanel(t, false),
        title: t("sidebar.gitReview"),
        formFactor: "desktop",
        appearance: props.settings.theme,
        dismissAction: "git-close",
        theme: createNativePresentationTheme(props.settings, false, "workspaceTools"),
        nodes: [
          {
            id: "desktop-git-layout",
            kind: "VStack",
            fill: true,
            children: [
              { id: "desktop-git-toolbar", kind: "VStack", padding: 12, children: toolbar },
              {
                id: "desktop-git-list",
                kind: "VStack",
                label: t("projectTools.gitReview.listPane"),
                children: [
                  ...banners,
                  ...overlays,
                  ...(data.reviewMode === "history" ? history : changes),
                ],
              },
              {
                id: "desktop-git-detail",
                kind: "VStack",
                label: t("projectTools.gitReview.detailPane"),
                children: detail,
              },
              {
                id: "desktop-git-commit",
                kind: "HStack",
                children:
                  data.reviewMode === "changes"
                    ? [
                        {
                          ...input(
                            "git-commit-message",
                            "projectTools.gitReview.commitMessagePlaceholder",
                            draft.message,
                            (message) => ({ message }),
                          ),
                          fill: true,
                          disabled: !writable || !state.dirtyCounts.staged,
                        },
                        action(
                          "git-commit",
                          "projectTools.gitReview.commit",
                          commit,
                          writable && !!draft.message.trim() && !!state.dirtyCounts.staged,
                        ),
                      ]
                    : [],
              },
            ],
          },
        ],
      }}
      handlers={c.handlers}
      onError={(error) => {
        if (current()) data.setError(error instanceof Error ? error.message : String(error));
      }}
    />
  );
}
