import { useState } from "react";
import { Cable, Plus } from "../../components/icons";
import { Button } from "../../components/ui/button";
import { useLocale } from "../../i18n";
import { type McpServerConfig, updateMcp } from "../../lib/settings";
import { McpServerEditModal, McpServersForm } from "../mcp-hub/McpServersForm";
import type { SettingsSectionProps } from "./types";

type EditingState = { mode: "add" } | { mode: "edit"; index: number; server: McpServerConfig };

export function McpSettingsSection(props: SettingsSectionProps & { allowStdio: boolean }) {
  const { t } = useLocale();
  const [editing, setEditing] = useState<EditingState | null>(null);

  const saveServer = (server: McpServerConfig) => {
    props.setSettings((previous) => {
      if (editing?.mode === "edit") {
        return updateMcp(previous, {
          servers: previous.mcp.servers.map((item, index) =>
            index === editing.index ? server : item,
          ),
        });
      }
      return updateMcp(previous, { servers: [...previous.mcp.servers, server] });
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted">
            <Cable className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">MCP</h2>
            <p className="text-xs text-muted-foreground">{t("mcpHub.subtitle")}</p>
          </div>
        </div>
        <Button type="button" size="sm" onClick={() => setEditing({ mode: "add" })}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {t("mcpHub.add")}
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <McpServersForm
          settings={props.settings}
          setSettings={props.setSettings}
          onAddServer={() => setEditing({ mode: "add" })}
          onEditServer={(server, index) => setEditing({ mode: "edit", server, index })}
        />
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
    </div>
  );
}
