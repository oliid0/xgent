import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button as AstryxCoreButton } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { DialogHeader } from "@astryxdesign/core/Dialog";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { FileInput } from "@astryxdesign/core/FileInput";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Icon as AstryxIcon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutFooter,
  Section,
  VStack,
} from "@astryxdesign/core/Layout";
import { List as AstryxList, ListItem } from "@astryxdesign/core/List";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { RadioList, RadioListItem } from "@astryxdesign/core/RadioList";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Spinner } from "@astryxdesign/core/Spinner";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { invoke, isBrowserRuntime } from "@xagent/runtime";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Key,
  Lock,
  Pencil,
  Plus,
  Server,
  Shield,
  Terminal,
  Trash2,
  Upload,
} from "../../components/icons";
import { useLocale } from "../../i18n";
import {
  removeSshHostFromProjectAssociations,
  type SshAuthType,
  type SshHostConfig,
  type SshProxyType,
  updateSsh,
} from "../../lib/settings";
import { createUuid } from "../../lib/shared/id";
import {
  type SshImportCandidate,
  type SshScanResult,
  scanSshImportCandidates,
} from "../../lib/ssh/scan";
import { SettingsModalShell } from "./SettingsModalShell";
import { ConfirmActionPopover, ConfirmDeletePopover } from "./shared";
import type { SettingsSectionProps } from "./types";

type SshHostDraft = Omit<SshHostConfig, "id">;
type SshKnownHostResetStatus = {
  hostId: string;
  kind: "success" | "info" | "error";
  message: string;
};

type SshKnownHostResetResponse = {
  deleted: number;
};

function authLabel(host: Pick<SshHostConfig, "authType">, t: (key: string) => string) {
  if (host.authType === "privateKey") return t("settings.sshAuthPrivateKey");
  if (host.authType === "keyboardInteractive") return t("settings.sshAuthKeyboardInteractive");
  return t("settings.sshAuthPassword");
}

function SshPasswordInput(props: {
  label: string;
  value: string;
  disabled?: boolean;
  configuredMessage?: string;
  onChange: (value: string) => void;
}) {
  const { label, value, disabled = false, configuredMessage, onChange } = props;

  return (
    <VStack gap={1}>
      <TextInput
        label={label}
        type="password"
        value={value}
        isDisabled={disabled}
        width="100%"
        onChange={onChange}
      />
      {configuredMessage && !value.trim() ? (
        <Text type="supporting" color="secondary">
          {configuredMessage}
        </Text>
      ) : null}
    </VStack>
  );
}

