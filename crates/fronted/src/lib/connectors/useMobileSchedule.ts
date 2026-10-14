import { useEffect, useRef, useState } from "react";
import {
  checkMobileAssistantPermissions,
  createMobileCalendarEvent,
  createMobileReminder,
  listMobileCalendarEvents,
  listMobileCalendars,
  listMobileReminders,
  type MobileActionResult,
  type MobileCalendarKind,
  type MobileCalendarList,
  mobileAssistantStatus,
  normalizeMobileAssistantPermissions,
  requestMobileAssistantPermission,
} from "../mobileAssistant";

type RecordSummary = { id: string; title: string; time: number | null; source: string };
type Lifetime = { active: boolean; busy: boolean; abort: AbortController; writes: Set<string> };

/** Reject normalized/ambiguous input instead of silently changing the user's date. */
export function localScheduleTime(day: string, time: string) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!parts || !clock) throw new Error("Use YYYY-MM-DD and HH:mm in this device's timezone");
  const [year, month, date, hour, minute] = [...parts.slice(1), ...clock.slice(1)].map(Number);
  const value = new Date(year, month - 1, date, hour, minute);
  if (
    year < 2000 ||
    year > 2100 ||
    value.getFullYear() !== year ||
    value.getMonth() !== month - 1 ||
    value.getDate() !== date ||
    value.getHours() !== hour ||
    value.getMinutes() !== minute
  )
    throw new Error("The date/time does not exist in this device's timezone");
  for (let minutes = 15; minutes <= 180; minutes += 15) {
    const later = new Date(value.getTime() + minutes * 60_000);
    if (
      later.getFullYear() === year &&
      later.getMonth() === month - 1 &&
      later.getDate() === date &&
      later.getHours() === hour &&
      later.getMinutes() === minute
    )
      throw new Error(
        "This local time occurs twice during a timezone change. Choose an unambiguous time.",
      );
  }
  return value.getTime();
}

