import { listen } from "@xgent/runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConfirmDialogOptions } from "../../components/astryx/useConfirmDialog";
import {
  applyBackupImport,
  BACKUP_SYNC_STATUS_EVENT,
  type BackupSyncConfigView,
  type BackupSyncStatusEvent,
  downloadBackup,
  exportBackup,
  fetchRemoteInfo,
  loadSyncConfig,
  peekBackupImport,
  saveSyncConfig,
  testSyncConnection,
  uploadBackup,
} from "../../lib/backup";
import { isNativeMobileRuntime } from "../../lib/runtimePlatform";
import { normalizeSkillsSettings } from "../../lib/settings";
import { describeBackupSource, summarizeBackupDomains } from "./backupManifestText";
import {
  applySyncStatusEvent,
  canTestSyncConnection,
  detectPreset,
  emptyForm,
  formFromView,
  isAutoSyncSuccess,
  isDirty,
  type PresetId,
  SYNC_PRESETS,
  type SyncForm,
} from "./backupSyncForm";
import type { SettingsSectionProps } from "./types";

type Operation =
  | "load"
  | "save"
  | "test"
  | "upload"
  | "download"
  | "export"
  | "import"
  | "auto-confirm";
type Status = { kind: "ok" | "error"; text: string } | null;

/** One backup controller for Astryx and SwiftUI; the existing Tauri commands own persistence. */
export function useBackupSyncData(
  props: SettingsSectionProps,
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>,
  t: (key: string) => string,
) {
  const [operation, setOperation] = useState<Operation | null>("load");
  const [syncView, setSyncViewState] = useState<BackupSyncConfigView | null>(null);
  const [form, setFormState] = useState<SyncForm>(emptyForm);
  const viewRef = useRef(syncView);
  const formRef = useRef(form);
  const setSyncView = useCallback(
    (
      next:
        | BackupSyncConfigView
        | null
        | ((value: BackupSyncConfigView | null) => BackupSyncConfigView | null),
    ) => {
      const value = typeof next === "function" ? next(viewRef.current) : next;
      viewRef.current = value;
      setSyncViewState(value);
    },
    [],
  );
  const setForm = useCallback((next: SyncForm | ((value: SyncForm) => SyncForm)) => {
    const value = typeof next === "function" ? next(formRef.current) : next;
    formRef.current = value;
    setFormState(value);
  }, []);
  const [preset, setPreset] = useState<PresetId>("custom");
  const [status, setStatus] = useState<Status>(null);
  const [syncStatus, setSyncStatus] = useState<Status>(null);
  const scope = useRef({ active: true, revision: 0, operation: null as Operation | null }).current;
  const latest = useRef({ props, t });
  latest.current = { props, t };
  const localAvailable = !isNativeMobileRuntime();
  const dirty = isDirty(form, syncView);
  const configured = !!syncView?.url.trim();
  const locked = operation !== null || syncView === null;

  const run = useCallback(
    async (kind: Operation, task: (current: () => boolean) => Promise<void>) => {
      if (!scope.active || scope.operation !== null) return;
      const revision = ++scope.revision;
      scope.operation = kind;
      setOperation(kind);
      const local = kind === "export" || kind === "import";
      const report = local ? setStatus : setSyncStatus;
      report(null);
      const current = () => scope.active && scope.revision === revision;
      try {
        await task(current);
      } catch (error) {
        if (current())
          report({ kind: "error", text: error instanceof Error ? error.message : String(error) });
      } finally {
        if (current()) {
          scope.operation = null;
          setOperation(null);
        }
      }
    },
    [scope],
  );
  const patchForm = (patch: Partial<SyncForm>) => {
    if (!scope.active || scope.operation !== null || !viewRef.current) return;
    setSyncStatus(null);
    setForm((value) => ({ ...value, ...patch }));
  };
  const reload = useCallback(
    () =>
      run("load", async (current) => {
        const view = await loadSyncConfig();
        if (!current()) return;
        setSyncView(view);
        setForm(formFromView(view));
        setPreset(detectPreset(view.url));
      }),
    [run, setSyncView, setForm],
  );
  useEffect(() => {
    scope.active = true;
    void reload();
    return () => {
      scope.active = false;
      scope.revision++;
      scope.operation = null;
    };
  }, [scope, reload]);
  useEffect(() => {
    let retired = false;
    let unlisten: (() => void) | undefined;
    void listen<BackupSyncStatusEvent>(BACKUP_SYNC_STATUS_EVENT, (event) => {
      if (retired || !scope.active) return;
      setSyncView((value) => applySyncStatusEvent(value, event.payload));
      if (isAutoSyncSuccess(event.payload))
        setSyncStatus({ kind: "ok", text: latest.current.t("settings.backupSyncAutoDone") });
    })
      .then((stop) => {
        if (retired) stop();
        else unlisten = stop;
      })
      .catch((error) => {
        if (!retired && scope.active) setSyncStatus({ kind: "error", text: String(error) });
      });
    return () => {
      retired = true;
      unlisten?.();
    };
  }, [scope, setSyncView]);

  async function restore(skills: unknown) {
    // Restore changed persistent settings, even if the user left this screen meanwhile.
    await latest.current.props.reloadSettings?.();
    if (skills)
      latest.current.props.setSettings((previous) => ({
        ...previous,
        skills: normalizeSkillsSettings(skills),
      }));
  }
  const handlePresetChange = (value: string) => {
    if (
      !scope.active ||
      scope.operation !== null ||
      !viewRef.current ||
      !["custom", ...SYNC_PRESETS.map((item) => item.id)].includes(value)
    )
      return;
    setPreset(value as PresetId);
    const matched = SYNC_PRESETS.find((item) => item.id === value);
    if (matched) patchForm({ url: matched.url });
  };
  const handleAutoSyncChange = (checked: boolean) => {
    if (!viewRef.current) return Promise.resolve();
    if (!checked) {
      patchForm({ autoSync: false });
      return Promise.resolve();
    }
    return run("auto-confirm", async (current) => {
      const approved = await confirm({
        title: t("settings.backupSyncAutoConfirmTitle"),
        subtitle: t("settings.backupSyncAutoConfirmSubtitle"),
        description: t("settings.backupSyncAutoConfirmDesc"),
        confirmLabel: t("settings.backupSyncAutoConfirmAction"),
        cancelLabel: t("settings.backupCancel"),
        tone: "warning",
      });
      if (approved && current()) setForm((value) => ({ ...value, autoSync: true }));
    });
  };
  const handleSaveSync = () =>
    !viewRef.current
      ? Promise.resolve()
      : run("save", async (current) => {
          const view = await saveSyncConfig({ ...formRef.current });
          if (!current()) return;
          setSyncView(view);
          setForm(formFromView(view));
          setPreset(detectPreset(view.url));
          if (!canTestSyncConnection(view)) {
            setSyncStatus({ kind: "ok", text: t("settings.backupSyncSaveDone") });
            return;
          }
          try {
            await testSyncConnection();
            if (current())
              setSyncStatus({ kind: "ok", text: t("settings.backupSyncSaveAndTestDone") });
          } catch (error) {
            if (current())
              setSyncStatus({
                kind: "error",
                text: `${t("settings.backupSyncSaveAndTestFailed")}${error instanceof Error ? error.message : String(error)}`,
              });
          }
        });
  const mayUseSavedConnection = () =>
    scope.active && !isDirty(formRef.current, viewRef.current) && !!viewRef.current?.url.trim();
  const handleTestSync = () => {
    if (!mayUseSavedConnection()) return Promise.resolve();
    return run("test", async (current) => {
      await testSyncConnection();
      if (current()) setSyncStatus({ kind: "ok", text: t("settings.backupSyncTestDone") });
    });
  };
  const handleUpload = () => {
    if (!mayUseSavedConnection()) return Promise.resolve();
    return run("upload", async (current) => {
      const remote = await fetchRemoteInfo();
      if (!current()) return;
      if (remote) {
        const approved = await confirm({
          title: t("settings.backupSyncUploadConfirmTitle"),
          subtitle: t("settings.backupSyncUploadConfirmSubtitle"),
          description: describeBackupSource(remote.manifest, t),
          confirmLabel: t("settings.backupSyncUpload"),
          cancelLabel: t("settings.backupCancel"),
          tone: "warning",
        });
        if (!approved || !current()) return;
      }
      const at = await uploadBackup(latest.current.props.settings.skills);
      if (current()) {
        setSyncView((value) => (value ? { ...value, lastSyncAt: at, lastError: null } : value));
        setSyncStatus({ kind: "ok", text: t("settings.backupSyncUploadDone") });
      }
    });
  };
  const handleDownload = () => {
    if (!mayUseSavedConnection()) return Promise.resolve();
    return run("download", async (current) => {
      const remote = await fetchRemoteInfo();
      if (!current()) return;
      if (!remote) {
        setSyncStatus({ kind: "error", text: t("settings.backupSyncRemoteEmpty") });
        return;
      }
      const approved = await confirm({
        title: t("settings.backupSyncDownloadConfirmTitle"),
        subtitle: t("settings.backupSyncDownloadConfirmSubtitle"),
        description: describeBackupSource(remote.manifest, t),
        confirmLabel: t("settings.backupSyncDownload"),
        cancelLabel: t("settings.backupCancel"),
        tone: "warning",
      });
      if (!approved || !current()) return;
      const outcome = await downloadBackup();
      await restore(outcome.skills);
      if (current()) {
        setSyncView((value) => (value ? { ...value, lastError: null } : value));
        setSyncStatus({
          kind: "ok",
          text: `${t("settings.backupSyncDownloadDone")}${summarizeBackupDomains(outcome.applied, t)}`,
        });
      }
    });
  };
  const handleExport = () => {
    if (!localAvailable) return Promise.resolve();
    return run("export", async (current) => {
      const path = await exportBackup(latest.current.props.settings.skills);
      if (path && current())
        setStatus({ kind: "ok", text: `${t("settings.backupExportDone")}${path}` });
    });
  };
  const handleImport = () => {
    if (!localAvailable) return Promise.resolve();
    return run("import", async (current) => {
      const preview = await peekBackupImport();
      if (!preview || !current()) return;
      const approved = await confirm({
        title: t("settings.backupImportConfirmTitle"),
        subtitle: t("settings.backupImportConfirmSubtitle"),
        description: describeBackupSource(preview.manifest, t),
        detail: preview.path,
        confirmLabel: t("settings.backupImportConfirmAction"),
        cancelLabel: t("settings.backupCancel"),
        tone: "warning",
      });
      if (!approved || !current()) return;
      const outcome = await applyBackupImport(preview.path);
      await restore(outcome.skills);
      if (current())
        setStatus({
          kind: "ok",
          text: `${t("settings.backupImportDone")}${summarizeBackupDomains(outcome.applied, t)}`,
        });
    });
  };
  return {
    syncView,
    form,
    preset,
    status,
    syncStatus,
    dirty,
    configured,
    locked,
    localAvailable,
    operation,
    busy: operation === "export" || operation === "import" ? operation : null,
    syncBusy: operation !== "export" && operation !== "import" ? operation : null,
    patchForm,
    reload,
    handlePresetChange,
    handleAutoSyncChange,
    handleSaveSync,
    handleTestSync,
    handleUpload,
    handleDownload,
    handleExport,
    handleImport,
  };
}
