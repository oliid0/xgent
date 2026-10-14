import type { ToolCall } from "@earendil-works/pi-ai";
import type { ToolPolicy } from "../settings";

export const PERSONAL_POLICY_PREFIX = "personal:";
export const PERSONAL_CAPABILITIES = [
  "bluetooth",
  "location",
  "calendar",
  "contacts",
  "reminders",
  "health",
  "home",
  "clipboard",
  "photos",
] as const;
export type PersonalCapability = (typeof PERSONAL_CAPABILITIES)[number];

export function personalCapability(toolCall: Pick<ToolCall, "name" | "arguments">) {
  if (toolCall.name !== "MobilePersonalData" && toolCall.name !== "MobilePersonalActions") return;
  const action = (toolCall.arguments as Record<string, unknown> | undefined)?.action;
  if (typeof action === "string" && action.trim() === "list_calendars")
    return (toolCall.arguments as Record<string, unknown>)?.calendar_kind === "reminder"
      ? "reminders"
      : "calendar";
  const capabilities: Record<string, PersonalCapability> = {
    scan_bluetooth: "bluetooth",
    bluetooth_services: "bluetooth",
    read_bluetooth_characteristic: "bluetooth",
    collect_bluetooth_notifications: "bluetooth",
    discover_devices: "bluetooth",
    get_current_location: "location",
    read_clipboard: "clipboard",
    write_clipboard: "clipboard",
    list_calendar_events: "calendar",
    list_contacts: "contacts",
    create_calendar_event: "calendar",
    list_reminders: "reminders",
    create_reminder: "reminders",
    read_health_steps: "health",
    read_health_samples: "health",
    list_home_inventory: "home",
    set_home_power: "home",
    list_photos: "photos",
    read_photo: "photos",
    import_photo_preview: "photos",
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
