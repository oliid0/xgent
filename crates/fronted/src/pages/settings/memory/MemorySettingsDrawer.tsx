import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Banner } from "@astryxdesign/core/Banner";
import { Button as AstryxNativeButton } from "@astryxdesign/core/Button";
import { DialogHeader } from "@astryxdesign/core/Dialog";
import { Divider } from "@astryxdesign/core/Divider";
import { Grid as AstryxGrid } from "@astryxdesign/core/Grid";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Selector } from "@astryxdesign/core/Selector";
import { Stack as AstryxStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading, Text } from "@astryxdesign/core/Text";
import { type ISOTimeString, TimeInput } from "@astryxdesign/core/TimeInput";
// Memory settings drawer: organizer model/schedule/scope/mode, extraction
// summary model, Run Now, quota-ladder banner and the wipe-all danger zone.
//
// Shared by every frontend runtime. Platform differences belong in the
// runtime boundary, never in this drawer.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatMemoryError,
  type MemoryQuotaSummaryResponse,
  memoryOrganizeRunCreate,
  memoryQuotaSummary,
} from "../../../lib/memory/api";
import { deriveQuotaLadder } from "../../../lib/memory/organizer/quota";
import {
  type AppSettings,
  computeNextMemoryOrganizerRunAt,
  type MemoryOrganizerFrequency,
  type MemoryOrganizerMode,
  type MemoryOrganizerScope,
  updateMemorySettings,
} from "../../../lib/settings";
import { OrganizerHistoryModal } from "./OrganizerHistoryModal";
import {
  formatTime,
  MEMORY_ORGANIZER_FREQUENCIES,
  MEMORY_ORGANIZER_MODES,
  MEMORY_ORGANIZER_SCOPES,
  MEMORY_ORGANIZER_WEEKDAYS,
  type MemoryModelOption,
  memoryScopeLabel,
} from "./panelModel";
import {
  ArrowLeft,
  canRunOrganizerLocally,
  History,
  ModelPicker,
  parseModelValue,
  pokeMemoryOrganizer,
  RefreshCw,
  Trash2,
  toModelValue,
} from "./platform";

const MEMORY_ORGANIZER_TIME_DEBOUNCE_MS = 400;

function memoryModelValue(model: AppSettings["memory"]["organizerModel"]) {
  return model ? toModelValue(model.customProviderId, model.model) : "";
}

