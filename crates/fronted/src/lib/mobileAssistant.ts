import { invoke } from "@xgent/runtime";

export type MobileAssistantBackend = "desktop-unavailable" | "android-native" | "ios-native";
export type MobilePermissionState = "granted" | "denied" | "prompt";
export type MobileAssistantPermission =
  | "microphone"
  | "camera"
  | "calendar"
  | "reminders"
  | "photos"
  | "location";

export type MobileAssistantStatus = {
  backend: MobileAssistantBackend;
  available: boolean;
  voiceInputAvailable: boolean;
  externalFolderMountAvailable: boolean;
  cloudSyncAvailable: boolean;
  healthAvailable: boolean;
  homeAvailable: boolean;
  permissionAliases: Partial<Record<MobileAssistantPermission, string>>;
  detail?: string | null;
};

export type MobilePermissionStates = Partial<
  Record<MobileAssistantPermission, MobilePermissionState>
>;

export type VoiceInputResult = {
  text: string;
  locale: string;
  confidence?: number | null;
};

export type MobileCalendarEvent = {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  location?: string | null;
  notes?: string | null;
  calendar?: string | null;
};

export type MobileReminder = {
  id: string;
  title: string;
  dueMs?: number | null;
  completed: boolean;
  notes?: string | null;
  list?: string | null;
};

export type MobileLocation = {
  latitude: number;
  longitude: number;
  altitudeMeters?: number | null;
  accuracyMeters: number;
  timestampMs: number;
  provider?: string | null;
};

export type MobileActionResult = {
  id?: string | null;
  presented: boolean;
  detail: string;
};

const PLUGIN_COMMAND = "plugin:mobile-assistant|";

export function mobileAssistantStatus() {
  return invoke<MobileAssistantStatus>(`${PLUGIN_COMMAND}status`);
}

export function checkMobileAssistantPermissions() {
  return invoke<MobilePermissionStates>(`${PLUGIN_COMMAND}check_permissions`);
}

export function normalizeMobileAssistantPermissions(
  status: MobileAssistantStatus,
  states: Partial<Record<string, MobilePermissionState>>,
): MobilePermissionStates {
  const normalized: MobilePermissionStates = {};
  for (const permission of [
    "microphone",
    "camera",
    "calendar",
    "reminders",
    "photos",
    "location",
  ] satisfies MobileAssistantPermission[]) {
    const alias = status.permissionAliases[permission] ?? permission;
    normalized[permission] = states[alias] ?? states[permission] ?? "prompt";
  }
  return normalized;
}

export function requestMobileAssistantPermission(permissionAlias: string) {
  return invoke<MobilePermissionStates>(`${PLUGIN_COMMAND}request_permissions`, {
    request: { permissions: [permissionAlias] },
  });
}

export function startMobileVoiceInput(locale?: string) {
  return invoke<VoiceInputResult>(`${PLUGIN_COMMAND}start_voice_input`, {
    request: { locale: locale || null },
  });
}

export function listMobileCalendarEvents(request: {
  startMs: number;
  endMs: number;
  limit?: number;
}) {
  return invoke<MobileCalendarEvent[]>(`${PLUGIN_COMMAND}list_calendar_events`, {
    request: { ...request, limit: request.limit ?? 50 },
  });
}

export function getMobileCurrentLocation(timeoutMs = 10_000) {
  return invoke<MobileLocation>(`${PLUGIN_COMMAND}get_current_location`, {
    request: { timeoutMs: Math.min(30_000, Math.max(1_000, timeoutMs)) },
  });
}

export function listMobileReminders(request: { incompleteOnly?: boolean; limit?: number } = {}) {
  return invoke<MobileReminder[]>(`${PLUGIN_COMMAND}list_reminders`, {
    request: { incompleteOnly: request.incompleteOnly ?? true, limit: request.limit ?? 50 },
  });
}

export function createMobileCalendarEvent(request: {
  title: string;
  startMs: number;
  endMs: number;
  allDay?: boolean;
  location?: string | null;
  notes?: string | null;
}) {
  return invoke<MobileActionResult>(`${PLUGIN_COMMAND}create_calendar_event`, {
    request: { ...request, allDay: request.allDay ?? false },
  });
}

export function createMobileReminder(request: {
  title: string;
  dueMs?: number | null;
  notes?: string | null;
}) {
  return invoke<MobileActionResult>(`${PLUGIN_COMMAND}create_reminder`, { request });
}

export function composeMobileMessage(request: {
  kind: "email" | "sms";
  recipients: string[];
  subject?: string | null;
  body?: string | null;
}) {
  return invoke<MobileActionResult>(`${PLUGIN_COMMAND}compose_message`, { request });
}
