import type { SkillSummary } from "../lib/skills";
import { isAlwaysEnabledSkillName, isUserSelectableSkill } from "../lib/skills";
import type { ClawHubCategorySlug } from "../lib/skills/clawHubCategories";
import type { presentationControls } from "./controls";
import type { PresentationNode } from "./types";

export const nativeSkillCategoryLabel = (value: string) =>
  `settings.skillsStoreCategory${value.charAt(0).toUpperCase()}${value.slice(1)}`;

export function nativeSkillInstalled(options: {
  c: ReturnType<typeof presentationControls>;
  items: { skill: SkillSummary; categories: ClawHubCategorySlug[] }[];
  selected: ReadonlySet<string>;
  bulkMode: boolean;
  bulkSelection: ReadonlySet<string>;
  deleting: string | null;
  t: (key: string) => string;
  toggle: (name: string, enabled: boolean) => void;
  toggleBulk: (name: string) => void;
  enterBulk: (name: string) => void;
  preview: (skill: SkillSummary) => void;
  remove: (skill: SkillSummary) => Promise<void>;
  category: (value: ClawHubCategorySlug) => void;
}): PresentationNode[] {
  const { c, t } = options;
  return options.items.map(({ skill, categories }) => {
    const id = `skill:${skill.baseDir}:${skill.name}`;
    const always = isAlwaysEnabledSkillName(skill.name);
    const selectable = isUserSelectableSkill(skill);
    return {
      id,
      kind: "VStack",
      variant: "skill-installed-row",
      label: skill.name,
      icon: always ? "lock" : "puzzlepiece.extension",
      selected: always || options.selected.has(skill.name),
      children: [
        {
          ...c.action(`${id}:preview`, skill.name, () => options.preview(skill)),
          variant: "ghost",
        },
        {
          id: `${id}:description`,
          kind: "Text",
          text: skill.description,
          secondary: true,
          maxLines: 2,
        },
        {
          id: `${id}:tags`,
          kind: "VStack",
          variant: "skill-tags",
          children: [
            ...(always
              ? [
                  {
                    id: `${id}:builtin`,
                    kind: "Badge" as const,
                    label: t("settings.skillsAlwaysOn"),
                  },
                ]
              : categories.slice(0, 3).map((value) => ({
                  ...c.action(`${id}:category:${value}`, t(nativeSkillCategoryLabel(value)), () =>
                    options.category(value),
                  ),
                  variant: "ghost",
                  size: "small" as const,
                }))),
            {
              id: `${id}:file`,
              kind: "Badge",
              label: options.selected.has(skill.name)
                ? t("settings.skillsHubEnabledBadge")
                : skill.skillFile,
            },
          ],
        },
        {
          id: `${id}:actions`,
          kind: "VStack",
          variant: "skill-row-actions",
          children: [
            ...(options.bulkMode
              ? [
                  c.toggle(
                    `${id}:bulk`,
                    `${t("settings.skillsHubBulkSelectLabel")}: ${skill.name}`,
                    options.bulkSelection.has(skill.name),
                    () => options.toggleBulk(skill.name),
                    selectable,
                  ),
                ]
              : [
                  ...(!always
                    ? [
                        {
                          ...c.action(`${id}:enter-bulk`, t("settings.skillsHubBulkSelect"), () =>
                            options.enterBulk(skill.name),
                          ),
                          kind: "IconButton" as const,
                          icon: "checklist",
                          variant: "ghost",
                        },
                      ]
                    : []),
                  c.toggle(
                    `${id}:enabled`,
                    `${t("settings.enable")}: ${skill.name}`,
                    always || options.selected.has(skill.name),
                    (enabled) => options.toggle(skill.name, enabled),
                    selectable,
                  ),
                  {
                    ...c.action(
                      `${id}:open`,
                      `${t("settings.skillsInstalledPreviewOpen")}: ${skill.name}`,
                      () => options.preview(skill),
                    ),
                    kind: "IconButton" as const,
                    icon: "doc.text",
                    variant: "ghost",
                  },
                  ...(!always
                    ? [
                        {
                          ...c.action(
                            `${id}:delete`,
                            t("settings.skillsHubDeleteSkill"),
                            () => options.remove(skill),
                            !options.deleting,
                          ),
                          kind: "IconButton" as const,
                          icon: "trash",
                          destructive: true,
                          variant: "ghost",
                        },
                      ]
                    : []),
                ]),
          ],
        },
      ],
    };
  });
}