export function MemorySettingsDrawer(props: {
  modelOptions: MemoryModelOption[];
  settings: AppSettings;
  setSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  workdir?: string;
  saving: boolean;
  t: (key: string) => string;
  onClose: () => void;
  onRequestWipe: () => void | Promise<void>;
  onOrganizerRunQueued?: (runId: string) => void;
  onMemoryChanged?: () => void;
}) {
  const {
    modelOptions,
    settings,
    setSettings,
    workdir,
    saving,
    t,
    onClose,
    onRequestWipe,
    onOrganizerRunQueued,
    onMemoryChanged,
  } = props;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [organizerFeedback, setOrganizerFeedback] = useState<string | null>(null);
  const [organizerSubmitting, setOrganizerSubmitting] = useState(false);
  const [drawerWipeConfirmOpen, setDrawerWipeConfirmOpen] = useState(false);
  const [quotaSummary, setQuotaSummary] = useState<MemoryQuotaSummaryResponse | null>(null);
  const memoryOrganizerModel = memoryModelValue(settings.memory.organizerModel);
  const conversationSummaryModel = memoryModelValue(settings.memory.summaryModel);
  const committedTimeLocal = settings.memory.organizerSchedule.timeLocal;
  const [timeLocalDraft, setTimeLocalDraft] = useState(committedTimeLocal);
  const committedTimeLocalRef = useRef(committedTimeLocal);
  const timeLocalDraftRef = useRef(timeLocalDraft);
  const canEnableOrganizer = memoryOrganizerModel.trim().length > 0;
  const organizerTimingDisabled =
    !settings.memory.organizerEnabled || settings.memory.organizerSchedule.frequency === "none";
  const quotaLadder = useMemo(() => deriveQuotaLadder(quotaSummary), [quotaSummary]);

  useEffect(() => {
    let cancelled = false;
    void memoryQuotaSummary({ workdir })
      .then((summary) => {
        if (!cancelled) setQuotaSummary(summary);
      })
      .catch(() => {
        // The banner is best-effort; a failed summary just renders nothing.
      });
    return () => {
      cancelled = true;
    };
  }, [workdir]);

  useEffect(() => {
    committedTimeLocalRef.current = committedTimeLocal;
    setTimeLocalDraft(committedTimeLocal);
  }, [committedTimeLocal]);

  useEffect(() => {
    timeLocalDraftRef.current = timeLocalDraft;
  }, [timeLocalDraft]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: updateOrganizerSchedule identity changes every render; the drafts are the triggers
  useEffect(() => {
    if (timeLocalDraft === committedTimeLocal) return;
    const timeout = window.setTimeout(() => {
      updateOrganizerSchedule({ timeLocal: timeLocalDraft });
    }, MEMORY_ORGANIZER_TIME_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [timeLocalDraft, committedTimeLocal]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: flush the pending draft exactly once on unmount
  useEffect(() => {
    return () => {
      const draft = timeLocalDraftRef.current;
      if (draft !== committedTimeLocalRef.current) {
        updateOrganizerSchedule({ timeLocal: draft });
      }
    };
  }, []);

  useEffect(() => {
    if (
      (!canEnableOrganizer || settings.memory.organizerSchedule.frequency === "none") &&
      settings.memory.organizerEnabled
    ) {
      setSettings((prev) =>
        updateMemorySettings(prev, {
          organizerEnabled: false,
          organizerNextRunAt: undefined,
        }),
      );
    }
  }, [
    canEnableOrganizer,
    setSettings,
    settings.memory.organizerEnabled,
    settings.memory.organizerSchedule.frequency,
  ]);

  // The two model selects share the picker but not the empty-value wording:
  // clearing the organizer model turns the organizer off, while clearing the
  // summary model means extraction follows the conversation's chat model.
  function renderModelSelect(
    value: string,
    onChange: (value: string) => void,
    ariaLabel: string,
    noneLabel: string,
  ) {
    return (
      <ModelPicker
        value={value}
        onChange={onChange}
        options={modelOptions}
        placeholder={noneLabel}
        noneLabel={noneLabel}
        ariaLabel={ariaLabel}
      />
    );
  }

  function handleOrganizerModelChange(value: string) {
    const selected = parseModelValue(value) ?? undefined;
    setSettings((prev) => updateMemorySettings(prev, { organizerModel: selected }));
    if (!selected) {
      setSettings((prev) =>
        updateMemorySettings(prev, {
          organizerEnabled: false,
          organizerNextRunAt: undefined,
        }),
      );
    }
  }

  function handleSummaryModelChange(value: string) {
    setSettings((prev) =>
      updateMemorySettings(prev, {
        summaryModel: parseModelValue(value) ?? undefined,
      }),
    );
  }

  function handleOrganizerToggle() {
    if (!canEnableOrganizer) return;
    setSettings((prev) => {
      const enabled =
        !prev.memory.organizerEnabled || prev.memory.organizerSchedule.frequency === "none";
      const organizerSchedule =
        enabled && prev.memory.organizerSchedule.frequency === "none"
          ? { ...prev.memory.organizerSchedule, frequency: "daily" as MemoryOrganizerFrequency }
          : prev.memory.organizerSchedule;
      return updateMemorySettings(prev, {
        organizerEnabled: enabled,
        organizerSchedule,
        organizerNextRunAt: enabled
          ? computeNextMemoryOrganizerRunAt(organizerSchedule)
          : undefined,
      });
    });
  }

  function updateOrganizerSchedule(patch: Partial<AppSettings["memory"]["organizerSchedule"]>) {
    setSettings((prev) => {
      const organizerSchedule = {
        ...prev.memory.organizerSchedule,
        ...patch,
      };
      const enabledByFrequency = patch.frequency === "daily" || patch.frequency === "weekly";
      const organizerEnabled =
        organizerSchedule.frequency !== "none" &&
        Boolean(prev.memory.organizerModel) &&
        (prev.memory.organizerEnabled || enabledByFrequency);
      return updateMemorySettings(prev, {
        organizerSchedule,
        organizerEnabled,
        organizerNextRunAt: organizerEnabled
          ? computeNextMemoryOrganizerRunAt(organizerSchedule)
          : undefined,
      });
    });
  }

  async function handleRunNow() {
    setOrganizerFeedback(null);
    if (!settings.memory.organizerModel) {
      setOrganizerFeedback(t("settings.memoryOrganizerNoModel"));
      return;
    }
    setOrganizerSubmitting(true);
    try {
      const response = await memoryOrganizeRunCreate({
        trigger: "manual",
        model: settings.memory.organizerModel,
        scope: settings.memory.organizerScope,
        mode: settings.memory.organizerMode,
      });
      const runId = response.run?.runId ?? response.activeRun?.runId;
      if (runId) {
        onOrganizerRunQueued?.(runId);
      }
      if (response.alreadyRunning) {
        setOrganizerFeedback(t("settings.memoryOrganizerAlreadyRunning"));
        setHistoryOpen(true);
        return;
      }
      const runnerPoked = canRunOrganizerLocally ? pokeMemoryOrganizer() : false;
      setOrganizerFeedback(
        t(runnerPoked ? "settings.memoryOrganizerQueued" : "settings.memoryOrganizerQueuedRemote"),
      );
      setHistoryOpen(true);
    } catch (err) {
      setOrganizerFeedback(formatMemoryError(err));
    } finally {
      setOrganizerSubmitting(false);
    }
  }

  if (historyOpen) {
    return (
      <OrganizerHistoryModal
        t={t}
        workdir={workdir}
        onClose={() => setHistoryOpen(false)}
        onMemoryChanged={onMemoryChanged}
      />
    );
  }

  return (
    <VStack
      width="100%"
      height="100%"
      minHeight={0}
      gap={0}
      role="region"
      aria-label={t("settings.memorySettingsTitle")}
    >
      <AstryxStack
        direction="vertical"
        as="aside"
        className="relative flex h-full w-full flex-col overflow-hidden"
      >
        <VStack paddingBlockStart={2}>
          <DialogHeader
            title={t("settings.memorySettingsTitle")}
            subtitle={t("settings.memorySettingsLocalOnly")}
            startContent={
              <IconButton
                label={t("settings.memorySettingsClose")}
                tooltip={t("settings.memorySettingsClose")}
                variant="ghost"
                size="sm"
                icon={<ArrowLeft />}
                onClick={onClose}
              />
            }
          />
        </VStack>

        <AstryxStack
          direction="vertical"
          className="relative min-h-0 flex-1 overflow-y-auto px-5 py-5"
        >
          <AstryxStack direction="vertical" className="space-y-6">
            {quotaLadder.level !== "normal" &&
            quotaLadder.bannerKey &&
            quotaLadder.tightestScope ? (
              <Banner
                status={
                  quotaLadder.level === "critical" || quotaLadder.level === "exhausted"
                    ? "error"
                    : "warning"
                }
                title={t(quotaLadder.bannerKey)
                  .replace("{scope}", memoryScopeLabel(quotaLadder.tightestScope.scope, t))
                  .replace("{used}", String(quotaLadder.tightestScope.used))
                  .replace("{limit}", String(quotaLadder.tightestScope.limit))}
                collapsible={false}
              />
            ) : null}

            <AstryxStack direction="vertical" as="section" className="space-y-2">
              <Heading level={4}>{t("settings.memoryDriverModels")}</Heading>
              <AstryxStack direction="vertical" className="space-y-4">
                <VStack gap={1}>
                  <Text type="supporting" color="secondary">
                    {t("settings.memoryOrganizerModel")}
                  </Text>
                  {renderModelSelect(
                    memoryOrganizerModel,
                    handleOrganizerModelChange,
                    t("settings.memoryOrganizerModel"),
                    t("settings.memoryModelNone"),
                  )}
                </VStack>
                <Divider />
                <VStack gap={1}>
                  <Text type="supporting" color="secondary">
                    {t("settings.memorySummaryModel")}
                  </Text>
                  {renderModelSelect(
                    conversationSummaryModel,
                    handleSummaryModelChange,
                    t("settings.memorySummaryModel"),
                    t("settings.memorySummaryModelFollow"),
                  )}
                </VStack>
                {modelOptions.length === 0 ? (
                  <Banner
                    status="warning"
                    title={t("settings.memoryModelEmpty")}
                    collapsible={false}
                  />
                ) : null}
              </AstryxStack>
            </AstryxStack>

            <AstryxStack direction="vertical" as="section" className="space-y-2">
              <AstryxStack
                direction="horizontal"
                className="flex items-center justify-between gap-2 px-1"
              >
                <Heading level={4}>{t("settings.memoryOrganizerTitle")}</Heading>
                <Switch
                  label={t("settings.memoryOrganizerToggle")}
                  isLabelHidden
                  value={settings.memory.organizerEnabled}
                  isDisabled={!canEnableOrganizer}
                  onChange={handleOrganizerToggle}
                />
              </AstryxStack>
              <AstryxStack direction="vertical" className="space-y-4">
                <AstryxStack direction="vertical" className="space-y-3">
                  <AstryxGrid className="memory-organizer-schedule-grid">
                    <Selector
                      label={t("settings.memoryOrganizerSchedule")}
                      value={settings.memory.organizerSchedule.frequency}
                      isDisabled={!canEnableOrganizer}
                      onChange={(next) =>
                        updateOrganizerSchedule({
                          frequency: next as MemoryOrganizerFrequency,
                        })
                      }
                      options={MEMORY_ORGANIZER_FREQUENCIES.map((item) => ({
                        value: item.value,
                        label: t(item.labelKey),
                      }))}
                    />
                    <TimeInput
                      label={t("settings.memoryOrganizerTime")}
                      value={(timeLocalDraft || undefined) as ISOTimeString | undefined}
                      onChange={(nextValue) => setTimeLocalDraft(nextValue ?? "")}
                      isDisabled={organizerTimingDisabled}
                      hourFormat="24h"
                      size="sm"
                      width="100%"
                    />
                  </AstryxGrid>
                  {settings.memory.organizerSchedule.frequency === "weekly" ? (
                    <Selector
                      label={t("settings.memoryOrganizerWeekday")}
                      value={String(settings.memory.organizerSchedule.weekday ?? 1)}
                      isDisabled={organizerTimingDisabled}
                      onChange={(next) => updateOrganizerSchedule({ weekday: Number(next) })}
                      options={MEMORY_ORGANIZER_WEEKDAYS.map((key, index) => ({
                        value: String(index),
                        label: t(key),
                      }))}
                    />
                  ) : null}
                  <AstryxGrid className="grid grid-cols-2 gap-2.5">
                    <Selector
                      label={t("settings.memoryOrganizerScope")}
                      value={settings.memory.organizerScope}
                      onChange={(next) => {
                        const organizerScope = next as MemoryOrganizerScope;
                        setSettings((prev) => updateMemorySettings(prev, { organizerScope }));
                      }}
                      options={MEMORY_ORGANIZER_SCOPES.map((item) => ({
                        value: item.value,
                        label: t(item.labelKey),
                      }))}
                    />
                    <Selector
                      label={t("settings.memoryOrganizerMode")}
                      value={settings.memory.organizerMode}
                      onChange={(next) => {
                        const organizerMode = next as MemoryOrganizerMode;
                        setSettings((prev) => updateMemorySettings(prev, { organizerMode }));
                      }}
                      options={MEMORY_ORGANIZER_MODES.map((item) => ({
                        value: item.value,
                        label: t(item.labelKey),
                      }))}
                    />
                  </AstryxGrid>
                  {settings.memory.organizerEnabled && settings.memory.organizerNextRunAt ? (
                    <HStack width="100%" gap={2} vAlign="center" hAlign="between">
                      <HStack gap={2} vAlign="center">
                        <StatusDot variant="success" label={t("settings.memoryOrganizerNextRun")} />
                        <Text type="supporting" color="secondary">
                          {t("settings.memoryOrganizerNextRun")}
                        </Text>
                      </HStack>
                      <Text type="supporting" color="secondary">
                        {formatTime(settings.memory.organizerNextRunAt)}
                      </Text>
                    </HStack>
                  ) : null}
                  {organizerFeedback ? (
                    <Banner status="info" title={organizerFeedback} collapsible={false} />
                  ) : null}
                </AstryxStack>
              </AstryxStack>
              <HStack width="100%" gap={2} vAlign="center">
                <AstryxNativeButton
                  label={t("settings.memoryOrganizerHistory")}
                  variant="secondary"
                  size="sm"
                  icon={<History />}
                  width="100%"
                  onClick={() => setHistoryOpen(true)}
                />
                <AstryxNativeButton
                  label={t("settings.memoryOrganizerRunNow")}
                  variant="primary"
                  size="sm"
                  icon={<RefreshCw />}
                  width="100%"
                  isLoading={organizerSubmitting}
                  isDisabled={!settings.memory.organizerModel || organizerSubmitting}
                  onClick={() => void handleRunNow()}
                />
              </HStack>
            </AstryxStack>

            <AstryxStack direction="vertical" as="section" className="space-y-2">
              <Heading level={4}>{t("settings.memorySettingsDangerZone")}</Heading>
              <AstryxStack direction="vertical" className="space-y-3">
                <Text type="supporting" color="secondary">
                  {t("settings.memorySettingsWipeDescription")}
                </Text>
                <AstryxNativeButton
                  label={t("settings.memoryWipeAll")}
                  variant="destructive"
                  size="sm"
                  icon={<Trash2 />}
                  width="100%"
                  onClick={() => setDrawerWipeConfirmOpen(true)}
                  isDisabled={saving}
                />
              </AstryxStack>
            </AstryxStack>
          </AstryxStack>
        </AstryxStack>
      </AstryxStack>
      <AlertDialog
        isOpen={drawerWipeConfirmOpen}
        onOpenChange={setDrawerWipeConfirmOpen}
        title={t("settings.memoryWipeConfirmTitle")}
        description={t("settings.memoryWipeConfirmDescription")}
        actionLabel={t("settings.memoryWipeAll")}
        cancelLabel={t("settings.memoryCancel")}
        actionVariant="destructive"
        isActionLoading={saving}
        onAction={onRequestWipe}
      />
    </VStack>
  );
}