/** Reads are explicit. Every write uses an observed destination and a captured draft. */
export function useMobileSchedule(enabled: boolean) {
  const [kind, setKindState] = useState<MobileCalendarKind>("event");
  const [calendars, setCalendars] = useState<MobileCalendarList | null>(null);
  const [calendarId, setCalendarId] = useState("");
  const [records, setRecords] = useState<RecordSummary[] | null>(null);
  const [title, setTitle] = useState("");
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(30);
  const [recurrence, setRecurrence] = useState<"none" | "daily" | "weekly">("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<MobileActionResult | null>(null);
  const [written, setWritten] = useState<string[]>([]);
  const lifetime = useRef<Lifetime | null>(null);
  if (!enabled && lifetime.current) lifetime.current.active = false;
  useEffect(() => {
    const owner: Lifetime = {
      active: enabled,
      busy: false,
      abort: new AbortController(),
      writes: new Set(),
    };
    lifetime.current = owner;
    setCalendars(null);
    setCalendarId("");
    setRecords(null);
    setError("");
    setReceipt(null);
    setBusy(false);
    setWritten([]);
    return () => {
      owner.active = false;
      owner.abort.abort();
    };
  }, [enabled]);

  const draft = { kind, calendarId, title: title.trim(), day, time, duration, recurrence };
  const fingerprint = JSON.stringify(draft);
  const canSave =
    !!calendars?.calendars.some((c) => c.id === calendarId) &&
    !!draft.title &&
    !!day &&
    !!time &&
    !busy &&
    !written.includes(fingerprint);

  function setKind(value: MobileCalendarKind) {
    if (value === kind || (value !== "event" && value !== "reminder") || lifetime.current?.busy)
      return;
    setKindState(value);
    setCalendars(null);
    setCalendarId("");
    setRecords(null);
    setError("");
    setReceipt(null);
  }

  async function authorize(owner: Lifetime, capturedKind: MobileCalendarKind) {
    const capability = capturedKind === "event" ? "calendar" : "reminders";
    const status = await mobileAssistantStatus();
    if (!owner.active) throw new Error("Cancelled");
    const alias = status.permissionAliases[capability];
    if (!status.available || !alias)
      throw new Error("The device did not provide this schedule adapter");
    let states = normalizeMobileAssistantPermissions(
      status,
      await checkMobileAssistantPermissions(),
    );
    if (!owner.active) throw new Error("Cancelled");
    if (states[capability] === "denied")
      throw new Error("Schedule access was denied. Enable it in system settings.");
    if (states[capability] !== "granted")
      states = normalizeMobileAssistantPermissions(
        status,
        await requestMobileAssistantPermission(alias, owner.abort.signal),
      );
    if (!owner.active) throw new Error("Cancelled");
    if (states[capability] !== "granted") throw new Error("Full schedule access was not granted");
  }

  async function load() {
    const owner = lifetime.current,
      capturedKind = kind;
    if (!enabled || !owner?.active || owner.busy) return;
    owner.busy = true;
    setBusy(true);
    setError("");
    setCalendars(null);
    setCalendarId("");
    setRecords(null);
    try {
      await authorize(owner, capturedKind);
      const result = await listMobileCalendars(capturedKind);
      if (!owner.active) return;
      if (
        !result ||
        typeof result.truncated !== "boolean" ||
        !Array.isArray(result.calendars) ||
        result.calendars.length > 200 ||
        result.calendars.some(
          (c) =>
            !c ||
            typeof c.id !== "string" ||
            !c.id ||
            typeof c.title !== "string" ||
            typeof c.source !== "string" ||
            typeof c.isDefault !== "boolean",
        ) ||
        new Set(result.calendars.map((c) => c.id)).size !== result.calendars.length
      )
        throw new Error("The device returned invalid calendar destinations");
      setCalendars(result);
      const defaults = result.calendars.filter((c) => c.isDefault);
      if (!result.truncated && defaults.length === 1) setCalendarId(defaults[0].id);
      const now = new Date(),
        end = new Date(now);
      end.setDate(end.getDate() + 7);
      const upcoming =
        capturedKind === "event"
          ? (
              await listMobileCalendarEvents({
                startMs: now.getTime(),
                endMs: end.getTime(),
                limit: 50,
              })
            ).map((c) => ({ id: c.id, title: c.title, time: c.startMs, source: c.calendar ?? "" }))
          : (await listMobileReminders({ incompleteOnly: true, limit: 50 })).map((c) => ({
              id: c.id,
              title: c.title,
              time: c.dueMs ?? null,
              source: c.list ?? "",
            }));
      if (!owner.active) return;
      if (
        upcoming.length > 50 ||
        upcoming.some(
          (c) =>
            typeof c.id !== "string" ||
            typeof c.title !== "string" ||
            typeof c.source !== "string" ||
            (c.time !== null && !Number.isSafeInteger(c.time)),
        )
      )
        throw new Error("The device returned invalid schedule records");
      setRecords(upcoming);
    } catch (cause) {
      if (owner.active) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      owner.busy = false;
      if (owner.active) setBusy(false);
    }
  }

  async function save() {
    const owner = lifetime.current;
    if (!enabled || !owner?.active || owner.busy || !canSave || owner.writes.has(fingerprint))
      return;
    owner.busy = true;
    setBusy(true);
    setError("");
    setReceipt(null);
    let submitted = false;
    try {
      const startMs = localScheduleTime(draft.day, draft.time);
      if (startMs <= Date.now()) throw new Error("Choose a future date/time");
      if (
        draft.title.length > 1024 ||
        !Number.isInteger(draft.duration) ||
        draft.duration < 1 ||
        draft.duration > 1440
      )
        throw new Error("Title or event duration exceeds its bound");
      await authorize(owner, draft.kind);
      // Re-read the destination after permission UI, since accounts may have changed.
      const current = await listMobileCalendars(draft.kind);
      if (!owner.active) return;
      if (!current.calendars.some((c) => c.id === draft.calendarId))
        throw new Error("Selected destination is no longer writable. Refresh before saving.");
      if (startMs <= Date.now())
        throw new Error(
          "The selected time passed while authorization was open. Choose a future time.",
        );
      owner.writes.add(fingerprint);
      submitted = true;
      setWritten([...owner.writes]);
      const saved =
        draft.kind === "event"
          ? await createMobileCalendarEvent(
              {
                title: draft.title,
                startMs,
                endMs: startMs + draft.duration * 60_000,
                calendarId: draft.calendarId,
              },
              `settings-schedule/${fingerprint}`,
            )
          : await createMobileReminder(
              {
                title: draft.title,
                dueMs: startMs,
                calendarId: draft.calendarId,
                ...(draft.recurrence === "none" ? {} : { recurrence: draft.recurrence }),
              },
              `settings-schedule/${fingerprint}`,
            );
      if (!owner.active) return;
      if (saved?.presented !== false || typeof saved.id !== "string" || !saved.id.trim())
        throw new Error("The device did not confirm a saved record ID");
      setReceipt(saved);
    } catch (cause) {
      if (owner.active)
        setError(
          `${cause instanceof Error ? cause.message : String(cause)}${submitted ? " — The write may have occurred. Inspect device records before creating it again; this draft will not be replayed." : ""}`,
        );
    } finally {
      owner.busy = false;
      if (owner.active) setBusy(false);
    }
  }
  return {
    kind,
    setKind,
    calendars,
    calendarId,
    setCalendarId,
    records,
    title,
    setTitle,
    day,
    setDay,
    time,
    setTime,
    duration,
    setDuration,
    recurrence,
    setRecurrence,
    busy,
    error,
    receipt,
    canSave,
    load,
    save,
  };
}
