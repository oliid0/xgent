import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { type ReactNode, useMemo, useState } from "react";
import { MoreHorizontal, Plug, Plus, Server } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import { type AppSettings, type McpServerConfig, updateMcp } from "../../../lib/settings";
import { presentationControls } from "../../../presentation/controls";
import { NativeSurface } from "../../../presentation/NativeSurface";
import { createNativePresentationTheme } from "../../../presentation/nativeTheme";
import type { PresentationNode } from "../../../presentation/types";
import { isApplePresentationRuntime } from "../../../runtime/applePresentation";
import { McpServerEditModal } from "../../mcp-hub/McpServersForm";
import { MobileHubHeader, MobileHubSearch } from "./MobileHubChrome";

type MobileMcpPageProps = {
  settings: AppSettings;
  setSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  onOpenSidebar: () => void;
  allowStdio: boolean;
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
    const mainNodes: PresentationNode[] = visibleServers.map(({ server, index }) => ({
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
    const add = {
      ...root.action("mcp-add", t("mcpHub.add"), openAdd),
      kind: "IconButton" as const,
      icon: "plus",
      prominent: true,
    };
    const rootNodes: PresentationNode[] = [
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
              add,
            ],
          },
          {
            ...root.input("mcp-search", "Search MCP", query, setQuery),
            padding: 12,
          },
          {
            id: "mcp-hub-section",
            kind: "HStack",
            padding: 16,
            children: [
              { id: "mcp-hub-section-title", kind: "Heading", text: t("mcpHub.tabInstalled") },
              { id: "mcp-hub-section-space", kind: "Spacer" },
              { id: "mcp-hub-count", kind: "Badge", label: String(visibleServers.length) },
            ],
          },
          {
            id: "mcp-hub-content",
            kind: "ScrollView",
            fill: true,
            padding: 12,
            children:
              mainNodes.length > 0
                ? mainNodes
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

    let editor: ReactNode = null;
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
      editor = (
        <NativeSurface
          document={{
            mode: "sheet",
            title: editing.mode === "add" ? t("mcpHub.add") : nativeDraft.id,
            appearance: props.settings.theme,
            formFactor: "mobile",
            theme: createNativePresentationTheme(props.settings, true, "workspaceTools"),
            nodes: editorNodes,
            dismissAction: "close",
          }}
          handlers={sheet.handlers}
          onError={(error) => setNativeError(String(error))}
        />
      );
    }

    return (
      <>
        <NativeSurface
          document={{
            mode: "root",
            title: "MCP",
            appearance: props.settings.theme,
            formFactor: "mobile",
            theme: createNativePresentationTheme(props.settings, true, "workspaceTools"),
            nodes: rootNodes,
          }}
          handlers={root.handlers}
          onError={(error) => setNativeError(String(error))}
        />
        {editor}
      </>
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
