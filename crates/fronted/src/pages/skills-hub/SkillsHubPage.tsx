import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button as AstryxCoreButton } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, Section, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Link } from "@astryxdesign/core/Link";
import { List, ListItem } from "@astryxdesign/core/List";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Selector } from "@astryxdesign/core/Selector";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Switch } from "@astryxdesign/core/Switch";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { Token } from "@astryxdesign/core/Token";
import { Button as AstryxButton } from "@xagent/ui/components/ui/button";
import { Inline as AstryxInline, View as AstryxView } from "@xagent/ui/components/ui/view";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { HubHeader } from "../../components/hub/HubChrome";
import {
  Activity,
  AlertTriangle,
  Blend,
  BookOpen,
  Brain,
  Check,
  Cloud,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Folder,
  Globe,
  House,
  Layers,
  ListChecks,
  Loader2,
  Lock,
  MessageCircle,
  Package,
  Palette,
  Plug,
  RefreshCw,
  Search,
  Server,
  Shield,
  SkillIcon,
  Trash2,
  Wallet,
  Wrench,
  X,
  Zap,
} from "../../components/icons";
import { Markdown } from "../../components/Markdown";
import { Button } from "../../components/ui/button";
import {
  ConfirmActionPopover,
  ConfirmDeletePopover,
} from "../../components/ui/confirm-action-popover";
import { useLocale } from "../../i18n";
import { type AppSettings, updateSkills } from "../../lib/settings";
import { cn } from "../../lib/shared/utils";
import {
  cancelSkillInstallJob,
  discoverSkills,
  type ExternalToolScan,
  getSkillInstallJobStatus,
  isAlwaysEnabledSkillName,
  isUserSelectableSkill,
  manageSkill,
  mergeAlwaysEnabledSkillNames,
  notifySkillsDiscoveryUpdated,
  readSkillText,
  type SkillInstallJobSnapshot,
  type SkillSummary,
  scanExternalSkills,
  startSkillInstallJob,
} from "../../lib/skills";
import {
  buildClawHubDownloadUrl,
  buildClawHubSkillKey,
  type ClawHubSkillCard,
  type ClawHubSkillDetail,
  type ClawHubSort,
  getClawHubSkillDetail,
  listClawHubSkills,
  resolveClawHubSkillOwner,
  searchClawHubSkills,
} from "../../lib/skills/clawHub";
import {
  CLAWHUB_CATEGORY_SLUGS,
  type ClawHubCategorySlug,
  classifyClawHubSkill,
} from "../../lib/skills/clawHubCategories";
import {
  DEFAULT_INSTALLED_SKILL_SORT,
  type InstalledSkillSort,
  isInstalledSkillSort,
  sortInstalledSkillItems,
} from "../../lib/skills/installedSort";

type SkillsHubView = "installed" | "store" | "import";

const EXTERNAL_TOOL_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  codebuddy: "CodeBuddy",
};

const STORE_PAGE_LIMIT = 24;
const INSTALLED_SKILL_PREVIEW_LINES = 10_000;
const COPY_FEEDBACK_MS = 1600;
const MAX_LOCAL_SKILL_BUNDLE_FILES = 512;
const MAX_LOCAL_SKILL_BUNDLE_BYTES = 32 * 1024 * 1024;
const TERMINAL_INSTALL_PHASES = new Set(["done", "error", "cancelled"]);

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}`));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const separator = result.indexOf(",");
      if (separator < 0) {
        reject(new Error(`Failed to encode ${file.name}`));
        return;
      }
      resolve(result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}
const STORE_SORT_OPTIONS: Array<{ value: ClawHubSort; labelKey: string }> = [
  { value: "downloads", labelKey: "settings.skillsStoreSortMostDownloaded" },
  { value: "stars", labelKey: "settings.skillsStoreSortMostStarred" },
  { value: "trending", labelKey: "settings.skillsStoreSortTrending" },
  { value: "updated", labelKey: "settings.skillsStoreSortRecentlyUpdated" },
];

const INSTALLED_SORT_OPTIONS: Array<{ value: InstalledSkillSort; labelKey: string }> = [
  { value: "name-asc", labelKey: "settings.skillsInstalledSortNameAsc" },
  { value: "name-desc", labelKey: "settings.skillsInstalledSortNameDesc" },
  { value: "installed-desc", labelKey: "settings.skillsInstalledSortNewest" },
];

type StoreCategoryValue = "all" | ClawHubCategorySlug;

// 图标与 ClawHub 官网分类侧边栏一一对应（layers/plug/zap/globe/wrench/…）。
const STORE_CATEGORY_ICONS: Record<StoreCategoryValue, typeof Layers> = {
  all: Layers,
  integrations: Plug,
  automation: Zap,
  research: Globe,
  development: Wrench,
  productivity: ListChecks,
  communication: MessageCircle,
  creative: Palette,
  knowledge: BookOpen,
  agents: Brain,
  operations: Activity,
  security: Shield,
  finance: Wallet,
  lifestyle: House,
  other: Package,
};

function storeCategoryLabelKey(value: StoreCategoryValue): string {
  return `settings.skillsStoreCategory${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

// 已安装技能没有 ClawHub 的 topics 字段，用名称+描述做启发式分类。
function classifyInstalledSkill(skill: SkillSummary): ClawHubCategorySlug[] {
  return classifyClawHubSkill({
    slug: skill.name,
    displayName: skill.name,
    summary: skill.description,
    topics: [],
  });
}

const STORE_CATEGORY_OPTIONS: readonly StoreCategoryValue[] = ["all", ...CLAWHUB_CATEGORY_SLUGS];

/** 选中分类后若本地过滤结果少于该值且还有下一页，自动继续拉取补齐。 */
const STORE_CATEGORY_FILL_TARGET = 12;

type StoreSkillInstallState = {
  done: boolean;
  installing: boolean;
  pending: boolean;
  terminalJob: boolean;
  job: SkillInstallJobSnapshot | undefined;
  progress: number | null;
};

type InstalledSkillPreviewState = {
  skillFile: string;
  content: string;
  truncated: boolean;
  loading: boolean;
  error: string | null;
};

function emptyInstalledSkillPreviewState(): InstalledSkillPreviewState {
  return {
    skillFile: "",
    content: "",
    truncated: false,
    loading: false,
    error: null,
  };
}

function fallbackCopyText(text: string) {
  let textarea: HTMLTextAreaElement | null = null;
  try {
    textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea?.remove();
  }
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return fallbackCopyText(text);
    }
  }
  return fallbackCopyText(text);
}

function normalizePreviewMetadataText(value: string) {
  return value
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function stripLeadingBlankLines(lines: string[]) {
  let index = 0;
  while (index < lines.length && !lines[index].trim()) {
    index += 1;
  }
  return lines.slice(index);
}

function stripReadmeDuplicateSummary(content: string, skill: SkillSummary) {
  const expectedName = normalizePreviewMetadataText(skill.name);
  const expectedDescription = normalizePreviewMetadataText(skill.description);
  let lines = stripLeadingBlankLines(content.split(/\r?\n/));

  if (lines.length > 0 && normalizePreviewMetadataText(lines[0]) === expectedName) {
    lines = stripLeadingBlankLines(lines.slice(1));
  }

  if (expectedDescription && lines.length > 0) {
    const paragraph: string[] = [];
    let index = 0;
    while (index < lines.length && lines[index].trim()) {
      paragraph.push(lines[index]);
      index += 1;
    }
    if (normalizePreviewMetadataText(paragraph.join(" ")) === expectedDescription) {
      lines = stripLeadingBlankLines(lines.slice(index));
    }
  }

  return lines.join("\n").trimStart();
}

const FRONTMATTER_PREVIEW_METADATA_KEYS = new Set(["name", "description"]);

function hasPreviewMetadataFrontmatterField(frontmatterBody: string) {
  return frontmatterBody.split(/\r?\n/).some((line) => {
    if (/^[ \t]/.test(line)) return false;
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:/);
    return match ? FRONTMATTER_PREVIEW_METADATA_KEYS.has(match[1].toLowerCase()) : false;
  });
}

function hasPreviewMetadataInlineFrontmatterField(frontmatterBody: string) {
  return Array.from(frontmatterBody.matchAll(/(?:^|\s)([A-Za-z0-9_-]+)\s*:/g)).some((match) =>
    FRONTMATTER_PREVIEW_METADATA_KEYS.has(match[1].toLowerCase()),
  );
}

function hasDisplayableFrontmatterContent(frontmatterBody: string) {
  return frontmatterBody.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    return trimmed !== "" && !trimmed.startsWith("#");
  });
}

function stripFrontmatterPreviewMetadataFields(frontmatterBody: string) {
  const lines = frontmatterBody.split(/\r?\n/);
  const nextLines: string[] = [];
  let skippingMetadataField = false;

  for (const line of lines) {
    const isIndented = /^[ \t]/.test(line);
    const trimmed = line.trim();
    const keyMatch = isIndented ? null : line.match(/^([A-Za-z0-9_-]+)\s*:/);

    if (keyMatch) {
      skippingMetadataField = FRONTMATTER_PREVIEW_METADATA_KEYS.has(keyMatch[1].toLowerCase());
      if (skippingMetadataField) continue;
    } else if (skippingMetadataField) {
      if (trimmed === "" || isIndented) continue;
      skippingMetadataField = false;
    }

    nextLines.push(line);
  }

  return nextLines.join("\n").trim();
}

function stripInlineFrontmatterPreviewMetadataFields(frontmatterBody: string) {
  const matches = Array.from(frontmatterBody.matchAll(/(?:^|\s)([A-Za-z0-9_-]+)\s*:/g));
  if (matches.length === 0) return frontmatterBody.trim();

  const fields = matches.map((match, index) => {
    const rawIndex = match.index ?? 0;
    const startsWithSpace = /^\s/.test(match[0]);
    const start = rawIndex + (startsWithSpace ? 1 : 0);
    const end =
      index + 1 < matches.length
        ? (matches[index + 1].index ?? frontmatterBody.length)
        : frontmatterBody.length;
    return {
      key: match[1].toLowerCase(),
      text: frontmatterBody.slice(start, end).trim(),
    };
  });

  return fields
    .filter((field) => !FRONTMATTER_PREVIEW_METADATA_KEYS.has(field.key))
    .map((field) => field.text)
    .join(" ")
    .trim();
}

function stripMarkdownSkillMetadata(content: string, skill: SkillSummary) {
  let next = content.replace(/^\uFEFF/, "");
  const frontmatter = next.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (frontmatter && hasPreviewMetadataFrontmatterField(frontmatter[1])) {
    const frontmatterBody = stripFrontmatterPreviewMetadataFields(frontmatter[1]);
    const rest = next.slice(frontmatter[0].length);
    next = hasDisplayableFrontmatterContent(frontmatterBody)
      ? `---\n${frontmatterBody}\n---\n${rest}`
      : rest;
  } else {
    const inlineFrontmatter = next.match(/^---[ \t]+([\s\S]*?)[ \t]+---[ \t]*/);
    if (inlineFrontmatter && hasPreviewMetadataInlineFrontmatterField(inlineFrontmatter[1])) {
      const frontmatterBody = stripInlineFrontmatterPreviewMetadataFields(inlineFrontmatter[1]);
      const rest = next.slice(inlineFrontmatter[0].length);
      next = frontmatterBody ? `--- ${frontmatterBody} --- ${rest}` : rest;
    }
  }
  return stripReadmeDuplicateSummary(next, skill);
}

function stripJsonSkillMetadata(content: string) {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return content;
    const next = { ...(parsed as Record<string, unknown>) };
    delete next.name;
    delete next.description;
    return Object.keys(next).length > 0 ? JSON.stringify(next, null, 2) : "";
  } catch {
    return content;
  }
}

function stripInstalledSkillPreviewMetadata(content: string, skill: SkillSummary) {
  if (/\.(md|mdx|markdown)$/i.test(skill.skillFile)) {
    return stripMarkdownSkillMetadata(content, skill);
  }
  if (/\.json$/i.test(skill.skillFile)) {
    return stripJsonSkillMetadata(content);
  }
  return content;
}

function InstalledSkillsList(props: {
  entries: Array<{ skill: SkillSummary; categories: ClawHubCategorySlug[] }>;
  rootDir: string;
  selected: ReadonlySet<string>;
  bulkSelection: ReadonlySet<string>;
  bulkMode: boolean;
  deletingSkillName: string | null;
  onOpen: (skill: SkillSummary) => void;
  onToggleSkill: (name: string, enabled: boolean) => void;
  onEnterBulk: (name: string) => void;
  onToggleBulk: (name: string) => void;
  onDelete: (skill: SkillSummary) => void;
  onSelectCategory: (category: StoreCategoryValue) => void;
}) {
  const { t } = useLocale();
  const deleteDisabled = props.deletingSkillName !== null;

  return (
    <VStack width="100%" gap={0}>
      <List
        density="balanced"
        hasDividers
        header={
          <Text type="supporting" color="secondary">
            {t("settings.skillsHubInstalledTab")}
          </Text>
        }
      >
        {props.entries.map(({ skill, categories }) => {
          const alwaysEnabled = isAlwaysEnabledSkillName(skill.name);
          const checked = alwaysEnabled || props.selected.has(skill.name);
          const bulkSelected = props.bulkSelection.has(skill.name);
          const deleting = props.deletingSkillName === skill.name;
          const PrimaryCategoryIcon = STORE_CATEGORY_ICONS[categories[0] ?? "other"];
          const flipKey = `${skill.name}-${props.rootDir}`;

          return (
            <ListItem
              key={flipKey}
              data-flip-key={flipKey}
              isSelected={bulkSelected}
              label={skill.name}
              startContent={
                <Icon
                  icon={PrimaryCategoryIcon}
                  size="md"
                  color={checked ? "primary" : "secondary"}
                />
              }
              description={
                <VStack gap={1}>
                  {skill.description ? (
                    <Text type="supporting" color="secondary" maxLines={2}>
                      {skill.description}
                    </Text>
                  ) : null}
                  <HStack gap={1} wrap="wrap">
                    {alwaysEnabled ? (
                      <Token
                        label={t("settings.skillsAlwaysOn")}
                        color="purple"
                        size="sm"
                        icon={<Icon icon={Lock} size="sm" color="inherit" />}
                      />
                    ) : (
                      categories
                        .slice(0, 3)
                        .map((category) => (
                          <Token
                            key={category}
                            label={t(storeCategoryLabelKey(category))}
                            color="gray"
                            size="sm"
                            onClick={() => props.onSelectCategory(category)}
                          />
                        ))
                    )}
                    <Token
                      label={checked ? t("settings.skillsHubEnabledBadge") : skill.skillFile}
                      color={checked ? "green" : "gray"}
                      size="sm"
                      icon={<Icon icon={FileText} size="sm" color="inherit" />}
                    />
                  </HStack>
                </VStack>
              }
              endContent={
                <HStack gap={1} vAlign="center" wrap="wrap">
                  {props.bulkMode ? (
                    alwaysEnabled ? (
                      <IconButton
                        label={t("settings.skillsBulkAlwaysOnDisabled")}
                        tooltip={t("settings.skillsBulkAlwaysOnDisabled")}
                        icon={<Icon icon={Lock} size="sm" color="inherit" />}
                        variant="ghost"
                        size="sm"
                        isDisabled
                      />
                    ) : (
                      <CheckboxInput
                        label={`${t("settings.skillsHubBulkSelectLabel")}: ${skill.name}`}
                        isLabelHidden
                        value={bulkSelected}
                        onChange={() => props.onToggleBulk(skill.name)}
                        size="sm"
                      />
                    )
                  ) : (
                    <>
                      {!alwaysEnabled ? (
                        <IconButton
                          label={t("settings.skillsHubBulkSelect")}
                          tooltip={t("settings.skillsHubBulkSelect")}
                          icon={<Icon icon={ListChecks} size="sm" color="inherit" />}
                          variant="ghost"
                          size="sm"
                          onClick={() => props.onEnterBulk(skill.name)}
                        />
                      ) : null}
                      <Switch
                        label={`${t("skills.select")}: ${skill.name}`}
                        isLabelHidden
                        value={checked}
                        size="sm"
                        isDisabled={alwaysEnabled}
                        disabledMessage={alwaysEnabled ? t("settings.skillsAlwaysOn") : undefined}
                        onChange={(next) => props.onToggleSkill(skill.name, next)}
                      />
                      <IconButton
                        label={`${t("settings.skillsInstalledPreviewOpen")}: ${skill.name}`}
                        tooltip={t("settings.skillsInstalledPreviewOpen")}
                        icon={<Icon icon={FileText} size="sm" color="inherit" />}
                        variant="ghost"
                        size="sm"
                        onClick={() => props.onOpen(skill)}
                      />
                      {!alwaysEnabled ? (
                        <ConfirmDeletePopover
                          name={skill.name}
                          onConfirm={() => props.onDelete(skill)}
                        >
                          {(open) => (
                            <IconButton
                              label={t("settings.skillsHubDeleteSkill")}
                              tooltip={t("settings.skillsHubDeleteSkill")}
                              icon={<Icon icon={Trash2} size="sm" color="inherit" />}
                              variant="ghost"
                              size="sm"
                              isDisabled={deleteDisabled}
                              isLoading={deleting}
                              onClick={open}
                            />
                          )}
                        </ConfirmDeletePopover>
                      ) : null}
                    </>
                  )}
                </HStack>
              }
            />
          );
        })}
      </List>
    </VStack>
  );
}

