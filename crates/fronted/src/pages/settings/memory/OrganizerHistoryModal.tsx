// Organizer run-history modal. All protocol parsing goes through the typed
// run report in lib/memory/organizer/runRecord — v4 reports round-trip
// unchanged; pre-v4 runs degrade to a read-only legacy view (summaries and
// review notes only: no decisions, no manual apply).
//
// Shared by every frontend runtime. Platform differences belong in the
// runtime boundary, never in this modal.

import { useEffect, useState } from "react";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { useMediaQuery } from "@astryxdesign/core/hooks";
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
import { BrushCleaning, Button, Check, DrawerSelect, RefreshCw } from "./platform";
import { useOrganizeRunHistory } from "./useMemoryPanelData";
import { View as AstryxView, Inline as AstryxInline } from "@xagent/ui/components/ui/view";
import { Button as AstryxButton } from "@xagent/ui/components/ui/button";

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

  const isCompact = useMediaQuery("(max-width: 640px)");

  return (
    <>
      <Dialog
        isOpen
        onOpenChange={(isOpen) => {
          if (!isOpen) onClose();
        }}
        purpose="info"
        variant={isCompact ? "fullscreen" : "standard"}
        width={isCompact ? "100dvw" : "var(--xagent-dialog-width-xl)"}
        maxHeight={isCompact ? "var(--xagent-viewport-height)" : "var(--xagent-dialog-height-xl)"}
        padding={0}
      >
        <AstryxView
          layout="flex"
          direction="vertical"
          className="flex h-full min-h-0 w-full flex-col overflow-hidden"
        >
          <DialogHeader
            title={t("settings.memoryOrganizerHistory")}
            subtitle={t("settings.memoryOrganizerHistoryDescription")}
            onOpenChange={(isOpen) => {
              if (!isOpen) onClose();
            }}
          />

          <AstryxView
            layout="grid"
            direction="horizontal"
            className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)]"
          >
            <AstryxView as="aside" className="flex min-h-0 flex-col border-r border-border/50">
              <AstryxView
                layout="block"
                direction="horizontal"
                className="space-y-2 border-b border-border/40 p-3"
              >
                <AstryxView
                  layout="flex"
                  direction="horizontal"
                  className="flex items-center gap-2"
                >
                  <AstryxView layout="block" direction="horizontal" className="min-w-0 flex-1">
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
                  </AstryxView>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    title={t("settings.memoryOrganizerClearHistory")}
                    aria-label={t("settings.memoryOrganizerClearHistory")}
                    onClick={() => setClearConfirmOpen(true)}
                    disabled={loading || clearingHistory || runs.length === 0}
                  >
                    <BrushCleaning className="h-3.5 w-3.5" />
                  </Button>
                </AstryxView>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => reload()}
                  disabled={loading}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                  {t("settings.memoryRefresh")}
                </Button>
              </AstryxView>
              <AstryxView
                layout="block"
                direction="horizontal"
                className="min-h-0 flex-1 overflow-auto p-2"
              >
                {runs.length === 0 ? (
                  <AstryxView
                    layout="block"
                    direction="horizontal"
                    className="rounded-lg border border-dashed border-border/60 px-3 py-8 text-center text-xs text-muted-foreground"
                  >
                    {t("settings.memoryOrganizerHistoryEmpty")}
                  </AstryxView>
                ) : (
                  <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
                    {runs.map((run) => {
                      const active = selectedRun?.runId === run.runId;
                      return (
                        <AstryxButton
                          key={run.runId}
                          type="button"
                          onClick={() => reload(run.runId)}
                          className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                            active
                              ? "border-primary/50 bg-primary/5"
                              : "border-border/50 bg-background/70 hover:bg-muted/35"
                          }`}
                        >
                          <AstryxView
                            layout="flex"
                            direction="horizontal"
                            className="flex items-center justify-between gap-2"
                          >
                            <AstryxInline
                              className={`rounded border px-1.5 py-0.5 text-[10px] ${organizerStatusClass(run.status)}`}
                            >
                              {organizerStatusLabel(run.status, t)}
                            </AstryxInline>
                            <AstryxInline className="text-[10px] text-muted-foreground">
                              {organizerTriggerLabel(run.trigger, t)}
                            </AstryxInline>
                          </AstryxView>
                          <AstryxView
                            layout="block"
                            direction="horizontal"
                            className="mt-1 truncate text-xs font-medium"
                          >
                            {run.finalSummary ||
                              run.error ||
                              t("settings.memoryOrganizerHistoryPending")}
                          </AstryxView>
                          <AstryxView
                            layout="block"
                            direction="horizontal"
                            className="mt-1 truncate text-[11px] text-muted-foreground"
                          >
                            {formatTime(run.startedAt || run.createdAt)} · {modelNameFromRun(run)}
                          </AstryxView>
                        </AstryxButton>
                      );
                    })}
                  </AstryxView>
                )}
              </AstryxView>
            </AstryxView>

            <AstryxView as="section" className="min-h-0 overflow-auto p-5">
              {error ? (
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="mb-4 whitespace-pre-wrap rounded-lg border border-destructive/20 bg-destructive/[0.05] px-3 py-2 text-xs text-destructive"
                >
                  {error}
                </AstryxView>
              ) : null}
              {historyFeedback ? (
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"
                >
                  {historyFeedback}
                </AstryxView>
              ) : null}
              {selectedRun ? (
                <AstryxView layout="block" direction="horizontal" className="space-y-4">
                  <AstryxView
                    layout="flex"
                    direction="horizontal"
                    className="flex flex-wrap items-start justify-between gap-3"
                  >
                    <AstryxView layout="block" direction="horizontal" className="min-w-0 space-y-1">
                      <AstryxView
                        layout="flex"
                        direction="horizontal"
                        className="flex flex-wrap items-center gap-2"
                      >
                        <AstryxInline
                          className={`rounded border px-2 py-1 text-xs ${organizerStatusClass(selectedRun.status)}`}
                        >
                          {organizerStatusLabel(selectedRun.status, t)}
                        </AstryxInline>
                        <AstryxInline className="rounded border border-border/60 px-2 py-1 text-xs text-muted-foreground">
                          {organizerTriggerLabel(selectedRun.trigger, t)}
                        </AstryxInline>
                        <AstryxInline className="rounded border border-border/60 px-2 py-1 text-xs text-muted-foreground">
                          {selectedRun.scope} / {selectedRun.mode}
                        </AstryxInline>
                      </AstryxView>
                      <AstryxView
                        layout="block"
                        direction="horizontal"
                        className="font-mono text-[11px] text-muted-foreground"
                      >
                        {selectedRun.runId}
                      </AstryxView>
                    </AstryxView>
                    <AstryxView
                      layout="grid"
                      direction="horizontal"
                      className="grid shrink-0 grid-cols-[auto_minmax(9rem,auto)] gap-x-2 gap-y-1 rounded-md border border-border/50 bg-background/70 px-3 py-2 text-xs text-muted-foreground"
                    >
                      <AstryxInline className="whitespace-nowrap">
                        {t("settings.memoryOrganizerStarted")}
                      </AstryxInline>
                      <AstryxInline className="whitespace-nowrap text-right font-mono text-foreground/80">
                        {formatTime(selectedRun.startedAt || selectedRun.createdAt)}
                      </AstryxInline>
                      <AstryxInline className="whitespace-nowrap">
                        {t("settings.memoryOrganizerFinished")}
                      </AstryxInline>
                      <AstryxInline className="whitespace-nowrap text-right font-mono text-foreground/80">
                        {selectedRun.finishedAt ? formatTime(selectedRun.finishedAt) : "-"}
                      </AstryxInline>
                    </AstryxView>
                  </AstryxView>

                  <AstryxView
                    layout="block"
                    direction="horizontal"
                    className="rounded-lg border border-border/60 bg-muted/15 p-4"
                  >
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="mb-2 text-xs font-semibold text-muted-foreground"
                    >
                      {t("settings.memoryOrganizerFinalSummary")}
                    </AstryxView>
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="whitespace-pre-wrap text-sm leading-relaxed"
                    >
                      {displayedFinalSummary(selectedRun, manualApplyDisplay) ||
                        t("settings.memoryOrganizerHistoryPending")}
                    </AstryxView>
                  </AstryxView>

                  <AstryxView
                    layout="grid"
                    direction="horizontal"
                    className="grid gap-2 sm:grid-cols-4"
                  >
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
                      <AstryxView
                        layout="block"
                        direction="horizontal"
                        key={key}
                        className="rounded-lg border border-border/50 bg-background/70 p-3"
                      >
                        <AstryxView
                          layout="block"
                          direction="horizontal"
                          className="text-[11px] text-muted-foreground"
                        >
                          {t(String(key))}
                        </AstryxView>
                        <AstryxView
                          layout="block"
                          direction="horizontal"
                          className="mt-1 text-lg font-semibold"
                        >
                          {value}
                        </AstryxView>
                      </AstryxView>
                    ))}
                  </AstryxView>

                  {safeDecisions.length > 0 ? (
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="rounded-lg border border-border/60 p-4"
                    >
                      <AstryxView
                        layout="flex"
                        direction="horizontal"
                        className="flex flex-wrap items-center justify-between gap-3"
                      >
                        <AstryxView layout="block" direction="horizontal">
                          <AstryxView
                            layout="block"
                            direction="horizontal"
                            className="text-xs font-semibold text-muted-foreground"
                          >
                            {t("settings.memoryOrganizerManualPreview")}
                          </AstryxView>
                          <AstryxView
                            layout="block"
                            direction="horizontal"
                            className="mt-1 text-xs text-muted-foreground"
                          >
                            {manualApplyDisplay.status === "applied"
                              ? t("settings.memoryOrganizerApplied")
                              : manualApplyDisplay.status === "partial"
                                ? t("settings.memoryOrganizerPartiallyApplied")
                                : manualApplyDisplay.status === "failed"
                                  ? t("settings.memoryOrganizerApplyFailed")
                                  : t("settings.memoryOrganizerManualPreviewDescription")}
                          </AstryxView>
                        </AstryxView>
                        {canApplyManualPreview ? (
                          <Button
                            type="button"
                            size="sm"
                            onClick={applyManualPreview}
                            disabled={applyingPreview}
                          >
                            <Check className="h-3.5 w-3.5" />
                            {t("settings.memoryOrganizerApplySelected")}
                          </Button>
                        ) : null}
                      </AstryxView>
                      <AstryxView layout="block" direction="horizontal" className="mt-3 space-y-2">
                        {safeDecisions.map((decision, index) => {
                          const key = organizerDecisionKey(decision, index);
                          const checked =
                            manualApplyDisplay.status && manualApplyDisplay.status !== "pending"
                              ? manualApplyDisplay.appliedDecisionKeys.size === 0
                                ? decision.applyStatus !== "failed"
                                : manualApplyDisplay.appliedDecisionKeys.has(key)
                              : selectedDecisionKeys.has(key);
                          return (
                            <AstryxView
                              layout="flex"
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
                              <AstryxInline className="min-w-0 flex-1">
                                <AstryxView
                                  as="span"
                                  layout="flex"
                                  direction="horizontal"
                                  className="flex flex-wrap items-center gap-2"
                                >
                                  <AstryxInline className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                                    {decision.op === "delete"
                                      ? t("settings.memoryOrganizerDecisionDelete")
                                      : t("settings.memoryOrganizerDecisionUpsert")}
                                  </AstryxInline>
                                  <AstryxInline className="font-mono text-[11px]">
                                    {decision.slug}
                                  </AstryxInline>
                                  {decision.scope ? (
                                    <AstryxInline className="text-[11px] text-muted-foreground">
                                      {decision.scope}
                                      {decision.workdirHash ? `:${decision.workdirHash}` : ""}
                                    </AstryxInline>
                                  ) : null}
                                  <AstryxInline
                                    className={`rounded border px-1.5 py-0.5 text-[10px] ${organizerRiskClass(decision.riskLevel)}`}
                                  >
                                    {organizerRiskLabel(decision.riskLevel, t)}
                                  </AstryxInline>
                                  {decision.confidence != null ? (
                                    <AstryxInline className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                      {t("settings.memoryOrganizerConfidence")}{" "}
                                      {decision.confidence.toFixed(2)}
                                    </AstryxInline>
                                  ) : null}
                                  {decision.requiresUserAck ? (
                                    <AstryxInline className="rounded border border-amber-500/30 bg-amber-500/[0.06] px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                                      {t("settings.memoryOrganizerRequiresAck")}
                                    </AstryxInline>
                                  ) : null}
                                  {decision.applyStatus ? (
                                    <AstryxInline
                                      className={`rounded border px-1.5 py-0.5 text-[10px] ${organizerApplyStatusClass(decision.applyStatus)}`}
                                    >
                                      {organizerApplyStatusLabel(decision.applyStatus, t)}
                                    </AstryxInline>
                                  ) : null}
                                </AstryxView>
                                <AstryxInline className="mt-1 block break-words text-muted-foreground">
                                  {decision.reason || decision.description || "-"}
                                </AstryxInline>
                                {decision.applyError?.message ? (
                                  <AstryxInline className="mt-1 block break-words text-destructive">
                                    {decision.applyError.message}
                                  </AstryxInline>
                                ) : null}
                                {decision.sourceSlugs?.length ? (
                                  <AstryxInline className="mt-1 block break-words font-mono text-[10px] text-muted-foreground">
                                    {t("settings.memoryOrganizerSources")}{" "}
                                    {decision.sourceSlugs.join(", ")}
                                  </AstryxInline>
                                ) : null}
                              </AstryxInline>
                            </AstryxView>
                          );
                        })}
                      </AstryxView>
                    </AstryxView>
                  ) : null}

                  {rejectionBuckets.length > 0 ? (
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="rounded-lg border border-border/60 p-4"
                    >
                      <AstryxView
                        layout="block"
                        direction="horizontal"
                        className="mb-3 text-xs font-semibold text-muted-foreground"
                      >
                        {t("settings.memoryOrganizerRejectionBuckets")}
                      </AstryxView>
                      <AstryxView
                        layout="grid"
                        direction="horizontal"
                        className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
                      >
                        {rejectionBuckets.map(([key, count]) => (
                          <AstryxView
                            layout="block"
                            direction="horizontal"
                            key={key}
                            className="rounded-md border border-border/50 bg-background/70 px-3 py-2"
                          >
                            <AstryxView
                              layout="block"
                              direction="horizontal"
                              className="text-[11px] text-muted-foreground"
                            >
                              {t(key)}
                            </AstryxView>
                            <AstryxView
                              layout="block"
                              direction="horizontal"
                              className="mt-1 text-sm font-semibold"
                            >
                              {count}
                            </AstryxView>
                          </AstryxView>
                        ))}
                      </AstryxView>
                    </AstryxView>
                  ) : null}

                  {reviewItems.length > 0 ? (
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-4"
                    >
                      <AstryxView
                        layout="block"
                        direction="horizontal"
                        className="mb-2 text-xs font-semibold text-amber-700 dark:text-amber-300"
                      >
                        {t("settings.memoryOrganizerReviewNotes")}
                      </AstryxView>
                      <AstryxView as="ul" className="space-y-2 text-xs text-muted-foreground">
                        {reviewItems.map((item, index) => (
                          <AstryxView
                            as="li"
                            key={`${index}:${item.phase}:${item.slug || ""}:${item.message}`}
                            className="rounded-md border border-border/50 bg-background/70 px-3 py-2"
                          >
                            <AstryxView
                              layout="flex"
                              direction="horizontal"
                              className="mb-1 flex flex-wrap items-center gap-2"
                            >
                              <AstryxInline
                                className={`rounded border px-1.5 py-0.5 text-[10px] ${organizerReviewItemClass(item)}`}
                              >
                                {organizerReviewItemLabel(item, t)}
                              </AstryxInline>
                              {item.code ? (
                                <AstryxInline className="font-mono text-[10px] text-muted-foreground">
                                  {item.code}
                                </AstryxInline>
                              ) : null}
                              {item.slug ? (
                                <AstryxInline className="font-mono text-[10px] text-muted-foreground">
                                  {item.slug}
                                </AstryxInline>
                              ) : null}
                            </AstryxView>
                            <AstryxView
                              layout="block"
                              direction="horizontal"
                              className="break-words"
                            >
                              {item.message}
                            </AstryxView>
                          </AstryxView>
                        ))}
                      </AstryxView>
                    </AstryxView>
                  ) : null}

                  {clusterSummaries.length > 0 ? (
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="rounded-lg border border-border/60 p-4"
                    >
                      <AstryxView
                        layout="block"
                        direction="horizontal"
                        className="mb-2 text-xs font-semibold text-muted-foreground"
                      >
                        {t("settings.memoryOrganizerClusterSummaries")}
                      </AstryxView>
                      <AstryxView layout="block" direction="horizontal" className="space-y-2">
                        {clusterSummaries.map((summary, index) => (
                          <AstryxView
                            layout="block"
                            direction="horizontal"
                            key={`${index}:${summary}`}
                            className="rounded bg-muted/30 px-3 py-2 text-xs"
                          >
                            {summary}
                          </AstryxView>
                        ))}
                      </AstryxView>
                    </AstryxView>
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
                </AstryxView>
              ) : (
                <AstryxView
                  layout="flex"
                  direction="horizontal"
                  className="flex h-full items-center justify-center text-sm text-muted-foreground"
                >
                  {t("settings.memoryOrganizerHistoryEmpty")}
                </AstryxView>
              )}
            </AstryxView>
          </AstryxView>
        </AstryxView>
      </Dialog>
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
