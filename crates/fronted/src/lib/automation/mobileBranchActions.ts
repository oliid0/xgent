import type { ToolCall } from "@earendil-works/pi-ai";
import type { MobileConnectorWriteInput } from "../connectors/durableMobileWrites";
import type { BackgroundSourceContext } from "./types";

export type MobileBranchProposal = {
  kind: "calendar_event" | "reminder";
  request: Record<string, unknown>;
  sourceId: string;
};
export type DeviceBranchPlan = {
  version: 1;
  requestId: string;
  sourceHostId: string;
  source: NonNullable<BackgroundSourceContext["routing"]>["branches"][number];
  actions: { input: MobileConnectorWriteInput; sourceId: string }[];
};
export type MobileBranchState = {
  plan: DeviceBranchPlan | null;
  states: ("unexecuted" | "running" | "succeeded" | "unknown")[];
};

export type MobilePlanningTicket = { attempts: number; recovery: number };
export type MobileReadKind = "event" | "reminder" | "health";
export type MobileReadChoice = {
  kind: MobileReadKind;
  id: string;
  sourceId: string;
  startMs?: number;
  endMs?: number;
};
export type MobileReadDestination = MobileReadChoice & {
  title: string;
  source: string;
  writable: boolean;
};
export type MobileReadAuthorization = {
  contextHash: string;
  revision: number;
  decision: "pending" | "approved" | "revoked";
  selections: MobileReadDestination[];
  allowedKinds: MobileReadKind[];
  canDiscoverKinds: MobileReadKind[];
  blockedReasons: Partial<Record<MobileReadKind, string>>;
  canApprove: boolean;
  canRevoke: boolean;
};
export type MobileReadChoices = {
  authorization: MobileReadAuthorization;
  kind: MobileReadKind;
  calendars: {
    id: string;
    sourceId: string;
    title: string;
    source: string;
    writable: boolean;
    isDefault: boolean;
    startMs?: number;
    endMs?: number;
  }[];
  truncated: boolean;
};
export const mobileReadChoiceKey = (choice: MobileReadChoice) =>
  JSON.stringify(
    choice.kind === "health"
      ? [choice.kind, choice.id, choice.sourceId, choice.startMs, choice.endMs]
      : [choice.kind, choice.id, choice.sourceId],
  );
export type MobileBranchAuthorization = {
  planHash: string;
  revision: number;
  decision: "pending" | "approved" | "revoked";
  approvedAt: number | null;
  required: boolean;
  blockedReason: string | null;
  allowed: boolean;
  canApprove: boolean;
  canRevoke: boolean;
};
export type MobileBranchReview = {
  requestId: string;
  sourceHostId: string;
  deviceHostId: string;
  cancelRequested: boolean;
  branches: {
    source: DeviceBranchPlan["source"];
    plan: DeviceBranchPlan | null;
    records: (import("../connectors/durableMobileWrites").MobileConnectorWriteRecord | null)[];
    labels: { id: string; title: string; sourceId: string; source: string }[];
    attempts: number;
    recovery: number;
    lastError: string | null;
    acknowledged: boolean;
    canRetryPlanning: boolean;
    authorization?: MobileBranchAuthorization | null;
    readAuthorization?: MobileReadAuthorization;
  }[];
};

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const closed = (value: object, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const timestamp = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 8.64e15;
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const optionalText = (value: unknown) => {
  if (value !== undefined && value !== null && typeof value !== "string")
    throw new Error("Device action text fields must be strings");
  return text(value) || null;
};

/** Model proposals are data only. Native acceptance freezes actual device,
 * operation IDs and account/list observations before ANY SDK effect. */
export function parseMobileBranchProposals(value: unknown): MobileBranchProposal[] {
  if (
    !object(value) ||
    !closed(value, ["actions"]) ||
    !Array.isArray(value.actions) ||
    !value.actions.length ||
    value.actions.length > 8 ||
    new TextEncoder().encode(JSON.stringify(value)).length > 64 * 1024
  )
    throw new Error("Device planning requires 1–8 bounded actions");
  return value.actions.map((action) => {
    if (
      !object(action) ||
      !closed(action, ["kind", "request", "sourceId"]) ||
      !["calendar_event", "reminder"].includes(String(action.kind)) ||
      !object(action.request) ||
      typeof action.sourceId !== "string" ||
      !action.sourceId.trim() ||
      action.sourceId.length > 4096
    )
      throw new Error("Unsupported or unbound device action");
    const source = action.request;
    const title = text(source.title),
      calendarId = text(source.calendarId);
    if (
      !title ||
      new TextEncoder().encode(title).length > 4096 ||
      !calendarId ||
      calendarId.length > 4096
    )
      throw new Error("Device actions require an explicit title and OS calendar/list");
    const notes = optionalText(source.notes);
    let request: Record<string, unknown>;
    if (action.kind === "calendar_event") {
      if (
        !closed(source, [
          "title",
          "calendarId",
          "startMs",
          "endMs",
          "allDay",
          "notes",
          "location",
        ]) ||
        !timestamp(source.startMs) ||
        !timestamp(source.endMs) ||
        source.endMs <= source.startMs ||
        (source.allDay !== undefined && typeof source.allDay !== "boolean")
      )
        throw new Error("Calendar action requires a complete positive interval");
      request = {
        title,
        calendarId,
        startMs: source.startMs,
        endMs: source.endMs,
        allDay: source.allDay === true,
        location: optionalText(source.location),
        notes,
      };
    } else {
      if (
        !closed(source, ["title", "calendarId", "dueMs", "notes", "recurrence"]) ||
        (source.dueMs !== undefined && source.dueMs !== null && !timestamp(source.dueMs)) ||
        (source.recurrence !== undefined &&
          (!timestamp(source.dueMs) || !["daily", "weekly"].includes(String(source.recurrence))))
      )
        throw new Error(
          "Recurring reminder requires a real first due time and daily/weekly frequency",
        );
      request = {
        title,
        calendarId,
        dueMs: source.dueMs ?? null,
        notes,
        ...(source.recurrence ? { recurrence: source.recurrence } : {}),
      };
    }
    if (new TextEncoder().encode(JSON.stringify(request)).length > 32 * 1024)
      throw new Error("Device action exceeds native ledger bounds");
    return {
      kind: action.kind as MobileBranchProposal["kind"],
      sourceId: action.sourceId,
      request,
    };
  });
}

export function mobileBranchToolCall(action: DeviceBranchPlan["actions"][number]): ToolCall {
  const request = action.input.request;
  const arguments_: Record<string, unknown> = {
    action: action.input.kind === "calendar_event" ? "create_calendar_event" : "create_reminder",
    title: request.title,
    calendar_id: request.calendarId,
    notes: request.notes,
  };
  if (action.input.kind === "calendar_event") {
    arguments_.start = new Date(Number(request.startMs)).toISOString();
    arguments_.end = new Date(Number(request.endMs)).toISOString();
    arguments_.all_day = request.allDay;
    arguments_.location = request.location;
  } else {
    if (request.dueMs !== null) arguments_.due = new Date(Number(request.dueMs)).toISOString();
    if (request.recurrence) arguments_.recurrence = request.recurrence;
  }
  return {
    type: "toolCall",
    id: action.input.operationId,
    name: "MobilePersonalActions",
    arguments: arguments_,
  };
}
