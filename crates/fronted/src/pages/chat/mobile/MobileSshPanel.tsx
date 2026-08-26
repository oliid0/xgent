import { invoke } from "@xagent/runtime";
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
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
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
import type { SshHostConfig } from "../../../lib/settings";
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
  const [command, setCommand] = useState("");
  const [keyboardResponse, setKeyboardResponse] = useState("");
  const [entries, setEntries] = useState<SshCommandEntry[]>([]);
  const [activeRunId, setActiveRunId] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectedHost = useMemo(
    () => hosts.find((host) => host.id === selectedHostId) ?? null,
    [hosts, selectedHostId],
  );
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
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [activeRunId, entries]);

  const run = async (event: FormEvent) => {
    event.preventDefault();
    const remoteCommand = command.trim();
    if (
      !selectedHost ||
      !remoteCommand ||
      activeRunId ||
      !workdir.trim() ||
      (selectedHost.authType === "keyboardInteractive" && !keyboardResponse.trim())
    )
      return;
    const id = createRunId();
    setCommand("");
    setActiveRunId(id);
    setEntries((current) => [...current, { id, command: remoteCommand }]);
    try {
      const response = await invoke<ShellRunResponse>("mobile_ssh_exec", {
        host_id: selectedHost.id,
        workdir,
        remote_command: remoteCommand,
        keyboard_response:
          selectedHost.authType === "keyboardInteractive" ? keyboardResponse : null,
        timeout_ms: 300_000,
        run_id: id,
      });
      setEntries((current) =>
        current.map((entry) => (entry.id === id ? { ...entry, response } : entry)),
      );
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      setEntries((current) =>
        current.map((entry) => (entry.id === id ? { ...entry, error } : entry)),
      );
    } finally {
      setActiveRunId("");
    }
  };

  const cancel = async () => {
    if (!activeRunId) return;
    await invoke("shell_cancel", { run_id: activeRunId }).catch(() => undefined);
  };

  const close = () => {
    if (activeRunId) void invoke("shell_cancel", { run_id: activeRunId }).catch(() => undefined);
    onClose();
  };

  const toggleHostAssociation = (hostId: string) => {
    if (!projectPathKey) return;
    const current = associatedHostIds.filter((id) => hosts.some((host) => host.id === id));
    onAssociatedHostIdsChange(
      associatedSet.has(hostId) ? current.filter((id) => id !== hostId) : [...current, hostId],
    );
  };

  if (!open) return null;

  return (
    <MobileFullscreenPanel open label={t("chat.mobileSsh.title")}>
      <HStack
        as="header"
        gap={2}
        vAlign="center"
        paddingInline={3}
        className="mobile-panel-header min-h-[var(--xagent-mobile-header-height)] shrink-0 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-primary)]/90 backdrop-blur-xl"
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
                            <Spinner accessibleLabel={t("chat.mobileTerminal.running")} size="sm" />
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
                            maxHeight="var(--xagent-terminal-output-max-height)"
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
                            maxHeight="var(--xagent-terminal-output-max-height)"
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
                            maxHeight="var(--xagent-terminal-output-max-height)"
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
