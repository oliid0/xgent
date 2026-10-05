import type { BackupDomainCounts, BackupManifest } from "../../lib/backup";

export function backupLastSyncText(value: number, t: (key: string) => string, locale?: string) {
  const date = new Date(value);
  const time = Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(locale);
  return t("settings.backupSyncLastAt").replace("{time}", time);
}

export function summarizeBackupDomains(counts: BackupDomainCounts, t: (key: string) => string) {
  return [
    `${t("settings.backupDomainProviders")} ${counts.providers}`,
    `${t("settings.backupDomainMcp")} ${counts.mcp}`,
    `${t("settings.backupDomainSystem")} ${counts.system}`,
    `${t("settings.backupDomainSkills")} ${counts.skills}`,
  ].join(" · ");
}

export function describeBackupSource(manifest: BackupManifest, t: (key: string) => string) {
  const date = new Date(manifest.createdAt);
  return [
    `${t("settings.backupSourceDevice")}: ${manifest.deviceName}`,
    `${t("settings.backupSourceTime")}: ${Number.isNaN(date.getTime()) ? manifest.createdAt : date.toLocaleString()}`,
    `${t("settings.backupSourceVersion")}: ${manifest.appVersion}`,
    summarizeBackupDomains(manifest.domains, t),
  ].join("\n");
}
