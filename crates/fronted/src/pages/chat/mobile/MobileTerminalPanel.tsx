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
import { invoke } from "@xgent/runtime";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GitBranch, Key, Send, Square, Terminal, Trash2, X } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import type { SshHostConfig } from "../../../lib/settings";
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
          sandbox: false,
          sandbox_allow_network: true,
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
    <MobileFullscreenPanel open label={panelTitle}>
      <HStack
        as="header"
        gap={2}
        vAlign="center"
        paddingInline={3}
        className="mobile-panel-header min-h-[var(--xgent-mobile-header-height)] shrink-0 border-b border-[var(--color-border-subtle)] bg-[var(--color-background-surface)]"
      >
        <PanelIcon />
        <StackItem size="fill">
          <VStack gap={0}>
            <Heading level={2} maxLines={1}>
              {panelTitle}
            </Heading>
            <Text type="supporting" color="secondary" maxLines={1}>
              {sessionCwd ? `${workdir.replace(/[\\/]+$/, "")}/${sessionCwd}` : workdir}
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
          onClick={onClose}
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
                      {response?.stdout ? (
                        <CodeBlock
                          code={response.stdout}
                          language="plaintext"
                          title="stdout"
                          size="sm"
                          width="100%"
                          maxHeight="var(--xgent-terminal-output-max-height)"
                          isWrapped
                          container="section"
                        />
                      ) : null}
                      {response?.stderr ? (
                        <CodeBlock
                          code={response.stderr}
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
                    </VStack>
                  </Card>
                );
              })}
            </VStack>
          )}
        </VStack>
      </StackItem>

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
            label={
              workdir
                ? mode === "ssh"
                  ? t("chat.mobileSsh.placeholder")
                  : t("chat.mobileTerminal.placeholder")
                : t("chat.mobileTerminal.noWorkspace")
            }
            isLabelHidden
            value={command}
            onChange={setCommand}
            isDisabled={Boolean(activeRunId) || !workdir}
            disabledMessage={!workdir ? t("chat.mobileTerminal.noWorkspace") : undefined}
            placeholder={
              workdir
                ? mode === "ssh"
                  ? t("chat.mobileSsh.placeholder")
                  : t("chat.mobileTerminal.placeholder")
                : t("chat.mobileTerminal.noWorkspace")
            }
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
