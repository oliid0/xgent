import type { CronRunRecord } from "../lib/automation";

/** Display values shared by the Astryx and SwiftUI run history components. */
export function cronRunDisplay(run: CronRunRecord, t: (key: string) => string, locale?: string) {
  const running = run.state === "pending" || run.state === "leased";
  const success = run.state === "done" && run.success;
  const status = running ? "running" : success ? "completed" : "error";
  const label = t(
    running
      ? "settings.cronViewLogRunning"
      : run.state === "expired"
        ? "settings.cronViewLogExpired"
        : success
          ? "settings.cronViewLogSuccess"
          : "settings.cronViewLogFailed",
  );
  const date = new Date(run.startedAt);
  const duration = running
    ? "—"
    : run.durationMs < 1000
      ? `${run.durationMs}ms`
      : `${(run.durationMs / 1000).toFixed(1)}s`;
  return {
    status: status as "running" | "completed" | "error",
    label,
    date: date.toLocaleDateString(locale, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    time: date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
    duration,
    metadata: `${duration}${run.exitCode == null ? "" : ` · ${t("settings.cronViewLogExit")} ${run.exitCode}`}`,
  };
}