function SshHostModal(props: {
  initialData?: SshHostConfig;
  onSave: (data: SshHostDraft) => void;
  onClose: () => void;
}) {
  const browser = isBrowserRuntime();
  const { initialData, onSave, onClose } = props;
  const { t } = useLocale();
  const [name, setName] = useState(initialData?.name ?? "");
  const [host, setHost] = useState(initialData?.host ?? "");
  const [port, setPort] = useState(initialData?.port ?? 22);
  const [username, setUsername] = useState(initialData?.username ?? "");
  const [authType, setAuthType] = useState<SshAuthType>(initialData?.authType ?? "password");
  const [password, setPassword] = useState(initialData?.password ?? "");
  const [privateKey, setPrivateKey] = useState(initialData?.privateKey ?? "");
  const [privateKeyPath, setPrivateKeyPath] = useState(initialData?.privateKeyPath ?? "");
  const [privateKeyPassphrase, setPrivateKeyPassphrase] = useState(
    initialData?.privateKeyPassphrase ?? "",
  );
  const [selectedKeyFile, setSelectedKeyFile] = useState<File | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [proxyType, setProxyType] = useState<SshProxyType>(initialData?.proxy.type ?? "socks5");
  const [proxyUrl, setProxyUrl] = useState(initialData?.proxy.url ?? "");
  const [proxyPort, setProxyPort] = useState<number | null>(initialData?.proxy.port || null);
  const [proxyUsername, setProxyUsername] = useState(initialData?.proxy.username ?? "");
  const [proxyPassword, setProxyPassword] = useState(initialData?.proxy.password ?? "");
  const isEditing = Boolean(initialData);
  const isPasswordAuth = authType === "password";
  const isPrivateKeyAuth = authType === "privateKey";
  const isKeyboardInteractiveAuth = authType === "keyboardInteractive";

  function handleFileSelected(file: File | null) {
    setSelectedKeyFile(file);
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === "string" ? reader.result : "";
      setPrivateKey(content.trim());
      setPrivateKeyPath(file.name);
      setAuthType("privateKey");
    };
    reader.readAsText(file);
  }

  function handleSave() {
    const trimmedName = name.trim();
    const trimmedHost = host.trim();
    if (!trimmedName || !trimmedHost) return;
    const trimmedPassword = password.trim();
    const trimmedPrivateKey = privateKey.trim();
    const trimmedPrivateKeyPath = privateKeyPath.trim();
    const trimmedPrivateKeyPassphrase = privateKeyPassphrase.trim();
    const trimmedProxyPassword = proxyPassword.trim();
    const nextPassword = isPasswordAuth ? trimmedPassword : "";
    const nextPrivateKey = isPrivateKeyAuth ? trimmedPrivateKey : "";
    const nextPrivateKeyPath = isPrivateKeyAuth ? trimmedPrivateKeyPath : "";
    const nextPrivateKeyPassphrase = isPrivateKeyAuth ? trimmedPrivateKeyPassphrase : "";

    onSave({
      name: trimmedName,
      description: initialData?.description ?? "",
      host: trimmedHost,
      port,
      username: username.trim(),
      authType,
      password: nextPassword,
      passwordConfigured:
        isPasswordAuth &&
        (nextPassword.length > 0 ||
          (initialData?.authType === "password" && initialData?.passwordConfigured === true)),
      privateKey: nextPrivateKey,
      privateKeyPath: nextPrivateKeyPath,
      privateKeyConfigured:
        isPrivateKeyAuth &&
        (nextPrivateKey.length > 0 ||
          nextPrivateKeyPath.length > 0 ||
          (initialData?.authType === "privateKey" && initialData?.privateKeyConfigured === true)),
      privateKeyPassphrase: nextPrivateKeyPassphrase,
      privateKeyPassphraseConfigured:
        isPrivateKeyAuth &&
        (nextPrivateKeyPassphrase.length > 0 ||
          (initialData?.authType === "privateKey" &&
            initialData?.privateKeyPassphraseConfigured === true)),
      proxy: {
        type: proxyType,
        url: proxyUrl.trim(),
        port: proxyPort ?? 0,
        username: proxyUsername.trim(),
        password: trimmedProxyPassword,
        passwordConfigured:
          trimmedProxyPassword.length > 0 || initialData?.proxy.passwordConfigured === true,
      },
    });
    onClose();
  }

  return (
    <SettingsModalShell onClose={onClose} purpose="form" ariaLabel={t("settings.sshAdd")}>
      <Layout
        height="fill"
        header={
          <DialogHeader
            title={isEditing ? t("settings.sshEdit") : t("settings.sshAdd")}
            subtitle={t("settings.sshDesc")}
            startContent={
              <IconButton
                label={t("settings.cancel")}
                tooltip={t("settings.cancel")}
                variant="ghost"
                size="sm"
                icon={<ArrowLeft aria-hidden="true" />}
                onClick={onClose}
              />
            }
          />
        }
        content={
          <LayoutContent isScrollable>
            <VStack gap={5}>
              <FormLayout>
                <FormLayout direction="horizontal">
                  <TextInput
                    label={t("settings.sshName")}
                    value={name}
                    isRequired
                    onChange={setName}
                  />
                  <TextInput
                    label={t("settings.sshHost")}
                    value={host}
                    isRequired
                    onChange={setHost}
                  />
                </FormLayout>
                <FormLayout direction="horizontal">
                  <TextInput
                    label={t("settings.sshUsername")}
                    value={username}
                    onChange={setUsername}
                  />
                  <NumberInput
                    label={t("settings.sshPort")}
                    value={port}
                    min={1}
                    max={65535}
                    step={1}
                    isIntegerOnly
                    isWheelEnabled={false}
                    onChange={setPort}
                  />
                </FormLayout>
              </FormLayout>

              <RadioList
                label={t("settings.sshAuthMethod")}
                value={authType}
                orientation="vertical"
                onChange={(value) => {
                  if (
                    value === "password" ||
                    value === "privateKey" ||
                    value === "keyboardInteractive"
                  ) {
                    setAuthType(value);
                  }
                }}
              >
                <RadioListItem
                  value="password"
                  label={t("settings.sshAuthPassword")}
                  description={t("settings.sshAuthPasswordHint")}
                  startContent={<Lock aria-hidden="true" />}
                />
                <RadioListItem
                  value="privateKey"
                  label={t("settings.sshAuthPrivateKey")}
                  description={t("settings.sshAuthPrivateKeyHint")}
                  startContent={<Key aria-hidden="true" />}
                />
                <RadioListItem
                  value="keyboardInteractive"
                  label={t("settings.sshAuthKeyboardInteractive")}
                  description={t("settings.sshAuthKeyboardInteractiveHint")}
                  startContent={<Terminal aria-hidden="true" />}
                />
              </RadioList>

              {isPasswordAuth ? (
                <SshPasswordInput
                  label={t("settings.sshPassword")}
                  value={password}
                  disabled={browser}
                  configuredMessage={
                    initialData?.passwordConfigured
                      ? t("settings.sshPasswordConfigured")
                      : undefined
                  }
                  onChange={setPassword}
                />
              ) : null}

              {isPrivateKeyAuth ? (
                <FormLayout>
                  <FileInput
                    label={t("settings.sshPrivateKeyImport")}
                    description={t("settings.sshAuthPrivateKeyHint")}
                    value={selectedKeyFile}
                    accept=".pem,.key,.ppk,text/plain"
                    mode="input"
                    isDisabled={browser}
                    onChange={(file) => {
                      if (Array.isArray(file)) return;
                      handleFileSelected(file);
                    }}
                  />
                  <TextArea
                    label={t("settings.sshPrivateKey")}
                    value={privateKey}
                    rows={9}
                    hasSpellCheck={false}
                    isDisabled={browser}
                    onChange={setPrivateKey}
                  />
                  {initialData?.privateKeyConfigured && !privateKey.trim() ? (
                    <Text type="supporting" color="secondary">
                      {t("settings.sshPrivateKeyConfigured")}
                    </Text>
                  ) : null}
                  <SshPasswordInput
                    label={t("settings.sshPrivateKeyPassphrase")}
                    value={privateKeyPassphrase}
                    disabled={browser}
                    configuredMessage={
                      initialData?.privateKeyPassphraseConfigured
                        ? t("settings.sshPrivateKeyPassphraseConfigured")
                        : undefined
                    }
                    onChange={setPrivateKeyPassphrase}
                  />
                </FormLayout>
              ) : null}

              {isKeyboardInteractiveAuth ? (
                <Banner
                  status="info"
                  title={t("settings.sshAuthKeyboardInteractive")}
                  description={t("settings.sshAuthKeyboardInteractiveHint")}
                />
              ) : null}

              <Collapsible
                trigger={t("settings.sshAdvancedSettings")}
                isOpen={advancedOpen}
                onOpenChange={setAdvancedOpen}
              >
                <FormLayout>
                  <VStack gap={2}>
                    <Text type="body" weight="semibold">
                      {t("settings.sshProxyType")}
                    </Text>
                    <SegmentedControl
                      label={t("settings.sshProxyType")}
                      value={proxyType}
                      layout="fill"
                      onChange={(value) => {
                        if (value === "socks5" || value === "http") setProxyType(value);
                      }}
                    >
                      <SegmentedControlItem
                        value="socks5"
                        label={t("settings.sshProxyTypeSocks5")}
                      />
                      <SegmentedControlItem value="http" label={t("settings.sshProxyTypeHttp")} />
                    </SegmentedControl>
                  </VStack>
                  <FormLayout direction="horizontal">
                    <TextInput
                      label={t("settings.sshProxyUrl")}
                      value={proxyUrl}
                      placeholder={t(
                        proxyType === "socks5"
                          ? "settings.sshProxyUrlSocks5Placeholder"
                          : "settings.sshProxyUrlHttpPlaceholder",
                      )}
                      onChange={setProxyUrl}
                    />
                    <NumberInput
                      label={t("settings.sshProxyPort")}
                      value={proxyPort}
                      min={1}
                      max={65535}
                      step={1}
                      hasClear
                      isIntegerOnly
                      isWheelEnabled={false}
                      onChange={(value) => setProxyPort(value ?? null)}
                    />
                  </FormLayout>
                  <FormLayout direction="horizontal">
                    <TextInput
                      label={t("settings.sshProxyUsername")}
                      value={proxyUsername}
                      onChange={setProxyUsername}
                    />
                    <SshPasswordInput
                      label={t("settings.sshProxyPassword")}
                      value={proxyPassword}
                      disabled={browser}
                      configuredMessage={
                        initialData?.proxy.passwordConfigured
                          ? t("settings.sshProxyPasswordConfigured")
                          : undefined
                      }
                      onChange={setProxyPassword}
                    />
                  </FormLayout>
                </FormLayout>
              </Collapsible>
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <HStack gap={2} hAlign="end">
              <AstryxCoreButton
                label={t("settings.cancel")}
                variant="secondary"
                onClick={onClose}
              />
              <AstryxCoreButton
                label={t("settings.save")}
                variant="primary"
                isDisabled={!name.trim() || !host.trim()}
                onClick={handleSave}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </SettingsModalShell>
  );
}

