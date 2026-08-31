import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { DialogHeader } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Selector } from "@astryxdesign/core/Selector";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Token } from "@astryxdesign/core/Token";
import { isBrowserRuntime } from "@xgent/runtime";
import { type FormEvent, memo, useEffect, useMemo, useState } from "react";
import { ConfirmDeletePopover } from "../../components/astryx/ConfirmActionPopover";
import { ToolPolicyToggle } from "../../components/hub/ToolPolicyToggle";
import {
  Globe2,
  Pencil,
  Plug,
  Search,
  Server,
  Terminal,
  Trash2,
  Wifi,
} from "../../components/icons";
import { useLocale } from "../../i18n";
import {
  type AppSettings,
  type McpServerConfig,
  type ToolPolicy,
  updateMcp,
  updateSystem,
} from "../../lib/settings";
import { toolGroupPolicyKey, toolServerPolicyKey } from "../../lib/tools/toolPolicy";
import { SettingsModalShell } from "../settings/SettingsModalShell";

type SetMcpSettingsFn = (updater: (prev: AppSettings) => AppSettings) => void;

type McpServersFormProps = {
  settings: AppSettings;
  setSettings: SetMcpSettingsFn;
  onAddServer?: () => void;
  onEditServer?: (server: McpServerConfig, idx: number) => void;
};

type ServerDraft = {
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
};

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
      throw new Error(`${errorPrefix}${trimmed}`);
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!key || !value) {
      throw new Error(`${errorPrefix}${trimmed}`);
    }
    out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

function suggestServerName(existing: string[]): string {
  const taken = new Set(existing.map((id) => id.trim()).filter(Boolean));
  let idx = existing.length + 1;
  let name = `MCP Server ${idx}`;
  while (taken.has(name)) {
    idx += 1;
    name = `MCP Server ${idx}`;
  }
  return name;
}

function blankDraft(existingIds: string[]): ServerDraft {
  return {
    id: suggestServerName(existingIds),
    transport: "stdio",
    timeoutMs: "60000",
    command: "",
    cwd: "",
    argsText: "",
    envText: "",
    url: "",
    messageUrl: "",
    headersText: "",
  };
}

function draftFromServer(server: McpServerConfig): ServerDraft {
  const transport: McpServerConfig["transport"] = server.transport ?? "stdio";
  return {
    id: server.id,
    transport,
    timeoutMs: String(server.timeoutMs ?? 60_000),
    command: server.command ?? "",
    cwd: server.cwd ?? "",
    argsText: (server.args ?? []).join("\n"),
    envText: formatKeyValueRecord(server.env),
    url: server.url ?? "",
    messageUrl: server.messageUrl ?? "",
    headersText: formatKeyValueRecord(server.headers),
  };
}

function buildServerFromDraft(
  draft: ServerDraft,
  base: McpServerConfig | null,
  existingIds: string[],
  t: (key: string) => string,
): McpServerConfig {
  const id = draft.id.trim();
  if (!id) {
    throw new Error(t("mcpHub.invalidName"));
  }
  if (existingIds.includes(id)) {
    throw new Error(t("mcpHub.duplicateName"));
  }

  const parsedTimeout = Number(draft.timeoutMs);
  const timeoutMs =
    Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? Math.floor(parsedTimeout) : 60_000;

  if (draft.transport === "stdio") {
    const command = draft.command.trim();
    if (!command) {
      throw new Error(t("mcpHub.invalidCommand"));
    }
    return {
      ...(base ?? {}),
      id,
      enabled: base?.enabled ?? true,
      transport: "stdio",
      command,
      args: parseLineList(draft.argsText),
      cwd: draft.cwd.trim() || undefined,
      env: parseKeyValueDraft(draft.envText, `${t("mcpHub.invalidKeyValue")} `),
      url: "",
      messageUrl: undefined,
      headers: undefined,
      timeoutMs,
    };
  }

  const url = draft.url.trim();
  if (!url) {
    throw new Error(t("mcpHub.invalidUrl"));
  }
  return {
    ...(base ?? {}),
    id,
    enabled: base?.enabled ?? true,
    transport: draft.transport,
    command: "",
    args: [],
    url,
    messageUrl: draft.transport === "sse" ? draft.messageUrl.trim() || undefined : undefined,
    headers: parseKeyValueDraft(draft.headersText, `${t("mcpHub.invalidKeyValue")} `),
    cwd: undefined,
    env: undefined,
    timeoutMs,
  };
}

function transportMeta(transport: string) {
  if (transport === "http") {
    return { label: "HTTP", color: "blue", Icon: Globe2 } as const;
  }
  if (transport === "sse") {
    return { label: "SSE", color: "teal", Icon: Wifi } as const;
  }
  return { label: "STDIO", color: "gray", Icon: Terminal } as const;
}

