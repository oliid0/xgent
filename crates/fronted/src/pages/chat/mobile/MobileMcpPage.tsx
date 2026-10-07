import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { useEffect, useMemo, useState } from "react";
import { useConfirmDialog } from "../../../components/astryx/useConfirmDialog";
import { MoreHorizontal, Plug, Plus, Server } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import {
  applyMcpRegistryInstallConfig,
  MCP_REGISTRY_SOURCE_OPTIONS,
  type McpRegistryCard,
  type McpRegistryInstallDraft,
  type McpRegistrySource,
  mcpRegistryConfigInputKey,
  resolveMcpRegistryInstallDraft,
  searchMcpRegistry,
  selectMcpRegistryCardForHost,
  withUniqueMcpServerId,
} from "../../../lib/mcpRegistry";
import { removeMcpServer, saveMcpServer } from "../../../lib/mcpServerSettings";
import { isNativeMobileRuntime } from "../../../lib/runtimePlatform";
import {
  type AppSettings,
  type McpServerConfig,
  type ToolPolicy,
  updateSystem,
} from "../../../lib/settings";
import { applyMcpOpsToAppSettings } from "../../../lib/settings/mcpOps";
import { toolGroupPolicyKey } from "../../../lib/tools/toolPolicy";
import { presentationControls } from "../../../presentation/controls";
import { NativeMcpRegistryPreview } from "../../../presentation/NativeMcpRegistryPreview";
import { NativeSurface } from "../../../presentation/NativeSurface";
import { nativeMcpServerList } from "../../../presentation/nativeMcpServerList";
import { createNativePresentationTheme } from "../../../presentation/nativeTheme";
import type { PresentationNode } from "../../../presentation/types";
import { isApplePresentationRuntime } from "../../../runtime/applePresentation";
import { McpImportView } from "../../mcp-hub/McpImportView";
import { McpRegistryBrowser } from "../../mcp-hub/McpRegistryBrowser";
import { McpServerEditModal } from "../../mcp-hub/McpServersForm";
import { MobileHubHeader, MobileHubSearch } from "./MobileHubChrome";

type MobileMcpPageProps = {
  settings: AppSettings;
  setSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  onOpenSidebar: () => void;
  allowStdio: boolean;
  presentationMode?: "root" | "sheet";
  nativeSettingsSurfaceId?: string;
};

type EditingState = { mode: "add" } | { mode: "edit"; index: number; server: McpServerConfig };

function serverSubtitle(server: McpServerConfig) {
  if (server.transport === "stdio") {
    return [server.command, ...(server.args ?? [])].filter(Boolean).join(" ");
  }
  return server.url;
}

