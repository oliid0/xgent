import { Banner } from "@astryxdesign/core/Banner";
import { BreadcrumbItem, Breadcrumbs } from "@astryxdesign/core/Breadcrumbs";
import { Button as AstryxCoreButton } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Grid } from "@astryxdesign/core/Grid";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Item } from "@astryxdesign/core/Item";
import {
  HStack,
  Layout,
  LayoutContent,
  LayoutFooter,
  StackItem,
  VStack,
} from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { Section } from "@astryxdesign/core/Section";
import { Selector as AstryxSelector } from "@astryxdesign/core/Selector";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Spinner } from "@astryxdesign/core/Spinner";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Token } from "@astryxdesign/core/Token";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ExternalLink,
  Globe2,
  Key,
  RefreshCw,
  Search,
  Server,
  Shield,
  Sparkles,
  Terminal,
} from "../../components/icons";
import { useLocale } from "../../i18n";
import {
  applyMcpRegistryInstallConfig,
  createUniqueMcpServerId,
  MCP_REGISTRY_SOURCE_OPTIONS,
  type McpRegistryCard,
  type McpRegistryConfigInput,
  type McpRegistryInstallDraft,
  type McpRegistrySource,
  mcpRegistryConfigInputKey,
  resolveMcpRegistryInstallDraft,
  searchMcpRegistry,
  withUniqueMcpServerId,
} from "../../lib/mcpRegistry";
import { type AppSettings, type McpServerConfig, updateMcp } from "../../lib/settings";

const STORE_PAGE_LIMIT = 18;
const STORE_SKELETON_IDS = ["one", "two", "three", "four", "five", "six"] as const;

type McpRegistryBrowserProps = {
  settings: AppSettings;
  setSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  allowStdio?: boolean;
};

type McpConfigModalDraft = {
  id: string;
  transport: McpServerConfig["transport"];
  timeoutMs: string;
  command: string;
  cwd: string;
  argsText: string;
  envText: string;
  url: string;
  messageUrl: string;
  headersText: string;
  configValues: Record<string, string>;
};

type McpPreviewLink = {
  key: string;
  labelKey: string;
  url: string;
};

type McpRegistryCardGroup = {
  id: string;
  cards: McpRegistryCard[];
};

type PrefetchedMcpPage = {
  cursor: string;
  source: McpRegistrySource;
  query: string;
  items: McpRegistryCard[];
  nextCursor?: string;
};

function versionLabelForCard(card: McpRegistryCard) {
  return card.versionLabel ?? (card.source === "official" ? card.scoreLabel : undefined);
}