function buildSkillDiscoverySignature(rootDir: string, skills: SkillSummary[]) {
  return [
    rootDir,
    ...skills
      .map((skill) =>
        [
          skill.name,
          skill.baseDir,
          skill.skillFile,
          skill.source?.registry ?? "",
          skill.source?.slug ?? "",
          skill.installedAt ?? "",
          skill.source?.version ?? "",
        ].join("\0"),
      )
      .sort(),
  ].join("\n");
}

const INSTALLED_SORT_STORAGE_KEY = "skillsHub.installedSort";
const FLIP_HERO_DURATION_MS = 380;
const FLIP_BATCH_HERO_DELAY_MS = 90;
const FLIP_BATCH_STAGGER_LIMIT = 8;
const FLIP_WAVE_DURATION_MS = 280;
const FLIP_WAVE_DELAY_MS = 30;
const FLIP_WAVE_MAX_DELAY_MS = 400;
const FLIP_HERO_TRANSITION = `translate ${FLIP_HERO_DURATION_MS}ms cubic-bezier(0.34, 1.3, 0.64, 1)`;
const FLIP_WAVE_TRANSITION = `translate ${FLIP_WAVE_DURATION_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`;

type FlipMode = "single" | "wave" | "batch";
type FlipPosition = { left: number; top: number };
type FlipRequest = {
  mode: FlipMode;
  heroKeys: ReadonlySet<string>;
  followKeys: ReadonlySet<string>;
};

function readInstalledSortPreference(): InstalledSkillSort {
  if (typeof window === "undefined") return DEFAULT_INSTALLED_SKILL_SORT;
  try {
    const stored = window.localStorage.getItem(INSTALLED_SORT_STORAGE_KEY);
    return isInstalledSkillSort(stored) ? stored : DEFAULT_INSTALLED_SKILL_SORT;
  } catch {
    return DEFAULT_INSTALLED_SKILL_SORT;
  }
}

function resetFlipStyles(element: HTMLElement) {
  element.style.transition = "";
  element.style.translate = "";
  element.style.willChange = "";
  element.style.zIndex = "";
}

function useFlipGrid() {
  const gridRef = useRef<HTMLDivElement>(null);
  const previousRectsRef = useRef<Map<string, FlipPosition>>(new Map());
  const previousOrderRef = useRef<string[]>([]);
  const pendingRequestRef = useRef<FlipRequest | null>(null);
  const frameRef = useRef<number | null>(null);
  const phaseTimerRef = useRef<number | null>(null);
  const cleanupTimerRef = useRef<number | null>(null);
  const activeElementsRef = useRef<HTMLElement[]>([]);

  const requestFlip = useCallback(
    (mode: FlipMode, heroKeys: readonly string[], followKeys: readonly string[] = heroKeys) => {
      pendingRequestRef.current = {
        mode,
        heroKeys: new Set(heroKeys),
        followKeys: new Set(followKeys),
      };
    },
    [],
  );

  const captureVisibleKey = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return null;
    let scrollParent = grid.parentElement;
    while (scrollParent) {
      const overflowY = window.getComputedStyle(scrollParent).overflowY;
      if (/auto|scroll|overlay/.test(overflowY)) break;
      scrollParent = scrollParent.parentElement;
    }
    const viewport = scrollParent?.getBoundingClientRect();
    const viewportTop = viewport?.top ?? 0;
    const viewportBottom = viewport?.bottom ?? window.innerHeight;
    const elements = grid.querySelectorAll<HTMLElement>("[data-flip-key]");
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      if (rect.bottom > viewportTop && rect.top < viewportBottom) {
        return element.dataset.flipKey ?? null;
      }
    }
    return null;
  }, []);

  const clearAnimation = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (phaseTimerRef.current !== null) {
      window.clearTimeout(phaseTimerRef.current);
      phaseTimerRef.current = null;
    }
    if (cleanupTimerRef.current !== null) {
      window.clearTimeout(cleanupTimerRef.current);
      cleanupTimerRef.current = null;
    }
    for (const element of activeElementsRef.current) {
      resetFlipStyles(element);
    }
    activeElementsRef.current = [];
  }, []);

  useLayoutEffect(() => {
    clearAnimation();
    const grid = gridRef.current;
    if (!grid) {
      previousRectsRef.current.clear();
      previousOrderRef.current = [];
      pendingRequestRef.current = null;
      return;
    }

    const elements = Array.from(grid.querySelectorAll<HTMLElement>("[data-flip-key]"));
    const nextOrder = elements.map((element) => element.dataset.flipKey ?? "");
    const request = pendingRequestRef.current;
    pendingRequestRef.current = null;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const followElement = request
      ? elements.find((element) => {
          const key = element.dataset.flipKey;
          return key ? request.followKeys.has(key) : false;
        })
      : undefined;

    followElement?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: reducedMotion ? "auto" : "smooth",
    });

    const gridRect = grid.getBoundingClientRect();
    const nextRects = new Map<string, FlipPosition>();
    for (const element of elements) {
      const key = element.dataset.flipKey;
      if (!key) continue;
      const rect = element.getBoundingClientRect();
      nextRects.set(key, {
        left: rect.left - gridRect.left,
        top: rect.top - gridRect.top,
      });
    }

    const previousRects = previousRectsRef.current;
    const previousOrder = previousOrderRef.current;
    const orderChanged =
      previousOrder.length !== nextOrder.length ||
      nextOrder.some((key, index) => key !== previousOrder[index]);
    previousRectsRef.current = nextRects;
    previousOrderRef.current = nextOrder;

    if (previousRects.size === 0 || previousOrder.length === 0 || !orderChanged || reducedMotion) {
      return;
    }

    const movedElements: Array<{ element: HTMLElement; hero: boolean }> = [];
    for (const element of elements) {
      const key = element.dataset.flipKey;
      const previousRect = key ? previousRects.get(key) : undefined;
      const nextRect = key ? nextRects.get(key) : undefined;
      if (!previousRect || !nextRect) continue;
      const deltaX = previousRect.left - nextRect.left;
      const deltaY = previousRect.top - nextRect.top;
      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) continue;
      element.style.transition = "none";
      element.style.translate = `${deltaX}px ${deltaY}px`;
      element.style.willChange = "translate";
      const hero = key ? (request?.heroKeys.has(key) ?? false) : false;
      if (hero) element.style.zIndex = "30";
      movedElements.push({ element, hero });
    }

    if (movedElements.length === 0) return;
    activeElementsRef.current = movedElements.map(({ element }) => element);
    void grid.offsetWidth;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const mode = request?.mode ?? "wave";
      const heroElements = movedElements.filter(({ hero }) => hero);
      const waveElements = movedElements.filter(({ hero }) => !hero);
      const maxWaveDelay = Math.min(
        Math.max(0, waveElements.length - 1) * FLIP_WAVE_DELAY_MS,
        FLIP_WAVE_MAX_DELAY_MS,
      );
      const startWave = () => {
        waveElements.forEach(({ element }, index) => {
          const delay = Math.min(index * FLIP_WAVE_DELAY_MS, FLIP_WAVE_MAX_DELAY_MS);
          element.style.transition = `${FLIP_WAVE_TRANSITION} ${delay}ms`;
          element.style.translate = "0 0";
        });
      };
      const scheduleCleanup = (delay: number) => {
        cleanupTimerRef.current = window.setTimeout(() => {
          for (const { element } of movedElements) {
            resetFlipStyles(element);
          }
          activeElementsRef.current = [];
          cleanupTimerRef.current = null;
        }, delay + 40);
      };

      if (mode === "batch") {
        const staggerHeroes = (request?.heroKeys.size ?? 0) <= FLIP_BATCH_STAGGER_LIMIT;
        heroElements.forEach(({ element }, index) => {
          const delay = staggerHeroes ? index * FLIP_BATCH_HERO_DELAY_MS : 0;
          element.style.transition = `${FLIP_HERO_TRANSITION} ${delay}ms`;
          element.style.translate = "0 0";
        });
        const lastHeroDelay =
          staggerHeroes && heroElements.length > 0
            ? (heroElements.length - 1) * FLIP_BATCH_HERO_DELAY_MS
            : 0;
        const heroPhaseDuration =
          heroElements.length > 0 ? lastHeroDelay + FLIP_HERO_DURATION_MS : 0;
        if (waveElements.length > 0) {
          if (heroPhaseDuration > 0) {
            phaseTimerRef.current = window.setTimeout(() => {
              phaseTimerRef.current = null;
              startWave();
            }, heroPhaseDuration);
          } else {
            startWave();
          }
        }
        const wavePhaseDuration =
          waveElements.length > 0 ? FLIP_WAVE_DURATION_MS + maxWaveDelay : 0;
        scheduleCleanup(heroPhaseDuration + wavePhaseDuration);
        return;
      }

      heroElements.forEach(({ element }) => {
        element.style.transition = FLIP_HERO_TRANSITION;
        element.style.translate = "0 0";
      });
      startWave();
      const heroDuration = heroElements.length > 0 ? FLIP_HERO_DURATION_MS : 0;
      const waveDuration = waveElements.length > 0 ? FLIP_WAVE_DURATION_MS + maxWaveDelay : 0;
      scheduleCleanup(Math.max(heroDuration, waveDuration));
    });
  });

  useLayoutEffect(
    () => () => {
      clearAnimation();
      previousRectsRef.current.clear();
      previousOrderRef.current = [];
      pendingRequestRef.current = null;
    },
    [clearAnimation],
  );

  return { captureVisibleKey, gridRef, requestFlip };
}

type SkillsHubPageProps = {
  settings: AppSettings;
  setSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  initialSkills?: SkillSummary[];
  initialRootDir?: string;
  isAgentMode: boolean;
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  onClose?: () => void;
  embedded?: boolean;
};

