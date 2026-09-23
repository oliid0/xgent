import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Center } from "@astryxdesign/core/Center";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Token } from "@astryxdesign/core/Token";
import { invoke } from "@xgent/runtime";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  FileText,
  GitBranch,
  GitCommitHorizontal,
  History,
  RefreshCw,
  X,
} from "../../../components/icons";
import { useLocale } from "../../../i18n";
import { isNativeMobileRuntime } from "../../../lib/runtimePlatform";
import type { AppSettings } from "../../../lib/settings";
import { NativeSurface } from "../../../presentation/NativeSurface";
import { createNativePresentationTheme } from "../../../presentation/nativeTheme";
import type {
  PresentationHandler,
  PresentationNode,
  PresentationValue,
} from "../../../presentation/types";
import { isApplePresentationRuntime } from "../../../runtime/applePresentation";
import { MobileFullscreenPanel } from "./MobilePanelScaffold";

type GitChange = {
  path: string;
  oldPath?: string;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  working: boolean;
  untracked: boolean;
};

type GitSnapshot = {
  branch: string;
  upstream: string;
  ahead: number;
  behind: number;
  changes: GitChange[];
};

type GitHistoryEntry = {
  sha: string;
  shortSha: string;
  author: string;
  date: string;
  subject: string;
};

type GitIdentity = { name: string; email: string };

type MobileGitReviewPanelProps = {
  open: boolean;
  workdir: string;
  settings: AppSettings;
  onClose: () => void;
};

function changeBadge(change: GitChange) {
  if (change.untracked) return "?";
  return (change.worktreeStatus.trim() || change.indexStatus.trim() || "M").slice(0, 1);
}

