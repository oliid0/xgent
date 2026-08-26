import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Cable, Plus } from "../../components/icons";
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
    <VStack gap={4} className="settings-mcp-section min-h-0 flex-1">
      <HStack gap={3} hAlign="between" vAlign="start" className="settings-mcp-header">
        <HStack gap={3} vAlign="center">
          <Cable />
          <VStack gap={0}>
            <Heading level={2}>
              MCP
            </Heading>
            <Text type="supporting" color="secondary">
              {t("mcpHub.subtitle")}
            </Text>
          </VStack>
        </HStack>
        <Button
          type="button"
          size="sm"
          label={t("mcpHub.add")}
          icon={<Plus />}
          className="settings-section-action"
          onClick={() => setEditing({ mode: "add" })}
        />
      </HStack>
      <StackItem size="fill">
        <McpServersForm
          settings={props.settings}
          setSettings={props.setSettings}
          onAddServer={() => setEditing({ mode: "add" })}
          onEditServer={(server, index) => setEditing({ mode: "edit", server, index })}
        />
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
