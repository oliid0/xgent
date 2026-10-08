import type { SkillInstallJobSnapshot } from "../lib/skills";
import {
  buildClawHubSkillKey,
  type ClawHubSkillCard,
  type ClawHubSkillDetail,
} from "../lib/skills/clawHub";
import { getInstallProgressPercent, installPhaseLabel } from "../lib/skills/installPresentation";
import type { presentationControls } from "./controls";
import { compactExtensionPreview } from "./nativeExtensionPreview";
import type { PresentationNode } from "./types";

export function nativeSkillInstallState(
  skill: ClawHubSkillCard,
  options: {
    installedKeys: ReadonlySet<string>;
    installedSlugs: ReadonlySet<string>;
    pendingKeys: ReadonlySet<string>;
    jobsByKey: Record<string, string>;
    jobs: Record<string, SkillInstallJobSnapshot>;
  },
) {
  const key = buildClawHubSkillKey(skill);
  const job = options.jobs[options.jobsByKey[key]];
  const pending = options.pendingKeys.has(key);
  const done =
    options.installedKeys.has(key) ||
    (!skill.ownerHandle && options.installedSlugs.has(skill.slug)) ||
    job?.phase === "done";
  const running = pending || (!!job && !["done", "error", "cancelled"].includes(job.phase));
  const progress = pending || !job ? null : getInstallProgressPercent(job);
  return { key, job, pending, done, running, progress };
}

export function nativeSkillStoreCard(options: {
  c: ReturnType<typeof presentationControls>;
  skill: ClawHubSkillCard;
  state: ReturnType<typeof nativeSkillInstallState>;
  t: (key: string) => string;
  install: () => void;
  preview: () => void;
  instance?: "detail";
}): PresentationNode {
  const { c, skill, state, t } = options;
  const id = `${options.instance === "detail" ? "skill-store-detail-card" : "skill-store"}:${state.key}`;
  const label = state.done
    ? t("settings.skillsStoreInstalled")
    : state.running
      ? installPhaseLabel(state.pending ? undefined : state.job, t)
      : t("settings.skillsStoreInstall");
  return {
    id,
    kind: "VStack",
    variant: "skill-store-card",
    label: skill.displayName,
    children: [
      { ...c.action(`${id}:preview`, skill.displayName, options.preview), variant: "ghost" },
      { id: `${id}:summary`, kind: "Text", text: skill.summary, secondary: true, maxLines: 3 },
      {
        id: `${id}:metadata`,
        kind: "VStack",
        variant: "skill-tags",
        children: [
          {
            id: `${id}:owner`,
            kind: "Badge",
            label: skill.ownerHandle ? `@${skill.ownerHandle}` : skill.slug,
          },
          {
            id: `${id}:version`,
            kind: "Badge",
            label: skill.latestVersion || t("settings.skillsStoreVersionLatest"),
          },
          {
            id: `${id}:downloads`,
            kind: "Badge",
            label: `${t("settings.skillsStorePreviewDownloads")} ${skill.downloads}`,
          },
          {
            id: `${id}:stars`,
            kind: "Badge",
            label: `${t("settings.skillsStorePreviewStars")} ${skill.stars}`,
          },
        ],
      },
      ...(state.running && !state.done
        ? [
            {
              id: `${id}:progress`,
              kind: "Progress" as const,
              label,
              ...(state.progress !== null ? { current: state.progress, total: 100 } : {}),
            },
          ]
        : []),
      ...(state.job?.phase === "error" && state.job.error && !state.done && !state.pending
        ? [
            {
              id: `${id}:error`,
              kind: "Banner" as const,
              status: "error" as const,
              label: state.job.error,
            },
          ]
        : []),
      {
        ...c.action(`${id}:install`, label, options.install, !state.done && !state.running),
        prominent: !state.done,
      },
    ],
  };
}

