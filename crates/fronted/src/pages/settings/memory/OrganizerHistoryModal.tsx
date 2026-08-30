import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Button as AstryxButton } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { DialogHeader } from "@astryxdesign/core/Dialog";
import { Grid as AstryxGrid } from "@astryxdesign/core/Grid";
import { IconButton } from "@astryxdesign/core/IconButton";
import { VStack } from "@astryxdesign/core/Layout";
import { Stack as AstryxStack } from "@astryxdesign/core/Stack";
import { Text as AstryxText } from "@astryxdesign/core/Text";
// Organizer run-history modal. All protocol parsing goes through the typed
// run report in lib/memory/organizer/runRecord — v4 reports round-trip
// unchanged; pre-v4 runs degrade to a read-only legacy view (summaries and
// review notes only: no decisions, no manual apply).
//
// Shared by every frontend runtime. Platform differences belong in the
// runtime boundary, never in this modal.

import { useEffect, useState } from "react";
import {
  formatMemoryError,
  type MemoryOrganizeRunStatus,
  memoryApplyBatch,
  memoryOrganizeRunClearHistory,
  memoryOrganizeRunUpdate,
} from "../../../lib/memory/api";
import {
  appliedBatchCount,
  buildManualApplyState,
  buildReviewItemsForBatch,
  decisionsWithApplyStatus,
  failedDecisionKeysFromReviewItems,
  isDefaultSelectedDecision,
  ORGANIZE_RUN_REPORT_VERSION,
  type OrganizeRunReportV4,
  organizerDecisionKey,
  readRunReport,
  successfulDecisionKeys,
} from "../../../lib/memory/organizer/runRecord";
import {
  deriveManualApplyDisplay,
  displayedFinalSummary,
  EMPTY_MANUAL_APPLY_STATE,
  formatTime,
  manualApplySummaryText,
  modelNameFromRun,
  organizerApplyStatusClass,
  organizerApplyStatusLabel,
  organizerReviewItemClass,
  organizerReviewItemLabel,
  organizerRiskClass,
  organizerRiskLabel,
  organizerStatusClass,
  organizerStatusLabel,
  organizerTriggerLabel,
  rejectionBucketEntries,
} from "./panelModel";
import { ArrowLeft, BrushCleaning, Button, DrawerSelect } from "./platform";
import { useOrganizeRunHistory } from "./useMemoryPanelData";

