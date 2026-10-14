import type {
  MobileAssistantPermission,
  MobileAssistantStatus,
  MobilePermissionStates,
} from "../mobileAssistant";
import type { ToolPolicy } from "../settings";
import { type PersonalCapability, personalPolicy } from "../tools/mobileAssistantPolicy";

/** Native adapters stay on the initiating phone. New external adapters must
 * declare their account, scopes and actual operations instead of borrowing OS grants. */
export const MOBILE_CONNECTORS = [
  {
    id: "calendar",
    permission: "calendar",
    actions: ["list_calendars", "list_calendar_events", "create_calendar_event"],
  },
  { id: "contacts", permission: "contacts", actions: ["list_contacts"] },
  {
    id: "reminders",
    permission: "reminders",
    actions: ["list_calendars", "list_reminders", "create_reminder"],
  },
  { id: "health", permission: "health", actions: ["read_health_steps", "read_health_samples"] },
  { id: "home", permission: "home", actions: ["list_home_inventory"] },
] as const satisfies readonly {
  id: string;
  permission: MobileAssistantPermission | null;
  actions: readonly string[];
}[];

export function mobileConnectorCatalog(
  status: MobileAssistantStatus | undefined,
  permissions: MobilePermissionStates,
  policies?: Record<string, ToolPolicy>,
) {
  return MOBILE_CONNECTORS.map((connector) => {
    const supported =
      !!status?.available &&
      !!connector.permission &&
      connector.actions.length > 0 &&
      status.permissionAliases[connector.permission] !== undefined &&
      (connector.id !== "health" || status.healthAvailable) &&
      (connector.id !== "home" || (status.homeAvailable && status.backend === "ios-native"));
    const permission = connector.permission ? permissions[connector.permission] : undefined;
    const policy = connector.permission
      ? personalPolicy(connector.permission as PersonalCapability, policies)
      : "deny";
    const state = !status
      ? "unknown"
      : !supported
        ? "unavailable"
        : policy === "deny"
          ? "blocked"
          : permission === "denied"
            ? "denied"
            : permission === "granted"
              ? "authorized"
              : permission === "requested"
                ? "requested"
                : "permissionNeeded";
    return {
      ...connector,
      supported,
      permissionState: permission,
      policy,
      state,
      locality: "initiating-device" as const,
      canRequest: supported && permission !== "granted",
    };
  });
}
