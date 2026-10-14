import type { Tool, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  readAuthorizedMobileHomeInventory,
  setAuthorizedMobileHomePower,
} from "../connectors/mobileHome";
import {
  accessMobileBluetoothGatt,
  checkMobileAssistantPermissions,
  composeMobileMessage,
  createMobileCalendarEvent,
  createMobileReminder,
  getMobileCurrentLocation,
  HEALTH_SAMPLE_METRICS,
  type HealthSampleMetric,
  listMobileCalendarEvents,
  listMobileCalendars,
  listMobileContacts,
  listMobilePhotos,
  listMobileReminders,
  type MobileActionResult,
  type MobileAssistantPermission,
  mobileAssistantStatus,
  normalizeMobileAssistantPermissions,
  readMobileHealthSamples,
  readMobileHealthSteps,
  readMobilePhoto,
  requestMobileAssistantPermission,
  requestMobileHealthMetricPermission,
  scanMobileBluetooth,
} from "../mobileAssistant";
import type { CommandSafetyMode, ToolPolicy } from "../settings";
import { readClipboardText, writeClipboardText } from "../system/clipboardText";
import { type BuiltinToolBundle, createBuiltinMetadataMap } from "./builtinTypes";
import { invokeFs as invokeDefaultFs } from "./fsBackend";
import { personalCapability, personalPolicy } from "./mobileAssistantPolicy";
import { isSessionApproved, requestToolApproval, toolApprovalScope } from "./toolApproval";
import type { ToolCommandPort } from "./toolCommandPort";
import { resolveToolPolicy } from "./toolPolicy";

