import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Layout, LayoutContent, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { useState } from "react";

import { HubHeader } from "../../components/hub/HubChrome";
import { Cable, Cloud, Download, Server } from "../../components/icons";
import { useLocale } from "../../i18n";
import { type AppSettings, type McpServerConfig, updateMcp } from "../../lib/settings";
import { McpImportView } from "./McpImportView";
import { McpRegistryBrowser } from "./McpRegistryBrowser";
import { McpServerEditModal, McpServersForm } from "./McpServersForm";

type McpHubPageProps = {
  settings: AppSettings;
  setSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  isAgentMode: boolean;
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  onClose?: () => void;
  allowStdio?: boolean;
  embedded?: boolean;
};

type McpHubView = "installed" | "store" | "import";

type EditingState = { mode: "add" } | { mode: "edit"; idx: number; server: McpServerConfig };

export function McpHubPage(props: McpHubPageProps) {
  const { settings, setSettings, sidebarOpen, onOpenSidebar, onClose, embedded = false } = props;
  const { t } = useLocale();
  const [view, setView] = useState<McpHubView>("installed");
  const [editing, setEditing] = useState<EditingState | null>(null);

  const serverCount = settings.mcp.servers.length;
  const enabledCount = settings.mcp.servers.filter((server) => server.enabled).length;
  const ready = serverCount > 0;
  const panelId = `mcp-panel-${view}`;

  function openAdd() {
    setView("installed");
    setEditing({ mode: "add" });
  }

  function openEdit(server: McpServerConfig, idx: number) {
    setEditing({ mode: "edit", idx, server });
  }

  function handleModalSave(server: McpServerConfig) {
    setSettings((prev) => {
      if (editing?.mode === "edit") {
        const targetIdx = editing.idx;
        return updateMcp(prev, {
          servers: prev.mcp.servers.map((item, index) => (index === targetIdx ? server : item)),
        });
      }
      return updateMcp(prev, { servers: [...prev.mcp.servers, server] });
    });
  }

  const content =
    view === "installed" ? (
      <McpServersForm
        settings={settings}
        setSettings={setSettings}
        onAddServer={openAdd}
        onEditServer={openEdit}
      />
    ) : view === "store" ? (
      <McpRegistryBrowser
        settings={settings}
        setSettings={setSettings}
        allowStdio={props.allowStdio}
      />
    ) : (
      <McpImportView settings={settings} setSettings={setSettings} allowStdio={props.allowStdio} />
    );

  return (
    <>
      <Layout
        height="fill"
        padding={0}
        className={embedded ? "hub-page-embedded" : undefined}
        header={
          embedded ? undefined : (
            <HubHeader
              icon={<Icon icon={Cable} size="md" color="inherit" />}
              title="MCP Hub"
              subtitle={t("mcpHub.subtitle")}
              tone="violet"
              sidebarOpen={sidebarOpen}
              onOpenSidebar={onOpenSidebar}
              onClose={onClose}
            />
          )
        }
        content={
          <LayoutContent
            padding={embedded ? 2 : 5}
            isScrollable={false}
            label="MCP Hub"
            className="mcp-hub-content"
          >
            <VStack
              width="100%"
              height="100%"
              minHeight={0}
              maxWidth="var(--xagent-hub-content-max-width)"
              gap={embedded ? 3 : 4}
              style={{ marginInline: "auto" }}
            >
              <Banner
                status={ready ? "success" : "info"}
                title={ready ? t("mcpHub.statusReady") : t("mcpHub.statusEmpty")}
                description={
                  ready
                    ? `${enabledCount} / ${serverCount} ${t("mcpHub.enabled")}`
                    : t("mcpHub.statusEmptyDesc")
                }
                collapsible={false}
                endContent={
                  <Button
                    label={t("mcpHub.add")}
                    variant={ready ? "secondary" : "primary"}
                    size="md"
                    onClick={openAdd}
                  />
                }
              />

              <TabList
                value={view}
                onChange={(value) => setView(value as McpHubView)}
                role="tablist"
                hasDivider
                overflow="scroll"
              >
                <Tab
                  value="installed"
                  label={t("mcpHub.tabInstalled")}
                  panelId="mcp-panel-installed"
                  icon={<Icon icon={Server} size="sm" color="inherit" />}
                  endContent={serverCount > 0 ? <Badge label={serverCount} /> : undefined}
                />
                <Tab
                  value="store"
                  label={t("mcpHub.tabStore")}
                  panelId="mcp-panel-store"
                  icon={<Icon icon={Cloud} size="sm" color="inherit" />}
                />
                <Tab
                  value="import"
                  label={t("mcpHub.tabImport")}
                  panelId="mcp-panel-import"
                  icon={<Icon icon={Download} size="sm" color="inherit" />}
                />
              </TabList>

              <StackItem size="fill" style={{ minHeight: 0, overflow: "hidden" }}>
                <VStack
                  id={panelId}
                  role="tabpanel"
                  aria-label={
                    view === "installed"
                      ? t("mcpHub.tabInstalled")
                      : view === "store"
                        ? t("mcpHub.tabStore")
                        : t("mcpHub.tabImport")
                  }
                  width="100%"
                  height="100%"
                  minHeight={0}
                >
                  {content}
                </VStack>
              </StackItem>
            </VStack>
          </LayoutContent>
        }
      />

      {editing ? (
        <McpServerEditModal
          mode={editing.mode}
          initialServer={editing.mode === "edit" ? editing.server : null}
          existingServers={settings.mcp.servers}
          allowStdio={props.allowStdio}
          onClose={() => setEditing(null)}
          onSave={handleModalSave}
        />
      ) : null}
    </>
  );
}
