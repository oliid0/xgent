import { useMemo, useState } from "react";
import {
  ChevronRight,
  MoreHorizontal,
  Plug,
  Plus,
  Server,
} from "../../../components/icons";
import { useLocale } from "../../../i18n";
import {
  type AppSettings,
  type McpServerConfig,
  updateMcp,
} from "../../../lib/settings";
import { McpServerEditModal } from "../../mcp-hub/McpServersForm";
import { MobileHubHeader, MobileHubSearch, MobileToggle } from "./MobileHubChrome";

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
          servers: prev.mcp.servers.map((item, index) =>
            index === editing.index ? server : item,
          ),
        });
      }
      return updateMcp(prev, { servers: [...prev.mcp.servers, server] });
    });
  };

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col bg-background">
      <MobileHubHeader
        title="MCP"
        onOpenSidebar={props.onOpenSidebar}
        trailing={
          <button
            type="button"
            onClick={() => setEditing({ mode: "add" })}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500 text-white shadow-sm active:bg-blue-600"
            aria-label={t("mcpHub.add")}
          >
            <Plus className="h-5 w-5" />
          </button>
        }
      />
      <MobileHubSearch value={query} onChange={setQuery} placeholder="Search MCP" />

      <div className="mt-8 flex items-center justify-between px-5">
        <h2 className="text-[18px] font-semibold">{t("mcpHub.tabInstalled")}</h2>
        <span className="text-[12px] tabular-nums text-muted-foreground">
          {visibleServers.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] pt-4">
        {visibleServers.map(({ server, index }) => (
          <article
            key={`${server.id}:${index}`}
            className="flex min-h-[76px] items-center gap-3 rounded-[1.35rem] px-2 py-2 active:bg-muted/65"
          >
            <button
              type="button"
              onClick={() => setEditing({ mode: "edit", index, server })}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border/45 bg-cyan-500/10 text-cyan-600 shadow-sm dark:text-cyan-300">
                {server.transport === "stdio" ? (
                  <Server className="h-6 w-6" />
                ) : (
                  <Plug className="h-6 w-6" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[16px] font-semibold">{server.id}</span>
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">
                    {server.transport}
                  </span>
                </span>
                <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                  {serverSubtitle(server) || t("mcpHub.statusEmptyDesc")}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
            </button>
            <MobileToggle
              checked={server.enabled}
              label={server.enabled ? t("settings.disable") : t("settings.enable")}
              onChange={(enabled) => patchServer(index, { enabled })}
            />
          </article>
        ))}
        {visibleServers.length === 0 ? (
          <div className="flex flex-col items-center px-8 py-20 text-center text-muted-foreground">
            <MoreHorizontal className="mb-3 h-7 w-7" />
            <p className="text-sm">{t("mcpHub.statusEmpty")}</p>
            <p className="mt-1 text-xs leading-5">{t("mcpHub.statusEmptyDesc")}</p>
          </div>
        ) : null}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
        <button
          type="button"
          onClick={() => setEditing({ mode: "add" })}
          className="pointer-events-auto flex h-12 items-center gap-2 rounded-full bg-blue-500 px-6 font-semibold text-white shadow-xl active:bg-blue-600"
        >
          <Plus className="h-5 w-5" />
          {t("mcpHub.add")}
        </button>
      </div>

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
    </section>
  );
}
