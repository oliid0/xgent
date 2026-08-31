//

import type { BackupSyncConfigView, BackupSyncStatusEvent } from "../../lib/backup";

export type SyncForm = {
  url: string;
  username: string;
  password: string;
  passwordTouched: boolean;
  remoteDir: string;
  profile: string;
  autoSync: boolean;
};

export type PresetId = "jianguoyun" | "nextcloud" | "synology" | "custom";

export const SYNC_PRESETS: { id: Exclude<PresetId, "custom">; url: string }[] = [
  { id: "jianguoyun", url: "https://dav.jianguoyun.com/dav/" },
  { id: "nextcloud", url: "https://server/remote.php/dav/files/USER/" },
  { id: "synology", url: "http://nas-ip:5005/" },
];

export function detectPreset(url: string): PresetId {
  const trimmed = url.trim();
  if (!trimmed) return "custom";
  let host = "";
  let port = "";
  try {
    const parsed = new URL(trimmed);
    host = parsed.hostname.toLowerCase();
    port = parsed.port;
  } catch {
    return "custom";
  }
  if (host === "dav.jianguoyun.com") return "jianguoyun";
  if (/\/remote\.php\/dav\//i.test(trimmed)) return "nextcloud";
  if (port === "5005" || port === "5006") return "synology";
  return "custom";
}

export function emptyForm(): SyncForm {
  return {
    url: "",
    username: "",
    password: "",
    passwordTouched: false,
    remoteDir: "",
    profile: "",
    autoSync: false,
  };
}

export function formFromView(view: BackupSyncConfigView): SyncForm {
  return {
    url: view.url,
    username: view.username,

    password: "",
    passwordTouched: false,
    remoteDir: view.remoteDir,
    profile: view.profile,
    autoSync: view.autoSync,
  };
}

export function isDirty(form: SyncForm, view: BackupSyncConfigView | null): boolean {
  if (!view) return true;
  return (
    form.passwordTouched ||
    form.url !== view.url ||
    form.username !== view.username ||
    form.remoteDir !== view.remoteDir ||
    form.profile !== view.profile ||
    form.autoSync !== view.autoSync
  );
}

export function canTestSyncConnection(view: BackupSyncConfigView): boolean {
  return Boolean(view.url && view.username && view.hasPassword);
}

export function isAutoSyncSuccess(payload: BackupSyncStatusEvent): boolean {
  return !payload.lastError && payload.lastSyncAt !== null;
}

export function applySyncStatusEvent(
  prev: BackupSyncConfigView | null,
  payload: BackupSyncStatusEvent,
): BackupSyncConfigView | null {
  if (!prev) return prev;
  if (payload.lastError) return { ...prev, lastError: payload.lastError };
  if (payload.lastSyncAt !== null) {
    return { ...prev, lastSyncAt: payload.lastSyncAt, lastError: null };
  }
  return prev;
}
