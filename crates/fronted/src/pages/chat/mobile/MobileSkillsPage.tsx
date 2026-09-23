import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading, Text } from "@astryxdesign/core/Text";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, MoreHorizontal, Plus, RefreshCw, SkillIcon } from "../../../components/icons";
import { Markdown } from "../../../components/Markdown";
import { useLocale } from "../../../i18n";
import { type AppSettings, updateSkills } from "../../../lib/settings";
import {
  discoverSkills,
  getSkillInstallJobStatus,
  isAlwaysEnabledSkillName,
  isUserSelectableSkill,
  readSkillText,
  type SkillInstallJobSnapshot,
  type SkillSummary,
  startSkillInstallJob,
} from "../../../lib/skills";
import {
  buildClawHubDownloadUrl,
  buildClawHubSkillKey,
  type ClawHubSkillCard,
  listClawHubSkills,
  resolveClawHubSkillOwner,
  searchClawHubSkills,
} from "../../../lib/skills/clawHub";
import { presentationControls } from "../../../presentation/controls";
import { NativeSurface } from "../../../presentation/NativeSurface";
import { createNativePresentationTheme } from "../../../presentation/nativeTheme";
import type { PresentationNode } from "../../../presentation/types";
import { isApplePresentationRuntime } from "../../../runtime/applePresentation";
import { MobileHubHeader, MobileHubSearch } from "./MobileHubChrome";

type MobileSkillsPageProps = {
  settings: AppSettings;
  setSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  initialSkills?: SkillSummary[];
  onOpenSidebar: () => void;
  presentationMode?: "root" | "sheet";
};

type SkillPreview = {
  content: string;
  loading: boolean;
  error: string;
};

