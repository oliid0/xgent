import { Banner } from "@astryxdesign/core/Banner";
import { Button as AstryxCoreButton } from "@astryxdesign/core/Button";
import { Dialog } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, Layout, LayoutContent, VStack } from "@astryxdesign/core/Layout";
import { Link } from "@astryxdesign/core/Link";
import { List, ListItem } from "@astryxdesign/core/List";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector as AstryxSelector } from "@astryxdesign/core/Selector";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Spinner } from "@astryxdesign/core/Spinner";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Token } from "@astryxdesign/core/Token";
import { Button as AstryxButton } from "@xagent/ui/components/ui/button";
import {
  Heading as AstryxHeading,
  Inline as AstryxInline,
  Paragraph as AstryxParagraph,
  View as AstryxView,
} from "@xagent/ui/components/ui/view";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Globe2,
  Key,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Server,
  Shield,
  Sparkles,
  Terminal,
  X,
} from "../../components/icons";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
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
import { cn } from "../../lib/shared/utils";
import { SettingsModalShell } from "../settings/SettingsModalShell";

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

function sourceTone(_source: McpRegistrySource) {
  // Source label is rendered as a neutral frosted-glass chip; the text alone communicates the source.
  return "border-border/45 bg-background/70 text-foreground/75";
}

