import { Button } from "@astryxdesign/core/Button";
import { Grid as AstryxGrid } from "@astryxdesign/core/Grid";
import { Selector } from "@astryxdesign/core/Selector";
import { Stack as AstryxStack } from "@astryxdesign/core/Stack";
import { Switch } from "@astryxdesign/core/Switch";
import { Text as AstryxText, Text as Label } from "@astryxdesign/core/Text";
import { TextInput as Input } from "@astryxdesign/core/TextInput";
import { listen } from "@xagent/runtime";
import { useCallback, useEffect, useState } from "react";
import { useConfirmDialog } from "../../components/astryx/useConfirmDialog";
import { AlertTriangle, Archive, ArchiveRestore, Cloud, Shield } from "../../components/icons";
import { useLocale } from "../../i18n";
import {
  applyBackupImport,
  BACKUP_SYNC_STATUS_EVENT,
  type BackupDomainCounts,
  type BackupManifest,
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
import { normalizeSkillsSettings } from "../../lib/settings";
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

type Status = { kind: "ok" | "error"; text: string } | null;

type SyncBusy = "load" | "test" | "save" | "upload" | "download" | null;

/** 后端返回的错误已是可直接展示的中文文案。 */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message.trim();
  return String(error ?? "").trim();
}

/** manifest.createdAt 是 RFC3339 UTC，按本地时区展示。 */
function formatCreatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/** lastSyncAt 是毫秒时间戳。 */
function formatTimestamp(value: number): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function summarizeDomains(counts: BackupDomainCounts, t: (key: string) => string): string {
  return [
    `${t("settings.backupDomainProviders")} ${counts.providers}`,
    `${t("settings.backupDomainMcp")} ${counts.mcp}`,
    `${t("settings.backupDomainSystem")} ${counts.system}`,
    `${t("settings.backupDomainSkills")} ${counts.skills}`,
  ].join(" · ");
}

function describeSource(manifest: BackupManifest, t: (key: string) => string) {
  const rows: [string, string][] = [
    [t("settings.backupSourceDevice"), manifest.deviceName],
    [t("settings.backupSourceTime"), formatCreatedAt(manifest.createdAt)],
    [t("settings.backupSourceVersion"), manifest.appVersion],
  ];
  return (
    <AstryxStack direction="vertical" className="space-y-1">
      {rows.map(([label, value]) => (
        <AstryxStack direction="horizontal" key={label} className="flex gap-2">
          <AstryxText as="span" type="inherit" className="shrink-0 opacity-70">
            {label}
          </AstryxText>
          <AstryxText as="span" type="inherit" className="break-all font-medium">
            {value}
          </AstryxText>
        </AstryxStack>
      ))}
      <AstryxStack direction="vertical" className="pt-1">
        {summarizeDomains(manifest.domains, t)}
      </AstryxStack>
    </AstryxStack>
  );
}

