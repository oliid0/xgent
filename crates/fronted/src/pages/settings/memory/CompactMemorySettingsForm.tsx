import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Grid } from "@astryxdesign/core/Grid";
import { VStack } from "@astryxdesign/core/Layout";
import { ListItem } from "@astryxdesign/core/List";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { type ISOTimeString, TimeInput } from "@astryxdesign/core/TimeInput";
import type { ReactNode } from "react";
import { Clock3, History, Play, Trash2 } from "../../../components/icons";
import type {
  AppSettings,
  MemoryOrganizerFrequency,
  MemoryOrganizerMode,
  MemoryOrganizerScope,
} from "../../../lib/settings";
import { SettingsRow, SettingsRowGroup, SettingsValueSelector } from "../shared";
import {
  formatTime,
  MEMORY_ORGANIZER_FREQUENCIES,
  MEMORY_ORGANIZER_MODES,
  MEMORY_ORGANIZER_SCOPES,
  MEMORY_ORGANIZER_WEEKDAYS,
} from "./panelModel";

/** Presentation only; the drawer owns the same organizer, save and wipe operations. */
export function CompactMemorySettingsForm(props: {
  memory: AppSettings["memory"];
  organizerModel: ReactNode;
  summaryModel: ReactNode;
  canEnableOrganizer: boolean;
  modelsEmpty: boolean;
  timingDisabled: boolean;
  timeDraft: string;
  busy: boolean;
  submitting: boolean;
  error: string | null;
  notice: string | null;
  feedback: string | null;
  quotaWarning?: ReactNode;
  t: (key: string) => string;
  onToggle: () => void;
  onScheduleChange: (patch: Partial<AppSettings["memory"]["organizerSchedule"]>) => void;
  onTimeChange: (value: string) => void;
  onScopeChange: (value: MemoryOrganizerScope) => void;
  onModeChange: (value: MemoryOrganizerMode) => void;
  onHistory: () => void;
  onRun: () => void;
  onWipe: () => void;
}) {
  const { memory, t, busy } = props;
  return (
    <VStack width="100%" gap={4} className="compact-memory-settings-form">
      {props.quotaWarning}
      <SettingsRowGroup title={t("settings.memoryDriverModels")}>
        <ListItem
          className="settings-control-row compact-memory-model-row"
          label={
            <VStack gap={2} width="100%">
              <Text type="body" wordBreak="break-word">
                {t("settings.memoryOrganizerModel")}
              </Text>
              {props.organizerModel}
            </VStack>
          }
        />
        <ListItem
          className="settings-control-row compact-memory-model-row"
          label={
            <VStack gap={2} width="100%">
              <Text type="body" wordBreak="break-word">
                {t("settings.memorySummaryModel")}
              </Text>
              {props.summaryModel}
            </VStack>
          }
        />
      </SettingsRowGroup>
      {props.modelsEmpty ? (
        <Banner status="warning" title={t("settings.memoryModelEmpty")} collapsible={false} />
      ) : null}
      <SettingsRowGroup title={t("settings.memoryOrganizerTitle")}>
        <SettingsRow label={t("settings.memoryOrganizerToggle")}>
          <Switch
            label={t("settings.memoryOrganizerToggle")}
            isLabelHidden
            value={memory.organizerEnabled}
            isDisabled={!props.canEnableOrganizer || busy}
            onChange={props.onToggle}
          />
        </SettingsRow>
        <SettingsRow label={t("settings.memoryOrganizerSchedule")} controlLayout="value">
          <SettingsValueSelector
            label={t("settings.memoryOrganizerSchedule")}
            isLabelHidden
            value={memory.organizerSchedule.frequency}
            isDisabled={!props.canEnableOrganizer || busy}
            options={MEMORY_ORGANIZER_FREQUENCIES.map((item) => ({
              value: item.value,
              label: t(item.labelKey),
            }))}
            onChange={(frequency) =>
              props.onScheduleChange({ frequency: frequency as MemoryOrganizerFrequency })
            }
          />
        </SettingsRow>
        <SettingsRow label={t("settings.memoryOrganizerTime")} icon={<Clock3 />}>
          <TimeInput
            label={t("settings.memoryOrganizerTime")}
            isLabelHidden
            size="lg"
            width="100%"
            hourFormat="24h"
            value={(props.timeDraft || undefined) as ISOTimeString | undefined}
            isDisabled={props.timingDisabled || busy}
            onChange={(value) => props.onTimeChange(value ?? "")}
          />
        </SettingsRow>
        {memory.organizerSchedule.frequency === "weekly" ? (
          <SettingsRow label={t("settings.memoryOrganizerWeekday")} controlLayout="value">
            <SettingsValueSelector
              label={t("settings.memoryOrganizerWeekday")}
              isLabelHidden
              value={String(memory.organizerSchedule.weekday ?? 1)}
              isDisabled={props.timingDisabled || busy}
              options={MEMORY_ORGANIZER_WEEKDAYS.map((key, index) => ({
                value: String(index),
                label: t(key),
              }))}
              onChange={(value) => props.onScheduleChange({ weekday: Number(value) })}
            />
          </SettingsRow>
        ) : null}
        <SettingsRow label={t("settings.memoryOrganizerScope")} controlLayout="value">
          <SettingsValueSelector
            label={t("settings.memoryOrganizerScope")}
            isLabelHidden
            value={memory.organizerScope}
            isDisabled={busy}
            options={MEMORY_ORGANIZER_SCOPES.map((item) => ({
              value: item.value,
              label: t(item.labelKey),
            }))}
            onChange={(value) => props.onScopeChange(value as MemoryOrganizerScope)}
          />
        </SettingsRow>
        <SettingsRow label={t("settings.memoryOrganizerMode")} controlLayout="value">
          <SettingsValueSelector
            label={t("settings.memoryOrganizerMode")}
            isLabelHidden
            value={memory.organizerMode}
            isDisabled={busy}
            options={MEMORY_ORGANIZER_MODES.map((item) => ({
              value: item.value,
              label: t(item.labelKey),
            }))}
            onChange={(value) => props.onModeChange(value as MemoryOrganizerMode)}
          />
        </SettingsRow>
      </SettingsRowGroup>
      {memory.organizerEnabled && memory.organizerNextRunAt ? (
        <Text type="supporting" color="secondary" wordBreak="break-word">
          {t("settings.memoryOrganizerNextRun")} {formatTime(memory.organizerNextRunAt)}
        </Text>
      ) : null}
      {props.feedback ? <Banner status="info" title={props.feedback} collapsible={false} /> : null}
      <Grid
        columns={{ minWidth: 140, max: 2 }}
        gap={2}
        width="100%"
        className="compact-memory-actions"
      >
        <Button
          label={t("settings.memoryOrganizerHistory")}
          icon={<History />}
          size="lg"
          width="100%"
          className="settings-wrapping-action"
          isDisabled={busy}
          onClick={props.onHistory}
        />
        <Button
          label={t("settings.memoryOrganizerRunNow")}
          icon={<Play />}
          variant="primary"
          size="lg"
          width="100%"
          className="settings-wrapping-action"
          isDisabled={!memory.organizerModel || busy}
          isLoading={props.submitting}
          onClick={props.onRun}
        />
      </Grid>
      {props.error ? <Banner status="error" title={props.error} collapsible={false} /> : null}
      {props.notice ? <Banner status="success" title={props.notice} collapsible={false} /> : null}
      <SettingsRowGroup title={t("settings.memorySettingsDangerZone")} tone="danger">
        <ListItem
          label={
            <VStack width="100%" gap={3}>
              <Text type="supporting" color="secondary" wordBreak="break-word">
                {t("settings.memorySettingsWipeDescription")}
              </Text>
              <Button
                label={t("settings.memoryWipeAll")}
                icon={<Trash2 />}
                variant="destructive"
                size="lg"
                width="100%"
                className="settings-wrapping-action"
                isDisabled={busy}
                onClick={props.onWipe}
              />
            </VStack>
          }
        />
      </SettingsRowGroup>
    </VStack>
  );
}
