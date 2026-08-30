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
import { invoke } from "@xagent/runtime";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  FileText,
  GitBranch,
  GitCommitHorizontal,
  History,
  RefreshCw,
  Undo2,
  Upload,
  X,
} from "../../../components/icons";
import { useLocale } from "../../../i18n";
import { MobileFullscreenPanel } from "./MobilePanelScaffold";

type ShellRunResponse = {
  exit_code?: number;
  exitCode?: number;
  stdout: string;
  stderr: string;
  cancelled: boolean;
};

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

type MobileGitReviewPanelProps = {
  open: boolean;
  workdir: string;
  onClose: () => void;
};

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function runId() {
  return `mobile-git-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
}

function exitCode(response: ShellRunResponse) {
  return response.exitCode ?? response.exit_code ?? 1;
}

function gitCommand(args: string) {
  return `if command -v git >/dev/null 2>&1; then git ${args}; else lg2 ${args}; fi`;
}

function parseStatus(output: string): GitSnapshot {
  const lines = output.replaceAll("\r\n", "\n").split("\n");
  const header = lines[0]?.startsWith("## ") ? (lines.shift()?.slice(3) ?? "") : "";
  const branchPart = header.split("...")[0]?.trim() ?? "";
  const upstreamMatch = header.match(/\.\.\.([^\s[]+)/);
  const aheadMatch = header.match(/ahead (\d+)/);
  const behindMatch = header.match(/behind (\d+)/);
  const changes = lines.flatMap<GitChange>((line) => {
    if (line.length < 4) return [];
    const indexStatus = line[0] ?? " ";
    const worktreeStatus = line[1] ?? " ";
    const rawPath = line.slice(3).trim();
    if (!rawPath) return [];
    const renameParts = rawPath.split(" -> ");
    const path = renameParts.at(-1)?.replace(/^"|"$/g, "") ?? rawPath;
    const oldPath = renameParts.length > 1 ? renameParts[0]?.replace(/^"|"$/g, "") : undefined;
    const untracked = indexStatus === "?" && worktreeStatus === "?";
    return [
      {
        path,
        oldPath,
        indexStatus,
        worktreeStatus,
        staged: !untracked && indexStatus !== " ",
        working: untracked || worktreeStatus !== " ",
        untracked,
      },
    ];
  });
  return {
    branch: branchPart === "No commits yet on" ? "" : branchPart,
    upstream: upstreamMatch?.[1] ?? "",
    ahead: Number(aheadMatch?.[1] ?? 0),
    behind: Number(behindMatch?.[1] ?? 0),
    changes,
  };
}

function parseHistory(output: string): GitHistoryEntry[] {
  return output
    .replaceAll("\r\n", "\n")
    .split("\n")
    .flatMap((line) => {
      const [sha, shortSha, author, date, ...subject] = line.split("\u001f");
      if (!sha || !shortSha) return [];
      return [{ sha, shortSha, author, date, subject: subject.join("\u001f") }];
    });
}

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
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notRepository, setNotRepository] = useState(false);
  const [notice, setNotice] = useState("");
  const [discardPath, setDiscardPath] = useState("");
  const activeRunIdRef = useRef("");

  const run = useCallback(
    async (label: string, command: string, allowNonZero = false) => {
      if (!workdir.trim()) throw new Error(t("chat.mobileTerminal.noWorkspace"));
      const id = runId();
      activeRunIdRef.current = id;
      setBusy(label);
      setError("");
      try {
        const response = await invoke<ShellRunResponse>("shell_run", {
          workdir,
          command,
          cwd: null,
          timeout_ms: 120_000,
          max_timeout_ms: 600_000,
          provider_id: null,
          run_id: id,
          sandbox: false,
          sandbox_allow_network: true,
        });
        if (!allowNonZero && exitCode(response) !== 0) {
          throw new Error(response.stderr.trim() || response.stdout.trim() || label);
        }
        return response.stdout;
      } finally {
        if (activeRunIdRef.current === id) activeRunIdRef.current = "";
        setBusy("");
      }
    },
    [t, workdir],
  );

  const refreshStatus = useCallback(async () => {
    try {
      const output = await run(
        "status",
        gitCommand("status --porcelain=v1 --branch --untracked-files=all"),
      );
      const next = parseStatus(output);
      setSnapshot(next);
      setNotRepository(false);
      setSelectedPath((current) =>
        current && next.changes.some((change) => change.path === current) ? current : "",
      );
      setError("");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setSnapshot(null);
      setNotRepository(message.toLowerCase().includes("not a git repository"));
      setError(message);
    }
  }, [run]);

  const refreshHistory = useCallback(async () => {
    try {
      const output = await run(
        "history",
        gitCommand("log -n 60 --date=iso-strict --pretty=format:'%H%x1f%h%x1f%an%x1f%ad%x1f%s'"),
      );
      setHistory(parseHistory(output));
      setError("");
    } catch (cause) {
      setHistory([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [run]);

  useEffect(() => {
    if (!open) return;
    setView("changes");
    setDetail("");
    setSelectedPath("");
    setSelectedCommit(null);
    setNotice("");
    setNotRepository(false);
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

  const openChange = useCallback(
    async (change: GitChange) => {
      setSelectedPath(change.path);
      setSelectedCommit(null);
      setDiscardPath("");
      try {
        const path = shellQuote(change.path);
        const commands = [
          change.staged ? gitCommand(`diff --cached --no-ext-diff -- ${path}`) : "",
          change.working && !change.untracked ? gitCommand(`diff --no-ext-diff -- ${path}`) : "",
          change.untracked ? `${gitCommand(`diff --no-index -- /dev/null ${path}`)} || true` : "",
        ].filter(Boolean);
        const output = await run("diff", commands.join("\n"), true);
        setDetail(output.trim() || t("projectTools.gitReview.noDiff"));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [run, t],
  );

  const mutate = useCallback(
    async (label: string, command: string, success: string) => {
      try {
        await run(label, command);
        setNotice(success);
        setDetail("");
        setSelectedPath("");
        setDiscardPath("");
        await refreshStatus();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [refreshStatus, run],
  );

  const openCommit = useCallback(
    async (entry: GitHistoryEntry) => {
      setSelectedCommit(entry);
      setSelectedPath("");
      try {
        setDetail(
          await run(
            "commit-detail",
            gitCommand(`show --stat --patch --format=fuller ${shellQuote(entry.sha)} --`),
          ),
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [run],
  );

  const commit = async (event: FormEvent) => {
    event.preventDefault();
    const message = commitMessage.trim();
    if (!message || stagedCount === 0) return;
    await mutate(
      "commit",
      gitCommand(`commit -m ${shellQuote(message)}`),
      t("projectTools.gitReview.commitSuccessMessage"),
    );
    setCommitMessage("");
  };

  const remoteOperation = async (operation: "fetch" | "pull" | "push") => {
    try {
      await run(operation, gitCommand(operation));
      setNotice(t(`projectTools.gitReview.${operation}SuccessMessage`));
      await refreshStatus();
      if (view === "history") await refreshHistory();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setNotice("");
    }
  };

  const initializeRepository = async () => {
    await mutate("init", gitCommand("init"), t("projectTools.gitReview.initSuccessMessage"));
  };

  const close = () => {
    const id = activeRunIdRef.current;
    if (id) void invoke("shell_cancel", { run_id: id }).catch(() => undefined);
    onClose();
  };

  if (!open) return null;

  const showingDetail = Boolean(selectedChange || selectedCommit);

  return (
    <MobileFullscreenPanel open label={t("chat.mobileGit.title")}>
      <HStack
        as="header"
        gap={2}
        vAlign="center"
        paddingInline={3}
        className="mobile-panel-header min-h-[var(--xagent-mobile-header-height)] shrink-0 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-primary)]/90 backdrop-blur-xl"
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
                        gitCommand(`add -- ${shellQuote(selectedChange.path)}`),
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
                        gitCommand(`restore --staged -- ${shellQuote(selectedChange.path)}`),
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
                            selectedChange.untracked
                              ? `rm -f -- ${shellQuote(selectedChange.path)}`
                              : gitCommand(
                                  `restore --worktree -- ${shellQuote(selectedChange.path)}`,
                                ),
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
                const Icon =
                  operation === "fetch" ? Download : operation === "pull" ? Undo2 : Upload;
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
          <HStack
            as="form"
            gap={2}
            vAlign="end"
            padding={3}
            onSubmit={(event) => void commit(event)}
            className="shrink-0 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-primary)] pb-[calc(var(--spacing-3)+env(safe-area-inset-bottom,0px))]"
          >
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
              isDisabled={Boolean(busy) || stagedCount === 0 || !commitMessage.trim()}
            />
          </HStack>
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
