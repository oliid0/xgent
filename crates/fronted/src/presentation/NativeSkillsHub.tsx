import { openUrl } from "@xgent/runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { useConfirmDialog } from "../components/astryx/useConfirmDialog";
import { useLocale } from "../i18n";
import { isNativeMobileRuntime } from "../lib/runtimePlatform";
import type { AppSettings } from "../lib/settings";
import type { ExternalToolScan, SkillInstallJobSnapshot, SkillSummary } from "../lib/skills";
import {
  type ClawHubSkillCard,
  type ClawHubSkillDetail,
  type ClawHubSort,
  getClawHubSkillDetail,
  resolveClawHubSkillOwner,
} from "../lib/skills/clawHub";
import {
  CLAWHUB_CATEGORY_SLUGS,
  type ClawHubCategorySlug,
  classifyClawHubSkill,
} from "../lib/skills/clawHubCategories";
import type { InstalledSkillSort } from "../lib/skills/installedSort";
import { writeClipboardText } from "../lib/system/clipboardText";
import type { InstalledSkillPreviewState } from "../pages/skills-hub/SkillsHubPage";
import { presentationControls } from "./controls";
import { NativeSurface } from "./NativeSurface";
import { nativeSkillImport } from "./nativeSkillImport";
import { nativeSkillCategoryLabel, nativeSkillInstalled } from "./nativeSkillInstalled";
import { nativeSkillPreview } from "./nativeSkillPreview";
import {
  nativeSkillInstallState,
  nativeSkillStoreCard,
  nativeSkillStorePreview,
} from "./nativeSkillStore";
import { createNativePresentationTheme } from "./nativeTheme";
import type { PresentationNode } from "./types";

type Category = "all" | ClawHubCategorySlug;
export type NativeSkillsHubProps = {
  settings: AppSettings;
  rootDir: string;
  mode?: "root" | "sheet";
  surfaceId?: string;
  view: "installed" | "store" | "import";
  onView: (view: "installed" | "store" | "import") => void;
  onOpenSidebar: () => void;
  onClose?: () => void;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<unknown>;
  onEnabled: (enabled: boolean) => void;
  installed: {
    items: { skill: SkillSummary; categories: ClawHubCategorySlug[] }[];
    total: number;
    selectedCount: number;
    selected: ReadonlySet<string>;
    query: string;
    onQuery: (query: string) => void;
    category: Category;
    categoryCounts: ReadonlyMap<Category, number>;
    onCategory: (category: Category) => void;
    sort: InstalledSkillSort;
    onSort: (sort: InstalledSkillSort) => void;
    onToggle: (name: string, enabled: boolean) => void;
    onOpen: (skill: SkillSummary) => void;
    onDelete: (skill: SkillSummary) => Promise<void>;
    deleting: string | null;
  };
  bulk: {
    enabled: boolean;
    selection: ReadonlySet<string>;
    onMode: () => void;
    onToggle: (name: string) => void;
    onAll: () => void;
    onClear: () => void;
    onEnter: (name: string) => void;
    enableCount: number;
    disableCount: number;
    onEnable: (enabled: boolean) => void;
    deleteNames: string[];
    deletePreview: string;
    onDelete: () => Promise<void>;
    undo: { count: number } | null;
    onUndo: () => void;
  };
  preview: { skill: SkillSummary | null; state: InstalledSkillPreviewState; onClose: () => void };
  store: {
    items: ClawHubSkillCard[];
    query: string;
    onQuery: (query: string) => void;
    sort: ClawHubSort;
    onSort: (sort: ClawHubSort) => void;
    loading: boolean;
    loadingMore: boolean;
    error: string | null;
    cursor: string | null;
    installedKeys: ReadonlySet<string>;
    installedSlugs: ReadonlySet<string>;
    pendingKeys: ReadonlySet<string>;
    jobsByKey: Record<string, string>;
    jobs: Record<string, SkillInstallJobSnapshot>;
    onInstall: (skill: ClawHubSkillCard) => Promise<void>;
    onLoadMore: () => Promise<void>;
  };
  import: {
    scans: ExternalToolScan[];
    loading: boolean;
    error: string | null;
    query: string;
    onQuery: (query: string) => void;
    selected: ReadonlySet<string>;
    installedNames: ReadonlySet<string>;
    progress: { done: number; total: number } | null;
    errors: { baseDir: string; name: string; message: string }[];
    importedCount: number | null;
    localImporting: boolean;
    toast: string | null;
    dismissToast: () => void;
    toggle: (path: string) => void;
    batchToggle: (paths: string[], selected: boolean) => void;
    rescan: () => Promise<void>;
    import: () => Promise<void>;
    importLocal: (files: File[]) => Promise<void>;
  };
};

