import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { useMemo, useState } from "react";
import { MoreHorizontal, Plug, Plus, Server } from "../../../components/icons";
import { useLocale } from "../../../i18n";
import { type AppSettings, type McpServerConfig, updateMcp } from "../../../lib/settings";
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

  return (
    <VStack as="section" gap={0} height="100%" minHeight={0}>
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
            onClick={() => setEditing({ mode: "add" })}
          />
        }
      />
      <MobileHubSearch value={query} onChange={setQuery} placeholder="Search MCP" />

      <HStack gap={2} hAlign="between" vAlign="center" paddingInline={5} paddingBlockStart={5}>
        <Heading level={2}>{t("mcpHub.tabInstalled")}</Heading>
        <Badge label={String(visibleServers.length)} />
      </HStack>

      <StackItem size="fill" isScrollable>
        <VStack gap={3} padding={3}>
          {visibleServers.length > 0 ? (
            <VStack gap={2}>
              {visibleServers.map(({ server, index }) => (
                <ClickableCard
                  key={`${server.id}:${index}`}
                  label={server.id}
                  onClick={() => setEditing({ mode: "edit", index, server })}
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
              actions={
                <Button
                  label={t("mcpHub.add")}
                  icon={<Plus />}
                  variant="primary"
                  onClick={() => setEditing({ mode: "add" })}
                />
              }
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