function SshImportCandidateRow(props: {
  candidate: SshImportCandidate;
  selected: boolean;
  onChange: () => void;
}) {
  const { candidate, selected, onChange } = props;
  const { t } = useLocale();
  const checkboxRef = useRef<HTMLInputElement>(null);
  const connection = `${candidate.username ? `${candidate.username}@` : ""}${candidate.host}:${candidate.port}`;

  return (
    <ListItem
      label={candidate.name}
      description={
        <VStack gap={1}>
          <Text type="supporting" color="secondary">
            {connection}
          </Text>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Text type="supporting" color="secondary">
              {authLabel(candidate, t)}
            </Text>
            {candidate.duplicate ? (
              <StatusDot
                variant="warning"
                label={t("settings.sshImportDuplicate")}
                tooltip={t("settings.sshImportDuplicate")}
              />
            ) : null}
          </HStack>
        </VStack>
      }
      startContent={
        <CheckboxInput
          ref={checkboxRef}
          label={candidate.name}
          isLabelHidden
          value={selected}
          size="sm"
          isDisabled={candidate.duplicate}
          disabledMessage={candidate.duplicate ? t("settings.sshImportDuplicate") : undefined}
          onChange={onChange}
        />
      }
      interactiveRef={checkboxRef}
      isDisabled={candidate.duplicate}
    />
  );
}