export function MobileSkillsPage(props: MobileSkillsPageProps) {
  const { t } = useLocale();
  const [skills, setSkills] = useState<SkillSummary[]>(props.initialSkills ?? []);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"installed" | "store">("installed");
  const [storeItems, setStoreItems] = useState<ClawHubSkillCard[]>([]);
  const [storeLoading, setStoreLoading] = useState(false);
  const [storeError, setStoreError] = useState("");
  const [storeJobs, setStoreJobs] = useState<Record<string, SkillInstallJobSnapshot>>({});
  const [pendingStoreKeys, setPendingStoreKeys] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [selected, setSelected] = useState<SkillSummary | null>(null);
  const [preview, setPreview] = useState<SkillPreview>({
    content: "",
    loading: false,
    error: "",
  });

  useEffect(() => {
    setSkills(props.initialSkills ?? []);
  }, [props.initialSkills]);

  useEffect(() => {
    if (!isApplePresentationRuntime() || props.initialSkills) return;
    let active = true;
    setRefreshing(true);
    void discoverSkills({ force: true })
      .then((result) => {
        if (active) setSkills(result.skills);
      })
      .catch((error) => {
        if (active) setRefreshError(String(error));
      })
      .finally(() => {
        if (active) setRefreshing(false);
      });
    return () => {
      active = false;
    };
  }, [props.initialSkills]);

  const visibleSkills = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return skills;
    return skills.filter((skill) =>
      `${skill.name}\n${skill.description}`.toLocaleLowerCase().includes(needle),
    );
  }, [query, skills]);

  useEffect(() => {
    if (view !== "store") return;
    let active = true;
    const timer = window.setTimeout(
      () => {
        setStoreLoading(true);
        setStoreError("");
        const search = query.trim()
          ? searchClawHubSkills({ query: query.trim(), limit: 24 })
          : listClawHubSkills({ sort: "downloads", limit: 24 }).then((page) => page.items);
        void search
          .then((items) => {
            if (active) setStoreItems(items);
          })
          .catch((cause) => {
            if (active) setStoreError(cause instanceof Error ? cause.message : String(cause));
          })
          .finally(() => {
            if (active) setStoreLoading(false);
          });
      },
      query.trim() ? 250 : 0,
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, view]);

  useEffect(() => {
    const activeJobs = Array.from(
      new Map(Object.values(storeJobs).map((job) => [job.jobId, job])).values(),
    ).filter((job) => !["done", "error", "cancelled"].includes(job.phase));
    if (activeJobs.length === 0) return;
    const timer = window.setInterval(() => {
      for (const job of activeJobs) {
        void getSkillInstallJobStatus(job.jobId)
          .then((next) => {
            setStoreJobs((previous) =>
              Object.fromEntries(
                Object.entries(previous).map(([key, value]) => [
                  key,
                  value.jobId === next.jobId ? next : value,
                ]),
              ),
            );
            if (next.phase === "done") {
              completeStoreJob(next);
            }
          })
          .catch((cause) => {
            const message = cause instanceof Error ? cause.message : String(cause);
            setStoreJobs((previous) =>
              Object.fromEntries(
                Object.entries(previous).map(([key, value]) => [
                  key,
                  value.jobId === job.jobId ? { ...value, phase: "error", error: message } : value,
                ]),
              ),
            );
          });
      }
    }, 600);
    return () => window.clearInterval(timer);
  }, [props.setSettings, storeJobs]);

  const installedStoreKeys = new Set(
    skills
      .filter((skill) => skill.source?.registry === "clawhub")
      .map((skill) =>
        buildClawHubSkillKey({
          slug: skill.source!.slug,
          ownerHandle: skill.source!.ownerHandle ?? null,
        }),
      ),
  );

  function completeStoreJob(job: SkillInstallJobSnapshot) {
    const names = (job.installed ?? [])
      .map((item) => item.name.trim())
      .filter((name) => name && !isAlwaysEnabledSkillName(name));
    if (names.length > 0) {
      props.setSettings((previous) =>
        updateSkills(previous, {
          enabled: true,
          selected: Array.from(new Set([...previous.skills.selected, ...names])),
        }),
      );
    }
    void discoverSkills({ force: true })
      .then((result) => setSkills(result.skills))
      .catch((cause) => setRefreshError(cause instanceof Error ? cause.message : String(cause)));
  }

  async function installStoreSkill(skill: ClawHubSkillCard) {
    const key = buildClawHubSkillKey(skill);
    if (
      pendingStoreKeys.includes(key) ||
      installedStoreKeys.has(key) ||
      (storeJobs[key] && !["error", "cancelled"].includes(storeJobs[key].phase))
    )
      return;
    setPendingStoreKeys((current) => [...current, key]);
    setStoreError("");
    try {
      const resolved = await resolveClawHubSkillOwner(skill);
      const job = await startSkillInstallJob({
        source: buildClawHubDownloadUrl(resolved.slug, resolved.ownerHandle),
        label: resolved.displayName,
        slug: resolved.slug,
        ownerHandle: resolved.ownerHandle,
        version: resolved.latestVersion,
        conflict: "backup",
      });
      setStoreJobs((current) => ({
        ...current,
        [key]: job,
        [buildClawHubSkillKey(resolved)]: job,
      }));
      if (job.phase === "done") completeStoreJob(job);
    } catch (cause) {
      setStoreError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPendingStoreKeys((current) => current.filter((item) => item !== key));
    }
  }

  function storeItemState(skill: ClawHubSkillCard) {
    const key = buildClawHubSkillKey(skill);
    const job = storeJobs[key];
    return {
      job,
      installed: installedStoreKeys.has(key) || job?.phase === "done",
      pending:
        pendingStoreKeys.includes(key) ||
        Boolean(job && !["done", "error", "cancelled"].includes(job.phase)),
    };
  }

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshError("");
    try {
      const result = await discoverSkills({ force: true });
      setSkills(result.skills);
    } catch (cause) {
      setRefreshError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!selected) {
      setPreview({ content: "", loading: false, error: "" });
      return;
    }
    let cancelled = false;
    setPreview({
      content: selected.inlineContent ?? "",
      loading: true,
      error: "",
    });
    void readSkillText({ path: selected.skillFile, offset: 0, length: 10_000 })
      .then((result) => {
        if (!cancelled) {
          setPreview({ content: result.content, loading: false, error: "" });
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setPreview({
            content: selected.inlineContent ?? "",
            loading: false,
            error: cause instanceof Error ? cause.message : String(cause),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const isSelected = (skill: SkillSummary) =>
    isAlwaysEnabledSkillName(skill.name) || props.settings.skills.selected.includes(skill.name);

  const toggle = (skill: SkillSummary, enabled: boolean) => {
    if (!isUserSelectableSkill(skill)) return;
    props.setSettings((prev) => {
      const next = new Set(prev.skills.selected);
      if (enabled) next.add(skill.name);
      else next.delete(skill.name);
      return updateSkills(prev, {
        enabled: enabled ? true : prev.skills.enabled,
        selected: Array.from(next),
      });
    });
  };

  if (isApplePresentationRuntime()) {
    const c = presentationControls();
    c.handlers.set("close", {
      enabled: true,
      accepts: (value) => value === null,
      run: selected ? () => setSelected(null) : props.onOpenSidebar,
    });
    const contentNodes: PresentationNode[] = selected
      ? [
          c.toggle(
            "enabled",
            t("settings.enable"),
            isSelected(selected),
            (enabled) => toggle(selected, enabled),
            isUserSelectableSkill(selected),
          ),
          { id: "description", kind: "Text", text: selected.description },
          ...(preview.loading
            ? [{ id: "loading", kind: "Progress" as const, label: t("app.loading") }]
            : []),
          { id: "preview", kind: "Text", text: preview.error || preview.content },
        ]
      : view === "store"
        ? [
            {
              id: "skills-store-heading",
              kind: "HStack",
              children: [
                {
                  id: "skills-store-popular",
                  kind: "Heading",
                  text: t("settings.skillsStoreSortMostDownloaded"),
                },
                { id: "skills-store-heading-space", kind: "Spacer" },
                { id: "skills-store-count", kind: "Badge", label: String(storeItems.length) },
              ],
            },
            ...(storeLoading
              ? [{ id: "skills-store-loading", kind: "Progress" as const, label: t("app.loading") }]
              : []),
            ...(storeError
              ? [
                  {
                    id: "skills-store-error",
                    kind: "Banner" as const,
                    label: storeError,
                    status: "error" as const,
                  },
                ]
              : []),
            ...storeItems.map((skill): PresentationNode => {
              const item = storeItemState(skill);
              return {
                id: `skills-store:${buildClawHubSkillKey(skill)}`,
                kind: "Card",
                children: [
                  {
                    id: `skills-store:${buildClawHubSkillKey(skill)}:row`,
                    kind: "HStack",
                    children: [
                      {
                        id: `skills-store:${buildClawHubSkillKey(skill)}:copy`,
                        kind: "VStack",
                        fill: true,
                        children: [
                          {
                            id: `skills-store:${buildClawHubSkillKey(skill)}:name`,
                            kind: "Heading",
                            text: skill.displayName,
                          },
                          {
                            id: `skills-store:${buildClawHubSkillKey(skill)}:summary`,
                            kind: "Text",
                            text: skill.summary,
                            secondary: true,
                            maxLines: 2,
                          },
                          ...(item.job?.phase === "error" && item.job.error
                            ? [
                                {
                                  id: `skills-store:${buildClawHubSkillKey(skill)}:error`,
                                  kind: "Text" as const,
                                  text: item.job.error,
                                },
                              ]
                            : []),
                        ],
                      },
                      {
                        ...c.action(
                          `skills-store:${buildClawHubSkillKey(skill)}:install`,
                          item.installed
                            ? t("settings.skillsStoreInstalled")
                            : item.pending
                              ? t("settings.skillsStorePhaseInstalling")
                              : t("settings.skillsStoreInstall"),
                          () => installStoreSkill(skill),
                          !item.installed && !item.pending,
                        ),
                        kind: "IconButton",
                        icon: item.installed ? "checkmark" : "plus",
                      },
                    ],
                  },
                ],
              };
            }),
            ...(!storeItems.length && !storeLoading && !storeError
              ? [
                  {
                    id: "skills-store-empty",
                    kind: "EmptyState" as const,
                    label: t("settings.skillsStoreEmptyTitle"),
                    text: t("settings.skillsStoreEmptyDesc"),
                  },
                ]
              : []),
          ]
        : [
            c.toggle(
              "skills-enabled",
              t("settings.enable"),
              props.settings.skills.enabled,
              (enabled) => props.setSettings((previous) => updateSkills(previous, { enabled })),
            ),
            c.input("search", t("settings.searchPlaceholder"), query, setQuery),
            c.action("refresh", t("settings.mobileAssistant.refresh"), refresh, !refreshing),
            ...(refreshing
              ? [{ id: "loading", kind: "Progress" as const, label: t("settings.skillsScanning") }]
              : []),
            ...(refreshError ? [{ id: "error", kind: "Text" as const, text: refreshError }] : []),
            ...visibleSkills.map(
              (skill): PresentationNode => ({
                ...c.action(`${skill.baseDir}:${skill.name}`, skill.name, () => setSelected(skill)),
                kind: "NavigationRow",
                text: skill.description,
                icon: "puzzlepiece.extension",
                selected: isSelected(skill),
              }),
            ),
            ...(visibleSkills.length || refreshing
              ? []
              : [{ id: "empty", kind: "Text" as const, text: t("settings.skillsNotFound") }]),
          ];
    if (props.presentationMode === "root") {
      const rootContentNodes = contentNodes.filter(
        (node) => node.id !== "search" && node.id !== "refresh",
      );
      const leading: PresentationNode = selected
        ? {
            ...c.action("back", t("settings.close"), () => setSelected(null)),
            kind: "IconButton",
            icon: "chevron.left",
            variant: "secondary",
          }
        : {
            ...c.action("open-sidebar", t("tooltip.openSidebar"), props.onOpenSidebar),
            kind: "IconButton",
            icon: "xgent.sidebar",
            variant: "secondary",
          };
      const trailing: PresentationNode = selected
        ? { id: "hub-toolbar-end", kind: "Spacer", width: 44 }
        : {
            ...c.action(
              "refresh",
              t("settings.mobileAssistant.refresh"),
              refresh,
              !refreshing && view === "installed",
            ),
            kind: "IconButton",
            icon: "arrow.clockwise",
            variant: "secondary",
          };
      const rootNodes: PresentationNode[] = [
        {
          id: "skills-hub-layout",
          kind: "VStack",
          fill: true,
          children: [
            {
              id: "skills-hub-toolbar",
              kind: "HStack",
              minHeight: 68,
              padding: 12,
              children: [
                leading,
                {
                  id: "skills-hub-title",
                  kind: "Heading",
                  text: selected?.name || t("sidebar.mobile.plugins"),
                  fill: true,
                  alignment: "center",
                  maxLines: 1,
                },
                trailing,
              ],
            },
            ...(!selected
              ? [
                  {
                    ...c.select(
                      "skills-view",
                      t("sidebar.mobile.plugins"),
                      view,
                      [
                        { value: "installed", label: t("settings.skillsHubInstalledTab") },
                        { value: "store", label: t("settings.skillsHubStoreTab") },
                      ],
                      (value) => setView(value as "installed" | "store"),
                    ),
                    kind: "SegmentedControl" as const,
                    padding: 12,
                  },
                  {
                    ...c.input(
                      "search",
                      view === "store"
                        ? t("settings.skillsHubStoreTab")
                        : t("settings.searchPlaceholder"),
                      query,
                      setQuery,
                    ),
                    padding: 12,
                  },
                ]
              : []),
            {
              id: "skills-hub-content",
              kind: "ScrollView",
              fill: true,
              padding: 16,
              children: rootContentNodes,
            },
          ],
        },
      ];
      return (
        <NativeSurface
          document={{
            mode: "root",
            title: selected?.name || t("sidebar.mobile.plugins"),
            appearance: props.settings.theme,
            formFactor: "mobile",
            theme: createNativePresentationTheme(props.settings, true, "workspaceTools"),
            nodes: rootNodes,
          }}
          handlers={c.handlers}
          onError={(error) => setRefreshError(String(error))}
        />
      );
    }
    return (
      <NativeSurface
        document={{
          mode: "sheet",
          title: selected?.name || t("sidebar.mobile.plugins"),
          appearance: props.settings.theme,
          formFactor: "mobile",
          theme: createNativePresentationTheme(props.settings, true, "workspaceTools"),
          nodes: [
            c.action(
              "back",
              t("settings.close"),
              selected ? () => setSelected(null) : props.onOpenSidebar,
            ),
            ...contentNodes,
          ],
          dismissAction: "close",
        }}
        handlers={c.handlers}
        onError={(error) => setRefreshError(String(error))}
      />
    );
  }

  if (selected) {
    return (
      <VStack as="section" gap={0} height="100%" minHeight={0}>
        <HStack
          as="header"
          gap={3}
          vAlign="center"
          paddingInline={3}
          minHeight="var(--xgent-mobile-header-height)"
          className="shrink-0 border-b border-border/40 pt-[env(safe-area-inset-top,0)]"
        >
          <IconButton
            label={t("settings.close")}
            tooltip={t("settings.close")}
            icon={<ArrowLeft />}
            variant="ghost"
            size="lg"
            onClick={() => setSelected(null)}
          />
          <StackItem size="fill">
            <VStack gap={0.5}>
              <Heading level={2} maxLines={1}>
                {selected.name}
              </Heading>
              <Text type="supporting" color="secondary" maxLines={1}>
                {selected.skillFile}
              </Text>
            </VStack>
          </StackItem>
          <Switch
            value={isSelected(selected)}
            isDisabled={!isUserSelectableSkill(selected)}
            label={isSelected(selected) ? t("settings.disable") : t("settings.enable")}
            isLabelHidden
            onChange={(checked) => toggle(selected, checked)}
            size="md"
          />
        </HStack>
        <StackItem size="fill" isScrollable>
          <VStack gap={4} padding={5}>
            {selected.description ? (
              <Text type="body" color="secondary">
                {selected.description}
              </Text>
            ) : null}
            {preview.loading ? <Spinner label={t("settings.skillsScanning")} size="md" /> : null}
            {preview.error ? (
              <Banner status="error" title={preview.error} collapsible={false} />
            ) : null}
            {preview.content ? <Markdown content={preview.content} /> : null}
          </VStack>
        </StackItem>
      </VStack>
    );
  }

  return (
    <VStack as="section" gap={0} height="100%" minHeight={0} className="relative">
      <MobileHubHeader
        title={t("sidebar.mobile.plugins")}
        onOpenSidebar={props.onOpenSidebar}
        trailing={
          <IconButton
            label={t("settings.skillsRescan")}
            tooltip={t("settings.skillsRescan")}
            icon={<RefreshCw />}
            variant="ghost"
            size="lg"
            isLoading={refreshing}
            isDisabled={refreshing}
            onClick={() => void refresh()}
          />
        }
      />
      <MobileHubSearch
        value={query}
        onChange={setQuery}
        placeholder={
          view === "store" ? t("settings.skillsHubStoreTab") : t("sidebar.mobile.searchPlugins")
        }
      />
      <HStack gap={2} paddingInline={4} paddingBlock={2}>
        <Button
          label={t("settings.skillsHubInstalledTab")}
          variant={view === "installed" ? "primary" : "secondary"}
          onClick={() => setView("installed")}
        />
        <Button
          label={t("settings.skillsHubStoreTab")}
          variant={view === "store" ? "primary" : "secondary"}
          onClick={() => setView("store")}
        />
      </HStack>
      {refreshError || storeError ? (
        <HStack paddingInline={5} paddingBlockStart={3}>
          <Banner
            status="error"
            title={view === "store" ? storeError : refreshError}
            collapsible={false}
          />
        </HStack>
      ) : null}

      <HStack gap={2} hAlign="between" vAlign="center" paddingInline={5} paddingBlockStart={5}>
        <Heading level={2}>
          {view === "store"
            ? t("settings.skillsStoreSortMostDownloaded")
            : t("settings.skillsHubInstalledTab")}
        </Heading>
        <Badge label={String(view === "store" ? storeItems.length : visibleSkills.length)} />
      </HStack>

      <StackItem size="fill" isScrollable>
        <VStack gap={3} padding={3} className="mobile-hub-scroll-content">
          {view === "store" && storeItems.length > 0 ? (
            <List density="spacious">
              {storeItems.map((skill) => {
                const item = storeItemState(skill);
                return (
                  <ListItem
                    key={buildClawHubSkillKey(skill)}
                    label={skill.displayName}
                    description={item.job?.error || skill.summary}
                    startContent={<SkillIcon />}
                    endContent={
                      <Button
                        label={
                          item.installed
                            ? t("settings.skillsStoreInstalled")
                            : item.pending
                              ? t("settings.skillsStorePhaseInstalling")
                              : t("settings.skillsStoreInstall")
                        }
                        variant="secondary"
                        isDisabled={item.installed || item.pending}
                        onClick={() => void installStoreSkill(skill)}
                      />
                    }
                  />
                );
              })}
            </List>
          ) : view === "store" && storeLoading ? (
            <Spinner label={t("app.loading")} size="md" />
          ) : view === "store" ? (
            <EmptyState icon={<Plus />} title={t("settings.skillsStoreEmptyTitle")} isCompact />
          ) : visibleSkills.length > 0 ? (
            <List density="spacious">
              {visibleSkills.map((skill) => (
                <ListItem
                  key={`${skill.baseDir}:${skill.name}`}
                  label={skill.name}
                  description={skill.description}
                  startContent={<SkillIcon />}
                  endContent={<MoreHorizontal />}
                  onClick={() => setSelected(skill)}
                  isSelected={isSelected(skill)}
                />
              ))}
            </List>
          ) : !refreshing ? (
            <EmptyState icon={<MoreHorizontal />} title={t("settings.skillsNotFound")} isCompact />
          ) : (
            <Spinner label={t("settings.skillsScanning")} size="md" />
          )}
        </VStack>
      </StackItem>
    </VStack>
  );
}