export function SkillsHubPage(props: SkillsHubPageProps) {
  const {
    settings,
    setSettings,
    initialSkills,
    initialRootDir,
    sidebarOpen,
    onOpenSidebar,
    onClose,
    embedded = false,
  } = props;
  const { t } = useLocale();
  // Skills are configuration, so their Hub remains manageable in every chat mode.
  // The chat runtime still decides whether a selected skill participates in a turn.
  const lockedByChatMode = false;

  const [skills, setSkills] = useState<SkillSummary[]>(initialSkills ?? []);
  const [rootDir, setRootDir] = useState(initialRootDir ?? "");
  const {
    captureVisibleKey: captureInstalledFlipKey,
    gridRef: installedGridRef,
    requestFlip: requestInstalledFlip,
  } = useFlipGrid();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [installedCategory, setInstalledCategory] = useState<StoreCategoryValue>("all");
  const [installedSort, setInstalledSort] = useState<InstalledSkillSort>(
    readInstalledSortPreference,
  );
  // 批量选择模式：仅在「已安装」「本地导入」页可用。用于在大量技能中快速圈选
  // 一段连续区间（点首项、Shift+点末项）而不必逐个勾选。
  const [bulkMode, setBulkMode] = useState(false);
  // Temporary multi-select set (not persisted). Independent from enable state.
  const [bulkSelection, setBulkSelection] = useState<ReadonlySet<string>>(() => new Set());
  const bulkAnchorRef = useRef<string | null>(null);
  const [bulkUndo, setBulkUndo] = useState<{ selected: string[]; count: number } | null>(null);
  const bulkUndoTimerRef = useRef<number | null>(null);
  const [view, setView] = useState<SkillsHubView>("installed");
  const [storeQuery, setStoreQuery] = useState("");
  const [storeSort, setStoreSort] = useState<ClawHubSort>("downloads");
  const [storeItems, setStoreItems] = useState<ClawHubSkillCard[]>([]);
  const [storeCursor, setStoreCursor] = useState<string | null>(null);
  const [storeLoading, setStoreLoading] = useState(false);
  const [storeLoadingMore, setStoreLoadingMore] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [installJobs, setInstallJobs] = useState<Record<string, SkillInstallJobSnapshot>>({});
  const [installingByStoreKey, setInstallingByStoreKey] = useState<Record<string, string>>({});
  const [pendingInstallKeys, setPendingInstallKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const pendingInstallTokensRef = useRef(new Map<string, symbol>());
  const [deletingSkillName, setDeletingSkillName] = useState<string | null>(null);
  const [externalScans, setExternalScans] = useState<ExternalToolScan[] | null>(null);
  const [externalLoading, setExternalLoading] = useState(false);
  const [externalError, setExternalError] = useState<string | null>(null);
  const [selectedExternal, setSelectedExternal] = useState<ReadonlySet<string>>(new Set());
  const [importQuery, setImportQuery] = useState("");
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [importErrors, setImportErrors] = useState<
    Array<{ baseDir: string; name: string; message: string }>
  >([]);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [localBundleImporting, setLocalBundleImporting] = useState(false);
  const [importToast, setImportToast] = useState<string | null>(null);
  const importToastTimerRef = useRef<number | null>(null);
  const [previewInstalledSkill, setPreviewInstalledSkill] = useState<SkillSummary | null>(null);
  const [installedPreviewState, setInstalledPreviewState] = useState<InstalledSkillPreviewState>(
    () => emptyInstalledSkillPreviewState(),
  );
  const discoverySignatureRef = useRef(
    buildSkillDiscoverySignature(initialRootDir ?? "", initialSkills ?? []),
  );

  const refresh = useCallback(
    async (options?: { silent?: boolean }) => {
      if (lockedByChatMode) {
        setSkills([]);
        setRootDir("");
        setLoadError(null);
        setLoading(false);
        discoverySignatureRef.current = buildSkillDiscoverySignature("", []);
        return;
      }
      const silent = options?.silent === true;
      if (!silent) {
        setLoading(true);
      }
      setLoadError(null);
      try {
        const discovery = await discoverSkills({ force: true });
        const signature = buildSkillDiscoverySignature(discovery.rootDir, discovery.skills);
        const changed = discoverySignatureRef.current !== signature;
        discoverySignatureRef.current = signature;
        setSkills(discovery.skills);
        setRootDir(discovery.rootDir);
        if (changed) {
          notifySkillsDiscoveryUpdated();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setSkills([]);
        setLoadError(msg || t("settings.skillsHubLoadFailed"));
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [lockedByChatMode, t],
  );

  useEffect(() => {
    if (initialSkills && initialSkills.length > 0) {
      setSkills(initialSkills);
    }
  }, [initialSkills]);

  useEffect(() => {
    if (initialRootDir) {
      setRootDir(initialRootDir);
    }
  }, [initialRootDir]);

  useEffect(() => {
    if ((initialSkills?.length ?? 0) === 0) {
      void refresh();
    }
  }, [initialSkills?.length, refresh]);

  const selected = useMemo(
    () => new Set(mergeAlwaysEnabledSkillNames(settings.skills.selected)),
    [settings.skills.selected],
  );
  const selectableSkills = useMemo(() => skills.filter(isUserSelectableSkill), [skills]);
  const selectedCount = selectableSkills.filter((skill) => selected.has(skill.name)).length;
  useEffect(() => {
    try {
      window.localStorage.setItem(INSTALLED_SORT_STORAGE_KEY, installedSort);
    } catch {
      // The preference is non-critical when storage is unavailable.
    }
  }, [installedSort]);
  const installedSkillNames = useMemo(() => new Set(skills.map((skill) => skill.name)), [skills]);
  const requestInstalledSkillFlip = useCallback(
    (mode: FlipMode, names: readonly string[], followNames: readonly string[] = names) => {
      const keys = names.map((name) => `${name}-${rootDir}`);
      const followKeys = followNames.map((name) => `${name}-${rootDir}`);
      requestInstalledFlip(mode, keys, followKeys);
    },
    [requestInstalledFlip, rootDir],
  );

  const textFilteredInstalled = useMemo(() => {
    const text = filter.trim().toLowerCase();
    if (!text) return skills;
    return skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(text) || skill.description.toLowerCase().includes(text),
    );
  }, [filter, skills]);

  // 已安装技能同样按 ClawHub 分区分类，让两个页签体验一致。始终启用（内置）
  // 技能没有真正的用途归属，统一归到 other 一栏而不参与语义分类。
  const categorizedInstalled = useMemo(
    () =>
      textFilteredInstalled.map((skill) => ({
        skill,
        categories: isAlwaysEnabledSkillName(skill.name)
          ? (["other"] as ClawHubCategorySlug[])
          : classifyInstalledSkill(skill),
      })),
    [textFilteredInstalled],
  );

  const installedCategoryCounts = useMemo(() => {
    const counts = new Map<StoreCategoryValue, number>();
    counts.set("all", categorizedInstalled.length);
    for (const { categories } of categorizedInstalled) {
      for (const category of categories) {
        counts.set(category, (counts.get(category) ?? 0) + 1);
      }
    }
    return counts;
  }, [categorizedInstalled]);

  const filtered = useMemo(
    () =>
      installedCategory === "all"
        ? categorizedInstalled
        : categorizedInstalled.filter(({ categories }) => categories.includes(installedCategory)),
    [categorizedInstalled, installedCategory],
  );
  const sortedFiltered = useMemo(
    () => sortInstalledSkillItems(filtered, installedSort, selected, ({ skill }) => skill),
    [filtered, installedSort, selected],
  );
  const filteredSelectableInstalledNames = useMemo(
    () =>
      sortedFiltered
        .map(({ skill }) => skill.name)
        .filter((name) => !isAlwaysEnabledSkillName(name)),
    [sortedFiltered],
  );
  useEffect(() => {
    if (view === "installed" && !lockedByChatMode) return;
    setPreviewInstalledSkill(null);
  }, [lockedByChatMode, view]);

  const rescanExternalSkills = useCallback(async () => {
    setExternalLoading(true);
    setExternalError(null);
    try {
      const scans = await scanExternalSkills();
      setExternalScans(scans);
      // 剔除本次扫描已不存在的勾选项，避免按钮计数虚高或静默空导入
      const validBaseDirs = new Set(scans.flatMap((scan) => scan.skills.map((s) => s.baseDir)));
      setSelectedExternal((prev) => {
        const next = new Set([...prev].filter((baseDir) => validBaseDirs.has(baseDir)));
        return next.size === prev.size ? prev : next;
      });
    } catch (err) {
      setExternalScans([]);
      setSelectedExternal(new Set());
      setExternalError(err instanceof Error ? err.message : String(err));
    } finally {
      setExternalLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view !== "import" || lockedByChatMode) return;
    if (externalScans !== null || externalLoading) return;
    void rescanExternalSkills();
  }, [view, lockedByChatMode, externalScans, externalLoading, rescanExternalSkills]);

  const externalSkillByBaseDir = useMemo(() => {
    const map = new Map<string, { baseDir: string; name: string }>();
    for (const scan of externalScans ?? []) {
      for (const skill of scan.skills) {
        map.set(skill.baseDir, { baseDir: skill.baseDir, name: skill.name });
      }
    }
    return map;
  }, [externalScans]);

  const isExternalSkillInstalled = useCallback(
    (baseDir: string) => {
      const skill = externalSkillByBaseDir.get(baseDir);
      return skill ? installedSkillNames.has(skill.name) : false;
    },
    [externalSkillByBaseDir, installedSkillNames],
  );

  const showImportToast = useCallback((message: string) => {
    if (importToastTimerRef.current !== null) {
      window.clearTimeout(importToastTimerRef.current);
    }
    setImportToast(message);
    importToastTimerRef.current = window.setTimeout(() => {
      setImportToast(null);
      importToastTimerRef.current = null;
    }, 5000);
  }, []);

  useEffect(() => {
    return () => {
      if (importToastTimerRef.current !== null) {
        window.clearTimeout(importToastTimerRef.current);
      }
    };
  }, []);

  const toggleExternalSkill = useCallback(
    (baseDir: string) => {
      // Already-installed skills cannot be selected for import.
      if (isExternalSkillInstalled(baseDir)) return;
      setSelectedExternal((prev) => {
        const next = new Set(prev);
        if (next.has(baseDir)) next.delete(baseDir);
        else next.add(baseDir);
        return next;
      });
    },
    [isExternalSkillInstalled],
  );

  // 批量区间勾选：已安装技能跳过，且不会进入 selectedExternal。
  const batchToggleExternalSkills = useCallback(
    (baseDirs: string[], on: boolean) => {
      setSelectedExternal((prev) => {
        const next = new Set(prev);
        for (const baseDir of baseDirs) {
          if (isExternalSkillInstalled(baseDir)) {
            next.delete(baseDir);
            continue;
          }
          if (on) next.add(baseDir);
          else next.delete(baseDir);
        }
        return next;
      });
    },
    [isExternalSkillInstalled],
  );

  const importSelectedExternalSkills = useCallback(async () => {
    if (importProgress) return;
    const selectedSkills = (externalScans ?? [])
      .flatMap((scan) => scan.skills)
      .filter((skill) => selectedExternal.has(skill.baseDir));
    const alreadyInstalledSelected = selectedSkills.filter((skill) =>
      installedSkillNames.has(skill.name),
    );
    const targets = selectedSkills.filter((skill) => !installedSkillNames.has(skill.name));
    if (targets.length === 0) {
      if (alreadyInstalledSelected.length > 0) {
        showImportToast(t("settings.skillsImportAlreadyInstalled"));
      }
      return;
    }
    setImportErrors([]);
    setImportedCount(null);
    const failures: Array<{ baseDir: string; name: string; message: string }> = [];
    for (let index = 0; index < targets.length; index += 1) {
      setImportProgress({ done: index, total: targets.length });
      try {
        await manageSkill({
          action: "install",
          source: targets[index].baseDir,
          conflict: "backup",
        });
      } catch (err) {
        failures.push({
          baseDir: targets[index].baseDir,
          name: targets[index].name,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    setImportProgress(null);
    setImportErrors(failures);
    setImportedCount(targets.length - failures.length);
    setSelectedExternal(new Set());
    await refresh({ silent: true });
  }, [
    externalScans,
    selectedExternal,
    importProgress,
    refresh,
    installedSkillNames,
    showImportToast,
    t,
  ]);

  const importLocalSkillBundle = useCallback(
    async (selectedFiles: File[]) => {
      if (localBundleImporting || selectedFiles.length === 0) return;
      if (selectedFiles.length > MAX_LOCAL_SKILL_BUNDLE_FILES) {
        showImportToast(
          t("settings.skillsLocalImportTooMany").replace(
            "{count}",
            String(MAX_LOCAL_SKILL_BUNDLE_FILES),
          ),
        );
        return;
      }
      const totalBytes = selectedFiles.reduce((total, file) => total + file.size, 0);
      if (totalBytes > MAX_LOCAL_SKILL_BUNDLE_BYTES) {
        showImportToast(
          t("settings.skillsLocalImportTooLarge").replace(
            "{size}",
            String(MAX_LOCAL_SKILL_BUNDLE_BYTES / (1024 * 1024)),
          ),
        );
        return;
      }

      setLocalBundleImporting(true);
      setImportErrors([]);
      setImportedCount(null);
      try {
        const files = await Promise.all(
          selectedFiles.map(async (file) => ({
            path: (file.webkitRelativePath || file.name).replace(/\\/g, "/"),
            contentBase64: await readFileAsBase64(file),
          })),
        );
        const response = await manageSkill({
          action: "import_bundle",
          conflict: "backup",
          files,
        });
        setImportedCount(response.installed?.length ?? 0);
        await refresh({ silent: true });
      } catch (error) {
        setImportErrors([
          {
            baseDir: "local-picker",
            name: t("settings.skillsLocalImport"),
            message: error instanceof Error ? error.message : String(error),
          },
        ]);
      } finally {
        setLocalBundleImporting(false);
      }
    },
    [localBundleImporting, refresh, showImportToast, t],
  );

  // Drop installed skills from import selection (cannot re-import).
  useEffect(() => {
    if (!externalScans) return;
    setSelectedExternal((prev) => {
      const next = new Set(
        [...prev].filter((baseDir) => {
          const skill = externalScans
            .flatMap((scan) => scan.skills)
            .find((item) => item.baseDir === baseDir);
          return skill ? !installedSkillNames.has(skill.name) : false;
        }),
      );
      return next.size === prev.size ? prev : next;
    });
  }, [externalScans, installedSkillNames]);

  useEffect(() => {
    if (!previewInstalledSkill) {
      setInstalledPreviewState(emptyInstalledSkillPreviewState());
      return;
    }

    let cancelled = false;
    const skillFile = previewInstalledSkill.skillFile;
    setInstalledPreviewState({
      skillFile,
      content: "",
      truncated: false,
      loading: true,
      error: null,
    });

    void readSkillText({
      path: skillFile,
      offset: 0,
      length: INSTALLED_SKILL_PREVIEW_LINES,
    })
      .then((result) => {
        if (cancelled) return;
        setInstalledPreviewState({
          skillFile,
          content: result.content,
          truncated: result.truncated,
          loading: false,
          error: null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setInstalledPreviewState({
          skillFile,
          content: previewInstalledSkill.inlineContent ?? "",
          truncated: previewInstalledSkill.inlineContentTruncated ?? false,
          loading: false,
          error: msg || t("settings.skillsInstalledPreviewUnavailable"),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [previewInstalledSkill, t]);

  const installedStoreState = useMemo(() => {
    const installed = new Map<string, SkillSummary>();
    const slugs = new Set<string>();
    for (const skill of skills) {
      if (skill.source?.registry !== "clawhub") continue;
      const slug = skill.source.slug?.trim();
      if (!slug) continue;
      slugs.add(slug);
      installed.set(
        buildClawHubSkillKey({ slug, ownerHandle: skill.source.ownerHandle ?? null }),
        skill,
      );
    }
    return { installed, slugs };
  }, [skills]);
  const completedInstallState = useMemo(() => {
    const keys = new Set<string>();
    const slugs = new Set<string>();
    for (const [storeKey, jobId] of Object.entries(installingByStoreKey)) {
      const job = installJobs[jobId];
      if (job?.phase === "done") {
        keys.add(storeKey);
        if (job.slug?.trim()) slugs.add(job.slug.trim());
      }
    }
    for (const job of Object.values(installJobs)) {
      if (job.phase === "done" && job.slug?.trim()) {
        slugs.add(job.slug.trim());
        keys.add(
          buildClawHubSkillKey({
            slug: job.slug.trim(),
            ownerHandle: job.ownerHandle ?? null,
          }),
        );
      }
    }
    return { keys, slugs };
  }, [installJobs, installingByStoreKey]);
  const installedStoreKeys = useMemo(() => {
    const keys = new Set(installedStoreState.installed.keys());
    for (const key of completedInstallState.keys) {
      keys.add(key);
    }
    return keys;
  }, [completedInstallState.keys, installedStoreState.installed]);
  const installedStoreSlugs = useMemo(() => {
    const slugs = new Set(installedStoreState.slugs);
    for (const slug of completedInstallState.slugs) {
      slugs.add(slug);
    }
    return slugs;
  }, [completedInstallState.slugs, installedStoreState.slugs]);

  useEffect(() => {
    if (view !== "store" || lockedByChatMode) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const query = storeQuery.trim();
      setStoreLoading(true);
      setStoreError(null);
      setStoreCursor(null);
      try {
        if (query) {
          const results = await searchClawHubSkills({ query, limit: STORE_PAGE_LIMIT });
          if (!cancelled) {
            setStoreItems(results);
            setStoreCursor(null);
          }
        } else {
          const results = await listClawHubSkills({
            sort: storeSort,
            limit: STORE_PAGE_LIMIT,
          });
          if (!cancelled) {
            setStoreItems(results.items);
            setStoreCursor(results.nextCursor);
          }
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setStoreItems([]);
          setStoreCursor(null);
          setStoreError(msg || t("settings.skillsHubStoreLoadFailed"));
        }
      } finally {
        if (!cancelled) {
          setStoreLoading(false);
        }
      }
    }, 260);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [lockedByChatMode, storeQuery, storeSort, t, view]);

  useEffect(() => {
    if (view !== "store" || lockedByChatMode) return;

    const syncLocalSkills = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void refresh({ silent: true });
    };

    syncLocalSkills();
    window.addEventListener("focus", syncLocalSkills);
    document.addEventListener("visibilitychange", syncLocalSkills);
    const timer = window.setInterval(syncLocalSkills, 10_000);

    return () => {
      window.removeEventListener("focus", syncLocalSkills);
      document.removeEventListener("visibilitychange", syncLocalSkills);
      window.clearInterval(timer);
    };
  }, [lockedByChatMode, refresh, view]);

  const enableInstalledSkillsFromJob = useCallback(
    (job: SkillInstallJobSnapshot) => {
      const installedNames = (job.installed ?? [])
        .map((item) => item.name?.trim())
        .filter((name): name is string => Boolean(name) && !isAlwaysEnabledSkillName(name));
      if (installedNames.length === 0) return;

      setSettings((prev) => {
        const next = new Set(prev.skills.selected);
        let changed = prev.skills.enabled !== true;
        for (const name of installedNames) {
          if (!next.has(name)) {
            next.add(name);
            changed = true;
          }
        }
        if (!changed) return prev;
        return updateSkills(prev, {
          enabled: true,
          selected: Array.from(next),
        });
      });
    },
    [setSettings],
  );

  useEffect(() => {
    const activeJobs = Object.values(installJobs).filter(
      (job) => !TERMINAL_INSTALL_PHASES.has(job.phase),
    );
    if (activeJobs.length === 0) return;

    const timer = window.setInterval(() => {
      for (const job of activeJobs) {
        void getSkillInstallJobStatus(job.jobId)
          .then((next) => {
            setInstallJobs((prev) => ({ ...prev, [next.jobId]: next }));
            if (TERMINAL_INSTALL_PHASES.has(next.phase)) {
              if (next.phase === "done") {
                enableInstalledSkillsFromJob(next);
                void refresh({ silent: true });
              }
            }
          })
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            setInstallJobs((prev) => ({
              ...prev,
              [job.jobId]: {
                ...job,
                phase: "error",
                error: msg || t("settings.skillsHubInstallStatusFailed"),
                finishedAt: Date.now(),
              },
            }));
          });
      }
    }, 600);

    return () => window.clearInterval(timer);
  }, [enableInstalledSkillsFromJob, installJobs, refresh, t]);

  async function loadMoreStore() {
    if (!storeCursor || storeLoading || storeLoadingMore || storeQuery.trim()) return;
    setStoreLoadingMore(true);
    setStoreError(null);
    try {
      const requestedLimit = Math.max(storeItems.length + STORE_PAGE_LIMIT, STORE_PAGE_LIMIT);
      const results = await listClawHubSkills({
        sort: storeSort,
        limit: requestedLimit,
      });
      const nextItems = dedupeStoreItems(results.items);
      if (nextItems.length > storeItems.length) {
        setStoreItems(nextItems);
        setStoreCursor(results.nextCursor);
      } else {
        setStoreCursor(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStoreError(msg || t("settings.skillsHubStoreLoadMoreFailed"));
    } finally {
      setStoreLoadingMore(false);
    }
  }

  async function installStoreSkill(skill: ClawHubSkillCard) {
    const initialStoreKey = buildClawHubSkillKey(skill);
    const initialJobId = installingByStoreKey[initialStoreKey];
    const initialJob = initialJobId ? installJobs[initialJobId] : undefined;
    if (
      lockedByChatMode ||
      pendingInstallTokensRef.current.has(initialStoreKey) ||
      installedStoreKeys.has(initialStoreKey) ||
      (!skill.ownerHandle && installedStoreSlugs.has(skill.slug)) ||
      (initialJob && !TERMINAL_INSTALL_PHASES.has(initialJob.phase))
    ) {
      return;
    }

    const pendingToken = Symbol(initialStoreKey);
    pendingInstallTokensRef.current.set(initialStoreKey, pendingToken);
    setPendingInstallKeys(new Set(pendingInstallTokensRef.current.keys()));
    setStoreError(null);
    try {
      const resolvedSkill = await resolveClawHubSkillOwner(skill);
      const storeKey = buildClawHubSkillKey(resolvedSkill);
      const activePendingToken = pendingInstallTokensRef.current.get(storeKey);
      if (activePendingToken && activePendingToken !== pendingToken) return;
      if (storeKey !== initialStoreKey) {
        pendingInstallTokensRef.current.set(storeKey, pendingToken);
        setPendingInstallKeys(new Set(pendingInstallTokensRef.current.keys()));
      }
      setStoreItems((prev) =>
        prev.map((item) =>
          item.slug === resolvedSkill.slug &&
          item.updatedAt === resolvedSkill.updatedAt &&
          (!item.ownerHandle || item.ownerHandle === resolvedSkill.ownerHandle)
            ? resolvedSkill
            : item,
        ),
      );
      const existingJobId = installingByStoreKey[storeKey];
      const existingJob = existingJobId ? installJobs[existingJobId] : undefined;
      if (
        installedStoreKeys.has(storeKey) ||
        (existingJob && !TERMINAL_INSTALL_PHASES.has(existingJob.phase))
      ) {
        return;
      }
      const job = await startSkillInstallJob({
        source: buildClawHubDownloadUrl(resolvedSkill.slug, resolvedSkill.ownerHandle),
        label: resolvedSkill.displayName,
        slug: resolvedSkill.slug,
        ownerHandle: resolvedSkill.ownerHandle,
        version: resolvedSkill.latestVersion,
        conflict: "backup",
      });
      setInstallJobs((prev) => ({ ...prev, [job.jobId]: job }));
      setInstallingByStoreKey((prev) => ({
        ...prev,
        [initialStoreKey]: job.jobId,
        [storeKey]: job.jobId,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStoreError(msg || t("settings.skillsHubInstallFailed"));
    } finally {
      let changed = false;
      for (const [storeKey, token] of pendingInstallTokensRef.current) {
        if (token !== pendingToken) continue;
        pendingInstallTokensRef.current.delete(storeKey);
        changed = true;
      }
      if (changed) {
        setPendingInstallKeys(new Set(pendingInstallTokensRef.current.keys()));
      }
    }
  }

  async function deleteSkill(skill: SkillSummary) {
    if (lockedByChatMode || isAlwaysEnabledSkillName(skill.name) || deletingSkillName) return;
    const skillName = skill.name;
    const sourceSlug = skill.source?.registry === "clawhub" ? skill.source.slug?.trim() || "" : "";
    const sourceOwnerHandle =
      skill.source?.registry === "clawhub" ? skill.source.ownerHandle?.trim() || null : null;
    setLoadError(null);
    setDeletingSkillName(skillName);
    try {
      await manageSkill({ action: "delete", name: skillName });
      setSettings((prev) =>
        updateSkills(prev, {
          selected: prev.skills.selected.filter((name) => name !== skillName),
        }),
      );
      setSkills((prev) => prev.filter((item) => item.name !== skillName));
      setPreviewInstalledSkill((current) => (current?.name === skillName ? null : current));
      if (sourceSlug) {
        const sourceKey = buildClawHubSkillKey({
          slug: sourceSlug,
          ownerHandle: sourceOwnerHandle,
        });
        setInstallingByStoreKey((prev) => {
          if (!(sourceKey in prev)) return prev;
          const next = { ...prev };
          delete next[sourceKey];
          return next;
        });
        setInstallJobs((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const [jobId, job] of Object.entries(prev)) {
            if (
              job.slug?.trim() === sourceSlug &&
              (!sourceOwnerHandle || job.ownerHandle?.trim() === sourceOwnerHandle)
            ) {
              delete next[jobId];
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      }
      notifySkillsDiscoveryUpdated();
      await refresh({ silent: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadError(msg || t("settings.skillsHubDeleteFailed"));
    } finally {
      setDeletingSkillName(null);
    }
  }

  function toggleSkill(name: string, on: boolean) {
    if (isAlwaysEnabledSkillName(name)) return;
    const next = new Set(settings.skills.selected);
    if (on) next.add(name);
    else next.delete(name);
    requestInstalledSkillFlip("single", [name], on ? [name] : []);
    setSettings((prev) => updateSkills(prev, { selected: Array.from(next) }));
  }

  const clearBulkUndoTimer = useCallback(() => {
    if (bulkUndoTimerRef.current !== null) {
      window.clearTimeout(bulkUndoTimerRef.current);
      bulkUndoTimerRef.current = null;
    }
  }, []);

  const exitBulkMode = useCallback(() => {
    setBulkMode(false);
    setBulkSelection(new Set());
    bulkAnchorRef.current = null;
  }, []);

  const enterBulkMode = useCallback(
    (initialName?: string) => {
      setBulkMode(true);
      setPreviewInstalledSkill(null);
      if (initialName && !isAlwaysEnabledSkillName(initialName)) {
        clearBulkUndoTimer();
        setBulkUndo(null);
        setBulkSelection(new Set([initialName]));
        bulkAnchorRef.current = initialName;
      }
    },
    [clearBulkUndoTimer],
  );

  const toggleBulkSelectionName = useCallback(
    (name: string) => {
      if (isAlwaysEnabledSkillName(name)) return;
      clearBulkUndoTimer();
      setBulkUndo(null);
      setBulkSelection((prev) => {
        const next = new Set(prev);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        return next;
      });
      bulkAnchorRef.current = name;
    },
    [clearBulkUndoTimer],
  );

  const setBulkSelectionRange = useCallback(
    (names: readonly string[], select: boolean) => {
      const selectable = names.filter((name) => !isAlwaysEnabledSkillName(name));
      if (selectable.length === 0) return;
      clearBulkUndoTimer();
      setBulkUndo(null);
      setBulkSelection((prev) => {
        const next = new Set(prev);
        for (const name of selectable) {
          if (select) next.add(name);
          else next.delete(name);
        }
        return next;
      });
    },
    [clearBulkUndoTimer],
  );

  // 批量启用/禁用：作用于 bulkSelection，成功后清空选择并弹出 Undo。
  // 副作用（Undo 快照/定时器/清空选择）都放在 setSettings 之外：
  // 传给 setSettings 的 updater 必须是纯函数（StrictMode 会双调用）。
  const applyBulkEnableState = useCallback(
    (target: boolean) => {
      const names = [...bulkSelection].filter((name) => !isAlwaysEnabledSkillName(name));
      if (names.length === 0) return;

      const before = settings.skills.selected;
      const current = new Set(before);
      const changedNames = names.filter((name) =>
        target ? !current.has(name) : current.has(name),
      );
      const changed = changedNames.length;
      if (changed === 0) return;

      requestInstalledSkillFlip("batch", changedNames, target ? changedNames : []);
      clearBulkUndoTimer();
      setBulkUndo({ selected: before, count: changed });
      bulkUndoTimerRef.current = window.setTimeout(() => {
        setBulkUndo(null);
        bulkUndoTimerRef.current = null;
      }, 6000);
      setBulkSelection(new Set());
      bulkAnchorRef.current = null;
      setSettings((prev) => {
        const next = new Set(prev.skills.selected);
        for (const name of names) {
          if (target) next.add(name);
          else next.delete(name);
        }
        return updateSkills(prev, {
          enabled: target ? true : prev.skills.enabled,
          selected: Array.from(next),
        });
      });
    },
    [
      bulkSelection,
      clearBulkUndoTimer,
      requestInstalledSkillFlip,
      setSettings,
      settings.skills.selected,
    ],
  );

  const undoBulkSelection = useCallback(() => {
    clearBulkUndoTimer();
    if (bulkUndo) {
      const restore = bulkUndo.selected;
      const current = new Set(settings.skills.selected);
      const restoreSet = new Set(restore);
      const changedNames = [...new Set([...current, ...restoreSet])].filter(
        (name) => !isAlwaysEnabledSkillName(name) && current.has(name) !== restoreSet.has(name),
      );
      const followNames = changedNames.filter((name) => restoreSet.has(name) && !current.has(name));
      requestInstalledSkillFlip("batch", changedNames, followNames);
      setSettings((prev) => updateSkills(prev, { selected: restore }));
    }
    setBulkUndo(null);
  }, [
    bulkUndo,
    clearBulkUndoTimer,
    requestInstalledSkillFlip,
    setSettings,
    settings.skills.selected,
  ]);

  async function deleteBulkSelectedInstalledSkills() {
    if (lockedByChatMode || deletingSkillName || !bulkMode) return;
    const targets = skills.filter(
      (skill) => bulkSelection.has(skill.name) && !isAlwaysEnabledSkillName(skill.name),
    );
    if (targets.length === 0) return;

    setLoadError(null);
    const failures: string[] = [];
    for (const skill of targets) {
      setDeletingSkillName(skill.name);
      try {
        await manageSkill({ action: "delete", name: skill.name });
        setSettings((prev) =>
          updateSkills(prev, {
            selected: prev.skills.selected.filter((name) => name !== skill.name),
          }),
        );
        setSkills((prev) => prev.filter((item) => item.name !== skill.name));
        setPreviewInstalledSkill((current) => (current?.name === skill.name ? null : current));
        setBulkSelection((prev) => {
          if (!prev.has(skill.name)) return prev;
          const next = new Set(prev);
          next.delete(skill.name);
          return next;
        });
        const sourceSlug =
          skill.source?.registry === "clawhub" ? skill.source.slug?.trim() || "" : "";
        const sourceOwnerHandle =
          skill.source?.registry === "clawhub" ? skill.source.ownerHandle?.trim() || null : null;
        if (sourceSlug) {
          const sourceKey = buildClawHubSkillKey({
            slug: sourceSlug,
            ownerHandle: sourceOwnerHandle,
          });
          setInstallingByStoreKey((prev) => {
            if (!(sourceKey in prev)) return prev;
            const next = { ...prev };
            delete next[sourceKey];
            return next;
          });
          setInstallJobs((prev) => {
            let changed = false;
            const next = { ...prev };
            for (const [jobId, job] of Object.entries(prev)) {
              if (
                job.slug?.trim() === sourceSlug &&
                (!sourceOwnerHandle || job.ownerHandle?.trim() === sourceOwnerHandle)
              ) {
                delete next[jobId];
                changed = true;
              }
            }
            return changed ? next : prev;
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(`${skill.name}: ${msg || t("settings.skillsHubDeleteFailed")}`);
      }
    }
    setDeletingSkillName(null);
    if (failures.length > 0) {
      setLoadError(`${t("settings.skillsHubBulkDeleteFailed")}: ${failures.join("; ")}`);
    }
    notifySkillsDiscoveryUpdated();
    await refresh({ silent: true });
  }

  useEffect(() => clearBulkUndoTimer, [clearBulkUndoTimer]);

  // 切换视图时退出批量模式并清空选择与锚点。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只需在 view 变化时触发；exitBulkMode 是稳定回调
  useEffect(() => {
    exitBulkMode();
  }, [view]);

  // Esc: clear selection first, then exit bulk mode.
  useEffect(() => {
    if (!bulkMode || lockedByChatMode) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        if (bulkSelection.size > 0) {
          setBulkSelection(new Set());
          bulkAnchorRef.current = null;
        } else {
          exitBulkMode();
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        const target = event.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
        ) {
          return;
        }
        // 「全选当前筛选」只对已安装页有定义；其余视图保留浏览器默认 Ctrl+A。
        if (view !== "installed") return;
        event.preventDefault();
        setBulkSelectionRange(filteredSelectableInstalledNames, true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    bulkMode,
    bulkSelection.size,
    exitBulkMode,
    filteredSelectableInstalledNames,
    lockedByChatMode,
    setBulkSelectionRange,
    view,
  ]);

  const bulkEnableChangeCount = useMemo(() => {
    let count = 0;
    for (const name of bulkSelection) {
      if (isAlwaysEnabledSkillName(name)) continue;
      if (!selected.has(name)) count += 1;
    }
    return count;
  }, [bulkSelection, selected]);
  const bulkDisableChangeCount = useMemo(() => {
    let count = 0;
    for (const name of bulkSelection) {
      if (isAlwaysEnabledSkillName(name)) continue;
      if (selected.has(name)) count += 1;
    }
    return count;
  }, [bulkSelection, selected]);
  const bulkDeleteNames = useMemo(
    () => [...bulkSelection].filter((name) => !isAlwaysEnabledSkillName(name)),
    [bulkSelection],
  );
  const bulkDeletePreview = useMemo(() => {
    const names = bulkDeleteNames.slice(0, 5);
    if (names.length === 0) return "";
    const rest = bulkDeleteNames.length - names.length;
    const joined = names.join(", ");
    return rest > 0
      ? t("settings.skillsHubBulkDeleteMore")
          .replace("{names}", joined)
          .replace("{count}", String(rest))
      : joined;
  }, [bulkDeleteNames, t]);

  function openInstalledSkillPreview(skill: SkillSummary) {
    setPreviewInstalledSkill(skill);
  }

  function setSkillsEnabled(enabled: boolean) {
    setSettings((prev) => updateSkills(prev, { enabled }));
  }

  const skillsEnabled = settings.skills.enabled;
  const skillsStatusHint = lockedByChatMode
    ? t("settings.skillsDisabledInChatMode")
    : skillsEnabled
      ? null
      : null;
  return (
    <VStack
      data-hub-embedded={embedded ? "true" : undefined}
      width="100%"
      height="100%"
      gap={0}
      style={{ position: "relative", minHeight: 0, overflow: "hidden" }}
    >
      {!embedded ? (
        <HubHeader
          icon={<Icon icon={Blend} size="md" color="accent" />}
          title={t("settings.skillsHubTitle")}
          subtitle={rootDir || t("settings.skillsHubSubtitle")}
          tone="amber"
          sidebarOpen={sidebarOpen}
          onOpenSidebar={onOpenSidebar}
          onClose={onClose}
        />
      ) : null}

      <StackItem size="fill">
        <Section
          padding={embedded ? 2 : 4}
          variant="transparent"
          width="100%"
          height="100%"
          style={{ minHeight: 0, overflow: "hidden" }}
        >
          <VStack height="100%" gap={3}>
            <Banner
              status={skillsEnabled ? "success" : "info"}
              title={
                skillsEnabled ? t("settings.skillsHubEnabled") : t("settings.skillsHubDisabled")
              }
              description={
                skillsStatusHint ??
                [
                  selectedCount,
                  "/",
                  selectableSkills.length,
                  t("settings.skillsHubSelectedShort"),
                ].join(" ")
              }
              collapsible={false}
              endContent={
                <HStack gap={2} vAlign="center">
                  <Switch
                    label={
                      skillsEnabled
                        ? t("settings.skillsHubToggleDisable")
                        : t("settings.skillsHubToggleEnable")
                    }
                    isLabelHidden
                    value={skillsEnabled}
                    onChange={setSkillsEnabled}
                    size="sm"
                  />
                  <AstryxCoreButton
                    label={loading ? t("settings.skillsScanning") : t("settings.skillsScan")}
                    icon={<Icon icon={RefreshCw} size="sm" color="inherit" />}
                    variant="secondary"
                    size="sm"
                    isLoading={loading}
                    isDisabled={loading}
                    onClick={() => void refresh()}
                  />
                </HStack>
              }
            />

            <HStack width="100%" gap={2} vAlign="center" hAlign="between" wrap="wrap">
              <TabList
                value={view}
                onChange={(value) => setView(value as SkillsHubView)}
                role="tablist"
                hasDivider
                overflow="scroll"
              >
                <Tab
                  value="installed"
                  label={t("settings.skillsHubInstalledTab")}
                  panelId="skills-panel-installed"
                  icon={<Icon icon={Server} size="sm" color="inherit" />}
                  endContent={
                    selectableSkills.length > 0 ? (
                      <Badge label={selectableSkills.length} />
                    ) : undefined
                  }
                />
                <Tab
                  value="store"
                  label={t("settings.skillsHubStoreTab")}
                  panelId="skills-panel-store"
                  icon={<Icon icon={Cloud} size="sm" color="inherit" />}
                />
                <Tab
                  value="import"
                  label={t("settings.skillsHubImportTab")}
                  panelId="skills-panel-import"
                  icon={<Icon icon={Download} size="sm" color="inherit" />}
                />
              </TabList>

              <HStack gap={2} vAlign="center" hAlign="end" wrap="wrap">
                {view !== "store" ? (
                  <ToggleButton
                    label={t("settings.skillsBulkSelect")}
                    isPressed={bulkMode}
                    size="sm"
                    icon={<Icon icon={ListChecks} size="sm" color="inherit" />}
                    onPressedChange={() => {
                      if (bulkMode) exitBulkMode();
                      else enterBulkMode();
                    }}
                    tooltip={
                      view === "installed"
                        ? t("settings.skillsBulkHint")
                        : t("settings.skillsBulkImportHint")
                    }
                  >
                    {bulkMode ? t("settings.skillsBulkDone") : t("settings.skillsBulkSelect")}
                  </ToggleButton>
                ) : null}
                {view === "installed" ? (
                  <Selector
                    label={t("settings.skillsInstalledSortLabel")}
                    isLabelHidden
                    value={installedSort}
                    onChange={(value) => {
                      if (!isInstalledSkillSort(value) || value === installedSort) return;
                      const followKey = captureInstalledFlipKey();
                      requestInstalledFlip("wave", [], followKey ? [followKey] : []);
                      setInstalledSort(value);
                    }}
                    options={INSTALLED_SORT_OPTIONS.map((option) => ({
                      value: option.value,
                      label: t(option.labelKey),
                    }))}
                    width="var(--xagent-hub-sort-control-width)"
                  />
                ) : null}
                <TextInput
                  label={
                    view === "installed"
                      ? t("settings.skillsSearch")
                      : view === "store"
                        ? t("settings.skillsStoreSearch")
                        : t("settings.skillsImportSearchPlaceholder")
                  }
                  isLabelHidden
                  value={
                    view === "installed" ? filter : view === "store" ? storeQuery : importQuery
                  }
                  onChange={(value) => {
                    if (view === "installed") setFilter(value);
                    else if (view === "store") setStoreQuery(value);
                    else setImportQuery(value);
                  }}
                  placeholder={
                    view === "installed"
                      ? t("settings.skillsSearch")
                      : view === "store"
                        ? t("settings.skillsStoreSearch")
                        : t("settings.skillsImportSearchPlaceholder")
                  }
                  startIcon={Search}
                  hasClear
                  width="var(--xagent-hub-search-control-width)"
                />
              </HStack>
            </HStack>

            <StackItem
              id={"skills-panel-" + view}
              role="tabpanel"
              size="fill"
              isScrollable={view === "installed"}
              aria-label={
                view === "installed"
                  ? t("settings.skillsHubInstalledTab")
                  : view === "store"
                    ? t("settings.skillsHubStoreTab")
                    : t("settings.skillsHubImportTab")
              }
            >
              {view === "installed" ? (
                <VStack gap={3}>
                  {skills.length > 0 ? (
                    <StoreCategoryChips
                      value={installedCategory}
                      counts={installedCategoryCounts}
                      onChange={setInstalledCategory}
                    />
                  ) : null}

                  {bulkMode ? (
                    <Banner
                      status="info"
                      title={t("settings.skillsBulkSelect")}
                      description={t("settings.skillsBulkHint")}
                      collapsible={false}
                    />
                  ) : null}

                  {loadError ? (
                    <Banner
                      status="error"
                      title={t("settings.skillsHubDetailLoadFailed")}
                      description={loadError}
                      collapsible={false}
                    />
                  ) : null}

                  {!skillsEnabled ? (
                    <Banner
                      status="info"
                      title={t("settings.skillsHubDisabled")}
                      description={t("settings.skillsDisabledHint")}
                      collapsible={false}
                    />
                  ) : null}

                  {loading && skills.length === 0 ? (
                    <Section padding={3} variant="transparent">
                      <VStack gap={2}>
                        <Spinner size="sm" label={t("settings.skillsScanning")} />
                        <Skeleton
                          width="100%"
                          height="var(--spacing-10)"
                          radius="rounded"
                          index={0}
                        />
                        <Skeleton
                          width="100%"
                          height="var(--spacing-10)"
                          radius="rounded"
                          index={1}
                        />
                        <Skeleton
                          width="100%"
                          height="var(--spacing-10)"
                          radius="rounded"
                          index={2}
                        />
                      </VStack>
                    </Section>
                  ) : null}

                  {!loading && skills.length === 0 && !loadError ? (
                    <VStack gap={2} hAlign="center">
                      <EmptyState
                        title={t("settings.skillsNotFound")}
                        description={t("settings.skillsNotFoundHint")}
                        icon={<Icon icon={BookOpen} size="lg" color="secondary" />}
                        isCompact
                      />
                      <AstryxCoreButton
                        label={t("settings.skillsRescan")}
                        icon={<Icon icon={RefreshCw} size="sm" color="inherit" />}
                        variant="secondary"
                        size="sm"
                        onClick={() => void refresh()}
                      />
                    </VStack>
                  ) : null}

                  {sortedFiltered.length > 0 ? (
                    <Section ref={installedGridRef} padding={0} variant="transparent">
                      <InstalledSkillsList
                        entries={sortedFiltered}
                        rootDir={rootDir}
                        selected={selected}
                        bulkSelection={bulkSelection}
                        bulkMode={bulkMode}
                        deletingSkillName={deletingSkillName}
                        onOpen={openInstalledSkillPreview}
                        onToggleSkill={toggleSkill}
                        onEnterBulk={enterBulkMode}
                        onToggleBulk={toggleBulkSelectionName}
                        onDelete={(skill) => void deleteSkill(skill)}
                        onSelectCategory={setInstalledCategory}
                      />
                    </Section>
                  ) : null}

                  {(filter.trim() || installedCategory !== "all") &&
                  sortedFiltered.length === 0 &&
                  skills.length > 0 ? (
                    <EmptyState
                      title={
                        filter.trim()
                          ? t("settings.skillsNoMatch").replace("{filter}", filter)
                          : t("settings.skillsStoreEmptyTitle")
                      }
                      icon={<Icon icon={Search} size="lg" color="secondary" />}
                      isCompact
                    />
                  ) : null}
                </VStack>
              ) : view === "store" ? (
                <SkillsStoreView
                  items={storeItems}
                  query={storeQuery}
                  sort={storeSort}
                  loading={storeLoading}
                  loadingMore={storeLoadingMore}
                  error={storeError}
                  cursor={storeCursor}
                  installedKeys={installedStoreKeys}
                  installedSlugs={installedStoreSlugs}
                  pendingInstallKeys={pendingInstallKeys}
                  installingByStoreKey={installingByStoreKey}
                  installJobs={installJobs}
                  onSortChange={setStoreSort}
                  onLoadMore={() => void loadMoreStore()}
                  onInstall={(skill) => void installStoreSkill(skill)}
                />
              ) : (
                <SkillsImportView
                  scans={externalScans ?? []}
                  loading={externalLoading}
                  error={externalError}
                  query={importQuery}
                  selected={selectedExternal}
                  installedNames={installedSkillNames}
                  importProgress={importProgress}
                  importErrors={importErrors}
                  importedCount={importedCount}
                  localBundleImporting={localBundleImporting}
                  importToast={importToast}
                  onDismissImportToast={() => {
                    if (importToastTimerRef.current !== null) {
                      window.clearTimeout(importToastTimerRef.current);
                      importToastTimerRef.current = null;
                    }
                    setImportToast(null);
                  }}
                  bulkMode={bulkMode}
                  onToggle={toggleExternalSkill}
                  onBatchToggle={batchToggleExternalSkills}
                  onRescan={() => void rescanExternalSkills()}
                  onImport={() => void importSelectedExternalSkills()}
                  onImportLocalBundle={(files) => void importLocalSkillBundle(files)}
                />
              )}
            </StackItem>

            {bulkMode && view === "installed" && (!bulkUndo || bulkSelection.size > 0) ? (
              <Section variant="muted" padding={2}>
                <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap">
                  <Text type="supporting" color="secondary">
                    {bulkSelection.size > 0
                      ? t("settings.skillsBulkSelectedCount").replace(
                          "{count}",
                          String(bulkSelection.size),
                        )
                      : t("settings.skillsBulkClickToSelect")}
                  </Text>
                  <HStack gap={1} vAlign="center" wrap="wrap">
                    <AstryxCoreButton
                      label={t("settings.skillsBulkSelectAll")}
                      variant="ghost"
                      size="sm"
                      onClick={() => setBulkSelectionRange(filteredSelectableInstalledNames, true)}
                    />
                    <AstryxCoreButton
                      label={t("settings.skillsBulkClear")}
                      variant="ghost"
                      size="sm"
                      isDisabled={bulkSelection.size === 0}
                      onClick={() => {
                        setBulkSelection(new Set());
                        bulkAnchorRef.current = null;
                      }}
                    />
                    <AstryxCoreButton
                      label={
                        t("settings.skillsBulkEnable") +
                        (bulkEnableChangeCount > 0 ? " (" + bulkEnableChangeCount + ")" : "")
                      }
                      variant="secondary"
                      size="sm"
                      isDisabled={bulkEnableChangeCount === 0}
                      onClick={() => applyBulkEnableState(true)}
                    />
                    <AstryxCoreButton
                      label={
                        t("settings.skillsBulkDisable") +
                        (bulkDisableChangeCount > 0 ? " (" + bulkDisableChangeCount + ")" : "")
                      }
                      variant="secondary"
                      size="sm"
                      isDisabled={bulkDisableChangeCount === 0}
                      onClick={() => applyBulkEnableState(false)}
                    />
                    <ConfirmActionPopover
                      title={t("settings.deleteConfirm")}
                      description={
                        t("settings.skillsHubBulkDeleteConfirm").replace(
                          "{count}",
                          String(bulkDeleteNames.length),
                        ) + (bulkDeletePreview ? " " + bulkDeletePreview : "")
                      }
                      confirmLabel={t("settings.delete")}
                      onConfirm={() => void deleteBulkSelectedInstalledSkills()}
                    >
                      {(open) => (
                        <AstryxCoreButton
                          label={
                            t("settings.skillsHubBulkDelete") +
                            (bulkDeleteNames.length > 0 ? " (" + bulkDeleteNames.length + ")" : "")
                          }
                          icon={<Icon icon={Trash2} size="sm" color="inherit" />}
                          variant="destructive"
                          size="sm"
                          isDisabled={bulkDeleteNames.length === 0 || deletingSkillName !== null}
                          onClick={open}
                        />
                      )}
                    </ConfirmActionPopover>
                    <AstryxCoreButton
                      label={t("settings.skillsBulkDone")}
                      icon={<Icon icon={X} size="sm" color="inherit" />}
                      size="sm"
                      onClick={exitBulkMode}
                    />
                  </HStack>
                </HStack>
              </Section>
            ) : null}

            {bulkUndo && bulkSelection.size === 0 ? (
              <Banner
                status="success"
                title={t("settings.skillsBulkUpdated").replace("{count}", String(bulkUndo.count))}
                collapsible={false}
                endContent={
                  <AstryxCoreButton
                    label={t("settings.skillsBulkUndo")}
                    variant="secondary"
                    size="sm"
                    onClick={undoBulkSelection}
                  />
                }
              />
            ) : null}
          </VStack>
        </Section>
      </StackItem>

      {previewInstalledSkill ? (
        <InstalledSkillPreviewDrawer
          skill={previewInstalledSkill}
          preview={installedPreviewState}
          checked={
            isAlwaysEnabledSkillName(previewInstalledSkill.name) ||
            selected.has(previewInstalledSkill.name)
          }
          skillsEnabled={skillsEnabled}
          onClose={() => setPreviewInstalledSkill(null)}
        />
      ) : null}
    </VStack>
  );
}

function SkillsImportView(props: {
  scans: ExternalToolScan[];
  loading: boolean;
  error: string | null;
  query: string;
  selected: ReadonlySet<string>;
  installedNames: ReadonlySet<string>;
  importProgress: { done: number; total: number } | null;
  importErrors: Array<{ baseDir: string; name: string; message: string }>;
  importedCount: number | null;
  localBundleImporting: boolean;
  importToast: string | null;
  onDismissImportToast: () => void;
  bulkMode: boolean;
  onToggle: (baseDir: string) => void;
  onBatchToggle: (baseDirs: string[], on: boolean) => void;
  onRescan: () => void;
  onImport: () => void;
  onImportLocalBundle: (files: File[]) => void;
}) {
  const {
    scans,
    loading,
    error,
    query,
    selected,
    installedNames,
    importProgress,
    importErrors,
    importedCount,
    localBundleImporting,
    importToast,
    onDismissImportToast,
    bulkMode,
    onToggle,
    onBatchToggle,
    onRescan,
    onImport,
    onImportLocalBundle,
  } = props;
  const { t } = useLocale();
  const bulkAnchorRef = useRef<string | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
    folderInputRef.current?.setAttribute("directory", "");
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredScans = useMemo(
    () =>
      scans.map((scan) => ({
        ...scan,
        skills: normalizedQuery
          ? scan.skills.filter(
              (skill) =>
                skill.name.toLowerCase().includes(normalizedQuery) ||
                skill.description.toLowerCase().includes(normalizedQuery),
            )
          : scan.skills,
      })),
    [scans, normalizedQuery],
  );
  const importing = importProgress !== null;
  const importableSelectedCount = useMemo(() => {
    let count = 0;
    for (const scan of scans) {
      for (const skill of scan.skills) {
        if (installedNames.has(skill.name)) continue;
        if (selected.has(skill.baseDir)) count += 1;
      }
    }
    return count;
  }, [scans, installedNames, selected]);

  const [activeTool, setActiveTool] = useState<string>(scans[0]?.tool ?? "claude-code");
  const userChoseToolRef = useRef(false);
  // 扫描结果就绪后自动定位到第一个有技能的工具；用户手动切换后不再干预
  useEffect(() => {
    if (userChoseToolRef.current || scans.length === 0) return;
    const preferred =
      scans.find((scan) => scan.skills.length > 0) ?? scans.find((scan) => scan.exists) ?? scans[0];
    if (preferred && preferred.tool !== activeTool) {
      setActiveTool(preferred.tool);
    }
  }, [scans, activeTool]);
  const activeScan = filteredScans.find((scan) => scan.tool === activeTool);
  // 「已选 X / Y」与全选按钮都只统计可导入项：已安装项不可选，不计入分子分母。
  const selectableVisibleBaseDirs = useMemo(
    () =>
      activeScan?.skills
        .filter((skill) => !installedNames.has(skill.name))
        .map((skill) => skill.baseDir) ?? [],
    [activeScan, installedNames],
  );
  const selectedSelectableVisibleCount = useMemo(
    () =>
      selectableVisibleBaseDirs.reduce(
        (count, baseDir) => count + (selected.has(baseDir) ? 1 : 0),
        0,
      ),
    [selectableVisibleBaseDirs, selected],
  );
  const allVisibleSelected =
    selectableVisibleBaseDirs.length > 0 &&
    selectedSelectableVisibleCount === selectableVisibleBaseDirs.length;

  function toggleImportSkill(baseDir: string, shiftKey: boolean) {
    if (!activeScan) return;
    const skill = activeScan.skills.find((item) => item.baseDir === baseDir);
    if (!skill || installedNames.has(skill.name) || importing) return;
    const checked = selected.has(baseDir);
    const orderedBaseDirs = activeScan.skills
      .filter((item) => !installedNames.has(item.name))
      .map((item) => item.baseDir);
    if (bulkMode && shiftKey && bulkAnchorRef.current && bulkAnchorRef.current !== baseDir) {
      const from = orderedBaseDirs.indexOf(bulkAnchorRef.current);
      const to = orderedBaseDirs.indexOf(baseDir);
      if (from !== -1 && to !== -1) {
        const [lo, hi] = from < to ? [from, to] : [to, from];
        onBatchToggle(orderedBaseDirs.slice(lo, hi + 1), !checked);
        bulkAnchorRef.current = baseDir;
        return;
      }
    }
    onToggle(baseDir);
    bulkAnchorRef.current = baseDir;
  }

  return (
    <VStack height="100%" gap={3}>
      {importToast ? (
        <Banner
          status="warning"
          title={t("settings.skillsHubImportTab")}
          description={importToast}
          collapsible={false}
          endContent={
            <IconButton
              label={t("settings.cancel")}
              tooltip={t("settings.cancel")}
              icon={<Icon icon={X} size="sm" color="inherit" />}
              variant="ghost"
              size="sm"
              onClick={onDismissImportToast}
            />
          }
        />
      ) : null}

      {error ? (
        <Banner
          status="error"
          title={t("settings.skillsImportScanFailed")}
          description={error}
          collapsible={false}
        />
      ) : null}

      {importErrors.length > 0 ? (
        <Banner
          status="error"
          title={t("settings.skillsImportFailed")}
          description={importErrors
            .map((failure) => failure.name + ": " + failure.message)
            .join("\n")}
          collapsible={false}
        />
      ) : null}

      {importedCount !== null && importedCount > 0 ? (
        <Banner
          status="success"
          title={t("settings.skillsImportDone")}
          description={String(importedCount)}
          collapsible={false}
        />
      ) : null}

      {importProgress ? (
        <ProgressBar
          label={t("settings.skillsImportProgress")}
          value={Math.min(importProgress.done + 1, importProgress.total)}
          max={importProgress.total}
          hasValueLabel
          variant="accent"
        />
      ) : null}

      {loading ? (
        <Spinner size="md" label={t("settings.skillsImportScanning")} />
      ) : (
        <>
          <HStack width="100%" gap={2} vAlign="center" hAlign="between" wrap="wrap">
            <TabList
              value={activeTool}
              onChange={(value) => {
                userChoseToolRef.current = true;
                setActiveTool(String(value));
              }}
              role="tablist"
              overflow="scroll"
            >
              {filteredScans.map((scan) => (
                <Tab
                  key={scan.tool}
                  value={scan.tool}
                  label={EXTERNAL_TOOL_LABELS[scan.tool] ?? scan.tool}
                  panelId={"skills-import-" + scan.tool}
                  icon={<Icon icon={Folder} size="sm" color="inherit" />}
                  endContent={scan.exists ? <Badge label={scan.skills.length} /> : undefined}
                />
              ))}
            </TabList>

            <HStack gap={1} vAlign="center" wrap="wrap">
              <input
                ref={folderInputRef}
                type="file"
                multiple
                aria-hidden="true"
                tabIndex={-1}
                style={{ display: "none" }}
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = "";
                  onImportLocalBundle(files);
                }}
              />
              <AstryxCoreButton
                label={t("settings.skillsLocalImport")}
                icon={<Icon icon={Folder} size="sm" color="inherit" />}
                variant="secondary"
                size="sm"
                isLoading={localBundleImporting}
                isDisabled={loading || importing || localBundleImporting}
                onClick={() => folderInputRef.current?.click()}
              />
              <AstryxCoreButton
                label={t("settings.skillsImportRescan")}
                icon={<Icon icon={RefreshCw} size="sm" color="inherit" />}
                variant="secondary"
                size="sm"
                isDisabled={loading || importing}
                onClick={onRescan}
              />
              {!bulkMode ? (
                <AstryxCoreButton
                  label={
                    t("settings.skillsImportButton") +
                    (importableSelectedCount > 0 ? " (" + importableSelectedCount + ")" : "")
                  }
                  icon={<Icon icon={Download} size="sm" color="inherit" />}
                  size="sm"
                  isLoading={importing}
                  isDisabled={selected.size === 0 || importing || loading}
                  onClick={onImport}
                />
              ) : null}
            </HStack>
          </HStack>

          {bulkMode ? (
            <Banner
              status="info"
              title={t("settings.skillsBulkSelect")}
              description={t("settings.skillsBulkImportHint")}
              collapsible={false}
            />
          ) : null}

          {activeScan ? (
            <VStack
              id={"skills-import-" + activeScan.tool}
              role="tabpanel"
              gap={2}
              style={{ minHeight: 0 }}
            >
              <HStack gap={1} vAlign="center" wrap="wrap">
                <Token
                  label={activeScan.rootDir}
                  color="gray"
                  size="sm"
                  icon={<Icon icon={Folder} size="sm" color="inherit" />}
                />
                {!activeScan.exists ? (
                  <Token label={t("settings.skillsImportNotDetected")} color="orange" size="sm" />
                ) : null}
                {activeScan.errors.length > 0 ? (
                  <Token
                    label={t("settings.skillsImportUnparsable").replace(
                      "{count}",
                      String(activeScan.errors.length),
                    )}
                    color="orange"
                    size="sm"
                  />
                ) : null}
                {activeScan.tool === "codebuddy" && activeScan.exists ? (
                  <Token label={t("settings.skillsImportCodebuddyHint")} color="blue" size="sm" />
                ) : null}
              </HStack>

              {!activeScan.exists ? (
                <EmptyState
                  title={t("settings.skillsImportNotDetected")}
                  description={activeScan.rootDir}
                  icon={<Icon icon={Folder} size="lg" color="secondary" />}
                  isCompact
                />
              ) : activeScan.skills.length === 0 ? (
                <EmptyState
                  title={t("settings.skillsImportEmpty")}
                  icon={<Icon icon={Folder} size="lg" color="secondary" />}
                  isCompact
                />
              ) : (
                <>
                  <HStack width="100%" gap={2} vAlign="center" hAlign="between" wrap="wrap">
                    <Text type="supporting" color="secondary" hasTabularNumbers>
                      {t("settings.skillsHubSelectedShort")} {selectedSelectableVisibleCount} /{" "}
                      {selectableVisibleBaseDirs.length}
                    </Text>
                    <CheckboxInput
                      label={
                        allVisibleSelected
                          ? t("settings.skillsImportDeselectAll")
                          : t("settings.skillsImportSelectAll")
                      }
                      value={allVisibleSelected}
                      isDisabled={importing || selectableVisibleBaseDirs.length === 0}
                      onChange={() => onBatchToggle(selectableVisibleBaseDirs, !allVisibleSelected)}
                      size="sm"
                    />
                  </HStack>

                  <StackItem size="fill" isScrollable>
                    <List density="balanced" hasDividers>
                      {activeScan.skills.map((skill) => {
                        const alreadyInstalled = installedNames.has(skill.name);
                        const checked = !alreadyInstalled && selected.has(skill.baseDir);
                        return (
                          <ListItem
                            key={skill.baseDir}
                            label={skill.name}
                            startContent={
                              <Icon
                                icon={SkillIcon}
                                size="md"
                                color={checked ? "accent" : "secondary"}
                              />
                            }
                            description={
                              <VStack gap={1}>
                                <Text type="supporting" color="secondary" maxLines={2}>
                                  {skill.description}
                                </Text>
                                <Text type="code" color="secondary" maxLines={1}>
                                  {skill.baseDir}
                                </Text>
                              </VStack>
                            }
                            endContent={
                              alreadyInstalled ? (
                                <Token
                                  label={t("settings.skillsImportInstalledBadge")}
                                  color="green"
                                  size="sm"
                                  icon={<Icon icon={Check} size="sm" color="inherit" />}
                                />
                              ) : (
                                <CheckboxInput
                                  label={skill.name}
                                  isLabelHidden
                                  value={checked}
                                  isDisabled={importing}
                                  onChange={(_value, event) => {
                                    const nativeEvent = event.nativeEvent;
                                    const shiftKey =
                                      nativeEvent instanceof MouseEvent && nativeEvent.shiftKey;
                                    toggleImportSkill(skill.baseDir, shiftKey);
                                  }}
                                  size="sm"
                                />
                              )
                            }
                          />
                        );
                      })}
                    </List>
                  </StackItem>
                </>
              )}
            </VStack>
          ) : null}
        </>
      )}

      {bulkMode ? (
        <Section variant="muted" padding={2}>
          <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap">
            <Text type="supporting" color="secondary">
              {importableSelectedCount > 0
                ? t("settings.skillsBulkSelectedCount").replace(
                    "{count}",
                    String(importableSelectedCount),
                  )
                : t("settings.skillsBulkClickToSelect")}
            </Text>
            <AstryxCoreButton
              label={
                t("settings.skillsBulkImportAction") +
                (importableSelectedCount > 0 ? " (" + importableSelectedCount + ")" : "")
              }
              icon={<Icon icon={Download} size="sm" color="inherit" />}
              size="sm"
              isLoading={importing}
              isDisabled={importableSelectedCount === 0 || importing || loading}
              onClick={onImport}
            />
          </HStack>
        </Section>
      ) : null}
    </VStack>
  );
}

function InstalledSkillPreviewDrawer(props: {
  skill: SkillSummary;
  preview: InstalledSkillPreviewState;
  checked: boolean;
  skillsEnabled: boolean;
  onClose: () => void;
}) {
  const { skill, preview, checked, skillsEnabled, onClose } = props;
  const { t } = useLocale();
  const alwaysEnabled = isAlwaysEnabledSkillName(skill.name);
  const source = skill.source;
  const description = skill.description.trim();
  const previewIsMarkdown = /\.(md|mdx|markdown)$/i.test(skill.skillFile);
  const previewContent = stripInstalledSkillPreviewMetadata(preview.content, skill);
  const statusLabel = alwaysEnabled
    ? t("settings.skillsInstalledPreviewBuiltIn")
    : checked
      ? t("settings.skillsInstalledPreviewSelected")
      : t("settings.skillsInstalledPreviewUnselected");

  const isCompact = useMediaQuery(
    "(max-width: 768px), (max-width: 1024px) and (pointer: coarse) and (hover: none)",
  );

  return (
    <Dialog
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      aria-label={t("settings.skillsInstalledPreviewTitle")}
      purpose="info"
      variant={isCompact ? "fullscreen" : "standard"}
      width={isCompact ? "100dvw" : "min(var(--xagent-drawer-width), 40dvw)"}
      padding={0}
      style={{
        marginInlineStart: "auto",
        marginInlineEnd: 0,
        blockSize: "var(--xagent-viewport-height)",
        maxBlockSize: "var(--xagent-viewport-height)",
        ...(isCompact
          ? {}
          : { borderRadius: "var(--radius-container) 0 0 var(--radius-container)" }),
      }}
    >
      <AstryxView as="aside" className="flex h-full w-full flex-col">
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="flex items-start gap-3 border-b border-border/40 px-5 py-4"
        >
          <AstryxView
            layout="flex"
            direction="horizontal"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-border/55 bg-background/80 text-foreground/85 shadow-[0_1px_0_rgba(255,255,255,0.55)_inset] dark:border-white/[0.09] dark:bg-white/[0.06] dark:shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]"
          >
            {alwaysEnabled ? <Lock className="h-5 w-5" /> : <SkillIcon className="h-7 w-7" />}
          </AstryxView>
          <AstryxView layout="block" direction="horizontal" className="min-w-0 flex-1">
            <AstryxView
              layout="block"
              direction="horizontal"
              className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80"
            >
              {t("settings.skillsInstalledPreviewTitle")}
            </AstryxView>
            <AstryxHeading
              level={2}
              className="mt-1 truncate text-base font-semibold tracking-tight text-foreground"
            >
              {skill.name}
            </AstryxHeading>
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-muted-foreground"
            >
              <AstryxView
                as="span"
                layout="inline-flex"
                direction="horizontal"
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium ring-1",
                  alwaysEnabled
                    ? "bg-foreground/[0.06] text-foreground/75 ring-border/45"
                    : checked
                      ? "bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300"
                      : "bg-muted/45 text-muted-foreground ring-border/35",
                )}
              >
                {statusLabel}
              </AstryxView>
              {source?.version ? <AstryxInline>v{source.version}</AstryxInline> : null}
            </AstryxView>
          </AstryxView>
          <AstryxButton
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
            title={t("settings.cronViewClose")}
          >
            <X className="h-4 w-4" />
          </AstryxButton>
        </AstryxView>

        <AstryxView
          layout="block"
          direction="horizontal"
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
        >
          <AstryxView layout="flex" direction="vertical" className="flex flex-col gap-4">
            <AstryxView layout="grid" direction="horizontal" className="grid gap-3">
              <AstryxView
                layout="block"
                direction="horizontal"
                className="rounded-2xl border border-border/40 bg-background/70 p-3.5 shadow-[0_1px_0_rgba(255,255,255,0.55)_inset] dark:border-white/[0.07] dark:bg-white/[0.05] dark:shadow-[0_1px_0_rgba(255,255,255,0.05)_inset]"
              >
                <AstryxView layout="flex" direction="horizontal" className="flex items-start gap-3">
                  <AstryxView
                    layout="flex"
                    direction="horizontal"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border/45 bg-background/80 text-foreground/75"
                  >
                    <SkillIcon className="h-5 w-5" />
                  </AstryxView>
                  <AstryxView layout="block" direction="horizontal" className="min-w-0 flex-1">
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/70"
                    >
                      {t("settings.skillsInstalledPreviewName")}
                    </AstryxView>
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="mt-1 break-words text-[15px] font-semibold leading-snug text-foreground"
                    >
                      {skill.name}
                    </AstryxView>
                  </AstryxView>
                </AstryxView>
              </AstryxView>

              <AstryxView
                layout="block"
                direction="horizontal"
                className="rounded-2xl border border-border/40 bg-background/60 p-3.5 shadow-[0_1px_0_rgba(255,255,255,0.5)_inset] dark:border-white/[0.06] dark:bg-white/[0.04] dark:shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]"
              >
                <AstryxView layout="flex" direction="horizontal" className="flex items-start gap-3">
                  <AstryxView
                    layout="flex"
                    direction="horizontal"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border/40 bg-muted/35 text-muted-foreground"
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                  </AstryxView>
                  <AstryxView layout="block" direction="horizontal" className="min-w-0 flex-1">
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/70"
                    >
                      {t("settings.skillsInstalledPreviewDescription")}
                    </AstryxView>
                    <AstryxParagraph className="mt-1.5 text-[13px] leading-6 text-muted-foreground">
                      {description || t("settings.skillsInstalledPreviewNoDescription")}
                    </AstryxParagraph>
                    <AstryxView
                      layout="flex"
                      direction="horizontal"
                      className="mt-2 flex justify-end"
                    >
                      <SkillPreviewCopyButton
                        value={description}
                        label={t("settings.skillsInstalledPreviewCopyDescription")}
                      />
                    </AstryxView>
                  </AstryxView>
                </AstryxView>
              </AstryxView>
            </AstryxView>

            {!skillsEnabled ? (
              <AstryxView
                layout="block"
                direction="horizontal"
                className="rounded-2xl border border-border/40 bg-muted/35 p-3"
              >
                <AstryxView
                  layout="flex"
                  direction="horizontal"
                  className="flex items-start gap-2 text-[12px] text-muted-foreground"
                >
                  <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/65" />
                  <AstryxInline>{t("settings.skillsDisabledHint")}</AstryxInline>
                </AstryxView>
              </AstryxView>
            ) : null}

            <AstryxView
              layout="block"
              direction="horizontal"
              className="rounded-2xl border border-border/40 bg-background/60 p-3"
            >
              <AstryxView
                layout="block"
                direction="horizontal"
                className="mb-2 text-[12px] font-semibold text-foreground"
              >
                {t("settings.skillsInstalledPreviewDetails")}
              </AstryxView>
              <AstryxView
                layout="block"
                direction="horizontal"
                className="divide-y divide-border/30"
              >
                <StorePreviewField
                  label={t("settings.skillsInstalledPreviewBaseDir")}
                  value={skill.baseDir}
                />
                <StorePreviewField
                  label={t("settings.skillsInstalledPreviewSkillFile")}
                  value={skill.skillFile}
                />
                <StorePreviewField
                  label={t("settings.skillsInstalledPreviewSource")}
                  value={source?.registry}
                />
                <StorePreviewField
                  label={t("settings.skillsStorePreviewSlug")}
                  value={source?.slug}
                />
                <StorePreviewField
                  label={t("settings.skillsStorePreviewVersion")}
                  value={source?.version}
                />
                <StorePreviewField
                  label={t("settings.skillsInstalledPreviewPublished")}
                  value={source?.publishedAt ? formatFullStoreDate(source.publishedAt) : null}
                />
              </AstryxView>
            </AstryxView>

            <AstryxView
              layout="block"
              direction="horizontal"
              className="rounded-2xl border border-border/40 bg-background/60 p-3"
            >
              <AstryxView
                layout="flex"
                direction="horizontal"
                className="mb-2 flex items-center justify-between gap-3"
              >
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="text-[12px] font-semibold text-foreground"
                >
                  {t("settings.skillsInstalledPreviewFilePreview")}
                </AstryxView>
                <AstryxView
                  layout="flex"
                  direction="horizontal"
                  className="flex min-w-0 items-center gap-1"
                >
                  <AstryxView
                    layout="block"
                    direction="horizontal"
                    className="truncate text-[10.5px] text-muted-foreground/70"
                  >
                    {preview.skillFile || skill.skillFile}
                  </AstryxView>
                  <SkillPreviewCopyButton
                    value={previewContent}
                    label={t("settings.skillsInstalledPreviewCopyFile")}
                  />
                </AstryxView>
              </AstryxView>

              {preview.loading ? (
                <InstalledPreviewSkeleton />
              ) : (
                <>
                  {preview.error ? (
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="rounded-xl border border-border/35 bg-muted/35 p-3"
                    >
                      <AstryxView
                        layout="flex"
                        direction="horizontal"
                        className="flex items-start gap-2 text-[12px] text-muted-foreground"
                      >
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/65" />
                        <AstryxView layout="block" direction="horizontal" className="min-w-0">
                          <AstryxView layout="block" direction="horizontal">
                            {t("settings.skillsInstalledPreviewUnavailable")}
                          </AstryxView>
                          <AstryxView
                            layout="block"
                            direction="horizontal"
                            className="mt-1 break-words text-[11px] opacity-75"
                          >
                            {preview.error}
                          </AstryxView>
                        </AstryxView>
                      </AstryxView>
                    </AstryxView>
                  ) : null}

                  {previewContent ? (
                    previewIsMarkdown ? (
                      <Markdown
                        content={previewContent}
                        className="text-[12px] leading-5 text-muted-foreground"
                      />
                    ) : (
                      <pre className="max-h-[24rem] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-muted/35 p-3 font-mono text-[11px] leading-5 text-muted-foreground">
                        {previewContent}
                      </pre>
                    )
                  ) : preview.error ? null : (
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="rounded-xl border border-border/35 bg-muted/30 p-3 text-[12px] text-muted-foreground"
                    >
                      {t("settings.skillsInstalledPreviewEmpty")}
                    </AstryxView>
                  )}

                  {preview.truncated ? (
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="mt-2 rounded-xl border border-border/35 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground"
                    >
                      {t("settings.skillsInstalledPreviewTruncated").replace(
                        "{count}",
                        String(INSTALLED_SKILL_PREVIEW_LINES),
                      )}
                    </AstryxView>
                  ) : null}
                </>
              )}
            </AstryxView>
          </AstryxView>
        </AstryxView>
      </AstryxView>
    </Dialog>
  );
}

function SkillPreviewCopyButton(props: { value: string; label: string }) {
  const { value, label } = props;
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (!value || !(await copyText(value))) return;
    setCopied(true);
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      resetTimerRef.current = null;
    }, COPY_FEEDBACK_MS);
  }, [value]);

  const accessibleLabel = copied ? t("settings.skillsInstalledPreviewCopied") : label;

  return (
    <AstryxButton
      type="button"
      disabled={!value}
      aria-label={accessibleLabel}
      title={accessibleLabel}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 disabled:pointer-events-none disabled:opacity-35"
      onClick={() => void handleCopy()}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </AstryxButton>
  );
}

function InstalledPreviewSkeleton() {
  return (
    <AstryxView layout="block" direction="horizontal" className="space-y-2">
      <Skeleton
        width="100%"
        height="calc(var(--spacing-2) + var(--spacing-0-5))"
        radius="rounded"
        index={0}
      />
      <Skeleton
        width="91.666%"
        height="calc(var(--spacing-2) + var(--spacing-0-5))"
        radius="rounded"
        index={1}
      />
      <Skeleton
        width="80%"
        height="calc(var(--spacing-2) + var(--spacing-0-5))"
        radius="rounded"
        index={2}
      />
      <Skeleton
        width="66.666%"
        height="calc(var(--spacing-2) + var(--spacing-0-5))"
        radius="rounded"
        index={3}
      />
    </AstryxView>
  );
}

function StoreCategoryChips(props: {
  value: StoreCategoryValue;
  counts: ReadonlyMap<StoreCategoryValue, number>;
  onChange: (value: StoreCategoryValue) => void;
}) {
  const { t } = useLocale();
  return (
    <HStack gap={1} vAlign="center" wrap="wrap">
      {STORE_CATEGORY_OPTIONS.map((value) => {
        const CategoryIcon = STORE_CATEGORY_ICONS[value];
        return (
          <ToggleButton
            key={value}
            label={t(storeCategoryLabelKey(value))}
            icon={<Icon icon={CategoryIcon} size="sm" color="inherit" />}
            isPressed={props.value === value}
            size="sm"
            onPressedChange={() => props.onChange(value)}
          >
            <HStack gap={1} vAlign="center">
              <Text type="inherit" color="inherit">
                {t(storeCategoryLabelKey(value))}
              </Text>
              <Badge label={props.counts.get(value) ?? 0} />
            </HStack>
          </ToggleButton>
        );
      })}
    </HStack>
  );
}

function SkillCategoryBadges(props: {
  categories: ClawHubCategorySlug[];
  topics?: string[];
  onSelect: (category: ClawHubCategorySlug) => void;
}) {
  const { t } = useLocale();
  return (
    <HStack gap={1} vAlign="center" wrap="wrap">
      {props.categories.map((category) => {
        return (
          <Token
            key={category}
            label={t(storeCategoryLabelKey(category))}
            color="gray"
            size="sm"
            icon={<Icon icon={STORE_CATEGORY_ICONS[category]} size="sm" color="inherit" />}
            onClick={() => props.onSelect(category)}
          />
        );
      })}
      {(props.topics ?? []).slice(0, 3).map((topic) => (
        <Token key={topic} label={topic} color="gray" size="sm" />
      ))}
    </HStack>
  );
}

function SkillsStoreView(props: {
  items: ClawHubSkillCard[];
  query: string;
  sort: ClawHubSort;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  cursor: string | null;
  installedKeys: Set<string>;
  installedSlugs: Set<string>;
  pendingInstallKeys: ReadonlySet<string>;
  installingByStoreKey: Record<string, string>;
  installJobs: Record<string, SkillInstallJobSnapshot>;
  onSortChange: (value: ClawHubSort) => void;
  onLoadMore: () => void;
  onInstall: (skill: ClawHubSkillCard) => void;
}) {
  const {
    items,
    query,
    sort,
    loading,
    loadingMore,
    error,
    cursor,
    installedKeys,
    installedSlugs,
    pendingInstallKeys,
    installingByStoreKey,
    installJobs,
    onSortChange,
    onLoadMore,
    onInstall,
  } = props;
  const { t } = useLocale();
  const searching = query.trim().length > 0;
  const refreshing = loading && items.length > 0;
  const [previewSkill, setPreviewSkill] = useState<ClawHubSkillCard | null>(null);
  const [previewDetail, setPreviewDetail] = useState<ClawHubSkillDetail | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [storeCategory, setStoreCategory] = useState<StoreCategoryValue>("all");

  const categorizedItems = useMemo(
    () =>
      items.map((skill) => ({
        skill,
        categories: classifyClawHubSkill(skill),
      })),
    [items],
  );

  const categoryCounts = useMemo(() => {
    const counts = new Map<StoreCategoryValue, number>();
    counts.set("all", categorizedItems.length);
    for (const { categories } of categorizedItems) {
      for (const category of categories) {
        counts.set(category, (counts.get(category) ?? 0) + 1);
      }
    }
    return counts;
  }, [categorizedItems]);

  const filteredItems = useMemo(
    () =>
      storeCategory === "all"
        ? categorizedItems
        : categorizedItems.filter(({ categories }) => categories.includes(storeCategory)),
    [categorizedItems, storeCategory],
  );

  // 分类是本地过滤：选中分类后结果太少且还有下一页时自动补页，
  // 避免出现"一屏只剩两张卡"的稀疏页面。
  useEffect(() => {
    if (storeCategory === "all" || searching) return;
    if (!cursor || loading || loadingMore) return;
    if (filteredItems.length >= STORE_CATEGORY_FILL_TARGET) return;
    onLoadMore();
  }, [cursor, filteredItems.length, loading, loadingMore, onLoadMore, searching, storeCategory]);

  useEffect(() => {
    if (!previewSkill) {
      setPreviewDetail(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }

    let cancelled = false;
    setPreviewDetail(null);
    setPreviewError(null);
    setPreviewLoading(true);

    void resolveClawHubSkillOwner(previewSkill)
      .then((resolvedSkill) => {
        if (
          !cancelled &&
          buildClawHubSkillKey(resolvedSkill) !== buildClawHubSkillKey(previewSkill)
        ) {
          setPreviewSkill(resolvedSkill);
        }
        return getClawHubSkillDetail(resolvedSkill.slug, resolvedSkill.ownerHandle);
      })
      .then((detail) => {
        if (!cancelled) {
          setPreviewDetail(detail);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setPreviewError(msg || t("settings.skillsHubDetailLoadFailed"));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPreviewLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [previewSkill, t]);

  function getInstallState(skill: ClawHubSkillCard): StoreSkillInstallState {
    const storeKey = buildClawHubSkillKey(skill);
    const pending = pendingInstallKeys.has(storeKey);
    const jobId = installingByStoreKey[storeKey];
    const job = jobId ? installJobs[jobId] : undefined;
    const terminalJob = Boolean(job && TERMINAL_INSTALL_PHASES.has(job.phase));
    const done =
      installedKeys.has(storeKey) ||
      (!skill.ownerHandle && installedSlugs.has(skill.slug)) ||
      job?.phase === "done";
    return {
      done,
      installing: pending || Boolean(job && !terminalJob),
      pending,
      terminalJob,
      job,
      progress: pending ? null : job ? getInstallProgressPercent(job) : null,
    };
  }

  return (
    <VStack height="100%" gap={3}>
      <HStack width="100%" gap={2} vAlign="center" hAlign="between" wrap="wrap">
        <StackItem size="fill">
          <StoreCategoryChips
            value={storeCategory}
            counts={categoryCounts}
            onChange={setStoreCategory}
          />
        </StackItem>
        <Selector
          label={t("settings.skillsStoreSortLabel")}
          isLabelHidden
          value={sort}
          options={STORE_SORT_OPTIONS.map((option) => ({
            value: option.value,
            label: t(option.labelKey),
          }))}
          width="var(--xagent-hub-sort-control-width)"
          isDisabled={searching}
          onChange={(value) => onSortChange(value as ClawHubSort)}
        />
        {refreshing ? <Spinner size="sm" label={t("settings.skillsStoreLoadingTitle")} /> : null}
      </HStack>

      {error ? (
        <Banner
          status="error"
          title={t("settings.skillsStoreEmptyTitle")}
          description={error}
          collapsible={false}
        />
      ) : null}

      <StackItem size="fill" isScrollable>
        <VStack gap={2}>
          {loading && items.length === 0 ? (
            <Section padding={3} variant="transparent">
              <VStack gap={2}>
                <Skeleton width="35%" height="var(--spacing-4)" radius="rounded" index={0} />
                <Skeleton width="100%" height="var(--spacing-10)" radius="rounded" index={1} />
                <Skeleton width="100%" height="var(--spacing-10)" radius="rounded" index={2} />
                <Skeleton width="100%" height="var(--spacing-10)" radius="rounded" index={3} />
              </VStack>
            </Section>
          ) : null}

          {!loading && items.length === 0 && !error ? (
            <EmptyState
              title={t("settings.skillsStoreEmptyTitle")}
              description={t("settings.skillsStoreEmptyDesc")}
              icon={<Icon icon={Cloud} size="lg" color="secondary" />}
              isCompact
            />
          ) : null}

          {filteredItems.length > 0 ? (
            <List
              density="balanced"
              hasDividers
              header={
                <HStack gap={1} vAlign="center">
                  <Text type="supporting" color="secondary" hasTabularNumbers>
                    {filteredItems.length}
                  </Text>
                  <Text type="supporting" color="secondary">
                    {t("settings.skillsHubStoreTab")}
                  </Text>
                </HStack>
              }
            >
              {filteredItems.map(({ skill, categories }) => {
                const { done, installing, pending, job, progress } = getInstallState(skill);
                const link = buildClawHubSkillUrl(skill);
                const PrimaryCategoryIcon = STORE_CATEGORY_ICONS[categories[0] ?? "other"];
                const installLabel = installing
                  ? installPhaseLabel(pending ? undefined : job, t)
                  : done
                    ? t("settings.skillsStoreInstalled")
                    : t("settings.skillsStoreInstall");
                const stats = [
                  formatCompactNumber(skill.downloads) +
                    " " +
                    t("settings.skillsStorePreviewDownloads"),
                  formatCompactNumber(skill.stars) + " " + t("settings.skillsStorePreviewStars"),
                  formatCompactNumber(skill.installsCurrent) +
                    " " +
                    t("settings.skillsStorePreviewInstalls"),
                  skill.updatedAt ? formatStoreDate(skill.updatedAt) : "",
                ]
                  .filter(Boolean)
                  .join(" · ");

                return (
                  <ListItem
                    key={buildClawHubSkillKey(skill)}
                    label={skill.displayName}
                    startContent={
                      <Icon
                        icon={PrimaryCategoryIcon}
                        size="md"
                        color={done ? "success" : "secondary"}
                      />
                    }
                    description={
                      <VStack gap={1}>
                        {skill.summary ? (
                          <Text type="supporting" color="secondary" maxLines={2}>
                            {skill.summary}
                          </Text>
                        ) : null}
                        <SkillCategoryBadges
                          categories={categories}
                          topics={skill.topics}
                          onSelect={setStoreCategory}
                        />
                        <Text type="supporting" color="secondary" hasTabularNumbers>
                          {stats}
                        </Text>
                        {installing && !done ? (
                          <ProgressBar
                            label={installLabel}
                            value={progress ?? 0}
                            isIndeterminate={progress === null}
                            hasValueLabel={progress !== null}
                            variant="accent"
                          />
                        ) : null}
                        {job?.phase === "error" && job.error && !done && !pending ? (
                          <HStack gap={1} vAlign="center">
                            <Token label={t("settings.skillsImportError")} color="red" size="sm" />
                            <Text type="supporting" color="secondary" maxLines={2}>
                              {job.error}
                            </Text>
                          </HStack>
                        ) : null}
                      </VStack>
                    }
                    endContent={
                      <HStack gap={1} vAlign="center" wrap="wrap">
                        <Token
                          label={
                            "v" + (skill.latestVersion ?? t("settings.skillsStoreVersionLatest"))
                          }
                          color="gray"
                          size="sm"
                        />
                        {done ? (
                          <Token
                            label={t("settings.skillsStoreInstalled")}
                            color="green"
                            size="sm"
                            icon={<Icon icon={Check} size="sm" color="inherit" />}
                          />
                        ) : null}
                        {link ? (
                          <IconButton
                            href={link}
                            target="_blank"
                            rel="noreferrer"
                            label={t("settings.skillsStoreOpenInClawHub")}
                            tooltip={t("settings.skillsStoreOpenInClawHub")}
                            icon={<Icon icon={ExternalLink} size="sm" color="inherit" />}
                            variant="ghost"
                            size="sm"
                          />
                        ) : null}
                        <IconButton
                          label={t("settings.skillsStorePreviewTitle")}
                          tooltip={t("settings.skillsStorePreviewTitle")}
                          icon={<Icon icon={FileText} size="sm" color="inherit" />}
                          variant="ghost"
                          size="sm"
                          onClick={() => setPreviewSkill(skill)}
                        />
                        {job && !pending && installing ? (
                          <IconButton
                            label={t("settings.cancel")}
                            tooltip={t("settings.cancel")}
                            icon={<Icon icon={X} size="sm" color="inherit" />}
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              void cancelSkillInstallJob(job.jobId).catch(() => undefined)
                            }
                          />
                        ) : null}
                        <AstryxCoreButton
                          label={installLabel}
                          icon={<Icon icon={done ? Check : Cloud} size="sm" color="inherit" />}
                          variant={done ? "secondary" : "primary"}
                          size="sm"
                          isLoading={installing}
                          isDisabled={done || installing}
                          aria-busy={installing}
                          onClick={() => onInstall(skill)}
                        />
                      </HStack>
                    }
                  />
                );
              })}
            </List>
          ) : null}

          {items.length > 0 && filteredItems.length === 0 && !loading ? (
            <EmptyState
              title={t("settings.skillsStoreEmptyTitle")}
              description={t("settings.skillsStoreEmptyDesc")}
              icon={<Icon icon={Search} size="lg" color="secondary" />}
              isCompact
            />
          ) : null}

          {cursor && !searching ? (
            <HStack hAlign="center">
              <AstryxCoreButton
                label={
                  loadingMore
                    ? t("settings.skillsStoreLoadingMore")
                    : t("settings.skillsStoreLoadMore")
                }
                icon={<Icon icon={RefreshCw} size="sm" color="inherit" />}
                variant="secondary"
                size="sm"
                isLoading={loadingMore}
                isDisabled={loadingMore}
                onClick={onLoadMore}
              />
            </HStack>
          ) : null}
        </VStack>
      </StackItem>

      {previewSkill ? (
        <SkillsStorePreviewDrawer
          skill={previewSkill}
          detail={previewDetail}
          loading={previewLoading}
          error={previewError}
          installState={getInstallState(previewSkill)}
          onClose={() => setPreviewSkill(null)}
          onInstall={() => onInstall(previewSkill)}
        />
      ) : null}
    </VStack>
  );
}

function SkillsStorePreviewDrawer(props: {
  skill: ClawHubSkillCard;
  detail: ClawHubSkillDetail | null;
  loading: boolean;
  error: string | null;
  installState: StoreSkillInstallState;
  onClose: () => void;
  onInstall: () => void;
}) {
  const { skill, detail, loading, error, installState, onClose, onInstall } = props;
  const { t } = useLocale();
  const data = detail ?? skill;
  const link = data.webUrl ?? buildClawHubSkillUrl(data);
  const version = data.latestVersion ?? t("settings.skillsStoreVersionLatest");
  const owner = detail?.ownerDisplayName ?? data.ownerHandle;
  const supportedOs = detail?.supportedOs ?? [];
  const supportedSystems = detail?.supportedSystems ?? [];
  const actionLabel = installState.installing
    ? installPhaseLabel(installState.pending ? undefined : installState.job, t)
    : installState.done
      ? t("settings.skillsStoreInstalled")
      : t("settings.skillsStoreInstall");

  const isCompact = useMediaQuery(
    "(max-width: 768px), (max-width: 1024px) and (pointer: coarse) and (hover: none)",
  );

  return (
    <Dialog
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      aria-label={t("settings.skillsStorePreviewTitle")}
      purpose="info"
      variant={isCompact ? "fullscreen" : "standard"}
      width={isCompact ? "100dvw" : "min(var(--xagent-drawer-width), 40dvw)"}
      padding={0}
      style={{
        marginInlineStart: "auto",
        marginInlineEnd: 0,
        blockSize: "var(--xagent-viewport-height)",
        maxBlockSize: "var(--xagent-viewport-height)",
        ...(isCompact
          ? {}
          : { borderRadius: "var(--radius-container) 0 0 var(--radius-container)" }),
      }}
    >
      <AstryxView as="aside" className="flex h-full w-full flex-col">
        <AstryxView
          layout="flex"
          direction="horizontal"
          className="flex items-start gap-3 border-b border-border/40 px-5 py-4"
        >
          <AstryxView
            layout="flex"
            direction="horizontal"
            className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border/55 bg-background/80 text-foreground/85 shadow-[0_1px_0_rgba(255,255,255,0.55)_inset] dark:border-white/[0.09] dark:bg-white/[0.06] dark:shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]"
          >
            {detail?.ownerImage ? (
              <img
                src={detail.ownerImage}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <SkillIcon className="h-7 w-7" />
            )}
          </AstryxView>
          <AstryxView layout="block" direction="horizontal" className="min-w-0 flex-1">
            <AstryxView
              layout="block"
              direction="horizontal"
              className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80"
            >
              {t("settings.skillsStorePreviewTitle")}
            </AstryxView>
            <AstryxHeading
              level={2}
              className="mt-1 truncate text-base font-semibold tracking-tight text-foreground"
            >
              {data.displayName}
            </AstryxHeading>
            <AstryxView
              layout="flex"
              direction="horizontal"
              className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground"
            >
              {owner ? <AstryxInline className="truncate">@{owner}</AstryxInline> : null}
              <AstryxInline>v{version}</AstryxInline>
              {data.updatedAt ? (
                <AstryxInline>{formatStoreDate(data.updatedAt)}</AstryxInline>
              ) : null}
            </AstryxView>
          </AstryxView>
          <AstryxButton
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
            title={t("settings.cronViewClose")}
          >
            <X className="h-4 w-4" />
          </AstryxButton>
        </AstryxView>

        <AstryxView
          layout="block"
          direction="horizontal"
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
        >
          <AstryxView layout="flex" direction="vertical" className="flex flex-col gap-4">
            {data.summary ? (
              <AstryxParagraph className="text-[13px] leading-6 text-muted-foreground">
                {data.summary}
              </AstryxParagraph>
            ) : null}

            <AstryxView layout="grid" direction="horizontal" className="grid grid-cols-3 gap-2">
              <StorePreviewMetric
                label={t("settings.skillsStorePreviewDownloads")}
                value={formatCompactNumber(data.downloads)}
              />
              <StorePreviewMetric
                label={t("settings.skillsStorePreviewStars")}
                value={formatCompactNumber(data.stars)}
              />
              <StorePreviewMetric
                label={t("settings.skillsStorePreviewInstalls")}
                value={formatCompactNumber(data.installsCurrent)}
              />
            </AstryxView>

            {installState.installing && !installState.done ? (
              <AstryxView
                layout="block"
                direction="horizontal"
                className="rounded-2xl border border-border/50 bg-background/75 p-3 backdrop-blur-md"
              >
                <AstryxView
                  layout="flex"
                  direction="horizontal"
                  className="flex items-center justify-between gap-3 text-[11px] text-foreground/85"
                >
                  <AstryxInline>
                    {installPhaseLabel(installState.pending ? undefined : installState.job, t)}
                  </AstryxInline>
                  {installState.job && !installState.pending ? (
                    <AstryxInline>{formatInstallProgress(installState.job)}</AstryxInline>
                  ) : null}
                </AstryxView>
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/[0.08]"
                >
                  {installState.progress === null ? (
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="hub-loading-progress h-full rounded-full bg-foreground/55"
                    />
                  ) : (
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="h-full rounded-full bg-foreground/65 transition-[width] duration-300"
                      style={{ width: `${installState.progress}%` }}
                    />
                  )}
                </AstryxView>
              </AstryxView>
            ) : null}

            {installState.job?.phase === "error" &&
            installState.job.error &&
            !installState.done &&
            !installState.pending ? (
              <AstryxView
                layout="block"
                direction="horizontal"
                className="rounded-2xl border border-destructive/25 bg-destructive/5 p-3 text-[12px] text-destructive"
              >
                {installState.job.error}
              </AstryxView>
            ) : null}

            {error ? (
              <AstryxView
                layout="block"
                direction="horizontal"
                className="rounded-2xl border border-border/40 bg-muted/35 p-3"
              >
                <AstryxView
                  layout="flex"
                  direction="horizontal"
                  className="flex items-start gap-2 text-[12px] text-muted-foreground"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/65" />
                  <AstryxInline>{t("settings.skillsStorePreviewDetailUnavailable")}</AstryxInline>
                </AstryxView>
              </AstryxView>
            ) : null}

            {loading ? (
              <StorePreviewSkeleton />
            ) : (
              <>
                <AstryxView
                  layout="block"
                  direction="horizontal"
                  className="rounded-2xl border border-border/40 bg-background/60 p-3"
                >
                  <AstryxView
                    layout="block"
                    direction="horizontal"
                    className="mb-2 text-[12px] font-semibold text-foreground"
                  >
                    {t("settings.skillsStorePreviewMetadata")}
                  </AstryxView>
                  <AstryxView
                    layout="block"
                    direction="horizontal"
                    className="divide-y divide-border/30"
                  >
                    <StorePreviewField
                      label={t("settings.skillsStorePreviewSlug")}
                      value={data.slug}
                    />
                    <StorePreviewField
                      label={t("settings.skillsStorePreviewOwner")}
                      value={owner}
                    />
                    <StorePreviewField
                      label={t("settings.skillsStorePreviewVersion")}
                      value={version}
                    />
                    <StorePreviewField
                      label={t("settings.skillsStorePreviewUpdated")}
                      value={data.updatedAt ? formatFullStoreDate(data.updatedAt) : null}
                    />
                    <StorePreviewField
                      label={t("settings.skillsStorePreviewCreated")}
                      value={detail?.createdAt ? formatFullStoreDate(detail.createdAt) : null}
                    />
                    <StorePreviewField
                      label={t("settings.skillsStorePreviewPublished")}
                      value={
                        detail?.latestVersionCreatedAt
                          ? formatFullStoreDate(detail.latestVersionCreatedAt)
                          : null
                      }
                    />
                    <StorePreviewField
                      label={t("settings.skillsStorePreviewLicense")}
                      value={detail?.license}
                    />
                    <StorePreviewField
                      label={t("settings.skillsStorePreviewOs")}
                      value={supportedOs.length > 0 ? supportedOs.join(", ") : null}
                    />
                    <StorePreviewField
                      label={t("settings.skillsStorePreviewSystems")}
                      value={supportedSystems.length > 0 ? supportedSystems.join(", ") : null}
                    />
                    <StorePreviewField
                      label={t("settings.skillsStorePreviewModeration")}
                      value={detail?.moderationStatus}
                    />
                  </AstryxView>
                </AstryxView>

                {detail?.latestVersionChangelog ? (
                  <AstryxView
                    layout="block"
                    direction="horizontal"
                    className="rounded-2xl border border-border/40 bg-background/60 p-3"
                  >
                    <AstryxView
                      layout="block"
                      direction="horizontal"
                      className="mb-2 text-[12px] font-semibold text-foreground"
                    >
                      {t("settings.skillsStorePreviewChangelog")}
                    </AstryxView>
                    <AstryxParagraph className="whitespace-pre-wrap text-[12px] leading-5 text-muted-foreground">
                      {detail.latestVersionChangelog}
                    </AstryxParagraph>
                  </AstryxView>
                ) : null}
              </>
            )}
          </AstryxView>
        </AstryxView>

        <AstryxView
          layout="flex"
          direction="horizontal"
          className="flex shrink-0 gap-2 border-t border-border/40 px-5 py-4"
        >
          {link ? (
            <Link href={link} isExternalLink isStandalone weight="semibold">
              {t("settings.skillsStoreOpenInClawHub")}
            </Link>
          ) : null}
          <Button
            type="button"
            variant={installState.done ? "outline" : "default"}
            size="sm"
            className={cn(
              "h-9 flex-1 gap-1.5 rounded-xl",
              installState.done &&
                "border-border/55 bg-background/75 text-foreground/85 backdrop-blur-md",
            )}
            disabled={installState.done || installState.installing}
            aria-busy={installState.installing}
            onClick={onInstall}
          >
            {installState.installing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : installState.done ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Cloud className="h-3.5 w-3.5" />
            )}
            {actionLabel}
          </Button>
        </AstryxView>
      </AstryxView>
    </Dialog>
  );
}

function StorePreviewMetric(props: { label: string; value: string }) {
  return (
    <AstryxView
      layout="block"
      direction="horizontal"
      className="rounded-2xl border border-border/35 bg-background/60 px-3 py-2.5"
    >
      <AstryxView
        layout="block"
        direction="horizontal"
        className="text-[10.5px] text-muted-foreground"
      >
        {props.label}
      </AstryxView>
      <AstryxView
        layout="block"
        direction="horizontal"
        className="mt-1 text-sm font-semibold tabular-nums text-foreground"
      >
        {props.value}
      </AstryxView>
    </AstryxView>
  );
}

const STORE_PREVIEW_FIELD_WIDTHS = ["82%", "66.666%", "55%", "75%", "45%", "60%"] as const;

function StorePreviewSkeleton() {
  return (
    <>
      <AstryxView
        layout="block"
        direction="horizontal"
        className="rounded-2xl border border-border/40 bg-background/60 p-3"
      >
        <Skeleton
          width="var(--spacing-12)"
          height="calc(var(--spacing-2) + var(--spacing-0-5))"
          radius="rounded"
          index={0}
        />
        <AstryxView layout="block" direction="horizontal" className="divide-y divide-border/30">
          {STORE_PREVIEW_FIELD_WIDTHS.map((width, i) => (
            <AstryxView
              layout="grid"
              direction="horizontal"
              key={i}
              className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 py-2.5"
            >
              <Skeleton
                width="calc(var(--spacing-12) + var(--spacing-2))"
                height="calc(var(--spacing-2) + var(--spacing-0-5))"
                radius="rounded"
                index={i * 2 + 1}
              />
              <Skeleton
                width={width}
                height="calc(var(--spacing-2) + var(--spacing-0-5))"
                radius="rounded"
                index={i * 2 + 2}
              />
            </AstryxView>
          ))}
        </AstryxView>
      </AstryxView>
      <AstryxView
        layout="block"
        direction="horizontal"
        className="rounded-2xl border border-border/40 bg-background/60 p-3"
      >
        <Skeleton
          width="calc(var(--spacing-12) + var(--spacing-4))"
          height="calc(var(--spacing-2) + var(--spacing-0-5))"
          radius="rounded"
          index={13}
        />
        <AstryxView layout="block" direction="horizontal" className="space-y-2">
          <Skeleton
            width="100%"
            height="calc(var(--spacing-2) + var(--spacing-0-5))"
            radius="rounded"
            index={14}
          />
          <Skeleton
            width="91.666%"
            height="calc(var(--spacing-2) + var(--spacing-0-5))"
            radius="rounded"
            index={15}
          />
          <Skeleton
            width="60%"
            height="calc(var(--spacing-2) + var(--spacing-0-5))"
            radius="rounded"
            index={16}
          />
        </AstryxView>
      </AstryxView>
    </>
  );
}

function StorePreviewField(props: { label: string; value?: string | null }) {
  if (!props.value) return null;
  return (
    <AstryxView
      layout="grid"
      direction="horizontal"
      className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-2 text-[12px]"
    >
      <AstryxView layout="block" direction="horizontal" className="text-muted-foreground">
        {props.label}
      </AstryxView>
      <AstryxView
        layout="block"
        direction="horizontal"
        className="min-w-0 break-words text-foreground"
      >
        {props.value}
      </AstryxView>
    </AstryxView>
  );
}

function dedupeStoreItems(items: ClawHubSkillCard[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const storeKey = buildClawHubSkillKey(item);
    if (seen.has(storeKey)) return false;
    seen.add(storeKey);
    return true;
  });
}

function buildClawHubSkillUrl(skill: ClawHubSkillCard) {
  if (!skill.ownerHandle) return null;
  return `https://clawhub.ai/${encodeURIComponent(skill.ownerHandle)}/${encodeURIComponent(skill.slug)}`;
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatStoreDate(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function formatFullStoreDate(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function getInstallProgressPercent(job: SkillInstallJobSnapshot) {
  if (job.phase === "done") return 100;
  if (!job.totalBytes || job.totalBytes <= 0) return null;
  return Math.max(2, Math.min(100, Math.round((job.downloadedBytes / job.totalBytes) * 100)));
}

function formatInstallProgress(job: SkillInstallJobSnapshot) {
  if (job.phase === "done") return "100%";
  if (job.totalBytes && job.totalBytes > 0) {
    return `${formatBytes(job.downloadedBytes)} / ${formatBytes(job.totalBytes)}`;
  }
  return job.downloadedBytes > 0 ? formatBytes(job.downloadedBytes) : "";
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let next = value;
  let unit = 0;
  while (next >= 1024 && unit < units.length - 1) {
    next /= 1024;
    unit += 1;
  }
  return `${next >= 10 || unit === 0 ? Math.round(next) : next.toFixed(1)} ${units[unit]}`;
}

function installPhaseLabel(job: SkillInstallJobSnapshot | undefined, t: (key: string) => string) {
  switch (job?.phase) {
    case "queued":
      return t("settings.skillsStorePhaseQueued");
    case "downloading":
      return t("settings.skillsStorePhaseDownloading");
    case "extracting":
      return t("settings.skillsStorePhaseExtracting");
    case "validating":
      return t("settings.skillsStorePhaseValidating");
    case "installing":
      return t("settings.skillsStorePhaseInstalling");
    case "done":
      return t("settings.skillsStoreInstalled");
    case "error":
      return t("settings.skillsStorePhaseError");
    default:
      return t("settings.skillsStorePhasePreparing");
  }
}

import { Dialog } from "@astryxdesign/core/Dialog";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import {
  Heading as AstryxHeading,
  Paragraph as AstryxParagraph,
} from "@xagent/ui/components/ui/view";
