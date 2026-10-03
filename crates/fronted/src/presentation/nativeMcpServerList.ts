import type { AppSettings, McpServerConfig, ToolPolicy } from "../lib/settings";
import { toolGroupPolicyKey, toolServerPolicyKey } from "../lib/tools/toolPolicy";
import type { presentationControls } from "./controls";
import type { PresentationNode } from "./types";

export function nativeMcpServerList(options: {
  controls: ReturnType<typeof presentationControls>;
  servers: { server: McpServerConfig; index: number }[];
  settings: AppSettings;
  t: (key: string) => string;
  patch: (id: string, patch: Partial<McpServerConfig>) => void;
  policy: (key: string, policy: ToolPolicy) => void;
  edit: (index: number, server: McpServerConfig) => void;
  remove: (server: McpServerConfig) => Promise<void>;
}): PresentationNode[] {
  const { controls: c, settings, t } = options;
  const group = settings.system.toolPolicies?.[toolGroupPolicyKey("mcp")] ?? "allow";
  return options.servers.map(({ server, index }) => {
    const id = `mcp-server:${server.id}`;
    const transport = server.transport ?? "stdio";
    const metadata = [
      transport.toUpperCase(),
      ...((server.args?.length ?? 0) > 0
        ? [`${t("mcpHub.previewArgs")} ${server.args.length}`]
        : []),
      ...(Object.keys(server.env ?? {}).length > 0
        ? [`${t("mcpHub.previewEnv")} ${Object.keys(server.env ?? {}).length}`]
        : []),
      ...(Object.keys(server.headers ?? {}).length > 0
        ? [`${t("mcpHub.previewHeaders")} ${Object.keys(server.headers ?? {}).length}`]
        : []),
    ];
    const key = toolServerPolicyKey(server.id);
    return {
      id,
      kind: "VStack",
      variant: "mcp-server-row",
      label: server.id,
      icon: transport === "stdio" ? "terminal" : "network",
      selected: server.enabled,
      children: [
        {
          id: `${id}:metadata`,
          kind: "VStack",
          variant: "mcp-server-metadata",
          children: metadata.map((label, i) => ({ id: `${id}:tag:${i}`, kind: "Badge", label })),
        },
        {
          id: `${id}:preview`,
          kind: "Text",
          secondary: true,
          text:
            transport === "stdio"
              ? [server.command, ...(server.args ?? [])].filter(Boolean).join(" ")
              : server.url,
          maxLines: 2,
        },
        {
          id: `${id}:actions`,
          kind: "VStack",
          variant: "mcp-server-actions",
          children: [
            c.toggle(
              `${id}:enabled`,
              server.enabled ? t("settings.disable") : t("settings.enable"),
              server.enabled,
              (enabled) => options.patch(server.id, { enabled }),
            ),
            {
              ...c.select(
                `${id}:policy`,
                `${server.id} ${t("settings.toolPermissionsTitle")}`,
                settings.system.toolPolicies?.[key] ?? group,
                ["allow", "ask", "deny"].map((value) => ({
                  value,
                  label: t(`settings.toolPolicy.${value}`),
                })),
                (value) => options.policy(key, value as ToolPolicy),
              ),
              kind: "SegmentedControl",
            },
            {
              ...c.action(`${id}:edit`, t("settings.edit"), () => options.edit(index, server)),
              kind: "IconButton",
              icon: "pencil",
              variant: "ghost",
            },
            {
              ...c.action(`${id}:delete`, t("settings.delete"), () => options.remove(server)),
              kind: "IconButton",
              icon: "trash",
              destructive: true,
              variant: "ghost",
            },
          ],
        },
      ],
    };
  });
}
