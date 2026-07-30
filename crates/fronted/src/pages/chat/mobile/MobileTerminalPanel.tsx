import { invoke } from "@xagent/runtime";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GitBranch,
  Key,
  Loader2,
  Send,
  Square,
  Terminal,
  Trash2,
  X,
} from "../../../components/icons";
import { useLocale } from "../../../i18n";
import type { SshHostConfig } from "../../../lib/settings";

type ShellRunResponse = {
  exit_code?: number;
  exitCode?: number;
  shell: string;
  platform: string;
  stdout: string;
  stderr: string;
  timed_out?: boolean;
  timedOut?: boolean;
  cancelled: boolean;
  duration_ms?: number;
  durationMs?: number;
};

type TerminalEntry = {
  id: string;
  command: string;
  response?: ShellRunResponse;
  error?: string;
};

export type MobileShellPanelMode = "terminal" | "git" | "ssh";

type MobileTerminalPanelProps = {
  open: boolean;
  workdir: string;
  mode?: MobileShellPanelMode;
  sshHosts?: SshHostConfig[];
  initialCommand?: string;
  autoRunInitialCommand?: boolean;
  onClose: () => void;
};

type ShellPreset = {
  id: string;
  label: string;
  command: string;
  runImmediately: boolean;
};

function createRunId() {
  return `mobile-terminal-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
}

function unwrapShellPath(raw: string) {
  const value = raw.trim();
  if (
    value.length >= 2 &&
    ((value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"')))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function normalizedRelativeCwd(
  current: string,
  requestedInput: string,
  workdir: string,
  previous: string,
) {
  let requested = unwrapShellPath(requestedInput).replaceAll("\\", "/").trim();
  if (requested === "-") return previous;
  if (!requested || requested === "~" || requested === "/workspace") return "";

  const normalizedWorkdir = workdir.replaceAll("\\", "/").replace(/\/+$/, "");
  let rootedAtWorkspace = false;
  if (requested === normalizedWorkdir) return "";
  if (requested.startsWith(`${normalizedWorkdir}/`)) {
    requested = requested.slice(normalizedWorkdir.length + 1);
    rootedAtWorkspace = true;
  } else if (requested.startsWith("/workspace/")) {
    requested = requested.slice("/workspace/".length);
    rootedAtWorkspace = true;
  } else if (requested.startsWith("/")) {
    throw new Error("cd only supports the current workspace and its subdirectories.");
  }

  const requestedSegments = requested.startsWith("./")
    ? requested.slice(2).split("/")
    : requested.split("/");
  const segments = rootedAtWorkspace
    ? requestedSegments
    : [...current.split("/").filter(Boolean), ...requestedSegments];
  const resolved: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (resolved.length === 0) {
        throw new Error("cd cannot leave the current workspace.");
      }
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return resolved.join("/");
}

function simpleCdTarget(command: string) {
  const match = /^cd(?:\s+(.*))?$/s.exec(command.trim());
  return match ? (match[1] ?? "") : null;
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function MobileTerminalPanel(props: MobileTerminalPanelProps) {
  const {
    open,
    workdir,
    mode = "terminal",
    sshHosts = [],
    initialCommand = "",
    autoRunInitialCommand = false,
    onClose,
  } = props;
  const { t } = useLocale();
  const [command, setCommand] = useState(initialCommand);
  const [entries, setEntries] = useState<TerminalEntry[]>([]);
  const [activeRunId, setActiveRunId] = useState("");
  const [sessionCwd, setSessionCwd] = useState("");
  const [previousSessionCwd, setPreviousSessionCwd] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoRunKeyRef = useRef("");

  const presets = useMemo<ShellPreset[]>(() => {
    if (mode === "git") {
      return [
        {
          id: "status",
          label: t("chat.mobileGit.status"),
          command:
            "if command -v git >/dev/null 2>&1; then git status --short --branch; else lg2 status; fi",
          runImmediately: true,
        },
        {
          id: "changes",
          label: t("chat.mobileGit.changes"),
          command:
            "if command -v git >/dev/null 2>&1; then git diff --stat && git diff; else lg2 diff; fi",
          runImmediately: true,
        },
        {
          id: "history",
          label: t("chat.mobileGit.history"),
          command:
            "if command -v git >/dev/null 2>&1; then git log --oneline --decorate -n 30; else lg2 log -n 30; fi",
          runImmediately: true,
        },
      ];
    }
    if (mode === "ssh") {
      return sshHosts
        .filter((host) => host.host.trim())
        .map((host) => {
          const target = [host.username.trim(), host.host.trim()].filter(Boolean).join("@");
          return {
            id: host.id,
            label: host.name.trim() || target,
            command: `ssh -p ${host.port || 22} ${shellQuote(target)}`,
            runImmediately: false,
          };
        });
    }
    return [];
  }, [mode, sshHosts, t]);

  const panelTitle =
    mode === "git"
      ? t("chat.mobileGit.title")
      : mode === "ssh"
        ? t("chat.mobileSsh.title")
        : t("chat.mobileTerminal.title");
  const PanelIcon = mode === "git" ? GitBranch : mode === "ssh" ? Key : Terminal;

  const runCommand = useCallback(
    async (rawCommand: string) => {
      const nextCommand = rawCommand.trim();
      if (!nextCommand || activeRunId || !workdir.trim()) return;
      const id = createRunId();
      const cdTarget = simpleCdTarget(nextCommand);
      let nextCwd = sessionCwd;
      if (cdTarget !== null) {
        try {
          nextCwd = normalizedRelativeCwd(sessionCwd, cdTarget, workdir, previousSessionCwd);
        } catch (cause) {
          setEntries((current) => [
            ...current,
            {
              id,
              command: nextCommand,
              error: cause instanceof Error ? cause.message : String(cause),
            },
          ]);
          return;
        }
      }
      setCommand("");
      setActiveRunId(id);
      setEntries((current) => [...current, { id, command: nextCommand }]);
      try {
        const response = await invoke<ShellRunResponse>("shell_run", {
          workdir,
          command: cdTarget === null ? nextCommand : "pwd",
          cwd: nextCwd || null,
          timeout_ms: 120_000,
          max_timeout_ms: 1_800_000,
          provider_id: null,
          run_id: id,
        });
        setEntries((current) =>
          current.map((entry) => (entry.id === id ? { ...entry, response } : entry)),
        );
        const exitCode = response.exitCode ?? response.exit_code;
        if (cdTarget !== null && exitCode === 0) {
          setPreviousSessionCwd(sessionCwd);
          setSessionCwd(nextCwd);
        }
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : String(cause);
        setEntries((current) =>
          current.map((entry) => (entry.id === id ? { ...entry, error } : entry)),
        );
      } finally {
        setActiveRunId("");
      }
    },
    [activeRunId, previousSessionCwd, sessionCwd, workdir],
  );

  useEffect(() => {
    if (!open) {
      autoRunKeyRef.current = "";
      return;
    }
    setCommand(initialCommand);
  }, [initialCommand, mode, open]);

  useEffect(() => {
    setSessionCwd("");
    setPreviousSessionCwd("");
    setEntries([]);
  }, [mode, workdir]);

  useEffect(() => {
    if (!open) return;
    const autoRunKey = `${workdir}\n${initialCommand}`;
    if (
      autoRunInitialCommand &&
      initialCommand.trim() &&
      workdir.trim() &&
      autoRunKeyRef.current !== autoRunKey
    ) {
      autoRunKeyRef.current = autoRunKey;
      void runCommand(initialCommand);
    }
  }, [autoRunInitialCommand, initialCommand, open, runCommand, workdir]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [activeRunId, entries]);

  if (!open) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await runCommand(command);
  };

  const cancel = async () => {
    if (!activeRunId) return;
    await invoke("shell_cancel", { run_id: activeRunId }).catch(() => undefined);
  };

  return (
    <section
      data-edge-swipe-ignore
      aria-label={panelTitle}
      className="absolute inset-0 z-[72] flex min-h-0 flex-col bg-zinc-950 text-zinc-100"
    >
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-zinc-950/90 px-3 pt-[env(safe-area-inset-top,0px)] backdrop-blur-xl">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
          <PanelIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">{panelTitle}</h2>
          <p className="truncate font-mono text-[10px] text-zinc-400">
            {sessionCwd ? `${workdir.replace(/[\\/]+$/, "")}/${sessionCwd}` : workdir}
          </p>
        </div>
        {entries.length > 0 && !activeRunId ? (
          <button
            type="button"
            onClick={() => setEntries([])}
            className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 active:bg-white/10 active:text-white"
            aria-label={t("chat.mobileTerminal.clear")}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 active:bg-white/10 active:text-white"
          aria-label={t("chat.mobileTerminal.close")}
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {presets.length > 0 ? (
        <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-white/10 px-3 py-2.5">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              disabled={Boolean(activeRunId)}
              onClick={() => {
                if (preset.runImmediately) void runCommand(preset.command);
                else setCommand(preset.command);
              }}
              className="shrink-0 rounded-full border border-white/10 bg-white/[0.055] px-3 py-1.5 text-[11px] font-medium text-zinc-200 active:bg-white/10 disabled:opacity-45"
            >
              {preset.label}
            </button>
          ))}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 py-4 font-mono text-[12px] leading-5"
      >
        {entries.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-zinc-400">
            <div className="text-zinc-200">
              {mode === "git"
                ? t("chat.mobileGit.ready")
                : mode === "ssh"
                  ? t("chat.mobileSsh.ready")
                  : t("chat.mobileTerminal.ready")}
            </div>
            <div className="mt-1 text-[11px] leading-5">
              {mode === "git"
                ? t("chat.mobileGit.hint")
                : mode === "ssh"
                  ? t("chat.mobileSsh.hint")
                  : t("chat.mobileTerminal.workspaceHint")}
            </div>
          </div>
        ) : null}
        {entries.map((entry) => {
          const response = entry.response;
          const exitCode = response?.exitCode ?? response?.exit_code;
          return (
            <article key={entry.id}>
              <div className="flex gap-2 text-emerald-400">
                <span>$</span>
                <span className="min-w-0 break-all text-zinc-100">{entry.command}</span>
              </div>
              {entry.id === activeRunId ? (
                <div className="mt-2 flex items-center gap-2 text-zinc-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("chat.mobileTerminal.running")}
                </div>
              ) : null}
              {response?.stdout ? (
                <pre className="mt-2 whitespace-pre-wrap break-words text-zinc-200">
                  {response.stdout}
                </pre>
              ) : null}
              {response?.stderr ? (
                <pre className="mt-2 whitespace-pre-wrap break-words text-amber-300">
                  {response.stderr}
                </pre>
              ) : null}
              {entry.error ? (
                <pre className="mt-2 whitespace-pre-wrap break-words text-red-300">
                  {entry.error}
                </pre>
              ) : null}
              {exitCode !== undefined ? (
                <div className="mt-1 text-[10px] text-zinc-500">
                  {t("chat.mobileTerminal.exitCode").replace("{code}", String(exitCode))}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      <form
        onSubmit={(event) => void submit(event)}
        className="flex shrink-0 items-end gap-2 border-t border-white/10 bg-zinc-950/92 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-3"
      >
        <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-2xl border border-white/12 bg-white/[0.055] px-3">
          <span className="font-mono text-emerald-400">$</span>
          <input
            value={command}
            onChange={(event) => setCommand(event.currentTarget.value)}
            disabled={Boolean(activeRunId) || !workdir}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={
              workdir
                ? mode === "ssh"
                  ? t("chat.mobileSsh.placeholder")
                  : t("chat.mobileTerminal.placeholder")
                : t("chat.mobileTerminal.noWorkspace")
            }
            className="h-10 min-w-0 flex-1 bg-transparent font-mono text-[13px] text-zinc-100 outline-none placeholder:text-zinc-600"
          />
        </label>
        <button
          type={activeRunId ? "button" : "submit"}
          onClick={activeRunId ? () => void cancel() : undefined}
          disabled={!activeRunId && (!command.trim() || !workdir)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-zinc-950 disabled:bg-zinc-800 disabled:text-zinc-600"
          aria-label={activeRunId ? t("chat.mobileTerminal.stop") : t("chat.mobileTerminal.run")}
        >
          {activeRunId ? <Square className="h-4 w-4 fill-current" /> : <Send className="h-4 w-4" />}
        </button>
      </form>
    </section>
  );
}
