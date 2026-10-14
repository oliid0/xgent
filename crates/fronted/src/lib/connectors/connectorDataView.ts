import type { MobileContactList } from "../mobileAssistant";

export type ConnectorDataIcon =
  | "calendar"
  | "reminders"
  | "contacts"
  | "home"
  | "room"
  | "accessory"
  | "scene";
export type ConnectorDataRow = {
  id: string;
  label: string;
  description: string;
  icon: ConnectorDataIcon;
  actions?: Array<{
    id: string;
    label: string;
    enabled: boolean;
    loading?: boolean;
    run: () => unknown;
  }>;
};

/** Display names never replace the identities used by the device adapters. */
export function mobileContactRows(
  data: MobileContactList,
  t: (key: string) => string,
): ConnectorDataRow[] {
  return data.contacts.map((contact) => ({
    id: contact.id,
    label:
      contact.name.trim() ||
      contact.phones[0]?.trim() ||
      contact.emails[0]?.trim() ||
      t("settings.connectors.unnamedContact"),
    description: [...contact.phones, ...contact.emails]
      .map((value) => value.trim())
      .filter(Boolean)
      .join(" · "),
    icon: "contacts",
  }));
}

export function connectorObservationTime(time: number, locale?: string): string {
  const date = new Date(time);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString(locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
}

export function mobileScheduleRows(
  records: Array<{ id: string; title: string; time: number | null; source: string }>,
  kind: "event" | "reminder",
  t: (key: string) => string,
  locale?: string,
): ConnectorDataRow[] {
  return records.map((record, index) => ({
    id: `${record.id}:${index}`,
    label: record.title.trim() || t("settings.connectors.unnamedRecord"),
    description: [
      record.time === null ? "" : connectorObservationTime(record.time, locale),
      record.source,
    ]
      .filter(Boolean)
      .join(" · "),
    icon: kind === "event" ? "calendar" : "reminders",
  }));
}
