import type { ToolPolicy } from "../settings";
import type { BuiltinToolMetadata } from "./builtinTypes";

export type { ToolPolicy } from "../settings";

export const TOOL_GROUP_POLICY_PREFIX = "group:";
export const TOOL_SERVER_POLICY_PREFIX = "server:";

export function toolGroupPolicyKey(groupId: string) {
  return `${TOOL_GROUP_POLICY_PREFIX}${groupId.trim()}`;
}

export function toolServerPolicyKey(serverId: string) {
  return `${TOOL_SERVER_POLICY_PREFIX}${serverId.trim()}`;
}

/**
 * Resolves the effective policy from the narrowest scope to the broadest.
 *
 * Explicit tool and MCP-server choices take priority over group defaults.
 * Read-only metadata remains useful to the UI, but it never overrides a
 * policy the user deliberately configured at a broader scope.
 */
export function resolveToolPolicy(
  toolName: string,
  metadata: BuiltinToolMetadata | undefined,
  policies: Record<string, ToolPolicy> | undefined,
): ToolPolicy {
  const explicit = policies?.[toolName];
  if (explicit) return explicit;
  const serverPolicy = metadata?.serverId
    ? policies?.[toolServerPolicyKey(metadata.serverId)]
    : undefined;
  if (serverPolicy) return serverPolicy;
  const groupPolicy = metadata?.groupId
    ? policies?.[toolGroupPolicyKey(metadata.groupId)]
    : undefined;
  if (groupPolicy) return groupPolicy;
  return "allow";
}
