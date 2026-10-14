import { useEffect, useRef, useState } from "react";
import type { AppSettings, SubagentTemplateConfig } from "../../lib/settings";
import { createUuid } from "../../lib/shared/id";
import { configuredSubagentModels } from "../../lib/subagents/modelRouting";
import {
  applySubagentTeamDraft,
  type SubagentTeamDraft,
  subagentTeamDraft,
  subagentTeamIssue,
} from "./subagentTeamDraft";
import type { SetSettingsFn } from "./types";

export function useSubagentTeamEditor(
  props: { settings: AppSettings; setSettings: SetSettingsFn },
  active = true,
) {
  const [draft, setDraft] = useState<SubagentTeamDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef({ ...props, active, mounted: true });
  Object.assign(latest.current, props, { active });
  const current = useRef(draft);
  const revision = useRef(0);
  useEffect(() => {
    latest.current.mounted = true;
    return () => {
      latest.current.mounted = false;
      revision.current++;
    };
  }, []);
  useEffect(() => {
    if (!active) {
      current.current = null;
      setDraft(null);
      setError(null);
      revision.current++;
    }
  }, [active]);
  const epoch = revision.current;
  const valid = () => latest.current.mounted && latest.current.active && revision.current === epoch;
  const open = (template?: SubagentTemplateConfig) => {
    if (!valid() || current.current) return;
    const next = subagentTeamDraft(
      template ?? {
        id: `team-${createUuid()}`,
        name: "",
        description: "",
        prompt: "",
        enabled: true,
      },
      !!template,
    );
    current.current = next;
    revision.current++;
    setDraft(next);
    setError(null);
  };
  const cancel = () => {
    if (!valid()) return;
    current.current = null;
    revision.current++;
    setDraft(null);
    setError(null);
  };
  const patch = (values: Partial<SubagentTemplateConfig> | { skills: string }) => {
    if (!valid() || !current.current) return;
    const next =
      "skills" in values
        ? { ...current.current, skills: values.skills }
        : { ...current.current, template: { ...current.current.template, ...values } };
    current.current = next;
    setDraft(next);
    setError(null);
  };
  const save = () => {
    if (!valid() || !current.current) return;
    const saving = current.current;
    const issue = subagentTeamIssue(latest.current.settings, saving);
    if (issue) {
      setError(issue);
      return;
    }
    latest.current.setSettings((previous) => applySubagentTeamDraft(previous, saving));
    cancel();
  };
  const remove = () => {
    if (!valid() || !current.current?.original) return;
    const original = current.current.original;
    const now = latest.current.settings.system.subagentTemplates?.find((t) => t.id === original.id);
    if (JSON.stringify(now) !== JSON.stringify(original)) {
      setError("subagentTeam.conflict");
      return;
    }
    latest.current.setSettings((previous) => {
      const team = previous.system.subagentTemplates ?? [];
      if (JSON.stringify(team.find((t) => t.id === original.id)) !== JSON.stringify(original))
        return previous;
      return {
        ...previous,
        system: { ...previous.system, subagentTemplates: team.filter((t) => t.id !== original.id) },
      };
    });
    cancel();
  };
  const models = configuredSubagentModels(props.settings.customProviders);
  const options = models.map((m) => ({
    value: m.value,
    label: `${m.providerName} / ${m.model} (${m.runtime.providerConfigId})`,
  }));
  if (draft?.template.modelValue && !options.some((o) => o.value === draft.template.modelValue))
    options.push({ value: draft.template.modelValue, label: draft.template.modelValue });
  return {
    team: props.settings.system.subagentTemplates ?? [],
    draft,
    error: error ?? (draft ? subagentTeamIssue(props.settings, draft) : null),
    options,
    scope: `subagent-team:${epoch}:${draft?.template.id ?? "list"}`,
    open,
    patch,
    cancel,
    save,
    remove,
  };
}

export type SubagentTeamEditor = ReturnType<typeof useSubagentTeamEditor>;
