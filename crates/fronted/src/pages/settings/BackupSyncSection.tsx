import { Button } from "@astryxdesign/core/Button";
import { Grid as AstryxGrid } from "@astryxdesign/core/Grid";
import { Selector } from "@astryxdesign/core/Selector";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Stack as AstryxStack } from "@astryxdesign/core/Stack";
import { Switch } from "@astryxdesign/core/Switch";
import { Text as AstryxText, Text as Label } from "@astryxdesign/core/Text";
import { TextInput as Input } from "@astryxdesign/core/TextInput";
import { useConfirmDialog } from "../../components/astryx/useConfirmDialog";
import { AlertTriangle, Archive, ArchiveRestore, Cloud, Shield } from "../../components/icons";
import { useLocale } from "../../i18n";
import { isApplePresentationRuntime } from "../../runtime/applePresentation";
import { SYNC_PRESETS } from "./backupSyncForm";
import { NativeBackupSyncSection } from "./NativeBackupSyncSection";
import type { SettingsSectionProps } from "./types";
import { useBackupSyncData } from "./useBackupSyncData";

function formatTimestamp(value: number): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

export function BackupSyncSection(props: SettingsSectionProps & { onBack?: () => void }) {
  const { t } = useLocale();
  const { confirm, dialog } = useConfirmDialog();
  const data = useBackupSyncData(props, confirm, t);
  const {
    busy,
    status,
    syncView,
    form,
    preset,
    syncBusy,
    syncStatus,
    dirty,
    patchForm,
    handlePresetChange,
    handleAutoSyncChange,
    handleSaveSync,
    handleTestSync,
    handleUpload,
    handleDownload,
    handleExport,
    handleImport,
  } = data;
  const syncLocked = data.locked;
  if (isApplePresentationRuntime())
    return (
      <>
        <NativeBackupSyncSection
          settings={props.settings}
          data={data}
          onBack={props.onBack}
          nativeSettingsSurfaceId={props.nativeSettingsSurfaceId}
        />
        {dialog}
      </>
    );

  return (
    <AstryxStack direction="vertical" className="space-y-6">
      {data.operation === "load" ? <Spinner label={t("app.loading")} /> : null}
      {!syncView && data.operation !== "load" ? (
        <Button
          label={t("presentation.retry")}
          onClick={() => void data.reload()}
          isDisabled={data.operation !== null}
        />
      ) : null}
      {data.localAvailable ? (
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
              isDisabled={syncLocked}
              onClick={() => void handleExport()}
            />
            <Button
              label={t("settings.backupImport")}
              variant="secondary"
              size="sm"
              isLoading={busy === "import"}
              isDisabled={syncLocked}
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
      ) : null}

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

                  patchForm({ password, passwordTouched: password.length > 0 });
                }}
              />
              {syncView?.hasPassword ? (
                <Button
                  label={t("settings.backupSyncClearPassword")}
                  variant="ghost"
                  size="sm"
                  isDisabled={syncLocked}
                  onClick={() => patchForm({ password: "", passwordTouched: true })}
                />
              ) : null}
            </AstryxStack>
          </AstryxGrid>

          <AstryxGrid className="grid gap-3 sm:grid-cols-2">
            <AstryxStack direction="vertical" className="space-y-1.5">
              <Label as="label" type="label" weight="medium" className="text-xs">
                {t("settings.backupSyncRemoteDir")}
              </Label>
              <Input
                label="xgent"
                isLabelHidden
                value={form.remoteDir}
                isDisabled={syncLocked}
                placeholder="xgent"
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
            isDisabled={syncLocked || dirty || !data.configured}
            onClick={() => void handleTestSync()}
          />
          <Button
            label={t("settings.backupSyncUpload")}
            variant="secondary"
            size="sm"
            isLoading={syncBusy === "upload"}
            isDisabled={syncLocked || dirty || !data.configured}
            onClick={() => void handleUpload()}
          />
          <Button
            label={t("settings.backupSyncDownload")}
            variant="secondary"
            size="sm"
            isLoading={syncBusy === "download"}
            isDisabled={syncLocked || dirty || !data.configured}
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