function groupMcpRegistryCards(cards: McpRegistryCard[]) {
  const groups: McpRegistryCardGroup[] = [];
  const byKey = new Map<string, McpRegistryCardGroup>();

  for (const card of cards) {
    const key = versionLabelForCard(card)
      ? `${card.source}:${card.sourceId || card.name || card.id}`
      : card.id;
    let group = byKey.get(key);
    if (!group) {
      group = { id: key, cards: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    if (!group.cards.some((item) => item.id === card.id)) {
      group.cards.push(card);
    }
  }

  return groups;
}

function mergeMcpRegistryCards(current: McpRegistryCard[], next: McpRegistryCard[]) {
  const byId = new Map(current.map((card) => [card.id, card]));
  for (const card of next) byId.set(card.id, card);
  return Array.from(byId.values());
}

function installLabelKey(card: McpRegistryCard) {
  if (!card.installDraft && card.source === "smithery") return "mcpHub.storeInstall";
  if (card.installDraft?.status === "needs_config") return "mcpHub.storeConfigure";
  return card.installDraft ? "mcpHub.storeInstall" : "mcpHub.storeManualOnly";
}

function configureDraftForCard(card: McpRegistryCard) {
  return card.installDraft ?? card.manualDraft;
}

function primaryRegistryLink(card: McpRegistryCard) {
  return card.detailUrl ?? card.homepageUrl ?? card.repositoryUrl;
}

function registryExternalLinks(card: McpRegistryCard): McpPreviewLink[] {
  const candidates: Array<{ key: string; labelKey: string; url?: string }> = [
    { key: "detail", labelKey: "mcpHub.storePreviewDetailPage", url: card.detailUrl },
    { key: "homepage", labelKey: "mcpHub.storePreviewHomepage", url: card.homepageUrl },
    { key: "repository", labelKey: "mcpHub.storePreviewRepository", url: card.repositoryUrl },
  ];
  const seen = new Set<string>();
  return candidates.flatMap((candidate) => {
    const url = candidate.url?.trim();
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{ key: candidate.key, labelKey: candidate.labelKey, url }];
  });
}

function formatKeyValueRecord(input: Record<string, string> | undefined) {
  return input
    ? Object.entries(input)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n")
    : "";
}

function parseLineList(input: string) {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseKeyValueDraft(input: string, errorPrefix: string) {
  const out: Record<string, string> = {};
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      throw new Error(`${errorPrefix}: ${trimmed}`);
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!key || !value) {
      throw new Error(`${errorPrefix}: ${trimmed}`);
    }
    out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

function cleanConfigValue(value: string | undefined) {
  if (!value || value === "...") return "";
  return value;
}

function valueFromServerConfig(input: McpRegistryConfigInput, server: McpServerConfig) {
  const targetName = input.targetName ?? input.name;
  if (input.target === "env") {
    return cleanConfigValue(server.env?.[targetName] ?? server.env?.[input.name]);
  }
  if (input.target === "header") {
    return cleanConfigValue(server.headers?.[targetName] ?? server.headers?.[input.name]);
  }
  if (input.target === "url") {
    try {
      const parsed = new URL(server.url);
      return cleanConfigValue(parsed.searchParams.get(targetName) ?? undefined);
    } catch {
      return "";
    }
  }
  if (input.target === "config") {
    for (let index = 0; index < (server.args ?? []).length; index += 1) {
      const arg = server.args[index];
      const rawConfig =
        arg === "--config"
          ? server.args[index + 1]
          : arg.startsWith("--config=")
            ? arg.slice("--config=".length)
            : undefined;
      if (!rawConfig) continue;
      try {
        const parsed = JSON.parse(rawConfig);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
        const value =
          (parsed as Record<string, unknown>)[targetName] ??
          (parsed as Record<string, unknown>)[input.name];
        return cleanConfigValue(
          typeof value === "string" ? value : value === undefined ? undefined : String(value),
        );
      } catch {
        return "";
      }
    }
  }
  return "";
}

function pickInitialTransport(card: McpRegistryCard): McpServerConfig["transport"] {
  const transport = configureDraftForCard(card)?.server.transport ?? card.transportHints[0];
  if (transport === "http" || transport === "sse") return transport;
  return "stdio";
}

function buildModalDraft(
  card: McpRegistryCard,
  existingServers: McpServerConfig[],
  allowStdio: boolean,
): McpConfigModalDraft {
  const configureDraft = configureDraftForCard(card);
  const server = configureDraft?.server;
  const initialTransport = pickInitialTransport(card);
  const transport =
    !allowStdio && initialTransport === "stdio"
      ? (card.transportHints.find((item) => item === "http" || item === "sse") ?? "http")
      : initialTransport;
  const id = createUniqueMcpServerId(
    server?.id || card.name || card.displayName,
    existingServers.map((item) => item.id),
  );
  const configValues: Record<string, string> = {};
  for (const input of configureDraft?.requiredConfig ?? []) {
    configValues[mcpRegistryConfigInputKey(input)] = server
      ? valueFromServerConfig(input, server)
      : "";
  }

  return {
    id,
    transport,
    timeoutMs: String(server?.timeoutMs ?? 60_000),
    command: server?.command ?? "",
    cwd: server?.cwd ?? "",
    argsText: (server?.args ?? []).join("\n"),
    envText: formatKeyValueRecord(server?.env),
    url: server?.url ?? "",
    messageUrl: server?.messageUrl ?? "",
    headersText: formatKeyValueRecord(server?.headers),
    configValues,
  };
}

function configTargetLabel(input: McpRegistryConfigInput, t: (key: string) => string) {
  if (input.target === "env") return t("mcpHub.previewEnv");
  if (input.target === "header") return t("mcpHub.previewHeaders");
  if (input.target === "argument") return t("mcpHub.previewArgs");
  if (input.target === "url") return "URL";
  return "Config";
}

function keyListLabel(record: Record<string, string> | undefined) {
  const keys = Object.keys(record ?? {}).filter(Boolean);
  return keys.length > 0 ? keys.join(", ") : null;
}

function buildServerFromModalDraft(
  draft: McpConfigModalDraft,
  requiredConfig: McpRegistryConfigInput[],
  t: (key: string) => string,
): McpServerConfig {
  const id = draft.id.trim();
  if (!id) {
    throw new Error(t("mcpHub.storeConfigureNameRequired"));
  }

  const timeoutMs = Number(draft.timeoutMs.trim());
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(t("mcpHub.storeConfigureTimeoutInvalid"));
  }

  for (const input of requiredConfig) {
    const value = draft.configValues[mcpRegistryConfigInputKey(input)]?.trim() ?? "";
    if (input.required && !value) {
      throw new Error(
        t("mcpHub.storeConfigureRequiredMissing").replace("{name}", input.label ?? input.name),
      );
    }
  }

  if (draft.transport === "stdio") {
    const command = draft.command.trim();
    if (!command) {
      throw new Error(t("mcpHub.storeConfigureCommandRequired"));
    }
    return {
      id,
      enabled: true,
      transport: "stdio",
      command,
      args: parseLineList(draft.argsText),
      env: parseKeyValueDraft(draft.envText, t("mcpHub.storeConfigureInvalidKeyValue")),
      cwd: draft.cwd.trim() || undefined,
      url: "",
      timeoutMs: Math.floor(timeoutMs),
    };
  }

  const url = draft.url.trim();
  if (!url) {
    throw new Error(t("mcpHub.storeConfigureUrlRequired"));
  }

  return {
    id,
    enabled: true,
    transport: draft.transport,
    command: "",
    args: [],
    url,
    headers: parseKeyValueDraft(draft.headersText, t("mcpHub.storeConfigureInvalidKeyValue")),
    timeoutMs: Math.floor(timeoutMs),
    messageUrl: draft.transport === "sse" ? draft.messageUrl.trim() || undefined : undefined,
  };
}

function McpConfigureModal(props: {
  card: McpRegistryCard;
  existingServers: McpServerConfig[];
  allowStdio: boolean;
  onClose: () => void;
  onSave: (server: McpServerConfig) => void;
}) {
  const { card, existingServers, allowStdio, onClose, onSave } = props;
  const { t } = useLocale();
  const configureDraft = configureDraftForCard(card);
  const requiredConfig = configureDraft?.requiredConfig ?? [];
  const [draft, setDraft] = useState(() => buildModalDraft(card, existingServers, allowStdio));
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(buildModalDraft(card, existingServers, allowStdio));
    setFormError(null);
  }, [allowStdio, card, existingServers]);

  function updateDraft(patch: Partial<McpConfigModalDraft>) {
    setFormError(null);
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function updateConfigValue(input: McpRegistryConfigInput, value: string) {
    setFormError(null);
    const key = mcpRegistryConfigInputKey(input);
    setDraft((prev) => ({
      ...prev,
      configValues: {
        ...prev.configValues,
        [key]: value,
      },
    }));
  }

  function handleSubmit(event: FormEvent<HTMLElement>) {
    event.preventDefault();
    try {
      if (!allowStdio && draft.transport === "stdio") {
        throw new Error(t("mcpHub.mobileNetworkOnly"));
      }
      const server = buildServerFromModalDraft(draft, requiredConfig, t);
      const configuredDraft: McpRegistryInstallDraft = {
        server,
        status: requiredConfig.length > 0 ? "needs_config" : "ready",
        requiredConfig,
        warnings: configureDraft?.warnings ?? [],
        commandPreview: "",
      };
      const finalDraft =
        requiredConfig.length > 0
          ? applyMcpRegistryInstallConfig(configuredDraft, draft.configValues)
          : configuredDraft;
      onSave(finalDraft.server);
      onClose();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    }
  }

  const isStdio = draft.transport === "stdio";
  const isSse = draft.transport === "sse";

  return (
    <Dialog
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      variant="standard"
      purpose="form"
      aria-label={t("mcpHub.storeConfigureTitle")}
      width="min(var(--xagent-settings-dialog-width), calc(100dvw - (var(--spacing-4) * 2)))"
      padding={0}
    >
      <form onSubmit={handleSubmit}>
        <Layout
          header={
            <DialogHeader
              title={t("mcpHub.storeConfigureTitle")}
              subtitle={t("mcpHub.storeConfigureSubtitle").replace("{name}", card.displayName)}
              startContent={<Icon icon={Sparkles} size="md" color="secondary" />}
              onOpenChange={(isOpen) => {
                if (!isOpen) onClose();
              }}
            />
          }
          content={
            <LayoutContent isScrollable>
              <VStack gap={5}>
                <FormLayout>
                  <FormLayout direction="horizontal">
                    <TextInput
                      label={t("mcpHub.serverName")}
                      value={draft.id}
                      placeholder={t("mcpHub.serverNamePlaceholder")}
                      onChange={(value) => updateDraft({ id: value })}
                    />
                    <AstryxSelector
                      label={t("mcpHub.transport")}
                      value={draft.transport}
                      options={[
                        {
                          value: "stdio",
                          label: t("mcpHub.stdio"),
                          disabled: !allowStdio,
                        },
                        { value: "http", label: t("mcpHub.http") },
                        { value: "sse", label: t("mcpHub.sse") },
                      ]}
                      onChange={(value) =>
                        updateDraft({
                          transport: value === "http" ? "http" : value === "sse" ? "sse" : "stdio",
                        })
                      }
                    />
                    <NumberInput
                      label={t("mcpHub.timeout")}
                      min={1}
                      value={Number.parseInt(draft.timeoutMs, 10) || null}
                      isWheelEnabled={false}
                      onChange={(value) => updateDraft({ timeoutMs: value ? String(value) : "" })}
                    />
                  </FormLayout>
                </FormLayout>

                <Section variant="muted">
                  <FormLayout>
                    {isStdio ? (
                      <>
                        <FormLayout direction="horizontal">
                          <TextInput
                            label={t("mcpHub.command")}
                            value={draft.command}
                            placeholder="npx"
                            onChange={(value) => updateDraft({ command: value })}
                          />
                          <TextInput
                            label={t("mcpHub.cwd")}
                            value={draft.cwd}
                            placeholder={t("mcpHub.cwdDefault")}
                            onChange={(value) => updateDraft({ cwd: value })}
                          />
                        </FormLayout>
                        <TextArea
                          label={t("mcpHub.args")}
                          value={draft.argsText}
                          rows={4}
                          hasSpellCheck={false}
                          placeholder={"-y\n@modelcontextprotocol/server-time"}
                          onChange={(value) => updateDraft({ argsText: value })}
                        />
                        <TextArea
                          label={t("mcpHub.env")}
                          value={draft.envText}
                          rows={4}
                          hasSpellCheck={false}
                          placeholder={"BRAVE_API_KEY=...\nHTTP_PROXY=..."}
                          onChange={(value) => updateDraft({ envText: value })}
                        />
                      </>
                    ) : (
                      <>
                        <TextInput
                          label={
                            draft.transport === "http" ? t("mcpHub.urlHttp") : t("mcpHub.urlSse")
                          }
                          value={draft.url}
                          placeholder={
                            draft.transport === "http"
                              ? "http://127.0.0.1:3000/mcp"
                              : "http://127.0.0.1:3000/sse"
                          }
                          onChange={(value) => updateDraft({ url: value })}
                        />
                        {isSse ? (
                          <TextInput
                            label={t("mcpHub.messageUrl")}
                            value={draft.messageUrl}
                            placeholder="http://127.0.0.1:3000/message"
                            onChange={(value) => updateDraft({ messageUrl: value })}
                          />
                        ) : null}
                        <TextArea
                          label={t("mcpHub.headers")}
                          value={draft.headersText}
                          rows={4}
                          hasSpellCheck={false}
                          placeholder={"Authorization=Bearer ...\nX-API-Key=..."}
                          onChange={(value) => updateDraft({ headersText: value })}
                        />
                      </>
                    )}
                  </FormLayout>
                </Section>

                {requiredConfig.length > 0 ? (
                  <Section variant="transparent" padding={0}>
                    <VStack gap={3}>
                      <VStack gap={1}>
                        <Heading level={4}>{t("mcpHub.storeConfigureRequiredTitle")}</Heading>
                        <Text color="secondary">{t("mcpHub.storeConfigureRequiredDesc")}</Text>
                      </VStack>
                      <Grid columns={{ minWidth: 240, max: 2, repeat: "fit" }} gap={3}>
                        {requiredConfig.map((input) => {
                          const key = mcpRegistryConfigInputKey(input);
                          return (
                            <VStack key={key} gap={1}>
                              <TextInput
                                label={input.label ?? input.name}
                                type={input.secret ? "password" : "text"}
                                value={draft.configValues[key] ?? ""}
                                placeholder={input.name}
                                description={input.description}
                                onChange={(value) => updateConfigValue(input, value)}
                              />
                              <Token label={configTargetLabel(input, t)} size="sm" />
                            </VStack>
                          );
                        })}
                      </Grid>
                    </VStack>
                  </Section>
                ) : null}

                {formError ? <Banner status="error" title={formError} collapsible={false} /> : null}
              </VStack>
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider>
              <HStack gap={2} hAlign="end">
                <AstryxCoreButton
                  type="button"
                  label={t("settings.cancel")}
                  variant="secondary"
                  onClick={onClose}
                />
                <AstryxCoreButton
                  type="submit"
                  label={t("mcpHub.storeConfigureSubmit")}
                  variant="primary"
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </form>
    </Dialog>
  );
}

function RegistryCard(props: {
  group: McpRegistryCardGroup;
  installedIdForCard: (card: McpRegistryCard) => string | undefined;
  installingId: string | null;
  onPreview: (card: McpRegistryCard) => void;
  onInstall: (card: McpRegistryCard) => void;
}) {
  const { group, installedIdForCard, installingId, onPreview, onInstall } = props;
  const { t } = useLocale();
  const [selectedCardId, setSelectedCardId] = useState(group.cards[0]?.id ?? "");

  useEffect(() => {
    if (!group.cards.some((card) => card.id === selectedCardId)) {
      setSelectedCardId(group.cards[0]?.id ?? "");
    }
  }, [group.cards, selectedCardId]);

  const card = group.cards.find((item) => item.id === selectedCardId) ?? group.cards[0];
  if (!card) return null;

  const installedId = installedIdForCard(card);
  const installing = installingId === card.id;
  const done = Boolean(installedId);
  const configureDraft = configureDraftForCard(card);
  const versionOptions = group.cards.map((item) => ({
    value: item.id,
    label: versionLabelForCard(item) ?? t("mcpHub.storeVersionLatest"),
  }));
  const hasVersionSelector = versionOptions.length > 1;

  return (
    <Item
      label={card.displayName}
      align="start"
      density="balanced"
      startContent={
        <Icon
          icon={card.remote ? Globe2 : Server}
          size="md"
          color={done ? "accent" : "secondary"}
        />
      }
      description={
        <VStack gap={1}>
          <Text color="secondary">{card.description || t("mcpHub.storeNoDescription")}</Text>
          {card.verified ? (
            <StatusDot variant="success" label={t("mcpHub.storePreviewVerified")} />
          ) : null}
          {configureDraft?.commandPreview ? (
            <Text type="code" color="secondary">
              {configureDraft.commandPreview}
            </Text>
          ) : null}
          {done ? (
            <HStack gap={1} vAlign="center">
              <StatusDot variant="success" label={t("mcpHub.storeInstalled")} />
              <Text type="supporting" color="secondary">
                {`${t("mcpHub.storeInstalledAs")} ${installedId}`}
              </Text>
            </HStack>
          ) : null}
        </VStack>
      }
      endContent={
        <HStack gap={1} vAlign="center" wrap="wrap">
          {hasVersionSelector ? (
            <AstryxSelector
              label={t("mcpHub.storeVersion")}
              isLabelHidden
              value={card.id}
              options={versionOptions}
              variant="ghost"
              size="sm"
              width="var(--xagent-mcp-version-selector-width)"
              onChange={setSelectedCardId}
            />
          ) : null}
          <IconButton
            label={t("mcpHub.storePreviewTitle")}
            tooltip={t("mcpHub.storePreviewTitle")}
            icon={<Icon icon={Search} size="sm" color="inherit" />}
            variant="ghost"
            size="sm"
            onClick={() => onPreview(card)}
          />
          <AstryxCoreButton
            label={done ? t("mcpHub.storeInstalled") : t(installLabelKey(card))}
            variant={done ? "secondary" : "primary"}
            size="sm"
            isDisabled={done || installing}
            isLoading={installing}
            onClick={() => onInstall(card)}
          />
        </HStack>
      }
    />
  );
}

function McpRegistryPreviewDrawer(props: {
  card: McpRegistryCard;
  detail: McpRegistryCard | null;
  loading: boolean;
  error: string | null;
  installedId?: string;
  installing: boolean;
  onClose: () => void;
  onInstall: (card: McpRegistryCard) => void;
}) {
  const { card, detail, loading, error, installedId, installing, onClose, onInstall } = props;
  const { t } = useLocale();
  const data = detail ?? card;
  const draft = configureDraftForCard(data);
  const server = draft?.server;
  const transports = draft ? [draft.server.transport] : data.transportHints;
  const links = registryExternalLinks(data);
  const primaryLink = primaryRegistryLink(data);
  const requiredConfig = draft?.requiredConfig ?? [];
  const warnings = draft?.warnings ?? [];
  const installed = Boolean(installedId);
  const installActionKey = installLabelKey(data);
  const actionLabel = installing
    ? t("mcpHub.storeInstalling")
    : installed
      ? t("mcpHub.storeInstalled")
      : installActionKey === "mcpHub.storeInstall" || installActionKey === "mcpHub.storeConfigure"
        ? t(installActionKey)
        : t("mcpHub.storeAddDraft");

  const isCompact = useMediaQuery(
    "(max-width: 768px), (max-width: 1024px) and (pointer: coarse) and (hover: none)",
  );

  return (
    <Dialog
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      aria-label={t("mcpHub.storePreviewTitle")}
      purpose="info"
      variant={isCompact ? "fullscreen" : "standard"}
      width={isCompact ? "100dvw" : "min(var(--xagent-drawer-width), 40dvw)"}
      padding={0}
      style={{
        marginInlineStart: "auto",
        marginInlineEnd: 0,
        blockSize: "var(--xagent-viewport-height)",
        maxBlockSize: "var(--xagent-viewport-height)",
        ...(isCompact
          ? {}
          : { borderRadius: "var(--radius-container) 0 0 var(--radius-container)" }),
      }}
    >
      <Layout
        height="fill"
        header={
          <DialogHeader
            title={data.displayName}
            subtitle={data.source}
            startContent={<Icon icon={data.remote ? Globe2 : Server} size="md" color="secondary" />}
            onOpenChange={(isOpen) => {
              if (!isOpen) onClose();
            }}
          />
        }
        content={
          <LayoutContent isScrollable>
            <VStack gap={5}>
              <Breadcrumbs variant="supporting" label={t("mcpHub.storePreviewTitle")}>
                <BreadcrumbItem onClick={onClose}>{t("mcpHub.tabStore")}</BreadcrumbItem>
                <BreadcrumbItem isCurrent>{data.displayName}</BreadcrumbItem>
              </Breadcrumbs>
              <Text color="secondary">{data.description || t("mcpHub.storeNoDescription")}</Text>

              <HStack gap={2} vAlign="center" wrap="wrap">
                <Token label={data.source} color="gray" size="sm" />
                {transports.map((transport) => (
                  <Token key={transport} label={transport.toUpperCase()} color="gray" size="sm" />
                ))}
                {data.verified ? (
                  <Token
                    label={t("mcpHub.storePreviewVerified")}
                    color="green"
                    size="sm"
                    icon={<Icon icon={Shield} size="sm" color="inherit" />}
                  />
                ) : null}
              </HStack>

              <MetadataList columns={2} label={{ position: "top" }}>
                <MetadataListItem label={t("mcpHub.storePreviewSource")}>
                  {data.source}
                </MetadataListItem>
                <MetadataListItem label={t("mcpHub.storePreviewMode")}>
                  {data.remote ? t("mcpHub.storePreviewRemote") : t("mcpHub.storePreviewLocal")}
                </MetadataListItem>
              </MetadataList>

              {loading ? (
                <VStack gap={2} aria-busy="true">
                  <HStack gap={2} vAlign="center">
                    <Spinner size="sm" aria-label={t("mcpHub.storePreviewLoadingDetail")} />
                    <Text type="supporting" color="secondary">
                      {t("mcpHub.storePreviewLoadingDetail")}
                    </Text>
                  </HStack>
                  <Skeleton width="100%" height="var(--spacing-3)" index={0} />
                  <Skeleton width="80%" height="var(--spacing-3)" index={1} />
                </VStack>
              ) : null}

              {error ? (
                <Banner
                  status="warning"
                  title={t("mcpHub.storePreviewDetailUnavailable")}
                  collapsible={false}
                />
              ) : null}

              {data.tags.length > 0 ? (
                <Section padding={0} variant="transparent">
                  <VStack gap={2}>
                    <Text type="label">{t("mcpHub.storePreviewTags")}</Text>
                    <HStack gap={1} wrap="wrap">
                      {data.tags.map((tag) => (
                        <Token key={tag} label={tag} color="gray" size="sm" />
                      ))}
                    </HStack>
                  </VStack>
                </Section>
              ) : null}

              <Section padding={0} variant="transparent">
                <VStack gap={3}>
                  <Text type="label">{t("mcpHub.storePreviewInstallPreview")}</Text>
                  {draft?.commandPreview ? (
                    <CodeBlock code={draft.commandPreview} size="sm" />
                  ) : (
                    <Banner
                      status="info"
                      title={
                        data.installUnavailableReason === "needs-manual-command"
                          ? t("mcpHub.storeNeedsCommand")
                          : t("mcpHub.storeManualOnly")
                      }
                      collapsible={false}
                    />
                  )}
                  <MetadataList label={{ position: "start", width: "var(--spacing-28)" }}>
                    <MetadataListItem label={t("mcpHub.serverName")}>
                      {server?.id ?? data.name}
                    </MetadataListItem>
                    {transports.length > 0 ? (
                      <MetadataListItem label={t("mcpHub.transport")}>
                        {transports.join(", ")}
                      </MetadataListItem>
                    ) : null}
                    {server?.timeoutMs ? (
                      <MetadataListItem label={t("mcpHub.timeout")}>
                        {`${server.timeoutMs} ms`}
                      </MetadataListItem>
                    ) : null}
                    {server?.command ? (
                      <MetadataListItem label={t("mcpHub.command")}>
                        {server.command}
                      </MetadataListItem>
                    ) : null}
                    {server?.args?.length ? (
                      <MetadataListItem label={t("mcpHub.args")}>
                        {server.args.join(" ")}
                      </MetadataListItem>
                    ) : null}
                    {server?.url ? (
                      <MetadataListItem
                        label={
                          server.transport === "sse" ? t("mcpHub.urlSse") : t("mcpHub.urlHttp")
                        }
                      >
                        {server.url}
                      </MetadataListItem>
                    ) : null}
                    {server?.messageUrl ? (
                      <MetadataListItem label={t("mcpHub.messageUrl")}>
                        {server.messageUrl}
                      </MetadataListItem>
                    ) : null}
                    {keyListLabel(server?.env) ? (
                      <MetadataListItem label={t("mcpHub.env")}>
                        {keyListLabel(server?.env)}
                      </MetadataListItem>
                    ) : null}
                    {keyListLabel(server?.headers) ? (
                      <MetadataListItem label={t("mcpHub.headers")}>
                        {keyListLabel(server?.headers)}
                      </MetadataListItem>
                    ) : null}
                  </MetadataList>
                </VStack>
              </Section>

              <Section padding={0} variant="transparent">
                <VStack gap={2}>
                  <Text type="label">{t("mcpHub.storePreviewRequiredConfig")}</Text>
                  {requiredConfig.length > 0 ? (
                    <List density="balanced" hasDividers>
                      {requiredConfig.map((input) => (
                        <ListItem
                          key={mcpRegistryConfigInputKey(input)}
                          label={input.label ?? input.name}
                          description={input.description}
                          startContent={
                            input.secret ? (
                              <Icon icon={Key} size="sm" color="secondary" />
                            ) : undefined
                          }
                          endContent={
                            <Token label={configTargetLabel(input, t)} color="gray" size="sm" />
                          }
                        />
                      ))}
                    </List>
                  ) : (
                    <Text type="supporting" color="secondary">
                      {t("mcpHub.storePreviewNoRequiredConfig")}
                    </Text>
                  )}
                </VStack>
              </Section>

              {warnings.length > 0 ? (
                <Banner
                  status="warning"
                  title={t("mcpHub.storePreviewWarnings")}
                  description={warnings.join("\n")}
                  collapsible={false}
                />
              ) : null}

              {links.length > 0 ? (
                <Section padding={0} variant="transparent">
                  <VStack gap={2}>
                    <Text type="label">{t("mcpHub.storePreviewLinks")}</Text>
                    <List density="balanced" hasDividers>
                      {links.map((link) => (
                        <ListItem
                          key={`${link.key}:${link.url}`}
                          label={t(link.labelKey)}
                          description={link.url}
                          startContent={<Icon icon={ExternalLink} size="sm" color="secondary" />}
                          href={link.url}
                          target="_blank"
                        />
                      ))}
                    </List>
                  </VStack>
                </Section>
              ) : null}
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <HStack gap={2} hAlign="end" wrap="wrap">
              {primaryLink ? (
                <AstryxCoreButton
                  href={primaryLink}
                  target="_blank"
                  rel="noreferrer"
                  label={t("mcpHub.storeOpenExternal")}
                  variant="secondary"
                />
              ) : null}
              <AstryxCoreButton
                label={actionLabel}
                variant={installed || draft?.status === "needs_config" ? "secondary" : "primary"}
                isDisabled={installed || installing}
                isLoading={installing}
                onClick={() => onInstall(data)}
              />
            </HStack>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
}

export function McpRegistryBrowser(props: McpRegistryBrowserProps) {
  const { settings, setSettings, allowStdio = true } = props;
  const { t } = useLocale();
  const [source, setSource] = useState<McpRegistrySource>("official");
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [items, setItems] = useState<McpRegistryCard[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [prefetchedPage, setPrefetchedPage] = useState<PrefetchedMcpPage | null>(null);
  const loadMoreInFlightRef = useRef(false);
  const storeScrollRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [configuringCard, setConfiguringCard] = useState<McpRegistryCard | null>(null);
  const [previewCard, setPreviewCard] = useState<McpRegistryCard | null>(null);
  const [previewDetail, setPreviewDetail] = useState<McpRegistryCard | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [installedByCardId, setInstalledByCardId] = useState<Record<string, string>>({});
  const groupedItems = useMemo(() => groupMcpRegistryCards(items), [items]);

  const existingIds = useMemo(
    () => new Set(settings.mcp.servers.map((server) => server.id)),
    [settings.mcp.servers],
  );

  useEffect(() => {
    if (!previewCard) {
      setPreviewDetail(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }

    let cancelled = false;
    setPreviewDetail(null);
    setPreviewError(null);
    setPreviewLoading(true);

    void resolveMcpRegistryInstallDraft(previewCard)
      .then((resolved) => {
        if (cancelled) return;
        setPreviewDetail(resolved);
        setItems((prev) => prev.map((item) => (item.id === resolved.id ? resolved : item)));
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setPreviewError(message || t("mcpHub.storeLoadFailed"));
      })
      .finally(() => {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [previewCard, t]);

  const runSearch = useCallback(
    async (mode: "replace" | "append" = "replace") => {
      const cursor = mode === "append" ? nextCursor : undefined;
      if (mode === "append" && (!cursor || loadMoreInFlightRef.current)) return;
      const requestQuery = mode === "append" ? activeQuery : query;
      const cached =
        mode === "append" &&
        prefetchedPage !== null &&
        prefetchedPage.cursor === cursor &&
        prefetchedPage.source === source &&
        prefetchedPage.query === requestQuery
          ? prefetchedPage
          : null;
      if (mode === "append") {
        loadMoreInFlightRef.current = true;
        if (!cached) setLoadingMore(true);
      } else {
        setLoading(true);
        setActiveQuery(requestQuery);
        setPrefetchedPage(null);
      }
      setError(null);
      try {
        const result =
          cached ??
          (await searchMcpRegistry({
            source,
            query: requestQuery,
            cursor,
            limit: STORE_PAGE_LIMIT,
          }));
        setItems((prev) =>
          mode === "append" ? mergeMcpRegistryCards(prev, result.items) : result.items,
        );
        setNextCursor(result.items.length > 0 ? result.nextCursor : undefined);
        if (mode === "append") setPrefetchedPage(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message || t("mcpHub.storeLoadFailed"));
        if (mode === "replace") {
          setItems([]);
          setNextCursor(undefined);
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
        if (mode === "append") loadMoreInFlightRef.current = false;
      }
    },
    [activeQuery, nextCursor, prefetchedPage, query, source, t],
  );

  useEffect(() => {
    const cursor = nextCursor;
    if (!cursor || loading) {
      setPrefetchedPage(null);
      return;
    }
    let cancelled = false;
    void searchMcpRegistry({
      source,
      query: activeQuery,
      cursor,
      limit: STORE_PAGE_LIMIT,
    })
      .then((result) => {
        if (cancelled) return;
        setPrefetchedPage({ cursor, query: activeQuery, ...result });
      })
      .catch(() => {
        if (!cancelled) setPrefetchedPage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeQuery, loading, nextCursor, source]);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || !nextCursor || loading || loadingMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void runSearch("append");
      },
      { root: storeScrollRef.current, rootMargin: "640px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loading, loadingMore, nextCursor, runSearch]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: source changes reset the registry; query changes run only on explicit submit.
  useEffect(() => {
    // Clear immediately on source switch so the skeleton + loading rows render right away.
    setItems([]);
    setNextCursor(undefined);
    setError(null);
    setPreviewCard(null);
    void runSearch("replace");
  }, [source]);

  function installedIdForCard(card: McpRegistryCard) {
    const draft = configureDraftForCard(card);
    const draftId = draft?.server.id ?? "";
    return (
      installedByCardId[card.id] ?? (draftId && existingIds.has(draftId) ? draftId : undefined)
    );
  }

  function addServerFromStore(card: McpRegistryCard, server: McpServerConfig) {
    const installedId = server.id;
    setSettings((prev) => {
      return updateMcp(prev, {
        servers: [...prev.mcp.servers, server],
      });
    });
    setInstalledByCardId((prev) => ({ ...prev, [card.id]: installedId }));
  }

  async function installCard(card: McpRegistryCard) {
    setInstallingId(card.id);
    setError(null);
    try {
      const resolved = await resolveMcpRegistryInstallDraft(card);
      setItems((prev) => prev.map((item) => (item.id === card.id ? resolved : item)));
      if (previewCard?.id === card.id) {
        setPreviewDetail(resolved);
      }
      if (!resolved.installDraft) {
        setConfiguringCard(resolved);
        return;
      }
      if (!allowStdio && resolved.installDraft.server.transport === "stdio") {
        throw new Error(t("mcpHub.mobileNetworkOnly"));
      }
      if (resolved.installDraft.status === "needs_config") {
        setConfiguringCard(resolved);
        return;
      }
      const draft = withUniqueMcpServerId(resolved.installDraft, settings.mcp.servers);
      addServerFromStore(card, draft.server);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || t("mcpHub.storeInstallFailed"));
    } finally {
      setInstallingId(null);
    }
  }

  const currentSourceLabel =
    MCP_REGISTRY_SOURCE_OPTIONS.find((option) => option.value === source)?.label ?? source;

  return (
    <VStack height="100%" minHeight={0} gap={4}>
      <HStack
        as="form"
        width="100%"
        gap={2}
        wrap="wrap"
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch("replace");
        }}
      >
        <StackItem size="fill">
          <TextInput
            label={t("mcpHub.storeSearchPlaceholder")}
            isLabelHidden
            startIcon={Search}
            value={query}
            onChange={setQuery}
            placeholder={t("mcpHub.storeSearchPlaceholder")}
            hasClear
            width="100%"
          />
        </StackItem>
        <AstryxSelector
          label={t("mcpHub.tabStore")}
          isLabelHidden
          value={source}
          options={MCP_REGISTRY_SOURCE_OPTIONS}
          width="var(--xagent-hub-category-control-width)"
          onChange={(value) => setSource(value as McpRegistrySource)}
        />
        <AstryxCoreButton
          type="submit"
          label={t("mcpHub.storeSearch")}
          variant="primary"
          isLoading={loading}
          isDisabled={loading}
        />
        <IconButton
          label={t("mcpHub.storeRefresh")}
          tooltip={t("mcpHub.storeRefresh")}
          icon={<Icon icon={RefreshCw} size="sm" color="inherit" />}
          variant="ghost"
          isLoading={loading}
          isDisabled={loading || loadingMore}
          onClick={() => void runSearch("replace")}
        />
      </HStack>

      {error ? <Banner status="error" title={error} collapsible={false} /> : null}

      <Layout
        height="fill"
        padding={0}
        content={
          <LayoutContent ref={storeScrollRef} padding={0} isScrollable>
            <VStack width="100%" gap={4} paddingBlock={2}>
              {loading && items.length === 0 ? (
                <VStack gap={4} aria-busy="true">
                  <HStack gap={2} vAlign="center">
                    <Spinner size="sm" aria-label={t("mcpHub.storeLoadingTitle")} />
                    <Text color="secondary">
                      {t("mcpHub.storeLoadingDesc").replace("{source}", currentSourceLabel)}
                    </Text>
                  </HStack>
                  {STORE_SKELETON_IDS.map((id, index) => (
                    <HStack key={id} width="100%" gap={3} vAlign="center">
                      <Skeleton
                        width="var(--spacing-10)"
                        height="var(--spacing-10)"
                        radius="rounded"
                        index={index}
                      />
                      <VStack width="100%" gap={2}>
                        <Skeleton width="35%" height="var(--spacing-4)" index={index} />
                        <Skeleton width="80%" height="var(--spacing-3)" index={index} />
                      </VStack>
                    </HStack>
                  ))}
                </VStack>
              ) : groupedItems.length > 0 ? (
                <Grid columns={{ minWidth: 400, max: 2, repeat: "fit" }} gap={2} width="100%">
                  {groupedItems.map((group) => (
                    <RegistryCard
                      key={group.id}
                      group={group}
                      installedIdForCard={installedIdForCard}
                      installingId={installingId}
                      onPreview={setPreviewCard}
                      onInstall={(next) => void installCard(next)}
                    />
                  ))}
                </Grid>
              ) : (
                <EmptyState
                  title={t("mcpHub.storeEmptyTitle")}
                  description={t("mcpHub.storeEmptyDesc")}
                  icon={<Icon icon={Terminal} size="lg" color="secondary" />}
                  actions={
                    <AstryxCoreButton
                      label={t("mcpHub.storeRefresh")}
                      variant="secondary"
                      onClick={() => void runSearch("replace")}
                    />
                  }
                />
              )}

              {nextCursor && items.length > 0 ? (
                <HStack ref={loadMoreSentinelRef} width="100%" hAlign="center" padding={2}>
                  {loadingMore ? (
                    <Spinner size="sm" label={t("mcpHub.storeLoadMore")} />
                  ) : (
                    <Text type="supporting" color="secondary">
                      {t("mcpHub.storeLoadMore")}
                    </Text>
                  )}
                </HStack>
              ) : null}
            </VStack>
          </LayoutContent>
        }
      />
      {previewCard ? (
        <McpRegistryPreviewDrawer
          card={previewCard}
          detail={previewDetail}
          loading={previewLoading}
          error={previewError}
          installedId={installedIdForCard(previewDetail ?? previewCard)}
          installing={installingId === previewCard.id}
          onClose={() => setPreviewCard(null)}
          onInstall={(next) => void installCard(next)}
        />
      ) : null}
      {configuringCard ? (
        <McpConfigureModal
          card={configuringCard}
          existingServers={settings.mcp.servers}
          allowStdio={allowStdio}
          onClose={() => setConfiguringCard(null)}
          onSave={(server) => {
            const uniqueServer = {
              ...server,
              id: createUniqueMcpServerId(
                server.id || configuringCard.name || configuringCard.displayName,
                settings.mcp.servers.map((item) => item.id),
              ),
            };
            addServerFromStore(configuringCard, uniqueServer);
          }}
        />
      ) : null}
    </VStack>
  );
}