const listDataTool: Tool = {
  name: "MobilePersonalData",
  description:
    "list_home_inventory reads HomeKit home, room, accessory, scene and writable power-control identities on the authorized initiating iOS device only. Optional home_id must be an observed HomeKit UUID, never a guessed name; default limit 200. It never executes scenes or reads live sensor values. " +
    "Access authorized phone-native data without Shell: connectivity, nearby BLE discovery, location, clipboard, calendar, contacts, reminders, photos and health. list_contacts searches authorized names with query and a bounded limit; returns IDs, names, phone numbers and email addresses. accessLimited means a selected subset, and truncated means record or field limits were reached; neither an empty list nor a partial list proves the full address book was searched. Contact IDs are local to this phone; never treat these records as permission to message someone. list_photos returns accessible image IDs with optional start/end bounds; read_photo returns a bounded JPEG preview for a photo_id, not the original image. Restricted libraries return only authorized photos. Health samples require metric, start and end and return units/source; empty data does not prove normal health or permission denial. After BLE scanning, bluetooth_services connects to device_id and lists GATT service/characteristic UUIDs and properties; read_bluetooth_characteristic requires device_id, service_uuid and characteristic_uuid and returns raw dataHex. Connections close after each operation. Interpret bytes only using the device's documented protocol; use collect_bluetooth_notifications with the same device/service/characteristic IDs for notification or indication data. It collects timestamped raw samples for duration_ms (default 5000, maximum 30000) or sample_limit (default/maximum 100), after subscription confirmation. timeout_ms bounds connection/setup. Empty samples mean no updates arrived during that window, not a zero measurement. Request personal data only when needed for the user's task.",
  parameters: Type.Object({
    action: Type.Union([
      Type.Literal("network_status"),
      Type.Literal("discover_devices"),
      Type.Literal("scan_bluetooth"),
      Type.Literal("bluetooth_services"),
      Type.Literal("read_bluetooth_characteristic"),
      Type.Literal("collect_bluetooth_notifications"),
      Type.Literal("get_current_location"),
      Type.Literal("read_clipboard"),
      Type.Literal("list_calendar_events"),
      Type.Literal("list_calendars"),
      Type.Literal("list_contacts"),
      Type.Literal("list_reminders"),
      Type.Literal("read_health_steps"),
      Type.Literal("read_health_samples"),
      Type.Literal("list_home_inventory"),
      Type.Literal("list_photos"),
      Type.Literal("read_photo"),
    ]),
    metric: Type.Optional(Type.Union(HEALTH_SAMPLE_METRICS.map((metric) => Type.Literal(metric)))),
    home_id: Type.Optional(
      Type.String({
        description:
          "For list_home_inventory: exact home UUID returned on this initiating iOS device; omit to list authorized homes. Read-only bounded metadata, no scene execution or live characteristic values.",
      }),
    ),
    calendar_kind: Type.Optional(
      Type.Union([Type.Literal("event"), Type.Literal("reminder")], {
        description:
          "For list_calendars: writable event calendars or reminder lists, default event. IDs and account/source names come from this phone; use the intended ID for creation. Android reminders are calendar alerts, not a separate task service.",
      }),
    ),
    query: Type.Optional(
      Type.String({
        maxLength: 256,
        description:
          "Contact name search; only authorized contacts are returned. Empty searches list a bounded set.",
      }),
    ),
    photo_id: Type.Optional(Type.String({ minLength: 1 })),
    device_id: Type.Optional(Type.String({ minLength: 1 })),
    service_uuid: Type.Optional(Type.String({ minLength: 1 })),
    characteristic_uuid: Type.Optional(Type.String({ minLength: 1 })),
    duration_ms: Type.Optional(
      Type.Integer({
        minimum: 1_000,
        maximum: 30_000,
        description:
          "Bluetooth notification collection duration after subscription succeeds; default 5000 ms.",
      }),
    ),
    sample_limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    start: Type.Optional(
      Type.String({ description: "Calendar or health range start as an ISO 8601 date-time." }),
    ),
    end: Type.Optional(
      Type.String({ description: "Calendar or health range end as an ISO 8601 date-time." }),
    ),
    incomplete_only: Type.Optional(Type.Boolean()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    timeout_ms: Type.Optional(Type.Integer({ minimum: 1_000, maximum: 30_000 })),
  }),
};

const actionTool: Tool = {
  name: "MobilePersonalActions",
  description:
    "set_home_power sets a reachable authorized HomeKit accessory's power state on the original iOS device. Requires observed home_id, accessory_id, service_id, characteristic_id and boolean power; list_home_inventory returns these identities. Actual SDK readback confirms completion. Unknown effects must not be retried with a new call ID. Calendar/reminder task branches do not authorize Home actions. " +
    "Create an authorized calendar event or reminder, write clipboard text, import an authorized photo's JPEG preview into the workspace, or open the device's email/SMS composer. import_photo_preview requires photo_id and a .jpg file_name; directory is relative to the workspace and existing files are preserved. Email and SMS are drafts that the user must review and send; never report them as sent.",
  parameters: Type.Object({
    action: Type.Union([
      Type.Literal("create_calendar_event"),
      Type.Literal("create_reminder"),
      Type.Literal("set_home_power"),
      Type.Literal("write_clipboard"),
      Type.Literal("compose_email"),
      Type.Literal("compose_sms"),
      Type.Literal("import_photo_preview"),
    ]),
    title: Type.Optional(Type.String({ minLength: 1 })),
    home_id: Type.Optional(Type.String()),
    accessory_id: Type.Optional(Type.String()),
    service_id: Type.Optional(Type.String()),
    characteristic_id: Type.Optional(Type.String()),
    power: Type.Optional(Type.Boolean()),
    calendar_id: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 256,
        description:
          "Actual writable device calendar/list ID returned by list_calendars with matching calendar_kind on this phone. Resolve the user's intended account rather than guessing; omitted IDs use only an observed system/unique default.",
      }),
    ),
    photo_id: Type.Optional(Type.String({ minLength: 1 })),
    file_name: Type.Optional(Type.String({ minLength: 1 })),
    directory: Type.Optional(Type.String()),
    start: Type.Optional(Type.String({ description: "Event start as an ISO 8601 date-time." })),
    end: Type.Optional(Type.String({ description: "Event end as an ISO 8601 date-time." })),
    due: Type.Optional(Type.String({ description: "Reminder due date as an ISO 8601 date-time." })),
    recurrence: Type.Optional(
      Type.Union([Type.Literal("daily"), Type.Literal("weekly")], {
        description:
          "Daily or weekly native recurrence from the first due time, in the device's timezone. Requires due. Android stores calendar alerts; iOS Reminders may advance recurrences with completion. A saved recurrence does not prove notification delivery. Use a native saved rule, not a chat promise.",
      }),
    ),
    all_day: Type.Optional(Type.Boolean()),
    location: Type.Optional(Type.String()),
    notes: Type.Optional(Type.String()),
    recipients: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 20 })),
    subject: Type.Optional(Type.String()),
    body: Type.Optional(Type.String()),
    content: Type.Optional(Type.String()),
  }),
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function savedActionResult(
  call: ToolCall,
  receipt: { id?: string | null; presented: boolean; detail: string },
) {
  if (receipt?.presented !== false || !receipt.id?.trim())
    return result(
      call,
      {
        error:
          "The device did not confirm a saved event/reminder. Inspect its existing state; a presented draft is not completion and must not be blindly replayed.",
        receipt,
      },
      true,
    );
  return result(call, receipt);
}