const McpServerCard = memo(function McpServerCard(props: {
  server: McpServerConfig;
  idx: number;
  policy: ToolPolicy;
  setSettings: SetMcpSettingsFn;
  onEdit: () => void;
}) {
  const { server: serverConfig, idx, policy, setSettings, onEdit } = props;
  const { t } = useLocale();
  const transport = serverConfig.transport || "stdio";
  const isStdio = transport === "stdio";
  const isHttp = transport === "http";
  const meta = transportMeta(transport);
  const MetaIcon = meta.Icon;
  const enabled = serverConfig.enabled;

  const patchServer = (patch: Partial<McpServerConfig>) => {
    setSettings((prev) =>
      updateMcp(prev, {
        servers: prev.mcp.servers.map((item, index) =>
          index === idx ? { ...item, ...patch } : item,
        ),
      }),
    );
  };

  const argsCount = (serverConfig.args ?? []).filter(Boolean).length;
  const envCount = serverConfig.env ? Object.keys(serverConfig.env).length : 0;
  const headerCount = serverConfig.headers ? Object.keys(serverConfig.headers).length : 0;
  const previewLine = isStdio
    ? [serverConfig.command, ...(serverConfig.args ?? [])].filter(Boolean).join(" ")
    : serverConfig.url || "";
  const previewLabel = isStdio
    ? t("mcpHub.command")
    : isHttp
      ? t("mcpHub.urlHttp")
      : t("mcpHub.urlSse");

  const metadata = [
    argsCount > 0 ? `${t("mcpHub.previewArgs")} ${argsCount}` : null,
    envCount > 0 ? `${t("mcpHub.previewEnv")} ${envCount}` : null,
    headerCount > 0 ? `${t("mcpHub.previewHeaders")} ${headerCount}` : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <ListItem
      label={serverConfig.id || `Server ${idx + 1}`}
      startContent={<Icon icon={MetaIcon} size="md" color={enabled ? "primary" : "disabled"} />}
      description={
        <VStack gap={1}>
          <HStack gap={1} wrap="wrap">
            <Token label={meta.label} color={meta.color} size="sm" />
            {metadata.map((label) => (
              <Token key={label} label={label} size="sm" />
            ))}
          </HStack>
          <Text type="supporting" color="secondary">
            {previewLine
              ? `${previewLabel}: ${previewLine}`
              : isStdio
                ? t("mcpHub.invalidCommand")
                : t("mcpHub.storeConfigureUrlRequired")}
          </Text>
        </VStack>
      }
      endContent={
        <HStack gap={1} vAlign="center">
          <Switch
            label={enabled ? t("settings.disable") : t("settings.enable")}
            isLabelHidden
            size="sm"
            value={enabled}
            onChange={(value) => patchServer({ enabled: value })}
          />
          <ToolPolicyToggle
            value={policy}
            size="sm"
            ariaLabel={`${serverConfig.id} tool policy`}
            onChange={(next) =>
              setSettings((current) =>
                updateSystem(current, {
                  toolPolicies: {
                    ...(current.system.toolPolicies ?? {}),
                    [toolServerPolicyKey(serverConfig.id)]: next,
                  },
                }),
              )
            }
          />
          <IconButton
            label={t("settings.edit")}
            tooltip={t("settings.edit")}
            icon={<Icon icon={Pencil} size="sm" color="inherit" />}
            variant="ghost"
            size="sm"
            onClick={onEdit}
          />
          <ConfirmDeletePopover
            name={serverConfig.id || `Server ${idx + 1}`}
            onConfirm={() =>
              setSettings((prev) => {
                const next = updateMcp(prev, {
                  servers: prev.mcp.servers.filter((_, index) => index !== idx),
                });
                const toolPolicies = { ...(next.system.toolPolicies ?? {}) };
                delete toolPolicies[toolServerPolicyKey(serverConfig.id)];
                return updateSystem(next, { toolPolicies });
              })
            }
          >
            {(open) => (
              <IconButton
                label={t("settings.delete")}
                tooltip={t("settings.delete")}
                icon={<Icon icon={Trash2} size="sm" color="inherit" />}
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
});

export function McpServerEditModal(props: {
  mode: "add" | "edit";
  initialServer: McpServerConfig | null;
  existingServers: McpServerConfig[];
  allowStdio?: boolean;
  onClose: () => void;
  onSave: (server: McpServerConfig) => void;
}) {
  const { mode, initialServer, existingServers, allowStdio = true, onClose, onSave } = props;
  const { t } = useLocale();
  const browser = isBrowserRuntime();

  const existingIdsExcludingCurrent = useMemo(() => {
    return existingServers
      .filter((server) => mode !== "edit" || server.id !== initialServer?.id)
      .map((server) => server.id);
  }, [existingServers, initialServer, mode]);

  const initialDraft = useMemo(() => {
    const next = initialServer
      ? draftFromServer(initialServer)
      : blankDraft(existingIdsExcludingCurrent);
    return !allowStdio && !initialServer ? { ...next, transport: "http" as const } : next;
  }, [allowStdio, existingIdsExcludingCurrent, initialServer]);
  const [draft, setDraft] = useState<ServerDraft>(initialDraft);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(initialDraft);
    setFormError(null);
  }, [initialDraft]);

  function updateDraft(patch: Partial<ServerDraft>) {
    setFormError(null);
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function handleSubmit(event: FormEvent<HTMLElement>) {
    event.preventDefault();
    try {
      if (!allowStdio && draft.transport === "stdio") {
        throw new Error(t("mcpHub.mobileNetworkOnly"));
      }
      const server = buildServerFromDraft(draft, initialServer, existingIdsExcludingCurrent, t);
      onSave(server);
      onClose();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    }
  }

  const isStdio = draft.transport === "stdio";
  const isSse = draft.transport === "sse";
  const title = mode === "add" ? t("mcpHub.addTitle") : t("mcpHub.editTitle");
  const subtitleRaw =
    mode === "add"
      ? t("mcpHub.addSubtitle")
      : t("mcpHub.editSubtitle").replace("{name}", initialServer?.id ?? "");
  const submitLabel = mode === "add" ? t("mcpHub.modalAdd") : t("mcpHub.modalSave");

  return (
    <SettingsModalShell onClose={onClose} purpose="form" ariaLabel={title}>
      <VStack as="form" onSubmit={handleSubmit} height="100%" minHeight={0} gap={0}>
        <DialogHeader
          title={title}
          subtitle={subtitleRaw}
          startContent={<Icon icon={Plug} size="md" color="secondary" />}
          onOpenChange={() => onClose()}
        />
        <Layout
          height="fill"
          padding={0}
          content={
            <LayoutContent padding={5} isScrollable>
              <FormLayout direction="vertical">
                <FormLayout direction="horizontal">
                  <TextInput
                    label={t("mcpHub.serverName")}
                    description={t("mcpHub.serverNameHint")}
                    value={draft.id}
                    placeholder={t("mcpHub.serverNamePlaceholder")}
                    width="100%"
                    onChange={(value) => updateDraft({ id: value })}
                  />
                  <Selector
                    label={t("mcpHub.transport")}
                    value={draft.transport}
                    width="100%"
                    options={[
                      { value: "stdio", label: t("mcpHub.stdio"), disabled: !allowStdio },
                      { value: "http", label: t("mcpHub.http") },
                      { value: "sse", label: t("mcpHub.sse") },
                    ]}
                    onChange={(value) =>
                      updateDraft({
                        transport: value === "http" ? "http" : value === "sse" ? "sse" : "stdio",
                      })
                    }
                  />
                  <TextInput
                    label={t("mcpHub.timeout")}
                    value={draft.timeoutMs}
                    placeholder="60000"
                    width="100%"
                    onChange={(value) => updateDraft({ timeoutMs: value })}
                  />
                </FormLayout>

                {!allowStdio ? (
                  <Banner
                    status="warning"
                    title={t("mcpHub.mobileNetworkOnly")}
                    collapsible={false}
                  />
                ) : null}

                {isStdio ? (
                  <FormLayout direction="vertical">
                    <FormLayout direction="horizontal">
                      <TextInput
                        label={t("mcpHub.command")}
                        value={draft.command}
                        placeholder="npx"
                        width="100%"
                        onChange={(value) => updateDraft({ command: value })}
                      />
                      <TextInput
                        label={t("mcpHub.cwd")}
                        value={draft.cwd}
                        placeholder={t("mcpHub.cwdDefault")}
                        width="100%"
                        onChange={(value) => updateDraft({ cwd: value })}
                      />
                    </FormLayout>
                    <TextArea
                      label={t("mcpHub.args")}
                      value={draft.argsText}
                      placeholder={"-y\n@modelcontextprotocol/server-time"}
                      rows={4}
                      width="100%"
                      hasSpellCheck={false}
                      onChange={(value) => updateDraft({ argsText: value })}
                    />
                    <TextArea
                      label={t("mcpHub.env")}
                      value={draft.envText}
                      placeholder={"BRAVE_API_KEY=...\nHTTP_PROXY=..."}
                      rows={4}
                      width="100%"
                      hasSpellCheck={false}
                      isDisabled={browser}
                      disabledMessage={browser ? t("mcpHub.mobileNetworkOnly") : undefined}
                      onChange={(value) => updateDraft({ envText: value })}
                    />
                  </FormLayout>
                ) : (
                  <FormLayout direction="vertical">
                    <TextInput
                      label={draft.transport === "http" ? t("mcpHub.urlHttp") : t("mcpHub.urlSse")}
                      value={draft.url}
                      placeholder={
                        draft.transport === "http"
                          ? "http://127.0.0.1:3000/mcp"
                          : "http://127.0.0.1:3000/sse"
                      }
                      width="100%"
                      onChange={(value) => updateDraft({ url: value })}
                    />
                    {isSse ? (
                      <TextInput
                        label={t("mcpHub.messageUrl")}
                        value={draft.messageUrl}
                        placeholder="http://127.0.0.1:3000/message"
                        width="100%"
                        onChange={(value) => updateDraft({ messageUrl: value })}
                      />
                    ) : null}
                    <TextArea
                      label={t("mcpHub.headers")}
                      value={draft.headersText}
                      placeholder={"Authorization=Bearer ...\nX-API-Key=..."}
                      rows={4}
                      width="100%"
                      hasSpellCheck={false}
                      isDisabled={browser}
                      disabledMessage={browser ? t("mcpHub.mobileNetworkOnly") : undefined}
                      onChange={(value) => updateDraft({ headersText: value })}
                    />
                  </FormLayout>
                )}

                {formError ? <Banner status="error" title={formError} collapsible={false} /> : null}
              </FormLayout>
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider>
              <HStack width="100%" gap={2} hAlign="end">
                <Button
                  type="button"
                  label={t("settings.cancel")}
                  variant="secondary"
                  onClick={onClose}
                />
                <Button type="submit" label={submitLabel} variant="primary" />
              </HStack>
            </LayoutFooter>
          }
        />
      </VStack>
    </SettingsModalShell>
  );
}

export function McpServersForm(props: McpServersFormProps) {
  const { settings, setSettings, onAddServer, onEditServer } = props;
  const { t } = useLocale();
  const [filter, setFilter] = useState("");

  const servers = settings.mcp.servers;
  const groupPolicy = settings.system.toolPolicies?.[toolGroupPolicyKey("mcp")] ?? "allow";
  const serverCount = servers.length;

  const filtered = useMemo(() => {
    const text = filter.trim().toLowerCase();
    if (!text) return servers.map((server, idx) => ({ server, idx }));
    return servers
      .map((server, idx) => ({ server, idx }))
      .filter(({ server }) => {
        const haystack = [server.id, server.command, server.url, server.transport ?? ""]
          .join("\n")
          .toLowerCase();
        return haystack.includes(text);
      });
  }, [filter, servers]);

  const showFilter = serverCount > 4;

  return (
    <Layout
      height="fill"
      padding={0}
      content={
        <LayoutContent padding={0} isScrollable>
          <VStack width="100%" gap={4} paddingBlock={2}>
            {showFilter ? (
              <TextInput
                label={t("mcpHub.searchInstalled")}
                isLabelHidden
                startIcon={Search}
                type="text"
                value={filter}
                onChange={setFilter}
                placeholder={t("mcpHub.searchInstalled")}
                hasClear
                width="100%"
              />
            ) : null}

            {serverCount === 0 ? (
              <EmptyState
                title={t("mcpHub.noServers")}
                description={t("mcpHub.noServersHint")}
                icon={<Icon icon={Server} size="lg" color="secondary" />}
                actions={
                  onAddServer ? (
                    <Button label={t("mcpHub.add")} variant="secondary" onClick={onAddServer} />
                  ) : undefined
                }
              />
            ) : null}

            {filter.trim() && filtered.length === 0 && serverCount > 0 ? (
              <EmptyState
                title={t("mcpHub.noMatchInstalled")}
                icon={<Icon icon={Plug} size="lg" color="secondary" />}
                isCompact
              />
            ) : null}

            {filtered.length > 0 ? (
              <List density="balanced" hasDividers>
                {filtered.map(({ server, idx }) => (
                  <McpServerCard
                    key={idx}
                    server={server}
                    idx={idx}
                    policy={
                      settings.system.toolPolicies?.[toolServerPolicyKey(server.id)] ?? groupPolicy
                    }
                    setSettings={setSettings}
                    onEdit={() => onEditServer?.(server, idx)}
                  />
                ))}
              </List>
            ) : null}
          </VStack>
        </LayoutContent>
      }
    />
  );
}