function SshImportModal(props: {
  existingHosts: SshHostConfig[];
  onImport: (hosts: SshImportCandidate[]) => void;
  onClose: () => void;
}) {
  const { existingHosts, onImport, onClose } = props;
  const { t } = useLocale();
  const [result, setResult] = useState<SshScanResult | null>(null);
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError("");
    scanSshImportCandidates(existingHosts)
      .then((scanResult) => {
        if (cancelled) return;
        setResult(scanResult);
        setSelectedIds(
          new Set(scanResult.candidates.filter((item) => !item.duplicate).map((item) => item.id)),
        );
      })
      .catch((scanError) => {
        if (cancelled) return;
        setError(scanError instanceof Error ? scanError.message : String(scanError));
      });
    return () => {
      cancelled = true;
    };
  }, [existingHosts]);

  const candidates = result?.candidates ?? [];
  const selected = candidates.filter((candidate) => selectedIds.has(candidate.id));

  function toggle(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <SettingsModalShell onClose={onClose} ariaLabel={t("settings.sshImport")}>
      <Layout
        height="fill"
        header={
          <DialogHeader
            title={t("settings.sshImport")}
            subtitle={t("settings.sshImportDesc")}
            startContent={
              <IconButton
                label={t("settings.cancel")}
                tooltip={t("settings.cancel")}
                variant="ghost"
                size="sm"
                icon={<AstryxIcon icon={ArrowLeft} size="sm" color="inherit" />}
                onClick={onClose}
              />
            }
          />
        }
        content={
          <LayoutContent padding={5} isScrollable>
            <VStack gap={4}>
              {!result && !error ? (
                <VStack minHeight="var(--spacing-32)" hAlign="center" vAlign="center" gap={2}>
                  <Spinner size="sm" aria-label={t("settings.sshImportScanning")} />
                  <Text color="secondary">{t("settings.sshImportScanning")}</Text>
                </VStack>
              ) : null}

              {error ? (
                <Banner
                  status="error"
                  title={t("settings.sshImportFailed")}
                  description={error}
                  collapsible={false}
                />
              ) : null}

              {result ? (
                <VStack gap={4}>
                  <AstryxList density="balanced">
                    <ListItem
                      label={result.sshDirPath}
                      description={t("settings.sshImportFound")
                        .replace("{count}", String(candidates.length))
                        .replace("{keys}", String(result.keyFiles.length))}
                      startContent={<AstryxIcon icon={Key} size="sm" color="secondary" />}
                    />
                  </AstryxList>

                  {candidates.length === 0 ? (
                    <EmptyState
                      title={t("settings.sshImportEmpty")}
                      description={t("settings.sshImportEmptyHint")}
                      icon={<AstryxIcon icon={Key} size="lg" color="secondary" />}
                      isCompact
                    />
                  ) : (
                    <AstryxList density="balanced" hasDividers>
                      {candidates.map((candidate) => (
                        <SshImportCandidateRow
                          key={candidate.id}
                          candidate={candidate}
                          selected={selectedIds.has(candidate.id)}
                          onChange={() => toggle(candidate.id)}
                        />
                      ))}
                    </AstryxList>
                  )}
                </VStack>
              ) : null}
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <HStack gap={3} hAlign="between" vAlign="center" wrap="wrap">
              <Text type="supporting" color="secondary" hasTabularNumbers>
                {t("settings.sshImportSelected").replace("{count}", String(selected.length))}
              </Text>
              <HStack gap={2} vAlign="center">
                <AstryxCoreButton
                  label={t("settings.cancel")}
                  variant="secondary"
                  onClick={onClose}
                />
                <AstryxCoreButton
                  label={t("settings.sshImport")}
                  variant="primary"
                  isDisabled={selected.length === 0}
                  onClick={() => {
                    onImport(selected);
                    onClose();
                  }}
                />
              </HStack>
            </HStack>
          </LayoutFooter>
        }
      />
    </SettingsModalShell>
  );
}