export function OrganizerHistoryModal(props: {
  t: (key: string) => string;
  onClose: () => void;
  workdir?: string;
  onMemoryChanged?: () => void;
}) {
  const { t, onClose, workdir, onMemoryChanged } = props;
  const [statusFilter, setStatusFilter] = useState<"all" | MemoryOrganizeRunStatus>("all");
  const { runs, selectedRun, setSelectedRun, loading, error, setError, reload } =
    useOrganizeRunHistory({ statusFilter });
  const [applyingPreview, setApplyingPreview] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [selectedDecisionKeys, setSelectedDecisionKeys] = useState<Set<string>>(() => new Set());
  const [historyFeedback, setHistoryFeedback] = useState<string | null>(null);

  const report = readRunReport(selectedRun);
  const v4Report = report.version === "legacy" ? null : report;
  const clusterSummaries = report.clusterSummaries;
  const reviewItems = report.reviewItems;
  const rawBlocks = v4Report?.raw ?? [];
  const manualApplyState = v4Report?.manualApplyState ?? EMPTY_MANUAL_APPLY_STATE;
  const parsedSafeDecisions = v4Report?.safeDecisions ?? [];
  const safeDecisions = decisionsWithApplyStatus(
    parsedSafeDecisions,
    manualApplyState,
    reviewItems,
  );
  const rejectionBuckets = rejectionBucketEntries(v4Report?.rejectionBuckets);
  const manualApplyDisplay = deriveManualApplyDisplay({
    run: selectedRun,
    safeDecisions,
    reviewItems,
    manualApplyState,
  });
  const canApplyManualPreview =
    selectedRun?.trigger === "manual" &&
    selectedRun.status === "succeeded" &&
    manualApplyDisplay.status === "pending" &&
    safeDecisions.length > 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: reseed only when the run or its decision set changes
  useEffect(() => {
    if (!canApplyManualPreview) {
      setSelectedDecisionKeys(new Set());
      return;
    }
    setSelectedDecisionKeys(
      new Set(
        safeDecisions
          .map((decision, index) => ({ decision, key: organizerDecisionKey(decision, index) }))
          .filter(({ decision }) => isDefaultSelectedDecision(decision))
          .map(({ key }) => key),
      ),
    );
  }, [selectedRun?.runId, canApplyManualPreview, safeDecisions.length]);

  function togglePreviewDecision(key: string) {
    setSelectedDecisionKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function applyManualPreview() {
    if (!selectedRun || !v4Report) return;
    const selectedWithKeys = parsedSafeDecisions
      .map((decision, index) => ({ decision, key: organizerDecisionKey(decision, index) }))
      .filter((item) => selectedDecisionKeys.has(item.key));
    if (selectedWithKeys.length === 0) {
      setError(t("settings.memoryOrganizerSelectAtLeastOne"));
      return;
    }
    setApplyingPreview(true);
    setError(null);
    try {
      const batch = await memoryApplyBatch({
        workdir,
        trigger: "memory-organize",
        model: modelNameFromRun(selectedRun),
        decisions: selectedWithKeys.map((item) => item.decision),
      });
      const appliedCount = appliedBatchCount(batch);
      const nextReviewItems = buildReviewItemsForBatch(batch, selectedWithKeys);
      const appliedDecisionKeys = successfulDecisionKeys(selectedWithKeys, batch);
      const failedDecisionKeys = failedDecisionKeysFromReviewItems(
        selectedWithKeys,
        nextReviewItems,
      );
      const manualApplyStateForReport = buildManualApplyState({
        selectedCount: selectedWithKeys.length,
        appliedCount,
        warningCount: nextReviewItems.length,
        appliedDecisionKeys,
        failedDecisionKeys,
      });
      const appliedKeySet = new Set(appliedDecisionKeys);
      const failedKeySet = new Set(failedDecisionKeys);
      const safeDecisionsForReport = parsedSafeDecisions.map((decision, index) => {
        const key = organizerDecisionKey(decision, index);
        if (failedKeySet.has(key)) return { ...decision, applyStatus: "failed" as const };
        if (appliedKeySet.has(key)) return { ...decision, applyStatus: "applied" as const };
        return decision;
      });
      const manualSummary = manualApplySummaryText({
        selectedCount: selectedWithKeys.length,
        appliedCount,
        warningCount: nextReviewItems.length,
      });
      const existingFinalSummary = selectedRun.finalSummary?.trim() || "";
      const nextReport: OrganizeRunReportV4 = {
        ...v4Report,
        version: ORGANIZE_RUN_REPORT_VERSION,
        reviewItems: [...reviewItems, ...nextReviewItems],
        safeDecisions: safeDecisionsForReport,
        manualApplyState: manualApplyStateForReport,
      };
      await memoryOrganizeRunUpdate({
        runId: selectedRun.runId,
        safeApplied: appliedCount,
        createdCount: batch.created.length,
        updatedCount: batch.updated.length,
        deletedCount: batch.deleted.length,
        reviewSkipped: selectedRun.reviewSkipped + nextReviewItems.length,
        finalSummary: existingFinalSummary.includes("手动应用结果")
          ? manualSummary
          : `${manualSummary}${existingFinalSummary ? `\n\n模型原始总结：${existingFinalSummary}` : ""}`,
        report: nextReport,
      });
      await reload(selectedRun.runId);
      onMemoryChanged?.();
    } catch (err) {
      setError(formatMemoryError(err));
    } finally {
      setApplyingPreview(false);
    }
  }

  async function clearHistory() {
    setClearingHistory(true);
    setError(null);
    setHistoryFeedback(null);
    try {
      const response = await memoryOrganizeRunClearHistory();
      setClearConfirmOpen(false);
      setSelectedRun(null);
      setSelectedDecisionKeys(new Set());
      setHistoryFeedback(
        response.retainedActiveCount > 0
          ? t("settings.memoryOrganizerHistoryClearedActiveRetained")
          : t("settings.memoryOrganizerHistoryCleared"),
      );
      await reload(undefined, { keepSelection: false });
    } catch (err) {
      setError(formatMemoryError(err));
    } finally {
      setClearingHistory(false);
    }
  }

  return (
    <>
      <VStack width="100%" height="100%" minHeight={0} gap={0} role="region">
        <AstryxStack
          direction="vertical"
          className="flex h-full min-h-0 w-full flex-col overflow-hidden"
        >
          <DialogHeader
            title={t("settings.memoryOrganizerHistory")}
            subtitle={t("settings.memoryOrganizerHistoryDescription")}
            startContent={
              <AstryxButton
                label={t("settings.memorySettingsClose")}
                tooltip={t("settings.memorySettingsClose")}
                type="button"
                onClick={onClose}
                aria-label={t("settings.memorySettingsClose")}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
              </AstryxButton>
            }
          />

          <AstryxGrid className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)]">
            <AstryxStack
              direction="vertical"
              as="aside"
              className="flex min-h-0 flex-col border-r border-border/50"
            >
              <AstryxStack direction="vertical" className="space-y-2 border-b border-border/40 p-3">
                <AstryxStack direction="horizontal" className="flex items-center gap-2">
                  <AstryxStack direction="vertical" className="min-w-0 flex-1">
                    <DrawerSelect
                      value={statusFilter}
                      onValueChange={(next) =>
                        setStatusFilter(next as "all" | MemoryOrganizeRunStatus)
                      }
                      ariaLabel={t("settings.memoryOrganizerHistoryAll")}
                      options={[
                        { value: "all", label: t("settings.memoryOrganizerHistoryAll") },
                        { value: "succeeded", label: t("settings.memoryOrganizerStatusSucceeded") },
                        { value: "failed", label: t("settings.memoryOrganizerStatusFailed") },
                        { value: "skipped", label: t("settings.memoryOrganizerStatusSkipped") },
                        { value: "running", label: t("settings.memoryOrganizerStatusRunning") },
                      ]}
                    />
                  </AstryxStack>
                  <IconButton
                    type="button"
                    variant="secondary"
                    size="md"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    label={t("settings.memoryOrganizerClearHistory")}
                    tooltip={t("settings.memoryOrganizerClearHistory")}
                    icon={<BrushCleaning className="h-3.5 w-3.5" />}
                    onClick={() => setClearConfirmOpen(true)}
                    isDisabled={loading || clearingHistory || runs.length === 0}
                  />
                </AstryxStack>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  label={t("settings.memoryRefresh")}
                  isLoading={loading}
                  onClick={() => reload()}
                  isDisabled={loading}
                />
              </AstryxStack>
              <AstryxStack direction="vertical" className="min-h-0 flex-1 overflow-auto p-2">
                {runs.length === 0 ? (
                  <AstryxStack
                    direction="vertical"
                    className="rounded-lg border border-dashed border-border/60 px-3 py-8 text-center text-xs text-muted-foreground"
                  >
                    {t("settings.memoryOrganizerHistoryEmpty")}
                  </AstryxStack>
                ) : (
                  <AstryxStack direction="vertical" className="space-y-1.5">
                    {runs.map((run) => {
                      const active = selectedRun?.runId === run.runId;
                      return (
                        <AstryxButton
                          label={
                            run.finalSummary ||
                            run.error ||
                            t("settings.memoryOrganizerHistoryPending")
                          }
                          key={run.runId}
                          type="button"
                          onClick={() => reload(run.runId)}
                          className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                            active
                              ? "border-primary/50 bg-primary/5"
                              : "border-border/50 bg-background/70 hover:bg-muted/35"
                          }`}
                        >
                          <AstryxStack
                            direction="horizontal"
                            className="flex items-center justify-between gap-2"
                          >
                            <AstryxText
                              as="span"
                              type="inherit"
                              className={`rounded border px-1.5 py-0.5 text-[10px] ${organizerStatusClass(run.status)}`}
                            >
                              {organizerStatusLabel(run.status, t)}
                            </AstryxText>
                            <AstryxText
                              as="span"
                              type="inherit"
                              className="text-[10px] text-muted-foreground"
                            >
                              {organizerTriggerLabel(run.trigger, t)}
                            </AstryxText>
                          </AstryxStack>
                          <AstryxStack
                            direction="vertical"
                            className="mt-1 truncate text-xs font-medium"
                          >
                            {run.finalSummary ||
                              run.error ||
                              t("settings.memoryOrganizerHistoryPending")}
                          </AstryxStack>
                          <AstryxStack
                            direction="vertical"
                            className="mt-1 truncate text-[11px] text-muted-foreground"
                          >
                            {formatTime(run.startedAt || run.createdAt)} · {modelNameFromRun(run)}
                          </AstryxStack>
                        </AstryxButton>
                      );
                    })}
                  </AstryxStack>
                )}
              </AstryxStack>
            </AstryxStack>

            <AstryxStack direction="vertical" as="section" className="min-h-0 overflow-auto p-5">
              {error ? (
                <AstryxStack
                  direction="vertical"
                  className="mb-4 whitespace-pre-wrap rounded-lg border border-destructive/20 bg-destructive/[0.05] px-3 py-2 text-xs text-destructive"
                >
                  {error}
                </AstryxStack>
              ) : null}
              {historyFeedback ? (
                <AstryxStack
                  direction="vertical"
                  className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"
                >
                  {historyFeedback}
                </AstryxStack>
              ) : null}
              {selectedRun ? (
                <AstryxStack direction="vertical" className="space-y-4">
                  <AstryxStack
                    direction="horizontal"
                    className="flex flex-wrap items-start justify-between gap-3"
                  >
                    <AstryxStack direction="vertical" className="min-w-0 space-y-1">
                      <AstryxStack
                        direction="horizontal"
                        className="flex flex-wrap items-center gap-2"
                      >
                        <AstryxText
                          as="span"
                          type="inherit"
                          className={`rounded border px-2 py-1 text-xs ${organizerStatusClass(selectedRun.status)}`}
                        >
                          {organizerStatusLabel(selectedRun.status, t)}
                        </AstryxText>
                        <AstryxText
                          as="span"
                          type="inherit"
                          className="rounded border border-border/60 px-2 py-1 text-xs text-muted-foreground"
                        >
                          {organizerTriggerLabel(selectedRun.trigger, t)}
                        </AstryxText>
                        <AstryxText
                          as="span"
                          type="inherit"
                          className="rounded border border-border/60 px-2 py-1 text-xs text-muted-foreground"
                        >
                          {selectedRun.scope} / {selectedRun.mode}
                        </AstryxText>
                      </AstryxStack>
                      <AstryxStack
                        direction="vertical"
                        className="font-mono text-[11px] text-muted-foreground"
                      >
                        {selectedRun.runId}
                      </AstryxStack>
                    </AstryxStack>
                    <AstryxGrid className="grid shrink-0 grid-cols-[auto_minmax(9rem,auto)] gap-x-2 gap-y-1 rounded-md border border-border/50 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                      <AstryxText as="span" type="inherit" className="whitespace-nowrap">
                        {t("settings.memoryOrganizerStarted")}
                      </AstryxText>
                      <AstryxText
                        as="span"
                        type="inherit"
                        className="whitespace-nowrap text-right font-mono text-foreground/80"
                      >
                        {formatTime(selectedRun.startedAt || selectedRun.createdAt)}
                      </AstryxText>
                      <AstryxText as="span" type="inherit" className="whitespace-nowrap">
                        {t("settings.memoryOrganizerFinished")}
                      </AstryxText>
                      <AstryxText
                        as="span"
                        type="inherit"
                        className="whitespace-nowrap text-right font-mono text-foreground/80"
                      >
                        {selectedRun.finishedAt ? formatTime(selectedRun.finishedAt) : "-"}
                      </AstryxText>
                    </AstryxGrid>
                  </AstryxStack>

                  <AstryxStack
                    direction="vertical"
                    className="rounded-lg border border-border/60 bg-muted/15 p-4"
                  >
                    <AstryxStack
                      direction="vertical"
                      className="mb-2 text-xs font-semibold text-muted-foreground"
                    >
                      {t("settings.memoryOrganizerFinalSummary")}
                    </AstryxStack>
                    <AstryxStack
                      direction="vertical"
                      className="whitespace-pre-wrap text-sm leading-relaxed"
                    >
                      {displayedFinalSummary(selectedRun, manualApplyDisplay) ||
                        t("settings.memoryOrganizerHistoryPending")}
                    </AstryxStack>
                  </AstryxStack>

                  <AstryxGrid className="grid gap-2 sm:grid-cols-4">
                    {[
                      ["settings.memoryOrganizerInputCount", selectedRun.inputCount],
                      ["settings.memoryOrganizerClusterCount", selectedRun.clusterCount],
                      ["settings.memoryOrganizerSafeApplied", selectedRun.safeApplied],
                      ["settings.memoryOrganizerReviewSkipped", selectedRun.reviewSkipped],
                      ["settings.memoryOrganizerCreatedCount", selectedRun.createdCount],
                      ["settings.memoryOrganizerUpdatedCount", selectedRun.updatedCount],
                      ["settings.memoryOrganizerDeletedCount", selectedRun.deletedCount],
                      ["settings.memoryOrganizerParseFailures", selectedRun.parseFailures],
                    ].map(([key, value]) => (
                      <AstryxStack
                        direction="vertical"
                        key={key}
                        className="rounded-lg border border-border/50 bg-background/70 p-3"
                      >
                        <AstryxStack
                          direction="vertical"
                          className="text-[11px] text-muted-foreground"
                        >
                          {t(String(key))}
                        </AstryxStack>
                        <AstryxStack direction="vertical" className="mt-1 text-lg font-semibold">
                          {value}
                        </AstryxStack>
                      </AstryxStack>
                    ))}
                  </AstryxGrid>

                  {safeDecisions.length > 0 ? (
                    <AstryxStack
                      direction="vertical"
                      className="rounded-lg border border-border/60 p-4"
                    >
                      <AstryxStack
                        direction="horizontal"
                        className="flex flex-wrap items-center justify-between gap-3"
                      >
                        <AstryxStack direction="vertical">
                          <AstryxStack
                            direction="vertical"
                            className="text-xs font-semibold text-muted-foreground"
                          >
                            {t("settings.memoryOrganizerManualPreview")}
                          </AstryxStack>
                          <AstryxStack
                            direction="vertical"
                            className="mt-1 text-xs text-muted-foreground"
                          >
                            {manualApplyDisplay.status === "applied"
                              ? t("settings.memoryOrganizerApplied")
                              : manualApplyDisplay.status === "partial"
                                ? t("settings.memoryOrganizerPartiallyApplied")
                                : manualApplyDisplay.status === "failed"
                                  ? t("settings.memoryOrganizerApplyFailed")
                                  : t("settings.memoryOrganizerManualPreviewDescription")}
                          </AstryxStack>
                        </AstryxStack>
                        {canApplyManualPreview ? (
                          <Button
                            type="button"
                            size="sm"
                            label={t("settings.memoryOrganizerApplySelected")}
                            onClick={applyManualPreview}
                            isDisabled={applyingPreview}
                          />
                        ) : null}
                      </AstryxStack>
                      <AstryxStack direction="vertical" className="mt-3 space-y-2">
                        {safeDecisions.map((decision, index) => {
                          const key = organizerDecisionKey(decision, index);
                          const checked =
                            manualApplyDisplay.status && manualApplyDisplay.status !== "pending"
                              ? manualApplyDisplay.appliedDecisionKeys.size === 0
                                ? decision.applyStatus !== "failed"
                                : manualApplyDisplay.appliedDecisionKeys.has(key)
                              : selectedDecisionKeys.has(key);
                          return (
                            <AstryxStack
                              direction="horizontal"
                              key={key}
                              className="flex gap-3 rounded-md border border-border/50 bg-background/70 p-3 text-xs"
                            >
                              <CheckboxInput
                                label={decision.slug}
                                isLabelHidden
                                value={checked}
                                isDisabled={!canApplyManualPreview || applyingPreview}
                                onChange={() => togglePreviewDecision(key)}
                                size="sm"
                              />
                              <AstryxText as="span" type="inherit" className="min-w-0 flex-1">
                                <AstryxStack
                                  as="span"
                                  direction="horizontal"
                                  className="flex flex-wrap items-center gap-2"
                                >
                                  <AstryxText
                                    as="span"
                                    type="inherit"
                                    className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground"
                                  >
                                    {decision.op === "delete"
                                      ? t("settings.memoryOrganizerDecisionDelete")
                                      : t("settings.memoryOrganizerDecisionUpsert")}
                                  </AstryxText>
                                  <AstryxText
                                    as="span"
                                    type="inherit"
                                    className="font-mono text-[11px]"
                                  >
                                    {decision.slug}
                                  </AstryxText>
                                  {decision.scope ? (
                                    <AstryxText
                                      as="span"
                                      type="inherit"
                                      className="text-[11px] text-muted-foreground"
                                    >
                                      {decision.scope}
                                      {decision.workdirHash ? `:${decision.workdirHash}` : ""}
                                    </AstryxText>
                                  ) : null}
                                  <AstryxText
                                    as="span"
                                    type="inherit"
                                    className={`rounded border px-1.5 py-0.5 text-[10px] ${organizerRiskClass(decision.riskLevel)}`}
                                  >
                                    {organizerRiskLabel(decision.riskLevel, t)}
                                  </AstryxText>
                                  {decision.confidence != null ? (
                                    <AstryxText
                                      as="span"
                                      type="inherit"
                                      className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                                    >
                                      {t("settings.memoryOrganizerConfidence")}{" "}
                                      {decision.confidence.toFixed(2)}
                                    </AstryxText>
                                  ) : null}
                                  {decision.requiresUserAck ? (
                                    <AstryxText
                                      as="span"
                                      type="inherit"
                                      className="rounded border border-amber-500/30 bg-amber-500/[0.06] px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300"
                                    >
                                      {t("settings.memoryOrganizerRequiresAck")}
                                    </AstryxText>
                                  ) : null}
                                  {decision.applyStatus ? (
                                    <AstryxText
                                      as="span"
                                      type="inherit"
                                      className={`rounded border px-1.5 py-0.5 text-[10px] ${organizerApplyStatusClass(decision.applyStatus)}`}
                                    >
                                      {organizerApplyStatusLabel(decision.applyStatus, t)}
                                    </AstryxText>
                                  ) : null}
                                </AstryxStack>
                                <AstryxText
                                  as="span"
                                  type="inherit"
                                  className="mt-1 block break-words text-muted-foreground"
                                >
                                  {decision.reason || decision.description || "-"}
                                </AstryxText>
                                {decision.applyError?.message ? (
                                  <AstryxText
                                    as="span"
                                    type="inherit"
                                    className="mt-1 block break-words text-destructive"
                                  >
                                    {decision.applyError.message}
                                  </AstryxText>
                                ) : null}
                                {decision.sourceSlugs?.length ? (
                                  <AstryxText
                                    as="span"
                                    type="inherit"
                                    className="mt-1 block break-words font-mono text-[10px] text-muted-foreground"
                                  >
                                    {t("settings.memoryOrganizerSources")}{" "}
                                    {decision.sourceSlugs.join(", ")}
                                  </AstryxText>
                                ) : null}
                              </AstryxText>
                            </AstryxStack>
                          );
                        })}
                      </AstryxStack>
                    </AstryxStack>
                  ) : null}

                  {rejectionBuckets.length > 0 ? (
                    <AstryxStack
                      direction="vertical"
                      className="rounded-lg border border-border/60 p-4"
                    >
                      <AstryxStack
                        direction="vertical"
                        className="mb-3 text-xs font-semibold text-muted-foreground"
                      >
                        {t("settings.memoryOrganizerRejectionBuckets")}
                      </AstryxStack>
                      <AstryxGrid className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {rejectionBuckets.map(([key, count]) => (
                          <AstryxStack
                            direction="vertical"
                            key={key}
                            className="rounded-md border border-border/50 bg-background/70 px-3 py-2"
                          >
                            <AstryxStack
                              direction="vertical"
                              className="text-[11px] text-muted-foreground"
                            >
                              {t(key)}
                            </AstryxStack>
                            <AstryxStack
                              direction="vertical"
                              className="mt-1 text-sm font-semibold"
                            >
                              {count}
                            </AstryxStack>
                          </AstryxStack>
                        ))}
                      </AstryxGrid>
                    </AstryxStack>
                  ) : null}

                  {reviewItems.length > 0 ? (
                    <AstryxStack
                      direction="vertical"
                      className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-4"
                    >
                      <AstryxStack
                        direction="vertical"
                        className="mb-2 text-xs font-semibold text-amber-700 dark:text-amber-300"
                      >
                        {t("settings.memoryOrganizerReviewNotes")}
                      </AstryxStack>
                      <AstryxStack
                        direction="vertical"
                        as="ul"
                        className="space-y-2 text-xs text-muted-foreground"
                      >
                        {reviewItems.map((item, index) => (
                          <AstryxStack
                            direction="vertical"
                            as="li"
                            key={`${index}:${item.phase}:${item.slug || ""}:${item.message}`}
                            className="rounded-md border border-border/50 bg-background/70 px-3 py-2"
                          >
                            <AstryxStack
                              direction="horizontal"
                              className="mb-1 flex flex-wrap items-center gap-2"
                            >
                              <AstryxText
                                as="span"
                                type="inherit"
                                className={`rounded border px-1.5 py-0.5 text-[10px] ${organizerReviewItemClass(item)}`}
                              >
                                {organizerReviewItemLabel(item, t)}
                              </AstryxText>
                              {item.code ? (
                                <AstryxText
                                  as="span"
                                  type="inherit"
                                  className="font-mono text-[10px] text-muted-foreground"
                                >
                                  {item.code}
                                </AstryxText>
                              ) : null}
                              {item.slug ? (
                                <AstryxText
                                  as="span"
                                  type="inherit"
                                  className="font-mono text-[10px] text-muted-foreground"
                                >
                                  {item.slug}
                                </AstryxText>
                              ) : null}
                            </AstryxStack>
                            <AstryxStack direction="vertical" className="break-words">
                              {item.message}
                            </AstryxStack>
                          </AstryxStack>
                        ))}
                      </AstryxStack>
                    </AstryxStack>
                  ) : null}

                  {clusterSummaries.length > 0 ? (
                    <AstryxStack
                      direction="vertical"
                      className="rounded-lg border border-border/60 p-4"
                    >
                      <AstryxStack
                        direction="vertical"
                        className="mb-2 text-xs font-semibold text-muted-foreground"
                      >
                        {t("settings.memoryOrganizerClusterSummaries")}
                      </AstryxStack>
                      <AstryxStack direction="vertical" className="space-y-2">
                        {clusterSummaries.map((summary, index) => (
                          <AstryxStack
                            direction="vertical"
                            key={`${index}:${summary}`}
                            className="rounded bg-muted/30 px-3 py-2 text-xs"
                          >
                            {summary}
                          </AstryxStack>
                        ))}
                      </AstryxStack>
                    </AstryxStack>
                  ) : null}

                  {rawBlocks.length > 0 ? (
                    <Collapsible
                      trigger={t("settings.memoryOrganizerTrimmedProtocol")}
                      defaultIsOpen={false}
                    >
                      <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/30 p-3 text-[11px]">
                        {JSON.stringify(rawBlocks, null, 2)}
                      </pre>
                    </Collapsible>
                  ) : null}
                </AstryxStack>
              ) : (
                <AstryxStack
                  direction="horizontal"
                  className="flex h-full items-center justify-center text-sm text-muted-foreground"
                >
                  {t("settings.memoryOrganizerHistoryEmpty")}
                </AstryxStack>
              )}
            </AstryxStack>
          </AstryxGrid>
        </AstryxStack>
      </VStack>
      <AlertDialog
        isOpen={clearConfirmOpen}
        onOpenChange={setClearConfirmOpen}
        title={t("settings.memoryOrganizerClearHistoryConfirmTitle")}
        description={t("settings.memoryOrganizerClearHistoryConfirmDescription")}
        actionLabel={t("settings.memoryOrganizerClearHistory")}
        cancelLabel={t("settings.memoryCancel")}
        actionVariant="destructive"
        isActionLoading={clearingHistory}
        onAction={clearHistory}
      />
    </>
  );
}
