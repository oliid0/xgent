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
import { type AppSettings, type McpServerConfig, updateMcp } from "../../../lib/settings";
import { presentationControls } from "../../../presentation/controls";
import { NativeSurface } from "../../../presentation/NativeSurface";
import { createNativePresentationTheme } from "../../../presentation/nativeTheme";
import type { PresentationNode } from "../../../presentation/types";
import { isApplePresentationRuntime } from "../../../runtime/applePresentation";
import { McpRegistryBrowser } from "../../mcp-hub/McpRegistryBrowser";
import { McpServerEditModal } from "../../mcp-hub/McpServersForm";
import { MobileHubHeader, MobileHubSearch } from "./MobileHubChrome";

type MobileMcpPageProps = {
  settings: AppSettings;
  setSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  onOpenSidebar: () => void;
  allowStdio: boolean;
  presentationMode?: "root" | "sheet";
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
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"installed" | "store">("installed");
  const [registrySource, setRegistrySource] = useState<McpRegistrySource>("official");
  const [registryItems, setRegistryItems] = useState<McpRegistryCard[]>([]);
  const [registryLoading, setRegistryLoading] = useState(false);
  const [registryError, setRegistryError] = useState("");
  const [installingCardId, setInstallingCardId] = useState("");
  const [addedCardIds, setAddedCardIds] = useState<string[]>([]);
  const [configuring, setConfiguring] = useState<{
    card: McpRegistryCard;
    draft: McpRegistryInstallDraft;
  } | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [nativeDraft, setNativeDraft] = useState<McpServerConfig | null>(null);
  const [nativeError, setNativeError] = useState("");

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
    addedCardIds.includes(card.id) ||
    props.settings.mcp.servers.some(
      (server) =>
        server.id === card.installDraft?.server.id || server.id === card.manualDraft?.server.id,
    );

  async function installRegistryCard(card: McpRegistryCard) {
    if (installingCardId || cardIsInstalled(card)) return;
    setInstallingCardId(card.id);
    setRegistryError("");
    try {
      const loaded = await resolveMcpRegistryInstallDraft(card);
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
        const ready = withUniqueMcpServerId(draft, props.settings.mcp.servers);
        props.setSettings((previous) =>
          updateMcp(previous, { servers: [...previous.mcp.servers, ready.server] }),
        );
        setAddedCardIds((ids) => [...ids, card.id]);
      }
    } catch (cause) {
      setRegistryError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setInstallingCardId("");
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
    props.setSettings((previous) =>
      updateMcp(previous, { servers: [...previous.mcp.servers, { ...configured.server, id }] }),
    );
    setAddedCardIds((ids) => [...ids, configuring.card.id]);
    setConfiguring(null);
    setRegistryError("");
  }

  const patchServer = (index: number, patch: Partial<McpServerConfig>) => {
    props.setSettings((prev) =>
      updateMcp(prev, {
        servers: prev.mcp.servers.map((server, currentIndex) =>
          currentIndex === index ? { ...server, ...patch } : server,
        ),
      }),
    );
  };

  const saveServer = (server: McpServerConfig) => {
    props.setSettings((prev) => {
      if (editing?.mode === "edit") {
        return updateMcp(prev, {
          servers: prev.mcp.servers.map((item, index) => (index === editing.index ? server : item)),
        });
      }
      return updateMcp(prev, { servers: [...prev.mcp.servers, server] });
    });
  };

  const suggestedServerName = () => {
    const existing = new Set(props.settings.mcp.servers.map((server) => server.id));
    let suffix = props.settings.mcp.servers.length + 1;
    while (existing.has(`MCP Server ${suffix}`)) suffix += 1;
    return `MCP Server ${suffix}`;
  };
  const openAdd = () => {
    setNativeError("");
    setNativeDraft({
      id: suggestedServerName(),
      enabled: true,
      transport: props.allowStdio ? "stdio" : "http",
      command: "",
      args: [],
      url: "",
      timeoutMs: 60_000,
    });
    setEditing({ mode: "add" });
  };
  const openEdit = (index: number, server: McpServerConfig) => {
    setNativeError("");
    setNativeDraft({ ...server, args: [...(server.args ?? [])] });
    setEditing({ mode: "edit", index, server });
  };
  const closeEditor = () => {
    setEditing(null);
    setNativeDraft(null);
    setNativeError("");
  };

  if (isApplePresentationRuntime()) {
    const root = presentationControls();
    if (props.presentationMode === "sheet") {
      root.handlers.set("close", {
        enabled: true,
        accepts: (value) => value === null,
        run: props.onOpenSidebar,
      });
    }
    const installedNodes: PresentationNode[] = visibleServers.map(({ server, index }) => ({
      id: `mcp-card:${index}`,
      kind: "Card",
      children: [
        {
          id: `mcp-card:${index}:summary`,
          kind: "HStack",
          children: [
            {
              id: `mcp-card:${index}:copy`,
              kind: "VStack",
              fill: true,
              children: [
                { id: `mcp-card:${index}:title`, kind: "Heading", text: server.id },
                {
                  id: `mcp-card:${index}:subtitle`,
                  kind: "Text",
                  text: serverSubtitle(server) || t("mcpHub.statusEmptyDesc"),
                  secondary: true,
                  maxLines: 2,
                },
                {
                  id: `mcp-card:${index}:transport`,
                  kind: "Badge",
                  label: server.transport.toUpperCase(),
                },
              ],
            },
            root.toggle(
              `mcp-card:${index}:enabled`,
              server.enabled ? t("settings.disable") : t("settings.enable"),
              server.enabled,
              (enabled) => patchServer(index, { enabled }),
            ),
          ],
        },
        root.action(`mcp-card:${index}:edit`, t("settings.edit"), () => openEdit(index, server)),
      ],
    }));
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
                  { id: `mcp-store:${card.id}:name`, kind: "Heading", text: card.displayName },
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
                text: "MCP",
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
              ],
              (value) => setView(value as "installed" | "store"),
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
    if (editing && nativeDraft) {
      const sheet = presentationControls();
      const patchDraft = (patch: Partial<McpServerConfig>) =>
        setNativeDraft((current) => (current ? { ...current, ...patch } : current));
      const commit = () => {
        const id = nativeDraft.id.trim();
        const endpoint =
          nativeDraft.transport === "stdio"
            ? (nativeDraft.command ?? "").trim()
            : (nativeDraft.url ?? "").trim();
        const duplicate = props.settings.mcp.servers.some(
          (server, index) =>
            server.id === id && (editing.mode !== "edit" || index !== editing.index),
        );
        if (!id || duplicate || !endpoint) {
          setNativeError(
            duplicate
              ? t("mcpHub.duplicateName")
              : nativeDraft.transport === "stdio"
                ? t("mcpHub.invalidCommand")
                : t("mcpHub.invalidUrl"),
          );
          return;
        }
        saveServer({
          ...nativeDraft,
          id,
          command: nativeDraft.transport === "stdio" ? endpoint : "",
          args:
            nativeDraft.transport === "stdio"
              ? (nativeDraft.args ?? []).map((arg) => arg.trim()).filter(Boolean)
              : [],
          url: nativeDraft.transport === "stdio" ? "" : endpoint,
        });
        closeEditor();
      };
      sheet.handlers.set("close", {
        enabled: true,
        accepts: (value) => value === null,
        run: closeEditor,
      });
      const editorNodes: PresentationNode[] = [
        ...(nativeError
          ? [
              {
                id: "mcp-editor-error",
                kind: "Banner" as const,
                label: nativeError,
                status: "error" as const,
              },
            ]
          : []),
        sheet.group("mcp-editor-connection", "MCP", [
          sheet.input("mcp-editor-id", t("mcpHub.serverName"), nativeDraft.id, (id) =>
            patchDraft({ id }),
          ),
          sheet.select(
            "mcp-editor-transport",
            t("mcpHub.transport"),
            nativeDraft.transport,
            [
              ...(props.allowStdio ? [{ value: "stdio", label: "STDIO" }] : []),
              { value: "http", label: "HTTP" },
              { value: "sse", label: "SSE" },
            ],
            (transport) => patchDraft({ transport: transport as McpServerConfig["transport"] }),
          ),
          ...(nativeDraft.transport === "stdio"
            ? [
                sheet.input(
                  "mcp-editor-command",
                  t("mcpHub.command"),
                  nativeDraft.command ?? "",
                  (command) => patchDraft({ command }),
                ),
                sheet.input(
                  "mcp-editor-args",
                  t("mcpHub.args"),
                  (nativeDraft.args ?? []).join(" "),
                  (args) => patchDraft({ args: args.split(/\s+/).filter(Boolean) }),
                ),
              ]
            : [
                sheet.input("mcp-editor-url", "URL", nativeDraft.url ?? "", (url) =>
                  patchDraft({ url }),
                ),
              ]),
          sheet.toggle("mcp-editor-enabled", t("settings.enable"), nativeDraft.enabled, (enabled) =>
            patchDraft({ enabled }),
          ),
        ]),
        {
          id: "mcp-editor-actions",
          kind: "HStack",
          children: [
            sheet.action("mcp-editor-cancel", t("settings.cancel"), closeEditor),
            { id: "mcp-editor-actions-space", kind: "Spacer" },
            ...(editing.mode === "edit"
              ? [
                  {
                    ...sheet.action("mcp-editor-delete", t("settings.delete"), () => {
                      props.setSettings((previous) =>
                        updateMcp(previous, {
                          servers: previous.mcp.servers.filter(
                            (_, index) => index !== editing.index,
                          ),
                        }),
                      );
                      closeEditor();
                    }),
                    destructive: true,
                  },
                ]
              : []),
            { ...sheet.action("mcp-editor-save", t("settings.save"), commit), prominent: true },
          ],
        },
      ];
      activeNodes = [
        ...(props.presentationMode === "sheet"
          ? [sheet.action("back", t("settings.close"), closeEditor)]
          : []),
        ...editorNodes,
      ];
      activeHandlers = sheet.handlers;
      activeTitle = editing.mode === "add" ? t("mcpHub.add") : nativeDraft.id;
      dismissAction = "close";
    }

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
      <NativeSurface
        document={{
          mode: props.presentationMode ?? "root",
          title: activeTitle,
          appearance: props.settings.theme,
          formFactor: "mobile",
          theme: createNativePresentationTheme(props.settings, true, "workspaceTools"),
          nodes: activeNodes,
          dismissAction,
        }}
        handlers={activeHandlers}
        onError={(error) =>
          configuring ? setRegistryError(String(error)) : setNativeError(String(error))
        }
      />
    );
  }

  if (view === "store") {
    return (
      <VStack as="section" gap={0} height="100%" minHeight={0} className="relative">
        <MobileHubHeader title="MCP" onOpenSidebar={props.onOpenSidebar} />
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
                      onChange={(enabled) => patchServer(index, { enabled })}
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