function transportTone(_transport: string) {
  return "bg-background/70 text-foreground/75 ring-border/45";
}

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
    <SettingsModalShell
      onClose={onClose}
      purpose="form"
      ariaLabel={t("mcpHub.storeConfigureTitle")}
    >
      <AstryxView
        as="form"
        onSubmit={handleSubmit}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="settings-modal-header flex items-center gap-3 border-b border-border/40 px-6 py-4"
        >
          <AstryxView
            layout="flex"
            direction="horizontal"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/55 bg-background/80 text-foreground/85 shadow-[0_1px_0_rgba(255,255,255,0.55)_inset] dark:border-white/[0.09] dark:bg-white/[0.06] dark:shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]"
          >
            <Sparkles className="h-5 w-5" />
          </AstryxView>
          <AstryxView layout="block" direction="horizontal" className="min-w-0 flex-1">
            <AstryxHeading level={2} className="text-base font-semibold">
              {t("mcpHub.storeConfigureTitle")}
            </AstryxHeading>
            <AstryxParagraph
              className="mt-0.5 truncate text-xs text-muted-foreground"
              title={card.displayName}
            >
              {t("mcpHub.storeConfigureSubtitle").replace("{name}", card.displayName)}
            </AstryxParagraph>
          </AstryxView>
          <AstryxButton
            type="button"
            onClick={onClose}
            title={t("settings.cancel")}
            aria-label={t("settings.cancel")}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </AstryxButton>
        </AstryxView>

        <AstryxView
          layout="block"
          direction="horizontal"
          className="settings-modal-body flex-1 overflow-y-auto px-6 py-5"
        >
          <AstryxView layout="block" direction="horizontal" className="space-y-5">
            <AstryxView layout="grid" direction="horizontal" className="grid gap-3 sm:grid-cols-3">
              <AstryxView
                layout="block"
                direction="horizontal"
                className="space-y-1.5 sm:col-span-1"
              >
                <Label htmlFor="mcp-store-config-id" className="text-xs text-muted-foreground">
                  {t("mcpHub.serverName")}
                </Label>
                <Input
                  id="mcp-store-config-id"
                  value={draft.id}
                  placeholder={t("mcpHub.serverNamePlaceholder")}
                  onChange={(event) => updateDraft({ id: event.currentTarget.value })}
                />
              </AstryxView>
              <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
                <Label
                  htmlFor="mcp-store-config-transport"
                  className="text-xs text-muted-foreground"
                >
                  {t("mcpHub.transport")}
                </Label>
                <Select
                  value={draft.transport}
                  onValueChange={(value) => {
                    const transport = value === "http" ? "http" : value === "sse" ? "sse" : "stdio";
                    updateDraft({ transport });
                  }}
                >
                  <SelectTrigger id="mcp-store-config-transport">
                    <SelectValue placeholder={t("mcpHub.selectTransport")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stdio" disabled={!allowStdio}>
                      {t("mcpHub.stdio")}
                    </SelectItem>
                    <SelectItem value="http">{t("mcpHub.http")}</SelectItem>
                    <SelectItem value="sse">{t("mcpHub.sse")}</SelectItem>
                  </SelectContent>
                </Select>
              </AstryxView>
              <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
                <Label htmlFor="mcp-store-config-timeout" className="text-xs text-muted-foreground">
                  {t("mcpHub.timeout")}
                </Label>
                <Input
                  id="mcp-store-config-timeout"
                  type="number"
                  value={draft.timeoutMs}
                  placeholder="60000"
                  onChange={(event) => updateDraft({ timeoutMs: event.currentTarget.value })}
                />
              </AstryxView>
            </AstryxView>

            {isStdio ? (
              <AstryxView
                layout="block"
                direction="horizontal"
                className="space-y-3 rounded-xl border border-border/45 bg-muted/20 p-4"
              >
                <AstryxView
                  layout="grid"
                  direction="horizontal"
                  className="grid gap-3 sm:grid-cols-2"
                >
                  <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
                    <Label
                      htmlFor="mcp-store-config-command"
                      className="text-xs text-muted-foreground"
                    >
                      {t("mcpHub.command")}
                    </Label>
                    <Input
                      id="mcp-store-config-command"
                      value={draft.command}
                      placeholder="npx"
                      className="font-mono text-[12.5px]"
                      onChange={(event) => updateDraft({ command: event.currentTarget.value })}
                    />
                  </AstryxView>
                  <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
                    <Label htmlFor="mcp-store-config-cwd" className="text-xs text-muted-foreground">
                      {t("mcpHub.cwd")}
                    </Label>
                    <Input
                      id="mcp-store-config-cwd"
                      value={draft.cwd}
                      placeholder={t("mcpHub.cwdDefault")}
                      className="font-mono text-[12.5px]"
                      onChange={(event) => updateDraft({ cwd: event.currentTarget.value })}
                    />
                  </AstryxView>
                </AstryxView>
                <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
                  <Label htmlFor="mcp-store-config-args" className="text-xs text-muted-foreground">
                    {t("mcpHub.args")}
                  </Label>
                  <Textarea
                    id="mcp-store-config-args"
                    value={draft.argsText}
                    placeholder={"-y\n@modelcontextprotocol/server-time"}
                    className="min-h-[92px] font-mono text-[12.5px]"
                    onChange={(event) => updateDraft({ argsText: event.currentTarget.value })}
                  />
                </AstryxView>
                <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
                  <Label htmlFor="mcp-store-config-env" className="text-xs text-muted-foreground">
                    {t("mcpHub.env")}
                  </Label>
                  <Textarea
                    id="mcp-store-config-env"
                    value={draft.envText}
                    placeholder={"BRAVE_API_KEY=...\nHTTP_PROXY=..."}
                    className="min-h-[92px] font-mono text-[12.5px]"
                    onChange={(event) => updateDraft({ envText: event.currentTarget.value })}
                  />
                </AstryxView>
              </AstryxView>
            ) : (
              <AstryxView
                layout="block"
                direction="horizontal"
                className="space-y-3 rounded-xl border border-border/45 bg-muted/20 p-4"
              >
                <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
                  <Label htmlFor="mcp-store-config-url" className="text-xs text-muted-foreground">
                    {draft.transport === "http" ? t("mcpHub.urlHttp") : t("mcpHub.urlSse")}
                  </Label>
                  <Input
                    id="mcp-store-config-url"
                    value={draft.url}
                    placeholder={
                      draft.transport === "http"
                        ? "http://127.0.0.1:3000/mcp"
                        : "http://127.0.0.1:3000/sse"
                    }
                    className="font-mono text-[12.5px]"
                    onChange={(event) => updateDraft({ url: event.currentTarget.value })}
                  />
                </AstryxView>
                {isSse ? (
                  <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
                    <Label
                      htmlFor="mcp-store-config-message-url"
                      className="text-xs text-muted-foreground"
                    >
                      {t("mcpHub.messageUrl")}
                    </Label>
                    <Input
                      id="mcp-store-config-message-url"
                      value={draft.messageUrl}
                      placeholder="http://127.0.0.1:3000/message"
                      className="font-mono text-[12.5px]"
                      onChange={(event) => updateDraft({ messageUrl: event.currentTarget.value })}
                    />
                  </AstryxView>
                ) : null}
                <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
                  <Label
                    htmlFor="mcp-store-config-headers"
                    className="text-xs text-muted-foreground"
                  >
                    {t("mcpHub.headers")}
                  </Label>
                  <Textarea
                    id="mcp-store-config-headers"
                    value={draft.headersText}
                    placeholder={"Authorization=Bearer ...\nX-API-Key=..."}
                    className="min-h-[92px] font-mono text-[12.5px]"
                    onChange={(event) => updateDraft({ headersText: event.currentTarget.value })}
                  />
                </AstryxView>
              </AstryxView>
            )}

            {requiredConfig.length > 0 ? (
              <AstryxView
                layout="block"
                direction="horizontal"
                className="space-y-3 rounded-xl border border-border/50 bg-background/65 p-4 backdrop-blur-md"
              >
                <AstryxView layout="block" direction="horizontal">
                  <AstryxView
                    layout="block"
                    direction="horizontal"
                    className="text-sm font-semibold"
                  >
                    {t("mcpHub.storeConfigureRequiredTitle")}
                  </AstryxView>
                  <AstryxParagraph className="mt-1 text-xs text-muted-foreground">
                    {t("mcpHub.storeConfigureRequiredDesc")}
                  </AstryxParagraph>
                </AstryxView>
                <AstryxView
                  layout="grid"
                  direction="horizontal"
                  className="grid gap-3 sm:grid-cols-2"
                >
                  {requiredConfig.map((input) => {
                    const key = mcpRegistryConfigInputKey(input);
                    return (
                      <AstryxView
                        layout="block"
                        direction="horizontal"
                        key={key}
                        className="space-y-1.5"
                      >
                        <Label
                          htmlFor={`mcp-store-config-${key}`}
                          className="text-xs text-muted-foreground"
                        >
                          {input.label ?? input.name}
                        </Label>
                        <Input
                          id={`mcp-store-config-${key}`}
                          type={input.secret ? "password" : "text"}
                          value={draft.configValues[key] ?? ""}
                          placeholder={input.name}
                          onChange={(event) => updateConfigValue(input, event.currentTarget.value)}
                        />
                        <AstryxView
                          layout="flex"
                          direction="horizontal"
                          className="flex items-start gap-1.5 text-[10.5px] text-muted-foreground/75"
                        >
                          <AstryxInline className="rounded bg-background/60 px-1.5 py-0.5 font-mono">
                            {configTargetLabel(input, t)}
                          </AstryxInline>
                          {input.description ? (
                            <AstryxInline>{input.description}</AstryxInline>
                          ) : null}
                        </AstryxView>
                      </AstryxView>
                    );
                  })}
                </AstryxView>
              </AstryxView>
            ) : null}

            {formError ? (
              <AstryxView
                layout="flex"
                direction="horizontal"
                className="flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/[0.06] px-3 py-2.5 text-xs text-destructive"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <AstryxInline>{formError}</AstryxInline>
              </AstryxView>
            ) : null}
          </AstryxView>
        </AstryxView>

        <AstryxView
          layout="flex"
          direction="horizontal"
          className="settings-modal-footer settings-modal-footer-row flex items-center justify-end gap-2 border-t border-border/40 px-6 py-4"
        >
          <Button type="button" variant="outline" onClick={onClose}>
            {t("settings.cancel")}
          </Button>
          <Button type="submit" className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            {t("mcpHub.storeConfigureSubmit")}
          </Button>
        </AstryxView>
      </AstryxView>
    </SettingsModalShell>
  );
}

