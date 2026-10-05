import { useState } from "react";
import { useLocale } from "../../i18n";
import { isNativeMobileRuntime } from "../../lib/runtimePlatform";
import type { AppSettings } from "../../lib/settings";
import { presentationControls } from "../../presentation/controls";
import { NativeSurface } from "../../presentation/NativeSurface";
import { createNativePresentationTheme } from "../../presentation/nativeTheme";
import type { PresentationNode } from "../../presentation/types";
import { SYNC_PRESETS } from "./backupSyncForm";
import type { useBackupSyncData } from "./useBackupSyncData";

/** Presentation only: every action uses the same backup model as Astryx. */
export function NativeBackupSyncSection(props: {
  settings: AppSettings;
  data: ReturnType<typeof useBackupSyncData>;
  onBack?: () => void;
  nativeSettingsSurfaceId?: string;
}) {
  const { t } = useLocale();
  const [failure, setFailure] = useState<unknown>(null);
  if (failure) throw failure;
  const { data } = props;
  const c = presentationControls();
  const { form, syncView, locked } = data;
  const mobile = isNativeMobileRuntime();
  const available = !locked && !data.dirty && data.configured;
  const back = c.action("backup-back", t("settings.mobile.backToSettings"), () => props.onBack?.());
  const nodes: PresentationNode[] = [
    ...(mobile ? [{ ...back, id: "back", kind: "IconButton" as const, icon: "chevron.left" }] : []),
    ...(data.operation === "load"
      ? [{ id: "backup-loading", kind: "Progress" as const, label: t("app.loading") }]
      : []),
    ...(!syncView && data.operation !== "load"
      ? [c.action("backup-retry", t("presentation.retry"), data.reload, data.operation === null)]
      : []),
    c.group("backup-connection", t("settings.backupSyncTitle"), [
      {
        id: "backup-connection-description",
        kind: "Text",
        text: t("settings.backupSyncDesc"),
        secondary: true,
      },
      {
        id: "backup-connection-fields",
        kind: "VStack",
        variant: "backup-connection-fields",
        children: [
          c.select(
            "backup-preset",
            t("settings.backupSyncPreset"),
            data.preset,
            [
              ...SYNC_PRESETS.map((item) => ({
                value: item.id,
                label: t(`settings.backupSyncPreset_${item.id}`),
              })),
              { value: "custom", label: t("settings.backupSyncPreset_custom") },
            ],
            data.handlePresetChange,
            !locked,
          ),
          c.input(
            "backup-url",
            t("settings.backupSyncUrl"),
            form.url,
            (url) => data.patchForm({ url }),
            false,
            !locked,
          ),
          c.input(
            "backup-username",
            t("settings.backupSyncUsername"),
            form.username,
            (username) => data.patchForm({ username }),
            false,
            !locked,
          ),
          c.input(
            "backup-password",
            t("settings.backupSyncPassword"),
            form.password,
            (password) => data.patchForm({ password, passwordTouched: password.length > 0 }),
            true,
            !locked,
          ),
          ...(syncView?.hasPassword && !form.passwordTouched
            ? [
                {
                  id: "backup-password-saved",
                  kind: "Text" as const,
                  text: t("settings.backupSyncPasswordSaved"),
                  secondary: true,
                },
              ]
            : []),
          ...(syncView?.hasPassword
            ? [
                {
                  ...c.action(
                    "backup-clear-password",
                    t("settings.backupSyncClearPassword"),
                    () => data.patchForm({ password: "", passwordTouched: true }),
                    !locked,
                  ),
                  destructive: true,
                },
              ]
            : []),
          c.input(
            "backup-directory",
            t("settings.backupSyncRemoteDir"),
            form.remoteDir,
            (remoteDir) => data.patchForm({ remoteDir }),
            false,
            !locked,
          ),
          c.input(
            "backup-profile",
            t("settings.backupSyncProfile"),
            form.profile,
            (profile) => data.patchForm({ profile }),
            false,
            !locked,
          ),
          {
            id: "backup-profile-hint",
            kind: "Text",
            text: t("settings.backupSyncProfileHint"),
            secondary: true,
          },
          {
            ...c.toggle(
              "backup-auto",
              t("settings.backupSyncAuto"),
              form.autoSync,
              data.handleAutoSyncChange,
              !locked,
            ),
            text: t("settings.backupSyncAutoHint"),
          },
        ],
      },
      {
        id: "backup-transfer-actions",
        kind: "VStack",
        variant: "backup-transfer-actions",
        children: [
          {
            ...c.action(
              "backup-save-connection",
              t("settings.backupSyncSave"),
              data.handleSaveSync,
              !locked,
            ),
            prominent: true,
            icon: "checkmark",
          },
          {
            ...c.action(
              "backup-test-connection",
              t("settings.backupSyncTest"),
              data.handleTestSync,
              available,
            ),
            icon: "network",
          },
          {
            ...c.action(
              "backup-upload",
              t("settings.backupSyncUpload"),
              data.handleUpload,
              available,
            ),
            icon: "icloud.and.arrow.up",
          },
          {
            ...c.action(
              "backup-download",
              t("settings.backupSyncDownload"),
              data.handleDownload,
              available,
            ),
            icon: "icloud.and.arrow.down",
          },
        ],
      },
    ]),
    ...(data.dirty && !locked
      ? [
          {
            id: "backup-dirty",
            kind: "Banner" as const,
            label: t("settings.backupSyncDirtyHint"),
            status: "paused" as const,
          },
        ]
      : []),
    ...(syncView?.lastSyncAt
      ? [
          {
            id: "backup-last-sync",
            kind: "Text" as const,
            text: `${t("settings.backupSyncLastAt")}${new Date(syncView.lastSyncAt).toLocaleString()}`,
            secondary: true,
          },
        ]
      : []),
    ...(syncView?.lastError
      ? [
          {
            id: "backup-persisted-error",
            kind: "Banner" as const,
            label: t("settings.backupSyncAutoErrorTitle"),
            text: syncView.lastError,
            status: "error" as const,
          },
        ]
      : []),
    ...(data.syncStatus
      ? [
          {
            id: "backup-status",
            kind: "Banner" as const,
            label: data.syncStatus.text,
            status: data.syncStatus.kind === "ok" ? ("completed" as const) : ("error" as const),
          },
        ]
      : []),
    ...(data.localAvailable
      ? [
          c.group("backup-local", t("settings.backupLocalTitle"), [
            {
              id: "backup-local-description",
              kind: "Text",
              text: t("settings.backupLocalDesc"),
              secondary: true,
            },
            c.action("backup-export", t("settings.backupExport"), data.handleExport, !locked),
            c.action("backup-import", t("settings.backupImport"), data.handleImport, !locked),
            {
              id: "backup-local-hint",
              kind: "Text",
              text: t("settings.backupAutoBackupHint"),
              secondary: true,
            },
            ...(data.status
              ? [
                  {
                    id: "backup-local-status",
                    kind: "Banner" as const,
                    label: data.status.text,
                    status: data.status.kind === "ok" ? ("completed" as const) : ("error" as const),
                  },
                ]
              : []),
          ]),
        ]
      : []),
    c.group("backup-scope", t("settings.backupScopeTitle"), [
      {
        id: "backup-scope-description",
        kind: "Text",
        text: t("settings.backupScopeDesc"),
        secondary: true,
      },
    ]),
  ];
  return (
    <NativeSurface
      sessionSurface={props.nativeSettingsSurfaceId}
      document={{
        mode: "sheet",
        title: t("settings.navBackup"),
        appearance: props.settings.theme,
        formFactor: mobile ? "mobile" : "desktop",
        theme: createNativePresentationTheme(props.settings, mobile),
        dismissAction: "backup-back",
        nodes,
      }}
      handlers={c.handlers}
      onError={setFailure}
    />
  );
}
