import type { AppSettings, SubagentTemplateConfig } from "../../lib/settings";
import { configuredSubagentModels } from "../../lib/subagents/modelRouting";
import { parseDelegationSkills } from "./providerModelSettings";

export type SubagentTeamDraft = {
  template: SubagentTemplateConfig;
  original: SubagentTemplateConfig | null;
  skills: string;
};

export function subagentTeamDraft(
  template: SubagentTemplateConfig,
  existing = true,
): SubagentTeamDraft {
  return {
    template: { ...template },
    original: existing ? template : null,
    skills: (template.requiredSkills ?? []).join(", "),
  };
}

export function subagentTeamIssue(settings: AppSettings, draft: SubagentTeamDraft): string | null {
  const template = draft.template;
  if (!template.name.trim() || !template.prompt.trim()) return "subagentTeam.required";
  const skills = parseDelegationSkills(draft.skills);
  if (!skills) return "subagentTeam.invalidSkills";
  if (template.enabled && skills.some((s) => s === "image_generation" || s === "video_generation"))
    return "subagentTeam.media";
  const current = settings.system.subagentTemplates?.find((t) => t.id === template.id);
  if (draft.original ? JSON.stringify(current) !== JSON.stringify(draft.original) : !!current)
    return "subagentTeam.conflict";
  if (template.enabled) {
    const models = configuredSubagentModels(settings.customProviders);
    if (
      !models.some(
        (m) =>
          (!template.modelValue || m.value === template.modelValue) &&
          skills.every((s) => m.skills.includes(s)),
      )
    )
      return "subagentTeam.unavailable";
  }
  return null;
}

export function applySubagentTeamDraft(
  settings: AppSettings,
  draft: SubagentTeamDraft,
): AppSettings {
  if (subagentTeamIssue(settings, draft)) return settings;
  const skills = parseDelegationSkills(draft.skills)!;
  const template = {
    ...draft.template,
    name: draft.template.name.trim(),
    description: draft.template.description.trim(),
    prompt: draft.template.prompt.trim(),
    modelValue: draft.template.modelValue || undefined,
    requiredSkills: skills.length ? skills : undefined,
  };
  const team = settings.system.subagentTemplates ?? [];
  return {
    ...settings,
    system: {
      ...settings.system,
      subagentTemplates: draft.original
        ? team.map((t) => (t.id === template.id ? template : t))
        : [...team, template],
    },
  };
}
