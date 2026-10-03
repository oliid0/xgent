import type { SkillSummary } from "../lib/skills";
import { isAlwaysEnabledSkillName } from "../lib/skills";
import { stripInstalledSkillPreviewMetadata } from "../lib/skills/previewContent";
import type { InstalledSkillPreviewState } from "../pages/skills-hub/SkillsHubPage";
import type { presentationControls } from "./controls";
import type { PresentationNode } from "./types";

export function nativeSkillPreview(options: {
  c: ReturnType<typeof presentationControls>;
  skill: SkillSummary;
  preview: InstalledSkillPreviewState;
  checked: boolean;
  skillsEnabled: boolean;
  t: (key: string) => string;
  close: () => void;
  copy: (id: "description" | "content", text: string) => Promise<void>;
  copied: string;
}): PresentationNode {
  const { c, skill, preview, t } = options;
  const content = stripInstalledSkillPreviewMetadata(preview.content, skill);
  const source = skill.source;
  const status = isAlwaysEnabledSkillName(skill.name)
    ? "settings.skillsInstalledPreviewBuiltIn"
    : options.checked
      ? "settings.skillsInstalledPreviewSelected"
      : "settings.skillsInstalledPreviewUnselected";
  const value = (id: string, label: string, text: string): PresentationNode => ({
    id: `skill-preview:${id}`,
    kind: "VStack",
    variant: "skill-detail-value",
    label: t(label),
    text,
  });
  return {
    id: "skill-preview",
    kind: "VStack",
    variant: "skill-preview",
    label: skill.name,
    fill: true,
    children: [
      {
        ...c.action("skill-preview-close", t("settings.close"), options.close),
        kind: "IconButton",
        icon: "xmark",
        variant: "ghost",
      },
      { id: "skill-preview-title", kind: "Heading", text: skill.name },
      { id: "skill-preview-status", kind: "Badge", label: t(status) },
      ...(!options.skillsEnabled && !isAlwaysEnabledSkillName(skill.name)
        ? [
            {
              id: "skill-preview-disabled",
              kind: "Banner" as const,
              status: "paused" as const,
              label: t("settings.skillsHubToggleDisable"),
            },
          ]
        : []),
      value(
        "description",
        "settings.skillsInstalledPreviewDescription",
        skill.description || t("settings.skillsInstalledPreviewNoDescription"),
      ),
      c.action(
        "skill-preview-copy-description",
        options.copied === "description"
          ? t("settings.skillsInstalledPreviewCopied")
          : t("settings.skillsInstalledPreviewCopyDescription"),
        () => options.copy("description", skill.description),
      ),
      value("file", "settings.skillsInstalledPreviewSkillFile", skill.skillFile),
      value("directory", "settings.skillsInstalledPreviewBaseDir", skill.baseDir),
      value(
        "source",
        "settings.skillsInstalledPreviewSource",
        source?.registry ||
          (skill.builtIn ? t("settings.skillsInstalledPreviewBuiltIn") : skill.baseDir),
      ),
      ...(source?.version
        ? [value("version", "settings.skillsStorePreviewVersion", source.version)]
        : []),
      ...(source?.ownerHandle
        ? [value("owner", "settings.skillsStorePreviewOwner", source.ownerHandle)]
        : []),
      ...(source?.slug ? [value("slug", "settings.skillsStorePreviewSlug", source.slug)] : []),
      ...(source?.publishedAt
        ? [
            value(
              "published",
              "settings.skillsInstalledPreviewPublished",
              new Date(source.publishedAt).toLocaleDateString(),
            ),
          ]
        : []),
      ...(source?.compatibilityTransform
        ? [
            value(
              "compatibility",
              "settings.skillsInstalledPreviewSource",
              source.compatibilityTransform,
            ),
          ]
        : []),
      ...(preview.loading
        ? [{ id: "skill-preview-loading", kind: "Progress" as const, label: t("app.loading") }]
        : []),
      ...(preview.error
        ? [
            {
              id: "skill-preview-error",
              kind: "Banner" as const,
              status: "error" as const,
              label: preview.error,
            },
          ]
        : []),
      {
        id: "skill-preview-file-heading",
        kind: "Heading",
        text: t("settings.skillsInstalledPreviewFilePreview"),
      },
      {
        id: "skill-preview-content",
        kind: /\.(md|mdx|markdown)$/i.test(skill.skillFile) ? "Markdown" : "CodeBlock",
        text: content,
        language: /\.json$/i.test(skill.skillFile) ? "json" : "text",
        minHeight: 180,
      },
      ...(preview.truncated
        ? [
            {
              id: "skill-preview-truncated",
              kind: "Banner" as const,
              status: "paused" as const,
              label: t("settings.skillsInstalledPreviewTruncated").replace("{count}", "10000"),
            },
          ]
        : []),
      c.action(
        "skill-preview-copy-content",
        options.copied === "content"
          ? t("settings.skillsInstalledPreviewCopied")
          : t("settings.skillsInstalledPreviewCopyFile"),
        () => options.copy("content", content),
        !!content && !preview.loading,
      ),
    ],
  };
}
