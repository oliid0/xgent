import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { Code, CodeBlock } from "@astryxdesign/core/CodeBlock";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Token } from "@astryxdesign/core/Token";
import { invoke } from "@xgent/runtime";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Key,
  Link2,
  Send,
  Settings2,
  Square,
  Trash2,
  X,
} from "../../../components/icons";
import { useLocale } from "../../../i18n";
import { isNativeMobileRuntime } from "../../../lib/runtimePlatform";
import type { AppSettings, SshHostConfig } from "../../../lib/settings";
import { runNativeSshCommand } from "../../../lib/terminal/runNativeSshCommand";
import type { TerminalSshPrompt } from "../../../lib/terminal/types";
import { presentationControls } from "../../../presentation/controls";
import { NativeSurface } from "../../../presentation/NativeSurface";
import { createNativePresentationTheme } from "../../../presentation/nativeTheme";
import type { PresentationNode } from "../../../presentation/types";
import { isApplePresentationRuntime } from "../../../runtime/applePresentation";
import { MobileFullscreenPanel } from "./MobilePanelScaffold";

type ShellRunResponse = {
  exit_code?: number;
  exitCode?: number;
  stdout: string;
  stderr: string;
  timed_out?: boolean;
  timedOut?: boolean;
  cancelled: boolean;
};

type SshCommandEntry = {
  id: string;
  command: string;
  response?: ShellRunResponse;
  error?: string;
};

type MobileSshPanelProps = {
  open: boolean;
  workdir: string;
  projectPathKey: string;
  hosts: SshHostConfig[];
  settings?: AppSettings;
  associatedHostIds: string[];
  onAssociatedHostIdsChange: (hostIds: string[]) => void;
  onOpenSettings: () => void;
  onClose: () => void;
};

