import { invoke } from "@xagent/runtime";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Download,
  FileText,
  GitBranch,
  GitCommitHorizontal,
  History,
  Loader2,
  RefreshCw,
  Undo2,
  Upload,
  X,
} from "../../../components/icons";
import { useLocale } from "../../../i18n";
import { cn } from "../../../lib/shared/utils";
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
      <header className="mobile-panel-header flex min-h-14 shrink-0 items-center gap-3 border-b border-border/55 bg-background/90 px-3 backdrop-blur-xl">
        {showingDetail ? (
          <button
            type="button"
            onClick={() => {
              setSelectedPath("");
              setSelectedCommit(null);
              setDetail("");
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
            aria-label={t("chat.mobileGit.back")}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-foreground">
            <GitBranch className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold">
            {selectedPath || selectedCommit?.subject || t("chat.mobileGit.title")}
          </h2>
          <p className="truncate text-[10px] text-muted-foreground">
            {showingDetail
              ? selectedCommit?.shortSha || snapshot?.branch || workdir
              : snapshot?.branch || workdir}
          </p>
        </div>
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void (view === "changes" ? refreshStatus() : refreshHistory())}
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground active:bg-muted disabled:opacity-45"
          aria-label={t("projectTools.gitReview.refresh")}
        >
          <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
        </button>
        <button
          type="button"
          onClick={close}
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
          aria-label={t("chat.mobileTerminal.close")}
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {!showingDetail ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-background px-3 py-2.5">
          <div className="grid min-w-0 flex-1 grid-cols-2 rounded-xl bg-muted p-1">
            {(["changes", "history"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setView(item)}
                className={cn(
                  "flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-medium",
                  view === item
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground",
                )}
              >
                {item === "changes" ? (
                  <FileText className="h-3.5 w-3.5" />
                ) : (
                  <History className="h-3.5 w-3.5" />
                )}
                {t(
                  item === "changes"
                    ? "projectTools.gitReview.localChangesView"
                    : "projectTools.gitReview.commitHistoryView",
                )}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {error && !notRepository ? (
        <div className="mx-3 mt-3 flex shrink-0 items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <button type="button" onClick={() => setError("")} aria-label={t("settings.cancel")}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="mx-3 mt-3 flex shrink-0 items-start gap-2 rounded-xl border border-border bg-muted/45 px-3 py-2.5 text-xs text-muted-foreground">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <span className="min-w-0 flex-1">{notice}</span>
        </div>
      ) : null}

      {showingDetail ? (
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-3 py-4">
          {selectedChange ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {selectedChange.working ? (
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void mutate(
                      "stage",
                      gitCommand(`add -- ${shellQuote(selectedChange.path)}`),
                      t("projectTools.gitReview.stageChanges"),
                    )
                  }
                  className="rounded-lg bg-foreground px-3 py-2 text-xs font-medium text-background disabled:opacity-45"
                >
                  {t("projectTools.gitReview.stageChanges")}
                </button>
              ) : null}
              {selectedChange.staged ? (
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void mutate(
                      "unstage",
                      gitCommand(`restore --staged -- ${shellQuote(selectedChange.path)}`),
                      t("projectTools.gitReview.unstageChanges"),
                    )
                  }
                  className="rounded-lg border border-border px-3 py-2 text-xs font-medium disabled:opacity-45"
                >
                  {t("projectTools.gitReview.unstageChanges")}
                </button>
              ) : null}
              {selectedChange.working ? (
                discardPath === selectedChange.path ? (
                  <>
                    <button
                      type="button"
                      disabled={Boolean(busy)}
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
                      className="rounded-lg bg-destructive px-3 py-2 text-xs font-medium text-destructive-foreground disabled:opacity-45"
                    >
                      {t("projectTools.gitReview.discardChanges")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDiscardPath("")}
                      className="rounded-lg border border-border px-3 py-2 text-xs font-medium"
                    >
                      {t("settings.cancel")}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDiscardPath(selectedChange.path)}
                    className="rounded-lg border border-destructive/30 px-3 py-2 text-xs font-medium text-destructive"
                  >
                    {t("projectTools.gitReview.discardChanges")}
                  </button>
                )
              ) : null}
            </div>
          ) : null}
          <pre className="min-w-max whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.65] text-foreground/90">
            {busy && !detail ? t("chat.mobileTerminal.running") : detail}
          </pre>
        </div>
      ) : view === "changes" ? (
        <>
          <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-border px-3 py-2.5">
            {(["fetch", "pull", "push"] as const).map((operation) => {
              const Icon = operation === "fetch" ? Download : operation === "pull" ? Undo2 : Upload;
              return (
                <button
                  key={operation}
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void remoteOperation(operation)}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-[11px] font-medium disabled:opacity-45"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t(`projectTools.gitReview.${operation}`)}
                </button>
              );
            })}
            {snapshot ? (
              <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {snapshot.ahead > 0 ? `↑${snapshot.ahead} ` : ""}
                {snapshot.behind > 0 ? `↓${snapshot.behind}` : ""}
              </span>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
            {!snapshot && busy ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("chat.mobileTerminal.running")}
              </div>
            ) : notRepository ? (
              <div className="mx-auto flex h-full max-w-sm flex-col items-center justify-center gap-3 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                  <GitBranch className="h-5 w-5" />
                </span>
                <div>
                  <div className="text-sm font-semibold">
                    {t("git.branchSelector.initRepositoryTitle")}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {t("git.branchSelector.initRepositoryDescription")}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void initializeRepository()}
                  className="min-h-11 rounded-xl bg-foreground px-4 text-sm font-medium text-background disabled:opacity-45"
                >
                  {t("git.branchSelector.initRepository")}
                </button>
              </div>
            ) : snapshot?.changes.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {t("projectTools.gitReview.noLocalChanges")}
              </div>
            ) : (
              <div className="space-y-2">
                {snapshot?.changes.map((change) => (
                  <button
                    key={`${change.indexStatus}${change.worktreeStatus}:${change.path}`}
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void openChange(change)}
                    className="flex w-full items-center gap-3 rounded-xl border border-border bg-background p-3 text-left active:bg-muted disabled:opacity-55"
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-semibold",
                        change.untracked
                          ? "bg-emerald-500/10 text-emerald-600"
                          : "bg-amber-500/10 text-amber-600",
                      )}
                    >
                      {changeBadge(change)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{change.path}</span>
                      <span className="mt-0.5 flex gap-2 text-[10px] text-muted-foreground">
                        {change.staged ? (
                          <span>{t("projectTools.gitReview.labelStaged")}</span>
                        ) : null}
                        {change.working ? (
                          <span>{t("projectTools.gitReview.labelUnstaged")}</span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <form
            onSubmit={(event) => void commit(event)}
            className="flex shrink-0 gap-2 border-t border-border bg-background px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-3"
          >
            <input
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.currentTarget.value)}
              disabled={Boolean(busy) || stagedCount === 0}
              placeholder={t("projectTools.gitReview.commitMessagePlaceholder")}
              className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-[13px] outline-none focus:ring-2 focus:ring-foreground/10 disabled:bg-muted/40"
            />
            <button
              type="submit"
              disabled={Boolean(busy) || stagedCount === 0 || !commitMessage.trim()}
              className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-foreground px-4 text-xs font-medium text-background disabled:bg-muted disabled:text-muted-foreground"
            >
              <GitCommitHorizontal className="h-4 w-4" />
              {t("projectTools.gitReview.commit")}
            </button>
          </form>
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-3">
          {busy && history.length === 0 ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("chat.mobileTerminal.running")}
            </div>
          ) : history.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t("projectTools.gitReview.noCommitHistory")}
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((entry) => (
                <button
                  key={entry.sha}
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void openCommit(entry)}
                  className="flex w-full items-start gap-3 rounded-xl border border-border bg-background p-3 text-left active:bg-muted disabled:opacity-55"
                >
                  <GitCommitHorizontal className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium leading-5">{entry.subject}</span>
                    <span className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-muted-foreground">
                      <span className="font-mono">{entry.shortSha}</span>
                      <span>{entry.author}</span>
                      <span>{entry.date}</span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </MobileFullscreenPanel>
  );
}