export function MobileGitReviewPanel(props: MobileGitReviewPanelProps) {
  const { open, workdir, onClose } = props;
  const { t } = useLocale();
  const [view, setView] = useState<"changes" | "history">("changes");
  const [snapshot, setSnapshot] = useState<GitSnapshot | null>(null);
  const [history, setHistory] = useState<GitHistoryEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [selectedCommit, setSelectedCommit] = useState<GitHistoryEntry | null>(null);
  const [detail, setDetail] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [identity, setIdentity] = useState<GitIdentity | null>(null);
  const [authorName, setAuthorName] = useState("");
  const [authorEmail, setAuthorEmail] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notRepository, setNotRepository] = useState(false);
  const [notice, setNotice] = useState("");
  const [discardPath, setDiscardPath] = useState("");
  const run = useCallback(
    async <T,>(label: string, action: () => Promise<T>): Promise<T> => {
      if (!workdir.trim()) throw new Error(t("chat.mobileTerminal.noWorkspace"));
      setBusy(label);
      setError("");
      try {
        return await action();
      } finally {
        setBusy("");
      }
    },
    [t, workdir],
  );

  const refreshStatus = useCallback(async () => {
    try {
      const [next, nextIdentity] = await run("status", () =>
        Promise.all([
          invoke<GitSnapshot>("mobile_git_status", { workdir }),
          invoke<GitIdentity>("mobile_git_identity", { workdir }),
        ]),
      );
      setSnapshot(next);
      setIdentity(nextIdentity);
      setNotRepository(false);
      setSelectedPath((current) =>
        current && next.changes.some((change) => change.path === current) ? current : "",
      );
      setError("");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setSnapshot(null);
      setIdentity(null);
      setNotRepository(message.toLowerCase().includes("not a git repository"));
      setError(message);
    }
  }, [run, workdir]);

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(
        await run("history", () => invoke<GitHistoryEntry[]>("mobile_git_history", { workdir })),
      );
      setError("");
    } catch (cause) {
      setHistory([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [run, workdir]);

  useEffect(() => {
    if (!open) return;
    setView("changes");
    setDetail("");
    setSelectedPath("");
    setSelectedCommit(null);
    setNotice("");
    setNotRepository(false);
    setAuthorName("");
    setAuthorEmail("");
    void refreshStatus();
  }, [open, refreshStatus]);

  useEffect(() => {
    if (!open || view !== "history" || history.length > 0) return;
    void refreshHistory();
  }, [history.length, open, refreshHistory, view]);

  const selectedChange = useMemo(
    () => snapshot?.changes.find((change) => change.path === selectedPath) ?? null,
    [selectedPath, snapshot?.changes],
  );
  const stagedCount = snapshot?.changes.filter((change) => change.staged).length ?? 0;
  const needsIdentity = stagedCount > 0 && (!identity?.name || !identity.email);
  const canCommit =
    stagedCount > 0 &&
    !!commitMessage.trim() &&
    (!needsIdentity || (!!authorName.trim() && !!authorEmail.trim()));

  const openChange = useCallback(
    async (change: GitChange) => {
      setSelectedPath(change.path);
      setSelectedCommit(null);
      setDiscardPath("");
      try {
        const output = await run("diff", () =>
          invoke<string>("mobile_git_diff", { workdir, path: change.path }),
        );
        setDetail(output.trim() || t("projectTools.gitReview.noDiff"));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [run, t, workdir],
  );

  const mutate = useCallback(
    async (
      label: string,
      operation: string,
      path: string | null,
      success: string,
      message?: string,
    ): Promise<boolean> => {
      try {
        await run(label, () =>
          invoke<string>("mobile_git_mutate", {
            workdir,
            operation,
            path,
            message: message ?? null,
            author_name: operation === "commit" ? authorName.trim() || null : null,
            author_email: operation === "commit" ? authorEmail.trim() || null : null,
          }),
        );
        setNotice(success);
        setDetail("");
        setSelectedPath("");
        setDiscardPath("");
        await refreshStatus();
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return false;
      }
    },
    [authorEmail, authorName, refreshStatus, run, workdir],
  );

  const openCommit = useCallback(
    async (entry: GitHistoryEntry) => {
      setSelectedCommit(entry);
      setSelectedPath("");
      try {
        setDetail(
          await run("commit-detail", () =>
            invoke<string>("mobile_git_commit_detail", { workdir, sha: entry.sha }),
          ),
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [run, workdir],
  );

  const commitNow = async () => {
    const message = commitMessage.trim();
    if (!canCommit) return;
    if (
      await mutate(
        "commit",
        "commit",
        null,
        t("projectTools.gitReview.commitSuccessMessage"),
        message,
      )
    ) {
      setCommitMessage("");
    }
  };
  const commit = async (event: FormEvent) => {
    event.preventDefault();
    await commitNow();
  };

  const remoteOperation = async (operation: "fetch" | "pull" | "push") => {
    try {
      await run(operation, () => invoke("mobile_git_remote", { workdir, operation }));
      setNotice(t(`projectTools.gitReview.${operation}SuccessMessage`));
      await refreshStatus();
      if (view === "history") await refreshHistory();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setNotice("");
    }
  };

  const initializeRepository = async () => {
    await mutate("init", "init", null, t("projectTools.gitReview.initSuccessMessage"));
  };

  const close = () => onClose();

  if (!open) return null;

  const showingDetail = Boolean(selectedChange || selectedCommit);

  if (isApplePresentationRuntime()) {
    const handlers = new Map<string, PresentationHandler>();
    const bind = (
      id: string,
      runAction: (value: PresentationValue) => unknown,
      accepts: (value: PresentationValue) => boolean,
      enabled = true,
    ) => {
      handlers.set(id, { run: runAction, accepts, enabled });
      return id;
    };
    const button = (
      id: string,
      label: string,
      runAction: () => unknown,
      options: {
        icon?: string;
        enabled?: boolean;
        destructive?: boolean;
        prominent?: boolean;
      } = {},
    ): PresentationNode => ({
      id,
      kind: options.icon ? "IconButton" : "Button",
      label,
      icon: options.icon,
      destructive: options.destructive,
      prominent: options.prominent,
      disabled: options.enabled === false,
      action: bind(id, runAction, (value) => value === null, options.enabled !== false),
    });
    const resetDetail = () => {
      setSelectedPath("");
      setSelectedCommit(null);
      setDetail("");
      setDiscardPath("");
    };
    const content: PresentationNode[] = [];
    if (busy)
      content.push({ id: "git-busy", kind: "Progress", label: t("chat.mobileTerminal.running") });
    if (error && !notRepository) {
      content.push({ id: "git-error", kind: "Banner", label: error, status: "error" });
    }
    if (notice) {
      content.push({ id: "git-notice", kind: "Banner", label: notice, status: "completed" });
    }
    if (showingDetail) {
      const actions: PresentationNode[] = [];
      if (selectedChange?.working) {
        actions.push(
          button(
            "git-stage",
            t("projectTools.gitReview.stageChanges"),
            () =>
              mutate(
                "stage",
                "stage",
                selectedChange.path,
                t("projectTools.gitReview.stageChanges"),
              ),
            { enabled: !busy },
          ),
        );
      }
      if (selectedChange?.staged) {
        actions.push(
          button(
            "git-unstage",
            t("projectTools.gitReview.unstageChanges"),
            () =>
              mutate(
                "unstage",
                "unstage",
                selectedChange.path,
                t("projectTools.gitReview.unstageChanges"),
              ),
            { enabled: !busy },
          ),
        );
      }
      if (selectedChange?.working) {
        if (discardPath === selectedChange.path) {
          actions.push(
            button(
              "git-discard-confirm",
              t("projectTools.gitReview.discardChanges"),
              () =>
                mutate(
                  "discard",
                  "discard",
                  selectedChange.path,
                  t("projectTools.gitReview.discardSuccessMessage"),
                ),
              { enabled: !busy, destructive: true },
            ),
            button("git-discard-cancel", t("settings.cancel"), () => setDiscardPath("")),
          );
        } else {
          actions.push(
            button(
              "git-discard",
              t("projectTools.gitReview.discardChanges"),
              () => setDiscardPath(selectedChange.path),
              { enabled: !busy, destructive: true },
            ),
          );
        }
      }
      if (actions.length)
        content.push({ id: "git-detail-actions", kind: "HStack", children: actions });
      content.push({
        id: "git-detail",
        kind: "CodeBlock",
        label: selectedPath || selectedCommit?.subject || t("chat.mobileGit.title"),
        language: "diff",
        text: busy && !detail ? t("chat.mobileTerminal.running") : detail,
      });
    } else if (view === "changes") {
      content.push({
        id: "git-remote-actions",
        kind: "HStack",
        children: (["fetch", "pull", "push"] as const).map((operation) =>
          button(
            `git-${operation}`,
            t(`projectTools.gitReview.${operation}`),
            () => remoteOperation(operation),
            { enabled: !busy },
          ),
        ),
      });
      if (notRepository) {
        content.push({
          id: "git-not-repository",
          kind: "EmptyState",
          icon: "arrow.triangle.branch",
          label: t("git.branchSelector.initRepositoryTitle"),
          text: t("git.branchSelector.initRepositoryDescription"),
          children: [
            button("git-init", t("git.branchSelector.initRepository"), initializeRepository, {
              enabled: !busy,
              prominent: true,
            }),
          ],
        });
      } else if (snapshot?.changes.length === 0) {
        content.push({
          id: "git-clean",
          kind: "EmptyState",
          icon: "checkmark.circle",
          label: t("projectTools.gitReview.noLocalChanges"),
        });
      } else {
        content.push({
          id: "git-changes",
          kind: "List",
          children: (snapshot?.changes ?? []).map((change) => ({
            id: `git-change:${change.indexStatus}${change.worktreeStatus}:${change.path}`,
            kind: "NavigationRow",
            label: change.path,
            text: [
              change.staged ? t("projectTools.gitReview.labelStaged") : "",
              change.working ? t("projectTools.gitReview.labelUnstaged") : "",
            ]
              .filter(Boolean)
              .join(" · "),
            icon: change.untracked ? "questionmark.circle" : "doc.text",
            disabled: !!busy,
            action: bind(
              `git-change:${change.indexStatus}${change.worktreeStatus}:${change.path}`,
              () => openChange(change),
              (value) => value === null,
              !busy,
            ),
          })),
        });
      }
      if (needsIdentity) {
        content.push({
          id: "git-identity",
          kind: "VStack",
          children: [
            {
              id: "git-author-name",
              kind: "TextInput",
              label: t("chat.mobileGit.authorName"),
              value: authorName,
              disabled: !!busy,
              action: bind(
                "git-author-name",
                (value) => setAuthorName(value as string),
                (value) => typeof value === "string",
                !busy,
              ),
            },
            {
              id: "git-author-email",
              kind: "TextInput",
              label: t("chat.mobileGit.authorEmail"),
              value: authorEmail,
              disabled: !!busy,
              action: bind(
                "git-author-email",
                (value) => setAuthorEmail(value as string),
                (value) => typeof value === "string",
                !busy,
              ),
            },
          ],
        });
      }
      content.push({
        id: "git-commit-row",
        kind: "HStack",
        children: [
          {
            id: "git-commit-message",
            kind: "TextInput",
            label: t("projectTools.gitReview.commitMessagePlaceholder"),
            value: commitMessage,
            fill: true,
            disabled: !!busy || stagedCount === 0,
            action: bind(
              "git-commit-message",
              (value) => setCommitMessage(value as string),
              (value) => typeof value === "string",
              !busy && stagedCount > 0,
            ),
          },
          button("git-commit", t("projectTools.gitReview.commit"), commitNow, {
            enabled: !busy && canCommit,
            prominent: true,
          }),
        ],
      });
    } else if (history.length === 0 && !busy) {
      content.push({
        id: "git-history-empty",
        kind: "EmptyState",
        icon: "clock.arrow.circlepath",
        label: t("projectTools.gitReview.noCommitHistory"),
      });
    } else {
      content.push({
        id: "git-history",
        kind: "List",
        children: history.map((entry) => ({
          id: `git-history:${entry.sha}`,
          kind: "NavigationRow",
          label: entry.subject,
          text: `${entry.shortSha} · ${entry.author} · ${entry.date}`,
          icon: "point.topleft.down.to.point.bottomright.curvepath",
          disabled: !!busy,
          action: bind(
            `git-history:${entry.sha}`,
            () => openCommit(entry),
            (value) => value === null,
            !busy,
          ),
        })),
      });
    }

    const nodes: PresentationNode[] = [
      {
        id: "git-layout",
        kind: "BrowserLayout",
        fill: true,
        children: [
          {
            id: "git-toolbar",
            kind: "HStack",
            padding: 8,
            children: [
              ...(showingDetail
                ? [
                    button("git-back", t("chat.mobileGit.back"), resetDetail, {
                      icon: "chevron.left",
                    }),
                  ]
                : [
                    {
                      id: "git-icon",
                      kind: "Badge" as const,
                      label: "G",
                      status: "completed" as const,
                    },
                  ]),
              {
                id: "git-title",
                kind: "VStack",
                fill: true,
                children: [
                  {
                    id: "git-heading",
                    kind: "Heading",
                    text: selectedPath || selectedCommit?.subject || t("chat.mobileGit.title"),
                  },
                  {
                    id: "git-subtitle",
                    kind: "Text",
                    text: selectedCommit?.shortSha || snapshot?.branch || workdir,
                    secondary: true,
                  },
                ],
              },
              button(
                "git-refresh",
                t("projectTools.gitReview.refresh"),
                () => (view === "changes" ? refreshStatus() : refreshHistory()),
                { icon: "arrow.clockwise", enabled: !busy },
              ),
              button("git-close", t("chat.mobileTerminal.close"), close, { icon: "xmark" }),
            ],
          },
          ...(showingDetail
            ? []
            : [
                {
                  id: "git-view",
                  kind: "SegmentedControl" as const,
                  label: t("chat.mobileGit.title"),
                  value: view,
                  options: [
                    { value: "changes", label: t("projectTools.gitReview.localChangesView") },
                    { value: "history", label: t("projectTools.gitReview.commitHistoryView") },
                  ],
                  action: bind(
                    "git-view",
                    (value) => setView(value as "changes" | "history"),
                    (value) => value === "changes" || value === "history",
                    !busy,
                  ),
                },
              ]),
          { id: "git-content", kind: "ScrollView", fill: true, children: content },
        ],
      },
    ];
    return (
      <NativeSurface
        document={{
          mode: "root",
          title: t("chat.mobileGit.title"),
          appearance: props.settings.theme,
          formFactor: isNativeMobileRuntime() ? "mobile" : "desktop",
          theme: createNativePresentationTheme(
            props.settings,
            isNativeMobileRuntime(),
            "workspaceTools",
          ),
          nodes,
        }}
        handlers={handlers}
        onError={(cause) => setError(cause instanceof Error ? cause.message : String(cause))}
      />
    );
  }

  return (
    <MobileFullscreenPanel open label={t("chat.mobileGit.title")}>
      <HStack
        as="header"
        gap={2}
        vAlign="center"
        paddingInline={3}
        className="mobile-panel-header min-h-[var(--xgent-mobile-header-height)] shrink-0 border-b border-[var(--color-border-subtle)] bg-[var(--color-background-surface)]"
      >
        {showingDetail ? (
          <IconButton
            label={t("chat.mobileGit.back")}
            tooltip={t("chat.mobileGit.back")}
            icon={<ArrowLeft />}
            variant="ghost"
            onClick={() => {
              setSelectedPath("");
              setSelectedCommit(null);
              setDetail("");
            }}
          />
        ) : (
          <GitBranch />
        )}
        <StackItem size="fill">
          <VStack gap={0}>
            <Heading level={2} maxLines={1}>
              {selectedPath || selectedCommit?.subject || t("chat.mobileGit.title")}
            </Heading>
            <Text type="supporting" color="secondary" maxLines={1}>
              {showingDetail
                ? selectedCommit?.shortSha || snapshot?.branch || workdir
                : snapshot?.branch || workdir}
            </Text>
          </VStack>
        </StackItem>
        <IconButton
          label={t("projectTools.gitReview.refresh")}
          tooltip={t("projectTools.gitReview.refresh")}
          icon={<RefreshCw />}
          variant="ghost"
          isLoading={Boolean(busy)}
          isDisabled={Boolean(busy)}
          onClick={() => void (view === "changes" ? refreshStatus() : refreshHistory())}
        />
        <IconButton
          label={t("chat.mobileTerminal.close")}
          tooltip={t("chat.mobileTerminal.close")}
          icon={<X />}
          variant="ghost"
          onClick={close}
        />
      </HStack>

      {!showingDetail ? (
        <HStack
          padding={2}
          className="shrink-0 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-primary)]"
        >
          <SegmentedControl
            value={view}
            onChange={(value) => setView(value as "changes" | "history")}
            label={t("chat.mobileGit.title")}
            layout="fill"
          >
            <SegmentedControlItem
              value="changes"
              label={t("projectTools.gitReview.localChangesView")}
            />
            <SegmentedControlItem
              value="history"
              label={t("projectTools.gitReview.commitHistoryView")}
            />
          </SegmentedControl>
        </HStack>
      ) : null}

      {error && !notRepository ? (
        <Banner
          status="error"
          title={error}
          collapsible={false}
          isDismissable
          onDismiss={() => setError("")}
        />
      ) : null}
      {notice ? (
        <Banner
          status="success"
          title={notice}
          collapsible={false}
          isDismissable
          onDismiss={() => setNotice("")}
        />
      ) : null}

      {showingDetail ? (
        <StackItem size="fill" isScrollable>
          <VStack gap={3} padding={3} className="min-h-full overscroll-contain">
            {selectedChange ? (
              <HStack gap={2} wrap="wrap">
                {selectedChange.working ? (
                  <Button
                    label={t("projectTools.gitReview.stageChanges")}
                    isDisabled={Boolean(busy)}
                    onClick={() =>
                      void mutate(
                        "stage",
                        "stage",
                        selectedChange.path,
                        t("projectTools.gitReview.stageChanges"),
                      )
                    }
                  />
                ) : null}
                {selectedChange.staged ? (
                  <Button
                    label={t("projectTools.gitReview.unstageChanges")}
                    isDisabled={Boolean(busy)}
                    onClick={() =>
                      void mutate(
                        "unstage",
                        "unstage",
                        selectedChange.path,
                        t("projectTools.gitReview.unstageChanges"),
                      )
                    }
                  />
                ) : null}
                {selectedChange.working ? (
                  discardPath === selectedChange.path ? (
                    <>
                      <Button
                        label={t("projectTools.gitReview.discardChanges")}
                        variant="destructive"
                        isDisabled={Boolean(busy)}
                        onClick={() =>
                          void mutate(
                            "discard",
                            "discard",
                            selectedChange.path,
                            t("projectTools.gitReview.discardSuccessMessage"),
                          )
                        }
                      />
                      <Button label={t("settings.cancel")} onClick={() => setDiscardPath("")} />
                    </>
                  ) : (
                    <Button
                      label={t("projectTools.gitReview.discardChanges")}
                      variant="destructive"
                      onClick={() => setDiscardPath(selectedChange.path)}
                    />
                  )
                ) : null}
              </HStack>
            ) : null}
            <CodeBlock
              code={busy && !detail ? t("chat.mobileTerminal.running") : detail}
              language="diff"
              size="sm"
              width="100%"
              maxHeight="100%"
              isWrapped
              container="section"
            />
          </VStack>
        </StackItem>
      ) : view === "changes" ? (
        <>
          <HStack
            gap={2}
            hAlign="between"
            vAlign="center"
            padding={2}
            className="shrink-0 overflow-x-auto border-b border-[var(--color-border-subtle)]"
          >
            <HStack gap={2}>
              {(["fetch", "pull", "push"] as const).map((operation) => {
                return (
                  <Button
                    key={operation}
                    label={t(`projectTools.gitReview.${operation}`)}
                    size="sm"
                    isDisabled={Boolean(busy)}
                    onClick={() => void remoteOperation(operation)}
                  />
                );
              })}
            </HStack>
            {snapshot ? (
              <Text type="supporting" color="secondary">
                {snapshot.ahead > 0 ? `↑${snapshot.ahead} ` : ""}
                {snapshot.behind > 0 ? `↓${snapshot.behind}` : ""}
              </Text>
            ) : null}
          </HStack>
          <StackItem size="fill" isScrollable>
            <VStack padding={3} className="min-h-full overscroll-contain">
              {!snapshot && busy ? (
                <Center height="100%">
                  <HStack gap={2} vAlign="center">
                    <Spinner aria-label={t("chat.mobileTerminal.running")} size="sm" />
                    <Text type="supporting" color="secondary">
                      {t("chat.mobileTerminal.running")}
                    </Text>
                  </HStack>
                </Center>
              ) : notRepository ? (
                <EmptyState
                  icon={<GitBranch />}
                  title={t("git.branchSelector.initRepositoryTitle")}
                  description={t("git.branchSelector.initRepositoryDescription")}
                  actions={
                    <Button
                      label={t("git.branchSelector.initRepository")}
                      variant="primary"
                      isDisabled={Boolean(busy)}
                      onClick={() => void initializeRepository()}
                    />
                  }
                />
              ) : snapshot?.changes.length === 0 ? (
                <EmptyState
                  icon={<FileText />}
                  title={t("projectTools.gitReview.noLocalChanges")}
                  isCompact
                />
              ) : (
                <List density="balanced" hasDividers>
                  {snapshot?.changes.map((change) => (
                    <ListItem
                      key={`${change.indexStatus}${change.worktreeStatus}:${change.path}`}
                      label={change.path}
                      startContent={
                        <Token
                          label={changeBadge(change)}
                          color={change.untracked ? "green" : "orange"}
                          size="sm"
                        />
                      }
                      description={
                        <HStack gap={1} wrap="wrap">
                          {change.staged ? (
                            <Token
                              label={t("projectTools.gitReview.labelStaged")}
                              color="green"
                              size="sm"
                            />
                          ) : null}
                          {change.working ? (
                            <Token
                              label={t("projectTools.gitReview.labelUnstaged")}
                              color="orange"
                              size="sm"
                            />
                          ) : null}
                        </HStack>
                      }
                      isDisabled={Boolean(busy)}
                      onClick={() => void openChange(change)}
                    />
                  ))}
                </List>
              )}
            </VStack>
          </StackItem>
          <VStack
            as="form"
            gap={2}
            padding={3}
            onSubmit={(event) => void commit(event)}
            className="shrink-0 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-primary)] pb-[calc(var(--spacing-3)+env(safe-area-inset-bottom,0px))]"
          >
            {needsIdentity ? (
              <VStack gap={2}>
                <TextInput
                  label={t("chat.mobileGit.authorName")}
                  value={authorName}
                  onChange={setAuthorName}
                  isDisabled={Boolean(busy)}
                  size="sm"
                />
                <TextInput
                  label={t("chat.mobileGit.authorEmail")}
                  value={authorEmail}
                  onChange={setAuthorEmail}
                  isDisabled={Boolean(busy)}
                  size="sm"
                />
              </VStack>
            ) : null}
            <HStack gap={2} vAlign="end" width="100%">
              <StackItem size="fill">
                <TextInput
                  label={t("projectTools.gitReview.commitMessagePlaceholder")}
                  isLabelHidden
                  value={commitMessage}
                  onChange={setCommitMessage}
                  isDisabled={Boolean(busy) || stagedCount === 0}
                  disabledMessage={
                    stagedCount === 0 ? t("projectTools.gitReview.noStagedChanges") : undefined
                  }
                  placeholder={t("projectTools.gitReview.commitMessagePlaceholder")}
                  size="lg"
                  width="100%"
                />
              </StackItem>
              <Button
                type="submit"
                label={t("projectTools.gitReview.commit")}
                variant="primary"
                size="lg"
                isLoading={busy === "commit"}
                isDisabled={Boolean(busy) || !canCommit}
              />
            </HStack>
          </VStack>
        </>
      ) : (
        <StackItem size="fill" isScrollable>
          <VStack
            padding={3}
            className="min-h-full overscroll-contain pb-[calc(var(--spacing-3)+env(safe-area-inset-bottom,0px))]"
          >
            {busy && history.length === 0 ? (
              <Center height="100%">
                <HStack gap={2} vAlign="center">
                  <Spinner aria-label={t("chat.mobileTerminal.running")} size="sm" />
                  <Text type="supporting" color="secondary">
                    {t("chat.mobileTerminal.running")}
                  </Text>
                </HStack>
              </Center>
            ) : history.length === 0 ? (
              <EmptyState
                icon={<History />}
                title={t("projectTools.gitReview.noCommitHistory")}
                isCompact
              />
            ) : (
              <List density="balanced" hasDividers>
                {history.map((entry) => (
                  <ListItem
                    key={entry.sha}
                    label={entry.subject}
                    description={`${entry.shortSha} · ${entry.author} · ${entry.date}`}
                    startContent={<GitCommitHorizontal />}
                    isDisabled={Boolean(busy)}
                    onClick={() => void openCommit(entry)}
                  />
                ))}
              </List>
            )}
          </VStack>
        </StackItem>
      )}
    </MobileFullscreenPanel>
  );
}