function requiredText(args: Record<string, unknown>, key: string) {
  const value = text(args[key]);
  if (!value) throw new Error(`MobilePersonalActions requires ${key}.`);
  return value;
}

function dateMs(value: unknown, label: string) {
  const source = text(value);
  const parsed = Date.parse(source);
  if (!source || !Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid ISO 8601 date-time.`);
  }
  return parsed;
}

function limit(value: unknown) {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.min(200, Math.max(1, value))
    : 50;
}

function result(toolCall: ToolCall, data: unknown, isError = false): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [
      { type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) },
    ],
    details: { kind: "mobile_personal_assistant", data },
    isError,
    timestamp: Date.now(),
  };
}

async function ensurePermission(permission: MobileAssistantPermission, signal?: AbortSignal) {
  const checkCancelled = () => {
    if (signal?.aborted) throw new Error("Cancelled");
  };
  checkCancelled();
  const status = await mobileAssistantStatus();
  checkCancelled();
  if (permission === "contacts" && status.permissionAliases.contacts === undefined)
    throw new Error("Contacts connector is unavailable on this device");
  if (permission === "health" && !status.healthAvailable) {
    throw new Error(status.detail || "Health data is unavailable on this device.");
  }
  const alias = status.permissionAliases[permission] ?? permission;
  // HealthKit intentionally hides read grants. Only its completed request can
  // use this state; other capabilities require a confirmed OS grant.
  const authorized = (state: string | undefined) =>
    state === "granted" ||
    (permission === "health" && status.backend === "ios-native" && state === "requested");
  let states = normalizeMobileAssistantPermissions(status, await checkMobileAssistantPermissions());
  checkCancelled();
  if (authorized(states[permission])) return;
  if (states[permission] === "denied") {
    throw new Error(`The user denied ${permission} permission. Enable it in system settings.`);
  }
  states = normalizeMobileAssistantPermissions(
    status,
    await requestMobileAssistantPermission(alias, signal),
  );
  checkCancelled();
  // Android's permission callback reports each requested permission; selected
  // photos can be granted even when full-library access was denied. Native
  // checkPermissions reconciles these into the effective photo capability.
  if (permission === "photos") {
    states = normalizeMobileAssistantPermissions(status, await checkMobileAssistantPermissions());
    checkCancelled();
  }
  if (!authorized(states[permission])) {
    throw new Error(`The user did not grant ${permission} permission.`);
  }
}

/** Manual task account discovery reuses the actual native permission path. */
export async function ensureMobilePersonalReadPermission(
  kind: "event" | "reminder",
  signal?: AbortSignal,
) {
  await ensurePermission(kind === "event" ? "calendar" : "reminders", signal);
}

export function createMobilePersonalAssistantTools(
  options: {
    commandPort?: ToolCommandPort;
    getToolPolicies?: () => Record<string, ToolPolicy> | undefined;
    getCommandSafetyMode?: () => CommandSafetyMode;
    conversationId?: string;
    workdir?: string;
    executeDurableWrite?: (
      kind: "calendar_event" | "reminder",
      request: Record<string, unknown>,
    ) => Promise<MobileActionResult>;
    isDurableWriteApproved?: (call: ToolCall) => Promise<boolean>;
    executeDurableRead?: (
      action: "list_calendars" | "list_calendar_events" | "list_reminders" | "read_health_samples",
      request: Record<string, unknown>,
    ) => Promise<unknown>;
    isDurableReadApproved?: (call: ToolCall) => Promise<boolean>;
  } = {},
): BuiltinToolBundle {
  const invokeFs = <T>(command: string, args: Record<string, unknown>) =>
    invokeDefaultFs<T>(command, args, options.commandPort?.invoke);
  async function executeToolCall(toolCall: ToolCall, signal?: AbortSignal) {
    if (signal?.aborted) return result(toolCall, "Cancelled", true);
    const operationScope = JSON.stringify([
      "assistant",
      options.conversationId ?? "standalone",
      toolCall.id,
    ]);
    try {
      const args = (toolCall.arguments ?? {}) as Record<string, unknown>;
      const action = text(args.action);
      if (action === "set_home_power" && options.executeDurableWrite)
        throw new Error("This calendar/reminder task branch does not authorize Home control");
      const capability = personalCapability(toolCall);
      if (capability) {
        const policies = options.getToolPolicies?.();
        const broadPolicy = (current: Record<string, ToolPolicy> | undefined) =>
          resolveToolPolicy(
            toolCall.name,
            {
              groupId: "system",
              kind: "mobile_personal_data",
              displayCategory: "system",
              isReadOnly: toolCall.name === "MobilePersonalData",
            },
            current,
          );
        const broad = broadPolicy(policies);
        const personal = personalPolicy(capability, policies);
        if (broad === "deny" || personal === "deny") {
          throw new Error(
            `The user disabled ${capability} access for the assistant. Do not retry.`,
          );
        }
        const needsApproval =
          broad === "ask" ||
          personal === "ask" ||
          (toolCall.name === "MobilePersonalActions" && options.getCommandSafetyMode?.() === "ask");
        const scope = toolApprovalScope(toolCall);
        const taskApproved = needsApproval
          ? toolCall.name === "MobilePersonalActions" &&
            options.executeDurableWrite &&
            options.isDurableWriteApproved
            ? await options.isDurableWriteApproved(toolCall)
            : toolCall.name === "MobilePersonalData" &&
                options.executeDurableRead &&
                options.isDurableReadApproved
              ? await options.isDurableReadApproved(toolCall)
              : false
          : false;
        if (
          needsApproval &&
          !taskApproved &&
          (!options.conversationId || !isSessionApproved(options.conversationId, scope))
        ) {
          if (!options.conversationId)
            throw new Error(`${capability} requires interactive assistant authorization.`);
          const approval = await requestToolApproval({
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            sessionScope: scope,
            summary: JSON.stringify(args),
            conversationId: options.conversationId,
            signal,
          });
          if (approval.kind !== "decided" || approval.decision === "deny") {
            throw new Error(
              approval.kind === "cancelled"
                ? "Cancelled"
                : `Assistant access to ${capability} was not approved. Do not retry.`,
            );
          }
          // A settings change while the prompt was open takes precedence.
          const currentPolicies = options.getToolPolicies?.();
          if (
            personalPolicy(capability, currentPolicies) === "deny" ||
            broadPolicy(currentPolicies) === "deny"
          ) {
            throw new Error(`The user disabled ${capability} access for the assistant.`);
          }
        }
        // Native task approval may have awaited IPC. A current DENY always
        // wins; the native effect claim independently rechecks persisted policy.
        if (
          taskApproved &&
          (personalPolicy(capability, options.getToolPolicies?.()) === "deny" ||
            broadPolicy(options.getToolPolicies?.()) === "deny")
        )
          throw new Error(`The user disabled ${capability} access for the assistant.`);
        if (signal?.aborted) throw new Error("Cancelled");
      }
      if (toolCall.name === "MobilePersonalData") {
        if (action === "list_home_inventory") {
          if (
            args.limit !== undefined &&
            (!Number.isInteger(args.limit) || Number(args.limit) < 1 || Number(args.limit) > 200)
          )
            throw new Error("Home inventory limit must be 1–200");
          if (args.home_id !== undefined && typeof args.home_id !== "string")
            throw new Error("home_id must be a HomeKit UUID");
          const inventory = await readAuthorizedMobileHomeInventory(
            {
              limit: args.limit === undefined ? 200 : Number(args.limit),
              homeId: args.home_id as string | undefined,
            },
            signal,
            () => {
              const policies = options.getToolPolicies?.();
              if (
                personalPolicy("home", policies) === "deny" ||
                resolveToolPolicy(
                  toolCall.name,
                  {
                    groupId: "system",
                    kind: "mobile_personal_data",
                    displayCategory: "system",
                    isReadOnly: true,
                  },
                  policies,
                ) === "deny"
              )
                throw new Error("The user disabled home access for the assistant.");
            },
          );
          return result(toolCall, {
            inventory,
            privacyNote:
              "Observed HomeKit metadata from this phone. Reachability is the platform's observation at observedAtMs, not a live sensor reading. No scene or accessory was changed. Truncated inventories do not describe the entire home.",
          });
        }
        if (action === "list_calendars") {
          const kind = args.calendar_kind ?? "event";
          if (kind !== "event" && kind !== "reminder")
            throw new Error("Calendar kind must be event or reminder");
          await ensurePermission(kind === "reminder" ? "reminders" : "calendar", signal);
          if (signal?.aborted) return result(toolCall, "Cancelled", true);
          const calendars = options.executeDurableRead
            ? await options.executeDurableRead("list_calendars", { kind })
            : await listMobileCalendars(kind);
          if (signal?.aborted) return result(toolCall, "Cancelled", true);
          return result(toolCall, calendars);
        }
        if (action === "list_contacts") {
          if (args.query !== undefined && typeof args.query !== "string")
            throw new Error("Contact query must be text");
          const query = text(args.query);
          const count = limit(args.limit);
          if (new TextEncoder().encode(query).length > 1024)
            throw new Error("Contact query exceeds 1024 bytes");
          await ensurePermission("contacts", signal);
          const contacts = await listMobileContacts(query, count);
          if (signal?.aborted) throw new Error("Cancelled");
          return result(toolCall, contacts);
        }
        if (action === "list_photos") {
          const startMs = args.start === undefined ? null : dateMs(args.start, "start");
          const endMs = args.end === undefined ? null : dateMs(args.end, "end");
          if (startMs !== null && endMs !== null && endMs <= startMs)
            throw new Error("end must be after start.");
          await ensurePermission("photos", signal);
          const photos = await listMobilePhotos({ startMs, endMs, limit: limit(args.limit) });
          if (signal?.aborted) throw new Error("Cancelled");
          return result(toolCall, photos);
        }
        if (action === "read_photo") {
          const id = requiredText(args, "photo_id");
          await ensurePermission("photos", signal);
          const photo = await readMobilePhoto(id);
          if (signal?.aborted) throw new Error("Cancelled");
          const response = result(toolCall, {
            id: photo.id,
            width: photo.width,
            height: photo.height,
            representation: "JPEG preview, not original",
          });
          response.content.push({
            type: "image",
            data: photo.dataBase64,
            mimeType: photo.mimeType,
          });
          return response;
        }
        if (action === "read_health_samples") {
          const metric = text(args.metric);
          if (!HEALTH_SAMPLE_METRICS.includes(metric as HealthSampleMetric)) {
            throw new Error(`metric must be one of: ${HEALTH_SAMPLE_METRICS.join(", ")}`);
          }
          const request = {
            metric: metric as HealthSampleMetric,
            startMs: dateMs(args.start, "start"),
            endMs: dateMs(args.end, "end"),
            limit: limit(args.limit),
          };
          if (request.endMs <= request.startMs) throw new Error("end must be after start.");
          if (options.executeDurableRead) {
            const health = await options.executeDurableRead("read_health_samples", request);
            if (signal?.aborted) return result(toolCall, "Cancelled", true);
            return result(toolCall, health);
          }
          const status = await mobileAssistantStatus();
          if (signal?.aborted) return result(toolCall, "Cancelled", true);
          if (!status.healthAvailable)
            throw new Error(status.detail || "Health data is unavailable.");
          const permission = await requestMobileHealthMetricPermission(request.metric, signal);
          if (signal?.aborted) return result(toolCall, "Cancelled", true);
          if (
            permission.health !== "granted" &&
            !(status.backend === "ios-native" && permission.health === "requested")
          ) {
            throw new Error(`The user did not grant ${metric} read permission.`);
          }
          const health = await readMobileHealthSamples(request);
          if (signal?.aborted) return result(toolCall, "Cancelled", true);
          return result(toolCall, {
            health,
            privacyNote:
              "Results contain only records exposed by the platform. Empty data does not establish health status or read authorization. If truncated, query a narrower time range.",
          });
        }
        if (action === "network_status") {
          const status = await mobileAssistantStatus();
          if (!status.network)
            throw new Error("Network path is still being detected on this device.");
          return result(toolCall, { network: status.network });
        }
        if (action === "discover_devices") {
          const status = await mobileAssistantStatus();
          let nearbyBluetooth: Awaited<ReturnType<typeof scanMobileBluetooth>> = [];
          let bluetoothError: string | undefined;
          try {
            await ensurePermission("bluetooth", signal);
            if (signal?.aborted) return result(toolCall, "Cancelled", true);
            nearbyBluetooth = await scanMobileBluetooth(
              typeof args.timeout_ms === "number" ? args.timeout_ms : 5_000,
            );
          } catch (cause) {
            if (signal?.aborted) return result(toolCall, "Cancelled", true);
            bluetoothError = cause instanceof Error ? cause.message : String(cause);
          }
          return result(toolCall, {
            network: status.network ?? null,
            connected: status.audioOutputs ?? [],
            nearbyBluetooth,
            ...(bluetoothError ? { bluetoothError } : {}),
          });
        }
        if (
          action === "bluetooth_services" ||
          action === "read_bluetooth_characteristic" ||
          action === "collect_bluetooth_notifications"
        ) {
          const deviceId = requiredText(args, "device_id");
          const reading = action !== "bluetooth_services";
          const notifying = action === "collect_bluetooth_notifications";
          const serviceUuid = reading ? requiredText(args, "service_uuid") : undefined;
          const characteristicUuid = reading
            ? requiredText(args, "characteristic_uuid")
            : undefined;
          await ensurePermission("bluetooth", signal);
          if (signal?.aborted) return result(toolCall, "Cancelled", true);
          const data = await accessMobileBluetoothGatt({
            operation: notifying ? "notify" : reading ? "read" : "services",
            deviceId,
            serviceUuid,
            characteristicUuid,
            timeoutMs: typeof args.timeout_ms === "number" ? args.timeout_ms : 10_000,
            ...(notifying
              ? {
                  durationMs: typeof args.duration_ms === "number" ? args.duration_ms : 5_000,
                  sampleLimit: typeof args.sample_limit === "number" ? args.sample_limit : 100,
                }
              : {}),
          });
          if (signal?.aborted) return result(toolCall, "Cancelled", true);
          return result(toolCall, data);
        }
        if (action === "scan_bluetooth") {
          await ensurePermission("bluetooth", signal);
          if (signal?.aborted) return result(toolCall, "Cancelled", true);
          const devices = await scanMobileBluetooth(
            typeof args.timeout_ms === "number" ? args.timeout_ms : 5_000,
          );
          if (signal?.aborted) return result(toolCall, "Cancelled", true);
          return result(toolCall, { devices });
        }
        if (action === "get_current_location") {
          await ensurePermission("location", signal);
          const timeoutMs =
            typeof args.timeout_ms === "number" && Number.isInteger(args.timeout_ms)
              ? args.timeout_ms
              : 10_000;
          return result(toolCall, {
            location: await getMobileCurrentLocation(timeoutMs),
          });
        }
        if (action === "read_clipboard") {
          return result(toolCall, { text: await readClipboardText() });
        }
        if (action === "list_calendar_events") {
          const request = {
            startMs: dateMs(args.start, "start"),
            endMs: dateMs(args.end, "end"),
            limit: limit(args.limit),
          };
          await ensurePermission("calendar", signal);
          if (options.executeDurableRead) {
            const data = await options.executeDurableRead("list_calendar_events", request);
            if (signal?.aborted) return result(toolCall, "Cancelled", true);
            return result(toolCall, data);
          }
          const events = await listMobileCalendarEvents(request);
          return result(toolCall, { events });
        }
        if (action === "list_reminders") {
          await ensurePermission("reminders", signal);
          const request = {
            incompleteOnly: args.incomplete_only !== false,
            limit: limit(args.limit),
          };
          if (options.executeDurableRead) {
            const data = await options.executeDurableRead("list_reminders", request);
            if (signal?.aborted) return result(toolCall, "Cancelled", true);
            return result(toolCall, data);
          }
          const reminders = await listMobileReminders(request);
          return result(toolCall, { reminders });
        }
        if (action === "read_health_steps") {
          const request = {
            startMs: dateMs(args.start, "start"),
            endMs: dateMs(args.end, "end"),
          };
          if (request.endMs <= request.startMs) {
            throw new Error("end must be after start.");
          }
          await ensurePermission("health", signal);
          const summary = await readMobileHealthSteps(request);
          return result(toolCall, {
            summary,
            privacyNote: summary.accessLimited
              ? "The platform may expose only the health data window the user authorized."
              : undefined,
          });
        }
      }
      if (toolCall.name !== "MobilePersonalActions") {
        throw new Error(`Unknown tool: ${toolCall.name}`);
      }
      if (action === "set_home_power") {
        if (typeof args.power !== "boolean")
          throw new Error("Home power requires a boolean power state");
        const request = {
          homeId: requiredText(args, "home_id"),
          accessoryId: requiredText(args, "accessory_id"),
          serviceId: requiredText(args, "service_id"),
          characteristicId: requiredText(args, "characteristic_id"),
          power: args.power,
        };
        const assertAccess = () => {
          if (signal?.aborted) throw new Error("Cancelled");
          const current = options.getToolPolicies?.();
          if (
            personalPolicy("home", current) === "deny" ||
            resolveToolPolicy(
              "MobilePersonalActions",
              {
                groupId: "system",
                kind: "mobile_personal_data",
                displayCategory: "system",
                isReadOnly: false,
              },
              current,
            ) === "deny"
          )
            throw new Error("The user disabled Home access");
        };
        return savedActionResult(
          toolCall,
          await setAuthorizedMobileHomePower(request, operationScope, signal, assertAccess),
        );
      }
      if (action === "import_photo_preview") {
        const id = requiredText(args, "photo_id");
        const fileName = requiredText(args, "file_name");
        if (!/^[^/\\]+\.jpe?g$/i.test(fileName))
          throw new Error("file_name must be a JPEG filename without directories.");
        if (!options.workdir) throw new Error("A workspace is required to import a photo preview.");
        await ensurePermission("photos", signal);
        const photo = await readMobilePhoto(id);
        if (signal?.aborted) throw new Error("Cancelled");
        const imported = await invokeFs<{ path: string }>("fs_import_file", {
          workdir: options.workdir,
          directory: text(args.directory),
          file_name: fileName,
          content_base64: photo.dataBase64,
        });
        return result(toolCall, {
          ...imported,
          photoId: id,
          mimeType: photo.mimeType,
          representation: "JPEG preview, not original",
        });
      }
      if (action === "create_calendar_event") {
        const request = {
          title: requiredText(args, "title"),
          ...(text(args.calendar_id) ? { calendarId: text(args.calendar_id) } : {}),
          startMs: dateMs(args.start, "start"),
          endMs: dateMs(args.end, "end"),
          allDay: args.all_day === true,
          location: text(args.location) || null,
          notes: text(args.notes) || null,
        };
        await ensurePermission("calendar", signal);
        const created = options.executeDurableWrite
          ? await options.executeDurableWrite("calendar_event", request)
          : await createMobileCalendarEvent(request, operationScope);
        return savedActionResult(toolCall, created);
      }
      if (action === "create_reminder") {
        const due = text(args.due);
        if (
          args.recurrence !== undefined &&
          (!due || !["daily", "weekly"].includes(String(args.recurrence)))
        )
          throw new Error("Recurring reminders require due and daily or weekly frequency");
        const request = {
          title: requiredText(args, "title"),
          ...(text(args.calendar_id) ? { calendarId: text(args.calendar_id) } : {}),
          dueMs: due ? dateMs(due, "due") : null,
          notes: text(args.notes) || null,
          ...(args.recurrence ? { recurrence: args.recurrence as "daily" | "weekly" } : {}),
        };
        await ensurePermission("reminders", signal);
        const created = options.executeDurableWrite
          ? await options.executeDurableWrite("reminder", request)
          : await createMobileReminder(request, operationScope);
        return savedActionResult(toolCall, created);
      }
      if (action === "write_clipboard") {
        const content = requiredText(args, "content");
        await writeClipboardText(content);
        return result(toolCall, { written: true, characters: content.length });
      }
      if (action === "compose_email" || action === "compose_sms") {
        const recipients = Array.isArray(args.recipients)
          ? args.recipients.map(text).filter(Boolean).slice(0, 20)
          : [];
        const opened = await composeMobileMessage({
          kind: action === "compose_email" ? "email" : "sms",
          recipients,
          subject: text(args.subject) || null,
          body: text(args.body) || null,
        });
        return result(toolCall, {
          ...opened,
          userConfirmationRequired: true,
          sent: false,
        });
      }
      throw new Error(`Unsupported mobile personal action: ${action || "(missing)"}`);
    } catch (error) {
      return result(toolCall, error instanceof Error ? error.message : String(error), true);
    }
  }

  return {
    groupId: "system",
    tools: [listDataTool, actionTool],
    executeToolCall,
    metadataByName: createBuiltinMetadataMap([
      [
        "MobilePersonalData",
        {
          groupId: "system",
          kind: "mobile_personal_data",
          isReadOnly: true,
          displayCategory: "system",
        },
      ],
      [
        "MobilePersonalActions",
        {
          groupId: "system",
          kind: "mobile_personal_action",
          isReadOnly: false,
          displayCategory: "system",
        },
      ],
    ]),
  };
}
