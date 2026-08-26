import { useState } from "react";
import {
  HubBackdrop,
  HubHeader,
  HubSegmentedButton,
  HubSegmentedControl,
} from "../../components/hub/HubChrome";
import { Cable, Cloud, Download, Plug, Plus, Server, Sparkles } from "../../components/icons";
import { Button } from "../../components/ui/button";
import { useLocale } from "../../i18n";
import { type AppSettings, type McpServerConfig, updateMcp } from "../../lib/settings";
import { cn } from "../../lib/shared/utils";
import { McpImportView } from "./McpImportView";
import { McpRegistryBrowser } from "./McpRegistryBrowser";
import { McpServerEditModal, McpServersForm } from "./McpServersForm";
import { View as AstryxView, Inline as AstryxInline } from "@xagent/ui/components/ui/view";

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
  const statusHint = ready ? null : t("mcpHub.statusEmptyDesc");

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
      return updateMcp(prev, {
        servers: [...prev.mcp.servers, server],
      });
    });
  }

  return (
    <AstryxView
      layout="flex"
      direction="vertical"
      data-hub-embedded={embedded ? "true" : undefined}
      className={cn(
        "hub-page hub-page-enter relative flex h-full min-h-0 flex-1 flex-col overflow-hidden",
        embedded && "hub-page-embedded",
      )}
    >
      <HubBackdrop tone="violet" />

      <AstryxView
        layout="flex"
        direction="vertical"
        className="relative z-10 flex h-full min-h-0 flex-col overflow-hidden"
      >
        {!embedded ? (
          <HubHeader
            icon={<Cable className="h-5 w-5" />}
            title="MCP Hub"
            subtitle={t("mcpHub.subtitle")}
            tone="violet"
            sidebarOpen={sidebarOpen}
            onOpenSidebar={onOpenSidebar}
            onClose={onClose}
          />
        ) : null}

        <AstryxView
          layout="block"
          direction="horizontal"
          className="hub-scroll min-h-0 flex-1 overflow-hidden px-5 pb-6 pt-2 sm:px-6 lg:px-8 xl:px-10"
        >
          <AstryxView
            layout="flex"
            direction="vertical"
            className="hub-content-stage mx-auto flex h-full min-h-0 w-full max-w-[1320px] flex-col gap-4"
          >
            {/* Status banner */}
            <AstryxView
              layout="block"
              direction="horizontal"
              className={cn(
                "hub-status-panel hub-panel-enter relative overflow-hidden rounded-xl border bg-card",
                ready ? "border-border shadow-sm" : "border-border",
              )}
            >
              <AstryxView
                layout="flex"
                direction="horizontal"
                className="flex items-center gap-3 px-4 py-3.5 sm:gap-x-5 sm:px-5"
              >
                <AstryxView
                  layout="flex"
                  direction="horizontal"
                  className="flex min-w-0 flex-1 items-center gap-3 sm:gap-3.5"
                >
                  <AstryxView
                    layout="flex"
                    direction="horizontal"
                    className={cn(
                      "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors",
                      ready
                        ? "border-border bg-muted text-foreground"
                        : "border-border bg-muted text-muted-foreground",
                    )}
                  >
                    <Plug className="h-5 w-5" />
                    {ready && enabledCount > 0 ? (
                      <AstryxInline className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />
                    ) : null}
                  </AstryxView>
                  <AstryxView layout="block" direction="horizontal" className="min-w-0 flex-1">
                    <AstryxView
                      layout="flex"
                      direction="horizontal"
                      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
                    >
                      <AstryxView
                        layout="block"
                        direction="horizontal"
                        className="text-[13.5px] font-semibold tracking-tight text-foreground"
                      >
                        {ready ? t("mcpHub.statusReady") : t("mcpHub.statusEmpty")}
                      </AstryxView>
                      {ready ? (
                        <AstryxView
                          as="span"
                          layout="inline-flex"
                          direction="horizontal"
                          className={cn(
                            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium tabular-nums ring-1",
                            enabledCount > 0
                              ? "bg-foreground/[0.06] text-foreground/85 ring-1 ring-border/50"
                              : "bg-muted text-muted-foreground ring-border",
                          )}
                        >
                          <AstryxInline className="font-semibold">{enabledCount}</AstryxInline>
                          <AstryxInline className="opacity-50">/</AstryxInline>
                          <AstryxInline className="opacity-80">{serverCount}</AstryxInline>
                          <AstryxInline className="ml-0.5 opacity-70">
                            {t("mcpHub.enabled")}
                          </AstryxInline>
                        </AstryxView>
                      ) : null}
                    </AstryxView>
                    {statusHint ? (
                      <AstryxView
                        layout="block"
                        direction="horizontal"
                        className="mt-0.5 truncate text-[11.5px] text-muted-foreground"
                      >
                        {statusHint}
                      </AstryxView>
                    ) : null}
                  </AstryxView>
                </AstryxView>

                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 gap-1.5 rounded-lg border-border bg-background px-3 sm:px-3.5"
                  onClick={openAdd}
                  title={t("mcpHub.add")}
                >
                  <Plus className="h-3.5 w-3.5" />
                  <AstryxInline className="hidden whitespace-nowrap sm:inline">
                    {t("mcpHub.add")}
                  </AstryxInline>
                </Button>
              </AstryxView>
            </AstryxView>

            {/* Tab bar */}
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="hub-tab-row hub-panel-enter flex items-center justify-between gap-3"
            >
              <HubSegmentedControl className="shrink-0">
                {[
                  {
                    value: "installed" as const,
                    label: t("mcpHub.tabInstalled"),
                    icon: Server,
                    count: serverCount,
                  },
                  {
                    value: "store" as const,
                    label: t("mcpHub.tabStore"),
                    icon: Cloud,
                    count: null,
                  },
                  {
                    value: "import" as const,
                    label: t("mcpHub.tabImport"),
                    icon: Download,
                    count: null,
                  },
                ].map((item) => {
                  const Icon = item.icon;
                  const active = view === item.value;
                  return (
                    <HubSegmentedButton
                      key={item.value}
                      active={active}
                      onClick={() => setView(item.value)}
                      className="px-4"
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <AstryxInline>{item.label}</AstryxInline>
                      {item.count !== null && item.count > 0 ? (
                        <AstryxView
                          as="span"
                          layout="inline-flex"
                          direction="horizontal"
                          className={cn(
                            "ml-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums",
                            active
                              ? "bg-foreground/[0.08] text-foreground/85"
                              : "bg-muted/70 text-muted-foreground",
                          )}
                        >
                          {item.count}
                        </AstryxView>
                      ) : null}
                    </HubSegmentedButton>
                  );
                })}
              </HubSegmentedControl>

              {view === "store" ? (
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="hidden text-[11.5px] text-muted-foreground sm:flex items-center gap-1.5"
                >
                  <Sparkles className="h-3.5 w-3.5 text-foreground/55" />
                  <AstryxInline>{t("mcpHub.storeSubtitle")}</AstryxInline>
                </AstryxView>
              ) : null}
            </AstryxView>

            {/* Content */}
            <AstryxView
              layout="block"
              direction="horizontal"
              className="hub-view-stage min-h-0 flex-1 overflow-hidden"
            >
              {view === "installed" ? (
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
                <McpImportView
                  settings={settings}
                  setSettings={setSettings}
                  allowStdio={props.allowStdio}
                />
              )}
            </AstryxView>
          </AstryxView>
        </AstryxView>
      </AstryxView>

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
    </AstryxView>
  );
}
