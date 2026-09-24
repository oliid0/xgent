import type { ToolCall } from "@earendil-works/pi-ai";
import type { ToolPolicy } from "../settings";

export const PERSONAL_POLICY_PREFIX = "personal:";
export const PERSONAL_CAPABILITIES = [
  "bluetooth",
  "location",
  "calendar",
  "reminders",
  "health",
  "clipboard",
] as const;
export type PersonalCapability = (typeof PERSONAL_CAPABILITIES)[number];

export function personalCapability(toolCall: Pick<ToolCall, "name" | "arguments">) {
  if (toolCall.name !== "MobilePersonalData" && toolCall.name !== "MobilePersonalActions") return;
  const action = (toolCall.arguments as Record<string, unknown> | undefined)?.action;
  const capabilities: Record<string, PersonalCapability> = {
    scan_bluetooth: "bluetooth",
    discover_devices: "bluetooth",
    get_current_location: "location",
    read_clipboard: "clipboard",
    write_clipboard: "clipboard",
    list_calendar_events: "calendar",
    create_calendar_event: "calendar",
    list_reminders: "reminders",
    create_reminder: "reminders",
    read_health_steps: "health",
    read_health_samples: "health",
  };
  return typeof action === "string" && Object.hasOwn(capabilities, action.trim())
    ? capabilities[action.trim()]
    : undefined;
}

export function personalPolicyKey(capability: PersonalCapability) {
  return `${PERSONAL_POLICY_PREFIX}${capability}`;
}

export function personalPolicy(
  capability: PersonalCapability,
  policies: Record<string, ToolPolicy> | undefined,
): ToolPolicy {
  return policies?.[personalPolicyKey(capability)] ?? "ask";
}
