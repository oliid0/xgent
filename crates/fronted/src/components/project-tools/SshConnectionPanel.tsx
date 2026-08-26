import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button as XdsButton } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { IconButton } from "@astryxdesign/core/IconButton";
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutFooter,
  LayoutHeader,
  StackItem,
  VStack,
} from "@astryxdesign/core/Layout";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { SelectableCard } from "@astryxdesign/core/SelectableCard";
import { Selector } from "@astryxdesign/core/Selector";
import { Spinner } from "@astryxdesign/core/Spinner";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Token } from "@astryxdesign/core/Token";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "../../i18n";
import type { SshHostConfig } from "../../lib/settings";
import { workspaceProjectPathKey } from "../../lib/settings";
import type {
  TerminalClient,
  TerminalSession,
  TerminalSnapshot,
  TerminalSshPrompt,
} from "../../lib/terminal/types";
import {
  ArrowLeft,
  Clock3,
  ConnectionIcon,
  FolderTree,
  Key,
  Server,
  Settings,
  Shield,
  Terminal,
  X,
} from "../icons";
import { useConfirmDialog } from "../ui/confirm-dialog";

type SshConnectionScope = "project" | "all";
type SshConnectionView = "list" | "settings" | "create";

type SshLatencyState = {
  latencyMs?: number;
  loading: boolean;
  failed: boolean;
};

type PendingSshCreate = {
  hostId: string;
  // Set once the create RPC returns a prompt: later prompt answers are tied to
  // this create flow by the prompt id instead of guessing by host.
  promptId: string | null;
};

type SshConnectionPanelProps = {
  active: boolean;
  cwd: string;
  projectPathKey: string;
  hosts: SshHostConfig[];
  associatedHostIds: string[];
  client: TerminalClient;
  sessions: TerminalSession[];
  onSessionSnapshot: (snapshot: TerminalSnapshot) => void;
  onSessionClosed: (sessionId: string) => void;
  onSshSessionsReconcile: (sessions: TerminalSession[]) => void;
  onOpenSession: (session: TerminalSession, kind?: "bash" | "sftp") => void;
  onAssociatedHostIdsChange: (hostIds: string[]) => void;
};

function endpointLabel(host: SshHostConfig) {
  const userPrefix = host.username.trim() ? `${host.username.trim()}@` : "";
  return `${userPrefix}${host.host}:${host.port}`;
}

function authLabel(host: Pick<SshHostConfig, "authType">, t: (key: string) => string) {
  if (host.authType === "privateKey") return t("settings.sshAuthPrivateKey");
  if (host.authType === "keyboardInteractive") return t("settings.sshAuthKeyboardInteractive");
  return t("settings.sshAuthPassword");
}

function hostHasProxy(host: SshHostConfig) {
  return (
    host.proxy.url.trim().length > 0 ||
    host.proxy.port > 0 ||
    host.proxy.username.trim().length > 0 ||
    host.proxy.passwordConfigured === true
  );
}

export function hostSecretReady(host: SshHostConfig) {
  if (host.authType === "keyboardInteractive") return true;
  if (host.authType === "privateKey") {
    return (
      host.privateKey.trim().length > 0 ||
      host.privateKeyPath.trim().length > 0 ||
      host.privateKeyConfigured === true
    );
  }
  return host.password.trim().length > 0 || host.passwordConfigured === true;
}

export function hostStatusMessage(host: SshHostConfig, t: (key: string) => string) {
  if (!hostSecretReady(host)) return t("projectTools.sshConnectionMissingSecret");
  return "";
}

function sessionBelongsToProject(session: TerminalSession, projectPathKey: string) {
  const wantedProjectKey = workspaceProjectPathKey(projectPathKey);
  if (!wantedProjectKey) return false;
  const sessionProjectKey = workspaceProjectPathKey(session.projectPathKey || session.cwd);
  return sessionProjectKey === wantedProjectKey;
}

function sessionTitle(session: TerminalSession, fallback: string) {
  return session.title || session.ssh?.hostName || fallback;
}

function sessionEndpointLabel(session: TerminalSession) {
  const ssh = session.ssh;
  if (!ssh) return session.cwd || session.projectPathKey;
  const userPrefix = ssh.username.trim() ? `${ssh.username.trim()}@` : "";
  return `${userPrefix}${ssh.host}:${ssh.port}`;
}

function sessionProjectLabel(session: TerminalSession) {
  return session.projectPathKey || session.cwd || "";
}

