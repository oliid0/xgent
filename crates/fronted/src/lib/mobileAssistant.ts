import { invoke } from "@xagent/runtime";

export type MobileAssistantBackend = "desktop-unavailable" | "android-native" | "ios-native";
export type MobilePermissionState = "granted" | "denied" | "prompt";
export type MobileAssistantPermission =
  | "microphone"
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