export function SshSettingsSection(props: SettingsSectionProps) {
  const { settings, setSettings } = props;
  const { t } = useLocale();
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingHost, setEditingHost] = useState<SshHostConfig | null>(null);
  const [knownHostResettingId, setKnownHostResettingId] = useState<string | null>(null);
  const [knownHostResetStatus, setKnownHostResetStatus] = useState<SshKnownHostResetStatus | null>(
    null,
  );
  const knownHostResetTimerRef = useRef<number | null>(null);
  const hosts = settings.ssh.hosts;

  useEffect(() => {
    return () => {
      if (knownHostResetTimerRef.current !== null) {
        window.clearTimeout(knownHostResetTimerRef.current);
      }
    };
  }, []);

  function showKnownHostResetStatus(status: SshKnownHostResetStatus) {
    if (knownHostResetTimerRef.current !== null) {
      window.clearTimeout(knownHostResetTimerRef.current);
    }
    setKnownHostResetStatus(status);
    knownHostResetTimerRef.current = window.setTimeout(() => {
      setKnownHostResetStatus((current) => (current?.hostId === status.hostId ? null : current));
      knownHostResetTimerRef.current = null;
    }, 5000);
  }

  function openAdd() {
    setEditingHost(null);
    setModalOpen(true);
  }

  function openEdit(host: SshHostConfig) {
    setEditingHost(host);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingHost(null);
  }

  function handleSave(data: SshHostDraft) {
    setSettings((prev) => {
      if (editingHost) {
        return updateSsh(prev, {
          hosts: prev.ssh.hosts.map((host) => {
            if (host.id !== editingHost.id) return host;
            const keepPasswordSecret = data.authType === "password" && host.authType === "password";
            const keepPrivateKeySecret =
              data.authType === "privateKey" && host.authType === "privateKey";
            const nextPassword =
              data.authType === "password"
                ? data.password || (keepPasswordSecret ? host.password : "")
                : "";
            const nextPrivateKey =
              data.authType === "privateKey"
                ? data.privateKey || (keepPrivateKeySecret ? host.privateKey : "")
                : "";
            const nextPrivateKeyPassphrase =
              data.authType === "privateKey"
                ? data.privateKeyPassphrase ||
                  (keepPrivateKeySecret ? host.privateKeyPassphrase : "")
                : "";
            return {
              ...host,
              ...data,
              password: nextPassword,
              privateKey: nextPrivateKey,
              privateKeyPassphrase: nextPrivateKeyPassphrase,
              passwordConfigured:
                data.authType === "password" &&
                (data.password.trim().length > 0 ||
                  (keepPasswordSecret && host.passwordConfigured === true)),
              privateKeyConfigured:
                data.authType === "privateKey" &&
                (data.privateKey.trim().length > 0 ||
                  data.privateKeyPath.trim().length > 0 ||
                  (keepPrivateKeySecret && host.privateKeyConfigured === true)),
              privateKeyPassphraseConfigured:
                data.authType === "privateKey" &&
                (data.privateKeyPassphrase.trim().length > 0 ||
                  (keepPrivateKeySecret && host.privateKeyPassphraseConfigured === true)),
              proxy: {
                ...data.proxy,
                password: data.proxy.password || host.proxy.password,
                passwordConfigured:
                  data.proxy.password.trim().length > 0 || host.proxy.passwordConfigured === true,
              },
            };
          }),
        });
      }
      return updateSsh(prev, {
        hosts: [
          ...prev.ssh.hosts,
          {
            id: createUuid(),
            ...data,
          },
        ],
      });
    });
  }

  function handleDelete(id: string) {
    setSettings((prev) =>
      removeSshHostFromProjectAssociations(
        updateSsh(prev, {
          hosts: prev.ssh.hosts.filter((host) => host.id !== id),
        }),
        id,
      ),
    );
  }

  async function handleResetKnownHost(host: SshHostConfig) {
    const targetHost = host.host.trim();
    if (!targetHost || host.port <= 0) {
      showKnownHostResetStatus({
        hostId: host.id,
        kind: "error",
        message: t("settings.sshKnownHostResetFailed").replace(
          "{error}",
          t("settings.sshRequired"),
        ),
      });
      return;
    }

    setKnownHostResettingId(host.id);
    try {
      const response = await invoke<SshKnownHostResetResponse>("settings_reset_ssh_known_host", {
        host: targetHost,
        port: host.port,
      });
      showKnownHostResetStatus({
        hostId: host.id,
        kind: response.deleted > 0 ? "success" : "info",
        message:
          response.deleted > 0
            ? t("settings.sshKnownHostResetSuccess")
            : t("settings.sshKnownHostResetEmpty"),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showKnownHostResetStatus({
        hostId: host.id,
        kind: "error",
        message: t("settings.sshKnownHostResetFailed").replace("{error}", message),
      });
    } finally {
      setKnownHostResettingId((current) => (current === host.id ? null : current));
    }
  }

  function handleImport(candidates: SshImportCandidate[]) {
    setSettings((prev) =>
      updateSsh(prev, {
        hosts: [
          ...prev.ssh.hosts,
          ...candidates.map((candidate) => {
            const { id: _id, source: _source, duplicate: _duplicate, ...host } = candidate;
            return {
              id: createUuid(),
              ...host,
            };
          }),
        ],
      }),
    );
  }

  if (modalOpen) {
    return (
      <SshHostModal
        initialData={editingHost ?? undefined}
        onSave={handleSave}
        onClose={closeModal}
      />
    );
  }

  if (importOpen) {
    return (
      <SshImportModal
        existingHosts={hosts}
        onImport={handleImport}
        onClose={() => setImportOpen(false)}
      />
    );
  }

  return (
    <VStack width="100%" gap={4}>
      <Section variant="transparent" padding={0}>
        <HStack width="100%" gap={2} vAlign="center" hAlign="end" wrap="wrap">
          <Badge label={hosts.length} variant="neutral" />
          <DropdownMenu
            button={{
              label: t("settings.sshAdd"),
              variant: "primary",
              size: "sm",
              icon: <AstryxIcon icon={Plus} size="sm" color="inherit" />,
            }}
            alignment="end"
            items={[
              {
                id: "add",
                label: t("settings.sshAdd"),
                icon: <AstryxIcon icon={Server} size="sm" color="inherit" />,
                onClick: openAdd,
              },
              {
                id: "import",
                label: t("settings.sshImport"),
                icon: <AstryxIcon icon={Upload} size="sm" color="inherit" />,
                onClick: () => setImportOpen(true),
              },
            ]}
          />
        </HStack>
      </Section>

      {hosts.length === 0 ? (
        <EmptyState
          isCompact
          icon={<AstryxIcon icon={Key} size="lg" color="secondary" />}
          title={t("settings.sshNoHosts")}
          description={t("settings.sshNoHostsHint")}
        />
      ) : (
        <AstryxList density="balanced" hasDividers>
          {hosts.map((host) => {
            const resetStatus =
              knownHostResetStatus?.hostId === host.id ? knownHostResetStatus : undefined;
            return (
              <ListItem
                key={host.id}
                label={host.name}
                startContent={<AstryxIcon icon={Server} size="md" color="secondary" />}
                description={
                  <VStack gap={1}>
                    <Text type="supporting" color="secondary" wordBreak="break-word">
                      {host.username ? `${host.username}@` : ""}
                      {host.host}:{host.port}
                    </Text>
                    <HStack gap={2} vAlign="center" wrap="wrap">
                      <Text type="supporting" color="secondary">
                        {authLabel(host, t)}
                      </Text>
                      {resetStatus ? (
                        <StatusDot
                          variant={
                            resetStatus.kind === "error"
                              ? "error"
                              : resetStatus.kind === "success"
                                ? "success"
                                : "neutral"
                          }
                          label={resetStatus.message}
                        />
                      ) : null}
                    </HStack>
                  </VStack>
                }
                endContent={
                  <HStack gap={1} vAlign="center">
                    <ConfirmActionPopover
                      title={t("settings.sshKnownHostResetTitle")}
                      description={t("settings.sshKnownHostResetDesc")}
                      confirmLabel={t("settings.sshKnownHostResetConfirm")}
                      onConfirm={() => void handleResetKnownHost(host)}
                    >
                      {(open) => (
                        <IconButton
                          label={t("settings.sshKnownHostResetTitle")}
                          tooltip={t("settings.sshKnownHostResetTitle")}
                          icon={<AstryxIcon icon={Shield} size="sm" color="inherit" />}
                          variant="ghost"
                          size="sm"
                          isLoading={knownHostResettingId === host.id}
                          onClick={open}
                        />
                      )}
                    </ConfirmActionPopover>
                    <IconButton
                      label={t("settings.sshEdit")}
                      tooltip={t("settings.sshEdit")}
                      icon={<AstryxIcon icon={Pencil} size="sm" color="inherit" />}
                      variant="ghost"
                      size="sm"
                      onClick={() => openEdit(host)}
                    />
                    <ConfirmDeletePopover name={host.name} onConfirm={() => handleDelete(host.id)}>
                      {(open) => (
                        <IconButton
                          label={t("settings.delete")}
                          tooltip={t("settings.delete")}
                          icon={<AstryxIcon icon={Trash2} size="sm" color="inherit" />}
                          variant="ghost"
                          size="sm"
                          onClick={open}
                        />
                      )}
                    </ConfirmDeletePopover>
                  </HStack>
                }
              />
            );
          })}
        </AstryxList>
      )}
    </VStack>
  );
}
