// Memory settings panel: entry list/filters, quota display, create/edit/
// accept/delete/wipe, plus mounting the settings drawer (which owns the
// organizer history modal).
//
// Shared by every frontend runtime. Platform differences belong in the
// runtime boundary, never in this panel.

import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Selector } from "@astryxdesign/core/Selector";
import { Button as AstryxButton } from "@xagent/ui/components/ui/button";
import { Textarea as AstryxTextarea } from "@xagent/ui/components/ui/textarea";
import {
  Heading as AstryxHeading,
  Inline as AstryxInline,
  Paragraph as AstryxParagraph,
  View as AstryxView,
} from "@xagent/ui/components/ui/view";
import { useEffect, useMemo, useState } from "react";
import { useLocale } from "../../../i18n";
import type { MemoryMeta } from "../../../lib/memory/api";
import { MEMORY_TYPES, type MemoryType } from "../../../lib/memory/schema";
import type { AppSettings } from "../../../lib/settings";
import { SettingsModalShell } from "../SettingsModalShell";
import { MemorySettingsDrawer } from "./MemorySettingsDrawer";
import {
  entryKey,
  entryTitle,
  fallbackScopeQuotas,
  formatTime,
  type MemoryModelOption,
  type MemoryTab,
  matchesFilter,
  memoryScopeLabel,
  memoryTypeLabel,
  projectLabel,
  quotaLevel,
  quotaPillClass,
  quotaStatusClass,
  quotaStatusLabelKey,
  selectedTitle,
  strongestQuotaLevel,
} from "./panelModel";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Brain,
  Button,
  buildModelOptions,
  Check,
  Folder,
  Globe2,
  Input,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
} from "./platform";
import { type MemoryCreateDraft, useMemoryPanelData } from "./useMemoryPanelData";

const EMPTY_CREATE_DRAFT: MemoryCreateDraft = {
  slug: "",
  scope: "global",
  memoryType: "user",
  description: "",
  body: "",
};