export function nativeSkillStorePreview(options: {
  c: ReturnType<typeof presentationControls>;
  skill: ClawHubSkillCard;
  detail: ClawHubSkillDetail | null;
  loading: boolean;
  error: string | null;
  state: ReturnType<typeof nativeSkillInstallState>;
  t: (key: string) => string;
  close: () => void;
  install: () => void;
  open: (url: string) => Promise<unknown>;
}): PresentationNode {
  const { c, t, detail } = options;
  const data = detail ?? options.skill;
  const card = nativeSkillStoreCard({
    ...options,
    skill: data,
    preview: options.close,
    instance: "detail",
  });
  const value = (id: string, label: string, text: string): PresentationNode => ({
    id: `skill-store-detail:${id}`,
    kind: "VStack",
    variant: "skill-detail-value",
    label: t(label),
    text,
  });
  const date = (value: number | null | undefined) =>
    value ? new Date(value).toLocaleDateString() : "";
  const link =
    data.webUrl ||
    (data.ownerHandle
      ? `https://clawhub.ai/${encodeURIComponent(data.ownerHandle)}/${encodeURIComponent(data.slug)}`
      : "");
  return compactExtensionPreview(
    {
      id: "skill-store-preview",
      kind: "VStack",
      variant: "skill-preview",
      label: data.displayName,
      children: [
        {
          ...c.action("skill-store-preview-close", t("settings.close"), options.close),
          kind: "IconButton",
          icon: "xmark",
          variant: "ghost",
        },
        { id: "skill-store-detail-title", kind: "Heading", text: data.displayName },
        ...(card.children ?? []).filter((node) => !node.id.endsWith(":preview")),
        ...(options.loading
          ? [
              {
                id: "skill-store-detail-loading",
                kind: "Progress" as const,
                label: t("app.loading"),
              },
            ]
          : []),
        ...(options.error
          ? [
              {
                id: "skill-store-detail-error",
                kind: "Banner" as const,
                status: "error" as const,
                label: t("settings.skillsStorePreviewDetailUnavailable"),
                text: options.error,
              },
            ]
          : []),
        value("slug", "settings.skillsStorePreviewSlug", data.slug),
        value(
          "owner",
          "settings.skillsStorePreviewOwner",
          detail?.ownerDisplayName || data.ownerHandle || "",
        ),
        value("installs", "settings.skillsStorePreviewInstalls", String(data.installsCurrent)),
        ...(
          [
            ["updated", "settings.skillsStorePreviewUpdated", date(data.updatedAt)],
            ["created", "settings.skillsStorePreviewCreated", date(detail?.createdAt)],
            [
              "published",
              "settings.skillsStorePreviewPublished",
              date(detail?.latestVersionCreatedAt),
            ],
            ["license", "settings.skillsStorePreviewLicense", detail?.license],
            ["os", "settings.skillsStorePreviewOs", detail?.supportedOs.join(", ")],
            ["systems", "settings.skillsStorePreviewSystems", detail?.supportedSystems.join(", ")],
            ["moderation", "settings.skillsStorePreviewModeration", detail?.moderationStatus],
          ] as const
        ).flatMap(([id, key, text]) => (text ? [value(id, key, text)] : [])),
        ...(detail?.latestVersionChangelog
          ? [
              {
                id: "skill-store-changelog-title",
                kind: "Heading" as const,
                text: t("settings.skillsStorePreviewChangelog"),
              },
              {
                id: "skill-store-changelog",
                kind: "Markdown" as const,
                text: detail.latestVersionChangelog,
              },
            ]
          : []),
        ...(link
          ? [
              c.action("skill-store-open-link", t("settings.skillsStoreOpenInClawHub"), () =>
                options.open(link),
              ),
            ]
          : []),
      ],
    },
    {
      detailsLabel: t("settings.skillsStorePreviewMetadata"),
      metadata: (item) => item.variant === "skill-detail-value",
      footer: (item) => item.id.endsWith(":install") || item.id === "skill-store-open-link",
    },
  );
}
