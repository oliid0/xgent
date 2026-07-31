import { useState } from "react";
import { useLocale } from "../../i18n";
import { type AppSettings, type McpServerConfig, updateMcp } from "../../lib/settings";
import { Cable, Plus } from "../icons";
import { ToolPolicyToggle } from "../hub/ToolPolicyToggle";
import { McpServerEditModal, McpServersForm } from "../../pages/mcp-hub/McpServersForm";
import { updateSystem } from "../../lib/settings";
import { toolGroupPolicyKey } from "../../lib/tools/toolPolicy";

type EditingState = { mode: "add" } | { mode: "edit"; index: number; server: McpServerConfig };

type McpSidePanelProps = {
  settings: AppSettings;
  setSettings: (updater: (current: AppSettings) => AppSettings) => void;
};

export function McpSidePanel(props: McpSidePanelProps) {
  const { t } = useLocale();
  const [editing, setEditing] = useState<EditingState | null>(null);
  const groupPolicy =
    props.settings.system.toolPolicies?.[toolGroupPolicyKey("mcp")] ?? "allow";

  const save = (server: McpServerConfig) => {
    props.setSettings((current) => {
      if (editing?.mode === "edit") {
        return updateMcp(current, {
          servers: current.mcp.servers.map((item, index) =>
            index === editing.index ? server : item,
          ),
        });
      }
      return updateMcp(current, { servers: [...current.mcp.servers, server] });
    });
    setEditing(null);
  };

  return (
    <section className="flex h-full w-[min(38vw,420px)] min-w-[340px] shrink-0 flex-col overflow-hidden border-r border-border/55 bg-[hsl(var(--sidebar-bg))]">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/55 px-4">
        <Cable className="h-4 w-4 text-violet-500" />
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">MCP</h2>
        <span className="text-xs text-muted-foreground">
          {props.settings.mcp.servers.filter((server) => server.enabled).length}/
          {props.settings.mcp.servers.length}
        </span>
        <ToolPolicyToggle
          value={groupPolicy}
          size="sm"
          ariaLabel="MCP tool policy"
          onChange={(policy) =>
            props.setSettings((current) =>
              updateSystem(current, {
                toolPolicies: {
                  ...(current.system.toolPolicies ?? {}),
                  [toolGroupPolicyKey("mcp")]: policy,
                },
              }),
            )
          }
        />
        <button
          type="button"
          onClick={() => setEditing({ mode: "add" })}
          title={t("mcpHub.add")}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 px-3">
        <McpServersForm
          settings={props.settings}
          setSettings={props.setSettings}
          onAddServer={() => setEditing({ mode: "add" })}
          onEditServer={(server, index) => setEditing({ mode: "edit", index, server })}
        />
      </div>
      {editing ? (
        <McpServerEditModal
          mode={editing.mode}
          initialServer={editing.mode === "edit" ? editing.server : null}
          existingServers={props.settings.mcp.servers}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      ) : null}
    </section>
  );
}
