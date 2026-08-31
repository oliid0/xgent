import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button as AstryxNativeButton } from "@astryxdesign/core/Button";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid as AstryxGrid } from "@astryxdesign/core/Grid";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack } from "@astryxdesign/core/Layout";
import { List as AstryxList, ListItem } from "@astryxdesign/core/List";
import { Selector } from "@astryxdesign/core/Selector";
import { Stack as AstryxStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Text as AstryxText, Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
// Memory settings panel: entry list/filters, quota display, create/edit/
// accept/delete/wipe, plus mounting the settings drawer (which owns the
// organizer history modal).
//
// Shared by every frontend runtime. Platform differences belong in the
// runtime boundary, never in this panel.

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
  quotaStatusLabelKey,
  selectedTitle,
  strongestQuotaLevel,
} from "./panelModel";
import { ArrowLeft, buildModelOptions, Folder, Plus, Settings2 } from "./platform";
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
    if (!selected && !showCreate) {
      setCompactDetailOpen(false);
    }
  }, [selected, showCreate]);

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

  function renderEntryButton(entry: MemoryMeta) {
    const active = activeEntryKey === entryKey(entry);
    return (
      <ListItem
        key={entryKey(entry)}
        label={entryTitle(entry)}
        description={`id: ${entry.slug}`}
        startContent={
          entry.unreviewed ? (
            <StatusDot variant="warning" label={t("settings.memoryUnreviewed")} />
          ) : undefined
        }
        endContent={
          <Text type="supporting" color="secondary">
            {memoryTypeLabel(entry.memoryType, t)}
          </Text>
        }
        isSelected={active}
        onClick={() => {
          openEntry(entry);
          setCompactDetailOpen(true);
        }}
      />
    );
  }

  function renderFlatEntries(items: MemoryMeta[], emptyKey: string) {
    if (items.length === 0) {
      return <EmptyState title={t(emptyKey)} isCompact />;
    }
    return (
      <AstryxList density="balanced" hasDividers>
        {items.map((entry) => renderEntryButton(entry))}
      </AstryxList>
    );
  }

  if (settingsDrawerOpen) {
    return (
      <SettingsModalShell
        onClose={() => setSettingsDrawerOpen(false)}
        ariaLabel={t("settings.memoryOpenSettings")}
      >
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
      </SettingsModalShell>
    );
  }

  return (
    <>
      <AstryxStack
        direction="vertical"
        paddingBlockStart={4}
        paddingBlockEnd={4}
        className="settings-memory-panel flex min-h-0 flex-1 flex-col gap-5"
      >
        <AstryxStack
          direction="vertical"
          className={`settings-memory-overview shrink-0 space-y-4 ${
            compactDetailOpen ? "settings-memory-compact-hidden" : ""
          }`}
        >
          <HStack width="100%" gap={3} vAlign="center" hAlign="between" wrap="wrap">
            <Text type="supporting" color="secondary">
              {t("settings.mobile.memoryDescription")}
            </Text>
            <HStack gap={1} vAlign="center">
              <AstryxNativeButton
                label={t("settings.memoryRefresh")}
                variant="ghost"
                size="sm"
                isLoading={loading}
                isDisabled={loading}
                onClick={() => void reload()}
              />
              <IconButton
                label={t("settings.memoryOpenSettings")}
                tooltip={t("settings.memoryOpenSettings")}
                variant="ghost"
                size="sm"
                icon={<Settings2 />}
                onClick={() => setSettingsDrawerOpen(true)}
              />
            </HStack>
          </HStack>

          <AstryxList
            density="compact"
            hasDividers
            header={
              <Text type="supporting" color="secondary" maxLines={1}>
                {pathsInfo?.root ?? "~/.xgent/memory"}
              </Text>
            }
          >
            {quotaItems.map((item) => {
              const level = quotaLevel(item);
              const label =
                item.scope === "global"
                  ? t("settings.memoryQuotaGlobal")
                  : t("settings.memoryQuotaProject");
              return (
                <ListItem
                  key={`${item.scope}:${item.workdirHash}`}
                  label={label}
                  description={`${item.used} / ${item.limit}`}
                  startContent={
                    <StatusDot
                      variant={
                        level === "healthy" ? "success" : level === "warning" ? "warning" : "error"
                      }
                      label={t(quotaStatusLabelKey(level))}
                    />
                  }
                  endContent={
                    <Text type="supporting" color="secondary">
                      {t(quotaStatusLabelKey(level))}
                    </Text>
                  }
                />
              );
            })}
          </AstryxList>

          {unreviewedCount > 0 ? (
            <Banner
              status="warning"
              title={`${unreviewedCount} ${t("settings.memoryAwaitingReview")}`}
              collapsible={false}
            />
          ) : null}
          {pathsInfo?.isInCloud ? (
            <Banner
              status="warning"
              title={t("settings.memoryCloudWarningPrefix")}
              description={pathsInfo.cloudProvider ?? t("settings.memoryCloudSyncFolder")}
              collapsible={false}
            />
          ) : null}
          {quotaStatus === "full" || quotaStatus === "danger" ? (
            <Banner
              status="error"
              title={t(
                quotaStatus === "full"
                  ? "settings.memoryQuotaFullMessage"
                  : "settings.memoryQuotaNearLimitMessage",
              )}
              collapsible={false}
            />
          ) : quotaStatus === "warning" ? (
            <Banner
              status="warning"
              title={t("settings.memoryQuotaWarningMessage")}
              collapsible={false}
            />
          ) : null}
          {error ? <Banner status="error" title={error} collapsible={false} /> : null}
        </AstryxStack>

        <AstryxGrid className="settings-memory-layout flex min-h-0 flex-1 overflow-hidden">
          <AstryxStack
            direction="vertical"
            as="section"
            className={`settings-memory-list-section flex min-h-0 min-w-0 flex-col ${
              compactDetailOpen ? "settings-memory-compact-hidden" : ""
            }`}
          >
            <AstryxStack
              direction="vertical"
              className="shrink-0 space-y-3 border-b border-border/40 p-3"
            >
              <TabList
                value={tab}
                onChange={(value) => setTab(value as MemoryTab)}
                size="sm"
                overflow="scroll"
              >
                <Tab
                  value="global"
                  label={`${t("settings.memoryCategoryGlobal")} (${globalEntryCount})`}
                  panelId="memory-entry-panel"
                />
                <Tab
                  value="project"
                  label={`${t("settings.memoryCategoryProject")} (${projectEntryCount})`}
                  panelId="memory-entry-panel"
                />
                <Tab
                  value="journal"
                  label={`${t("settings.memoryCategoryJournal")} (${dailyEntryCount})`}
                  panelId="memory-entry-panel"
                />
              </TabList>
              <HStack width="100%" gap={2} vAlign="center">
                <TextInput
                  label={t("settings.memorySearchPlaceholder")}
                  isLabelHidden
                  value={filter}
                  onChange={setFilter}
                  placeholder={t("settings.memorySearchPlaceholder")}
                  startIcon="search"
                  hasClear
                  width="100%"
                />
                <IconButton
                  label={t("settings.memoryNew")}
                  tooltip={t("settings.memoryNew")}
                  variant="secondary"
                  size="sm"
                  icon={<Plus />}
                  onClick={() => {
                    setShowCreate(true);
                    setCompactDetailOpen(true);
                  }}
                />
              </HStack>
            </AstryxStack>

            <AstryxStack
              direction="vertical"
              className="settings-memory-entry-list min-h-0 flex-1 overflow-auto p-2"
            >
              {tab === "global" ? (
                renderFlatEntries(globalEntries, "settings.memoryNoGlobalEntries")
              ) : tab === "journal" ? (
                renderFlatEntries(dailyEntries, "settings.memoryNoJournalEntries")
              ) : projectGroups.length === 0 ? (
                <EmptyState title={t("settings.memoryNoProjectEntries")} isCompact />
              ) : (
                <AstryxStack direction="vertical" className="space-y-2">
                  {projectGroups.map((group) => (
                    <Collapsible
                      key={group.key}
                      defaultIsOpen
                      trigger={
                        <HStack width="100%" gap={2} vAlign="center">
                          <Folder />
                          <Text maxLines={1}>{group.label}</Text>
                          <Badge label={group.entries.length} variant="neutral" />
                        </HStack>
                      }
                    >
                      <AstryxList density="compact" hasDividers>
                        {group.entries.map((entry) => renderEntryButton(entry))}
                      </AstryxList>
                    </Collapsible>
                  ))}
                </AstryxStack>
              )}
            </AstryxStack>
          </AstryxStack>

          <AstryxStack
            direction="vertical"
            as="section"
            className={`settings-memory-detail-section flex min-h-0 min-w-0 flex-col ${
              !compactDetailOpen ? "settings-memory-compact-hidden" : ""
            }`}
          >
            <HStack
              width="100%"
              gap={2}
              vAlign="center"
              className="settings-memory-compact-toolbar"
              padding={2}
            >
              <IconButton
                label={t("settings.memoryTitle")}
                tooltip={t("settings.memoryTitle")}
                variant="ghost"
                size="sm"
                icon={<ArrowLeft />}
                onClick={() => {
                  setCompactDetailOpen(false);
                  setShowCreate(false);
                }}
              />
              <Text>
                {showCreate
                  ? t("settings.memoryNew")
                  : selected
                    ? selectedTitle(selected)
                    : t("settings.memoryTitle")}
              </Text>
            </HStack>
            {showCreate ? (
              <AstryxStack direction="vertical" className="shrink-0 border-b border-border/40 p-4">
                <AstryxStack direction="vertical" className="mb-3 text-sm font-semibold">
                  {t("settings.memoryNew")}
                </AstryxStack>
                <AstryxGrid className="grid gap-3 md:grid-cols-2">
                  <TextInput
                    label={t("settings.memorySlugPlaceholder")}
                    value={draft.slug}
                    onChange={(value) => setDraft((prev) => ({ ...prev, slug: value }))}
                    placeholder={t("settings.memorySlugPlaceholder")}
                    width="100%"
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
                  <TextInput
                    label={t("settings.memoryDescriptionPlaceholder")}
                    value={draft.description}
                    onChange={(value) => setDraft((prev) => ({ ...prev, description: value }))}
                    placeholder={t("settings.memoryDescriptionPlaceholder")}
                    width="100%"
                  />
                </AstryxGrid>
                <TextArea
                  label={t("settings.memoryBodyPlaceholder")}
                  value={draft.body}
                  onChange={(value) => setDraft((prev) => ({ ...prev, body: value }))}
                  placeholder={t("settings.memoryBodyPlaceholder")}
                  rows={6}
                  width="100%"
                />
                <AstryxStack direction="horizontal" className="mt-3 flex justify-end gap-2">
                  <AstryxNativeButton
                    label={t("settings.memoryCancel")}
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowCreate(false)}
                  />
                  <AstryxNativeButton
                    label={t("settings.memorySave")}
                    variant="primary"
                    size="sm"
                    onClick={() => void handleCreateEntry()}
                    isLoading={saving}
                    isDisabled={saving}
                  />
                </AstryxStack>
              </AstryxStack>
            ) : null}

            {selected ? (
              <>
                <AstryxStack
                  direction="vertical"
                  className="shrink-0 border-b border-border/40 p-4"
                >
                  <AstryxStack
                    direction="horizontal"
                    className="flex flex-wrap items-start justify-between gap-3"
                  >
                    <AstryxStack direction="vertical" className="min-w-0">
                      <AstryxStack
                        direction="horizontal"
                        className="flex flex-wrap items-center gap-2"
                      >
                        <AstryxStack
                          direction="vertical"
                          className="truncate text-sm font-semibold"
                        >
                          {selectedTitle(selected)}
                        </AstryxStack>
                        <AstryxText
                          as="span"
                          type="inherit"
                          className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {memoryScopeLabel(selected.scope, t)}
                        </AstryxText>
                        <AstryxText
                          as="span"
                          type="inherit"
                          className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {memoryTypeLabel(selected.memoryType, t)}
                        </AstryxText>
                        {selected.meta.unreviewed ? (
                          <AstryxText
                            as="span"
                            type="inherit"
                            className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300"
                          >
                            {t("settings.memoryUnreviewed")}
                          </AstryxText>
                        ) : null}
                      </AstryxStack>
                      <AstryxStack
                        direction="vertical"
                        className="mt-1 text-xs text-muted-foreground"
                      >
                        {t("settings.memoryUpdated")} {formatTime(selected.meta.updatedAt)}
                      </AstryxStack>
                      <AstryxStack
                        direction="vertical"
                        className="mt-1 truncate font-mono text-[11px] text-muted-foreground/70"
                      >
                        id: {selected.slug}
                      </AstryxStack>
                      {selectedEntry?.scope === "project" ? (
                        <AstryxStack
                          direction="vertical"
                          className="mt-1 truncate font-mono text-[11px] text-muted-foreground/70"
                        >
                          {selectedEntry.workdirPath || selectedEntry.workdirHash}
                        </AstryxStack>
                      ) : null}
                    </AstryxStack>
                    <AstryxStack direction="horizontal" className="flex items-center gap-2">
                      {selected.meta.unreviewed && selected.memoryType !== "daily" ? (
                        <AstryxNativeButton
                          label={t("settings.memoryAccept")}
                          variant="secondary"
                          size="sm"
                          onClick={() => void acceptSelected()}
                          isDisabled={saving}
                        />
                      ) : null}
                      <AstryxNativeButton
                        label={t("settings.memoryDelete")}
                        variant="secondary"
                        size="sm"
                        onClick={() => void deleteSelected()}
                        isDisabled={saving}
                      />
                    </AstryxStack>
                  </AstryxStack>
                </AstryxStack>

                <AstryxStack
                  direction="vertical"
                  className="settings-memory-detail-body min-h-0 flex-1 overflow-auto p-4"
                >
                  {selected.memoryType === "daily" ? (
                    <AstryxStack direction="vertical" className="space-y-3">
                      <TextArea
                        label={t("settings.memoryAppendBlockPlaceholder")}
                        value={editDraft.appendBody}
                        onChange={(value) =>
                          setEditDraft((prev) => ({ ...prev, appendBody: value }))
                        }
                        placeholder={t("settings.memoryAppendBlockPlaceholder")}
                        rows={5}
                        width="100%"
                      />
                      <AstryxStack
                        direction="vertical"
                        className="rounded-lg border border-border/50 bg-muted/20 p-3"
                      >
                        <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">
                          {selected.body || t("settings.memoryEmptyBody")}
                        </pre>
                      </AstryxStack>
                    </AstryxStack>
                  ) : (
                    <AstryxStack direction="vertical" className="space-y-3">
                      <TextInput
                        label={t("settings.memoryDescriptionPlaceholder")}
                        value={editDraft.description}
                        onChange={(value) =>
                          setEditDraft((prev) => ({ ...prev, description: value }))
                        }
                        placeholder={t("settings.memoryDescriptionPlaceholder")}
                        width="100%"
                      />
                      <TextArea
                        label={t("settings.memoryBodyPlaceholder")}
                        value={editDraft.body}
                        onChange={(value) => setEditDraft((prev) => ({ ...prev, body: value }))}
                        rows={16}
                        width="100%"
                      />
                    </AstryxStack>
                  )}
                </AstryxStack>

                <AstryxStack
                  direction="vertical"
                  className="shrink-0 border-t border-border/40 p-4"
                >
                  <AstryxStack direction="horizontal" className="flex justify-between gap-3">
                    <AstryxStack direction="horizontal" className="flex items-center gap-2">
                      <AstryxNativeButton
                        label={t("settings.memoryWipeAll")}
                        variant="secondary"
                        size="sm"
                        onClick={() => setWipeConfirmOpen(true)}
                        isDisabled={saving}
                      />
                    </AstryxStack>
                    <AstryxNativeButton
                      label={t("settings.memorySave")}
                      variant="primary"
                      size="sm"
                      onClick={() => void saveSelected()}
                      isLoading={saving}
                      isDisabled={saving}
                    />
                  </AstryxStack>
                </AstryxStack>
              </>
            ) : (
              <AstryxStack
                direction="horizontal"
                className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground"
              >
                {t("settings.memorySelectEntry")}
              </AstryxStack>
            )}
          </AstryxStack>
        </AstryxGrid>
      </AstryxStack>

      <AlertDialog
        isOpen={wipeConfirmOpen}
        onOpenChange={setWipeConfirmOpen}
        title={t("settings.memoryWipeConfirmTitle")}
        description={t("settings.memoryWipeConfirmDescription")}
        actionLabel={t("settings.memoryWipeAll")}
        cancelLabel={t("settings.memoryCancel")}
        actionVariant="destructive"
        isActionLoading={saving}
        onAction={handleWipeAll}
      />
    </>
  );
}
