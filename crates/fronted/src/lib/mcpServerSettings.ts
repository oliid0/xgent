import { type AppSettings, type McpServerConfig, updateMcp, updateSystem } from "./settings";
import { applyMcpOpsToAppSettings } from "./settings/mcpOps";
import { toolServerPolicyKey } from "./tools/toolPolicy";

/** Identity stays valid if another screen deletes or reorders a server. */
export function saveMcpServer(
  current: AppSettings,
  server: McpServerConfig,
  previousId: string | null,
  t: (key: string) => string,
): AppSettings {
  const previous =
    previousId === null ? undefined : current.mcp.servers.find((item) => item.id === previousId);
  if (previousId !== null && !previous) throw new Error(t("mcpHub.noServers"));
  if (current.mcp.servers.some((item) => item.id === server.id && item.id !== previousId)) {
    throw new Error(t("mcpHub.duplicateName"));
  }
  let next = applyMcpOpsToAppSettings(current, [
    ...(previousId !== null && previousId !== server.id
      ? [{ kind: "remove" as const, serverId: previousId }]
      : []),
    {
      kind: "upsert",
      server: { ...previous, ...server, enabled: previous?.enabled ?? server.enabled },
    },
  ]);
  if (previousId === null || previousId === server.id) return next;
  next = updateMcp(next, {
    selected: current.mcp.selected.map((id) => (id === previousId ? server.id : id)),
    ...(current.mcp.computerUseDriverId === previousId ? { computerUseDriverId: server.id } : {}),
  });
  const policies = { ...(next.system.toolPolicies ?? {}) };
  const oldKey = toolServerPolicyKey(previousId);
  const newKey = toolServerPolicyKey(server.id);
  if (policies[oldKey] !== undefined) policies[newKey] = policies[oldKey];
  delete policies[oldKey];
  return updateSystem(next, { toolPolicies: policies });
}

export function removeMcpServer(current: AppSettings, serverId: string): AppSettings {
  const next = applyMcpOpsToAppSettings(current, [{ kind: "remove", serverId }]);
  const policies = { ...(next.system.toolPolicies ?? {}) };
  const key = toolServerPolicyKey(serverId);
  if (policies[key] === undefined) return next;
  delete policies[key];
  return updateSystem(next, { toolPolicies: policies });
}