function createRunId() {
  return `mobile-ssh-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
}

function endpoint(host: SshHostConfig) {
  return `${host.username.trim() ? `${host.username.trim()}@` : ""}${host.host.trim()}:${host.port || 22}`;
}

function authLabel(host: SshHostConfig, t: (key: string) => string) {
  if (host.authType === "privateKey") return t("settings.sshAuthPrivateKey");
  if (host.authType === "keyboardInteractive") {
    return t("settings.sshAuthKeyboardInteractive");
  }
  return t("settings.sshAuthPassword");
}

export function MobileSshPanel(props: MobileSshPanelProps) {
  const {
    open,
    workdir,
    projectPathKey,
    hosts,
    associatedHostIds,
    onAssociatedHostIdsChange,
    onOpenSettings,
    onClose,
  } = props;
  const { t } = useLocale();
  const [selectedHostId, setSelectedHostId] = useState("");
  const [command, setCommandState] = useState("");
  const [keyboardResponse, setKeyboardResponseState] = useState("");
  const drafts = useRef({ command: "", keyboardResponse: "", promptAnswer: "" });
  const setCommand = useCallback((value: string) => {
    drafts.current.command = value;
    setCommandState(value);
  }, []);
  const setKeyboardResponse = useCallback((value: string) => {
    drafts.current.keyboardResponse = value;
    setKeyboardResponseState(value);
  }, []);
  const [entries, setEntries] = useState<SshCommandEntry[]>([]);
  const [activeRunId, setActiveRunId] = useState("");
  const mobile = isNativeMobileRuntime();
  const desktopRun = useRef<AbortController | null>(null);
  const [sshPrompt, setSshPrompt] = useState<{
    prompt: TerminalSshPrompt;
    answer: (value: { answer?: string; trustHostKey?: boolean }) => void;
  } | null>(null);
  const [promptAnswer, setPromptAnswerState] = useState("");
  const setPromptAnswer = useCallback((value: string) => {
    drafts.current.promptAnswer = value;
    setPromptAnswerState(value);
  }, []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectedHost = useMemo(
    () => hosts.find((host) => host.id === selectedHostId) ?? null,
    [hosts, selectedHostId],
  );
  const scopeKey = JSON.stringify([open, workdir, projectPathKey, selectedHost?.id ?? ""]);
  const runScope = useRef({
    key: scopeKey,
    revision: 0,
    active: true,
    runId: "",
    pendingCancelIds: [] as string[],
  }).current;
  if (runScope.key !== scopeKey) {
    if (runScope.runId) runScope.pendingCancelIds.push(runScope.runId);
    runScope.key = scopeKey;
    runScope.revision += 1;
    runScope.runId = "";
  }
  const runRevision = runScope.revision;
  const isCurrentScope = () =>
    open && runScope.active && runScope.key === scopeKey && runScope.revision === runRevision;
  const isCurrentRun = (id: string) => isCurrentScope() && runScope.runId === id;
  const associatedSet = useMemo(
    () => new Set(associatedHostIds.filter((id) => hosts.some((host) => host.id === id))),
    [associatedHostIds, hosts],
  );
  const orderedHosts = useMemo(
    () => [
      ...hosts.filter((host) => associatedSet.has(host.id)),
      ...hosts.filter((host) => !associatedSet.has(host.id)),
    ],
    [associatedSet, hosts],
  );

  useEffect(() => {
    if (!open) return;
    setSelectedHostId((current) =>
      current && hosts.some((host) => host.id === current) ? current : "",
    );
  }, [hosts, open]);

  useEffect(() => {
    runScope.active = true;
    for (const runId of runScope.pendingCancelIds.splice(0)) {
      void invoke("shell_cancel", { run_id: runId }).catch(() => undefined);
    }
    return () => {
      runScope.active = false;
      desktopRun.current?.abort();
      const runId = runScope.runId;
      runScope.runId = "";
      if (runId) void invoke("shell_cancel", { run_id: runId }).catch(() => undefined);
    };
  }, [runScope, scopeKey]);

  useEffect(() => {
    setCommand("");
    setKeyboardResponse("");
    setEntries([]);
    setActiveRunId("");
    setSshPrompt(null);
    setPromptAnswer("");
  }, [scopeKey, setCommand, setKeyboardResponse, setPromptAnswer]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [activeRunId, entries]);

  const run = async (event?: FormEvent) => {
    event?.preventDefault();
    const remoteCommand = drafts.current.command.trim();
    const keyboardAnswer = drafts.current.keyboardResponse;
    if (
      !selectedHost ||
      !remoteCommand ||
      !isCurrentScope() ||
      runScope.runId ||
      !workdir.trim() ||
      (mobile && selectedHost.authType === "keyboardInteractive" && !keyboardAnswer.trim())
    )
      return;
    const id = createRunId();
    runScope.runId = id;
    setCommand("");
    setKeyboardResponse("");
    setActiveRunId(id);
    setEntries((current) => [...current, { id, command: remoteCommand }]);
    const controller = new AbortController();
    desktopRun.current = controller;
    try {
      const response = mobile
        ? await invoke<ShellRunResponse>("mobile_ssh_exec", {
            host_id: selectedHost.id,
            workdir,
            remote_command: remoteCommand,
            keyboard_response:
              selectedHost.authType === "keyboardInteractive" ? keyboardAnswer : null,
            timeout_ms: 300_000,
            run_id: id,
          })
        : await runNativeSshCommand<ShellRunResponse>({
            hostId: selectedHost.id,
            workdir,
            projectPathKey,
            command: remoteCommand,
            runId: id,
            signal: controller.signal,
            prompt: (prompt) =>
              new Promise((resolve, reject) => {
                const abort = () =>
                  reject(new DOMException("SSH connection cancelled", "AbortError"));
                if (controller.signal.aborted) {
                  abort();
                  return;
                }
                controller.signal.addEventListener("abort", abort, { once: true });
                if (!isCurrentRun(id)) {
                  abort();
                  return;
                }
                setPromptAnswer("");
                let submitted = false;
                setSshPrompt({
                  prompt,
                  answer: (value) => {
                    if (submitted) return;
                    submitted = true;
                    controller.signal.removeEventListener("abort", abort);
                    if (!isCurrentRun(id) || controller.signal.aborted) {
                      abort();
                      return;
                    }
                    setSshPrompt(null);
                    setPromptAnswer("");
                    resolve(value);
                  },
                });
              }),
          });
      if (!isCurrentRun(id)) return;
      setEntries((current) =>
        current.map((entry) => (entry.id === id ? { ...entry, response } : entry)),
      );
    } catch (cause) {
      if (!isCurrentRun(id)) return;
      const error = cause instanceof Error ? cause.message : String(cause);
      setEntries((current) =>
        current.map((entry) => (entry.id === id ? { ...entry, error } : entry)),
      );
    } finally {
      if (desktopRun.current === controller) desktopRun.current = null;
      if (isCurrentRun(id)) {
        runScope.runId = "";
        setSshPrompt(null);
        setPromptAnswer("");
        setActiveRunId("");
      }
    }
  };

  const cancel = async () => {
    const runId = runScope.runId;
    if (!runId || !isCurrentRun(runId)) return;
    desktopRun.current?.abort();
    await invoke("shell_cancel", { run_id: runId }).catch(() => undefined);
  };

  const close = () => {
    if (!isCurrentScope()) return;
    desktopRun.current?.abort();
    const runId = runScope.runId;
    runScope.runId = "";
    runScope.active = false;
    runScope.revision += 1;
    setCommand("");
    setKeyboardResponse("");
    setPromptAnswer("");
    if (runId) void invoke("shell_cancel", { run_id: runId }).catch(() => undefined);
    onClose();
  };

  const toggleHostAssociation = (hostId: string) => {
    if (!projectPathKey || !isCurrentScope()) return;
    const current = associatedHostIds.filter((id) => hosts.some((host) => host.id === id));
    onAssociatedHostIdsChange(
      associatedSet.has(hostId) ? current.filter((id) => id !== hostId) : [...current, hostId],
    );
  };

  if (!open) return null;

  if (isApplePresentationRuntime()) {
    const c = presentationControls();
    c.handlers.set("close", { enabled: true, accepts: (value) => value === null, run: close });
    const nodes: PresentationNode[] = selectedHost
      ? [
          {
            ...c.action(
              "back",
              t("chat.mobileSsh.back"),
              () => {
                if (!isCurrentScope()) return;
                setSelectedHostId("");
                setEntries([]);
                setKeyboardResponse("");
              },
              !activeRunId,
            ),
            icon: "chevron.left",
          },
          { id: "endpoint", kind: "Text", text: endpoint(selectedHost) },
          ...(mobile && selectedHost.authType === "keyboardInteractive"
            ? [
                c.input(
                  "challenge",
                  t("settings.sshAuthKeyboardInteractive"),
                  keyboardResponse,
                  (value) => {
                    if (isCurrentScope()) setKeyboardResponse(value);
                  },
                  true,
                ),
              ]
            : []),
          ...entries.map((entry) =>
            c.group(entry.id, `$ ${entry.command}`, [
              ...(
                [
                  ["stdout", entry.response?.stdout],
                  ["stderr", entry.response?.stderr],
                  ["error", entry.error],
                ] as const
              ).flatMap(([stream, text]): PresentationNode[] =>
                text
                  ? [
                      {
                        id: `${entry.id}:${stream}`,
                        kind: "CodeBlock",
                        label: stream,
                        language: "plaintext",
                        text,
                      },
                    ]
                  : [],
              ),
              ...((entry.response?.exitCode ?? entry.response?.exit_code) !== undefined
                ? [
                    {
                      id: `${entry.id}:exit`,
                      kind: "Badge" as const,
                      label: t("chat.mobileTerminal.exitCode").replace(
                        "{code}",
                        String(entry.response?.exitCode ?? entry.response?.exit_code),
                      ),
                      status:
                        (entry.response?.exitCode ?? entry.response?.exit_code) === 0
                          ? ("completed" as const)
                          : ("error" as const),
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
            ]),
          ),
          c.input(
            "command",
            t("chat.mobileSsh.placeholder"),
            command,
            (value) => {
              if (isCurrentScope()) setCommand(value);
            },
            false,
            !activeRunId && !!workdir.trim(),
          ),
          c.action(
            "run",
            t("chat.send"),
            () => run(),
            !!command.trim() &&
              !activeRunId &&
              !!workdir.trim() &&
              (!mobile ||
                selectedHost.authType !== "keyboardInteractive" ||
                !!keyboardResponse.trim()),
          ),
          c.action("cancel", t("chat.stopGeneration"), cancel, !!activeRunId),
          c.action(
            "clear",
            t("chat.mobileTerminal.clear"),
            () => {
              if (isCurrentScope() && !runScope.runId) setEntries([]);
            },
            !activeRunId && entries.length > 0,
          ),
        ]
      : [
          c.action("settings", t("settings.sshAdd"), () => {
            if (isCurrentScope()) onOpenSettings();
          }),
          ...orderedHosts.map((host) =>
            c.group(host.id, host.name, [
              {
                ...c.action(`${host.id}:connect`, endpoint(host), () => {
                  if (isCurrentScope()) setSelectedHostId(host.id);
                }),
                kind: "NavigationRow",
                icon: "server.rack",
              },
              c.toggle(
                `${host.id}:associate`,
                t("chat.workspaceSection"),
                associatedSet.has(host.id),
                () => toggleHostAssociation(host.id),
                !!projectPathKey,
              ),
            ]),
          ),
        ];
    if (sshPrompt) {
      nodes.splice(
        0,
        nodes.length,
        { id: "ssh-prompt-message", kind: "Text", text: sshPrompt.prompt.message },
        ...(sshPrompt.prompt.fingerprintSha256
          ? [
              {
                id: "ssh-fingerprint",
                kind: "Text" as const,
                text: sshPrompt.prompt.fingerprintSha256,
              },
            ]
          : []),
        ...(sshPrompt.prompt.kind === "hostKey"
          ? []
          : [
              c.input(
                "ssh-answer",
                t("settings.sshAuthMethod"),
                promptAnswer,
                (value) => {
                  if (isCurrentScope()) setPromptAnswer(value);
                },
                !sshPrompt.prompt.answerEcho,
              ),
            ]),
        c.action("ssh-confirm", t("settings.confirm"), () => {
          if (!isCurrentScope()) return;
          const response = drafts.current.promptAnswer;
          sshPrompt.answer(
            sshPrompt.prompt.kind === "hostKey" ? { trustHostKey: true } : { answer: response },
          );
        }),
        c.action("ssh-cancel", t("settings.cancel"), cancel),
      );
    }
    if (activeRunId)
      nodes.push({ id: "running", kind: "Progress", label: t("chat.mobileTerminal.running") });
    return (
      <NativeSurface
        document={{
          mode: "sheet",
          title: selectedHost?.name || t("chat.mobileSsh.title"),
          appearance: props.settings?.theme ?? "system",
          formFactor: mobile ? "mobile" : "desktop",
          theme: props.settings
            ? createNativePresentationTheme(props.settings, mobile, "workspaceTools")
            : undefined,
          nodes:
            selectedHost && !sshPrompt
              ? [
                  {
                    id: "mobile-ssh-layout",
                    kind: "TerminalLayout",
                    fill: true,
                    children: [
                      {
                        id: "mobile-terminal-output",
                        kind: "VStack",
                        spacing: 12,
                        children: nodes.filter(
                          (node) =>
                            !["challenge", "command", "run", "cancel", "clear"].includes(node.id),
                        ),
                      },
                      {
                        id: "mobile-terminal-input",
                        kind: "VStack",
                        spacing: 8,
                        children: nodes.filter((node) =>
                          ["challenge", "command", "run", "cancel", "clear"].includes(node.id),
                        ),
                      },
                    ],
                  },
                ]
              : nodes,
          dismissAction: "close",
        }}
        handlers={c.handlers}
        onError={(error) => {
          if (isCurrentScope())
            setEntries((current) => [
              ...current,
              { id: createRunId(), command: "", error: String(error) },
            ]);
        }}
      />
    );
  }

  return (
    <MobileFullscreenPanel
      open
      label={t("chat.mobileSsh.title")}
      onBack={() => {
        if (!selectedHost) return onClose();
        if (activeRunId) return;
        setSelectedHostId("");
        setKeyboardResponse("");
        setEntries([]);
      }}
    >
      <HStack
        as="header"
        gap={2}
        vAlign="center"
        paddingInline={3}
        className="mobile-panel-header min-h-[var(--xgent-mobile-header-height)] shrink-0 bg-[var(--color-background-surface)]"
      >
        {selectedHost ? (
          <IconButton
            label={t("chat.mobileSsh.back")}
            tooltip={t("chat.mobileSsh.back")}
            icon={<ArrowLeft />}
            variant="ghost"
            onClick={() => {
              if (activeRunId) return;
              setSelectedHostId("");
              setKeyboardResponse("");
              setEntries([]);
            }}
            isDisabled={Boolean(activeRunId)}
          />
        ) : (
          <Key />
        )}
        <StackItem size="fill">
          <VStack gap={0}>
            <Heading level={2} maxLines={1}>
              {selectedHost?.name || t("chat.mobileSsh.title")}
            </Heading>
            <Text type="supporting" color="secondary" maxLines={1}>
              {selectedHost ? endpoint(selectedHost) : t("chat.mobileSsh.savedHosts")}
            </Text>
          </VStack>
        </StackItem>
        {!selectedHost ? (
          <IconButton
            label={t("settings.sshTitle")}
            tooltip={t("settings.sshTitle")}
            icon={<Settings2 />}
            variant="ghost"
            onClick={onOpenSettings}
          />
        ) : entries.length > 0 && !activeRunId ? (
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
          onClick={close}
        />
      </HStack>

      {!selectedHost ? (
        <StackItem size="fill" isScrollable>
          <VStack
            gap={3}
            padding={3}
            className="min-h-full overscroll-contain pb-[calc(var(--spacing-4)+env(safe-area-inset-bottom,0px))]"
          >
            {hosts.length === 0 ? (
              <EmptyState
                icon={<Key />}
                title={t("settings.sshNoHosts")}
                description={t("settings.sshNoHostsHint")}
                actions={
                  <Button label={t("settings.sshAdd")} variant="primary" onClick={onOpenSettings} />
                }
              />
            ) : (
              <VStack gap={3}>
                <Banner
                  status="info"
                  icon={<Link2 />}
                  title={t("projectTools.sshConnectionScopeProject")}
                  description={
                    projectPathKey
                      ? t("projectTools.sshConnectionConfiguredHosts").replace(
                          "{count}",
                          String(associatedSet.size),
                        )
                      : t("projectTools.sshConnectionNoProject")
                  }
                  collapsible={false}
                />
                <VStack gap={2}>
                  {orderedHosts.map((host) => {
                    const associated = associatedSet.has(host.id);
                    const associationLabel = associated
                      ? t("chat.mobileSsh.removeAssociation")
                      : t("chat.mobileSsh.associateHost");
                    return (
                      <ClickableCard
                        key={host.id}
                        label={host.name || host.host}
                        onClick={() => setSelectedHostId(host.id)}
                        padding={3}
                        width="100%"
                      >
                        <HStack gap={3} vAlign="center">
                          <Key />
                          <StackItem size="fill">
                            <VStack gap={1}>
                              <HStack gap={2} vAlign="center" wrap="wrap">
                                <Text type="body" weight="medium">
                                  {host.name || host.host}
                                </Text>
                                {associated ? (
                                  <Token
                                    label={t("chat.mobileSsh.associated")}
                                    color="green"
                                    size="sm"
                                  />
                                ) : null}
                              </HStack>
                              <Text type="supporting" color="secondary" maxLines={2}>
                                {endpoint(host)} · {authLabel(host, t)}
                              </Text>
                            </VStack>
                          </StackItem>
                          <Switch
                            label={associationLabel}
                            isLabelHidden
                            value={associated}
                            isDisabled={!projectPathKey}
                            disabledMessage={
                              !projectPathKey ? t("projectTools.sshConnectionNoProject") : undefined
                            }
                            onChange={() => toggleHostAssociation(host.id)}
                            size="md"
                          />
                        </HStack>
                      </ClickableCard>
                    );
                  })}
                </VStack>
              </VStack>
            )}
          </VStack>
        </StackItem>
      ) : (
        <>
          <StackItem size="fill">
            <VStack
              ref={scrollRef}
              gap={4}
              padding={3}
              className="h-full overflow-y-auto overscroll-contain"
            >
              {entries.length === 0 ? (
                <EmptyState
                  icon={<Key />}
                  title={t("chat.mobileSsh.commandMode")}
                  description={
                    selectedHost.authType === "keyboardInteractive"
                      ? t("chat.mobileSsh.keyboardResponseHint")
                      : t("chat.mobileSsh.commandHint")
                  }
                  isCompact
                />
              ) : (
                <VStack gap={4}>
                  {entries.map((entry) => {
                    const response = entry.response;
                    const code = response?.exitCode ?? response?.exit_code;
                    return (
                      <Card key={entry.id} padding={3} width="100%">
                        <VStack gap={3}>
                          <Text type="body" weight="medium">
                            <Code>{`❯ ${entry.command}`}</Code>
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
                          {code !== undefined ? (
                            <Token
                              label={t("chat.mobileTerminal.exitCode").replace(
                                "{code}",
                                String(code),
                              )}
                              color={code === 0 ? "green" : "red"}
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

          {selectedHost.authType === "keyboardInteractive" ? (
            <HStack
              padding={3}
              className="shrink-0 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-primary)]"
            >
              <TextInput
                type="password"
                label={t("chat.mobileSsh.keyboardResponse")}
                value={keyboardResponse}
                onChange={setKeyboardResponse}
                isDisabled={Boolean(activeRunId)}
                placeholder={t("chat.mobileSsh.keyboardResponsePlaceholder")}
                size="lg"
                width="100%"
              />
            </HStack>
          ) : null}
          <HStack
            as="form"
            gap={2}
            vAlign="end"
            padding={3}
            onSubmit={(event) => void run(event)}
            className="shrink-0 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-primary)] pb-[calc(var(--spacing-3)+env(safe-area-inset-bottom,0px))]"
          >
            <StackItem size="fill">
              <TextInput
                label={t("chat.mobileSsh.remoteCommandPlaceholder")}
                isLabelHidden
                value={command}
                onChange={setCommand}
                isDisabled={Boolean(activeRunId)}
                placeholder={t("chat.mobileSsh.remoteCommandPlaceholder")}
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
              isDisabled={
                !activeRunId &&
                (!command.trim() ||
                  (selectedHost.authType === "keyboardInteractive" && !keyboardResponse.trim()))
              }
            />
          </HStack>
        </>
      )}
    </MobileFullscreenPanel>
  );
}
