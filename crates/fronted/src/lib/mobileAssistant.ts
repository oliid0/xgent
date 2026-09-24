import { invoke } from "@xgent/runtime";

export type MobileAssistantBackend = "desktop-unavailable" | "android-native" | "ios-native";
export type MobilePermissionState = "granted" | "denied" | "prompt" | "requested";
export type MobileAssistantPermission =
  | "bluetooth"
  | "microphone"
  | "camera"
  | "calendar"
  | "reminders"
  | "photos"
  | "location"
  | "health";

export type MobileAssistantStatus = {
  backend: MobileAssistantBackend;
  available: boolean;
  voiceInputAvailable: boolean;
  externalFolderMountAvailable: boolean;
  cloudSyncAvailable: boolean;
  healthAvailable: boolean;
  homeAvailable: boolean;
  network?: {
    transport: "wifi" | "cellular" | "ethernet" | "other" | "none";
    connected: boolean;
    metered?: boolean;
    validated?: boolean;
  } | null;
  audioOutputs?: Array<{
    id: string;
    name: string;
    transport: "bluetooth" | "airplay" | "remote" | "hdmi" | "wired" | "other";
    active?: boolean;
  }>;
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

export type HealthStepsSummary = {
  startMs: number;
  endMs: number;
  steps: number;
  source: "health-connect" | "healthkit";
  accessLimited: boolean;
};

export const HEALTH_SAMPLE_METRICS = [
  "heart_rate",
  "blood_glucose",
  "oxygen_saturation",
  "weight",
  "body_temperature",
] as const;
export type HealthSampleMetric = (typeof HEALTH_SAMPLE_METRICS)[number];
export type HealthSamplesResult = {
  metric: HealthSampleMetric;
  unit: string;
  startMs: number;
  endMs: number;
  samples: Array<{ id: string; startMs: number; endMs: number; value: number; source: string }>;
  source: "health-connect" | "healthkit";
  truncated: boolean;
  accessLimited: boolean;
};

export function requestMobileHealthMetricPermission(
  metric: HealthSampleMetric,
  signal?: AbortSignal,
) {
  return queuePermissionRequest(
    () =>
      invoke<MobilePermissionStates>(`${PLUGIN_COMMAND}request_health_metric_permission`, {
        request: { metric },
      }),
    signal,
  );
}

export function readMobileHealthSamples(request: {
  metric: HealthSampleMetric;
  startMs: number;
  endMs: number;
  limit: number;
}) {
  return invoke<HealthSamplesResult>(`${PLUGIN_COMMAND}read_health_samples`, { request });
}

export type MobileActionResult = {
  id?: string | null;
  presented: boolean;
  detail: string;
};

const PLUGIN_COMMAND = "plugin:mobile-assistant|";

export type MobilePhotoList = {
  photos: Array<{ id: string; createdMs: number | null; width: number; height: number }>;
  truncated: boolean;
  accessLimited: boolean;
};
export function listMobilePhotos(request: {
  startMs: number | null;
  endMs: number | null;
  limit: number;
}) {
  return invoke<MobilePhotoList>(`${PLUGIN_COMMAND}list_photos`, { request });
}
export function readMobilePhoto(id: string) {
  return invoke<{
    id: string;
    mimeType: string;
    dataBase64: string;
    width: number;
    height: number;
  }>(`${PLUGIN_COMMAND}read_photo`, { request: { id } });
}

export type MobileBluetoothDevice = {
  id: string;
  name?: string | null;
  rssi: number;
  serviceUuids: string[];
};

export function scanMobileBluetooth(timeoutMs = 5_000) {
  if (!Number.isFinite(timeoutMs)) throw new Error("Bluetooth scan duration must be finite");
  return invoke<MobileBluetoothDevice[]>(`${PLUGIN_COMMAND}scan_bluetooth`, {
    request: { timeoutMs: Math.min(30_000, Math.max(1_000, Math.round(timeoutMs))) },
  });
}

export type MobileBluetoothGattResult = {
  deviceId: string;
  services: {
    uuid: string;
    characteristics: { uuid: string; readable: boolean; writable: boolean; notifiable: boolean }[];
  }[];
  serviceUuid?: string | null;
  characteristicUuid?: string | null;
  dataHex?: string | null;
  samples?: { receivedAtMs: number; dataHex: string }[];
  stopReason?: "duration" | "sample_limit" | null;
};

export function accessMobileBluetoothGatt(request: {
  operation: "services" | "read" | "notify";
  deviceId: string;
  serviceUuid?: string;
  characteristicUuid?: string;
  timeoutMs: number;
  durationMs?: number;
  sampleLimit?: number;
}) {
  if (!request.deviceId.trim()) throw new Error("Bluetooth device_id is required");
  if (
    !Number.isInteger(request.timeoutMs) ||
    request.timeoutMs < 1_000 ||
    request.timeoutMs > 30_000
  )
    throw new Error("Bluetooth timeout must be between 1000 and 30000 ms");
  const uuid =
    /^(?:[\da-f]{4}|[\da-f]{8}|[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/i;
  if (
    request.operation !== "services" &&
    (!uuid.test(request.serviceUuid ?? "") || !uuid.test(request.characteristicUuid ?? ""))
  )
    throw new Error("Characteristic access requires valid service_uuid and characteristic_uuid");
  if (request.operation === "notify") {
    const duration = request.durationMs ?? 5_000;
    const limit = request.sampleLimit ?? 100;
    if (
      !Number.isInteger(duration) ||
      duration < 1_000 ||
      duration > 30_000 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new Error("Notification duration must be 1000-30000 ms and sample limit 1-100");
  }
  return invoke<MobileBluetoothGattResult>(`${PLUGIN_COMMAND}bluetooth_gatt`, { request });
}

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
    "bluetooth",
    "microphone",
    "camera",
    "calendar",
    "reminders",
    "photos",
    "location",
    "health",
  ] satisfies MobileAssistantPermission[]) {
    const alias = status.permissionAliases[permission] ?? permission;
    normalized[permission] = states[alias] ?? states[permission] ?? "prompt";
  }
  return normalized;
}

// Settings and concurrent tools share one queue: native authorization dialogs
// must finish before another capability can request its own OS authorization.
let permissionQueue: Promise<unknown> = Promise.resolve();

function queuePermissionRequest<T>(request: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const pending = permissionQueue.then(async () => {
    if (signal?.aborted) throw new Error("Cancelled");
    const response = await request();
    if (signal?.aborted) throw new Error("Cancelled");
    return response;
  });
  permissionQueue = pending.catch(() => undefined);
  return pending;
}

export function requestMobileAssistantPermission(permissionAlias: string, signal?: AbortSignal) {
  return queuePermissionRequest(
    () =>
      invoke<MobilePermissionStates>(`${PLUGIN_COMMAND}request_permissions`, {
        request: { permissions: [permissionAlias] },
      }),
    signal,
  );
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

export function readMobileHealthSteps(request: { startMs: number; endMs: number }) {
  return invoke<HealthStepsSummary>(`${PLUGIN_COMMAND}read_health_steps`, { request });
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

export function openMobileSystemSettings() {
  return invoke<MobileActionResult>(`${PLUGIN_COMMAND}open_settings`);
}