function sshSessionStatus(session: TerminalSession) {
  const status = session.ssh?.status ?? (session.running ? "connected" : "disconnected");
  if (status === "connected" && !session.running) return "disconnected";
  return status;
}

function sshSessionConnected(session: TerminalSession) {
  return sshSessionStatus(session) === "connected" && session.running;
}

function sshStatusLabel(session: TerminalSession, t: (key: string) => string) {
  const status = sshSessionStatus(session);
  if (status === "reconnecting") {
    const attempt = Math.max(1, Number(session.ssh?.reconnectAttempt ?? 1));
    const max = Math.max(attempt, Number(session.ssh?.reconnectMaxAttempts ?? 3));
    return t("projectTools.sshConnectionReconnecting")
      .replace("{attempt}", String(attempt))
      .replace("{max}", String(max));
  }
  if (status === "disconnected") return t("projectTools.sshConnectionDisconnected");
  return t("projectTools.sshConnectionConnected");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isTerminalSessionNotFoundError(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return message.includes("terminal session not found") || message.includes("session not found");
}

function HostMetaTags(props: { host: SshHostConfig }) {
  const { host } = props;
  const { t } = useLocale();
  const tags: string[] = [];
  if (host.authType === "privateKey" && host.privateKeyPath.trim()) {
    tags.push(host.privateKeyPath.trim());
  } else if (host.authType === "privateKey" && host.privateKeyConfigured) {
    tags.push(t("settings.sshPrivateKeyConfigured"));
  }
  if (host.privateKeyPassphraseConfigured) {
    tags.push(t("settings.sshPrivateKeyPassphraseConfigured"));
  }
  if (tags.length === 0) return null;
  return (
    <HStack gap={1.5} wrap="wrap" vAlign="center">
      {tags.map((tag) => (
        <Token key={tag} label={tag} size="sm" />
      ))}
    </HStack>
  );
}

export function SshConnectionPanel(props: SshConnectionPanelProps) {
  const {
    active,
    cwd,
    projectPathKey,
    hosts,
    associatedHostIds,
    client,
    sessions,
    onSessionSnapshot,
    onSessionClosed,
    onSshSessionsReconcile,
    onOpenSession,
    onAssociatedHostIdsChange,
  } = props;
  const { t } = useLocale();
  const { confirm: requestCloseSessionConfirm, dialog: closeSessionConfirmDialog } =
    useConfirmDialog();
  const [scope, setScope] = useState<SshConnectionScope>("project");
  const [view, setView] = useState<SshConnectionView>("list");
  const [createHostId, setCreateHostId] = useState("");
  const [createTitle, setCreateTitle] = useState("");
  const [createSftpEnabled, setCreateSftpEnabled] = useState(false);
  const [creating, setCreating] = useState(false);
  const [closingSessionIds, setClosingSessionIds] = useState<ReadonlySet<string>>(new Set());
  // Create-page failures and list-page failures surface in their own views;
  // a close error must not appear under the create form and vice versa.
  const [createError, setCreateError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<TerminalSshPrompt | null>(null);
  const [promptAnswer, setPromptAnswer] = useState("");
  const [answeringPrompt, setAnsweringPrompt] = useState(false);
  const [latencyBySessionId, setLatencyBySessionId] = useState<Record<string, SshLatencyState>>({});
  const latencyRequestsRef = useRef<Set<string>>(new Set());
  const pendingCreateRef = useRef<PendingSshCreate | null>(null);
  const onSshSessionsReconcileRef = useRef(onSshSessionsReconcile);
  onSshSessionsReconcileRef.current = onSshSessionsReconcile;
  const associatedSet = useMemo(() => new Set(associatedHostIds), [associatedHostIds]);
  const associatedHosts = useMemo(
    () => hosts.filter((host) => associatedSet.has(host.id)),
    [associatedSet, hosts],
  );
  const sshSessions = useMemo(
    () => sessions.filter((session) => session.kind === "ssh" && session.ssh),
    [sessions],
  );
  const projectSshSessions = useMemo(
    () => sshSessions.filter((session) => sessionBelongsToProject(session, projectPathKey)),
    [projectPathKey, sshSessions],
  );
  const visibleSessions = scope === "project" ? projectSshSessions : sshSessions;
  const visibleSessionsRef = useRef(visibleSessions);
  visibleSessionsRef.current = visibleSessions;
  const visibleSessionsKey = useMemo(
    () => visibleSessions.map((session) => session.id).join("\n"),
    [visibleSessions],
  );
  const canCreateInScope = scope === "project";
  const createHosts = canCreateInScope ? associatedHosts : [];
  const hasCreateHosts = createHosts.length > 0;
  const canShowCreateButton = canCreateInScope && hasCreateHosts;
  const selectedCreateHostId = createHosts.some((host) => host.id === createHostId)
    ? createHostId
    : (createHosts[0]?.id ?? "");
  const selectedCreateHost = createHosts.find((host) => host.id === selectedCreateHostId) ?? null;
  const selectedHostMessage = selectedCreateHost ? hostStatusMessage(selectedCreateHost, t) : "";
  const canCreate = Boolean(
    canShowCreateButton && selectedCreateHost && !selectedHostMessage && !creating,
  );
  useEffect(() => {
    if (canShowCreateButton || view !== "create") return;
    setView("list");
  }, [canShowCreateButton, view]);

  // Create/list errors are transient feedback for the visible panel. Clearing
  // on deactivation (not activation) keeps them from greeting the user on a
  // later reopen while still surfacing failures that land while the tab is
  // put away (e.g. an in-flight create that fails after switching tabs).
  useEffect(() => {
    if (active) return;
    setCreateError(null);
    setListError(null);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let inFlight = false;
    const reconcileSshSessions = () => {
      if (inFlight) return;
      inFlight = true;
      void client
        .list()
        .then((nextSessions) => {
          if (cancelled) return;
          onSshSessionsReconcileRef.current(
            nextSessions.filter((session) => session.kind === "ssh" && session.ssh),
          );
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
        });
    };
    reconcileSshSessions();
    const timer = window.setInterval(reconcileSshSessions, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active, client]);

  const refreshSessionLatency = useCallback(
    (session: TerminalSession) => {
      if (!sshSessionConnected(session) || session.kind !== "ssh") return;
      if (latencyRequestsRef.current.has(session.id)) return;
      latencyRequestsRef.current.add(session.id);
      setLatencyBySessionId((current) => ({
        ...current,
        [session.id]: {
          latencyMs: current[session.id]?.latencyMs,
          loading: true,
          failed: false,
        },
      }));
      void client
        .sshLatency(session.id, session.projectPathKey)
        .then((latency) => {
          setLatencyBySessionId((current) => ({
            ...current,
            [session.id]: {
              latencyMs: latency.latencyMs,
              loading: false,
              failed: false,
            },
          }));
        })
        .catch(() => {
          setLatencyBySessionId((current) => ({
            ...current,
            [session.id]: {
              loading: false,
              failed: true,
            },
          }));
        })
        .finally(() => {
          latencyRequestsRef.current.delete(session.id);
        });
    },
    [client],
  );

  useEffect(() => {
    const visibleIds = new Set(visibleSessions.map((session) => session.id));
    setLatencyBySessionId((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([sessionId]) => visibleIds.has(sessionId)),
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [visibleSessions]);

  useEffect(() => {
    // Latency probes only run while the tab is visible. The interval callback
    // reads the latest session list from a ref so reconcile-produced array
    // identities don't rebuild the timer; the id join key only retriggers an
    // immediate refresh when membership actually changes.
    if (!active) return;
    const refreshConnectedLatencies = () => {
      for (const session of visibleSessionsRef.current) {
        if (session.kind === "ssh" && sshSessionConnected(session)) {
          refreshSessionLatency(session);
        }
      }
    };
    refreshConnectedLatencies();
    const timer = window.setInterval(refreshConnectedLatencies, 10_000);
    return () => window.clearInterval(timer);
  }, [active, refreshSessionLatency, visibleSessionsKey]);

  // Ends the create flow's form/pending state only. It deliberately never
  // touches the prompt: while a prompt is open its lifecycle belongs to the
  // prompt handlers (submit/cancel), so a concurrent flow finish can't yank an
  // auth dialog out from under the user.
  const finishCreateFlow = useCallback(() => {
    if (!pendingCreateRef.current) return;
    pendingCreateRef.current = null;
    setCreateTitle("");
    setCreateSftpEnabled(false);
    setCreating(false);
    setCreateError(null);
    setView("list");
  }, []);

  const finishCreatedSnapshot = useCallback(
    (snapshot: TerminalSnapshot) => {
      onSessionSnapshot(snapshot);
      finishCreateFlow();
    },
    [finishCreateFlow, onSessionSnapshot],
  );

  // A failure from a previous create attempt is stale once the form is
  // reopened or retargeted at another host.
  const openCreateView = useCallback(() => {
    setCreateError(null);
    setView("create");
  }, []);

  const selectCreateHost = useCallback((hostId: string) => {
    setCreateHostId(hostId);
    setCreateError(null);
  }, []);

  const toggleHost = (hostId: string) => {
    const current = associatedHostIds.filter((id) => hosts.some((host) => host.id === id));
    const next = associatedSet.has(hostId)
      ? current.filter((id) => id !== hostId)
      : [...current, hostId];
    onAssociatedHostIdsChange(next);
  };

  const handleCreate = useCallback(() => {
    if (!selectedCreateHost || !canCreate) return;
    pendingCreateRef.current = {
      hostId: selectedCreateHost.id,
      promptId: null,
    };
    setCreating(true);
    setCreateError(null);
    void client
      .createSsh({
        cwd,
        projectPathKey,
        hostId: selectedCreateHost.id,
        title: createTitle.trim() || undefined,
        sftpEnabled: createSftpEnabled,
      })
      .then((result) => {
        if (result.prompt) {
          const pending = pendingCreateRef.current;
          if (pending && pending.hostId === selectedCreateHost.id) {
            pendingCreateRef.current = { ...pending, promptId: result.prompt.id };
            setPrompt(result.prompt);
            setPromptAnswer("");
            setView("list");
          } else {
            // The flow this prompt belongs to is gone; don't surface an
            // ownerless auth dialog — release it server-side instead.
            void client.cancelSshPrompt(result.prompt.id).catch(() => undefined);
          }
          return;
        }
        // The create RPC identifies our session directly via the returned
        // snapshot — never by matching "some new session on this host".
        if (result.snapshot) {
          finishCreatedSnapshot(result.snapshot);
        }
      })
      .catch((err) => {
        pendingCreateRef.current = null;
        setCreateError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setCreating(false));
  }, [
    canCreate,
    client,
    createSftpEnabled,
    createTitle,
    cwd,
    finishCreatedSnapshot,
    projectPathKey,
    selectedCreateHost,
  ]);

  const handleSubmitPrompt = useCallback(() => {
    if (!prompt || answeringPrompt) return;
    const hostKeyPrompt = prompt.kind === "hostKey";
    if (!hostKeyPrompt && !promptAnswer.trim()) return;
    setAnsweringPrompt(true);
    setListError(null);
    void client
      .answerSshPrompt({
        promptId: prompt.id,
        answer: hostKeyPrompt ? undefined : promptAnswer,
        trustHostKey: hostKeyPrompt,
      })
      .then((result) => {
        if (result.prompt) {
          const pending = pendingCreateRef.current;
          if (pending) {
            pendingCreateRef.current = { ...pending, promptId: result.prompt.id };
          }
          setPrompt(result.prompt);
          setPromptAnswer("");
          return;
        }
        setPrompt(null);
        setPromptAnswer("");
        if (result.snapshot) {
          finishCreatedSnapshot(result.snapshot);
        }
      })
      .catch((err) => setListError(err instanceof Error ? err.message : String(err)))
      .finally(() => setAnsweringPrompt(false));
  }, [answeringPrompt, client, finishCreatedSnapshot, prompt, promptAnswer]);

  const handleCancelPrompt = useCallback(() => {
    const promptId = prompt?.id;
    pendingCreateRef.current = null;
    setPrompt(null);
    setPromptAnswer("");
    if (!promptId) return;
    void client.cancelSshPrompt(promptId).catch(() => undefined);
  }, [client, prompt]);

  const handleCloseSession = useCallback(
    async (session: TerminalSession) => {
      if (closingSessionIds.has(session.id)) return;
      const title = sessionTitle(session, t("projectTools.sshConnectionTitle"));
      const confirmed = await requestCloseSessionConfirm({
        title: t("projectTools.confirmCloseSshSession"),
        subtitle: t("projectTools.closeSshSessionConfirm").replace("{title}", title),
        detail: sessionEndpointLabel(session),
        confirmLabel: t("projectTools.closeSshSessionContinue"),
        cancelLabel: t("projectTools.closeSshSessionCancel"),
        closeLabel: t("projectTools.closeSshSessionClose"),
        tone: "destructive",
      });
      if (!confirmed) return;
      setClosingSessionIds((current) => new Set(current).add(session.id));
      setListError(null);
      void client
        .close(session.id, session.projectPathKey)
        .then(() => onSessionClosed(session.id))
        .catch((err) => {
          if (isTerminalSessionNotFoundError(err)) {
            onSessionClosed(session.id);
            return;
          }
          setListError(errorMessage(err));
        })
        .finally(() =>
          setClosingSessionIds((current) => {
            if (!current.has(session.id)) return current;
            const next = new Set(current);
            next.delete(session.id);
            return next;
          }),
        );
    },
    [client, closingSessionIds, onSessionClosed, requestCloseSessionConfirm, t],
  );

  const emptyTitle =
    scope === "project"
      ? t("projectTools.sshConnectionProjectEmpty")
      : t("projectTools.sshConnectionAllEmpty");
  const emptyHint =
    scope === "project"
      ? t("projectTools.sshConnectionProjectEmptyHint")
      : t("projectTools.sshConnectionAllEmptyHint");
  const visibleSessionCount = visibleSessions.length;
  const connectedSessionCount = visibleSessions.filter(sshSessionConnected).length;
  const statusText =
    visibleSessionCount > 0
      ? t("projectTools.sshConnectionConnectionCount")
          .replace("{count}", String(visibleSessionCount))
          .replace("{connected}", String(connectedSessionCount))
      : scope === "all"
        ? t("projectTools.sshConnectionAllEmpty")
        : projectPathKey
          ? t("projectTools.sshConnectionProjectEmpty")
          : t("projectTools.sshConnectionNoProject");
  const hostKeyPrompt = prompt?.kind === "hostKey";
  const promptSubmitDisabled =
    answeringPrompt || Boolean(prompt && !hostKeyPrompt && !promptAnswer.trim());
  const latencyText = (session: TerminalSession) => {
    const state = latencyBySessionId[session.id];
    if (state?.failed) return t("projectTools.sshConnectionLatencyUnknown");
    if (state?.latencyMs) {
      return t("projectTools.sshConnectionLatencyValue").replace("{ms}", String(state.latencyMs));
    }
    if (state?.loading) return t("projectTools.sshConnectionLatencyChecking");
    return t("projectTools.sshConnectionLatencyUnknown");
  };

  const backButton = (
    <IconButton
      label={t("projectTools.sshConnectionBack")}
      tooltip={t("projectTools.sshConnectionBack")}
      icon={<ArrowLeft size={16} />}
      variant="ghost"
      size="md"
      onClick={() => setView("list")}
    />
  );

  const settingsPage = (
    <Layout
      height="fill"
      header={
        <LayoutHeader hasDivider label={t("projectTools.sshConnectionAssociateHosts")}>
          <HStack gap={2} vAlign="center">
            {backButton}
            <StackItem size="fill">
              <VStack gap={0.5}>
                <Heading level={4}>{t("projectTools.sshConnectionAssociateHosts")}</Heading>
                <Text type="supporting" color="secondary" maxLines={1}>
                  {t("projectTools.sshConnectionAssociateHostsHint")}
                </Text>
              </VStack>
            </StackItem>
            <HStack gap={1} vAlign="center">
              <Badge label={String(associatedHosts.length)} />
              <Text type="supporting" color="secondary" maxLines={1}>
                {t("projectTools.sshConnectionAssociatedCount")}
              </Text>
            </HStack>
          </HStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent padding={3}>
          {hosts.length === 0 ? (
            <EmptyState
              icon={<Key size={24} />}
              title={t("projectTools.sshConnectionNoConfiguredHosts")}
              description={t("projectTools.sshConnectionNoConfiguredHostsHint")}
              isCompact
            />
          ) : (
            <VStack gap={2}>
              {hosts.map((host) => {
                const selected = associatedSet.has(host.id);
                return (
                  <SelectableCard
                    key={host.id}
                    label={host.name}
                    isSelected={selected}
                    onChange={() => toggleHost(host.id)}
                    width="100%"
                    padding={3}
                  >
                    <HStack gap={3} vAlign="start">
                      <Server size={20} />
                      <StackItem size="fill">
                        <VStack gap={1}>
                          <HStack gap={1.5} wrap="wrap" vAlign="center">
                            <Text type="label" maxLines={1}>
                              {host.name}
                            </Text>
                            <Token label={authLabel(host, t)} size="sm" />
                            {hostHasProxy(host) ? (
                              <Token label={t("settings.sshAdvancedProxy")} size="sm" />
                            ) : null}
                          </HStack>
                          <Text type="code" color="secondary" maxLines={1}>
                            {endpointLabel(host)}
                          </Text>
                          <HostMetaTags host={host} />
                        </VStack>
                      </StackItem>
                    </HStack>
                  </SelectableCard>
                );
              })}
            </VStack>
          )}
        </LayoutContent>
      }
    />
  );

  const createPage = (
    <Layout
      height="fill"
      header={
        <LayoutHeader hasDivider label={t("projectTools.sshConnectionCreateTitle")}>
          <HStack gap={2} vAlign="center">
            {backButton}
            <StackItem size="fill">
              <VStack gap={0.5}>
                <Heading level={4}>{t("projectTools.sshConnectionCreateTitle")}</Heading>
                <Text type="supporting" color="secondary" maxLines={1}>
                  {t("projectTools.sshConnectionCreateHint")}
                </Text>
              </VStack>
            </StackItem>
          </HStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent padding={3}>
          {createHosts.length === 0 ? (
            <EmptyState
              icon={<Key size={24} />}
              title={
                hosts.length === 0
                  ? t("projectTools.sshConnectionNoConfiguredHosts")
                  : t("projectTools.sshConnectionCreateNoAssociatedHosts")
              }
              description={
                hosts.length === 0
                  ? t("projectTools.sshConnectionNoConfiguredHostsHint")
                  : t("projectTools.sshConnectionCreateNoAssociatedHostsHint")
              }
              actions={
                hosts.length > 0 ? (
                  <XdsButton
                    label={t("projectTools.sshConnectionAssociateHosts")}
                    variant="secondary"
                    size="sm"
                    onClick={() => setView("settings")}
                  />
                ) : undefined
              }
              isCompact
            />
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                handleCreate();
              }}
            >
              <VStack gap={4}>
                <FormLayout>
                  <Selector
                    label={t("projectTools.sshConnectionHost")}
                    value={selectedCreateHostId}
                    onChange={selectCreateHost}
                    options={createHosts.map((host) => ({
                      value: host.id,
                      label: host.name,
                      description: endpointLabel(host) + " · " + authLabel(host, t),
                    }))}
                    startIcon={<Server size={16} />}
                    width="100%"
                    size="lg"
                  />
                  <TextInput
                    label={t("projectTools.sshConnectionTabTitle")}
                    value={createTitle}
                    onChange={setCreateTitle}
                    placeholder={
                      selectedCreateHost?.name || t("projectTools.sshConnectionTabTitlePlaceholder")
                    }
                    width="100%"
                    size="lg"
                  />
                  <CheckboxInput
                    label={t("projectTools.sshConnectionSftpEnabled")}
                    value={createSftpEnabled}
                    onChange={setCreateSftpEnabled}
                    size="sm"
                  />
                </FormLayout>

                {selectedCreateHost ? (
                  <VStack gap={2}>
                    <HStack gap={2} vAlign="center">
                      <Server size={18} />
                      <StackItem size="fill">
                        <VStack gap={0.5}>
                          <Text type="label" maxLines={1}>
                            {selectedCreateHost.name}
                          </Text>
                          <Text type="code" color="secondary" maxLines={1}>
                            {endpointLabel(selectedCreateHost)}
                          </Text>
                        </VStack>
                      </StackItem>
                      <Token label={authLabel(selectedCreateHost, t)} size="sm" />
                    </HStack>
                    {selectedHostMessage ? (
                      <Banner status="error" title={selectedHostMessage} />
                    ) : null}
                  </VStack>
                ) : null}

                {createError ? <Banner status="error" title={createError} /> : null}

                <HStack gap={2} hAlign="end" wrap="wrap">
                  <XdsButton
                    label={t("projectTools.sshConnectionCreateCancel")}
                    variant="ghost"
                    size="sm"
                    onClick={() => setView("list")}
                  />
                  <XdsButton
                    type="submit"
                    label={
                      creating
                        ? t("projectTools.sshConnectionConnecting")
                        : t("projectTools.sshConnectionConnect")
                    }
                    size="sm"
                    isDisabled={!canCreate}
                    isLoading={creating}
                  />
                </HStack>
              </VStack>
            </form>
          )}
        </LayoutContent>
      }
    />
  );

  const hasEmptyActions =
    canShowCreateButton || (scope === "project" && associatedHosts.length === 0);

  const listPage = (
    <Layout
      height="fill"
      header={
        <LayoutHeader hasDivider label={t("projectTools.sshConnectionTitle")}>
          <VStack gap={3}>
            <HStack gap={2} vAlign="center">
              <Key size={20} />
              <StackItem size="fill">
                <VStack gap={0.5}>
                  <Heading level={4}>{t("projectTools.sshConnectionTitle")}</Heading>
                  <Text type="supporting" color="secondary" maxLines={1}>
                    {statusText}
                  </Text>
                </VStack>
              </StackItem>
              {canShowCreateButton ? (
                <IconButton
                  label={t("projectTools.newSshConnection")}
                  tooltip={t("projectTools.newSshConnection")}
                  icon={<ConnectionIcon height="1em" />}
                  variant="ghost"
                  size="md"
                  onClick={openCreateView}
                />
              ) : null}
              {scope === "project" ? (
                <IconButton
                  label={t("projectTools.sshConnectionSettings")}
                  tooltip={t("projectTools.sshConnectionSettings")}
                  icon={<Settings size={16} />}
                  variant="ghost"
                  size="md"
                  onClick={() => setView("settings")}
                />
              ) : null}
            </HStack>
            <SegmentedControl
              value={scope}
              onChange={(value) => setScope(value as SshConnectionScope)}
              label={t("projectTools.sshConnectionScopeGroup")}
              layout="fill"
              size="sm"
            >
              <SegmentedControlItem
                value="project"
                label={t("projectTools.sshConnectionScopeProject")}
              />
              <SegmentedControlItem value="all" label={t("projectTools.sshConnectionScopeAll")} />
            </SegmentedControl>
          </VStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent padding={3}>
          <VStack gap={3} minHeight="100%">
            {listError ? <Banner status="error" title={listError} /> : null}
            {visibleSessionCount === 0 ? (
              <EmptyState
                icon={<Key size={24} />}
                title={emptyTitle}
                description={emptyHint}
                actions={
                  hasEmptyActions ? (
                    <>
                      {canShowCreateButton ? (
                        <XdsButton
                          label={t("projectTools.newSshConnection")}
                          variant="primary"
                          size="sm"
                          onClick={openCreateView}
                        />
                      ) : null}
                      {scope === "project" && associatedHosts.length === 0 ? (
                        <XdsButton
                          label={t("projectTools.sshConnectionAssociateHosts")}
                          variant="secondary"
                          size="sm"
                          onClick={() => setView("settings")}
                        />
                      ) : null}
                    </>
                  ) : undefined
                }
                isCompact
              />
            ) : (
              <VStack gap={2}>
                {visibleSessions.map((session) => {
                  const title = sessionTitle(session, t("projectTools.sshConnectionTitle"));
                  const endpoint = sessionEndpointLabel(session);
                  const projectLabel = sessionProjectLabel(session);
                  const closing = closingSessionIds.has(session.id);
                  const sshStatus = sshSessionStatus(session);
                  const connected = sshSessionConnected(session);
                  const latency = latencyBySessionId[session.id];
                  const statusVariant =
                    sshStatus === "disconnected"
                      ? "error"
                      : sshStatus === "reconnecting"
                        ? "warning"
                        : "success";
                  const statusLabel = sshStatusLabel(session, t);
                  return (
                    <Card key={session.id} width="100%" padding={3} elevation="low">
                      <VStack gap={3}>
                        <HStack gap={3} vAlign="start">
                          <Server size={20} />
                          <StackItem size="fill">
                            <VStack gap={1}>
                              <HStack gap={1.5} wrap="wrap" vAlign="center">
                                <Text type="label" maxLines={1}>
                                  {title}
                                </Text>
                                <HStack gap={1} vAlign="center">
                                  <StatusDot
                                    variant={statusVariant}
                                    label={statusLabel}
                                    isPulsing={sshStatus === "reconnecting"}
                                  />
                                  <Text type="supporting" color="secondary">
                                    {statusLabel}
                                  </Text>
                                </HStack>
                              </HStack>
                              <Text type="code" color="secondary" maxLines={1}>
                                {endpoint}
                              </Text>
                              {scope === "all" && projectLabel ? (
                                <Text type="supporting" color="secondary" maxLines={1}>
                                  {projectLabel}
                                </Text>
                              ) : null}
                            </VStack>
                          </StackItem>
                        </HStack>
                        <HStack gap={2} hAlign="between" vAlign="center" wrap="wrap">
                          <Token
                            label={latencyText(session)}
                            size="sm"
                            icon={
                              latency?.loading && !latency.latencyMs ? (
                                <Spinner size="sm" aria-label={latencyText(session)} />
                              ) : (
                                <Clock3 size={12} />
                              )
                            }
                          />
                          <HStack gap={1} vAlign="center">
                            <IconButton
                              label={t("projectTools.sshConnectionOpenBash")}
                              tooltip={t("projectTools.sshConnectionOpenBash")}
                              icon={<Terminal size={16} />}
                              variant="ghost"
                              size="md"
                              isDisabled={!connected}
                              onClick={() => onOpenSession(session, "bash")}
                            />
                            {session.ssh?.sftpEnabled ? (
                              <IconButton
                                label={t("projectTools.sshConnectionOpenSftp")}
                                tooltip={t("projectTools.sshConnectionOpenSftp")}
                                icon={<FolderTree size={16} />}
                                variant="ghost"
                                size="md"
                                isDisabled={!connected}
                                onClick={() => onOpenSession(session, "sftp")}
                              />
                            ) : null}
                            <IconButton
                              label={t("projectTools.sshConnectionCloseSession")}
                              tooltip={t("projectTools.sshConnectionCloseSession")}
                              icon={<X size={16} />}
                              variant="ghost"
                              size="md"
                              isLoading={closing}
                              isDisabled={closing}
                              onClick={() => handleCloseSession(session)}
                            />
                          </HStack>
                        </HStack>
                      </VStack>
                    </Card>
                  );
                })}
              </VStack>
            )}
          </VStack>
        </LayoutContent>
      }
    />
  );

  return (
    <>
      {view === "settings" ? settingsPage : view === "create" ? createPage : listPage}
      {prompt ? (
        <Dialog
          isOpen
          onOpenChange={(isOpen) => {
            if (!isOpen) handleCancelPrompt();
          }}
          purpose="form"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              handleSubmitPrompt();
            }}
          >
            <Layout
              header={
                <DialogHeader
                  title={
                    hostKeyPrompt
                      ? t("projectTools.sshConnectionPromptTitle")
                      : t("projectTools.sshConnectionAuthPromptTitle")
                  }
                  subtitle={prompt.message}
                  startContent={<Shield size={18} />}
                  onOpenChange={() => handleCancelPrompt()}
                />
              }
              content={
                <LayoutContent>
                  <VStack gap={4}>
                    <MetadataList>
                      <MetadataListItem label={t("projectTools.sshConnectionHost")}>
                        <Text type="code" wordBreak="break-word">
                          {prompt.host}:{prompt.port}
                        </Text>
                      </MetadataListItem>
                      {prompt.keyType ? (
                        <MetadataListItem label={t("projectTools.sshConnectionKeyType")}>
                          <Text type="code" wordBreak="break-word">
                            {prompt.keyType}
                          </Text>
                        </MetadataListItem>
                      ) : null}
                      {prompt.fingerprintSha256 ? (
                        <MetadataListItem label={t("projectTools.sshConnectionFingerprint")}>
                          <Text type="code" wordBreak="break-all">
                            {prompt.fingerprintSha256}
                          </Text>
                        </MetadataListItem>
                      ) : null}
                    </MetadataList>
                    {!hostKeyPrompt ? (
                      <TextInput
                        label={t("projectTools.sshConnectionAuthPromptTitle")}
                        isLabelHidden
                        value={promptAnswer}
                        onChange={setPromptAnswer}
                        type={prompt.answerEcho ? "text" : "password"}
                        hasAutoFocus
                        width="100%"
                        size="lg"
                      />
                    ) : null}
                  </VStack>
                </LayoutContent>
              }
              footer={
                <LayoutFooter hasDivider>
                  <HStack gap={2} hAlign="end" wrap="wrap">
                    <XdsButton
                      label={
                        hostKeyPrompt
                          ? t("projectTools.sshConnectionRejectHost")
                          : t("projectTools.sshConnectionPromptCancel")
                      }
                      variant="ghost"
                      size="sm"
                      onClick={handleCancelPrompt}
                      isDisabled={answeringPrompt}
                    />
                    <XdsButton
                      type="submit"
                      label={
                        hostKeyPrompt
                          ? t("projectTools.sshConnectionTrustHost")
                          : t("projectTools.sshConnectionPromptSubmit")
                      }
                      size="sm"
                      isDisabled={promptSubmitDisabled}
                      isLoading={answeringPrompt}
                    />
                  </HStack>
                </LayoutFooter>
              }
            />
          </form>
        </Dialog>
      ) : null}
      {closeSessionConfirmDialog}
    </>
  );
}