export function MemoryPanel(props: {
  workdir?: string;
  settings: AppSettings;
  setSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  compact?: boolean;
}) {
  const { t } = useLocale();
  const workdir = props.workdir?.trim() || undefined;
  const [tab, setTab] = useState<MemoryTab>("global");
  const [filter, setFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [wipeConfirmOpen, setWipeConfirmOpen] = useState(false);
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  const [compactDetailOpen, setCompactDetailOpen] = useState(false);
  const [draft, setDraft] = useState<MemoryCreateDraft>(EMPTY_CREATE_DRAFT);
  const {
    entries,
    quota,
    selected,
    selectedEntry,
    pathsInfo,
    loading,
    error,
    saving,
    editDraft,
    setEditDraft,
    reload,
    openEntry,
    createEntry,
    saveSelected,
    acceptSelected,
    deleteSelected,
    wipeAll,
    watchOrganizerRun,
  } = useMemoryPanelData({ workdir, t });

  const modelOptions = useMemo<MemoryModelOption[]>(
    () =>
      buildModelOptions(props.settings).map((option) => ({
        value: option.value,
        label: option.label,
        providerName: option.providerName,
        providerId: option.providerId,
        providerType: option.providerType,
      })),
    [props.settings],
  );

  const globalEntries = useMemo(() => {
    return entries
      .filter((entry) => entry.scope === "global" && entry.memoryType !== "daily")
      .filter((entry) => matchesFilter(entry, filter));
  }, [entries, filter]);

  const dailyEntries = useMemo(() => {
    return entries
      .filter((entry) => entry.memoryType === "daily")
      .filter((entry) => matchesFilter(entry, filter));
  }, [entries, filter]);

  const projectGroups = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; label: string; latestUpdatedAt: number; entries: MemoryMeta[] }
    >();
    for (const entry of entries) {
      if (entry.scope !== "project" || entry.memoryType === "daily") continue;
      if (!matchesFilter(entry, filter)) continue;
      const key = entry.workdirHash || entry.workdirPath || "unknown";
      const label = projectLabel(entry, t);
      const group = groups.get(key) ?? {
        key,
        label,
        latestUpdatedAt: 0,
        entries: [],
      };
      group.latestUpdatedAt = Math.max(group.latestUpdatedAt, entry.updatedAt);
      group.entries.push(entry);
      groups.set(key, group);
    }
    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        entries: group.entries.sort((a, b) =>
          b.updatedAt === a.updatedAt ? a.slug.localeCompare(b.slug) : b.updatedAt - a.updatedAt,
        ),
      }))
      .sort((a, b) =>
        b.latestUpdatedAt === a.latestUpdatedAt
          ? a.label.localeCompare(b.label)
          : b.latestUpdatedAt - a.latestUpdatedAt,
      );
  }, [entries, filter, t]);

  const projectEntryCount = entries.filter(
    (entry) => entry.scope === "project" && entry.memoryType !== "daily",
  ).length;
  const globalEntryCount = entries.filter(
    (entry) => entry.scope === "global" && entry.memoryType !== "daily",
  ).length;
  const dailyEntryCount = entries.filter((entry) => entry.memoryType === "daily").length;
  const unreviewedCount = entries.filter((entry) => entry.unreviewed).length;
  const quotaItems = useMemo(
    () => fallbackScopeQuotas(entries, quota, Boolean(workdir)),
    [entries, quota, workdir],
  );
  const quotaStatus = strongestQuotaLevel(quotaItems);

  useEffect(() => {
    if (props.compact && !selected && !showCreate) {
      setCompactDetailOpen(false);
    }
  }, [props.compact, selected, showCreate]);

  async function handleCreateEntry() {
    const created = await createEntry(draft);
    if (created) {
      setShowCreate(false);
      setCompactDetailOpen(true);
      setDraft(EMPTY_CREATE_DRAFT);
    }
  }

  function handleWipeAll() {
    setWipeConfirmOpen(false);
    void wipeAll();
  }

  const activeEntryKey = selectedEntry ? entryKey(selectedEntry) : null;

  function renderEntryButton(entry: MemoryMeta, nested = false) {
    const active = activeEntryKey === entryKey(entry);
    return (
      <AstryxButton
        key={entryKey(entry)}
        type="button"
        onClick={() => {
          openEntry(entry);
          if (props.compact) setCompactDetailOpen(true);
        }}
        className={`settings-memory-entry w-full rounded-xl border border-transparent px-3 py-2.5 text-left transition-[color,background-color,border-color] duration-150 ${
          nested ? "ml-3 w-[calc(100%-0.75rem)]" : ""
        } ${
          active
            ? "border-primary/15 bg-primary/[0.08]"
            : entry.unreviewed
              ? "bg-amber-500/[0.06] hover:bg-amber-500/[0.1]"
              : "hover:bg-muted/40"
        }`}
      >
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="flex items-center justify-between gap-2"
        >
          <AstryxView
            layout="block"
            direction="horizontal"
            className="min-w-0 truncate text-xs font-semibold"
          >
            {entryTitle(entry)}
          </AstryxView>
          <AstryxView
            layout="block"
            direction="horizontal"
            className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
          >
            {memoryTypeLabel(entry.memoryType, t)}
          </AstryxView>
        </AstryxView>
        <AstryxView
          layout="block"
          direction="horizontal"
          className="mt-1 truncate font-mono text-[11px] text-muted-foreground/70"
        >
          id: {entry.slug}
        </AstryxView>
      </AstryxButton>
    );
  }

  function renderFlatEntries(items: MemoryMeta[], emptyKey: string) {
    if (items.length === 0) {
      return (
        <AstryxView
          layout="block"
          direction="horizontal"
          className="rounded-lg border border-dashed border-border/60 px-4 py-8 text-center text-xs text-muted-foreground"
        >
          {t(emptyKey)}
        </AstryxView>
      );
    }
    return (
      <AstryxView layout="block" direction="horizontal" className="space-y-1.5">
        {items.map((entry) => renderEntryButton(entry))}
      </AstryxView>
    );
  }

  return (
    <>
      <AstryxView
        layout="flex"
        direction="vertical"
        className="settings-memory-panel flex min-h-0 flex-1 flex-col gap-5"
      >
        <AstryxView
          layout="block"
          direction="horizontal"
          className={`settings-memory-overview shrink-0 space-y-4 ${
            props.compact && compactDetailOpen ? "settings-memory-compact-hidden" : ""
          }`}
        >
          <AstryxView
            layout="flex"
            direction="horizontal"
            className="settings-section-heading-row flex items-center justify-between gap-4"
          >
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="settings-section-title-group flex min-w-0 items-center gap-3"
            >
              <AstryxView
                layout="flex"
                direction="horizontal"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-300"
              >
                <Brain className="h-[18px] w-[18px]" />
              </AstryxView>
              <AstryxView layout="block" direction="horizontal" className="min-w-0">
                <AstryxHeading level={2} className="text-sm font-semibold">
                  {t("settings.memoryTitle")}
                </AstryxHeading>
                <AstryxParagraph className="text-xs leading-relaxed text-muted-foreground">
                  {t("settings.mobile.memoryDescription")}
                </AstryxParagraph>
              </AstryxView>
            </AstryxView>
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="settings-memory-summary-actions flex shrink-0 items-center gap-2"
            >
              <Button variant="outline" size="sm" onClick={() => reload()} disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                {t("settings.memoryRefresh")}
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                title={t("settings.memoryOpenSettings")}
                aria-label={t("settings.memoryOpenSettings")}
                onClick={() => setSettingsDrawerOpen(true)}
              >
                <Settings2 className="h-3.5 w-3.5" />
              </Button>
            </AstryxView>
          </AstryxView>

          <AstryxView
            layout="block"
            direction="horizontal"
            className="settings-memory-status-group overflow-hidden rounded-2xl border border-border/60 bg-card"
          >
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="settings-memory-status-row flex min-w-0 items-center gap-3 px-4 py-3"
            >
              <AstryxView
                layout="flex"
                direction="horizontal"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground"
              >
                <Folder className="h-4 w-4" />
              </AstryxView>
              <AstryxView layout="block" direction="horizontal" className="min-w-0 flex-1">
                <AstryxView layout="block" direction="horizontal" className="text-xs font-medium">
                  {t("settings.memoryTitle")}
                </AstryxView>
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="truncate font-mono text-[11px] text-muted-foreground"
                >
                  {pathsInfo?.root ?? "~/.xagent/memory"}
                </AstryxView>
              </AstryxView>
              <AstryxView
                layout="block"
                direction="horizontal"
                className={`shrink-0 rounded-md border px-2 py-1 text-[11px] ${quotaStatusClass(quotaStatus)}`}
              >
                {t(quotaStatusLabelKey(quotaStatus))}
              </AstryxView>
            </AstryxView>
            <AstryxView
              layout="grid"
              direction="horizontal"
              className="settings-memory-quota-grid grid border-t border-border/45 sm:grid-cols-2"
            >
              {quotaItems.map((item) => {
                const level = quotaLevel(item);
                const label =
                  item.scope === "global"
                    ? t("settings.memoryQuotaGlobal")
                    : t("settings.memoryQuotaProject");
                return (
                  <AstryxView
                    layout="flex"
                    direction="horizontal"
                    key={`${item.scope}:${item.workdirHash}`}
                    className="settings-memory-quota-row flex min-w-0 items-center justify-between gap-3 px-4 py-3 sm:[&+&]:border-l sm:[&+&]:border-border/45"
                  >
                    <AstryxInline className="truncate text-xs text-muted-foreground">
                      {label}
                    </AstryxInline>
                    <AstryxInline
                      className={`shrink-0 rounded-md border px-2 py-1 text-[11px] tabular-nums ${quotaPillClass(level)}`}
                    >
                      {item.used} / {item.limit}
                    </AstryxInline>
                  </AstryxView>
                );
              })}
            </AstryxView>
          </AstryxView>

          {unreviewedCount > 0 ? (
            <AstryxView
              layout="block"
              direction="horizontal"
              className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300"
            >
              {unreviewedCount} {t("settings.memoryAwaitingReview")}
            </AstryxView>
          ) : null}
          {pathsInfo?.isInCloud ? (
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t("settings.memoryCloudWarningPrefix")}{" "}
              {pathsInfo.cloudProvider ?? t("settings.memoryCloudSyncFolder")}
            </AstryxView>
          ) : null}
          {quotaStatus === "full" || quotaStatus === "danger" ? (
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-3 py-2.5 text-xs text-red-700 dark:text-red-300"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t(
                quotaStatus === "full"
                  ? "settings.memoryQuotaFullMessage"
                  : "settings.memoryQuotaNearLimitMessage",
              )}
            </AstryxView>
          ) : quotaStatus === "warning" ? (
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t("settings.memoryQuotaWarningMessage")}
            </AstryxView>
          ) : null}
          {error ? (
            <AstryxView
              layout="block"
              direction="horizontal"
              className="whitespace-pre-wrap rounded-xl border border-destructive/20 bg-destructive/[0.05] px-3 py-2.5 text-xs text-destructive"
            >
              {error}
            </AstryxView>
          ) : null}
        </AstryxView>

        <AstryxView
          layout="grid"
          direction="horizontal"
          className="settings-memory-layout grid min-h-0 flex-1 overflow-hidden rounded-2xl border border-border/60 bg-card lg:grid-cols-[340px_minmax(0,1fr)]"
        >
          <AstryxView
            as="section"
            className={`settings-memory-list-section flex min-h-0 min-w-0 flex-col border-r border-border/45 ${
              props.compact && compactDetailOpen ? "settings-memory-compact-hidden" : ""
            }`}
          >
            <AstryxView
              layout="block"
              direction="horizontal"
              className="shrink-0 space-y-3 border-b border-border/40 p-3"
            >
              <AstryxView
                layout="grid"
                direction="horizontal"
                className="grid grid-cols-3 gap-1 rounded-lg bg-muted/50 p-1"
              >
                <AstryxButton
                  type="button"
                  onClick={() => setTab("global")}
                  className={`flex min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium ${tab === "global" ? "bg-background shadow-xs" : "text-muted-foreground"}`}
                >
                  <Globe2 className="h-3.5 w-3.5 shrink-0" />
                  <AstryxInline className="truncate">
                    {t("settings.memoryCategoryGlobal")}
                  </AstryxInline>
                  <AstryxInline className="shrink-0 text-[10px] text-muted-foreground">
                    {globalEntryCount}
                  </AstryxInline>
                </AstryxButton>
                <AstryxButton
                  type="button"
                  onClick={() => setTab("project")}
                  className={`flex min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium ${tab === "project" ? "bg-background shadow-xs" : "text-muted-foreground"}`}
                >
                  <Folder className="h-3.5 w-3.5 shrink-0" />
                  <AstryxInline className="truncate">
                    {t("settings.memoryCategoryProject")}
                  </AstryxInline>
                  <AstryxInline className="shrink-0 text-[10px] text-muted-foreground">
                    {projectEntryCount}
                  </AstryxInline>
                </AstryxButton>
                <AstryxButton
                  type="button"
                  onClick={() => setTab("journal")}
                  className={`flex min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium ${tab === "journal" ? "bg-background shadow-xs" : "text-muted-foreground"}`}
                >
                  <BookOpen className="h-3.5 w-3.5 shrink-0" />
                  <AstryxInline className="truncate">
                    {t("settings.memoryCategoryJournal")}
                  </AstryxInline>
                  <AstryxInline className="shrink-0 text-[10px] text-muted-foreground">
                    {dailyEntryCount}
                  </AstryxInline>
                </AstryxButton>
              </AstryxView>
              <AstryxView layout="flex" direction="horizontal" className="flex gap-2">
                <AstryxView layout="block" direction="horizontal" className="relative flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    className="pl-8 text-xs"
                    placeholder={t("settings.memorySearchPlaceholder")}
                  />
                </AstryxView>
                <Button
                  size="icon"
                  variant="outline"
                  title={t("settings.memoryNew")}
                  onClick={() => {
                    setShowCreate(true);
                    if (props.compact) setCompactDetailOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </AstryxView>
            </AstryxView>

            <AstryxView
              layout="block"
              direction="horizontal"
              className="settings-memory-entry-list min-h-0 flex-1 overflow-auto p-2"
            >
              {tab === "global" ? (
                renderFlatEntries(globalEntries, "settings.memoryNoGlobalEntries")
              ) : tab === "journal" ? (
                renderFlatEntries(dailyEntries, "settings.memoryNoJournalEntries")
              ) : projectGroups.length === 0 ? (
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="rounded-lg border border-dashed border-border/60 px-4 py-8 text-center text-xs text-muted-foreground"
                >
                  {t("settings.memoryNoProjectEntries")}
                </AstryxView>
              ) : (
                <AstryxView layout="block" direction="horizontal" className="space-y-2">
                  {projectGroups.map((group) => (
                    <Collapsible
                      key={group.key}
                      defaultIsOpen
                      trigger={
                        <AstryxView
                          layout="flex"
                          direction="horizontal"
                          className="min-w-0 items-center gap-2"
                        >
                          <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <AstryxInline
                            className="min-w-0 flex-1 truncate font-medium"
                            title={group.label}
                          >
                            {group.label}
                          </AstryxInline>
                          <AstryxInline className="shrink-0 rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {group.entries.length}
                          </AstryxInline>
                        </AstryxView>
                      }
                    >
                      <AstryxView
                        layout="block"
                        direction="horizontal"
                        className="space-y-1.5 border-t border-border/40 px-2 py-2"
                      >
                        {group.entries.map((entry) => renderEntryButton(entry, true))}
                      </AstryxView>
                    </Collapsible>
                  ))}
                </AstryxView>
              )}
            </AstryxView>
          </AstryxView>

          <AstryxView
            as="section"
            className={`settings-memory-detail-section flex min-h-0 min-w-0 flex-col ${
              props.compact && !compactDetailOpen ? "settings-memory-compact-hidden" : ""
            }`}
          >
            {props.compact ? (
              <AstryxView
                layout="flex"
                direction="horizontal"
                className="settings-memory-compact-toolbar flex min-h-12 shrink-0 items-center border-b border-border/40 px-2"
              >
                <AstryxButton
                  type="button"
                  onClick={() => {
                    setCompactDetailOpen(false);
                    setShowCreate(false);
                  }}
                  className="settings-memory-back inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2.5 text-sm font-medium text-primary"
                  aria-label={t("settings.memoryTitle")}
                >
                  <ArrowLeft className="h-4 w-4" />
                  {t("settings.memoryTitle")}
                </AstryxButton>
              </AstryxView>
            ) : null}
            {showCreate ? (
              <AstryxView
                layout="block"
                direction="horizontal"
                className="shrink-0 border-b border-border/40 p-4"
              >
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="mb-3 text-sm font-semibold"
                >
                  {t("settings.memoryNew")}
                </AstryxView>
                <AstryxView
                  layout="grid"
                  direction="horizontal"
                  className="grid gap-3 md:grid-cols-2"
                >
                  <Input
                    value={draft.slug}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, slug: event.target.value }))
                    }
                    placeholder={t("settings.memorySlugPlaceholder")}
                  />
                  <Selector
                    label={t("settings.memoryNew")}
                    isLabelHidden
                    value={draft.memoryType}
                    onChange={(value) =>
                      setDraft((prev) => ({
                        ...prev,
                        memoryType: value as MemoryType,
                      }))
                    }
                    options={MEMORY_TYPES.map((type) => ({
                      value: type,
                      label: memoryTypeLabel(type, t),
                    }))}
                  />
                  <Selector
                    label={t("settings.memoryScopeGlobal")}
                    isLabelHidden
                    value={draft.scope}
                    onChange={(value) =>
                      setDraft((prev) => ({
                        ...prev,
                        scope: value as "global" | "project",
                      }))
                    }
                    options={[
                      { value: "global", label: t("settings.memoryScopeGlobal") },
                      { value: "project", label: t("settings.memoryScopeProject") },
                    ]}
                  />
                  <Input
                    value={draft.description}
                    onChange={(event) =>
                      setDraft((prev) => ({ ...prev, description: event.target.value }))
                    }
                    placeholder={t("settings.memoryDescriptionPlaceholder")}
                  />
                </AstryxView>
                <AstryxTextarea
                  value={draft.body}
                  onChange={(event) => setDraft((prev) => ({ ...prev, body: event.target.value }))}
                  className="mt-3 min-h-28 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder={t("settings.memoryBodyPlaceholder")}
                />
                <AstryxView
                  layout="flex"
                  direction="horizontal"
                  className="mt-3 flex justify-end gap-2"
                >
                  <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>
                    {t("settings.memoryCancel")}
                  </Button>
                  <Button size="sm" onClick={handleCreateEntry} disabled={saving}>
                    {t("settings.memorySave")}
                  </Button>
                </AstryxView>
              </AstryxView>
            ) : null}

            {selected ? (
              <>
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="shrink-0 border-b border-border/40 p-4"
                >
                  <AstryxView
                    layout="flex"
                    direction="horizontal"
                    className="flex flex-wrap items-start justify-between gap-3"
                  >
                    <AstryxView layout="block" direction="horizontal" className="min-w-0">
                      <AstryxView
                        layout="flex"
                        direction="horizontal"
                        className="flex flex-wrap items-center gap-2"
                      >
                        <AstryxView
                          layout="block"
                          direction="horizontal"
                          className="truncate text-sm font-semibold"
                        >
                          {selectedTitle(selected)}
                        </AstryxView>
                        <AstryxInline className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {memoryScopeLabel(selected.scope, t)}
                        </AstryxInline>
                        <AstryxInline className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {memoryTypeLabel(selected.memoryType, t)}
                        </AstryxInline>
                        {selected.meta.unreviewed ? (
                          <AstryxInline className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                            {t("settings.memoryUnreviewed")}
                          </AstryxInline>
                        ) : null}
                      </AstryxView>
                      <AstryxView
                        layout="block"
                        direction="horizontal"
                        className="mt-1 text-xs text-muted-foreground"
                      >
                        {t("settings.memoryUpdated")} {formatTime(selected.meta.updatedAt)}
                      </AstryxView>
                      <AstryxView
                        layout="block"
                        direction="horizontal"
                        className="mt-1 truncate font-mono text-[11px] text-muted-foreground/70"
                      >
                        id: {selected.slug}
                      </AstryxView>
                      {selectedEntry?.scope === "project" ? (
                        <AstryxView
                          layout="block"
                          direction="horizontal"
                          className="mt-1 truncate font-mono text-[11px] text-muted-foreground/70"
                        >
                          {selectedEntry.workdirPath || selectedEntry.workdirHash}
                        </AstryxView>
                      ) : null}
                    </AstryxView>
                    <AstryxView
                      layout="flex"
                      direction="horizontal"
                      className="flex items-center gap-2"
                    >
                      {selected.meta.unreviewed && selected.memoryType !== "daily" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={acceptSelected}
                          disabled={saving}
                        >
                          <Check className="h-3.5 w-3.5" />
                          {t("settings.memoryAccept")}
                        </Button>
                      ) : null}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={deleteSelected}
                        disabled={saving}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t("settings.memoryDelete")}
                      </Button>
                    </AstryxView>
                  </AstryxView>
                </AstryxView>

                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="settings-memory-detail-body min-h-0 flex-1 overflow-auto p-4"
                >
                  {selected.memoryType === "daily" ? (
                    <AstryxView layout="block" direction="horizontal" className="space-y-3">
                      <AstryxTextarea
                        value={editDraft.appendBody}
                        onChange={(event) =>
                          setEditDraft((prev) => ({ ...prev, appendBody: event.target.value }))
                        }
                        className="min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
                        placeholder={t("settings.memoryAppendBlockPlaceholder")}
                      />
                      <AstryxView
                        layout="block"
                        direction="horizontal"
                        className="rounded-lg border border-border/50 bg-muted/20 p-3"
                      >
                        <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">
                          {selected.body || t("settings.memoryEmptyBody")}
                        </pre>
                      </AstryxView>
                    </AstryxView>
                  ) : (
                    <AstryxView layout="block" direction="horizontal" className="space-y-3">
                      <Input
                        value={editDraft.description}
                        onChange={(event) =>
                          setEditDraft((prev) => ({ ...prev, description: event.target.value }))
                        }
                        placeholder={t("settings.memoryDescriptionPlaceholder")}
                      />
                      <AstryxTextarea
                        value={editDraft.body}
                        onChange={(event) =>
                          setEditDraft((prev) => ({ ...prev, body: event.target.value }))
                        }
                        className="min-h-[360px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed"
                      />
                    </AstryxView>
                  )}
                </AstryxView>

                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="shrink-0 border-t border-border/40 p-4"
                >
                  <AstryxView
                    layout="flex"
                    direction="horizontal"
                    className="flex justify-between gap-3"
                  >
                    <AstryxView
                      layout="flex"
                      direction="horizontal"
                      className="flex items-center gap-2"
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setWipeConfirmOpen(true)}
                        disabled={saving}
                      >
                        {t("settings.memoryWipeAll")}
                      </Button>
                    </AstryxView>
                    <Button size="sm" onClick={saveSelected} disabled={saving}>
                      {t("settings.memorySave")}
                    </Button>
                  </AstryxView>
                </AstryxView>
              </>
            ) : (
              <AstryxView
                layout="flex"
                direction="horizontal"
                className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground"
              >
                {t("settings.memorySelectEntry")}
              </AstryxView>
            )}
          </AstryxView>
        </AstryxView>
      </AstryxView>

      {settingsDrawerOpen ? (
        <MemorySettingsDrawer
          modelOptions={modelOptions}
          settings={props.settings}
          setSettings={props.setSettings}
          workdir={workdir}
          saving={saving}
          t={t}
          onClose={() => setSettingsDrawerOpen(false)}
          onRequestWipe={wipeAll}
          onOrganizerRunQueued={(runId) => watchOrganizerRun(runId)}
          onMemoryChanged={() => {
            void reload();
          }}
        />
      ) : null}

      {wipeConfirmOpen ? (
        <SettingsModalShell
          onClose={() => setWipeConfirmOpen(false)}
          ariaLabel={t("settings.memoryWipeConfirmTitle")}
          panelClassName="max-w-md"
        >
          <AstryxView
            layout="flex"
            direction="horizontal"
            className="flex items-start gap-3 border-b px-5 py-4"
          >
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10"
            >
              <AlertTriangle className="h-4 w-4 text-destructive" />
            </AstryxView>
            <AstryxView layout="block" direction="horizontal" className="min-w-0 flex-1">
              <AstryxView
                layout="block"
                direction="horizontal"
                id="memory-wipe-confirm-title"
                className="text-sm font-semibold"
              >
                {t("settings.memoryWipeConfirmTitle")}
              </AstryxView>
              <AstryxView
                layout="block"
                direction="horizontal"
                className="mt-1 text-xs leading-relaxed text-muted-foreground"
              >
                {t("settings.memoryWipeConfirmDescription")}
              </AstryxView>
            </AstryxView>
          </AstryxView>
          <AstryxView
            layout="flex"
            direction="horizontal"
            className="flex justify-end gap-2 px-5 py-4"
          >
            <Button variant="outline" size="sm" onClick={() => setWipeConfirmOpen(false)}>
              {t("settings.memoryCancel")}
            </Button>
            <Button variant="destructive" size="sm" onClick={handleWipeAll} disabled={saving}>
              {t("settings.memoryWipeAll")}
            </Button>
          </AstryxView>
        </SettingsModalShell>
      ) : null}
    </>
  );
}