/** Business state/actions come from the existing Astryx desktop controller. */
export function NativeSkillsHub(props: NativeSkillsHubProps) {
  const { t } = useLocale();
  const compact = isNativeMobileRuntime();
  const { confirm, dialog } = useConfirmDialog();
  const [storeCategory, setStoreCategory] = useState<Category>("all");
  const [storePreview, setStorePreview] = useState<ClawHubSkillCard | null>(null);
  const [detail, setDetail] = useState<ClawHubSkillDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [importTool, setImportTool] = useState("");
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  const lifetime = useRef(0);
  const previewLease = useRef({
    active: true,
    skill: props.preview.skill,
    root: props.rootDir,
    view: props.view,
  });
  previewLease.current.skill = props.preview.skill;
  previewLease.current.root = props.rootDir;
  previewLease.current.view = props.view;
  const copyRevision = useRef(0);
  const requestedCategoryPage = useRef("");
  const categorizedStore = useMemo(
    () => props.store.items.map((skill) => ({ skill, categories: classifyClawHubSkill(skill) })),
    [props.store.items],
  );
  const visibleStore = categorizedStore.filter(
    ({ categories }) => storeCategory === "all" || categories.includes(storeCategory),
  );
  const storeCounts = new Map<Category, number>([["all", categorizedStore.length]]);
  for (const { categories } of categorizedStore)
    for (const category of categories)
      storeCounts.set(category, (storeCounts.get(category) ?? 0) + 1);
  useEffect(() => {
    lifetime.current += 1;
    previewLease.current.active = true;
    return () => {
      lifetime.current += 1;
      previewLease.current.active = false;
    };
  }, []);
  useEffect(() => {
    const store = props.store;
    if (
      props.view !== "store" ||
      storeCategory === "all" ||
      store.query.trim() ||
      !store.cursor ||
      store.loading ||
      store.loadingMore ||
      store.error ||
      visibleStore.length >= 12
    )
      return;
    const key = `${store.sort}\0${storeCategory}\0${store.cursor}`;
    if (requestedCategoryPage.current === key) return;
    requestedCategoryPage.current = key;
    void store.onLoadMore();
  }, [props.store, props.view, storeCategory, visibleStore.length]);
  useEffect(() => {
    setStorePreview(null);
    setError("");
  }, [props.view]);
  useEffect(() => {
    copyRevision.current += 1;
    setCopied("");
  }, [props.preview.skill]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(""), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  useEffect(() => {
    if (!storePreview) {
      setDetail(null);
      setDetailLoading(false);
      setDetailError(null);
      return;
    }
    let active = true;
    setDetail(null);
    setDetailLoading(true);
    setDetailError(null);
    void resolveClawHubSkillOwner(storePreview)
      .then(async (resolved) => {
        if (!active) return;
        const result = await getClawHubSkillDetail(resolved.slug, resolved.ownerHandle);
        if (active) setDetail(result);
      })
      .catch((cause) => {
        if (active) setDetailError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [storePreview]);
  const activeTool = props.import.scans.some((scan) => scan.tool === importTool)
    ? importTool
    : ((
        props.import.scans.find((scan) => scan.skills.length > 0) ??
        props.import.scans.find((scan) => scan.exists) ??
        props.import.scans[0]
      )?.tool ?? "");
  const c = presentationControls();
  const closePreview = () => {
    props.preview.onClose();
    setStorePreview(null);
  };
  const close =
    props.preview.skill || storePreview ? closePreview : (props.onClose ?? props.onOpenSidebar);
  c.handlers.set("close", { enabled: true, accepts: (value) => value === null, run: close });
  const remove = async (skill: SkillSummary, current: () => boolean = () => true) => {
    if (
      (await confirm({
        title: t("settings.deleteConfirm"),
        description: skill.name,
        confirmLabel: t("settings.delete"),
        cancelLabel: t("settings.cancel"),
        tone: "destructive",
      })) &&
      current()
    )
      await props.installed.onDelete(skill);
  };
  const removeBulk = async () => {
    if (
      await confirm({
        title: t("settings.deleteConfirm"),
        description:
          t("settings.skillsHubBulkDeleteConfirm").replace(
            "{count}",
            String(props.bulk.deleteNames.length),
          ) +
          " " +
          props.bulk.deletePreview,
        confirmLabel: t("settings.delete"),
        cancelLabel: t("settings.cancel"),
        tone: "destructive",
      })
    )
      await props.bulk.onDelete();
  };
  const categoryOptions = (counts?: ReadonlyMap<Category, number>) =>
    ["all", ...CLAWHUB_CATEGORY_SLUGS].map((value) => ({
      value,
      label: `${t(nativeSkillCategoryLabel(value))}${counts ? ` (${counts.get(value as Category) ?? 0})` : ""}`,
    }));
  const query =
    props.view === "installed"
      ? props.installed.query
      : props.view === "store"
        ? props.store.query
        : props.import.query;
  const setQuery =
    props.view === "installed"
      ? props.installed.onQuery
      : props.view === "store"
        ? props.store.onQuery
        : props.import.onQuery;
  const controls: PresentationNode[] = [
    c.input("skill-search", t("settings.searchPlaceholder"), query, setQuery),
  ];
  let rows: PresentationNode[];
  if (props.view === "installed") {
    controls.push(
      c.select(
        "skill-installed-sort",
        t("settings.skillsInstalledSortLabel"),
        props.installed.sort,
        [
          { value: "name-asc", label: t("settings.skillsInstalledSortNameAsc") },
          { value: "name-desc", label: t("settings.skillsInstalledSortNameDesc") },
          { value: "installed-desc", label: t("settings.skillsInstalledSortNewest") },
        ],
        (sort) => props.installed.onSort(sort as InstalledSkillSort),
      ),
      c.select(
        "skill-installed-category",
        t("settings.skillsHubInstalledTab"),
        props.installed.category,
        categoryOptions(props.installed.categoryCounts),
        (value) => props.installed.onCategory(value as Category),
      ),
    );
    rows = nativeSkillInstalled({
      c,
      t,
      ...props.installed,
      selected: props.installed.selected,
      bulkMode: props.bulk.enabled,
      bulkSelection: props.bulk.selection,
      toggle: props.installed.onToggle,
      toggleBulk: props.bulk.onToggle,
      enterBulk: props.bulk.onEnter,
      preview: props.installed.onOpen,
      remove,
      category: props.installed.onCategory,
    });
  } else if (props.view === "store") {
    controls.push(
      c.select(
        "skill-store-sort",
        t("settings.skillsHubStoreTab"),
        props.store.sort,
        ["downloads", "stars", "trending", "updated"].map((value, index) => ({
          value,
          label: t(
            [
              "settings.skillsStoreSortMostDownloaded",
              "settings.skillsStoreSortMostStarred",
              "settings.skillsStoreSortTrending",
              "settings.skillsStoreSortRecentlyUpdated",
            ][index],
          ),
        })),
        (sort) => props.store.onSort(sort as ClawHubSort),
      ),
      c.select(
        "skill-store-category",
        t("settings.skillsHubStoreTab"),
        storeCategory,
        categoryOptions(storeCounts),
        (category) => setStoreCategory(category as Category),
      ),
    );
    rows = visibleStore.map(({ skill }) =>
      nativeSkillStoreCard({
        c,
        t,
        skill,
        state: nativeSkillInstallState(skill, props.store),
        preview: () => setStorePreview(skill),
        install: () => {
          void props.store.onInstall(skill);
        },
      }),
    );
  } else
    rows = nativeSkillImport({
      c,
      t,
      ...props.import,
      tool: activeTool,
      chooseTool: setImportTool,
    });
  const banner = (id: string, message: string | null): PresentationNode[] =>
    message ? [{ id, kind: "Banner", status: "error", label: message }] : [];
  const content: PresentationNode[] = [
    ...banner("skill-hub-error", props.error),
    ...banner("skill-native-error", error),
    ...(props.view === "store" ? banner("skill-store-error", props.store.error) : []),
    ...(props.loading || (props.view === "store" && props.store.loading)
      ? [
          {
            id: "skill-hub-loading",
            kind: "Progress" as const,
            label: t("settings.skillsScanning"),
          },
        ]
      : []),
    ...(props.view === "installed"
      ? [
          {
            id: "skill-installed-count",
            kind: "Text" as const,
            secondary: true,
            text: `${t("settings.skillsHubSelectedShort")} ${props.installed.selectedCount} / ${props.installed.total}`,
          },
          { id: "skill-root-dir", kind: "Text" as const, text: props.rootDir, secondary: true },
        ]
      : []),
    {
      id: "skill-hub-items",
      kind: "VStack",
      variant: props.view === "store" ? "skill-store-grid" : "skill-installed-list",
      children: rows,
    },
    ...(rows.length === 0 &&
    !props.loading &&
    props.view !== "import" &&
    (props.view !== "store" || !props.store.loading)
      ? [
          {
            id: "skill-hub-empty",
            kind: "EmptyState" as const,
            label: t(query ? "settings.skillsNoMatch" : "settings.skillsNotFound").replace(
              "{filter}",
              query,
            ),
          },
        ]
      : []),
    ...(props.view === "store" && props.store.cursor && !props.store.query.trim()
      ? [
          c.action(
            "skill-store-load-more",
            t("settings.skillsStoreLoadMore"),
            props.store.onLoadMore,
            !props.store.loading && !props.store.loadingMore,
          ),
        ]
      : []),
  ];
  const bulkNodes: PresentationNode[] =
    props.bulk.enabled && props.view === "installed"
      ? [
          {
            id: "skill-bulk-actions",
            kind: "VStack",
            variant: "skill-bulk-actions",
            children: [
              {
                id: "skill-bulk-count",
                kind: "Text",
                text: t("settings.skillsBulkSelectedCount").replace(
                  "{count}",
                  String(props.bulk.selection.size),
                ),
              },
              c.action("skill-bulk-all", t("settings.skillsBulkSelectAll"), props.bulk.onAll),
              c.action(
                "skill-bulk-clear",
                t("settings.skillsBulkClear"),
                props.bulk.onClear,
                props.bulk.selection.size > 0,
              ),
              c.action(
                "skill-bulk-enable",
                `${t("settings.skillsBulkEnable")} (${props.bulk.enableCount})`,
                () => props.bulk.onEnable(true),
                props.bulk.enableCount > 0,
              ),
              c.action(
                "skill-bulk-disable",
                `${t("settings.skillsBulkDisable")} (${props.bulk.disableCount})`,
                () => props.bulk.onEnable(false),
                props.bulk.disableCount > 0,
              ),
              {
                ...c.action(
                  "skill-bulk-delete",
                  `${t("settings.skillsHubBulkDelete")} (${props.bulk.deleteNames.length})`,
                  removeBulk,
                  props.bulk.deleteNames.length > 0 && !props.installed.deleting,
                ),
                destructive: true,
              },
            ],
          },
        ]
      : [];
  if (props.bulk.undo && props.bulk.selection.size === 0)
    bulkNodes.push({
      id: "skill-bulk-undo-notice",
      kind: "Banner",
      status: "completed",
      label: t("settings.skillsBulkUpdated").replace("{count}", String(props.bulk.undo.count)),
      children: [c.action("skill-bulk-undo", t("settings.skillsBulkUndo"), props.bulk.onUndo)],
    });
  let preview: PresentationNode | undefined;
  if (props.preview.skill) {
    const skill = props.preview.skill;
    const root = props.rootDir;
    const view = props.view;
    const current = () =>
      previewLease.current.active &&
      previewLease.current.skill === skill &&
      previewLease.current.root === root &&
      previewLease.current.view === view;
    preview = nativeSkillPreview({
      c,
      t,
      skill: props.preview.skill,
      preview: props.preview.state,
      checked: props.installed.selected.has(props.preview.skill.name),
      deleting: props.installed.deleting === props.preview.skill.name,
      onDelete: async () => {
        if (current()) await remove(skill, current);
      },
      onToggle: (enabled) => {
        if (current()) props.installed.onToggle(skill.name, enabled);
      },
      skillsEnabled: props.settings.skills.enabled,
      close: closePreview,
      copied,
      copy: async (id, text) => {
        const epoch = lifetime.current;
        const revision = ++copyRevision.current;
        await writeClipboardText(text);
        if (epoch === lifetime.current && revision === copyRevision.current) setCopied(id);
      },
    });
  } else if (storePreview)
    preview = nativeSkillStorePreview({
      c,
      t,
      skill: storePreview,
      detail,
      loading: detailLoading,
      error: detailError,
      state: nativeSkillInstallState(detail ?? storePreview, props.store),
      close: closePreview,
      open: openUrl,
      install: () => {
        void props.store.onInstall(detail ?? storePreview);
      },
    });
  const nodes: PresentationNode[] = [
    {
      id: "native-skills-hub",
      kind: "VStack",
      variant: "skills-hub-layout",
      fill: true,
      children: [
        {
          id: "skill-hub-main",
          kind: "VStack",
          variant: "skills-hub-main",
          fill: true,
          children: [
            {
              id: "skill-hub-toolbar",
              kind: "VStack",
              variant: "skills-hub-toolbar",
              children: [
                {
                  ...c.action("skill-sidebar", t("tooltip.openSidebar"), props.onOpenSidebar),
                  kind: "IconButton",
                  icon: "xgent.sidebar",
                  variant: "ghost",
                },
                { id: "skill-hub-title", kind: "Heading", text: t("settings.skillsHubTitle") },
                c.toggle(
                  "skill-hub-enabled",
                  t("settings.enable"),
                  props.settings.skills.enabled,
                  props.onEnabled,
                ),
                c.action(
                  "skill-hub-refresh",
                  t("settings.skillsScan"),
                  () => props.refresh(),
                  !props.loading,
                ),
              ],
            },
            {
              ...c.select(
                "skill-hub-view",
                t("settings.skillsHubTitle"),
                props.view,
                ["installed", "store", "import"].map((value) => ({
                  value,
                  label: t(
                    `settings.skillsHub${value.charAt(0).toUpperCase()}${value.slice(1)}Tab`,
                  ),
                })),
                (view) => props.onView(view as NativeSkillsHubProps["view"]),
              ),
              kind: "SegmentedControl",
              padding: 16,
            },
            ...(!props.preview.skill && !storePreview && props.view === "installed"
              ? [
                  c.action(
                    "skill-bulk-mode",
                    t(props.bulk.enabled ? "settings.skillsBulkDone" : "settings.skillsBulkSelect"),
                    props.bulk.onMode,
                  ),
                ]
              : []),
            {
              id: "skill-hub-controls",
              kind: "VStack",
              variant: "skill-hub-controls",
              children: controls,
            },
            { id: "skill-hub-content", kind: "ScrollView", fill: true, children: content },
            ...bulkNodes,
          ],
        },
        ...(preview ? [preview] : []),
      ],
    },
  ];
  return (
    <>
      {dialog}
      <NativeSurface
        sessionSurface={props.surfaceId}
        document={{
          mode: props.mode ?? "root",
          title: t("settings.skillsHubTitle"),
          appearance: props.settings.theme,
          formFactor: compact ? "mobile" : "desktop",
          theme: createNativePresentationTheme(props.settings, compact, "workspaceTools"),
          nodes,
          dismissAction: props.mode === "sheet" || preview ? "close" : undefined,
        }}
        handlers={c.handlers}
        onError={(cause) => setError(String(cause))}
      />
    </>
  );
}