function ConfigChips({ card }: { card: McpRegistryCard }) {
  const inputs = configureDraftForCard(card)?.requiredConfig ?? [];
  if (inputs.length === 0) return null;
  return (
    <HStack gap={1} wrap="wrap">
      {inputs.slice(0, 5).map((input) => (
        <Token
          key={`${input.target}:${input.name}`}
          label={input.name}
          description={input.description ?? input.name}
          size="sm"
          icon={input.secret ? <Icon icon={Key} size="sm" color="inherit" /> : undefined}
        />
      ))}
      {inputs.length > 5 ? <Token label={`+${inputs.length - 5}`} size="sm" /> : null}
    </HStack>
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
  const transports = configureDraft ? [configureDraft.server.transport] : card.transportHints;
  const link = primaryRegistryLink(card);
  const versionOptions = group.cards.map((item) => ({
    value: item.id,
    label: versionLabelForCard(item) ?? t("mcpHub.storeVersionLatest"),
  }));
  const hasVersionSelector = versionOptions.length > 1;

  return (
    <ListItem
      label={card.displayName}
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
          <HStack gap={1} wrap="wrap">
            <Token label={card.source} size="sm" />
            {card.verified ? (
              <Token
                label={t("mcpHub.storePreviewVerified")}
                color="green"
                size="sm"
                icon={<Icon icon={Shield} size="sm" color="inherit" />}
              />
            ) : null}
            {transports.map((transport) => (
              <Token key={transport} label={transport.toUpperCase()} color="blue" size="sm" />
            ))}
            {card.tags.slice(0, 3).map((tag) => (
              <Token key={tag} label={tag} size="sm" />
            ))}
          </HStack>
          {configureDraft?.commandPreview ? (
            <Text type="code" color="secondary">
              {configureDraft.commandPreview}
            </Text>
          ) : null}
          <ConfigChips card={card} />
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
          {link ? (
            <AstryxCoreButton
              href={link}
              target="_blank"
              rel="noreferrer"
              label={t("mcpHub.storeOpenExternal")}
              tooltip={t("mcpHub.storeOpenExternal")}
              icon={<Icon icon={ExternalLink} size="sm" color="inherit" />}
              isIconOnly
              variant="ghost"
              size="sm"
            />
          ) : null}
          <AstryxCoreButton
            label={done ? t("mcpHub.storeInstalled") : t(installLabelKey(card))}
            icon={<Icon icon={done ? Check : Sparkles} size="sm" color="inherit" />}
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
      <AstryxView as="aside" className="flex h-full w-full flex-col">
        <AstryxView
          layout="flex"
          direction="vertical"
          className="flex flex-col gap-2.5 border-b border-border/40 px-5 py-4"
        >
          <AstryxView layout="flex" direction="horizontal" className="flex items-center gap-3">
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-border/55 bg-background/80 text-foreground/85 shadow-[0_1px_0_rgba(255,255,255,0.55)_inset] dark:border-white/[0.09] dark:bg-white/[0.06] dark:shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]"
            >
              {data.remote ? <Globe2 className="h-5 w-5" /> : <Server className="h-5 w-5" />}
            </AstryxView>
            <AstryxView layout="block" direction="horizontal" className="min-w-0 flex-1">
              <AstryxView
                layout="block"
                direction="horizontal"
                className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground/80"
              >
                {t("mcpHub.storePreviewTitle")}
              </AstryxView>
              <AstryxHeading
                level={2}
                className="mt-0.5 truncate text-[15px] font-semibold tracking-tight text-foreground"
              >
                {data.displayName}
              </AstryxHeading>
            </AstryxView>
            <AstryxButton
              type="button"
              onClick={onClose}
              title={t("settings.cancel")}
              aria-label={t("settings.cancel")}
              className="flex h-8 w-8 shrink-0 items-center justify-center self-start rounded-full text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </AstryxButton>
          </AstryxView>
          <AstryxView
            layout="flex"
            direction="horizontal"
            className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground"
          >
            <AstryxView
              as="span"
              layout="inline-flex"
              direction="horizontal"
              className={cn("inline-flex rounded-md border px-1.5 py-0.5", sourceTone(data.source))}
            >
              {data.source}
            </AstryxView>
            {transports.map((transport) => (
              <AstryxView
                as="span"
                layout="inline-flex"
                direction="horizontal"
                key={transport}
                className={cn(
                  "inline-flex rounded-md px-1.5 py-0.5 font-semibold uppercase ring-1",
                  transportTone(transport),
                )}
              >
                {transport}
              </AstryxView>
            ))}
            {data.verified ? (
              <AstryxView
                as="span"
                layout="inline-flex"
                direction="horizontal"
                className="inline-flex items-center gap-1 text-foreground/75"
              >
                <Shield className="h-3 w-3" />
                {t("mcpHub.storePreviewVerified")}
              </AstryxView>
            ) : null}
          </AstryxView>
        </AstryxView>

        <AstryxView
          layout="block"
          direction="horizontal"
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
        >
          <AstryxView layout="flex" direction="vertical" className="flex flex-col gap-4">
            <AstryxParagraph className="text-[13px] leading-6 text-muted-foreground">
              {data.description || t("mcpHub.storeNoDescription")}
            </AstryxParagraph>

            <AstryxView layout="grid" direction="horizontal" className="grid grid-cols-2 gap-2">
              <McpPreviewMetric label={t("mcpHub.storePreviewSource")} value={data.source} />
              <McpPreviewMetric
                label={t("mcpHub.storePreviewMode")}
                value={data.remote ? t("mcpHub.storePreviewRemote") : t("mcpHub.storePreviewLocal")}
              />
            </AstryxView>

            {loading ? (
              <AstryxView
                layout="block"
                direction="horizontal"
                className="space-y-2 rounded-2xl border border-border/35 bg-background/60 p-3"
              >
                <AstryxView
                  layout="flex"
                  direction="horizontal"
                  className="flex items-center gap-2 text-[12px] text-muted-foreground"
                >
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground/65" />
                  {t("mcpHub.storePreviewLoadingDetail")}
                </AstryxView>
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="skills-skeleton-shimmer h-3 w-full rounded"
                />
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="skills-skeleton-shimmer h-3 w-4/5 rounded"
                />
              </AstryxView>
            ) : null}

            {error ? (
              <AstryxView
                layout="block"
                direction="horizontal"
                className="rounded-2xl border border-border/40 bg-muted/35 p-3"
              >
                <AstryxView
                  layout="flex"
                  direction="horizontal"
                  className="flex items-start gap-2 text-[12px] text-muted-foreground"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/65" />
                  <AstryxInline>{t("mcpHub.storePreviewDetailUnavailable")}</AstryxInline>
                </AstryxView>
              </AstryxView>
            ) : null}

            {data.tags.length > 0 ? (
              <AstryxView
                layout="block"
                direction="horizontal"
                className="rounded-2xl border border-border/40 bg-background/60 p-3"
              >
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="mb-2 text-[12px] font-semibold text-foreground"
                >
                  {t("mcpHub.storePreviewTags")}
                </AstryxView>
                <AstryxView layout="flex" direction="horizontal" className="flex flex-wrap gap-1.5">
                  {data.tags.map((tag) => (
                    <AstryxInline
                      key={tag}
                      className="rounded-md bg-muted/55 px-1.5 py-0.5 text-[10.5px] text-muted-foreground ring-1 ring-border/30"
                    >
                      {tag}
                    </AstryxInline>
                  ))}
                </AstryxView>
              </AstryxView>
            ) : null}

            <AstryxView
              layout="block"
              direction="horizontal"
              className="rounded-2xl border border-border/40 bg-background/60 p-3"
            >
              <AstryxView
                layout="block"
                direction="horizontal"
                className="mb-2 text-[12px] font-semibold text-foreground"
              >
                {t("mcpHub.storePreviewInstallPreview")}
              </AstryxView>
              {draft?.commandPreview ? (
                <code className="mb-2 block max-h-28 overflow-y-auto whitespace-pre-wrap break-all rounded-xl border border-border/35 bg-muted/35 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                  {draft.commandPreview}
                </code>
              ) : (
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="mb-2 rounded-xl border border-border/35 bg-muted/35 px-3 py-2 text-[12px] text-muted-foreground"
                >
                  {data.installUnavailableReason === "needs-manual-command"
                    ? t("mcpHub.storeNeedsCommand")
                    : t("mcpHub.storeManualOnly")}
                </AstryxView>
              )}
              <AstryxView
                layout="block"
                direction="horizontal"
                className="divide-y divide-border/30"
              >
                <McpPreviewField
                  label={t("mcpHub.serverName")}
                  value={server?.id ?? data.name}
                  mono
                />
                <McpPreviewField
                  label={t("mcpHub.transport")}
                  value={transports.length > 0 ? transports.join(", ") : null}
                />
                <McpPreviewField
                  label={t("mcpHub.timeout")}
                  value={server?.timeoutMs ? `${server.timeoutMs} ms` : null}
                />
                <McpPreviewField label={t("mcpHub.command")} value={server?.command} mono />
                <McpPreviewField
                  label={t("mcpHub.args")}
                  value={server?.args?.length ? server.args.join("\n") : null}
                  mono
                />
                <McpPreviewField
                  label={server?.transport === "sse" ? t("mcpHub.urlSse") : t("mcpHub.urlHttp")}
                  value={server?.url}
                  mono
                />
                <McpPreviewField label={t("mcpHub.messageUrl")} value={server?.messageUrl} mono />
                <McpPreviewField label={t("mcpHub.env")} value={keyListLabel(server?.env)} mono />
                <McpPreviewField
                  label={t("mcpHub.headers")}
                  value={keyListLabel(server?.headers)}
                  mono
                />
              </AstryxView>
            </AstryxView>

            <AstryxView
              layout="block"
              direction="horizontal"
              className="rounded-2xl border border-border/40 bg-background/60 p-3"
            >
              <AstryxView
                layout="block"
                direction="horizontal"
                className="mb-2 text-[12px] font-semibold text-foreground"
              >
                {t("mcpHub.storePreviewRequiredConfig")}
              </AstryxView>
              {requiredConfig.length > 0 ? (
                <AstryxView layout="block" direction="horizontal" className="space-y-2">
                  {requiredConfig.map((input) => (
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      key={mcpRegistryConfigInputKey(input)}
                      className="rounded-xl border border-border/35 bg-muted/25 px-3 py-2"
                    >
                      <AstryxView
                        layout="flex"
                        direction="horizontal"
                        className="flex min-w-0 items-center gap-2"
                      >
                        {input.secret ? (
                          <Key className="h-3.5 w-3.5 shrink-0 text-foreground/65" />
                        ) : null}
                        <AstryxInline className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
                          {input.label ?? input.name}
                        </AstryxInline>
                        <AstryxInline className="rounded-md bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground ring-1 ring-border/30">
                          {configTargetLabel(input, t)}
                        </AstryxInline>
                      </AstryxView>
                      {input.description ? (
                        <AstryxView
                          layout="block"
                          direction="horizontal"
                          className="mt-1 text-[11px] leading-4 text-muted-foreground"
                        >
                          {input.description}
                        </AstryxView>
                      ) : null}
                    </AstryxView>
                  ))}
                </AstryxView>
              ) : (
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="text-[12px] text-muted-foreground"
                >
                  {t("mcpHub.storePreviewNoRequiredConfig")}
                </AstryxView>
              )}
            </AstryxView>

            {warnings.length > 0 ? (
              <AstryxView
                layout="block"
                direction="horizontal"
                className="rounded-2xl border border-border/55 bg-background/65 p-3 backdrop-blur-md"
              >
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="mb-2 text-[12px] font-semibold text-foreground/85"
                >
                  {t("mcpHub.storePreviewWarnings")}
                </AstryxView>
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="space-y-1 text-[12px] text-muted-foreground"
                >
                  {warnings.map((warning) => (
                    <AstryxView layout="block" direction="horizontal" key={warning}>
                      {warning}
                    </AstryxView>
                  ))}
                </AstryxView>
              </AstryxView>
            ) : null}

            {links.length > 0 ? (
              <AstryxView
                layout="block"
                direction="horizontal"
                className="rounded-2xl border border-border/40 bg-background/60 p-3"
              >
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="mb-2 text-[12px] font-semibold text-foreground"
                >
                  {t("mcpHub.storePreviewLinks")}
                </AstryxView>
                <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
                  {links.map((link) => (
                    <Link
                      key={`${link.key}:${link.url}`}
                      href={link.url}
                      isExternalLink
                      isStandalone
                      className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                    >
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                      <AstryxInline className="shrink-0">{t(link.labelKey)}</AstryxInline>
                      <AstryxInline className="min-w-0 truncate font-mono text-[11px] opacity-70">
                        {link.url}
                      </AstryxInline>
                    </Link>
                  ))}
                </AstryxView>
              </AstryxView>
            ) : null}
          </AstryxView>
        </AstryxView>

        <AstryxView
          layout="flex"
          direction="horizontal"
          className="flex shrink-0 gap-2 border-t border-border/40 px-5 py-4"
        >
          {primaryLink ? (
            <Link href={primaryLink} isExternalLink isStandalone weight="semibold">
              {t("mcpHub.storeOpenExternal")}
            </Link>
          ) : null}
          <Button
            type="button"
            variant={installed || draft?.status === "needs_config" ? "outline" : "default"}
            size="sm"
            className={cn(
              "h-9 flex-1 gap-1.5 rounded-xl",
              installed && "border-border/55 bg-background/75 text-foreground/85 backdrop-blur-md",
            )}
            disabled={installed || installing}
            onClick={() => onInstall(data)}
          >
            {installing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : installed ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {actionLabel}
          </Button>
        </AstryxView>
      </AstryxView>
    </Dialog>
  );
}

function McpPreviewMetric(props: { label: string; value: string }) {
  return (
    <AstryxView
      layout="block"
      direction="horizontal"
      className="rounded-2xl border border-border/35 bg-background/60 px-3 py-2.5"
    >
      <AstryxView
        layout="block"
        direction="horizontal"
        className="text-[10.5px] text-muted-foreground"
      >
        {props.label}
      </AstryxView>
      <AstryxView
        layout="block"
        direction="horizontal"
        className="mt-1 truncate text-sm font-semibold text-foreground"
        title={props.value}
      >
        {props.value}
      </AstryxView>
    </AstryxView>
  );
}

function McpPreviewField(props: { label: string; value?: string | null; mono?: boolean }) {
  if (!props.value) return null;
  return (
    <AstryxView
      layout="grid"
      direction="horizontal"
      className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-2 text-[12px]"
    >
      <AstryxView layout="block" direction="horizontal" className="text-muted-foreground">
        {props.label}
      </AstryxView>
      <AstryxView
        layout="block"
        direction="horizontal"
        className={cn(
          "min-w-0 break-words text-foreground",
          props.mono && "whitespace-pre-wrap font-mono text-[11px]",
        )}
      >
        {props.value}
      </AstryxView>
    </AstryxView>
  );
}

export function McpRegistryBrowser(props: McpRegistryBrowserProps) {
  const { settings, setSettings, allowStdio = true } = props;
  const { t } = useLocale();
  const [source, setSource] = useState<McpRegistrySource>("official");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<McpRegistryCard[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
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
      if (mode === "append" && !cursor) return;
      if (mode === "append") {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        const result = await searchMcpRegistry({
          source,
          query,
          cursor,
          limit: STORE_PAGE_LIMIT,
        });
        setItems((prev) => (mode === "append" ? [...prev, ...result.items] : result.items));
        setNextCursor(result.nextCursor);
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
      }
    },
    [nextCursor, query, source, t],
  );

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
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch("replace");
        }}
      >
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
        <AstryxCoreButton
          type="submit"
          label={t("mcpHub.storeSearch")}
          icon={<Icon icon={Search} size="sm" color="inherit" />}
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

      <SegmentedControl
        label={t("mcpHub.tabStore")}
        value={source}
        size="sm"
        onChange={(value) => setSource(value as McpRegistrySource)}
      >
        {MCP_REGISTRY_SOURCE_OPTIONS.map((option) => (
          <SegmentedControlItem key={option.value} value={option.value} label={option.label} />
        ))}
      </SegmentedControl>

      {error ? <Banner status="error" title={error} collapsible={false} /> : null}

      <Layout
        height="fill"
        padding={0}
        content={
          <LayoutContent padding={0} isScrollable>
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
                <List density="balanced" hasDividers>
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
                </List>
              ) : (
                <EmptyState
                  title={t("mcpHub.storeEmptyTitle")}
                  description={t("mcpHub.storeEmptyDesc")}
                  icon={<Icon icon={Terminal} size="lg" color="secondary" />}
                  actions={
                    <AstryxCoreButton
                      label={t("mcpHub.storeRefresh")}
                      variant="secondary"
                      icon={<Icon icon={RefreshCw} size="sm" color="inherit" />}
                      onClick={() => void runSearch("replace")}
                    />
                  }
                />
              )}

              {nextCursor && items.length > 0 ? (
                <HStack width="100%" hAlign="center">
                  <AstryxCoreButton
                    label={t("mcpHub.storeLoadMore")}
                    variant="secondary"
                    size="sm"
                    isLoading={loadingMore}
                    isDisabled={loadingMore}
                    onClick={() => void runSearch("append")}
                  />
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
