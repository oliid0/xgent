import { openUrl } from "@xagent/runtime";
import iconSimpleUrl from "../../../src-tauri/icons/icon-simple.png";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  Shield,
  Sparkles,
} from "../../components/icons";
import { Markdown } from "../../components/Markdown";
import { Button } from "../../components/ui/button";
import { useLocale } from "../../i18n";
import type { AppUpdateCheckResult, AppUpdateController } from "../../lib/appUpdates";
import { updateUpdateSettings } from "../../lib/settings";
import { formatReleaseDate } from "./aboutDate";
import { AgentActivationSwitch } from "./shared";
import type { SettingsSectionProps } from "./types";

type AboutSectionProps = SettingsSectionProps & {
  appUpdate: AppUpdateController;
};

function releaseTitle(result?: AppUpdateCheckResult) {
  if (!result) return "";
  return result.releaseName?.trim() || result.releaseTag?.trim() || result.version || "";
}

function normalizeTitle(value: string) {
  return value
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function releaseNotesBody(result?: AppUpdateCheckResult) {
  const body = result?.body?.replace(/^\s*(?:<!--[\s\S]*?-->\s*)+/, "").trim();
  if (!body) return "";

  const title = normalizeTitle(releaseTitle(result));
  if (!title) return body;

  const lines = body.split(/\r?\n/);
  const firstContentIndex = lines.findIndex((line) => line.trim());
  if (firstContentIndex < 0) return "";

  const firstContentLine = lines[firstContentIndex].trim();
  if (/^#\s+/.test(firstContentLine) && normalizeTitle(firstContentLine) === title) {
    return lines
      .slice(firstContentIndex + 1)
      .join("\n")
      .trim();
  }

  return body;
}

export function AboutSection(props: AboutSectionProps) {
  const { settings, setSettings, appUpdate } = props;
  const { t } = useLocale();
  const includePrereleases = settings.updates.includePrereleases;
  const checkState = appUpdate.state;

  async function handleInstallUpdate() {
    await appUpdate.installOnly().catch(() => undefined);
  }

  async function handleRestartApp() {
    if (checkState.status !== "installed") return;
    await appUpdate.restart().catch(() => undefined);
  }

  const latestResult = appUpdate.result;
  const latestReleaseNotes = releaseNotesBody(latestResult);
  const channelLabel =
    latestResult?.channel === "prerelease"
      ? t("settings.aboutChannelPrerelease")
      : t("settings.aboutChannelStable");
  const currentVersion = latestResult?.currentVersion || __XAGENT_APP_VERSION__;
  const nextVersion = latestResult?.version || latestResult?.releaseTag || "";
  const releaseDate = formatReleaseDate(latestResult?.date);
  const checking = checkState.status === "checking";
  const installing = checkState.status === "installing";
  const installed = checkState.status === "installed";
  const restarting = checkState.status === "restarting";
  const canInstall = appUpdate.canInstall;
  const statusTitle =
    checkState.status === "error"
      ? t("settings.aboutUpdateError")
      : checking
        ? t("settings.aboutChecking")
        : installing
          ? t("settings.aboutInstalling")
          : restarting
            ? t("settings.aboutRestarting")
            : installed
              ? t("settings.aboutInstalled")
              : latestResult?.available
                ? t("settings.aboutUpdateAvailable")
                : latestResult?.manualDownload
                  ? t("settings.aboutManualUpdate")
                  : latestResult?.configured
                    ? t("settings.aboutUpToDate")
                    : t("settings.aboutUpdaterNotConfigured");
  const statusDescription =
    checkState.status === "error"
      ? appUpdate.message || t("settings.aboutUpdateError")
      : checking
        ? t("settings.aboutCheckingDesc")
        : installing
          ? t("settings.aboutInstallingDesc")
          : restarting
            ? t("settings.aboutRestartingDesc")
            : installed
              ? t("settings.aboutInstalledDesc")
              : latestResult?.available
                ? t("settings.aboutUpdateAvailableDesc")
                : latestResult?.manualDownload
                  ? t("settings.aboutManualUpdateDesc")
                  : latestResult?.configured
                    ? t("settings.aboutUpToDateDesc")
                    : latestResult?.message || t("settings.aboutUpdaterNotConfiguredDesc");

  return (
    <div className="settings-about-section space-y-6">
      <div className="settings-about-header flex flex-wrap items-start justify-between gap-4">
        <div className="settings-about-identity flex min-w-0 items-center gap-3">
          <img
            src={iconSimpleUrl}
            alt=""
            className="settings-about-app-icon h-14 w-14 shrink-0 rounded-[15px] shadow-[0_12px_30px_-18px_rgba(0,0,0,0.65)]"
          />
          <div className="min-w-0">
            <h3 className="text-lg font-semibold tracking-tight">XGent</h3>
            <div className="mt-0.5 text-xs font-medium tabular-nums text-muted-foreground">
              v{currentVersion}
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              {t("settings.aboutDescription")}
            </p>
          </div>
        </div>

        <div className="settings-about-header-actions flex items-center gap-2">
          {latestResult?.releaseUrl ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void openUrl(latestResult.releaseUrl || "")}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t("settings.aboutOpenRelease")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void appUpdate.runCheck().catch(() => undefined)}
            disabled={checking || installing || restarting}
          >
            {checking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {t("settings.aboutCheckUpdate")}
          </Button>
        </div>
      </div>

      <div className="settings-about-grid grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="settings-about-card space-y-4 rounded-2xl border border-border/60 bg-card p-4">
          <div className="settings-about-version-row flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("settings.aboutCurrentVersion")}
              </div>
              <div className="mt-1 text-2xl font-semibold leading-none tabular-nums">
                v{currentVersion}
              </div>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/45 px-2.5 py-1 text-xs font-medium">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              {channelLabel}
            </div>
          </div>

          <div className="settings-about-status-card rounded-xl border border-border/60 bg-background/70 p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                {checkState.status === "error" ? (
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                ) : restarting ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : latestResult?.available || latestResult?.manualDownload ? (
                  <Download className="h-4 w-4 text-primary" />
                ) : checking ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{statusTitle}</div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {statusDescription}
                </p>

                {nextVersion ? (
                  <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                    <div className="rounded-lg bg-muted/45 px-3 py-2">
                      <div className="text-muted-foreground">
                        {t("settings.aboutLatestVersion")}
                      </div>
                      <div className="mt-0.5 font-medium tabular-nums">v{nextVersion}</div>
                    </div>
                    <div className="rounded-lg bg-muted/45 px-3 py-2">
                      <div className="text-muted-foreground">{t("settings.aboutReleaseDate")}</div>
                      <div className="mt-0.5 truncate font-medium">{releaseDate || "N/A"}</div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={installed ? handleRestartApp : handleInstallUpdate}
                disabled={(installed ? false : !canInstall) || installing || restarting}
              >
                {installing || restarting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : installed ? (
                  <RefreshCw className="h-4 w-4" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {installed ? t("settings.aboutRestartApp") : t("settings.aboutInstallUpdate")}
              </Button>
              <div className="text-xs text-muted-foreground">
                {latestResult?.repository || "oliid0/xgent"}
              </div>
            </div>
          </div>

          {latestReleaseNotes ? (
            <div className="settings-about-release-notes space-y-2 rounded-xl border border-border/60 bg-background/70 p-4">
              <div className="text-sm font-semibold">{releaseTitle(latestResult)}</div>
              <div className="max-h-48 overflow-auto pr-2">
                <Markdown
                  content={latestReleaseNotes}
                  className="release-notes-markdown text-xs leading-relaxed text-muted-foreground"
                />
              </div>
            </div>
          ) : null}
        </section>

        <aside className="space-y-4">
          <section className="settings-about-card rounded-2xl border border-border/60 bg-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  {t("settings.aboutPrereleaseTitle")}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {t("settings.aboutPrereleaseDesc")}
                </p>
              </div>
              <AgentActivationSwitch
                checked={includePrereleases}
                title={t("settings.aboutPrereleaseToggle")}
                onToggle={() =>
                  setSettings((prev) =>
                    updateUpdateSettings(prev, {
                      includePrereleases: !prev.updates.includePrereleases,
                    }),
                  )
                }
              />
            </div>
          </section>

          <section className="settings-about-card space-y-3 rounded-2xl border border-border/60 bg-card p-4">
            <div className="text-sm font-semibold">{t("settings.aboutNotesTitle")}</div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("settings.aboutNotesBody")}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("settings.aboutSecurityBody")}
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
