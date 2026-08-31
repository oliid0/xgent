import { invoke } from "@xgent/runtime";
import type { SkillsSettings } from "../settings";

export type BackupDomainCounts = {
  providers: number;
  mcp: number;
  system: number;
  skills: number;
};

export type BackupManifest = {
  protocolVersion: number;
  schemaVersion: number;
  snapshotId: string;
  /** RFC3339 UTC。 */
  createdAt: string;
  deviceName: string;
  appVersion: string;

  encryption: string;
  domains: BackupDomainCounts;
};

export type BackupImportPreview = {
  path: string;
  manifest: BackupManifest;
};

export type BackupApplyOutcome = {
  applied: BackupDomainCounts;

  skills: SkillsSettings | null;

  backupPath: string | null;
};

export async function exportBackup(skills: SkillsSettings): Promise<string | null> {
  return await invoke<string | null>("settings_backup_export", { skills });
}

export async function peekBackupImport(): Promise<BackupImportPreview | null> {
  return await invoke<BackupImportPreview | null>("settings_backup_peek_import", { path: null });
}

export async function applyBackupImport(path: string): Promise<BackupApplyOutcome> {
  return await invoke<BackupApplyOutcome>("settings_backup_apply_import", { path });
}

export type BackupSyncConfigView = {
  url: string;
  username: string;
  hasPassword: boolean;
  remoteDir: string;
  profile: string;
  autoSync: boolean;

  lastSyncAt: number | null;
  lastError: string | null;
};

export type BackupSyncConfigRequest = {
  url: string;
  username: string;
  password: string;
  passwordTouched: boolean;
  remoteDir: string;
  profile: string;
  autoSync: boolean;
};

export type BackupRemoteInfo = {
  manifest: BackupManifest;
  size: number;
  sha256: string;
};

export async function loadSyncConfig(): Promise<BackupSyncConfigView> {
  return await invoke<BackupSyncConfigView>("settings_backup_load_sync_config");
}

export async function saveSyncConfig(
  config: BackupSyncConfigRequest,
): Promise<BackupSyncConfigView> {
  return await invoke<BackupSyncConfigView>("settings_backup_save_sync_config", { config });
}

export async function testSyncConnection(): Promise<void> {
  await invoke("settings_backup_test_sync_connection");
}

export async function fetchRemoteInfo(): Promise<BackupRemoteInfo | null> {
  return await invoke<BackupRemoteInfo | null>("settings_backup_fetch_remote_info");
}

export async function uploadBackup(skills: SkillsSettings): Promise<number> {
  return await invoke<number>("settings_backup_upload", { skills });
}

export async function downloadBackup(): Promise<BackupApplyOutcome> {
  return await invoke<BackupApplyOutcome>("settings_backup_download");
}

export function markBackupDirty(skills: SkillsSettings): void {
  void invoke("settings_backup_mark_dirty", { skills }).catch(() => {});
}

export type BackupSyncStatusEvent = {
  lastSyncAt: number | null;
  lastError: string | null;
};

export const BACKUP_SYNC_STATUS_EVENT = "backup-sync-status-updated";