export function BackupSyncSection(props: SettingsSectionProps) {
  const { settings, setSettings, reloadSettings } = props;
  const { t } = useLocale();
  const { confirm, dialog } = useConfirmDialog();
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [status, setStatus] = useState<Status>(null);

  const [syncView, setSyncView] = useState<BackupSyncConfigView | null>(null);
  const [form, setForm] = useState<SyncForm>(emptyForm);
  const [preset, setPreset] = useState<PresetId>("custom");
  const [syncBusy, setSyncBusy] = useState<SyncBusy>("load");
  const [syncStatus, setSyncStatus] = useState<Status>(null);

  const dirty = isDirty(form, syncView);
  const syncLocked = syncBusy !== null;

  /**
   * 还原（导入 / 下载）落库后同步前端状态。
   *
   * 顺序不能反：`reloadSettings` 从 SQLite 重载 providers/mcp/system，
   * 但 skills 只存在于 localStorage，库里没有 —— 必须重载完再把快照里的
   * skills 盖上去，否则会被重载出来的旧值顶掉。
   *
   * 不重载的后果不是「显示旧值」这么轻：`persistSettings` 按域 diff，
   * 用户之后动任一域就会拿还原前的内存值写回库，把还原静默回滚掉。
   */
  const syncStateAfterRestore = useCallback(
    async (skillsPayload: unknown) => {
      await reloadSettings?.();
      if (skillsPayload) {
        const skills = normalizeSkillsSettings(skillsPayload);
        setSettings((prev) => ({ ...prev, skills }));
      }
    },
    [reloadSettings, setSettings],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const view = await loadSyncConfig();
        if (cancelled) return;
        setSyncView(view);
        setForm(formFromView(view));
        setPreset(detectPreset(view.url));
      } catch (error) {
        if (!cancelled) setSyncStatus({ kind: "error", text: errorText(error) });
      } finally {
        if (!cancelled) setSyncBusy(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 后台自动同步的结果。手动同步的成败由命令返回值就地反馈，不经过这个事件，
  // 所以这里收到的一定是「用户没主动点按钮时发生的同步」。
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void listen<BackupSyncStatusEvent>(BACKUP_SYNC_STATUS_EVENT, (event) => {
      setSyncView((prev) => applySyncStatusEvent(prev, event.payload));
      if (isAutoSyncSuccess(event.payload)) {
        setSyncStatus({ kind: "ok", text: t("settings.backupSyncAutoDone") });
      }
    }).then((fn) => {
      // 组件在 listen resolve 前就卸载时，拿到句柄立刻注销，避免泄漏。
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [t]);

  const patchForm = useCallback((patch: Partial<SyncForm>) => {
    setSyncStatus(null);
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  const handlePresetChange = useCallback(
    (value: string) => {
      const next = value as PresetId;
      setPreset(next);
      const matched = SYNC_PRESETS.find((item) => item.id === next);
      // 选「自定义」时保留当前 URL，只有选到具体预设才覆写。
      if (matched) patchForm({ url: matched.url });
    },
    [patchForm],
  );

  /**
   * 开启自动同步前先确认一次。
   *
   * 开关一旦打开，此后每次改配置都会把含明文 API Key 的快照推到远端，
   * 而且不再有任何逐次提示。这个后果值得一次显式点头；关闭方向无害，直接生效。
   */
  const handleAutoSyncChange = useCallback(
    async (checked: boolean) => {
      if (!checked) {
        patchForm({ autoSync: false });
        return;
      }
      const confirmed = await confirm({
        title: t("settings.backupSyncAutoConfirmTitle"),
        subtitle: t("settings.backupSyncAutoConfirmSubtitle"),
        description: t("settings.backupSyncAutoConfirmDesc"),
        confirmLabel: t("settings.backupSyncAutoConfirmAction"),
        cancelLabel: t("settings.backupCancel"),
        tone: "warning",
      });
      if (confirmed) patchForm({ autoSync: true });
    },
    [confirm, patchForm, t],
  );

  /** 保存后立即测一次连接：配置填错的话，此刻纠正的成本最低。 */
  const handleSaveSync = useCallback(async () => {
    setSyncBusy("save");
    setSyncStatus(null);
    try {
      const view = await saveSyncConfig({
        url: form.url,
        username: form.username,
        password: form.password,
        passwordTouched: form.passwordTouched,
        remoteDir: form.remoteDir,
        profile: form.profile,
        autoSync: form.autoSync,
      });
      setSyncView(view);
      setForm(formFromView(view));
      setPreset(detectPreset(view.url));

      // 凭据不全时没什么可测的，直接报保存成功即可。
      if (!canTestSyncConnection(view)) {
        setSyncStatus({ kind: "ok", text: t("settings.backupSyncSaveDone") });
        return;
      }
      try {
        await testSyncConnection();
        setSyncStatus({ kind: "ok", text: t("settings.backupSyncSaveAndTestDone") });
      } catch (error) {
        // 保存本身是成功的，连接失败只是提醒 —— 不能让用户以为配置没存上。
        setSyncStatus({
          kind: "error",
          text: `${t("settings.backupSyncSaveAndTestFailed")}${errorText(error)}`,
        });
      }
    } catch (error) {
      setSyncStatus({
        kind: "error",
        text: errorText(error) || t("settings.backupSyncSaveFailed"),
      });
    } finally {
      setSyncBusy(null);
    }
  }, [form, t]);

  /** 测试连接读的是库里的配置，故未保存时不可用。 */
  const handleTestSync = useCallback(async () => {
    setSyncBusy("test");
    setSyncStatus(null);
    try {
      await testSyncConnection();
      setSyncStatus({ kind: "ok", text: t("settings.backupSyncTestDone") });
    } catch (error) {
      setSyncStatus({
        kind: "error",
        text: errorText(error) || t("settings.backupSyncTestFailed"),
      });
    } finally {
      setSyncBusy(null);
    }
  }, [t]);

  const handleUpload = useCallback(async () => {
    setSyncBusy("upload");
    setSyncStatus(null);
    try {
      // 远端已有备份时先让用户看清会覆盖谁 —— 可能是另一台机器刚传的。
      const remote = await fetchRemoteInfo();
      if (remote) {
        const confirmed = await confirm({
          title: t("settings.backupSyncUploadConfirmTitle"),
          subtitle: t("settings.backupSyncUploadConfirmSubtitle"),
          description: describeSource(remote.manifest, t),
          confirmLabel: t("settings.backupSyncUpload"),
          cancelLabel: t("settings.backupCancel"),
          tone: "warning",
        });
        if (!confirmed) return;
      }
      const syncedAt = await uploadBackup(settings.skills);
      // 后端在成功时清了 last_error，视图同步跟上，横幅立即消失。
      setSyncView((prev) => (prev ? { ...prev, lastSyncAt: syncedAt, lastError: null } : prev));
      setSyncStatus({ kind: "ok", text: t("settings.backupSyncUploadDone") });
    } catch (error) {
      setSyncStatus({
        kind: "error",
        text: errorText(error) || t("settings.backupSyncUploadFailed"),
      });
    } finally {
      setSyncBusy(null);
    }
  }, [confirm, settings.skills, t]);

  const handleDownload = useCallback(async () => {
    setSyncBusy("download");
    setSyncStatus(null);
    try {
      const remote = await fetchRemoteInfo();
      if (!remote) {
        setSyncStatus({ kind: "error", text: t("settings.backupSyncRemoteEmpty") });
        return;
      }
      const confirmed = await confirm({
        title: t("settings.backupSyncDownloadConfirmTitle"),
        subtitle: t("settings.backupSyncDownloadConfirmSubtitle"),
        description: describeSource(remote.manifest, t),
        confirmLabel: t("settings.backupSyncDownload"),
        cancelLabel: t("settings.backupCancel"),
        tone: "warning",
      });
      if (!confirmed) return;

      const outcome = await downloadBackup();
      await syncStateAfterRestore(outcome.skills);
      // 下载成功证明这条链路是通的，后端已清 last_error，视图同步跟上。
      setSyncView((prev) => (prev ? { ...prev, lastError: null } : prev));
      setSyncStatus({
        kind: "ok",
        text: `${t("settings.backupSyncDownloadDone")}${summarizeDomains(outcome.applied, t)}`,
      });
    } catch (error) {
      setSyncStatus({
        kind: "error",
        text: errorText(error) || t("settings.backupSyncDownloadFailed"),
      });
    } finally {
      setSyncBusy(null);
    }
  }, [confirm, syncStateAfterRestore, t]);

  const handleExport = useCallback(async () => {
    setBusy("export");
    setStatus(null);
    try {
      // skills 启用态只存在于前端，必须由这里拼进 payload。
      const path = await exportBackup(settings.skills);
      // 用户在系统对话框里取消时返回 null，不算失败。
      if (path) {
        setStatus({ kind: "ok", text: `${t("settings.backupExportDone")}${path}` });
      }
    } catch (error) {
      setStatus({ kind: "error", text: errorText(error) || t("settings.backupExportFailed") });
    } finally {
      setBusy(null);
    }
  }, [settings.skills, t]);

  const handleImport = useCallback(async () => {
    setBusy("import");
    setStatus(null);
    try {
      // 先只解析校验、不写库，让用户看到来源摘要再决定是否覆盖。
      const preview = await peekBackupImport();
      if (!preview) return;

      const confirmed = await confirm({
        title: t("settings.backupImportConfirmTitle"),
        subtitle: t("settings.backupImportConfirmSubtitle"),
        description: describeSource(preview.manifest, t),
        detail: preview.path,
        confirmLabel: t("settings.backupImportConfirmAction"),
        cancelLabel: t("settings.backupCancel"),
        tone: "warning",
      });
      if (!confirmed) return;

      const outcome = await applyBackupImport(preview.path);
      await syncStateAfterRestore(outcome.skills);
      setStatus({
        kind: "ok",
        text: `${t("settings.backupImportDone")}${summarizeDomains(outcome.applied, t)}`,
      });
    } catch (error) {
      setStatus({ kind: "error", text: errorText(error) || t("settings.backupImportFailed") });
    } finally {
      setBusy(null);
    }
  }, [confirm, syncStateAfterRestore, t]);

  return (
    <AstryxStack direction="vertical" className="space-y-6">
      <AstryxStack
        direction="vertical"
        as="section"
        className="space-y-3 rounded-2xl border border-border/60 bg-card p-4"
      >
        <AstryxStack
          direction="horizontal"
          className="flex items-center gap-2 text-sm font-medium text-foreground"
        >
          <Archive className="h-4 w-4 text-muted-foreground" />
          {t("settings.backupLocalTitle")}
        </AstryxStack>
        <AstryxText
          as="p"
          type="inherit"
          display="block"
          className="text-xs leading-relaxed text-muted-foreground"
        >
          {t("settings.backupLocalDesc")}
        </AstryxText>

        <AstryxStack direction="horizontal" className="flex flex-wrap gap-2">
          <Button
            label={t("settings.backupExport")}
            variant="secondary"
            size="sm"
            isLoading={busy === "export"}
            isDisabled={busy !== null}
            onClick={() => void handleExport()}
          />
          <Button
            label={t("settings.backupImport")}
            variant="secondary"
            size="sm"
            isLoading={busy === "import"}
            isDisabled={busy !== null}
            onClick={() => void handleImport()}
          />
        </AstryxStack>

        <AstryxStack
          direction="horizontal"
          className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"
        >
          <ArchiveRestore className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <AstryxText as="span" type="inherit">
            {t("settings.backupAutoBackupHint")}
          </AstryxText>
        </AstryxStack>

        {status ? (
          <AstryxStack
            direction="vertical"
            className={`break-all text-xs font-medium ${
              status.kind === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
            }`}
          >
            {status.text}
          </AstryxStack>
        ) : null}
      </AstryxStack>

      <AstryxStack
        direction="vertical"
        as="section"
        className="space-y-3 rounded-2xl border border-border/60 bg-card p-4"
      >
        <AstryxStack
          direction="horizontal"
          className="flex items-center gap-2 text-sm font-medium text-foreground"
        >
          <Cloud className="h-4 w-4 text-muted-foreground" />
          {t("settings.backupSyncTitle")}
        </AstryxStack>
        <AstryxText
          as="p"
          type="inherit"
          display="block"
          className="text-xs leading-relaxed text-muted-foreground"
        >
          {t("settings.backupSyncDesc")}
        </AstryxText>

        <AstryxStack direction="vertical" className="space-y-3">
          <AstryxStack direction="vertical" className="space-y-1.5">
            <Selector
              label={t("settings.backupSyncPreset")}
              value={preset}
              width="100%"
              isDisabled={syncLocked}
              options={[
                ...SYNC_PRESETS.map((item) => ({
                  value: item.id,
                  label: t(`settings.backupSyncPreset_${item.id}`),
                })),
                { value: "custom", label: t("settings.backupSyncPreset_custom") },
              ]}
              onChange={handlePresetChange}
            />
          </AstryxStack>

          <AstryxStack direction="vertical" className="space-y-1.5">
            <Label as="label" type="label" weight="medium" className="text-xs">
              {t("settings.backupSyncUrl")}
            </Label>
            <Input
              label="https://dav.example.com/dav/"
              isLabelHidden
              value={form.url}
              isDisabled={syncLocked}
              placeholder="https://dav.example.com/dav/"
              onChange={(nextValue) => patchForm({ url: nextValue })}
            />
          </AstryxStack>

          <AstryxGrid className="grid gap-3 sm:grid-cols-2">
            <AstryxStack direction="vertical" className="space-y-1.5">
              <Label as="label" type="label" weight="medium" className="text-xs">
                {t("settings.backupSyncUsername")}
              </Label>
              <Input
                label={t("settings.backupSyncUsername")}
                isLabelHidden
                {...({ autoComplete: "off" } as const)}
                type="text"
                value={form.username}
                isDisabled={syncLocked}
                onChange={(nextValue) => patchForm({ username: nextValue })}
              />
            </AstryxStack>
            <AstryxStack direction="vertical" className="space-y-1.5">
              <Label as="label" type="label" weight="medium" className="text-xs">
                {t("settings.backupSyncPassword")}
              </Label>
              <Input
                label={t("settings.backupSyncPassword")}
                isLabelHidden
                {...({ autoComplete: "new-password" } as const)}
                type="password"
                value={form.password}
                isDisabled={syncLocked}
                placeholder={
                  syncView?.hasPassword && !form.passwordTouched
                    ? t("settings.backupSyncPasswordSaved")
                    : ""
                }
                onChange={(nextValue) => {
                  const password = nextValue;
                  // 清空密码框视为「没动过」，而不是「把密码改成空」。
                  // 后端只在 passwordTouched 时采用新值，若这里对空串也置 true，
                  // 用户输入几个字符再全删掉就会静默抹掉已存的密码 —— 与本框
                  // 自己的「留空则不修改」占位提示直接矛盾，且此后自动同步因
                  // 凭据不全而永久静默跳过（auto_upload 的 credentials 分支）。
                  // 真要清空密码就关掉同步或改用户名，不该由删字符触发。
                  patchForm({ password, passwordTouched: password.length > 0 });
                }}
              />
            </AstryxStack>
          </AstryxGrid>

          <AstryxGrid className="grid gap-3 sm:grid-cols-2">
            <AstryxStack direction="vertical" className="space-y-1.5">
              <Label as="label" type="label" weight="medium" className="text-xs">
                {t("settings.backupSyncRemoteDir")}
              </Label>
              <Input
                label="xagent"
                isLabelHidden
                value={form.remoteDir}
                isDisabled={syncLocked}
                placeholder="xagent"
                onChange={(nextValue) => patchForm({ remoteDir: nextValue })}
              />
            </AstryxStack>
            <AstryxStack direction="vertical" className="space-y-1.5">
              <Label as="label" type="label" weight="medium" className="text-xs">
                {t("settings.backupSyncProfile")}
              </Label>
              <Input
                label="default"
                isLabelHidden
                value={form.profile}
                isDisabled={syncLocked}
                placeholder="default"
                onChange={(nextValue) => patchForm({ profile: nextValue })}
              />
            </AstryxStack>
          </AstryxGrid>
          <AstryxText
            as="p"
            type="inherit"
            display="block"
            className="text-xs leading-relaxed text-muted-foreground"
          >
            {t("settings.backupSyncProfileHint")}
          </AstryxText>

          <AstryxStack
            direction="horizontal"
            className="flex items-start justify-between gap-3 rounded-xl border border-border/60 px-3.5 py-3"
          >
            <AstryxStack direction="vertical" className="min-w-0 space-y-1">
              <AstryxStack direction="vertical" className="text-xs font-medium text-foreground">
                {t("settings.backupSyncAuto")}
              </AstryxStack>
              <AstryxText
                as="p"
                type="inherit"
                display="block"
                className="text-xs leading-relaxed text-muted-foreground"
              >
                {t("settings.backupSyncAutoHint")}
              </AstryxText>
            </AstryxStack>
            <Switch
              label={t("settings.backupSyncAuto")}
              isLabelHidden
              value={form.autoSync}
              isDisabled={syncLocked}
              aria-label={t("settings.backupSyncAuto")}
              onChange={(checked) => void handleAutoSyncChange(checked)}
            />
          </AstryxStack>
        </AstryxStack>

        <AstryxStack direction="horizontal" className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            label={t("settings.backupSyncSave")}
            size="sm"
            isLoading={syncBusy === "save"}
            isDisabled={syncLocked}
            onClick={() => void handleSaveSync()}
          />
          <Button
            label={t("settings.backupSyncTest")}
            variant="secondary"
            size="sm"
            isLoading={syncBusy === "test"}
            isDisabled={syncLocked || dirty}
            onClick={() => void handleTestSync()}
          />
          <Button
            label={t("settings.backupSyncUpload")}
            variant="secondary"
            size="sm"
            isLoading={syncBusy === "upload"}
            isDisabled={syncLocked || dirty}
            onClick={() => void handleUpload()}
          />
          <Button
            label={t("settings.backupSyncDownload")}
            variant="secondary"
            size="sm"
            isLoading={syncBusy === "download"}
            isDisabled={syncLocked || dirty}
            onClick={() => void handleDownload()}
          />
        </AstryxStack>

        {dirty && !syncLocked ? (
          <AstryxText
            as="p"
            type="inherit"
            display="block"
            className="text-xs font-medium text-amber-700 dark:text-amber-300"
          >
            {t("settings.backupSyncDirtyHint")}
          </AstryxText>
        ) : null}

        {syncView?.lastSyncAt ? (
          <AstryxText
            as="p"
            type="inherit"
            display="block"
            className="text-xs text-muted-foreground"
          >
            {t("settings.backupSyncLastAt")}
            {formatTimestamp(syncView.lastSyncAt)}
          </AstryxText>
        ) : null}

        {/*
          自动同步失败的常驻横幅。区别于下面那条 syncStatus —— 后者是本次交互的
          即时反馈，切走页面就没了；这条来自库里的 last_error，只要故障没修好，
          每次进设置页都还在。用户不会在后台同步失败时正好盯着这个页面。
        */}
        {syncView?.lastError ? (
          <AstryxStack
            direction="horizontal"
            className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-3"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <AstryxStack direction="vertical" className="min-w-0 space-y-1">
              <AstryxStack direction="vertical" className="text-xs font-medium text-destructive">
                {t("settings.backupSyncAutoErrorTitle")}
              </AstryxStack>
              <AstryxText
                as="p"
                type="inherit"
                display="block"
                className="break-all text-xs leading-relaxed text-destructive/90"
              >
                {syncView.lastError}
              </AstryxText>
            </AstryxStack>
          </AstryxStack>
        ) : null}

        {syncStatus ? (
          <AstryxStack
            direction="vertical"
            className={`break-all text-xs font-medium ${
              syncStatus.kind === "ok"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-destructive"
            }`}
          >
            {syncStatus.text}
          </AstryxStack>
        ) : null}
      </AstryxStack>

      <AstryxStack
        direction="vertical"
        as="section"
        className="space-y-2 rounded-2xl border border-border/60 bg-card p-4"
      >
        <AstryxStack
          direction="horizontal"
          className="flex items-center gap-2 text-sm font-medium text-foreground"
        >
          <Shield className="h-4 w-4 text-muted-foreground" />
          {t("settings.backupScopeTitle")}
        </AstryxStack>
        <AstryxText
          as="p"
          type="inherit"
          display="block"
          className="text-xs leading-relaxed text-muted-foreground"
        >
          {t("settings.backupScopeDesc")}
        </AstryxText>
      </AstryxStack>

      {dialog}
    </AstryxStack>
  );
}
