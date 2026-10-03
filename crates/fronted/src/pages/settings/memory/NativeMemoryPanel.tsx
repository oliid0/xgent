import { useCallback, useEffect, useRef, useState } from "react";
import type { MemoryMeta } from "../../../lib/memory/api";
import { MEMORY_TYPES } from "../../../lib/memory/schema";
import { isNativeMobileRuntime } from "../../../lib/runtimePlatform";
import type { AppSettings } from "../../../lib/settings";
import { presentationControls } from "../../../presentation/controls";
import { NativeSurface } from "../../../presentation/NativeSurface";
import { createNativePresentationTheme } from "../../../presentation/nativeTheme";
import type { PresentationNode } from "../../../presentation/types";
import {
  entryKey,
  entryTitle,
  fallbackScopeQuotas,
  formatTime,
  matchesFilter,
  memoryProjectGroups,
  memoryScopeLabel,
  memoryTypeLabel,
  quotaLevel,
  quotaStatusLabelKey,
  selectedTitle,
  strongestQuotaLevel,
} from "./panelModel";
import type { MemoryCreateDraft, useMemoryPanelData } from "./useMemoryPanelData";

type Props = {
  data: ReturnType<typeof useMemoryPanelData>;
  settings: AppSettings;
  workdir?: string;
  t: (key: string) => string;
  onBack?: () => void;
  onSettings: () => void;
  nativeSettingsSurfaceId?: string;
};

