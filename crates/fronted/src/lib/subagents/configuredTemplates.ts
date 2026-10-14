import type { AgentPromptTemplate, SubagentTemplateConfig } from "../settings";
import type { SubagentTemplate } from "./types";

export function configuredSubagentTemplates(
  legacy: AgentPromptTemplate[],
  team: SubagentTemplateConfig[] | undefined,
  scheduling: boolean,
): SubagentTemplate[] {
  const configured: SubagentTemplate[] = legacy
    .filter((t) => t.enabled && t.prompt.trim())
    .map((t) => ({ id: t.id, name: t.name, description: t.description, prompt: t.prompt }));
  if (!scheduling) return configured;
  const ids = new Set(configured.map((t) => t.id));
  for (const template of team ?? []) {
    if (!template.enabled || !template.prompt.trim() || ids.has(template.id)) continue;
    ids.add(template.id);
    configured.push({
      persistInstructions: true,
      id: template.id,
      name: template.name,
      description: template.description,
      prompt: template.prompt,
      modelValue: template.modelValue,
      requiredSkills: template.requiredSkills,
    });
  }
  return configured;
}
