import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Code, CodeBlock } from "@astryxdesign/core/CodeBlock";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Token } from "@astryxdesign/core/Token";
import { invoke, isTauriRuntime, listenNativePlugin } from "@xgent/runtime";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GitBranch, Key, Send, Square, Terminal, Trash2, X } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import { inferRuntimePlatform } from "../../../lib/runtimePlatform";
import type { AppSettings, SshHostConfig } from "../../../lib/settings";
import { presentationControls } from "../../../presentation/controls";
import { NativeSurface } from "../../../presentation/NativeSurface";
import { createNativePresentationTheme } from "../../../presentation/nativeTheme";
import type { PresentationNode } from "../../../presentation/types";
import { isApplePresentationRuntime } from "../../../runtime/applePresentation";
import { MobileFullscreenPanel } from "./MobilePanelScaffold";

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
  liveStdout?: string;
  liveStderr?: string;
};

export type MobileShellPanelMode = "terminal" | "git" | "ssh";

type MobileTerminalPanelProps = {
  open: boolean;
  workdir: string;
  settings?: AppSettings;
  preferLanPcExecution?: boolean;
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

function normalizedSessionCwd(
  current: string,
  requestedInput: string,
  workdir: string,
  previous: string,
  guestFilesystem: boolean,
) {
  let requested = unwrapShellPath(requestedInput).replaceAll("\\", "/").trim();
  if (guestFilesystem) {
    if (requested === "-") return previous || "/workspace";
    if (!requested || requested === "~") return "/root";
    const workspace = workdir.replaceAll("\\", "/").replace(/\/+$/, "");
    if (requested === workspace || requested.startsWith(`${workspace}/`)) {
      requested = `/workspace${requested.slice(workspace.length)}`;
    }
    const path = requested.startsWith("/") ? requested : `${current || "/workspace"}/${requested}`;
    const segments: string[] = [];
    for (const segment of path.split("/")) {
      if (!segment || segment === ".") continue;
      if (segment === "..") segments.pop();
      else segments.push(segment);
    }
    return `/${segments.join("/")}`;
  }
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
  const match = /^cd(?:[ \t]+(.*))?$/.exec(command.trim());
  if (!match) return null;
  const target = (match[1] ?? "").trim();
  if (!target) return "";
  // Persist only a literal single-directory change. Operators, expansions and
  // escape sequences belong to the backend Shell, not the workspace path parser.
  const plain = /^[\p{L}\p{N}_./:@+,=%-]+$/u.test(target) || target === "~";
  const quoted = /^'[^'\\\r\n]*'$/.test(target) || /^"[^"\\$`\r\n]*"$/.test(target);
  if (!plain && !quoted) return null;
  const path = unwrapShellPath(target);
  if (path.startsWith("-") && path !== "-") return null;
  if (quoted && (path.trim() !== path || !path || path === "~" || path === "-")) return null;
  return target;
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

// Text-only command results cannot interpret terminal controls. Fold progress
// overwrites and remove ANSI escapes before presenting them as prose or code.
const terminalEscape = String.fromCharCode(27);
const terminalBell = String.fromCharCode(7);
const terminalOsc = new RegExp(
  `${terminalEscape}\\][^${terminalBell}${terminalEscape}]*(?:${terminalBell}|${terminalEscape}\\\\)`,
  "g",
);
const terminalCsi = new RegExp(`${terminalEscape}\\[[0-?]*[ -/]*[@-~]`, "g");
const terminalCharset = new RegExp(`${terminalEscape}[()][0-2AB]`, "g");
const terminalSingle = new RegExp(`${terminalEscape}[@-_]`, "g");

function displayTerminalOutput(raw: string) {
  return raw
    .replace(terminalOsc, "")
    .replace(terminalCsi, "")
    .replace(terminalCharset, "")
    .replace(terminalSingle, "")
    .split("\n")
    .map((line) =>
      Array.from(line.split("\r").filter(Boolean).at(-1) ?? "")
        .filter((character) => {
          const code = character.charCodeAt(0);
          return code === 9 || (code >= 32 && code !== 127);
        })
        .join(""),
    )
    .join("\n");
}

export function MobileTerminalPanel(props: MobileTerminalPanelProps) {
  const {
    open,
    workdir,
    preferLanPcExecution = false,
    mode = "terminal",
    sshHosts = [],
    initialCommand = "",
    autoRunInitialCommand = false,
    onClose,
  } = props;
  const { t } = useLocale();
  const guestFilesystem =
    !preferLanPcExecution && isTauriRuntime() && inferRuntimePlatform() === "android";
  const liveInputEnabled =
    !preferLanPcExecution &&
    mode === "terminal" &&
    isTauriRuntime() &&
    ["android", "ios"].includes(inferRuntimePlatform());
  const [command, setCommandValue] = useState(initialCommand);
  const [entries, setEntries] = useState<TerminalEntry[]>([]);
  const [activeRunId, setActiveRunId] = useState("");
  const [inputText, setInputValue] = useState("");
  // Native edits and a keyboard submit can arrive before React publishes the
  // next document. Commands/stdin must read the draft accepted by that edit.
  const drafts = useRef({ command: initialCommand, input: "" });
  const setCommand = useCallback((next: string) => {
    drafts.current.command = next;
    setCommandValue(next);
  }, []);
  const setInputText = useCallback((next: string | ((previous: string) => string)) => {
    const value = typeof next === "function" ? next(drafts.current.input) : next;
    drafts.current.input = value;
    setInputValue(value);
  }, []);
  const [inputReady, setInputReady] = useState(false);
  const [inputBusy, setInputBusy] = useState(false);
  const [inputError, setInputError] = useState("");
  const inputState = useRef({ runId: "", ready: false, busy: false }).current;
  const [sessionCwd, setSessionCwd] = useState("");
  const [previousSessionCwd, setPreviousSessionCwd] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoRunKeyRef = useRef("");
  const runScopeKey = JSON.stringify([open, mode, workdir, preferLanPcExecution]);
  const runScope = useRef({
    key: runScopeKey,
    revision: 0,
    active: true,
    runId: "",
    pendingCancelIds: [] as string[],
    listeners: new Set<() => Promise<void>>(),
  }).current;
  if (runScope.key !== runScopeKey) {
    if (runScope.runId) runScope.pendingCancelIds.push(runScope.runId);
    runScope.key = runScopeKey;
    runScope.revision += 1;
    runScope.runId = "";
    autoRunKeyRef.current = "";
  }
  const runRevision = runScope.revision;
  const isCurrentScope = () =>
    open && runScope.active && runScope.key === runScopeKey && runScope.revision === runRevision;
  const isCurrentRun = (id: string) => isCurrentScope() && runScope.runId === id;

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
  const commandLabel = workdir
    ? mode === "ssh"
      ? t("chat.mobileSsh.placeholder")
      : t("chat.mobileTerminal.placeholder")
    : t("chat.mobileTerminal.noWorkspace");
  const PanelIcon = mode === "git" ? GitBranch : mode === "ssh" ? Key : Terminal;
  const cwdLabel = sessionCwd.startsWith("/")
    ? sessionCwd
    : sessionCwd
      ? `${workdir.replace(/[\\/]+$/, "")}/${sessionCwd}`
      : guestFilesystem
        ? "/workspace"
        : workdir;

  const runCommand = useCallback(
    async (rawCommand: string) => {
      const nextCommand = rawCommand.trim();
      if (!nextCommand || !isCurrentScope() || runScope.runId || !workdir.trim()) return;
      const id = createRunId();
      const cdTarget = simpleCdTarget(nextCommand);
      let nextCwd = sessionCwd;
      if (cdTarget !== null) {
        try {
          nextCwd = normalizedSessionCwd(
            sessionCwd,
            cdTarget,
            workdir,
            previousSessionCwd,
            guestFilesystem,
          );
        } catch (cause) {
          if (isCurrentScope()) {
            setEntries((current) => [
              ...current,
              {
                id,
                command: nextCommand,
                error: cause instanceof Error ? cause.message : String(cause),
              },
            ]);
          }
          return;
        }
      }
      runScope.runId = id;
      setCommand("");
      setActiveRunId(id);
      inputState.runId = id;
      inputState.ready = false;
      inputState.busy = false;
      setInputReady(false);
      setInputBusy(false);
      setInputText("");
      setInputError("");
      setEntries((current) => [...current.slice(-19), { id, command: nextCommand }]);
      let removeOutputListener: (() => Promise<void>) | undefined;
      let removeInputListener: (() => Promise<void>) | undefined;
      try {
        if (liveInputEnabled) {
          // Register before starting the command: a fast process may announce
          // readiness before shell_run returns. Input observation is required.
          removeInputListener = await listenNativePlugin<{
            runId: string;
            ready: boolean;
            error?: string | null;
          }>("mobile-execution", "inputState", (event) => {
            if (!isCurrentRun(id) || event.runId !== id || typeof event.ready !== "boolean") return;
            inputState.ready = event.ready;
            setInputReady(event.ready);
            if (typeof event.error === "string") setInputError(event.error);
          });
          runScope.listeners.add(removeInputListener);
        }
        if (isTauriRuntime()) {
          try {
            const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
            let liveStdout = "";
            let liveStderr = "";
            removeOutputListener = await listenNativePlugin<{
              runId: string;
              stream: "stdout" | "stderr";
              data: string;
            }>("mobile-execution", "output", (event) => {
              if (!isCurrentRun(id) || event.runId !== id) return;
              if (event.stream !== "stdout" && event.stream !== "stderr") return;
              try {
                const bytes = Uint8Array.from(atob(event.data), (char) => char.charCodeAt(0));
                const chunk = decoders[event.stream].decode(bytes, { stream: true });
                if (event.stream === "stdout") liveStdout = (liveStdout + chunk).slice(-65_536);
                else liveStderr = (liveStderr + chunk).slice(-65_536);
                setEntries((current) =>
                  current.map((entry) =>
                    entry.id === id ? { ...entry, liveStdout, liveStderr } : entry,
                  ),
                );
              } catch {
                // The final Shell result remains available if one event is malformed.
              }
            });
            runScope.listeners.add(removeOutputListener);
          } catch {
            // Live observation is optional; a failed listener must not block Shell.
          }
        }
        if (!isCurrentRun(id)) return;
        const response = await invoke<ShellRunResponse>("shell_run", {
          workdir,
          command: cdTarget === null ? nextCommand : "pwd",
          cwd: nextCwd || null,
          timeout_ms: 120_000,
          max_timeout_ms: 1_800_000,
          provider_id: null,
          run_id: id,
          sandbox: false,
          sandbox_allow_network: true,
          ...(liveInputEnabled ? { interactive_stdin: true } : {}),
        });
        if (!isCurrentRun(id)) return;
        setEntries((current) =>
          current.map((entry) => (entry.id === id ? { ...entry, response } : entry)),
        );
        const exitCode = response.exitCode ?? response.exit_code;
        if (cdTarget !== null && exitCode === 0 && !response.cancelled) {
          setPreviousSessionCwd(sessionCwd);
          setSessionCwd(nextCwd);
        }
      } catch (cause) {
        if (!isCurrentRun(id)) return;
        const error = cause instanceof Error ? cause.message : String(cause);
        setEntries((current) =>
          current.map((entry) => (entry.id === id ? { ...entry, error } : entry)),
        );
      } finally {
        for (const remove of [removeOutputListener, removeInputListener]) {
          if (remove && runScope.listeners.delete(remove)) void remove().catch(() => undefined);
        }
        if (inputState.runId === id) {
          inputState.runId = "";
          inputState.ready = false;
          inputState.busy = false;
        }
        if (isCurrentRun(id)) {
          runScope.runId = "";
          setActiveRunId("");
          setInputReady(false);
          setInputBusy(false);
        }
      }
    },
    [
      previousSessionCwd,
      sessionCwd,
      workdir,
      runRevision,
      runScopeKey,
      guestFilesystem,
      liveInputEnabled,
      setCommand,
      setInputText,
    ],
  );

  useEffect(() => {
    setCommand(initialCommand);
  }, [initialCommand, runScopeKey]);

  useEffect(() => {
    runScope.active = true;
    for (const runId of runScope.pendingCancelIds.splice(0)) {
      void invoke("shell_cancel", { run_id: runId }).catch(() => undefined);
    }
    return () => {
      runScope.active = false;
      for (const remove of runScope.listeners) void remove().catch(() => undefined);
      runScope.listeners.clear();
      const runId = runScope.runId;
      runScope.runId = "";
      if (runId) void invoke("shell_cancel", { run_id: runId }).catch(() => undefined);
    };
  }, [runScope, runScopeKey]);

  useEffect(() => {
    setActiveRunId("");
    inputState.runId = "";
    inputState.ready = false;
    inputState.busy = false;
    setInputReady(false);
    setInputBusy(false);
    setInputText("");
    setInputError("");
    setSessionCwd("");
    setPreviousSessionCwd("");
    setEntries([]);
  }, [runScopeKey]);

  useEffect(() => {
    if (!open) return;
    const autoRunKey = `${mode}\n${workdir}\n${initialCommand}`;
    if (
      autoRunInitialCommand &&
      initialCommand.trim() &&
      workdir.trim() &&
      autoRunKeyRef.current !== autoRunKey
    ) {
      autoRunKeyRef.current = autoRunKey;
      void runCommand(initialCommand);
    }
  }, [autoRunInitialCommand, initialCommand, mode, open, runCommand, workdir]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [activeRunId, entries]);

  if (!open) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await runCommand(drafts.current.command);
  };

  const cancel = async () => {
    const runId = runScope.runId;
    if (!runId || !isCurrentRun(runId)) return;
    inputState.ready = false;
    setInputReady(false);
    try {
      await invoke("shell_cancel", { run_id: runId });
    } catch (cause) {
      if (!isCurrentRun(runId)) return;
      const message = cause instanceof Error ? cause.message : String(cause);
      setInputError(message);
      setEntries((current) =>
        current.map((entry) => (entry.id === runId ? { ...entry, error: message } : entry)),
      );
    }
  };

  const closePanel = () => {
    if (!isCurrentScope()) return;
    const id = runScope.runId;
    runScope.runId = "";
    runScope.active = false;
    runScope.revision += 1;
    inputState.ready = false;
    for (const remove of runScope.listeners) void remove().catch(() => undefined);
    runScope.listeners.clear();
    if (id) void invoke("shell_cancel", { run_id: id }).catch(() => undefined);
    onClose();
  };

  const sendInput = async (eof = false) => {
    const id = inputState.runId;
    if (!isCurrentRun(id) || !inputState.ready || inputState.busy) return;
    const text = drafts.current.input;
    const bytes = new TextEncoder().encode(eof ? "" : `${text}\n`);
    if (bytes.length > 16 * 1024) {
      setInputError(t("chat.mobileTerminal.inputTooLarge"));
      return;
    }
    inputState.busy = true;
    setInputBusy(true);
    setInputError("");
    try {
      const response = await invoke<{ acceptedBytes: number; closed: boolean }>(
        "plugin:mobile-execution|write_input",
        {
          request: {
            runId: id,
            dataBase64: bytes.length
              ? btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
              : null,
            eof,
          },
        },
      );
      if (!isCurrentRun(id)) return;
      if (
        response.acceptedBytes !== bytes.length ||
        typeof response.closed !== "boolean" ||
        (eof && !response.closed)
      ) {
        throw new Error(t("chat.mobileTerminal.inputRejected"));
      }
      if (!eof) setInputText((current) => (current === text ? "" : current));
      if (response.closed) {
        inputState.ready = false;
        setInputReady(false);
      }
    } catch (cause) {
      if (isCurrentRun(id)) setInputError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (isCurrentRun(id)) {
        inputState.busy = false;
        setInputBusy(false);
      }
    }
  };

  if (isApplePresentationRuntime()) {
    const c = presentationControls();
    c.handlers.set("close", {
      enabled: true,
      accepts: (value) => value === null,
      run: closePanel,
    });
    const nodes: PresentationNode[] = [
      {
        id: "cwd",
        kind: "Text",
        text: cwdLabel,
        secondary: true,
      },
      ...presets.map((preset) =>
        c.action(
          preset.id,
          preset.label,
          () => {
            if (isCurrentScope())
              return preset.runImmediately
                ? runCommand(preset.command)
                : setCommand(preset.command);
          },
          !activeRunId && isCurrentScope(),
        ),
      ),
      ...entries.map((entry): PresentationNode => {
        const exitCode = entry.response?.exitCode ?? entry.response?.exit_code;
        const streams = [
          ["stdout", entry.response?.stdout ?? entry.liveStdout],
          ["stderr", entry.response?.stderr ?? entry.liveStderr],
          ["error", entry.error],
        ] as const;
        return c.group(entry.id, `$ ${entry.command}`, [
          ...streams.flatMap(([stream, raw]): PresentationNode[] =>
            raw
              ? [
                  {
                    id: `${entry.id}:${stream}`,
                    kind: "CodeBlock",
                    label: stream,
                    language: "plaintext",
                    text: displayTerminalOutput(raw),
                  },
                ]
              : [],
          ),
          ...(exitCode !== undefined
            ? [
                {
                  id: `${entry.id}:exit`,
                  kind: "Badge" as const,
                  label: t("chat.mobileTerminal.exitCode").replace("{code}", String(exitCode)),
                  status: exitCode === 0 ? ("completed" as const) : ("error" as const),
                },
              ]
            : []),
          ...(entry.response?.cancelled
            ? [
                {
                  id: `${entry.id}:cancelled`,
                  kind: "Badge" as const,
                  label: t("chat.mobileTerminal.cancelled"),
                  status: "paused" as const,
                },
              ]
            : []),
          ...((entry.response?.timedOut ?? entry.response?.timed_out)
            ? [
                {
                  id: `${entry.id}:timed-out`,
                  kind: "Badge" as const,
                  label: t("chat.mobileTerminal.timedOut"),
                  status: "error" as const,
                },
              ]
            : []),
        ]);
      }),
      ...(activeRunId
        ? [{ id: "running", kind: "Progress" as const, label: t("chat.mobileTerminal.running") }]
        : []),
      ...(activeRunId && liveInputEnabled
        ? [
            c.group("live-input", t("chat.mobileTerminal.programInput"), [
              c.input(
                "program-input",
                t("chat.mobileTerminal.programInput"),
                inputText,
                (value) => {
                  if (isCurrentRun(inputState.runId)) setInputText(value);
                },
                false,
                inputReady && !inputBusy,
              ),
              c.action(
                "send-input",
                t("chat.mobileTerminal.sendInput"),
                () => sendInput(),
                inputReady && !inputBusy,
              ),
              c.action(
                "input-eof",
                t("chat.mobileTerminal.inputEof"),
                () => sendInput(true),
                inputReady && !inputBusy,
              ),
              ...(inputError
                ? [{ id: "input-error", kind: "Text" as const, text: inputError }]
                : []),
            ]),
          ]
        : []),
      c.input(
        "command",
        commandLabel,
        command,
        (value) => {
          if (isCurrentScope()) setCommand(value);
        },
        false,
        !activeRunId && !!workdir,
      ),
      c.action(
        "run",
        t("chat.mobileTerminal.run"),
        () => runCommand(drafts.current.command),
        !!command.trim() && !!workdir.trim() && !activeRunId && isCurrentScope(),
      ),
      c.action("cancel", t("chat.mobileTerminal.stop"), cancel, !!activeRunId),
      c.action(
        "clear",
        t("chat.mobileTerminal.clear"),
        () => {
          if (isCurrentScope()) setEntries([]);
        },
        !activeRunId && entries.length > 0,
      ),
    ];
    return (
      <NativeSurface
        document={{
          mode: "sheet",
          title: panelTitle,
          appearance: props.settings?.theme ?? "system",
          formFactor: "mobile",
          theme: props.settings
            ? createNativePresentationTheme(props.settings, true, "workspaceTools")
            : undefined,
          nodes: [
            {
              id: "mobile-terminal-layout",
              kind: "TerminalLayout",
              fill: true,
              children: [
                {
                  id: "mobile-terminal-output",
                  kind: "VStack",
                  spacing: 12,
                  children: nodes.filter(
                    (node) =>
                      !["live-input", "command", "run", "cancel", "clear"].includes(node.id),
                  ),
                },
                {
                  id: "mobile-terminal-input",
                  kind: "VStack",
                  spacing: 8,
                  children: nodes.filter((node) =>
                    ["live-input", "command", "run", "cancel", "clear"].includes(node.id),
                  ),
                },
              ],
            },
          ],
          dismissAction: "close",
        }}
        handlers={c.handlers}
        onError={(cause) => {
          if (isCurrentScope())
            setEntries((current) => [
              ...current,
              { id: createRunId(), command: "", error: String(cause) },
            ]);
        }}
      />
    );
  }

  return (
    <MobileFullscreenPanel open label={panelTitle} onBack={closePanel}>
      <HStack
        as="header"
        gap={2}
        vAlign="center"
        paddingInline={3}
        className="mobile-panel-header min-h-[var(--xgent-mobile-header-height)] shrink-0 bg-[var(--color-background-surface)]"
      >
        <PanelIcon />
        <StackItem size="fill">
          <VStack gap={0}>
            <Heading level={2} maxLines={1}>
              {panelTitle}
            </Heading>
            <Text type="supporting" color="secondary" maxLines={1}>
              {cwdLabel}
            </Text>
          </VStack>
        </StackItem>
        {entries.length > 0 && !activeRunId ? (
          <IconButton
            label={t("chat.mobileTerminal.clear")}
            tooltip={t("chat.mobileTerminal.clear")}
            icon={<Trash2 />}
            variant="ghost"
            onClick={() => setEntries([])}
          />
        ) : null}
        <IconButton
          label={t("chat.mobileTerminal.close")}
          tooltip={t("chat.mobileTerminal.close")}
          icon={<X />}
          variant="ghost"
          onClick={closePanel}
        />
      </HStack>

      {presets.length > 0 ? (
        <HStack
          gap={2}
          padding={2}
          className="shrink-0 overflow-x-auto border-b border-[var(--color-border-subtle)]"
        >
          {presets.map((preset) => (
            <Button
              key={preset.id}
              label={preset.label}
              size="sm"
              isDisabled={Boolean(activeRunId)}
              onClick={() => {
                if (preset.runImmediately) void runCommand(preset.command);
                else setCommand(preset.command);
              }}
            />
          ))}
        </HStack>
      ) : null}

      <StackItem size="fill">
        <VStack
          ref={scrollRef}
          gap={4}
          padding={3}
          className="h-full overflow-y-auto overscroll-contain"
        >
          {entries.length === 0 ? (
            <EmptyState
              icon={<PanelIcon />}
              title={
                mode === "git"
                  ? t("chat.mobileGit.ready")
                  : mode === "ssh"
                    ? t("chat.mobileSsh.ready")
                    : t("chat.mobileTerminal.ready")
              }
              description={
                mode === "git"
                  ? t("chat.mobileGit.hint")
                  : mode === "ssh"
                    ? t("chat.mobileSsh.hint")
                    : t("chat.mobileTerminal.workspaceHint")
              }
              isCompact
            />
          ) : (
            <VStack gap={4}>
              {entries.map((entry) => {
                const response = entry.response;
                const exitCode = response?.exitCode ?? response?.exit_code;
                const stdout = displayTerminalOutput(response?.stdout ?? entry.liveStdout ?? "");
                const stderr = displayTerminalOutput(response?.stderr ?? entry.liveStderr ?? "");
                return (
                  <Card key={entry.id} padding={3} width="100%">
                    <VStack gap={3}>
                      <Text type="body" weight="medium">
                        <Code>{`$ ${entry.command}`}</Code>
                      </Text>
                      {entry.id === activeRunId ? (
                        <HStack gap={2} vAlign="center">
                          <Spinner aria-label={t("chat.mobileTerminal.running")} size="sm" />
                          <Text type="supporting" color="secondary">
                            {t("chat.mobileTerminal.running")}
                          </Text>
                        </HStack>
                      ) : null}
                      {stdout ? (
                        <CodeBlock
                          code={stdout}
                          aria-label={`stdout:\n${stdout}`}
                          language="plaintext"
                          title="stdout"
                          size="sm"
                          width="100%"
                          maxHeight="var(--xgent-terminal-output-max-height)"
                          isWrapped
                          container="section"
                        />
                      ) : null}
                      {stderr ? (
                        <CodeBlock
                          code={stderr}
                          aria-label={`stderr:\n${stderr}`}
                          language="plaintext"
                          title="stderr"
                          size="sm"
                          width="100%"
                          maxHeight="var(--xgent-terminal-output-max-height)"
                          isWrapped
                          container="section"
                        />
                      ) : null}
                      {entry.error ? (
                        <CodeBlock
                          code={entry.error}
                          aria-label={`error:\n${entry.error}`}
                          language="plaintext"
                          title="error"
                          size="sm"
                          width="100%"
                          maxHeight="var(--xgent-terminal-output-max-height)"
                          isWrapped
                          container="section"
                        />
                      ) : null}
                      {exitCode !== undefined ? (
                        <Token
                          label={t("chat.mobileTerminal.exitCode").replace(
                            "{code}",
                            String(exitCode),
                          )}
                          color={exitCode === 0 ? "green" : "red"}
                          size="sm"
                        />
                      ) : null}
                      {response?.cancelled ? (
                        <Token
                          label={t("chat.mobileTerminal.cancelled")}
                          color="orange"
                          size="sm"
                        />
                      ) : null}
                      {(response?.timedOut ?? response?.timed_out) ? (
                        <Token label={t("chat.mobileTerminal.timedOut")} color="red" size="sm" />
                      ) : null}
                    </VStack>
                  </Card>
                );
              })}
            </VStack>
          )}
        </VStack>
      </StackItem>

      {activeRunId && liveInputEnabled ? (
        <VStack
          gap={2}
          padding={3}
          className="shrink-0 border-t border-[var(--color-border-subtle)]"
        >
          <TextInput
            label={t("chat.mobileTerminal.programInput")}
            value={inputText}
            onChange={setInputText}
            onEnter={() => void sendInput()}
            isDisabled={!inputReady || inputBusy}
            width="100%"
          />
          <HStack gap={2}>
            <Button
              label={t("chat.mobileTerminal.sendInput")}
              onClick={() => void sendInput()}
              isDisabled={!inputReady || inputBusy}
            />
            <Button
              label={t("chat.mobileTerminal.inputEof")}
              onClick={() => void sendInput(true)}
              isDisabled={!inputReady || inputBusy}
            />
          </HStack>
          {inputError ? <Text>{inputError}</Text> : null}
        </VStack>
      ) : null}
      <HStack
        as="form"
        gap={2}
        vAlign="end"
        padding={3}
        onSubmit={(event) => void submit(event)}
        className="shrink-0 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-primary)] pb-[calc(var(--spacing-3)+env(safe-area-inset-bottom,0px))]"
      >
        <StackItem size="fill">
          <TextInput
            label={commandLabel}
            aria-label={commandLabel}
            isLabelHidden
            value={command}
            onChange={setCommand}
            isDisabled={Boolean(activeRunId) || !workdir}
            disabledMessage={!workdir ? t("chat.mobileTerminal.noWorkspace") : undefined}
            placeholder={commandLabel}
            size="lg"
            width="100%"
          />
        </StackItem>
        <IconButton
          type={activeRunId ? "button" : "submit"}
          label={activeRunId ? t("chat.mobileTerminal.stop") : t("chat.mobileTerminal.run")}
          tooltip={activeRunId ? t("chat.mobileTerminal.stop") : t("chat.mobileTerminal.run")}
          icon={activeRunId ? <Square /> : <Send />}
          variant={activeRunId ? "destructive" : "primary"}
          size="lg"
          onClick={activeRunId ? () => void cancel() : undefined}
          isDisabled={!activeRunId && (!command.trim() || !workdir)}
        />
      </HStack>
    </MobileFullscreenPanel>
  );
}
