import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Clock3,
  Cloud,
  ImageIcon,
  Loader2,
  Mic,
  RefreshCw,
  Shield,
  WifiOff,
} from "../../components/icons";
import { useLocale } from "../../i18n";
import {
  checkMobileAssistantPermissions,
  type MobileAssistantPermission,
  type MobileAssistantStatus,
  type MobilePermissionStates,
  mobileAssistantStatus,
  normalizeMobileAssistantPermissions,
  requestMobileAssistantPermission,
} from "../../lib/mobileAssistant";
import { cn } from "../../lib/shared/utils";

type PermissionDescriptor = {
  id: MobileAssistantPermission;
  labelKey: string;
  descriptionKey: string;
  icon: typeof Mic;
};

const PERMISSIONS: PermissionDescriptor[] = [
  {
    id: "microphone",
    labelKey: "settings.mobileAssistant.microphone",
    descriptionKey: "settings.mobileAssistant.microphoneDescription",
    icon: Mic,
  },
  {
    id: "calendar",
    labelKey: "settings.mobileAssistant.calendar",
    descriptionKey: "settings.mobileAssistant.calendarDescription",
    icon: Clock3,
  },
  {
    id: "reminders",
    labelKey: "settings.mobileAssistant.reminders",
    descriptionKey: "settings.mobileAssistant.remindersDescription",
    icon: Check,
  },
  {
    id: "photos",
    labelKey: "settings.mobileAssistant.photos",
    descriptionKey: "settings.mobileAssistant.photosDescription",
    icon: ImageIcon,
  },
  {
    id: "location",
    labelKey: "settings.mobileAssistant.location",
    descriptionKey: "settings.mobileAssistant.locationDescription",
    icon: WifiOff,
  },
];

function PermissionStateBadge({
  state,
}: {
  state: MobilePermissionStates[MobileAssistantPermission];
}) {
  const { t } = useLocale();
  const label =
    state === "granted"
      ? t("settings.mobileAssistant.granted")
      : state === "denied"
        ? t("settings.mobileAssistant.denied")
        : t("settings.mobileAssistant.notRequested");
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-1 text-[11px] font-medium",
        state === "granted"
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
          : state === "denied"
            ? "bg-rose-500/10 text-rose-600 dark:text-rose-300"
            : "bg-muted text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

export function MobileAssistantSection() {
  const { t } = useLocale();
  const [status, setStatus] = useState<MobileAssistantStatus>();
  const [permissions, setPermissions] = useState<MobilePermissionStates>({});
  const [busy, setBusy] = useState<MobileAssistantPermission | "refresh" | "">("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setBusy((current) => current || "refresh");
    setError("");
    try {
      const [nextStatus, nextPermissions] = await Promise.all([
        mobileAssistantStatus(),
        checkMobileAssistantPermissions(),
      ]);
      setStatus(nextStatus);
      setPermissions(normalizeMobileAssistantPermissions(nextStatus, nextPermissions));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy((current) => (current === "refresh" ? "" : current));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const permissionRows = useMemo(
    () =>
      PERMISSIONS.filter(
        (permission) => status?.permissionAliases?.[permission.id] !== undefined,
      ),
    [status],
  );

  async function request(permission: MobileAssistantPermission) {
    setBusy(permission);
    setError("");
    try {
      if (!status) throw new Error(t("settings.mobileAssistant.unavailable"));
      const alias = status.permissionAliases[permission] ?? permission;
      const next = await requestMobileAssistantPermission(alias);
      setPermissions(normalizeMobileAssistantPermissions(status, next));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-border/55 bg-card">
        <div className="flex items-start gap-3 border-b border-border/45 px-4 py-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-300">
            <Shield className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">{t("settings.mobileAssistant.permissions")}</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("settings.mobileAssistant.permissionsDescription")}
            </p>
          </div>
          <button
            type="button"
            disabled={busy !== ""}
            onClick={() => void refresh()}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-45"
            aria-label={t("settings.mobileAssistant.refresh")}
          >
            <RefreshCw className={cn("h-4 w-4", busy === "refresh" && "animate-spin")} />
          </button>
        </div>

        <div className="divide-y divide-border/45">
          {permissionRows.map((permission) => {
            const Icon = permission.icon;
            const state = permissions[permission.id] ?? "prompt";
            return (
              <button
                key={permission.id}
                type="button"
                disabled={busy !== "" || state === "granted"}
                onClick={() => void request(permission.id)}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors enabled:hover:bg-muted/35 disabled:cursor-default"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted/70 text-muted-foreground">
                  {busy === permission.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{t(permission.labelKey)}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                    {t(permission.descriptionKey)}
                  </span>
                </span>
                <PermissionStateBadge state={state} />
              </button>
            );
          })}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border/55 bg-card">
        <div className="px-4 pb-2 pt-4 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {t("settings.mobileAssistant.platformServices")}
        </div>
        <div className="divide-y divide-border/45">
          {[
            {
              id: "icloud",
              icon: Cloud,
              title: t("settings.mobileAssistant.icloud"),
              detail: t("settings.mobileAssistant.icloudDescription"),
              available: status?.cloudSyncAvailable,
            },
            {
              id: "external",
              icon: WifiOff,
              title: t("settings.mobileAssistant.externalFolders"),
              detail: t("settings.mobileAssistant.externalFoldersDescription"),
              available: status?.externalFolderMountAvailable,
            },
          ].map((service) => {
            const Icon = service.icon;
            return (
              <div key={service.id} className="flex items-center gap-3 px-4 py-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted/70 text-muted-foreground">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{service.title}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                    {service.detail}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {service.available
                    ? t("settings.mobileAssistant.available")
                    : t("settings.mobileAssistant.unavailable")}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {status?.detail ? (
        <p className="px-1 text-xs leading-relaxed text-muted-foreground">{status.detail}</p>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-xs leading-relaxed text-destructive">
          {error}
        </div>
      ) : null}
    </div>
  );
}
