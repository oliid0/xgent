import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Grid } from "@astryxdesign/core/Grid";
import { VStack } from "@astryxdesign/core/Layout";
import { ListItem } from "@astryxdesign/core/List";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import {
  Archive,
  ArchiveRestore,
  Check,
  Cloud,
  Download,
  Upload,
  Wifi,
} from "../../components/icons";
import { useLocale } from "../../i18n";
import { backupLastSyncText } from "./backupManifestText";
import { SYNC_PRESETS } from "./backupSyncForm";
import { SecretTextInput } from "./SecretTextInput";
import { SettingsRow, SettingsRowGroup, SettingsValueSelector } from "./shared";
import type { useBackupSyncData } from "./useBackupSyncData";

/** Compact presentation of the shared backup controller, including its operation locks. */
export function CompactBackupSyncForm({ data }: { data: ReturnType<typeof useBackupSyncData> }) {
  const { t, locale } = useLocale();
  const { form, syncView, locked } = data;
  const available = !locked && !data.dirty && data.configured;
  const actions = [
    {
      id: "save",
      label: "settings.backupSyncSave",
      icon: Check,
      run: data.handleSaveSync,
      enabled: !locked,
    },
    {
      id: "test",
      label: "settings.backupSyncTest",
      icon: Wifi,
      run: data.handleTestSync,
      enabled: available,
    },
    {
      id: "upload",
      label: "settings.backupSyncUpload",
      icon: Upload,
      run: data.handleUpload,
      enabled: available,
    },
    {
      id: "download",
      label: "settings.backupSyncDownload",
      icon: Download,
      run: data.handleDownload,
      enabled: available,
    },
  ] as const;

  return (
    <VStack width="100%" gap={4} className="compact-backup-form">
      {data.operation === "load" ? <Spinner label={t("app.loading")} /> : null}
      {!syncView && data.operation !== "load" ? (
        <Button
          label={t("presentation.retry")}
          size="lg"
          width="100%"
          className="settings-wrapping-action"
          onClick={() => void data.reload()}
          isDisabled={data.operation !== null}
        />
      ) : null}
      <Text type="supporting" color="secondary" wordBreak="break-word">
        {t("settings.backupSyncDesc")}
      </Text>
      <SettingsRowGroup title={t("settings.backupSyncTitle")}>
        <SettingsRow label={t("settings.backupSyncPreset")} icon={<Cloud />} controlLayout="value">
          <SettingsValueSelector
            label={t("settings.backupSyncPreset")}
            isLabelHidden
            value={data.preset}
            isDisabled={locked}
            options={[
              ...SYNC_PRESETS.map((item) => ({
                value: item.id,
                label: t(`settings.backupSyncPreset_${item.id}`),
              })),
              { value: "custom", label: t("settings.backupSyncPreset_custom") },
            ]}
            onChange={data.handlePresetChange}
          />
        </SettingsRow>
        <ListItem
          label={
            <TextInput
              label={t("settings.backupSyncUrl")}
              value={form.url}
              width="100%"
              size="lg"
              isDisabled={locked}
              placeholder="https://dav.example.com/dav/"
              onChange={(url) => data.patchForm({ url })}
            />
          }
        />
        <ListItem
          label={
            <TextInput
              label={t("settings.backupSyncUsername")}
              value={form.username}
              width="100%"
              size="lg"
              isDisabled={locked}
              autoComplete="off"
              onChange={(username) => data.patchForm({ username })}
            />
          }
        />
        <ListItem
          label={
            <SecretTextInput
              label={t("settings.backupSyncPassword")}
              value={form.password}
              compact
              isDisabled={locked}
              placeholder={
                syncView?.hasPassword && !form.passwordTouched
                  ? t("settings.backupSyncPasswordSaved")
                  : ""
              }
              onChange={(password) =>
                data.patchForm({ password, passwordTouched: password.length > 0 })
              }
            />
          }
        />
        {syncView?.hasPassword ? (
          <ListItem
            label={
              <Button
                label={t("settings.backupSyncClearPassword")}
                variant="ghost"
                size="lg"
                width="100%"
                className="settings-wrapping-action"
                isDisabled={locked}
                onClick={() => data.patchForm({ password: "", passwordTouched: true })}
              />
            }
          />
        ) : null}
        <ListItem
          label={
            <TextInput
              label={t("settings.backupSyncRemoteDir")}
              value={form.remoteDir}
              width="100%"
              size="lg"
              isDisabled={locked}
              placeholder="xgent"
              onChange={(remoteDir) => data.patchForm({ remoteDir })}
            />
          }
        />
        <ListItem
          label={
            <TextInput
              label={t("settings.backupSyncProfile")}
              value={form.profile}
              width="100%"
              size="lg"
              isDisabled={locked}
              placeholder="default"
              onChange={(profile) => data.patchForm({ profile })}
            />
          }
        />
        <SettingsRow
          label={t("settings.backupSyncAuto")}
          description={t("settings.backupSyncAutoHint")}
        >
          <Switch
            label={t("settings.backupSyncAuto")}
            isLabelHidden
            value={form.autoSync}
            isDisabled={locked}
            onChange={(checked) => void data.handleAutoSyncChange(checked)}
          />
        </SettingsRow>
      </SettingsRowGroup>
      <Text type="supporting" color="secondary" wordBreak="break-word">
        {t("settings.backupSyncProfileHint")}
      </Text>
      <Grid
        width="100%"
        columns={{ minWidth: 160, max: 2 }}
        gap={2}
        className="compact-backup-actions"
      >
        {actions.map((action) => (
          <Button
            key={action.id}
            label={t(action.label)}
            icon={<action.icon />}
            data-backup-action={action.id}
            variant={action.id === "save" ? "primary" : "secondary"}
            size="lg"
            width="100%"
            className="settings-wrapping-action"
            isLoading={data.syncBusy === action.id}
            isDisabled={!action.enabled}
            onClick={() => void action.run()}
          />
        ))}
      </Grid>
      {data.dirty && !locked ? (
        <Banner status="warning" title={t("settings.backupSyncDirtyHint")} collapsible={false} />
      ) : null}
      {syncView?.lastSyncAt ? (
        <Text type="supporting" color="secondary" wordBreak="break-word">
          {backupLastSyncText(syncView.lastSyncAt, t, locale)}
        </Text>
      ) : null}
      {syncView?.lastError ? (
        <Banner
          status="error"
          title={t("settings.backupSyncAutoErrorTitle")}
          description={syncView.lastError}
          collapsible={false}
        />
      ) : null}
      {data.syncStatus ? (
        <Banner
          status={data.syncStatus.kind === "ok" ? "success" : "error"}
          title={data.syncStatus.text}
          collapsible={false}
        />
      ) : null}
      {data.localAvailable ? (
        <>
          <Text type="supporting" color="secondary" wordBreak="break-word">
            {t("settings.backupLocalDesc")}
          </Text>
          <SettingsRowGroup title={t("settings.backupLocalTitle")}>
            <ListItem
              label={
                <Button
                  label={t("settings.backupExport")}
                  icon={<Archive />}
                  size="lg"
                  width="100%"
                  className="settings-wrapping-action"
                  variant="ghost"
                  isDisabled={locked}
                  isLoading={data.busy === "export"}
                  onClick={() => void data.handleExport()}
                />
              }
            />
            <ListItem
              label={
                <Button
                  label={t("settings.backupImport")}
                  icon={<ArchiveRestore />}
                  size="lg"
                  width="100%"
                  className="settings-wrapping-action"
                  variant="ghost"
                  isDisabled={locked}
                  isLoading={data.busy === "import"}
                  onClick={() => void data.handleImport()}
                />
              }
            />
          </SettingsRowGroup>
          <Text type="supporting" color="secondary" wordBreak="break-word">
            {t("settings.backupAutoBackupHint")}
          </Text>
          {data.status ? (
            <Banner
              status={data.status.kind === "ok" ? "success" : "error"}
              title={data.status.text}
              collapsible={false}
            />
          ) : null}
        </>
      ) : null}
      <Text type="supporting" color="secondary" wordBreak="break-word">
        {t("settings.backupScopeDesc")}
      </Text>
    </VStack>
  );
}
