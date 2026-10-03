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
import { type FormEvent, memo, useEffect, useMemo, useRef, useState } from "react";
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
  blankDraft,
  buildServerFromDraft,
  draftFromServer,
  type ServerDraft,
} from "../../lib/mcpServerDraft";
import { removeMcpServer } from "../../lib/mcpServerSettings";
import { isNativeMobileRuntime } from "../../lib/runtimePlatform";
import {
  type AppSettings,
  type McpServerConfig,
  type ToolPolicy,
  updateSystem,
} from "../../lib/settings";
import { applyMcpOpsToAppSettings } from "../../lib/settings/mcpOps";
import { toolGroupPolicyKey, toolServerPolicyKey } from "../../lib/tools/toolPolicy";
import { NativeSurface } from "../../presentation/NativeSurface";
import { nativeMcpServerEditor } from "../../presentation/nativeMcpServerEditor";
import { createNativePresentationTheme } from "../../presentation/nativeTheme";
import { isApplePresentationRuntime } from "../../runtime/applePresentation";
import { SettingsModalShell } from "../settings/SettingsModalShell";

type SetMcpSettingsFn = (updater: (prev: AppSettings) => AppSettings) => void;

type McpServersFormProps = {
  settings: AppSettings;
  setSettings: SetMcpSettingsFn;
  onAddServer?: () => void;
  onEditServer?: (server: McpServerConfig, idx: number) => void;
};

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
      applyMcpOpsToAppSettings(prev, [{ kind: "patch", serverId: serverConfig.id, patch }]),
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
            onConfirm={() => setSettings((prev) => removeMcpServer(prev, serverConfig.id))}
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
  nativeSettings?: AppSettings;
  nativeSurfaceId?: string;
  presentationMode?: "root" | "sheet";
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
  const latestDraft = useRef(draft);
  const [formError, setFormError] = useState<string | null>(null);
  const [scope] = useState(() => ({ active: true, busy: false }));

  useEffect(() => {
    scope.active = true;
    return () => {
      scope.active = false;
    };
  }, [scope]);

  function updateDraft(patch: Partial<ServerDraft>) {
    if (!scope.active || scope.busy) return;
    setFormError(null);
    latestDraft.current = { ...latestDraft.current, ...patch };
    setDraft(latestDraft.current);
  }

  function submit() {
    if (!scope.active || scope.busy) return;
    scope.busy = true;
    try {
      if (!allowStdio && latestDraft.current.transport === "stdio") {
        throw new Error(t("mcpHub.mobileNetworkOnly"));
      }
      const server = buildServerFromDraft(
        latestDraft.current,
        initialServer,
        existingIdsExcludingCurrent,
        t,
      );
      onSave(server);
      scope.active = false;
      onClose();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    } finally {
      scope.busy = false;
    }
  }

  function handleSubmit(event: FormEvent<HTMLElement>) {
    event.preventDefault();
    submit();
  }

  const isStdio = draft.transport === "stdio";
  const isSse = draft.transport === "sse";
  const title = mode === "add" ? t("mcpHub.addTitle") : t("mcpHub.editTitle");
  const subtitleRaw =
    mode === "add"
      ? t("mcpHub.addSubtitle")
      : t("mcpHub.editSubtitle").replace("{name}", initialServer?.id ?? "");
  const submitLabel = mode === "add" ? t("mcpHub.modalAdd") : t("mcpHub.modalSave");

  if (isApplePresentationRuntime() && props.nativeSettings) {
    const compact = isNativeMobileRuntime();
    const native = nativeMcpServerEditor({
      draft,
      update: updateDraft,
      allowStdio,
      browser,
      t,
      title,
      subtitle: subtitleRaw,
      submitLabel,
      error: formError,
      close: () => {
        if (scope.active) {
          scope.active = false;
          onClose();
        }
      },
      submit,
    });
    return (
      <NativeSurface
        sessionSurface={props.nativeSurfaceId}
        document={{
          mode: props.presentationMode ?? "root",
          title,
          appearance: props.nativeSettings.theme,
          formFactor: compact ? "mobile" : "desktop",
          theme: createNativePresentationTheme(props.nativeSettings, compact, "workspaceTools"),
          dismissAction: "close",
          nodes: native.nodes,
        }}
        handlers={native.handlers}
        onError={(error) => setFormError(String(error))}
      />
    );
  }

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