/** Only presentation differs: every read and mutation belongs to the shared panel hook. */
export function NativeMemoryPanel(props: Props) {
  const { data, settings, t, workdir } = props;
  const [tab, setTab] = useState("global");
  const [filter, setFilter] = useState("");
  const [screen, setScreen] = useState<"list" | "detail" | "create">("list");
  const [confirmation, setConfirmation] = useState<"delete" | "wipe" | null>(null);
  const navigation = useRef({ active: true, revision: 0 }).current;
  useEffect(() => {
    navigation.active = true;
    return () => {
      navigation.active = false;
      navigation.revision += 1;
    };
  }, [navigation, workdir]);
  const [draft, setDraftState] = useState<MemoryCreateDraft>({
    slug: "",
    scope: "global",
    memoryType: "user",
    description: "",
    body: "",
  });
  const draftRef = useRef(draft);
  const setDraft = useCallback(
    (update: MemoryCreateDraft | ((current: MemoryCreateDraft) => MemoryCreateDraft)) => {
      const next = typeof update === "function" ? update(draftRef.current) : update;
      draftRef.current = next;
      setDraftState(next);
    },
    [],
  );
  const c = presentationControls();
  const busy = data.loading || data.saving;
  const nodes: PresentationNode[] = [];
  const text = (id: string, value: string): PresentationNode => ({
    id,
    kind: "Text",
    text: value,
    secondary: true,
  });
  const area = (
    id: string,
    label: string,
    value: string,
    run: (value: string) => void,
  ): PresentationNode => ({
    ...c.input(id, label, value, run, false, !busy),
    kind: "TextArea",
    language: "markdown",
  });
  const back = () => {
    navigation.revision += 1;
    if (confirmation) setConfirmation(null);
    else if (screen !== "list") setScreen("list");
    else props.onBack?.();
  };
  nodes.push(c.action("back", t("settings.memorySettingsClose"), back, !busy));
  if (data.error)
    nodes.push({ id: "memory-error", kind: "Banner", label: data.error, status: "error" });
  if (data.notice)
    nodes.push({ id: "memory-notice", kind: "Banner", label: data.notice, status: "completed" });
  if (busy)
    nodes.push({
      id: "memory-progress",
      kind: "Progress",
      label: t(data.saving ? "settings.memorySave" : "settings.memoryRefresh"),
    });

  if (confirmation) {
    nodes.push(
      c.group(
        "memory-confirm",
        t(confirmation === "wipe" ? "settings.memoryWipeConfirmTitle" : "settings.memoryDelete"),
        [
          text(
            "memory-confirm-description",
            confirmation === "wipe"
              ? t("settings.memoryWipeConfirmDescription")
              : (data.selected?.slug ?? ""),
          ),
          {
            ...c.action(
              "memory-confirm-action",
              t(confirmation === "wipe" ? "settings.memoryWipeAll" : "settings.memoryDelete"),
              async () => {
                const revision = navigation.revision;
                const completed =
                  confirmation === "wipe" ? await data.wipeAll() : await data.deleteSelected();
                if (completed && navigation.active && navigation.revision === revision) {
                  setConfirmation(null);
                  setScreen("list");
                }
              },
              !busy,
            ),
            destructive: true,
          },
          c.action(
            "memory-confirm-cancel",
            t("settings.memoryCancel"),
            () => setConfirmation(null),
            !busy,
          ),
        ],
      ),
    );
  } else if (screen === "create") {
    nodes.push(
      c.group("memory-create-form", t("settings.memoryNew"), [
        c.input(
          "memory-slug",
          t("settings.memorySlugPlaceholder"),
          draft.slug,
          (slug) => setDraft((prev) => ({ ...prev, slug })),
          false,
          !busy,
        ),
        c.select(
          "memory-create-scope",
          t("settings.memoryScopeGlobal"),
          draft.scope,
          [
            { value: "global", label: t("settings.memoryScopeGlobal") },
            ...(workdir ? [{ value: "project", label: t("settings.memoryScopeProject") }] : []),
          ],
          (scope) => setDraft((prev) => ({ ...prev, scope: scope as MemoryCreateDraft["scope"] })),
          !busy,
        ),
        c.select(
          "memory-create-type",
          t("settings.memoryNew"),
          draft.memoryType,
          MEMORY_TYPES.map((value) => ({ value, label: memoryTypeLabel(value, t) })),
          (memoryType) =>
            setDraft((prev) => ({
              ...prev,
              memoryType: memoryType as MemoryCreateDraft["memoryType"],
            })),
          !busy,
        ),
        c.input(
          "memory-description",
          t("settings.memoryDescriptionPlaceholder"),
          draft.description,
          (description) => setDraft((prev) => ({ ...prev, description })),
          false,
          !busy,
        ),
        area("memory-body", t("settings.memoryBodyPlaceholder"), draft.body, (body) =>
          setDraft((prev) => ({ ...prev, body })),
        ),
        c.action(
          "memory-create-save",
          t("settings.memorySave"),
          async () => {
            const submittedDraft = draftRef.current;
            const revision = navigation.revision;
            if (
              (await data.createEntry(submittedDraft)) &&
              navigation.active &&
              navigation.revision === revision &&
              draftRef.current === submittedDraft
            ) {
              setDraft({
                slug: "",
                scope: "global",
                memoryType: "user",
                description: "",
                body: "",
              });
              setScreen("detail");
            }
          },
          !busy && !!draft.slug.trim() && !!draft.body.trim(),
        ),
      ]),
    );
  } else if (screen === "detail" && data.selected) {
    const selected = data.selected;
    nodes.push(
      c.group("memory-detail", selectedTitle(selected), [
        text(
          "memory-meta",
          `${selected.slug} · ${memoryScopeLabel(selected.scope, t)} · ${memoryTypeLabel(selected.memoryType, t)} · ${formatTime(selected.meta.updatedAt)}`,
        ),
        ...(selected.memoryType === "daily"
          ? [
              area(
                "memory-append",
                t("settings.memoryAppendBlockPlaceholder"),
                data.editDraft.appendBody,
                (appendBody) => data.setEditDraft((prev) => ({ ...prev, appendBody })),
              ),
              {
                id: "memory-journal",
                kind: "Markdown" as const,
                text: selected.body || t("settings.memoryEmptyBody"),
              },
            ]
          : [
              c.input(
                "memory-edit-description",
                t("settings.memoryDescriptionPlaceholder"),
                data.editDraft.description,
                (description) => data.setEditDraft((prev) => ({ ...prev, description })),
                false,
                !busy,
              ),
              area(
                "memory-edit-body",
                t("settings.memoryBodyPlaceholder"),
                data.editDraft.body,
                (body) => data.setEditDraft((prev) => ({ ...prev, body })),
              ),
            ]),
        c.action(
          "memory-save",
          t("settings.memorySave"),
          data.saveSelected,
          !busy && (selected.memoryType !== "daily" || !!data.editDraft.appendBody.trim()),
        ),
        ...(selected.meta.unreviewed && selected.memoryType !== "daily"
          ? [c.action("memory-accept", t("settings.memoryAccept"), data.acceptSelected, !busy)]
          : []),
        {
          ...c.action(
            "memory-delete",
            t("settings.memoryDelete"),
            () => setConfirmation("delete"),
            !busy,
          ),
          destructive: true,
        },
      ]),
    );
  } else {
    nodes.push(
      c.action("memory-refresh", t("settings.memoryRefresh"), () => data.reload(), !busy),
      c.action("memory-settings", t("settings.memoryOpenSettings"), props.onSettings, !busy),
    );
    if (data.pathsInfo?.root) nodes.push(text("memory-root", data.pathsInfo.root));
    if (data.pathsInfo?.isInCloud)
      nodes.push({
        id: "memory-cloud-warning",
        kind: "Banner",
        label: `${t("settings.memoryCloudWarningPrefix")} ${data.pathsInfo.cloudProvider ?? t("settings.memoryCloudSyncFolder")}`,
        status: "error",
      });
    const quotas = fallbackScopeQuotas(data.entries, data.quota, !!workdir);
    const quotaStatus = strongestQuotaLevel(quotas);
    const unreviewedCount = data.entries.filter((entry) => entry.unreviewed).length;
    if (unreviewedCount)
      nodes.push({
        id: "memory-review-warning",
        kind: "Banner",
        label: `${unreviewedCount} ${t("settings.memoryAwaitingReview")}`,
        status: "pending",
      });
    if (quotaStatus !== "healthy")
      nodes.push({
        id: "memory-quota-warning",
        kind: "Banner",
        label: t(
          quotaStatus === "full"
            ? "settings.memoryQuotaFullMessage"
            : quotaStatus === "danger"
              ? "settings.memoryQuotaNearLimitMessage"
              : "settings.memoryQuotaWarningMessage",
        ),
        status: quotaStatus === "warning" ? "pending" : "error",
      });
    nodes.push(
      c.group(
        "memory-quota",
        t("settings.memoryQuotaGlobal"),
        quotas.map((item, index) =>
          text(
            `memory-quota:${index}`,
            `${memoryScopeLabel(item.scope, t)} · ${item.used} / ${item.limit} · ${t(quotaStatusLabelKey(quotaLevel(item)))}`,
          ),
        ),
      ),
    );
    const categoryCount = (category: string) =>
      data.entries.filter((entry) =>
        category === "journal"
          ? entry.memoryType === "daily"
          : entry.memoryType !== "daily" && entry.scope === category,
      ).length;
    nodes.push(
      c.select(
        "memory-category",
        t("settings.navMemory"),
        tab,
        [
          {
            value: "global",
            label: `${t("settings.memoryCategoryGlobal")} (${categoryCount("global")})`,
          },
          {
            value: "project",
            label: `${t("settings.memoryCategoryProject")} (${categoryCount("project")})`,
          },
          {
            value: "journal",
            label: `${t("settings.memoryCategoryJournal")} (${categoryCount("journal")})`,
          },
        ],
        setTab,
        !busy,
      ),
      c.input("memory-filter", t("settings.memorySearchPlaceholder"), filter, setFilter),
    );
    const entries = data.entries.filter(
      (entry) =>
        matchesFilter(entry, filter) &&
        (tab === "journal"
          ? entry.memoryType === "daily"
          : entry.memoryType !== "daily" && entry.scope === tab),
    );
    const renderEntry = (entry: MemoryMeta): PresentationNode => ({
      ...c.action(
        `memory-open:${entryKey(entry)}`,
        entryTitle(entry),
        async () => {
          const revision = ++navigation.revision;
          const opened = await data.openEntry(entry);
          if (opened && navigation.active && navigation.revision === revision) setScreen("detail");
        },
        !busy,
      ),
      kind: "NavigationRow",
      variant: "memory-entry",
      text: `${memoryTypeLabel(entry.memoryType, t)} · ${formatTime(entry.updatedAt)}`,
      children: entry.unreviewed
        ? [
            {
              id: `memory-review:${entryKey(entry)}`,
              kind: "Badge",
              label: t("settings.memoryAwaitingReview"),
              status: "pending",
            },
          ]
        : [],
    });
    const items: PresentationNode[] =
      tab === "project"
        ? memoryProjectGroups(data.entries, filter, t).map((group) => ({
            id: `memory-project:${group.key}`,
            kind: "Collapsible",
            variant: "memory-project",
            label: `${group.label} (${group.entries.length})`,
            children: group.entries.map(renderEntry),
          }))
        : entries.map(renderEntry);
    nodes.push(...items);
    if (!items.length && !data.loading)
      nodes.push({
        id: "memory-empty",
        kind: "EmptyState",
        label: t(
          tab === "journal"
            ? "settings.memoryNoJournalEntries"
            : tab === "project"
              ? "settings.memoryNoProjectEntries"
              : "settings.memoryNoGlobalEntries",
        ),
        icon: "brain",
      });
    nodes.push(
      c.action(
        "memory-create",
        t("settings.memoryNew"),
        () => {
          navigation.revision += 1;
          setScreen("create");
        },
        !busy,
      ),
      {
        ...c.action(
          "memory-wipe",
          t("settings.memoryWipeAll"),
          () => setConfirmation("wipe"),
          !busy,
        ),
        destructive: true,
      },
    );
  }
  return (
    <NativeSurface
      sessionSurface={props.nativeSettingsSurfaceId}
      document={{
        mode: "sheet",
        title: t("settings.navMemory"),
        appearance: settings.theme,
        formFactor: isNativeMobileRuntime() ? "mobile" : "desktop",
        theme: createNativePresentationTheme(settings, isNativeMobileRuntime()),
        nodes,
        dismissAction: "back",
      }}
      handlers={c.handlers}
      onError={(error) => console.error("Native memory presentation failed", error)}
    />
  );
}