export function MobileMcpPage(props: MobileMcpPageProps) {
  const { t } = useLocale();
  const compact = isNativeMobileRuntime();
  const { confirm, dialog } = useConfirmDialog();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"installed" | "store" | "import">("installed");
  const [registrySource, setRegistrySource] = useState<McpRegistrySource>("official");
  const [registryItems, setRegistryItems] = useState<McpRegistryCard[]>([]);
  const [registryLoading, setRegistryLoading] = useState(false);
  const [registryError, setRegistryError] = useState("");
  const [installingCardId, setInstallingCardId] = useState("");
  const [installedServerIds, setInstalledServerIds] = useState<Record<string, string>>({});
  const [configuring, setConfiguring] = useState<{
    card: McpRegistryCard;
    draft: McpRegistryInstallDraft;
  } | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [nativeError, setNativeError] = useState("");
  const [previewCard, setPreviewCard] = useState<McpRegistryCard | null>(null);
  const [installScope] = useState(() => ({ active: true, busy: false, revision: 0 }));
  useEffect(() => {
    installScope.active = true;
    installScope.busy = false;
    setInstallingCardId("");
    return () => {
      installScope.active = false;
      installScope.busy = false;
      installScope.revision++;
    };
  }, [installScope, view]);

  const visibleServers = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return props.settings.mcp.servers.map((server, index) => ({ server, index }));
    return props.settings.mcp.servers
      .map((server, index) => ({ server, index }))
      .filter(({ server }) =>
        `${server.id}\n${server.transport}\n${serverSubtitle(server)}`
          .toLocaleLowerCase()
          .includes(needle),
      );
  }, [props.settings.mcp.servers, query]);

  useEffect(() => {
    if (view !== "store" || !isApplePresentationRuntime()) return;
    let active = true;
    const timer = window.setTimeout(
      () => {
        setRegistryLoading(true);
        setRegistryError("");
        void searchMcpRegistry({ source: registrySource, query: query.trim(), limit: 24 })
          .then((result) => {
            if (active) setRegistryItems(result.items);
          })
          .catch((cause) => {
            if (active) setRegistryError(cause instanceof Error ? cause.message : String(cause));
          })
          .finally(() => {
            if (active) setRegistryLoading(false);
          });
      },
      query.trim() ? 250 : 0,
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, registrySource, view]);

  const cardIsInstalled = (card: McpRegistryCard) =>
    props.settings.mcp.servers.some(
      (server) =>
        server.id === installedServerIds[card.id] ||
        server.id === card.installDraft?.server.id ||
        server.id === card.networkDraft?.server.id ||
        server.id === card.manualDraft?.server.id,
    );

  async function installRegistryCard(card: McpRegistryCard) {
    if (!installScope.active || installScope.busy || cardIsInstalled(card)) return;
    installScope.busy = true;
    const revision = ++installScope.revision;
    const current = () => installScope.active && installScope.revision === revision;
    setInstallingCardId(card.id);
    setRegistryError("");
    try {
      const loaded = await resolveMcpRegistryInstallDraft(card);
      if (!current()) return;
      const resolved = selectMcpRegistryCardForHost(loaded, props.allowStdio);
      setRegistryItems((items) => items.map((item) => (item.id === card.id ? loaded : item)));
      const draft = resolved.installDraft ?? resolved.manualDraft;
      if (!draft)
        throw new Error(resolved.installUnavailableReason || t("mcpHub.storeInstallUnavailable"));
      if (!props.allowStdio && draft.server.transport === "stdio")
        throw new Error(t("mcpHub.mobileNetworkOnly"));
      if (!resolved.installDraft || draft.status === "needs_config") {
        setConfiguring({
          card: resolved,
          draft: withUniqueMcpServerId(draft, props.settings.mcp.servers),
        });
        setConfigValues({});
      } else {
        let installedId = "";
        props.setSettings((previous) => {
          const ready = withUniqueMcpServerId(draft, previous.mcp.servers);
          installedId = ready.server.id;
          return applyMcpOpsToAppSettings(previous, [{ kind: "upsert", server: ready.server }]);
        });
        setInstalledServerIds((current) => ({ ...current, [card.id]: installedId }));
      }
    } catch (cause) {
      if (current()) setRegistryError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (current()) {
        installScope.busy = false;
        setInstallingCardId("");
      }
    }
  }

  function commitRegistryConfig() {
    if (!configuring) return;
    const id = configuring.draft.server.id.trim();
    if (!id || props.settings.mcp.servers.some((server) => server.id === id)) {
      setRegistryError(!id ? t("mcpHub.storeConfigureNameRequired") : t("mcpHub.duplicateName"));
      return;
    }
    const missing = configuring.draft.requiredConfig.find(
      (input) => input.required && !configValues[mcpRegistryConfigInputKey(input)]?.trim(),
    );
    if (missing) {
      setRegistryError(
        t("mcpHub.storeConfigureRequiredMissing").replace("{name}", missing.label || missing.name),
      );
      return;
    }
    const configured = applyMcpRegistryInstallConfig(configuring.draft, configValues);
    const endpoint =
      configured.server.transport === "stdio" ? configured.server.command : configured.server.url;
    if (!endpoint?.trim()) {
      setRegistryError(
        t(
          configured.server.transport === "stdio"
            ? "mcpHub.storeConfigureCommandRequired"
            : "mcpHub.storeConfigureUrlRequired",
        ),
      );
      return;
    }
    props.setSettings((previous) => saveMcpServer(previous, { ...configured.server, id }, null, t));
    setInstalledServerIds((current) => ({ ...current, [configuring.card.id]: id }));
    setConfiguring(null);
    setRegistryError("");
  }

  const patchServer = (serverId: string, patch: Partial<McpServerConfig>) => {
    props.setSettings((prev) =>
      applyMcpOpsToAppSettings(prev, [{ kind: "patch", serverId, patch }]),
    );
  };
  const saveServer = (server: McpServerConfig) => {
    props.setSettings((prev) =>
      saveMcpServer(prev, server, editing?.mode === "edit" ? editing.server.id : null, t),
    );
  };
  const openAdd = () => {
    setNativeError("");
    setEditing({ mode: "add" });
  };
  const openEdit = (index: number, server: McpServerConfig) => {
    setNativeError("");
    setEditing({ mode: "edit", index, server });
  };
  const closeEditor = () => {
    setEditing(null);
    setNativeError("");
  };
  const deleteServer = async (server: McpServerConfig) => {
    if (
      !(await confirm({
        title: t("settings.delete"),
        description: server.id,
        confirmLabel: t("settings.delete"),
        cancelLabel: t("settings.cancel"),
        tone: "destructive",
      }))
    )
      return;
    props.setSettings((prev) => removeMcpServer(prev, server.id));
  };

  if (isApplePresentationRuntime() && editing) {
    return (
      <McpServerEditModal
        key={editing.mode === "edit" ? editing.server.id : "add"}
        mode={editing.mode}
        initialServer={editing.mode === "edit" ? editing.server : null}
        existingServers={props.settings.mcp.servers}
        allowStdio={props.allowStdio}
        onClose={closeEditor}
        onSave={saveServer}
        nativeSettings={props.settings}
        nativeSurfaceId={props.nativeSettingsSurfaceId}
        presentationMode={props.presentationMode}
      />
    );
  }

  if (isApplePresentationRuntime() && !compact && view === "import") {
    return (
      <McpImportView
        settings={props.settings}
        setSettings={props.setSettings}
        allowStdio={props.allowStdio}
        nativeSurfaceId={props.nativeSettingsSurfaceId}
        presentationMode={props.presentationMode}
        onChangeView={setView}
        onOpenSidebar={props.onOpenSidebar}
      />
    );
  }

  if (isApplePresentationRuntime()) {
    const root = presentationControls();
    if (props.presentationMode === "sheet") {
      root.handlers.set("close", {
        enabled: true,
        accepts: (value) => value === null,
        run: props.onOpenSidebar,
      });
    }
    const setPolicy = (key: string, policy: ToolPolicy) =>
      props.setSettings((prev) =>
        updateSystem(prev, {
          toolPolicies: { ...(prev.system.toolPolicies ?? {}), [key]: policy },
        }),
      );
    const installedNodes = nativeMcpServerList({
      controls: root,
      settings: props.settings,
      servers: visibleServers,
      t,
      patch: patchServer,
      policy: setPolicy,
      edit: openEdit,
      remove: deleteServer,
    });
    const storeNodes: PresentationNode[] = registryItems.map((card): PresentationNode => {
      const installed = cardIsInstalled(card);
      const pending = installingCardId === card.id;
      return {
        id: `mcp-store:${card.id}`,
        kind: "Card",
        children: [
          {
            id: `mcp-store:${card.id}:row`,
            kind: "HStack",
            children: [
              {
                id: `mcp-store:${card.id}:copy`,
                kind: "VStack",
                fill: true,
                children: [
                  {
                    ...root.action(`mcp-store:${card.id}:preview`, card.displayName, () =>
                      setPreviewCard(card),
                    ),
                    kind: "NavigationRow",
                    icon: card.remote ? "network" : "server.rack",
                  },
                  {
                    id: `mcp-store:${card.id}:description`,
                    kind: "Text",
                    text: card.description,
                    secondary: true,
                    maxLines: 2,
                  },
                  { id: `mcp-store:${card.id}:source`, kind: "Badge", label: card.source },
                ],
              },
              {
                ...root.action(
                  `mcp-store:${card.id}:install`,
                  installed
                    ? t("mcpHub.storeInstalled")
                    : pending
                      ? t("mcpHub.storeInstalling")
                      : t("mcpHub.storeInstall"),
                  () => installRegistryCard(card),
                  !installed && !pending && !installingCardId,
                ),
                kind: "IconButton",
                icon: installed ? "checkmark" : "plus",
              },
            ],
          },
        ],
      };
    });
    const add = {
      ...root.action("mcp-add", t("mcpHub.add"), openAdd),
      kind: "IconButton" as const,
      icon: "plus",
      prominent: true,
    };
    const rootNodes: PresentationNode[] = [
      ...(props.presentationMode === "sheet"
        ? [root.action("back", t("settings.close"), props.onOpenSidebar)]
        : []),
      {
        id: "mcp-hub-layout",
        kind: "VStack",
        fill: true,
        children: [
          {
            id: "mcp-hub-toolbar",
            kind: "HStack",
            minHeight: 68,
            padding: 12,
            children: [
              {
                ...root.action("open-sidebar", t("tooltip.openSidebar"), props.onOpenSidebar),
                kind: "IconButton",
                icon: "xgent.sidebar",
                variant: "secondary",
              },
              {
                id: "mcp-hub-title",
                kind: "Heading",
                text: compact ? "MCP" : t("mcpHub.title"),
                fill: true,
                alignment: "center",
              },
              view === "installed" ? add : { id: "mcp-toolbar-end", kind: "Spacer", width: 44 },
            ],
          },
          {
            ...root.select(
              "mcp-view",
              "MCP",
              view,
              [
                { value: "installed", label: t("mcpHub.tabInstalled") },
                { value: "store", label: t("mcpHub.tabStore") },
                ...(!compact ? [{ value: "import", label: t("mcpHub.tabImport") }] : []),
              ],
              (value) => setView(value as "installed" | "store" | "import"),
            ),
            kind: "SegmentedControl",
            padding: 12,
          },
          {
            ...root.input("mcp-search", t("mcpHub.storeSearchPlaceholder"), query, setQuery),
            padding: 12,
          },
          ...(view === "store"
            ? [
                {
                  ...root.select(
                    "mcp-store-source",
                    t("mcpHub.tabStore"),
                    registrySource,
                    MCP_REGISTRY_SOURCE_OPTIONS,
                    (value) => setRegistrySource(value as McpRegistrySource),
                  ),
                  padding: 12,
                },
              ]
            : []),
          {
            id: "mcp-hub-section",
            kind: "HStack",
            padding: 16,
            children: [
              {
                id: "mcp-hub-section-title",
                kind: "Heading",
                text: t(view === "store" ? "mcpHub.tabStore" : "mcpHub.tabInstalled"),
              },
              { id: "mcp-hub-section-space", kind: "Spacer" },
              {
                id: "mcp-hub-count",
                kind: "Badge",
                label: String(view === "store" ? registryItems.length : visibleServers.length),
              },
            ],
          },
          ...(nativeError
            ? [
                {
                  id: "mcp-hub-error",
                  kind: "Banner" as const,
                  status: "error" as const,
                  label: nativeError,
                },
              ]
            : []),
          ...(view === "installed" && props.settings.mcp.servers.length > 0
            ? [
                {
                  ...root.select(
                    "mcp-group-policy",
                    t("settings.toolPermissionsTitle"),
                    props.settings.system.toolPolicies?.[toolGroupPolicyKey("mcp")] ?? "allow",
                    ["allow", "ask", "deny"].map((value) => ({
                      value,
                      label: t(`settings.toolPolicy.${value}`),
                    })),
                    (value) => setPolicy(toolGroupPolicyKey("mcp"), value as ToolPolicy),
                  ),
                  kind: "SegmentedControl" as const,
                  padding: 12,
                },
              ]
            : []),
          {
            id: "mcp-hub-content",
            kind: "ScrollView",
            fill: true,
            padding: 12,
            children:
              view === "store"
                ? [
                    ...(registryLoading
                      ? [
                          {
                            id: "mcp-store-loading",
                            kind: "Progress" as const,
                            label: t("app.loading"),
                          },
                        ]
                      : []),
                    ...(registryError
                      ? [
                          {
                            id: "mcp-store-error",
                            kind: "Banner" as const,
                            label: registryError,
                            status: "error" as const,
                          },
                        ]
                      : []),
                    ...storeNodes,
                    ...(!registryLoading && !registryError && storeNodes.length === 0
                      ? [
                          {
                            id: "mcp-store-empty",
                            kind: "EmptyState" as const,
                            label: t("mcpHub.storeEmptyTitle"),
                            text: t("mcpHub.storeEmptyDesc"),
                          },
                        ]
                      : []),
                  ]
                : installedNodes.length > 0
                  ? installedNodes
                  : [
                      {
                        id: "mcp-empty",
                        kind: "EmptyState",
                        icon: "ellipsis",
                        label: t("mcpHub.statusEmpty"),
                        text: t("mcpHub.statusEmptyDesc"),
                        children: [root.action("mcp-empty-add", t("mcpHub.add"), openAdd)],
                      },
                    ],
          },
        ],
      },
    ];

    let activeNodes = rootNodes;
    let activeHandlers = root.handlers;
    let activeTitle = "MCP";
    let dismissAction: string | undefined =
      props.presentationMode === "sheet" ? "close" : undefined;
    if (configuring) {
      const sheet = presentationControls();
      const patchServer = (patch: Partial<McpServerConfig>) =>
        setConfiguring((current) =>
          current
            ? {
                ...current,
                draft: { ...current.draft, server: { ...current.draft.server, ...patch } },
              }
            : current,
        );
      const close = () => {
        setConfiguring(null);
        setRegistryError("");
      };
      sheet.handlers.set("close", {
        enabled: true,
        accepts: (value) => value === null,
        run: close,
      });
      activeNodes = [
        ...(props.presentationMode === "sheet"
          ? [sheet.action("back", t("settings.close"), close)]
          : []),
        sheet.group("mcp-store-connection", t("mcpHub.storeConfigureTitle"), [
          sheet.input("mcp-store-id", t("mcpHub.serverName"), configuring.draft.server.id, (id) =>
            patchServer({ id }),
          ),
          configuring.draft.server.transport === "stdio"
            ? sheet.input(
                "mcp-store-command",
                t("mcpHub.command"),
                configuring.draft.server.command || "",
                (command) => patchServer({ command }),
              )
            : sheet.input("mcp-store-url", "URL", configuring.draft.server.url || "", (url) =>
                patchServer({ url }),
              ),
        ]),
        ...configuring.draft.requiredConfig.map((input) =>
          sheet.input(
            `mcp-store-config:${mcpRegistryConfigInputKey(input)}`,
            input.label || input.name,
            configValues[mcpRegistryConfigInputKey(input)] || "",
            (value) =>
              setConfigValues((current) => ({
                ...current,
                [mcpRegistryConfigInputKey(input)]: value,
              })),
            input.secret,
          ),
        ),
        ...(registryError
          ? [
              {
                id: "mcp-store-config-error",
                kind: "Banner" as const,
                label: registryError,
                status: "error" as const,
              },
            ]
          : []),
        {
          ...sheet.action(
            "mcp-store-config-save",
            t("mcpHub.storeConfigureSubmit"),
            commitRegistryConfig,
          ),
          prominent: true,
        },
        sheet.action("mcp-store-config-cancel", t("settings.cancel"), close),
      ];
      activeHandlers = sheet.handlers;
      activeTitle = t("mcpHub.storeConfigureTitle");
      dismissAction = "close";
    }

    return (
      <>
        {dialog}
        {previewCard && !configuring ? (
          <NativeMcpRegistryPreview
            key={previewCard.id}
            card={previewCard}
            settings={props.settings}
            compact={compact}
            allowStdio={props.allowStdio}
            installed={cardIsInstalled(previewCard)}
            installing={installingCardId === previewCard.id}
            installBusy={Boolean(installingCardId)}
            installError={registryError}
            close={() => {
              setPreviewCard(null);
              setRegistryError("");
            }}
            install={installRegistryCard}
          />
        ) : null}
        <NativeSurface
          sessionSurface={props.nativeSettingsSurfaceId}
          document={{
            mode: props.presentationMode ?? "root",
            title: activeTitle,
            appearance: props.settings.theme,
            formFactor: compact ? "mobile" : "desktop",
            theme: createNativePresentationTheme(props.settings, compact, "workspaceTools"),
            nodes: activeNodes,
            dismissAction,
          }}
          handlers={activeHandlers}
          onError={(error) =>
            configuring ? setRegistryError(String(error)) : setNativeError(String(error))
          }
        />
      </>
    );
  }

  if (view === "store") {
    return (
      <VStack as="section" gap={0} height="100%" minHeight={0} className="relative">
        <MobileHubHeader
          title="MCP"
          onOpenSidebar={props.onOpenSidebar}
          backToSettings={props.presentationMode === "sheet"}
          backLabel={t("settings.mobile.backToSettings")}
        />
        <HStack gap={2} paddingInline={4} paddingBlock={2}>
          <Button
            label={t("mcpHub.tabInstalled")}
            variant="secondary"
            onClick={() => setView("installed")}
          />
          <Button label={t("mcpHub.tabStore")} variant="primary" onClick={() => setView("store")} />
        </HStack>
        <StackItem size="fill" isScrollable>
          <VStack padding={3} minHeight={0}>
            <McpRegistryBrowser
              settings={props.settings}
              setSettings={props.setSettings}
              allowStdio={props.allowStdio}
            />
          </VStack>
        </StackItem>
      </VStack>
    );
  }

  return (
    <VStack as="section" gap={0} height="100%" minHeight={0} className="relative">
      <MobileHubHeader
        title="MCP"
        onOpenSidebar={props.onOpenSidebar}
        backToSettings={props.presentationMode === "sheet"}
        backLabel={t("settings.mobile.backToSettings")}
        trailing={
          <IconButton
            label={t("mcpHub.add")}
            tooltip={t("mcpHub.add")}
            icon={<Plus />}
            variant="primary"
            size="lg"
            onClick={openAdd}
          />
        }
      />
      <MobileHubSearch value={query} onChange={setQuery} placeholder="Search MCP" />
      <HStack gap={2} paddingInline={4} paddingBlock={2}>
        <Button
          label={t("mcpHub.tabInstalled")}
          variant="primary"
          onClick={() => setView("installed")}
        />
        <Button label={t("mcpHub.tabStore")} variant="secondary" onClick={() => setView("store")} />
      </HStack>

      <HStack gap={2} hAlign="between" vAlign="center" paddingInline={5} paddingBlockStart={5}>
        <Heading level={2}>{t("mcpHub.tabInstalled")}</Heading>
        <Badge label={String(visibleServers.length)} />
      </HStack>

      <StackItem size="fill" isScrollable>
        <VStack gap={3} padding={3} className="mobile-hub-scroll-content">
          {visibleServers.length > 0 ? (
            <VStack gap={2}>
              {visibleServers.map(({ server, index }) => (
                <ClickableCard
                  key={`${server.id}:${index}`}
                  label={server.id}
                  onClick={() => openEdit(index, server)}
                  padding={3}
                  width="100%"
                >
                  <HStack gap={3} vAlign="center">
                    {server.transport === "stdio" ? <Server /> : <Plug />}
                    <StackItem size="fill">
                      <VStack gap={1}>
                        <HStack gap={2} vAlign="center" wrap="wrap">
                          <Text type="body" weight="medium">
                            {server.id}
                          </Text>
                          <Token label={server.transport} size="sm" color="cyan" />
                        </HStack>
                        <Text type="supporting" color="secondary" maxLines={2}>
                          {serverSubtitle(server) || t("mcpHub.statusEmptyDesc")}
                        </Text>
                      </VStack>
                    </StackItem>
                    <Switch
                      label={server.enabled ? t("settings.disable") : t("settings.enable")}
                      isLabelHidden
                      value={server.enabled}
                      onChange={(enabled) => patchServer(server.id, { enabled })}
                      size="md"
                    />
                  </HStack>
                </ClickableCard>
              ))}
            </VStack>
          ) : (
            <EmptyState
              icon={<MoreHorizontal />}
              title={t("mcpHub.statusEmpty")}
              description={t("mcpHub.statusEmptyDesc")}
              actions={<Button label={t("mcpHub.add")} variant="primary" onClick={openAdd} />}
            />
          )}
        </VStack>
      </StackItem>

      {editing ? (
        <McpServerEditModal
          mode={editing.mode}
          initialServer={editing.mode === "edit" ? editing.server : null}
          existingServers={props.settings.mcp.servers}
          allowStdio={props.allowStdio}
          onClose={() => setEditing(null)}
          onSave={saveServer}
        />
      ) : null}
    </VStack>
  );
}
