import type { Tool, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  checkMobileAssistantPermissions,
  composeMobileMessage,
  createMobileCalendarEvent,
  createMobileReminder,
  getMobileCurrentLocation,
  listMobileCalendarEvents,
  listMobileReminders,
  type MobileAssistantPermission,
  mobileAssistantStatus,
  normalizeMobileAssistantPermissions,
  requestMobileAssistantPermission,
} from "../mobileAssistant";
import { readClipboardText, writeClipboardText } from "../system/clipboardText";
import { type BuiltinToolBundle, createBuiltinMetadataMap } from "./builtinTypes";

const listDataTool: Tool = {
  name: "MobilePersonalData",
  description:
    "Read the user's authorized current location, clipboard text, system calendar, or reminders on this Android/iOS device. Use privacy-sensitive reads only when the user's task requires them.",
  parameters: Type.Object({
    action: Type.Union([
      Type.Literal("get_current_location"),
      Type.Literal("read_clipboard"),
      Type.Literal("list_calendar_events"),
      Type.Literal("list_reminders"),
    ]),
    start: Type.Optional(
      Type.String({ description: "Calendar range start as an ISO 8601 date-time." }),
    ),
    end: Type.Optional(
      Type.String({ description: "Calendar range end as an ISO 8601 date-time." }),
    ),
    incomplete_only: Type.Optional(Type.Boolean()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    timeout_ms: Type.Optional(Type.Integer({ minimum: 1_000, maximum: 30_000 })),
  }),
};

const actionTool: Tool = {
  name: "MobilePersonalActions",
  description:
    "Create an authorized calendar event or reminder, write clipboard text, or open the device's email/SMS composer. Email and SMS are drafts that the user must review and send; never report them as sent.",
  parameters: Type.Object({
    action: Type.Union([
      Type.Literal("create_calendar_event"),
      Type.Literal("create_reminder"),
      Type.Literal("write_clipboard"),
      Type.Literal("compose_email"),
      Type.Literal("compose_sms"),
    ]),
    title: Type.Optional(Type.String({ minLength: 1 })),
    start: Type.Optional(Type.String({ description: "Event start as an ISO 8601 date-time." })),
    end: Type.Optional(Type.String({ description: "Event end as an ISO 8601 date-time." })),
    due: Type.Optional(Type.String({ description: "Reminder due date as an ISO 8601 date-time." })),
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

async function ensurePermission(permission: MobileAssistantPermission) {
  const status = await mobileAssistantStatus();
  const alias = status.permissionAliases[permission] ?? permission;
  let states = normalizeMobileAssistantPermissions(status, await checkMobileAssistantPermissions());
  if (states[permission] === "granted") return;
  states = normalizeMobileAssistantPermissions(
    status,
    await requestMobileAssistantPermission(alias),
  );
  if (states[permission] !== "granted") {
    throw new Error(`The user did not grant ${permission} permission.`);
  }
}

export function createMobilePersonalAssistantTools(): BuiltinToolBundle {
  async function executeToolCall(toolCall: ToolCall, signal?: AbortSignal) {
    if (signal?.aborted) return result(toolCall, "Cancelled", true);
    try {
      const args = (toolCall.arguments ?? {}) as Record<string, unknown>;
      const action = text(args.action);
      if (toolCall.name === "MobilePersonalData") {
        if (action === "get_current_location") {
          await ensurePermission("location");
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
          await ensurePermission("calendar");
          const events = await listMobileCalendarEvents(request);
          return result(toolCall, { events });
        }
        if (action === "list_reminders") {
          await ensurePermission("reminders");
          const reminders = await listMobileReminders({
            incompleteOnly: args.incomplete_only !== false,
            limit: limit(args.limit),
          });
          return result(toolCall, { reminders });
        }
      }
      if (toolCall.name !== "MobilePersonalActions") {
        throw new Error(`Unknown tool: ${toolCall.name}`);
      }
      if (action === "create_calendar_event") {
        const request = {
          title: requiredText(args, "title"),
          startMs: dateMs(args.start, "start"),
          endMs: dateMs(args.end, "end"),
          allDay: args.all_day === true,
          location: text(args.location) || null,
          notes: text(args.notes) || null,
        };
        await ensurePermission("calendar");
        const created = await createMobileCalendarEvent(request);
        return result(toolCall, created);
      }
      if (action === "create_reminder") {
        const due = text(args.due);
        const request = {
          title: requiredText(args, "title"),
          dueMs: due ? dateMs(due, "due") : null,
          notes: text(args.notes) || null,
        };
        await ensurePermission("reminders");
        const created = await createMobileReminder(request);
        return result(toolCall, created);
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
